use std::process::{Child, Command};
use std::sync::Mutex;
use tauri::Manager;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! Welcome to CPI-Control.", name)
}

struct BackendProcess(Mutex<Option<Child>>);

fn find_node() -> Option<std::path::PathBuf> {
    // Common Node.js locations
    let candidates = if cfg!(target_os = "windows") {
        vec![
            "node.exe".to_string(),
            r"C:\Program Files\nodejs\node.exe".to_string(),
        ]
    } else {
        let mut paths = vec![
            "node".to_string(),
            "/usr/local/bin/node".to_string(),
            "/opt/homebrew/bin/node".to_string(),
        ];
        // Add nvm-managed Node.js paths
        if let Ok(home) = std::env::var("HOME") {
            let nvm_dir = std::path::PathBuf::from(&home).join(".nvm/versions/node");
            if let Ok(entries) = std::fs::read_dir(&nvm_dir) {
                let mut versions: Vec<_> = entries
                    .filter_map(|e| e.ok())
                    .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
                    .collect();
                // Sort descending to prefer latest version
                versions.sort_by(|a, b| b.file_name().cmp(&a.file_name()));
                for v in versions {
                    paths.push(v.path().join("bin/node").to_string_lossy().to_string());
                }
            }
        }
        paths
    };

    // Try PATH first via `which`
    if let Ok(output) = Command::new(if cfg!(target_os = "windows") { "where" } else { "which" })
        .arg("node")
        .output()
    {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                return Some(std::path::PathBuf::from(path.lines().next().unwrap_or(&path)));
            }
        }
    }

    // Fallback to known locations
    for candidate in candidates {
        let p = std::path::PathBuf::from(&candidate);
        if p.exists() {
            return Some(p);
        }
    }

    None
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(BackendProcess(Mutex::new(None)))
        .setup(|app| {
            println!("CPI-Control Desktop starting...");

            // Resolve backend directory from Tauri resources
            let resource_dir = app.path().resource_dir().expect("Failed to get resource dir");
            let backend_entry = resource_dir.join("backend").join("index.js");

            if !backend_entry.exists() {
                eprintln!(
                    "Backend bundle not found at {:?} — running in dev mode (backend must be started separately)",
                    backend_entry
                );
                return Ok(());
            }

            let node_path = find_node().expect(
                "Node.js not found! Please install Node.js v20+ from https://nodejs.org",
            );

            println!("Starting backend with Node.js: {:?}", node_path);
            println!("Backend entry: {:?}", backend_entry);

            // Determine data directory for the database
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("Failed to get app data dir");
            std::fs::create_dir_all(&app_data_dir).ok();

            let child = Command::new(&node_path)
                .arg(&backend_entry)
                .env("OPSBOARD_DATA_DIR", &app_data_dir)
                .env("NODE_ENV", "production")
                .current_dir(resource_dir.join("backend"))
                .spawn()
                .expect("Failed to start backend process");

            println!("Backend started with PID: {}", child.id());

            app.state::<BackendProcess>()
                .0
                .lock()
                .unwrap()
                .replace(child);

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                // Kill backend when app closes
                let state = window.state::<BackendProcess>();
                let mut guard = state.0.lock().unwrap();
                if let Some(mut child) = guard.take() {
                    println!("Shutting down backend (PID: {})...", child.id());
                    let _ = child.kill();
                    let _ = child.wait();
                }
                drop(guard);
            }
        })
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
