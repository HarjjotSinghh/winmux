use super::session::{PtySession, ScrollbackBuf, SCROLLBACK_MAX_BYTES};
use crate::notification::OscParser;
use std::collections::HashMap;
use std::io::Read;
use uuid::Uuid;

pub struct PtyManager {
    sessions: HashMap<String, PtySession>,
}

/// Information about the OSC notification a PTY emitted.
pub struct OscNotif {
    pub osc_type: String,
    pub title: String,
    pub body: String,
}

/// Callbacks a caller plugs in per PTY session. These replace the old
/// Tauri-specific `Channel<Vec<u8>>` + `AppHandle` parameters so the same
/// `PtyManager` can be used from the Tauri UI **and** the daemon binary.
#[allow(clippy::type_complexity)]
pub struct SessionCallbacks {
    pub on_output: Box<dyn Fn(&[u8]) + Send + Sync>,
    pub on_osc: Box<dyn Fn(&OscNotif) + Send + Sync>,
    pub on_exit: Box<dyn Fn(Option<u32>) + Send + Sync>,
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

    /// Spawn a new PTY. The caller provides the session ID so it can reference
    /// it from the callbacks (e.g. to tag emitted events with the terminal ID).
    pub fn create(
        &mut self,
        id: String,
        shell: &str,
        cwd: Option<&str>,
        cols: u16,
        rows: u16,
        callbacks: SessionCallbacks,
    ) -> Result<(), String> {
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
        std::thread::spawn(move || {
            Self::read_loop(reader, callbacks, scrollback);
        });

        Ok(())
    }

    /// Convenience that generates a UUID and calls `create`.
    pub fn create_with_uuid(
        &mut self,
        shell: &str,
        cwd: Option<&str>,
        cols: u16,
        rows: u16,
        callbacks: SessionCallbacks,
    ) -> Result<String, String> {
        let id = Uuid::new_v4().to_string();
        self.create(id.clone(), shell, cwd, cols, rows, callbacks)?;
        Ok(id)
    }

    fn read_loop(
        mut reader: Box<dyn Read + Send>,
        callbacks: SessionCallbacks,
        scrollback: ScrollbackBuf,
    ) {
        let mut buf = vec![0u8; 8192];
        let mut osc_parser = OscParser::new();

        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let data = &buf[..n];

                    // Scan for OSC notification sequences
                    if let Some(notif) = osc_parser.parse(data) {
                        let n = OscNotif {
                            osc_type: notif.osc_type,
                            title: notif.title,
                            body: notif.body,
                        };
                        (callbacks.on_osc)(&n);
                    }

                    // Append to scrollback ring buffer (trim front if over cap)
                    if let Ok(mut sb) = scrollback.lock() {
                        sb.extend(data.iter());
                        let overflow = sb.len().saturating_sub(SCROLLBACK_MAX_BYTES);
                        if overflow > 0 {
                            sb.drain(0..overflow);
                        }
                    }

                    // Forward to caller
                    (callbacks.on_output)(data);
                }
                Err(e) => {
                    log::debug!("PTY read error: {}", e);
                    break;
                }
            }
        }

        // Terminal exited
        (callbacks.on_exit)(None);
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

    pub fn list_ids(&self) -> Vec<String> {
        self.sessions.keys().cloned().collect()
    }

    #[allow(dead_code)]
    pub fn session_count(&self) -> usize {
        self.sessions.len()
    }
}
