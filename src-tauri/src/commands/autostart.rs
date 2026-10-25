use crate::plug::diagnostics::app_log;
use tauri_plugin_autostart::ManagerExt;

#[cfg(windows)]
use std::{os::windows::process::CommandExt, process::Command};

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
#[cfg(windows)]
const AUTOSTART_TASK_NAME: &str = "NUCtool Autostart";

#[cfg(windows)]
fn powershell_escape(value: &str) -> String {
    value.replace('\'', "''")
}

#[cfg(windows)]
fn run_powershell(script: &str) -> Result<(), String> {
    let mut command = Command::new("powershell.exe");
    command
        .args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-WindowStyle",
            "Hidden",
            "-Command",
            script,
        ])
        .creation_flags(CREATE_NO_WINDOW);
    let output = command
        .output()
        .map_err(|error| format!("failed to run PowerShell: {}", error))?;
    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Err(if !stderr.is_empty() {
        stderr
    } else if !stdout.is_empty() {
        stdout
    } else {
        format!("PowerShell exited with status {}", output.status)
    })
}

#[cfg(windows)]
fn scheduled_task_exists() -> bool {
    let task_name = powershell_escape(AUTOSTART_TASK_NAME);
    run_powershell(&format!(
        "$task = Get-ScheduledTask -TaskName '{}' -ErrorAction SilentlyContinue; if ($null -eq $task) {{ exit 1 }}; exit 0",
        task_name
    ))
    .is_ok()
}

#[cfg(windows)]
fn scheduled_task_enabled() -> bool {
    let task_name = powershell_escape(AUTOSTART_TASK_NAME);
    run_powershell(&format!(
        "$task = Get-ScheduledTask -TaskName '{}' -ErrorAction SilentlyContinue; if ($null -eq $task -or $task.State -eq 'Disabled') {{ exit 1 }}; exit 0",
        task_name
    ))
    .is_ok()
}

#[cfg(windows)]
fn create_scheduled_task() -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|error| error.to_string())?;
    let exe = powershell_escape(&exe.to_string_lossy());
    let task_name = powershell_escape(AUTOSTART_TASK_NAME);
    let script = format!(
        "$ErrorActionPreference = 'Stop'; \
         $user = [Security.Principal.WindowsIdentity]::GetCurrent().Name; \
         $action = New-ScheduledTaskAction -Execute '{}' -Argument '--autostart'; \
         $trigger = New-ScheduledTaskTrigger -AtLogOn -User $user; \
         $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Highest; \
         $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero); \
         Register-ScheduledTask -TaskName '{}' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null",
        exe, task_name
    );
    run_powershell(&script)
}

#[cfg(windows)]
fn delete_scheduled_task() -> Result<(), String> {
    if !scheduled_task_exists() {
        return Ok(());
    }
    let task_name = powershell_escape(AUTOSTART_TASK_NAME);
    run_powershell(&format!(
        "$ErrorActionPreference = 'Stop'; Unregister-ScheduledTask -TaskName '{}' -Confirm:$false",
        task_name
    ))
}

pub fn migrate_legacy_autostart(app: &tauri::AppHandle) {
    #[cfg(windows)]
    {
        let manager = app.autolaunch();
        let legacy_enabled = manager.is_enabled().unwrap_or(false);
        if scheduled_task_enabled() {
            if let Err(error) = create_scheduled_task() {
                app_log(
                    "autostart",
                    "warn",
                    "task.refresh_failed",
                    format!("error={}", error),
                );
            }
            if legacy_enabled {
                let _ = manager.disable();
            }
            return;
        }
        if !legacy_enabled {
            return;
        }

        match create_scheduled_task() {
            Ok(()) => match manager.disable() {
                Ok(()) => app_log(
                    "autostart",
                    "info",
                    "legacy.migrated",
                    "migrated registry autostart to elevated scheduled task",
                ),
                Err(error) => app_log(
                    "autostart",
                    "warn",
                    "legacy.remove_failed",
                    format!("error={}", error),
                ),
            },
            Err(error) => app_log(
                "autostart",
                "warn",
                "legacy.migration_failed",
                format!("error={}", error),
            ),
        }
    }

    #[cfg(not(windows))]
    let _ = app;
}

#[tauri::command]
pub async fn autostart_status(app: tauri::AppHandle) -> Result<bool, String> {
    let mgr = app.autolaunch();
    #[cfg(windows)]
    {
        let task_enabled = scheduled_task_enabled();
        let legacy_enabled = mgr.is_enabled().unwrap_or(false);
        let enabled = task_enabled || legacy_enabled;
        app_log(
            "autostart",
            "info",
            "status",
            format!(
                "enabled={} task_enabled={} legacy_enabled={}",
                enabled, task_enabled, legacy_enabled
            ),
        );
        Ok(enabled)
    }
    #[cfg(not(windows))]
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
    #[cfg(windows)]
    let res = if enable {
        create_scheduled_task().and_then(|_| {
            if mgr.is_enabled().unwrap_or(false) {
                mgr.disable().map_err(|error| error.to_string())?;
            }
            Ok(())
        })
    } else {
        delete_scheduled_task().and_then(|_| {
            if mgr.is_enabled().unwrap_or(false) {
                mgr.disable().map_err(|error| error.to_string())?;
            }
            Ok(())
        })
    };
    #[cfg(not(windows))]
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

    #[cfg(windows)]
    let verified: Result<bool, String> =
        Ok(scheduled_task_enabled() || mgr.is_enabled().unwrap_or(false));
    #[cfg(not(windows))]
    let verified: Result<bool, String> = mgr.is_enabled().map_err(|error| error.to_string());

    match verified {
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
