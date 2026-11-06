//! 读取 Herdr 的 settings.json + themes/<name>.json，与 PowerShell helper 的配色规则一致。

use serde_json::Value;
use std::fs;
use std::path::Path;
use tiny_skia::Color;

#[derive(Clone, Copy)]
pub struct Theme {
    pub canvas: Color,
    pub surface: Color,
    pub popover: Color,
    pub raised: Color,
    pub border: Color,
    pub foreground: Color,
    pub muted: Color,
    pub dim: Color,
    pub accent: Color,
    pub accent_fg: Color,
    pub blocked: Color,
    #[allow(dead_code)]
    pub done: Color,
}

impl Theme {
    pub fn load(home: &Path) -> Self {
        let settings = read_json(&home.join("settings.json")).unwrap_or(Value::Null);
        let appearance = settings.get("appearance").and_then(Value::as_str).unwrap_or("dark");
        let name = match settings.get("theme") {
            Some(Value::String(name)) => Some(name.clone()),
            Some(Value::Object(map)) => map.get(appearance).and_then(Value::as_str).map(str::to_string),
            // Herdr 把主题记在布局里：settings.json 通常没有 theme，当前布局名在 shared.json。
            _ => layout_theme(home),
        };
        let colors = name
            .and_then(|name| read_json(&home.join("themes").join(format!("{name}.json"))))
            .and_then(|theme| theme.get("colors").cloned())
            .unwrap_or(Value::Null);

        let light = appearance == "light";
        let fallback = if light { &LIGHT } else { &DARK };
        let pick = |key: &str| {
            colors
                .get(key)
                .and_then(Value::as_str)
                .and_then(parse_hex)
                .unwrap_or_else(|| parse_hex(fallback.get(key)).unwrap())
        };
        Self {
            canvas: pick("canvas"),
            surface: pick("surface"),
            popover: pick("popover"),
            raised: pick("raised"),
            border: pick("border"),
            foreground: pick("foreground"),
            muted: pick("muted"),
            dim: pick("dim"),
            accent: pick("accent"),
            accent_fg: pick("accent_foreground"),
            blocked: pick("blocked"),
            done: pick("done"),
        }
    }
}

struct Palette(
    &'static str,
    &'static str,
    &'static str,
    &'static str,
    &'static str,
    &'static str,
    &'static str,
    &'static str,
    &'static str,
    &'static str,
    &'static str,
    &'static str,
);

impl Palette {
    fn get(&self, key: &str) -> &'static str {
        match key {
            "canvas" => self.0,
            "surface" => self.1,
            "popover" => self.2,
            "raised" => self.3,
            "border" => self.4,
            "foreground" => self.5,
            "muted" => self.6,
            "dim" => self.7,
            "accent" => self.8,
            "accent_foreground" => self.9,
            "blocked" => self.10,
            "done" => self.11,
            _ => "#000000",
        }
    }
}

const DARK: Palette = Palette(
    "#0A212A", "#0C2732", "#173540", "#22434F", "#ffffff22", "#EDE8D7", "#B1CBCE", "#7E9BA1", "#499DCE", "#0C2732", "#E64651", "#86EB9E",
);
const LIGHT: Palette = Palette(
    "#F1EDE3", "#FFFFFF", "#FBF8F0", "#EDE8DC", "#00000022", "#1F2A2E", "#5D6B70", "#8A979B", "#2F6F9E", "#FFFFFF", "#B33A3A", "#2F7D4F",
);

/// 当前布局声明的主题名：`shared.json` 的 `layout` 指向 `layouts/<布局>.json`。
fn layout_theme(home: &Path) -> Option<String> {
    let shared = read_json(&home.join("shared.json"))?;
    let layout = shared.get("layout").and_then(Value::as_str)?;
    let layout = read_json(&home.join("layouts").join(format!("{layout}.json")))?;
    layout.get("theme").and_then(Value::as_str).map(str::to_string)
}

pub fn blend(a: Color, b: Color, t: f32) -> Color {
    let t = t.clamp(0.0, 1.0);
    Color::from_rgba(
        a.red() + (b.red() - a.red()) * t,
        a.green() + (b.green() - a.green()) * t,
        a.blue() + (b.blue() - a.blue()) * t,
        a.alpha() + (b.alpha() - a.alpha()) * t,
    )
    .unwrap_or(a)
}

fn read_json(path: &Path) -> Option<Value> {
    serde_json::from_str(&fs::read_to_string(path).ok()?).ok()
}

fn parse_hex(hex: &str) -> Option<Color> {
    let h = hex.trim().trim_start_matches('#');
    let expand = |s: &str| u8::from_str_radix(s, 16).ok();
    match h.len() {
        3 => Some(Color::from_rgba8(
            expand(&h[0..1].repeat(2))?,
            expand(&h[1..2].repeat(2))?,
            expand(&h[2..3].repeat(2))?,
            255,
        )),
        6 => Some(Color::from_rgba8(
            expand(&h[0..2])?,
            expand(&h[2..4])?,
            expand(&h[4..6])?,
            255,
        )),
        8 => Some(Color::from_rgba8(
            expand(&h[0..2])?,
            expand(&h[2..4])?,
            expand(&h[4..6])?,
            expand(&h[6..8])?,
        )),
        _ => None,
    }
}
