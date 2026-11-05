// 主区域「Git 对比」标签页：任意视图把 diff 目标发布到 shared，标签页跟随更新。
// 目标结构：{ kind, from?, to?, base?, path, label }，kind 与 git.loadFileDiff 一致。

import { div } from "gpui-kit";
import { h_flex, h_resizable, resizable_panel, v_flex } from "gpui-base";
import { focused, panes, run, setShared, settings, shared, spaces } from "herdr";
import * as git from "../git.js";
import { diffStats } from "../git.js";
import { repoName } from "../git-parse.js";
import { emptyState, shortPath } from "../ui.js";
import { ROW_H, buildDiffRows, paneRow, paneWidth } from "./diff-view.js";

export const STAGE_TAB = "Git 对比";
const SHARED_TARGET = "git-workbench.compare-target";
const FOLLOW_KEY = "git-workbench.stage-follow";

/** 侧栏切换文件时是否自动打开/更新主区域对比。 */
export function followEnabled() {
  try {
    return window.localStorage.getItem(FOLLOW_KEY) === "1";
  } catch {
    return false;
  }
}

export function setFollowEnabled(on) {
  try {
    window.localStorage.setItem(FOLLOW_KEY, on ? "1" : "0");
  } catch {}
}

/** 在所有空间里找「Git 对比」标签页，避免重复打开。 */
export function findStageTab() {
  const modTabs = new Set(panes().filter((pane) => pane.mod === "git-workbench").map((pane) => pane.tab));
  for (const space of spaces()) {
    const tab = space.tabs.find((item) => item.name === STAGE_TAB || modTabs.has(item.id));
    if (tab) return { tab, space: space.id };
  }
  return null;
}

/** 把 diff 目标发布给主区域标签页。 */
export function publishStage(v, target) {
  if (!v.repo || !target?.path) return;
  setShared(SHARED_TARGET, {
    root: v.repo.root,
    on: v.repo.on ?? null,
    ...target,
    seq: Date.now(),
  });
}

/**
 * 主区域当前显示的就是这个目标时，刷新它的内容；不打开标签页，也不改别的目标。
 * 用于后台发现文件变化后的自动重读。
 */
export function refreshStage(v, target) {
  if (!v.repo || !target?.path) return;
  const current = normalize(shared(SHARED_TARGET));
  if (!current || current.root !== v.repo.root || !sameTarget(current, target)) return;
  publishStage(v, target);
}

function sameTarget(a, b) {
  return a.kind === b.kind && a.path === b.path
    && (a.from ?? null) === (b.from ?? null)
    && (a.to ?? null) === (b.to ?? null)
    && (a.base ?? null) === (b.base ?? null);
}

/** 打开或切回主区域标签页，并立即显示该目标。 */
export function showInStage(v, cx, target) {
  if (!v.repo || !target?.path) return;
  setFollowEnabled(true);
  publishStage(v, target);
  const existing = findStageTab();
  if (existing) {
    run("space.select", { id: existing.space });
    run("tab.select", { id: existing.tab.id });
    return;
  }
  // 连续切换文件时不要重复开标签页。
  v.stageOpenedAt = Date.now();
  run("tab.new", {
    name: STAGE_TAB,
    space: focused()?.space,
    mod: "git-workbench",
    props: { view: "compare", stage: true },
  });
  cx.notify();
}

/**
 * 选中文件后的跟随：标签页开着就更新；被关掉且开启跟随时重新打开。
 */
export function syncStage(v, cx, target) {
  if (!v.repo || !target?.path) return;
  const stage = findStageTab();
  if (!stage && !followEnabled()) return;
  if (!stage && Date.now() - (v.stageOpenedAt ?? 0) <= 2000) return;
  publishStage(v, target);
  if (!stage) showInStage(v, cx, target);
}

/** 主区域标签页的数据：只跟随 shared 里的目标。 */
export function createStageState() {
  return {
    target: null,
    diff: null,
    loading: false,
    error: "",
    seq: -1,
    token: 0,
    // 两栏共享同一纵向位置（像素），横向各自独立。
    top: 0,
    viewH: 0,
    bodyW: 0,
    wLeft: 0,
    wRight: 0,
    xLeft: 0,
    xRight: 0,
    drag: null,
  };
}

/** 旧版 shared 只有 a/b，读入时补成 range 目标。 */
function normalize(target) {
  if (!target) return null;
  if (target.kind) return target;
  return {
    ...target,
    kind: "range",
    from: target.a ?? "HEAD",
    to: target.b ?? null,
    label: `${target.a || "HEAD"} → ${target.b || "工作区"}`,
  };
}

export function ensureStage(v, cx) {
  const target = normalize(shared(SHARED_TARGET));
  if (!target || !target.root || !target.path) return;
  if (target.seq === v.stage.seq) return;
  v.stage.seq = target.seq;
  v.stage.target = target;
  v.repo = { root: target.root, on: target.on ?? null, name: repoName(target.root), branch: "", head: "" };
  loadStageDiff(v, cx);
}

function loadStageDiff(v, cx) {
  const state = v.stage;
  const target = state.target;
  const token = ++state.token;
  state.diff = null;
  state.error = "";
  state.loading = true;
  state.top = 0;
  state.xLeft = 0;
  state.xRight = 0;
  state.drag = null;
  cx.notify();
  cx.spawn(async (cx) => {
    const result = target.kind === "untracked"
      ? await git.loadUntrackedDiff(target.root, target.on, target.path)
      : await git.loadFileDiff(target.root, target.on, {
        kind: target.kind,
        base: target.base ?? null,
        from: target.from ?? null,
        to: target.to ?? null,
        path: target.path,
      });
    if (token !== state.token) return;
    state.loading = false;
    if (!result.ok) {
      state.error = result.err;
    } else {
      const rows = buildDiffRows(result.parsed);
      state.diff = {
        error: result.parsed?.binary ? "二进制文件，没有文本 diff" : result.parsed?.empty ? "没有可显示的文本差异" : "",
        rows,
        widthL: paneWidth(rows, "left"),
        widthR: paneWidth(rows, "right"),
        stats: diffStats(result.parsed),
        truncated: result.truncated,
      };
    }
    cx.notify();
  });
}

// ---- 左右分栏 --------------------------------------------------------------
// 两栏各自渲染可见的一小段行，纵向共用一个 top，滚动天然同步；横向位置各存一份。
// 滚动条也是自绘的：原生滚动区域拿不到偏移量，无法让另一栏跟随。

function xKey(side) {
  return side === "left" ? "xLeft" : "xRight";
}

function contentWidth(state, side) {
  return (side === "left" ? state.diff?.widthL : state.diff?.widthR) ?? 320;
}

function viewCount(state, side) {
  return (side === "left" ? state.wLeft : state.wRight) || 0;
}

function maxTop(state) {
  return Math.max(0, (state.diff?.rows?.length ?? 0) * ROW_H - (state.viewH || 0));
}

function maxX(state, side) {
  return Math.max(0, contentWidth(state, side) - viewCount(state, side));
}

function setTop(state, top) {
  state.top = Math.max(0, Math.min(top, maxTop(state)));
}

function setX(state, side, x) {
  state[xKey(side)] = Math.max(0, Math.min(x, maxX(state, side)));
}

function frac(value) {
  return Math.max(0, Math.min(1, value));
}

function onWheel(v, side, event, cx) {
  const state = v.stage;
  if (!state.diff) return;
  let dx = event.delta?.x ?? 0;
  let dy = event.delta?.y ?? 0;
  // Shift + 滚轮 / 触控板横向滑动都当作横向滚动。
  if (event.modifiers?.shift && !dx) {
    dx = dy;
    dy = 0;
  }
  if (dy) setTop(state, state.top - dy);
  if (dx) {
    // 对比默认两栏横向同步；按住 Alt 只滚当前栏。
    const next = state[xKey(side)] - dx;
    if (event.modifiers?.alt) setX(state, side, next);
    else {
      setX(state, "left", next);
      setX(state, "right", next);
    }
  }
  cx.stop_propagation();
  if (dy || dx) cx.notify();
}

function onSize(v, side, size, cx) {
  const state = v.stage;
  let changed = false;
  if (Math.abs((state.viewH || 0) - size.height) > 0.5) {
    state.viewH = size.height;
    changed = true;
  }
  const key = side === "left" ? "wLeft" : "wRight";
  if (Math.abs((state[key] || 0) - size.width) > 0.5) {
    state[key] = size.width;
    changed = true;
  }
  if (!changed) return;
  setTop(state, state.top);
  cx.notify();
}

/** 把滚动条上的一个点换算成滚动位置。 */
function jump(v, side, axis, pos, cx, independent = false) {
  const state = v.stage;
  if (!state.diff) return;
  if (axis === "y") {
    const total = state.diff.rows.length * ROW_H;
    const view = state.viewH || 0;
    if (total <= view || view <= 0) return;
    const thumb = Math.max(24, (view * view) / total);
    setTop(state, frac((pos.y - thumb / 2) / Math.max(1, view - thumb)) * (total - view));
  } else {
    const total = contentWidth(state, side);
    const view = viewCount(state, side);
    if (total <= view || view <= 0) return;
    const thumb = Math.max(30, (view * view) / total);
    const next = frac((pos.x - thumb / 2) / Math.max(1, view - thumb)) * (total - view);
    if (independent) setX(state, side, next);
    else {
      setX(state, "left", next);
      setX(state, "right", next);
    }
  }
  cx.notify();
}

function dragBar(v, side, axis, event, cx) {
  const independent = Boolean(event.modifiers?.alt);
  v.stage.drag = { side, axis, independent };
  jump(v, side, axis, event.local_position ?? { x: 0, y: 0 }, cx, independent);
}

function dragMove(v, side, event, cx) {
  const drag = v.stage.drag;
  if (!drag) return;
  // 纵向位置两栏一致，指针滑到另一栏也能继续拖；横向位置按栏各算。
  if (drag.axis === "x" && drag.side !== side) return;
  jump(v, drag.side, drag.axis, event.local_position ?? { x: 0, y: 0 }, cx, drag.independent);
}

function endDrag(v, cx) {
  if (!v.stage.drag) return;
  v.stage.drag = null;
  cx.notify();
}

function scrollbarEl(v, side, t, axis, cx) {
  const state = v.stage;
  const total = axis === "y" ? (state.diff?.rows?.length ?? 0) * ROW_H : contentWidth(state, side);
  const view = axis === "y" ? (state.viewH || 0) : viewCount(state, side);
  if (total <= view || view <= 0) return div();
  const offset = axis === "y" ? state.top : state[xKey(side)];
  const thumb = Math.max(axis === "y" ? 24 : 30, (view * view) / total);
  const pos = (Math.max(0, Math.min(offset, total - view)) / (total - view)) * (view - thumb);
  const handle = div().absolute().rounded(3).bg(t.border);
  const track = div().id(`stage-scroll-${axis}-${side}`).absolute().cursor_pointer()
    .on_mouse_down("left", (e, cx2) => dragBar(v, side, axis, e, cx2))
    .on_mouse_move((e, cx2) => dragMove(v, side, e, cx2))
    .on_mouse_up("left", (_e, cx2) => endDrag(v, cx2));
  return axis === "y"
    ? track.top(0).bottom(0).right(0).w(10).child(handle.right(2).w(6).top(pos).h(thumb))
    : track.left(0).right(10).bottom(0).h(10).child(handle.bottom(2).h(6).left(pos).w(thumb));
}

const PANE_HEAD_H = 24;

function paneLabel(target, side) {
  if (!target) return "";
  const custom = side === "left" ? target.leftLabel : target.rightLabel;
  if (custom != null) return custom;
  if (target.kind === "commit") {
    const hash = side === "left" ? target.base : target.to;
    return hash ? String(hash).slice(0, 7) : side === "left" ? "根提交" : "";
  }
  if (target.kind === "range") return side === "left" ? target.from || "HEAD" : target.to || "工作区";
  return side === "left" ? "HEAD" : "工作区";
}

/** 某一侧完全没有内容（例如新增/删除文件）：这种对比只显示有内容的那一栏。 */
function sideEmpty(rows, side) {
  let pairs = 0;
  for (const row of rows) {
    if (row.kind !== "pair") continue;
    pairs++;
    if (row[side]) return false;
  }
  return pairs > 0;
}

function paneEl(v, side, t, cx) {
  const state = v.stage;
  const rows = state.diff?.rows ?? [];
  const width = contentWidth(state, side);
  // 内容比视口窄时铺满，hunk 标题和空白行才不会只占左半边。
  const painted = Math.max(width, viewCount(state, side));
  const x = Math.max(0, Math.min(state[xKey(side)] ?? 0, maxX(state, side)));
  const start = Math.max(0, Math.floor(state.top / ROW_H));
  const offset = state.top - start * ROW_H;
  const count = Math.ceil((state.viewH || 0) / ROW_H) + 2;
  const visible = rows.slice(start, Math.min(rows.length, start + count));
  const label = paneLabel(state.target, side);
  return v_flex().id(`stage-pane-${side}`).size_full().min_h(0)
    .child(h_flex().w_full().h(PANE_HEAD_H).flex_none().px(8).gap(6).items_center().bg(t.chrome).border_b(1).border_color(t.border)
      .child(div().flex_none().text_size(9).text_color(side === "left" ? t.ansi1 : t.ansi2).child(side === "left" ? "旧版" : "新版"))
      .child(div().flex_1().min_w(0).truncate().text_size(10).text_color(t.muted).child(label))
      .tooltip(label))
    .child(div().flex_1().min_h(0).relative().overflow_hidden()
      .font_family(settings().font_family ?? "monospace")
      .on_size_change((size, cx2) => onSize(v, side, size, cx2))
      .on_scroll_wheel((e, cx2) => onWheel(v, side, e, cx2))
      .on_mouse_move((e, cx2) => dragMove(v, side, e, cx2))
      .on_mouse_up("left", (_e, cx2) => endDrag(v, cx2))
      .on_mouse_down_out((_e, cx2) => endDrag(v, cx2))
      .child(v_flex().absolute().top(-offset).left(-x).w(painted).flex_none()
        .children(visible.map((row) => paneRow(row, side, t))))
      .child(scrollbarEl(v, side, t, "y", cx))
      .child(scrollbarEl(v, side, t, "x", cx)));
}

/** 左右两栏 + 可拖动分隔条；首次创建时各占一半，之后由用户拖动决定。 */
function renderSplit(v, t, cx) {
  const initial = Math.max(260, Math.round((v.stage.bodyW || 720) / 2));
  return h_resizable("git-workbench-stage-split-v2").size_full().min_h(0)
    .child(resizable_panel().h_full().size(initial).size_range(260, 1600).child(paneEl(v, "left", t, cx)))
    .child(resizable_panel().h_full().child(paneEl(v, "right", t, cx)));
}

/** 主区域标签页的渲染：标题 + 整窗左右分栏 diff。 */
export function renderStage(v, t, cx) {
  const state = v.stage;
  const target = state.target;
  const rows = state.diff?.rows ?? [];
  // 新增/删除文件这种一侧全空的对比只画有内容的那一栏。
  const single = state.diff && !state.diff.error
    ? (sideEmpty(rows, "left") ? "right" : sideEmpty(rows, "right") ? "left" : null)
    : null;
  const head = h_flex().w_full().h(38).flex_none().px(12).gap(10).items_center().border_b(1).border_color(t.border).bg(t.chrome)
    .child(div().text_size(11).font_semibold().text_color(t.muted).child("Git 对比"))
    .when(Boolean(v.repo), (e) => e.child(div().text_size(10).text_color(t.dim).child(v.repo.name)))
    .when(Boolean(target), (e) => e
      .child(div().text_size(11).text_color(t.foreground).child(shortPath(target.path, 90)))
      .when(Boolean(target.label), (e2) => e2.child(div().text_size(10).text_color(t.dim).child(target.label))))
    .child(div().flex_1())
    .when(Boolean(state.diff) && !single, (e) => e.child(div().text_size(9).text_color(t.dim).child("Alt+滚轮可单独滚动一侧")))
    .when(Boolean(state.diff?.stats?.add), (e) => e.child(div().text_size(10).text_color(t.ansi2).child(`+${state.diff.stats.add}`)))
    .when(Boolean(state.diff?.stats?.del), (e) => e.child(div().text_size(10).text_color(t.ansi1).child(`−${state.diff.stats.del}`)));

  return v_flex().id(v.stageDiffId).size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(12)
    .child(head)
    .child(div().flex_1().min_h(0).relative()
      .on_size_change((size, cx2) => {
        // 分栏首次创建时用一半宽度；之后窗口里保存的拖动位置优先。
        if (Math.abs((state.bodyW || 0) - size.width) <= 0.5) return;
        state.bodyW = size.width;
        cx2.notify();
      })
      .when(!target, (e) => e.child(div().absolute().inset_0()
        .child(emptyState("还没有对比目标", "在侧栏选择文件后点「主区域打开」，之后切换文件会自动跟随", t))))
      .when(state.loading, (e) => e.child(div().absolute().inset_0().flex().items_center().justify_center()
        .child(div().text_size(11).text_color(t.dim).child("加载 diff…"))))
      .when(!state.loading && Boolean(state.error || state.diff?.error), (e) => e.child(div().absolute().inset_0().flex().items_center().justify_center()
        .child(div().text_size(11).text_color(t.dim).child(state.error || state.diff.error))))
      .when(!state.loading && !state.error && Boolean(state.diff) && !state.diff.error,
        (e) => e.child(single ? paneEl(v, single, t, cx) : renderSplit(v, t, cx))));
}
