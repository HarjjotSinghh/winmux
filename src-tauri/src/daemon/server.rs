//! Named-pipe server for the `winmux-daemon` binary.
//!
//! Architecture:
//! - One named pipe instance per client connection (Windows PIPE_UNLIMITED_INSTANCES).
//! - Each connection gets: a reader thread (parses RPC requests, dispatches), a
//!   writer thread (serialises outbound lines from an mpsc channel to the pipe),
//!   and a set of attached session IDs.
//! - PTY output, exit, and OSC events emitted by `PtyManager` callbacks are
//!   broadcast to every client that has `attach`ed the relevant session ID.
//! - `daemon.shutdown` gracefully terminates the daemon.

use crate::daemon::protocol::{
    method, AttachResult, CapabilitiesResult, CreateSessionParams, CreatedResult,
    ListSessionsResult, ResizeParams, RpcNotification, RpcRequest, RpcResponse, SessionExitNotif,
    SessionIdParams, SessionInfo, SessionOscNotif, SessionOutputNotif, WriteParams,
    DAEMON_PIPE_NAME, PROTOCOL_VERSION,
};
use crate::pty::{OscNotif as PtyOscNotif, PtyManager, SessionCallbacks};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::io::{BufRead, BufReader, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex};

pub const DAEMON_VERSION: &str = env!("CARGO_PKG_VERSION");

type ClientId = u64;

/// Map of session_id -> list of attached client senders.
type Subscribers = Arc<Mutex<HashMap<String, Vec<ClientSender>>>>;

#[derive(Clone)]
struct ClientSender {
    client_id: ClientId,
    tx: Sender<String>,
}

struct DaemonState {
    pty: Arc<Mutex<PtyManager>>,
    subs: Subscribers,
    shutdown: Arc<AtomicBool>,
    next_client_id: Arc<Mutex<u64>>,
}

impl DaemonState {
    fn new() -> Self {
        Self {
            pty: Arc::new(Mutex::new(PtyManager::new())),
            subs: Arc::new(Mutex::new(HashMap::new())),
            shutdown: Arc::new(AtomicBool::new(false)),
            next_client_id: Arc::new(Mutex::new(1)),
        }
    }

    fn next_id(&self) -> ClientId {
        let mut lock = self.next_client_id.lock().unwrap();
        let id = *lock;
        *lock += 1;
        id
    }
}

pub fn run_daemon() -> Result<(), Box<dyn std::error::Error>> {
    log::info!("winmux-daemon starting on {}", DAEMON_PIPE_NAME);
    let state = Arc::new(DaemonState::new());

    #[cfg(windows)]
    {
        use windows_sys::Win32::Foundation::CloseHandle;
        loop {
            if state.shutdown.load(Ordering::SeqCst) {
                log::info!("Shutdown flag set — daemon exiting");
                break;
            }

            let handle = create_named_pipe()?;
            wait_for_connection(handle)?;

            let state_clone = state.clone();
            std::thread::spawn(move || {
                let client_id = state_clone.next_id();
                if let Err(e) = handle_client(handle, client_id, state_clone.clone()) {
                    log::debug!("Client {} error: {}", client_id, e);
                }
                unsafe { CloseHandle(handle as *mut std::ffi::c_void) };
                // Clean up subscriptions for this client
                if let Ok(mut subs) = state_clone.subs.lock() {
                    for senders in subs.values_mut() {
                        senders.retain(|s| s.client_id != client_id);
                    }
                }
            });
        }
    }

    #[cfg(not(windows))]
    {
        let _ = state;
        return Err("Named pipes only supported on Windows".into());
    }

    Ok(())
}

#[cfg(windows)]
fn create_named_pipe() -> Result<isize, Box<dyn std::error::Error>> {
    use windows_sys::Win32::Foundation::INVALID_HANDLE_VALUE;
    use windows_sys::Win32::Storage::FileSystem::PIPE_ACCESS_DUPLEX;
    use windows_sys::Win32::System::Pipes::*;

    let wide: Vec<u16> = DAEMON_PIPE_NAME
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();

    let handle = unsafe {
        CreateNamedPipeW(
            wide.as_ptr(),
            PIPE_ACCESS_DUPLEX,
            PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT,
            PIPE_UNLIMITED_INSTANCES,
            65536,
            65536,
            0,
            std::ptr::null(),
        )
    };

    if handle.is_null() || std::ptr::eq(handle, INVALID_HANDLE_VALUE) {
        return Err("Failed to create named pipe".into());
    }
    Ok(handle as isize)
}

#[cfg(windows)]
fn wait_for_connection(handle: isize) -> Result<(), Box<dyn std::error::Error>> {
    unsafe {
        windows_sys::Win32::System::Pipes::ConnectNamedPipe(
            handle as *mut std::ffi::c_void,
            std::ptr::null_mut(),
        )
    };
    Ok(())
}

#[cfg(windows)]
fn handle_client(
    handle: isize,
    client_id: ClientId,
    state: Arc<DaemonState>,
) -> Result<(), Box<dyn std::error::Error>> {
    use std::os::windows::io::FromRawHandle;

    let file = unsafe { std::fs::File::from_raw_handle(handle as *mut std::ffi::c_void) };
    let reader_file = file.try_clone()?;
    let writer_file = file;

    // mpsc channel: any thread can push outbound lines, writer thread drains.
    let (tx, rx) = mpsc::channel::<String>();

    // Writer thread
    let writer_handle = std::thread::spawn(move || {
        let mut writer = writer_file;
        while let Ok(line) = rx.recv() {
            if writer.write_all(line.as_bytes()).is_err() {
                break;
            }
            if writer.write_all(b"\n").is_err() {
                break;
            }
            if writer.flush().is_err() {
                break;
            }
        }
        // Don't double-close; caller does CloseHandle.
        std::mem::forget(writer);
    });

    let client_sender = ClientSender {
        client_id,
        tx: tx.clone(),
    };

    // Reader loop: parse requests, dispatch, send responses via tx.
    let reader = BufReader::new(reader_file);
    for line in reader.lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }

        let resp = match serde_json::from_str::<RpcRequest>(&line) {
            Ok(req) => dispatch(req, &state, &client_sender),
            Err(e) => RpcResponse::error(None, "parse_error", &format!("Invalid JSON: {}", e)),
        };

        let json = serde_json::to_string(&resp)?;
        if tx.send(json).is_err() {
            break;
        }
    }

    drop(tx); // signal writer to exit
    let _ = writer_handle.join();
    Ok(())
}

fn dispatch(
    req: RpcRequest,
    state: &Arc<DaemonState>,
    client: &ClientSender,
) -> RpcResponse {
    let id = req.id.clone();
    let params = req.params.clone().unwrap_or(Value::Null);

    match req.method.as_str() {
        method::PING => {
            RpcResponse::success(id, serde_json::json!({"status": "ok"}))
        }

        method::CAPABILITIES => {
            let result = CapabilitiesResult {
                protocol_version: PROTOCOL_VERSION,
                daemon_version: DAEMON_VERSION.into(),
            };
            match serde_json::to_value(&result) {
                Ok(v) => RpcResponse::success(id, v),
                Err(e) => RpcResponse::error(id, "internal", &e.to_string()),
            }
        }

        method::SHUTDOWN => {
            log::info!("Shutdown requested by client {}", client.client_id);
            state.shutdown.store(true, Ordering::SeqCst);
            // Close all sessions
            if let Ok(mut mgr) = state.pty.lock() {
                for id in mgr.list_ids() {
                    let _ = mgr.close(&id);
                }
            }
            RpcResponse::success(id, serde_json::json!({"ok": true}))
        }

        method::LIST_SESSIONS => {
            let mgr = match state.pty.lock() {
                Ok(m) => m,
                Err(e) => return RpcResponse::error(id, "internal", &e.to_string()),
            };
            let sessions: Vec<SessionInfo> = mgr
                .list_ids()
                .into_iter()
                .map(|sid| SessionInfo {
                    shell: mgr.get_shell(&sid).unwrap_or_default(),
                    cwd: mgr.get_cwd(&sid).unwrap_or_default(),
                    id: sid,
                })
                .collect();
            let result = ListSessionsResult { sessions };
            match serde_json::to_value(&result) {
                Ok(v) => RpcResponse::success(id, v),
                Err(e) => RpcResponse::error(id, "internal", &e.to_string()),
            }
        }

        method::CREATE_SESSION => {
            let p: CreateSessionParams = match serde_json::from_value(params) {
                Ok(p) => p,
                Err(e) => return RpcResponse::error(id, "bad_params", &e.to_string()),
            };
            let shell = p
                .shell
                .unwrap_or_else(|| "powershell.exe".to_string());
            let cwd = p.cwd;
            let subs = state.subs.clone();

            let mut mgr = match state.pty.lock() {
                Ok(m) => m,
                Err(e) => return RpcResponse::error(id, "internal", &e.to_string()),
            };

            let new_id = uuid::Uuid::new_v4().to_string();
            let callbacks = build_broadcast_callbacks(new_id.clone(), subs);

            match mgr.create(new_id.clone(), &shell, cwd.as_deref(), p.cols, p.rows, callbacks) {
                Ok(()) => {
                    let result = CreatedResult { id: new_id };
                    RpcResponse::success(id, serde_json::to_value(&result).unwrap())
                }
                Err(e) => RpcResponse::error(id, "create_failed", &e),
            }
        }

        method::CLOSE_SESSION => {
            let p: SessionIdParams = match serde_json::from_value(params) {
                Ok(p) => p,
                Err(e) => return RpcResponse::error(id, "bad_params", &e.to_string()),
            };
            let mut mgr = match state.pty.lock() {
                Ok(m) => m,
                Err(e) => return RpcResponse::error(id, "internal", &e.to_string()),
            };
            match mgr.close(&p.id) {
                Ok(_) => RpcResponse::success(id, serde_json::json!({"ok": true})),
                Err(e) => RpcResponse::error(id, "close_failed", &e),
            }
        }

        method::ATTACH_SESSION => {
            let p: SessionIdParams = match serde_json::from_value(params) {
                Ok(p) => p,
                Err(e) => return RpcResponse::error(id, "bad_params", &e.to_string()),
            };

            let (shell, cwd, scrollback) = {
                let mgr = match state.pty.lock() {
                    Ok(m) => m,
                    Err(e) => return RpcResponse::error(id, "internal", &e.to_string()),
                };
                let shell = match mgr.get_shell(&p.id) {
                    Ok(s) => s,
                    Err(e) => return RpcResponse::error(id, "not_found", &e),
                };
                let cwd = mgr.get_cwd(&p.id).unwrap_or_default();
                let sb = mgr.get_scrollback(&p.id).unwrap_or_default();
                (shell, cwd, sb)
            };

            // Register this client as a subscriber
            if let Ok(mut subs) = state.subs.lock() {
                let entry = subs.entry(p.id.clone()).or_default();
                if !entry.iter().any(|s| s.client_id == client.client_id) {
                    entry.push(client.clone());
                }
            }

            let result = AttachResult {
                scrollback_b64: B64.encode(&scrollback),
                shell,
                cwd,
            };
            match serde_json::to_value(&result) {
                Ok(v) => RpcResponse::success(id, v),
                Err(e) => RpcResponse::error(id, "internal", &e.to_string()),
            }
        }

        method::DETACH_SESSION => {
            let p: SessionIdParams = match serde_json::from_value(params) {
                Ok(p) => p,
                Err(e) => return RpcResponse::error(id, "bad_params", &e.to_string()),
            };
            if let Ok(mut subs) = state.subs.lock() {
                if let Some(entry) = subs.get_mut(&p.id) {
                    entry.retain(|s| s.client_id != client.client_id);
                }
            }
            RpcResponse::success(id, serde_json::json!({"ok": true}))
        }

        method::WRITE_SESSION => {
            let p: WriteParams = match serde_json::from_value(params) {
                Ok(p) => p,
                Err(e) => return RpcResponse::error(id, "bad_params", &e.to_string()),
            };
            let data = match B64.decode(p.data_b64.as_bytes()) {
                Ok(d) => d,
                Err(e) => return RpcResponse::error(id, "bad_b64", &e.to_string()),
            };
            let mgr = match state.pty.lock() {
                Ok(m) => m,
                Err(e) => return RpcResponse::error(id, "internal", &e.to_string()),
            };
            match mgr.write(&p.id, &data) {
                Ok(_) => RpcResponse::success(id, serde_json::json!({"ok": true})),
                Err(e) => RpcResponse::error(id, "write_failed", &e),
            }
        }

        method::RESIZE_SESSION => {
            let p: ResizeParams = match serde_json::from_value(params) {
                Ok(p) => p,
                Err(e) => return RpcResponse::error(id, "bad_params", &e.to_string()),
            };
            let mut mgr = match state.pty.lock() {
                Ok(m) => m,
                Err(e) => return RpcResponse::error(id, "internal", &e.to_string()),
            };
            match mgr.resize(&p.id, p.cols, p.rows) {
                Ok(_) => RpcResponse::success(id, serde_json::json!({"ok": true})),
                Err(e) => RpcResponse::error(id, "resize_failed", &e),
            }
        }

        method::GET_SCROLLBACK => {
            let p: SessionIdParams = match serde_json::from_value(params) {
                Ok(p) => p,
                Err(e) => return RpcResponse::error(id, "bad_params", &e.to_string()),
            };
            let mgr = match state.pty.lock() {
                Ok(m) => m,
                Err(e) => return RpcResponse::error(id, "internal", &e.to_string()),
            };
            match mgr.get_scrollback(&p.id) {
                Ok(bytes) => RpcResponse::success(
                    id,
                    serde_json::json!({"data_b64": B64.encode(&bytes)}),
                ),
                Err(e) => RpcResponse::error(id, "not_found", &e),
            }
        }

        method::GET_CWD => {
            let p: SessionIdParams = match serde_json::from_value(params) {
                Ok(p) => p,
                Err(e) => return RpcResponse::error(id, "bad_params", &e.to_string()),
            };
            let mgr = match state.pty.lock() {
                Ok(m) => m,
                Err(e) => return RpcResponse::error(id, "internal", &e.to_string()),
            };
            match mgr.get_cwd(&p.id) {
                Ok(cwd) => RpcResponse::success(id, serde_json::json!({"cwd": cwd})),
                Err(e) => RpcResponse::error(id, "not_found", &e),
            }
        }

        _ => RpcResponse::error(
            id,
            "method_not_found",
            &format!("Unknown method: {}", req.method),
        ),
    }
}

fn build_broadcast_callbacks(session_id: String, subs: Subscribers) -> SessionCallbacks {
    let sid_out = session_id.clone();
    let subs_out = subs.clone();
    let sid_osc = session_id.clone();
    let subs_osc = subs.clone();
    let sid_exit = session_id;
    let subs_exit = subs;

    SessionCallbacks {
        on_output: Box::new(move |data: &[u8]| {
            let notif = RpcNotification::new(
                method::SESSION_OUTPUT,
                serde_json::to_value(SessionOutputNotif {
                    id: sid_out.clone(),
                    data_b64: B64.encode(data),
                })
                .unwrap(),
            );
            push_to_subscribers(&subs_out, &sid_out, &notif);
        }),
        on_osc: Box::new(move |n: &PtyOscNotif| {
            // Also fire a Windows toast, matching UI behavior.
            crate::notification::send_system_notification(&n.title, &n.body);

            let notif = RpcNotification::new(
                method::SESSION_OSC,
                serde_json::to_value(SessionOscNotif {
                    id: sid_osc.clone(),
                    osc_type: n.osc_type.clone(),
                    title: n.title.clone(),
                    body: n.body.clone(),
                })
                .unwrap(),
            );
            push_to_subscribers(&subs_osc, &sid_osc, &notif);
        }),
        on_exit: Box::new(move |code: Option<u32>| {
            let notif = RpcNotification::new(
                method::SESSION_EXIT,
                serde_json::to_value(SessionExitNotif {
                    id: sid_exit.clone(),
                    exit_code: code,
                })
                .unwrap(),
            );
            push_to_subscribers(&subs_exit, &sid_exit, &notif);
            // Remove all subscriptions for this session
            if let Ok(mut subs) = subs_exit.lock() {
                subs.remove(&sid_exit);
            }
        }),
    }
}

fn push_to_subscribers(subs: &Subscribers, session_id: &str, notif: &RpcNotification) {
    let Ok(subs) = subs.lock() else { return };
    let Some(senders) = subs.get(session_id) else { return };
    let Ok(line) = serde_json::to_string(notif) else { return };
    for s in senders {
        let _ = s.tx.send(line.clone());
    }
}

// Silence "dead subscribers set — only used in push_to_subscribers" alerts
// when cfg(not(windows)).
#[allow(dead_code)]
struct HashSetUnused(HashSet<ClientId>);
