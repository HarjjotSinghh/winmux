mod osc;
mod store;

pub use osc::OscParser;
pub use store::{Notification, NotificationStore};

use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

/// Send a Windows toast notification via the system notification center
pub fn send_system_notification(app: &AppHandle, title: &str, body: &str) {
    if let Err(e) = app
        .notification()
        .builder()
        .title(title)
        .body(body)
        .show()
    {
        log::warn!("Failed to send system notification: {}", e);
    }
}
