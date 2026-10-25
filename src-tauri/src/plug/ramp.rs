use crate::plug::constants::{FAN_RAMP_STEP, MIN_FAN_SPEED};

pub fn ramp_speed_internal(
    cache: i64,
    target: i64,
    max_step_up: i64,
    max_step_down: i64,
    min_speed: i64,
) -> i64 {
    let min_speed = min_speed.clamp(0, 100);
    let target = target.clamp(0, 100);
    if target == 0 && min_speed == 0 {
        // Explicit zero-RPM policy: retain the existing intentional stop behavior.
        return 0;
    }
    // A zero target is valid only when the caller explicitly allows zero RPM
    // (effective_min_speed returns 0 for that case). Otherwise respect the
    // configured floor just like every other low target.
    let target = if target == 0 && min_speed > 0 {
        min_speed
    } else {
        target
    };

    if cache == 0 {
        target.max(min_speed)
    } else if target > cache {
        let high = (cache + max_step_up).min(100);
        target.clamp(cache, high)
    } else if target < cache {
        let low = (cache - max_step_down).max(min_speed);
        target.clamp(low, cache)
    } else {
        cache
    }
}

#[allow(dead_code)]
pub fn ramp_speed(cache: i64, target: i64) -> i64 {
    ramp_speed_internal(cache, target, FAN_RAMP_STEP, FAN_RAMP_STEP, MIN_FAN_SPEED)
}
