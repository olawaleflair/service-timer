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
    let monitors = app.available_monitors().map_err(|error| error.to_string())?;
    let selected_monitor = find_monitor_from_list(&monitors, &display_id);
    let target_monitor = selected_monitor
        .filter(|monitor| !is_primary_monitor(&app, monitor) || monitors.len() <= 1)
        .or_else(|| preferred_stage_monitor(&app, &monitors));
    let (x, y, width, height, target_name) = target_monitor
        .as_ref()
        .map(|monitor| {
            let position = monitor.position();
            let size = monitor.size();
            let name = monitor.name().map(ToOwned::to_owned).unwrap_or_else(|| "selected display".to_string());
            (position.x, position.y, size.width, size.height, name)
        })
        .unwrap_or((80, 80, 960, 540, "main display".to_string()));

    let (window, created_window) = if let Some(existing) = app.get_webview_window("stage") {
        (existing, false)
    } else {
        let window = WebviewWindowBuilder::new(&app, "stage", WebviewUrl::App("index.html?stage=1".into()))
            .title("Stage Display")
            .decorations(false)
            .resizable(false)
            .position(x as f64, y as f64)
            .inner_size(width as f64, height as f64)
            .visible(false)
            .build()
            .map_err(|error| error.to_string())?;
        (window, true)
    };

    if created_window {
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
    }

    window.set_fullscreen(false).ok();
    window.set_decorations(false).ok();
    window.set_resizable(false).ok();
    window
        .set_position(PhysicalPosition::new(x, y))
        .map_err(|error| error.to_string())?;
    window
        .set_size(PhysicalSize::new(width, height))
        .map_err(|error| error.to_string())?;
    window.set_always_on_top(true).ok();
    window.set_fullscreen(true).map_err(|error| error.to_string())?;
    window.unminimize().ok();
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().ok();
    app.emit_to(
        "main",
        "stage-status",
        StageWindowStatus {
            opened: true,
            connected: true,
            message: if monitors.len() <= 1 {
                "Windows is only detecting one display. Stage display opened on this screen.".to_string()
            } else {
                format!("Stage display opened on {target_name} at {x},{y}.")
            },
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

fn preferred_stage_monitor(app: &AppHandle, monitors: &[Monitor]) -> Option<Monitor> {
    monitors
        .iter()
        .find(|monitor| !is_primary_monitor(app, monitor))
        .cloned()
        .or_else(|| app.primary_monitor().ok().flatten())
        .or_else(|| monitors.first().cloned())
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
        .setup(|app| {
            let main = match app.get_webview_window("main") {
                Some(window) => window,
                None => WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                    .title("Service Timer")
                    .inner_size(1280.0, 820.0)
                    .min_inner_size(1040.0, 720.0)
                    .resizable(true)
                    .visible(true)
                    .build()?,
            };

            main.show()?;
            main.set_focus()?;

            {
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
            if app.available_monitors().map(|monitors| monitors.len()).unwrap_or(0) > 1 {
                let _ = open_stage_display(app.handle().clone(), "auto-second-screen".to_string(), true);
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
