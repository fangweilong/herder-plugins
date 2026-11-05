// Blame：逐行显示提交、作者与时间；点击一行跳到该提交。

import { div } from "gpui-kit";
import { h_flex, v_flex, Input, InputState } from "gpui-base";
import { settings } from "herdr";
import * as git from "../git.js";
import { relativeTime } from "../git-parse.js";
import { emptyState, errorBar, textButton } from "../ui.js";

const FILE_ROWS = 300;
// 逐行渲染整个文件会撞上元素数量上限（约两千行时渲染被中断），按页显示。
const PAGE_ROWS = 400;

export function createBlameState() {
  return {
    path: "",
    rev: InputState.new({ placeholder: "留空表示工作区，或填提交/branch" }),
    filter: InputState.new({ placeholder: "搜索文件" }),
    files: [],
    filesLoading: false,
    filesError: "",
    open: false,
    lines: [],
    page: 0,
    loading: false,
    error: "",
    note: "",
    token: 0,
  };
}

export function ensureBlame(v, cx) {
  ensureFiles(v, cx);
  if (v.blame.lines.length || v.blame.loading) return;
  if (v.blame.path) loadBlame(v, cx);
}

/** 从其他视图跳转过来：带入文件路径并立即加载。 */
export function showBlame(v, path, cx, rev = "") {
  v.view = "blame";
  v.blame.path = path;
  v.blame.rev.set_value(rev);
  ensureFiles(v, cx);
  loadBlame(v, cx);
  cx.notify();
}

function ensureFiles(v, cx) {
  const state = v.blame;
  if (state.files.length || state.filesLoading || !v.repo) return;
  state.filesLoading = true;
  state.filesError = "";
  const root = v.repo.root;
  const on = v.repo.on;
  cx.spawn(async (cx) => {
    const result = await git.loadFiles(root, on);
    if (v.repo?.root !== root) return;
    state.filesLoading = false;
    if (result.ok) state.files = result.files;
    else state.filesError = result.err;
    cx.notify();
  });
}

export function loadBlame(v, cx) {
  if (!v.repo) return;
  const state = v.blame;
  const path = state.path.trim();
  const rev = state.rev.value().trim();
  if (!path) {
    state.note = "请选择文件";
    cx.notify();
    return;
  }
  const root = v.repo.root;
  const on = v.repo.on;
  const token = ++state.token;
  state.loading = true;
  state.error = "";
  state.note = "";
  cx.notify();
  cx.spawn(async (cx) => {
    const result = await git.loadBlame(root, on, path, 5000, rev);
    if (token !== state.token || v.repo?.root !== root) return;
    state.loading = false;
    state.page = 0;
    if (!result.ok) {
      state.error = result.err;
      state.lines = [];
    } else {
      state.lines = result.lines;
    }
    cx.notify();
  });
}

function chooseFile(v, path, cx) {
  const state = v.blame;
  state.path = path;
  state.open = false;
  state.filter.set_value("");
  loadBlame(v, cx);
}

function openPicker(v, cx) {
  const state = v.blame;
  state.open = !state.open;
  if (state.open) ensureFiles(v, cx);
  cx.notify();
}

function setPage(v, page, cx) {
  const state = v.blame;
  const max = Math.max(0, Math.ceil(state.lines.length / PAGE_ROWS) - 1);
  state.page = Math.min(Math.max(0, page), max);
  cx.notify();
}

const AUTHOR_COLORS = ["ansi1", "ansi2", "ansi3", "ansi4", "ansi5", "ansi6"];

function authorColor(hash, t) {
  let sum = 0;
  for (let i = 0; i < hash.length; i++) sum += hash.charCodeAt(i);
  return t[AUTHOR_COLORS[sum % AUTHOR_COLORS.length]] ?? t.accent;
}

function filePicker(v, state, t, cx) {
  const query = state.filter.value().trim().toLowerCase();
  const matched = query ? state.files.filter((path) => path.toLowerCase().includes(query)) : state.files;
  const shown = matched.slice(0, FILE_ROWS);
  return div().id("blame-file-menu").absolute().top(8).left(10).right(10).rounded(8)
    .bg(t.popover).border_1().border_color(t.border).p(4)
    .child(div().h(26).px(6).flex().items_center().rounded(6).bg(t.input).border_1().border_color(t.border)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .child(Input.new(state.filter).h_full().text_size(11).text_color(t.foreground)))
    .child(div().id("blame-file-menu-x").w_full().max_h(280).overflow_y_scrollbar()
      .when(state.filesLoading && !state.files.length, (e) => e.child(div().p(8).text_size(11).text_color(t.dim).child("读取文件…")))
      .when(Boolean(state.filesError), (e) => e.child(div().p(8).text_size(11).text_color(t.ansi1).child(state.filesError)))
      .when(!state.filesLoading && !state.files.length && !state.filesError, (e) => e.child(div().p(8).text_size(11).text_color(t.dim).child("没有文件")))
      .when(!matched.length && Boolean(state.files.length), (e) => e.child(div().p(8).text_size(11).text_color(t.dim).child("没有匹配的文件")))
      .children(shown.map((path) => h_flex().id(`blame-file-${path}`).w_full().h(26).flex_none().px(6).gap(6).items_center()
        .rounded(5).when(path === state.path, (e) => e.bg(t.selected)).cursor_pointer()
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => chooseFile(v, path, cx))
        .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.muted).child(path))))
      .when(matched.length > shown.length, (e) => e.child(div().p(6).text_size(10).text_color(t.dim)
        .child(`仅显示前 ${FILE_ROWS} 个，继续输入以缩小范围`))));
}

function lineRow(v, line, t, cx) {
  const color = authorColor(line.hash, t);
  return h_flex().id(`blame-${line.line}`).w_full().h(20).flex_none().items_center().gap(6).px(8)
    .hover((style) => style.bg(t.hover)).cursor_pointer()
    .on_click((_e, cx) => v.showCommit({ hash: line.hash, short: line.short, subject: line.summary, author: line.author, date: new Date(line.time * 1000).toISOString(), refs: [], parents: [] }, cx))
    .child(div().w(58).flex_none().text_size(9).text_color(color).font_family(settings().font_family ?? "monospace").child(line.short))
    .child(div().w(90).flex_none().truncate().text_size(9).text_color(t.muted).child(line.author))
    .child(div().w(58).flex_none().text_size(9).text_color(t.dim).child(relativeTime(line.time)))
    .child(div().w(34).flex_none().text_size(9).text_color(t.dim).child(String(line.line)))
    .child(div().flex_1().min_w(0).truncate().text_size(10).text_color(t.foreground).font_family(settings().font_family ?? "monospace").child(line.code || " "));
}

export function renderBlame(v, t, cx) {
  const state = v.blame;
  const total = state.lines.length;
  const start = state.page * PAGE_ROWS;
  const visible = state.lines.slice(start, start + PAGE_ROWS);
  const header = v_flex().w_full().flex_none().gap(6).p(10).border_b(1).border_color(t.border)
    .child(h_flex().gap(6).items_center()
      .child(h_flex().id("blame-file-trigger").flex_1().min_w(0).h(26).px(7).gap(4).items_center().rounded(6)
        .bg(t.input).border_1().border_color(state.open ? t.accent : t.border).cursor_pointer()
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => openPicker(v, cx))
        .child(div().flex_1().min_w(0).truncate().text_size(11)
          .text_color(state.path ? t.foreground : t.dim).child(state.path || (state.filesLoading ? "读取文件…" : "选择文件")))
        .child(div().text_size(9).text_color(t.dim).child("▾")))
      .child(textButton("blame-run", state.loading ? "加载中…" : "查看", t, (cx) => loadBlame(v, cx),
        { small: true, primary: true, disabled: state.loading })))
    .child(h_flex().gap(6).items_center()
      .child(div().flex_1().min_w(0).h(26).px(7).flex().items_center().rounded(6).bg(t.input).border_1().border_color(t.border)
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .child(Input.new(state.rev).h_full().text_size(11).text_color(t.foreground)))
      .when(total > PAGE_ROWS, (e) => e
        .child(div().id("blame-prev").text_size(11).text_color(state.page > 0 ? t.accent : t.dim)
          .cursor_pointer().on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .on_click((_e, cx) => setPage(v, state.page - 1, cx)).child("‹"))
        .child(div().text_size(9).text_color(t.dim).child(`${start + 1}–${Math.min(total, start + PAGE_ROWS)} / ${total}`))
        .child(div().id("blame-next").text_size(11).text_color(start + PAGE_ROWS < total ? t.accent : t.dim)
          .cursor_pointer().on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .on_click((_e, cx) => setPage(v, state.page + 1, cx)).child("›")))
      .child(div().text_size(10).text_color(t.dim).child(state.loading ? "" : `${total} 行`)))
    .when(Boolean(state.note), (e) => e.child(div().text_size(10).text_color(t.dim).child(state.note)));

  return v_flex().size_full().min_h(0).bg(t.background).relative()
    .child(header)
    .when(Boolean(state.error), (e) => e.child(errorBar(state.error, t)))
    .child(div().flex_1().min_h(0).relative()
      .child(div().id("blame-x").size_full().overflow_y_scrollbar()
        .children(visible.map((line) => lineRow(v, line, t, cx))))
      .when(state.loading, (e) => e.child(div().absolute().inset_0().child(emptyState("读取追溯…", null, t))))
      .when(!state.loading && !state.lines.length, (e) => e.child(div().absolute().inset_0()
        .child(emptyState(state.path ? "没有追溯结果" : "选择文件", "从仓库文件中选择一个，查看每一行的最后修改", t)))))
    .when(state.open, (e) => e
      .child(div().id("blame-menu-backdrop").absolute().inset_0()
        .on_mouse_down("left", (_e, cx) => { state.open = false; cx.notify(); }))
      .child(filePicker(v, state, t, cx)));
}
