// 界面公共部件：按钮、标签、空状态、状态色。所有尺寸随窗口缩放，不依赖布局。

import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";

/** 文件状态色：A 绿、D 红、U 红、R 蓝、其他强调色。 */
export function statusColor(letter, t) {
  if (letter === "A") return t.ansi2;
  if (letter === "D" || letter === "U") return t.ansi1;
  if (letter === "R") return t.ansi4;
  return t.accent;
}

/** 可点击的文字按钮；按下时阻止窗口拖动。 */
export function textButton(id, label, t, onClick, options = {}) {
  const { primary = false, danger = false, disabled = false, small = false, active = false, title = null } = options;
  const bg = disabled ? t.raised : primary ? t.solid : active ? t.selected : t.raised;
  const fg = disabled ? t.dim : primary ? t.solid_foreground : danger ? t.ansi1 : active ? t.foreground : t.muted;
  let el = h_flex()
    .id(id)
    .h(small ? 24 : 28)
    .px(small ? 8 : 10)
    .items_center()
    .justify_center()
    .rounded(7)
    .bg(bg)
    .text_color(fg)
    .text_size(small ? 11 : 12)
    .when(!disabled, (e) => e.cursor_pointer().hover((s) => s.bg(primary ? t.solid : active ? t.hover : t.hover)))
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .when(!disabled && onClick, (e) => e.on_click((_e, cx) => onClick(cx)))
    .child(label);
  if (title) el = el.tooltip(title);
  return el;
}

/** 小圆点 + 文本的标签。 */
export function chip(text, color, t, options = {}) {
  return h_flex()
    .h(20)
    .px(6)
    .items_center()
    .rounded(5)
    .bg(options.bg ?? t.raised)
    .border_1()
    .border_color(options.border ?? t.border)
    .text_color(color)
    .text_size(10)
    .when(options.truncate, (e) => e.max_w(140).truncate())
    .child(text);
}

/** 分组标题。 */
export function sectionTitle(label, t, right = null) {
  const row = h_flex().w_full().h(26).flex_none().px(10).items_center().gap(6)
    .child(div().text_size(10).font_semibold().text_color(t.dim).child(label.toUpperCase()))
    .child(div().flex_1());
  if (right) row.child(right);
  return row;
}

/** 居中空状态。 */
export function emptyState(title, hint, t) {
  return v_flex().size_full().items_center().justify_center().gap(6).p(24)
    .child(div().text_size(13).text_color(t.muted).child(title))
    .when(Boolean(hint), (e) => e.child(div().text_size(11).text_color(t.dim).child(hint)));
}

/** 错误条。 */
export function errorBar(text, t) {
  return h_flex().w_full().flex_none().px(10).py(6).gap(6).items_center().bg(t.ansi1 + "14").border_b(1).border_color(t.border)
    .child(div().text_size(11).text_color(t.ansi1).child(text));
}

/** 把长路径压成 "父目录/文件名"，父目录省略到两段。 */
export function shortPath(path, max = 48) {
  const parts = String(path ?? "").split("/");
  if (parts.length <= 2) return path;
  const head = parts.slice(0, -1);
  const tail = parts[parts.length - 1];
  let parent = head.slice(-2).join("/");
  if (head.length > 2) parent = `…/${parent}`;
  const out = `${parent}/${tail}`;
  return out.length > max ? `…/${tail}` : out;
}

/** 数字增减的紧凑显示。 */
export function addDel(add, del, t) {
  return h_flex().gap(5).items_center()
    .when(add > 0, (e) => e.child(div().text_size(10).text_color(t.ansi2).child(`+${add}`)))
    .when(del > 0, (e) => e.child(div().text_size(10).text_color(t.ansi1).child(`−${del}`)));
}

