# Changelog

All notable changes to WinMux are documented here. This project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.10] - 2026-04-13

### Fixed — root cause of the "buttons don't work" modal
- **CloseConfirmModal buttons were genuinely broken since v0.3.0.** The modal is rendered inside `TitleBar`, whose root `<div onMouseDown={startDragging}>` enables native window-drag. The modal did not stop `mousedown` propagation, so every click on the modal started a Tauri window drag and the subsequent click never registered as a button click. Added `onMouseDown` + `onMouseUp` stopPropagation on both the overlay and modal content. Quit completely / Keep running / click-outside-to-dismiss / Escape-to-dismiss all work reliably now. **This was not a freeze — it was drag interception.**

### Added — escape hatches
- **Tray menu "Force Quit (kill immediately)"**. Tray events are handled by Rust, not JS, so this remains clickable even when the webview is frozen. Calls `std::process::exit(0)` directly — no modal, no daemon shutdown RPC, no waiting. The one-click recovery when the UI is stuck.
- **Escape dismisses the close modal** (registered with `capture: true` so it fires before any input handlers inside the modal).
- Regular tray "Quit" now also uses the fire-and-forget daemon-shutdown pattern (matches `quit_app`), so tray quit can never hang on a stuck daemon either.

## [0.4.9] - 2026-04-13

### Added (diagnostic)
- Stall heartbeat: 100 ms `setInterval` measures actual fire gap; if it exceeds 300 ms we log `UI stall: <duration>ms` via a new `diag_log` Tauri command into the existing `AppData\Local\com.winmux.terminal\logs\WinMux.log`. This captures freeze durations without the user having to open DevTools before the stall.
- `PerformanceObserver` for `longtask` entries > 200 ms — logged with name so we can tell whether it's JS, style, layout, or script-parsing.
- Tauri `diag_log(level, msg)` command so the UI can write structured warnings/info directly into the Rust-side log file.

## [0.4.8] - 2026-04-13

### Fixed
- **Close modal buttons now respond even under load.** `quit_app` no longer blocks waiting for `daemon.shutdown()` — it spawns the shutdown RPC on a detached thread with a 250 ms head-start, then exits regardless. Previously "Quit completely" could stall for 3–15 s on a hung daemon and users saw nothing happen.
- **Auto-save no longer stacks.** Added in-flight guard on the 5 s `setInterval` save so a slow save (daemon call timeout, heavy scrollback fetch) can't let subsequent saves pile up and starve the Tauri async runtime.

### Added
- **DevTools shortcut (diagnostic)**: `Ctrl+Shift+Alt+I` opens the Chrome DevTools window in release builds. Enabled via the `devtools` tauri feature so the shipped installer can be profiled in-place.

## [0.4.7] - 2026-04-13

### Fixed
- **Stability: ~30–60 s freeze with 4+ active terminals.** Two changes targeting the main-thread stall:
  1. `TerminalView` now coalesces PTY output via a `requestAnimationFrame` writer. Busy sessions (Claude streaming tokens, `cargo build`, long `ls`) previously called `term.write` once per PTY chunk, dozens of times per frame. On bursts with multiple panes open, xterm's synchronous parser could stall the main thread long enough to trip Windows' "(Not Responding)" detection. Writes are now merged into one `term.write` per frame per pane — xterm still processes the same bytes, just in ≤60 calls/sec instead of thousands.
  2. `DaemonClient::CALL_TIMEOUT` dropped from 15 s → 3 s. A hung daemon call used to tie up a Tauri command worker for 15 s, during which periodic saves (~13 RPCs / 5 s across 4 panes) could queue and starve the async runtime. With a 3 s ceiling, stuck calls fail fast and callers surface the error instead of spreading the stall.

## [0.4.6] - 2026-04-13

### Fixed
- **Critical: installer/updater failed with "Error opening file for writing: ...\winmux-daemon.exe"** when the previous install's daemon was still running (which is nearly always the case thanks to hide-to-tray + idle-timeout). NSIS doesn't kill processes before overwriting by default. Added `src-tauri/nsis/hooks.nsh` with `NSIS_HOOK_PREINSTALL` + `NSIS_HOOK_PREUNINSTALL` macros that `taskkill /F /IM winmux-daemon.exe /T` (and `winmux.exe`, `winmux-cli.exe`) before extraction. Wired via `bundle.nsis.installerHooks`. Both fresh installs and in-place updates now succeed even when WinMux is running.

### CI
- Added a workflow step that checks `TAURI_SIGNING_PRIVATE_KEY` is non-empty at job scope and prints its length + SHA1 fingerprint (not the value). Expected fingerprint is `016d72f781f6474871be159effd2ddebac1c7310` (length 348). If the CI job reports a different length or fingerprint, the GitHub secret needs to be re-pasted.

## [0.4.5] - 2026-04-13

### Added
- **In-process attach path.** Splitting a pane now preserves the original terminal even when the daemon isn't running. `PtyManager` now stores each session's `SessionCallbacks` behind an `Arc<Mutex<...>>` so `PtyManager::attach` can swap the downstream sinks without disturbing the running PTY or its reader thread. `attach_terminal` tries the daemon first and falls through to the in-process manager, mirroring the rest of the terminal command routing.

### Changed
- `PtyManager::read_loop` now locks the callbacks handle per read burst and dispatches OSC + output through the current sinks — so the live set of callbacks is always applied, and a pane remount sees continuity without races. (Shell exits still fire `on_exit` under the same lock.)
- `PtyManager::close` now also drops the entry from the callbacks map.

### Fixed / closed
- Closes the in-process limitation flagged in 0.4.4's "Known limitation" — splits preserve terminal state in both daemon and in-process modes.

## [0.4.4] - 2026-04-13

### Fixed
- **Critical: splitting a pane no longer wipes the original terminal.** When the user split left/right/up/down, the React tree shape changed from `{ terminal }` to `{ split, first, second }`, which unmounted and remounted the original `TerminalView` in a new position. That mount called `createTerminal`, spawning a fresh shell and losing all session state — Claude sessions, scrollback, running processes all gone. `SplitContainer` now synthesizes a `restore` hint from the existing `node.terminalId` on mount, so the remount re-attaches to the live daemon session via `attachTerminal` and the scrollback is replayed. The PTY on the daemon side was never actually killed — the bug was purely on the UI reattach path.

### Known limitation
- In-process fallback mode (daemon unavailable) still loses terminal state on split because `attach_terminal` is daemon-only. If the daemon spawns correctly, splits are now preserved. A future release will add an in-process attach path.

## [0.4.3] - 2026-04-13

### Fixed
- CI: `#[allow(clippy::type_complexity)]` on `SessionCallbacks` (`pty/manager.rs`) and `SessionSinks` (`daemon_client/mod.rs`) — clippy started flagging `Box<dyn Fn(...) + Send + Sync>` callback fields as too complex and `cargo clippy -- -D warnings` was blocking the release pipeline. No runtime change.

## [0.4.2] - 2026-04-13

### Fixed
- **Hotfix: app launched with a grey "(Not Responding)" window and hung for ~10s.** The Tauri `setup` hook was synchronously calling `DaemonClient::connect_or_spawn`, which can block the main thread for up to ~18 seconds (retries + 15 s ping timeout) on cold starts — Windows flagged the window as not responding within 5 s. Daemon connect is now spawned in a background thread so setup returns immediately and the webview renders right away. Commands issued before the daemon finishes initialising transparently fall back to the in-process `PtyManager`; subsequent commands use the daemon once it's ready.

## [0.4.1] - 2026-04-13

### Added
- **Daemon idle-timeout.** `winmux-daemon.exe` now exits automatically after 30 minutes with zero live sessions (override via `WINMUX_DAEMON_IDLE_TIMEOUT_SECS=0` to disable, or any positive integer in seconds). Idle clock starts at boot, resets on every session create, restarts when the last session closes (including shells that exit on their own — the session is now auto-pruned from `PtyManager`).
- **"Quit" paths shut the daemon down too.** Tray menu `Quit WinMux (ends all terminals)` and the first-close modal's `Quit completely` button now send `daemon.shutdown` before exiting the UI. Clicking X → "Keep running" still leaves the daemon alive.
- **Daemon-disconnect banner.** If the `winmux-daemon` pipe closes while the UI is running (daemon crashed, killed, or idle-timed-out with the UI still open), a red toast appears bottom-left: "Terminal daemon disconnected ... Restart WinMux". Restart calls `@tauri-apps/plugin-process` `relaunch()`.

### Fixed / Infrastructure
- `DaemonClient` reader thread now emits a `daemon-disconnected` Tauri event when the pipe closes.
- `DaemonHandle` moved to `Mutex<Option<...>>` interior mutability so the daemon client can be installed from inside the `setup` hook (which now has the real `AppHandle`).
- Session cleanup on shell-exit: daemon's `on_exit` callback prunes the session from `PtyManager` so the idle tracker can't be fooled by zombie entries.
- Attempted MSI installer restoration — diagnosed as WiX `ICE30` (duplicate component from `externalBin` + Cargo `[[bin]]` both registering `winmux-daemon.exe`). Dropping `externalBin` resolved the WiX error, but the MSI bundler then consistently fails with `os error 32` (file lock on `winmux.exe`) on Windows Defender-protected machines. NSIS remains the sole target; MSI stays deferred until the upstream file-lock race is fixed (or we add a WiX `fragmentPaths` workaround in a future release).

### Dev notes
- `scripts/prepare-daemon-sidecar.mjs` is no longer wired into the build (externalBin dropped) but kept in-tree for future WiX fragment work.

## [0.4.0] - 2026-04-13

### Added
- **True terminal persistence via a separate daemon process.** A new `winmux-daemon.exe` binary ships alongside the UI. On first UI launch the app tries to connect to the daemon on `\\.\pipe\winmux-daemon`; if it's not running, the UI spawns it detached. The daemon owns all PTYs — **closing or force-quitting the UI no longer ends your terminals or anything running inside them (Claude, dev servers, ssh sessions, etc.)**. Launching WinMux again re-attaches the UI to the exact same live shells with their scrollback intact.
- New Tauri command `attach_terminal(session_id)` — used on session restore. Rejects with `daemon_unavailable` / `not_found` so the UI can gracefully fall through to Tier 2b visual replay when the daemon isn't running or the session has died.
- Saved sessions now record the daemon session ID per pane (`PaneData::Terminal.session_id`, `PaneNodeData.sessionId`). Forward-compatible — older sessions without the field still load.

### Changed
- `TerminalView` mount flow is now attach-first: if `restore.sessionId` is present, it calls `attachTerminal` and replays the daemon's authoritative scrollback under a dim `── Reattached ──` marker. On failure it falls through to the existing Tier 2b fresh-shell + visual replay path under `── Previous session · <time> ──`.
- All terminal commands (`create_terminal`, `write_terminal`, `resize_terminal`, `close_terminal`, `get_cwd`, `get_scrollback`, `get_terminal_shell`) now route through the daemon when it's available, and fall back to the in-process `PtyManager` otherwise.

### Infrastructure
- New `src-tauri/src/daemon_client` module: blocking-sync named-pipe client with a dedicated reader thread that dispatches JSON-RPC responses by `id` and routes `session.output`/`exit`/`osc` push notifications to per-session sinks.
- The daemon is spawned with `CREATE_NO_WINDOW | DETACHED_PROCESS` on Windows and released from the UI process group.

### Known gaps (planned for 0.4.1+)
- No idle-timeout on the daemon — it keeps running until explicitly terminated. A "Quit daemon too" tray option is planned.
- Daemon crash mid-session isn't reported to the UI yet; next launch will cleanly fall back to Tier 2b.
- MSI installer target dropped in favor of NSIS only — WiX light.exe was failing on the daemon sidecar; the NSIS installer builds cleanly and is the Tauri updater's preferred target anyway.

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
