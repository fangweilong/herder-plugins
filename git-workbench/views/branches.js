// 分支 / 远程 / 标签：树形展开 分支 → 提交 → 文件，右侧看提交详情与并排 diff。

import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { settings } from "herdr";
import * as git from "../git.js";
import { diffStats, loadCommitFiles, loadCommitMeta } from "../git.js";
import { relativeTime } from "../git-parse.js";
import { addDel, chip, emptyState, errorBar, shortPath, statusColor, textButton } from "../ui.js";
import { buildDiffRows, diffContentWidth, diffHeader, renderDiff } from "./diff-view.js";
import { showInStage, syncStage } from "./stage.js";

export function createBranchesState() {
  return {
    list: [],
    loading: false,
    error: "",
    note: "",
    signature: "",
    selectedKey: null,
    openBranches: {},
    commits: {},     // branchKey -> { loading, error, items }
    commitSeq: {},   // branchKey -> generation
    openCommits: {}, // hash -> true
    files: {},       // hash -> { loading, loaded, error, items, meta }
    selectedCommit: null,
    selectedFile: null,
    diff: null,
    diffLoading: false,
    token: 0,
    fileToken: 0,
    initialized: false,
  };
}

function branchKey(branch) {
  return `${branch.kind}:${branch.name}`;
}

function listSignature(list) {
  return list.map((b) => `${branchKey(b)}\0${b.hash}\0${b.current ? 1 : 0}\0${b.ahead}\0${b.behind}`).join("\n");
}

export function ensureBranches(v, cx) {
  if (v.branches.list.length || v.branches.loading) return;
  refreshBranches(v, cx);
}

export function refreshBranches(v, cx, options = {}) {
  if (!v.repo || v.branches.loading) return;
  const silent = Boolean(options.silent);
  const state = v.branches;
  const root = v.repo.root;
  const on = v.repo.on;
  const token = ++state.token;
  if (!silent) {
    state.loading = true;
    cx.notify();
  }
  cx.spawn(async (cx) => {
    const result = await git.loadBranches(root, on);
    if (token !== state.token || v.repo?.root !== root) return;
    state.loading = false;
    if (!result.ok) {
      state.error = result.err;
      cx.notify();
      return;
    }
    state.error = "";
    const signature = listSignature(result.branches);
    if (signature === state.signature) {
      if (!silent) cx.notify();
      return;
    }
    const previous = new Map(state.list.map((b) => [branchKey(b), b.hash]));
    state.list = result.branches;
    state.signature = signature;
    // 分支指向变了就丢掉缓存的提交，展开状态还保留。
    for (const branch of state.list) {
      const key = branchKey(branch);
      if (previous.has(key) && previous.get(key) !== branch.hash) {
        delete state.commits[key];
        if (state.openBranches[key]) loadCommits(v, branch, cx);
      }
    }
    const keys = new Set(state.list.map(branchKey));
    if (!state.selectedKey || !keys.has(state.selectedKey)) {
      const current = state.list.find((b) => b.current) ?? state.list.find((b) => b.kind === "branch");
      state.selectedKey = current ? branchKey(current) : null;
    }
    if (!state.initialized && state.selectedKey) {
      state.initialized = true;
      const current = state.list.find((b) => branchKey(b) === state.selectedKey);
      if (current) {
        state.openBranches[state.selectedKey] = true;
        loadCommits(v, current, cx);
      }
    }
    cx.notify();
  });
}

/** 展开/收起分支，并把它设为当前选中；首次展开时读取提交。 */
function toggleBranch(v, branch, cx) {
  const state = v.branches;
  const key = branchKey(branch);
  const wasSelected = state.selectedKey === key;
  state.selectedKey = key;
  if (wasSelected && state.openBranches[key]) {
    state.openBranches[key] = false;
  } else {
    state.openBranches[key] = true;
    if (!state.commits[key]) loadCommits(v, branch, cx);
  }
  if (state.selectedCommit) {
    state.selectedCommit = null;
    state.selectedFile = null;
    state.diff = null;
  }
  cx.notify();
}

function loadCommits(v, branch, cx) {
  if (!v.repo) return;
  const state = v.branches;
  const key = branchKey(branch);
  if (state.commits[key]?.loading) return;
  const seq = (state.commitSeq[key] = (state.commitSeq[key] ?? 0) + 1);
  state.commits[key] = { loading: true, error: "", items: state.commits[key]?.items ?? [] };
  const root = v.repo.root;
  const on = v.repo.on;
  cx.notify();
  cx.spawn(async (cx) => {
    const result = await git.loadLog(root, on, { limit: 200, rev: branch.name });
    if (seq !== state.commitSeq[key] || v.repo?.root !== root) return;
    state.commits[key] = { loading: false, error: result.ok ? "" : result.err, items: result.ok ? result.commits : [] };
    cx.notify();
  });
}

/** 选中提交并展开它的文件；文件第一次展开时才读取。 */
function expandCommit(v, commit, cx) {
  const state = v.branches;
  const hash = commit.hash;
  if (state.selectedCommit?.hash !== hash) {
    state.selectedCommit = commit;
    state.selectedFile = null;
    state.diff = null;
  }
  state.openCommits[hash] = !state.openCommits[hash];
  if (state.openCommits[hash]) ensureCommitFiles(v, commit, cx);
  cx.notify();
}

function ensureCommitFiles(v, commit, cx) {
  const state = v.branches;
  const hash = commit.hash;
  const cached = state.files[hash];
  if (cached?.loading || cached?.loaded) return;
  state.files[hash] = { loading: true, loaded: false, error: "", items: [], meta: null };
  const root = v.repo.root;
  const on = v.repo.on;
  cx.notify();
  cx.spawn(async (cx) => {
    const meta = await loadCommitMeta(root, on, hash);
    const result = await loadCommitFiles(root, on, hash, meta.parents);
    if (v.repo?.root !== root) return;
    state.files[hash] = {
      loading: false,
      loaded: true,
      error: result.ok ? "" : result.err,
      items: result.ok ? result.files : [],
      meta,
    };
    cx.notify();
    if (state.selectedCommit?.hash === hash && !state.selectedFile && result.ok && result.files.length) {
      selectFile(v, commit, result.files[0].path, cx);
    }
  });
}

/** 分支树里某个提交文件的 diff 目标。 */
function stageTarget(v, commit, path) {
  const base = v.branches.files[commit.hash]?.meta?.parents?.[0] ?? null;
  return {
    kind: "commit",
    base,
    to: commit.hash,
    path,
    label: `${commit.short} 提交`,
    leftLabel: base ? base.slice(0, 7) : "根提交",
    rightLabel: `${commit.short} · ${commit.subject || "(无提交信息)"}`,
  };
}

function selectFile(v, commit, path, cx) {
  if (!v.repo) return;
  const state = v.branches;
  const meta = state.files[commit.hash]?.meta;
  state.selectedCommit = commit;
  state.selectedFile = path;
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
      to: commit.hash,
      path,
    });
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
    syncStage(v, cx, stageTarget(v, commit, path));
    cx.notify();
  });
}

function runWrite(v, cx, action, success) {
  if (!v.repo) return;
  const state = v.branches;
  state.note = "";
  cx.spawn(async (cx) => {
    const result = await action(v.repo.root, v.repo.on);
    state.note = result.ok ? success : `失败：${result.err}`;
    if (result.ok) {
      refreshBranches(v, cx);
      v.refresh(cx);
    } else cx.notify();
  });
}

function branchRow(v, branch, t, cx) {
  const state = v.branches;
  const key = branchKey(branch);
  const open = Boolean(state.openBranches[key]);
  const selected = state.selectedKey === key;
  return h_flex().id(`branch-${branch.kind}-${branch.name}`).w_full().h(36).flex_none().gap(5).px(8)
    .when(selected, (e) => e.bg(t.selected)).hover((style) => style.bg(selected ? t.selected : t.hover))
    .cursor_pointer().on_click((_e, cx) => toggleBranch(v, branch, cx))
    .child(div().w(10).flex_none().text_size(9).text_color(t.dim).child(open ? "▾" : "▸"))
    .child(div().w(10).flex_none().text_size(10).text_color(branch.current ? t.accent : branch.kind === "remote" ? t.dim : t.muted)
      .child(branch.current ? "●" : branch.kind === "tag" ? "▣" : "○"))
    .child(v_flex().flex_1().min_w(0).gap(1)
      .child(h_flex().w_full().gap(4).items_center()
        .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(branch.current ? t.foreground : t.muted).child(branch.name))
        .when(branch.ahead > 0, (e) => e.child(div().text_size(9).text_color(t.ansi2).child(`↑${branch.ahead}`)))
        .when(branch.behind > 0, (e) => e.child(div().text_size(9).text_color(t.ansi1).child(`↓${branch.behind}`)))
        .when(branch.current, (e) => e.child(chip("当前", t.accent, t, { bg: t.accent + "18" }))))
      .child(div().w_full().truncate().text_size(9).text_color(t.dim)
        .child([relativeTime(branch.date), branch.author, branch.subject].filter(Boolean).join(" · "))))
    .tooltip([branch.name, branch.hash, branch.author, branch.date, branch.subject].filter(Boolean).join(" · "));
}

function treeNote(text, t) {
  return h_flex().w_full().h(24).flex_none().pl(28).pr(8).items_center()
    .child(div().text_size(10).text_color(t.dim).child(text));
}

function commitRow(v, key, commit, t, cx) {
  const state = v.branches;
  const selected = state.selectedCommit?.hash === commit.hash;
  const open = Boolean(state.openCommits[commit.hash]);
  return h_flex().id(`branch-commit-${key}-${commit.hash}`).w_full().h(30).flex_none().gap(5).pl(24).pr(8)
    .when(selected, (e) => e.bg(t.selected)).hover((style) => style.bg(selected ? t.selected : t.hover))
    .cursor_pointer().on_click((_e, cx) => expandCommit(v, commit, cx))
    .child(div().w(10).flex_none().text_size(9).text_color(t.dim).child(open ? "▾" : "▸"))
    .child(div().w(8).flex_none().text_size(9).text_color(commit.merge ? t.ansi3 : t.dim).child(commit.merge ? "⑂" : "●"))
    .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(selected ? t.foreground : t.muted).child(commit.subject || "(无提交信息)"))
    .child(div().max_w(76).truncate().flex_none().text_size(9).text_color(t.dim).child(commit.author || ""))
    .child(div().flex_none().text_size(9).text_color(t.dim).child(relativeTime(commit.date)))
    .child(div().flex_none().text_size(9).text_color(t.dim).child(commit.short))
    .tooltip([commit.short, commit.author, commit.date, commit.subject].filter(Boolean).join(" · "));
}

function fileRow(v, key, commit, file, t, cx) {
  const state = v.branches;
  const selected = state.selectedFile === file.path;
  return h_flex().id(`branch-file-${key}-${commit.hash}-${file.path}`).w_full().h(24).flex_none().gap(5).pl(42).pr(8)
    .when(selected, (e) => e.bg(t.selected)).hover((style) => style.bg(selected ? t.selected : t.hover))
    .cursor_pointer().on_click((_e, cx) => selectFile(v, commit, file.path, cx))
    .child(div().w(10).flex_none().text_size(9).font_semibold().text_color(statusColor(file.status, t)).child(file.status))
    .child(div().flex_1().min_w(0).truncate().text_size(10).text_color(selected ? t.foreground : t.muted).child(file.path))
    .child(addDel(file.add, file.del, t));
}

function treeRows(v, state, t, cx) {
  const rows = [];
  for (const [kind, label] of [["branch", "本地分支"], ["remote", "远程分支"], ["tag", "标签"]]) {
    const items = state.list.filter((branch) => branch.kind === kind);
    if (!items.length) continue;
    rows.push(h_flex().w_full().h(30).flex_none().px(8).gap(6).items_center().bg(t.chrome)
      .child(div().text_size(10).font_semibold().text_color(t.dim).child(`${label} (${items.length})`)));
    for (const branch of items) {
      const key = branchKey(branch);
      rows.push(branchRow(v, branch, t, cx));
      if (!state.openBranches[key]) continue;
      const cache = state.commits[key];
      if (!cache || cache.loading) {
        rows.push(treeNote("加载提交…", t));
        continue;
      }
      if (cache.error) {
        rows.push(treeNote(cache.error, t));
        continue;
      }
      if (!cache.items.length) {
        rows.push(treeNote("没有提交", t));
        continue;
      }
      for (const commit of cache.items) {
        rows.push(commitRow(v, key, commit, t, cx));
        if (!state.openCommits[commit.hash]) continue;
        const files = state.files[commit.hash];
        if (!files || files.loading) rows.push(treeNote("加载文件…", t));
        else if (files.error) rows.push(treeNote(files.error, t));
        else if (!files.items.length) rows.push(treeNote("没有文件改动", t));
        else rows.push(...files.items.map((file) => fileRow(v, key, commit, file, t, cx)));
      }
    }
  }
  return rows;
}

export function renderBranchesList(v, t, cx) {
  const state = v.branches;
  const rows = treeRows(v, state, t, cx);
  const header = h_flex().w_full().flex_none().h(34).px(10).gap(6).items_center().border_b(1).border_color(t.border)
    .child(div().text_size(11).font_semibold().text_color(t.muted).child("分支"))
    .child(div().text_size(10).text_color(t.dim).child(`${state.list.length}`))
    .child(div().flex_1())
    .child(textButton("branch-new", "新建", t, (cx) => {
      const selected = state.list.find((item) => branchKey(item) === state.selectedKey);
      v.askAction({
        title: "新建分支",
        body: selected ? `从 ${selected.name} 创建并切换` : "从当前 HEAD 创建并切换",
        input: { placeholder: "分支名" },
        run: (_c2, name) => git.write.createBranch(v.repo.root, v.repo.on, name, selected?.name ?? "HEAD"),
        success: "已创建并切换分支",
        done: (c2) => refreshBranches(v, c2),
      });
    }, { small: true }))
    .child(div().id("branch-refresh").text_size(11).text_color(t.muted).cursor_pointer()
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => refreshBranches(v, cx)).child("刷新"));

  return v_flex().size_full().min_h(0).bg(t.surface)
    .child(header)
    .when(Boolean(state.error), (e) => e.child(errorBar(state.error, t)))
    .child(div().flex_1().min_h(0).relative()
      .child(div().id("branch-list-x").size_full().overflow_y_scrollbar().children(rows))
      .when(!rows.length && !state.loading, (e) => e.child(div().absolute().inset_0()
        .child(emptyState("没有分支", null, t))))
      .when(state.loading && !state.list.length, (e) => e.child(div().absolute().inset_0()
        .child(emptyState("读取分支…", null, t)))));
}

function toolbar(v, branch, t, cx) {
  const local = branch.kind === "branch";
  const root = () => v.repo.root;
  const on = () => v.repo.on;
  return h_flex().w_full().flex_none().gap(6).px(10).py(6).border_b(1).border_color(t.border)
    .when(local && !branch.current, (e) => e.child(textButton("branch-switch", "切换", t, (cx) => v.askAction({
      title: "切换分支",
      body: `切换到 ${branch.name}？未提交的改动会被带过去。`,
      run: () => git.write.switchBranch(root(), on(), branch.name),
      success: "已切换分支",
      done: (c2) => { refreshBranches(v, c2); v.refresh(c2); },
    }), { small: true, primary: true })))
    .when(local && !branch.current, (e) => e.child(textButton("branch-merge", "合并", t, (cx) => v.askAction({
      title: "合并分支",
      body: `把 ${branch.name} 合并到当前分支？`,
      run: () => git.write.merge(root(), on(), branch.name),
      success: "合并完成",
      done: (c2) => refreshBranches(v, c2),
    }), { small: true })))
    .when(local && !branch.current, (e) => e.child(textButton("branch-rebase", "变基", t, (cx) => v.askAction({
      title: "变基",
      body: `把当前分支变基到 ${branch.name}？这会改写当前分支的提交。`,
      danger: true,
      run: () => git.write.rebase(root(), on(), branch.name),
      success: "变基完成",
      done: (c2) => refreshBranches(v, c2),
    }), { small: true, danger: true })))
    .when(local && !branch.current, (e) => e.child(textButton("branch-delete", "删除", t, (cx) => v.askAction({
      title: "删除分支",
      body: `删除 ${branch.name}？未合并的分支会被拒绝。`,
      danger: true,
      run: () => git.write.deleteBranch(root(), on(), branch.name),
      success: "已删除分支",
      done: (c2) => refreshBranches(v, c2),
    }), { small: true, danger: true })))
    .when(branch.kind === "tag", (e) => e.child(textButton("tag-delete", "删除标签", t, (cx) => v.askAction({
      title: "删除标签",
      body: `删除标签 ${branch.name}？`,
      danger: true,
      run: () => git.write.deleteTag(root(), on(), branch.name),
      success: "已删除标签",
      done: (c2) => refreshBranches(v, c2),
    }), { small: true, danger: true })))
    .child(div().flex_1())
    .child(textButton("git-fetch", "获取", t, (cx) => runWrite(v, cx, (r, o) => git.write.fetch(r, o), "获取完成"), { small: true }))
    .child(textButton("git-pull", "拉取", t, (cx) => v.askAction({
      title: "拉取",
      body: "git pull --ff-only：不能快进时会失败，不会产生合并提交。",
      run: () => git.write.pull(root(), on()),
      success: "拉取完成",
      done: (c2) => refreshBranches(v, c2),
    }), { small: true }))
    .child(textButton("git-push", "推送", t, (cx) => v.askAction({
      title: "推送",
      body: "推送到当前分支配置的远程？",
      run: () => git.write.push(root(), on()),
      success: "推送完成",
      done: (c2) => refreshBranches(v, c2),
    }), { small: true }));
}

function commitHeader(v, commit, t, cx) {
  return v_flex().w_full().flex_none().gap(3).px(12).py(8).border_b(1).border_color(t.border).bg(t.chrome)
    .child(h_flex().w_full().gap(8).items_center()
      .child(div().flex_1().min_w(0).truncate().text_size(12).font_semibold().text_color(t.foreground)
        .child(commit.subject || "(无提交信息)"))
      .child(textButton("branch-commit-cherry", "拣选", t, (cx) => v.askAction({
        title: "拣选提交",
        body: `把 ${commit.short} 应用到当前分支？`,
        run: () => git.write.cherryPick(v.repo.root, v.repo.on, commit.hash),
        success: "拣选完成",
        done: (c2) => refreshBranches(v, c2),
      }), { small: true }))
      .child(textButton("branch-commit-revert", "还原", t, (cx) => v.askAction({
        title: "还原提交",
        body: `生成一个反向提交撤销 ${commit.short}？`,
        run: () => git.write.revert(v.repo.root, v.repo.on, commit.hash),
        success: "还原完成",
        done: (c2) => refreshBranches(v, c2),
      }), { small: true, danger: true })))
    .child(h_flex().gap(8).items_center()
      .child(div().text_size(10).text_color(t.muted).child(commit.author))
      .child(div().text_size(10).text_color(t.dim).child(relativeTime(commit.date)))
      .child(div().text_size(10).text_color(t.dim).font_family(settings().font_family ?? "monospace").child(commit.short))
      .child(div().flex_1())
      .child(div().text_size(10).text_color(t.dim).child(commit.parents?.length > 1 ? `${commit.parents.length} 个父提交` : "")));
}

export function renderBranchesDetail(v, t, cx) {
  const state = v.branches;
  const branch = state.list.find((item) => branchKey(item) === state.selectedKey);
  const commit = state.selectedCommit;
  const file = commit && state.selectedFile
    ? state.files[commit.hash]?.items.find((item) => item.path === state.selectedFile)
    : null;

  if (!branch && !commit) return emptyState("选择一个分支", "左侧展开分支查看提交与文件", t);

  return v_flex().size_full().min_h(0)
    .when(Boolean(branch), (e) => e
      .child(h_flex().w_full().flex_none().h(34).px(10).gap(8).items_center().border_b(1).border_color(t.border).bg(t.chrome)
        .child(div().text_size(12).font_semibold().text_color(t.foreground).child(branch.name))
        .child(chip(branch.kind === "remote" ? "远程" : branch.kind === "tag" ? "标签" : "本地", t.muted, t))
        .when(branch.current, (e) => e.child(chip("当前分支", t.accent, t, { bg: t.accent + "18" })))
        .child(div().flex_1())
        .when(Boolean(branch.upstream), (e) => e.child(div().text_size(9).text_color(t.dim).child(`↗ ${branch.upstream}`))))
      .child(toolbar(v, branch, t, cx)))
    .when(Boolean(state.note), (e) => e.child(h_flex().w_full().flex_none().px(10).py(4)
      .child(div().text_size(10).text_color(state.note.startsWith("失败") ? t.ansi1 : t.dim).child(state.note))))
    .when(Boolean(commit), (e) => e.child(commitHeader(v, commit, t, cx)))
    .when(Boolean(file), (e) => e.child(diffHeader(shortPath(file.path, 72), state.diff?.stats, t,
      textButton("branch-stage-open", "主区域打开", t,
        (cx) => showInStage(v, cx, stageTarget(v, commit, file.path)), { small: true }))))
    .child(div().flex_1().min_h(0).relative()
      .when(!commit, (e) => e.child(div().absolute().inset_0()
        .child(emptyState(state.selectedKey && state.openBranches[state.selectedKey] ? "选择提交" : "展开分支",
          state.selectedKey && state.openBranches[state.selectedKey]
            ? "点左侧提交查看改动文件"
            : "点分支看提交，点提交看文件，点文件看并排 diff", t))))
      .when(Boolean(commit) && !file, (e) => e.child(div().absolute().inset_0()
        .child(emptyState("选择一个文件", "左侧提交下的文件", t))))
      .when(Boolean(file) && state.diffLoading, (e) => e.child(div().absolute().inset_0().flex().items_center().justify_center()
        .child(div().text_size(11).text_color(t.dim).child("加载 diff…"))))
      .when(Boolean(file) && !state.diffLoading && Boolean(state.diff?.error), (e) => e.child(div().absolute().inset_0().flex().items_center().justify_center()
        .child(div().text_size(11).text_color(t.dim).child(state.diff.error))))
      .when(Boolean(file) && !state.diffLoading && !state.diff?.error, (e) => e.child(
        renderDiff(state.diff?.rows ?? [], t, "branch-diff", state.diff?.width ?? 600, settings().font_family ?? "monospace"))));
}
