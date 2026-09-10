fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "desktop_state",
            "desktop_autostart",
            "desktop_choose_legacy",
            "desktop_pick_directory",
            "desktop_logs",
            "desktop_start",
            "desktop_update_status",
            "desktop_server_restart",
            "desktop_update_check",
            "desktop_update_install",
        ]),
    ))
    .expect("Desktop command permissions could not be generated");
}
