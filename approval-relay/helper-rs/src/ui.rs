//! CPU 自绘的弹窗布局与绘制。
//! 所有坐标使用物理像素；设计尺寸按 scale 缩放，命中区域直接用于鼠标事件。

use crate::protocol::{OptionItem, Request};
use crate::state::{self, I18n};
use crate::theme::{blend, Theme};
use cosmic_text::{Attrs, Buffer, Color as TextColor, Family, FontSystem, Metrics, Shaping, SwashCache};
use std::collections::HashMap;
use std::time::Instant;
use tiny_skia::{Color, FillRule, Paint, PathBuilder, Pixmap, Rect, Transform};

const MARGIN: f32 = 22.0;
const ROW_GAP: f32 = 8.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Hit {
    Close,
    Option(usize),
    Submit,
    Ignore,
    Open,
    Translate,
    ScreenTranslate,
    ScreenRefresh,
    ScreenToggle,
    Input,
    Send,
    WizardPrev,
    WizardNext,
    KeyCap(usize),
}

#[derive(Debug, Clone, Default)]
pub struct WizardAnswer {
    pub selected: Vec<usize>,
    pub text: String,
}

pub struct Wizard {
    pub index: usize,
    pub answers: Vec<WizardAnswer>,
    pub cursor: usize,
}

pub struct Ui {
    pub font_system: FontSystem,
    pub swash: SwashCache,
    pub theme: Theme,
    pub i18n: I18n,
    pub request: Option<Request>,
    pub selected: Vec<usize>,
    pub other_active: bool,
    pub input: String,
    pub preedit: String,
    pub focus_input: bool,
    pub screen_expanded: bool,
    pub translation_visible: bool,
    pub translation_text: String,
    pub translation_provider: String,
    pub option_translations: HashMap<String, String>,
    pub hint_translations: HashMap<String, String>,
    pub screen_translated: bool,
    pub screen_translation: String,
    pub message: Option<(String, Instant)>,
    pub busy: bool,
    pub hover: Option<Hit>,
    pub hits: Vec<(Rect, Hit)>,
    pub wizard: Option<Wizard>,
    pub translate_loading: bool,
    pub screen_translate_loading: bool,
    pub cursor: usize,
    pub pending_count: usize,
}

impl Ui {
    pub fn new(theme: Theme, i18n: I18n) -> Self {
        let mut font_system = FontSystem::new();
        for path in state::cjk_fonts().iter().chain(state::symbol_fonts().iter()) {
            if path.is_file() {
                let _ = font_system.db_mut().load_font_file(path);
            }
        }
        Self {
            font_system,
            swash: SwashCache::new(),
            theme,
            i18n,
            request: None,
            selected: Vec::new(),
            other_active: false,
            input: String::new(),
            preedit: String::new(),
            focus_input: false,
            screen_expanded: false,
            translation_visible: false,
            translation_text: String::new(),
            translation_provider: String::new(),
            option_translations: HashMap::new(),
            hint_translations: HashMap::new(),
            screen_translated: false,
            screen_translation: String::new(),
            message: None,
            busy: false,
            hover: None,
            hits: Vec::new(),
            wizard: None,
            translate_loading: false,
            screen_translate_loading: false,
            cursor: usize::MAX,
            pending_count: 0,
        }
    }

    pub fn set_request(&mut self, request: Request, lang: &str) {
        self.i18n.set_lang(lang);
        let wizard = if request.multi_question && !request.questions.is_empty() {
            Some(Wizard {
                index: 0,
                answers: request
                    .questions
                    .iter()
                    .map(|_| WizardAnswer {
                        selected: Vec::new(),
                        text: String::new(),
                    })
                    .collect(),
                cursor: usize::MAX,
            })
        } else {
            None
        };
        self.wizard = wizard;
        self.selected = request
            .options
            .iter()
            .enumerate()
            .filter(|(_, option)| option.selected)
            .map(|(index, _)| index)
            .collect();
        // 初始不聚焦任何选项：用户必须自己点击、按数字或方向键后再确认。
        self.cursor = usize::MAX;
        self.request = Some(request);
        self.other_active = false;
        self.input.clear();
        self.preedit.clear();
        self.focus_input = false;
        self.screen_expanded = false;
        self.translation_visible = false;
        self.translation_text.clear();
        self.translation_provider.clear();
        self.option_translations.clear();
        self.hint_translations.clear();
        self.screen_translated = false;
        self.screen_translation.clear();
        self.message = None;
        self.busy = false;
    }

    pub fn clear_request(&mut self) {
        self.request = None;
        self.selected.clear();
        self.other_active = false;
        self.input.clear();
        self.preedit.clear();
        self.focus_input = false;
        self.wizard = None;
    }

    pub fn hit_at(&self, x: f32, y: f32) -> Option<Hit> {
        self.hits
            .iter()
            .rev()
            .find(|(rect, _)| x >= rect.left() && x <= rect.right() && y >= rect.top() && y <= rect.bottom())
            .map(|(_, hit)| *hit)
    }

    pub fn update_hover(&mut self, x: f32, y: f32) -> bool {
        let hit = self.hit_at(x, y);
        if hit != self.hover {
            self.hover = hit;
            true
        } else {
            false
        }
    }

    pub fn current_options(&self) -> Vec<OptionItem> {
        if let Some(wizard) = &self.wizard {
            return self
                .request
                .as_ref()
                .and_then(|request| request.questions.get(wizard.index))
                .map(|question| question.options.clone())
                .unwrap_or_default();
        }
        self.request.as_ref().map(|request| request.options.clone()).unwrap_or_default()
    }

    pub fn current_multi(&self) -> bool {
        if let Some(wizard) = &self.wizard {
            return self
                .request
                .as_ref()
                .and_then(|request| request.questions.get(wizard.index))
                .map(|question| question.multi)
                .unwrap_or(false);
        }
        self.request.as_ref().map(|request| request.multi).unwrap_or(false)
    }

    pub fn draw(&mut self, pixmap: &mut Pixmap, scale: f32) -> f32 {
        self.hits.clear();
        let sc = |v: f32| v * scale;
        let width = pixmap.width() as f32;
        let inner_width = width - sc(MARGIN * 2.0);
        // 整窗铺满不透明底色：softbuffer 在 Windows/macOS 上会丢弃 alpha，
        // 若只画圆角，四角会以透明像素的形式变成黑块。圆角交给系统窗口裁剪。
        let surface = self.theme.surface;
        pixmap.fill(surface);

        let mut y = sc(MARGIN);
        let theme = self.theme;
        let Some(request) = self.request.clone() else {
            self.text(pixmap, &self.i18n.t("panel.empty"), sc(MARGIN), y, inner_width, sc(14.0), theme.muted, false);
            return sc(MARGIN * 2.0) + sc(24.0);
        };

        // 顶部：需要你 + 应用名 + 等待时长 + 关闭
        let chip_text = self.i18n.t("popup.needYou");
        let chip_w = self.measure(&chip_text, sc(12.0), false) + sc(16.0);
        fill_round(pixmap, Rect::from_xywh(sc(MARGIN), y, chip_w, sc(22.0)).unwrap(), sc(6.0), theme.blocked);
        self.text(pixmap, &chip_text, sc(MARGIN + 8.0), y + sc(5.0), chip_w, sc(12.0), Color::WHITE, false);
        let title = display_app(request.app.as_deref().unwrap_or(""));
        self.text(pixmap, &title, sc(MARGIN) + chip_w + sc(10.0), y, inner_width - chip_w - sc(50.0), sc(17.0), theme.foreground, false);
        let wait = wait_text(self.i18n.lang.as_str(), now_millis().saturating_sub(request.created) / 1000);
        let wait_w = self.measure(&wait, sc(11.0), false);
        let mut right = sc(MARGIN) + inner_width - sc(32.0);
        right -= wait_w;
        self.text(pixmap, &wait, right, y + sc(3.0), wait_w, sc(11.0), theme.muted, false);
        if self.pending_count > 1 {
            let queue = self.i18n.tf("popup.queue", &[("{n}", &(self.pending_count - 1).to_string())]);
            let queue_w = self.measure(&queue, sc(11.0), false);
            right -= queue_w + sc(10.0);
            self.text(pixmap, &queue, right, y + sc(3.0), queue_w, sc(11.0), theme.accent, false);
        }
        let close = Rect::from_xywh(sc(MARGIN) + inner_width - sc(24.0), y - sc(2.0), sc(24.0), sc(24.0)).unwrap();
        let close_hover = self.hover == Some(Hit::Close);
        if close_hover {
            fill_round(pixmap, close, sc(5.0), theme.raised);
        }
        self.text(pixmap, "×", close.left() + sc(7.0), close.top() + sc(1.0), sc(16.0), sc(15.0), theme.muted, false);
        self.hits.push((close, Hit::Close));
        y += sc(30.0);

        // 空间 / 标签 / 终端 chips
        let mut cx = sc(MARGIN);
        for (label, value) in [
            (self.i18n.t("popup.space"), request.space.clone()),
            (self.i18n.t("popup.tab"), request.tab.clone()),
            (self.i18n.t("popup.terminal"), Some(request.address.clone())),
        ] {
            let Some(value) = value.filter(|value| !value.is_empty()) else {
                continue;
            };
            let text = format!("{label}  {value}");
            let w = self.measure(&text, sc(11.0), false) + sc(14.0);
            if cx + w > sc(MARGIN) + inner_width {
                break;
            }
            fill_round(pixmap, Rect::from_xywh(cx, y, w, sc(20.0)).unwrap(), sc(5.0), theme.raised);
            self.text(pixmap, &text, cx + sc(7.0), y + sc(4.0), w, sc(11.0), theme.muted, false);
            cx += w + sc(6.0);
        }
        if cx > sc(MARGIN) {
            y += sc(26.0);
        }

        // 页签
        if !request.tabs.is_empty() {
            let mut tx = sc(MARGIN);
            for (index, tab) in request.tabs.iter().enumerate() {
                let mark = if index == request.current_tab {
                    "●"
                } else if tab.answered {
                    "✔"
                } else {
                    "○"
                };
                let text = format!("{mark} {}", tab.label);
                let color = if index == request.current_tab { theme.accent } else { theme.muted };
                let w = self.measure(&text, sc(12.0), false);
                if tx + w > sc(MARGIN) + inner_width {
                    break;
                }
                self.text(pixmap, &text, tx, y, w, sc(12.0), color, false);
                tx += w + sc(14.0);
            }
            y += sc(24.0);
        }

        // 问题卡
        let question = self.question_text(&request);
        if !question.is_empty() {
            let text_h = self.wrap_height(&question, sc(15.0), inner_width - sc(28.0), false);
            let card_h = (text_h + sc(20.0)).max(sc(44.0));
            fill_round(pixmap, Rect::from_xywh(sc(MARGIN), y, inner_width, card_h).unwrap(), sc(7.0), theme.popover);
            fill_round(pixmap, Rect::from_xywh(sc(MARGIN), y + sc(10.0), sc(3.0), card_h - sc(20.0)).unwrap(), sc(1.5), theme.accent);
            self.text(pixmap, &question, sc(MARGIN + 14.0), y + sc(10.0), inner_width - sc(28.0), sc(15.0), theme.foreground, false);
            y += card_h + sc(8.0);
        }

        // 问题译文
        if self.translation_visible {
            let header = if self.translation_provider.is_empty() {
                self.i18n.t("translate.failed")
            } else {
                self.i18n.tf("translate.questionBy", &[("{p}", &self.translation_provider)])
            };
            self.text(pixmap, &header, sc(MARGIN), y, inner_width, sc(11.0), theme.accent, false);
            y += sc(18.0);
            let text = if self.translation_text.is_empty() {
                self.i18n.t("translate.loading")
            } else {
                self.translation_text.clone()
            };
            let text_w = inner_width - sc(24.0);
            let text = self.fit_text(&text, sc(13.5), text_w, sc(150.0) - sc(16.0), false);
            let h = self.wrap_height(&text, sc(13.5), text_w, false) + sc(16.0);
            fill_round(pixmap, Rect::from_xywh(sc(MARGIN), y, inner_width, h).unwrap(), sc(6.0), theme.popover);
            self.text(pixmap, &text, sc(MARGIN + 12.0), y + sc(8.0), text_w, sc(13.5), theme.foreground, false);
            y += h + sc(8.0);
        }

        // 终端内容卡
        let tbtn_y = y;
        let screen_title = self.i18n.t("popup.screen");
        self.text(pixmap, &screen_title, sc(MARGIN), tbtn_y, sc(100.0), sc(11.0), theme.dim, false);
        let mut bx = sc(MARGIN) + inner_width;
        let translate_label = if self.screen_translated {
            self.i18n.t("translate.hide")
        } else if self.screen_translate_loading {
            self.i18n.t("translate.loading")
        } else {
            self.i18n.t("popup.translateScreen")
        };
        let tw = self.measure(&translate_label, sc(11.5), false);
        bx -= tw;
        self.text(pixmap, &translate_label, bx, tbtn_y, tw, sc(11.5), theme.accent, false);
        self.hits.push((Rect::from_xywh(bx - sc(2.0), tbtn_y - sc(2.0), tw + sc(4.0), sc(18.0)).unwrap(), Hit::ScreenTranslate));
        bx -= sc(14.0);
        let refresh_label = self.i18n.t("popup.refresh");
        let rw = self.measure(&refresh_label, sc(11.5), false);
        bx -= rw;
        self.text(pixmap, &refresh_label, bx, tbtn_y, rw, sc(11.5), theme.muted, false);
        self.hits.push((Rect::from_xywh(bx - sc(2.0), tbtn_y - sc(2.0), rw + sc(4.0), sc(18.0)).unwrap(), Hit::ScreenRefresh));
        bx -= sc(14.0);
        let expand_label = if self.screen_expanded {
            self.i18n.t("popup.collapse")
        } else {
            self.i18n.t("popup.expand")
        };
        let ew = self.measure(&expand_label, sc(11.5), false);
        bx -= ew;
        self.text(pixmap, &expand_label, bx, tbtn_y, ew, sc(11.5), theme.muted, false);
        self.hits.push((Rect::from_xywh(bx - sc(2.0), tbtn_y - sc(2.0), ew + sc(4.0), sc(18.0)).unwrap(), Hit::ScreenToggle));
        y += sc(20.0);

        let lines: Vec<&str> = request.screen.lines().collect();
        let line_size = sc(12.0);
        let text_x = sc(MARGIN + 12.0);
        let text_w = inner_width - sc(24.0);

        if !self.screen_expanded {
            // 默认收起：整屏终端日志直接铺开会淹没问题本身，只给行数，需要时再展开。
            let count = lines.iter().filter(|line| !line.trim().is_empty()).count();
            let summary = self.i18n.tf("popup.screenLines", &[("{n}", &count.to_string())]);
            let h = sc(32.0);
            let rect = Rect::from_xywh(sc(MARGIN), y, inner_width, h).unwrap();
            fill_round(pixmap, rect, sc(8.0), theme.canvas);
            stroke_round(pixmap, rect, sc(8.0), blend(theme.border, theme.muted, 0.28));
            self.text(pixmap, &summary, text_x, y + sc(9.0), text_w, line_size, theme.dim, true);
            y += h + sc(8.0);
        } else {
            // 与 draw_text 的 Metrics 行高一致；实际高度还要算上长行折行后的行数。
            let line_h = line_size * 1.45;
            let max_h = sc(320.0);
            let padding = sc(20.0);
            let max_content_h = (max_h - padding).max(line_h);

            // 从末尾往前保留能放下的行。终端内容通常看最后几行，长行会被 draw_text 折行，
            // 所以不能用“逻辑行数”直接算卡片高度，否则文字会溢出卡片压到下面的选项上。
            let mut lo = 0usize;
            let mut hi = lines.len();
            let mut keep = 0usize;
            while lo <= hi {
                let mid = lo + (hi - lo) / 2;
                let body = if mid == 0 {
                    String::new()
                } else {
                    lines[lines.len() - mid..].join("\n")
                };
                let body_h = self.wrapped_h(&body, line_size, text_w, true);
                let omitted_h = if mid < lines.len() {
                    let dropped = lines.len() - mid;
                    let omitted = self.i18n.tf("popup.screenOmitted", &[("{n}", &dropped.to_string())]);
                    self.wrapped_h(&omitted, line_size, text_w, true)
                } else {
                    0.0
                };
                if body_h + omitted_h <= max_content_h {
                    keep = mid;
                    lo = mid + 1;
                } else if mid == 0 {
                    break;
                } else {
                    hi = mid - 1;
                }
            }

            let dropped = lines.len() - keep;
            let omitted = if dropped > 0 {
                Some(self.i18n.tf("popup.screenOmitted", &[("{n}", &dropped.to_string())]))
            } else {
                None
            };
            let body = if keep == 0 {
                String::new()
            } else {
                lines[lines.len() - keep..].join("\n")
            };
            let omitted_h = omitted
                .as_ref()
                .map(|text| self.wrapped_h(text, line_size, text_w, true))
                .unwrap_or(0.0);
            let body_h = self.wrapped_h(&body, line_size, text_w, true);
            let screen_h = (body_h + omitted_h + padding).max(line_h + padding);
            let screen_rect = Rect::from_xywh(sc(MARGIN), y, inner_width, screen_h).unwrap();
            fill_round(pixmap, screen_rect, sc(8.0), theme.canvas);
            stroke_round(pixmap, screen_rect, sc(8.0), blend(theme.border, theme.muted, 0.28));
            let text_y = y + sc(10.0);
            let mut body_y = text_y;
            if let Some(omitted) = &omitted {
                self.text(pixmap, omitted, text_x, body_y, text_w, line_size, theme.dim, true);
                body_y += omitted_h;
            }
            self.text(
                pixmap,
                &body,
                text_x,
                body_y,
                text_w,
                line_size,
                blend(theme.muted, theme.foreground, 0.22),
                true,
            );
            y += screen_h + sc(8.0);
        }

        if self.screen_translated && !self.screen_translation.trim().is_empty() {
            let header = if self.translation_provider.is_empty() {
                self.i18n.t("popup.screenTranslated")
            } else {
                self.i18n.tf("translate.by", &[("{p}", &self.translation_provider)])
            };
            self.text(pixmap, &header, sc(MARGIN), y, inner_width, sc(11.0), theme.accent, false);
            y += sc(18.0);
            let screen_translation = self.screen_translation.clone();
            let text_w = inner_width - sc(24.0);
            let screen_translation =
                self.fit_text(&screen_translation, sc(13.0), text_w, sc(160.0) - sc(14.0), false);
            let h = self.wrap_height(&screen_translation, sc(13.0), text_w, false) + sc(14.0);
            fill_round(pixmap, Rect::from_xywh(sc(MARGIN), y, inner_width, h).unwrap(), sc(6.0), theme.canvas);
            self.text(pixmap, &screen_translation, sc(MARGIN + 12.0), y + sc(6.0), text_w, sc(13.0), theme.foreground, false);
            y += h + sc(8.0);
        }

        // 分隔线
        fill_round(pixmap, Rect::from_xywh(sc(MARGIN), y, inner_width, sc(1.0)).unwrap(), 0.0, theme.border);
        y += sc(10.0);

        // 选项标题
        let mode = if self.current_multi() {
            self.i18n.t("popup.modeMulti")
        } else {
            self.i18n.t("popup.modeSingle")
        };
        let options_title = if let Some(wizard) = &self.wizard {
            let index = (wizard.index + 1).to_string();
            let count = request.questions.len().to_string();
            format!("{}  ·  {mode}", self.i18n.tf("popup.wizardQuestion", &[("{i}", &index), ("{n}", &count)]))
        } else {
            format!("{}  ·  {mode}", self.i18n.t("popup.choose"))
        };
        self.text(pixmap, &options_title, sc(MARGIN), y, inner_width, sc(11.0), theme.dim, false);
        let translate_label = if self.translation_visible {
            self.i18n.t("translate.hide")
        } else {
            self.i18n.t("translate.button")
        };
        let trw = self.measure(&translate_label, sc(11.0), false);
        let trx = sc(MARGIN) + inner_width - trw;
        self.text(pixmap, &translate_label, trx, y, trw, sc(11.0), theme.accent, false);
        self.hits.push((Rect::from_xywh(trx - sc(3.0), y - sc(2.0), trw + sc(6.0), sc(18.0)).unwrap(), Hit::Translate));
        y += sc(22.0);

        let options = self.current_options();
        if !options.is_empty() {
            for (index, option) in options.iter().enumerate() {
                let height = self.option_row(pixmap, index, option, sc, y, inner_width);
                y += height + sc(ROW_GAP);
            }
        } else if request.kind != "text" {
            y = self.key_caps(pixmap, y, sc, inner_width);
        }

        // 输入卡
        let input_visible = self.other_active
            || (request.kind == "text" && !request.multi_question)
            || (self.wizard.is_some() && self.wizard_input_needed());
        if input_visible {
            fill_round(pixmap, Rect::from_xywh(sc(MARGIN), y, inner_width, sc(1.0)).unwrap(), 0.0, theme.border);
            y += sc(8.0);
            let field = Rect::from_xywh(sc(MARGIN), y, inner_width - sc(74.0), sc(32.0)).unwrap();
            fill_round(pixmap, field, sc(5.0), theme.raised);
            let hint = if self.other_active {
                self.i18n.t("popup.placeholderOther")
            } else {
                self.i18n.t("popup.placeholder")
            };
            let shown = if self.input.is_empty() && self.preedit.is_empty() {
                hint
            } else {
                format!("{}{}", self.input, self.preedit)
            };
            let field_w = (field.width() - sc(20.0)).max(sc(1.0));
            let shown = self.tail_fit(&shown, sc(13.5), field_w);
            let color = if self.input.is_empty() && self.preedit.is_empty() { theme.dim } else { theme.foreground };
            self.text(pixmap, &shown, field.left() + sc(10.0), y + sc(8.0), field_w, sc(13.5), color, false);
            if self.focus_input {
                let measured = self.measure(&self.input.clone(), sc(13.5), false);
                let caret_x = (field.left() + sc(10.0) + measured).min(field.right() - sc(2.0));
                fill_round(pixmap, Rect::from_xywh(caret_x, y + sc(8.0), sc(1.0), sc(16.0)).unwrap(), 0.0, theme.accent);
            }
            self.hits.push((field, Hit::Input));
            let send_label = self.i18n.t("popup.send");
            let sw = self.measure(&send_label, sc(12.0), false) + sc(20.0);
            let send = Rect::from_xywh(field.right() + sc(8.0), y + sc(2.0), sw, sc(28.0)).unwrap();
            fill_round(pixmap, send, sc(5.0), theme.accent);
            self.text(pixmap, &send_label, send.left() + sc(10.0), y + sc(8.0), sw, sc(12.0), theme.accent_fg, false);
            self.hits.push((send, Hit::Send));
            y += sc(40.0);
        }

        if let Some((message, at)) = self.message.clone() {
            if at.elapsed().as_secs() < 8 {
                self.text(pixmap, &message, sc(MARGIN), y, inner_width, sc(11.0), theme.blocked, false);
                y += sc(18.0);
            }
        }

        // 底部分隔线 + 操作
        fill_round(pixmap, Rect::from_xywh(sc(MARGIN), y, inner_width, sc(1.0)).unwrap(), 0.0, theme.border);
        y += sc(10.0);
        let mut right = sc(MARGIN) + inner_width;
        let ignore = self.i18n.t("popup.ignore");
        let iw = self.measure(&ignore, sc(12.0), false);
        right -= iw;
        self.text(pixmap, &ignore, right, y, iw, sc(12.0), theme.dim, false);
        self.hits.push((Rect::from_xywh(right - sc(3.0), y - sc(2.0), iw + sc(6.0), sc(20.0)).unwrap(), Hit::Ignore));
        right -= sc(14.0);
        let open = self.i18n.t("popup.open");
        let ow = self.measure(&open, sc(12.0), false);
        right -= ow;
        self.text(pixmap, &open, right, y, ow, sc(12.0), theme.muted, false);
        self.hits.push((Rect::from_xywh(right - sc(3.0), y - sc(2.0), ow + sc(6.0), sc(20.0)).unwrap(), Hit::Open));

        if self.wizard.is_some() {
            right -= sc(14.0);
            let next = if self
                .wizard
                .as_ref()
                .map(|wizard| wizard.index + 1 >= request.questions.len())
                .unwrap_or(false)
            {
                self.i18n.t("popup.wizardSubmit")
            } else {
                self.i18n.t("popup.wizardNext")
            };
            let nw = self.measure(&next, sc(12.0), false);
            right -= nw;
            self.text(pixmap, &next, right, y, nw, sc(12.0), theme.accent, false);
            self.hits.push((Rect::from_xywh(right - sc(3.0), y - sc(2.0), nw + sc(6.0), sc(20.0)).unwrap(), Hit::WizardNext));
            if self.wizard.as_ref().map(|wizard| wizard.index > 0).unwrap_or(false) {
                right -= sc(14.0);
                let prev = self.i18n.t("popup.wizardPrev");
                let pw = self.measure(&prev, sc(12.0), false);
                right -= pw;
                self.text(pixmap, &prev, right, y, pw, sc(12.0), theme.muted, false);
                self.hits.push((Rect::from_xywh(right - sc(3.0), y - sc(2.0), pw + sc(6.0), sc(20.0)).unwrap(), Hit::WizardPrev));
            }
        } else if request.multi {
            right -= sc(16.0);
            let submit = self.i18n.t("popup.submit");
            let sw = self.measure(&submit, sc(12.0), false) + sc(20.0);
            right -= sw;
            let button = Rect::from_xywh(right, y - sc(3.0), sw, sc(26.0)).unwrap();
            fill_round(pixmap, button, sc(5.0), theme.accent);
            self.text(pixmap, &submit, right + sc(10.0), y + sc(3.0), sw, sc(12.0), theme.accent_fg, false);
            self.hits.push((button, Hit::Submit));
        }

        // 左侧提示
        let hint = if self.wizard.is_some() {
            self.i18n.t("popup.hintWizard")
        } else if request.multi {
            self.i18n.t("popup.hintMultiSelect")
        } else if !options.is_empty() {
            self.i18n.t("popup.hintDefaults")
        } else if request.kind == "text" {
            self.i18n.t("popup.hintText")
        } else {
            self.i18n.t("popup.hintGeneric")
        };
        self.text(pixmap, &hint, sc(MARGIN), y, right - sc(MARGIN) - sc(8.0), sc(10.5), theme.muted, false);
        y += sc(28.0);

        y + sc(MARGIN)
    }

    fn option_row(&mut self, pixmap: &mut Pixmap, index: usize, option: &OptionItem, sc: impl Fn(f32) -> f32, y: f32, width: f32) -> f32 {
        let theme = self.theme;
        // 单选不预选终端里的光标项：用户没点之前所有选项保持中性，避免误触 Enter 直接提交。
        let selected = if self.wizard.is_some() {
            self.wizard_selects(index).unwrap_or(false)
        } else if self.current_multi() {
            self.selected.contains(&index)
        } else {
            false
        };
        let hovered = self.hover == Some(Hit::Option(index));
        let focused = self.hover.is_none() && self.cursor == index;

        // 选项说明可能很长；先按实际换行后的高度算行高，否则文字会压到下一行。
        let label = strip_number(&option.label);
        let label = self.option_translations.get(&label).cloned().unwrap_or(label);
        let hint = self
            .hint_translations
            .get(&option.hint)
            .cloned()
            .unwrap_or_else(|| option.hint.clone());
        let has_hint = !hint.trim().is_empty();
        let text_w = (width - sc(80.0)).max(sc(40.0));
        let label_h = self.wrap_height(&label, sc(14.0), text_w, false);
        let hint_h = if has_hint { self.wrap_height(&hint, sc(11.0), text_w, false) } else { 0.0 };
        let pad = sc(8.0);
        let gap = sc(3.0);
        let content_h = label_h + if has_hint { gap + hint_h } else { 0.0 };
        let height = (content_h + pad * 2.0).max(sc(42.0));

        let rect = Rect::from_xywh(sc(MARGIN), y, width, height).unwrap();
        let fill = if selected {
            blend(theme.accent, theme.raised, 0.16)
        } else if hovered {
            blend(theme.raised, theme.foreground, 0.07)
        } else {
            theme.raised
        };
        let border = if selected {
            theme.accent
        } else if hovered {
            blend(theme.border, theme.muted, 0.55)
        } else if focused {
            blend(theme.border, theme.accent, 0.45)
        } else {
            theme.border
        };
        fill_round(pixmap, rect, sc(9.0), fill);
        stroke_round(pixmap, rect, sc(9.0), border);

        let badge = Rect::from_xywh(rect.left() + sc(12.0), rect.top() + (height - sc(22.0)) / 2.0, sc(22.0), sc(22.0)).unwrap();
        fill_round(pixmap, badge, sc(11.0), if selected { theme.accent } else { theme.popover });
        let badge_text = option
            .keys
            .first()
            .map(|key| key.to_uppercase())
            .unwrap_or_else(|| (index + 1).to_string());
        let bw = self.measure(&badge_text, sc(11.0), false);
        self.text(
            pixmap,
            &badge_text,
            badge.left() + (badge.width() - bw) / 2.0,
            badge.top() + sc(5.0),
            sc(22.0),
            sc(11.0),
            if selected { theme.accent_fg } else { theme.foreground },
            false,
        );

        let primary = if selected { theme.accent_fg } else { theme.foreground };
        let secondary = if selected { blend(theme.accent_fg, theme.accent, 0.22) } else { theme.muted };
        let label_y = if has_hint { rect.top() + pad } else { rect.top() + (height - label_h) / 2.0 };
        self.text(pixmap, &label, rect.left() + sc(46.0), label_y, text_w, sc(14.0), primary, false);
        if has_hint {
            let hint_y = label_y + label_h + gap;
            self.text(pixmap, &hint, rect.left() + sc(46.0), hint_y, text_w, sc(11.0), secondary, false);
        }
        let mark = if self.current_multi() {
            if selected { "✓".to_string() } else { "☐".to_string() }
        } else if selected {
            "✓".to_string()
        } else {
            String::new()
        };
        let mw = self.measure(&mark, sc(11.0), false);
        self.text(pixmap, &mark, rect.right() - sc(12.0) - mw, rect.top() + (height - sc(16.0)) / 2.0, mw, sc(11.0), secondary, false);
        self.hits.push((rect, Hit::Option(index)));
        height
    }

    fn key_caps(&mut self, pixmap: &mut Pixmap, mut y: f32, sc: impl Fn(f32) -> f32, width: f32) -> f32 {
        let caps = [("Enter", "enter"), ("Esc", "esc"), ("↑", "up"), ("↓", "down"), ("Tab", "tab"), ("1", "1"), ("2", "2"), ("3", "3"), ("Y", "y"), ("N", "n")];
        let theme = self.theme;
        let mut x = sc(MARGIN);
        for (index, (label, _)) in caps.iter().enumerate() {
            let w = self.measure(label, sc(12.0), false) + sc(18.0);
            if x + w > sc(MARGIN) + width {
                x = sc(MARGIN);
                y += sc(36.0);
            }
            let rect = Rect::from_xywh(x, y, w, sc(28.0)).unwrap();
            let hovered = self.hover == Some(Hit::KeyCap(index));
            fill_round(pixmap, rect, sc(5.0), if hovered { blend(theme.accent, theme.raised, 0.16) } else { theme.raised });
            self.text(pixmap, label, x + sc(9.0), y + sc(6.0), w, sc(12.0), theme.muted, false);
            self.hits.push((rect, Hit::KeyCap(index)));
            x += w + sc(6.0);
        }
        y + sc(36.0)
    }

    fn wizard_selects(&self, index: usize) -> Option<bool> {
        let wizard = self.wizard.as_ref()?;
        let answer = wizard.answers.get(wizard.index)?;
        Some(answer.selected.contains(&index))
    }

    fn wizard_input_needed(&self) -> bool {
        let Some(wizard) = &self.wizard else { return false };
        let Some(request) = &self.request else { return false };
        let Some(question) = request.questions.get(wizard.index) else { return false };
        let Some(answer) = wizard.answers.get(wizard.index) else { return false };
        question
            .options
            .iter()
            .position(|option| option.other)
            .map(|index| answer.selected.contains(&index))
            .unwrap_or(false)
    }

    pub fn question_text(&self, request: &Request) -> String {
        if let Some(wizard) = &self.wizard {
            if let Some(question) = request.questions.get(wizard.index) {
                return question.question.clone();
            }
        }
        if request.question.trim().is_empty() {
            request
                .tabs
                .get(request.current_tab)
                .map(|tab| tab.label.clone())
                .unwrap_or_else(|| self.i18n.t("popup.questionSection"))
        } else {
            request.question.clone()
        }
    }

    fn measure(&mut self, text: &str, size: f32, mono: bool) -> f32 {
        let mut buffer = Buffer::new(&mut self.font_system, Metrics::new(size, size * 1.4));
        buffer.set_size(&mut self.font_system, None, None);
        let attrs = if mono {
            Attrs::new().family(mono_family())
        } else {
            Attrs::new().family(Family::SansSerif)
        };
        buffer.set_text(&mut self.font_system, text, &attrs, Shaping::Advanced);
        buffer.shape_until_scroll(&mut self.font_system, false);
        let mut width: f32 = 0.0;
        for run in buffer.layout_runs() {
            width = width.max(run.line_w);
        }
        width
    }

    fn wrap_height(&mut self, text: &str, size: f32, width: f32, mono: bool) -> f32 {
        let mut buffer = Buffer::new(&mut self.font_system, Metrics::new(size, size * 1.45));
        buffer.set_size(&mut self.font_system, Some(width), None);
        let attrs = if mono {
            Attrs::new().family(mono_family())
        } else {
            Attrs::new().family(Family::SansSerif)
        };
        buffer.set_text(&mut self.font_system, text, &attrs, Shaping::Advanced);
        buffer.shape_until_scroll(&mut self.font_system, false);
        let lines = buffer.layout_runs().count().max(1) as f32;
        lines * size * 1.45
    }

    fn wrapped_h(&mut self, text: &str, size: f32, width: f32, mono: bool) -> f32 {
        if text.is_empty() {
            0.0
        } else {
            self.wrap_height(text, size, width, mono)
        }
    }

    /// 把文本截到给定高度内，超出时在末尾加省略号。
    fn fit_text(&mut self, text: &str, size: f32, width: f32, max_height: f32, mono: bool) -> String {
        if text.is_empty() || self.wrap_height(text, size, width, mono) <= max_height {
            return text.to_string();
        }
        let chars: Vec<char> = text.chars().collect();
        let mut lo = 0usize;
        let mut hi = chars.len();
        while lo < hi {
            let mid = lo + (hi - lo + 1) / 2;
            let mut candidate: String = chars[..mid].iter().collect();
            candidate.push('…');
            if self.wrap_height(&candidate, size, width, mono) <= max_height {
                lo = mid;
            } else {
                hi = mid - 1;
            }
        }
        let mut out: String = chars[..lo].iter().collect();
        out.push('…');
        out
    }

    /// 单行输入框只显示末尾，避免长文本折行压到发送按钮。
    fn tail_fit(&mut self, text: &str, size: f32, width: f32) -> String {
        if text.is_empty() || width <= 1.0 || self.measure(text, size, false) <= width {
            return text.to_string();
        }
        let chars: Vec<char> = text.chars().collect();
        let mut lo = 0usize;
        let mut hi = chars.len();
        while lo < hi {
            let mid = lo + (hi - lo) / 2;
            let mut candidate = String::from("…");
            candidate.extend(chars[mid..].iter());
            if self.measure(&candidate, size, false) <= width {
                hi = mid;
            } else {
                lo = mid + 1;
            }
        }
        let mut out = String::from("…");
        out.extend(chars[lo..].iter());
        if self.measure(&out, size, false) > width {
            return "…".to_string();
        }
        out
    }

    fn text(&mut self, pixmap: &mut Pixmap, text: &str, x: f32, y: f32, max_width: f32, size: f32, color: Color, mono: bool) {
        draw_text(
            pixmap,
            &mut self.font_system,
            &mut self.swash,
            text,
            x,
            y,
            max_width.max(0.0),
            size,
            color,
            mono,
        );
    }
}

// fontdb 的通用 monospace 在 Windows 上会落到 Courier New：细、带衬线，小字号发虚。
// 显式指定平台自带的现代等宽字体，缺字时仍由 cosmic-text 的 fallback 兜底。
fn mono_family() -> Family<'static> {
    #[cfg(windows)]
    {
        Family::Name("Consolas")
    }
    #[cfg(target_os = "macos")]
    {
        Family::Name("Menlo")
    }
    #[cfg(all(not(windows), not(target_os = "macos")))]
    {
        Family::Monospace
    }
}

fn draw_text(
    pixmap: &mut Pixmap,
    font_system: &mut FontSystem,
    swash: &mut SwashCache,
    text: &str,
    x: f32,
    y: f32,
    max_width: f32,
    size: f32,
    color: Color,
    mono: bool,
) {
    if text.is_empty() || max_width <= 1.0 {
        return;
    }
    let mut buffer = Buffer::new(font_system, Metrics::new(size, size * 1.45));
    buffer.set_size(font_system, Some(max_width), None);
    let attrs = if mono {
        Attrs::new().family(mono_family())
    } else {
        Attrs::new().family(Family::SansSerif)
    };
    buffer.set_text(font_system, text, &attrs, Shaping::Advanced);
    buffer.shape_until_scroll(font_system, false);
    let tcolor = TextColor::rgb((color.red() * 255.0) as u8, (color.green() * 255.0) as u8, (color.blue() * 255.0) as u8);
    let width = pixmap.width() as i32;
    let height = pixmap.height() as i32;
    let data = pixmap.data_mut();
    // 小数坐标直接截断会让字形整体偏左/偏上半个像素，取整后再落点。
    let origin_x = x.round() as i32;
    let origin_y = y.round() as i32;
    buffer.draw(font_system, swash, tcolor, |gx, gy, gw, gh, pixel| {
        let alpha = pixel.a();
        if alpha == 0 {
            return;
        }
        let px = origin_x + gx;
        let py = origin_y + gy;
        for row in 0..gh as i32 {
            let yy = py + row;
            if yy < 0 || yy >= height {
                continue;
            }
            for col in 0..gw as i32 {
                let xx = px + col;
                if xx < 0 || xx >= width {
                    continue;
                }
                let index = ((yy * width + xx) * 4) as usize;
                let a = alpha as f32 / 255.0;
                let inv = 1.0 - a;
                let sr = (pixel.r() as f32) * a;
                let sg = (pixel.g() as f32) * a;
                let sb = (pixel.b() as f32) * a;
                data[index] = (sr + data[index] as f32 * inv).min(255.0) as u8;
                data[index + 1] = (sg + data[index + 1] as f32 * inv).min(255.0) as u8;
                data[index + 2] = (sb + data[index + 2] as f32 * inv).min(255.0) as u8;
                data[index + 3] = (a * 255.0 + data[index + 3] as f32 * inv).min(255.0) as u8;
            }
        }
    });
}

fn fill_round(pixmap: &mut Pixmap, rect: Rect, radius: f32, color: Color) {
    if color.alpha() <= 0.0 {
        return;
    }
    let Some(path) = round_path(rect, radius) else { return };
    let mut paint = Paint::default();
    paint.set_color(color);
    pixmap.fill_path(&path, &paint, FillRule::Winding, Transform::identity(), None);
}

fn stroke_round(pixmap: &mut Pixmap, rect: Rect, radius: f32, color: Color) {
    let Some(path) = round_path(rect, radius) else { return };
    let mut paint = Paint::default();
    paint.set_color(color);
    paint.anti_alias = true;
    let mut stroke = tiny_skia::Stroke::default();
    stroke.width = 1.0;
    pixmap.stroke_path(&path, &paint, &stroke, Transform::identity(), None);
}

fn round_path(rect: Rect, radius: f32) -> Option<tiny_skia::Path> {
    let r = radius.min(rect.width() / 2.0).min(rect.height() / 2.0).max(0.0);
    if r <= 0.0 {
        return Some(PathBuilder::from_rect(rect));
    }
    let mut pb = PathBuilder::new();
    pb.move_to(rect.left() + r, rect.top());
    pb.line_to(rect.right() - r, rect.top());
    pb.quad_to(rect.right(), rect.top(), rect.right(), rect.top() + r);
    pb.line_to(rect.right(), rect.bottom() - r);
    pb.quad_to(rect.right(), rect.bottom(), rect.right() - r, rect.bottom());
    pb.line_to(rect.left() + r, rect.bottom());
    pb.quad_to(rect.left(), rect.bottom(), rect.left(), rect.bottom() - r);
    pb.line_to(rect.left(), rect.top() + r);
    pb.quad_to(rect.left(), rect.top(), rect.left() + r, rect.top());
    pb.close();
    pb.finish()
}

pub fn strip_number(label: &str) -> String {
    let trimmed = label.trim_start();
    let mut chars = trimmed.chars().peekable();
    let mut digits = 0;
    while let Some(ch) = chars.peek() {
        if ch.is_ascii_digit() {
            digits += 1;
            chars.next();
        } else {
            break;
        }
    }
    if digits > 0 {
        if let Some(sep) = chars.peek() {
            if *sep == '.' || *sep == ')' {
                chars.next();
                if chars.peek() == Some(&' ') {
                    chars.next();
                }
                return chars.collect();
            }
        }
    }
    label.to_string()
}

fn display_app(app: &str) -> String {
    match app.to_lowercase().as_str() {
        "claude" => "Claude".to_string(),
        "codex" => "Codex".to_string(),
        "gemini" => "Gemini".to_string(),
        "opencode" | "open-code" => "OpenCode".to_string(),
        "omp" | "oh-my-pi" => "oh-my-pi".to_string(),
        "cursor" => "Cursor".to_string(),
        "" => "Agent".to_string(),
        _ => {
            let mut chars = app.chars();
            match chars.next() {
                Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
                None => "Agent".to_string(),
            }
        }
    }
}

fn wait_text(lang: &str, seconds: u64) -> String {
    if lang == "zh" {
        if seconds < 60 {
            format!("已等待 {seconds} 秒")
        } else {
            format!("已等待 {} 分 {} 秒", seconds / 60, seconds % 60)
        }
    } else if seconds < 60 {
        format!("Waiting {seconds}s")
    } else {
        format!("Waiting {}m {}s", seconds / 60, seconds % 60)
    }
}

fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}
