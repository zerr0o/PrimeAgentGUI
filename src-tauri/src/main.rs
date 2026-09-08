#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(test)]
mod update_tests;
mod updates;

use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::PathBuf,
    process::Command,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_opener::OpenerExt;

#[derive(Default, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Preferences {
    started: bool,
    legacy_root: Option<String>,
}
struct Desktop {
    root: PathBuf,
    resources: PathBuf,
    port: u16,
    prefs: Mutex<Preferences>,
    starting: AtomicBool,
}

fn native_only(window: &WebviewWindow) -> Result<(), String> {
    let url = window.url().map_err(|e| e.to_string())?;
    if is_launcher_url(&url) {
        Ok(())
    } else {
        Err("This action is reserved for the desktop launcher.".into())
    }
}
fn is_launcher_url(url: &tauri::Url) -> bool {
    url.port().is_none()
        && url.username().is_empty()
        && url.password().is_none()
        && ((url.scheme() == "tauri" && url.host_str() == Some("localhost"))
            || (["http", "https"].contains(&url.scheme())
                && url.host_str() == Some("tauri.localhost")))
}
fn show_main(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}
fn show_settings(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("desktop-settings") {
        let _ = window.show();
        let _ = window.set_focus();
    } else {
        let _ = WebviewWindowBuilder::new(
            app,
            "desktop-settings",
            WebviewUrl::App("index.html?settings".into()),
        )
        .data_directory(app.state::<Desktop>().root.join("webview"))
        .title("Prime Agent Studio · Application")
        .inner_size(660.0, 760.0)
        .min_inner_size(560.0, 600.0)
        .build();
    }
}
fn save_preferences(state: &Desktop, prefs: &Preferences) -> Result<(), String> {
    fs::create_dir_all(&state.root).map_err(|e| e.to_string())?;
    let temp = state.root.join("desktop.json.tmp");
    fs::write(
        &temp,
        serde_json::to_vec_pretty(prefs).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    fs::rename(temp, state.root.join("desktop.json")).map_err(|e| e.to_string())
}
#[tauri::command]
fn desktop_state(
    window: WebviewWindow,
    app: tauri::AppHandle,
    state: tauri::State<Desktop>,
) -> Result<serde_json::Value, String> {
    native_only(&window)?;
    let prefs = state.prefs.lock().map_err(|e| e.to_string())?.clone();
    Ok(
        serde_json::json!({"version":app.package_info().version.to_string(),"started":prefs.started,"legacyRoot":prefs.legacy_root,"imported":state.root.join("data").exists(),"autostart":app.autolaunch().is_enabled().map_err(|e| e.to_string())?}),
    )
}
#[tauri::command]
fn desktop_autostart(
    window: WebviewWindow,
    app: tauri::AppHandle,
    enabled: bool,
) -> Result<(), String> {
    native_only(&window)?;
    if enabled {
        app.autolaunch().enable()
    } else {
        app.autolaunch().disable()
    }
    .map_err(|e| e.to_string())
}
#[tauri::command]
async fn desktop_choose_legacy(
    window: WebviewWindow,
    app: tauri::AppHandle,
) -> Result<Option<String>, String> {
    native_only(&window)?;
    let chosen = tauri::async_runtime::spawn_blocking(|| {
        rfd::FileDialog::new()
            .set_title("Installation existante de Prime Agent Studio")
            .pick_folder()
    })
    .await
    .map_err(|e| e.to_string())?;
    let Some(folder) = chosen else {
        return Ok(None);
    };
    if !folder.join("server.mjs").is_file() || !folder.join(".local/workspace.json").is_file() {
        return Err("Choisissez le dossier de l’ancienne installation du Studio. / Select the previous Studio installation folder.".into());
    }
    let state = app.state::<Desktop>();
    if state.root.join("data").exists() || state.starting.load(Ordering::SeqCst) {
        return Err(
            "Les données sont déjà initialisées. / Data has already been initialized.".into(),
        );
    }
    let path = folder.to_string_lossy().to_string();
    let mut prefs = state.prefs.lock().map_err(|e| e.to_string())?;
    prefs.legacy_root = Some(path.clone());
    save_preferences(&state, &prefs)?;
    Ok(Some(path))
}
#[tauri::command]
fn desktop_logs(
    window: WebviewWindow,
    app: tauri::AppHandle,
    state: tauri::State<Desktop>,
) -> Result<(), String> {
    native_only(&window)?;
    fs::create_dir_all(&state.root).map_err(|e| e.to_string())?;
    app.opener()
        .open_path(state.root.to_string_lossy(), None::<&str>)
        .map_err(|e| e.to_string())
}
#[tauri::command]
async fn desktop_start(
    window: WebviewWindow,
    app: tauri::AppHandle,
) -> Result<serde_json::Value, String> {
    native_only(&window)?;
    let state = app.state::<Desktop>();
    if state.starting.swap(true, Ordering::SeqCst) {
        return Err("Le démarrage est déjà en cours. / Startup is already in progress.".into());
    }
    let root = state.root.clone();
    let resources = state.resources.clone();
    let port = state.port;
    let legacy = state
        .prefs
        .lock()
        .map_err(|e| e.to_string())?
        .legacy_root
        .clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let mut command = Command::new(resources.join("node.exe"));
        command.arg(resources.join("studio/scripts/desktop-start.mjs"))
            .arg(serde_json::json!({"resourceDir":resources,"dataRoot":root,"port":port,"legacyRoot":legacy}).to_string())
            .current_dir(&resources);
        #[cfg(windows)] { use std::os::windows::process::CommandExt; command.creation_flags(0x08000000); }
        let output = command.output().map_err(|e| format!("Impossible de lancer le Studio. / Could not start Studio: {e}"))?;
        if !output.status.success() { return Err(String::from_utf8_lossy(&output.stderr).chars().take(3000).collect::<String>()) }
        serde_json::from_slice::<serde_json::Value>(&output.stdout).map_err(|e| e.to_string())
    }).await.map_err(|e|e.to_string()).and_then(|r|r);
    state.starting.store(false, Ordering::SeqCst);
    match result {
        Ok(result) => {
            let mut prefs = state.prefs.lock().map_err(|e| e.to_string())?;
            prefs.started = true;
            save_preferences(&state, &prefs)?;
            let _ = fs::write(state.root.join("backend.json"), result.to_string());
            if let Some(main) = app.get_webview_window("main") {
                main.navigate(
                    tauri::Url::parse(&format!("http://127.0.0.1:{}/", state.port))
                        .map_err(|e| e.to_string())?,
                )
                .map_err(|e| e.to_string())?;
                if window.label() == "desktop-settings" {
                    show_main(&app);
                }
            }
            Ok(result)
        }
        Err(error) => {
            let _ = fs::create_dir_all(&state.root);
            let _ = fs::write(state.root.join("desktop-error.log"), &error);
            show_main(&app);
            Err(error)
        }
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _| {
            if args.iter().any(|arg| arg == "--settings") {
                show_settings(app);
            } else if !args.iter().any(|arg| arg == "--background") {
                show_main(app);
            }
        }))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--background"]),
        ))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(updates::Updates::default())
        .invoke_handler(tauri::generate_handler![
            desktop_state,
            desktop_autostart,
            desktop_choose_legacy,
            desktop_logs,
            desktop_start,
            updates::desktop_update_check,
            updates::desktop_update_install
        ])
        .setup(|app| {
            let root = std::env::var_os("PRIME_STUDIO_DESKTOP_DATA_ROOT")
                .map(PathBuf::from)
                .unwrap_or(app.path().app_local_data_dir()?);
            let mut resources = app.path().resource_dir()?.join("backend");
            if cfg!(debug_assertions) && !resources.join("node.exe").is_file() {
                resources = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.desktop-build");
            }
            let port = std::env::var("PRIME_STUDIO_DESKTOP_PORT")
                .ok()
                .map(|p| p.parse::<u16>())
                .transpose()?
                .unwrap_or(3088);
            if port == 0 {
                return Err("Invalid Studio port".into());
            }
            let prefs = fs::read(root.join("desktop.json"))
                .ok()
                .and_then(|bytes| serde_json::from_slice(&bytes).ok())
                .unwrap_or_default();
            let webview_data = root.join("webview");
            app.manage(Desktop {
                root,
                resources,
                port,
                prefs: Mutex::new(prefs),
                starting: AtomicBool::new(false),
            });
            let handle = app.handle().clone();
            let origin = format!("http://127.0.0.1:{port}");
            let navigation_app = handle.clone();
            let links_app = handle.clone();
            let background = std::env::args().any(|arg| arg == "--background");
            WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::App(
                    if background {
                        "index.html?background"
                    } else {
                        "index.html"
                    }
                    .into(),
                ),
            )
            .title("Prime Agent Studio")
            .inner_size(1280.0, 860.0)
            .min_inner_size(860.0, 620.0)
            .visible(!background)
            .data_directory(webview_data)
            .initialization_script(
                "Object.defineProperty(window, '__PRIME_STUDIO_DESKTOP__', { value: true });",
            )
            .on_new_window(move |url, _| {
                if ["https", "http"].contains(&url.scheme()) {
                    let _ = links_app.opener().open_url(url.as_str(), None::<&str>);
                }
                tauri::webview::NewWindowResponse::Deny
            })
            .on_navigation(move |url| {
                let local = is_launcher_url(url);
                if local || url.origin().ascii_serialization() == origin {
                    return true;
                }
                if ["https", "http"].contains(&url.scheme()) {
                    let _ = navigation_app.opener().open_url(url.as_str(), None::<&str>);
                }
                false
            })
            .build()?;
            let french = sys_locale::get_locale()
                .unwrap_or_else(|| "en".into())
                .to_lowercase()
                .starts_with("fr");
            let open = MenuItem::with_id(
                app,
                "open",
                if french {
                    "Ouvrir le Studio"
                } else {
                    "Open Studio"
                },
                true,
                None::<&str>,
            )?;
            let settings = MenuItem::with_id(
                app,
                "settings",
                if french {
                    "Réglages de l’application"
                } else {
                    "App settings"
                },
                true,
                None::<&str>,
            )?;
            let quit = MenuItem::with_id(
                app,
                "quit",
                if french {
                    "Quitter l’application"
                } else {
                    "Quit application"
                },
                true,
                None::<&str>,
            )?;
            let separator = PredefinedMenuItem::separator(app)?;
            let menu = Menu::with_items(app, &[&open, &settings, &separator, &quit])?;
            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Prime Agent Studio")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(move |app, event| match event.id.as_ref() {
                    "open" => show_main(app),
                    "settings" => show_settings(app),
                    "quit" => app.exit(0),
                    _ => (),
                })
                .on_tray_icon_event(|tray, event| {
                    if matches!(
                        event,
                        TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        }
                    ) {
                        show_main(tray.app_handle());
                    }
                })
                .build(app)?;
            if std::env::args().any(|arg| arg == "--settings") {
                show_settings(app.handle());
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("Prime Agent Studio desktop failed");
}
