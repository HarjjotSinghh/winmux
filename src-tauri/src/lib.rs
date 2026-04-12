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
#[derive(Default)]
pub struct DaemonHandle(pub std::sync::Mutex<Option<std::sync::Arc<daemon_client::DaemonClient>>>);

impl DaemonHandle {
    pub fn get(&self) -> Option<std::sync::Arc<daemon_client::DaemonClient>> {
        self.0.lock().ok().and_then(|g| g.clone())
    }
}

pub fn run() {
    let pty_manager = Arc::new(Mutex::new(PtyManager::new()));
    let notification_store = Arc::new(Mutex::new(notification::NotificationStore::new()));
    let config = Arc::new(Mutex::new(config::Settings::load()));

    let daemon_handle = DaemonHandle::default();

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
            commands::open_devtools,
            commands::diag_log,
        ])
        .setup(move |app| {
            let app_handle = app.handle().clone();
            let pty_mgr = pty_manager.clone();

            // Bring up the daemon in a background thread — do NOT block `setup`
            // on it. `connect_or_spawn` can take up to ~18 seconds in the worst
            // case (spawn retries + ping timeout), which freezes the webview
            // and triggers Windows' "(Not Responding)". Commands issued before
            // the daemon is ready transparently fall back to the in-process
            // PtyManager; any subsequent ones use the daemon.
            {
                let app_for_daemon = app_handle.clone();
                std::thread::spawn(move || {
                    let daemon_opt =
                        daemon_client::DaemonClient::connect_or_spawn(app_for_daemon.clone())
                            .map(Arc::new);
                    if daemon_opt.is_some() {
                        log::info!("daemon: connected — PTYs will survive UI restarts");
                    } else {
                        log::warn!("daemon: unavailable — using in-process PTYs");
                    }
                    let handle = app_for_daemon.state::<DaemonHandle>();
                    let mut slot = handle.0.lock().expect("DaemonHandle poisoned");
                    *slot = daemon_opt;
                });
            }

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
                .text("force_quit", "Force Quit (kill immediately)")
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
                        let state: tauri::State<DaemonHandle> = app.state();
                        if let Some(d) = state.get() {
                            // Non-blocking — do NOT wait on daemon shutdown,
                            // or a hung daemon delays tray response.
                            std::thread::spawn(move || {
                                if let Err(e) = d.shutdown() {
                                    log::warn!("daemon shutdown failed from tray: {}", e);
                                }
                            });
                        }
                        std::thread::sleep(std::time::Duration::from_millis(250));
                        app.exit(0);
                    }
                    "force_quit" => {
                        // Absolute escape hatch for when the UI is frozen.
                        // Skips every cleanup path and kills the process now.
                        log::warn!("Force quit — process terminating immediately");
                        std::process::exit(0);
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
