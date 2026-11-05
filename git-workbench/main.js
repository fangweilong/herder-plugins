// Git Workbench：提交历史、工作区变更、分支、提交对比与 blame。
// 默认停靠在右侧「更改」面板，跟随当前终端所在仓库；也兼容浮层模式（props.overlay）。

import { View, div } from "gpui-kit";
import { v_flex, h_flex, Input, InputState, h_resizable, v_resizable, resizable_panel } from "gpui-base";
import {
  closeOverlay,
  focused,
  nextCommand,
  notify,
  panes,
  pickFolder,
  props,
  spaces,
  theme,
  watchFolder,
} from "herdr";
import * as git from "./git.js";
import { createLogState, ensureLog, loadLogPage, readCommit, renderLogDetail, renderLogList } from "./views/log.js";
import { createChangesState, ensureChanges, refreshChanges, renderChangesDetail, renderChangesList } from "./views/changes.js";
import { createBranchesState, ensureBranches, refreshBranches, renderBranchesDetail, renderBranchesList } from "./views/branches.js";
import { createCompareState, ensureCompare, openCompareStage, renderCompareDetail, renderCompareList } from "./views/compare.js";
import { createStageState, ensureStage, followEnabled, renderStage, setFollowEnabled } from "./views/stage.js";
import { createBlameState, ensureBlame, renderBlame, showBlame as openBlame } from "./views/blame.js";
import { textButton } from "./ui.js";

const VIEWS = [
  { id: "log", label: "历史" },
  { id: "changes", label: "变更" },
  { id: "branches", label: "分支" },
  { id: "compare", label: "对比" },
  { id: "blame", label: "追溯" },
];

const TICK_MS = 5000;

export default class GitWorkbench extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    const boot = props() || {};
    // 主区域的「Git 对比」标签页：只跟随 shared 里的目标，不做仓库定位与轮询。
    this.stageMode = Boolean(boot.stage);
    if (this.stageMode) {
      this.view = "compare";
      this.repo = null;
      this.error = "";
      this.stage = createStageState();
      // 同一窗口可能有多个对比标签页，元素 id 必须各不相同。
      this.stageDiffId = `stage-diff-${Math.random().toString(36).slice(2, 8)}`;
      ensureStage(this, cx);
      cx.timer.every(500, (cx) => ensureStage(this, cx));
      return;
    }
    // 布局里作为右侧面板（无 overlay）时跟随当前终端仓库；也保留浮层模式。
    this.docked = !boot.overlay;
    const initialView = boot.view;
    this.view = VIEWS.some((item) => item.id === initialView) ? initialView : readStored("view", "log");
    this.narrow = false;
    this.focusKey = null;
    this.followToken = 0;
    this.repo = null;
    this.locating = true;
    this.error = "";
    this.noteText = "";
    this.confirm = null;
    this.confirmInput = null;
    this.confirmBusy = false;
    this.lastRefresh = 0;

    this.log = createLogState();
    this.log.filter.on("change", (_event, cx) => {
      this.log.filterText = this.log.filter.value();
      cx.notify();
    });
    this.changes = createChangesState();
    this.branches = createBranchesState();
    this.compare = createCompareState();
    this.blame = createBlameState();
    this.blame.filter.on("change", (_event, cx) => cx.notify());

    this.locate(cx);
    cx.timer.every(TICK_MS, (cx) => this.tick(cx));
    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        if (VIEWS.some((item) => item.id === command)) this.setView(command, cx);
        else if (command === "blame-file") {
          const path = this.log?.file || this.changes?.selected?.path;
          if (path) this.showBlame(path, cx);
        } else if (command === "open-compare") {
          this.setView("compare", cx);
          this.pendingStage = true;
          if (this.compare.files.length) {
            this.pendingStage = false;
            openCompareStage(this, cx);
          }
        } else if (command === "refresh") {
          this.refresh(cx);
        }
        cx.notify();
      }
    });
    this.watch(cx);

    if (this.view === "log") ensureLog(this, cx);
  }

  // ---- 仓库定位与刷新 -----------------------------------------------------

  locate(cx) {
    const f = focused();
    const space = spaces().find((item) => item.id === f?.space) ?? spaces().find((item) => item.active);
    const pane = f?.pane ? panes().find((item) => item.pane === f.pane) : null;
    const cwd = pane?.cwd || f?.cwd || space?.folder || null;
    const on = space?.machine ?? null;
    if (!cwd) {
      this.locating = false;
      this.error = "当前终端没有文件夹";
      cx.notify();
      return;
    }
    this.locating = true;
    cx.spawn(async (cx) => {
      const repo = await git.findRepo(cwd, on);
      this.locating = false;
      if (!repo) {
        this.repo = null;
        this.error = `不是 Git 仓库：${cwd}`;
        cx.notify();
        return;
      }
      this.adopt(repo, cx);
    });
  }

  adopt(repo, cx) {
    this.repo = repo;
    this.error = "";
    this.view = this.view || "log";
    this.log = createLogState();
    this.log.filter.on("change", (_event, cx) => {
      this.log.filterText = this.log.filter.value();
      cx.notify();
    });
    this.changes = createChangesState();
    this.branches = createBranchesState();
    this.compare = createCompareState();
    this.blame = createBlameState();
    this.blame.filter.on("change", (_event, cx) => cx.notify());
    this.refresh(cx);
    this.watch(cx);
    ensureLog(this, cx);
    if (this.view === "changes") ensureChanges(this, cx);
    if (this.view === "branches") ensureBranches(this, cx);
    if (this.view === "compare") ensureCompare(this, cx);
    if (this.view === "blame") ensureBlame(this, cx);
    cx.notify();
  }

  tick(cx) {
    if (this.locating) return;
    if (this.docked) this.followFocus(cx);
    if (!this.repo) {
      if (!this.error) this.locate(cx);
      return;
    }
    // 后台轮询保持静默：只有仓库头信息真的变了才重绘、才重载列表。
    this.refresh(cx, { silent: true });
  }

  /** 刷新：主流视图不重建列表，避免每 5 秒闪一次。 */
  refresh(cx, options = {}) {
    const silent = Boolean(options.silent);
    if (!this.repo) {
      this.locate(cx);
      return;
    }
    const root = this.repo.root;
    const on = this.repo.on;
    this.lastRefresh = Date.now();
    cx.spawn(async (cx) => {
      const info = await git.findRepo(root, on);
      if (!info || this.repo?.root !== root) return;
      const headChanged = this.repo.head !== info.head;
      const branchChanged = this.repo.branch !== info.branch;
      this.repo = { ...this.repo, ...info };
      // 手动刷新给状态栏反馈；后台轮询只在数据变化时重绘。
      if (!silent || headChanged || branchChanged) cx.notify();
      if (headChanged) {
        if (this.view === "log") loadLogPage(this, cx, true);
        if (this.view === "branches") refreshBranches(this, cx);
      }
    });
    if (this.view === "changes") refreshChanges(this, cx, { silent });
  }

  /** 仓库目录变化后刷新；.git 内的写入也会触发，用节流挡住风暴。 */
  watch(cx) {
    this.watchGen = (this.watchGen ?? 0) + 1;
    const generation = this.watchGen;
    cx.spawn(async (cx) => {
      for (;;) {
        if (generation !== this.watchGen) return;
        const root = this.repo?.root;
        if (!root) { await delay(cx, 1500); continue; }
        try {
          await watchFolder(root);
        } catch {
          await delay(cx, 2000);
          continue;
        }
        if (generation !== this.watchGen || this.repo?.root !== root) continue;
        // 一次提交会带来一串 .git 事件，先等它们合并成一批再读。
        await delay(cx, 250);
        if (generation !== this.watchGen || this.repo?.root !== root) continue;
        if (Date.now() - this.lastRefresh < 400) continue;
        this.refresh(cx, { silent: true });
      }
    });
  }

  /** 停靠面板跟随当前终端：切到别的仓库时重载；同仓库内切换不打断浏览。 */
  followFocus(cx) {
    if (!this.docked) return;
    const f = focused();
    const space = spaces().find((item) => item.id === f?.space);
    const pane = f?.pane ? panes().find((item) => item.pane === f.pane) : null;
    const cwd = pane?.cwd || f?.cwd || null;
    const key = `${f?.space ?? ""}|${f?.pane ?? ""}|${cwd ?? ""}`;
    if (key === this.focusKey) return;
    this.focusKey = key;
    if (!cwd) return;
    const root = this.repo?.root;
    const inside = root && (cwd === root || cwd.startsWith(root + "/") || cwd.startsWith(root + "\\"));
    if (inside) return;
    const token = ++this.followToken;
    const on = space?.machine ?? null;
    cx.spawn(async (cx) => {
      const repo = await git.findRepo(cwd, on);
      if (token !== this.followToken || !repo || repo.root === this.repo?.root) return;
      this.adopt(repo, cx);
    });
  }

  setView(id, cx) {
    this.view = id;
    writeStored("view", id);
    if (id === "log") ensureLog(this, cx);
    if (id === "changes") ensureChanges(this, cx);
    if (id === "branches") ensureBranches(this, cx);
    if (id === "compare") ensureCompare(this, cx);
    if (id === "blame") ensureBlame(this, cx);
    cx.notify();
  }

  locateOther(cx) {
    cx.spawn(async (cx) => {
      const folder = await pickFolder({ prompt: "选择 Git 仓库" }).catch(() => null);
      if (!folder) return;
      const repo = await git.findRepo(folder, null);
      if (!repo) {
        notify({ title: "不是 Git 仓库", body: folder, level: "warning" });
        return;
      }
      this.adopt(repo, cx);
    });
  }

  // ---- 确认与操作 ---------------------------------------------------------

  /**
   * 弹出确认框。run 返回 {ok, err}；危险操作使用 danger 样式。
   * input 存在时，run 的第二个参数是输入框内容。
   */
  askAction(spec) {
    this.confirm = spec;
    this.confirmBusy = false;
    this.confirmInput = spec.input
      ? InputState.new({ placeholder: spec.input.placeholder ?? "", value: spec.input.value ?? "" })
      : null;
  }

  runConfirm(cx) {
    const spec = this.confirm;
    if (!spec || this.confirmBusy) return;
    if (spec.input && !this.confirmInput?.value().trim()) {
      this.noteText = "请先填写内容";
      cx.notify();
      return;
    }
    this.confirmBusy = true;
    const text = this.confirmInput?.value().trim() ?? "";
    cx.notify();
    cx.spawn(async (cx) => {
      let result;
      try {
        result = await spec.run(cx, text);
      } catch (error) {
        result = { ok: false, err: error?.message ?? String(error) };
      }
      this.confirmBusy = false;
      if (!result?.ok) {
        this.noteText = `失败：${result?.err || "未知错误"}`;
        cx.notify();
        return;
      }
      this.confirm = null;
      this.confirmInput = null;
      this.noteText = spec.success ?? "完成";
      this.refresh(cx);
      if (spec.done) spec.done(cx);
      cx.notify();
    });
  }

  /** 跳到某个提交：把提交注入日志列表并选中。 */
  showCommit(commit, cx) {
    const state = this.log;
    if (!state.commits.some((item) => item.hash === commit.hash)) {
      state.commits = [commit, ...state.commits];
    }
    this.view = "log";
    writeStored("view", "log");
    readCommit(this, commit.hash, cx, true);
    cx.notify();
  }

  /** 对某个文件查看 blame。 */
  showBlame(path, cx) {
    openBlame(this, path, cx);
  }

  // ---- 渲染 ---------------------------------------------------------------

  render(cx) {
    const t = theme();
    if (this.stageMode) return renderStage(this, t, cx);
    if (this.locating && !this.repo) return this.frame(t, simpleState("正在定位 Git 仓库…", t));
    if (!this.repo) return this.frame(t, v_flex().size_full().items_center().justify_center().gap(10)
      .child(div().text_size(13).text_color(t.muted).child(this.error || "没有可用的仓库"))
      .child(textButton("pick-repo", "选择仓库…", t, (cx) => this.locateOther(cx))));

    let left = simpleState("该视图尚未接线", t);
    let right = simpleState("", t);
    if (this.view === "log") {
      left = renderLogList(this, t, cx);
      right = renderLogDetail(this, t, cx);
    } else if (this.view === "changes") {
      left = renderChangesList(this, t, cx);
      right = renderChangesDetail(this, t, cx);
    } else if (this.view === "branches") {
      left = renderBranchesList(this, t, cx);
      right = renderBranchesDetail(this, t, cx);
    } else if (this.view === "compare") {
      left = renderCompareList(this, t, cx);
      right = renderCompareDetail(this, t, cx);
    } else if (this.view === "blame") {
      return this.frame(t, renderBlame(this, t, cx), cx);
    }

    // 侧栏窄时上下分栏，宽时左右分栏；阈值随布局拖动实时切换。
    const body = this.narrow
      ? v_resizable("git-workbench-body-v").size_full().min_h(0)
        .child(resizable_panel().w_full().size(300).size_range(160, 620).child(left))
        .child(resizable_panel().w_full().child(right))
      : h_resizable("git-workbench-body").size_full().min_h(0)
        .child(resizable_panel().h_full().size(380).size_range(260, 680).child(left))
        .child(resizable_panel().h_full().child(right));

    return this.frame(t, body, cx);
  }

  frame(t, body, cx = null) {
    const closeable = Boolean(props()?.overlay);
    const title = h_flex().w_full().h(42).flex_none().px(12).gap(10).items_center().border_b(1).border_color(t.border).bg(t.chrome)
      .child(div().text_size(12).font_semibold().text_color(t.foreground).child("Git"))
      .when(Boolean(this.repo), (e) => e
        .child(div().id("repo-name").text_size(12).text_color(t.muted).cursor_pointer()
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .on_click((_e, cx) => this.locateOther(cx))
          .child(this.repo.name))
        .child(div().text_size(10).text_color(t.dim).truncate().child(this.repo.branch ?? "游离 HEAD"))
        .when(Boolean(this.repo.head), (e) => e.child(div().text_size(10).text_color(t.dim).child(`@ ${this.repo.head}`))))
      .child(div().flex_1())
      .children(VIEWS.map((view) => h_flex().id(`view-${view.id}`).h(26).px(9).items_center().rounded(6)
        .when(this.view === view.id, (style) => style.bg(t.selected))
        .text_size(11).text_color(this.view === view.id ? t.foreground : t.muted)
        .cursor_pointer().hover((style) => style.bg(this.view === view.id ? t.selected : t.hover))
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => this.setView(view.id, cx)).child(view.label)))
      .child(textButton("git-refresh", "刷新", t, (cx) => {
        this.refresh(cx);
        if (this.view === "log") loadLogPage(this, cx, true);
        if (this.view === "branches") refreshBranches(this, cx);
      }, { small: true }))
      .when(closeable, (e) => e.child(textButton("git-close", "✕", t, () => closeOverlay(props().overlay), { small: true })));

    const root = v_flex().id("git-workbench").size_full().min_h(0).rounded(10).overflow_hidden()
      .bg(t.background).text_color(t.foreground).text_size(12).track_focus(this.handle)
      .on_size_change((size, cx) => {
        const narrow = size.width < 760;
        if (narrow !== this.narrow) {
          this.narrow = narrow;
          cx.notify();
        }
      })
      .on_key_down((event, cx) => {
        if (event.key === "escape") {
          if (this.confirm) { this.confirm = null; this.confirmInput = null; cx.notify(); cx.stop_propagation(); }
          else if (closeable) { closeOverlay(props().overlay); cx.stop_propagation(); }
        }
      })
      .child(title)
      .child(div().flex_1().min_h(0).p(0).child(body))
      .child(this.statusBar(t));

    return this.confirm ? root.child(this.confirmOverlay(t, cx)) : root;
  }

  statusBar(t) {
    return h_flex().w_full().h(24).flex_none().px(10).gap(8).items_center().border_t(1).border_color(t.border).bg(t.chrome)
      .child(div().flex_1().min_w(0).truncate().text_size(10).text_color(this.noteText.startsWith("失败") ? t.ansi1 : t.dim)
        .child(this.noteText || (this.repo ? this.repo.root : "")))
      .child(div().id("gw-follow").text_size(10).text_color(followEnabled() ? t.accent : t.dim).cursor_pointer()
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => { setFollowEnabled(!followEnabled()); cx.notify(); })
        .child(followEnabled() ? "主区域跟随 ✓" : "主区域跟随"))
      .child(div().text_size(10).text_color(t.dim).child(this.docked ? "自动刷新 · 拖左边缘调宽" : "自动刷新 · Esc 关闭"));
  }

  confirmOverlay(t, cx) {
    const spec = this.confirm;
    return div().id("confirm-backdrop").absolute().inset_0().flex().items_center().justify_center().bg("#00000066")
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .child(v_flex().w(460).p(16).gap(10).rounded(10).bg(t.popover).border_1().border_color(t.border)
        .child(div().text_size(13).font_semibold().text_color(spec.danger ? t.ansi1 : t.foreground).child(spec.title))
        .when(Boolean(spec.body), (e) => e.child(div().text_size(11).text_color(t.muted).child(spec.body)))
        .when(Boolean(this.confirmInput), (e) => e.child(h_flex().h(30).px(8).items_center().rounded(6).bg(t.input).border_1().border_color(t.border)
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .child(Input.new(this.confirmInput).h_full().text_size(11).text_color(t.foreground))))
        .child(h_flex().gap(8).justify_end()
          .child(textButton("confirm-cancel", "取消", t, (cx) => { this.confirm = null; this.confirmInput = null; cx.notify(); }, { small: true }))
          .child(textButton("confirm-ok", this.confirmBusy ? "执行中…" : "确定", t, (cx) => this.runConfirm(cx),
            { small: true, primary: !spec.danger, danger: spec.danger, disabled: this.confirmBusy }))));
  }
}

function simpleState(text, t) {
  return v_flex().size_full().items_center().justify_center().p(20)
    .child(div().text_size(12).text_color(t.dim).child(text));
}

function delay(cx, ms) {
  return new Promise((resolve) => cx.timer.after(ms, () => resolve()));
}

function readStored(key, fallback) {
  try {
    return window.localStorage.getItem(`git-workbench.${key}`) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeStored(key, value) {
  try {
    window.localStorage.setItem(`git-workbench.${key}`, value);
  } catch {}
}
