// Herdr 设置 → 编辑器：选择默认编辑器，并手动刷新发现结果。
//
// 这个文件由 settings-install.js 复制到 frame/settings/ 下运行；它只依赖同目录的
// files-plus-discovery.js（editors.js 的副本），不能反向 import mods/files-plus。
// 发现结果和默认项都放在 shared 里，文件面板读同一份数据，两边立即同步。

import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, setShared, shared, window } from "herdr";
import { discoverFrom, discoveryScriptPosix, discoveryScriptWindows, parseDiscovery, parseDiscoveryState } from "./files-plus-discovery.js";

const EDITORS_KEY = "files-plus.editors";
const SELECTED_EDITOR = "files-plus.editor";

// 刷新状态要跨渲染保存；页面每次渲染都会重新调用本函数。
// 存开始时间而不是布尔值：页面在刷新途中关闭时，下次打开不会永远卡在“正在刷新”。
const state = { refreshing: 0 };
const BUSY_MS = 15000;
const busy = () => state.refreshing && Date.now() - state.refreshing < BUSY_MS;

const readState = () => parseDiscoveryState(shared(EDITORS_KEY)) ?? { editors: [], at: 0, error: null };

const whenText = (at) => (at ? new Date(at).toLocaleString() : "从未刷新");

function heading(t, text) {
  return div().pt(6).pb(8).text_size(12).font_semibold().text_color(t.dim).child(text);
}

function button(t, id, label, onClick) {
  return div()
    .id(id)
    .px(12)
    .py(5)
    .rounded(7)
    .border_1()
    .border_color(t.border)
    .bg(t.raised)
    .cursor_pointer()
    .text_size(13)
    .text_color(t.foreground)
    .hover((s) => s.bg(t.hover))
    .on_click(onClick)
    .child(label);
}

function refresh(cx) {
  if (busy()) return;
  state.refreshing = Date.now();
  cx.notify();
  cx.spawn(async (cx) => {
    try {
      const r =
        window()?.platform === "windows"
          ? await exec("powershell", ["-NoProfile", "-WindowStyle", "Hidden", "-Command", discoveryScriptWindows()])
          : await exec("sh", ["-c", discoveryScriptPosix()]);
      if (r.code !== 0) throw new Error((r.stderr || "").trim() || `退出码 ${r.code}`);
      const editors = discoverFrom(parseDiscovery(r.stdout));
      setShared(EDITORS_KEY, {
        editors,
        at: Date.now(),
        error: editors.length ? null : "没有发现编辑器；请检查 HERDR_EDITORS、VISUAL、EDITOR 或 PATH。",
      });
      // 默认编辑器消失后让第一项接手；否则面板会用它，设置页却没有任何一项被选中。
      if (editors.length && !editors.some((editor) => editor.id === shared(SELECTED_EDITOR))) {
        setShared(SELECTED_EDITOR, editors[0].id);
      }
    } catch (e) {
      // 保留上一次的列表：刷新失败不该让本来能用的编辑器消失。
      const old = readState();
      setShared(EDITORS_KEY, { editors: old.editors, at: old.at, error: String(e?.message ?? e) });
    } finally {
      state.refreshing = 0;
      cx.notify();
    }
  });
}

function editorRow(t, editor, selected) {
  return h_flex()
    .id(`files-plus-editor-${editor.id.replace(/[^\w.-]+/g, "-")}`)
    .gap(10)
    .py(10)
    .items_center()
    .border_b(1)
    .border_color(t.border)
    .cursor_pointer()
    .hover((s) => s.bg(t.hover))
    .on_click((_e, cx) => {
      setShared(SELECTED_EDITOR, editor.id);
      cx.notify();
    })
    .child(div().w(14).text_size(12).text_color(t.ansi2).child(selected ? "✓" : ""))
    .child(
      v_flex()
        .flex_1()
        .min_w(0)
        .gap(2)
        .child(div().text_size(14).text_color(t.foreground).child(editor.name))
        .child(div().text_size(12).text_color(t.dim).child(`${editor.command} · ${editor.source}`)),
    )
    .when(selected, (el) => el.child(div().text_size(12).text_color(t.dim).child("默认")));
}

export default function EditorsSettings(t, cx) {
  const current = readState();
  const selected = shared(SELECTED_EDITOR);
  return v_flex()
    .w_full()
    .child(
      h_flex()
        .w_full()
        .items_center()
        .justify_between()
        .gap(16)
        .child(heading(t, "默认编辑器"))
        .child(button(t, "files-plus-refresh", busy() ? "正在刷新…" : "刷新", (_e, cx) => refresh(cx))),
    )
    .child(
      div()
        .text_size(12.5)
        .line_height("18px")
        .text_color(t.dim)
        .child("「项目」按钮、文件预览按钮、行内 ↗ 和快捷键都用这个编辑器；标题栏的 ▾ 只对下一次打开生效。"),
    )
    .when(Boolean(current.error), (el) => el.child(div().pt(8).text_size(12).text_color(t.blocked).child(current.error)))
    .when(
      current.editors.length === 0 && !current.error,
      (el) => el.child(div().pt(12).text_size(12.5).text_color(t.dim).child("还没有发现编辑器，点「刷新」重新扫描。")),
    )
    .child(v_flex().w_full().pt(8).children(current.editors.map((editor) => editorRow(t, editor, editor.id === selected))))
    .child(
      div()
        .pt(14)
        .text_size(11.5)
        .line_height("17px")
        .text_color(t.dim)
        .child(`上次刷新：${whenText(current.at)}。Windows 会读取最新的用户/机器环境变量、开始菜单快捷方式和卸载项；macOS / Linux 的 PATH 是启动快照，装完新编辑器后需要重启 Herdr，或用 HERDR_EDITORS 指向完整路径。`),
    );
}
