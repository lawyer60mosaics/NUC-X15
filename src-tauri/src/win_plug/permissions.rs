use powershell_script::PsScriptBuilder;
use std::{env, process};

use crate::plug::diagnostics::app_log;

/*
 * @Author: cyear
 * @Create time: 2025-01-30
 * @Description:
 * @Version: 0.3.5
 */

#[expect(
    dead_code,
    reason = "Privilege escalation is only called in release builds."
)]
pub fn privilege_escalation() {
    let ps = PsScriptBuilder::new()
        .no_profile(true)
        .non_interactive(true)
        .hidden(true)
        .print_commands(false)
        .build();
    let script = r#"if (([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { Write-Output "1" } else { Write-Output "0" }"#;
    let out = match ps.run(script) {
        Ok(out) => out,
        Err(e) => {
            app_log(
                "startup",
                "warn",
                "privilege_check.failed",
                format!("error={}", e),
            );
            return;
        }
    };

    app_log(
        "startup",
        "debug",
        "privilege_check.done",
        format!("output={}", out.to_string().trim()),
    );
    if out.to_string().trim().parse::<i64>().unwrap_or(0) != 0 {
        return;
    }

    let Ok(path) = env::current_exe() else {
        app_log(
            "startup",
            "warn",
            "privilege_restart.path_failed",
            "current_exe unavailable",
        );
        return;
    };
    let path_str = path.to_string_lossy();
    match ps.run(format!(r#"Start-Process "{}" -Verb RunAs"#, path_str).as_str()) {
        Ok(_) => {
            app_log(
                "startup",
                "info",
                "privilege_restart.started",
                "requested elevated restart",
            );
            process::exit(0);
        }
        Err(e) => {
            app_log(
                "startup",
                "warn",
                "privilege_restart.failed",
                format!("error={}", e),
            );
        }
    }
}
