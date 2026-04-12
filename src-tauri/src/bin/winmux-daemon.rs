//! winmux-daemon — long-lived PTY host for WinMux.
//!
//! Owns all terminal sessions. The Tauri UI (winmux.exe) connects over a
//! named pipe (`\\.\pipe\winmux-daemon`) and issues RPC requests to create,
//! write, resize, attach, and close sessions. Sessions survive UI restarts.

#![cfg_attr(all(target_os = "windows", not(debug_assertions)), windows_subsystem = "windows")]

fn main() {
    // Simple stderr logger (daemon has no UI)
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"))
        .format_timestamp_secs()
        .init();

    log::info!("winmux-daemon v{} starting", env!("CARGO_PKG_VERSION"));

    if let Err(e) = winmux_lib::daemon::run_daemon() {
        log::error!("Daemon exited with error: {}", e);
        std::process::exit(1);
    }

    log::info!("winmux-daemon exiting cleanly");
}
