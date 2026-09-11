fn main() {
    tauri_build::build();

    // `tauri_build` embeds the Windows resource (which contains the
    // Common-Controls v6 side-by-side manifest) into binaries, but not into
    // test harnesses. Without the manifest the loader binds comctl32 v5 and
    // `cargo test` dies at load time with STATUS_ENTRYPOINT_NOT_FOUND because
    // tao/muda import TaskDialogIndirect. Link the same resource into tests.
    #[cfg(windows)]
    {
        if let Ok(out_dir) = std::env::var("OUT_DIR") {
            let resource = std::path::Path::new(&out_dir).join("resource.lib");
            if resource.exists() {
                println!("cargo:rustc-link-arg-tests={}", resource.display());
            }
        }
    }
}
