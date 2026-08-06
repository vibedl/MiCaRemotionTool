mod studio_launcher;

use studio_launcher::{StudioLauncher, StudioStatus};
use tauri::{Manager, RunEvent, State};

#[tauri::command]
fn get_studio_status(_launcher: State<'_, StudioLauncher>) -> StudioStatus {
    StudioStatus {
        running: true,
        message: "Studio bereit".into(),
        port: 4300,
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(StudioLauncher::new())
        .setup(|app| {
            let resource_dir = app.path().resource_dir().ok();
            let status = app.state::<StudioLauncher>().ensure_started(resource_dir);
            if let Some(window) = app.get_webview_window("main") {
                let title = if status.running {
                    "Room Flythrough Studio".to_string()
                } else {
                    format!("Room Flythrough Studio — {}", status.message)
                };
                let _ = window.set_title(&title);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_studio_status])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if matches!(event, RunEvent::Exit) {
                if let Some(launcher) = app_handle.try_state::<StudioLauncher>() {
                    launcher.shutdown();
                }
            }
        });
}

fn main() {
    run();
}
