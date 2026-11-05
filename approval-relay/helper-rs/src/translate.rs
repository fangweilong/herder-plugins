//! 问题/终端内容的机器翻译。默认顺序 Google → Microsoft，与 PowerShell helper 一致。
//! 网络请求同步执行，由调用方放到后台线程，避免阻塞 UI。

use std::collections::HashMap;
use std::time::Duration;

#[derive(Clone)]
pub struct Translated {
    pub text: String,
    pub provider: String,
}

fn google(text: &str, to: &str) -> Result<String, String> {
    let url = format!(
        "https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=auto&tl={}&q={}",
        percent(to),
        percent(text)
    );
    let body = ureq::get(&url)
        .set("User-Agent", "Mozilla/5.0")
        .timeout(Duration::from_secs(7))
        .call()
        .map_err(|error| error.to_string())?
        .into_string()
        .map_err(|error| error.to_string())?;
    let data: serde_json::Value = serde_json::from_str(&body).map_err(|error| error.to_string())?;
    let first = data.get(0).ok_or_else(|| "empty response".to_string())?;
    if let Some(text) = first.as_str() {
        return Ok(text.to_string());
    }
    if let Some(text) = first.get(0).and_then(|value| value.as_str()) {
        return Ok(text.to_string());
    }
    let mut out = String::new();
    if let Some(segments) = first.as_array() {
        for segment in segments {
            if let Some(part) = segment.get(0).and_then(|value| value.as_str()) {
                out.push_str(part);
            }
        }
    }
    if out.is_empty() {
        return Err("empty response".to_string());
    }
    Ok(out)
}

fn microsoft(text: &str, to: &str) -> Result<String, String> {
    let to = if to == "zh-CN" { "zh-Hans" } else { to };
    let url = format!(
        "https://edge.microsoft.com/translate/translatetext?from=&to={}&isEnterpriseClient=false",
        percent(to)
    );
    let body = serde_json::to_vec(&vec![text]).map_err(|error| error.to_string())?;
    let raw = ureq::post(&url)
        .set("Content-Type", "application/json; charset=UTF-8")
        .set("User-Agent", "Mozilla/5.0")
        .timeout(Duration::from_secs(7))
        .send_bytes(&body)
        .map_err(|error| error.to_string())?
        .into_string()
        .map_err(|error| error.to_string())?;
    let data: serde_json::Value = serde_json::from_str(&raw).map_err(|error| error.to_string())?;
    data.get(0)
        .and_then(|item| item.get("translations"))
        .and_then(|items| items.get(0))
        .and_then(|item| item.get("text"))
        .and_then(|text| text.as_str())
        .map(str::to_string)
        .ok_or_else(|| "empty response".to_string())
}

/// 按配置顺序尝试提供方；全部失败时返回合并错误。
pub fn translate(text: &str, to: &str, order: &[String]) -> Result<Translated, String> {
    let value = text.trim();
    if value.is_empty() {
        return Err("empty".to_string());
    }
    let value: String = value.chars().take(1800).collect();
    let mut errors: Vec<String> = Vec::new();
    for candidate in order {
        let result = match candidate.as_str() {
            "google" => google(&value, to).map(|text| Translated { text, provider: "Google".into() }),
            "microsoft" => microsoft(&value, to).map(|text| Translated { text, provider: "Microsoft".into() }),
            _ => continue,
        };
        match result {
            Ok(translated) => return Ok(translated),
            Err(error) => errors.push(format!("{candidate}: {error}")),
        }
    }
    Err(errors.join(" / "))
}

/// 翻译缓存，避免同一问题反复请求。
#[derive(Default)]
pub struct Cache {
    entries: HashMap<String, Result<Translated, String>>,
}

impl Cache {
    pub fn get(&mut self, text: &str, to: &str, order: &[String]) -> Result<Translated, String> {
        let key = format!("{to}|{text}");
        if let Some(cached) = self.entries.get(&key) {
            return cached.clone();
        }
        let result = translate(text, to, order);
        let stored = match &result {
            Ok(translated) => Ok(Translated {
                text: translated.text.clone(),
                provider: translated.provider.clone(),
            }),
            Err(error) => Err(error.clone()),
        };
        self.entries.insert(key, stored);
        result
    }
}

pub fn target_lang(lang: &str) -> &'static str {
    if lang == "zh" {
        "zh-CN"
    } else {
        "en"
    }
}

fn percent(text: &str) -> String {
    let mut out = String::with_capacity(text.len() * 3);
    for byte in text.as_bytes() {
        match *byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(*byte as char),
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}
