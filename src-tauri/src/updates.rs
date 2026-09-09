use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    time::Duration,
};
use tauri::{ipc::Channel, AppHandle, Manager, WebviewWindow};
use tauri_plugin_updater::{Update, UpdaterExt};

#[derive(Default)]
pub struct Updates {
    busy: AtomicBool,
    pending: Mutex<Option<Update>>,
}
impl Updates {
    pub fn is_busy(&self) -> bool {
        self.busy.load(Ordering::SeqCst)
    }
}
struct Operation<'a>(&'a AtomicBool);
impl Drop for Operation<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}
fn begin(state: &Updates) -> Result<Operation<'_>, String> {
    if state.busy.swap(true, Ordering::SeqCst) {
        return Err("update_busy".into());
    }
    Ok(Operation(&state.busy))
}
fn failure(app: &AppHandle, error: impl std::fmt::Display, code: &str) -> String {
    let root = &app.state::<super::Desktop>().root;
    let _ = std::fs::create_dir_all(root);
    let _ = std::fs::write(root.join("desktop-update-error.log"), error.to_string());
    code.into()
}

#[tauri::command]
pub async fn desktop_update_check(
    window: WebviewWindow,
    app: AppHandle,
) -> Result<serde_json::Value, String> {
    super::update_window_only(&window, &app)?;
    let state = app.state::<Updates>();
    let _operation = begin(&state)?;
    *state.pending.lock().map_err(|_| "update_failed")? = None;
    let updater = app
        .updater_builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|e| failure(&app, e, "check_failed"))?;
    // Bound only the metadata request. The download may take longer on a slow connection.
    let update = tokio::time::timeout(Duration::from_secs(20), updater.check())
        .await
        .map_err(|e| failure(&app, e, "check_failed"))?
        .map_err(|e| failure(&app, e, "check_failed"))?;
    let response = match &update {
        Some(update) => {
            serde_json::json!({"available":true,"version":update.version,"notes":update.body})
        }
        None => serde_json::json!({"available":false}),
    };
    *state.pending.lock().map_err(|_| "update_failed")? = update;
    Ok(response)
}

#[tauri::command]
pub async fn desktop_update_install(
    window: WebviewWindow,
    app: AppHandle,
    version: String,
    restart_server: Option<bool>,
    on_event: Channel<serde_json::Value>,
) -> Result<(), String> {
    super::update_window_only(&window, &app)?;
    if app
        .state::<super::Desktop>()
        .starting
        .load(Ordering::SeqCst)
    {
        return Err("update_busy".into());
    }
    let state = app.state::<Updates>();
    let _operation = begin(&state)?;
    let update = state
        .pending
        .lock()
        .map_err(|_| "update_failed")?
        .clone()
        .ok_or("check_required")?;
    if update.version != version {
        return Err("check_required".into());
    }
    let mut downloaded = 0_u64;
    let mut last_percent = None;
    let bytes = update
        .download(
            |chunk, total| {
                downloaded += chunk as u64;
                let percent = total
                    .filter(|total| *total > 0)
                    .map(|total| (downloaded * 100 / total).min(100));
                if percent != last_percent || last_percent.is_none() {
                    let _ =
                        on_event.send(serde_json::json!({"stage":"downloading","percent":percent}));
                    last_percent = percent;
                }
            },
            || {
                let _ = on_event.send(serde_json::json!({"stage":"verifying"}));
            },
        )
        .await
        .map_err(|e| failure(&app, e, "download_failed"))?;
    // Download verifies the signature. The newly installed app handles an idle
    // server restart; it never carries permission to interrupt agents across updates.
    let restart_path = app
        .state::<super::Desktop>()
        .root
        .join("restart-after-update.json");
    if restart_server.unwrap_or(false) {
        std::fs::write(
            &restart_path,
            serde_json::json!({"version":version}).to_string(),
        )
        .map_err(|e| failure(&app, e, "install_failed"))?;
    } else {
        let _ = std::fs::remove_file(&restart_path);
    }
    let _ = on_event.send(serde_json::json!({"stage":"installing"}));
    update.install(bytes).map_err(|e| {
        let _ = std::fs::remove_file(&restart_path);
        failure(&app, e, "install_failed")
    })?;
    Ok(())
}
