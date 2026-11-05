//! 调用 Herdr 的 hc CLI 把按键/文本送回终端。三平台共用同一套参数。

use std::env;
use std::path::PathBuf;
use std::process::Command;
use std::time::Duration;

pub fn hc_path() -> Option<PathBuf> {
    if let Some(path) = env::var_os("HERDR_HC") {
        let path = PathBuf::from(path);
        if path.is_file() {
            return Some(path);
        }
    }
    if let Some(paths) = env::var_os("PATH") {
        for dir in env::split_paths(&paths) {
            for name in ["hc.exe", "hc"] {
                let candidate = dir.join(name);
                if candidate.is_file() {
                    return Some(candidate);
                }
            }
        }
    }
    #[cfg(windows)]
    {
        if let Some(local) = env::var_os("LOCALAPPDATA") {
            let candidate = PathBuf::from(local)
                .join("Programs")
                .join("herdr-core")
                .join("hc.exe");
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    #[cfg(target_os = "macos")]
    {
        for candidate in [
            "/opt/homebrew/bin/hc",
            "/usr/local/bin/hc",
            "/Applications/Herdr.app/Contents/MacOS/hc",
        ] {
            let path = PathBuf::from(candidate);
            if path.is_file() {
                return Some(path);
            }
        }
    }
    None
}

fn capture(args: &[String]) -> Result<String, String> {
    let exe = hc_path().ok_or_else(|| "hc not found".to_string())?;
    let output = Command::new(exe)
        .args(args)
        .output()
        .map_err(|error| error.to_string())?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(if stderr.is_empty() { "hc failed".to_string() } else { stderr })
    }
}

/// 单次最多 6 个键，长序列分批发送。
pub fn keys(address: &str, keys: &[String]) -> Result<(), String> {
    for chunk in keys.chunks(6) {
        let mut args = vec!["keys".to_string(), address.to_string()];
        args.extend(chunk.iter().cloned());
        capture(&args)?;
        std::thread::sleep(Duration::from_millis(60));
    }
    Ok(())
}

pub fn send(address: &str, text: &str) -> Result<(), String> {
    capture(&["send".to_string(), "--force".to_string(), address.to_string(), text.to_string()])?;
    Ok(())
}

/// 读取终端全文；失败时返回 None。
pub fn read_screen(address: &str) -> Option<String> {
    let raw = capture(&[
        "read".to_string(),
        address.to_string(),
        "--lines".to_string(),
        "0".to_string(),
        "--json".to_string(),
    ])
    .ok()?;
    let value: serde_json::Value = serde_json::from_str(&raw).ok()?;
    value.get("text").and_then(|text| text.as_str()).map(str::to_string)
}

/// 返回 status.state（如 "blocked"）；查询失败时返回 None。
pub fn status(address: &str) -> Option<String> {
    let raw = capture(&["get".to_string(), address.to_string(), "--json".to_string()]).ok()?;
    let value: serde_json::Value = serde_json::from_str(&raw).ok()?;
    value
        .get("status")
        .and_then(|status| status.get("state"))
        .and_then(|state| state.as_str())
        .map(str::to_string)
}
