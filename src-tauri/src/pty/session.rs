use portable_pty::{Child, CommandBuilder, MasterPty, PtySize};
use std::collections::VecDeque;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::Mutex;

pub const SCROLLBACK_MAX_BYTES: usize = 256 * 1024;

pub type ScrollbackBuf = Arc<Mutex<VecDeque<u8>>>;

pub struct PtySession {
    master: Box<dyn MasterPty + Send>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    child: Box<dyn Child + Send + Sync>,
    pub cols: u16,
    pub rows: u16,
    pub cwd: PathBuf,
    pub shell: String,
    pub title: String,
    pub scrollback: ScrollbackBuf,
}

impl PtySession {
    pub fn spawn(
        shell: &str,
        cwd: Option<&str>,
        cols: u16,
        rows: u16,
        env_vars: Vec<(String, String)>,
    ) -> Result<(Self, Box<dyn Read + Send>), String> {
        let pty_system = portable_pty::native_pty_system();

        let size = PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        };

        let pair = pty_system
            .openpty(size)
            .map_err(|e| format!("Failed to open PTY: {}", e))?;

        let mut cmd = CommandBuilder::new(shell);

        // Add shell-specific flags for cleaner startup
        let shell_lower = shell.to_lowercase();
        if shell_lower.contains("powershell") || shell_lower.contains("pwsh") {
            cmd.arg("-NoLogo");
        }

        // Set working directory
        let working_dir = if let Some(dir) = cwd {
            PathBuf::from(dir)
        } else {
            dirs::home_dir().unwrap_or_else(|| PathBuf::from("C:\\"))
        };
        cmd.cwd(&working_dir);

        // Inject WinMux environment variables
        for (key, value) in &env_vars {
            cmd.env(key, value);
        }
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("Failed to spawn shell: {}", e))?;

        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("Failed to clone PTY reader: {}", e))?;

        let writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("Failed to take PTY writer: {}", e))?;

        let session = PtySession {
            master: pair.master,
            writer: Arc::new(Mutex::new(writer)),
            child,
            cols,
            rows,
            cwd: working_dir,
            shell: shell.to_string(),
            title: String::new(),
            scrollback: Arc::new(Mutex::new(VecDeque::with_capacity(SCROLLBACK_MAX_BYTES))),
        };

        Ok((session, reader))
    }

    pub fn write(&self, data: &[u8]) -> Result<(), String> {
        let mut writer = self.writer.lock().map_err(|e| e.to_string())?;
        writer
            .write_all(data)
            .map_err(|e| format!("Failed to write to PTY: {}", e))?;
        writer
            .flush()
            .map_err(|e| format!("Failed to flush PTY: {}", e))?;
        Ok(())
    }

    pub fn resize(&mut self, cols: u16, rows: u16) -> Result<(), String> {
        self.cols = cols;
        self.rows = rows;
        self.master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Failed to resize PTY: {}", e))
    }

    pub fn is_alive(&mut self) -> bool {
        self.child
            .try_wait()
            .map(|status| status.is_none())
            .unwrap_or(false)
    }

    pub fn kill(&mut self) {
        let _ = self.child.kill();
    }
}
