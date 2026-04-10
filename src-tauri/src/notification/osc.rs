/// Parsed OSC notification
#[derive(Debug, Clone, serde::Serialize)]
pub struct OscNotification {
    pub title: String,
    pub body: String,
    pub osc_type: String,
}

/// Stateful parser that detects OSC 9, 99, and 777 notification sequences
/// in a stream of terminal output bytes.
pub struct OscParser {
    state: ParseState,
    buffer: Vec<u8>,
}

#[derive(Debug, PartialEq)]
enum ParseState {
    Normal,
    Escape,       // saw \x1b
    OscStart,     // saw \x1b]
    OscBody,      // accumulating OSC payload
}

impl OscParser {
    pub fn new() -> Self {
        Self {
            state: ParseState::Normal,
            buffer: Vec::with_capacity(256),
        }
    }

    /// Parse a chunk of terminal output. Returns the first OSC notification found, if any.
    pub fn parse(&mut self, data: &[u8]) -> Option<OscNotification> {
        for &byte in data {
            match self.state {
                ParseState::Normal => {
                    if byte == 0x1b {
                        self.state = ParseState::Escape;
                    }
                }
                ParseState::Escape => {
                    if byte == b']' {
                        self.state = ParseState::OscStart;
                        self.buffer.clear();
                    } else {
                        self.state = ParseState::Normal;
                    }
                }
                ParseState::OscStart => {
                    self.buffer.push(byte);
                    // Check if we have enough to know the OSC type
                    if byte == b';' || self.buffer.len() > 4 {
                        self.state = ParseState::OscBody;
                    }
                }
                ParseState::OscBody => {
                    // OSC terminators: BEL (\x07) or ST (\x1b\\)
                    if byte == 0x07 {
                        let result = self.try_parse_notification();
                        self.state = ParseState::Normal;
                        self.buffer.clear();
                        if result.is_some() {
                            return result;
                        }
                    } else if byte == 0x1b {
                        // Potential ST terminator - peek for backslash
                        // For simplicity, treat ESC in OSC body as terminator
                        let result = self.try_parse_notification();
                        self.state = ParseState::Normal;
                        self.buffer.clear();
                        if result.is_some() {
                            return result;
                        }
                    } else {
                        self.buffer.push(byte);
                        // Safety limit
                        if self.buffer.len() > 4096 {
                            self.state = ParseState::Normal;
                            self.buffer.clear();
                        }
                    }
                }
            }
        }
        None
    }

    fn try_parse_notification(&self) -> Option<OscNotification> {
        let payload = String::from_utf8_lossy(&self.buffer);

        // OSC 9: \x1b]9;<message>\x07 (iTerm2 growl)
        if let Some(msg) = payload.strip_prefix("9;") {
            return Some(OscNotification {
                title: "Terminal".to_string(),
                body: msg.to_string(),
                osc_type: "osc9".to_string(),
            });
        }

        // OSC 99: \x1b]99;<message>\x07 (Kitty notification)
        if let Some(msg) = payload.strip_prefix("99;") {
            // Kitty format can have key=value pairs before the message
            // e.g., "i=1:d=0;Title" or just "Message"
            let parts: Vec<&str> = msg.splitn(2, ';').collect();
            if parts.len() == 2 {
                return Some(OscNotification {
                    title: "Notification".to_string(),
                    body: parts[1].to_string(),
                    osc_type: "osc99".to_string(),
                });
            }
            return Some(OscNotification {
                title: "Notification".to_string(),
                body: msg.to_string(),
                osc_type: "osc99".to_string(),
            });
        }

        // OSC 777: \x1b]777;notify;<title>;<body>\x07 (rxvt/urxvt)
        if let Some(rest) = payload.strip_prefix("777;notify;") {
            let parts: Vec<&str> = rest.splitn(2, ';').collect();
            if parts.len() == 2 {
                return Some(OscNotification {
                    title: parts[0].to_string(),
                    body: parts[1].to_string(),
                    osc_type: "osc777".to_string(),
                });
            }
            return Some(OscNotification {
                title: rest.to_string(),
                body: String::new(),
                osc_type: "osc777".to_string(),
            });
        }

        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_osc9() {
        let mut parser = OscParser::new();
        let data = b"\x1b]9;Build complete\x07";
        let notif = parser.parse(data).unwrap();
        assert_eq!(notif.body, "Build complete");
        assert_eq!(notif.osc_type, "osc9");
    }

    #[test]
    fn test_osc777() {
        let mut parser = OscParser::new();
        let data = b"\x1b]777;notify;Claude Code;Task finished\x07";
        let notif = parser.parse(data).unwrap();
        assert_eq!(notif.title, "Claude Code");
        assert_eq!(notif.body, "Task finished");
        assert_eq!(notif.osc_type, "osc777");
    }

    #[test]
    fn test_no_notification() {
        let mut parser = OscParser::new();
        let data = b"Hello, world!\r\n";
        assert!(parser.parse(data).is_none());
    }

    #[test]
    fn test_osc99() {
        let mut parser = OscParser::new();
        let data = b"\x1b]99;Agent done\x07";
        let notif = parser.parse(data).unwrap();
        assert_eq!(notif.body, "Agent done");
        assert_eq!(notif.osc_type, "osc99");
    }
}
