use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};
use std::sync::{
    mpsc::{self, Receiver},
    Mutex, OnceLock,
};
use std::thread;
use std::time::Duration;

use crate::plug::diagnostics::app_log;

struct ActiveProcess {
    child: Child,
    stdin: std::process::ChildStdin,
    rx: Receiver<String>,
}

pub struct WmiClient {
    process: Mutex<Option<ActiveProcess>>,
}

pub static WMI_CLIENT: OnceLock<WmiClient> = OnceLock::new();

impl WmiClient {
    pub fn global() -> &'static Self {
        WMI_CLIENT.get_or_init(|| WmiClient {
            process: Mutex::new(None),
        })
    }

    pub fn send_wmi_set(&self, payload: &str) -> i64 {
        match self.send_command(&format!("set {}", payload)) {
            Ok(val) => val,
            Err(e) => {
                eprintln!("WmiClient send_wmi_set failed: {}", e);
                -1
            }
        }
    }

    pub fn send_get_model(&self) -> i64 {
        match self.send_command("get_model") {
            Ok(model) => model,
            Err(e) => {
                eprintln!("WmiClient send_get_model failed: {}", e);
                0
            }
        }
    }

    pub fn send_command(&self, cmd: &str) -> Result<i64, String> {
        let mut guard = self
            .process
            .lock()
            .map_err(|e| format!("Mutex poisoning: {:?}", e))?;

        // Ensure child is running and initialized
        let active = self.ensure_running(&mut guard)?;

        // Write the command
        if let Err(e) = writeln!(active.stdin, "{}", cmd) {
            eprintln!(
                "WMI helper write failed: {:?}. Attempting self-healing recovery.",
                e
            );
            app_log(
                "wmi_client",
                "warn",
                "ipc.write_failed",
                format!("error={:?}", e),
            );
            // Kill child and reset connection
            let _ = active.child.kill();
            *guard = None;

            // Retry spawning and sending command once
            let new_active = self.ensure_running(&mut guard)?;
            if let Err(e2) = writeln!(new_active.stdin, "{}", cmd) {
                return Err(format!("WMI IPC write failed on retry: {:?}", e2));
            }
        }

        // Get the active process reference (need to borrow after guard mutability)
        let active = guard.as_mut().unwrap();
        if let Err(e) = active.stdin.flush() {
            return Err(format!("WMI IPC flush failed: {:?}", e));
        }

        // Wait for response with a strict 4 seconds timeout limit
        match active.rx.recv_timeout(Duration::from_secs(4)) {
            Ok(response) => {
                let parts: Vec<&str> = response.splitn(2, ' ').collect();
                if parts.is_empty() {
                    return Err("WMI IPC response was empty".to_string());
                }
                match parts[0] {
                    "ok" => Ok(0),
                    "value" => {
                        if parts.len() < 2 {
                            return Err("WMI IPC value response missing payload".to_string());
                        }
                        parts[1]
                            .parse::<i64>()
                            .map_err(|e| format!("Failed to parse value: {:?}", e))
                    }
                    "model" => {
                        if parts.len() < 2 {
                            return Err("WMI IPC model response missing payload".to_string());
                        }
                        parts[1]
                            .parse::<i64>()
                            .map_err(|e| format!("Failed to parse model: {:?}", e))
                    }
                    "err" => {
                        let reason = parts.get(1).copied().unwrap_or("unknown error");
                        Err(format!("WMI helper returned error: {}", reason))
                    }
                    _ => Err(format!(
                        "WMI IPC returned unexpected response: {}",
                        response
                    )),
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                eprintln!("WMI IPC read timed out (4s). Killing child for self-healing recovery.");
                app_log(
                    "wmi_client",
                    "error",
                    "ipc.timeout",
                    "WMI helper timed out, killing process",
                );
                let _ = active.child.kill();
                *guard = None;
                Err("WMI helper call timed out".to_string())
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                eprintln!(
                    "WMI IPC channel disconnected. Killing child for self-healing recovery."
                );
                app_log(
                    "wmi_client",
                    "error",
                    "ipc.disconnected",
                    "WMI helper channel disconnected, resetting",
                );
                let _ = active.child.kill();
                *guard = None;
                Err("WMI helper channel disconnected".to_string())
            }
        }
    }

    fn ensure_running<'a>(
        &self,
        guard: &'a mut Option<ActiveProcess>,
    ) -> Result<&'a mut ActiveProcess, String> {
        if guard.is_none() {
            app_log(
                "wmi_client",
                "info",
                "spawn.start",
                "spawning WMI helper subprocess",
            );
            let exe_path = std::env::current_exe()
                .map_err(|e| format!("Failed to get current executable path: {:?}", e))?;

            // Create command with window flags to hide console window on Windows GUI application spawn.
            // Under std::process::Command on Windows, Stdio::piped() automatically hides console.
            let mut child = Command::new(exe_path)
                .arg("--nuctool-wmi-helper")
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .spawn()
                .map_err(|e| format!("Failed to spawn WMI helper: {:?}", e))?;

            let mut stdin = child.stdin.take().ok_or("Failed to open child stdin")?;
            let stdout = child.stdout.take().ok_or("Failed to open child stdout")?;

            let (tx, rx) = mpsc::channel();

            // Spawn background stdout reader thread
            thread::spawn(move || {
                let reader = BufReader::new(stdout);
                for line in reader.lines() {
                    match line {
                        Ok(l) => {
                            if tx.send(l).is_err() {
                                break; // Receiver dropped
                            }
                        }
                        Err(_) => break, // EOF or pipe broken
                    }
                }
            });

            // Initialize the child WMI/COM context
            if let Err(e) = writeln!(stdin, "init") {
                let _ = child.kill();
                return Err(format!("Failed to write init command to child: {:?}", e));
            }
            if let Err(e) = stdin.flush() {
                let _ = child.kill();
                return Err(format!("Failed to flush init command to child: {:?}", e));
            }

            // Wait for "ok" response from init
            match rx.recv_timeout(Duration::from_secs(4)) {
                Ok(response) => {
                    if response != "ok" {
                        let _ = child.kill();
                        return Err(format!("WMI helper init failed: {}", response));
                    }
                }
                Err(e) => {
                    let _ = child.kill();
                    return Err(format!(
                        "WMI helper init timed out or disconnected: {:?}",
                        e
                    ));
                }
            }

            app_log(
                "wmi_client",
                "info",
                "spawn.success",
                "WMI helper subprocess running and initialized successfully",
            );
            *guard = Some(ActiveProcess { child, stdin, rx });
        }

        Ok(guard.as_mut().unwrap())
    }
}
