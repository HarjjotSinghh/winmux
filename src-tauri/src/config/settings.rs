use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub shell: ShellSettings,
    pub appearance: AppearanceSettings,
    pub notifications: NotificationSettings,
    pub keybindings: Vec<Keybinding>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellSettings {
    pub default_shell: String,
    pub default_cwd: Option<String>,
    pub env: std::collections::HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppearanceSettings {
    pub font_family: String,
    pub font_size: f64,
    pub theme: String,
    pub sidebar_width: u32,
    pub show_sidebar: bool,
    pub opacity: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationSettings {
    pub enabled: bool,
    pub sound: bool,
    pub toast_notifications: bool,
    pub osc_detection: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Keybinding {
    pub action: String,
    pub keys: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            shell: ShellSettings {
                default_shell: detect_default_shell(),
                default_cwd: None,
                env: std::collections::HashMap::new(),
            },
            appearance: AppearanceSettings {
                font_family: "Cascadia Code, Consolas, monospace".to_string(),
                font_size: 14.0,
                theme: "dark".to_string(),
                sidebar_width: 220,
                show_sidebar: true,
                opacity: 1.0,
            },
            notifications: NotificationSettings {
                enabled: true,
                sound: true,
                toast_notifications: true,
                osc_detection: true,
            },
            keybindings: default_keybindings(),
        }
    }
}

impl Settings {
    pub fn load() -> Self {
        let path = Self::config_path();
        if path.exists() {
            match fs::read_to_string(&path) {
                Ok(content) => match serde_json::from_str(&content) {
                    Ok(settings) => return settings,
                    Err(e) => log::warn!("Failed to parse settings: {}", e),
                },
                Err(e) => log::warn!("Failed to read settings: {}", e),
            }
        }

        let settings = Self::default();
        let _ = settings.save();
        settings
    }

    pub fn save(&self) -> Result<(), String> {
        let path = Self::config_path();
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("Failed to create config dir: {}", e))?;
        }
        let json = serde_json::to_string_pretty(self)
            .map_err(|e| format!("Failed to serialize settings: {}", e))?;
        fs::write(&path, json).map_err(|e| format!("Failed to write settings: {}", e))
    }

    fn config_path() -> PathBuf {
        let config_dir = dirs::config_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("winmux");
        config_dir.join("settings.json")
    }
}

fn detect_default_shell() -> String {
    // Prefer pwsh.exe (PowerShell 7+), fall back to powershell.exe, then cmd.exe
    let candidates = [
        "pwsh.exe",
        "powershell.exe",
        "cmd.exe",
    ];

    for candidate in &candidates {
        if which_exists(candidate) {
            return candidate.to_string();
        }
    }

    "cmd.exe".to_string()
}

fn which_exists(name: &str) -> bool {
    if let Ok(path) = std::env::var("PATH") {
        for dir in path.split(';') {
            let full = std::path::Path::new(dir).join(name);
            if full.exists() {
                return true;
            }
        }
    }
    false
}

fn default_keybindings() -> Vec<Keybinding> {
    vec![
        Keybinding { action: "newWorkspace".to_string(), keys: "Ctrl+Shift+T".to_string() },
        Keybinding { action: "closeWorkspace".to_string(), keys: "Ctrl+Shift+W".to_string() },
        Keybinding { action: "splitRight".to_string(), keys: "Ctrl+Shift+D".to_string() },
        Keybinding { action: "splitDown".to_string(), keys: "Ctrl+Shift+E".to_string() },
        Keybinding { action: "focusNext".to_string(), keys: "Alt+Right".to_string() },
        Keybinding { action: "focusPrev".to_string(), keys: "Alt+Left".to_string() },
        Keybinding { action: "focusUp".to_string(), keys: "Alt+Up".to_string() },
        Keybinding { action: "focusDown".to_string(), keys: "Alt+Down".to_string() },
        Keybinding { action: "toggleSidebar".to_string(), keys: "Ctrl+B".to_string() },
        Keybinding { action: "commandPalette".to_string(), keys: "Ctrl+Shift+P".to_string() },
        Keybinding { action: "notifications".to_string(), keys: "Ctrl+Shift+I".to_string() },
        Keybinding { action: "workspace1".to_string(), keys: "Ctrl+1".to_string() },
        Keybinding { action: "workspace2".to_string(), keys: "Ctrl+2".to_string() },
        Keybinding { action: "workspace3".to_string(), keys: "Ctrl+3".to_string() },
        Keybinding { action: "workspace4".to_string(), keys: "Ctrl+4".to_string() },
        Keybinding { action: "workspace5".to_string(), keys: "Ctrl+5".to_string() },
        Keybinding { action: "workspace6".to_string(), keys: "Ctrl+6".to_string() },
        Keybinding { action: "workspace7".to_string(), keys: "Ctrl+7".to_string() },
        Keybinding { action: "workspace8".to_string(), keys: "Ctrl+8".to_string() },
        Keybinding { action: "workspace9".to_string(), keys: "Ctrl+9".to_string() },
        Keybinding { action: "clearTerminal".to_string(), keys: "Ctrl+K".to_string() },
        Keybinding { action: "zoomIn".to_string(), keys: "Ctrl+=".to_string() },
        Keybinding { action: "zoomOut".to_string(), keys: "Ctrl+-".to_string() },
        Keybinding { action: "zoomReset".to_string(), keys: "Ctrl+0".to_string() },
    ]
}
