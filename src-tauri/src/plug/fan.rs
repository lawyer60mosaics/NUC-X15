use colored::Colorize;
use std::{
    fs::OpenOptions,
    io::Write,
    path::PathBuf,
    process::Command,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc::{self, SyncSender, TryRecvError},
        Arc, OnceLock, RwLock,
    },
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{Emitter, Manager, Window};

use crate::plug::{
    config::{default_fan_data, get_monitor_log_file_path},
    constants::{
        FAN_RAMP_STEP, FAN_RAMP_STEP_DOWN, FAST_RAMP_UP, MAX_FAN_SPEED_PERCENT,
        MAX_MONITOR_SAMPLE_INTERVAL_MS, MAX_SENSOR_RPM, MAX_TEMP_LIMIT,
        MIN_MONITOR_SAMPLE_INTERVAL_MS, MIN_TEMP_LIMIT, SPEED_EMA_ALPHA, TEMP_EMA_ALPHA,
        TEMP_EMERGENCY, TEMP_JUMP_THRESHOLD, WAKE_COOLDOWN_SPEED,
    },
    diagnostics::app_log,
    fan_curve::find_speed_for_temp,
    mode_profiles::{
        default_cpu_fan_max_for_mode, default_gpu_fan_max_for_mode, default_hysteresis_for_mode,
        default_ramp_step_for_mode,
    },
    models::ControlState,
    ramp::ramp_speed_internal,
    struct_set::{
        ApiFan, FanActorSnapshot, FanControlMode, FanControlPolicy, FanData, FanSpeeds, TDP,
    },
};

// 推送线程全局唯一标志，防止重复调用累积线程
static SPEED_PUSH_RUNNING: AtomicBool = AtomicBool::new(false);
static FAN_SENTINEL_RUNNING: AtomicBool = AtomicBool::new(false);
static FORCE_SHUTDOWN_QUEUED: AtomicBool = AtomicBool::new(false);
static SENSOR_PUSH_INTERVAL_MS: std::sync::atomic::AtomicU64 =
    std::sync::atomic::AtomicU64::new(1000);
/// Fan Actor 通道：RwLock 允许 Actor 挂死后替换通道
static FAN_ACTOR_TX: RwLock<Option<SyncSender<FanActorMessage>>> = RwLock::new(None);
/// 外部看门狗心跳，Actor 在每次 WMI 调用前更新
static ACTOR_HEARTBEAT: AtomicU64 = AtomicU64::new(0);
/// Actor 被看门狗判定为挂死时置 true
static ACTOR_HUNG: AtomicBool = AtomicBool::new(false);
static FAN_ACTOR_GENERATION: AtomicU64 = AtomicU64::new(0);
static LAST_SENTINEL_RESTART_MS: AtomicU64 = AtomicU64::new(0);
static LAST_RUNTIME: RwLock<Option<(FanData, Window)>> = RwLock::new(None);
const INVALID_TEMP_RELEASE_THRESHOLD: u8 = 3;
const TDP_CACHE_TTL_MS: u64 = 5_000;
const TDP_COALESCE_WAIT_MS: u64 = 1_500;
const TDP_LOCK_CHECK_INTERVAL_MS: u64 = 5_000;
const HARDWARE_RETRY_COOLDOWN_MS: u64 = 30_000;
const MANUAL_MODE_CHECK_INTERVAL_MS: u64 = 10_000;
const CONTROL_LOOP_TIMEOUT_MS: u64 = 15_000;
const WATCHDOG_HUNG_TIMEOUT_MS: u64 = 20_000;
const SENTINEL_CHECK_INTERVAL_MS: u64 = 3_000;
const SENTINEL_SAMPLE_STALE_MS: u64 = 12_000;
const SENTINEL_HEARTBEAT_STALE_MS: u64 = 15_000;
const SENTINEL_OBJECTIVE_CONFIRM_MS: u64 = 6_000;
const SENTINEL_OBJECTIVE_QUORUM: u8 = 2;
const SENTINEL_RESTART_COOLDOWN_MS: u64 = 20_000;
const RESUME_GAP_MS: u64 = 60_000;

#[derive(Clone, Copy)]
struct CachedTdp {
    value: (i64, i64, i64, i64, i64),
    updated_ms: u64,
}

#[derive(Default)]
struct SentinelState {
    subjective_down_since_ms: Option<u64>,
    last_reason: String,
    failover_epoch: u64,
}

#[derive(Default)]
struct SentinelAssessment {
    votes: u8,
    reason: String,
}

static TDP_CACHE: RwLock<Option<CachedTdp>> = RwLock::new(None);
static TDP_READ_IN_FLIGHT: AtomicBool = AtomicBool::new(false);
static TDP_WRITE_IN_FLIGHT: AtomicBool = AtomicBool::new(false);
static TDP_LOCK_REAPPLY_PAUSED_UNTIL_MS: AtomicU64 = AtomicU64::new(0);
static HARDWARE_UNAVAILABLE_UNTIL_MS: AtomicU64 = AtomicU64::new(0);

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

fn read_cached_tdp(max_age_ms: Option<u64>) -> Option<(i64, i64, i64, i64, i64)> {
    let cache = TDP_CACHE.read().ok()?.as_ref().copied()?;
    if let Some(max_age_ms) = max_age_ms {
        if now_ms_u64().saturating_sub(cache.updated_ms) > max_age_ms {
            return None;
        }
    }
    Some(cache.value)
}

fn update_tdp_cache(value: (i64, i64, i64, i64, i64)) {
    if let Ok(mut cache) = TDP_CACHE.write() {
        *cache = Some(CachedTdp {
            value,
            updated_ms: now_ms_u64(),
        });
    }
}

fn update_cpu_tdp_cache(cpu1: i64, cpu2: i64) {
    if let Ok(mut cache) = TDP_CACHE.write() {
        let (_, _, gpu1, gpu2, tcc) = cache.map(|cached| cached.value).unwrap_or_default();
        *cache = Some(CachedTdp {
            value: (cpu1, cpu2, gpu1, gpu2, tcc),
            updated_ms: now_ms_u64(),
        });
    }
}

fn is_resume_gap(elapsed_ms: u64) -> bool {
    elapsed_ms >= RESUME_GAP_MS
}

fn should_watchdog_mark_hung(elapsed_ms: u64) -> bool {
    elapsed_ms > WATCHDOG_HUNG_TIMEOUT_MS && !is_resume_gap(elapsed_ms)
}

fn wait_for_tdp_cache_newer_than(
    started_ms: u64,
    wait_ms: u64,
) -> Option<(i64, i64, i64, i64, i64)> {
    let deadline = Instant::now() + Duration::from_millis(wait_ms);
    loop {
        if let Ok(cache) = TDP_CACHE.read() {
            if let Some(cached) = cache.as_ref().copied() {
                if cached.updated_ms >= started_ms {
                    return Some(cached.value);
                }
            }
        }

        if Instant::now() >= deadline {
            return None;
        }
        thread::sleep(Duration::from_millis(25));
    }
}

pub fn pause_tdp_lock_reapply(duration_ms: u64, reason: &str) {
    let until_ms = now_ms_u64().saturating_add(duration_ms);
    TDP_LOCK_REAPPLY_PAUSED_UNTIL_MS.store(until_ms, Ordering::SeqCst);
    app_log(
        "fan_actor",
        "info",
        "tdp_lock.pause",
        format!(
            "reason={} duration_ms={} until_ms={}",
            reason, duration_ms, until_ms
        ),
    );
}

fn hardware_unavailable_error() -> Option<String> {
    let now = now_ms_u64();
    let until = HARDWARE_UNAVAILABLE_UNTIL_MS.load(Ordering::SeqCst);
    if now >= until {
        return None;
    }

    let retry_after_secs = until.saturating_sub(now).div_ceil(1000);
    Some(format!(
        "硬件暂不可用，请以管理员权限运行或稍后重试（{} 秒后重试）",
        retry_after_secs
    ))
}

fn mark_hardware_unavailable(error: &str) {
    let until = now_ms_u64().saturating_add(HARDWARE_RETRY_COOLDOWN_MS);
    HARDWARE_UNAVAILABLE_UNTIL_MS.store(until, Ordering::SeqCst);
    app_log(
        "fan_actor",
        "warn",
        "hardware.unavailable",
        format!(
            "retry_cooldown_ms={} error={}",
            HARDWARE_RETRY_COOLDOWN_MS, error
        ),
    );
}

fn clear_hardware_unavailable(reason: &str) {
    if HARDWARE_UNAVAILABLE_UNTIL_MS.swap(0, Ordering::SeqCst) > 0 {
        app_log(
            "fan_actor",
            "info",
            "hardware.available",
            format!("reason={}", reason),
        );
    }
}

fn has_saved_runtime() -> bool {
    LAST_RUNTIME
        .read()
        .map(|runtime| runtime.is_some())
        .unwrap_or(false)
}

fn update_snapshot(speeds: &FanSpeeds, ctrl_state: &ControlState) {
    if let Ok(mut snap) = shared_snapshot().write() {
        let tdp = read_cached_tdp(None);
        snap.cpu_temp = Some(speeds.left_temp);
        snap.gpu_temp = Some(speeds.right_temp);
        snap.cpu_fan_rpm = Some(speeds.left_fan_speed);
        snap.gpu_fan_rpm = Some(speeds.right_fan_speed);
        if let Some((cpu1, cpu2, gpu1, gpu2, _)) = tdp {
            snap.cpu_power_limit_w = (cpu1 > 0).then_some(cpu1);
            snap.cpu_power_short_w = (cpu2 > 0).then_some(cpu2);
            snap.gpu_power_limit_w = (gpu1 > 0).then_some(gpu1);
            snap.gpu_power_short_w = (gpu2 > 0).then_some(gpu2);
        }
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

fn remember_runtime(fan_data: &FanData, window: &Window) {
    if let Ok(mut runtime) = LAST_RUNTIME.write() {
        *runtime = Some((fan_data.clone(), window.clone()));
    }
}

fn forget_runtime() {
    if let Ok(mut runtime) = LAST_RUNTIME.write() {
        *runtime = None;
    }
}

#[cfg(windows)]
pub(crate) fn init_com_on_thread() {
    crate::win_plug::wmi::wmi_security();
}

#[cfg(not(windows))]
pub(crate) fn init_com_on_thread() {}

#[expect(
    clippy::large_enum_variant,
    reason = "The actor channel is bounded and message clarity is more useful here."
)]
enum FanActorMessage {
    Start {
        fan_data: FanData,
        window: Window,
    },
    UpdatePolicy {
        fan_data: FanData,
    },
    Stop,
    GetTdp {
        reply: mpsc::SyncSender<(i64, i64, i64, i64, i64)>,
    },
    SetTdp {
        tdp: TDP,
        reply: mpsc::SyncSender<bool>,
    },
    SetCpuTdp {
        cpu1: i64,
        cpu2: i64,
        reply: mpsc::SyncSender<bool>,
    },
    LockCpuTdp {
        cpu1: i64,
        cpu2: i64,
        reply: mpsc::SyncSender<bool>,
    },
    LockTdp {
        tdp: TDP,
        reply: mpsc::SyncSender<bool>,
    },
    SetRgbColorY {
        reply: mpsc::SyncSender<bool>,
    },
    SetRgbColorN {
        reply: mpsc::SyncSender<bool>,
    },
    GetRgbColor {
        reply: mpsc::SyncSender<bool>,
    },
}

#[allow(dead_code)]
pub fn fan_init() {
    if let Ok(driver) = ApiFan::try_init() {
        driver.set_fan_control();
    } else {
        return;
    }
    println!("{}", "风扇初始化成功".green());
}

pub fn fan_reset() {
    app_log("fan", "info", "fan_reset.start", "setting fan mode to auto");
    let driver = match ApiFan::try_init() {
        Ok(driver) => driver,
        Err(error) => {
            app_log(
                "fan",
                "error",
                "fan_reset.failed",
                format!("driver_init_error={}", error),
            );
            return;
        }
    };
    let ok = driver.set_fan_auto();
    if !ok {
        app_log(
            "fan",
            "error",
            "fan_reset.failed",
            "set_fan_auto returned false",
        );
        return;
    }
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
        (
            if lv >= 254 { 255 } else { lv },
            if rv >= 254 { 255 } else { rv },
        )
    };
    let ok = driver.set_fan(l, r);
    app_log(
        "fan",
        if ok { "debug" } else { "warn" },
        "fan_set",
        format!(
            "left={} right={} raw_left={} raw_right={} ok={}",
            left, right, l, r, ok
        ),
    );
    println!(
        "FAN_L: {}% / FAN_R: {}% RAW: {}/{} RESULT:{}",
        left, right, l, r, ok
    );
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
    if !(MIN_TEMP_LIMIT..=MAX_TEMP_LIMIT).contains(&cpu_out)
        || !(MIN_TEMP_LIMIT..=MAX_TEMP_LIMIT).contains(&gpu_out)
    {
        state.invalid_temp_streak = state.invalid_temp_streak.saturating_add(1);
        println!(
            "温度读数异常 cpu={} gpu={}，异常计数={}",
            cpu_out, gpu_out, state.invalid_temp_streak
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
        if state.invalid_temp_streak >= INVALID_TEMP_RELEASE_THRESHOLD
            && !state.released_to_auto_due_invalid
        {
            println!(
                "{}",
                "⚠️ 连续温度异常，临时切换自动风扇等待传感器恢复".yellow()
            );
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
            (30_000u64 / control_sleep_ms.max(500)).clamp(1, 60) as u32;
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

    println!(
        "CPU:{}°C (EMA {:.2}) GPU:{}°C (EMA {:.2}) cacheL:{}% cacheR:{}%",
        cpu_out, ema_cpu_new, gpu_out, ema_gpu_new, state.fan_cache[0], state.fan_cache[1]
    );

    // 检测风扇被系统切回自动模式（如 OSD/电源计划切换），尝试重新接管但不要立即返回，避免留下硬件在自动高转速状态
    if should_check_manual_mode(state, control_sleep_ms) && driver.get_fan_mode() == 2 {
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
            println!(
                "🧊 唤醒冷却期 (剩余 {} 个周期)，风扇保持 {}% 保守转速",
                state.wake_cooldown_ticks_remaining, cs
            );
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
        thread::sleep(Duration::from_millis(control_sleep_ms));
        return;
    }
    if fan_data.right_fan.is_empty() {
        println!("{}", "右风扇曲线数据无效（没有有效点）".red());
        thread::sleep(Duration::from_millis(control_sleep_ms));
        return;
    }

    if constant_mode {
        let target = constant_speed_target(&fan_data.control);
        if fan_data
            .control
            .control_mode
            .eq_ignore_ascii_case("constant")
        {
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
        None => {
            thread::sleep(Duration::from_millis(control_sleep_ms));
            return;
        }
    };
    let mut target_right_raw = match find_speed_for_temp(&fan_data.right_fan, gpu_use, "右") {
        Some(s) => s.clamp(0, MAX_FAN_SPEED_PERCENT),
        None => {
            thread::sleep(Duration::from_millis(control_sleep_ms));
            return;
        }
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
        println!(
            "⚡ 刚刚接管，立即写入目标速度 CPU:{}% GPU:{}%",
            target_left_raw, target_right_raw
        );
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
    let ema_target_left_new = SPEED_EMA_ALPHA * (target_left_raw as f64)
        + (1.0 - SPEED_EMA_ALPHA) * state.ema_target_left;
    let ema_target_right_new = SPEED_EMA_ALPHA * (target_right_raw as f64)
        + (1.0 - SPEED_EMA_ALPHA) * state.ema_target_right;
    let target_left = ema_target_left_new.round() as i64;
    let target_right = ema_target_right_new.round() as i64;

    let speed_hysteresis = effective_speed_hysteresis(fan_data, state.active_mode.clone());

    // 防抖：目标与当前差值均在滞后范围内时，跳过本次写入
    if (state.fan_cache[0] - target_left).abs() <= speed_hysteresis
        && (state.fan_cache[1] - target_right).abs() <= speed_hysteresis
    {
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

    if cpu_out - state.ema_cpu.round() as i64 >= TEMP_JUMP_THRESHOLD
        || gpu_out - state.ema_gpu.round() as i64 >= TEMP_JUMP_THRESHOLD
    {
        max_up = FAST_RAMP_UP;
    }

    if state.force_max_fan {
        max_up = FAST_RAMP_UP.max(max_up);
        max_down = 100;
    }

    // 斜坡限速（使用自适应步进）
    let ramp_left = ramp_speed_internal(
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

    println!(
        "🔄 CPU {}%→{}%  GPU {}%→{}%",
        state.fan_cache[0], ramp_left, state.fan_cache[1], ramp_right
    );
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

fn should_check_manual_mode(state: &mut ControlState, control_sleep_ms: u64) -> bool {
    if state.manual_mode_check_ticks == 0 {
        let tick_ms = control_sleep_ms.max(MIN_MONITOR_SAMPLE_INTERVAL_MS);
        state.manual_mode_check_ticks =
            (MANUAL_MODE_CHECK_INTERVAL_MS / tick_ms).clamp(1, 60) as u32;
        return true;
    }

    state.manual_mode_check_ticks = state.manual_mode_check_ticks.saturating_sub(1);
    false
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

fn update_tray_status(
    window: Option<&Window>,
    mode: &FanControlMode,
    cpu_temp: i64,
    gpu_temp: i64,
) {
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

    let cpu_confirm = fan_data.alerts.cpu.actions.confirm_times.max(1);
    let gpu_confirm = fan_data.alerts.gpu.actions.confirm_times.max(1);
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

    let Some(path) = monitor_log_path() else {
        return;
    };
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
        let driver = match ApiFan::try_init() {
            Ok(driver) => driver,
            Err(e) => {
                app_log(
                    "fan_actor",
                    "error",
                    "driver.init_failed",
                    format!("error={}", e),
                );
                return;
            }
        };
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

            if is_resume_gap(elapsed) {
                app_log(
                    "fan_actor",
                    "warn",
                    "watchdog.resume_gap",
                    format!("elapsed_ms={} action=grace_and_keep_actor", elapsed),
                );
                ACTOR_HEARTBEAT.store(now, Ordering::SeqCst);
                continue;
            }

            if should_watchdog_mark_hung(elapsed) {
                println!(
                    "{}",
                    format!("☠️ 外部看门狗：心跳超时 {}ms，判定 Actor 挂死", elapsed)
                        .red()
                        .bold()
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

fn sentinel_restart_control(reason: &str, force: bool) -> bool {
    let now = now_ms_u64();
    let last_restart = LAST_SENTINEL_RESTART_MS.load(Ordering::SeqCst);
    if !force && now.saturating_sub(last_restart) < SENTINEL_RESTART_COOLDOWN_MS {
        app_log(
            "fan_sentinel",
            "debug",
            "restart.skipped_cooldown",
            format!(
                "reason={} remaining_ms={}",
                reason,
                SENTINEL_RESTART_COOLDOWN_MS.saturating_sub(now.saturating_sub(last_restart))
            ),
        );
        return false;
    }

    let runtime = LAST_RUNTIME
        .read()
        .ok()
        .and_then(|runtime| runtime.as_ref().cloned());
    let Some((fan_data, window)) = runtime else {
        app_log(
            "fan_sentinel",
            "warn",
            "restart.skipped_no_runtime",
            format!("reason={}", reason),
        );
        return false;
    };

    LAST_SENTINEL_RESTART_MS.store(now, Ordering::SeqCst);
    app_log(
        "fan_sentinel",
        "warn",
        "restart.start",
        format!(
            "reason={} force={} mode={} constant={} speed={}",
            reason,
            force,
            fan_data.control.mode.as_str(),
            is_constant_mode(&fan_data.control),
            fan_data.control.constant_speed
        ),
    );

    ACTOR_HUNG.store(true, Ordering::SeqCst);
    if let Ok(mut guard) = FAN_ACTOR_TX.write() {
        *guard = None;
    }

    let sender = fan_actor_sender();
    match sender.try_send(FanActorMessage::Start { fan_data, window }) {
        Ok(()) => {
            app_log(
                "fan_sentinel",
                "warn",
                "restart.queued",
                format!("reason={}", reason),
            );
            true
        }
        Err(error) => {
            app_log(
                "fan_sentinel",
                "error",
                "restart.failed",
                format!("reason={} error={}", reason, error),
            );
            false
        }
    }
}

fn sentinel_assess_snapshot(
    snap: &FanActorSnapshot,
    now: u128,
    runtime_available: bool,
) -> SentinelAssessment {
    let mut reasons: Vec<String> = Vec::new();
    let mut votes = 0_u8;

    if !runtime_available && !snap.running {
        return SentinelAssessment::default();
    }

    if ACTOR_HUNG.load(Ordering::SeqCst) {
        votes = votes.saturating_add(1);
        reasons.push("actor_flag".to_string());
    }

    if snap.hung {
        votes = votes.saturating_add(1);
        reasons.push("snapshot_hung".to_string());
    }

    if snap.running {
        if let Some(sampled_at) = snap.sampled_at_ms {
            let stale_ms = now.saturating_sub(sampled_at);
            if stale_ms > u128::from(SENTINEL_SAMPLE_STALE_MS)
                && !is_resume_gap(stale_ms.min(u128::from(u64::MAX)) as u64)
            {
                votes = votes.saturating_add(1);
                reasons.push(format!("sample_stale:{}ms", stale_ms));
            }
        }

        if let Some(last_heartbeat) = snap.last_heartbeat_ms {
            let stale_ms = now.saturating_sub(last_heartbeat);
            if stale_ms > u128::from(SENTINEL_HEARTBEAT_STALE_MS)
                && !is_resume_gap(stale_ms.min(u128::from(u64::MAX)) as u64)
            {
                votes = votes.saturating_add(1);
                reasons.push(format!("heartbeat_stale:{}ms", stale_ms));
            }
        }
    }

    SentinelAssessment {
        votes,
        reason: reasons.join(","),
    }
}

fn sentinel_has_objective_down(votes: u8, confirmed_ms: u64) -> bool {
    votes >= SENTINEL_OBJECTIVE_QUORUM || confirmed_ms >= SENTINEL_OBJECTIVE_CONFIRM_MS
}

fn wait_for_sentinel_restart_result(started_ms: u64) -> Result<String, String> {
    let deadline = Instant::now() + Duration::from_secs(12);
    let mut last_sample = 0_u128;
    let mut fresh_samples = 0_u8;
    loop {
        let snap = read_snapshot();
        if snap.running && !snap.hung {
            if let Some(sampled_at) = snap.sampled_at_ms {
                if sampled_at >= u128::from(started_ms) && sampled_at > last_sample {
                    last_sample = sampled_at;
                    fresh_samples = fresh_samples.saturating_add(1);
                    if fresh_samples >= 3 {
                        return Ok(format!(
                            "哨兵自检通过：模式 {}，连续采样 {} 次，最近采样 {}",
                            snap.active_mode, fresh_samples, sampled_at
                        ));
                    }
                }
            }
        }

        if let Some(error) = hardware_unavailable_error() {
            return Err(format!(
                "哨兵已尝试重启，但 Windows WMI 拒绝访问：{}",
                error
            ));
        }

        if Instant::now() >= deadline {
            return Err(format!(
                "哨兵已发起自检，但 12 秒内没有看到连续稳定采样。running={} hung={} fresh_samples={} last_sample={} last_heartbeat={:?}",
                snap.running, snap.hung, fresh_samples, last_sample, snap.last_heartbeat_ms
            ));
        }

        thread::sleep(Duration::from_millis(350));
    }
}

fn record_sentinel_restart_result(started_ms: u64) {
    match wait_for_sentinel_restart_result(started_ms) {
        Ok(message) => app_log("fan_sentinel", "warn", "manual_test.done", message),
        Err(error) => app_log("fan_sentinel", "error", "manual_test.failed", error),
    }
}

fn queue_manual_sentinel_test_restart(fan_data: FanData, window: Window) -> Result<(), String> {
    remember_runtime(&fan_data, &window);
    let sender = fan_actor_sender();
    if !ACTOR_HUNG.load(Ordering::SeqCst) {
        sender
            .try_send(FanActorMessage::Stop)
            .map_err(|error| format!("哨兵自检停止命令排队失败: {}", error))?;
        sender
            .try_send(FanActorMessage::Start { fan_data, window })
            .map_err(|error| format!("哨兵自检启动命令排队失败: {}", error))?;
        app_log(
            "fan_sentinel",
            "warn",
            "manual_test.queued",
            "queued graceful stop/start on current actor",
        );
        return Ok(());
    }

    remember_runtime(&fan_data, &window);
    if sentinel_restart_control("manual_test_hung_actor", true) {
        Ok(())
    } else {
        Err("哨兵自检硬重启没有成功排队，请查看最近哨兵日志。".to_string())
    }
}

pub fn start_fan_sentinel() {
    if FAN_SENTINEL_RUNNING
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return;
    }

    thread::spawn(|| {
        app_log(
            "fan_sentinel",
            "info",
            "start",
            format!(
                "check_ms={} sample_stale_ms={} heartbeat_stale_ms={} restart_cooldown_ms={}",
                SENTINEL_CHECK_INTERVAL_MS,
                SENTINEL_SAMPLE_STALE_MS,
                SENTINEL_HEARTBEAT_STALE_MS,
                SENTINEL_RESTART_COOLDOWN_MS
            ),
        );

        let mut state = SentinelState::default();

        loop {
            thread::sleep(Duration::from_millis(SENTINEL_CHECK_INTERVAL_MS));

            let snap = read_snapshot();
            let now = now_ms();
            let runtime_available = has_saved_runtime();
            if !runtime_available && !snap.running && ACTOR_HUNG.swap(false, Ordering::SeqCst) {
                app_log(
                    "fan_sentinel",
                    "info",
                    "sdown.clear_no_runtime",
                    "control is stopped; cleared stale actor flag",
                );
            }
            let assessment = sentinel_assess_snapshot(&snap, now, runtime_available);
            if assessment.votes == 0 {
                if state.subjective_down_since_ms.take().is_some() {
                    app_log(
                        "fan_sentinel",
                        "info",
                        "sdown.clear",
                        format!("previous_reason={}", state.last_reason),
                    );
                    state.last_reason.clear();
                }
                continue;
            }

            let now_u64 = now.min(u128::from(u64::MAX)) as u64;
            let sdown_since = match state.subjective_down_since_ms {
                Some(started_ms) => started_ms,
                None => {
                    state.subjective_down_since_ms = Some(now_u64);
                    state.last_reason = assessment.reason.clone();
                    app_log(
                        "fan_sentinel",
                        "warn",
                        "sdown.enter",
                        format!(
                            "votes={} quorum={} reason={}",
                            assessment.votes, SENTINEL_OBJECTIVE_QUORUM, assessment.reason
                        ),
                    );
                    continue;
                }
            };

            let confirmed_ms = now_u64.saturating_sub(sdown_since);
            state.last_reason = assessment.reason.clone();
            if !sentinel_has_objective_down(assessment.votes, confirmed_ms) {
                app_log(
                    "fan_sentinel",
                    "debug",
                    "sdown.confirming",
                    format!(
                        "votes={} quorum={} confirmed_ms={} confirm_ms={} reason={}",
                        assessment.votes,
                        SENTINEL_OBJECTIVE_QUORUM,
                        confirmed_ms,
                        SENTINEL_OBJECTIVE_CONFIRM_MS,
                        assessment.reason
                    ),
                );
                continue;
            }

            state.failover_epoch = state.failover_epoch.saturating_add(1);
            app_log(
                "fan_sentinel",
                "warn",
                "odown.enter",
                format!(
                    "epoch={} votes={} quorum={} confirmed_ms={} reason={}",
                    state.failover_epoch,
                    assessment.votes,
                    SENTINEL_OBJECTIVE_QUORUM,
                    confirmed_ms,
                    assessment.reason
                ),
            );

            if sentinel_restart_control(
                &format!(
                    "odown epoch={} votes={} reason={}",
                    state.failover_epoch, assessment.votes, assessment.reason
                ),
                false,
            ) {
                state.subjective_down_since_ms = None;
                state.last_reason.clear();
            } else if !has_saved_runtime() && !read_snapshot().running {
                ACTOR_HUNG.store(false, Ordering::SeqCst);
                state.subjective_down_since_ms = None;
                state.last_reason.clear();
                app_log(
                    "fan_sentinel",
                    "info",
                    "odown.clear_no_runtime",
                    "control is stopped; cleared stale actor flag",
                );
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
        app_log(
            "fan_actor",
            "info",
            "channel.create",
            "sync channel capacity=16",
        );

        let actor_generation = FAN_ACTOR_GENERATION.fetch_add(1, Ordering::SeqCst) + 1;

        // 初始化心跳和清除挂死标记
        ACTOR_HEARTBEAT.store(now_ms_u64(), Ordering::SeqCst);
        ACTOR_HUNG.store(false, Ordering::SeqCst);

        // 启动外部看门狗
        start_watchdog();

        *guard = Some(tx.clone());

        // 启动 Fan Actor 线程
        thread::spawn(move || {
            app_log(
                "fan_actor",
                "info",
                "thread.start",
                format!("fan actor thread spawned generation={}", actor_generation),
            );
            init_com_on_thread();
            // ApiFan 实例仅在 Actor 线程内创建和使用，不跨线程共享
            let driver = match ApiFan::try_init() {
                Ok(driver) => driver,
                Err(e) => {
                    app_log(
                        "fan_actor",
                        "error",
                        "driver.init_failed",
                        format!("error={}", e),
                    );
                    mark_hardware_unavailable(&e);
                    ACTOR_HEARTBEAT.store(0, Ordering::SeqCst);
                    ACTOR_HUNG.store(true, Ordering::SeqCst);
                    if let Ok(mut guard) = FAN_ACTOR_TX.write() {
                        *guard = None;
                    }
                    return;
                }
            };
            clear_hardware_unavailable("driver_init_ok");
            app_log("fan_actor", "info", "driver.init", "ApiFan initialized");
            let mut runtime: Option<(FanData, Window, ControlState)> = None;
            let mut last_iter_finished: Option<Instant> = None;
            let mut tdp_lock: Option<(TDP, Instant)> = None;

            loop {
                if FAN_ACTOR_GENERATION.load(Ordering::SeqCst) != actor_generation {
                    app_log(
                        "fan_actor",
                        "warn",
                        "thread.superseded",
                        format!("generation={}", actor_generation),
                    );
                    return;
                }

                // 在 WMI 调用前更新心跳，确保看门狗能检测到卡死
                ACTOR_HEARTBEAT.store(now_ms_u64(), Ordering::SeqCst);

                // 1. 排空所有控制消息（包括 TDP/RGB 请求）
                loop {
                    match rx.try_recv() {
                        Ok(FanActorMessage::Start { fan_data, window }) => {
                            remember_runtime(&fan_data, &window);
                            app_log(
                                "fan_actor",
                                "info",
                                "message.start",
                                format!(
                                    "mode={} constant={} speed={} interval_ms={}",
                                    fan_data.control.mode.as_str(),
                                    is_constant_mode(&fan_data.control),
                                    fan_data.control.constant_speed,
                                    fan_data.monitor.sample_interval_ms
                                ),
                            );
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
                            if let Ok(mut last_runtime) = LAST_RUNTIME.write() {
                                if let Some((runtime_fan_data, _)) = last_runtime.as_mut() {
                                    *runtime_fan_data = fan_data.clone();
                                }
                            }
                            app_log(
                                "fan_actor",
                                "info",
                                "message.update_policy",
                                format!(
                                    "mode={} constant={} speed={} interval_ms={}",
                                    fan_data.control.mode.as_str(),
                                    is_constant_mode(&fan_data.control),
                                    fan_data.control.constant_speed,
                                    fan_data.monitor.sample_interval_ms
                                ),
                            );
                            if let Some((ref mut runtime_fan_data, _, ref mut ctrl_state)) = runtime
                            {
                                *runtime_fan_data = fan_data.clone();
                                ctrl_state.constant_mode = is_constant_mode(&fan_data.control);
                                ctrl_state.constant_speed = fan_data.control.constant_speed;
                                ctrl_state.manual_mode_check_ticks = 0;
                            }
                        }
                        Ok(FanActorMessage::Stop) => {
                            forget_runtime();
                            app_log(
                                "fan_actor",
                                "info",
                                "message.stop",
                                "switching fan to auto and clearing runtime",
                            );
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
                            app_log(
                                "fan_actor",
                                "debug",
                                "message.get_tdp",
                                format!(
                                    "elapsed_ms={} result={:?}",
                                    started.elapsed().as_millis(),
                                    tdp
                                ),
                            );
                            let _ = reply.try_send(tdp);
                        }
                        Ok(FanActorMessage::SetTdp { tdp, reply }) => {
                            let started = Instant::now();
                            let cpu1 = tdp.cpu1;
                            let cpu2 = tdp.cpu2;
                            let gpu1 = tdp.gpu1;
                            let gpu2 = tdp.gpu2;
                            let ok = driver.set_tdp(tdp);
                            app_log(
                                "fan_actor",
                                if ok { "info" } else { "warn" },
                                "message.set_tdp",
                                format!(
                                    "elapsed_ms={} cpu={}W/{}W gpu={}W/{}W ok={}",
                                    started.elapsed().as_millis(),
                                    cpu1,
                                    cpu2,
                                    gpu1,
                                    gpu2,
                                    ok
                                ),
                            );
                            let _ = reply.try_send(ok);
                        }
                        Ok(FanActorMessage::SetCpuTdp { cpu1, cpu2, reply }) => {
                            let started = Instant::now();
                            let ok = driver.set_cpu_tdp(cpu1, cpu2);
                            app_log(
                                "fan_actor",
                                if ok { "info" } else { "warn" },
                                "message.set_cpu_tdp",
                                format!(
                                    "elapsed_ms={} cpu={}W/{}W ok={}",
                                    started.elapsed().as_millis(),
                                    cpu1,
                                    cpu2,
                                    ok
                                ),
                            );
                            let _ = reply.try_send(ok);
                        }
                        Ok(FanActorMessage::LockCpuTdp { cpu1, cpu2, reply }) => {
                            let started = Instant::now();
                            let ok = driver.set_cpu_tdp(cpu1, cpu2);
                            if ok {
                                let (_c1, _c2, g1, g2, tcc) = driver.get_tdp();
                                tdp_lock = Some((
                                    TDP {
                                        cpu1,
                                        cpu2,
                                        gpu1: g1,
                                        gpu2: g2,
                                        tcc,
                                    },
                                    Instant::now(),
                                ));
                            }
                            app_log(
                                "fan_actor",
                                if ok { "info" } else { "warn" },
                                "message.lock_cpu_tdp",
                                format!(
                                    "elapsed_ms={} cpu={}W/{}W lock_active={}",
                                    started.elapsed().as_millis(),
                                    cpu1,
                                    cpu2,
                                    ok
                                ),
                            );
                            let _ = reply.try_send(ok);
                        }
                        Ok(FanActorMessage::LockTdp { tdp, reply }) => {
                            let started = Instant::now();
                            let ok = driver.set_tdp(tdp.clone());
                            if ok {
                                tdp_lock = Some((tdp.clone(), Instant::now()));
                            }
                            app_log(
                                "fan_actor",
                                if ok { "info" } else { "warn" },
                                "message.lock_tdp",
                                format!(
                                    "elapsed_ms={} cpu={}W/{}W gpu={}W/{}W lock_active={}",
                                    started.elapsed().as_millis(),
                                    tdp.cpu1,
                                    tdp.cpu2,
                                    tdp.gpu1,
                                    tdp.gpu2,
                                    ok
                                ),
                            );
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
                if let Some((ref target_tdp, last_checked)) = tdp_lock {
                    if last_checked.elapsed() >= Duration::from_millis(TDP_LOCK_CHECK_INTERVAL_MS) {
                        let now_ms = now_ms_u64();
                        let paused_until_ms =
                            TDP_LOCK_REAPPLY_PAUSED_UNTIL_MS.load(Ordering::SeqCst);
                        if now_ms < paused_until_ms {
                            app_log(
                                "fan_actor",
                                "debug",
                                "tdp_lock.paused",
                                format!("remaining_ms={}", paused_until_ms.saturating_sub(now_ms)),
                            );
                            tdp_lock = Some((target_tdp.clone(), Instant::now()));
                            continue;
                        }

                        let (read_cpu1, read_cpu2, read_gpu1, read_gpu2, _read_tcc) =
                            driver.get_tdp();
                        if read_cpu1 != target_tdp.cpu1
                            || read_cpu2 != target_tdp.cpu2
                            || read_gpu1 != target_tdp.gpu1
                            || read_gpu2 != target_tdp.gpu2
                        {
                            if TDP_WRITE_IN_FLIGHT.load(Ordering::SeqCst) {
                                app_log(
                                    "fan_actor",
                                    "debug",
                                    "tdp_lock.write_busy",
                                    "skip drift reapply while explicit TDP write is in flight",
                                );
                                tdp_lock = Some((target_tdp.clone(), Instant::now()));
                                continue;
                            }

                            app_log(
                                "fan_actor",
                                "warn",
                                "tdp_lock.drift",
                                format!(
                                    "want cpu={}W/{}W gpu={}W/{}W got cpu={}W/{}W gpu={}W/{}W reapplying=true",
                                    target_tdp.cpu1, target_tdp.cpu2, target_tdp.gpu1, target_tdp.gpu2,
                                    read_cpu1, read_cpu2, read_gpu1, read_gpu2
                                ),
                            );
                            println!(
                                "TDP lock drift: want cpu={}W/{}W gpu={}W/{}W got cpu={}W/{}W gpu={}W/{}W, reapplying",
                                target_tdp.cpu1, target_tdp.cpu2, target_tdp.gpu1, target_tdp.gpu2,
                                read_cpu1, read_cpu2, read_gpu1, read_gpu2
                            );
                            let ok = driver.set_tdp(target_tdp.clone());
                            if ok {
                                update_tdp_cache((
                                    target_tdp.cpu1,
                                    target_tdp.cpu2,
                                    target_tdp.gpu1,
                                    target_tdp.gpu2,
                                    target_tdp.tcc,
                                ));
                            }
                            app_log(
                                "fan_actor",
                                if ok { "info" } else { "warn" },
                                "tdp_lock.reapply",
                                format!("ok={}", ok),
                            );
                        } else {
                            app_log(
                                "fan_actor",
                                "debug",
                                "tdp_lock.ok",
                                format!(
                                    "cpu={}W/{}W gpu={}W/{}W",
                                    read_cpu1, read_cpu2, read_gpu1, read_gpu2
                                ),
                            );
                        }
                        tdp_lock = Some((target_tdp.clone(), Instant::now()));
                    }
                }

                if let Some((ref fan_data, ref window, ref mut ctrl_state)) = runtime {
                    // 检查是否被外部看门狗标记为挂死
                    if ACTOR_HUNG.load(Ordering::SeqCst) {
                        app_log(
                            "fan_actor",
                            "error",
                            "actor_hung.flagged",
                            "external watchdog marked actor hung; clearing runtime",
                        );
                        println!("{}", "🪦 Actor 被外部看门狗标记为挂死，退出".red().bold());
                        runtime = None;
                        if let Ok(mut snap) = shared_snapshot().write() {
                            *snap = FanActorSnapshot::default();
                        }
                        continue;
                    }

                    // 内部看门狗：距上次成功循环超过阈值时优先恢复控制。
                    // 真正卡在 WMI 内部时本线程无法执行到这里，会交给外部 watchdog 处理。
                    if let Some(last) = last_iter_finished {
                        let gap = last.elapsed();
                        if gap > Duration::from_millis(CONTROL_LOOP_TIMEOUT_MS) {
                            let gap_ms = gap.as_millis().min(u128::from(u64::MAX)) as u64;
                            let resume_like = is_resume_gap(gap_ms);
                            app_log(
                                "fan_actor",
                                "warn",
                                "control_loop.timeout",
                                format!(
                                    "gap_ms={} action=recover_runtime resume_like={}",
                                    gap_ms, resume_like
                                ),
                            );
                            println!(
                                "{}",
                                format!(
                                    "⚠️ 内部控制循环断档 {}ms，正在重建手动风扇控制并恢复锁定",
                                    gap_ms
                                )
                                .yellow()
                                .bold()
                            );

                            let control_ok = driver.set_fan_control();
                            let previous_speed =
                                ctrl_state.fan_cache[0].max(ctrl_state.fan_cache[1]);
                            let recovery_speed = if is_constant_mode(&fan_data.control) {
                                constant_speed_target(&fan_data.control)
                            } else {
                                previous_speed
                                    .max(WAKE_COOLDOWN_SPEED)
                                    .clamp(0, MAX_FAN_SPEED_PERCENT)
                            };
                            fan_set(recovery_speed, recovery_speed, &driver);

                            let target_tdp = tdp_lock.as_ref().map(|(tdp, _)| tdp.clone());
                            let mut tdp_ok = None;
                            if let Some(target_tdp) = target_tdp {
                                if TDP_WRITE_IN_FLIGHT.load(Ordering::SeqCst) {
                                    app_log(
                                        "fan_actor",
                                        "debug",
                                        "control_loop.recover_tdp_skipped",
                                        "explicit TDP write is in flight",
                                    );
                                } else {
                                    let ok = driver.set_tdp(target_tdp.clone());
                                    if ok {
                                        update_tdp_cache((
                                            target_tdp.cpu1,
                                            target_tdp.cpu2,
                                            target_tdp.gpu1,
                                            target_tdp.gpu2,
                                            target_tdp.tcc,
                                        ));
                                        tdp_lock = Some((target_tdp, Instant::now()));
                                    }
                                    tdp_ok = Some(ok);
                                }
                            }

                            *ctrl_state = ControlState::new(fan_data.control.mode.clone());
                            ctrl_state.constant_mode = is_constant_mode(&fan_data.control);
                            ctrl_state.constant_speed = fan_data.control.constant_speed;
                            ctrl_state.fan_cache = [recovery_speed, recovery_speed];
                            ctrl_state.ema_target_left = recovery_speed as f64;
                            ctrl_state.ema_target_right = recovery_speed as f64;

                            if let Ok(mut snap) = shared_snapshot().write() {
                                snap.running = true;
                                snap.active_mode = ctrl_state.active_mode.as_str().to_string();
                                snap.constant_mode = ctrl_state.constant_mode;
                                snap.constant_speed = ctrl_state.constant_speed;
                                snap.hung = false;
                                snap.dropped_samples = snap.dropped_samples.saturating_add(1);
                                snap.last_heartbeat_ms =
                                    Some(ACTOR_HEARTBEAT.load(Ordering::SeqCst) as u128);
                            }
                            app_log(
                                "fan_actor",
                                "warn",
                                "control_loop.recovered",
                                format!(
                                    "gap_ms={} set_control_ok={} recovery_speed={} tdp_ok={:?}",
                                    gap_ms, control_ok, recovery_speed, tdp_ok
                                ),
                            );
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

                    continue;
                }

                thread::sleep(Duration::from_millis(80));
            }
        });

        return tx;
    }

    // RwLock 被污染（理论上不应该到这里）
    panic!("FAN_ACTOR_TX RwLock poisoned");
}

#[cfg(test)]
mod tests {
    use super::{
        is_resume_gap, sentinel_assess_snapshot, sentinel_has_objective_down,
        should_watchdog_mark_hung, ACTOR_HUNG, CONTROL_LOOP_TIMEOUT_MS, RESUME_GAP_MS,
        SENTINEL_HEARTBEAT_STALE_MS, SENTINEL_OBJECTIVE_CONFIRM_MS, SENTINEL_SAMPLE_STALE_MS,
        WATCHDOG_HUNG_TIMEOUT_MS,
    };
    use crate::plug::struct_set::FanActorSnapshot;
    use std::sync::atomic::Ordering;

    #[test]
    fn watchdog_treats_short_stalls_as_hung() {
        assert!(!should_watchdog_mark_hung(WATCHDOG_HUNG_TIMEOUT_MS));
        assert!(should_watchdog_mark_hung(WATCHDOG_HUNG_TIMEOUT_MS + 1));
        assert!(should_watchdog_mark_hung(RESUME_GAP_MS - 1));
    }

    #[test]
    fn watchdog_treats_large_clock_gaps_as_resume() {
        assert!(is_resume_gap(RESUME_GAP_MS));
        assert!(is_resume_gap(13_005_009));
        assert!(!should_watchdog_mark_hung(13_005_009));
    }

    #[test]
    fn control_loop_timeout_threshold_stays_below_watchdog_hung_threshold() {
        assert!(CONTROL_LOOP_TIMEOUT_MS < WATCHDOG_HUNG_TIMEOUT_MS);
    }

    #[test]
    fn sentinel_votes_like_quorum_before_objective_down() {
        ACTOR_HUNG.store(false, Ordering::SeqCst);
        assert!(!sentinel_has_objective_down(
            1,
            SENTINEL_OBJECTIVE_CONFIRM_MS - 1
        ));
        assert!(sentinel_has_objective_down(2, 0));
        assert!(sentinel_has_objective_down(
            1,
            SENTINEL_OBJECTIVE_CONFIRM_MS
        ));
    }

    #[test]
    fn sentinel_assessment_counts_independent_failure_signals() {
        ACTOR_HUNG.store(false, Ordering::SeqCst);
        let now = 100_000_u128;
        let mut snap = FanActorSnapshot {
            running: true,
            sampled_at_ms: Some(now - u128::from(SENTINEL_SAMPLE_STALE_MS + 1)),
            last_heartbeat_ms: Some(now - u128::from(SENTINEL_HEARTBEAT_STALE_MS + 1)),
            ..FanActorSnapshot::default()
        };

        let assessment = sentinel_assess_snapshot(&snap, now, true);
        assert_eq!(assessment.votes, 2);
        assert!(assessment.reason.contains("sample_stale"));
        assert!(assessment.reason.contains("heartbeat_stale"));

        snap.sampled_at_ms = Some(now);
        let assessment = sentinel_assess_snapshot(&snap, now, true);
        assert_eq!(assessment.votes, 1);
    }

    #[test]
    fn sentinel_assessment_ignores_resume_sized_gaps() {
        ACTOR_HUNG.store(false, Ordering::SeqCst);
        let now = u128::from(RESUME_GAP_MS + SENTINEL_HEARTBEAT_STALE_MS + 1);
        let snap = FanActorSnapshot {
            running: true,
            sampled_at_ms: Some(0),
            last_heartbeat_ms: Some(0),
            ..FanActorSnapshot::default()
        };

        let assessment = sentinel_assess_snapshot(&snap, now, true);
        assert_eq!(assessment.votes, 0);
    }

    #[test]
    fn sentinel_ignores_stale_actor_flag_when_control_is_stopped() {
        ACTOR_HUNG.store(true, Ordering::SeqCst);
        let assessment = sentinel_assess_snapshot(&FanActorSnapshot::default(), 100_000, false);
        ACTOR_HUNG.store(false, Ordering::SeqCst);
        assert_eq!(assessment.votes, 0);
    }
}

// ── TDP/RGB 操作：通过 Fan Actor 通道请求，避免 spawn_blocking 直接调用 WMI ──

pub fn request_tdp() -> Result<(i64, i64, i64, i64, i64), String> {
    if let Some(error) = hardware_unavailable_error() {
        return Err(error);
    }

    if let Some(value) = read_cached_tdp(Some(TDP_CACHE_TTL_MS)) {
        app_log(
            "fan_request",
            "debug",
            "tdp.cache_hit",
            "returning fresh cached TDP",
        );
        return Ok(value);
    }

    if TDP_READ_IN_FLIGHT
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        let wait_started_ms = now_ms_u64();
        if let Some(value) = wait_for_tdp_cache_newer_than(wait_started_ms, TDP_COALESCE_WAIT_MS) {
            app_log(
                "fan_request",
                "debug",
                "tdp.coalesced_wait",
                format!("wait_ms={}", now_ms_u64().saturating_sub(wait_started_ms)),
            );
            return Ok(value);
        }
        if let Some(value) = read_cached_tdp(None) {
            app_log(
                "fan_request",
                "warn",
                "tdp.coalesced",
                "returning stale cached TDP while read is in flight",
            );
            return Ok(value);
        }
        return Err("硬件读数繁忙，请稍后重试".to_string());
    }

    let started = Instant::now();
    app_log("fan_request", "debug", "tdp.send", "queueing GetTdp");
    let (tx, rx) = mpsc::sync_channel::<(i64, i64, i64, i64, i64)>(1);
    let result = match fan_actor_sender().try_send(FanActorMessage::GetTdp { reply: tx }) {
        Ok(_) => {
            app_log(
                "fan_request",
                "debug",
                "tdp.wait",
                format!("queued_elapsed_ms={}", started.elapsed().as_millis()),
            );
            rx.recv_timeout(Duration::from_secs(5))
                .map_err(|e| format!("硬件响应超时: {}", e))
        }
        Err(e) => Err(format!("硬件通道已满: {}", e)),
    };
    TDP_READ_IN_FLIGHT.store(false, Ordering::SeqCst);
    if let Ok(value) = result {
        update_tdp_cache(value);
        Ok(value)
    } else {
        result
    }
}

pub fn request_set_tdp(tdp: TDP) -> Result<bool, String> {
    if let Some(error) = hardware_unavailable_error() {
        return Err(error);
    }

    if TDP_WRITE_IN_FLIGHT
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("硬件写入繁忙，请稍后重试".to_string());
    }

    let (tx, rx) = mpsc::sync_channel::<bool>(1);
    let desired = (tdp.cpu1, tdp.cpu2, tdp.gpu1, tdp.gpu2, tdp.tcc);
    let result = match fan_actor_sender().try_send(FanActorMessage::SetTdp { tdp, reply: tx }) {
        Ok(_) => rx
            .recv_timeout(Duration::from_secs(10))
            .map_err(|e| format!("硬件响应超时: {}", e)),
        Err(e) => Err(format!("硬件通道已满: {}", e)),
    };
    TDP_WRITE_IN_FLIGHT.store(false, Ordering::SeqCst);
    if result == Ok(true) {
        update_tdp_cache(desired);
    }
    result
}

pub fn request_set_cpu_tdp(cpu1: i64, cpu2: i64) -> Result<bool, String> {
    if let Some(error) = hardware_unavailable_error() {
        return Err(error);
    }

    if TDP_WRITE_IN_FLIGHT
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("硬件写入繁忙，请稍后重试".to_string());
    }

    app_log(
        "fan_request",
        "info",
        "set_cpu_tdp.send",
        format!("cpu={}W/{}W", cpu1, cpu2),
    );
    let (tx, rx) = mpsc::sync_channel::<bool>(1);
    let result = match fan_actor_sender().try_send(FanActorMessage::SetCpuTdp {
        cpu1,
        cpu2,
        reply: tx,
    }) {
        Ok(_) => rx
            .recv_timeout(Duration::from_secs(8))
            .map_err(|e| format!("硬件响应超时: {}", e)),
        Err(e) => Err(format!("硬件通道已满: {}", e)),
    };
    TDP_WRITE_IN_FLIGHT.store(false, Ordering::SeqCst);
    if result == Ok(true) {
        update_cpu_tdp_cache(cpu1, cpu2);
    }
    result
}

pub fn request_lock_cpu_tdp(cpu1: i64, cpu2: i64) -> Result<bool, String> {
    if let Some(error) = hardware_unavailable_error() {
        return Err(error);
    }

    if TDP_WRITE_IN_FLIGHT
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("硬件写入繁忙，请稍后重试".to_string());
    }

    app_log(
        "fan_request",
        "info",
        "lock_cpu_tdp.send",
        format!("cpu={}W/{}W", cpu1, cpu2),
    );
    let (tx, rx) = mpsc::sync_channel::<bool>(1);
    let result = match fan_actor_sender().try_send(FanActorMessage::LockCpuTdp {
        cpu1,
        cpu2,
        reply: tx,
    }) {
        Ok(_) => rx
            .recv_timeout(Duration::from_secs(8))
            .map_err(|e| format!("硬件响应超时: {}", e)),
        Err(e) => Err(format!("硬件通道已满: {}", e)),
    };
    TDP_WRITE_IN_FLIGHT.store(false, Ordering::SeqCst);
    if result == Ok(true) {
        update_cpu_tdp_cache(cpu1, cpu2);
    }
    result
}

pub fn request_lock_tdp(tdp: TDP) -> Result<bool, String> {
    if let Some(error) = hardware_unavailable_error() {
        return Err(error);
    }

    if TDP_WRITE_IN_FLIGHT
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("硬件写入繁忙，请稍后重试".to_string());
    }

    app_log(
        "fan_request",
        "info",
        "lock_tdp.send",
        format!(
            "cpu={}W/{}W gpu={}W/{}W",
            tdp.cpu1, tdp.cpu2, tdp.gpu1, tdp.gpu2
        ),
    );
    let (tx, rx) = mpsc::sync_channel::<bool>(1);
    let desired = (tdp.cpu1, tdp.cpu2, tdp.gpu1, tdp.gpu2, tdp.tcc);
    let result = match fan_actor_sender().try_send(FanActorMessage::LockTdp { tdp, reply: tx }) {
        Ok(_) => rx
            .recv_timeout(Duration::from_secs(10))
            .map_err(|e| format!("硬件响应超时: {}", e)),
        Err(e) => Err(format!("硬件通道已满: {}", e)),
    };
    TDP_WRITE_IN_FLIGHT.store(false, Ordering::SeqCst);
    if result == Ok(true) {
        update_tdp_cache(desired);
    }
    result
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
        app_log(
            "fan_push",
            "debug",
            "start.skipped",
            "push thread already running",
        );
        println!("{}", "推送线程已在运行，忽略重复调用".yellow());
        return;
    }
    thread::spawn(move || {
        app_log(
            "fan_push",
            "info",
            "thread.start",
            "fan speed push thread started",
        );
        println!("{}", "✅ 风扇推送线程已启动".green());
        let mut hidden_ticks: u64 = 0;
        let mut emitted_ticks: u64 = 0;
        loop {
            let interval_ms = SENSOR_PUSH_INTERVAL_MS.load(Ordering::Relaxed).clamp(
                MIN_MONITOR_SAMPLE_INTERVAL_MS,
                MAX_MONITOR_SAMPLE_INTERVAL_MS,
            );
            thread::sleep(Duration::from_millis(interval_ms));
            if matches!(window.is_visible(), Ok(false)) {
                hidden_ticks += 1;
                if hidden_ticks == 1 || hidden_ticks.is_multiple_of(30) {
                    app_log(
                        "fan_push",
                        "debug",
                        "window.hidden",
                        format!("hidden_ticks={} interval_ms={}", hidden_ticks, interval_ms),
                    );
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
                cpu_power_limit_w: snap.cpu_power_limit_w,
                cpu_power_short_w: snap.cpu_power_short_w,
                gpu_power_limit_w: snap.gpu_power_limit_w,
                gpu_power_short_w: snap.gpu_power_short_w,
            };
            if let Err(e) = window.emit("get-fan-speeds", speeds) {
                app_log("fan_push", "warn", "emit.failed", format!("error={:?}", e));
                println!("推送失败（窗口可能已销毁）: {:?}，推送线程退出", e);
                break;
            }
            emitted_ticks += 1;
            if emitted_ticks == 1 || emitted_ticks.is_multiple_of(30) {
                app_log("fan_push", "debug", "emit.ok", format!("emitted_ticks={} interval_ms={} running={} cpu_temp={:?} gpu_temp={:?} cpu_rpm={:?} gpu_rpm={:?}", emitted_ticks, interval_ms, snap.running, snap.cpu_temp, snap.gpu_temp, snap.cpu_fan_rpm, snap.gpu_fan_rpm));
            }
        }
        SPEED_PUSH_RUNNING.store(false, Ordering::SeqCst);
        app_log(
            "fan_push",
            "info",
            "thread.exit",
            "fan speed push thread exited",
        );
        println!("{}", "📴 风扇推送线程已退出".yellow());
    });
}

#[tauri::command]
pub async fn start_fan_control(window: Window, fan_data: serde_json::Value) -> Result<(), String> {
    clear_hardware_unavailable("manual_start");

    let fan_data: FanData = match serde_json::from_value(fan_data) {
        Ok(v) => v,
        Err(e) => {
            println!("风扇配置解析失败: {}", e);
            return Err(format!("配置解析失败: {}", e));
        }
    };

    SENSOR_PUSH_INTERVAL_MS.store(
        fan_data.monitor.sample_interval_ms.clamp(
            MIN_MONITOR_SAMPLE_INTERVAL_MS,
            MAX_MONITOR_SAMPLE_INTERVAL_MS.min(1000),
        ),
        Ordering::Relaxed,
    );
    let sender = fan_actor_sender();
    if let Err(e) = sender.try_send(FanActorMessage::Start {
        fan_data: fan_data.clone(),
        window: window.clone(),
    }) {
        println!("发送启动命令到风扇 Actor 失败: {}", e);
        return Err(format!("风扇控制通道已满: {}", e));
    }
    remember_runtime(&fan_data, &window);
    Ok(())
}

#[tauri::command]
pub async fn force_fan_sentinel_restart(
    window: Window,
    fan_data: Option<serde_json::Value>,
) -> Result<String, String> {
    clear_hardware_unavailable("manual_sentinel_test");

    let fan_data: FanData = match fan_data {
        Some(value) if !value.is_null() => match serde_json::from_value(value) {
            Ok(v) => v,
            Err(e) => {
                println!("风扇配置解析失败: {}", e);
                return Err(format!("配置解析失败: {}", e));
            }
        },
        _ => {
            let fallback = LAST_RUNTIME
                .read()
                .ok()
                .and_then(|runtime| runtime.as_ref().map(|(fan_data, _)| fan_data.clone()))
                .unwrap_or_else(default_fan_data);
            app_log(
                "fan_sentinel",
                "warn",
                "manual_test.fallback_config",
                format!("mode={}", fallback.control.mode.as_str()),
            );
            fallback
        }
    };

    SENSOR_PUSH_INTERVAL_MS.store(
        fan_data.monitor.sample_interval_ms.clamp(
            MIN_MONITOR_SAMPLE_INTERVAL_MS,
            MAX_MONITOR_SAMPLE_INTERVAL_MS.min(1000),
        ),
        Ordering::Relaxed,
    );
    remember_runtime(&fan_data, &window);

    let started_ms = now_ms_u64();
    app_log(
        "fan_sentinel",
        "warn",
        "manual_test.start",
        format!(
            "mode={} constant={} speed={}",
            fan_data.control.mode.as_str(),
            is_constant_mode(&fan_data.control),
            fan_data.control.constant_speed
        ),
    );

    queue_manual_sentinel_test_restart(fan_data, window)?;

    thread::spawn(move || record_sentinel_restart_result(started_ms));

    Ok(
        "哨兵自检已交给后端执行：会先停止再启动风扇控制，并在日志中记录是否连续稳定采样。"
            .to_string(),
    )
}

#[tauri::command]
pub async fn get_current_fan_mode() -> Result<String, String> {
    Ok(read_snapshot().active_mode)
}

#[tauri::command]
pub async fn stop_fan_control() -> Result<(), String> {
    forget_runtime();
    clear_hardware_unavailable("manual_stop");

    let actor_was_hung = ACTOR_HUNG.swap(false, Ordering::SeqCst);
    let sender = FAN_ACTOR_TX
        .read()
        .ok()
        .and_then(|guard| guard.as_ref().cloned());
    let sender_present = sender.is_some();

    if let Some(sender) = sender {
        if !actor_was_hung {
            match sender.try_send(FanActorMessage::Stop) {
                Ok(()) => {}
                Err(mpsc::TrySendError::Disconnected(_)) => {
                    if let Ok(mut guard) = FAN_ACTOR_TX.write() {
                        *guard = None;
                    }
                }
                Err(e) => {
                    println!("发送停止命令到风扇 Actor 失败: {}", e);
                    return Err(format!("风扇控制通道已满: {}", e));
                }
            }
        } else if let Ok(mut guard) = FAN_ACTOR_TX.write() {
            *guard = None;
        }
    }

    if let Ok(mut snap) = shared_snapshot().write() {
        *snap = FanActorSnapshot::default();
    }

    app_log(
        "fan_request",
        "info",
        "stop.manual",
        format!(
            "actor_was_hung={} sender_present={}",
            actor_was_hung, sender_present
        ),
    );
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
        fan_data.monitor.sample_interval_ms.clamp(
            MIN_MONITOR_SAMPLE_INTERVAL_MS,
            MAX_MONITOR_SAMPLE_INTERVAL_MS.min(1000),
        ),
        Ordering::Relaxed,
    );

    let sender = fan_actor_sender();
    if let Ok(mut last_runtime) = LAST_RUNTIME.write() {
        if let Some((runtime_fan_data, _)) = last_runtime.as_mut() {
            *runtime_fan_data = fan_data.clone();
        }
    }

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
