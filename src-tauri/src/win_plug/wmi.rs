use anyhow::{anyhow, Context};
use colored::Colorize;
use serde::Deserialize;
use windows::core::{w, BSTR, VARIANT};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoInitializeSecurity, CoSetProxyBlanket,
    CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED, EOAC_NONE, RPC_C_AUTHN_LEVEL_CALL,
    RPC_C_AUTHN_LEVEL_DEFAULT, RPC_C_IMP_LEVEL_IMPERSONATE,
};
use windows::Win32::System::Wmi::{
    IWbemClassObject, IWbemLocator, IWbemServices, WbemLocator, WBEM_FLAG_FORWARD_ONLY,
    WBEM_FLAG_RETURN_ERROR_OBJECT, WBEM_FLAG_RETURN_WBEM_COMPLETE, WBEM_INFINITE,
};
use wmi::{COMLibrary, WMIConnection};

use crate::plug::diagnostics::app_log;

const RPC_C_AUTHN_WINNT: u32 = 10;
const RPC_C_AUTHZ_NONE: u32 = 0;

fn model_id_from_name(model: &str) -> Option<i64> {
    let normalized = model.trim().to_ascii_uppercase();
    match normalized.as_str() {
        "LAPKC71E" | "LAPKC71F" => Some(0),
        "LAPAC71H" => Some(1),
        _ => None,
    }
}

pub fn wmi_security() {
    // SAFETY: These are process/thread COM initialization calls. All pointers are null
    // or supplied by the Windows crate, and failures are intentionally ignored because
    // COM may already be initialized by another plugin.
    unsafe {
        let init_result = CoInitializeEx(None, COINIT_MULTITHREADED);
        if init_result.is_err() {
            app_log(
                "wmi",
                "debug",
                "coinitialize.result",
                format!("result={:?}", init_result),
            );
        }
        if let Err(error) = CoInitializeSecurity(
            None,
            -1,
            None,
            None,
            RPC_C_AUTHN_LEVEL_DEFAULT,
            RPC_C_IMP_LEVEL_IMPERSONATE,
            None,
            EOAC_NONE,
            None,
        ) {
            app_log(
                "wmi",
                "debug",
                "coinitialize_security.result",
                format!("error={:?}", error),
            );
        }
    }
}

pub fn wmi_init() -> anyhow::Result<(IWbemClassObject, IWbemServices, BSTR, BSTR)> {
    let loc: IWbemLocator = unsafe {
        CoCreateInstance(&WbemLocator, None, CLSCTX_INPROC_SERVER)
            .context("failed to create WbemLocator")?
    };
    let svc = unsafe {
        loc.ConnectServer(&BSTR::from(r"ROOT\WMI"), None, None, None, 0, None, None)
            .context("failed to connect to ROOT\\WMI")?
    };
    unsafe {
        CoSetProxyBlanket(
            &svc,
            RPC_C_AUTHN_WINNT,
            RPC_C_AUTHZ_NONE,
            None,
            RPC_C_AUTHN_LEVEL_CALL,
            RPC_C_IMP_LEVEL_IMPERSONATE,
            None,
            EOAC_NONE,
        )
        .context("failed to set WMI proxy blanket")?;
    }

    let cls_name = BSTR::from("AcpiTest_MULong");
    let method_name = BSTR::from("GetSetULong");

    let object_enum = unsafe {
        svc.CreateInstanceEnum(
            &cls_name,
            WBEM_FLAG_FORWARD_ONLY | WBEM_FLAG_RETURN_ERROR_OBJECT,
            None,
        )
        .context("failed to enumerate AcpiTest_MULong instances")?
    };
    let mut objects = [None; 1];
    let mut count: u32 = 0;
    unsafe {
        object_enum
            .Next(WBEM_INFINITE, &mut objects, &mut count)
            .ok()
            .context("failed to retrieve AcpiTest_MULong instance")?;
    }
    let object = objects[0]
        .as_ref()
        .ok_or_else(|| anyhow!("AcpiTest_MULong instance not found"))?;

    let mut obj_path = VARIANT::new();
    unsafe {
        object
            .Get(w!("__RELPATH"), 0, &mut obj_path, None, None)
            .context("failed to read WMI object path")?;
    }
    let obj_path = BSTR::try_from(&obj_path).context("failed to convert WMI object path")?;

    let mut cls: Option<IWbemClassObject> = None;
    unsafe {
        svc.GetObject(
            &cls_name,
            WBEM_FLAG_RETURN_WBEM_COMPLETE,
            None,
            Some(&mut cls),
            None,
        )
        .context("failed to get AcpiTest_MULong class")?;
    }
    let cls = cls.ok_or_else(|| anyhow!("AcpiTest_MULong class missing"))?;
    let mut in_cls: Option<IWbemClassObject> = None;
    let mut out_cls: Option<IWbemClassObject> = None;
    unsafe {
        cls.GetMethod(&method_name, 0, &mut in_cls, &mut out_cls)
            .context("failed to get GetSetULong method")?;
    }
    let in_cls = in_cls.ok_or_else(|| anyhow!("GetSetULong input class missing"))?;
    Ok((in_cls, svc, obj_path, method_name))
}

pub fn wmi_set(
    in_cls: &IWbemClassObject,
    svc: &IWbemServices,
    obj_path: &BSTR,
    method_name: &BSTR,
    size: &str,
) -> i64 {
    let Some(hex) = size.strip_prefix("0x") else {
        eprintln!("Invalid WMI payload format: {}", size);
        return -1;
    };

    let in_params = match unsafe { in_cls.SpawnInstance(0) } {
        Ok(params) => params,
        Err(e) => {
            eprintln!("Failed to create WMI input params: {:?}", e);
            return -1;
        }
    };

    let data_value = match u64::from_str_radix(hex, 16) {
        Ok(val) => val,
        Err(e) => {
            eprintln!("Failed to parse WMI hex payload '{}': {:?}", size, e);
            return -1;
        }
    };

    unsafe {
        if let Err(e) = in_params.Put(
            &BSTR::from("Data"),
            0,
            &VARIANT::from(data_value.to_string().as_str()),
            0,
        ) {
            eprintln!("Failed to set WMI Data parameter: {:?}", e);
            return -1;
        }
    }

    let mut out_params: Option<IWbemClassObject> = None;
    if let Err(e) = unsafe {
        svc.ExecMethod(
            obj_path,
            method_name,
            WBEM_FLAG_RETURN_WBEM_COMPLETE,
            None,
            &in_params,
            Some(&mut out_params),
            None,
        )
    } {
        eprintln!("Failed to execute WMI method: {:?}", e);
        return -1;
    }

    let out_params = match out_params {
        Some(params) => params,
        None => {
            eprintln!("WMI method returned no output parameters");
            return -1;
        }
    };

    let mut return_value = VARIANT::new();
    if let Err(e) = unsafe { out_params.Get(w!("Return"), 0, &mut return_value, None, None) } {
        eprintln!("Failed to read WMI return value: {:?}", e);
        return -1;
    }

    let raw = return_value.to_string();
    match raw.parse::<i64>() {
        Ok(v) => v,
        Err(e) => {
            eprintln!("Failed to parse WMI return value '{}': {:?}", raw, e);
            -1
        }
    }
}

pub fn get_model() -> i64 {
    #[derive(Deserialize, Debug)]
    struct LaptopInfo {
        model: String,
        manufacturer: String,
    }

    let com_con = match COMLibrary::new() {
        Ok(con) => con,
        Err(e) => {
            eprintln!("WMI COM initialization failed while reading model: {:?}", e);
            return -1;
        }
    };
    let wmi_con = match WMIConnection::new(com_con) {
        Ok(con) => con,
        Err(e) => {
            eprintln!("WMI connection failed while reading model: {:?}", e);
            return -1;
        }
    };
    let results: Vec<LaptopInfo> =
        match wmi_con.raw_query("SELECT Model, Manufacturer FROM Win32_ComputerSystem") {
            Ok(results) => results,
            Err(e) => {
                eprintln!("WMI model query failed: {:?}", e);
                return -1;
            }
        };

    if let Some(laptop) = results.into_iter().next() {
        eprintln!("Manufacturer: {}", laptop.manufacturer.blue());
        eprintln!("Model: {}", laptop.model.blue());
        model_id_from_name(&laptop.model).unwrap_or(-1)
    } else {
        -1
    }
}

use std::io::{self, BufRead, Write};

pub fn run_wmi_helper_loop() -> ! {
    let stdin = io::stdin();
    let mut stdout = io::stdout();
    let mut state: Option<(IWbemClassObject, IWbemServices, BSTR, BSTR)> = None;

    for line in stdin.lock().lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => break,
        };
        let parts: Vec<&str> = line.splitn(2, ' ').collect();
        if parts.is_empty() {
            continue;
        }
        let cmd = parts[0];
        match cmd {
            "init" => {
                wmi_security();
                match wmi_init() {
                    Ok(s) => {
                        state = Some(s);
                        let _ = writeln!(stdout, "ok");
                    }
                    Err(e) => {
                        let _ = writeln!(stdout, "err {:?}", e);
                    }
                }
            }
            "set" => {
                if parts.len() < 2 {
                    let _ = writeln!(stdout, "err missing payload");
                } else if let Some((in_cls, svc, obj_path, method_name)) = &state {
                    let payload = parts[1];
                    let val = wmi_set(in_cls, svc, obj_path, method_name, payload);
                    let _ = writeln!(stdout, "value {}", val);
                } else {
                    let _ = writeln!(stdout, "err not initialized");
                }
            }
            "get_model" => {
                let model = get_model();
                let _ = writeln!(stdout, "model {}", model);
            }
            "quit" => {
                let _ = writeln!(stdout, "ok");
                let _ = stdout.flush();
                std::process::exit(0);
            }
            _ => {
                let _ = writeln!(stdout, "err unknown command");
            }
        }
        let _ = stdout.flush();
    }
    std::process::exit(0);
}

#[cfg(test)]
mod tests {
    use super::model_id_from_name;

    #[test]
    fn model_mapping_rejects_unsupported_hardware() {
        assert_eq!(model_id_from_name("LAPKC71E"), Some(0));
        assert_eq!(model_id_from_name("LAPKC71F"), Some(0));
        assert_eq!(model_id_from_name("LAPAC71H"), Some(1));
        assert_eq!(model_id_from_name(" lapkc71e "), Some(0));
        assert_eq!(model_id_from_name("UNKNOWN"), None);
        assert_eq!(model_id_from_name(""), None);
    }
}
