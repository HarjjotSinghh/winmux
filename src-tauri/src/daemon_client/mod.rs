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
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;

pub const CALL_TIMEOUT: Duration = Duration::from_secs(15);

/// Sinks a caller plugs in per daemon session — output bytes, OSC events, and
/// exit code all route here.
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
    pub fn connect() -> Result<Self, String> {
        let (reader_file, writer_file) = open_pipe_pair()?;

        let inner = Arc::new(Inner {
            writer: Mutex::new(writer_file),
            next_id: AtomicU64::new(1),
            pending: Arc::new(Mutex::new(HashMap::new())),
            sinks: Arc::new(Mutex::new(HashMap::new())),
        });

        // Spawn reader thread
        let reader_inner = inner.clone();
        std::thread::spawn(move || {
            reader_loop(reader_file, reader_inner);
        });

        Ok(DaemonClient { inner })
    }

    /// Connect, or try to spawn `winmux-daemon.exe` next to the current exe
    /// and reconnect. Returns `Ok(None)` if the daemon binary isn't present
    /// or couldn't be started — caller should fall back to in-process PTYs.
    pub fn connect_or_spawn() -> Option<Self> {
        // First attempt
        if let Ok(client) = Self::connect() {
            if client.ping().is_ok() {
                log::info!("daemon: attached to existing instance");
                return Some(client);
            }
        }

        // Try to spawn the daemon next to the current exe
        if let Err(e) = spawn_daemon_detached() {
            log::warn!("daemon: could not spawn — falling back to in-process ({})", e);
            return None;
        }

        // Retry connect up to ~3 seconds
        for attempt in 0..15 {
            std::thread::sleep(Duration::from_millis(200));
            if let Ok(client) = Self::connect() {
                if client.ping().is_ok() {
                    log::info!("daemon: spawned and connected (attempt {})", attempt + 1);
                    return Some(client);
                }
            }
        }

        log::warn!("daemon: spawn succeeded but pipe never opened — falling back");
        None
    }
}

#[cfg(windows)]
fn spawn_daemon_detached() -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    use std::process::Command;

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

    log::info!("daemon: spawning {}", daemon_exe.display());
    Command::new(&daemon_exe)
        .creation_flags(CREATE_NO_WINDOW | DETACHED_PROCESS)
        .spawn()
        .map_err(|e| format!("spawn daemon: {}", e))?;

    Ok(())
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
