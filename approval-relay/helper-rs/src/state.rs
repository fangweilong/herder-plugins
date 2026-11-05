//! 配置、i18n、语言与字体选择。

use serde::Deserialize;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Deserialize, Default)]
pub struct Config {
    #[serde(default)]
    pub language: String,
    #[serde(default, rename = "helperIdleSeconds", alias = "helper_idle_seconds")]
    pub helper_idle_seconds: Option<u64>,
    #[serde(default)]
    pub translation: TranslationConfig,
}

#[derive(Debug, Clone, Deserialize, Default)]
pub struct TranslationConfig {
    #[serde(default)]
    pub enabled: Option<bool>,
    #[serde(default)]
    pub provider: String,
    #[serde(default)]
    pub order: Vec<String>,
}

impl Config {
    pub fn load(data: &Path) -> Self {
        fs::read_to_string(data.join("config.json"))
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_default()
    }

    pub fn idle_seconds(&self) -> u64 {
        self.helper_idle_seconds.unwrap_or(120)
    }

    /// 翻译开关；未配置时按 provider 推断，与 PowerShell helper 一致。
    pub fn translation_enabled(&self) -> bool {
        self.translation
            .enabled
            .unwrap_or(self.translation.provider != "off")
    }

    pub fn translation_order(&self) -> Vec<String> {
        if !self.translation.order.is_empty() {
            return self.translation.order.clone();
        }
        if self.translation.provider == "microsoft" {
            vec!["microsoft".into(), "google".into()]
        } else {
            vec!["google".into(), "microsoft".into()]
        }
    }
}

#[derive(Clone)]
pub struct I18n {
    table: Value,
    pub lang: String,
}

impl I18n {
    pub fn load(home: &Path) -> Self {
        let table = fs::read_to_string(home.join("mods/approval-relay/i18n.json"))
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or(Value::Null);
        Self { table, lang: "en".into() }
    }

    pub fn set_lang(&mut self, lang: &str) {
        self.lang = if lang.starts_with("zh") { "zh".into() } else { "en".into() };
    }

    pub fn t(&self, key: &str) -> String {
        self.table
            .get(&self.lang)
            .and_then(|table| table.get(key))
            .and_then(Value::as_str)
            .or_else(|| self.table.get("en").and_then(|table| table.get(key)).and_then(Value::as_str))
            .unwrap_or(key)
            .to_string()
    }

    pub fn tf(&self, key: &str, pairs: &[(&str, &str)]) -> String {
        let mut text = self.t(key);
        for (name, value) in pairs {
            text = text.replace(name, value);
        }
        text
    }
}

pub fn resolve_language(request_lang: &str, config: &Config) -> String {
    let candidates = [request_lang, config.language.as_str()];
    for value in candidates {
        if value.starts_with("zh") {
            return "zh".into();
        }
        if value.starts_with("en") {
            return "en".into();
        }
    }
    for key in ["LC_ALL", "LC_MESSAGES", "LANG"] {
        if let Ok(value) = std::env::var(key) {
            if value.to_lowercase().contains("zh") {
                return "zh".into();
            }
        }
    }
    "en".into()
}

pub fn cjk_fonts() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    #[cfg(windows)]
    {
        if let Some(windir) = std::env::var_os("WINDIR") {
            let fonts = Path::new(&windir).join("Fonts");
            for name in ["msyh.ttc", "msyhbd.ttc", "simhei.ttf", "simsun.ttc"] {
                paths.push(fonts.join(name));
            }
        }
    }
    #[cfg(target_os = "macos")]
    {
        for name in ["PingFang.ttc", "Hiragino Sans GB.ttc", "STHeiti Light.ttc"] {
            paths.push(Path::new("/System/Library/Fonts").join(name));
        }
    }
    #[cfg(target_os = "linux")]
    {
        for name in [
            "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
            "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
            "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
        ] {
            paths.push(PathBuf::from(name));
        }
    }
    paths
}

pub fn symbol_fonts() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    #[cfg(windows)]
    {
        if let Some(windir) = std::env::var_os("WINDIR") {
            paths.push(Path::new(&windir).join("Fonts").join("seguisym.ttf"));
        }
    }
    #[cfg(target_os = "macos")]
    {
        paths.push(PathBuf::from("/System/Library/Fonts/Apple Symbols.ttf"));
    }
    #[cfg(target_os = "linux")]
    {
        paths.push(PathBuf::from("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"));
    }
    paths
}
