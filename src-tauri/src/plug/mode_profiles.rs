use crate::plug::struct_set::{FanControlMode, FanPoint};

#[derive(Clone)]
pub struct ModeSpec {
    pub cpu_start_temp: i64,
    pub cpu_slope_end_temp: i64,
    pub cpu_full_speed_temp: i64,
    pub gpu_start_temp: i64,
    pub gpu_slope_end_temp: i64,
    pub gpu_full_speed_temp: i64,
    pub ramp_step_percent_per_sec: i64,
    pub hysteresis_bandwidth: i64,
    pub cpu_fan_max_percent: i64,
    pub gpu_fan_max_percent: i64,
}

fn mode_spec(mode: &FanControlMode) -> ModeSpec {
    match mode {
        FanControlMode::Silent => ModeSpec {
            cpu_start_temp: 50,
            cpu_slope_end_temp: 75,
            cpu_full_speed_temp: 90,
            gpu_start_temp: 48,
            gpu_slope_end_temp: 70,
            gpu_full_speed_temp: 85,
            ramp_step_percent_per_sec: 2,
            hysteresis_bandwidth: 8,
            cpu_fan_max_percent: 35,
            gpu_fan_max_percent: 30,
        },
        FanControlMode::Office => ModeSpec {
            cpu_start_temp: 45,
            cpu_slope_end_temp: 70,
            cpu_full_speed_temp: 85,
            gpu_start_temp: 43,
            gpu_slope_end_temp: 65,
            gpu_full_speed_temp: 82,
            ramp_step_percent_per_sec: 3,
            hysteresis_bandwidth: 5,
            cpu_fan_max_percent: 55,
            gpu_fan_max_percent: 45,
        },
        FanControlMode::Gaming => ModeSpec {
            cpu_start_temp: 40,
            cpu_slope_end_temp: 75,
            cpu_full_speed_temp: 85,
            gpu_start_temp: 38,
            gpu_slope_end_temp: 70,
            gpu_full_speed_temp: 83,
            ramp_step_percent_per_sec: 5,
            hysteresis_bandwidth: 3,
            cpu_fan_max_percent: 80,
            gpu_fan_max_percent: 90,
        },
        FanControlMode::Performance => ModeSpec {
            cpu_start_temp: 35,
            cpu_slope_end_temp: 70,
            cpu_full_speed_temp: 80,
            gpu_start_temp: 35,
            gpu_slope_end_temp: 65,
            gpu_full_speed_temp: 78,
            ramp_step_percent_per_sec: 8,
            hysteresis_bandwidth: 2,
            cpu_fan_max_percent: 100,
            gpu_fan_max_percent: 100,
        },
        FanControlMode::Custom => ModeSpec {
            cpu_start_temp: 45,
            cpu_slope_end_temp: 70,
            cpu_full_speed_temp: 85,
            gpu_start_temp: 43,
            gpu_slope_end_temp: 65,
            gpu_full_speed_temp: 82,
            ramp_step_percent_per_sec: 4,
            hysteresis_bandwidth: 5,
            cpu_fan_max_percent: 100,
            gpu_fan_max_percent: 100,
        },
    }
}

fn curve_from_profile(
    start_temp: i64,
    slope_end_temp: i64,
    full_speed_temp: i64,
    max_percent: i64,
) -> Vec<FanPoint> {
    let low_speed = 20i64.min(max_percent);
    let mid_speed = ((max_percent as f64) * 0.65).round() as i64;
    let high_speed = ((max_percent as f64) * 0.88).round() as i64;

    vec![
        FanPoint {
            temperature: (start_temp - 8).max(25) as i32,
            speed: low_speed.clamp(0, 100) as i32,
        },
        FanPoint {
            temperature: start_temp as i32,
            speed: low_speed.clamp(0, 100) as i32,
        },
        FanPoint {
            temperature: ((start_temp + slope_end_temp) / 2) as i32,
            speed: mid_speed.clamp(0, 100) as i32,
        },
        FanPoint {
            temperature: slope_end_temp as i32,
            speed: high_speed.clamp(0, 100) as i32,
        },
        FanPoint {
            temperature: full_speed_temp as i32,
            speed: max_percent.clamp(0, 100) as i32,
        },
    ]
}

pub fn default_profile_curves(mode: &FanControlMode) -> (Vec<FanPoint>, Vec<FanPoint>) {
    let spec = mode_spec(mode);
    (
        curve_from_profile(
            spec.cpu_start_temp,
            spec.cpu_slope_end_temp,
            spec.cpu_full_speed_temp,
            spec.cpu_fan_max_percent,
        ),
        curve_from_profile(
            spec.gpu_start_temp,
            spec.gpu_slope_end_temp,
            spec.gpu_full_speed_temp,
            spec.gpu_fan_max_percent,
        ),
    )
}

pub fn default_ramp_step_for_mode(mode: &FanControlMode) -> i64 {
    mode_spec(mode).ramp_step_percent_per_sec
}

pub fn default_hysteresis_for_mode(mode: &FanControlMode) -> i64 {
    mode_spec(mode).hysteresis_bandwidth
}

pub fn default_cpu_fan_max_for_mode(mode: &FanControlMode) -> i64 {
    mode_spec(mode).cpu_fan_max_percent
}

pub fn default_gpu_fan_max_for_mode(mode: &FanControlMode) -> i64 {
    mode_spec(mode).gpu_fan_max_percent
}
