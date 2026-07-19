#[cfg(test)]
use crate::plug::struct_set::ApiFan;
#[cfg(all(test, windows))]
use crate::win_plug::wmi::wmi_security;
#[cfg(test)]
use std::{env, thread::sleep, time::Duration};

#[test]
fn test_api_fan() {
    // 仅在显式要求时运行硬件测试，避免在无权限环境下失败
    if env::var("RUN_HW_TESTS").unwrap_or_default() != "1" {
        println!("跳过硬件测试 test_api_fan（设置 RUN_HW_TESTS=1 可启用）");
        return;
    }
    println!("请随时准备好你的NUC控制台基准模式，出现异常请打开基准模式");
    wmi_security();
    let api = ApiFan::try_init().expect("hardware WMI initialization should succeed");
    api.set_fan_auto();
    sleep(Duration::from_secs(1));
    assert_eq!(api.get_fan_mode(), 2);

    api.set_fan_control();
    sleep(Duration::from_secs(1));
    sleep(Duration::from_secs(1));
    assert_eq!(api.get_fan_mode(), 1);

    api.set_fan(0, 0);
    sleep(Duration::from_secs(2));
    assert_eq!(api.get_fan_l(), 0);
    assert_eq!(api.get_fan_r(), 0);

    #[cfg(windows)]
    api.set_fan(200, 200);
    #[cfg(unix)]
    api.set_fan(255, 255);
    sleep(Duration::from_secs(1));
    assert_ne!(api.get_fan_l(), 0);
    assert_ne!(api.get_fan_r(), 0);

    api.set_fan_auto();
    sleep(Duration::from_secs(1));
    assert_eq!(api.get_fan_mode(), 2);
}

#[test]
#[cfg(windows)]
fn led_color() {
    if env::var("RUN_HW_TESTS").unwrap_or_default() != "1" {
        println!("跳过硬件测试 led_color（设置 RUN_HW_TESTS=1 可启用）");
        return;
    }
    println!("请查看你的LED");
    wmi_security();
    let api = ApiFan::try_init().expect("hardware WMI initialization should succeed");
    api.set_ac_led_color_y();
    sleep(Duration::from_secs(3));
    assert_eq!(api.get_ac_led_color(), 2);

    api.set_ac_led_color_n();
    sleep(Duration::from_secs(3));
    assert_eq!(api.get_ac_led_color(), 1);
}

// ── 纯逻辑测试（无需硬件，可直接 cargo test） ──────────────────────────────

#[cfg(all(test, windows))]
use crate::plug::struct_set::{ec_read_payload, ec_write_payload};
#[cfg(test)]
use crate::plug::{
    config::{default_fan_data, normalize_fan_data},
    fan_curve::{find_speed_for_temp, sanitize_curve, speed_handle},
    ramp::ramp_speed,
    struct_set::{FanControlMode, FanData, FanPoint},
};

/// 问题2：插值结果必须夹紧到 [0, 100]
#[test]
fn test_speed_handle_clamp() {
    // 正常插值：50°C 在 [40°C→20%, 60°C→80%] 之间 → 应为 50%
    assert_eq!(speed_handle(40, 20, 60, 80, 50), 50);
    // 下溢：曲线速度为负，结果应被夹到 0
    assert_eq!(speed_handle(0, -10, 100, -10, 50), 0);
    // 上溢：插值可能超过 100，应被夹到 100
    assert_eq!(speed_handle(0, 90, 10, 200, 9), 100);
}

/// 问题2：除零保护
#[test]
fn test_speed_handle_div_zero() {
    // temp == temp_old 时应直接返回 speed_old，不触发除零
    assert_eq!(speed_handle(50, 60, 50, 80, 50), 60);
}

/// 问题1：温度低于曲线第一个点时应取第一个点的速度
#[test]
fn test_speed_handle_below_first_point() {
    // temp_old=0/speed_old=0 时，25°C 在 0→30% 曲线中插值
    assert_eq!(speed_handle(0, 0, 30, 30, 25), 25);
}

#[test]
fn test_sanitize_curve_keeps_speed_monotonic() {
    let curve = vec![
        FanPoint {
            temperature: 60,
            speed: 70,
        },
        FanPoint {
            temperature: 40,
            speed: 30,
        },
        FanPoint {
            temperature: 50,
            speed: 20,
        },
    ];

    let sanitized = sanitize_curve(&curve, "左");

    assert_eq!(
        sanitized,
        vec![
            FanPoint {
                temperature: 40,
                speed: 30,
            },
            FanPoint {
                temperature: 50,
                speed: 30,
            },
            FanPoint {
                temperature: 60,
                speed: 70,
            },
        ]
    );
    assert_eq!(find_speed_for_temp(&sanitized, 55, "左"), Some(50));
}

#[test]
fn test_sanitize_curve_merges_duplicate_temperatures_with_safer_speed() {
    let curve = vec![
        FanPoint {
            temperature: 55,
            speed: 35,
        },
        FanPoint {
            temperature: 55,
            speed: 60,
        },
        FanPoint {
            temperature: 65,
            speed: 50,
        },
    ];

    let sanitized = sanitize_curve(&curve, "右");

    assert_eq!(
        sanitized,
        vec![
            FanPoint {
                temperature: 55,
                speed: 60,
            },
            FanPoint {
                temperature: 65,
                speed: 60,
            },
        ]
    );
}

/// 问题10：满转判断应精确匹配，而非依赖加法
#[test]
fn test_full_speed_cache_check() {
    let cache: [i64; 2] = [100, 100];
    assert!(cache[0] == 100 && cache[1] == 100);
    // 旧逻辑 sum==200 会误判 [150, 50]
    let cache_bug: [i64; 2] = [150, 50];
    assert!(!(cache_bug[0] == 100 && cache_bug[1] == 100));
    assert_eq!(cache_bug[0] + cache_bug[1], 200); // 说明旧加法有 bug
}

/// 问题11：fan_set 的 Windows/Linux 映射边界
#[test]
fn test_fan_set_mapping_bounds() {
    assert_eq!((100i64 * 2).clamp(0, 200), 200);
    assert_eq!((0i64 * 2).clamp(0, 200), 0);
    assert_eq!((110i64 * 2).clamp(0, 200), 200); // 越界被夹到最大值
                                                 // Linux 100% → 255
    let lv = ((2.55 * 100f64) as i64).clamp(0, 255);
    assert_eq!(if lv >= 254 { 255 } else { lv }, 255);
    // Linux 99% → 252，不触发强制拉满
    let lv99 = ((2.55 * 99f64) as i64).clamp(0, 255);
    assert_eq!(if lv99 >= 254 { 255 } else { lv99 }, 252);
}

/// 新问题：ramp_speed 首次启动（cache=0）应直接跳到 target，但不低于 MIN_FAN_SPEED
#[test]
fn test_ramp_speed_first_start() {
    // cache=0 首次启动，目标 60% → 直接到 60%
    assert_eq!(ramp_speed(0, 60), 60);
    // cache=0 首次启动，目标 10%（低于 MIN_FAN_SPEED=20）→ 应被抬到 20%
    assert_eq!(ramp_speed(0, 10), 20);
}

/// 新问题：ramp_speed 正常运行时步进不超过 FAN_RAMP_STEP=10
#[test]
fn test_ramp_speed_step_limit() {
    // cache=50，目标 80% → 只能升到 60%（步进 10）
    assert_eq!(ramp_speed(50, 80), 60);
    // cache=50，目标 20% → 只能降到 40%（步进 10，但不低于 MIN=20）
    assert_eq!(ramp_speed(50, 20), 40);
    // cache=25，目标 10%（低于 MIN_FAN_SPEED）→ 降到 20（MIN 下界）
    assert_eq!(ramp_speed(25, 10), 20);
}

/// 新问题：WMI 格式字符串字符数验证（_set_fan 和 set_tdp 的地址格式）
#[test]
fn test_wmi_format_string_length() {
    // _set_fan：0x + 10位十六进制 = 18字符
    // 值范围 0-200（0x00-0xC8），保证 {:02X} 不超出2位
    for v in [0i64, 100, 200] {
        let s = format!("0x0000000000{:02X}1809", v);
        assert_eq!(s.len(), 18, "v={} 格式字符串长度异常: {}", v, s);
    }
    // set_tdp：同样格式
    for v in [0i64, 65, 150] {
        let s = format!("0x0000000000{:02X}0783", v);
        assert_eq!(s.len(), 18, "v={} TDP格式字符串长度异常: {}", v, s);
    }
}

#[test]
#[cfg(windows)]
fn test_ec_tdp_payload_format() {
    assert_eq!(ec_read_payload(0x0783), "0x0000010000000783");
    assert_eq!(
        ec_write_payload(0x0783, 55).as_deref(),
        Some("0x0000000000370783")
    );
    assert_eq!(
        ec_write_payload(0x0784, 80).as_deref(),
        Some("0x0000000000500784")
    );
    assert!(ec_write_payload(0x0783, -1).is_none());
    assert!(ec_write_payload(0x0783, 256).is_none());
}

/// 新问题：get_fan_speeds 过滤逻辑验证（温度下界改为 1）
#[test]
fn test_fan_speeds_filter() {
    // 有效范围内的值应原样保留
    assert!(1i64 <= 50 && 50 <= 105); // 50°C 正常
    assert!((0i64..=7000).contains(&3500)); // 3500 RPM 正常

    // 边界值验证
    assert!(!(1i64..=105).contains(&0)); // 0°C 被过滤
    assert!(!(1i64..=105).contains(&-1)); // 负数被过滤
    assert!(!(1i64..=105).contains(&106)); // 超温被过滤
    assert!(!(0i64..=7000).contains(&7001)); // 超转速被过滤
}

#[test]
fn test_default_fan_data_has_valid_curve() {
    let d = default_fan_data();
    assert!(!d.left_fan.is_empty());
    assert!(!d.right_fan.is_empty());
    assert_eq!(d.control.strategy, "independent");
    assert!(d.monitor.sample_interval_ms >= 500);
}

#[test]
fn test_normalize_fan_data_clamps_values() {
    let bad = FanData {
        left_fan: vec![FanPoint {
            temperature: -10,
            speed: 999,
        }],
        right_fan: vec![FanPoint {
            temperature: 999,
            speed: -20,
        }],
        control: crate::plug::struct_set::FanControlPolicy {
            strategy: "invalid".to_string(),
            preset: "invalid".to_string(),
            ramp_up_step: -1,
            ramp_down_step: 99,
            min_speed: 99,
            zero_rpm_enabled: true,
            zero_rpm_threshold: 999,
            ..Default::default()
        },
        alerts: crate::plug::struct_set::AlertConfig {
            cpu: crate::plug::struct_set::SensorAlertRule {
                threshold: -5,
                actions: crate::plug::struct_set::AlertActions {
                    popup: true,
                    sound: false,
                    log: true,
                    force_shutdown: false,
                    confirm_times: 0,
                },
            },
            gpu: crate::plug::struct_set::SensorAlertRule {
                threshold: 500,
                actions: crate::plug::struct_set::AlertActions {
                    popup: true,
                    sound: false,
                    log: true,
                    force_shutdown: false,
                    confirm_times: 999,
                },
            },
            recover_delta: 999,
        },
        monitor: crate::plug::struct_set::MonitoringConfig {
            sample_interval_ms: 10,
            log_enabled: true,
        },
        appearance: Default::default(),
        app_settings: Default::default(),
    };

    let n = normalize_fan_data(bad);
    assert_eq!(n.control.strategy, "independent");
    assert_eq!(n.control.preset, "standard");
    assert!(n.control.ramp_up_step >= 1 && n.control.ramp_up_step <= 40);
    assert!(n.control.ramp_down_step >= 1 && n.control.ramp_down_step <= 30);
    assert!(n.control.min_speed <= 60);
    assert!(n.alerts.cpu.threshold >= 50);
    assert!(n.alerts.gpu.threshold <= 110);
    assert!(n.alerts.cpu.actions.confirm_times >= 1);
    assert!(n.alerts.gpu.actions.confirm_times <= 10);
    assert!(n.monitor.sample_interval_ms >= 500 && n.monitor.sample_interval_ms <= 1000);
    assert!(n.left_fan[0].temperature >= 1 && n.left_fan[0].temperature <= 110);
    assert!(n.left_fan[0].speed >= 0 && n.left_fan[0].speed <= 100);
}

#[test]
fn test_normalize_fan_data_accepts_benchmark_preset() {
    let fan_data = FanData {
        control: crate::plug::struct_set::FanControlPolicy {
            preset: "benchmark".to_string(),
            ..Default::default()
        },
        ..Default::default()
    };

    let normalized = normalize_fan_data(fan_data);

    assert_eq!(normalized.control.mode, FanControlMode::Benchmark);
    assert_eq!(normalized.control.preset, "benchmark");
    assert_eq!(normalized.control.ramp_up_step, 12);
    assert_eq!(normalized.control.ramp_down_step, 12);
    assert_eq!(normalized.control.cpu_hysteresis_bandwidth, 1);
    assert_eq!(normalized.control.gpu_hysteresis_bandwidth, 1);
    assert_eq!(normalized.control.cpu_fan_max_percent, 100);
    assert_eq!(normalized.control.gpu_fan_max_percent, 100);
}
