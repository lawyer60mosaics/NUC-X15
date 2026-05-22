use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::Path,
    process,
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
const MAX_LOG_DETAIL_CHARS: usize = 8_000;
const DIAGNOSTIC_SUMMARY_LINE_LIMIT: usize = 900;
const DIAGNOSTIC_RECENT_ISSUE_LIMIT: usize = 16;
const FRONTEND_HEARTBEAT_STALE_MS: u64 = 25_000;
const FRONTEND_RELOAD_COOLDOWN_MS: u64 = 45_000;

static LOG_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
static FRONTEND_HEARTBEAT_MS: AtomicU64 = AtomicU64::new(0);
static FRONTEND_HEARTBEAT_SEQ: AtomicU64 = AtomicU64::new(0);
static FRONTEND_LAST_RELOAD_MS: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, serde::Serialize)]
pub struct DiagnosticIssue {
    pub timestamp_ms: u64,
    pub level: String,
    pub component: String,
    pub event: String,
    pub message: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct DiagnosticSummary {
    pub path: String,
    pub size_bytes: u64,
    pub modified_ms: Option<u64>,
    pub total_lines: usize,
    pub scanned_lines: usize,
    pub health: String,
    pub summary: String,
    pub warning_count: usize,
    pub error_count: usize,
    pub invoke_failure_count: usize,
    pub invoke_timeout_count: usize,
    pub ui_drift_count: usize,
    pub watchdog_reload_count: usize,
    pub watchdog_event_count: usize,
    pub sentinel_event_count: usize,
    pub tdp_drift_count: usize,
    pub tdp_reapply_failed_count: usize,
    pub actor_hung_count: usize,
    pub vendor_failure_count: usize,
    pub hardware_busy_count: usize,
    pub recent_watchdog_events: Vec<DiagnosticIssue>,
    pub recent_issues: Vec<DiagnosticIssue>,
}

#[derive(Debug)]
struct ParsedLogLine {
    timestamp_ms: u64,
    level: String,
    component: String,
    event: String,
    message: String,
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

fn now_ms_u64() -> u64 {
    now_ms() as u64
}

fn truncate_log_details(details: &str) -> String {
    let char_count = details.chars().count();
    if char_count <= MAX_LOG_DETAIL_CHARS {
        return details.to_string();
    }

    let truncated: String = details.chars().take(MAX_LOG_DETAIL_CHARS).collect();
    format!("{}...[truncated chars={}]", truncated, char_count)
}

pub fn diagnostic_log_path() -> std::path::PathBuf {
    get_config_dir().join("diagnostic.log")
}

pub fn frontend_heartbeat_path() -> std::path::PathBuf {
    get_config_dir().join("frontend_heartbeat.json")
}

fn write_frontend_heartbeat_file(
    seq: u64,
    visible: bool,
    focused: bool,
    running: Option<bool>,
    reason: Option<&str>,
) {
    let path = frontend_heartbeat_path();
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }

    let payload = serde_json::json!({
        "ts": now_ms_u64(),
        "owner_pid": process::id(),
        "seq": seq,
        "visible": visible,
        "focused": focused,
        "running": running,
        "reason": reason.unwrap_or_default(),
    });
    let temp_path = path.with_extension("json.tmp");
    if fs::write(&temp_path, payload.to_string()).is_ok() {
        let _ = fs::rename(temp_path, path);
    }
}

fn modified_ms(path: &Path) -> Option<u64> {
    fs::metadata(path)
        .ok()
        .and_then(|metadata| metadata.modified().ok())
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
}

fn parse_log_line(line: &str) -> Option<ParsedLogLine> {
    let (timestamp, rest) = line.split_once(' ')?;
    let timestamp_ms = timestamp.parse::<u64>().ok()?;
    let rest = rest.strip_prefix('[')?;
    let (level, rest) = rest.split_once("] [")?;
    let (component, rest) = rest.split_once("] ")?;
    let (event, message) = rest.split_once(' ').unwrap_or((rest, ""));

    Some(ParsedLogLine {
        timestamp_ms,
        level: level.to_string(),
        component: component.to_string(),
        event: event.to_string(),
        message: truncate_log_details(message).chars().take(320).collect(),
    })
}

fn is_diagnostic_summary_echo(line: &str, parsed: Option<&ParsedLogLine>) -> bool {
    let Some(entry) = parsed else {
        return false;
    };

    entry.component == "frontend"
        && entry.event == "invoke.done"
        && line.contains("\"command\":\"get_diagnostic_summary\"")
}

fn summarize_diagnostic_lines(
    path: &Path,
    lines: &[&str],
    total_lines: usize,
) -> DiagnosticSummary {
    let mut warning_count = 0;
    let mut error_count = 0;
    let mut invoke_failure_count = 0;
    let mut invoke_timeout_count = 0;
    let mut ui_drift_count = 0;
    let mut watchdog_reload_count = 0;
    let mut watchdog_event_count = 0;
    let mut sentinel_event_count = 0;
    let mut tdp_drift_count = 0;
    let mut tdp_reapply_failed_count = 0;
    let mut actor_hung_count = 0;
    let mut vendor_failure_count = 0;
    let mut hardware_busy_count = 0;
    let mut recent_watchdog_events = Vec::new();
    let mut recent_issues = Vec::new();

    for line in lines {
        let lower = line.to_ascii_lowercase();
        let parsed = parse_log_line(line);
        if is_diagnostic_summary_echo(line, parsed.as_ref()) {
            continue;
        }
        let is_warn = parsed
            .as_ref()
            .map(|entry| entry.level == "warn")
            .unwrap_or_else(|| lower.contains("[warn]"));
        let is_error = parsed
            .as_ref()
            .map(|entry| entry.level == "error")
            .unwrap_or_else(|| lower.contains("[error]"));

        if is_warn {
            warning_count += 1;
        }
        if is_error {
            error_count += 1;
        }
        if lower.contains("invoke.failed") {
            invoke_failure_count += 1;
        }
        if lower.contains("invoke.timeout") {
            invoke_timeout_count += 1;
        }
        if lower.contains("ui.event_loop.drift") {
            ui_drift_count += 1;
        }
        if lower.contains("[frontend_watchdog] reload") {
            watchdog_reload_count += 1;
        }
        let is_watchdog_event = lower.contains("[frontend_watchdog]")
            || lower.contains("[fan_sentinel]")
            || lower.contains("[external_sentinel]")
            || lower.contains("watchdog.")
            || lower.contains("actor_hung.flagged");
        if is_watchdog_event {
            watchdog_event_count += 1;
        }
        if lower.contains("[fan_sentinel]") || lower.contains("[external_sentinel]") {
            sentinel_event_count += 1;
        }
        if lower.contains("tdp_lock.drift") || lower.contains("cpu_tdp_lock.drift") {
            tdp_drift_count += 1;
        }
        if lower.contains("tdp_lock.reapply ok=false")
            || (lower.contains("set_tdp.verify") && lower.contains("cpu_ok=false"))
        {
            tdp_reapply_failed_count += 1;
        }
        if lower.contains("\"hung\":true") || lower.contains("actor_hung.flagged") {
            actor_hung_count += 1;
        }
        if lower.contains("[vendor]") && (is_warn || is_error || lower.contains("timeout")) {
            vendor_failure_count += 1;
        }
        if lower.contains("硬件读数繁忙") || lower.contains("hardware read busy") {
            hardware_busy_count += 1;
        }

        let notable = is_error
            || lower.contains("invoke.failed")
            || lower.contains("invoke.timeout")
            || lower.contains("tdp_lock.drift")
            || lower.contains("power.tdp_external_drift")
            || lower.contains("tdp_lock.reapply ok=false")
            || lower.contains("hard_recovery.")
            || lower.contains("control_loop.timeout")
            || lower.contains("control_loop.recovered")
            || lower.contains("watchdog.resume_gap")
            || lower.contains("[external_sentinel]")
            || lower.contains("\"hung\":true")
            || lower.contains("[frontend_watchdog] reload")
            || lower.contains("ui.event_loop.drift")
            || lower.contains("硬件读数繁忙");

        if notable {
            if let Some(entry) = parsed.as_ref() {
                recent_issues.push(DiagnosticIssue {
                    timestamp_ms: entry.timestamp_ms,
                    level: entry.level.clone(),
                    component: entry.component.clone(),
                    event: entry.event.clone(),
                    message: entry.message.clone(),
                });
            }
            while recent_issues.len() > DIAGNOSTIC_RECENT_ISSUE_LIMIT {
                recent_issues.remove(0);
            }
        }

        if is_watchdog_event {
            if let Some(entry) = parsed.as_ref() {
                recent_watchdog_events.push(DiagnosticIssue {
                    timestamp_ms: entry.timestamp_ms,
                    level: entry.level.clone(),
                    component: entry.component.clone(),
                    event: entry.event.clone(),
                    message: entry.message.clone(),
                });
            }
            while recent_watchdog_events.len() > DIAGNOSTIC_RECENT_ISSUE_LIMIT {
                recent_watchdog_events.remove(0);
            }
        }
    }

    let health = if error_count > 0 || actor_hung_count > 0 || watchdog_reload_count > 0 {
        "danger"
    } else if tdp_reapply_failed_count > 0
        || tdp_drift_count > 0
        || invoke_timeout_count > 0
        || ui_drift_count > 0
        || warning_count > 0
    {
        "warn"
    } else {
        "ok"
    }
    .to_string();

    let summary = match health.as_str() {
        "danger" => "发现需要关注的运行故障，建议查看最近问题。",
        "warn" => "近期有可恢复告警，核心控制仍可能正常运行。",
        _ => "最近日志未发现明显异常。",
    }
    .to_string();

    let size_bytes = fs::metadata(path)
        .map(|metadata| metadata.len())
        .unwrap_or(0);

    DiagnosticSummary {
        path: path.to_string_lossy().to_string(),
        size_bytes,
        modified_ms: modified_ms(path),
        total_lines,
        scanned_lines: lines.len(),
        health,
        summary,
        warning_count,
        error_count,
        invoke_failure_count,
        invoke_timeout_count,
        ui_drift_count,
        watchdog_reload_count,
        watchdog_event_count,
        sentinel_event_count,
        tdp_drift_count,
        tdp_reapply_failed_count,
        actor_hung_count,
        vendor_failure_count,
        hardware_busy_count,
        recent_watchdog_events,
        recent_issues,
    }
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

    let details = truncate_log_details(details.as_ref());
    let line = format!(
        "{} [{}] [{}] {} {}\n",
        now_ms(),
        level,
        component,
        event,
        details
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
            app_log(
                "frontend_watchdog",
                "warn",
                "window_missing",
                "main window not found",
            );
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
                    format!(
                        "stale_ms={} seq={} visible={} focused={}",
                        stale_ms, seq, visible, focused
                    ),
                );
            }
            Err(e) => {
                app_log(
                    "frontend_watchdog",
                    "error",
                    "reload_failed",
                    format!("error={}", e),
                );
            }
        }
    });
}

#[tauri::command]
pub async fn frontend_diag_log(
    level: String,
    event: String,
    details: String,
) -> Result<(), String> {
    app_log("frontend", &level, &event, details);
    Ok(())
}

#[tauri::command]
pub async fn frontend_heartbeat(
    seq: u64,
    visible: bool,
    focused: bool,
    reason: Option<String>,
    running: Option<bool>,
) -> Result<(), String> {
    FRONTEND_HEARTBEAT_MS.store(now_ms_u64(), Ordering::SeqCst);
    FRONTEND_HEARTBEAT_SEQ.store(seq, Ordering::SeqCst);
    write_frontend_heartbeat_file(seq, visible, focused, running, reason.as_deref());
    if seq == 1 || seq.is_multiple_of(20) {
        app_log(
            "frontend_watchdog",
            "debug",
            "heartbeat",
            format!(
                "seq={} visible={} focused={} reason={}",
                seq,
                visible,
                focused,
                reason.unwrap_or_default()
            ),
        );
    }
    Ok(())
}

#[tauri::command]
pub async fn get_diagnostic_log_path() -> Result<String, String> {
    Ok(diagnostic_log_path().to_string_lossy().to_string())
}

#[tauri::command]
pub async fn get_diagnostic_summary() -> Result<DiagnosticSummary, String> {
    let path = diagnostic_log_path();
    let content = match fs::read_to_string(&path) {
        Ok(content) => content,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(error) => return Err(error.to_string()),
    };

    let all_lines: Vec<&str> = content.lines().collect();
    let total_lines = all_lines.len();
    let start = total_lines.saturating_sub(DIAGNOSTIC_SUMMARY_LINE_LIMIT);
    Ok(summarize_diagnostic_lines(
        &path,
        &all_lines[start..],
        total_lines,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn diagnostic_summary_ignores_self_referential_echoes() {
        let lines = [
            r#"1778948332966 [debug] [frontend] invoke.done {"details":{"command":"get_diagnostic_summary","result":{"health":"danger","warning_count":12,"invoke_failure_count":17,"recent_issues":[{"message":"frontend.invoke.failed something"},{"message":"ui.event_loop.drift"},{"message":"[frontend_watchdog] reload"}]}}}"#,
            r#"1778948334912 [debug] [fan_push] emit.ok emitted_ticks=1020 interval_ms=1000 running=true cpu_temp=Some(52)"#,
        ];

        let summary = summarize_diagnostic_lines(Path::new("diagnostic.log"), &lines, lines.len());

        assert_eq!(summary.health, "ok");
        assert_eq!(summary.invoke_failure_count, 0);
        assert_eq!(summary.ui_drift_count, 0);
        assert_eq!(summary.watchdog_reload_count, 0);
        assert!(summary.recent_issues.is_empty());
    }

    #[test]
    fn diagnostic_summary_keeps_real_frontend_failures() {
        let lines = [
            r#"1778948332966 [warn] [frontend] invoke.failed {"details":{"command":"get_tdp","error":"boom"}}"#,
        ];

        let summary = summarize_diagnostic_lines(Path::new("diagnostic.log"), &lines, lines.len());

        assert_eq!(summary.health, "warn");
        assert_eq!(summary.warning_count, 1);
        assert_eq!(summary.invoke_failure_count, 1);
        assert_eq!(summary.recent_issues.len(), 1);
        assert_eq!(summary.recent_issues[0].event, "invoke.failed");
    }
}
