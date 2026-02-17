mod discovery;
mod menu;

use tauri::Manager;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use discovery::{discover_backend, check_connection};
use menu::{create_menu, handle_menu_event};

#[tauri::command]
async fn get_backend_url() -> Option<String> {
    discover_backend().await
}

#[tauri::command]
async fn check_backend_connection(url: String) -> bool {
    check_connection(&url).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![get_backend_url, check_backend_connection])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Set up menu
            let menu = create_menu(app.handle())?;
            app.set_menu(menu)?;

            let window = app.get_webview_window("main").unwrap();
            let app_handle = app.handle().clone();

            // Spawn async task to discover backend and inject URL
            let window_clone = window.clone();
            tauri::async_runtime::spawn(async move {
                match discover_backend().await {
                    Some(url) => {
                        let script = format!(
                            "window.__ASSUP_API_URL__ = '{}';",
                            url
                        );
                        let _ = window_clone.eval(&script);
                    }
                    None => {
                        // Show dialog when backend not found
                        app_handle.dialog()
                            .message("Could not find Assup backend on ports 3001 or 3000.\n\nPlease start the backend server and restart the app.")
                            .kind(MessageDialogKind::Error)
                            .title("Backend Not Found")
                            .buttons(MessageDialogButtons::Ok)
                            .show(|_| {});
                    }
                }
            });

            Ok(())
        })
        .on_menu_event(|app, event| {
            handle_menu_event(app, event.id().0.as_str());
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
