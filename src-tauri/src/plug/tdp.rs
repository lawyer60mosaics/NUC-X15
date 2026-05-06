/**
* @Author: cyear
* @Create time: 2025-02-28
* @Description:
* @Version: 1
**/
use crate::plug::{struct_set::{RGB, TDP}, fan, diagnostics::app_log};

#[tauri::command]
pub async fn get_tdp() -> Result<(i64, i64, i64, i64, i64), String> {
    app_log("command", "debug", "get_tdp.start", "");
    let started = std::time::Instant::now();
    let result = tauri::async_runtime::spawn_blocking(fan::request_tdp)
        .await
        .map_err(|e| format!("TDP task failed: {}", e))?;
    app_log("command", if result.is_ok() { "debug" } else { "warn" }, "get_tdp.done", format!("elapsed_ms={} result={:?}", started.elapsed().as_millis(), result));
    result
}

#[tauri::command]
pub async fn set_tdp(t: TDP) -> Result<bool, String> {
    app_log("command", "info", "set_tdp.start", format!("cpu={}W/{}W gpu={}W/{}W tcc={}", t.cpu1, t.cpu2, t.gpu1, t.gpu2, t.tcc));
    let started = std::time::Instant::now();
    let result = tauri::async_runtime::spawn_blocking(move || fan::request_set_tdp(t))
        .await
        .map_err(|e| format!("TDP task failed: {}", e))?;
    app_log("command", if result == Ok(true) { "info" } else { "warn" }, "set_tdp.done", format!("elapsed_ms={} result={:?}", started.elapsed().as_millis(), result));
    result
}

#[tauri::command]
pub async fn set_cpu_tdp(cpu1: i64, cpu2: i64) -> Result<bool, String> {
    app_log("command", "info", "set_cpu_tdp.start", format!("cpu={}W/{}W", cpu1, cpu2));
    let started = std::time::Instant::now();
    let result = tauri::async_runtime::spawn_blocking(move || fan::request_set_cpu_tdp(cpu1, cpu2))
        .await
        .map_err(|e| format!("CPU TDP task failed: {}", e))?;
    app_log("command", if result == Ok(true) { "info" } else { "warn" }, "set_cpu_tdp.done", format!("elapsed_ms={} result={:?}", started.elapsed().as_millis(), result));
    result
}

#[tauri::command]
pub async fn lock_cpu_tdp(cpu1: i64, cpu2: i64) -> Result<bool, String> {
    app_log("command", "info", "lock_cpu_tdp.start", format!("cpu={}W/{}W", cpu1, cpu2));
    let started = std::time::Instant::now();
    let result = tauri::async_runtime::spawn_blocking(move || fan::request_lock_cpu_tdp(cpu1, cpu2))
        .await
        .map_err(|e| format!("CPU TDP lock task failed: {}", e))?;
    app_log("command", if result == Ok(true) { "info" } else { "warn" }, "lock_cpu_tdp.done", format!("elapsed_ms={} result={:?}", started.elapsed().as_millis(), result));
    result
}

#[tauri::command]
#[cfg(windows)]
pub async fn set_rgb(rgb: RGB) {
    println!("{:#?}", rgb);
}

#[tauri::command]
#[cfg(windows)]
pub async fn get_rgb() -> RGB {
    RGB {
        r: 0,
        g: 0,
        b: 0
    }
}

#[tauri::command]
#[cfg(unix)]
pub async fn set_rgb(rgb: RGB) {
    println!("{:#?}", rgb);
}

#[tauri::command]
#[cfg(unix)]
pub async fn get_rgb() -> RGB {
    RGB {
        r: 0,
        g: 0,
        b: 0
    }
}

#[tauri::command]
#[cfg(windows)]
pub async fn set_rgb_color_y() {
    let _ = tauri::async_runtime::spawn_blocking(|| fan::request_set_rgb_color_y()).await;
}

#[tauri::command]
#[cfg(windows)]
pub async fn set_rgb_color_n() {
    let _ = tauri::async_runtime::spawn_blocking(|| fan::request_set_rgb_color_n()).await;
}

#[tauri::command]
#[cfg(windows)]
pub async fn get_rgb_color() -> bool {
    tauri::async_runtime::spawn_blocking(|| fan::request_get_rgb_color().unwrap_or(false))
        .await
        .unwrap_or(false)
}

#[tauri::command]
#[cfg(unix)]
pub async fn set_rgb_color_y() {}

#[tauri::command]
#[cfg(unix)]
pub async fn set_rgb_color_n() {}

#[tauri::command]
#[cfg(unix)]
pub async fn get_rgb_color() -> bool {
    false
}
