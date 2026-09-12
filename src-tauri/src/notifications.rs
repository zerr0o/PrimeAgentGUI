use serde::{Deserialize, Serialize};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{Manager, WebviewWindow};
use tauri_plugin_notification::NotificationExt;

#[derive(Clone, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Preferences {
    questions: bool,
    turn_complete: bool,
    language: String,
}
impl Default for Preferences {
    fn default() -> Self {
        Self {
            questions: true,
            turn_complete: true,
            language: if sys_locale::get_locale()
                .unwrap_or_default()
                .starts_with("fr")
            {
                "fr".into()
            } else {
                "en".into()
            },
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Patch {
    questions: Option<bool>,
    turn_complete: Option<bool>,
    language: Option<String>,
}

#[tauri::command]
pub fn desktop_notification_preferences(
    window: WebviewWindow,
    app: tauri::AppHandle,
    patch: Option<Patch>,
) -> Result<Preferences, String> {
    super::update_window_only(&window, &app)?;
    let state = app.state::<super::Desktop>();
    let mut prefs = state.prefs.lock().map_err(|e| e.to_string())?;
    if let Some(patch) = patch {
        let mut next = prefs.clone();
        if let Some(value) = patch.questions {
            next.notifications.questions = value;
        }
        if let Some(value) = patch.turn_complete {
            next.notifications.turn_complete = value;
        }
        if let Some(value) = patch.language {
            if value != "fr" && value != "en" {
                return Err("Invalid notification language".into());
            }
            next.notifications.language = value;
        }
        super::save_preferences(&state, &next)?;
        *prefs = next;
    }
    Ok(prefs.notifications.clone())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Event {
    sequence: u64,
    kind: String,
    project: String,
    status: String,
    created_at: u64,
}
#[derive(Deserialize)]
struct Snapshot {
    instance: String,
    sequence: u64,
    events: Vec<Event>,
}

fn focused(app: &tauri::AppHandle) -> bool {
    // Include the launcher/settings window, not only the conversation WebView.
    // An unreadable focus state suppresses the notification conservatively.
    app.webview_windows()
        .values()
        .any(|window| window.is_focused().unwrap_or(true))
}

pub fn start(app: tauri::AppHandle, port: u16) {
    tauri::async_runtime::spawn(async move {
        let Ok(client) = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(3))
            .build()
        else {
            return;
        };
        let mut instance = String::new();
        let mut cursor = 0;
        loop {
            let result = async {
                let mut response = client
                    .get(format!(
                        "http://127.0.0.1:{port}/api/desktop-notifications?after={cursor}"
                    ))
                    .send()
                    .await?
                    .error_for_status()?;
                let mut bytes = Vec::new();
                while let Some(chunk) = response.chunk().await? {
                    if bytes.len() + chunk.len() > 512 * 1024 {
                        return Ok(None);
                    }
                    bytes.extend_from_slice(&chunk);
                }
                Ok::<_, reqwest::Error>(serde_json::from_slice::<Snapshot>(&bytes).ok())
            }
            .await;
            if let Ok(Some(snapshot)) = result {
                if snapshot.instance != instance {
                    // Starting the app or restarting its server does not replay old alerts.
                    instance = snapshot.instance;
                } else {
                    for event in snapshot.events {
                        if event.sequence <= cursor {
                            continue;
                        }
                        let now = SystemTime::now()
                            .duration_since(UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_millis() as u64;
                        if now.saturating_sub(event.created_at) > 30_000 {
                            continue;
                        }
                        let prefs = app
                            .state::<super::Desktop>()
                            .prefs
                            .lock()
                            .ok()
                            .map(|prefs| prefs.notifications.clone());
                        let Some(prefs) = prefs else {
                            continue;
                        };
                        let enabled = match event.kind.as_str() {
                            "question" => prefs.questions,
                            "turnComplete" => prefs.turn_complete,
                            _ => false,
                        };
                        if !enabled || focused(&app) {
                            continue;
                        }
                        let french = prefs.language == "fr";
                        let title = match (event.kind.as_str(), event.status.as_str(), french) {
                            ("question", _, true) => "Une question attend votre réponse",
                            ("question", _, false) => "A question needs your answer",
                            (_, "failed", true) => "L’agent a rencontré une erreur",
                            (_, "failed", false) => "The agent encountered an error",
                            (_, _, true) => "L’agent a terminé son tour",
                            (_, _, false) => "The agent has finished its turn",
                        };
                        if let Err(error) = app
                            .notification()
                            .builder()
                            .title(title)
                            .body(event.project.chars().take(100).collect::<String>())
                            .sound("Default")
                            .show()
                        {
                            let _ = std::fs::write(
                                app.state::<super::Desktop>()
                                    .root
                                    .join("desktop-notification-error.log"),
                                error.to_string(),
                            );
                        }
                    }
                }
                // Consume muted and focused events as well as displayed ones.
                cursor = snapshot.sequence;
            }
            tokio::time::sleep(Duration::from_secs(2)).await;
        }
    });
}
