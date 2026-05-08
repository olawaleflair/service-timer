use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder,
    WindowEvent,
};
use tauri::window::Monitor;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DisplayInfo {
    id: String,
    name: String,
    is_primary: bool,
    width: u32,
    height: u32,
    scale_factor: f64,
    connected: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StagePayload {
    mode: String,
    section_name: String,
    timer_text: String,
    tone: String,
}

#[derive(Default)]
struct StageState(Mutex<Option<StagePayload>>);

#[derive(Default)]
struct CloseGuardState(Mutex<bool>);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct StageWindowStatus {
    opened: bool,
    connected: bool,
    message: String,
}

#[tauri::command]
fn list_displays(app: AppHandle) -> Result<Vec<DisplayInfo>, String> {
    let monitors = app.available_monitors().map_err(|error| error.to_string())?;
    let primary = app.primary_monitor().map_err(|error| error.to_string())?;
    let primary_position = primary.as_ref().map(|monitor| monitor.position().to_owned());

    Ok(monitors
        .into_iter()
        .enumerate()
        .map(|(index, monitor)| {
            let position = monitor.position();
            let size = monitor.size();
            let name = monitor
                .name()
                .map(ToOwned::to_owned)
                .unwrap_or_else(|| format!("Display {}", index + 1));
            let id = display_id(index, &name, position.x, position.y);
            DisplayInfo {
                id,
                name,
                is_primary: primary_position
                    .as_ref()
                    .map(|primary| primary.x == position.x && primary.y == position.y)
                    .unwrap_or(index == 0),
                width: size.width,
                height: size.height,
                scale_factor: monitor.scale_factor(),
                connected: true,
            }
        })
        .collect())
}

#[tauri::command]
fn open_stage_display(app: AppHandle, display_id: String, test_mode: bool) -> Result<(), String> {
    let window = match app.get_webview_window("stage") {
        Some(window) => window,
        None => {
            let window =
                WebviewWindowBuilder::new(&app, "stage", WebviewUrl::App("index.html?stage=1".into()))
                    .title("Stage Display")
                    .decorations(false)
                    .resizable(true)
                    .visible(false)
                    .build()
                    .map_err(|error| error.to_string())?;
            let app_for_events = app.clone();
            window.on_window_event(move |event| {
                if matches!(event, WindowEvent::Destroyed) {
                    let _ = app_for_events.emit_to(
                        "main",
                        "stage-status",
                        StageWindowStatus {
                            opened: false,
                            connected: false,
                            message: "Stage display closed.".to_string(),
                        },
                    );
                }
            });
            window
        }
    };

    let monitors = app.available_monitors().map_err(|error| error.to_string())?;
    let target_monitor = find_monitor_from_list(&monitors, &display_id).or_else(|| {
        app.primary_monitor()
            .ok()
            .flatten()
            .or_else(|| monitors.first().cloned())
    });
    let use_fullscreen = monitors.len() > 1 && target_monitor.as_ref().map(|monitor| !is_primary_monitor(&app, monitor)).unwrap_or(false);

    if let Some(monitor) = target_monitor {
        let position = monitor.position();
        let size = monitor.size();
        if use_fullscreen {
            window
                .set_position(PhysicalPosition::new(position.x, position.y))
                .map_err(|error| error.to_string())?;
            window
                .set_size(PhysicalSize::new(size.width, size.height))
                .map_err(|error| error.to_string())?;
        } else {
            let width = (size.width / 2).max(720).min(size.width);
            let height = (size.height / 2).max(420).min(size.height);
            let x = position.x + 80;
            let y = position.y + 80;
            window
                .set_position(PhysicalPosition::new(x, y))
                .map_err(|error| error.to_string())?;
            window
                .set_size(PhysicalSize::new(width, height))
                .map_err(|error| error.to_string())?;
        }
    }

    window.show().map_err(|error| error.to_string())?;
    window.set_decorations(!use_fullscreen).ok();
    window.set_fullscreen(use_fullscreen).map_err(|error| error.to_string())?;
    app.emit_to(
        "main",
        "stage-status",
        StageWindowStatus {
            opened: true,
            connected: true,
            message: "Stage display ready.".to_string(),
        },
    )
    .ok();

    if test_mode {
        let payload = StagePayload {
            mode: "test".to_string(),
            section_name: "Timer display connected".to_string(),
            timer_text: String::new(),
            tone: "normal".to_string(),
        };
        set_stage_payload(app, payload)?;
    }

    Ok(())
}

#[tauri::command]
fn set_stage_payload(app: AppHandle, payload: StagePayload) -> Result<(), String> {
    let state = app.state::<StageState>();
    *state.0.lock().map_err(|_| "Stage state lock failed.")? = Some(payload.clone());
    app.emit_to("stage", "stage-payload", payload)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn get_stage_payload(app: AppHandle) -> Result<Option<StagePayload>, String> {
    let state = app.state::<StageState>();
    let payload = state
        .0
        .lock()
        .map_err(|_| "Stage state lock failed.")?
        .clone();
    Ok(payload)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateCheck {
    available: bool,
    message: String,
}

#[tauri::command]
fn check_for_update() -> UpdateCheck {
    UpdateCheck {
        available: false,
        message: "Update endpoint is not configured yet.".to_string(),
    }
}

#[tauri::command]
fn close_application(app: AppHandle) {
    exit_application(&app);
}

fn exit_application(app: &AppHandle) {
    if let Ok(mut guarded) = app.state::<CloseGuardState>().0.lock() {
        *guarded = false;
    }
    if let Some(stage) = app.get_webview_window("stage") {
        let _ = stage.close();
    }
    app.exit(0);
}

#[tauri::command]
fn set_main_close_guard(app: AppHandle, guarded: bool) -> Result<(), String> {
    let state = app.state::<CloseGuardState>();
    *state
        .0
        .lock()
        .map_err(|_| "Close guard state lock failed.")? = guarded;
    Ok(())
}

fn find_monitor_from_list(monitors: &[Monitor], selected_id: &str) -> Option<Monitor> {
    for (index, monitor) in monitors.iter().enumerate() {
        let name = monitor
            .name()
            .map(ToOwned::to_owned)
            .unwrap_or_else(|| format!("Display {}", index + 1));
        let position = monitor.position();
        if display_id(index, &name, position.x, position.y) == selected_id {
            return Some(monitor.clone());
        }
    }
    None
}

fn is_primary_monitor(app: &AppHandle, monitor: &Monitor) -> bool {
    app.primary_monitor()
        .ok()
        .flatten()
        .map(|primary| {
            primary.position().x == monitor.position().x
                && primary.position().y == monitor.position().y
        })
        .unwrap_or(false)
}

fn display_id(index: usize, name: &str, x: i32, y: i32) -> String {
    format!("display:{index}:{name}:{x}:{y}")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(StageState::default())
        .manage(CloseGuardState::default())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .setup(|app| {
            if let Some(main) = app.get_webview_window("main") {
                let app_for_events = app.handle().clone();
                main.on_window_event(move |event| {
                    match event {
                        WindowEvent::CloseRequested { api, .. } => {
                            let should_guard = app_for_events
                                .state::<CloseGuardState>()
                                .0
                                .lock()
                                .map(|guarded| *guarded)
                                .unwrap_or(false);
                            api.prevent_close();
                            if should_guard {
                                let _ = app_for_events.emit_to("main", "main-close-requested", ());
                            } else {
                                exit_application(&app_for_events);
                            }
                        }
                        WindowEvent::Destroyed => {
                            if let Some(stage) = app_for_events.get_webview_window("stage") {
                                let _ = stage.close();
                            }
                        }
                        _ => {}
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_displays,
            open_stage_display,
            set_stage_payload,
            get_stage_payload,
            check_for_update,
            close_application,
            set_main_close_guard
        ])
        .run(tauri::generate_context!())
        .expect("error while running Service Timer");
}
