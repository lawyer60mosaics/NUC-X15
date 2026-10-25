use serde_json::Value;
#[cfg(not(windows))]
use serde_json::json;

#[cfg(windows)]
use std::{os::windows::process::CommandExt, process::{Command, Stdio}, time::{Duration, Instant}};

#[cfg(windows)]
const MONITOR_SCRIPT: &str = r#"
$ErrorActionPreference = 'Stop'
$result = [ordered]@{ sampledAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); cpu = $null; memory = $null; igpu = $null; dgpu = $null; system = $null; errors = @() }
try {
  $cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
  if ($cpu) { $result.cpu = [ordered]@{ name = $cpu.Name; usage = $cpu.LoadPercentage; currentMhz = $cpu.CurrentClockSpeed; maxMhz = $cpu.MaxClockSpeed; l2Kb = $cpu.L2CacheSize; l3Kb = $cpu.L3CacheSize } }
} catch { $result.errors += "CPU: $($_.Exception.Message)" }
try {
  $os = Get-CimInstance Win32_OperatingSystem
  $memory = Get-CimInstance Win32_PhysicalMemory | Select-Object -First 1
  if ($os) { $result.memory = [ordered]@{ totalKb = $os.TotalVisibleMemorySize; freeKb = $os.FreePhysicalMemory; speedMhz = if ($memory) { $memory.ConfiguredClockSpeed } else { $null } } }
} catch { $result.errors += "Memory: $($_.Exception.Message)" }
try {
  $bios = Get-CimInstance Win32_BIOS
  $product = Get-CimInstance Win32_ComputerSystemProduct
  $result.system = [ordered]@{ bios = if ($bios) { $bios.SMBIOSBIOSVersion } else { $null }; manufacturer = if ($product) { $product.Vendor } else { $null }; model = if ($product) { $product.Name } else { $null }; sku = if ($product) { $product.Version } else { $null } }
} catch { $result.errors += "System: $($_.Exception.Message)" }
try {
  $controllers = @(Get-CimInstance Win32_VideoController)
  $intel = $controllers | Where-Object { $_.Name -match 'Intel.*(UHD|Iris|Graphics)' } | Select-Object -First 1
  $nvidia = $controllers | Where-Object { $_.Name -match 'NVIDIA' } | Select-Object -First 1
  if ($intel) { $result.igpu = [ordered]@{ name = $intel.Name; usage = $null; currentMhz = $null; memoryMb = $null } }
  if ($nvidia) { $result.dgpu = [ordered]@{ name = $nvidia.Name; usage = $null; temperature = $null; currentMhz = $null; memoryUsedMb = $null; memoryTotalMb = $null } }
  $smi = Join-Path $env:WINDIR 'System32\nvidia-smi.exe'
  if ($nvidia -and (Test-Path $smi)) {
    $row = @(& $smi '--query-gpu=utilization.gpu,temperature.gpu,clocks.gr,memory.used,memory.total' '--format=csv,noheader,nounits' 2>$null) | Select-Object -First 1
    if ($row -and $LASTEXITCODE -eq 0) {
      $parts = @($row -split ',' | ForEach-Object { $_.Trim() })
      if ($parts.Count -ge 5) {
        $result.dgpu.usage = [int]$parts[0]
        $result.dgpu.temperature = [int]$parts[1]
        $result.dgpu.currentMhz = [int]$parts[2]
        $result.dgpu.memoryUsedMb = [int]$parts[3]
        $result.dgpu.memoryTotalMb = [int]$parts[4]
      }
    }
  }
} catch { $result.errors += "GPU: $($_.Exception.Message)" }
$result | ConvertTo-Json -Depth 5 -Compress
"#;

#[cfg(windows)]
fn monitor_snapshot_blocking() -> Result<Value, String> {
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let mut child = Command::new("powershell.exe")
        .creation_flags(CREATE_NO_WINDOW)
        .args(["-NoProfile", "-NonInteractive", "-Command", MONITOR_SCRIPT])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to start hardware monitor: {e}"))?;
    let started = Instant::now();
    loop {
        if child.try_wait().map_err(|e| e.to_string())?.is_some() {
            let output = child.wait_with_output().map_err(|e| e.to_string())?;
            if !output.status.success() {
                return Err(format!("hardware monitor exited with {}: {}", output.status, String::from_utf8_lossy(&output.stderr).trim()));
            }
            return serde_json::from_slice(&output.stdout).map_err(|e| format!("invalid hardware monitor response: {e}"));
        }
        if started.elapsed() > Duration::from_secs(12) {
            let _ = child.kill();
            let _ = child.wait();
            return Err("hardware monitor timed out after 12 seconds".to_string());
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}

#[tauri::command]
pub async fn get_studio_monitor_snapshot() -> Result<Value, String> {
    #[cfg(windows)]
    { return tauri::async_runtime::spawn_blocking(monitor_snapshot_blocking).await.map_err(|e| e.to_string())?; }
    #[cfg(not(windows))]
    { Ok(json!({ "sampledAt": null, "cpu": null, "memory": null, "igpu": null, "dgpu": null, "system": null, "errors": ["Windows hardware monitor is unavailable on this platform"] })) }
}
