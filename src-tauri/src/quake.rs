//! Quake-style dropdown window: a single global hotkey toggles the whole
//! window (show + focus when hidden or blurred, hide when focused).
//!
//! The hotkey itself is registered from Rust at startup so no extra JS
//! dependency or capability entry is needed; the toggle logic is shared with
//! the `toggle_quake` command backing the command palette.

use tauri::{AppHandle, Manager};

/// Global hotkey for the quake dropdown.
pub const QUAKE_SHORTCUT: &str = "Ctrl+Shift+Space";

/// Pure decision rule, unit-tested: hide only when the window is both visible
/// and focused; otherwise show and focus it.
pub fn quake_should_show(is_visible: bool, is_focused: bool) -> bool {
    !(is_visible && is_focused)
}

fn main_window(app: &AppHandle) -> Result<tauri::WebviewWindow, String> {
    app.get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())
}

pub fn set_quake_visible(app: &AppHandle, show: bool) -> Result<(), String> {
    let window = main_window(app)?;
    if show {
        window.unminimize().map_err(|e| e.to_string())?;
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
    } else {
        window.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Toggle the quake window. Backs both the global hotkey and the palette.
#[tauri::command]
pub fn toggle_quake(app: AppHandle) -> Result<(), String> {
    let window = main_window(&app)?;
    let show = quake_should_show(
        window.is_visible().unwrap_or(false),
        window.is_focused().unwrap_or(false),
    );
    set_quake_visible(&app, show)
}

/// Register the global hotkey. Best-effort: if the OS refuses the chord
/// (already taken), log and continue — the palette entry still works.
pub fn register_quake_shortcut(app: &AppHandle) {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    let handle = app.clone();
    let for_closure = handle.clone();
    match handle
        .global_shortcut()
        .on_shortcut(QUAKE_SHORTCUT, move |_app, _shortcut, event| {
            use tauri_plugin_global_shortcut::ShortcutState;
            if event.state == ShortcutState::Pressed {
                if let Err(e) = toggle_quake(for_closure.clone()) {
                    log::warn!("quake toggle failed: {}", e);
                }
            }
        }) {
        Ok(()) => log::info!("quake hotkey registered: {}", QUAKE_SHORTCUT),
        Err(e) => log::warn!(
            "quake hotkey unavailable ({}); palette entry still works",
            e
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::quake_should_show;

    #[test]
    fn hides_only_when_visible_and_focused() {
        assert!(!quake_should_show(true, true));
        assert!(quake_should_show(false, false));
        assert!(quake_should_show(false, true));
        assert!(quake_should_show(true, false));
    }
}
