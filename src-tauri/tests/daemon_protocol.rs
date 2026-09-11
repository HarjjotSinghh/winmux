//! End-to-end regression test for the daemon pipe protocol.
//!
//! Headless: starts a daemon server on an isolated pipe name, then drives it
//! through the real `DaemonClient` (ping → create → write → scrollback →
//! close). No GUI, no keyboard/mouse, no input devices.
//!
//! Before the `PeekNamedPipe` fix, a synchronous pipe handle was shared (via
//! `try_clone`) between a blocking reader thread and a writer on another
//! thread. Windows locks the file object while a synchronous read is pending,
//! so every response write deadlocked and no RPC ever completed — the app
//! logged "daemon: spawn succeeded but pipe never opened" on every launch.
//! This test hangs/times out instead of passing on that broken design.

#![cfg(windows)]

use std::time::{Duration, Instant};
use winmux_lib::{DaemonClient, SessionSinks};

fn noop_sinks() -> SessionSinks {
    SessionSinks {
        on_output: Box::new(|_| {}),
        on_exit: Box::new(|_| {}),
        on_osc: Box::new(|_| {}),
    }
}

#[test]
fn daemon_rpc_roundtrip() {
    // Use a dedicated pipe so a real installed daemon can never be involved.
    let pipe = format!(r"\\.\pipe\winmux-daemon-test-{}", std::process::id());
    std::env::set_var("WINMUX_DAEMON_PIPE", &pipe);

    std::thread::spawn(|| {
        let _ = winmux_lib::daemon::run_daemon();
    });

    // Wait for the server to create its pipe instance.
    let deadline = Instant::now() + Duration::from_secs(10);
    let client = loop {
        match DaemonClient::connect_for_test() {
            Ok(c) => break c,
            Err(_) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(100)),
            Err(e) => panic!("daemon pipe never opened: {}", e),
        }
    };

    // Ping twice: proves responses route back to the right request.
    client.ping().expect("first ping");
    client.ping().expect("second ping");

    let id = client
        .create_session(Some("cmd.exe"), None, 80, 24, noop_sinks())
        .expect("create_session");

    client
        .write_session(&id, b"echo HELLO_WINMUX_TEST\r\n")
        .expect("write_session");

    // PTY output is asynchronous — poll the daemon-side scrollback.
    let deadline = Instant::now() + Duration::from_secs(10);
    let mut seen = false;
    while Instant::now() < deadline {
        if let Ok(sb) = client.get_scrollback(&id) {
            if String::from_utf8_lossy(&sb).contains("HELLO_WINMUX_TEST") {
                seen = true;
                break;
            }
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    assert!(seen, "echo output never appeared in daemon scrollback");

    client.close_session(&id).expect("close_session");
}
