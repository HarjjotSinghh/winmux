//! Client for the `winmux-daemon` named pipe.
//!
//! Blocking-sync design (no async runtime). A single pipe connection is opened
//! once on `connect()`; reads and writes use separately-cloned file handles.
//! A dedicated reader thread parses every inbound line and routes it:
//!
//! * **Responses** (have numeric `id`) → completed through an mpsc channel kept
//!   in `pending[id]` so the requester thread unblocks.
//! * **Push notifications** (`session.output|exit|osc`) → dispatched to the
//!   session's registered `SessionSinks`.

use crate::daemon::protocol::{method, DAEMON_PIPE_NAME};
use crate::pty::OscNotif;
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

/// How long a daemon RPC may block before we fail fast. Short enough that a
/// hung daemon won't back up the Tauri command worker pool under normal UI
/// activity (4 terminals × periodic save + keystrokes = dozens of RPCs/sec).
pub const CALL_TIMEOUT: Duration = Duration::from_secs(3);

/// Sinks a caller plugs in per daemon session — output bytes, OSC events, and
/// exit code all route here.
#[allow(clippy::type_complexity)]
pub struct SessionSinks {
    pub on_output: Box<dyn Fn(Vec<u8>) + Send + Sync>,
    pub on_exit: Box<dyn Fn(Option<u32>) + Send + Sync>,
    pub on_osc: Box<dyn Fn(&OscNotif) + Send + Sync>,
}

struct Inner {
    writer: Mutex<std::fs::File>,
    next_id: AtomicU64,
    pending: Arc<Mutex<HashMap<u64, Sender<CallResult>>>>,
    sinks: Arc<Mutex<HashMap<String, SessionSinks>>>,
}

pub struct DaemonClient {
    inner: Arc<Inner>,
}

struct CallResult {
    ok: bool,
    result: Option<Value>,
    error_message: Option<String>,
}

impl DaemonClient {
    /// Open the named pipe and spawn the reader thread. Returns `Err` if the
    /// pipe isn't there — callers can treat that as "daemon not running".
    ///
    /// When the reader thread exits (pipe closes — daemon crash or explicit
    /// shutdown), a supervisor thread kicks in: existing sessions are marked
    /// exited (their PTYs died with the daemon), and we attempt to respawn.
    /// A shared crash-rate gate prevents a panic-looping daemon from being
    /// restarted forever.
    pub fn connect(app: AppHandle) -> Result<Self, String> {
        Self::connect_with_supervision(app, true)
    }

    /// Internal variant. `supervise=false` during the initial `connect_or_spawn`
    /// retry loop so probe connections that close immediately don't trigger
    /// a full supervisor run.
    fn connect_with_supervision(app: AppHandle, supervise: bool) -> Result<Self, String> {
        let (reader_file, writer_file) = open_pipe_pair()?;

        let inner = Arc::new(Inner {
            writer: Mutex::new(writer_file),
            next_id: AtomicU64::new(1),
            pending: Arc::new(Mutex::new(HashMap::new())),
            sinks: Arc::new(Mutex::new(HashMap::new())),
        });

        let reader_inner = inner.clone();
        let app_for_disconnect = app;
        std::thread::spawn(move || {
            reader_loop(reader_file, reader_inner.clone());
            log::warn!("daemon_client: reader exited — daemon disconnected");

            // PTYs die with the daemon. Notify every attached tab so the UI
            // can render "[process exited]" instead of silently going deaf.
            if let Ok(mut sinks) = reader_inner.sinks.lock() {
                for (id, s) in sinks.drain() {
                    log::info!("daemon_client: marking session {} exited (daemon gone)", id);
                    (s.on_exit)(None);
                }
            }

            // Unblock any in-flight RPC so callers don't wait the full 3s.
            if let Ok(mut pending) = reader_inner.pending.lock() {
                for (_id, tx) in pending.drain() {
                    let _ = tx.send(CallResult {
                        ok: false,
                        result: None,
                        error_message: Some("daemon disconnected".into()),
                    });
                }
            }

            if supervise {
                std::thread::spawn(move || supervise_reconnect(app_for_disconnect));
            }
        });

        Ok(DaemonClient { inner })
    }

    /// Connect, or try to spawn `winmux-daemon.exe` next to the current exe
    /// and reconnect. Returns `Ok(None)` if the daemon binary isn't present
    /// or couldn't be started — caller should fall back to in-process PTYs.
    pub fn connect_or_spawn(app: AppHandle) -> Option<Self> {
        // First attempt — probe unsupervised so a failed ping (stale pipe)
        // doesn't immediately kick off a supervisor run.
        if let Ok(probe) = Self::connect_with_supervision(app.clone(), false) {
            if probe.ping().is_ok() {
                drop(probe);
                if let Ok(client) = Self::connect(app.clone()) {
                    if client.ping().is_ok() {
                        log::info!("daemon: attached to existing instance");
                        return Some(client);
                    }
                }
            }
        }

        // Try to spawn the daemon next to the current exe
        if let Err(e) = spawn_daemon_detached() {
            log::warn!("daemon: could not spawn — falling back to in-process ({})", e);
            return None;
        }

        // Retry connect up to ~3 seconds. Probes are unsupervised; only the
        // final returned client has a supervisor attached.
        for attempt in 0..15 {
            std::thread::sleep(Duration::from_millis(200));
            if let Ok(probe) = Self::connect_with_supervision(app.clone(), false) {
                if probe.ping().is_ok() {
                    drop(probe);
                    if let Ok(client) = Self::connect(app.clone()) {
                        if client.ping().is_ok() {
                            log::info!("daemon: spawned and connected (attempt {})", attempt + 1);
                            return Some(client);
                        }
                    }
                }
            }
        }

        log::warn!("daemon: spawn succeeded but pipe never opened — falling back");
        None
    }
}

// ── Supervisor / crash-rate gate ────────────────────────────────────

static CRASH_WINDOW_START: AtomicU64 = AtomicU64::new(0);
static CRASH_COUNT: AtomicU32 = AtomicU32::new(0);

const MAX_CRASHES_IN_WINDOW: u32 = 3;
const CRASH_WINDOW_SECS: u64 = 60;

fn should_respawn() -> bool {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let start = CRASH_WINDOW_START.load(Ordering::SeqCst);

    if start == 0 || now.saturating_sub(start) > CRASH_WINDOW_SECS {
        CRASH_WINDOW_START.store(now, Ordering::SeqCst);
        CRASH_COUNT.store(1, Ordering::SeqCst);
        true
    } else {
        let count = CRASH_COUNT.fetch_add(1, Ordering::SeqCst) + 1;
        count <= MAX_CRASHES_IN_WINDOW
    }
}

/// Runs in its own thread after the daemon pipe closes. Attempts one
/// respawn via `connect_or_spawn` (which internally retries pipe open for
/// ~3s) and installs the new client into the managed `DaemonHandle`.
fn supervise_reconnect(app: AppHandle) {
    let state: tauri::State<crate::DaemonHandle> = app.state();

    // If the app is shutting down, the pipe close is expected — don't
    // respawn (it'd race the app.exit and potentially leak a daemon
    // process) and don't count toward the crash cap.
    if state.is_shutting_down() {
        log::info!("daemon: pipe closed during app shutdown — skipping respawn");
        return;
    }

    if !should_respawn() {
        log::error!(
            "daemon: crash-loop detected (>{} crashes in {}s) — giving up",
            MAX_CRASHES_IN_WINDOW, CRASH_WINDOW_SECS
        );
        let _ = app.emit("daemon-dead", ());
        return;
    }

    let _ = app.emit("daemon-reconnecting", ());
    log::info!("daemon: supervisor attempting respawn");

    std::thread::sleep(Duration::from_millis(500));

    match DaemonClient::connect_or_spawn(app.clone()) {
        Some(client) => {
            let arc = Arc::new(client);
            if let Ok(mut slot) = state.client.lock() {
                *slot = Some(arc);
            }
            log::info!("daemon: supervisor reconnected successfully");
            let _ = app.emit("daemon-reconnected", ());
        }
        None => {
            log::error!("daemon: supervisor respawn failed");
            if let Ok(mut slot) = state.client.lock() {
                *slot = None;
            }
            let _ = app.emit("daemon-dead", ());
        }
    }
}

#[cfg(windows)]
fn spawn_daemon_detached() -> Result<(), String> {
    use std::fs::OpenOptions;
    use std::os::windows::process::CommandExt;
    use std::process::{Command, Stdio};

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    const DETACHED_PROCESS: u32 = 0x0000_0008;

    let current_exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let daemon_exe = current_exe
        .parent()
        .ok_or_else(|| "current exe has no parent".to_string())?
        .join("winmux-daemon.exe");

    if !daemon_exe.exists() {
        return Err(format!("daemon binary missing at {}", daemon_exe.display()));
    }

    // Redirect daemon stdout+stderr to a log file. With DETACHED_PROCESS the
    // daemon has no console, so without this any panic/crash vanishes silently.
    // Having the file lets us do post-mortem on "why did it disconnect?".
    let mut stdout_stdio = Stdio::null();
    let mut stderr_stdio = Stdio::null();
    let log_path_msg = match daemon_log_path() {
        Ok(path) => {
            if let Some(parent) = path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            match OpenOptions::new().create(true).append(true).open(&path) {
                Ok(f) => match f.try_clone() {
                    Ok(f2) => {
                        stdout_stdio = Stdio::from(f);
                        stderr_stdio = Stdio::from(f2);
                        format!(" (log: {})", path.display())
                    }
                    Err(e) => format!(" (log open failed: clone {})", e),
                },
                Err(e) => format!(" (log open failed: {})", e),
            }
        }
        Err(e) => format!(" (log path unresolved: {})", e),
    };

    log::info!("daemon: spawning {}{}", daemon_exe.display(), log_path_msg);
    Command::new(&daemon_exe)
        .creation_flags(CREATE_NO_WINDOW | DETACHED_PROCESS)
        .stdout(stdout_stdio)
        .stderr(stderr_stdio)
        .spawn()
        .map_err(|e| format!("spawn daemon: {}", e))?;

    Ok(())
}

#[cfg(windows)]
fn daemon_log_path() -> Result<std::path::PathBuf, String> {
    let local_appdata = std::env::var("LOCALAPPDATA")
        .map_err(|_| "LOCALAPPDATA env var not set".to_string())?;
    Ok(std::path::PathBuf::from(local_appdata)
        .join("WinMux")
        .join("daemon.log"))
}

#[cfg(not(windows))]
fn spawn_daemon_detached() -> Result<(), String> {
    Err("Daemon only supported on Windows".into())
}

impl DaemonClient {

    /// Synchronously send an RPC request and wait for the matching response.
    fn call(&self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.inner.next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = mpsc::channel::<CallResult>();

        self.inner
            .pending
            .lock()
            .map_err(|e| e.to_string())?
            .insert(id, tx);

        let req = json!({ "id": id, "method": method, "params": params });
        let line = serde_json::to_string(&req).map_err(|e| e.to_string())?;

        {
            let mut w = self.inner.writer.lock().map_err(|e| e.to_string())?;
            w.write_all(line.as_bytes()).map_err(|e| e.to_string())?;
            w.write_all(b"\n").map_err(|e| e.to_string())?;
            w.flush().map_err(|e| e.to_string())?;
        }

        match rx.recv_timeout(CALL_TIMEOUT) {
            Ok(res) => {
                if res.ok {
                    Ok(res.result.unwrap_or(Value::Null))
                } else {
                    Err(res.error_message.unwrap_or_else(|| "daemon error".into()))
                }
            }
            Err(_) => {
                // Remove pending entry on timeout
                if let Ok(mut p) = self.inner.pending.lock() {
                    p.remove(&id);
                }
                Err(format!("daemon call `{}` timed out", method))
            }
        }
    }

    pub fn ping(&self) -> Result<(), String> {
        self.call(method::PING, Value::Null).map(|_| ())
    }

    /// Tell the daemon to close every session and exit.
    pub fn shutdown(&self) -> Result<(), String> {
        self.call(method::SHUTDOWN, Value::Null).map(|_| ())
    }

    pub fn list_sessions(&self) -> Result<Vec<SessionInfoLite>, String> {
        let v = self.call(method::LIST_SESSIONS, Value::Null)?;
        let arr = v.get("sessions").and_then(|x| x.as_array()).cloned().unwrap_or_default();
        let mut out = Vec::with_capacity(arr.len());
        for item in arr {
            out.push(serde_json::from_value(item).map_err(|e| e.to_string())?);
        }
        Ok(out)
    }

    /// Create a brand new PTY session, register the sinks, and start receiving
    /// output. Returns the daemon-assigned session ID.
    pub fn create_session(
        &self,
        shell: Option<&str>,
        cwd: Option<&str>,
        cols: u16,
        rows: u16,
        sinks: SessionSinks,
    ) -> Result<String, String> {
        let params = json!({
            "shell": shell,
            "cwd": cwd,
            "cols": cols,
            "rows": rows,
        });
        let v = self.call(method::CREATE_SESSION, params)?;
        let id = v
            .get("id")
            .and_then(|x| x.as_str())
            .ok_or_else(|| "create_session: missing id".to_string())?
            .to_string();

        // Register sinks BEFORE attaching so we can't miss output.
        self.inner
            .sinks
            .lock()
            .map_err(|e| e.to_string())?
            .insert(id.clone(), sinks);

        self.call(method::ATTACH_SESSION, json!({ "id": id }))?;
        Ok(id)
    }

    /// Attach to an existing session (used on UI restart). Returns scrollback
    /// bytes so the caller can replay them into xterm before live output flows.
    /// Registers sinks to receive subsequent output.
    pub fn attach_session(
        &self,
        id: &str,
        sinks: SessionSinks,
    ) -> Result<AttachInfo, String> {
        self.inner
            .sinks
            .lock()
            .map_err(|e| e.to_string())?
            .insert(id.to_string(), sinks);

        let v = self.call(method::ATTACH_SESSION, json!({ "id": id }))?;
        let scrollback_b64 = v
            .get("scrollback_b64")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string();
        let scrollback = B64.decode(scrollback_b64).unwrap_or_default();
        let shell = v
            .get("shell")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string();
        let cwd = v
            .get("cwd")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string();
        Ok(AttachInfo {
            scrollback,
            shell,
            cwd,
        })
    }

    pub fn write_session(&self, id: &str, data: &[u8]) -> Result<(), String> {
        self.call(
            method::WRITE_SESSION,
            json!({ "id": id, "data_b64": B64.encode(data) }),
        )
        .map(|_| ())
    }

    pub fn resize_session(&self, id: &str, cols: u16, rows: u16) -> Result<(), String> {
        self.call(
            method::RESIZE_SESSION,
            json!({ "id": id, "cols": cols, "rows": rows }),
        )
        .map(|_| ())
    }

    pub fn close_session(&self, id: &str) -> Result<(), String> {
        // Drop local sinks first so we stop forwarding output.
        if let Ok(mut sinks) = self.inner.sinks.lock() {
            sinks.remove(id);
        }
        self.call(method::CLOSE_SESSION, json!({ "id": id })).map(|_| ())
    }

    pub fn get_cwd(&self, id: &str) -> Result<String, String> {
        let v = self.call(method::GET_CWD, json!({ "id": id }))?;
        Ok(v.get("cwd")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string())
    }

    pub fn get_scrollback(&self, id: &str) -> Result<Vec<u8>, String> {
        let v = self.call(method::GET_SCROLLBACK, json!({ "id": id }))?;
        let b64 = v
            .get("data_b64")
            .and_then(|x| x.as_str())
            .unwrap_or("");
        B64.decode(b64).map_err(|e| e.to_string())
    }
}

#[derive(Debug)]
pub struct AttachInfo {
    pub scrollback: Vec<u8>,
    pub shell: String,
    pub cwd: String,
}

#[derive(Debug, serde::Deserialize)]
pub struct SessionInfoLite {
    pub id: String,
    pub shell: String,
    pub cwd: String,
}

// ── Reader loop ─────────────────────────────────────────────────────

fn reader_loop(reader_file: std::fs::File, inner: Arc<Inner>) {
    let reader = BufReader::new(reader_file);
    for line in reader.lines() {
        let Ok(line) = line else {
            log::debug!("DaemonClient reader: pipe closed");
            break;
        };
        if line.trim().is_empty() {
            continue;
        }
        let Ok(v) = serde_json::from_str::<Value>(&line) else {
            log::debug!("DaemonClient reader: bad json: {}", line);
            continue;
        };

        if v.get("id").and_then(|x| x.as_u64()).is_some() {
            // Response
            let id = v["id"].as_u64().unwrap();
            let ok = v.get("ok").and_then(|x| x.as_bool()).unwrap_or(false);
            let result = v.get("result").cloned();
            let error_message = v
                .get("error")
                .and_then(|e| e.get("message"))
                .and_then(|m| m.as_str())
                .map(|s| s.to_string());

            if let Ok(mut p) = inner.pending.lock() {
                if let Some(tx) = p.remove(&id) {
                    let _ = tx.send(CallResult {
                        ok,
                        result,
                        error_message,
                    });
                }
            }
        } else if let Some(m) = v.get("method").and_then(|x| x.as_str()) {
            // Push notification
            dispatch_notification(m, v.get("params").cloned().unwrap_or(Value::Null), &inner);
        }
    }
}

fn dispatch_notification(method_name: &str, params: Value, inner: &Arc<Inner>) {
    match method_name {
        method::SESSION_OUTPUT => {
            let Some(id) = params.get("id").and_then(|x| x.as_str()) else { return };
            let Some(b64) = params.get("data_b64").and_then(|x| x.as_str()) else { return };
            let Ok(data) = B64.decode(b64) else { return };
            let sinks = match inner.sinks.lock() {
                Ok(s) => s,
                Err(_) => return,
            };
            if let Some(s) = sinks.get(id) {
                (s.on_output)(data);
            }
        }
        method::SESSION_EXIT => {
            let Some(id) = params.get("id").and_then(|x| x.as_str()) else { return };
            let code = params
                .get("exit_code")
                .and_then(|x| x.as_u64())
                .map(|x| x as u32);
            let sinks = match inner.sinks.lock() {
                Ok(s) => s,
                Err(_) => return,
            };
            if let Some(s) = sinks.get(id) {
                (s.on_exit)(code);
            }
        }
        method::SESSION_OSC => {
            let Some(id) = params.get("id").and_then(|x| x.as_str()) else { return };
            let osc_type = params
                .get("osc_type")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .to_string();
            let title = params
                .get("title")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .to_string();
            let body = params
                .get("body")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .to_string();
            let notif = OscNotif {
                osc_type,
                title,
                body,
            };
            let sinks = match inner.sinks.lock() {
                Ok(s) => s,
                Err(_) => return,
            };
            if let Some(s) = sinks.get(id) {
                (s.on_osc)(&notif);
            }
        }
        _ => {
            log::debug!("DaemonClient: unknown push method {}", method_name);
        }
    }
}

// ── Pipe plumbing ───────────────────────────────────────────────────

#[cfg(windows)]
fn open_pipe_pair() -> Result<(std::fs::File, std::fs::File), String> {
    use std::fs::OpenOptions;
    use std::os::windows::fs::OpenOptionsExt;
    use windows_sys::Win32::Storage::FileSystem::FILE_FLAG_OVERLAPPED;

    // Regular file open works for Windows named pipes.
    // We avoid FILE_FLAG_OVERLAPPED since we use blocking reads/writes.
    let _ = FILE_FLAG_OVERLAPPED; // silence unused import on non-overlapped builds

    let writer = OpenOptions::new()
        .read(true)
        .write(true)
        .share_mode(0x0000_0003) // FILE_SHARE_READ | FILE_SHARE_WRITE
        .open(DAEMON_PIPE_NAME)
        .map_err(|e| format!("connect winmux-daemon pipe: {}", e))?;

    let reader = writer
        .try_clone()
        .map_err(|e| format!("clone pipe handle: {}", e))?;

    Ok((reader, writer))
}

#[cfg(not(windows))]
fn open_pipe_pair() -> Result<(std::fs::File, std::fs::File), String> {
    Err("Daemon client only implemented on Windows".into())
}
