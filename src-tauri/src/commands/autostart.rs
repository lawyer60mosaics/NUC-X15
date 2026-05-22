use crate::plug::diagnostics::app_log;
use tauri_plugin_autostart::ManagerExt;

#[tauri::command]
pub async fn autostart_status(app: tauri::AppHandle) -> Result<bool, String> {
    let mgr = app.autolaunch();
    match mgr.is_enabled() {
        Ok(enabled) => {
            app_log(
                "autostart",
                "info",
                "status",
                format!("enabled={}", enabled),
            );
            Ok(enabled)
        }
        Err(error) => {
            app_log(
                "autostart",
                "error",
                "status.failed",
                format!("error={}", error),
            );
            Err(error.to_string())
        }
    }
}

#[tauri::command]
pub async fn autostart_set(app: tauri::AppHandle, enable: bool) -> Result<bool, String> {
    let mgr = app.autolaunch();
    let res = if enable { mgr.enable() } else { mgr.disable() };
    if let Err(error) = res {
        app_log(
            "autostart",
            "error",
            "set.failed",
            format!("requested={} error={}", enable, error),
        );
        return Err(error.to_string());
    }

    match mgr.is_enabled() {
        Ok(enabled) => {
            app_log(
                "autostart",
                if enabled == enable { "info" } else { "warn" },
                "set.done",
                format!("requested={} enabled={}", enable, enabled),
            );
            Ok(enabled)
        }
        Err(error) => {
            app_log(
                "autostart",
                "error",
                "set.verify_failed",
                format!("requested={} error={}", enable, error),
            );
            Err(error.to_string())
        }
    }
}
