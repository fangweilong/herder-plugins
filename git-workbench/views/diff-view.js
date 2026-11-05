// 并排 diff 的渲染：把 hunk 展平成固定行高的虚拟列表。
// 每行左右各占一半，天然同步滚动；行内变更来自 diff.js 的词级配对。

import { div } from "gpui-kit";
import { h_flex, Scrollbar, v_virtual_list } from "gpui-base";
import { sideBySide } from "../diff.js";

export const ROW_H = 20;

/**
 * 把解析后的 diff 展平为渲染行：
 * { kind: "hunk", text } 或 { kind: "pair", left, right }。
 */
export function buildDiffRows(parsed) {
  const rows = [];
  for (const hunk of parsed?.hunks ?? []) {
    rows.push({ kind: "hunk", text: hunk.title });
    for (const pair of sideBySide(hunk)) rows.push({ kind: "pair", ...pair });
  }
  return rows;
}

/** 估算内容宽度，用于水平滚动。左右两栏各占一半，所以按两倍字符宽计算。 */
export function diffContentWidth(rows) {
  let max = 0;
  for (const row of rows) {
    if (row.kind === "hunk") continue;
    const length = Math.max(row.left?.text?.length ?? 0, row.right?.text?.length ?? 0);
    if (length > max) max = length;
  }
  return Math.max(600, max * 14.4 + 140);
}

function numberCell(no, t) {
  return div().w(38).flex_none().text_right().pr(6).text_size(10).text_color(t.dim).child(no == null ? "" : String(no));
}

function segments(side, t, tone) {
  if (!side.segments) return div().flex_1().min_w(0).truncate().child(side.text || " ");
  return h_flex().flex_1().min_w(0).overflow_hidden().children(
    side.segments.map((segment) =>
      div().when(segment.changed, (e) => e.bg(tone + "55").rounded(2)).child(segment.text || " ")),
  );
}

function cell(side, t, options) {
  // options: { bg, tone, borderLeft }
  const { bg, tone } = options;
  if (!side) {
    return h_flex().flex_1().min_w(0).h(ROW_H).bg(options.emptyBg ?? t.raised)
      .when(options.borderLeft, (e) => e.border_l(1).border_color(t.border))
      .child(div().w(38).flex_none());
  }
  return h_flex().flex_1().min_w(0).h(ROW_H).items_center()
    .when(Boolean(bg), (e) => e.bg(bg))
    .when(options.borderLeft, (e) => e.border_l(1).border_color(t.border))
    .child(numberCell(side.no, t))
    .child(segments(side, t, tone ?? t.accent));
}

function pairRow(row, t) {
  const leftKind = row.left?.kind;
  const rightKind = row.right?.kind;
  return h_flex().w_full().h(ROW_H).flex_none()
    .child(cell(row.left, t, {
      bg: leftKind === "del" ? t.ansi1 + "16" : null,
      tone: t.ansi1,
      emptyBg: t.raised,
    }))
    .child(cell(row.right, t, {
      bg: rightKind === "add" ? t.ansi2 + "16" : null,
      tone: t.ansi2,
      borderLeft: true,
      emptyBg: t.raised,
    }));
}

function hunkRow(text, t) {
  return h_flex().w_full().h(ROW_H).flex_none().px(8).items_center().bg(t.raised).border_y(1).border_color(t.border)
    .child(div().text_size(10).text_color(t.dim).truncate().child(text));
}

/**
 * 渲染 diff 主体。
 * @param {Array} rows buildDiffRows 的结果
 * @param {Record<string,string>} t 主题
 * @param {string} id 虚拟列表 id（每个视图唯一）
 * @param {number} contentWidth diffContentWidth 的结果
 */
export function renderDiff(rows, t, id, contentWidth, fontFamily = "monospace") {
  if (!rows.length) {
    return div().size_full().flex().items_center().justify_center()
      .child(div().text_size(12).text_color(t.dim).child("没有可显示的文本差异"));
  }
  return div().size_full().relative().font_family(fontFamily)
    // 横向滚动条常驻，避免只能靠触控板横滑才发现能左右看。
    .child(div().id(`${id}-x`).size_full().overflow_x_scrollbar().mode("always")
      .child(div().min_w(contentWidth).h_full().child(
        v_virtual_list(id, rows.length, ROW_H, (i) => String(i),
          (range) => rows.slice(range.start, range.end).map((row) =>
            row.kind === "hunk" ? hunkRow(row.text, t) : pairRow(row, t))).size_full())))
    .child(Scrollbar.vertical(id).viewport_from_layout().absolute().inset_0());
}

/**
 * 主区域左右分栏时的一侧行：hunk 标题两侧各画一遍，pair 只画自己那一半。
 * @param {{kind:string, text?:string, left?:object, right?:object}} row
 * @param {"left"|"right"} side
 */
export function paneRow(row, side, t) {
  if (row.kind === "hunk") {
    return h_flex().w_full().h(ROW_H).flex_none().px(8).items_center().bg(t.raised).border_y(1).border_color(t.border)
      .child(div().text_size(10).text_color(t.dim).truncate().child(row.text));
  }
  const cellSide = row[side];
  const tone = side === "left" ? t.ansi1 : t.ansi2;
  if (!cellSide) {
    return h_flex().w_full().h(ROW_H).flex_none().bg(t.raised)
      .child(div().w(38).flex_none())
      .child(div().flex_1().min_w(0));
  }
  return h_flex().w_full().h(ROW_H).flex_none().items_center()
    .when(cellSide.kind === (side === "left" ? "del" : "add"), (e) => e.bg(tone + "16"))
    .child(numberCell(cellSide.no, t))
    .child(segments(cellSide, t, tone));
}

/** 单侧内容宽度：行号列加最长的一行。 */
export function paneWidth(rows, side) {
  let max = 0;
  for (const row of rows) {
    if (row.kind === "hunk") continue;
    const length = row[side]?.text?.length ?? 0;
    if (length > max) max = length;
  }
  return Math.max(320, max * 7.2 + 70);
}

/** 文件 diff 头部条。 */
export function diffHeader(name, stats, t, right = null) {
  return h_flex().w_full().h(32).flex_none().px(10).gap(8).items_center().border_b(1).border_color(t.border).bg(t.chrome)
    .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.foreground).child(name))
    .when(stats && stats.add > 0, (e) => e.child(div().text_size(10).text_color(t.ansi2).child(`+${stats.add}`)))
    .when(stats && stats.del > 0, (e) => e.child(div().text_size(10).text_color(t.ansi1).child(`−${stats.del}`)))
    .when(Boolean(right), (e) => e.child(right));
}
