use std::collections::VecDeque;
use std::io::BufRead;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::SystemTime;
use tauri::Manager;

const MAX_LOG_LINES: usize = 1000;

struct BackendState {
    child: Option<Child>,
    started_at: Option<SystemTime>,
    logs: VecDeque<String>,
    node_path: PathBuf,
    backend_entry: PathBuf,
    app_data_dir: PathBuf,
    resource_dir: PathBuf,
}

type SharedBackendState = Arc<Mutex<BackendState>>;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! Welcome to CPI-Control.", name)
}

#[tauri::command]
fn get_machine_id() -> Result<String, String> {
    machine_uid::get().map_err(|e| format!("Failed to get machine ID: {}", e))
}

#[tauri::command]
fn open_log_window(app: tauri::AppHandle, url: String) -> Result<String, String> {
    use tauri::WebviewWindowBuilder;
    let label = format!("log-live-{}", std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis());
    WebviewWindowBuilder::new(&app, &label, tauri::WebviewUrl::App(url.into()))
        .title("CPI-Control — Live Logs")
        .inner_size(1200.0, 800.0)
        .center()
        .build()
        .map_err(|e| format!("Failed to create window: {}", e))?;
    Ok(label)
}

#[tauri::command]
fn open_terminal(command: String) -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        let script = format!(
            "tell application \"Terminal\"\n  activate\n  do script \"{}\"\nend tell",
            command.replace('\\', "\\\\").replace('"', "\\\"")
        );
        Command::new("osascript")
            .arg("-e")
            .arg(&script)
            .spawn()
            .map_err(|e| format!("Failed to open Terminal: {}", e))?;
        return Ok("Terminal opened".to_string());
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("Terminal opening is only supported on macOS".to_string())
    }
}

#[tauri::command]
fn get_backend_status(state: tauri::State<'_, SharedBackendState>) -> Result<serde_json::Value, String> {
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    let bs = &mut *guard;

    let mut running = false;
    let mut pid: Option<u32> = None;

    if let Some(ref mut child) = bs.child {
        match child.try_wait() {
            Ok(Some(_status)) => {
                // Process has exited
                running = false;
                bs.child = None;
                bs.started_at = None;
            }
            Ok(None) => {
                // Still running
                running = true;
                pid = Some(child.id());
            }
            Err(_) => {
                running = false;
            }
        }
    }

    let uptime_seconds = if running {
        bs.started_at
            .and_then(|t| t.elapsed().ok())
            .map(|d| d.as_secs())
    } else {
        None
    };

    Ok(serde_json::json!({
        "running": running,
        "pid": pid,
        "uptimeSeconds": uptime_seconds,
        "logCount": bs.logs.len()
    }))
}

#[tauri::command]
fn get_backend_logs(state: tauri::State<'_, SharedBackendState>) -> Result<Vec<String>, String> {
    let guard = state.lock().map_err(|e| e.to_string())?;
    Ok(guard.logs.iter().cloned().collect())
}

#[tauri::command]
fn restart_backend(state: tauri::State<'_, SharedBackendState>) -> Result<String, String> {
    // Phase 1: Kill existing, spawn new (under lock)
    let spawn_result = {
        let mut guard = state.lock().map_err(|e| e.to_string())?;
        let bs = &mut *guard;

        // Kill existing process
        if let Some(mut child) = bs.child.take() {
            let pid = child.id();
            let _ = child.kill();
            let _ = child.wait();
            bs.started_at = None;
            bs.logs.push_back(format!("[tauri] Killed backend process (PID: {})", pid));
            trim_logs(&mut bs.logs);
        }

        let node_path = bs.node_path.clone();
        let backend_entry = bs.backend_entry.clone();
        let app_data_dir = bs.app_data_dir.clone();
        let resource_dir = bs.resource_dir.clone();

        bs.logs.push_back("[tauri] Restarting backend...".to_string());
        trim_logs(&mut bs.logs);

        let result = spawn_backend(&node_path, &backend_entry, &app_data_dir, &resource_dir);

        match result {
            Ok(child) => {
                let pid = child.id();
                bs.child = Some(child);
                bs.started_at = Some(SystemTime::now());
                bs.logs.push_back(format!("[tauri] Backend restarted (PID: {})", pid));
                trim_logs(&mut bs.logs);
                Ok(pid)
            }
            Err(e) => {
                bs.logs.push_back(format!("[tauri] Failed to restart backend: {}", e));
                trim_logs(&mut bs.logs);
                Err(format!("Failed to restart: {}", e))
            }
        }
    };

    // Phase 2: Start log readers (outside lock)
    match spawn_result {
        Ok(pid) => {
            let state_arc: SharedBackendState = Arc::clone(&state);
            spawn_log_reader(state_arc);
            Ok(format!("Backend restarted with PID: {}", pid))
        }
        Err(e) => Err(e),
    }
}

fn trim_logs(logs: &mut VecDeque<String>) {
    while logs.len() > MAX_LOG_LINES {
        logs.pop_front();
    }
}

fn spawn_backend(
    node_path: &PathBuf,
    backend_entry: &PathBuf,
    app_data_dir: &PathBuf,
    resource_dir: &PathBuf,
) -> Result<Child, String> {
    Command::new(node_path)
        .arg(backend_entry)
        .env("OPSBOARD_DATA_DIR", app_data_dir)
        .env("NODE_ENV", "production")
        .current_dir(resource_dir.join("backend"))
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start backend: {}", e))
}

fn spawn_watchdog(state: SharedBackendState) {
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(std::time::Duration::from_secs(5));

            let should_restart = {
                let mut guard = match state.lock() {
                    Ok(g) => g,
                    Err(_) => continue,
                };
                if let Some(child) = guard.child.as_mut() {
                    match child.try_wait() {
                        Ok(Some(_status)) => {
                            // Process exited — remove dead child
                            guard.child.take();
                            guard.logs.push_back("[tauri] Backend process exited unexpectedly".to_string());
                            trim_logs(&mut guard.logs);
                            true
                        }
                        Ok(None) => false, // still running
                        Err(_) => false,
                    }
                } else {
                    // No child process — needs restart
                    true
                }
            };

            if should_restart {
                let (node_path, backend_entry, app_data_dir, resource_dir) = {
                    let guard = match state.lock() {
                        Ok(g) => g,
                        Err(_) => continue,
                    };
                    (
                        guard.node_path.clone(),
                        guard.backend_entry.clone(),
                        guard.app_data_dir.clone(),
                        guard.resource_dir.clone(),
                    )
                };

                // Wait a moment before restarting
                std::thread::sleep(std::time::Duration::from_secs(2));

                match spawn_backend(&node_path, &backend_entry, &app_data_dir, &resource_dir) {
                    Ok(child) => {
                        let pid = child.id();
                        {
                            let mut guard = state.lock().unwrap();
                            guard.child = Some(child);
                            guard.logs.push_back(format!("[tauri] Backend auto-restarted (PID: {})", pid));
                            trim_logs(&mut guard.logs);
                        }
                        spawn_log_reader(Arc::clone(&state));
                    }
                    Err(e) => {
                        if let Ok(mut guard) = state.lock() {
                            guard.logs.push_back(format!("[tauri] Auto-restart failed: {}", e));
                            trim_logs(&mut guard.logs);
                        }
                    }
                }
            }
        }
    });
}

fn spawn_log_reader(state: SharedBackendState) {
    // Take stdout
    let stdout = {
        let mut g = state.lock().unwrap();
        g.child.as_mut().and_then(|c| c.stdout.take())
    };
    // Take stderr
    let stderr = {
        let mut g = state.lock().unwrap();
        g.child.as_mut().and_then(|c| c.stderr.take())
    };

    if let Some(stdout) = stdout {
        let state_clone = Arc::clone(&state);
        std::thread::spawn(move || {
            let reader = std::io::BufReader::new(stdout);
            for line in reader.lines() {
                match line {
                    Ok(text) => {
                        let mut g = state_clone.lock().unwrap();
                        g.logs.push_back(text);
                        trim_logs(&mut g.logs);
                    }
                    Err(_) => break,
                }
            }
        });
    }

    if let Some(stderr) = stderr {
        let state_clone = Arc::clone(&state);
        std::thread::spawn(move || {
            let reader = std::io::BufReader::new(stderr);
            for line in reader.lines() {
                match line {
                    Ok(text) => {
                        let mut g = state_clone.lock().unwrap();
                        g.logs.push_back(format!("[stderr] {}", text));
                        trim_logs(&mut g.logs);
                    }
                    Err(_) => break,
                }
            }
        });
    }
}

fn find_node() -> Option<PathBuf> {
    // The bundled Node binary is not yet available here (we don't have resource_dir).
    // This function is only used as a fallback. The main setup code checks for
    // the bundled node first (see run() below).

    let candidates = if cfg!(target_os = "windows") {
        vec![
            "node.exe".to_string(),
            r"C:\Program Files\nodejs\node.exe".to_string(),
        ]
    } else {
        let mut paths = vec![
            "/usr/local/bin/node".to_string(),
            "/opt/homebrew/bin/node".to_string(),
        ];
        if let Ok(home) = std::env::var("HOME") {
            let nvm_dir = PathBuf::from(&home).join(".nvm/versions/node");
            if let Ok(entries) = std::fs::read_dir(&nvm_dir) {
                let mut versions: Vec<_> = entries
                    .filter_map(|e| e.ok())
                    .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
                    .collect();
                versions.sort_by(|a, b| b.file_name().cmp(&a.file_name()));
                for v in versions {
                    paths.push(v.path().join("bin/node").to_string_lossy().to_string());
                }
            }
        }
        paths
    };

    for candidate in candidates {
        let p = PathBuf::from(&candidate);
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
        .setup(|app| {
            println!("CPI-Control Desktop starting...");

            // Resolve backend directory from Tauri resources
            let resource_dir = app.path().resource_dir().expect("Failed to get resource dir");
            let backend_entry = resource_dir.join("backend").join("index.js");

            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("Failed to get app data dir");
            std::fs::create_dir_all(&app_data_dir).ok();

            // Prefer bundled Node.js (guaranteed to match native module version)
            let bundled_node = resource_dir.join("backend").join("node");
            let node_path = if bundled_node.exists() {
                println!("Using bundled Node.js: {:?}", bundled_node);
                bundled_node
            } else {
                println!("Bundled Node.js not found, falling back to system Node");
                find_node().unwrap_or_default()
            };

            if !backend_entry.exists() {
                eprintln!(
                    "Backend bundle not found at {:?} — running in dev mode (backend must be started separately)",
                    backend_entry
                );

                // Still create state so commands don't panic
                let state: SharedBackendState = Arc::new(Mutex::new(BackendState {
                    child: None,
                    started_at: None,
                    logs: VecDeque::new(),
                    node_path,
                    backend_entry,
                    app_data_dir,
                    resource_dir,
                }));
                app.manage(state);
                return Ok(());
            }

            if node_path.as_os_str().is_empty() {
                panic!("Node.js not found! Please install Node.js v20+ from https://nodejs.org");
            }

            println!("Starting backend with Node.js: {:?}", node_path);
            println!("Backend entry: {:?}", backend_entry);

            let child = spawn_backend(&node_path, &backend_entry, &app_data_dir, &resource_dir)
                .expect("Failed to start backend process");

            println!("Backend started with PID: {}", child.id());

            let state: SharedBackendState = Arc::new(Mutex::new(BackendState {
                child: Some(child),
                started_at: Some(SystemTime::now()),
                logs: VecDeque::new(),
                node_path,
                backend_entry,
                app_data_dir,
                resource_dir,
            }));

            // Start log reader threads
            spawn_log_reader(Arc::clone(&state));

            // Start watchdog to auto-restart backend if it crashes
            spawn_watchdog(Arc::clone(&state));

            app.manage(state);
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                // Kill backend when app closes
                let state = window.state::<SharedBackendState>();
                let mut guard = state.lock().unwrap();
                if let Some(mut child) = guard.child.take() {
                    println!("Shutting down backend (PID: {})...", child.id());
                    let _ = child.kill();
                    let _ = child.wait();
                }
                drop(guard);
            }
        })
        .invoke_handler(tauri::generate_handler![greet, get_backend_status, get_backend_logs, restart_backend, open_terminal, open_log_window, get_machine_id])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
