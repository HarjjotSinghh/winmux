// Make sure `src-tauri/binaries/winmux-daemon-<TRIPLE>.exe` exists so the
// Tauri bundler's externalBin validation is happy.
//
// If the real daemon binary has been built (src-tauri/target/release/winmux-daemon.exe),
// copy it into place. Otherwise create a zero-byte stub so tauri-build doesn't
// trip on its pre-compile sanity check — the real binary will overwrite the
// stub once `cargo build --bin winmux-daemon` finishes.
//
// Called twice from tauri.conf.json's beforeBuildCommand:
//   1. before the daemon is built → writes stub
//   2. after the daemon is built  → copies the real binary

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const TARGET_TRIPLE = process.env.WINMUX_TARGET_TRIPLE || "x86_64-pc-windows-msvc";
const src = path.join(repoRoot, "src-tauri", "target", "release", "winmux-daemon.exe");
const binariesDir = path.join(repoRoot, "src-tauri", "binaries");
const dst = path.join(binariesDir, `winmux-daemon-${TARGET_TRIPLE}.exe`);

fs.mkdirSync(binariesDir, { recursive: true });

if (fs.existsSync(src)) {
  fs.copyFileSync(src, dst);
  const size = (fs.statSync(dst).size / 1024 / 1024).toFixed(1);
  console.log(`[prepare-daemon-sidecar] copied real daemon (${size} MB) -> ${path.relative(repoRoot, dst)}`);
} else {
  fs.writeFileSync(dst, Buffer.alloc(0));
  console.log(`[prepare-daemon-sidecar] stub created at ${path.relative(repoRoot, dst)} (daemon not yet built)`);
}
