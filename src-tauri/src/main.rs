#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]
use std::{
    env,
    sync::{Arc, RwLock},
    thread,
};
use tauri_plugin_autostart::MacosLauncher;

mod commands;
#[cfg(unix)]
mod linux_plug;
mod plug;
mod tests;
#[cfg(windows)]
mod win_plug;

use commands::{
    autostart::{autostart_set, autostart_status},
    config::{
        export_monitor_log_csv, list_fan_profiles, load_fan_config, load_fan_profile,
        save_fan_config, save_fan_profile,
    },
    diagnostics::{
        frontend_diag_log, frontend_heartbeat, get_diagnostic_log_path, get_diagnostic_summary,
    },
    fan::{
        force_fan_sentinel_restart, get_current_fan_mode, get_fan_control_snapshot, get_fan_speeds,
        start_fan_control, stop_fan_control, update_fan_policy,
    },
    tdp::{
        apply_display_scene_profile, apply_system_power_profile, get_display_refresh_status,
        get_rgb, get_rgb_color, get_tdp, lock_cpu_tdp, lock_tdp, set_cpu_tdp,
        set_display_refresh_rate, set_gpu_clock_limit, set_rgb, set_rgb_color_n, set_rgb_color_y,
        set_tdp,
    },
    vendor::{
        apply_vendor_battery, apply_vendor_lighting, apply_vendor_whisper,
        get_vendor_service_status,
    },
};
use plug::{
    config::saved_startup_takeover_enabled,
    diagnostics::{app_log, start_frontend_watchdog},
    fan::{fan_reset, init_snapshot, start_fan_sentinel},
    process_sentinel::{
        acquire_main_instance_lock, maybe_run_external_sentinel_from_args, start_external_sentinel,
    },
    setup,
    struct_set::{FanActorSnapshot, FanControlState},
};

#[cfg(unix)]
use linux_plug::sysfs::sys_init;
#[cfg(all(windows, debug_assertions))]
use win_plug::wmi::wmi_security;
#[cfg(all(windows, not(debug_assertions)))]
use win_plug::{permissions::privilege_escalation, wmi::wmi_security};

fn main() {
    if std::env::args().any(|arg| arg == "--nuctool-wmi-helper") {
        #[cfg(windows)]
        win_plug::wmi::run_wmi_helper_loop();
        #[cfg(not(windows))]
        std::process::exit(0);
    }

    if maybe_run_external_sentinel_from_args() {
        return;
    }

    app_log("app", "info", "main.start", "application entry");
    if !acquire_main_instance_lock() {
        return;
    }
    #[cfg(windows)]
    start_external_sentinel();
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
    #[cfg(all(windows, not(debug_assertions)))]
    privilege_escalation();
    #[cfg(windows)]
    thread::spawn(move || {
        app_log(
            "startup",
            "info",
            "wmi_security.start",
            "initializing WMI security",
        );
        wmi_security();
        if saved_startup_takeover_enabled() {
            app_log(
                "startup",
                "info",
                "fan_reset.skipped",
                "startup takeover is enabled; keeping existing fan control until frontend resumes",
            );
            return;
        }
        // fan_reset 超时保护：避免 WMI 初始化挂死阻塞启动
        let (tx, rx) = std::sync::mpsc::channel::<()>();
        std::thread::spawn(move || {
            app_log(
                "startup",
                "info",
                "fan_reset.start",
                "initializing COM and resetting fan mode",
            );
            plug::fan::init_com_on_thread();
            fan_reset();
            app_log(
                "startup",
                "info",
                "fan_reset.done",
                "fan reset thread finished",
            );
            let _ = tx.send(());
        });
        match rx.recv_timeout(std::time::Duration::from_secs(15)) {
            Ok(_) => app_log(
                "startup",
                "info",
                "fan_reset.ack",
                "fan reset completed within timeout",
            ),
            Err(e) => app_log(
                "startup",
                "warn",
                "fan_reset.timeout",
                format!("fan reset did not finish in 15s: {}", e),
            ),
        }
    });
    #[cfg(unix)]
    sys_init();
    let snapshot = Arc::new(RwLock::new(FanActorSnapshot::default()));
    init_snapshot(snapshot.clone());
    start_fan_sentinel();
    let fan_control_state = FanControlState;
    app_log(
        "app",
        "info",
        "builder.configure.start",
        "configuring tauri builder",
    );
    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        .manage(fan_control_state)
        .setup(|app| {
            app_log("app", "info", "setup.start", "entering tauri setup");
            start_frontend_watchdog(app.handle().clone());
            let result = setup::init(app);
            match &result {
                Ok(()) => app_log("app", "info", "setup.done", "tauri setup completed"),
                Err(e) => app_log("app", "error", "setup.failed", format!("error={}", e)),
            }
            result
        })
        .invoke_handler(tauri::generate_handler![
            start_fan_control,
            force_fan_sentinel_restart,
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
            lock_tdp,
            set_cpu_tdp,
            lock_cpu_tdp,
            apply_system_power_profile,
            get_display_refresh_status,
            set_display_refresh_rate,
            apply_display_scene_profile,
            set_gpu_clock_limit,
            set_rgb,
            get_rgb,
            set_rgb_color_y,
            set_rgb_color_n,
            get_rgb_color,
            autostart_status,
            autostart_set,
            frontend_diag_log,
            frontend_heartbeat,
            get_diagnostic_log_path,
            get_diagnostic_summary,
            apply_vendor_battery,
            apply_vendor_lighting,
            apply_vendor_whisper,
            get_vendor_service_status
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                app_log("window", "info", "close_requested", "hiding window to tray");
                // 关闭时隐藏到托盘，不退出程序
                if let Err(e) = window.hide() {
                    app_log("window", "warn", "hide_failed", format!("error={}", e));
                }
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .unwrap_or_else(|e| {
            app_log("app", "error", "run.failed", format!("error={}", e));
        });
}
