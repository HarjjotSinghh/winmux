# WinMux

**Terminal multiplexer for Windows, built for AI coding agents.**

WinMux is a native Windows terminal application with workspaces, split panes, an integrated notification system for AI agents (Claude Code, Codex, etc.), a CLI API, and GPU-accelerated rendering. Think cmux, but for Windows.

## Features

- **Workspaces** - Vertical sidebar with named workspace tabs, git branch display, and notification badges
- **Split Panes** - Horizontal and vertical splits with draggable dividers
- **GPU-Accelerated Terminal** - xterm.js with WebGL rendering for smooth, fast terminal output
- **AI Agent Notifications** - Detects OSC 9/99/777 sequences and provides visual notification rings, sidebar badges, and Windows toast notifications
- **CLI API** - `winmux` CLI communicates with the running app via Windows named pipes (JSON-RPC v2)
- **Command Palette** - Quick access to all commands via `Ctrl+Shift+P`
- **Agent Hooks** - Built-in hook handlers for Claude Code (`winmux claude-hook`) and Codex (`winmux codex-hook`)
- **Session Persistence** - Workspaces, pane layouts, and working directories are saved and restored across sessions
- **Customizable** - JSON-based settings for shell, appearance, keybindings, and notifications
- **System Tray** - Minimize to tray, double-click to restore
- **Modern Shell Support** - Auto-detects and prefers PowerShell 7+ (pwsh.exe)

## Installation

### From GitHub Releases

Download the latest `.msi` installer from [Releases](https://github.com/harjjotsinghh/winmux/releases).

### Build from Source

**Prerequisites:**
- [Rust](https://rustup.rs/) (1.80+)
- [Node.js](https://nodejs.org/) (22+)
- [pnpm](https://pnpm.io/) (10+)
- Visual Studio Build Tools 2022 (with C++ workload)

```bash
# Clone the repository
git clone https://github.com/harjjotsinghh/winmux.git
cd winmux

# Install frontend dependencies
pnpm install

# Run in development mode
pnpm tauri dev

# Build for production
pnpm tauri build
```

The built installer will be in `src-tauri/target/release/bundle/`.

## Keyboard Shortcuts

| Action | Shortcut |
|--------|----------|
| New Workspace | `Ctrl+Shift+T` |
| Close Workspace | `Ctrl+Shift+W` |
| Split Right | `Ctrl+Shift+D` |
| Split Down | `Ctrl+Shift+E` |
| Toggle Sidebar | `Ctrl+B` |
| Command Palette | `Ctrl+Shift+P` |
| Notifications | `Ctrl+Shift+I` |
| Switch Workspace 1-9 | `Ctrl+1` - `Ctrl+9` |
| Zoom In/Out | `Ctrl+=` / `Ctrl+-` |

## CLI Usage

The `winmux-cli` binary communicates with the running WinMux app:

```bash
# Check if WinMux is running
winmux ping

# Send a notification
winmux notify --title "Build Complete" --body "All tests passed"

# Send text to a terminal
winmux send "ls -la" --terminal <id>

# Hook for Claude Code
winmux claude-hook < hook-data.json
```

## AI Agent Integration

### Claude Code

Add to your Claude Code hooks configuration:

```json
{
  "hooks": {
    "notification": [
      {
        "command": "winmux claude-hook"
      }
    ]
  }
}
```

### Codex

```toml
# ~/.codex/config.toml
notify = ["winmux", "codex-hook"]
```

### Custom Notifications (any agent)

Send OSC 777 from your shell:

```bash
printf "\033]777;notify;Build Done;All tests passed\007"
```

## Configuration

Settings are stored at `%APPDATA%/winmux/settings.json`:

```json
{
  "shell": {
    "defaultShell": "pwsh.exe",
    "defaultCwd": null,
    "env": {}
  },
  "appearance": {
    "fontFamily": "Cascadia Code, Consolas, monospace",
    "fontSize": 14,
    "theme": "dark",
    "sidebarWidth": 220,
    "showSidebar": true,
    "opacity": 1.0
  },
  "notifications": {
    "enabled": true,
    "sound": true,
    "toastNotifications": true,
    "oscDetection": true
  }
}
```

## Architecture

Built with [Tauri v2](https://tauri.app/) (Rust backend + WebView2 frontend):

- **PTY Management**: `portable-pty` crate (ConPTY on Windows)
- **Terminal Rendering**: xterm.js with WebGL addon
- **IPC Streaming**: Tauri Channels (raw bytes, no JSON overhead)
- **CLI IPC**: Windows Named Pipes with JSON-RPC v2
- **State Management**: Zustand
- **Notifications**: OSC sequence detection + Windows toast notifications

## License

AGPL-3.0-or-later. See [LICENSE](LICENSE) for details.

## Credits

Inspired by [cmux](https://github.com/manaflow-ai/cmux) (macOS terminal multiplexer by Manaflow AI).
