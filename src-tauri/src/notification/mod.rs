mod osc;
mod store;

pub use osc::OscParser;
pub use store::{Notification, NotificationStore};

use tauri::AppHandle;

/// Send a Windows toast notification via notify-rust (works in dev mode)
pub fn send_system_notification(_app: &AppHandle, title: &str, body: &str) {
    let t = title.to_string();
    let b = body.to_string();
    // Spawn a thread so we don't block the caller
    std::thread::spawn(move || {
        if let Err(e) = notify_rust::Notification::new()
            .appname("WinMux")
            .summary(&t)
            .body(&b)
            .timeout(notify_rust::Timeout::Milliseconds(5000))
            .show()
        {
            log::warn!("Failed to send system notification: {}", e);
        }
    });
}
