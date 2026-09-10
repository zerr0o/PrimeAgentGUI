use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};
use tauri::{AppHandle, Manager, WebviewWindow};

#[derive(Default)]
pub struct DirectoryPicker {
    busy: Arc<AtomicBool>,
}

struct Selection(Arc<AtomicBool>);
impl Drop for Selection {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

fn begin(state: &DirectoryPicker) -> Result<Selection, String> {
    state
        .busy
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .map_err(|_| "picker_busy".to_owned())?;
    Ok(Selection(Arc::clone(&state.busy)))
}

fn allowed_origin(label: &str, url: &tauri::Url, port: u16) -> bool {
    label == "main" && super::is_studio_url(url, port)
}

fn initial_directory(cwd: Option<String>) -> Option<PathBuf> {
    cwd.filter(|path| !path.trim().is_empty())
        .map(PathBuf::from)
        .filter(|path| path.is_dir())
}

fn selected_directory(chosen: Option<PathBuf>) -> Result<Option<String>, String> {
    chosen
        .map(|path| {
            if path.is_dir() {
                Ok(path.to_string_lossy().into_owned())
            } else {
                Err("picker_failed".to_owned())
            }
        })
        .transpose()
}

#[tauri::command]
pub async fn desktop_pick_directory(
    window: WebviewWindow,
    app: AppHandle,
    cwd: Option<String>,
    title: Option<String>,
) -> Result<Option<String>, String> {
    let url = window.url().map_err(|_| "picker_forbidden".to_owned())?;
    if !allowed_origin(window.label(), &url, app.state::<super::Desktop>().port) {
        return Err("picker_forbidden".into());
    }
    let selection = begin(&app.state::<DirectoryPicker>())?;
    tauri::async_runtime::spawn_blocking(move || {
        // Keep the window and lock alive until the actual native dialog closes,
        // even if its invoking page navigates away or drops the pending request.
        let _selection = selection;
        let mut dialog = rfd::FileDialog::new().set_parent(&window);
        if let Some(title) = title.filter(|title| !title.trim().is_empty()) {
            dialog = dialog.set_title(title);
        }
        if let Some(directory) = initial_directory(cwd) {
            dialog = dialog.set_directory(directory);
        }
        selected_directory(dialog.pick_folder())
    })
    .await
    .map_err(|_| "picker_failed".to_owned())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_main_window_at_the_exact_studio_origin_can_pick_a_directory() {
        let studio: tauri::Url = "http://127.0.0.1:3088/?project=test".parse().unwrap();
        assert!(allowed_origin("main", &studio, 3088));
        assert!(!allowed_origin("desktop-settings", &studio, 3088));
        for raw in [
            "tauri://localhost/index.html",
            "http://tauri.localhost/",
            "https://127.0.0.1:3088/",
            "http://127.0.0.1:3089/",
            "http://localhost:3088/",
            "http://127.0.0.1.evil.test:3088/",
            "http://user@127.0.0.1:3088/",
            "https://example.com/",
        ] {
            assert!(
                !allowed_origin("main", &raw.parse().unwrap(), 3088),
                "{raw}"
            );
        }
    }

    #[test]
    fn selection_lock_follows_the_native_worker_and_recovers_after_a_panic() {
        let picker = DirectoryPicker::default();
        let selection = begin(&picker).unwrap();
        let (started, ready) = std::sync::mpsc::channel();
        let (finish, finished) = std::sync::mpsc::channel();
        let worker = std::thread::spawn(move || {
            let _selection = selection;
            started.send(()).unwrap();
            finished.recv().unwrap();
        });
        ready.recv().unwrap();
        assert_eq!(begin(&picker).err().as_deref(), Some("picker_busy"));
        finish.send(()).unwrap();
        worker.join().unwrap();
        assert!(!picker.busy.load(Ordering::SeqCst));

        let panic = std::panic::catch_unwind(|| {
            let _selection = begin(&picker).unwrap();
            panic!("native dialog failed");
        });
        assert!(panic.is_err());
        let _reopened = begin(&picker).unwrap();
    }

    #[test]
    fn cancellation_and_invalid_paths_do_not_leave_the_picker_busy() {
        let picker = DirectoryPicker::default();
        let directory = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let file = directory.join("Cargo.toml");
        assert!(initial_directory(Some(file.to_string_lossy().into_owned())).is_none());
        assert!(initial_directory(Some(" ".into())).is_none());
        assert_eq!(
            initial_directory(Some(directory.to_string_lossy().into_owned())),
            Some(directory.clone())
        );
        for chosen in [None, Some(directory), Some(file)] {
            let result = {
                let _selection = begin(&picker).unwrap();
                selected_directory(chosen.clone())
            };
            match chosen {
                None => assert_eq!(result, Ok(None)),
                Some(path) if path.is_dir() => {
                    assert_eq!(result, Ok(Some(path.to_string_lossy().into_owned())))
                }
                Some(_) => assert_eq!(result, Err("picker_failed".into())),
            }
            assert!(!picker.busy.load(Ordering::SeqCst));
        }
    }
}
