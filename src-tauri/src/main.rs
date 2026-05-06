#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]
use std::{
    env,
    thread,
    sync::{Arc, RwLock}
};
use tauri::Emitter;
use tauri_plugin_autostart::MacosLauncher;

#[cfg(windows)]
mod win_plug;
#[cfg(unix)]
mod linux_plug;
mod plug;
mod commands;
mod tests;

use plug::{
    setup,
    struct_set::{FanControlState, FanActorSnapshot},
    fan::{fan_reset, init_snapshot},
    diagnostics::{app_log, start_frontend_watchdog},
};
use commands::{
    autostart::{autostart_set, autostart_status},
    config::{
        export_monitor_log_csv,
        list_fan_profiles,
        load_fan_config,
        load_fan_profile,
        save_fan_config,
        save_fan_profile,
    },
    fan::{
        get_current_fan_mode,
        get_fan_control_snapshot,
        get_fan_speeds,
        start_fan_control,
        stop_fan_control,
        update_fan_policy,
    },
    tdp::{get_rgb, get_rgb_color, get_tdp, lock_cpu_tdp, set_cpu_tdp, set_rgb, set_rgb_color_n, set_rgb_color_y, set_tdp},
    diagnostics::{frontend_diag_log, frontend_heartbeat, get_diagnostic_log_path},
};

#[cfg(windows)]
use win_plug::{
    permissions::privilege_escalation,
    wmi::wmi_security,
};
#[cfg(unix)]
use linux_plug::{
    sysfs::sys_init,
};

fn main() {
    app_log("app", "info", "main.start", "application entry");
    #[cfg(debug_assertions)]
    let devtools = tauri_plugin_devtools::init();
    #[cfg(debug_assertions)]
    let mut builder = tauri::Builder::default();
    #[cfg(not(debug_assertions))]
    let builder = tauri::Builder::default();
    #[cfg(debug_assertions)]
    {
        builder = builder.plugin(devtools);
    }
    #[cfg(windows)]
    privilege_escalation();
    #[cfg(windows)]
    thread::spawn(move || {
        app_log("startup", "info", "wmi_security.start", "initializing WMI security and fan reset");
        wmi_security();
        // fan_reset 超时保护：避免 WMI 初始化挂死阻塞启动
        let (tx, rx) = std::sync::mpsc::channel::<()>();
        std::thread::spawn(move || {
            app_log("startup", "info", "fan_reset.start", "initializing COM and resetting fan mode");
            plug::fan::init_com_on_thread();
            fan_reset();
            app_log("startup", "info", "fan_reset.done", "fan reset thread finished");
            let _ = tx.send(());
        });
        match rx.recv_timeout(std::time::Duration::from_secs(15)) {
            Ok(_) => app_log("startup", "info", "fan_reset.ack", "fan reset completed within timeout"),
            Err(e) => app_log("startup", "warn", "fan_reset.timeout", format!("fan reset did not finish in 15s: {}", e)),
        }
    });
    #[cfg(unix)]
    sys_init();
    let snapshot = Arc::new(RwLock::new(FanActorSnapshot::default()));
    init_snapshot(snapshot.clone());
    let fan_control_state = FanControlState;
    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec![]), ))
        .manage(fan_control_state)
        .setup(|app| {
            start_frontend_watchdog(app.handle().clone());
            setup::init(app)
        })
        .invoke_handler(tauri::generate_handler![
            start_fan_control,
            stop_fan_control,
            update_fan_policy,
            get_fan_control_snapshot,
            get_current_fan_mode,
            save_fan_config,
            load_fan_config,
            save_fan_profile,
            load_fan_profile,
            list_fan_profiles,
            export_monitor_log_csv,
            get_fan_speeds,
            get_tdp,
            set_tdp,
            set_cpu_tdp,
            lock_cpu_tdp,
            set_rgb,
            get_rgb,
            set_rgb_color_y,
            set_rgb_color_n,
            get_rgb_color,
            autostart_status,
            autostart_set,
            frontend_diag_log,
            frontend_heartbeat,
            get_diagnostic_log_path
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Focused(true) = event {
                app_log("window", "info", "focused", "emitting nuctool-resume focus");
                let _ = window.emit("nuctool-resume", "focus");
            }
            if let tauri::WindowEvent::Resized(_) = event {
                app_log("window", "debug", "resized", "emitting nuctool-resume resize");
                let _ = window.emit("nuctool-resume", "resize");
            }
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                app_log("window", "info", "close_requested", "hiding window to tray");
                // 关闭时隐藏到托盘，不退出程序
                window.hide().unwrap();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .unwrap();
}
