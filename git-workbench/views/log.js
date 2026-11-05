// 提交历史：左侧提交列表，右侧提交详情 + 文件列表 + 并排 diff。

import { div } from "gpui-kit";
import { h_flex, v_flex, Input, InputState, Scrollbar, v_virtual_list } from "gpui-base";
import { settings } from "herdr";
import * as git from "../git.js";
import { diffStats } from "../git.js";
import { relativeTime } from "../git-parse.js";
import { addDel, chip, emptyState, errorBar, sectionTitle, shortPath, statusColor, textButton } from "../ui.js";
import { buildDiffRows, diffContentWidth, diffHeader, renderDiff } from "./diff-view.js";
import { showInStage, syncStage } from "./stage.js";

const PAGE = 150;

export function createLogState() {
  const filter = InputState.new({ placeholder: "搜索提交信息 / 作者 / hash" });
  return {
    commits: [],
    loading: false,
    error: "",
    hasMore: true,
    filter,
    filterText: "",
    selected: null,
    detail: null,
    files: [],
    file: null,
    diff: null,
    diffLoading: false,
    commitLoading: false,
    token: 0,
    fileToken: 0,
  };
}

/** 首次进入视图，或切换仓库后加载第一页。 */
export function ensureLog(v, cx) {
  if (v.log.commits.length || v.log.loading) return;
  loadLogPage(v, cx, true);
}

export function loadLogPage(v, cx, reset = false) {
  if (!v.repo || v.log.loading) return;
  const state = v.log;
  const root = v.repo.root;
  const on = v.repo.on;
  const token = ++state.token;
  if (reset) {
    // 保留当前列表与选中项，等新数据回来再替换，避免后台刷新时列表闪空。
    state.hasMore = true;
    state.error = "";
  }
  state.loading = true;
  cx.notify();
  cx.spawn(async (cx) => {
    const result = await git.loadLog(root, on, { limit: PAGE, skip: reset ? 0 : state.commits.length });
    if (token !== state.token || v.repo?.root !== root) return;
    state.loading = false;
    if (!result.ok) {
      state.error = /does not have any commits yet|bad revision/i.test(result.err) ? "仓库还没有提交" : result.err;
      state.hasMore = false;
      cx.notify();
      return;
    }
    state.commits = reset ? result.commits : [...state.commits, ...result.commits];
    state.hasMore = result.commits.length === PAGE;
    const kept = state.selected && state.commits.some((item) => item.hash === state.selected);
    if (kept) {
      cx.notify();
    } else {
      if (state.selected) {
        state.selected = null;
        state.detail = null;
        state.files = [];
        state.file = null;
        state.diff = null;
      }
      if (state.commits.length) readCommit(v, state.commits[0].hash, cx);
      else cx.notify();
    }
  });
}

/**
 * 选中提交，加载说明与文件列表。
 * explicit 表示用户主动点选：只有主动点选才同步主区域。
 */
export function readCommit(v, hash, cx, explicit = false) {
  if (!v.repo) return;
  const state = v.log;
  state.selected = hash;
  state.detail = null;
  state.files = [];
  state.file = null;
  state.diff = null;
  state.commitLoading = true;
  const token = ++state.token;
  const root = v.repo.root;
  const on = v.repo.on;
  cx.notify();
  cx.spawn(async (cx) => {
    const meta = await git.loadCommitMeta(root, on, hash);
    const files = await git.loadCommitFiles(root, on, hash, meta.parents);
    if (token !== state.token || v.repo?.root !== root || state.selected !== hash) return;
    state.detail = meta;
    state.files = files.ok ? files.files : [];
    state.commitLoading = false;
    if (!files.ok) state.error = files.err;
    cx.notify();
    if (state.files.length) readCommitFile(v, state.files[0].path, cx, explicit);
  });
}

/** 当前选中提交里某个文件的 diff 目标。 */
function commitTarget(v, path) {
  const state = v.log;
  const base = state.detail?.parents?.[0] ?? null;
  const commit = state.commits.find((item) => item.hash === state.selected);
  /** @type {string} */
  const hash = state.selected ?? "";
  return {
    kind: "commit",
    base,
    to: state.selected,
    path,
    label: `${hash.slice(0, 7)} 提交`,
    leftLabel: base ? base.slice(0, 7) : "根提交",
    rightLabel: commit ? `${commit.short} · ${commit.subject || "(无提交信息)"}` : hash.slice(0, 7),
  };
}

/** 加载提交中某个文件的 diff。explicit 同 readCommit。 */
export function readCommitFile(v, path, cx, explicit = false) {
  const state = v.log;
  if (!v.repo || state.selected == null) return;
  const meta = state.detail;
  const hash = state.selected;
  state.file = path;
  state.diff = null;
  state.diffLoading = true;
  const token = ++state.fileToken;
  const root = v.repo.root;
  const on = v.repo.on;
  cx.notify();
  cx.spawn(async (cx) => {
    const result = await git.loadFileDiff(root, on, {
      kind: "commit",
      base: meta?.parents?.[0] ?? null,
      to: hash,
      path,
    });
    if (token !== state.fileToken || v.repo?.root !== root || state.file !== path) return;
    state.diffLoading = false;
    if (!result.ok) {
      state.diff = { error: result.err, rows: [], width: 600, stats: { add: 0, del: 0 } };
    } else {
      const rows = buildDiffRows(result.parsed);
      state.diff = {
        error: result.parsed?.binary ? "二进制文件，没有文本 diff" : result.parsed?.empty ? "没有可显示的文本差异（可能只改了模式）" : "",
        rows,
        width: diffContentWidth(rows),
        stats: diffStats(result.parsed),
        truncated: result.truncated,
      };
    }
    if (explicit) syncStage(v, cx, commitTarget(v, path));
    cx.notify();
  });
}

function filtered(state) {
  const query = state.filterText.trim().toLowerCase();
  if (!query) return state.commits;
  return state.commits.filter((commit) =>
    commit.subject.toLowerCase().includes(query) ||
    commit.author.toLowerCase().includes(query) ||
    commit.hash.startsWith(query) ||
    commit.refs.some((ref) => ref.name.toLowerCase().includes(query)));
}

function refBadge(ref, t) {
  const color = ref.kind === "tag" ? t.ansi3 : ref.head ? t.accent : ref.kind === "remote" ? t.muted : t.ansi4;
  return chip(ref.name, color, t, { truncate: true });
}

function commitRow(v, commit, t, cx) {
  const selected = v.log.selected === commit.hash;
  return h_flex().id(`log-${commit.hash}`).w_full().h(48).flex_none().gap(8).px(8)
    .when(selected, (e) => e.bg(t.selected)).hover((s) => s.bg(selected ? t.selected : t.hover))
    .cursor_pointer().on_click((_e, cx) => readCommit(v, commit.hash, cx, true))
    .child(div().w(2).h(30).flex_none().rounded(1).when(selected, (e) => e.bg(t.accent)))
    .child(v_flex().flex_1().min_w(0).gap(3)
      .child(h_flex().w_full().gap(5).items_center()
        .child(div().text_size(10).text_color(commit.merge ? t.ansi3 : t.dim).child(commit.merge ? "⑂" : "●"))
        .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(selected ? t.foreground : t.foreground).child(commit.subject || "(无提交信息)"))
        .children(commit.refs.slice(0, 2).map((ref) => refBadge(ref, t))))
      .child(h_flex().w_full().gap(6).items_center()
        .child(div().flex_1().min_w(0).truncate().text_size(10).text_color(t.dim).child(`${commit.author} · ${relativeTime(commit.date)}`))
        .child(div().text_size(10).text_color(t.muted).font_family(settings().font_family ?? "monospace").child(commit.short))));
}

export function renderLogList(v, t, cx) {
  const state = v.log;
  const commits = filtered(state);
  const header = h_flex().w_full().flex_none().h(34).px(10).gap(6).items_center().border_b(1).border_color(t.border)
    .child(div().text_size(11).font_semibold().text_color(t.muted).child("提交"))
    .child(div().text_size(10).text_color(t.dim).child(`${state.commits.length}${state.hasMore ? "+" : ""}`))
    .child(div().flex_1())
    .child(div().id("log-refresh").text_size(11).text_color(t.muted).cursor_pointer()
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => loadLogPage(v, cx, true)).child("刷新"));

  return v_flex().size_full().min_h(0).bg(t.surface)
    .child(header)
    .child(h_flex().flex_none().h(36).px(8).items_center().border_b(1).border_color(t.border)
      .child(div().flex_1().h(26).px(8).flex().items_center().rounded(6).bg(t.input).border_1().border_color(t.border)
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .child(Input.new(state.filter).h_full().text_size(11).text_color(t.foreground))))
    .when(Boolean(state.error), (e) => e.child(errorBar(state.error, t)))
    .child(div().flex_1().min_h(0).relative()
      .child(div().id("log-list-x").size_full().overflow_y_scrollbar().child(
        v_virtual_list("log-list", commits.length, 48, (index) => commits[index]?.hash ?? String(index),
          (range) => commits.slice(range.start, range.end).map((commit) => commitRow(v, commit, t, cx)))))
      .child(Scrollbar.vertical("log-list").viewport_from_layout().absolute().inset_0())
      .when(!commits.length && !state.loading, (e) => e.child(div().absolute().inset_0().child(emptyState(
        state.filterText ? "没有匹配的提交" : "没有提交",
        state.filterText ? "换个关键词试试" : null, t))))
      .when(state.loading && !state.commits.length, (e) => e.child(div().absolute().inset_0().child(emptyState("加载提交…", null, t)))))
    .when(state.hasMore && !state.filterText, (e) => e.child(h_flex().flex_none().h(30).justify_center().items_center()
      .child(div().id("log-more").text_size(11).text_color(t.accent).cursor_pointer()
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => loadLogPage(v, cx, false)).child(state.loading ? "加载中…" : "加载更多"))));
}

function metaLine(label, value, t) {
  return h_flex().gap(6).items_center()
    .child(div().w(42).flex_none().text_size(10).text_color(t.dim).child(label))
    .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.muted).child(value));
}

function fileRow(v, file, t, cx) {
  const selected = v.log.file === file.path;
  return h_flex().id(`log-file-${file.path}`).w_full().h(26).flex_none().gap(6).px(8)
    .when(selected, (e) => e.bg(t.selected)).hover((s) => s.bg(selected ? t.selected : t.hover))
    .cursor_pointer().on_click((_e, cx) => readCommitFile(v, file.path, cx, true))
    .child(div().w(12).flex_none().text_size(10).font_semibold().text_color(statusColor(file.status, t)).child(file.status))
    .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(selected ? t.foreground : t.muted).child(file.path))
    .child(addDel(file.add, file.del, t))
    .child(textButton(`blame-${file.path}`, "追溯", t, (cx) => v.showBlame(file.path, cx), { small: true }));
}

export function renderLogDetail(v, t, cx) {
  const state = v.log;
  if (!state.selected) return emptyState("选择一个提交", "左侧列表显示提交历史", t);
  const commit = state.commits.find((c) => c.hash === state.selected);
  const detail = state.detail;

  const header = v_flex().w_full().flex_none().gap(6).p(12).border_b(1).border_color(t.border)
    .child(h_flex().w_full().gap(8).items_center()
      .child(div().flex_1().min_w(0).text_size(14).font_semibold().text_color(t.foreground).child(commit?.subject ?? "(无提交信息)"))
      .child(textButton("commit-cherry-pick", "拣选", t, (cx) => v.askAction({
        title: "拣选提交",
        body: `把 ${commit?.short} 应用到当前分支？`,
        run: (c2) => git.write.cherryPick(v.repo.root, v.repo.on, state.selected),
        done: (c2) => readCommit(v, state.selected, c2),
      }), { small: true }))
      .child(textButton("commit-revert", "还原", t, (cx) => v.askAction({
        title: "还原提交",
        body: `生成一个反向提交撤销 ${commit?.short}？`,
        run: () => git.write.revert(v.repo.root, v.repo.on, state.selected),
        done: (c2) => v.refresh(c2),
      }), { small: true, danger: true }))
      .child(textButton("commit-reset", "重置…", t, (cx) => v.askAction({
        title: "重置到该提交",
        body: "输入 soft / mixed / hard（默认 mixed）。hard 会丢弃工作区与暂存区的改动。",
        danger: true,
        input: { placeholder: "mixed", value: "mixed" },
        run: (c2, mode) => git.write.reset(v.repo.root, v.repo.on,
          ["soft", "mixed", "hard"].includes(mode) ? mode : "mixed", state.selected),
        success: "重置完成",
        done: (c2) => { loadLogPage(v, c2, true); v.refresh(c2); },
      }), { small: true, danger: true }))
      .child(textButton("commit-tag", "标签…", t, (cx) => v.askAction({
        title: "创建标签",
        body: `在 ${commit?.short} 上创建轻量标签`,
        input: { placeholder: "标签名，例如 v1.0.0" },
        run: (c2, name) => git.write.tag(v.repo.root, v.repo.on, name, state.selected),
        success: "标签已创建",
        done: (c2) => readCommit(v, state.selected, c2),
      }), { small: true })))
    .child(h_flex().w_full().gap(8).items_center()
      .child(div().text_size(11).text_color(t.muted).child(commit?.author ?? ""))
      .child(div().text_size(10).text_color(t.dim).child(commit ? relativeTime(commit.date) : ""))
      .child(div().text_size(10).text_color(t.dim).font_family(settings().font_family ?? "monospace").child(commit?.short ?? ""))
      .child(div().flex_1())
      .child(div().text_size(10).text_color(t.dim).child(commit?.parents?.length ? `${commit.parents.length} 个父提交` : "")))
    .when(Boolean(commit?.refs?.length), (e) => e.child(h_flex().gap(4).children(commit.refs.map((ref) => refBadge(ref, t)))))
    .when(Boolean(detail?.body && detail.body !== commit?.subject), (e) => e.child(div().text_size(11).text_color(t.muted).child(detail.body)));

  const files = state.files;
  const filePanel = v_flex().w_full().flex_none().border_b(1).border_color(t.border)
    .child(sectionTitle(`改动 ${files.length} 个文件`, t))
    .child(div().w_full().flex_none().max_h(164).overflow_y_scrollbar()
      .children(files.map((file) => fileRow(v, file, t, cx))))
    .when(!files.length && state.commitLoading, (e) => e.child(div().p(10).text_size(11).text_color(t.dim).child("加载改动…")))
    .when(!files.length && !state.commitLoading, (e) => e.child(div().p(10).text_size(11).text_color(t.dim).child("这个提交没有文件改动")));

  const diffArea = state.file
    ? v_flex().flex_1().min_h(0)
      .child(diffHeader(shortPath(state.file, 72), state.diff?.stats, t,
        textButton("log-stage-open", "主区域打开", t,
          (cx) => showInStage(v, cx, commitTarget(v, state.file)), { small: true })))
      .child(div().flex_1().min_h(0).relative()
        .when(state.diffLoading, (el) => el.child(div().absolute().inset_0().flex().items_center().justify_center()
          .child(div().text_size(11).text_color(t.dim).child("加载 diff…"))))
        .when(!state.diffLoading && Boolean(state.diff?.error), (el) => el.child(div().absolute().inset_0().flex().items_center().justify_center()
          .child(div().text_size(11).text_color(t.dim).child(state.diff.error))))
        .when(!state.diffLoading && !state.diff?.error, (el) => el.child(
          renderDiff(state.diff?.rows ?? [], t, "log-diff", state.diff?.width ?? 600, settings().font_family ?? "monospace"))))
    : div().flex_1().min_h(0).relative()
      .child(div().absolute().inset_0().child(emptyState(state.commitLoading ? "加载提交…" : "选择一个文件", "右侧显示并排 diff", t)));

  return v_flex().size_full().min_h(0).child(header).child(filePanel).child(diffArea);
}
