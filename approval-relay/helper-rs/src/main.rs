//! Herdr 审批弹窗助手（Rust + CPU 自绘）。
//!
//! 协议与 PowerShell helper 完全一致：读 `queue/<id>.json`，写 `answers/<id>.json`，
//! 通过 `hc` 把按键/文本送回终端。解析、排队、审计仍由 mod 负责。

mod hc;
mod protocol;
mod state;
mod theme;
mod translate;
mod ui;

use crate::protocol::Request;
use crate::state::{Config, I18n};
use crate::theme::Theme;
use crate::ui::{strip_number, Hit, Ui};use softbuffer::{Context, Surface};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::sync::Arc;
use std::time::{Duration, Instant};
use winit::application::ApplicationHandler;
use winit::dpi::{LogicalSize, PhysicalPosition};
use winit::event::{ElementState, Ime, MouseButton, WindowEvent};
use winit::event_loop::{ActiveEventLoop, ControlFlow, EventLoop};
use winit::keyboard::{Key, NamedKey};
use winit::window::{Window, WindowId, WindowLevel};

const DESIGN_WIDTH: f32 = 740.0;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let home = app_home();
    let data = home.join("data").join("approval-relay");
    let _ = fs::create_dir_all(data.join("queue"));
    let _ = fs::create_dir_all(data.join("answers"));

    let lock_path = data.join("helper.lock");
    let lock = fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(false)
        .open(&lock_path)?;
    if fs2::FileExt::try_lock_exclusive(&lock).is_err() {
        return Ok(());
    }
    if another_helper_alive(&data) {
        return Ok(());
    }

    let event_loop = EventLoop::new()?;
    event_loop.set_control_flow(ControlFlow::WaitUntil(Instant::now() + Duration::from_millis(100)));
    let mut helper = Helper::new(home, lock);
    event_loop.run_app(&mut helper)?;
    Ok(())
}

/// 让 Windows 11 用 DWM 裁剪圆角。softbuffer 的像素没有 alpha，自己画圆角
/// 只会得到黑角；DWM 不支持的旧系统保持直角，但角上不再是黑色。
#[cfg(windows)]
fn round_window_corners(window: &Window) {
    use winit::raw_window_handle::{HasWindowHandle, RawWindowHandle};

    let Ok(handle) = window.window_handle() else { return };
    let RawWindowHandle::Win32(win32) = handle.as_raw() else { return };
    const DWMWA_WINDOW_CORNER_PREFERENCE: u32 = 33;
    const DWMWCP_ROUND: i32 = 2;
    #[link(name = "dwmapi")]
    extern "system" {
        fn DwmSetWindowAttribute(hwnd: isize, attr: u32, value: *const std::ffi::c_void, size: u32) -> i32;
    }
    let preference = DWMWCP_ROUND;
    unsafe {
        let _ = DwmSetWindowAttribute(
            win32.hwnd.get(),
            DWMWA_WINDOW_CORNER_PREFERENCE,
            &preference as *const i32 as *const std::ffi::c_void,
            std::mem::size_of::<i32>() as u32,
        );
    }
}

/// macOS 没有 DWM：让内容视图的 CALayer 裁剪圆角，窗口设为透明，
/// 圆角外才能露出桌面而不是黑块。窗口本身仍是矩形，命中区域不受影响。
#[cfg(target_os = "macos")]
fn round_window_corners(window: &Window) {
    use objc2::msg_send;
    use objc2::runtime::{AnyObject, Bool};
    use winit::raw_window_handle::{HasWindowHandle, RawWindowHandle};

    let Ok(handle) = window.window_handle() else { return };
    let RawWindowHandle::AppKit(appkit) = handle.as_raw() else { return };
    let view = appkit.ns_view.as_ptr() as *mut AnyObject;
    unsafe {
        let _: () = msg_send![view, setWantsLayer: Bool::YES];
        let layer: *mut AnyObject = msg_send![view, layer];
        if layer.is_null() {
            return;
        }
        let _: () = msg_send![layer, setCornerRadius: 14.0f64];
        let _: () = msg_send![layer, setMasksToBounds: Bool::YES];
    }
}

#[cfg(not(any(windows, target_os = "macos")))]
fn round_window_corners(_window: &Window) {}

fn app_home() -> PathBuf {
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        if arg == "--app-home" {
            if let Some(path) = args.next() {
                return PathBuf::from(path);
            }
        }
    }
    let base = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
        .unwrap_or_default();
    base.join(".config").join("herdr-app")
}

fn another_helper_alive(data: &Path) -> bool {
    let beat = fs::read_to_string(data.join("helper.json"))
        .ok()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok());
    let Some(beat) = beat else { return false };
    let at = beat.get("at").and_then(|value| value.as_u64()).unwrap_or(0);
    let pid = beat.get("pid").and_then(|value| value.as_u64()).unwrap_or(0);
    now_millis().saturating_sub(at) < 6000 && pid != 0 && pid != std::process::id() as u64
}

struct Helper {
    data: PathBuf,
    queue: PathBuf,
    answers: PathBuf,
    config: Config,
    theme: Theme,
    ui: Ui,
    _lock: fs::File,
    window: Option<Arc<Window>>,
    surface: Option<Surface<Arc<Window>, Arc<Window>>>,
    hidden: bool,
    exiting: bool,
    last_poll: Instant,
    last_beat: u64,
    last_activity: Instant,
    mouse: (f32, f32),
    pressed: Option<Hit>,
    tray: TrayState,
    placed: bool,
    trans_tx: mpsc::Sender<TransJob>,
    trans_rx: mpsc::Receiver<TransMsg>,
}

pub enum TransJob {
    Question {
        question: String,
        options: Vec<(String, String)>,
        order: Vec<String>,
        to: String,
    },
    Screen {
        text: String,
        order: Vec<String>,
        to: String,
    },
}

#[derive(Default)]
pub struct TransMsg {
    pub screen: Option<Result<translate::Translated, String>>,
    pub question: Option<Result<translate::Translated, String>>,
    pub options: Vec<(String, String)>,
    pub hints: Vec<(String, String)>,
    pub errors: Vec<String>,
    pub provider: String,
}

fn spawn_translator(tx: mpsc::Sender<TransMsg>, rx: mpsc::Receiver<TransJob>) {
    std::thread::spawn(move || {
        let mut cache = translate::Cache::default();
        while let Ok(job) = rx.recv() {
            let mut msg = TransMsg::default();
            match job {
                TransJob::Question { question, options, order, to } => {
                    if !question.trim().is_empty() {
                        match cache.get(&question, &to, &order) {
                            Ok(translated) => {
                                msg.provider = translated.provider.clone();
                                msg.question = Some(Ok(translated));
                            }
                            Err(error) => {
                                msg.errors.push(format!("question: {error}"));
                                msg.question = Some(Err(error));
                            }
                        }
                    }
                    for (label, hint) in options {
                        if label.trim().is_empty() || !label.chars().any(|ch| ch.is_ascii_alphabetic()) {
                            continue;
                        }
                        match cache.get(&label, &to, &order) {
                            Ok(translated) => {
                                if msg.provider.is_empty() {
                                    msg.provider = translated.provider.clone();
                                }
                                msg.options.push((label, translated.text));
                            }
                            Err(error) => msg.errors.push(format!("option: {error}")),
                        }
                        if hint.trim().is_empty() || !hint.chars().any(|ch| ch.is_ascii_alphabetic()) {
                            continue;
                        }
                        match cache.get(&hint, &to, &order) {
                            Ok(translated) => {
                                if msg.provider.is_empty() {
                                    msg.provider = translated.provider.clone();
                                }
                                msg.hints.push((hint, translated.text));
                            }
                            Err(error) => msg.errors.push(format!("hint: {error}")),
                        }
                    }
                }
                TransJob::Screen { text, order, to } => {
                    msg.screen = Some(cache.get(&text, &to, &order));
                }
            }
            if tx.send(msg).is_err() {
                return;
            }
        }
    });
}

struct TrayState {
    #[cfg(any(windows, target_os = "macos"))]
    icon: Option<tray_icon::TrayIcon>,
    #[cfg(any(windows, target_os = "macos"))]
    menu: Option<muda::Menu>,
    #[cfg(any(windows, target_os = "macos"))]
    open: Option<muda::MenuItem>,
    #[cfg(any(windows, target_os = "macos"))]
    exit: Option<muda::MenuItem>,
    count: i32,
}

impl Helper {
    fn new(home: PathBuf, lock: fs::File) -> Self {
        let data = home.join("data").join("approval-relay");
        let config = Config::load(&data);
        let theme = Theme::load(&home);
        let i18n = I18n::load(&home);
        let mut ui = Ui::new(theme, i18n);
        ui.i18n.set_lang(&state::resolve_language("", &config));
        let (trans_tx, job_rx) = mpsc::channel();
        let (msg_tx, trans_rx) = mpsc::channel();
        spawn_translator(msg_tx, job_rx);
        Self {
            queue: data.join("queue"),
            answers: data.join("answers"),
            data,
            config,
            theme,
            ui,
            _lock: lock,
            window: None,
            surface: None,
            hidden: true,
            exiting: false,
            last_poll: Instant::now() - Duration::from_secs(1),
            last_beat: 0,
            last_activity: Instant::now(),
            mouse: (0.0, 0.0),
            pressed: None,
            tray: TrayState {
                #[cfg(any(windows, target_os = "macos"))]
                icon: None,
                #[cfg(any(windows, target_os = "macos"))]
                menu: None,
                #[cfg(any(windows, target_os = "macos"))]
                open: None,
                #[cfg(any(windows, target_os = "macos"))]
                exit: None,
                count: -1,
            },
            placed: false,
            trans_tx,
            trans_rx,
        }
    }

    fn ensure_window(&mut self, event_loop: &ActiveEventLoop) {
        if self.window.is_some() {
            return;
        }
        let attrs = Window::default_attributes()
            .with_title("Herdr 审批")
            .with_inner_size(LogicalSize::new(DESIGN_WIDTH, 520.0))
            .with_min_inner_size(LogicalSize::new(600.0, 320.0))
            .with_decorations(false)
            .with_window_level(WindowLevel::AlwaysOnTop)
            .with_resizable(false);
        // 圆角由 CALayer 裁剪，窗口必须透明，否则裁掉的部分会露出窗口底色。
        #[cfg(target_os = "macos")]
        let attrs = attrs.with_transparent(true);
        let Ok(window) = event_loop.create_window(attrs) else { return };
        round_window_corners(&window);
        let window = Arc::new(window);
        let Ok(context) = Context::new(window.clone()) else { return };
        let context: &'static mut Context<Arc<Window>> = Box::leak(Box::new(context));
        let Ok(surface) = Surface::new(context, window.clone()) else { return };
        self.surface = Some(surface);
        self.window = Some(window);
        self.create_tray();
        self.place_bottom_right();
        if self.hidden {
            if let Some(window) = &self.window {
                window.set_visible(false);
            }
        }
    }

    fn create_tray(&mut self) {
        #[cfg(any(windows, target_os = "macos"))]
        {
            use muda::{Menu, MenuItem};
            let open = MenuItem::new(self.ui.i18n.t("tray.open"), true, None);
            let exit = MenuItem::new(self.ui.i18n.t("tray.exit"), true, None);
            let menu = Menu::new();
            let _ = menu.append(&open);
            let _ = menu.append(&exit);
            let icon = tray_icon::Icon::from_rgba(self.tray_rgba(0), 32, 32).ok();
            let builder = tray_icon::TrayIconBuilder::new()
                .with_tooltip(self.ui.i18n.t("tray.title"))
                .with_menu(Box::new(menu.clone()));
            let builder = if let Some(icon) = icon { builder.with_icon(icon) } else { builder };
            self.tray.icon = builder.build().ok();
            self.tray.menu = Some(menu);
            self.tray.open = Some(open);
            self.tray.exit = Some(exit);
        }
    }

    fn tray_rgba(&self, count: i32) -> Vec<u8> {
        let mut pixels = vec![0u8; 32 * 32 * 4];
        let color = if count > 0 { self.theme.blocked } else { self.theme.accent };
        let (r, g, b) = (
            (color.red() * 255.0) as u8,
            (color.green() * 255.0) as u8,
            (color.blue() * 255.0) as u8,
        );
        for y in 0..32 {
            for x in 0..32 {
                let dx = x as f32 - 15.5;
                let dy = y as f32 - 15.5;
                if dx * dx + dy * dy <= 14.0 * 14.0 {
                    let index = ((y * 32 + x) * 4) as usize;
                    pixels[index] = r;
                    pixels[index + 1] = g;
                    pixels[index + 2] = b;
                    pixels[index + 3] = 255;
                }
            }
        }
        pixels
    }

    fn update_tray(&mut self) {
        let count = fs::read_dir(&self.queue)
            .map(|entries| entries.filter_map(Result::ok).filter(|entry| entry.path().extension().map(|ext| ext == "json").unwrap_or(false)).count() as i32)
            .unwrap_or(0);
        self.ui.pending_count = count.max(0) as usize;
        if count == self.tray.count {
            return;
        }
        self.tray.count = count;
        #[cfg(any(windows, target_os = "macos"))]
        {
            use tray_icon::TrayIconBuilder;
            let _ = TrayIconBuilder::new; // keep import used
            if let Some(icon) = &self.tray.icon {
                let _ = icon.set_tooltip(Some(if count > 0 {
                    self.ui.i18n.tf("tray.pending", &[("{n}", &count.to_string())])
                } else {
                    self.ui.i18n.t("tray.title")
                }));
                if let Ok(image) = tray_icon::Icon::from_rgba(self.tray_rgba(count), 32, 32) {
                    let _ = icon.set_icon(Some(image));
                }
            }
        }
    }

    fn place_bottom_right(&mut self) {
        if self.placed {
            return;
        }
        let Some(window) = &self.window else { return };
        let scale = window.scale_factor();
        let win = window.outer_size();
        #[cfg(windows)]
        if let Some((left, top, width, height)) = screen::work_area() {
            let x = left + width as i32 - win.width as i32 - (20.0 * scale) as i32;
            let y = top + height as i32 - win.height as i32 - (20.0 * scale) as i32;
            window.set_outer_position(PhysicalPosition::new(x.max(left), y.max(top)));
            self.placed = true;
            return;
        }
        let Some(monitor) = window.current_monitor().or_else(|| window.primary_monitor()) else { return };
        let size = monitor.size();
        let pos = monitor.position();
        let x = pos.x + size.width as i32 - win.width as i32 - (20.0 * scale) as i32;
        let y = pos.y + size.height as i32 - win.height as i32 - (20.0 * scale) as i32;
        window.set_outer_position(PhysicalPosition::new(x.max(pos.x), y.max(pos.y)));
        self.placed = true;
    }

    fn poll(&mut self) {
        if self.last_poll.elapsed() < Duration::from_millis(700) {
            return;
        }
        self.last_poll = Instant::now();
        if let Some(request) = &self.ui.request {
            if !protocol::request_still_queued(&self.queue, &request.id) {
                self.ui.clear_request();
                self.hide();
            }
        }
        if self.ui.request.is_none() {
            if let Some(next) = protocol::next_request(&self.queue) {
                self.show_request(next);
            } else {
                self.hide();
            }
        }
        self.update_tray();
    }

    fn show_request(&mut self, request: Request) {
        let lang = state::resolve_language(&request.lang, &self.config);
        let text_mode = request.kind == "text" && !request.multi_question && request.options.is_empty();
        self.ui.set_request(request, &lang);
        self.ui.focus_input = text_mode;
        self.hidden = false;
        self.last_activity = Instant::now();
        if let Some(window) = &self.window {
            window.set_ime_allowed(text_mode);
            window.set_visible(true);
            window.focus_window();
        }
        self.request_redraw();
    }

    fn hide(&mut self) {
        // 只有“从可见变成隐藏”才算一次活动；轮询里重复 hide 不能刷新空闲计时。
        if !self.hidden {
            self.last_activity = Instant::now();
        }
        self.hidden = true;
        if let Some(window) = &self.window {
            window.set_visible(false);
        }
    }

    fn request_redraw(&self) {
        if let Some(window) = &self.window {
            window.request_redraw();
        }
    }

    fn scale(&self) -> f32 {
        self.window.as_ref().map(|window| window.scale_factor() as f32).unwrap_or(1.0)
    }

    fn redraw(&mut self) {
        let (Some(window), Some(surface)) = (self.window.clone(), self.surface.as_mut()) else { return };
        let size = window.inner_size();
        let (Some(width), Some(height)) = (
            std::num::NonZeroU32::new(size.width),
            std::num::NonZeroU32::new(size.height),
        ) else {
            return;
        };
        let scale = window.scale_factor() as f32;
        let Some(mut pixmap) = tiny_skia::Pixmap::new(width.get(), height.get()) else { return };
        pixmap.fill(tiny_skia::Color::from_rgba8(0, 0, 0, 0));
        let desired = self.ui.draw(&mut pixmap, scale);
        let _ = surface.resize(width, height);
        let Ok(mut buffer) = surface.buffer_mut() else { return };
        for (dst, px) in buffer.iter_mut().zip(pixmap.data().chunks_exact(4)) {
            *dst = ((px[0] as u32) << 16) | ((px[1] as u32) << 8) | px[2] as u32;
        }
        let _ = buffer.present();
        let logical_height = desired / scale;
        let current = height.get() as f32 / scale;
        let max_height = window
            .current_monitor()
            .map(|monitor| monitor.size().height as f32 / scale - 60.0)
            .unwrap_or(2000.0)
            .max(320.0);
        let logical_height = logical_height.min(max_height);
        if (logical_height - current).abs() > 2.0 && logical_height >= 160.0 {
            let _ = window.request_inner_size(LogicalSize::new(DESIGN_WIDTH, logical_height));
        }
    }

    fn handle_hit(&mut self, hit: Hit) {
        match hit {
            Hit::Close => self.hide(),
            Hit::Option(index) => self.select(index),
            Hit::Submit => self.submit_multi(),
            Hit::Ignore => self.dismiss(),
            Hit::Open => self.open_herdr(),
            Hit::Translate => self.start_translate_question(),
            Hit::ScreenTranslate => self.start_translate_screen(),
            Hit::ScreenRefresh => self.refresh_screen(),
            Hit::ScreenToggle => {
                self.ui.screen_expanded = !self.ui.screen_expanded;
                self.request_redraw();
            }
            Hit::Input => {
                self.ui.focus_input = true;
                if let Some(window) = &self.window {
                    window.set_ime_allowed(true);
                }
                self.request_redraw();
            }
            Hit::Send => self.send_text(),
            Hit::KeyCap(index) => self.generic_key(index),
            Hit::WizardPrev => self.wizard_prev(),
            Hit::WizardNext => self.wizard_next(),
        }
    }

    fn select(&mut self, index: usize) {
        let Some(request) = self.ui.request.clone() else { return };
        let Some(option) = self.ui.current_options().get(index).cloned() else { return };
        self.ui.cursor = index;
        if self.ui.wizard.is_some() {
            self.wizard_select(index);
            return;
        }
        if option.other {
            self.ui.other_active = true;
            self.ui.focus_input = true;
            self.ui.input.clear();
            if let Some(window) = &self.window {
                window.set_ime_allowed(true);
            }
            self.request_redraw();
            return;
        }
        match hc::keys(&request.address, &option.keys) {
            Ok(()) => {}
            Err(error) => {
                self.ui.message = Some((error, Instant::now()));
                self.request_redraw();
                return;
            }
        }
        if request.multi {
            if let Some(pos) = self.ui.selected.iter().position(|value| *value == index) {
                self.ui.selected.remove(pos);
            } else {
                self.ui.selected.push(index);
            }
        } else if request.tabs.len() > 1 || request.multi_question {
            self.emit_refresh(&request);
        } else {
            self.emit("keys", &option.label, option.keys.clone(), None, true, None);
            return;
        }
        self.request_redraw();
    }

    fn submit_multi(&mut self) {
        let Some(request) = self.ui.request.clone() else { return };
        let mut keys: Vec<String> = std::iter::repeat_n("down".to_string(), 24).collect();
        keys.push("enter".to_string());
        if let Err(error) = hc::keys(&request.address, &keys) {
            self.ui.message = Some((error, Instant::now()));
            self.request_redraw();
            return;
        }
        self.emit_refresh(&request);
        self.request_redraw();
    }

    fn send_text(&mut self) {
        let Some(request) = self.ui.request.clone() else { return };
        let value = self.ui.input.trim().replace(['\r', '\n'], " ");
        if value.is_empty() {
            return;
        }
        if value.chars().count() > 2000 {
            self.ui.message = Some((self.ui.i18n.t("error.long"), Instant::now()));
            self.request_redraw();
            return;
        }
        if self.ui.wizard.is_some() {
            if let Some(wizard) = &mut self.ui.wizard {
                if let Some(answer) = wizard.answers.get_mut(wizard.index) {
                    answer.text = value;
                }
            }
            self.ui.input.clear();
            self.request_redraw();
            return;
        }
        let other = request.options.iter().find(|option| option.other);
        let result = if let Some(option) = other {
            hc::keys(&request.address, &option.keys).and_then(|_| hc::send(&request.address, &value))
        } else {
            hc::send(&request.address, &value)
        };
        match result {
            Ok(()) => {
                self.emit("text", &value.clone(), Vec::new(), Some(value), true, None);
            }
            Err(error) => {
                self.ui.message = Some((error, Instant::now()));
                self.request_redraw();
            }
        }
    }

    fn dismiss(&mut self) {
        if self.ui.request.is_some() {
            self.emit("dismiss", "", Vec::new(), None, true, None);
        }
    }

    fn generic_key(&mut self, index: usize) {
        let keys = [
            "enter", "esc", "up", "down", "tab", "1", "2", "3", "y", "n",
        ];
        let Some(key) = keys.get(index) else { return };
        let Some(request) = self.ui.request.clone() else { return };
        let key = key.to_string();
        let mut list = vec![key.clone()];
        if key == "y" || key == "n" {
            list.push("enter".to_string());
        }
        match hc::keys(&request.address, &list) {
            Ok(()) => self.emit("keys", &key, list, None, true, None),
            Err(error) => {
                self.ui.message = Some((error, Instant::now()));
                self.request_redraw();
            }
        }
    }

    fn emit(&mut self, action: &str, choice: &str, keys: Vec<String>, text: Option<String>, ok: bool, error: Option<String>) {
        let Some(request) = self.ui.request.clone() else { return };
        // 给终端一点时间处理按键，再判断是否仍在 blocked（与 PowerShell helper 一致）。
        std::thread::sleep(Duration::from_millis(600));
        let status = hc::status(&request.address);
        let answer = serde_json::json!({
            "id": request.id,
            "address": request.address,
            "action": action,
            "choice": choice,
            "keys": keys,
            "text": text,
            "hash": request.hash,
            "ok": ok,
            "error": error,
            "stillBlocked": status.as_deref() == Some("blocked"),
            "status": status,
            "at": now_millis(),
        });
        protocol::write_answer(&self.answers, &answer);
        protocol::remove_queued(&self.queue, &request.id);
        self.ui.clear_request();
        self.hide();
        self.update_tray();
    }

    fn emit_refresh(&mut self, request: &Request) {
        let answer = serde_json::json!({
            "id": request.id,
            "address": request.address,
            "action": "refresh",
            "at": now_millis(),
        });
        protocol::write_answer(&self.answers, &answer);
        self.last_poll = Instant::now() - Duration::from_secs(2);
    }

    fn open_herdr(&mut self) {
        let Some(request) = &self.ui.request else { return };
        let address = request.address.clone();
        if let Some(app) = app_path() {
            let _ = std::process::Command::new(app)
                .args(["do", "agent.focus", "--terminal", &address])
                .output();
            self.hide();
        }
    }

    fn refresh_screen(&mut self) {
        let Some(request) = &self.ui.request else { return };
        let address = request.address.clone();
        let Some(text) = hc::read_screen(&address) else { return };
        if let Some(request) = &mut self.ui.request {
            request.screen = text;
        }
        self.ui.screen_translated = false;
        self.ui.screen_translation.clear();
        self.request_redraw();
    }

    fn start_translate_question(&mut self) {
        let Some(request) = &self.ui.request else { return };
        if !self.config.translation_enabled() {
            self.ui.translation_visible = true;
            self.ui.translation_provider.clear();
            self.ui.translation_text = self.ui.i18n.t("translate.off");
            self.request_redraw();
            return;
        }
        let options = self
            .ui
            .current_options()
            .iter()
            .map(|option| (strip_number(&option.label), option.hint.clone()))
            .collect();
        let question = self.ui.question_text(request);
        let to = translate::target_lang(&self.ui.i18n.lang).to_string();
        let order = self.config.translation_order();
        let _ = self.trans_tx.send(TransJob::Question { question, options, order, to });
        self.ui.translate_loading = true;
        self.ui.translation_visible = true;
        self.ui.translation_text.clear();
        self.ui.translation_provider.clear();
        self.request_redraw();
    }

    fn start_translate_screen(&mut self) {
        if self.ui.screen_translated {
            self.ui.screen_translated = false;
            self.request_redraw();
            return;
        }
        if !self.config.translation_enabled() {
            self.ui.message = Some((self.ui.i18n.t("translate.off"), Instant::now()));
            self.request_redraw();
            return;
        }
        let Some(request) = &self.ui.request else { return };
        let text = trim_screen(&request.screen);
        if text.trim().is_empty() {
            return;
        }
        let to = translate::target_lang(&self.ui.i18n.lang).to_string();
        let order = self.config.translation_order();
        let _ = self.trans_tx.send(TransJob::Screen { text, order, to });
        self.ui.screen_translate_loading = true;
        self.request_redraw();
    }

    fn drain_translations(&mut self) {
        while let Ok(msg) = self.trans_rx.try_recv() {
            if let Some(question) = msg.question {
                self.ui.translate_loading = false;
                self.ui.translation_visible = true;
                self.ui.translation_provider = msg.provider.clone();
                match question {
                    Ok(translated) => self.ui.translation_text = translated.text,
                    Err(_) => {
                        if msg.options.is_empty() {
                            let mut text = self.ui.i18n.t("translate.failed");
                            if !msg.errors.is_empty() {
                                text.push(' ');
                                text.push_str(&msg.errors.join(" / "));
                            }
                            self.ui.translation_text = text;
                        } else {
                            self.ui.translation_text = self.ui.i18n.t("translate.optionsOnly");
                        }
                    }
                }
                for (label, text) in msg.options {
                    self.ui.option_translations.insert(label, text);
                }
                for (hint, text) in msg.hints {
                    self.ui.hint_translations.insert(hint, text);
                }
            }
            if let Some(screen) = msg.screen {
                self.ui.screen_translate_loading = false;
                match screen {
                    Ok(translated) => {
                        self.ui.screen_translation = translated.text;
                        self.ui.screen_translated = true;
                        self.ui.translation_provider = translated.provider;
                    }
                    Err(error) => {
                        self.ui.message = Some((format!("{} {error}", self.ui.i18n.t("translate.failed")), Instant::now()));
                    }
                }
            }
            self.request_redraw();
        }
    }

    fn wizard_select(&mut self, index: usize) {
        let Some(wizard) = &mut self.ui.wizard else { return };
        let Some(request) = &self.ui.request else { return };
        let Some(question) = request.questions.get(wizard.index) else { return };
        let Some(answer) = wizard.answers.get_mut(wizard.index) else { return };
        let other = question.options.iter().position(|option| option.other);
        if question.options.get(index).map(|option| option.other).unwrap_or(false) {
            answer.selected = vec![index];
            answer.text.clear();
            self.ui.focus_input = true;
            self.ui.other_active = true;
        } else {
            answer.selected.retain(|value| Some(*value) != other);
            if question.multi {
                if let Some(pos) = answer.selected.iter().position(|value| *value == index) {
                    answer.selected.remove(pos);
                } else {
                    answer.selected.push(index);
                }
            } else {
                answer.selected = vec![index];
            }
            self.ui.other_active = false;
        }
        self.request_redraw();
    }

    fn wizard_prev(&mut self) {
        if let Some(wizard) = &mut self.ui.wizard {
            if wizard.index > 0 {
                wizard.index -= 1;
                self.ui.selected = wizard.answers[wizard.index].selected.clone();
                self.ui.cursor = self.ui.selected.first().copied().unwrap_or(usize::MAX);
                wizard.cursor = self.ui.cursor;
                self.ui.input = wizard.answers[wizard.index].text.clone();
                self.request_redraw();
            }
        }
    }

    fn wizard_next(&mut self) {
        let Some(wizard) = &self.ui.wizard else { return };
        let Some(request) = self.ui.request.clone() else { return };
        let Some(question) = request.questions.get(wizard.index).cloned() else { return };
        let Some(answer) = wizard.answers.get(wizard.index).cloned() else { return };
        if answer.selected.is_empty() {
            return;
        }
        let other = question.options.iter().position(|option| option.other);
        if other.map(|index| answer.selected.contains(&index)).unwrap_or(false) && answer.text.trim().is_empty() {
            self.ui.focus_input = true;
            self.ui.other_active = true;
            return;
        }
        if let Err(error) = self.send_wizard_current(&request, &question, &answer) {
            self.ui.message = Some((error, Instant::now()));
            self.request_redraw();
            return;
        }
        if wizard.index + 1 < request.questions.len() {
            if let Some(wizard) = &mut self.ui.wizard {
                wizard.index += 1;
                self.ui.selected = wizard.answers[wizard.index].selected.clone();
                self.ui.cursor = self.ui.selected.first().copied().unwrap_or(usize::MAX);
                wizard.cursor = self.ui.cursor;
                self.ui.input = wizard.answers[wizard.index].text.clone();
                self.ui.other_active = false;
            }
            self.refresh_screen();
            self.request_redraw();
        } else {
            let _ = hc::keys(&request.address, &["enter".to_string()]);
            self.emit("keys", "multi-question", Vec::new(), None, true, None);
        }
    }

    fn send_wizard_current(
        &self,
        request: &Request,
        question: &protocol::Question,
        answer: &ui::WizardAnswer,
    ) -> Result<(), String> {
        let other = question.options.iter().position(|option| option.other);
        let mut selected = answer.selected.clone();
        selected.sort_unstable();
        if selected.is_empty() {
            return Ok(());
        }
        let mut keys: Vec<String> = Vec::new();
        if question.multi {
            let mut position = 0usize;
            for index in &selected {
                if Some(*index) == other {
                    continue;
                }
                let delta = *index as i32 - position as i32;
                if delta > 0 {
                    keys.extend(std::iter::repeat_n("down".to_string(), delta as usize));
                } else if delta < 0 {
                    keys.extend(std::iter::repeat_n("up".to_string(), (-delta) as usize));
                }
                keys.push("space".to_string());
                position = *index;
            }
            if other.map(|value| selected.contains(&value)).unwrap_or(false) {
                let other = other.unwrap();
                let delta = other as i32 - position as i32;
                if delta > 0 {
                    keys.extend(std::iter::repeat_n("down".to_string(), delta as usize));
                } else if delta < 0 {
                    keys.extend(std::iter::repeat_n("up".to_string(), (-delta) as usize));
                }
                keys.push("enter".to_string());
                hc::keys(&request.address, &keys)?;
                std::thread::sleep(Duration::from_millis(250));
                return hc::send(&request.address, &answer.text);
            }
            keys.push("enter".to_string());
        } else {
            let index = selected[0];
            keys.extend(std::iter::repeat_n("down".to_string(), index));
            keys.push("enter".to_string());
            if Some(index) == other {
                hc::keys(&request.address, &keys)?;
                std::thread::sleep(Duration::from_millis(250));
                return hc::send(&request.address, &answer.text);
            }
        }
        hc::keys(&request.address, &keys)?;
        std::thread::sleep(Duration::from_millis(200));
        Ok(())
    }

    fn tick(&mut self, event_loop: &ActiveEventLoop) {
        if self.exiting {
            event_loop.exit();
            return;
        }
        if let Some(window) = &self.window {
            let _ = window.request_redraw();
        }
        self.write_heartbeat();
        if self.data.join("stop.flag").exists() {
            let _ = fs::remove_file(self.data.join("stop.flag"));
            self.exiting = true;
            event_loop.exit();
            return;
        }
        if self.data.join("wake.flag").exists() {
            let _ = fs::remove_file(self.data.join("wake.flag"));
            self.hidden = false;
            if let Some(window) = &self.window {
                window.set_visible(true);
                window.focus_window();
            }
        }
        self.poll();
        self.drain_translations();
        self.handle_tray_events();
        let idle = self.config.idle_seconds();
        if self.ui.request.is_none() && self.hidden && idle > 0 && self.last_activity.elapsed().as_secs() > idle {
            self.exiting = true;
            event_loop.exit();
        }
    }

    fn handle_tray_events(&mut self) {
        #[cfg(any(windows, target_os = "macos"))]
        {
            while let Ok(event) = tray_icon::TrayIconEvent::receiver().try_recv() {
                if let tray_icon::TrayIconEvent::Click { button: tray_icon::MouseButton::Left, .. } = event {
                    if self.ui.request.is_some() {
                        self.hidden = false;
                        if let Some(window) = &self.window {
                            window.set_visible(true);
                            window.focus_window();
                        }
                    }
                }
            }
            while let Ok(event) = muda::MenuEvent::receiver().try_recv() {
                if self.tray.open.as_ref().map(|item| item.id()) == Some(&event.id) {
                    if self.ui.request.is_some() {
                        self.hidden = false;
                        if let Some(window) = &self.window {
                            window.set_visible(true);
                            window.focus_window();
                        }
                    }
                } else if self.tray.exit.as_ref().map(|item| item.id()) == Some(&event.id) {
                    self.exiting = true;
                }
            }
        }
    }

    fn write_heartbeat(&mut self) {
        let now = now_millis();
        if now.saturating_sub(self.last_beat) < 2000 {
            return;
        }
        self.last_beat = now;
        let beat = serde_json::json!({ "pid": std::process::id(), "at": now, "version": "0.2.0" });
        protocol::write_json(&self.data.join("helper.json"), &beat);
    }

    fn key(&mut self, event: &winit::event::KeyEvent) {
        if self.ui.request.is_none() {
            return;
        }
        let escape = matches!(&event.logical_key, Key::Named(NamedKey::Escape));
        if self.ui.focus_input && !escape {
            match &event.logical_key {
                Key::Named(NamedKey::Backspace) => {
                    self.ui.input.pop();
                }
                Key::Named(NamedKey::Enter) => self.send_text(),
                Key::Named(NamedKey::Tab) => {
                    self.ui.focus_input = false;
                    if let Some(window) = &self.window {
                        window.set_ime_allowed(false);
                    }
                }
                Key::Character(value) => self.ui.input.push_str(value.as_str()),
                _ => {}
            }
            self.request_redraw();
            return;
        }
        if escape {
            self.hide();
            return;
        }
        if self.ui.wizard.is_some() {
            match &event.logical_key {
                Key::Named(NamedKey::ArrowDown) => {
                    self.wizard_move_cursor(1);
                    return;
                }
                Key::Named(NamedKey::ArrowUp) => {
                    self.wizard_move_cursor(-1);
                    return;
                }
                Key::Named(NamedKey::Tab) => {
                    self.wizard_next();
                    return;
                }
                Key::Named(NamedKey::Enter) => {
                    self.wizard_next();
                    return;
                }
                Key::Named(NamedKey::Space) => {
                    let cursor = self.ui.wizard.as_ref().map(|wizard| wizard.cursor).unwrap_or(usize::MAX);
                    if cursor < self.ui.current_options().len() {
                        self.select(cursor);
                    }
                    return;
                }
                _ => {}
            }
        } else {
            match &event.logical_key {
                Key::Named(NamedKey::ArrowDown) | Key::Named(NamedKey::ArrowUp) => {
                    let count = self.ui.current_options().len();
                    if count > 0 {
                        let delta: i32 = if matches!(event.logical_key, Key::Named(NamedKey::ArrowDown)) { 1 } else { -1 };
                        // 初始光标不在任何选项上；第一次按方向键才落到第一项/最后一项。
                        let next = if self.ui.cursor >= count {
                            if delta > 0 { 0 } else { count - 1 }
                        } else {
                            (self.ui.cursor as i32 + delta).clamp(0, count as i32 - 1) as usize
                        };
                        self.ui.cursor = next;
                        self.request_redraw();
                    }
                    return;
                }
                Key::Named(NamedKey::Space) => {
                    let cursor = self.ui.cursor;
                    if cursor < self.ui.current_options().len() {
                        self.select(cursor);
                    }
                    return;
                }
                _ => {}
            }
        }
        if let Key::Character(value) = &event.logical_key {
            let lower = value.to_lowercase();
            if lower == "t" {
                self.start_translate_question();
                return;
            }
            if let Some(ch) = lower.chars().next() {
                if ch.is_ascii_digit() && ch != '0' {
                    let index = ch.to_digit(10).unwrap() as usize - 1;
                    if index < self.ui.current_options().len() {
                        self.select(index);
                        return;
                    }
                }
            }
        }
        if let Key::Named(NamedKey::Enter) = event.logical_key {
            if self.ui.request.as_ref().map(|request| request.multi).unwrap_or(false) {
                self.submit_multi();
            } else if self.ui.cursor < self.ui.current_options().len() {
                // 只确认用户用方向键移动过的选项；没有选择时 Enter 不提交任何内容。
                let cursor = self.ui.cursor;
                self.select(cursor);
            }
        }
    }

    fn wizard_move_cursor(&mut self, delta: i32) {
        let count = self.ui.current_options().len();
        if count == 0 {
            return;
        }
        if let Some(wizard) = &mut self.ui.wizard {
            wizard.cursor = if wizard.cursor >= count {
                if delta > 0 { 0 } else { count - 1 }
            } else {
                (wizard.cursor as i32 + delta).clamp(0, count as i32 - 1) as usize
            };
            self.ui.cursor = wizard.cursor;
        }
        self.request_redraw();
    }
}

impl ApplicationHandler for Helper {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        self.ensure_window(event_loop);
        self.poll();
        if self.ui.request.is_some() && !self.hidden {
            if let Some(window) = &self.window {
                window.set_visible(true);
            }
        }
    }

    fn window_event(&mut self, event_loop: &ActiveEventLoop, _id: WindowId, event: WindowEvent) {
        match event {
            WindowEvent::CloseRequested => self.hide(),
            WindowEvent::Resized(_) | WindowEvent::ScaleFactorChanged { .. } => {
                self.placed = false;
                self.place_bottom_right();
                self.request_redraw();
            }
            WindowEvent::RedrawRequested => self.redraw(),
            WindowEvent::CursorMoved { position, .. } => {
                self.mouse = (position.x as f32, position.y as f32);
                if self.ui.update_hover(self.mouse.0, self.mouse.1) {
                    self.request_redraw();
                }
            }
            WindowEvent::MouseInput { state, button: MouseButton::Left, .. } => {
                match state {
                    ElementState::Pressed => {
                        self.pressed = self.ui.hit_at(self.mouse.0, self.mouse.1);
                        if self.pressed.is_none() && self.mouse.1 < 40.0 * self.scale() {
                            if let Some(window) = &self.window {
                                let _ = window.drag_window();
                            }
                        }
                    }
                    ElementState::Released => {
                        if let Some(hit) = self.pressed.take() {
                            if self.ui.hit_at(self.mouse.0, self.mouse.1) == Some(hit) {
                                self.handle_hit(hit);
                            }
                        }
                    }
                }
            }
            WindowEvent::KeyboardInput { event, .. } => {
                if event.state == ElementState::Pressed {
                    self.key(&event);
                }
            }
            WindowEvent::Ime(Ime::Preedit(text, _)) => {
                if self.ui.focus_input {
                    self.ui.preedit = text;
                    self.request_redraw();
                }
            }
            WindowEvent::Ime(Ime::Commit(text)) => {
                if self.ui.focus_input {
                    self.ui.input.push_str(&text);
                    self.ui.preedit.clear();
                    self.request_redraw();
                }
            }
            _ => {}
        }
        if self.exiting {
            event_loop.exit();
        }
    }

    fn about_to_wait(&mut self, event_loop: &ActiveEventLoop) {
        self.tick(event_loop);
        event_loop.set_control_flow(ControlFlow::WaitUntil(Instant::now() + Duration::from_millis(100)));
    }
}

/// 与 PowerShell helper 的 Trim-Screen 一致：取最后 12 行非空内容。
fn trim_screen(text: &str) -> String {
    let lines: Vec<&str> = text.lines().filter(|line| !line.trim().is_empty()).collect();
    lines.iter().rev().take(12).rev().copied().collect::<Vec<_>>().join("\n")
}

/// 取鼠标所在显示器的工作区（taskbar 之外），与 PowerShell helper 的定位一致。
#[cfg(windows)]
mod screen {
    #[repr(C)]
    struct Point {
        x: i32,
        y: i32,
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct Rect {
        left: i32,
        top: i32,
        right: i32,
        bottom: i32,
    }

    #[repr(C)]
    struct MonitorInfo {
        cb_size: u32,
        rc_monitor: Rect,
        rc_work: Rect,
        flags: u32,
    }

    #[link(name = "user32")]
    extern "system" {
        fn GetCursorPos(point: *mut Point) -> i32;
        fn MonitorFromPoint(point: Point, flags: u32) -> isize;
        fn GetMonitorInfoW(monitor: isize, info: *mut MonitorInfo) -> i32;
    }

    pub fn work_area() -> Option<(i32, i32, u32, u32)> {
        let mut point = Point { x: 0, y: 0 };
        let mut info = MonitorInfo {
            cb_size: std::mem::size_of::<MonitorInfo>() as u32,
            rc_monitor: Rect { left: 0, top: 0, right: 0, bottom: 0 },
            rc_work: Rect { left: 0, top: 0, right: 0, bottom: 0 },
            flags: 0,
        };
        unsafe {
            if GetCursorPos(&mut point) == 0 {
                return None;
            }
            let monitor = MonitorFromPoint(point, 2); // MONITOR_DEFAULTTONEAREST
            if GetMonitorInfoW(monitor, &mut info) == 0 {
                return None;
            }
        }
        let work = info.rc_work;
        Some((
            work.left,
            work.top,
            (work.right - work.left).max(0) as u32,
            (work.bottom - work.top).max(0) as u32,
        ))
    }
}

fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn app_path() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os("HERDR_APP") {
        let path = PathBuf::from(path);
        if path.is_file() {
            return Some(path);
        }
    }
    #[cfg(windows)]
    {
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            let candidate = PathBuf::from(local).join("Programs").join("herdr-app").join("herdr-app.exe");
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    #[cfg(target_os = "macos")]
    {
        let candidate = PathBuf::from("/Applications/Herdr.app/Contents/MacOS/herdr-app");
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}
