# WinMux - Terminal Multiplexer for Windows

## Vision
A native Windows terminal multiplexer built for multitasking with AI coding agents.
Spiritual successor to cmux (macOS), rebuilt from scratch for Windows using Tauri v2.

## Architecture

### Tech Stack
- **Backend**: Rust (Tauri v2 framework)
- **Frontend**: React 19 + TypeScript + Vite
- **Terminal**: xterm.js with WebGL addon (GPU-accelerated)
- **PTY**: portable-pty crate (ConPTY on Windows)
- **IPC (internal)**: Tauri Channels (high-throughput streaming)
- **IPC (external)**: Windows Named Pipes with JSON-RPC v2
- **State**: Zustand
- **Notifications**: Windows Toast via tauri-plugin-notification + OSC detection

### Object Hierarchy
```
Window (native Windows window, custom title bar)
  └── Workspace (sidebar entry, contains a pane tree)
       └── PaneNode (binary tree of splits)
            ├── Split { direction, ratio, first, second }
            └── Terminal { id, pty_session }
```

### Data Flow: PTY → Display
```
[pwsh.exe] ↔ [ConPTY] ↔ [portable-pty reader/writer]
                                  │
                             [Rust thread]
                             reads PTY output → scans for OSC notifications
                                  │
                         [tauri::ipc::Channel<Vec<u8>>]
                                  │
                            [WebView2 IPC]
                                  │
                         [xterm.js term.write()]
                                  │
                         [WebGL renderer → screen]
```

### Named Pipe IPC (CLI ↔ App)
```
[winmux.exe CLI] → [\\.\pipe\winmux] → [Rust pipe server] → [App state mutation]
                                                            → [Frontend event emission]
```

Protocol: JSON-RPC v2 over newline-delimited messages.

### Directory Structure
```
winmux/
├── src-tauri/           # Rust backend
│   ├── src/
│   │   ├── lib.rs       # Tauri app builder
│   │   ├── main.rs      # Entry point
│   │   ├── commands.rs   # Tauri IPC commands
│   │   ├── pty/         # PTY session management
│   │   ├── ipc/         # Named pipe server + JSON-RPC
│   │   ├── notification/ # OSC detection + notification store
│   │   ├── config/      # Settings management
│   │   ├── session/     # Session persistence (save/restore)
│   │   └── cli/         # CLI binary (winmux.exe)
│   ├── Cargo.toml
│   └── tauri.conf.json
├── src/                 # React frontend
│   ├── components/
│   │   ├── Terminal/    # xterm.js wrapper
│   │   ├── Sidebar/     # Vertical workspace tabs
│   │   ├── SplitPane/   # Binary tree split layout
│   │   ├── Notification/ # Notification rings/badges/panel
│   │   ├── TitleBar/    # Custom window title bar
│   │   └── CommandPalette/ # Command palette (Ctrl+Shift+P)
│   ├── hooks/           # React hooks
│   ├── stores/          # Zustand stores
│   ├── lib/             # Utilities
│   └── types/           # TypeScript types
├── .github/workflows/   # CI/CD
├── package.json
└── vite.config.ts
```

## Feature Roadmap

### Phase 1: Core Terminal ✅
- Tauri v2 app with custom title bar
- xterm.js with WebGL GPU-accelerated rendering
- ConPTY spawning of pwsh.exe / powershell.exe / cmd.exe
- Bidirectional data flow with Tauri Channels
- Terminal resize handling

### Phase 2: Workspaces & Split Panes
- Vertical sidebar with workspace tabs
- Binary tree split pane layout
- Resizable dividers
- Keyboard navigation between panes
- Workspace creation/deletion/renaming

### Phase 3: Notifications
- OSC 9/99/777 sequence detection in PTY output stream
- Blue notification ring around panes
- Sidebar badges for unread notifications
- Windows toast notifications
- Notification panel (Ctrl+Shift+I)

### Phase 4: CLI & Named Pipe IPC
- Named pipe server (\\.\pipe\winmux)
- JSON-RPC v2 protocol
- CLI binary (winmux.exe) with commands:
  - winmux notify, winmux split, winmux send
  - winmux list-workspaces, winmux new-workspace
  - winmux claude-hook, winmux codex-hook

### Phase 5: Settings & Persistence
- JSON config file (~/.config/winmux/settings.json)
- Keyboard shortcut customization
- Theme/font configuration
- Session save/restore on relaunch
- Shell profile management

### Phase 6: AI Agent Integration
- Claude Code hook handler
- Codex hook handler
- Agent-aware notification suppression
- Environment variable injection (WINMUX_SOCKET_PATH, etc.)

## Key Design Decisions

1. **Tauri v2 over Electron**: ~10x smaller binary, native Windows integration, Rust performance
2. **portable-pty over raw ConPTY**: Battle-tested (wezterm), handles edge cases
3. **xterm.js WebGL over Canvas**: GPU-accelerated, handles large scrollback
4. **Channels over Events**: Raw bytes, no JSON overhead, designed for streaming
5. **Named Pipes over TCP**: Windows-native, no port conflicts, secure by default
6. **Zustand over Redux**: Minimal boilerplate, perfect for terminal state
7. **Binary tree splits**: Same model as Windows Terminal, proven recursive structure
