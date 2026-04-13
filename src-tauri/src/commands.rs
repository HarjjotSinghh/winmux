use crate::config::Settings;
use crate::daemon_client::SessionSinks;
use crate::notification::{self, Notification, NotificationStore};
use crate::pty::{OscNotif, PtyManager, SessionCallbacks};
use crate::session::SessionData;
use crate::DaemonHandle;
use base64::Engine;
use std::sync::{Arc, Mutex};
use tauri::ipc::Channel;
use tauri::{AppHandle, Emitter, State, WebviewWindow};

#[derive(Clone, serde::Serialize)]
struct OscNotificationEvent {
    terminal_id: String,
    title: String,
    body: String,
    osc_type: String,
}

#[derive(Clone, serde::Serialize)]
struct TerminalExitEvent {
    terminal_id: String,
    exit_code: Option<u32>,
}

fn build_daemon_sinks(
    app: AppHandle,
    output: Channel<Vec<u8>>,
    terminal_id: String,
) -> SessionSinks {
    let app_for_osc = app.clone();
    let tid_for_osc = terminal_id.clone();
    let tid_for_exit = terminal_id;

    SessionSinks {
        on_output: Box::new(move |data| {
            let _ = output.send(data);
        }),
        on_osc: Box::new(move |n: &OscNotif| {
            // Toast is already sent by the daemon process; just emit to UI.
            let _ = app_for_osc.emit(
                "osc-notification",
                OscNotificationEvent {
                    terminal_id: tid_for_osc.clone(),
                    title: n.title.clone(),
                    body: n.body.clone(),
                    osc_type: n.osc_type.clone(),
                },
            );
        }),
        on_exit: Box::new(move |code: Option<u32>| {
            let _ = app.emit(
                "terminal-exit",
                TerminalExitEvent {
                    terminal_id: tid_for_exit.clone(),
                    exit_code: code,
                },
            );
        }),
    }
}

type PtyState = Arc<Mutex<PtyManager>>;
type NotifState = Arc<Mutex<NotificationStore>>;
type ConfigState = Arc<Mutex<Settings>>;

// ── Terminal Commands ──────────────────────────────────────────────

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn create_terminal(
    app: AppHandle,
    pty_manager: State<PtyState>,
    daemon: State<DaemonHandle>,
    config: State<ConfigState>,
    shell: Option<String>,
    cwd: Option<String>,
    cols: Option<u16>,
    rows: Option<u16>,
    on_output: Channel<Vec<u8>>,
) -> Result<String, String> {
    let shell_path = {
        let settings = config.lock().map_err(|e| e.to_string())?;
        shell.unwrap_or_else(|| settings.shell.default_shell.clone())
    };
    let working_dir = {
        let settings = config.lock().map_err(|e| e.to_string())?;
        cwd.or_else(|| settings.shell.default_cwd.clone())
    };
    let c = cols.unwrap_or(80);
    let r = rows.unwrap_or(24);

    // Prefer daemon if available (PTY survives UI restarts)
    if let Some(d) = daemon.get() {
        // We won't know the ID until the daemon responds, so build sinks with a
        // placeholder; once we know the real ID we re-register sinks keyed by it.
        // Simplest: register AFTER we know the ID by building sinks inline with the
        // id we get back. DaemonClient::create_session does this via re-insert.
        // Build sinks where the terminal_id is filled in by the daemon.
        // We use a placeholder here — the daemon uses its own assigned UUID.
        let placeholder_sinks =
            build_daemon_sinks(app.clone(), on_output.clone(), String::new());
        let id = d.create_session(
            Some(&shell_path),
            working_dir.as_deref(),
            c,
            r,
            placeholder_sinks,
        )?;

        // Re-register sinks with the real id so emitted osc/exit events carry it.
        let real_sinks = build_daemon_sinks(app, on_output, id.clone());
        // attach_session re-registers; it's safe to call again (daemon idempotent).
        d.attach_session(&id, real_sinks)?;
        return Ok(id);
    }

    // Fallback: in-process PTY
    let id = uuid::Uuid::new_v4().to_string();
    let callbacks = build_tauri_callbacks(app, on_output, id.clone());

    let mut mgr = pty_manager.lock().map_err(|e| e.to_string())?;
    mgr.create(id.clone(), &shell_path, working_dir.as_deref(), c, r, callbacks)?;
    Ok(id)
}

/// Re-attach to a pre-existing PTY (used on UI restore or pane split). Returns
/// the scrollback bytes so the UI can replay them before live output resumes.
///
/// Priority: daemon first (sessions survive UI restart); fall back to the
/// in-process `PtyManager` so split-induced remounts still preserve state
/// even when the daemon isn't running.
#[tauri::command]
pub fn attach_terminal(
    app: AppHandle,
    pty_manager: State<PtyState>,
    daemon: State<DaemonHandle>,
    session_id: String,
    on_output: Channel<Vec<u8>>,
) -> Result<AttachInfo, String> {
    if let Some(d) = daemon.get() {
        let sinks = build_daemon_sinks(app, on_output, session_id.clone());
        let info = d.attach_session(&session_id, sinks)?;
        return Ok(AttachInfo {
            scrollback_b64: base64::engine::general_purpose::STANDARD.encode(&info.scrollback),
            shell: info.shell,
            cwd: info.cwd,
        });
    }

    // In-process fallback: swap the existing session's callbacks to the new
    // UI sinks and replay scrollback. Rejects if the session has already
    // been closed.
    let new_callbacks = build_tauri_callbacks(app, on_output, session_id.clone());
    let mgr = pty_manager.lock().map_err(|e| e.to_string())?;
    let scrollback = mgr.attach(&session_id, new_callbacks)?;
    let shell = mgr.get_shell(&session_id).unwrap_or_default();
    let cwd = mgr.get_cwd(&session_id).unwrap_or_default();
    Ok(AttachInfo {
        scrollback_b64: base64::engine::general_purpose::STANDARD.encode(&scrollback),
        shell,
        cwd,
    })
}

#[derive(serde::Serialize)]
pub struct AttachInfo {
    pub scrollback_b64: String,
    pub shell: String,
    pub cwd: String,
}

fn build_tauri_callbacks(
    app: AppHandle,
    output: Channel<Vec<u8>>,
    terminal_id: String,
) -> SessionCallbacks {
    let app_for_osc = app.clone();
    let tid_for_osc = terminal_id.clone();
    let tid_for_exit = terminal_id;

    SessionCallbacks {
        on_output: Box::new(move |data: &[u8]| {
            let _ = output.send(data.to_vec());
        }),
        on_osc: Box::new(move |notif: &OscNotif| {
            notification::send_system_notification(&notif.title, &notif.body);
            let _ = app_for_osc.emit(
                "osc-notification",
                OscNotificationEvent {
                    terminal_id: tid_for_osc.clone(),
                    title: notif.title.clone(),
                    body: notif.body.clone(),
                    osc_type: notif.osc_type.clone(),
                },
            );
        }),
        on_exit: Box::new(move |code: Option<u32>| {
            let _ = app.emit(
                "terminal-exit",
                TerminalExitEvent {
                    terminal_id: tid_for_exit.clone(),
                    exit_code: code,
                },
            );
        }),
    }
}

#[tauri::command]
pub fn write_terminal(
    pty_manager: State<PtyState>,
    daemon: State<DaemonHandle>,
    id: String,
    data: Vec<u8>,
) -> Result<(), String> {
    if let Some(d) = daemon.get() {
        return d.write_session(&id, &data);
    }
    let mgr = pty_manager.lock().map_err(|e| e.to_string())?;
    mgr.write(&id, &data)
}

#[tauri::command]
pub fn resize_terminal(
    pty_manager: State<PtyState>,
    daemon: State<DaemonHandle>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    if let Some(d) = daemon.get() {
        return d.resize_session(&id, cols, rows);
    }
    let mut mgr = pty_manager.lock().map_err(|e| e.to_string())?;
    mgr.resize(&id, cols, rows)
}

#[tauri::command]
pub fn close_terminal(
    pty_manager: State<PtyState>,
    daemon: State<DaemonHandle>,
    id: String,
) -> Result<(), String> {
    if let Some(d) = daemon.get() {
        return d.close_session(&id);
    }
    let mut mgr = pty_manager.lock().map_err(|e| e.to_string())?;
    mgr.close(&id)
}

#[tauri::command]
pub fn get_cwd(
    pty_manager: State<PtyState>,
    daemon: State<DaemonHandle>,
    id: String,
) -> Result<String, String> {
    if let Some(d) = daemon.get() {
        return d.get_cwd(&id);
    }
    let mgr = pty_manager.lock().map_err(|e| e.to_string())?;
    mgr.get_cwd(&id)
}

#[tauri::command]
pub fn get_scrollback(
    pty_manager: State<PtyState>,
    daemon: State<DaemonHandle>,
    id: String,
) -> Result<Vec<u8>, String> {
    if let Some(d) = daemon.get() {
        return d.get_scrollback(&id);
    }
    let mgr = pty_manager.lock().map_err(|e| e.to_string())?;
    mgr.get_scrollback(&id)
}

#[tauri::command]
pub fn get_terminal_shell(
    pty_manager: State<PtyState>,
    daemon: State<DaemonHandle>,
    id: String,
) -> Result<String, String> {
    if let Some(d) = daemon.get() {
        // Daemon doesn't expose shell via a dedicated method — use list_sessions.
        if let Ok(sessions) = d.list_sessions() {
            if let Some(s) = sessions.into_iter().find(|s| s.id == id) {
                return Ok(s.shell);
            }
        }
        return Err(format!("session not found: {}", id));
    }
    let mgr = pty_manager.lock().map_err(|e| e.to_string())?;
    mgr.get_shell(&id)
}

#[tauri::command]
pub fn get_shell_path(config: State<ConfigState>) -> Result<String, String> {
    let settings = config.lock().map_err(|e| e.to_string())?;
    Ok(settings.shell.default_shell.clone())
}

// ── Notification Commands ──────────────────────────────────────────

#[tauri::command]
pub fn list_notifications(store: State<NotifState>) -> Result<Vec<Notification>, String> {
    let s = store.lock().map_err(|e| e.to_string())?;
    Ok(s.list())
}

#[tauri::command]
pub fn clear_notifications(store: State<NotifState>) -> Result<(), String> {
    let mut s = store.lock().map_err(|e| e.to_string())?;
    s.clear();
    Ok(())
}

#[tauri::command]
pub fn dismiss_notification(store: State<NotifState>, id: String) -> Result<(), String> {
    let mut s = store.lock().map_err(|e| e.to_string())?;
    s.dismiss(&id);
    Ok(())
}

// ── System Notification Command ────────────────────────────────────

#[tauri::command]
pub fn send_toast(title: String, body: String) {
    let t = title;
    let b = body;
    std::thread::spawn(move || {
        if let Err(e) = notify_rust::Notification::new()
            .appname("WinMux")
            .summary(&t)
            .body(&b)
            .timeout(notify_rust::Timeout::Milliseconds(5000))
            .show()
        {
            log::warn!("Toast failed: {}", e);
        }
    });
}

// ── Settings Commands ──────────────────────────────────────────────

#[tauri::command]
pub fn get_settings(config: State<ConfigState>) -> Result<Settings, String> {
    let settings = config.lock().map_err(|e| e.to_string())?;
    Ok(settings.clone())
}

#[tauri::command]
pub fn update_settings(config: State<ConfigState>, settings: Settings) -> Result<(), String> {
    let mut cfg = config.lock().map_err(|e| e.to_string())?;
    *cfg = settings;
    cfg.save()
}

// ── Session Commands ──────────────────────────────────────────────

#[tauri::command]
pub fn save_session(data: SessionData) -> Result<(), String> {
    data.save()
}

#[tauri::command]
pub fn load_session() -> Option<SessionData> {
    SessionData::load()
}

// ── Clipboard Commands ──────────────────────────────────────────

#[derive(serde::Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum ClipboardPaste {
    Text { value: String },
    Paths { paths: Vec<String> },
    Empty,
}

#[tauri::command]
pub fn clipboard_paste() -> Result<ClipboardPaste, String> {
    #[cfg(windows)]
    {
        use clipboard_win::{formats, get_clipboard};

        // 1. File list (CF_HDROP) — user copied files in Explorer
        if let Ok(files) = get_clipboard::<Vec<String>, _>(formats::FileList) {
            if !files.is_empty() {
                return Ok(ClipboardPaste::Paths { paths: files });
            }
        }

        // 2. Image (CF_DIB / CF_BITMAP) — user pasted a screenshot
        if let Ok(bmp_bytes) = get_clipboard::<Vec<u8>, _>(formats::Bitmap) {
            if !bmp_bytes.is_empty() {
                match save_clipboard_image(&bmp_bytes) {
                    Ok(path) => return Ok(ClipboardPaste::Paths { paths: vec![path] }),
                    Err(e) => log::warn!("Failed to save clipboard image: {}", e),
                }
            }
        }

        // 3. Text (CF_UNICODETEXT)
        if let Ok(text) = get_clipboard::<String, _>(formats::Unicode) {
            if !text.is_empty() {
                return Ok(ClipboardPaste::Text { value: text });
            }
        }

        Ok(ClipboardPaste::Empty)
    }
    #[cfg(not(windows))]
    {
        Err("Clipboard paste only implemented for Windows".into())
    }
}

#[cfg(windows)]
fn save_clipboard_image(bmp_bytes: &[u8]) -> Result<String, String> {
    use chrono::Utc;
    use std::fs;
    use std::io::Cursor;

    let img = image::load(Cursor::new(bmp_bytes), image::ImageFormat::Bmp)
        .map_err(|e| format!("decode bmp: {}", e))?;

    let temp_dir = std::env::temp_dir().join("winmux").join("clipboard");
    fs::create_dir_all(&temp_dir).map_err(|e| e.to_string())?;

    let filename = format!("winmux-clipboard-{}.png", Utc::now().format("%Y%m%d-%H%M%S%3f"));
    let path = temp_dir.join(filename);

    img.save_with_format(&path, image::ImageFormat::Png)
        .map_err(|e| format!("encode png: {}", e))?;

    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn clipboard_write_text(text: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        use clipboard_win::{formats, set_clipboard};
        set_clipboard(formats::Unicode, &text).map_err(|e| e.to_string())
    }
    #[cfg(not(windows))]
    {
        let _ = text;
        Err("Clipboard write only implemented for Windows".into())
    }
}

// ── Window Commands ──────────────────────────────────────────────

#[tauri::command]
pub fn window_minimize(window: WebviewWindow) -> Result<(), String> {
    window.minimize().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn window_maximize(window: WebviewWindow) -> Result<(), String> {
    if window.is_maximized().unwrap_or(false) {
        window.unmaximize().map_err(|e| e.to_string())
    } else {
        window.maximize().map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn window_close(window: WebviewWindow) -> Result<(), String> {
    window.hide().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn window_is_maximized(window: WebviewWindow) -> Result<bool, String> {
    window.is_maximized().map_err(|e| e.to_string())
}

/// Open the webview's DevTools. Available in release builds because we ship
/// with the tauri `devtools` feature enabled — we need it to diagnose UI
/// freezes in installed copies.
#[tauri::command]
pub fn open_devtools(window: WebviewWindow) {
    window.open_devtools();
}

/// Keepalive: UI calls this on a 60s interval so the daemon-side pipe
/// sees continuous activity. With the connection-aware idle watcher
/// (v0.4.12+) this is defence-in-depth — it also surfaces half-open
/// pipes quickly, since a stale pipe will make the ping fail fast.
#[tauri::command]
pub fn ping_daemon(daemon: State<DaemonHandle>) -> Result<bool, String> {
    if let Some(d) = daemon.get() {
        d.ping().map(|_| true)
    } else {
        Ok(false)
    }
}

/// JS-side diagnostic log entry — written to the same tauri_plugin_log file
/// so post-freeze investigation can correlate UI stalls with Rust events.
#[tauri::command]
pub fn diag_log(level: String, msg: String) {
    match level.as_str() {
        "error" => log::error!("[ui] {}", msg),
        "warn" => log::warn!("[ui] {}", msg),
        "info" => log::info!("[ui] {}", msg),
        _ => log::debug!("[ui] {}", msg),
    }
}

#[tauri::command]
pub fn quit_app(app: AppHandle, daemon: State<DaemonHandle>) {
    log::info!("Explicit quit requested");
    // Mark first so the reconnect supervisor skips respawn when the pipe
    // closes during teardown.
    daemon.mark_shutting_down();
    // Fire daemon shutdown in a detached thread with a hard wall-clock cap so
    // a hung daemon can never delay our exit. The UI must feel instant.
    if let Some(d) = daemon.get() {
        std::thread::spawn(move || {
            if let Err(e) = d.shutdown() {
                log::warn!("daemon shutdown failed during quit: {}", e);
            }
        });
    }
    // Give the shutdown request ~250 ms head-start, then exit regardless.
    std::thread::sleep(std::time::Duration::from_millis(250));
    app.exit(0);
}
