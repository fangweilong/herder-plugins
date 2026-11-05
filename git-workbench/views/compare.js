// 提交对比：A → B（B 为“工作区”表示未提交改动），列出变更文件并逐文件看并排 diff。
// 侧栏负责选择，主区域标签页通过 shared 跟随同一目标，用整窗宽度显示并排 diff。

import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { settings } from "herdr";
import * as git from "../git.js";
import { diffStats } from "../git.js";
import { addDel, emptyState, errorBar, shortPath, statusColor, textButton } from "../ui.js";
import { buildDiffRows, diffContentWidth, diffHeader, renderDiff } from "./diff-view.js";
import { findStageTab, showInStage, syncStage } from "./stage.js";

const WORKTREE = "";

export function createCompareState() {
  return {
    a: "HEAD",
    b: WORKTREE,
    picked: false,
    refs: [],
    refsLoading: false,
    open: null, // "a" | "b" | null
    files: [],
    loading: false,
    error: "",
    selected: null,
    diff: null,
    diffLoading: false,
    note: "",
    token: 0,
    fileToken: 0,
  };
}

/** 当前 A → B 下某个文件的 diff 目标。 */
function compareTarget(v, path) {
  const state = v.compare;
  return {
    kind: "range",
    from: state.a || "HEAD",
    to: state.b || null,
    path,
    label: `${state.a || "HEAD"} → ${state.b || "工作区"}`,
    leftLabel: state.a || "HEAD",
    rightLabel: state.b || "工作区（未提交改动）",
  };
}

/** 在中央工作区打开（或切回）对比标签页。 */
export function openCompareStage(v, cx) {
  const state = v.compare;
  const path = state.selected || state.files[0]?.path;
  if (!path) return;
  showInStage(v, cx, compareTarget(v, path));
}

export function ensureCompare(v, cx) {
  const state = v.compare;
  if (!state.picked && v.repo?.branch) state.a = v.repo.branch;
  if (!state.refs.length && !state.refsLoading) loadRefs(v, cx);
  if (!state.files.length && !state.loading) compare(v, cx);
}

function loadRefs(v, cx) {
  if (!v.repo) return;
  const state = v.compare;
  const root = v.repo.root;
  const on = v.repo.on;
  state.refsLoading = true;
  cx.spawn(async (cx) => {
    const result = await git.loadBranches(root, on);
    if (v.repo?.root !== root) return;
    state.refsLoading = false;
    if (result.ok) state.refs = result.branches;
    cx.notify();
  });
}

export function compare(v, cx) {
  if (!v.repo) return;
  const state = v.compare;
  const from = state.a || "HEAD";
  const to = state.b || null;
  if (to === from) {
    state.note = "起点和终点相同";
    cx.notify();
    return;
  }
  const root = v.repo.root;
  const on = v.repo.on;
  const token = ++state.token;
  state.open = null;
  state.loading = true;
  state.error = "";
  state.note = "";
  state.files = [];
  state.selected = null;
  state.diff = null;
  cx.notify();
  cx.spawn(async (cx) => {
    const result = await git.loadRangeFiles(root, on, from, to);
    if (token !== state.token || v.repo?.root !== root) return;
    state.loading = false;
    if (!result.ok) {
      state.error = result.err;
      cx.notify();
      return;
    }
    state.files = result.files;
    cx.notify();
    if (state.files.length) selectFile(v, state.files[0].path, cx);
    if (v.pendingStage) {
      v.pendingStage = false;
      openCompareStage(v, cx);
    }
  });
}

/** explicit 表示用户主动点选：只有主动点选才同步主区域。 */
function selectFile(v, path, cx, explicit = false) {
  if (!v.repo) return;
  const state = v.compare;
  const from = state.a || "HEAD";
  const to = state.b || null;
  state.selected = path;
  state.diff = null;
  state.diffLoading = true;
  const token = ++state.fileToken;
  const root = v.repo.root;
  const on = v.repo.on;
  cx.notify();
  cx.spawn(async (cx) => {
    const result = await git.loadFileDiff(root, on, { kind: "range", from, to, path });
    if (token !== state.fileToken || v.repo?.root !== root) return;
    state.diffLoading = false;
    if (!result.ok) {
      state.diff = { error: result.err, rows: [], width: 600, stats: { add: 0, del: 0 } };
    } else {
      const rows = buildDiffRows(result.parsed);
      state.diff = {
        error: result.parsed?.binary ? "二进制文件，没有文本 diff" : result.parsed?.empty ? "没有可显示的文本差异" : "",
        rows,
        width: diffContentWidth(rows),
        stats: diffStats(result.parsed),
        truncated: result.truncated,
      };
    }
    // 主区域标签页开着就实时跟随；被关掉且开启跟随时重新打开。
    if (explicit) syncStage(v, cx, compareTarget(v, path));
    cx.notify();
  });
}

/** 下拉选项：HEAD、本地/远程分支、标签；终点多一个“工作区”。 */
function options(state, kind) {
  const list = [];
  if (kind === "b") list.push({ value: WORKTREE, label: "工作区（未提交改动）", kind: "worktree" });
  list.push({ value: "HEAD", label: "HEAD（当前提交）", kind: "head" });
  const seen = new Set(["HEAD"]);
  for (const ref of state.refs) {
    if (seen.has(ref.name)) continue;
    seen.add(ref.name);
    list.push({ value: ref.name, label: ref.name, kind: ref.kind, current: ref.current });
  }
  return list;
}

function labelOf(state, kind) {
  const value = kind === "a" ? state.a : state.b;
  return value || "工作区（未提交改动）";
}

function setRevision(v, kind, value, cx) {
  const state = v.compare;
  if (kind === "a") state.a = value;
  else state.b = value;
  state.picked = true;
  state.open = null;
  cx.notify();
  compare(v, cx);
}

function revRow(state, kind, label, t, cx) {
  const open = state.open === kind;
  const value = labelOf(state, kind);
  return h_flex().w_full().gap(6).items_center()
    .child(div().w(52).flex_none().text_size(10).text_color(t.dim).child(label))
    .child(h_flex().id(`compare-${kind}-trigger`).flex_1().min_w(0).h(26).px(7).gap(4).items_center()
      .rounded(6).bg(t.input).border_1().border_color(open ? t.accent : t.border).cursor_pointer()
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { state.open = open ? null : kind; cx.notify(); })
      .child(div().flex_1().min_w(0).truncate().text_size(11)
        .text_color(value.startsWith("工作区") ? t.dim : t.foreground).child(value))
      .child(div().text_size(9).text_color(t.dim).child("▾")));
}

function picker(v, state, kind, t, cx) {
  if (state.open !== kind) return null;
  const items = options(state, kind);
  return div().id(`compare-${kind}-menu`).absolute().top(kind === "a" ? 40 : 72).left(64).right(10)
    .rounded(8).bg(t.popover).border_1().border_color(t.border).p(3).max_h(300)
    .child(div().id(`compare-${kind}-menu-x`).w_full().max_h(294).overflow_y_scrollbar()
    .children(items.map((item) => h_flex().id(`compare-${kind}-opt-${item.value || "worktree"}`)
      .w_full().h(27).flex_none().gap(6).px(6).items_center().rounded(5)
      .when(item.value === (kind === "a" ? state.a : state.b), (e) => e.bg(t.selected))
      .hover((style) => style.bg(t.hover)).cursor_pointer()
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => setRevision(v, kind, item.value, cx))
      .child(div().w(10).flex_none().text_size(9).text_color(item.current ? t.accent : t.dim)
        .child(item.current ? "●" : item.kind === "tag" ? "▣" : item.kind === "worktree" ? "✎" : "○"))
      .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.muted).child(item.label))
      .when(item.kind === "remote", (e) => e.child(div().text_size(9).text_color(t.dim).child("远程")))
      .when(item.kind === "tag", (e) => e.child(div().text_size(9).text_color(t.dim).child("标签"))))));
}

export function renderCompareList(v, t, cx) {
  const state = v.compare;

  const header = v_flex().w_full().flex_none().gap(6).p(10).border_b(1).border_color(t.border)
    .child(revRow(state, "a", "起点", t, cx))
    .child(revRow(state, "b", "终点", t, cx))
    .child(h_flex().gap(6).items_center()
      .child(textButton("compare-run", state.loading ? "对比中…" : "对比", t, (cx) => compare(v, cx),
        { small: true, primary: true, disabled: state.loading }))
      .child(textButton("compare-swap", "交换", t, (cx) => {
        const a = state.a;
        state.a = state.b;
        state.b = a;
        state.picked = true;
        cx.notify();
        compare(v, cx);
      }, { small: true }))
      .child(textButton("compare-stage", "主区域打开", t, (cx) => openCompareStage(v, cx),
        { small: true, primary: true, disabled: state.loading || !state.files.length }))
      .child(div().flex_1())
      .child(div().text_size(10).text_color(t.dim).child(
        state.refsLoading ? "读取分支…" : state.loading ? "" : `${state.files.length} 个文件${findStageTab() ? " · 主区域已跟随" : ""}`)))
    .when(Boolean(state.note), (e) => e.child(div().text_size(10).text_color(t.dim).child(state.note)));

  return v_flex().size_full().min_h(0).relative().bg(t.surface)
    .child(header)
    .when(Boolean(state.error), (e) => e.child(errorBar(state.error, t)))
    .child(div().flex_1().min_h(0).relative()
      .child(div().id("compare-list-x").size_full().overflow_y_scrollbar()
        .children(state.files.map((file) => {
          const selected = state.selected === file.path;
          return h_flex().id(`compare-${file.path}`).w_full().h(26).flex_none().gap(6).px(8)
            .when(selected, (e) => e.bg(t.selected)).hover((style) => style.bg(selected ? t.selected : t.hover))
            .cursor_pointer().on_click((_e, cx) => selectFile(v, file.path, cx, true))
            .child(div().w(11).flex_none().text_size(10).font_semibold().text_color(statusColor(file.status, t)).child(file.status))
            .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(selected ? t.foreground : t.muted).child(file.path))
            .child(addDel(file.add, file.del, t));
        })))
      .when(state.loading, (e) => e.child(div().absolute().inset_0().child(emptyState("对比中…", null, t))))
      .when(!state.loading && !state.files.length, (e) => e.child(div().absolute().inset_0()
        .child(emptyState("没有差异", "选择两个不同的分支、标签或提交", t)))))
    .when(Boolean(state.open), (e) => e
      .child(div().id("compare-menu-backdrop").absolute().inset_0()
        .on_mouse_down("left", (_e, cx) => { state.open = null; cx.notify(); }))
      .child(picker(v, state, state.open, t, cx)));
}

export function renderCompareDetail(v, t, cx) {
  const state = v.compare;
  if (!state.selected) return emptyState("选择一个文件", "右侧显示 A → B 的并排 diff", t);
  const from = state.a || "HEAD";
  const to = state.b || "工作区";
  return v_flex().size_full().min_h(0)
    .child(diffHeader(shortPath(state.selected, 72), state.diff?.stats, t,
      div().text_size(10).text_color(t.dim).child(`${from} → ${to}`)))
    .child(div().flex_1().min_h(0).relative()
      .when(state.diffLoading, (e) => e.child(div().absolute().inset_0().flex().items_center().justify_center()
        .child(div().text_size(11).text_color(t.dim).child("加载 diff…"))))
      .when(!state.diffLoading && Boolean(state.diff?.error), (e) => e.child(div().absolute().inset_0().flex().items_center().justify_center()
        .child(div().text_size(11).text_color(t.dim).child(state.diff.error))))
      .when(!state.diffLoading && !state.diff?.error, (e) => e.child(
        renderDiff(state.diff?.rows ?? [], t, "compare-diff", state.diff?.width ?? 600, settings().font_family ?? "monospace"))));
}
