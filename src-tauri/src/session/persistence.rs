use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionData {
    pub workspaces: Vec<WorkspaceData>,
    pub active_workspace: usize,
    pub sidebar_width: u32,
    pub sidebar_visible: bool,
    pub window_state: WindowState,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowState {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub maximized: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceData {
    pub name: String,
    pub color: Option<String>,
    pub pane_tree: PaneData,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum PaneData {
    Terminal {
        cwd: String,
        shell: String,
        #[serde(default)]
        scrollback: String,
        /// Daemon session ID from the previous run. When present the UI will
        /// try to re-attach to the live PTY instead of spawning a fresh shell.
        ///
        /// NOTE: `rename_all` on an enum only renames *variants* — variant
        /// fields keep their Rust names unless renamed explicitly. Without
        /// this `rename`, the UI's `sessionId` was silently dropped on save
        /// and sessions could never be re-attached.
        #[serde(rename = "sessionId", default, skip_serializing_if = "Option::is_none")]
        session_id: Option<String>,
    },
    Browser {
        url: String,
    },
    Split {
        direction: String,
        ratio: f64,
        first: Box<PaneData>,
        second: Box<PaneData>,
    },
}

impl SessionData {
    pub fn save(&self) -> Result<(), String> {
        let path = Self::session_path();
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create session dir: {}", e))?;
        }
        let json = serde_json::to_string_pretty(self)
            .map_err(|e| format!("Failed to serialize session: {}", e))?;
        fs::write(&path, json).map_err(|e| format!("Failed to write session: {}", e))
    }

    pub fn load() -> Option<Self> {
        let path = Self::session_path();
        if !path.exists() {
            return None;
        }
        let content = fs::read_to_string(&path).ok()?;
        serde_json::from_str(&content).ok()
    }

    fn session_path() -> PathBuf {
        let data_dir = dirs::data_local_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("winmux");
        data_dir.join("session.json")
    }
}

impl Default for SessionData {
    fn default() -> Self {
        Self {
            workspaces: vec![WorkspaceData {
                name: "Workspace 1".to_string(),
                color: None,
                pane_tree: PaneData::Terminal {
                    cwd: dirs::home_dir()
                        .unwrap_or_else(|| PathBuf::from("C:\\"))
                        .to_string_lossy()
                        .to_string(),
                    shell: "pwsh.exe".to_string(),
                    scrollback: String::new(),
                    session_id: None,
                },
            }],
            active_workspace: 0,
            sidebar_width: 220,
            sidebar_visible: true,
            window_state: WindowState {
                x: 100,
                y: 100,
                width: 1280,
                height: 800,
                maximized: false,
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The UI sends `sessionId` (camelCase). `rename_all` on the enum only
    /// renames variants, not variant fields — without the explicit `rename`
    /// this silently parsed as `None`, which broke PTY re-attach on restore.
    #[test]
    fn terminal_session_id_roundtrips_as_camel_case() {
        let json = r#"{"type":"terminal","cwd":"C:\\","shell":"cmd.exe","scrollback":"","sessionId":"abc-123"}"#;
        let pane: PaneData = serde_json::from_str(json).expect("parse");

        match &pane {
            PaneData::Terminal { session_id, .. } => {
                assert_eq!(session_id.as_deref(), Some("abc-123"));
            }
            other => panic!("expected terminal pane, got {:?}", other),
        }

        let value = serde_json::to_value(&pane).expect("serialize");
        assert_eq!(
            value.get("sessionId").and_then(|v| v.as_str()),
            Some("abc-123"),
            "saved sessions must carry the daemon session id"
        );
    }

    #[test]
    fn panes_without_session_id_stay_lean() {
        let pane = PaneData::Terminal {
            cwd: "C:\\".into(),
            shell: "cmd.exe".into(),
            scrollback: String::new(),
            session_id: None,
        };
        let value = serde_json::to_value(&pane).expect("serialize");
        assert!(value.get("sessionId").is_none());
    }

    #[test]
    fn browser_panes_roundtrip() {
        let json = r#"{"type":"browser","url":"https://example.com"}"#;
        let pane: PaneData = serde_json::from_str(json).expect("parse");
        match pane {
            PaneData::Browser { url } => assert_eq!(url, "https://example.com"),
            other => panic!("expected browser pane, got {:?}", other),
        }
    }
}
