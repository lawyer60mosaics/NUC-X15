pub mod config;
pub mod constants;
pub mod diagnostics;
pub mod fan;
pub mod fan_curve;
pub mod keyboard_rgb;
pub mod mode_profiles;
pub mod models;
pub mod process_sentinel;
pub mod ramp;
pub mod setup;
pub mod struct_set;
pub mod tdp;
pub mod vendor;

#[cfg(windows)]
pub mod wmi_client;
