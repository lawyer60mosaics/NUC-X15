use crate::plug::{
    constants::{MAX_FAN_SPEED_PERCENT, MAX_TEMP_LIMIT, MIN_TEMP_LIMIT},
    struct_set::FanPoint,
};

pub fn speed_handle(temp_old: i64, speed_old: i64, temp: i64, speed: i64, temp_now: i64) -> i64 {
    let temp_diff = temp - temp_old;
    if temp_diff == 0 {
        return speed_old.clamp(0, MAX_FAN_SPEED_PERCENT);
    }
    let result = speed_old + ((speed - speed_old) * (temp_now - temp_old) / temp_diff);
    result.clamp(0, MAX_FAN_SPEED_PERCENT)
}

pub fn sanitize_curve(curve: &[FanPoint], side: &str) -> Vec<FanPoint> {
    let mut points: Vec<FanPoint> = curve
        .iter()
        .map(|p| {
            let t = (p.temperature as i64).clamp(MIN_TEMP_LIMIT, MAX_TEMP_LIMIT);
            let s = (p.speed as i64).clamp(0, MAX_FAN_SPEED_PERCENT);

            if t != p.temperature as i64 || s != p.speed as i64 {
                println!(
                    "{}风扇曲线点已自动修正: temp {}->{} speed {}->{}",
                    side, p.temperature, t, p.speed, s
                );
            }

            FanPoint {
                temperature: t as i32,
                speed: s as i32,
            }
        })
        .collect();

    points.sort_by_key(|p| (p.temperature, p.speed));

    let mut merged: Vec<FanPoint> = Vec::with_capacity(points.len());
    for point in points {
        match merged.last_mut() {
            Some(last) if last.temperature == point.temperature => {
                last.speed = last.speed.max(point.speed);
            }
            _ => merged.push(point),
        }
    }

    let mut max_speed = 0;
    for point in &mut merged {
        if point.speed < max_speed {
            println!(
                "{}风扇曲线点已自动修正: temp {} speed {}->{}",
                side, point.temperature, point.speed, max_speed
            );
            point.speed = max_speed;
        } else {
            max_speed = point.speed;
        }
    }

    merged
}

pub fn find_speed_for_temp(curve: &[FanPoint], temp_now: i64, side: &str) -> Option<i64> {
    if curve.is_empty() {
        println!("{}风扇曲线为空", side);
        return None;
    }

    let temp_now = temp_now.clamp(MIN_TEMP_LIMIT, MAX_TEMP_LIMIT);
    let mut temp_old = curve[0].temperature as i64;
    let mut speed_old = curve[0].speed as i64;

    if temp_now <= temp_old {
        return Some(speed_old.clamp(0, MAX_FAN_SPEED_PERCENT));
    }

    for point in curve.iter().skip(1) {
        let t = point.temperature as i64;
        let s = point.speed as i64;
        if t >= temp_now {
            return Some(speed_handle(temp_old, speed_old, t, s, temp_now));
        }
        temp_old = t;
        speed_old = s;
    }

    Some(speed_old.clamp(0, MAX_FAN_SPEED_PERCENT))
}
