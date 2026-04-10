use crate::config::Settings;
use crate::notification::{Notification, NotificationStore};
use crate::pty::PtyManager;
use crate::session::SessionData;
use std::sync::{Arc, Mutex};
use tauri::ipc::Channel;
use tauri::{AppHandle, State, WebviewWindow};

type PtyState = Arc<Mutex<PtyManager>>;
type NotifState = Arc<Mutex<NotificationStore>>;
type ConfigState = Arc<Mutex<Settings>>;

// ── Terminal Commands ──────────────────────────────────────────────

#[tauri::command]
pub fn create_terminal(
    app: AppHandle,
    pty_manager: State<PtyState>,
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

    let mut mgr = pty_manager.lock().map_err(|e| e.to_string())?;
    mgr.create(&shell_path, working_dir.as_deref(), c, r, on_output, app)
}

#[tauri::command]
pub fn write_terminal(
    pty_manager: State<PtyState>,
    id: String,
    data: Vec<u8>,
) -> Result<(), String> {
    let mgr = pty_manager.lock().map_err(|e| e.to_string())?;
    mgr.write(&id, &data)
}

#[tauri::command]
pub fn resize_terminal(
    pty_manager: State<PtyState>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let mut mgr = pty_manager.lock().map_err(|e| e.to_string())?;
    mgr.resize(&id, cols, rows)
}

#[tauri::command]
pub fn close_terminal(pty_manager: State<PtyState>, id: String) -> Result<(), String> {
    let mut mgr = pty_manager.lock().map_err(|e| e.to_string())?;
    mgr.close(&id)
}

#[tauri::command]
pub fn get_cwd(pty_manager: State<PtyState>, id: String) -> Result<String, String> {
    let mgr = pty_manager.lock().map_err(|e| e.to_string())?;
    mgr.get_cwd(&id)
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
