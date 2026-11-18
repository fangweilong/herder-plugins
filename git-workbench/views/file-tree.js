// 目录树行的公共渲染：目录行可折叠；文件行由各视图按自己的信息画。

import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { fs } from "../text.js";

/** 目录收起状态的键；scope 用来区分不同分组/提交里的同名目录。 */
function collapseKey(scope, path) {
  return `${scope}\0${path}`;
}

/** 目录是否处于收起状态。 */
export function isDirCollapsed(collapsed, scope, path) {
  return Boolean(collapsed[collapseKey(scope, path)]);
}

/** 反转目录的收起状态并重绘。 */
export function toggleDir(collapsed, scope, path, cx) {
  const key = collapseKey(scope, path);
  if (collapsed[key]) delete collapsed[key];
  else collapsed[key] = true;
  cx.notify();
}

/**
 * 目录行：展开箭头、目录名与文件数，整行可点击。
 * @param {string} idPrefix 元素 id 前缀，同一窗口里的多棵树各自唯一。
 * @param {{path: string, name: string, depth: number, count: number, collapsed: boolean}} row
 * @param {object} t 主题
 * @param {(path: string, cx: object) => void} onToggle
 * @param {{indent?: number, height?: number}} [options] indent 是 depth 0 的左内边距。
 */
export function dirRow(idPrefix, row, t, onToggle, options = {}) {
  const indent = options.indent ?? 6;
  return h_flex().id(`${idPrefix}-dir-${row.path}`).w_full().h(options.height ?? 24).flex_none().gap(5)
    .pl(indent + row.depth * 12).pr(8).items_center()
    .hover((style) => style.bg(t.hover))
    .cursor_pointer()
    .on_click((_e, cx) => onToggle(row.path, cx))
    .child(div().w(10).flex_none().text_size(fs(10)).text_color(t.dim).child(row.collapsed ? "▸" : "▾"))
    .child(div().flex_1().min_w(0).truncate().text_size(fs(12)).text_color(t.muted).child(row.name))
    .child(div().flex_none().text_size(fs(10)).text_color(t.dim).child(String(row.count)))
    .tooltip(row.path);
}
