use std::io::{BufRead, BufReader, Write};

const PIPE_NAME: &str = r"\\.\pipe\winmux";

fn main() {
    let args: Vec<String> = std::env::args().collect();

    if args.len() < 2 {
        print_usage();
        std::process::exit(1);
    }

    let command = &args[1];

    let result = match command.as_str() {
        "ping" => send_rpc("system.ping", None),
        "capabilities" => send_rpc("system.capabilities", None),
        "notify" => {
            let title = get_flag(&args, "--title").unwrap_or_else(|| "WinMux".to_string());
            let body = get_flag(&args, "--body").unwrap_or_default();
            let subtitle = get_flag(&args, "--subtitle").unwrap_or_default();
            let full_body = if subtitle.is_empty() {
                body
            } else {
                format!("{}\n{}", subtitle, body)
            };
            send_rpc(
                "notification.create",
                Some(serde_json::json!({
                    "title": title,
                    "body": full_body,
                })),
            )
        }
        "send" => {
            let text = args[2..].join(" ");
            let terminal_id = get_flag(&args, "--terminal");
            send_rpc(
                "terminal.send",
                Some(serde_json::json!({
                    "terminalId": terminal_id,
                    "text": text,
                })),
            )
        }
        "claude-hook" => {
            let mut input = String::new();
            if std::io::stdin().read_line(&mut input).is_ok() && !input.trim().is_empty() {
                send_rpc(
                    "notification.create",
                    Some(serde_json::json!({
                        "title": "Claude Code",
                        "body": "Agent needs attention",
                        "source": "claude-hook",
                    })),
                )
            } else {
                send_rpc(
                    "notification.create",
                    Some(serde_json::json!({
                        "title": "Claude Code",
                        "body": "Task completed",
                        "source": "claude-hook",
                    })),
                )
            }
        }
        "codex-hook" => send_rpc(
            "notification.create",
            Some(serde_json::json!({
                "title": "Codex",
                "body": "Agent needs attention",
                "source": "codex-hook",
            })),
        ),
        "help" | "--help" | "-h" => {
            print_usage();
            std::process::exit(0);
        }
        "version" | "--version" | "-V" => {
            println!("winmux-cli 0.1.0");
            std::process::exit(0);
        }
        _ => {
            eprintln!("Unknown command: {}", command);
            print_usage();
            std::process::exit(1);
        }
    };

    match result {
        Ok(response) => {
            if let Some(result) = response.get("result") {
                println!("{}", serde_json::to_string_pretty(result).unwrap());
            } else if let Some(error) = response.get("error") {
                eprintln!("Error: {}", error);
                std::process::exit(1);
            }
        }
        Err(e) => {
            eprintln!("Failed to connect to WinMux: {}", e);
            eprintln!("Is WinMux running?");
            std::process::exit(1);
        }
    }
}

fn send_rpc(
    method: &str,
    params: Option<serde_json::Value>,
) -> Result<serde_json::Value, Box<dyn std::error::Error>> {
    let mut stream = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(PIPE_NAME)?;

    let request = serde_json::json!({
        "id": "1",
        "method": method,
        "params": params.unwrap_or(serde_json::Value::Null),
    });

    writeln!(stream, "{}", serde_json::to_string(&request)?)?;
    stream.flush()?;

    let reader = BufReader::new(stream);
    for line in reader.lines() {
        let line = line?;
        if !line.trim().is_empty() {
            return Ok(serde_json::from_str(&line)?);
        }
    }

    Err("No response from WinMux".into())
}

fn get_flag(args: &[String], flag: &str) -> Option<String> {
    args.iter()
        .position(|a| a == flag)
        .and_then(|i| args.get(i + 1))
        .cloned()
}

fn print_usage() {
    println!(
        r#"winmux-cli - Command-line interface for WinMux terminal multiplexer

USAGE:
    winmux <command> [options]

COMMANDS:
    ping                    Check if WinMux is running
    capabilities            List supported features
    notify                  Send a notification
        --title <text>      Notification title (default: "WinMux")
        --body <text>       Notification body
        --subtitle <text>   Notification subtitle
    send <text>             Send text to terminal
        --terminal <id>     Target terminal ID
    claude-hook             Handle Claude Code hook events
    codex-hook              Handle Codex hook events
    version                 Show version
    help                    Show this help

EXAMPLES:
    winmux ping
    winmux notify --title "Build Done" --body "All tests passed"
    winmux send "ls -la" --terminal abc123
    winmux claude-hook < hook-input.json"#
    );
}
