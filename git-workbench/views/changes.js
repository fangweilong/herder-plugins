// 工作区变更：Staged / Unstaged / Untracked 分组、逐文件并排 diff、暂存与提交。

import { div } from "gpui-kit";
import { h_flex, v_flex, Input, InputState, Scrollbar } from "gpui-base";
import { settings } from "herdr";
import { loadLogPage } from "./log.js";
import * as git from "../git.js";
import { diffStats } from "../git.js";
import { statusLetter } from "../git-parse.js";
import { addDel, emptyState, errorBar, shortPath, statusColor, textButton } from "../ui.js";
import { buildDiffRows, diffContentWidth, diffHeader, renderDiff } from "./diff-view.js";
import { refreshStage, showInStage, syncStage } from "./stage.js";

export function createChangesState() {
  const message = InputState.new({ placeholder: "提交信息" });
  return {
    files: [],
    loading: false,
    error: "",
    hasHead: true,
    selected: null, // { group: "staged" | "unstaged" | "untracked", path }
    diff: null,
    diffLoading: false,
    message,
    amend: false,
    busy: false,
    note: "",
    token: 0,
    fileToken: 0,
    signature: "",
  };
}

export function ensureChanges(v, cx) {
  if (v.changes.files.length || v.changes.loading) return;
  refreshChanges(v, cx);
}

export function refreshChanges(v, cx, options = {}) {
  if (!v.repo || v.changes.loading) return;
  const silent = Boolean(options.silent);
  const state = v.changes;
  const root = v.repo.root;
  const on = v.repo.on;
  const token = ++state.token;
  // 选中文件在刷新前的状态，用来判断是否需要重读 diff。
  const before = state.selected ? findFile(state, state.selected) : null;
  const beforeSig = before ? fileSignature(before) : "";
  if (!silent) {
    state.loading = true;
    cx.notify();
  }
  cx.spawn(async (cx) => {
    const result = await git.loadStatus(root, on);
    if (token !== state.token || v.repo?.root !== root) return;
    state.loading = false;
    if (!result.ok) {
      state.error = result.err;
      cx.notify();
      return;
    }
    state.error = "";
    state.hasHead = result.hasHead;
    const signature = filesSignature(result.files);
    if (signature !== state.signature) {
      state.files = result.files;
      state.signature = signature;
      // 选中项跟着文件列表走；文件消失或状态变化时清空 diff。
      if (state.selected && !findFile(state, state.selected)) {
        state.selected = null;
        state.diff = null;
      }
      cx.notify();
    } else if (!silent) {
      cx.notify();
    }
    if (state.selected) {
      const after = findFile(state, state.selected);
      // 文件本身没变就保留当前 diff，避免后台刷新时整块闪一下。
      if (!after || !state.diff || fileSignature(after) !== beforeSig) {
        readChange(v, state.selected.group, state.selected.path, cx, false, true);
      }
    } else {
      const first = groups(state)[0];
      if (first?.files.length) readChange(v, first.id, first.files[0].path, cx);
    }
  });
}

function filesSignature(files) {
  return files.map((file) => `${file.path}\0${file.x}${file.y}\0${file.add}\0${file.del}\0${file.binary ? 1 : 0}`).join("\n");
}

function fileSignature(file) {
  return `${file.x}${file.y}\0${file.add}\0${file.del}\0${file.binary ? 1 : 0}`;
}

function findFile(state, selected) {
  return state.files.find((file) => {
    if (selected.group === "staged") return file.staged && file.path === selected.path;
    if (selected.group === "unstaged") return (file.unstaged || file.conflict) && file.path === selected.path;
    return file.untracked && file.path === selected.path;
  });
}

function groups(state) {
  const staged = state.files.filter((file) => file.staged);
  const unstaged = state.files.filter((file) => file.unstaged || file.conflict);
  const untracked = state.files.filter((file) => file.untracked);
  return [
    { id: "staged", label: "已暂存", files: staged },
    { id: "unstaged", label: "未暂存", files: unstaged },
    { id: "untracked", label: "未跟踪", files: untracked },
  ].filter((group) => group.files.length);
}

/** 把分组转换成主区域 diff 目标。 */
export function changeTarget(group, path) {
  return {
    kind: group === "untracked" ? "untracked" : group === "staged" ? "staged" : "work",
    path,
    label: group === "staged" ? "已暂存" : group === "untracked" ? "未跟踪" : "未暂存",
    // 未跟踪文件没有左侧内容，主区域只显示右栏。
    leftLabel: group === "staged" ? "HEAD" : group === "untracked" ? "" : "暂存区",
    rightLabel: group === "staged" ? "暂存区" : group === "untracked" ? "工作区（新文件）" : "工作区",
  };
}

/**
 * 读取一个文件的改动。
 * explicit：用户主动点选，同步并可在开启跟随时打开主区域。
 * refresh：只重读同一目标，主区域正显示它时刷新内容（不打开）。
 */
export function readChange(v, group, path, cx, explicit = false, refresh = false) {
  if (!v.repo) return;
  const state = v.changes;
  const file = state.files.find((item) => item.path === path);
  if (!file) return;
  state.selected = { group, path };
  state.diff = null;
  state.diffLoading = true;
  const token = ++state.fileToken;
  const root = v.repo.root;
  const on = v.repo.on;
  cx.notify();
  cx.spawn(async (cx) => {
    let result;
    if (group === "untracked") {
      result = await git.loadUntrackedDiff(root, on, path);
    } else {
      result = await git.loadFileDiff(root, on, {
        kind: group === "staged" ? "staged" : "work",
        path,
      });
    }
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
    if (explicit) syncStage(v, cx, changeTarget(group, path));
    else if (refresh) refreshStage(v, changeTarget(group, path));
    cx.notify();
  });
}

function runWrite(v, cx, action, success) {
  if (!v.repo) return;
  const root = v.repo.root;
  const on = v.repo.on;
  const state = v.changes;
  state.busy = true;
  cx.notify();
  cx.spawn(async (cx) => {
    const result = await action(root, on);
    state.busy = false;
    state.note = result.ok ? success : `失败：${result.err}`;
    if (result.ok) refreshChanges(v, cx);
    else cx.notify();
  });
}

function groupRow(v, group, t, cx) {
  const count = group.files.length;
  return h_flex().w_full().h(27).flex_none().px(8).gap(6).items_center().bg(t.chrome)
    .child(div().text_size(10).font_semibold().text_color(t.dim).child(`${group.label} (${count})`))
    .child(div().flex_1())
    .when(group.id === "staged", (e) => e.child(div().id("unstage-all").text_size(10).text_color(t.muted).cursor_pointer()
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => runWrite(v, cx, (root, on) => git.write.unstageAll(root, on), "已全部取消暂存"))
      .child("全部取消")))
    .when(group.id === "untracked", (e) => e.child(div().id("add-all").text_size(10).text_color(t.muted).cursor_pointer()
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => runWrite(v, cx, (root, on) => git.write.stage(root, on, group.files.map((file) => file.path)), "已添加全部未跟踪文件"))
      .child("全部添加")));
}

function fileRow(v, file, group, t, cx) {
  const state = v.changes;
  const selected = state.selected?.group === group.id && state.selected?.path === file.path;
  const letter = statusLetter(file);
  const row = h_flex().id(`${group.id}-${file.path}`).w_full().h(27).flex_none().gap(5).px(6)
    .when(selected, (e) => e.bg(t.selected)).hover((style) => style.bg(selected ? t.selected : t.hover))
    .on_click((_e, cx) => readChange(v, group.id, file.path, cx, true))
    .child(div().w(11).flex_none().text_size(10).font_semibold().text_color(statusColor(letter, t)).child(letter))
    .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(selected ? t.foreground : t.muted).child(file.path))
    .child(addDel(file.add, file.del, t));

  if (group.id === "staged") {
    row.child(textButton(`unstage-${file.path}`, "取消", t,
      (cx) => runWrite(v, cx, (root, on) => git.write.unstage(root, on, [file.path]), "已取消暂存"), { small: true }));
  } else if (group.id === "unstaged") {
    row.child(textButton(`stage-${file.path}`, "暂存", t,
      (cx) => runWrite(v, cx, (root, on) => git.write.stage(root, on, [file.path]), "已暂存"), { small: true }));
    row.child(textButton(`discard-${file.path}`, "丢弃", t, (cx) => v.askAction({
      title: "丢弃工作区改动",
      body: `这会把 ${file.path} 恢复到已暂存或 HEAD 的状态，无法撤销。`,
      danger: true,
      run: (c2) => git.write.restore(v.repo.root, v.repo.on, [file.path]),
      success: "已丢弃改动",
      done: (c2) => refreshChanges(v, c2),
    }), { small: true, danger: true }));
  } else {
    row.child(textButton(`add-${file.path}`, "添加", t,
      (cx) => runWrite(v, cx, (root, on) => git.write.stage(root, on, [file.path]), "已添加"), { small: true }));
  }
  return row;
}

export function renderChangesList(v, t, cx) {
  const state = v.changes;
  const all = groups(state);
  const total = state.files.length;
  const rows = [];
  for (const group of all) {
    rows.push({ kind: "group", group });
    for (const file of group.files) rows.push({ kind: "file", group, file });
  }
  const header = h_flex().w_full().flex_none().h(34).px(10).gap(6).items_center().border_b(1).border_color(t.border)
    .child(div().text_size(11).font_semibold().text_color(t.muted).child("工作区"))
    .child(div().text_size(10).text_color(t.dim).child(`${total} 个文件`))
    .child(div().flex_1())
    .child(textButton("stage-all", "全部暂存", t, (cx) => runWrite(v, cx, (root, on) => git.write.stageAll(root, on), "已全部暂存"), { small: true }))
    .child(div().id("changes-refresh").text_size(11).text_color(t.muted).cursor_pointer()
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => refreshChanges(v, cx)).child("刷新"));

  return v_flex().size_full().min_h(0).bg(t.surface)
    .child(header)
    .when(Boolean(state.error), (e) => e.child(errorBar(state.error, t)))
    .when(Boolean(state.note), (e) => e.child(h_flex().w_full().flex_none().px(10).py(4)
      .child(div().text_size(10).text_color(state.note.startsWith("失败") ? t.ansi1 : t.muted).child(state.note))))
    .child(div().flex_1().min_h(0).relative()
      .child(div().id("changes-list-x").size_full().overflow_y_scrollbar()
        .children(rows.map((row) => row.kind === "group"
          ? groupRow(v, row.group, t, cx)
          : fileRow(v, row.file, row.group, t, cx))))
      .child(Scrollbar.vertical("changes-list").viewport_from_layout().absolute().inset_0())
      .when(!rows.length && !state.loading, (e) => e.child(div().absolute().inset_0()
        .child(emptyState(state.hasHead ? "没有未提交的改动" : "仓库还没有提交", "工作区是干净的", t))))
      .when(state.loading && !state.files.length, (e) => e.child(div().absolute().inset_0().child(emptyState("读取工作区…", null, t)))));
}

export function renderChangesDetail(v, t, cx) {
  const state = v.changes;

  const message = h_flex().w_full().flex_none().p(8).gap(6).items_center().border_t(1).border_color(t.border)
    .child(div().flex_1().min_w(0).h(30).px(8).flex().items_center().rounded(7).bg(t.input).border_1().border_color(t.border)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .child(Input.new(state.message).h_full().text_size(11).text_color(t.foreground)))
    .child(textButton("changes-stash", "贮藏", t, (cx) => v.askAction({
      title: "贮藏工作区",
      body: "把当前改动（含未跟踪文件）存入贮藏，工作区恢复干净。",
      run: () => git.write.stash(v.repo.root, v.repo.on, true),
      success: "已贮藏",
      done: (c2) => refreshChanges(v, c2),
    }), { small: true }))
    .child(textButton("changes-stash-pop", "弹出", t, (cx) => v.askAction({
      title: "恢复贮藏",
      body: "应用并删除最近一条贮藏。冲突时会保留。",
      run: () => git.write.stashPop(v.repo.root, v.repo.on),
      success: "已恢复贮藏",
      done: (c2) => refreshChanges(v, c2),
    }), { small: true }))
    .child(textButton("changes-amend", state.amend ? "修补 ✓" : "修补", t, (cx) => {
      state.amend = !state.amend;
      cx.notify();
    }, { small: true, active: state.amend }))
    .child(textButton("changes-commit", state.busy ? "提交中…" : "提交", t, (cx) => {
      const text = state.message.value().trim();
      if (!text) { state.note = "请填写提交信息"; cx.notify(); return; }
      const staged = state.files.filter((file) => file.staged).length;
      if (!staged && !state.amend) { state.note = "没有已暂存的文件"; cx.notify(); return; }
      state.busy = true;
      cx.spawn(async (cx) => {
        const result = await git.write.commit(v.repo.root, v.repo.on, text, state.amend);
        state.busy = false;
        state.note = result.ok ? "提交完成" : `失败：${result.err}`;
        if (result.ok) {
          state.message.set_value("");
          state.amend = false;
          state.selected = null;
          state.diff = null;
          refreshChanges(v, cx);
          if (v.view === "log") loadLogPage(v, cx, true);
        } else {
          cx.notify();
        }
      });
    }, { small: true, primary: true, disabled: state.busy }));

  const diffArea = state.selected
    ? v_flex().flex_1().min_h(0)
      .child(diffHeader(shortPath(state.selected.path, 72), state.diff?.stats, t,
        h_flex().gap(6).items_center()
          .when(state.selected.group === "staged", (e) => e.child(div().text_size(10).text_color(t.dim).child("已暂存")))
          .child(textButton("changes-stage-open", "主区域打开", t,
            (cx) => showInStage(v, cx, changeTarget(state.selected.group, state.selected.path)), { small: true }))))
      .child(div().flex_1().min_h(0).relative()
        .when(state.diffLoading, (e) => e.child(div().absolute().inset_0().flex().items_center().justify_center()
          .child(div().text_size(11).text_color(t.dim).child("加载 diff…"))))
        .when(!state.diffLoading && Boolean(state.diff?.error), (e) => e.child(div().absolute().inset_0().flex().items_center().justify_center()
          .child(div().text_size(11).text_color(t.dim).child(state.diff.error))))
        .when(!state.diffLoading && !state.diff?.error, (e) => e.child(
          renderDiff(state.diff?.rows ?? [], t, "changes-diff", state.diff?.width ?? 600, settings().font_family ?? "monospace"))))
    : div().flex_1().min_h(0).relative()
      .child(div().absolute().inset_0().child(emptyState("选择一个文件", "右侧显示并排 diff", t)));

  return v_flex().size_full().min_h(0)
    .child(diffArea)
    .when(Boolean(state.note), (e) => e.child(h_flex().flex_none().px(10).py(4)
      .child(div().text_size(10).text_color(state.note.startsWith("失败") ? t.ansi1 : t.dim).child(state.note))))
    .child(message);
}
