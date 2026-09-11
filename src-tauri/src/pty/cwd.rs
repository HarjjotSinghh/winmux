//! Tracks the shell's live working directory from OSC escape sequences.
//!
//! Supported on the wire:
//! * **OSC 7** — `ESC ] 7 ; file://HOST/PATH BEL | ST` (bash, zsh, fish,
//!   Git Bash, WSL, most POSIX shells with shell integration).
//! * **OSC 9;9** — `ESC ] 9 ; 9 ; PATH BEL | ST` (ConEmu-style, emitted by
//!   Windows Terminal shell integration and various PowerShell setups).
//!
//! When the shell emits neither, the PTY's spawn directory remains the best
//! known value. The tracker is a tiny state machine so a sequence split
//! across two `read` calls still parses.

use std::path::PathBuf;

const MAX_PAYLOAD: usize = 4096;
const BEL: u8 = 0x07;
const ESC: u8 = 0x1b;

#[derive(PartialEq, Eq)]
enum State {
    Normal,
    Esc,
    Osc,
    OscEsc,
}

pub struct CwdTracker {
    state: State,
    buf: Vec<u8>,
}

impl Default for CwdTracker {
    fn default() -> Self {
        Self::new()
    }
}

impl CwdTracker {
    pub fn new() -> Self {
        Self {
            state: State::Normal,
            buf: Vec::new(),
        }
    }

    /// Feed raw PTY bytes. Returns the last complete cwd update in `data`, if
    /// any. Never allocates more than `MAX_PAYLOAD` per sequence.
    pub fn parse(&mut self, data: &[u8]) -> Option<String> {
        let mut found: Option<String> = None;

        for &b in data {
            match self.state {
                State::Normal => {
                    if b == ESC {
                        self.state = State::Esc;
                    }
                }
                State::Esc => {
                    if b == b']' {
                        self.state = State::Osc;
                        self.buf.clear();
                    } else {
                        self.state = State::Normal;
                    }
                }
                State::Osc => {
                    if b == BEL {
                        self.state = State::Normal;
                        if let Some(path) = decode(&self.buf) {
                            found = Some(path);
                        }
                    } else if b == ESC {
                        self.state = State::OscEsc;
                    } else if self.buf.len() < MAX_PAYLOAD {
                        self.buf.push(b);
                    } else {
                        // Runaway sequence; abandon it rather than grow.
                        self.state = State::Normal;
                        self.buf.clear();
                    }
                }
                State::OscEsc => {
                    // ST is ESC \ ; anything else aborts the sequence.
                    if b == b'\\' {
                        self.state = State::Normal;
                        if let Some(path) = decode(&self.buf) {
                            found = Some(path);
                        }
                    } else {
                        self.state = State::Normal;
                    }
                }
            }
        }

        found
    }
}

fn decode(payload: &[u8]) -> Option<String> {
    let text = std::str::from_utf8(payload).ok()?;

    if let Some(rest) = text.strip_prefix("7;") {
        return parse_file_uri(rest);
    }
    if let Some(rest) = text.strip_prefix("9;9;") {
        return Some(normalize_path(rest));
    }
    None
}

/// `file://HOST/C:/Users/me` → `C:\Users\me`
fn parse_file_uri(uri: &str) -> Option<String> {
    let rest = uri.strip_prefix("file://")?;
    let slash = rest.find('/')?;
    let path = percent_decode(&rest[slash..]);
    if path.is_empty() {
        return None;
    }
    Some(normalize_path(&path))
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hi = (bytes[i + 1] as char).to_digit(16);
            let lo = (bytes[i + 2] as char).to_digit(16);
            if let (Some(hi), Some(lo)) = (hi, lo) {
                out.push((hi * 16 + lo) as u8);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Windows path conventions: `/C:/Users/me` → `C:\Users\me`, forward slashes
/// become backslashes. Non-Windows-style paths pass through with slashes.
fn normalize_path(path: &str) -> String {
    let trimmed = if path.len() >= 3
        && path.starts_with('/')
        && path.as_bytes()[1].is_ascii_alphabetic()
        && path.as_bytes()[2] == b':'
    {
        &path[1..]
    } else {
        path
    };
    trimmed.replace('/', "\\")
}

/// Update the shared cwd if it actually changed.
pub fn update_if_changed(shared: &std::sync::Arc<std::sync::Mutex<PathBuf>>, next: &str) {
    if let Ok(mut current) = shared.lock() {
        let candidate = PathBuf::from(next);
        if *current != candidate {
            *current = candidate;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(data: &[u8]) -> Option<String> {
        CwdTracker::new().parse(data)
    }

    #[test]
    fn parses_osc7_with_bel() {
        let got = parse(b"\x1b]7;file://HOST/C:/Users/test\x07");
        assert_eq!(got.as_deref(), Some("C:\\Users\\test"));
    }

    #[test]
    fn parses_osc7_with_st() {
        let got = parse(b"\x1b]7;file://hostname/C:/Projects/winmux\x1b\\");
        assert_eq!(got.as_deref(), Some("C:\\Projects\\winmux"));
    }

    #[test]
    fn percent_decodes_spaces() {
        let got = parse(b"\x1b]7;file://h/C:/Program%20Files\x07");
        assert_eq!(got.as_deref(), Some("C:\\Program Files"));
    }

    #[test]
    fn parses_osc_9_9() {
        let got = parse(b"\x1b]9;9;C:\\Users\\me\\repo\x07");
        assert_eq!(got.as_deref(), Some("C:\\Users\\me\\repo"));
    }

    #[test]
    fn ignores_unrelated_osc() {
        assert_eq!(parse(b"\x1b]9;notify;hello\x07"), None);
        assert_eq!(parse(b"\x1b]0;window title\x07"), None);
        assert_eq!(parse(b"\x1b]777;notify;t;b\x07"), None);
    }

    #[test]
    fn parses_sequence_split_across_calls() {
        let mut tracker = CwdTracker::new();
        assert_eq!(tracker.parse(b"\x1b]7;file://h/C:/Pro"), None);
        let got = tracker.parse(b"jects\x07");
        assert_eq!(got.as_deref(), Some("C:\\Projects"));
    }

    #[test]
    fn returns_last_update_in_a_chunk() {
        let got = parse(b"\x1b]7;file://h/C:/one\x07 noise \x1b]7;file://h/C:/two\x07");
        assert_eq!(got.as_deref(), Some("C:\\two"));
    }

    #[test]
    fn survives_noise_and_aborted_sequences() {
        let got = parse(b"hello \x1b]7;file://h/C:/ok\x07 \x1b[31mred\x1b[0m");
        assert_eq!(got.as_deref(), Some("C:\\ok"));
    }
}
