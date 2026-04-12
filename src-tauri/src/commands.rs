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
#[allow(clippy::too_many_arguments)]
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
pub fn get_scrollback(pty_manager: State<PtyState>, id: String) -> Result<Vec<u8>, String> {
    let mgr = pty_manager.lock().map_err(|e| e.to_string())?;
    mgr.get_scrollback(&id)
}

#[tauri::command]
pub fn get_terminal_shell(pty_manager: State<PtyState>, id: String) -> Result<String, String> {
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

#[tauri::command]
pub fn quit_app(app: AppHandle) {
    log::info!("Explicit quit requested");
    app.exit(0);
}
