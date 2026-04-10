use super::protocol::{JsonRpcRequest, JsonRpcResponse};
use crate::notification::NotificationStore;
use crate::pty::PtyManager;
use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};

const IPC_PORT: u16 = 19542;

pub fn start_ipc_server(
    app_handle: AppHandle,
    pty_manager: Arc<Mutex<PtyManager>>,
) -> Result<(), Box<dyn std::error::Error>> {
    let listener = TcpListener::bind(format!("127.0.0.1:{}", IPC_PORT))?;
    log::info!("IPC server listening on 127.0.0.1:{}", IPC_PORT);

    for stream in listener.incoming() {
        match stream {
            Ok(stream) => {
                let app = app_handle.clone();
                let mgr = pty_manager.clone();

                std::thread::spawn(move || {
                    if let Err(e) = handle_client(stream, app, mgr) {
                        log::debug!("IPC client error: {}", e);
                    }
                });
            }
            Err(e) => {
                log::warn!("IPC accept error: {}", e);
            }
        }
    }

    Ok(())
}

fn handle_client(
    stream: std::net::TcpStream,
    app_handle: AppHandle,
    pty_manager: Arc<Mutex<PtyManager>>,
) -> Result<(), Box<dyn std::error::Error>> {
    let reader = BufReader::new(stream.try_clone()?);
    let mut writer = stream;

    for line in reader.lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }

        let response = match serde_json::from_str::<JsonRpcRequest>(&line) {
            Ok(request) => dispatch_request(request, &app_handle, &pty_manager),
            Err(e) => JsonRpcResponse::error(
                None,
                "parse_error",
                &format!("Invalid JSON: {}", e),
            ),
        };

        let response_json = serde_json::to_string(&response)?;
        writeln!(writer, "{}", response_json)?;
        writer.flush()?;
    }

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
                "features": ["notifications", "workspaces", "splits", "cli"]
            }),
        ),

        "notification.create" => {
            let params = request.params.unwrap_or_default();
            let title = params.get("title").and_then(|v| v.as_str()).unwrap_or("WinMux");
            let body = params.get("body").and_then(|v| v.as_str()).unwrap_or("");
            let terminal_id = params
                .get("terminalId")
                .and_then(|v| v.as_str())
                .unwrap_or("");

            let store: &Arc<Mutex<NotificationStore>> =
                app_handle.state::<Arc<Mutex<NotificationStore>>>().inner();
            let notif = match store.lock() {
                Ok(mut s) => s.add(terminal_id, title, body, "cli"),
                Err(e) => return JsonRpcResponse::error(id, "internal", &e.to_string()),
            };

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

        _ => JsonRpcResponse::error(
            id,
            "method_not_found",
            &format!("Unknown method: {}", request.method),
        ),
    }
}
