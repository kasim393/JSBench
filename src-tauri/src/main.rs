use std::fs;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use serde::Serialize;
use tauri::{Emitter, State};

// ---------- child process handle ----------
struct ProcHandle(Arc<Mutex<Option<Child>>>);

static RUN_SEQ: AtomicU64 = AtomicU64::new(0);

#[derive(Serialize, Clone)]
struct RunExited {
    run_id: u64,
    code: Option<i32>,
    duration_ms: u128,
    timed_out: bool,
}

#[derive(Serialize)]
struct NodeStatus {
    ok: bool,
    version: String,
    path: String,
}

#[derive(Serialize)]
struct Entry {
    name: String,
    path: String,
    is_dir: bool,
}

fn find_node() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("JSBENCH_NODE_PATH") {
        let pb = PathBuf::from(p);
        if pb.exists() {
            return Some(pb);
        }
    }
    which::which("node").ok()
}

#[tauri::command]
fn node_status() -> NodeStatus {
    match find_node() {
        Some(p) => {
            let out = Command::new(&p).arg("--version").output();
            let version = out
                .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
                .unwrap_or_default();
            NodeStatus { ok: true, version, path: p.display().to_string() }
        }
        None => NodeStatus { ok: false, version: String::new(), path: String::new() },
    }
}

#[tauri::command]
fn run_js(
    app: tauri::AppHandle,
    path: String,
    timeout_ms: Option<u64>,
    proc: State<ProcHandle>,
) -> Result<u64, String> {
    let node = find_node()
        .ok_or("Node.js executable not found. Install Node.js or set JSBENCH_NODE_PATH.")?;
    if !std::path::Path::new(&path).exists() {
        return Err(format!("File not found: {}", path));
    }

    let run_id = RUN_SEQ.fetch_add(1, Ordering::Relaxed);
    let timeout = timeout_ms.unwrap_or(10_000);

    // Only one run at a time: kill any previous process
    {
        let mut guard = proc.0.lock().unwrap();
        if let Some(mut old) = guard.take() {
            let _ = old.kill();
            let _ = old.wait();
        }
    }

    let mut child = Command::new(node)
        .arg(&path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to spawn node: {}", e))?;

    let stdout_pipe = child.stdout.take();
    let stderr_pipe = child.stderr.take();

    // Store handle so stop_js can kill it
    *proc.0.lock().unwrap() = Some(child);

    let app2 = app.clone();
    let app3 = app.clone();

    // stdout reader thread
    std::thread::spawn(move || {
        if let Some(p) = stdout_pipe {
            let reader = BufReader::new(p);
            for line in reader.lines() {
                match line {
                    Ok(l) => {
                        let _ = app2.emit("run-output", serde_json::json!({
                            "run_id": run_id, "stream": "stdout", "text": format!("{}\n", l)
                        }));
                    }
                    Err(_) => break,
                }
            }
        }
    });

    // stderr reader thread
    std::thread::spawn(move || {
        if let Some(p) = stderr_pipe {
            let reader = BufReader::new(p);
            for line in reader.lines() {
                match line {
                    Ok(l) => {
                        let _ = app3.emit("run-output", serde_json::json!({
                            "run_id": run_id, "stream": "stderr", "text": format!("{}\n", l)
                        }));
                    }
                    Err(_) => break,
                }
            }
        }
    });

    // watcher thread: timeout + exit event
    let proc_handle = proc.0.clone();
    std::thread::spawn(move || {
        let start = Instant::now();
        let mut timed_out = false;
        let code;
        loop {
            // give the mutex a chance for stop_js to take the child
            std::thread::sleep(std::time::Duration::from_millis(30));
            let mut guard = proc_handle.lock().unwrap();
            match guard.as_mut() {
                Some(child) => match child.try_wait() {
                    Ok(Some(status)) => {
                        code = status.code();
                        guard.take();
                        break;
                    }
                    Ok(None) => {
                        if start.elapsed().as_millis() > timeout as u128 {
                            let _ = child.kill();
                            let _ = child.wait();
                            timed_out = true;
                            code = Some(-1);
                            guard.take();
                            break;
                        }
                    }
                    Err(_) => {
                        code = Some(-1);
                        guard.take();
                        break;
                    }
                },
                None => {
                    // stopped externally by stop_js
                    code = Some(-2);
                    break;
                }
            }
        }

        let _ = app.emit("run-exit", RunExited {
            run_id,
            code,
            duration_ms: start.elapsed().as_millis(),
            timed_out,
        });
    });

    Ok(run_id)
}

#[tauri::command]
fn stop_js(proc: State<ProcHandle>) -> Result<(), String> {
    let mut guard = proc.0.lock().unwrap();
    if let Some(mut child) = guard.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    Ok(())
}

// ---------- fs commands ----------
#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_file(path: String, content: String) -> Result<(), String> {
    if let Some(parent) = std::path::Path::new(&path).parent() {
        let _ = fs::create_dir_all(parent);
    }
    fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
fn create_file(path: String) -> Result<(), String> {
    if std::path::Path::new(&path).exists() {
        return Err("File already exists".into());
    }
    fs::write(&path, "").map_err(|e| e.to_string())
}

#[tauri::command]
fn create_folder(path: String) -> Result<(), String> {
    if std::path::Path::new(&path).exists() {
        return Err("Folder already exists".into());
    }
    fs::create_dir_all(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn rename_entry(old_path: String, new_path: String) -> Result<(), String> {
    if std::path::Path::new(&new_path).exists() {
        return Err("Target already exists".into());
    }
    fs::rename(&old_path, &new_path).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_entry(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if p.is_dir() {
        fs::remove_dir_all(p).map_err(|e| e.to_string())
    } else {
        fs::remove_file(p).map_err(|e| e.to_string())
    }
}

#[tauri::command]
fn list_dir(path: String) -> Result<Vec<Entry>, String> {
    let mut entries: Vec<Entry> = Vec::new();
    for entry in fs::read_dir(&path).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') || name == "node_modules" || name == "target" {
            continue;
        }
        let meta = entry.metadata().map_err(|e| e.to_string())?;
        entries.push(Entry {
            name,
            path: entry.path().display().to_string(),
            is_dir: meta.is_dir(),
        });
    }
    entries.sort_by(|a, b| match (b.is_dir, a.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    Ok(entries)
}

// ---------- config ----------
fn config_path() -> PathBuf {
    let exe = std::env::current_exe().ok().unwrap_or_default();
    let dir = exe.parent().unwrap_or(std::path::Path::new("."));
    let portable = dir.join("config");
    if portable.exists() {
        portable
    } else {
        std::env::var("APPDATA")
            .map(|d| PathBuf::from(d).join("JSBench"))
            .unwrap_or_else(|_| dir.to_path_buf())
    }
}

fn read_config() -> serde_json::Value {
    let p = config_path().join("config.json");
    fs::read_to_string(p)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(serde_json::Value::Null)
}

#[tauri::command]
fn get_workspace() -> Result<String, String> {
    let cfg = read_config();
    Ok(cfg
        .get("workspace")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string())
}

#[tauri::command]
fn set_workspace(path: String) -> Result<(), String> {
    let dir = config_path();
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let cfg = serde_json::json!({ "workspace": path });
    fs::write(
        dir.join("config.json"),
        serde_json::to_string_pretty(&cfg).unwrap(),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_config_path() -> String {
    config_path().display().to_string()
}

#[tauri::command]
fn save_session(open_files: Vec<String>, active_file: String) -> Result<(), String> {
    let dir = config_path();
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let p = dir.join("config.json");
    let mut cfg: serde_json::Value = fs::read_to_string(&p)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(serde_json::json!({}));
    cfg["open_files"] = serde_json::json!(open_files);
    cfg["active_file"] = serde_json::json!(active_file);
    fs::write(p, serde_json::to_string_pretty(&cfg).unwrap()).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_session() -> Result<serde_json::Value, String> {
    Ok(read_config())
}

#[tauri::command]
fn open_workspace_dialog(app: tauri::AppHandle) -> Result<String, String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog().file().pick_folder(move |p| {
        let _ = tx.send(p.map(|f| f.to_string()));
    });
    rx.recv()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "cancelled".to_string())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .manage(ProcHandle(Arc::new(Mutex::new(None))))
        .invoke_handler(tauri::generate_handler![
            node_status,
            run_js,
            stop_js,
            read_file,
            write_file,
            create_file,
            create_folder,
            rename_entry,
            delete_entry,
            list_dir,
            get_workspace,
            set_workspace,
            get_config_path,
            save_session,
            get_session,
            open_workspace_dialog,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
