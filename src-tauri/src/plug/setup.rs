use std::error::Error;
use std::{fs, process, thread, time::Duration};
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::plugin::PermissionState;
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{App, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::plug::{config::get_config_dir, diagnostics::app_log, fan::fan_reset};

async fn update(app: tauri::AppHandle) -> tauri_plugin_updater::Result<()> {
    let up: Update;
    match app.updater() {
        Ok(a) => match a.check().await {
            Ok(Some(update)) => {
                up = update;
            }
            Err(e) => {
                println!("update check failed: {:#?}", e);
                return Ok(());
            }
            _ => return Ok(()),
        },
        Err(e) => {
            println!("Updater Error: {:#?}", e);
            return Ok(());
        }
    }
    println!("update found: {:#?}", up.body);
    let update_body = up
        .body
        .clone()
        .unwrap_or_else(|| "A new NUCtool update is available.".to_string());
    app.dialog()
        .message(update_body.as_str())
        .title("NUCtool 有新版本 v".to_owned() + up.clone().version.as_str())
        .buttons(MessageDialogButtons::OkCancelCustom(
            "更新".to_string(),
            "取消".to_string(),
        ))
        .show(|yes| match yes {
            true => {
                tauri::async_runtime::spawn(async move {
                    let mut downloaded = 0;
                    let result = up
                        .download_and_install(
                            |chunk_length, content_length| {
                                downloaded += chunk_length;
                                println!("downloaded {downloaded} from {content_length:?}");
                            },
                            || {
                                println!("download finished");
                            },
                        )
                        .await;
                    match result {
                        Ok(_) => {
                            println!("update installed");
                            app.restart();
                        }
                        Err(e) => {
                            println!("download failed: {:#?}", e);
                        }
                    }
                });
            }
            false => {
                println!("update canceled")
            }
        });
    Ok(())
}

pub fn init(app: &mut App) -> Result<(), Box<dyn Error>> {
    #[cfg(debug_assertions)] // only include this code on debug builds
    {
        if let Some(window) = app.get_webview_window("main") {
            window.open_devtools();
            window.close_devtools();
        }
    }
    let handle = app.handle().clone();
    tauri::async_runtime::spawn(async move {
        match update(handle).await {
            Ok(_) => {}
            Err(e) => {
                println!("update error: {:#?}", e);
            }
        }
    });
    let config_dir = get_config_dir();
    fs::create_dir_all(&config_dir)?;
    app_log(
        "autostart",
        "info",
        "startup.preserve_user_setting",
        format!("config_dir={}", config_dir.display()),
    );
    let Some(window) = app.get_webview_window("main") else {
        return Err("main webview window not found".into());
    };
    let _ = window.set_size(tauri::LogicalSize::new(1200.0, 780.0));
    let _ = window.set_min_size(Some(tauri::LogicalSize::new(680.0, 480.0)));
    let _ = window.center();
    let h = MenuItemBuilder::with_id("h", "显示界面").build(app)?;
    let q = MenuItemBuilder::with_id("q", "退出程序").build(app)?;
    let d = MenuItemBuilder::with_id("d", "调试模式").build(app)?;
    let menu = MenuBuilder::new(app).items(&[&h, &d, &q]).build()?;
    let mut tray_builder = TrayIconBuilder::with_id("main_tray")
        .menu(&menu)
        .show_menu_on_left_click(false);
    if let Some(icon) = app.default_window_icon() {
        tray_builder = tray_builder.icon(icon.clone());
    }
    let _tray = tray_builder
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "h" => {
                println!("显示 clicked");
                if let Some(webview_window) = app.get_webview_window("main") {
                    let _ = webview_window.show();
                    let _ = webview_window.set_focus();
                }
            }
            "q" => {
                if app
                    .notification()
                    .permission_state()
                    .unwrap_or(PermissionState::Denied)
                    == PermissionState::Granted
                {
                    let _ = app.notification().builder().body("安全退出！").show();
                }
                thread::spawn(move || {
                    thread::sleep(Duration::from_secs(1));
                    fan_reset();
                    println!("退出");
                    process::exit(0);
                });
            }
            "d" => {
                if let Some(webview_window) = app.get_webview_window("tdp") {
                    let _ = webview_window.show();
                    let _ = webview_window.set_focus();
                }
            }
            _ => (),
        })
        .on_tray_icon_event(|tray, event| match event {
            TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } => {
                println!("left click pressed and released");
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            _ => {
                // println!("unhandled event {event:?}");
            }
        })
        .build(app)?;
    #[cfg(windows)]
    if let Err(e) = window_vibrancy::apply_acrylic(&window, Some((18, 18, 18, 125))) {
        println!("apply_acrylic main failed: {:?}", e);
    }
    #[cfg(windows)]
    if let Some(tdp_window) = app.get_webview_window("tdp") {
        if let Err(e) = window_vibrancy::apply_acrylic(tdp_window, Some((18, 18, 18, 125))) {
            println!("apply_acrylic tdp failed: {:?}", e);
        }
    }
    Ok(())
}
