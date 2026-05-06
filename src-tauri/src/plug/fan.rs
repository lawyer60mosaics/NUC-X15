use std::{
    sync::{
        Arc, RwLock, OnceLock,
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc::{self, SyncSender, TryRecvError},
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
    thread,
    fs::OpenOptions,
    io::Write,
    path::PathBuf,
    process::Command,
};
use tauri::{Emitter, Manager, Window};
use colored::Colorize;

#[cfg(windows)]
use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};

use crate::plug::{
    constants::{
        FAN_RAMP_STEP, FAN_RAMP_STEP_DOWN,
        FAST_RAMP_UP, MAX_FAN_SPEED_PERCENT, MAX_SENSOR_RPM, MAX_TEMP_LIMIT,
        MAX_MONITOR_SAMPLE_INTERVAL_MS, MIN_MONITOR_SAMPLE_INTERVAL_MS, MIN_TEMP_LIMIT,
        SPEED_EMA_ALPHA, TEMP_EMA_ALPHA, TEMP_EMERGENCY, TEMP_JUMP_THRESHOLD,
        WAKE_COOLDOWN_SPEED,
    },
    fan_curve::find_speed_for_temp,
    ramp::ramp_speed_internal,
    config::get_monitor_log_file_path,
    diagnostics::app_log,
    mode_profiles::{
        default_cpu_fan_max_for_mode,
        default_gpu_fan_max_for_mode,
        default_hysteresis_for_mode,
        default_ramp_step_for_mode,
    },
    struct_set::{
        ApiFan, FanActorSnapshot, FanControlMode, FanControlPolicy,
        FanData, FanSpeeds, TDP,
    },
    models::ControlState,
};

// 推送线程全局唯一标志，防止重复调用累积线程
static SPEED_PUSH_RUNNING: AtomicBool = AtomicBool::new(false);
static FORCE_SHUTDOWN_QUEUED: AtomicBool = AtomicBool::new(false);
static SENSOR_PUSH_INTERVAL_MS: std::sync::atomic::AtomicU64 =
    std::sync::atomic::AtomicU64::new(1000);
/// Fan Actor 通道：RwLock 允许 Actor 挂死后替换通道
static FAN_ACTOR_TX: RwLock<Option<SyncSender<FanActorMessage>>> = RwLock::new(None);
/// 外部看门狗心跳，Actor 在每次 WMI 调用前更新
static ACTOR_HEARTBEAT: AtomicU64 = AtomicU64::new(0);
/// Actor 被看门狗判定为挂死时置 true
static ACTOR_HUNG: AtomicBool = AtomicBool::new(false);
const INVALID_TEMP_RELEASE_THRESHOLD: u8 = 3;

/// 全局共享快照：Fan Actor 写入，Async 层只读，零阻塞
static SNAPSHOT: OnceLock<Arc<RwLock<FanActorSnapshot>>> = OnceLock::new();

fn shared_snapshot() -> &'static Arc<RwLock<FanActorSnapshot>> {
    SNAPSHOT.get().expect("SNAPSHOT not initialized")
}

fn read_snapshot() -> FanActorSnapshot {
    shared_snapshot()
        .read()
        .map(|s| s.clone())
        .unwrap_or_default()
}

fn update_snapshot(speeds: &FanSpeeds, ctrl_state: &ControlState) {
    if let Ok(mut snap) = shared_snapshot().write() {
        snap.cpu_temp = Some(speeds.left_temp);
        snap.gpu_temp = Some(speeds.right_temp);
        snap.cpu_fan_rpm = Some(speeds.left_fan_speed);
        snap.gpu_fan_rpm = Some(speeds.right_fan_speed);
        snap.active_mode = ctrl_state.active_mode.as_str().to_string();
        snap.running = true;
        snap.constant_mode = ctrl_state.constant_mode;
        snap.constant_speed = ctrl_state.constant_speed;
        snap.sampled_at_ms = Some(now_ms());
        snap.hung = ACTOR_HUNG.load(Ordering::SeqCst);
        snap.last_heartbeat_ms = Some(ACTOR_HEARTBEAT.load(Ordering::SeqCst) as u128);
    }
}

/// 由 main.rs 在启动时调用，注入共享快照实例
pub fn init_snapshot(snap: Arc<RwLock<FanActorSnapshot>>) {
    SNAPSHOT.set(snap).ok();
}

#[cfg(windows)]
pub(crate) fn init_com_on_thread() {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    }
}

#[cfg(not(windows))]
pub(crate) fn init_com_on_thread() {}

enum FanActorMessage {
    Start { fan_data: FanData, window: Window },
    UpdatePolicy { fan_data: FanData },
    Stop,
    GetTdp { reply: mpsc::SyncSender<(i64, i64, i64, i64, i64)> },
    SetTdp { tdp: TDP, reply: mpsc::SyncSender<bool> },
    SetCpuTdp { cpu1: i64, cpu2: i64, reply: mpsc::SyncSender<bool> },
    LockCpuTdp { cpu1: i64, cpu2: i64, reply: mpsc::SyncSender<bool> },
    SetRgbColorY { reply: mpsc::SyncSender<bool> },
    SetRgbColorN { reply: mpsc::SyncSender<bool> },
    GetRgbColor { reply: mpsc::SyncSender<bool> },
}

#[allow(dead_code)]
pub fn fan_init() {
    ApiFan::init().set_fan_control();
    println!("{}", "风扇初始化成功".green());
}

pub fn fan_reset() {
    app_log("fan", "info", "fan_reset.start", "setting fan mode to auto");
    ApiFan::init().set_fan_auto();
    app_log("fan", "info", "fan_reset.done", "set_fan_auto returned");
    println!("{}", "风扇状态重置".red());
}

/// 将百分比转换为硬件原始值并写入风扇
/// Windows: 0-100% → 0-200 (寄存器值)
/// Linux:   0-100% → 0-255 (PWM 值)
pub fn fan_set(left: i64, right: i64, driver: &ApiFan) {
    #[cfg(windows)]
    let (l, r) = ((left * 2).clamp(0, 200), (right * 2).clamp(0, 200));
    #[cfg(unix)]
    let (l, r): (i64, i64) = {
        let lv = ((2.55 * left as f64) as i64).clamp(0, 255);
        let rv = ((2.55 * right as f64) as i64).clamp(0, 255);
        // 接近满值时强制拉满，避免卡在 254 无法满转
        (if lv >= 254 { 255 } else { lv }, if rv >= 254 { 255 } else { rv })
    };
    let ok = driver.set_fan(l, r);
    app_log("fan", if ok { "debug" } else { "warn" }, "fan_set", format!("left={} right={} raw_left={} raw_right={} ok={}", left, right, l, r, ok));
    println!("FAN_L: {}% / FAN_R: {}% RAW: {}/{} RESULT:{}", left, right, l, r, ok);
}


/// 核心控制循环：读取温度，查找曲线，限速写入硬件
fn apply_fan_curve(
    fan_data: &FanData,
    driver: &ApiFan,
    state: &mut ControlState,
    speeds: &FanSpeeds,
    window: Option<&Window>,
) {
    let cpu_out = speeds.left_temp;
    let gpu_out = speeds.right_temp;
    let cpu_fan_rpm = speeds.left_fan_speed;
    let gpu_fan_rpm = speeds.right_fan_speed;
    let constant_mode = is_constant_mode(&fan_data.control);
    let control_sleep_ms = fan_data
        .monitor
        .sample_interval_ms
        .max(MIN_MONITOR_SAMPLE_INTERVAL_MS);

    if fan_data.monitor.log_enabled {
        append_monitor_log(fan_data, cpu_out, gpu_out, cpu_fan_rpm, gpu_fan_rpm);
    }

    // 过滤异常温度读数（<= 0 或 > 110 视为硬件读数异常）
    // 在睡眠/现代待机阶段常见传感器异常。
    // 恒速模式下不能切自动，否则系统策略可能把风扇拉到满转。
    if cpu_out < MIN_TEMP_LIMIT || cpu_out > MAX_TEMP_LIMIT || gpu_out < MIN_TEMP_LIMIT || gpu_out > MAX_TEMP_LIMIT {
        state.invalid_temp_streak = state.invalid_temp_streak.saturating_add(1);
        println!(
            "温度读数异常 cpu={} gpu={}，异常计数={}",
            cpu_out,
            gpu_out,
            state.invalid_temp_streak
        );
        if constant_mode {
            let target = constant_speed_target(&fan_data.control);
            if driver.get_fan_mode() == 2 {
                let switched = driver.set_fan_control();
                println!("恒速模式下恢复手动控制: {}", switched);
            }
            if state.fan_cache != [target, target] {
                println!("恒速模式保底写入 {}%（异常温度期间）", target);
                fan_set(target, target, driver);
                state.fan_cache = [target, target];
            }
            state.ema_target_left = target as f64;
            state.ema_target_right = target as f64;
            thread::sleep(Duration::from_millis(control_sleep_ms));
            return;
        }
        if state.invalid_temp_streak >= INVALID_TEMP_RELEASE_THRESHOLD && !state.released_to_auto_due_invalid {
            println!("{}", "⚠️ 连续温度异常，临时切换自动风扇等待传感器恢复".yellow());
            let switched = driver.set_fan_auto();
            println!("切换自动风扇: {}", switched);
            state.released_to_auto_due_invalid = true;
            state.fan_cache = [0, 0];
            state.ema_target_left = 0.0;
            state.ema_target_right = 0.0;
        }
        thread::sleep(Duration::from_secs(2));
        return;
    }

    if state.invalid_temp_streak > 0 {
        state.invalid_temp_streak = 0;
    }
    if state.released_to_auto_due_invalid {
        println!("{}", "✅ 温度读数恢复，重新接管手动风扇控制".green());
        let switched = driver.set_fan_control();
        println!("重新接管手动风扇: {}", switched);
        state.released_to_auto_due_invalid = false;
        state.fan_cache = [0, 0];
        state.ema_target_left = 0.0;
        state.ema_target_right = 0.0;
        // 丢弃睡眠前的 EMA 残留，防止过时 EMA 与唤醒后瞬时温度叠加产生虚高目标
        state.ema_cpu = 0.0;
        state.ema_gpu = 0.0;
        // 进入唤醒冷却期：苏醒后以保守转速运行 ~30 秒，给传感器和系统充分的稳定窗口
        state.wake_cooldown_ticks_remaining =
            (30_000u64 / control_sleep_ms.max(500)).max(1).min(60) as u32;
    }

    // 初始化 EMA（首次调用或冷却期重置后直接用当前读数）
    if state.ema_cpu == 0.0 {
        state.ema_cpu = cpu_out as f64;
    }
    if state.ema_gpu == 0.0 {
        state.ema_gpu = gpu_out as f64;
    }

    // 温度 EMA 平滑，减弱瞬时抖动
    let ema_cpu_new = TEMP_EMA_ALPHA * (cpu_out as f64) + (1.0 - TEMP_EMA_ALPHA) * state.ema_cpu;
    let ema_gpu_new = TEMP_EMA_ALPHA * (gpu_out as f64) + (1.0 - TEMP_EMA_ALPHA) * state.ema_gpu;
    let cpu_use = ema_cpu_new.round() as i64;
    let gpu_use = ema_gpu_new.round() as i64;

    // 恒速开启时不参与场景动态切换，避免“场景名在变但实际恒速生效”的混淆。
    if constant_mode {
        state.active_mode = fan_data.control.mode.clone();
    } else {
        // 动态模式切换使用平滑温度，避免办公场景被瞬时读数尖峰误触发高转。
        update_dynamic_mode(fan_data, state, cpu_use, gpu_use);
    }
    update_tray_status(window, &state.active_mode, cpu_out, gpu_out);

    // 告警仍使用原始温度，保证高温风险不被平滑延迟掩盖。
    process_alerts(fan_data, state, cpu_out, gpu_out, window);

    println!("CPU:{}°C (EMA {:.2}) GPU:{}°C (EMA {:.2}) cacheL:{}% cacheR:{}%", cpu_out, ema_cpu_new, gpu_out, ema_gpu_new, state.fan_cache[0], state.fan_cache[1]);

    // 检测风扇被系统切回自动模式（如 OSD/电源计划切换），尝试重新接管但不要立即返回，避免留下硬件在自动高转速状态
    if driver.get_fan_mode() == 2 {
        println!("{}", "⚠️ 风扇被切回自动模式，正在恢复手动控制...".yellow());
        // 立即切回手动并重置缓存/EMA以便马上按曲线写入
        let set_ok = driver.set_fan_control();
        println!("恢复手动控制: {}", set_ok);
        state.fan_cache = [0, 0];
        state.ema_cpu = cpu_out as f64;
        state.ema_gpu = gpu_out as f64;
        // 不再 return；继续按曲线计算并写入，避免硬件长时间处于自动策略
    }

    // 过温保护：超过 TEMP_EMERGENCY 立即满转
    if cpu_out > TEMP_EMERGENCY || gpu_out > TEMP_EMERGENCY {
        if state.fan_cache[0] == 100 && state.fan_cache[1] == 100 {
            println!("{}", "⚠️ 过温，风扇已满转，跳过重复写入".red());
        } else {
            println!("{}", "🔥 过温保护触发，风扇全速运转！".red().bold());
            fan_set(100, 100, driver);
            (state.fan_cache[0], state.fan_cache[1]) = (100, 100);
        }
        thread::sleep(Duration::from_secs(4));
        // 更新 EMA 带入最新读数
        state.ema_cpu = ema_cpu_new;
        state.ema_gpu = ema_gpu_new;
        return;
    }

    // 过温解除后，若缓存仍为满速，重置为 0 使斜坡从目标速度直接跳入
    // 避免从 100% 以每步 10% 缓慢降速，带来长达数十秒的不必要满速
    if state.fan_cache[0] == 100 && state.fan_cache[1] == 100 {
        println!("{}", "✅ 过温已解除，重置缓存以快速恢复正常转速".green());
        state.fan_cache = [0, 0];
    }

    // 唤醒冷却期：传感器刚从睡眠/异常中恢复时，以保守转速运行一段时间。
    // 防止 EC 复位满转、传感器瞬时尖峰、或 COM 恢复期内的不稳定读数导致风扇暴走。
    if state.wake_cooldown_ticks_remaining > 0 {
        let cs = WAKE_COOLDOWN_SPEED;
        if state.fan_cache != [cs, cs] {
            println!("🧊 唤醒冷却期 (剩余 {} 个周期)，风扇保持 {}% 保守转速",
                state.wake_cooldown_ticks_remaining, cs);
            fan_set(cs, cs, driver);
            state.fan_cache = [cs, cs];
        }
        state.wake_cooldown_ticks_remaining = state.wake_cooldown_ticks_remaining.saturating_sub(1);
        state.ema_cpu = cpu_out as f64;
        state.ema_gpu = gpu_out as f64;
        state.ema_target_left = cs as f64;
        state.ema_target_right = cs as f64;
        thread::sleep(Duration::from_millis(control_sleep_ms));
        return;
    }

    if fan_data.left_fan.is_empty() {
        println!("{}", "左风扇曲线数据无效（没有有效点）".red());
        return;
    }
    if fan_data.right_fan.is_empty() {
        println!("{}", "右风扇曲线数据无效（没有有效点）".red());
        return;
    }

    if constant_mode {
        let target = constant_speed_target(&fan_data.control);
        if fan_data.control.control_mode.eq_ignore_ascii_case("constant") {
            println!("🔒 控制模式: 恒速模式，固定 {}%", target);
        } else {
            println!("🔒 控制模式: 恒速配置已启用，固定 {}%", target);
        }
        if state.fan_cache != [target, target] {
            fan_set(target, target, driver);
            state.fan_cache = [target, target];
        }
        state.ema_target_left = target as f64;
        state.ema_target_right = target as f64;
        state.ema_cpu = cpu_out as f64;
        state.ema_gpu = gpu_out as f64;
        thread::sleep(Duration::from_millis(control_sleep_ms));
        return;
    }

    // 从曲线查找目标转速（使用 EMA 后的温度）
    let mut target_left_raw = match find_speed_for_temp(&fan_data.left_fan, cpu_use, "左") {
        Some(s) => s.clamp(0, MAX_FAN_SPEED_PERCENT),
        None => return,
    };
    let mut target_right_raw = match find_speed_for_temp(&fan_data.right_fan, gpu_use, "右") {
        Some(s) => s.clamp(0, MAX_FAN_SPEED_PERCENT),
        None => return,
    };

    apply_strategy(
        &fan_data.control,
        cpu_use,
        gpu_use,
        &mut target_left_raw,
        &mut target_right_raw,
    );

    apply_gpu_linkage(
        &fan_data.control,
        gpu_use,
        &mut target_left_raw,
        &mut target_right_raw,
    );

    let cpu_cap = effective_cpu_max_percent(fan_data, state.active_mode.clone());
    let gpu_cap = effective_gpu_max_percent(fan_data, state.active_mode.clone());
    target_left_raw = target_left_raw.clamp(0, cpu_cap);
    target_right_raw = target_right_raw.clamp(0, gpu_cap);

    target_left_raw = apply_temperature_hysteresis(
        cpu_use,
        target_left_raw,
        state.fan_cache[0],
        &mut state.cpu_hysteresis_anchor_temp,
        effective_cpu_hysteresis(fan_data, state.active_mode.clone()),
    );
    target_right_raw = apply_temperature_hysteresis(
        gpu_use,
        target_right_raw,
        state.fan_cache[1],
        &mut state.gpu_hysteresis_anchor_temp,
        effective_gpu_hysteresis(fan_data, state.active_mode.clone()),
    );

    if state.force_max_fan {
        target_left_raw = MAX_FAN_SPEED_PERCENT;
        target_right_raw = MAX_FAN_SPEED_PERCENT;
    }

    // 如果我们刚刚从自动切回手动，马上写一次目标速度，确保硬件快速接管（避免短时间仍由系统自动策略控制而导致高转）
    if state.fan_cache == [0, 0] {
        // 此处为首次写入或刚重置缓存的情形，直接写入目标速度（clamp 已在上面做好）
        println!("⚡ 刚刚接管，立即写入目标速度 CPU:{}% GPU:{}%", target_left_raw, target_right_raw);
        fan_set(target_left_raw, target_right_raw, driver);
        (state.fan_cache[0], state.fan_cache[1]) = (target_left_raw, target_right_raw);
        // 更新 EMA 目标以反映写入
        state.ema_target_left = target_left_raw as f64;
        state.ema_target_right = target_right_raw as f64;
        // 更新温度 EMA 状态并等待下次循环
        state.ema_cpu = ema_cpu_new;
        state.ema_gpu = ema_gpu_new;
        thread::sleep(Duration::from_millis(control_sleep_ms));
        return;
    }


    // 对目标速度再做 EMA 平滑，减小目标抖动带来的写入频率
    if state.ema_target_left == 0.0 {
        state.ema_target_left = target_left_raw as f64;
    }
    if state.ema_target_right == 0.0 {
        state.ema_target_right = target_right_raw as f64;
    }
    let ema_target_left_new = SPEED_EMA_ALPHA * (target_left_raw as f64) + (1.0 - SPEED_EMA_ALPHA) * state.ema_target_left;
    let ema_target_right_new = SPEED_EMA_ALPHA * (target_right_raw as f64) + (1.0 - SPEED_EMA_ALPHA) * state.ema_target_right;
    let target_left = ema_target_left_new.round() as i64;
    let target_right = ema_target_right_new.round() as i64;

    let speed_hysteresis = effective_speed_hysteresis(fan_data, state.active_mode.clone());

    // 防抖：目标与当前差值均在滞后范围内时，跳过本次写入
    if (state.fan_cache[0] - target_left).abs()  <= speed_hysteresis
    && (state.fan_cache[1] - target_right).abs() <= speed_hysteresis {
        println!("{}", "Δ速度过小，保持当前状态（防抖）".green());
        // 更新 EMA 状态并休眠
        state.ema_cpu = ema_cpu_new;
        state.ema_gpu = ema_gpu_new;
        state.ema_target_left = ema_target_left_new;
        state.ema_target_right = ema_target_right_new;
        thread::sleep(Duration::from_millis(control_sleep_ms));
        return;
    }

    // 自适应斜坡：若温度短时间内快速上升，允许快速上升步进；下降时更保守
    let mode_step = default_ramp_step_for_mode(&state.active_mode);
    let mut max_up = fan_data.control.ramp_up_step.max(mode_step).max(1);
    let mut max_down = fan_data.control.ramp_down_step.max(mode_step).max(1);

    if max_up <= 0 {
        max_up = FAN_RAMP_STEP;
    }
    if max_down <= 0 {
        max_down = FAN_RAMP_STEP_DOWN;
    }

    if cpu_out - state.ema_cpu.round() as i64 >= TEMP_JUMP_THRESHOLD || gpu_out - state.ema_gpu.round() as i64 >= TEMP_JUMP_THRESHOLD {
        max_up = FAST_RAMP_UP;
    }

    if state.force_max_fan {
        max_up = FAST_RAMP_UP.max(max_up);
        max_down = 100;
    }

    // 斜坡限速（使用自适应步进）
    let ramp_left  = ramp_speed_internal(
        state.fan_cache[0],
        target_left,
        max_up,
        max_down,
        effective_min_speed(&fan_data.control, cpu_use),
    );
    let ramp_right = ramp_speed_internal(
        state.fan_cache[1],
        target_right,
        max_up,
        max_down,
        effective_min_speed(&fan_data.control, gpu_use),
    );

    if state.fan_cache[0] == ramp_left && state.fan_cache[1] == ramp_right {
        println!("{}", "✓ 斜坡后速度未变化，维持当前状态".green());
        // 更新 EMA 状态并休眠
        state.ema_cpu = ema_cpu_new;
        state.ema_gpu = ema_gpu_new;
        state.ema_target_left = ema_target_left_new;
        state.ema_target_right = ema_target_right_new;
        thread::sleep(Duration::from_millis(control_sleep_ms));
        return;
    }

    println!("🔄 CPU {}%→{}%  GPU {}%→{}%", state.fan_cache[0], ramp_left, state.fan_cache[1], ramp_right);
    fan_set(ramp_left, ramp_right, driver);
    (state.fan_cache[0], state.fan_cache[1]) = (ramp_left, ramp_right);

    // 更新 EMA 状态
    state.ema_cpu = ema_cpu_new;
    state.ema_gpu = ema_gpu_new;
    state.ema_target_left = ema_target_left_new;
    state.ema_target_right = ema_target_right_new;

    thread::sleep(Duration::from_millis(control_sleep_ms));
}

fn effective_min_speed(control: &FanControlPolicy, temp_now: i64) -> i64 {
    if control.zero_rpm_enabled && temp_now <= control.zero_rpm_threshold {
        0
    } else {
        control.min_speed.clamp(0, MAX_FAN_SPEED_PERCENT)
    }
}

fn is_constant_mode(control: &FanControlPolicy) -> bool {
    control.constant_speed_enabled || control.control_mode.eq_ignore_ascii_case("constant")
}

fn constant_speed_target(control: &FanControlPolicy) -> i64 {
    control.constant_speed.clamp(0, MAX_FAN_SPEED_PERCENT)
}

fn effective_cpu_max_percent(fan_data: &FanData, active_mode: FanControlMode) -> i64 {
    let mode_default = default_cpu_fan_max_for_mode(&active_mode);
    let configured = fan_data.control.cpu_fan_max_percent;
    if configured <= 0 {
        mode_default
    } else if active_mode == FanControlMode::Custom {
        configured.clamp(20, MAX_FAN_SPEED_PERCENT)
    } else {
        configured.clamp(20, mode_default)
    }
}

fn effective_gpu_max_percent(fan_data: &FanData, active_mode: FanControlMode) -> i64 {
    let mode_default = default_gpu_fan_max_for_mode(&active_mode);
    let configured = fan_data.control.gpu_fan_max_percent;
    if configured <= 0 {
        mode_default
    } else if active_mode == FanControlMode::Custom {
        configured.clamp(20, MAX_FAN_SPEED_PERCENT)
    } else {
        configured.clamp(20, mode_default)
    }
}

fn effective_cpu_hysteresis(fan_data: &FanData, active_mode: FanControlMode) -> i64 {
    let mode_default = default_hysteresis_for_mode(&active_mode);
    let configured = fan_data.control.cpu_hysteresis_bandwidth;
    if configured <= 0 {
        mode_default
    } else {
        configured.clamp(1, 12)
    }
}

fn effective_gpu_hysteresis(fan_data: &FanData, active_mode: FanControlMode) -> i64 {
    let mode_default = default_hysteresis_for_mode(&active_mode);
    let configured = fan_data.control.gpu_hysteresis_bandwidth;
    if configured <= 0 {
        mode_default
    } else {
        configured.clamp(1, 12)
    }
}

fn effective_speed_hysteresis(fan_data: &FanData, active_mode: FanControlMode) -> i64 {
    let configured = fan_data
        .control
        .cpu_hysteresis_bandwidth
        .max(fan_data.control.gpu_hysteresis_bandwidth)
        .clamp(1, 12);
    configured.max(default_hysteresis_for_mode(&active_mode).min(6))
}

fn apply_temperature_hysteresis(
    temp_now: i64,
    target: i64,
    current_speed: i64,
    anchor_temp: &mut i64,
    bandwidth: i64,
) -> i64 {
    if *anchor_temp == 0 {
        *anchor_temp = temp_now;
        return target;
    }

    if temp_now >= *anchor_temp {
        *anchor_temp = temp_now;
        return target;
    }

    if *anchor_temp - temp_now <= bandwidth.max(1) {
        return target.max(current_speed);
    }

    *anchor_temp = temp_now;
    target
}

fn apply_gpu_linkage(
    control: &FanControlPolicy,
    gpu_temp: i64,
    left_target: &mut i64,
    right_target: &mut i64,
) {
    if !control.gpu_linkage_enabled {
        return;
    }
    if gpu_temp < control.gpu_linkage_threshold {
        return;
    }

    let boosted_cpu = (*left_target + control.gpu_linkage_boost).clamp(0, MAX_FAN_SPEED_PERCENT);
    *left_target = (*left_target).max(boosted_cpu);
    *right_target = (*right_target).max(*left_target);
}

fn update_dynamic_mode(fan_data: &FanData, state: &mut ControlState, cpu_temp: i64, gpu_temp: i64) {
    if !matches!(fan_data.control.mode, FanControlMode::Office) {
        state.active_mode = fan_data.control.mode.clone();
        state.office_cooldown_ticks = 0;
        state.gaming_hot_ticks = 0;
        return;
    }

    let sample_secs = (fan_data.monitor.sample_interval_ms.max(500) as f64) / 1000.0;
    let gaming_required_ticks = (3.0 / sample_secs).ceil() as u32;
    let office_required_ticks = (180.0 / sample_secs).ceil() as u32;

    if gpu_temp >= fan_data.control.gpu_linkage_threshold {
        state.gaming_hot_ticks = state.gaming_hot_ticks.saturating_add(1);
        state.office_cooldown_ticks = 0;
    } else if cpu_temp < 40 {
        state.office_cooldown_ticks = state.office_cooldown_ticks.saturating_add(1);
        state.gaming_hot_ticks = 0;
    } else {
        state.gaming_hot_ticks = 0;
        state.office_cooldown_ticks = 0;
    }

    let next_mode = if state.gaming_hot_ticks >= gaming_required_ticks.max(1) {
        FanControlMode::Gaming
    } else if state.office_cooldown_ticks >= office_required_ticks.max(1) {
        FanControlMode::Office
    } else {
        state.active_mode.clone()
    };

    if next_mode != state.active_mode {
        println!(
            "🧭 模式自动切换: {} -> {}",
            state.active_mode.as_str(),
            next_mode.as_str()
        );
        state.active_mode = next_mode;
    }
}

fn update_tray_status(window: Option<&Window>, mode: &FanControlMode, cpu_temp: i64, gpu_temp: i64) {
    let Some(win) = window else { return };
    let Some(tray) = win.app_handle().tray_by_id("main_tray") else {
        return;
    };
    let tip = format!(
        "NUCtool | 模式:{} | CPU:{}°C GPU:{}°C",
        mode.as_str(),
        cpu_temp,
        gpu_temp
    );
    let _ = tray.set_tooltip(Some(tip));
}

fn apply_strategy(
    control: &FanControlPolicy,
    cpu_temp: i64,
    gpu_temp: i64,
    left_target: &mut i64,
    right_target: &mut i64,
) {
    match control.strategy.as_str() {
        "mix_max" => {
            let _ = cpu_temp.max(gpu_temp);
            let linked = (*left_target).max(*right_target);
            *left_target = linked;
            *right_target = linked;
        }
        "cpu_only" => {
            *right_target = *left_target;
        }
        "gpu_only" => {
            *left_target = *right_target;
        }
        _ => {}
    }
}

fn process_alerts(
    fan_data: &FanData,
    state: &mut ControlState,
    cpu_temp: i64,
    gpu_temp: i64,
    window: Option<&Window>,
) {
    let cpu_threshold = fan_data.alerts.cpu.threshold;
    let gpu_threshold = fan_data.alerts.gpu.threshold;

    let cpu_confirm = fan_data
        .alerts
        .cpu
        .actions
        .confirm_times
        .max(1);
    let gpu_confirm = fan_data
        .alerts
        .gpu
        .actions
        .confirm_times
        .max(1);
    let recover_delta = fan_data.alerts.recover_delta.max(1);

    if cpu_temp >= cpu_threshold {
        state.alert_cpu_high_count = state.alert_cpu_high_count.saturating_add(1);
        state.alert_cpu_recover_count = 0;
    } else if state.cpu_alert_active && cpu_temp <= cpu_threshold - recover_delta {
        state.alert_cpu_recover_count = state.alert_cpu_recover_count.saturating_add(1);
        state.alert_cpu_high_count = 0;
    } else {
        state.alert_cpu_high_count = 0;
        state.alert_cpu_recover_count = 0;
    }

    if gpu_temp >= gpu_threshold {
        state.alert_gpu_high_count = state.alert_gpu_high_count.saturating_add(1);
        state.alert_gpu_recover_count = 0;
    } else if state.gpu_alert_active && gpu_temp <= gpu_threshold - recover_delta {
        state.alert_gpu_recover_count = state.alert_gpu_recover_count.saturating_add(1);
        state.alert_gpu_high_count = 0;
    } else {
        state.alert_gpu_high_count = 0;
        state.alert_gpu_recover_count = 0;
    }

    if !state.cpu_alert_active && state.alert_cpu_high_count >= cpu_confirm {
        state.cpu_alert_active = true;
        apply_alert_actions("CPU", cpu_temp, &fan_data.alerts.cpu.actions, window);
    }

    if !state.gpu_alert_active && state.alert_gpu_high_count >= gpu_confirm {
        state.gpu_alert_active = true;
        apply_alert_actions("GPU", gpu_temp, &fan_data.alerts.gpu.actions, window);
    }

    if state.cpu_alert_active && state.alert_cpu_recover_count >= cpu_confirm {
        state.cpu_alert_active = false;
        println!("✅ CPU 温度告警已恢复");
    }

    if state.gpu_alert_active && state.alert_gpu_recover_count >= gpu_confirm {
        state.gpu_alert_active = false;
        println!("✅ GPU 温度告警已恢复");
    }

    state.force_max_fan = (state.cpu_alert_active && fan_data.alerts.cpu.actions.force_shutdown)
        || (state.gpu_alert_active && fan_data.alerts.gpu.actions.force_shutdown);
}

fn apply_alert_actions(
    sensor: &str,
    temp: i64,
    actions: &crate::plug::struct_set::AlertActions,
    window: Option<&Window>,
) {
    if actions.log {
        println!("[告警] {} 温度达到 {}°C", sensor, temp);
    }
    if actions.popup {
        println!("[弹窗] {} 温度过高：{}°C", sensor, temp);
    }
    if actions.sound {
        print!("\x07");
    }
    if actions.force_shutdown {
        println!("[保护动作] {} 触发强制保护，风扇将保持全速", sensor);
        schedule_force_shutdown(sensor, temp);
    }

    if let Some(win) = window {
        if actions.popup || actions.sound || actions.force_shutdown {
            let payload = serde_json::json!({
                "sensor": sensor,
                "temperature": temp,
                "popup": actions.popup,
                "sound": actions.sound,
                "force_shutdown": actions.force_shutdown,
            });
            if let Err(e) = win.emit("temp-alert", payload) {
                println!("发送温度告警事件失败: {:?}", e);
            }
        }
    }
}

fn schedule_force_shutdown(sensor: &str, temp: i64) {
    if FORCE_SHUTDOWN_QUEUED
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return;
    }

    let sensor = sensor.to_string();
    thread::spawn(move || {
        println!(
            "[强制关机预备] {} 持续高温 {}°C，5 秒后执行系统关机",
            sensor, temp
        );
        thread::sleep(Duration::from_secs(5));

        #[cfg(windows)]
        let result = Command::new("shutdown")
            .args(["/s", "/t", "5", "/f", "/c", "NUCtool thermal protection"]) 
            .status();
        #[cfg(unix)]
        let result = Command::new("shutdown")
            .args(["-h", "+1", "NUCtool thermal protection"]) 
            .status();

        match result {
            Ok(status) => {
                println!("已请求系统关机，状态: {:?}", status);
            }
            Err(e) => {
                println!("执行系统关机失败: {}", e);
                FORCE_SHUTDOWN_QUEUED.store(false, Ordering::SeqCst);
            }
        }
    });
}

fn monitor_log_path() -> Option<PathBuf> {
    get_monitor_log_file_path().ok()
}

fn append_monitor_log(
    fan_data: &FanData,
    cpu_temp: i64,
    gpu_temp: i64,
    cpu_fan: i64,
    gpu_fan: i64,
) {
    if !fan_data.monitor.log_enabled {
        return;
    }

    let safe_cpu_temp = cpu_temp.clamp(0, MAX_TEMP_LIMIT);
    let safe_gpu_temp = gpu_temp.clamp(0, MAX_TEMP_LIMIT);
    let safe_cpu_fan = cpu_fan.clamp(0, MAX_SENSOR_RPM);
    let safe_gpu_fan = gpu_fan.clamp(0, MAX_SENSOR_RPM);

    let Some(path) = monitor_log_path() else { return };
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    let exists = path.exists();
    let mut file = match OpenOptions::new().create(true).append(true).open(&path) {
        Ok(f) => f,
        Err(e) => {
            println!("写入监控日志失败: {}", e);
            return;
        }
    };

    if !exists {
        let _ = writeln!(
            file,
            "timestamp,cpu_temp,gpu_temp,cpu_fan_rpm,gpu_fan_rpm,strategy,preset,mode"
        );
    }

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let _ = writeln!(
        file,
        "{},{},{},{},{},{},{},{}",
        timestamp,
        safe_cpu_temp,
        safe_gpu_temp,
        safe_cpu_fan,
        safe_gpu_fan,
        fan_data.control.strategy,
        fan_data.control.preset,
        fan_data.control.mode.as_str()
    );
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

fn now_ms_u64() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// 外部看门狗触发的紧急风扇释放（独立线程，不依赖 Actor）
fn emergency_release_fans() {
    println!("{}", "🚨 紧急释放：独立线程执行 set_fan_auto".red().bold());
    thread::spawn(|| {
        #[cfg(windows)]
        init_com_on_thread();
        let driver = ApiFan::init();
        driver.set_fan_auto();
        println!("{}", "🚨 紧急释放完成：风扇已切回自动模式".red());
    });
}

/// 启动外部看门狗线程，监控 Actor 心跳
fn start_watchdog() {
    thread::spawn(|| {
        println!("👁️ 外部看门狗已启动");
        loop {
            thread::sleep(Duration::from_secs(5));

            let last_beat = ACTOR_HEARTBEAT.load(Ordering::SeqCst);
            if last_beat == 0 {
                continue; // Actor 尚未启动
            }

            let now = now_ms_u64();
            let elapsed = now.saturating_sub(last_beat);

            if elapsed > 20_000 {
                println!(
                    "{}",
                    format!("☠️ 外部看门狗：心跳超时 {}ms，判定 Actor 挂死", elapsed)
                        .red().bold()
                );
                ACTOR_HUNG.store(true, Ordering::SeqCst);

                // 紧急释放风扇到自动模式
                emergency_release_fans();

                // 清空 Actor 通道，允许下次 start 创建新 Actor
                if let Ok(mut guard) = FAN_ACTOR_TX.write() {
                    *guard = None;
                }

                // 更新快照为挂死状态
                if let Ok(mut snap) = shared_snapshot().write() {
                    *snap = FanActorSnapshot::default();
                    snap.hung = true;
                    snap.last_heartbeat_ms = Some(last_beat as u128);
                    snap.dropped_samples = snap.dropped_samples.saturating_add(1);
                }

                println!("{}", "👁️ 外部看门狗退出（等待用户重新启动控制）".yellow());
                return;
            }
        }
    });
}

fn fan_actor_sender() -> SyncSender<FanActorMessage> {
    // 快速路径：Actor 存活则直接返回已有通道
    {
        if let Ok(guard) = FAN_ACTOR_TX.read() {
            if let Some(ref tx) = *guard {
                if !ACTOR_HUNG.load(Ordering::SeqCst) {
                    return tx.clone();
                }
            }
        }
    }

    // 慢速路径：创建新 Actor（首次初始化 或 挂死后重启）
    if let Ok(mut guard) = FAN_ACTOR_TX.write() {
        // 双重检查
        if let Some(ref tx) = *guard {
            if !ACTOR_HUNG.load(Ordering::SeqCst) {
                return tx.clone();
            }
        }

        let (tx, rx) = mpsc::sync_channel::<FanActorMessage>(16);
        app_log("fan_actor", "info", "channel.create", "sync channel capacity=16");

        // 初始化心跳和清除挂死标记
        ACTOR_HEARTBEAT.store(now_ms_u64(), Ordering::SeqCst);
        ACTOR_HUNG.store(false, Ordering::SeqCst);

        // 启动外部看门狗
        start_watchdog();

        // 启动 Fan Actor 线程
        thread::spawn(move || {
            app_log("fan_actor", "info", "thread.start", "fan actor thread spawned");
            init_com_on_thread();
            // ApiFan 实例仅在 Actor 线程内创建和使用，不跨线程共享
            let driver = ApiFan::init();
            app_log("fan_actor", "info", "driver.init", "ApiFan initialized");
            let mut runtime: Option<(FanData, Window, ControlState)> = None;
            let mut last_iter_finished: Option<Instant> = None;
            let mut cpu_tdp_lock: Option<(i64, i64, Instant)> = None;

            loop {
                // 在 WMI 调用前更新心跳，确保看门狗能检测到卡死
                ACTOR_HEARTBEAT.store(now_ms_u64(), Ordering::SeqCst);

                // 1. 排空所有控制消息（包括 TDP/RGB 请求）
                loop {
                    match rx.try_recv() {
                        Ok(FanActorMessage::Start { fan_data, window }) => {
                            app_log("fan_actor", "info", "message.start", format!("mode={} constant={} speed={} interval_ms={}", fan_data.control.mode.as_str(), is_constant_mode(&fan_data.control), fan_data.control.constant_speed, fan_data.monitor.sample_interval_ms));
                            println!("{}", "✅ Actor 收到启动命令".green().bold());
                            driver.set_fan_control();
                            let init_speed = if is_constant_mode(&fan_data.control) {
                                constant_speed_target(&fan_data.control)
                            } else {
                                30
                            };
                            fan_set(init_speed, init_speed, &driver);
                            let mut ctrl_state = ControlState::new(fan_data.control.mode.clone());
                            ctrl_state.constant_mode = is_constant_mode(&fan_data.control);
                            ctrl_state.constant_speed = fan_data.control.constant_speed;
                            runtime = Some((fan_data, window, ctrl_state));
                        }
                        Ok(FanActorMessage::UpdatePolicy { fan_data }) => {
                            app_log("fan_actor", "info", "message.update_policy", format!("mode={} constant={} speed={} interval_ms={}", fan_data.control.mode.as_str(), is_constant_mode(&fan_data.control), fan_data.control.constant_speed, fan_data.monitor.sample_interval_ms));
                            if let Some((ref mut runtime_fan_data, _, ref mut ctrl_state)) = runtime {
                                *runtime_fan_data = fan_data.clone();
                                ctrl_state.constant_mode = is_constant_mode(&fan_data.control);
                                ctrl_state.constant_speed = fan_data.control.constant_speed;
                            }
                        }
                        Ok(FanActorMessage::Stop) => {
                            app_log("fan_actor", "info", "message.stop", "switching fan to auto and clearing runtime");
                            println!("{}", "🛑 Actor 收到停止命令".red());
                            runtime = None;
                            driver.set_fan_auto();
                            if let Ok(mut snap) = shared_snapshot().write() {
                                *snap = FanActorSnapshot::default();
                            }
                        }
                        // TDP/RGB 请求直接使用 Actor 持有的 driver 实例
                        Ok(FanActorMessage::GetTdp { reply }) => {
                            let started = Instant::now();
                            let tdp = driver.get_tdp();
                            app_log("fan_actor", "debug", "message.get_tdp", format!("elapsed_ms={} result={:?}", started.elapsed().as_millis(), tdp));
                            let _ = reply.try_send(tdp);
                        }
                        Ok(FanActorMessage::SetTdp { tdp, reply }) => {
                            let started = Instant::now();
                            let cpu1 = tdp.cpu1;
                            let cpu2 = tdp.cpu2;
                            let gpu1 = tdp.gpu1;
                            let gpu2 = tdp.gpu2;
                            let ok = driver.set_tdp(tdp);
                            app_log("fan_actor", if ok { "info" } else { "warn" }, "message.set_tdp", format!("elapsed_ms={} cpu={}W/{}W gpu={}W/{}W ok={}", started.elapsed().as_millis(), cpu1, cpu2, gpu1, gpu2, ok));
                            let _ = reply.try_send(ok);
                        }
                        Ok(FanActorMessage::SetCpuTdp { cpu1, cpu2, reply }) => {
                            let started = Instant::now();
                            let ok = driver.set_cpu_tdp(cpu1, cpu2);
                            app_log("fan_actor", if ok { "info" } else { "warn" }, "message.set_cpu_tdp", format!("elapsed_ms={} cpu={}W/{}W ok={}", started.elapsed().as_millis(), cpu1, cpu2, ok));
                            let _ = reply.try_send(ok);
                        }
                        Ok(FanActorMessage::LockCpuTdp { cpu1, cpu2, reply }) => {
                            let started = Instant::now();
                            let ok = driver.set_cpu_tdp(cpu1, cpu2);
                            if ok {
                                cpu_tdp_lock = Some((cpu1, cpu2, Instant::now()));
                            }
                            app_log("fan_actor", if ok { "info" } else { "warn" }, "message.lock_cpu_tdp", format!("elapsed_ms={} cpu={}W/{}W lock_active={}", started.elapsed().as_millis(), cpu1, cpu2, ok));
                            let _ = reply.try_send(ok);
                        }
                        Ok(FanActorMessage::SetRgbColorY { reply }) => {
                            #[cfg(windows)]
                            let _ = reply.try_send(driver.set_ac_led_color_y());
                            #[cfg(not(windows))]
                            let _ = reply.try_send(false);
                        }
                        Ok(FanActorMessage::SetRgbColorN { reply }) => {
                            #[cfg(windows)]
                            let _ = reply.try_send(driver.set_ac_led_color_n());
                            #[cfg(not(windows))]
                            let _ = reply.try_send(false);
                        }
                        Ok(FanActorMessage::GetRgbColor { reply }) => {
                            #[cfg(windows)]
                            let _ = reply.try_send(driver.get_ac_led_color() == 2);
                            #[cfg(not(windows))]
                            let _ = reply.try_send(false);
                        }
                        Err(TryRecvError::Empty) => break,
                        Err(TryRecvError::Disconnected) => return,
                    }
                }

                // 2. 控制循环：单一线程完成 WMI 读取 → 曲线应用 → 写入 → 快照更新
                if let Some((cpu1, cpu2, last_checked)) = cpu_tdp_lock {
                    if last_checked.elapsed() >= Duration::from_secs(15) {
                        let (read_cpu1, read_cpu2, _, _, _) = driver.get_tdp();
                        if read_cpu1 != cpu1 || read_cpu2 != cpu2 {
                            app_log("fan_actor", "warn", "cpu_tdp_lock.drift", format!("want={}W/{}W got={}W/{}W reapplying=true", cpu1, cpu2, read_cpu1, read_cpu2));
                            println!(
                                "CPU TDP lock drift: want={}W/{}W got={}W/{}W, reapplying",
                                cpu1, cpu2, read_cpu1, read_cpu2
                            );
                            let ok = driver.set_cpu_tdp(cpu1, cpu2);
                            app_log("fan_actor", if ok { "info" } else { "warn" }, "cpu_tdp_lock.reapply", format!("want={}W/{}W ok={}", cpu1, cpu2, ok));
                        } else {
                            app_log("fan_actor", "debug", "cpu_tdp_lock.ok", format!("want={}W/{}W got={}W/{}W", cpu1, cpu2, read_cpu1, read_cpu2));
                        }
                        cpu_tdp_lock = Some((cpu1, cpu2, Instant::now()));
                    }
                }

                if let Some((ref fan_data, ref window, ref mut ctrl_state)) = runtime {
                    // 检查是否被外部看门狗标记为挂死
                    if ACTOR_HUNG.load(Ordering::SeqCst) {
                        app_log("fan_actor", "error", "actor_hung.flagged", "external watchdog marked actor hung; clearing runtime");
                        println!("{}", "🪦 Actor 被外部看门狗标记为挂死，退出".red().bold());
                        runtime = None;
                        if let Ok(mut snap) = shared_snapshot().write() {
                            *snap = FanActorSnapshot::default();
                        }
                        continue;
                    }

                    // 内部看门狗：距上次成功循环超过 15 秒判定 WMI 挂死
                    if let Some(last) = last_iter_finished {
                        let gap = last.elapsed();
                        if gap > Duration::from_secs(15) {
                            app_log("fan_actor", "error", "control_loop.timeout", format!("gap_ms={} action=set_fan_auto_and_stop_runtime", gap.as_millis()));
                            println!(
                                "{}",
                                format!(
                                    "☠️ 内部控制循环超时 {}ms，WMI 通信可能已挂死，紧急释放至自动模式",
                                    gap.as_millis()
                                )
                                .red()
                                .bold()
                            );
                            driver.set_fan_auto();
                            runtime = None;
                            if let Ok(mut snap) = shared_snapshot().write() {
                                *snap = FanActorSnapshot::default();
                            }
                            continue;
                        }
                    }

                    // 在 WMI 调用前再次更新心跳
                    ACTOR_HEARTBEAT.store(now_ms_u64(), Ordering::SeqCst);

                    // 直接 WMI 读取（不再经过独立 sensor actor 线程）
                    let speeds = driver.get_fan_speeds();

                    // 应用风扇曲线控制
                    apply_fan_curve(fan_data, &driver, ctrl_state, &speeds, Some(window));
                    last_iter_finished = Some(Instant::now());

                    // 更新共享快照供 async 层零阻塞读取
                    update_snapshot(&speeds, ctrl_state);

                    let control_sleep_ms = fan_data
                        .monitor
                        .sample_interval_ms
                        .max(MIN_MONITOR_SAMPLE_INTERVAL_MS);
                    thread::sleep(Duration::from_millis(control_sleep_ms));
                    continue;
                }

                thread::sleep(Duration::from_millis(80));
            }
        });

        *guard = Some(tx.clone());
        return tx;
    }

    // RwLock 被污染（理论上不应该到这里）
    panic!("FAN_ACTOR_TX RwLock poisoned");
}

// ── TDP/RGB 操作：通过 Fan Actor 通道请求，避免 spawn_blocking 直接调用 WMI ──

pub fn request_tdp() -> Result<(i64, i64, i64, i64, i64), String> {
    let started = Instant::now();
    app_log("fan_request", "debug", "tdp.send", "queueing GetTdp");
    let (tx, rx) = mpsc::sync_channel::<(i64, i64, i64, i64, i64)>(1);
    fan_actor_sender()
        .try_send(FanActorMessage::GetTdp { reply: tx })
        .map_err(|e| format!("硬件通道已满: {}", e))?;
    app_log("fan_request", "debug", "tdp.wait", format!("queued_elapsed_ms={}", started.elapsed().as_millis()));
    rx.recv_timeout(Duration::from_secs(5))
        .map_err(|e| format!("硬件响应超时: {}", e))
}

pub fn request_set_tdp(tdp: TDP) -> Result<bool, String> {
    let (tx, rx) = mpsc::sync_channel::<bool>(1);
    fan_actor_sender()
        .try_send(FanActorMessage::SetTdp { tdp, reply: tx })
        .map_err(|e| format!("硬件通道已满: {}", e))?;
    rx.recv_timeout(Duration::from_secs(10))
        .map_err(|e| format!("硬件响应超时: {}", e))
}

pub fn request_set_cpu_tdp(cpu1: i64, cpu2: i64) -> Result<bool, String> {
    app_log("fan_request", "info", "set_cpu_tdp.send", format!("cpu={}W/{}W", cpu1, cpu2));
    let (tx, rx) = mpsc::sync_channel::<bool>(1);
    fan_actor_sender()
        .try_send(FanActorMessage::SetCpuTdp { cpu1, cpu2, reply: tx })
        .map_err(|e| format!("硬件通道已满: {}", e))?;
    rx.recv_timeout(Duration::from_secs(8))
        .map_err(|e| format!("硬件响应超时: {}", e))
}

pub fn request_lock_cpu_tdp(cpu1: i64, cpu2: i64) -> Result<bool, String> {
    app_log("fan_request", "info", "lock_cpu_tdp.send", format!("cpu={}W/{}W", cpu1, cpu2));
    let (tx, rx) = mpsc::sync_channel::<bool>(1);
    fan_actor_sender()
        .try_send(FanActorMessage::LockCpuTdp { cpu1, cpu2, reply: tx })
        .map_err(|e| format!("硬件通道已满: {}", e))?;
    rx.recv_timeout(Duration::from_secs(8))
        .map_err(|e| format!("硬件响应超时: {}", e))
}

#[cfg(windows)]
pub fn request_set_rgb_color_y() -> Result<bool, String> {
    let (tx, rx) = mpsc::sync_channel::<bool>(1);
    fan_actor_sender()
        .try_send(FanActorMessage::SetRgbColorY { reply: tx })
        .map_err(|e| format!("硬件通道已满: {}", e))?;
    rx.recv_timeout(Duration::from_secs(5))
        .map_err(|e| format!("硬件响应超时: {}", e))
}

#[cfg(windows)]
pub fn request_set_rgb_color_n() -> Result<bool, String> {
    let (tx, rx) = mpsc::sync_channel::<bool>(1);
    fan_actor_sender()
        .try_send(FanActorMessage::SetRgbColorN { reply: tx })
        .map_err(|e| format!("硬件通道已满: {}", e))?;
    rx.recv_timeout(Duration::from_secs(5))
        .map_err(|e| format!("硬件响应超时: {}", e))
}

#[cfg(windows)]
pub fn request_get_rgb_color() -> Result<bool, String> {
    let (tx, rx) = mpsc::sync_channel::<bool>(1);
    fan_actor_sender()
        .try_send(FanActorMessage::GetRgbColor { reply: tx })
        .map_err(|e| format!("硬件通道已满: {}", e))?;
    rx.recv_timeout(Duration::from_secs(5))
        .map_err(|e| format!("硬件响应超时: {}", e))
}

/// 启动风扇数据推送线程（每 2.5 秒向前端 emit 一次）
/// 使用 AtomicBool 防止重复调用累积线程；emit 失败时安全退出而非 panic
#[tauri::command]
pub async fn get_fan_speeds(window: Window) {
    if SPEED_PUSH_RUNNING
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        app_log("fan_push", "debug", "start.skipped", "push thread already running");
        println!("{}", "推送线程已在运行，忽略重复调用".yellow());
        return;
    }
    thread::spawn(move || {
        app_log("fan_push", "info", "thread.start", "fan speed push thread started");
        println!("{}", "✅ 风扇推送线程已启动".green());
        let mut hidden_ticks: u64 = 0;
        let mut emitted_ticks: u64 = 0;
        loop {
            let interval_ms = SENSOR_PUSH_INTERVAL_MS
                .load(Ordering::Relaxed)
                .clamp(MIN_MONITOR_SAMPLE_INTERVAL_MS, MAX_MONITOR_SAMPLE_INTERVAL_MS);
            thread::sleep(Duration::from_millis(interval_ms));
            if matches!(window.is_visible(), Ok(false)) {
                hidden_ticks += 1;
                if hidden_ticks == 1 || hidden_ticks % 30 == 0 {
                    app_log("fan_push", "debug", "window.hidden", format!("hidden_ticks={} interval_ms={}", hidden_ticks, interval_ms));
                }
                continue;
            }
            hidden_ticks = 0;
            let snap = read_snapshot();
            let speeds = FanSpeeds {
                left_fan_speed: snap.cpu_fan_rpm.unwrap_or(0),
                right_fan_speed: snap.gpu_fan_rpm.unwrap_or(0),
                left_temp: snap.cpu_temp.unwrap_or(0),
                right_temp: snap.gpu_temp.unwrap_or(0),
            };
            if let Err(e) = window.emit("get-fan-speeds", speeds) {
                app_log("fan_push", "warn", "emit.failed", format!("error={:?}", e));
                println!("推送失败（窗口可能已销毁）: {:?}，推送线程退出", e);
                break;
            }
            emitted_ticks += 1;
            if emitted_ticks == 1 || emitted_ticks % 30 == 0 {
                app_log("fan_push", "debug", "emit.ok", format!("emitted_ticks={} interval_ms={} running={} cpu_temp={:?} gpu_temp={:?} cpu_rpm={:?} gpu_rpm={:?}", emitted_ticks, interval_ms, snap.running, snap.cpu_temp, snap.gpu_temp, snap.cpu_fan_rpm, snap.gpu_fan_rpm));
            }
        }
        SPEED_PUSH_RUNNING.store(false, Ordering::SeqCst);
        app_log("fan_push", "info", "thread.exit", "fan speed push thread exited");
        println!("{}", "📴 风扇推送线程已退出".yellow());
    });
}

#[tauri::command]
pub async fn start_fan_control(window: Window, fan_data: serde_json::Value) -> Result<(), String> {
    let fan_data: FanData = match serde_json::from_value(fan_data) {
        Ok(v) => v,
        Err(e) => {
            println!("风扇配置解析失败: {}", e);
            return Err(format!("配置解析失败: {}", e));
        }
    };

    SENSOR_PUSH_INTERVAL_MS.store(
        fan_data
            .monitor
            .sample_interval_ms
            .clamp(MIN_MONITOR_SAMPLE_INTERVAL_MS, MAX_MONITOR_SAMPLE_INTERVAL_MS.min(1000)),
        Ordering::Relaxed,
    );
    let sender = fan_actor_sender();
    if let Err(e) = sender.try_send(FanActorMessage::Start { fan_data, window }) {
        println!("发送启动命令到风扇 Actor 失败: {}", e);
        return Err(format!("风扇控制通道已满: {}", e));
    }
    Ok(())
}

#[tauri::command]
pub async fn get_current_fan_mode() -> Result<String, String> {
    Ok(read_snapshot().active_mode)
}

#[tauri::command]
pub async fn stop_fan_control() -> Result<(), String> {
    let sender = fan_actor_sender();
    if let Err(e) = sender.try_send(FanActorMessage::Stop) {
        println!("发送停止命令到风扇 Actor 失败: {}", e);
        return Err(format!("风扇控制通道已满: {}", e));
    }
    Ok(())
}

#[tauri::command]
pub async fn update_fan_policy(fan_data: serde_json::Value) -> Result<(), String> {
    let fan_data: FanData = match serde_json::from_value(fan_data) {
        Ok(v) => v,
        Err(e) => {
            println!("风扇配置解析失败: {}", e);
            return Err(format!("配置解析失败: {}", e));
        }
    };

    SENSOR_PUSH_INTERVAL_MS.store(
        fan_data
            .monitor
            .sample_interval_ms
            .clamp(MIN_MONITOR_SAMPLE_INTERVAL_MS, MAX_MONITOR_SAMPLE_INTERVAL_MS.min(1000)),
        Ordering::Relaxed,
    );

    let sender = fan_actor_sender();
    if let Err(e) = sender.try_send(FanActorMessage::UpdatePolicy { fan_data }) {
        println!("发送更新策略命令到风扇 Actor 失败: {}", e);
        return Err(format!("风扇控制通道已满: {}", e));
    }
    Ok(())
}

#[tauri::command]
pub async fn get_fan_control_snapshot() -> Result<FanActorSnapshot, String> {
    Ok(read_snapshot())
}
