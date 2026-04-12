# Changelog

All notable changes to WinMux are documented here. This project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.1] - 2026-04-12

### Fixed
- CI build: `cargo clippy -- -D warnings` failures that blocked the v0.3.0 release pipeline:
  - Added `#[allow(dead_code)]` on legitimately unused API hooks (`NotificationStore::{unread_count, unread_for_terminal, clear_for_terminal}`, `PtySession::{cols, rows, title, is_alive}`) that will be consumed by the daemon refactor
  - `#[allow(clippy::too_many_arguments)]` on the Tauri `create_terminal` command (8 args is natural given Tauri's injection model)
  - Replaced raw-pointer comparison in `ipc::server` with `std::ptr::eq` and dropped the redundant `*mut c_void` cast on `INVALID_HANDLE_VALUE`
  - Added `Default` impl for `PtyManager`

No functional changes.

## [0.3.0] - 2026-04-12

### Added
- **Session continuity** — closing WinMux no longer means losing your terminals. Two complementary mechanisms:
  - **Hide-to-tray (Tier 1)**: clicking ❌ now shows a modal asking whether to keep WinMux running in the tray (recommended) or quit completely. Your choice is remembered. Terminals and any running processes (Claude, dev servers, etc.) stay alive between hides — reopening via the tray returns you to the exact state you left.
  - **Visual restoration (Tier 2b)**: on actual app quit + relaunch, WinMux now saves each pane's working directory, shell, and last ~256 KB of scrollback (on window hide and before unload). On restart, shells respawn in the same cwd and the previous output is replayed with dim `── Previous session · <time> ──` and `── Resumed ──` delimiters so it's clearly historical.
- Tray menu labels clarified: `Open WinMux` / `Quit WinMux (ends all terminals)`. Tray tooltip now reads `WinMux — double-click to open`.

### Fixed
- **Re-launching the app shortcut while WinMux was hidden did nothing.** The single-instance callback only called `set_focus()` on the hidden window. It now calls `show()` + `unminimize()` + `set_focus()`, so re-launching surfaces the existing window as expected. Tray "Open" and double-click paths also hardened.
- Added log instrumentation on close-to-tray, second-instance launch, and explicit quit for easier debugging.

### Infrastructure
- PTY sessions now maintain a 256 KB ring buffer of raw output, accessible via `get_scrollback` IPC. Buffer is trimmed from the front as it fills.
- New `quit_app` Tauri command for deliberate app exit from the UI.
- New `get_terminal_shell` command exposes the shell path per session for accurate restoration.
- Session JSON schema extended with `scrollback` (base64) field on terminal panes. Old sessions load forward-compatibly (field is optional).

## [0.2.1] - 2026-04-12

### Fixed
- Ctrl+Click on links in the terminal now opens the user's default browser via `@tauri-apps/plugin-shell` instead of trying to navigate the embedded webview.

## [0.2.0] - 2026-04-12

### Added
- **Pane splits UI** — hover toolbar on every terminal with split-right, split-down, and close pane buttons. Keyboard shortcuts `Ctrl+Shift+D` (right), `Ctrl+Shift+E` (down), `Ctrl+Shift+W` (close pane).
- **Copy / paste** — `Ctrl+Shift+C` copies selection, `Ctrl+Shift+V` pastes. Right-click copies when there's a selection, pastes otherwise. Smart paste handles text, file paths (from Explorer), and images (Snipping Tool, screenshots — saved to temp dir and pasted as path, matching Claude Code convention).
- **Drag & drop files** — drop any file or folder onto the window and its quoted path is written to the active terminal.
- **Workspace right-click menu** — rename, change color, and delete workspaces from an explicit context menu. (Double-click to rename and clicking the color dot still work.)
- **Auto-updater** — checks GitHub releases on startup and every hour. Shows a notification with "Download" and "Later", then "Restart to update" once downloaded. Updates are signed with a minisign keypair.

### Changed
- **Contrast improvements** across the UI:
  - `--text-muted`: `#404040` → `#8A8A8A`
  - `--text-secondary`: `#737373` → `#B4B4B4`
  - `--text`: `#E5E5E5` → `#F5F5F5`
  - Sidebar `WORKSPACES` label: `#525252` → `#A3A3A3`
  - Inactive workspace name: `#737373` → `#B4B4B4` (hover `#D4D4D4`)
- Close-pane semantics: `Ctrl+Shift+W` now closes the active pane (collapsing the split) and only closes the whole workspace when a single pane remains.

### Infrastructure
- Added `clipboard-win` + `image` Rust dependencies for smart paste and image decoding.
- Added `tauri-plugin-updater` and `@tauri-apps/plugin-updater`.
- Release workflow now signs artifacts and publishes `latest.json` for updater consumption.

### Signing key setup (one-time, maintainers only)
Auto-update requires two GitHub Actions secrets on the repo:

- `TAURI_SIGNING_PRIVATE_KEY` — contents of the private key file (generated via `pnpm tauri signer generate`)
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — password used when generating the key (empty string if `--password ""` was used)

The public key is embedded in `src-tauri/tauri.conf.json` under `plugins.updater.pubkey`. Never commit the private key.

## [0.1.0] - 2026-04

Initial release.
- Tauri v2 + React + xterm.js
- Windows PTY via `portable-pty` (ConPTY)
- Workspaces, split panes data model, session restore
- OSC 9 toast notifications
- Tray icon, single-instance, minimal dark UI
