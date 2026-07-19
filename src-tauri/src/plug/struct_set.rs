use lazy_static::lazy_static;
use serde::{Deserialize, Serialize};
#[cfg(unix)]
use std::path::PathBuf;

use crate::plug::constants::{
    DEFAULT_ALERT_CONFIRM_TIMES, DEFAULT_CPU_ALERT_THRESHOLD, DEFAULT_CPU_FAN_MAX_PERCENT,
    DEFAULT_CPU_HYSTERESIS_BANDWIDTH, DEFAULT_GPU_ALERT_THRESHOLD, DEFAULT_GPU_FAN_MAX_PERCENT,
    DEFAULT_GPU_HYSTERESIS_BANDWIDTH, DEFAULT_GPU_LINKAGE_BOOST, DEFAULT_GPU_LINKAGE_THRESHOLD,
    DEFAULT_MODE, DEFAULT_MONITOR_SAMPLE_INTERVAL_MS, DEFAULT_RAMP_DOWN_STEP, DEFAULT_RAMP_UP_STEP,
    DEFAULT_ZERO_RPM_THRESHOLD, MAX_MONITOR_SAMPLE_INTERVAL_MS, MIN_FAN_SPEED,
    MIN_MONITOR_SAMPLE_INTERVAL_MS,
};
use crate::plug::diagnostics::app_log;
#[cfg(windows)]
use crate::plug::wmi_client::WmiClient;
#[cfg(unix)]
use crate::{
    linux_plug::sysfs::{get_kernel_version, get_model_id, get_sys, set_sys},
    plug::config::find_hwmon_with_name,
};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

#[cfg(windows)]
const EC_ADDR_AP_OEM: u16 = 0x0741;
#[cfg(windows)]
const EC_ADDR_TDP_GPU_PL1: u16 = 0x072d;
#[cfg(windows)]
const EC_ADDR_TDP_GPU_PL2: u16 = 0x072e;
#[cfg(windows)]
const EC_ADDR_TDP_CPU_PL1: u16 = 0x0783;
#[cfg(windows)]
const EC_ADDR_TDP_CPU_PL2: u16 = 0x0784;
#[cfg(windows)]
const EC_ADDR_TDP_TCC: u16 = 0x0786;
#[cfg(windows)]
const EC_ENABLE_MANUAL_CTRL: i64 = 0x01;
#[cfg(windows)]
const EC_COMM_FAILURE: i64 = 0xFEFEFEFE;
pub static R_FAN_L1: &str = "0x000001000000046C";
pub static R_FAN_L2: &str = "0x000001000000046D";
pub static R_FAN_R1: &str = "0x0000010000000464";
pub static R_FAN_R2: &str = "0x0000010000000465";
pub static R_TEMP_L: &str = "0x000001000000043E";
pub static R_TEMP_R: &str = "0x000001000000044F";
pub static R_FAN_MODE: &str = "0x0000010000000751";
pub static W_FAN_AC71H_TURBO: &str = "0x0000000000400751";
pub static W_FAN_KC71F_TURBO: &str = "0x0000000000500751";
pub static W_FAN_RESET: &str = "0x0000000000A00751";
pub static R_AC_LED_COLOR: &str = "0x00000100000007EA";
#[allow(dead_code)]
pub static R_DC_LED_COLOR: &str = "0x00000100000007EB";
pub static W_AC_LED_COLOR_Y: &str = "0x00000000002A07EA";
pub static W_AC_LED_COLOR_N: &str = "0x00000000000A07EA";
#[allow(dead_code)]
pub static W_DC_LED_COLOR_Y: &str = "0x00000000002A07EB";
#[allow(dead_code)]
pub static W_DC_LED_COLOR_N: &str = "0x00000000000A07EB";
// RGB: i64 = 标准RGB值 / 51 * 10
#[cfg(windows)]
lazy_static! {
    pub static ref MODEL_ID: i64 = WmiClient::global().send_get_model();
}
#[cfg(unix)]
lazy_static! {
    pub static ref MODEL_ID: i64 = get_model_id();
}
#[cfg(unix)]
lazy_static! {
    pub static ref KERNEL_ID: i64 = get_kernel_version();
}

#[cfg(unix)]
lazy_static! {
    pub static ref DRIVER_PATH: PathBuf = find_hwmon_with_name();
}

// 全局硬件写入互斥锁，防止并发写入 WMI/sysfs 导致的不稳定或错误
lazy_static! {
    pub static ref HW_ACCESS_LOCK: Mutex<()> = Mutex::new(());
}

#[cfg(windows)]
pub(crate) fn ec_read_payload(address: u16) -> String {
    format!("0x000001000000{:04X}", address)
}

#[cfg(windows)]
pub(crate) fn ec_write_payload(address: u16, value: i64) -> Option<String> {
    if !(0..=0xFF).contains(&value) {
        return None;
    }
    Some(format!("0x0000000000{:02X}{:04X}", value, address))
}

#[cfg(windows)]
fn ec_call_failed(value: i64) -> bool {
    value < 0 || value == EC_COMM_FAILURE
}

/// 带重试的锁获取：用于关键操作（风扇模式切换、TDP 写入等）
/// 普通风扇写入使用单次 try_lock（跳过一次写入可接受）
fn acquire_hw_lock(max_attempts: u32) -> Option<std::sync::MutexGuard<'static, ()>> {
    for attempt in 0..max_attempts {
        match HW_ACCESS_LOCK.try_lock() {
            Ok(guard) => return Some(guard),
            Err(_) => {
                if attempt == 0 || (attempt + 1) % 5 == 0 {
                    println!(
                        "⏳ HW_ACCESS_LOCK 争用 (尝试 {}/{})",
                        attempt + 1,
                        max_attempts
                    );
                }
                thread::sleep(Duration::from_millis(100));
            }
        }
    }
    println!("❌ HW_ACCESS_LOCK 获取失败，已重试 {} 次", max_attempts);
    None
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct FanPoint {
    pub temperature: i32,
    pub speed: i32,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FanControlMode {
    Silent,
    Office,
    Gaming,
    Performance,
    Benchmark,
    Custom,
}

impl FanControlMode {
    pub fn as_str(&self) -> &'static str {
        match self {
            FanControlMode::Silent => "silent",
            FanControlMode::Office => "office",
            FanControlMode::Gaming => "gaming",
            FanControlMode::Performance => "performance",
            FanControlMode::Benchmark => "benchmark",
            FanControlMode::Custom => "custom",
        }
    }

    pub fn from_text(value: &str) -> Self {
        match value.trim().to_lowercase().as_str() {
            "silent" => FanControlMode::Silent,
            "office" | "standard" | "balanced" => FanControlMode::Office,
            "gaming" | "game" => FanControlMode::Gaming,
            "performance" | "fullspeed" => FanControlMode::Performance,
            "benchmark" | "bench" | "stress" => FanControlMode::Benchmark,
            "custom" => FanControlMode::Custom,
            _ => FanControlMode::Office,
        }
    }
}

impl Default for FanControlMode {
    fn default() -> Self {
        FanControlMode::from_text(DEFAULT_MODE)
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct FanControlPolicy {
    #[serde(default)]
    pub mode: FanControlMode,
    #[serde(default = "default_strategy")]
    pub strategy: String,
    #[serde(default = "default_preset")]
    pub preset: String,
    #[serde(default = "default_control_mode")]
    pub control_mode: String,
    #[serde(default = "default_ramp_up_step")]
    pub ramp_up_step: i64,
    #[serde(default = "default_ramp_down_step")]
    pub ramp_down_step: i64,
    #[serde(default = "default_min_speed")]
    pub min_speed: i64,
    #[serde(default)]
    pub zero_rpm_enabled: bool,
    #[serde(default = "default_zero_rpm_threshold")]
    pub zero_rpm_threshold: i64,
    #[serde(default)]
    pub constant_speed_enabled: bool,
    #[serde(default = "default_constant_speed")]
    pub constant_speed: i64,
    #[serde(default)]
    pub startup_takeover_enabled: bool,
    #[serde(default = "default_cpu_hysteresis_bandwidth")]
    pub cpu_hysteresis_bandwidth: i64,
    #[serde(default = "default_gpu_hysteresis_bandwidth")]
    pub gpu_hysteresis_bandwidth: i64,
    #[serde(default = "default_cpu_fan_max_percent")]
    pub cpu_fan_max_percent: i64,
    #[serde(default = "default_gpu_fan_max_percent")]
    pub gpu_fan_max_percent: i64,
    #[serde(default = "default_true")]
    pub gpu_linkage_enabled: bool,
    #[serde(default = "default_gpu_linkage_threshold")]
    pub gpu_linkage_threshold: i64,
    #[serde(default = "default_gpu_linkage_boost")]
    pub gpu_linkage_boost: i64,
}

impl Default for FanControlPolicy {
    fn default() -> Self {
        Self {
            mode: FanControlMode::default(),
            strategy: default_strategy(),
            preset: default_preset(),
            control_mode: default_control_mode(),
            ramp_up_step: default_ramp_up_step(),
            ramp_down_step: default_ramp_down_step(),
            min_speed: default_min_speed(),
            zero_rpm_enabled: false,
            zero_rpm_threshold: default_zero_rpm_threshold(),
            constant_speed_enabled: false,
            constant_speed: default_constant_speed(),
            startup_takeover_enabled: false,
            cpu_hysteresis_bandwidth: default_cpu_hysteresis_bandwidth(),
            gpu_hysteresis_bandwidth: default_gpu_hysteresis_bandwidth(),
            cpu_fan_max_percent: default_cpu_fan_max_percent(),
            gpu_fan_max_percent: default_gpu_fan_max_percent(),
            gpu_linkage_enabled: default_true(),
            gpu_linkage_threshold: default_gpu_linkage_threshold(),
            gpu_linkage_boost: default_gpu_linkage_boost(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AlertActions {
    #[serde(default = "default_true")]
    pub popup: bool,
    #[serde(default)]
    pub sound: bool,
    #[serde(default = "default_true")]
    pub log: bool,
    #[serde(default)]
    pub force_shutdown: bool,
    #[serde(default = "default_alert_confirm_times")]
    pub confirm_times: u32,
}

impl Default for AlertActions {
    fn default() -> Self {
        Self {
            popup: true,
            sound: false,
            log: true,
            force_shutdown: false,
            confirm_times: default_alert_confirm_times(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SensorAlertRule {
    #[serde(default = "default_cpu_alert_threshold")]
    pub threshold: i64,
    #[serde(default)]
    pub actions: AlertActions,
}

impl Default for SensorAlertRule {
    fn default() -> Self {
        Self {
            threshold: default_cpu_alert_threshold(),
            actions: AlertActions::default(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AlertConfig {
    #[serde(default = "default_cpu_alert_rule")]
    pub cpu: SensorAlertRule,
    #[serde(default = "default_gpu_alert_rule")]
    pub gpu: SensorAlertRule,
    #[serde(default = "default_recover_delta")]
    pub recover_delta: i64,
}

impl Default for AlertConfig {
    fn default() -> Self {
        Self {
            cpu: default_cpu_alert_rule(),
            gpu: default_gpu_alert_rule(),
            recover_delta: default_recover_delta(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct MonitoringConfig {
    #[serde(default = "default_monitor_sample_interval_ms")]
    pub sample_interval_ms: u64,
    #[serde(default)]
    pub log_enabled: bool,
}

impl Default for MonitoringConfig {
    fn default() -> Self {
        Self {
            sample_interval_ms: default_monitor_sample_interval_ms(),
            log_enabled: false,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AppearanceConfig {
    #[serde(default = "default_time_theme_mode")]
    pub time_theme_mode: String,
}

impl Default for AppearanceConfig {
    fn default() -> Self {
        Self {
            time_theme_mode: default_time_theme_mode(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct FanData {
    #[serde(default)]
    pub left_fan: Vec<FanPoint>,
    #[serde(default)]
    pub right_fan: Vec<FanPoint>,
    #[serde(default)]
    pub control: FanControlPolicy,
    #[serde(default)]
    pub alerts: AlertConfig,
    #[serde(default)]
    pub monitor: MonitoringConfig,
    #[serde(default)]
    pub appearance: AppearanceConfig,
    #[serde(default)]
    pub app_settings: serde_json::Value,
}

fn default_strategy() -> String {
    "independent".to_string()
}

fn default_preset() -> String {
    "custom".to_string()
}

fn default_control_mode() -> String {
    "curve".to_string()
}

fn default_ramp_up_step() -> i64 {
    DEFAULT_RAMP_UP_STEP
}

fn default_ramp_down_step() -> i64 {
    DEFAULT_RAMP_DOWN_STEP
}

fn default_min_speed() -> i64 {
    MIN_FAN_SPEED
}

fn default_zero_rpm_threshold() -> i64 {
    DEFAULT_ZERO_RPM_THRESHOLD
}

fn default_constant_speed() -> i64 {
    50
}

fn default_cpu_hysteresis_bandwidth() -> i64 {
    DEFAULT_CPU_HYSTERESIS_BANDWIDTH
}

fn default_gpu_hysteresis_bandwidth() -> i64 {
    DEFAULT_GPU_HYSTERESIS_BANDWIDTH
}

fn default_cpu_fan_max_percent() -> i64 {
    DEFAULT_CPU_FAN_MAX_PERCENT
}

fn default_gpu_fan_max_percent() -> i64 {
    DEFAULT_GPU_FAN_MAX_PERCENT
}

fn default_gpu_linkage_threshold() -> i64 {
    DEFAULT_GPU_LINKAGE_THRESHOLD
}

fn default_gpu_linkage_boost() -> i64 {
    DEFAULT_GPU_LINKAGE_BOOST
}

fn default_cpu_alert_threshold() -> i64 {
    DEFAULT_CPU_ALERT_THRESHOLD
}

fn default_gpu_alert_threshold() -> i64 {
    DEFAULT_GPU_ALERT_THRESHOLD
}

fn default_alert_confirm_times() -> u32 {
    DEFAULT_ALERT_CONFIRM_TIMES
}

fn default_cpu_alert_rule() -> SensorAlertRule {
    SensorAlertRule {
        threshold: default_cpu_alert_threshold(),
        actions: AlertActions::default(),
    }
}

fn default_gpu_alert_rule() -> SensorAlertRule {
    SensorAlertRule {
        threshold: default_gpu_alert_threshold(),
        actions: AlertActions::default(),
    }
}

fn default_recover_delta() -> i64 {
    3
}

fn default_monitor_sample_interval_ms() -> u64 {
    DEFAULT_MONITOR_SAMPLE_INTERVAL_MS.clamp(
        MIN_MONITOR_SAMPLE_INTERVAL_MS,
        MAX_MONITOR_SAMPLE_INTERVAL_MS,
    )
}

fn default_time_theme_mode() -> String {
    "auto".to_string()
}

fn default_true() -> bool {
    true
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct FanSpeeds {
    pub left_fan_speed: i64,
    pub right_fan_speed: i64,
    pub left_temp: i64,
    pub right_temp: i64,
    pub cpu_power_limit_w: Option<i64>,
    pub cpu_power_short_w: Option<i64>,
    pub gpu_power_limit_w: Option<i64>,
    pub gpu_power_short_w: Option<i64>,
}

#[expect(
    clippy::upper_case_acronyms,
    reason = "The frontend command payload already uses this public type name."
)]
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TDP {
    pub cpu1: i64,
    pub cpu2: i64,
    pub gpu1: i64,
    pub gpu2: i64,
    pub tcc: i64,
}

#[expect(
    clippy::upper_case_acronyms,
    reason = "The frontend command payload already uses this public type name."
)]
#[derive(Serialize, Deserialize, Debug)]
pub struct RGB {
    pub(crate) r: i64,
    pub(crate) g: i64,
    pub(crate) b: i64,
}

#[derive(Serialize, Clone, Debug)]
pub struct FanActorSnapshot {
    pub running: bool,
    pub active_mode: String,
    pub constant_mode: bool,
    pub constant_speed: i64,
    pub cpu_temp: Option<i64>,
    pub gpu_temp: Option<i64>,
    pub cpu_fan_rpm: Option<i64>,
    pub gpu_fan_rpm: Option<i64>,
    pub cpu_power_limit_w: Option<i64>,
    pub cpu_power_short_w: Option<i64>,
    pub gpu_power_limit_w: Option<i64>,
    pub gpu_power_short_w: Option<i64>,
    pub sampled_at_ms: Option<u128>,
    pub dropped_samples: u64,
    pub hung: bool,
    pub last_heartbeat_ms: Option<u128>,
}

impl Default for FanActorSnapshot {
    fn default() -> Self {
        Self {
            running: false,
            active_mode: "office".to_string(),
            constant_mode: false,
            constant_speed: 0,
            cpu_temp: None,
            gpu_temp: None,
            cpu_fan_rpm: None,
            gpu_fan_rpm: None,
            cpu_power_limit_w: None,
            cpu_power_short_w: None,
            gpu_power_limit_w: None,
            gpu_power_short_w: None,
            sampled_at_ms: None,
            dropped_samples: 0,
            hung: false,
            last_heartbeat_ms: None,
        }
    }
}

/// FanControlState 由 Tauri 管理，作为 Actor 系统已初始化的标记
pub struct FanControlState;

#[cfg(windows)]
pub struct ApiFan {
    r_fan_l1: &'static str,
    r_fan_l2: &'static str,
    r_fan_r1: &'static str,
    r_fan_r2: &'static str,
}

#[cfg(windows)]
impl ApiFan {
    pub fn try_init() -> Result<Self, String> {
        let (r_fan_l1, r_fan_l2, r_fan_r1, r_fan_r2) = if *MODEL_ID == 1 {
            (R_FAN_L1, R_FAN_L2, R_FAN_R1, R_FAN_R2)
        } else {
            (R_FAN_R1, R_FAN_R2, R_FAN_L1, R_FAN_L2)
        };
        Ok(ApiFan {
            r_fan_l1,
            r_fan_l2,
            r_fan_r1,
            r_fan_r2,
        })
    }
    pub fn get_cpu_temp(&self) -> i64 {
        // 与 GPU 保持一致，取低 8 位才是摄氏度温度值，避免高位脏数据触发过温保护
        WmiClient::global().send_wmi_set(R_TEMP_L) & 0xFF
    }
    pub fn get_gpu_temp(&self) -> i64 {
        WmiClient::global().send_wmi_set(R_TEMP_R) & 0xFF
    }
    pub fn get_fan_l(&self) -> i64 {
        (WmiClient::global().send_wmi_set(self.r_fan_l1) & 0xFF) << 8
            | WmiClient::global().send_wmi_set(self.r_fan_l2)
    }
    pub fn get_fan_r(&self) -> i64 {
        (WmiClient::global().send_wmi_set(self.r_fan_r1) & 0xFF) << 8
            | WmiClient::global().send_wmi_set(self.r_fan_r2)
    }
    fn _set_fan(&self, l: i64, r: i64) {
        // 风扇写入使用 try_lock：在极端并发场景下跳过一次写入影响可控
        let _guard = match HW_ACCESS_LOCK.try_lock() {
            Ok(g) => g,
            Err(_) => {
                println!(
                    "⚠️ HW_ACCESS_LOCK 争用（风扇写入），跳过本次写入 L={} R={}",
                    l, r
                );
                return;
            }
        };
        // l/r 范围 0-200，用 {:02X} 保证2位十六进制（00-C8），超出时 clamp 保护
        let l = l.clamp(0, 200);
        let r = r.clamp(0, 200);
        let _ = WmiClient::global().send_wmi_set(&format!("0x0000000000{:02X}1809", l));
        let _ = WmiClient::global().send_wmi_set(&format!("0x0000000000{:02X}1804", r));
    }
    /// MAX speed 200
    pub fn set_fan(&self, l: i64, r: i64) -> bool {
        let _ = if *MODEL_ID == 1 {
            &self._set_fan(l, r)
        } else {
            &self._set_fan(r, l)
        };
        true
    }
    pub fn set_fan_auto(&self) -> bool {
        let Some(_guard) = acquire_hw_lock(10) else {
            println!("❌ set_fan_auto 失败：无法获取硬件锁");
            return false;
        };
        let _ = WmiClient::global().send_wmi_set(W_FAN_RESET);
        true
    }
    pub fn set_fan_control(&self) -> bool {
        let Some(_guard) = acquire_hw_lock(10) else {
            println!("❌ set_fan_control 失败：无法获取硬件锁");
            return false;
        };
        if *MODEL_ID == 1 {
            WmiClient::global().send_wmi_set(W_FAN_AC71H_TURBO);
        } else {
            WmiClient::global().send_wmi_set(W_FAN_KC71F_TURBO);
        }
        true
    }
    /// 1 - control, 2 - auto
    pub fn get_fan_mode(&self) -> i64 {
        let out = WmiClient::global().send_wmi_set(R_FAN_MODE);
        println!("MODE: {}", out);
        if out <= 0 {
            return 1;
        } // 异常不管了
        if out == 27664 || out == 27648 {
            2
        } else {
            1
        }
    }
    pub fn get_fan_speeds(&self) -> FanSpeeds {
        let left_fan = self.get_fan_l();
        let right_fan = self.get_fan_r();
        let left_temp = self.get_cpu_temp();
        let right_temp = self.get_gpu_temp();

        // 超出合理范围的读数视为硬件异常，归零以避免前端显示乱码
        // 转速上限 7000 RPM，温度上限 105°C
        FanSpeeds {
            left_fan_speed: if (0..=7000).contains(&left_fan) {
                left_fan
            } else {
                0
            },
            right_fan_speed: if (0..=7000).contains(&right_fan) {
                right_fan
            } else {
                0
            },
            left_temp: if (1..=105).contains(&left_temp) {
                left_temp
            } else {
                0
            },
            right_temp: if (1..=105).contains(&right_temp) {
                right_temp
            } else {
                0
            },
            cpu_power_limit_w: None,
            cpu_power_short_w: None,
            gpu_power_limit_w: None,
            gpu_power_short_w: None,
        }
    }

    fn ec_read_byte(&self, address: u16) -> i64 {
        let payload = ec_read_payload(address);
        let value = WmiClient::global().send_wmi_set(&payload);
        if ec_call_failed(value) {
            -1
        } else {
            value & 0xFF
        }
    }

    fn ec_write_byte(&self, address: u16, value: i64) -> i64 {
        let Some(payload) = ec_write_payload(address, value) else {
            app_log(
                "hardware",
                "warn",
                "ec.write.invalid_value",
                format!("address=0x{:04X} value={}", address, value),
            );
            return -1;
        };
        WmiClient::global().send_wmi_set(&payload)
    }

    fn ensure_manual_control(&self) -> bool {
        let current = self.ec_read_byte(EC_ADDR_AP_OEM);
        if current < 0 {
            app_log(
                "hardware",
                "warn",
                "ec.manual_control.read_failed",
                format!("address=0x{:04X}", EC_ADDR_AP_OEM),
            );
            return false;
        }

        if current & EC_ENABLE_MANUAL_CTRL != 0 {
            return true;
        }

        let next = current | EC_ENABLE_MANUAL_CTRL;
        let out = self.ec_write_byte(EC_ADDR_AP_OEM, next);
        thread::sleep(Duration::from_millis(80));
        let verified = self.ec_read_byte(EC_ADDR_AP_OEM);
        let ok = !ec_call_failed(out) && verified & EC_ENABLE_MANUAL_CTRL != 0;
        app_log(
            "hardware",
            if ok { "info" } else { "warn" },
            "ec.manual_control.enable",
            format!(
                "before=0x{:02X} write_out={} verify=0x{:02X} ok={}",
                current, out, verified, ok
            ),
        );
        ok
    }

    /// (gpu1, gpu2, cpu1, cpu2, tcc)
    pub fn get_tdp(&self) -> (i64, i64, i64, i64, i64) {
        (
            self.ec_read_byte(EC_ADDR_TDP_CPU_PL1),
            self.ec_read_byte(EC_ADDR_TDP_CPU_PL2),
            self.ec_read_byte(EC_ADDR_TDP_GPU_PL1),
            self.ec_read_byte(EC_ADDR_TDP_GPU_PL2),
            self.ec_read_byte(EC_ADDR_TDP_TCC),
        )
    }
    pub fn set_tdp(&self, t: TDP) -> bool {
        let Some(_guard) = acquire_hw_lock(5) else {
            println!("set_tdp failed: hardware lock unavailable");
            return false;
        };
        if !self.ensure_manual_control() {
            app_log(
                "hardware",
                "warn",
                "set_tdp.manual_control_failed",
                format!(
                    "cpu={}W/{}W gpu={}W/{}W tcc={}",
                    t.cpu1, t.cpu2, t.gpu1, t.gpu2, t.tcc
                ),
            );
            return false;
        }

        let cpu1_out = self.ec_write_byte(EC_ADDR_TDP_CPU_PL1, t.cpu1);
        thread::sleep(Duration::from_millis(500));
        let cpu2_out = self.ec_write_byte(EC_ADDR_TDP_CPU_PL2, t.cpu2);
        thread::sleep(Duration::from_millis(500));
        let gpu1_out = self.ec_write_byte(EC_ADDR_TDP_GPU_PL1, t.gpu1);
        thread::sleep(Duration::from_millis(500));
        let gpu2_out = self.ec_write_byte(EC_ADDR_TDP_GPU_PL2, t.gpu2);
        thread::sleep(Duration::from_millis(500));
        let tcc_out = self.ec_write_byte(EC_ADDR_TDP_TCC, t.tcc);
        thread::sleep(Duration::from_millis(500));

        if [cpu1_out, cpu2_out, gpu1_out, gpu2_out, tcc_out]
            .iter()
            .any(|value| ec_call_failed(*value))
        {
            app_log(
                "hardware",
                "warn",
                "set_tdp.wmi_failed",
                format!(
                    "cpu1_out={} cpu2_out={} gpu1_out={} gpu2_out={} tcc_out={}",
                    cpu1_out, cpu2_out, gpu1_out, gpu2_out, tcc_out
                ),
            );
            return false;
        }

        let (read_cpu1, read_cpu2, read_gpu1, read_gpu2, _) = self.get_tdp();
        let cpu_ok = read_cpu1 == t.cpu1 && read_cpu2 == t.cpu2;
        let gpu_ok = read_gpu1 == t.gpu1 && read_gpu2 == t.gpu2;

        app_log(
            "hardware",
            if cpu_ok && gpu_ok { "info" } else { "warn" },
            "set_tdp.verify",
            format!(
                "want cpu={}W/{}W gpu={}W/{}W got cpu={}W/{}W gpu={}W/{}W cpu_ok={} gpu_ok={}",
                t.cpu1,
                t.cpu2,
                t.gpu1,
                t.gpu2,
                read_cpu1,
                read_cpu2,
                read_gpu1,
                read_gpu2,
                cpu_ok,
                gpu_ok
            ),
        );

        if !cpu_ok {
            println!(
                "set_tdp CPU verify failed: want {}W/{}W got {}W/{}W",
                t.cpu1, t.cpu2, read_cpu1, read_cpu2
            );
        }
        if !gpu_ok {
            println!(
                "set_tdp GPU verify failed: want {}W/{}W got {}W/{}W (System might be overriding this)",
                t.gpu1, t.gpu2, read_gpu1, read_gpu2
            );
        }

        cpu_ok
    }
    pub fn set_cpu_tdp(&self, cpu1: i64, cpu2: i64) -> bool {
        app_log(
            "hardware",
            "info",
            "set_cpu_tdp.start",
            format!("cpu={}W/{}W", cpu1, cpu2),
        );
        let Some(_guard) = acquire_hw_lock(5) else {
            app_log(
                "hardware",
                "warn",
                "set_cpu_tdp.lock_failed",
                format!("cpu={}W/{}W", cpu1, cpu2),
            );
            println!("set_cpu_tdp failed: hardware lock unavailable");
            return false;
        };
        if !self.ensure_manual_control() {
            app_log(
                "hardware",
                "warn",
                "set_cpu_tdp.manual_control_failed",
                format!("cpu={}W/{}W", cpu1, cpu2),
            );
            return false;
        }
        let cpu1_out = self.ec_write_byte(EC_ADDR_TDP_CPU_PL1, cpu1);
        thread::sleep(Duration::from_millis(500));
        let cpu2_out = self.ec_write_byte(EC_ADDR_TDP_CPU_PL2, cpu2);
        thread::sleep(Duration::from_millis(500));

        if ec_call_failed(cpu1_out) || ec_call_failed(cpu2_out) {
            app_log(
                "hardware",
                "warn",
                "set_cpu_tdp.wmi_failed",
                format!("cpu1_out={} cpu2_out={}", cpu1_out, cpu2_out),
            );
            println!(
                "set_cpu_tdp WMI write failed: cpu1_out={} cpu2_out={}",
                cpu1_out, cpu2_out
            );
            return false;
        }

        let (read_cpu1, read_cpu2, _, _, _) = self.get_tdp();
        let ok = read_cpu1 == cpu1 && read_cpu2 == cpu2;
        app_log(
            "hardware",
            if ok { "info" } else { "warn" },
            "set_cpu_tdp.verify",
            format!(
                "want={}W/{}W got={}W/{}W ok={}",
                cpu1, cpu2, read_cpu1, read_cpu2, ok
            ),
        );
        if !ok {
            println!(
                "set_cpu_tdp verify failed: want={}W/{}W got={}W/{}W",
                cpu1, cpu2, read_cpu1, read_cpu2
            );
        }
        ok
    }
    pub fn set_ac_led_color_y(&self) -> bool {
        let Some(_guard) = acquire_hw_lock(3) else {
            println!("❌ set_ac_led_color_y 失败：无法获取硬件锁");
            return false;
        };
        let _ = WmiClient::global().send_wmi_set(W_AC_LED_COLOR_Y);
        true
    }
    pub fn set_ac_led_color_n(&self) -> bool {
        let Some(_guard) = acquire_hw_lock(3) else {
            println!("❌ set_ac_led_color_n 失败：无法获取硬件锁");
            return false;
        };
        let _ = WmiClient::global().send_wmi_set(W_AC_LED_COLOR_N);
        true
    }
    #[allow(dead_code)]
    pub fn set_dc_led_color_y(&self) -> bool {
        let _guard = match HW_ACCESS_LOCK.try_lock() {
            Ok(g) => g,
            Err(_) => {
                println!("⚠️ HW_ACCESS_LOCK 争用，跳过操作");
                return false;
            }
        };
        let _ = WmiClient::global().send_wmi_set(W_DC_LED_COLOR_Y);
        true
    }
    #[allow(dead_code)]
    pub fn set_dc_led_color_n(&self) -> bool {
        let _guard = match HW_ACCESS_LOCK.try_lock() {
            Ok(g) => g,
            Err(_) => {
                println!("⚠️ HW_ACCESS_LOCK 争用，跳过操作");
                return false;
            }
        };
        let _ = WmiClient::global().send_wmi_set(W_DC_LED_COLOR_N);
        true
    }
    /// 0 - Error, 1 - off, 2 - on
    pub fn get_ac_led_color(&self) -> i64 {
        let out = WmiClient::global().send_wmi_set(R_AC_LED_COLOR);
        match out & 0xff {
            2 => 1,
            4 => 1,
            34 => 2,
            36 => 2,
            _ => {
                println!("COLOR AC ERROR: {}", out);
                0
            }
        }
    }
    #[allow(dead_code)]
    pub fn get_dc_led_color(&self) -> i64 {
        let out = WmiClient::global().send_wmi_set(R_DC_LED_COLOR);
        match out {
            10 => 1,
            64 => 2,
            _ => {
                println!("COLOR DC ERROR: {}", out);
                0
            }
        }
    }
}

#[cfg(unix)]
pub struct ApiFan {
    pub cpu: PathBuf,
    pub gpu: PathBuf,
    pub r_fan_l: PathBuf,
    pub r_fan_r: PathBuf,
    pub w_fan_l: PathBuf,
    pub w_fan_r: PathBuf,
    pub mode: PathBuf,
    pub cpu_pl1: PathBuf,
    pub cpu_pl2: PathBuf,
    pub gpu_pl1: PathBuf,
    pub gpu_pl2: PathBuf,
}

#[cfg(unix)]
impl ApiFan {
    pub fn try_init() -> Result<Self, String> {
        Ok(Self::init())
    }

    pub fn init() -> Self {
        let (r_fan_l, r_fan_r, w_fan_l, w_fan_r) = if *MODEL_ID == 1 {
            (
                DRIVER_PATH.join("fan2_input"),
                DRIVER_PATH.join("fan1_input"),
                DRIVER_PATH.join("pwm2"),
                DRIVER_PATH.join("pwm1"),
            )
        } else {
            (
                DRIVER_PATH.join("fan1_input"),
                DRIVER_PATH.join("fan2_input"),
                DRIVER_PATH.join("pwm1"),
                DRIVER_PATH.join("pwm2"),
            )
        };
        ApiFan {
            cpu: DRIVER_PATH.join("temp1_input"),
            gpu: DRIVER_PATH.join("temp2_input"),
            r_fan_l,
            r_fan_r,
            w_fan_l,
            w_fan_r,
            mode: DRIVER_PATH.join("pwm1_enable"),
            cpu_pl1: DRIVER_PATH.join("power1_input"),
            cpu_pl2: DRIVER_PATH.join("power2_input"),
            gpu_pl1: DRIVER_PATH.join("power3_input"),
            gpu_pl2: DRIVER_PATH.join("power4_input"),
        }
    }
    pub fn get_cpu_temp(&self) -> i64 {
        get_sys(&self.cpu) / 1000
    }
    pub fn get_gpu_temp(&self) -> i64 {
        get_sys(&self.gpu) / 1000
    }
    pub fn get_fan_l(&self) -> i64 {
        get_sys(&self.r_fan_l)
    }
    pub fn get_fan_r(&self) -> i64 {
        get_sys(&self.r_fan_r)
    }
    pub fn set_fan_l(&self, n: i64) -> bool {
        let _guard = match HW_ACCESS_LOCK.try_lock() {
            Ok(g) => g,
            Err(_) => {
                println!("⚠️ HW_ACCESS_LOCK 争用（set_fan_l），跳过本次写入 n={}", n);
                return false;
            }
        };
        set_sys(&self.w_fan_l, n)
    }
    pub fn set_fan_r(&self, n: i64) -> bool {
        let _guard = match HW_ACCESS_LOCK.try_lock() {
            Ok(g) => g,
            Err(_) => {
                println!("⚠️ HW_ACCESS_LOCK 争用（set_fan_r），跳过本次写入 n={}", n);
                return false;
            }
        };
        set_sys(&self.w_fan_r, n)
    }
    /// MAX speed 255
    pub fn set_fan(&self, l: i64, r: i64) -> bool {
        self.set_fan_l(l) && self.set_fan_r(r)
    }
    pub fn set_fan_auto(&self) -> bool {
        let Some(_guard) = acquire_hw_lock(10) else {
            println!("❌ set_fan_auto 失败：无法获取硬件锁");
            return false;
        };
        set_sys(&self.mode, 2)
    }
    pub fn set_fan_control(&self) -> bool {
        let Some(_guard) = acquire_hw_lock(10) else {
            println!("❌ set_fan_control 失败：无法获取硬件锁");
            return false;
        };
        set_sys(&self.mode, 1)
    }
    pub fn get_fan_mode(&self) -> i64 {
        get_sys(&self.mode)
    }
    pub fn get_fan_speeds(&self) -> FanSpeeds {
        let left_fan = self.get_fan_l();
        let right_fan = self.get_fan_r();
        let left_temp = self.get_cpu_temp();
        let right_temp = self.get_gpu_temp();

        FanSpeeds {
            left_fan_speed: if (0..=7000).contains(&left_fan) {
                left_fan
            } else {
                0
            },
            right_fan_speed: if (0..=7000).contains(&right_fan) {
                right_fan
            } else {
                0
            },
            left_temp: if (1..=105).contains(&left_temp) {
                left_temp
            } else {
                0
            },
            right_temp: if (1..=105).contains(&right_temp) {
                right_temp
            } else {
                0
            },
            cpu_power_limit_w: None,
            cpu_power_short_w: None,
            gpu_power_limit_w: None,
            gpu_power_short_w: None,
        }
    }
    pub fn get_tdp(&self) -> (i64, i64, i64, i64, i64) {
        (
            get_sys(&self.cpu_pl1) / 1000,
            get_sys(&self.cpu_pl2) / 1000,
            get_sys(&self.gpu_pl1) / 1000,
            get_sys(&self.gpu_pl2) / 1000,
            0,
        )
    }
    pub fn set_tdp(&self, t: TDP) -> bool {
        let Some(_guard) = acquire_hw_lock(5) else {
            println!("❌ set_tdp 失败：无法获取硬件锁");
            return false;
        };
        let writes_ok = set_sys(&self.cpu_pl1, t.cpu1 * 1000)
            && set_sys(&self.cpu_pl2, t.cpu2 * 1000)
            && set_sys(&self.gpu_pl1, t.gpu1 * 1000)
            && set_sys(&self.gpu_pl2, t.gpu2 * 1000);
        if !writes_ok {
            return false;
        }
        let (read_cpu1, read_cpu2, read_gpu1, read_gpu2, _) = self.get_tdp();
        read_cpu1 == t.cpu1 && read_cpu2 == t.cpu2 && read_gpu1 == t.gpu1 && read_gpu2 == t.gpu2
    }
    pub fn set_cpu_tdp(&self, cpu1: i64, cpu2: i64) -> bool {
        app_log(
            "hardware",
            "info",
            "set_cpu_tdp.start",
            format!("platform=linux cpu={}W/{}W", cpu1, cpu2),
        );
        let Some(_guard) = acquire_hw_lock(5) else {
            app_log(
                "hardware",
                "warn",
                "set_cpu_tdp.lock_failed",
                format!("platform=linux cpu={}W/{}W", cpu1, cpu2),
            );
            println!("set_cpu_tdp failed: hardware lock unavailable");
            return false;
        };
        let writes_ok = set_sys(&self.cpu_pl1, cpu1 * 1000) && set_sys(&self.cpu_pl2, cpu2 * 1000);
        if !writes_ok {
            app_log(
                "hardware",
                "warn",
                "set_cpu_tdp.sysfs_failed",
                format!("cpu={}W/{}W", cpu1, cpu2),
            );
            return false;
        }
        let (read_cpu1, read_cpu2, _, _, _) = self.get_tdp();
        let ok = read_cpu1 == cpu1 && read_cpu2 == cpu2;
        app_log(
            "hardware",
            if ok { "info" } else { "warn" },
            "set_cpu_tdp.verify",
            format!(
                "platform=linux want={}W/{}W got={}W/{}W ok={}",
                cpu1, cpu2, read_cpu1, read_cpu2, ok
            ),
        );
        ok
    }
}
