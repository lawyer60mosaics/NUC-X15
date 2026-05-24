use std::{
    env,
    ffi::OsString,
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{self, Command, Stdio},
    sync::OnceLock,
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use serde_json::Value;
use tauri::{
    image::Image,
    menu::{MenuBuilder, MenuItemBuilder},
    tray::TrayIconBuilder,
    Manager,
};

use crate::plug::{
    config::get_config_dir,
    diagnostics::{app_log, frontend_heartbeat_path},
};

const EXTERNAL_SENTINEL_ARG: &str = "--nuctool-external-sentinel";
const PARENT_PID_ARG: &str = "--parent-pid";
const APP_EXE_ARG: &str = "--app-exe";
const CHECK_INTERVAL_MS: u64 = 3_000;
const HEARTBEAT_STALE_MS: u64 = 45_000;
const STARTUP_GRACE_MS: u64 = 75_000;
const RESUME_GAP_MS: u64 = 30_000;
const RESUME_GRACE_MS: u64 = 60_000;
const MAIN_LOCK_FILE: &str = "main_instance.lock";

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

static MAIN_INSTANCE_LOCK: OnceLock<File> = OnceLock::new();

pub fn acquire_main_instance_lock() -> bool {
    let lock_path = get_config_dir().join(MAIN_LOCK_FILE);
    if let Some(parent) = lock_path.parent() {
        let _ = fs::create_dir_all(parent);
    }

    for _ in 0..2 {
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&lock_path)
        {
            Ok(mut file) => {
                let _ = write!(
                    file,
                    "{{\"pid\":{},\"started_ms\":{}}}",
                    process::id(),
                    now_ms_u64()
                );
                let _ = file.flush();
                let _ = MAIN_INSTANCE_LOCK.set(file);
                app_log(
                    "app",
                    "info",
                    "single_instance.locked",
                    format!("pid={} path={}", process::id(), lock_path.display()),
                );
                return true;
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                if let Some(pid) = read_lock_pid(&lock_path) {
                    if process_alive(pid) {
                        app_log(
                            "app",
                            "warn",
                            "single_instance.exit",
                            format!("existing_pid={} current_pid={}", pid, process::id()),
                        );
                        return false;
                    }
                }

                app_log(
                    "app",
                    "warn",
                    "single_instance.stale_lock",
                    format!("path={}", lock_path.display()),
                );
                let _ = fs::remove_file(&lock_path);
            }
            Err(error) => {
                app_log(
                    "app",
                    "error",
                    "single_instance.lock_failed",
                    format!("path={} error={}", lock_path.display(), error),
                );
                return true;
            }
        }
    }

    false
}

pub fn maybe_run_external_sentinel_from_args() -> bool {
    let args: Vec<OsString> = env::args_os().collect();
    if !args.iter().any(|arg| arg == EXTERNAL_SENTINEL_ARG) {
        return false;
    }

    let parent_pid = arg_value(&args, PARENT_PID_ARG)
        .and_then(|value| value.to_string_lossy().parse::<u32>().ok())
        .unwrap_or(0);
    let app_exe = arg_value(&args, APP_EXE_ARG)
        .map(PathBuf::from)
        .or_else(|| env::current_exe().ok());

    run_external_sentinel_tray(parent_pid, app_exe);
    true
}

pub fn start_external_sentinel() {
    let exe = match env::current_exe() {
        Ok(exe) => exe,
        Err(error) => {
            app_log(
                "external_sentinel",
                "error",
                "spawn.failed",
                format!("current_exe error={}", error),
            );
            return;
        }
    };

    let parent_pid = process::id().to_string();
    let mut command = Command::new(&exe);
    command
        .arg(EXTERNAL_SENTINEL_ARG)
        .arg(PARENT_PID_ARG)
        .arg(&parent_pid)
        .arg(APP_EXE_ARG)
        .arg(&exe)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    match command.spawn() {
        Ok(child) => app_log(
            "external_sentinel",
            "info",
            "spawn.ok",
            format!("pid={} parent_pid={}", child.id(), parent_pid),
        ),
        Err(error) => app_log(
            "external_sentinel",
            "error",
            "spawn.failed",
            format!("error={}", error),
        ),
    }
}

fn arg_value(args: &[OsString], name: &str) -> Option<OsString> {
    args.windows(2)
        .find(|pair| pair.first().is_some_and(|arg| arg == name))
        .and_then(|pair| pair.get(1).cloned())
}

fn run_external_sentinel_tray(parent_pid: u32, app_exe: Option<PathBuf>) {
    let app_exe_for_setup = app_exe.clone();
    let result = tauri::Builder::default()
        .setup(move |app| {
            for label in ["main", "tdp"] {
                if let Some(window) = app.get_webview_window(label) {
                    let _ = window.hide();
                }
            }

            let status =
                MenuItemBuilder::with_id("status", format!("哨兵运行中，监控 PID {}", parent_pid))
                    .enabled(false)
                    .build(app)?;
            let restart = MenuItemBuilder::with_id("restart", "重启主程序").build(app)?;
            let quit = MenuItemBuilder::with_id("quit", "退出哨兵").build(app)?;
            let menu = MenuBuilder::new(app)
                .items(&[&status, &restart, &quit])
                .build()?;

            let mut tray_builder = TrayIconBuilder::with_id("sentinel_tray")
                .menu(&menu)
                .tooltip(format!("NUCtool 哨兵：正在监控 PID {}", parent_pid))
                .show_menu_on_left_click(true);
            tray_builder = tray_builder.icon(sentinel_tray_icon());

            let app_exe_for_menu = app_exe_for_setup.clone();
            let _tray = tray_builder
                .on_menu_event(move |_app, event| match event.id().as_ref() {
                    "restart" => {
                        app_log(
                            "external_sentinel",
                            "warn",
                            "tray.restart_requested",
                            format!("parent_pid={}", parent_pid),
                        );
                        restart_app(parent_pid, app_exe_for_menu.as_deref(), true);
                        process::exit(0);
                    }
                    "quit" => {
                        app_log(
                            "external_sentinel",
                            "warn",
                            "tray.quit_requested",
                            format!("parent_pid={}", parent_pid),
                        );
                        process::exit(0);
                    }
                    _ => {}
                })
                .build(app)?;

            let app_exe_for_monitor = app_exe_for_setup.clone();
            thread::spawn(move || {
                run_external_sentinel(parent_pid, app_exe_for_monitor);
                process::exit(0);
            });
            Ok(())
        })
        .run(tauri::generate_context!());

    if let Err(error) = result {
        app_log(
            "external_sentinel",
            "error",
            "tray.failed",
            format!("error={}", error),
        );
        run_external_sentinel(parent_pid, app_exe);
    }
}

fn sentinel_tray_icon() -> Image<'static> {
    Image::new(include_bytes!("../../icons/sentinel-tray.rgba"), 32, 32)
}

fn run_external_sentinel(parent_pid: u32, app_exe: Option<PathBuf>) {
    app_log(
        "external_sentinel",
        "info",
        "start",
        format!(
            "parent_pid={} heartbeat_stale_ms={} startup_grace_ms={}",
            parent_pid, HEARTBEAT_STALE_MS, STARTUP_GRACE_MS
        ),
    );

    let boot = Instant::now();
    let mut last_check = Instant::now();
    let mut resume_grace_until: Option<Instant> = None;

    loop {
        thread::sleep(Duration::from_millis(CHECK_INTERVAL_MS));

        let now = Instant::now();
        let check_gap = now.saturating_duration_since(last_check);
        last_check = now;
        if check_gap > Duration::from_millis(RESUME_GAP_MS) {
            resume_grace_until = Some(now + Duration::from_millis(RESUME_GRACE_MS));
            app_log(
                "external_sentinel",
                "info",
                "resume_gap",
                format!("gap_ms={}", check_gap.as_millis()),
            );
            continue;
        }

        let parent_alive = process_alive(parent_pid);
        let heartbeat = read_heartbeat_state(&frontend_heartbeat_path());
        let heartbeat_age_ms = heartbeat
            .modified_ms
            .and_then(|modified| now_ms_u64().checked_sub(modified));
        let heartbeat_belongs_to_parent = heartbeat.owner_pid == Some(parent_pid);

        if let Some(owner_pid) = heartbeat.owner_pid {
            if owner_pid != parent_pid {
                if boot.elapsed() < Duration::from_millis(STARTUP_GRACE_MS) {
                    continue;
                }

                if process_alive(owner_pid) {
                    app_log(
                        "external_sentinel",
                        "info",
                        "superseded_exit",
                        format!(
                            "parent_pid={} heartbeat_owner_pid={} last_heartbeat={:?}",
                            parent_pid, owner_pid, heartbeat
                        ),
                    );
                    return;
                }

                app_log(
                    "external_sentinel",
                    "info",
                    "stale_heartbeat_owner_ignored",
                    format!(
                        "parent_pid={} stale_owner_pid={} last_heartbeat={:?}",
                        parent_pid, owner_pid, heartbeat
                    ),
                );
                continue;
            }
        }

        if !parent_alive {
            if heartbeat_belongs_to_parent && heartbeat.running.unwrap_or(false) {
                app_log(
                    "external_sentinel",
                    "warn",
                    "parent_missing_restart",
                    format!("parent_pid={} last_heartbeat={:?}", parent_pid, heartbeat),
                );
                restart_app(parent_pid, app_exe.as_deref(), false);
            } else {
                app_log(
                    "external_sentinel",
                    "info",
                    "parent_missing_exit",
                    format!("parent_pid={} last_heartbeat={:?}", parent_pid, heartbeat),
                );
            }
            return;
        }

        if boot.elapsed() < Duration::from_millis(STARTUP_GRACE_MS) {
            continue;
        }

        if resume_grace_until.is_some_and(|until| now < until) {
            continue;
        }

        let Some(age_ms) = heartbeat_age_ms else {
            continue;
        };
        if !heartbeat_belongs_to_parent {
            continue;
        }
        if age_ms < HEARTBEAT_STALE_MS {
            continue;
        }

        app_log(
            "external_sentinel",
            "error",
            "frontend_stale_restart",
            format!(
                "parent_pid={} heartbeat_age_ms={} seq={:?} visible={:?} focused={:?} running={:?}",
                parent_pid,
                age_ms,
                heartbeat.seq,
                heartbeat.visible,
                heartbeat.focused,
                heartbeat.running
            ),
        );
        restart_app(parent_pid, app_exe.as_deref(), true);
        return;
    }
}

#[derive(Debug, Default)]
struct HeartbeatState {
    modified_ms: Option<u64>,
    owner_pid: Option<u32>,
    seq: Option<u64>,
    visible: Option<bool>,
    focused: Option<bool>,
    running: Option<bool>,
}

fn read_heartbeat_state(path: &Path) -> HeartbeatState {
    let modified_ms = fs::metadata(path)
        .ok()
        .and_then(|metadata| metadata.modified().ok())
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64);

    let value = fs::read_to_string(path)
        .ok()
        .and_then(|content| serde_json::from_str::<Value>(&content).ok());

    HeartbeatState {
        modified_ms,
        owner_pid: value
            .as_ref()
            .and_then(|value| value.get("owner_pid"))
            .and_then(Value::as_u64)
            .and_then(|pid| u32::try_from(pid).ok()),
        seq: value
            .as_ref()
            .and_then(|value| value.get("seq"))
            .and_then(Value::as_u64),
        visible: value
            .as_ref()
            .and_then(|value| value.get("visible"))
            .and_then(Value::as_bool),
        focused: value
            .as_ref()
            .and_then(|value| value.get("focused"))
            .and_then(Value::as_bool),
        running: value
            .as_ref()
            .and_then(|value| value.get("running"))
            .and_then(Value::as_bool),
    }
}

fn restart_app(parent_pid: u32, app_exe: Option<&Path>, kill_parent: bool) {
    if kill_parent {
        kill_process(parent_pid);
    }

    let Some(app_exe) = app_exe else {
        app_log(
            "external_sentinel",
            "error",
            "restart.failed",
            "app_exe missing",
        );
        return;
    };

    let mut command = Command::new(app_exe);
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    match command.spawn() {
        Ok(child) => app_log(
            "external_sentinel",
            "warn",
            "restart.spawned",
            format!("new_pid={} app_exe={}", child.id(), app_exe.display()),
        ),
        Err(error) => app_log(
            "external_sentinel",
            "error",
            "restart.failed",
            format!("app_exe={} error={}", app_exe.display(), error),
        ),
    }
}

pub(crate) fn process_alive(pid: u32) -> bool {
    if pid == 0 {
        return false;
    }

    #[cfg(windows)]
    {
        let filter = format!("PID eq {}", pid);
        let mut command = Command::new("tasklist");
        command
            .arg("/FI")
            .arg(filter)
            .arg("/FO")
            .arg("CSV")
            .arg("/NH")
            .stdin(Stdio::null())
            .stderr(Stdio::null());
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
        let output = match command.output() {
            Ok(output) => output,
            Err(_) => return true,
        };
        let stdout = String::from_utf8_lossy(&output.stdout);
        stdout.contains(&format!(",\"{}\",", pid)) || stdout.contains(&format!(",{},", pid))
    }

    #[cfg(not(windows))]
    {
        PathBuf::from(format!("/proc/{}", pid)).exists()
    }
}

fn read_lock_pid(path: &Path) -> Option<u32> {
    let mut content = String::new();
    File::open(path).ok()?.read_to_string(&mut content).ok()?;
    serde_json::from_str::<Value>(&content)
        .ok()?
        .get("pid")?
        .as_u64()
        .and_then(|pid| u32::try_from(pid).ok())
}

fn kill_process(pid: u32) {
    if pid == 0 {
        return;
    }

    #[cfg(windows)]
    {
        let mut command = Command::new("taskkill");
        command
            .arg("/PID")
            .arg(pid.to_string())
            .arg("/F")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
        match command.status() {
            Ok(status) => app_log(
                "external_sentinel",
                "warn",
                "parent.kill",
                format!("pid={} status={}", pid, status),
            ),
            Err(error) => app_log(
                "external_sentinel",
                "error",
                "parent.kill_failed",
                format!("pid={} error={}", pid, error),
            ),
        }
    }

    #[cfg(not(windows))]
    {
        let _ = Command::new("kill")
            .arg("-TERM")
            .arg(pid.to_string())
            .status();
    }
}

fn now_ms_u64() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

#[allow(dead_code)]
fn external_sentinel_state_path() -> PathBuf {
    get_config_dir().join("external_sentinel.state.json")
}
