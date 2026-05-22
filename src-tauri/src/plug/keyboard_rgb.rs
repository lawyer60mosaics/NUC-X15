use crate::plug::{diagnostics::app_log, struct_set::RGB};

const ITE_VENDOR_ID: u16 = 0x048d;
const ITE_PRODUCT_IDS: [u16; 3] = [0x6004, 0x6006, 0xce00];
const ITE_RELEASE_NUMBER: u16 = 0x0003;

const NUM_ROWS: usize = 6;
const NUM_COLS: usize = 21;
const ROW_BUFFER_LEN: usize = 3 * NUM_COLS + 2;

const ROW_BLUE_OFFSET: usize = 1;
const ROW_GREEN_OFFSET: usize = 1 + NUM_COLS;
const ROW_RED_OFFSET: usize = 1 + 2 * NUM_COLS;

const CMD_SET_EFFECT: u8 = 0x08;
const CMD_SET_ROW_INDEX: u8 = 0x16;

const CONTROL_APPLY_EFFECT: u8 = 0x02;
const USER_EFFECT: u8 = 0x33;
const DEFAULT_BRIGHTNESS: u8 = 0x32;

fn rgb_byte(value: i64) -> u8 {
    value.clamp(0, 255) as u8
}

#[cfg(windows)]
mod platform {
    use super::*;
    use std::{ffi::c_void, mem::size_of, slice};
    use windows::{
        core::{Error, PCWSTR},
        Win32::{
            Devices::{
                DeviceAndDriverInstallation::{
                    SetupDiDestroyDeviceInfoList, SetupDiEnumDeviceInterfaces,
                    SetupDiGetClassDevsW, SetupDiGetDeviceInterfaceDetailW, DIGCF_DEVICEINTERFACE,
                    DIGCF_PRESENT, HDEVINFO, SP_DEVICE_INTERFACE_DATA,
                    SP_DEVICE_INTERFACE_DETAIL_DATA_W,
                },
                HumanInterfaceDevice::{
                    HidD_GetAttributes, HidD_GetHidGuid, HidD_SetFeature, HIDD_ATTRIBUTES,
                },
            },
            Foundation::{CloseHandle, HANDLE, HWND},
            Storage::FileSystem::{
                CreateFileW, WriteFile, FILE_ATTRIBUTE_NORMAL, FILE_GENERIC_READ,
                FILE_GENERIC_WRITE, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
            },
        },
    };

    struct DeviceInfoSet(HDEVINFO);

    impl Drop for DeviceInfoSet {
        fn drop(&mut self) {
            // Best-effort cleanup of the SetupAPI enumeration handle.
            let _ = unsafe { SetupDiDestroyDeviceInfoList(self.0) };
        }
    }

    struct DeviceHandle(HANDLE);

    impl Drop for DeviceHandle {
        fn drop(&mut self) {
            // Best-effort cleanup of the HID file handle.
            let _ = unsafe { CloseHandle(self.0) };
        }
    }

    fn windows_error(context: &str, error: Error) -> String {
        format!("{}: {}", context, error)
    }

    fn detail_data_size() -> u32 {
        size_of::<SP_DEVICE_INTERFACE_DETAIL_DATA_W>() as u32
    }

    fn device_path(detail: *const SP_DEVICE_INTERFACE_DETAIL_DATA_W) -> String {
        // SetupAPI writes a null-terminated UTF-16 string into the flexible
        // DevicePath field; scan until the first terminator inside the buffer.
        let start = unsafe { (*detail).DevicePath.as_ptr() };
        let mut len = 0usize;
        while unsafe { *start.add(len) } != 0 {
            len += 1;
        }

        String::from_utf16_lossy(unsafe { slice::from_raw_parts(start, len) })
    }

    fn hid_paths() -> Result<Vec<String>, String> {
        let guid = unsafe { HidD_GetHidGuid() };
        let info_set = unsafe {
            SetupDiGetClassDevsW(
                Some(&guid),
                PCWSTR::null(),
                HWND(std::ptr::null_mut()),
                DIGCF_PRESENT | DIGCF_DEVICEINTERFACE,
            )
        }
        .map(DeviceInfoSet)
        .map_err(|error| windows_error("enumerating HID devices failed", error))?;

        let mut paths = Vec::new();
        let mut index = 0u32;

        loop {
            let mut interface_data = SP_DEVICE_INTERFACE_DATA {
                cbSize: size_of::<SP_DEVICE_INTERFACE_DATA>() as u32,
                ..Default::default()
            };

            if let Err(error) = unsafe {
                SetupDiEnumDeviceInterfaces(info_set.0, None, &guid, index, &mut interface_data)
            } {
                if index == 0 && paths.is_empty() {
                    app_log(
                        "keyboard_rgb",
                        "warn",
                        "hid.enumerate.empty",
                        format!("error={}", error),
                    );
                }
                break;
            }

            let mut required_size = 0u32;
            let _ = unsafe {
                SetupDiGetDeviceInterfaceDetailW(
                    info_set.0,
                    &interface_data,
                    None,
                    0,
                    Some(&mut required_size),
                    None,
                )
            };

            if required_size >= detail_data_size() {
                let mut buffer = vec![0u8; required_size as usize];
                let detail = buffer.as_mut_ptr() as *mut SP_DEVICE_INTERFACE_DETAIL_DATA_W;
                unsafe {
                    (*detail).cbSize = detail_data_size();
                }

                match unsafe {
                    SetupDiGetDeviceInterfaceDetailW(
                        info_set.0,
                        &interface_data,
                        Some(detail),
                        required_size,
                        Some(&mut required_size),
                        None,
                    )
                } {
                    Ok(()) => paths.push(device_path(detail)),
                    Err(error) => app_log(
                        "keyboard_rgb",
                        "warn",
                        "hid.detail.failed",
                        format!("index={} error={}", index, error),
                    ),
                }
            }

            index += 1;
        }

        Ok(paths)
    }

    fn open_device(path: &str) -> Result<DeviceHandle, String> {
        let wide_path = path.encode_utf16().chain(Some(0)).collect::<Vec<_>>();
        let handle = unsafe {
            CreateFileW(
                PCWSTR(wide_path.as_ptr()),
                FILE_GENERIC_READ.0 | FILE_GENERIC_WRITE.0,
                FILE_SHARE_READ | FILE_SHARE_WRITE,
                None,
                OPEN_EXISTING,
                FILE_ATTRIBUTE_NORMAL,
                HANDLE::default(),
            )
        }
        .map(DeviceHandle)
        .map_err(|error| windows_error("opening HID device failed", error))?;

        Ok(handle)
    }

    fn is_ite_keyboard(handle: &DeviceHandle) -> bool {
        let mut attributes = HIDD_ATTRIBUTES {
            Size: size_of::<HIDD_ATTRIBUTES>() as u32,
            ..Default::default()
        };

        let ok = unsafe { HidD_GetAttributes(handle.0, &mut attributes).as_bool() };
        ok && attributes.VendorID == ITE_VENDOR_ID
            && ITE_PRODUCT_IDS.contains(&attributes.ProductID)
            && attributes.VersionNumber == ITE_RELEASE_NUMBER
    }

    fn send_ctrl(handle: &DeviceHandle, payload: &[u8]) -> Result<(), String> {
        let mut report = [0u8; 9];
        let len = payload.len().min(8);
        report[1..=len].copy_from_slice(&payload[..len]);

        let ok = unsafe {
            HidD_SetFeature(
                handle.0,
                report.as_ptr() as *const c_void,
                report.len() as u32,
            )
            .as_bool()
        };

        if ok {
            Ok(())
        } else {
            Err("sending keyboard RGB feature report failed".to_string())
        }
    }

    fn write_data(handle: &DeviceHandle, report: &[u8]) -> Result<(), String> {
        let mut written = 0u32;
        unsafe { WriteFile(handle.0, Some(report), Some(&mut written), None) }
            .map_err(|error| windows_error("writing keyboard RGB data failed", error))?;

        if written == report.len() as u32 {
            Ok(())
        } else {
            Err(format!(
                "incomplete keyboard RGB data write: expected={} actual={}",
                report.len(),
                written
            ))
        }
    }

    fn set_user_effect(handle: &DeviceHandle, brightness: u8) -> Result<(), String> {
        send_ctrl(
            handle,
            &[
                CMD_SET_EFFECT,
                CONTROL_APPLY_EFFECT,
                USER_EFFECT,
                0,
                brightness,
                0,
                0,
                0,
            ],
        )
    }

    fn set_row_index(handle: &DeviceHandle, row: u8) -> Result<(), String> {
        send_ctrl(handle, &[CMD_SET_ROW_INDEX, 0, row])
    }

    fn apply_static_color(handle: &DeviceHandle, rgb: &RGB) -> Result<(), String> {
        let red = rgb_byte(rgb.r);
        let green = rgb_byte(rgb.g);
        let blue = rgb_byte(rgb.b);

        set_user_effect(handle, DEFAULT_BRIGHTNESS)?;

        for row in 0..NUM_ROWS {
            let mut report = [0u8; ROW_BUFFER_LEN];
            for col in 0..NUM_COLS {
                report[ROW_RED_OFFSET + col] = red;
                report[ROW_GREEN_OFFSET + col] = green;
                report[ROW_BLUE_OFFSET + col] = blue;
            }

            set_row_index(handle, row as u8)?;
            write_data(handle, &report)
                .map_err(|error| format!("writing keyboard RGB row {} failed: {}", row, error))?;
        }

        Ok(())
    }

    pub fn set_static_color(rgb: &RGB) -> Result<bool, String> {
        let red = rgb_byte(rgb.r);
        let green = rgb_byte(rgb.g);
        let blue = rgb_byte(rgb.b);
        let mut errors = Vec::new();

        app_log(
            "keyboard_rgb",
            "info",
            "set_static_color.start",
            format!("r={} g={} b={}", red, green, blue),
        );

        for path in hid_paths()? {
            let handle = match open_device(&path) {
                Ok(handle) => handle,
                Err(error) => {
                    errors.push(error);
                    continue;
                }
            };

            if !is_ite_keyboard(&handle) {
                continue;
            }

            match apply_static_color(&handle, rgb) {
                Ok(()) => {
                    app_log(
                        "keyboard_rgb",
                        "info",
                        "set_static_color.done",
                        format!("r={} g={} b={}", red, green, blue),
                    );
                    return Ok(true);
                }
                Err(error) => errors.push(error),
            }
        }

        Err(format!(
            "no usable ITE 8291R3 keyboard RGB device found {:04x}:{:?} rev {:04x}; errors={:?}",
            ITE_VENDOR_ID, ITE_PRODUCT_IDS, ITE_RELEASE_NUMBER, errors
        ))
    }
}

#[cfg(not(windows))]
mod platform {
    use super::*;

    pub fn set_static_color(_rgb: &RGB) -> Result<bool, String> {
        Err("keyboard RGB currently only supports the Windows HID backend".to_string())
    }
}

pub fn set_static_color(rgb: &RGB) -> Result<bool, String> {
    platform::set_static_color(rgb)
}
