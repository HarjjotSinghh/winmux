use super::protocol::{JsonRpcRequest, JsonRpcResponse};
use crate::notification::NotificationStore;
use crate::pty::PtyManager;
use std::io::{BufRead, BufReader, Write};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};

pub const PIPE_NAME: &str = r"\\.\pipe\winmux";

pub fn start_ipc_server(
    app_handle: AppHandle,
    pty_manager: Arc<Mutex<PtyManager>>,
) -> Result<(), Box<dyn std::error::Error>> {
    log::info!("IPC server starting on {}", PIPE_NAME);

    #[cfg(windows)]
    {
        use windows_sys::Win32::Foundation::CloseHandle;
        loop {
            let handle = create_named_pipe()?;
            wait_for_connection(handle)?;

            let app = app_handle.clone();
            let mgr = pty_manager.clone();

            std::thread::spawn(move || {
                if let Err(e) = handle_pipe_client(handle, app, mgr) {
                    log::debug!("Pipe client error: {}", e);
                }
                unsafe { CloseHandle(handle as *mut std::ffi::c_void) };
            });
        }
    }

    #[cfg(not(windows))]
    {
        let _ = (app_handle, pty_manager);
        Err("Named pipes only supported on Windows".into())
    }
}

#[cfg(windows)]
fn create_named_pipe() -> Result<isize, Box<dyn std::error::Error>> {
    use windows_sys::Win32::Foundation::INVALID_HANDLE_VALUE;
    use windows_sys::Win32::Storage::FileSystem::PIPE_ACCESS_DUPLEX;
    use windows_sys::Win32::System::Pipes::*;

    let wide: Vec<u16> = PIPE_NAME.encode_utf16().chain(std::iter::once(0)).collect();

    let handle = unsafe {
        CreateNamedPipeW(
            wide.as_ptr(),
            PIPE_ACCESS_DUPLEX,
            PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT,
            PIPE_UNLIMITED_INSTANCES,
            4096,
            4096,
            0,
            std::ptr::null(),
        )
    };

    if handle.is_null() || std::ptr::eq(handle, INVALID_HANDLE_VALUE) {
        return Err("Failed to create named pipe".into());
    }
    Ok(handle as isize)
}

#[cfg(windows)]
fn wait_for_connection(handle: isize) -> Result<(), Box<dyn std::error::Error>> {
    unsafe { windows_sys::Win32::System::Pipes::ConnectNamedPipe(handle as *mut std::ffi::c_void, std::ptr::null_mut()) };
    Ok(())
}

#[cfg(windows)]
fn handle_pipe_client(
    handle: isize,
    app_handle: AppHandle,
    pty_manager: Arc<Mutex<PtyManager>>,
) -> Result<(), Box<dyn std::error::Error>> {
    use std::os::windows::io::FromRawHandle;

    let file = unsafe { std::fs::File::from_raw_handle(handle as *mut std::ffi::c_void) };
    let reader_file = file.try_clone()?;
    let mut writer = file;
    let reader = BufReader::new(reader_file);

    for line in reader.lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }

        let response = match serde_json::from_str::<JsonRpcRequest>(&line) {
            Ok(request) => dispatch_request(request, &app_handle, &pty_manager),
            Err(e) => JsonRpcResponse::error(None, "parse_error", &format!("Invalid JSON: {}", e)),
        };

        let json = serde_json::to_string(&response)?;
        writeln!(writer, "{}", json)?;
        writer.flush()?;
    }

    // Prevent double-close — caller does CloseHandle
    std::mem::forget(writer);
    Ok(())
}

fn dispatch_request(
    request: JsonRpcRequest,
    app_handle: &AppHandle,
    pty_manager: &Arc<Mutex<PtyManager>>,
) -> JsonRpcResponse {
    let id = request.id.clone();

    match request.method.as_str() {
        "system.ping" => JsonRpcResponse::success(
            id,
            serde_json::json!({ "status": "ok", "version": "0.1.0" }),
        ),

        "system.capabilities" => JsonRpcResponse::success(
            id,
            serde_json::json!({
                "version": "0.1.0",
                "features": ["notifications", "workspaces", "splits", "browser", "named-pipes"]
            }),
        ),

        "notification.create" => {
            let params = request.params.unwrap_or_default();
            let title = params.get("title").and_then(|v| v.as_str()).unwrap_or("WinMux");
            let body = params.get("body").and_then(|v| v.as_str()).unwrap_or("");
            let terminal_id = params.get("terminalId").and_then(|v| v.as_str()).unwrap_or("");

            let store: &Arc<Mutex<NotificationStore>> =
                app_handle.state::<Arc<Mutex<NotificationStore>>>().inner();
            let notif = match store.lock() {
                Ok(mut s) => s.add(terminal_id, title, body, "cli"),
                Err(e) => return JsonRpcResponse::error(id, "internal", &e.to_string()),
            };
            // Send Windows toast notification
            crate::notification::send_system_notification(title, body);

            let _ = app_handle.emit("notification-added", &notif);
            JsonRpcResponse::success(id, serde_json::json!({ "id": notif.id }))
        }

        "terminal.send" => {
            let params = request.params.unwrap_or_default();
            let terminal_id = params.get("terminalId").and_then(|v| v.as_str());
            let text = params.get("text").and_then(|v| v.as_str()).unwrap_or("");

            if let Some(tid) = terminal_id {
                match pty_manager.lock() {
                    Ok(mgr) => match mgr.write(tid, text.as_bytes()) {
                        Ok(_) => JsonRpcResponse::success(id, serde_json::json!({ "ok": true })),
                        Err(e) => JsonRpcResponse::error(id, "write_error", &e),
                    },
                    Err(e) => JsonRpcResponse::error(id, "internal", &e.to_string()),
                }
            } else {
                JsonRpcResponse::error(id, "missing_param", "terminalId is required")
            }
        }

        "browser.open" => {
            let params = request.params.unwrap_or_default();
            let url = params.get("url").and_then(|v| v.as_str()).unwrap_or("https://google.com");
            let _ = app_handle.emit("open-browser", serde_json::json!({ "url": url }));
            JsonRpcResponse::success(id, serde_json::json!({ "ok": true }))
        }

        _ => JsonRpcResponse::error(
            id,
            "method_not_found",
            &format!("Unknown method: {}", request.method),
        ),
    }
}
