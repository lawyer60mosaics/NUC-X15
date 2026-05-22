use std::{env, fs, path::PathBuf};

#[cfg(unix)]
use std::{fs::File, io::Read};

use crate::plug::{
    constants::{
        DEFAULT_ALERT_CONFIRM_TIMES, DEFAULT_CPU_ALERT_THRESHOLD, DEFAULT_GPU_ALERT_THRESHOLD,
        DEFAULT_GPU_LINKAGE_BOOST, DEFAULT_GPU_LINKAGE_THRESHOLD,
        DEFAULT_MONITOR_SAMPLE_INTERVAL_MS, DEFAULT_ZERO_RPM_THRESHOLD,
        MAX_MONITOR_SAMPLE_INTERVAL_MS, MAX_TEMP_LIMIT, MIN_FAN_SPEED,
        MIN_MONITOR_SAMPLE_INTERVAL_MS, MIN_TEMP_LIMIT,
    },
    fan_curve::sanitize_curve,
    mode_profiles::{
        default_cpu_fan_max_for_mode, default_gpu_fan_max_for_mode, default_hysteresis_for_mode,
        default_profile_curves, default_ramp_step_for_mode,
    },
    struct_set::{FanControlMode, FanData},
};

pub fn get_config_dir() -> PathBuf {
    dirs::config_dir()
        .or_else(dirs::home_dir)
        .unwrap_or_else(env::temp_dir)
        .join("com.nuc.x15.fan.cyear.app")
}

pub fn get_config_file_path() -> Result<PathBuf, String> {
    let config_dir = get_config_dir();
    let config_file = config_dir.join("fan_config.json");
    Ok(config_file)
}

pub fn get_profile_dir() -> PathBuf {
    get_config_dir().join("profiles")
}

pub fn get_monitor_log_file_path() -> Result<PathBuf, String> {
    Ok(get_config_dir().join("monitor_log.csv"))
}

fn sanitize_profile_name(profile: &str) -> Result<String, String> {
    let trimmed = profile.trim();
    if trimmed.is_empty() {
        return Err("配置名称不能为空".to_string());
    }
    if trimmed.len() > 48 {
        return Err("配置名称长度不能超过 48".to_string());
    }
    if !trimmed
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return Err("配置名称只能包含字母、数字、_、-".to_string());
    }
    Ok(trimmed.to_string())
}

fn get_profile_file_path(profile: &str) -> Result<PathBuf, String> {
    let safe_profile = sanitize_profile_name(profile)?;
    Ok(get_profile_dir().join(format!("{}.json", safe_profile)))
}

pub fn normalize_fan_data(mut fan_data: FanData) -> FanData {
    let strategy = fan_data.control.strategy.to_lowercase();
    fan_data.control.strategy = match strategy.as_str() {
        "independent" | "mix_max" | "cpu_only" | "gpu_only" => strategy,
        _ => "independent".to_string(),
    };

    let legacy_preset = fan_data.control.preset.to_lowercase();
    let mut mode_from_legacy_preset = false;
    if fan_data.control.mode == FanControlMode::Office {
        let resolved_mode = match legacy_preset.as_str() {
            "silent" => FanControlMode::Silent,
            "performance" | "gaming" => FanControlMode::Gaming,
            "fullspeed" => FanControlMode::Performance,
            "benchmark" | "bench" | "stress" => FanControlMode::Benchmark,
            "custom" => FanControlMode::Custom,
            _ => FanControlMode::Office,
        };
        mode_from_legacy_preset = resolved_mode != FanControlMode::Office;
        fan_data.control.mode = resolved_mode;
    }

    fan_data.control.preset = match fan_data.control.mode {
        FanControlMode::Silent => "silent".to_string(),
        FanControlMode::Office => "standard".to_string(),
        FanControlMode::Gaming => "performance".to_string(),
        FanControlMode::Performance => "fullspeed".to_string(),
        FanControlMode::Benchmark => "benchmark".to_string(),
        FanControlMode::Custom => "custom".to_string(),
    };

    fan_data.left_fan = sanitize_curve(&fan_data.left_fan, "左");
    fan_data.right_fan = sanitize_curve(&fan_data.right_fan, "右");

    if fan_data.left_fan.is_empty() || fan_data.right_fan.is_empty() {
        let (left_defaults, right_defaults) = default_profile_curves(&fan_data.control.mode);
        if fan_data.left_fan.is_empty() {
            fan_data.left_fan = left_defaults;
        }
        if fan_data.right_fan.is_empty() {
            fan_data.right_fan = right_defaults;
        }
    }

    let control_mode = fan_data.control.control_mode.to_lowercase();
    fan_data.control.control_mode = match control_mode.as_str() {
        "curve" | "constant" => control_mode,
        _ => {
            if fan_data.control.constant_speed_enabled {
                "constant".to_string()
            } else {
                "curve".to_string()
            }
        }
    };

    fan_data.control.constant_speed = fan_data.control.constant_speed.clamp(0, 100);
    if fan_data.control.constant_speed == 0 && fan_data.control.constant_speed_enabled {
        fan_data.control.constant_speed = 60;
    }

    let use_mode_defaults =
        mode_from_legacy_preset && fan_data.control.mode != FanControlMode::Custom;

    if fan_data.control.ramp_up_step <= 0 || use_mode_defaults {
        fan_data.control.ramp_up_step = default_ramp_step_for_mode(&fan_data.control.mode);
    }
    fan_data.control.ramp_up_step = fan_data.control.ramp_up_step.clamp(1, 40);

    if fan_data.control.ramp_down_step <= 0 || use_mode_defaults {
        fan_data.control.ramp_down_step = default_ramp_step_for_mode(&fan_data.control.mode);
    }
    fan_data.control.ramp_down_step = fan_data.control.ramp_down_step.clamp(1, 30);

    let mode_cpu_cap = default_cpu_fan_max_for_mode(&fan_data.control.mode);
    let mode_gpu_cap = default_gpu_fan_max_for_mode(&fan_data.control.mode);
    let mode_hysteresis = default_hysteresis_for_mode(&fan_data.control.mode);

    if fan_data.control.cpu_hysteresis_bandwidth <= 0 || use_mode_defaults {
        fan_data.control.cpu_hysteresis_bandwidth = mode_hysteresis;
    }
    if fan_data.control.gpu_hysteresis_bandwidth <= 0 || use_mode_defaults {
        fan_data.control.gpu_hysteresis_bandwidth = mode_hysteresis;
    }
    fan_data.control.cpu_hysteresis_bandwidth =
        fan_data.control.cpu_hysteresis_bandwidth.clamp(1, 12);
    fan_data.control.gpu_hysteresis_bandwidth =
        fan_data.control.gpu_hysteresis_bandwidth.clamp(1, 12);

    if fan_data.control.cpu_fan_max_percent <= 0 || use_mode_defaults {
        fan_data.control.cpu_fan_max_percent = mode_cpu_cap;
    }
    if fan_data.control.gpu_fan_max_percent <= 0 || use_mode_defaults {
        fan_data.control.gpu_fan_max_percent = mode_gpu_cap;
    }
    fan_data.control.cpu_fan_max_percent = fan_data.control.cpu_fan_max_percent.clamp(20, 100);
    fan_data.control.gpu_fan_max_percent = fan_data.control.gpu_fan_max_percent.clamp(20, 100);

    if fan_data.control.mode != FanControlMode::Custom {
        fan_data.control.cpu_fan_max_percent =
            fan_data.control.cpu_fan_max_percent.min(mode_cpu_cap);
        fan_data.control.gpu_fan_max_percent =
            fan_data.control.gpu_fan_max_percent.min(mode_gpu_cap);
    }

    if fan_data.control.gpu_linkage_threshold <= 0 {
        fan_data.control.gpu_linkage_threshold = DEFAULT_GPU_LINKAGE_THRESHOLD;
    }
    fan_data.control.gpu_linkage_threshold = fan_data
        .control
        .gpu_linkage_threshold
        .clamp(60, MAX_TEMP_LIMIT);

    if fan_data.control.gpu_linkage_boost < 0 {
        fan_data.control.gpu_linkage_boost = DEFAULT_GPU_LINKAGE_BOOST;
    }
    fan_data.control.gpu_linkage_boost = fan_data.control.gpu_linkage_boost.clamp(0, 30);

    fan_data.control.min_speed = fan_data.control.min_speed.clamp(0, 60);
    if fan_data.control.min_speed < 0 {
        fan_data.control.min_speed = MIN_FAN_SPEED;
    }

    fan_data.control.zero_rpm_threshold = fan_data
        .control
        .zero_rpm_threshold
        .clamp(MIN_TEMP_LIMIT, MAX_TEMP_LIMIT);
    if fan_data.control.zero_rpm_threshold <= 0 {
        fan_data.control.zero_rpm_threshold = DEFAULT_ZERO_RPM_THRESHOLD;
    }

    fan_data.alerts.cpu.threshold = fan_data.alerts.cpu.threshold.clamp(50, MAX_TEMP_LIMIT);
    if fan_data.alerts.cpu.threshold <= 0 {
        fan_data.alerts.cpu.threshold = DEFAULT_CPU_ALERT_THRESHOLD;
    }

    fan_data.alerts.gpu.threshold = fan_data.alerts.gpu.threshold.clamp(50, MAX_TEMP_LIMIT);
    if fan_data.alerts.gpu.threshold <= 0 {
        fan_data.alerts.gpu.threshold = DEFAULT_GPU_ALERT_THRESHOLD;
    }

    fan_data.alerts.recover_delta = fan_data.alerts.recover_delta.clamp(1, 10);

    fan_data.alerts.cpu.actions.confirm_times =
        fan_data.alerts.cpu.actions.confirm_times.clamp(1, 10);
    if fan_data.alerts.cpu.actions.confirm_times == 0 {
        fan_data.alerts.cpu.actions.confirm_times = DEFAULT_ALERT_CONFIRM_TIMES;
    }

    fan_data.alerts.gpu.actions.confirm_times =
        fan_data.alerts.gpu.actions.confirm_times.clamp(1, 10);
    if fan_data.alerts.gpu.actions.confirm_times == 0 {
        fan_data.alerts.gpu.actions.confirm_times = DEFAULT_ALERT_CONFIRM_TIMES;
    }

    fan_data.monitor.sample_interval_ms = fan_data.monitor.sample_interval_ms.clamp(
        MIN_MONITOR_SAMPLE_INTERVAL_MS,
        MAX_MONITOR_SAMPLE_INTERVAL_MS.min(1000),
    );
    if fan_data.monitor.sample_interval_ms == 0 {
        fan_data.monitor.sample_interval_ms = DEFAULT_MONITOR_SAMPLE_INTERVAL_MS.clamp(500, 1000);
    }

    fan_data
}

pub fn default_fan_data() -> FanData {
    normalize_fan_data(FanData::default())
}

pub fn saved_startup_takeover_enabled() -> bool {
    let Ok(config_path) = get_config_file_path() else {
        return false;
    };
    if !config_path.exists() {
        return false;
    }
    read_fan_data(&config_path)
        .map(|fan_data| fan_data.control.startup_takeover_enabled)
        .unwrap_or(false)
}

fn write_fan_data(path: &PathBuf, fan_data: &FanData) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建配置目录失败: {}", e))?;
    }

    let json_data =
        serde_json::to_string_pretty(fan_data).map_err(|e| format!("序列化配置失败: {}", e))?;
    fs::write(path, json_data).map_err(|e| format!("写入配置文件失败: {}", e))
}

fn read_fan_data(path: &PathBuf) -> Result<FanData, String> {
    let json_data = fs::read_to_string(path).map_err(|e| format!("读取配置文件失败: {}", e))?;
    let fan_data: FanData =
        serde_json::from_str(&json_data).map_err(|e| format!("解析配置文件失败: {}", e))?;
    Ok(normalize_fan_data(fan_data))
}

#[cfg(unix)]
pub fn find_hwmon_with_name() -> PathBuf {
    let hwmon_dir = "/sys/class/hwmon";

    match fs::read_dir(hwmon_dir) {
        Ok(entries) => {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    let name_path = path.join("name");
                    if name_path.exists() {
                        if let Ok(mut name_file) = File::open(&name_path) {
                            let mut content = String::new();
                            if name_file.read_to_string(&mut content).is_ok()
                                && content.trim() == "uniwill"
                            {
                                println!("找到匹配的hwmon设备: {:?}", path);
                                return path;
                            }
                        }
                    }
                }
            }
        }
        Err(e) => {
            eprintln!("无法读取hwmon目录 {}: {}", hwmon_dir, e);
        }
    }

    // 未找到时返回一个占位路径并打印明确错误，而非直接 panic
    // 实际访问时会因路径不存在而失败，但程序可以正常启动并提示用户
    eprintln!("❌ 未找到 uniwill hwmon 设备，请确保 uniwill-laptop 驱动已正确加载！");
    eprintln!("   尝试运行: sudo modprobe uniwill-laptop");
    PathBuf::from("/sys/class/hwmon/hwmon_not_found")
}

#[tauri::command]
pub async fn save_fan_config(fan_data: FanData) -> Result<(), String> {
    let config_path = get_config_file_path()?;
    let normalized = normalize_fan_data(fan_data);
    write_fan_data(&config_path, &normalized)?;
    println!("风扇配置已保存至: {:?}", config_path);
    Ok(())
}

#[tauri::command]
pub async fn load_fan_config() -> Result<FanData, String> {
    let config_path = get_config_file_path()?;
    if !config_path.exists() {
        let defaults = default_fan_data();
        write_fan_data(&config_path, &defaults)?;
        println!("配置文件不存在，已创建默认配置: {:?}", config_path);
        return Ok(defaults);
    }
    let fan_data = read_fan_data(&config_path)?;
    println!("风扇配置已加载: {:?}", config_path);
    Ok(fan_data)
}

#[tauri::command]
pub async fn save_fan_profile(profile: String, fan_data: FanData) -> Result<(), String> {
    let profile_path = get_profile_file_path(&profile)?;
    let normalized = normalize_fan_data(fan_data);
    write_fan_data(&profile_path, &normalized)?;
    println!("配置档案已保存 [{}]: {:?}", profile, profile_path);
    Ok(())
}

#[tauri::command]
pub async fn load_fan_profile(profile: String) -> Result<FanData, String> {
    let profile_path = get_profile_file_path(&profile)?;
    if !profile_path.exists() {
        return Err(format!("配置档案不存在: {}", profile));
    }
    let fan_data = read_fan_data(&profile_path)?;
    println!("配置档案已加载 [{}]: {:?}", profile, profile_path);
    Ok(fan_data)
}

#[tauri::command]
pub async fn list_fan_profiles() -> Result<Vec<String>, String> {
    let profile_dir = get_profile_dir();
    if !profile_dir.exists() {
        return Ok(vec![]);
    }
    let mut profiles = vec![];
    for entry in fs::read_dir(profile_dir).map_err(|e| format!("读取配置档案目录失败: {}", e))?
    {
        let entry = entry.map_err(|e| format!("读取配置档案失败: {}", e))?;
        let path = entry.path();
        if path.extension().and_then(|x| x.to_str()) != Some("json") {
            continue;
        }
        if let Some(name) = path.file_stem().and_then(|x| x.to_str()) {
            profiles.push(name.to_string());
        }
    }
    profiles.sort();
    Ok(profiles)
}

#[tauri::command]
pub async fn export_monitor_log_csv(destination_path: String) -> Result<String, String> {
    let src = get_monitor_log_file_path()?;
    if !src.exists() {
        return Err("监控日志文件不存在".to_string());
    }

    let destination = PathBuf::from(destination_path);
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建导出目录失败: {}", e))?;
    }
    fs::copy(&src, &destination).map_err(|e| format!("导出监控日志失败: {}", e))?;
    Ok(destination.to_string_lossy().to_string())
}
