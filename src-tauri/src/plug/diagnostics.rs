use std::{
    fs::{self, OpenOptions},
    io::Write,
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex, OnceLock,
    },
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use tauri::{AppHandle, Manager};

use crate::plug::config::get_config_dir;

const MAX_LOG_BYTES: u64 = 5 * 1024 * 1024;
const FRONTEND_HEARTBEAT_STALE_MS: u64 = 25_000;
const FRONTEND_RELOAD_COOLDOWN_MS: u64 = 45_000;

static LOG_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
static FRONTEND_HEARTBEAT_MS: AtomicU64 = AtomicU64::new(0);
static FRONTEND_HEARTBEAT_SEQ: AtomicU64 = AtomicU64::new(0);
static FRONTEND_LAST_RELOAD_MS: AtomicU64 = AtomicU64::new(0);

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

fn now_ms_u64() -> u64 {
    now_ms() as u64
}

pub fn diagnostic_log_path() -> std::path::PathBuf {
    get_config_dir().join("diagnostic.log")
}

pub fn app_log(component: &str, level: &str, event: &str, details: impl AsRef<str>) {
    let lock = LOG_LOCK.get_or_init(|| Mutex::new(()));
    let Ok(_guard) = lock.lock() else {
        println!("[diag-log] failed to lock diagnostic logger");
        return;
    };

    let path = diagnostic_log_path();
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }

    if let Ok(metadata) = fs::metadata(&path) {
        if metadata.len() >= MAX_LOG_BYTES {
            let rotated = path.with_extension("log.1");
            let _ = fs::remove_file(&rotated);
            let _ = fs::rename(&path, rotated);
        }
    }

    let line = format!(
        "{} [{}] [{}] {} {}\n",
        now_ms(),
        level,
        component,
        event,
        details.as_ref()
    );

    match OpenOptions::new().create(true).append(true).open(&path) {
        Ok(mut file) => {
            let _ = file.write_all(line.as_bytes());
        }
        Err(e) => {
            println!("[diag-log] failed to write {:?}: {}", path, e);
        }
    }
}

pub fn start_frontend_watchdog(app: AppHandle) {
    let boot_ms = now_ms_u64();
    FRONTEND_HEARTBEAT_MS.store(boot_ms, Ordering::SeqCst);
    app_log(
        "frontend_watchdog",
        "info",
        "start",
        format!(
            "stale_ms={} reload_cooldown_ms={}",
            FRONTEND_HEARTBEAT_STALE_MS, FRONTEND_RELOAD_COOLDOWN_MS
        ),
    );

    thread::spawn(move || loop {
        thread::sleep(Duration::from_secs(5));

        let now = now_ms_u64();
        let last_beat = FRONTEND_HEARTBEAT_MS.load(Ordering::SeqCst);
        let stale_ms = now.saturating_sub(last_beat);

        if stale_ms < FRONTEND_HEARTBEAT_STALE_MS {
            continue;
        }

        let last_reload = FRONTEND_LAST_RELOAD_MS.load(Ordering::SeqCst);
        if now.saturating_sub(last_reload) < FRONTEND_RELOAD_COOLDOWN_MS {
            continue;
        }

        let Some(window) = app.get_webview_window("main") else {
            app_log("frontend_watchdog", "warn", "window_missing", "main window not found");
            continue;
        };

        let visible = window.is_visible().unwrap_or(false);
        let focused = window.is_focused().unwrap_or(false);
        let seq = FRONTEND_HEARTBEAT_SEQ.load(Ordering::SeqCst);
        app_log(
            "frontend_watchdog",
            "warn",
            "stale",
            format!(
                "stale_ms={} last_heartbeat_ms={} seq={} visible={} focused={}",
                stale_ms, last_beat, seq, visible, focused
            ),
        );

        if !visible && !focused {
            continue;
        }

        match window.reload() {
            Ok(_) => {
                FRONTEND_LAST_RELOAD_MS.store(now, Ordering::SeqCst);
                FRONTEND_HEARTBEAT_MS.store(now, Ordering::SeqCst);
                app_log(
                    "frontend_watchdog",
                    "warn",
                    "reload",
                    format!("stale_ms={} seq={} visible={} focused={}", stale_ms, seq, visible, focused),
                );
            }
            Err(e) => {
                app_log("frontend_watchdog", "error", "reload_failed", format!("error={}", e));
            }
        }
    });
}

#[tauri::command]
pub async fn frontend_diag_log(level: String, event: String, details: String) -> Result<(), String> {
    app_log("frontend", &level, &event, details);
    Ok(())
}

#[tauri::command]
pub async fn frontend_heartbeat(seq: u64, visible: bool, focused: bool, reason: Option<String>) -> Result<(), String> {
    FRONTEND_HEARTBEAT_MS.store(now_ms_u64(), Ordering::SeqCst);
    FRONTEND_HEARTBEAT_SEQ.store(seq, Ordering::SeqCst);
    if seq == 1 || seq % 20 == 0 {
        app_log(
            "frontend_watchdog",
            "debug",
            "heartbeat",
            format!("seq={} visible={} focused={} reason={}", seq, visible, focused, reason.unwrap_or_default()),
        );
    }
    Ok(())
}

#[tauri::command]
pub async fn get_diagnostic_log_path() -> Result<String, String> {
    Ok(diagnostic_log_path().to_string_lossy().to_string())
}
