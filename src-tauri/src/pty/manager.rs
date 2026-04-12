use super::session::{PtySession, ScrollbackBuf, SCROLLBACK_MAX_BYTES};
use crate::notification::OscParser;
use std::collections::HashMap;
use std::io::Read;
use tauri::ipc::Channel;
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

pub struct PtyManager {
    sessions: HashMap<String, PtySession>,
}

#[derive(Clone, serde::Serialize)]
struct OscNotificationEvent {
    terminal_id: String,
    title: String,
    body: String,
    osc_type: String,
}

#[derive(Clone, serde::Serialize)]
struct TerminalExitEvent {
    terminal_id: String,
    exit_code: Option<u32>,
}

impl Default for PtyManager {
    fn default() -> Self {
        Self::new()
    }
}

impl PtyManager {
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
        }
    }

    pub fn create(
        &mut self,
        shell: &str,
        cwd: Option<&str>,
        cols: u16,
        rows: u16,
        channel: Channel<Vec<u8>>,
        app_handle: AppHandle,
    ) -> Result<String, String> {
        let id = Uuid::new_v4().to_string();

        let env_vars = vec![
            ("WINMUX_TERMINAL_ID".to_string(), id.clone()),
            (
                "WINMUX_PIPE_NAME".to_string(),
                r"\\.\pipe\winmux".to_string(),
            ),
        ];

        let (session, reader) = PtySession::spawn(shell, cwd, cols, rows, env_vars)?;
        let scrollback = session.scrollback.clone();
        self.sessions.insert(id.clone(), session);

        // Spawn reader thread for this terminal
        let terminal_id = id.clone();
        std::thread::spawn(move || {
            Self::read_loop(reader, channel, terminal_id, app_handle, scrollback);
        });

        Ok(id)
    }

    fn read_loop(
        mut reader: Box<dyn Read + Send>,
        channel: Channel<Vec<u8>>,
        terminal_id: String,
        app_handle: AppHandle,
        scrollback: ScrollbackBuf,
    ) {
        let mut buf = vec![0u8; 8192];
        let mut osc_parser = OscParser::new();

        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let data = buf[..n].to_vec();

                    // Scan for OSC notification sequences
                    if let Some(notif) = osc_parser.parse(&data) {
                        // Send Windows toast notification
                        crate::notification::send_system_notification(
                            &app_handle, &notif.title, &notif.body,
                        );

                        let _ = app_handle.emit(
                            "osc-notification",
                            OscNotificationEvent {
                                terminal_id: terminal_id.clone(),
                                title: notif.title,
                                body: notif.body,
                                osc_type: notif.osc_type,
                            },
                        );
                    }

                    // Append to scrollback ring buffer (trim front if over cap)
                    if let Ok(mut sb) = scrollback.lock() {
                        sb.extend(data.iter());
                        let overflow = sb.len().saturating_sub(SCROLLBACK_MAX_BYTES);
                        if overflow > 0 {
                            sb.drain(0..overflow);
                        }
                    }

                    // Send raw data to frontend
                    if channel.send(data).is_err() {
                        break;
                    }
                }
                Err(e) => {
                    log::debug!("PTY read error for {}: {}", terminal_id, e);
                    break;
                }
            }
        }

        // Terminal exited
        let _ = app_handle.emit(
            "terminal-exit",
            TerminalExitEvent {
                terminal_id,
                exit_code: None,
            },
        );
    }

    pub fn write(&self, id: &str, data: &[u8]) -> Result<(), String> {
        let session = self
            .sessions
            .get(id)
            .ok_or_else(|| format!("Terminal not found: {}", id))?;
        session.write(data)
    }

    pub fn resize(&mut self, id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let session = self
            .sessions
            .get_mut(id)
            .ok_or_else(|| format!("Terminal not found: {}", id))?;
        session.resize(cols, rows)
    }

    pub fn close(&mut self, id: &str) -> Result<(), String> {
        if let Some(mut session) = self.sessions.remove(id) {
            session.kill();
            Ok(())
        } else {
            Err(format!("Terminal not found: {}", id))
        }
    }

    pub fn get_cwd(&self, id: &str) -> Result<String, String> {
        let session = self
            .sessions
            .get(id)
            .ok_or_else(|| format!("Terminal not found: {}", id))?;
        Ok(session.cwd.to_string_lossy().to_string())
    }

    pub fn get_scrollback(&self, id: &str) -> Result<Vec<u8>, String> {
        let session = self
            .sessions
            .get(id)
            .ok_or_else(|| format!("Terminal not found: {}", id))?;
        let sb = session.scrollback.lock().map_err(|e| e.to_string())?;
        Ok(sb.iter().copied().collect())
    }

    pub fn get_shell(&self, id: &str) -> Result<String, String> {
        let session = self
            .sessions
            .get(id)
            .ok_or_else(|| format!("Terminal not found: {}", id))?;
        Ok(session.shell.clone())
    }

    pub fn session_count(&self) -> usize {
        self.sessions.len()
    }
}
