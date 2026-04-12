//! Wire protocol for the winmux daemon.
//!
//! Transport: one JSON value per line (`\n`-terminated). Same-pipe, bidirectional.
//!
//! Three message shapes share a single JSON schema — differentiated only by
//! whether `id` is present (request/response) or null (server push):
//!
//! * **Request** (client → daemon): `{"id": 1, "method": "daemon.create_session", "params": {...}}`
//! * **Response** (daemon → client): `{"id": 1, "ok": true, "result": {...}}`  (or `"error": {...}`)
//! * **Notification** (daemon → client, unsolicited): `{"id": null, "method": "session.output", "params": {...}}`
//!
//! Binary PTY data rides as base64 strings inside JSON. Overhead is ~33% but
//! keeps the protocol debuggable with any line-oriented pipe tool.

use serde::{Deserialize, Serialize};

pub const DAEMON_PIPE_NAME: &str = r"\\.\pipe\winmux-daemon";

// ── Shared RPC envelope ─────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct RpcRequest {
    pub id: Option<serde_json::Value>,
    pub method: String,
    #[serde(default)]
    pub params: Option<serde_json::Value>,
}

#[derive(Debug, Serialize)]
pub struct RpcResponse {
    pub id: Option<serde_json::Value>,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<RpcError>,
}

#[derive(Debug, Serialize)]
pub struct RpcError {
    pub code: String,
    pub message: String,
}

impl RpcResponse {
    pub fn success(id: Option<serde_json::Value>, result: serde_json::Value) -> Self {
        Self {
            id,
            ok: true,
            result: Some(result),
            error: None,
        }
    }

    pub fn error(id: Option<serde_json::Value>, code: &str, message: &str) -> Self {
        Self {
            id,
            ok: false,
            result: None,
            error: Some(RpcError {
                code: code.into(),
                message: message.into(),
            }),
        }
    }
}

/// Server-pushed notification (request-shaped, `id` is null).
#[derive(Debug, Serialize)]
pub struct RpcNotification {
    pub id: Option<serde_json::Value>, // always None on the wire
    pub method: String,
    pub params: serde_json::Value,
}

impl RpcNotification {
    pub fn new(method: impl Into<String>, params: serde_json::Value) -> Self {
        Self {
            id: None,
            method: method.into(),
            params,
        }
    }
}

// ── Request params ──────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateSessionParams {
    pub shell: Option<String>,
    pub cwd: Option<String>,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SessionIdParams {
    pub id: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WriteParams {
    pub id: String,
    pub data_b64: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ResizeParams {
    pub id: String,
    pub cols: u16,
    pub rows: u16,
}

// ── Results ─────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct CreatedResult {
    pub id: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SessionInfo {
    pub id: String,
    pub shell: String,
    pub cwd: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ListSessionsResult {
    pub sessions: Vec<SessionInfo>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AttachResult {
    pub scrollback_b64: String,
    pub shell: String,
    pub cwd: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CapabilitiesResult {
    pub protocol_version: u32,
    pub daemon_version: String,
}

// ── Notification params ─────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct SessionOutputNotif {
    pub id: String,
    pub data_b64: String,
}

#[derive(Debug, Serialize)]
pub struct SessionExitNotif {
    pub id: String,
    pub exit_code: Option<u32>,
}

#[derive(Debug, Serialize)]
pub struct SessionOscNotif {
    pub id: String,
    pub osc_type: String,
    pub title: String,
    pub body: String,
}

// ── Method name constants ───────────────────────────────────────────

pub mod method {
    // Requests
    pub const PING: &str = "daemon.ping";
    pub const CAPABILITIES: &str = "daemon.capabilities";
    pub const SHUTDOWN: &str = "daemon.shutdown";

    pub const LIST_SESSIONS: &str = "daemon.list_sessions";
    pub const CREATE_SESSION: &str = "daemon.create_session";
    pub const CLOSE_SESSION: &str = "daemon.close_session";

    pub const ATTACH_SESSION: &str = "daemon.attach_session";
    pub const DETACH_SESSION: &str = "daemon.detach_session";
    pub const WRITE_SESSION: &str = "daemon.write_session";
    pub const RESIZE_SESSION: &str = "daemon.resize_session";

    pub const GET_SCROLLBACK: &str = "daemon.get_scrollback";
    pub const GET_CWD: &str = "daemon.get_cwd";

    // Server-pushed notifications
    pub const SESSION_OUTPUT: &str = "session.output";
    pub const SESSION_EXIT: &str = "session.exit";
    pub const SESSION_OSC: &str = "session.osc";
}

pub const PROTOCOL_VERSION: u32 = 1;
