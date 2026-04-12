mod commands;
mod config;
pub mod daemon;
mod daemon_client;
mod ipc;
mod notification;
mod pty;
mod session;

use std::sync::{Arc, Mutex};
use tauri::Manager;

pub use pty::{OscNotif, PtyManager, SessionCallbacks};

/// Tauri-managed handle to the daemon client. `None` when the daemon
/// couldn't be spawned (binary missing, pipe errors, etc.) — in that case
/// commands fall back to in-process PTYs via `PtyManager`.
pub struct DaemonHandle(pub Option<std::sync::Arc<daemon_client::DaemonClient>>);

pub fn run() {
    let pty_manager = Arc::new(Mutex::new(PtyManager::new()));
    let notification_store = Arc::new(Mutex::new(notification::NotificationStore::new()));
    let config = Arc::new(Mutex::new(config::Settings::load()));

    // Attempt to bring up the winmux-daemon so PTYs can survive UI restarts.
    // If the daemon binary isn't available or the pipe can't be opened,
    // commands gracefully fall back to in-process PtyManager.
    let daemon = daemon_client::DaemonClient::connect_or_spawn().map(Arc::new);
    let daemon_handle = DaemonHandle(daemon);

    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            log::info!("Second instance launched; surfacing existing window");
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .manage(pty_manager.clone())
        .manage(notification_store.clone())
        .manage(config.clone())
        .manage(daemon_handle)
        .invoke_handler(tauri::generate_handler![
            commands::create_terminal,
            commands::attach_terminal,
            commands::write_terminal,
            commands::resize_terminal,
            commands::close_terminal,
            commands::get_shell_path,
            commands::get_scrollback,
            commands::get_terminal_shell,
            commands::list_notifications,
            commands::clear_notifications,
            commands::dismiss_notification,
            commands::send_toast,
            commands::get_settings,
            commands::update_settings,
            commands::save_session,
            commands::load_session,
            commands::get_cwd,
            commands::window_minimize,
            commands::window_maximize,
            commands::window_close,
            commands::window_is_maximized,
            commands::clipboard_paste,
            commands::clipboard_write_text,
            commands::quit_app,
        ])
        .setup(move |app| {
            let app_handle = app.handle().clone();
            let pty_mgr = pty_manager.clone();

            // Start the IPC server for CLI communication
            std::thread::spawn(move || {
                if let Err(e) = ipc::start_ipc_server(app_handle, pty_mgr) {
                    log::error!("IPC server failed: {}", e);
                }
            });

            // Set up system tray
            let tray_menu = tauri::menu::MenuBuilder::new(app)
                .text("show", "Open WinMux")
                .separator()
                .text("quit", "Quit WinMux (ends all terminals)")
                .build()?;

            let _tray = tauri::tray::TrayIconBuilder::new()
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.unminimize();
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => {
                        log::info!("Quit requested from tray menu");
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::DoubleClick { .. } = event {
                        if let Some(window) = tray.app_handle().get_webview_window("main") {
                            let _ = window.unminimize();
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            log::info!("WinMux started successfully");
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                log::info!("Close requested on window '{}' — hiding to tray", window.label());
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running WinMux");
}
