# Changelog

All notable changes to WinMux are documented here. This project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
