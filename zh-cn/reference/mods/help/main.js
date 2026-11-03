// The keybind list (Herdr's prefix+?), grouped, filterable by typing.
// Reads keys.json through keys(); edit keys.json to change any of them.

import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { keys, props, closeOverlay, theme } from "herdr";

const GROUPS = [
  ["空间", /^space\./],
  ["标签页", /^tab\./],
  ["窗格", /^pane\./],
  ["智能体", /^agent\./],
  ["终端", /^terminal\.|^send:/],
  ["窗口", /./],
];

const NAMES = {
  "space.new": "新建空间", "space.close": "关闭空间", "space.rename": "重命名空间", "space.move": "移动空间",
  "space.select": "选择空间", "space.next": "下一个空间", "space.prev": "上一个空间",
  "tab.new": "新建标签页", "tab.close": "关闭标签页", "tab.rename": "重命名标签页", "tab.move": "移动标签页",
  "tab.select": "选择标签页", "tab.settle": "固定标签页", "tab.unsettle": "取消固定标签页",
  "tab.next": "下一个标签页", "tab.prev": "上一个标签页",
  "pane.split": "分屏", "pane.close": "关闭窗格", "pane.zoom": "最大化窗格", "pane.focus": "聚焦窗格",
  "pane.go": "移动焦点", "pane.swap": "交换窗格",
  "terminal.open": "打开终端", "terminal.keep": "保留终端", "terminal.park": "送回终端",
  "terminal.right_click": "右键路由", "terminal.kill": "结束终端", "terminal.peek": "查看终端",
  "terminal.show": "显示终端", "terminal.copy": "复制", "terminal.paste": "粘贴",
  "terminal.paste_image": "粘贴图片",
  "agent.focus": "聚焦智能体", "agent.next": "下一个智能体", "agent.prev": "上一个智能体",
  "layout.switch": "切换布局", "layout.clone": "复制布局", "mod.clone": "复制 mod",
  "layout.set": "调整布局", "layout.toggle": "显示/隐藏布局节点", "layout.show": "显示布局节点",
  "layout.hide": "隐藏布局节点", "layout.resize": "调整布局大小", "layout.select": "选择布局分支",
  "layout.reset": "重置布局", "mod.open": "打开 mod", "overlay.close": "关闭浮层",
  "app.help": "快捷键", "app.welcome": "欢迎页", "app.whats_new": "更新说明",
  "app.feedback": "反馈", "app.palette": "命令面板", "app.settings": "设置",
  "app.check_updates": "检查更新", "app.update_core": "更新 herdr-core",
  "app.reset": "恢复默认界面", "app.theme": "切换主题", "app.zoom_in": "放大",
  "app.zoom_out": "缩小", "app.zoom_reset": "重置缩放", "app.update": "重启并更新",
  "app.quit": "退出 Herdr", "app.hide": "隐藏 Herdr", "app.hide_others": "隐藏其他应用",
  "app.show_all": "显示全部", "window.close": "关闭窗口", "window.minimize": "最小化窗口",
  "window.maximize": "最大化窗口",
};
const ARGS = { left: "左", right: "右", up: "上", down: "下", program: "程序", menu: "菜单" };
const SECTIONS = { global: "全局", space: "空间", tab: "标签页", pane: "窗格", terminal: "终端", agent: "智能体" };

function label(action) {
  if (action.startsWith("send:")) return "输入 " + JSON.stringify(action.slice(5));
  const [name, arg] = action.split(":");
  if (NAMES[name]) return arg ? `${NAMES[name]}：${ARGS[arg] ?? arg}` : NAMES[name];
  const words = name.replace(/[._]/g, " ");
  return arg ? `${words} ${arg}` : words;
}

export default class Help extends View {
  init(_props, cx) {
    this.filter = "";
    this.input = InputState.new({ placeholder: "输入以筛选…" });
    this.input.on("change", (_e, cx) => { this.filter = this.input.value(); cx.notify(); });
    this.input.focus();
    cx.timer.after(600, () => this.input.focus());
    this.handle = cx.focus_handle();
  }

  render(cx) {
    const t = theme();
    const f = this.filter.toLowerCase();
    const all = keys().filter((k) => !f || k.keys.includes(f) || label(k.action).includes(f));
    const seen = new Set();
    const groups = GROUPS.map(([name, re]) => {
      const rows = all.filter((k) => !seen.has(k) && re.test(k.action) && (seen.add(k) || true));
      return [name, rows];
    }).filter(([, rows]) => rows.length > 0);
    return v_flex()
      .id("help")
      .track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key === "escape") return closeOverlay(props().overlay);
      })
      .size_full()
      .min_h(0)
      .p(18)
      .gap(14)
      .bg(t.popover)
      .text_size(12)
      .child(
        h_flex()
          .h(22)
          .items_center()
          .justify_between()
          .child(div().text_size(15).font_semibold().text_color(t.foreground).child("快捷键"))
          .child(div().text_size(11).text_color(t.dim).child("Esc")),
      )
      .child(Input.new(this.input).h(36).flex_none().px(10).rounded(9).border_1().border_color(t.accent).bg(t.background).text_size(12.8).text_color(t.foreground))
      .child(
        v_flex()
          .flex_1()
          .min_h(0)
          .overflow_y_scrollbar()
          .py(2)
          .gap(10)
          .children(
            groups.map(([name, rows]) =>
              v_flex()
                .gap(2)
                .child(div().text_size(11.5).font_medium().text_color(t.dim).child(name))
                .children(
                  rows.map((k) =>
                    h_flex()
                      .h(32)
                      .px(8)
                      .rounded(7)
                      .items_center()
                      .child(div().w(190).text_color(t.accent).child(k.keys + (k.section !== "global" ? `  （${SECTIONS[k.section] ?? k.section}）` : "")))
                      .child(div().text_color(t.foreground).child(label(k.action))),
                  ),
                ),
            ),
          ),
      );
  }
}
