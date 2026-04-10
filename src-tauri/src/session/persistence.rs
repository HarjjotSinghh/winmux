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
