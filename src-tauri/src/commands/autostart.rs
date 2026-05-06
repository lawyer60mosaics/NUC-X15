use tauri_plugin_autostart::ManagerExt;

#[tauri::command]
pub async fn autostart_status(app: tauri::AppHandle) -> Result<bool, String> {
    let mgr = app.autolaunch();
    mgr.is_enabled().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn autostart_set(app: tauri::AppHandle, enable: bool) -> Result<bool, String> {
    let mgr = app.autolaunch();
    let res = if enable { mgr.enable() } else { mgr.disable() };
    res.map_err(|e| e.to_string())?;
    mgr.is_enabled().map_err(|e| e.to_string())
}
