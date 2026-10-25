use std::{
    process::{Command, Stdio},
    time::Duration,
};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HotProcess {
    pub pid: u32,
    pub name: String,
    pub cpu_percent: f64,
    pub memory_mb: f64,
    pub heat_score: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HotProcessSnapshot {
    pub sampled_at_ms: u64,
    pub sample_ms: u64,
    pub logical_cores: u32,
    pub note: String,
    pub items: Vec<HotProcess>,
}

#[cfg(windows)]
#[derive(Debug, Deserialize)]
struct PowershellHotProcessSnapshot {
    sample_ms: Option<u64>,
    logical_cores: Option<u32>,
    items: Option<Vec<PowershellHotProcess>>,
}

#[cfg(windows)]
#[derive(Debug, Deserialize)]
struct PowershellHotProcess {
    pid: Option<u32>,
    name: Option<String>,
    cpu_percent: Option<f64>,
    memory_mb: Option<f64>,
    heat_score: Option<f64>,
}

#[tauri::command]
pub async fn get_hot_processes(limit: Option<usize>) -> Result<HotProcessSnapshot, String> {
    let limit = limit.unwrap_or(10);
    tauri::async_runtime::spawn_blocking(move || collect_hot_processes(limit))
        .await
        .map_err(|e| format!("process heat task failed: {}", e))?
}

fn collect_hot_processes(limit: usize) -> Result<HotProcessSnapshot, String> {
    let safe_limit = limit.clamp(3, 20);

    #[cfg(windows)]
    {
        collect_hot_processes_windows(safe_limit)
    }

    #[cfg(not(windows))]
    {
        Ok(collect_hot_processes_unix(safe_limit))
    }
}

#[cfg(windows)]
fn collect_hot_processes_windows(limit: usize) -> Result<HotProcessSnapshot, String> {
    const SAMPLE_MS: u64 = 800;

    let script = format!(
        r#"
$ErrorActionPreference = 'SilentlyContinue'
$sampleMs = {sample_ms}
$first = @{{}}
Get-Process | ForEach-Object {{
  if ($null -ne $_.CPU) {{
    $first[[int]$_.Id] = [double]$_.CPU
  }}
}}
Start-Sleep -Milliseconds $sampleMs
$items = Get-Process | ForEach-Object {{
  $pidValue = [int]$_.Id
  if ($first.ContainsKey($pidValue) -and $null -ne $_.CPU) {{
    $delta = [double]$_.CPU - [double]$first[$pidValue]
    if ($delta -lt 0) {{ $delta = 0 }}
    $cpu = ($delta / ($sampleMs / 1000.0)) * 100.0
    $memoryMb = [double]$_.WorkingSet64 / 1MB
    [pscustomobject]@{{
      pid = $pidValue
      name = [string]$_.ProcessName
      cpu_percent = [math]::Round($cpu, 1)
      memory_mb = [math]::Round($memoryMb, 1)
      heat_score = [math]::Round($cpu + ($memoryMb / 512.0), 1)
    }}
  }}
}} | Where-Object {{ $_.heat_score -gt 0 }} | Sort-Object heat_score -Descending | Select-Object -First {limit}
$cores = (Get-CimInstance Win32_ComputerSystem).NumberOfLogicalProcessors
[pscustomobject]@{{
  sample_ms = $sampleMs
  logical_cores = [int]$cores
  items = @($items)
}} | ConvertTo-Json -Depth 4 -Compress
"#,
        sample_ms = SAMPLE_MS,
        limit = limit
    );

    let mut command = Command::new("powershell");
    command
        .arg("-NoLogo")
        .arg("-NoProfile")
        .arg("-NonInteractive")
        .arg("-ExecutionPolicy")
        .arg("Bypass")
        .arg("-Command")
        .arg(script)
        .stdin(Stdio::null())
        .stderr(Stdio::piped())
        .stdout(Stdio::piped());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }

    let output = command
        .output()
        .map_err(|e| format!("failed to start process heat sampler: {}", e))?;

    if !output.status.success() {
        return Err(format!(
            "process heat sampler failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    let raw = String::from_utf8_lossy(&output.stdout);
    let parsed: PowershellHotProcessSnapshot =
        serde_json::from_str(raw.trim()).map_err(|e| format!("process heat json error: {}", e))?;

    let items = parsed
        .items
        .unwrap_or_default()
        .into_iter()
        .filter_map(|item| {
            Some(HotProcess {
                pid: item.pid?,
                name: item.name.unwrap_or_else(|| "Unknown".to_string()),
                cpu_percent: item.cpu_percent.unwrap_or(0.0).max(0.0),
                memory_mb: item.memory_mb.unwrap_or(0.0).max(0.0),
                heat_score: item.heat_score.unwrap_or(0.0).max(0.0),
            })
        })
        .collect();

    Ok(HotProcessSnapshot {
        sampled_at_ms: now_ms(),
        sample_ms: parsed.sample_ms.unwrap_or(SAMPLE_MS),
        logical_cores: parsed.logical_cores.unwrap_or(1).max(1),
        note: "CPU 为短时间采样的核心等效占用，100% 约等于一个逻辑核心满载。".to_string(),
        items,
    })
}

#[cfg(not(windows))]
fn collect_hot_processes_unix(limit: usize) -> HotProcessSnapshot {
    let output = Command::new("ps")
        .args(["-eo", "pid=,comm=,pcpu=,rss=", "--sort=-pcpu"])
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output();

    let items = output
        .ok()
        .map(|output| String::from_utf8_lossy(&output.stdout).to_string())
        .unwrap_or_default()
        .lines()
        .filter_map(parse_ps_line)
        .take(limit)
        .collect();

    HotProcessSnapshot {
        sampled_at_ms: now_ms(),
        sample_ms: 0,
        logical_cores: std::thread::available_parallelism()
            .map(|n| n.get() as u32)
            .unwrap_or(1),
        note: "CPU 来自 ps 的瞬时 %CPU，热度按 CPU 和内存占用估算。".to_string(),
        items,
    }
}

#[cfg(not(windows))]
fn parse_ps_line(line: &str) -> Option<HotProcess> {
    let mut parts = line.split_whitespace();
    let pid = parts.next()?.parse::<u32>().ok()?;
    let name = parts.next()?.to_string();
    let cpu_percent = parts.next()?.parse::<f64>().ok()?.max(0.0);
    let rss_kb = parts.next()?.parse::<f64>().ok()?.max(0.0);
    let memory_mb = rss_kb / 1024.0;

    Some(HotProcess {
        pid,
        name,
        cpu_percent: round1(cpu_percent),
        memory_mb: round1(memory_mb),
        heat_score: round1(cpu_percent + (memory_mb / 512.0)),
    })
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_millis(0))
        .as_millis() as u64
}

#[cfg(not(windows))]
fn round1(value: f64) -> f64 {
    (value * 10.0).round() / 10.0
}
