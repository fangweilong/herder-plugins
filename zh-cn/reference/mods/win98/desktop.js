// The desktop's icons, down the left edge of the teal: My Computer, the
// Recycle Bin, every space as a folder (the shown one selected, its agents'
// state as a badge), the games, Network Neighborhood. One click opens (Win98's
// "single-click to open" web style); right-click for each icon's menu, or the
// desktop's.

import { div } from "gpui-kit";
import { v_flex } from "gpui-base";
import { spaces, run } from "herdr";
import { C, unit, root, icon, openMenu, openDialog, perform, sfx } from "./kit.js";
import { closeSpaceAsk } from "./taskbar.js";

export default class Desktop {
  init() {
    this.sel = null;
  }

  item(u, key, ico, text, o = {}) {
    const on = o.selected ?? this.sel === key;
    const badge = o.badge;
    return v_flex()
      .id(`dk-${key}`)
      .flex_none()
      .w(u(76))
      .pt(u(4))
      .pb(u(6))
      .items_center()
      .gap(u(3))
      .on_mouse_down("left", (_e, cx) => {
        cx.stop_propagation();
        this.sel = key;
        cx.notify();
      })
      .on_click((_e, cx) => {
        o.open?.();
        cx.notify();
      })
      .on_mouse_down("right", (_e, cx) => {
        cx.stop_propagation();
        this.sel = key;
        if (o.menu) openMenu(o.menu());
        cx.notify();
      })
      .child(
        div()
          .relative()
          .child(icon(u, ico, 32))
          .when(on, (el) => el.child(div().absolute().top(0).left(0).size_full().bg("#00008060")))
          .when(Boolean(badge), (el) =>
            el.child(
              div()
                .absolute()
                .left(u(-2))
                .bottom(u(-2))
                .child(icon(u, badge, 16))
                .when(badge === "warn-badge", (b) => b.loop("opacity", { from: 0, to: 1, period: 900 })),
            ),
          ),
      )
      .child(
        div()
          .max_w(u(74))
          .px(u(1))
          .text_center()
          .text_color(C.white)
          .border(u(1))
          .border_color(on ? "#ffff00" : "#00000000")
          .when(on, (el) => el.bg(C.navy))
          .child(text),
      );
  }

  render(_cx) {
    const u = unit();
    const all = spaces();
    const badgeOf = (s) => (s.status === "blocked" ? "warn-badge" : s.status === "working" ? "hourglass" : s.status === "done" ? "check-badge" : null);
    const items = [
      this.item(u, "computer", "computer", "我的电脑", { open: () => openDialog("mycomputer", {}) }),
      this.item(u, "bin", "bin", "回收站", { open: () => openDialog("bin", {}) }),
      ...all.map((s) =>
        this.item(u, s.id, s.machine ? "netfolder" : s.active ? "folder-open" : "folder", s.name, {
          selected: s.active,
          badge: badgeOf(s),
          open: () => run("space.select", { id: s.id }),
          menu: () => [
            { label: "打开", bold: true, act: { run: ["space.select", { id: s.id }] } },
            { label: "新建标签页...", act: { dialog: { kind: "prompt", title: "新建标签页", text: `输入「${s.name}」中新标签页的名称：`, icon: "dos", command: { name: "tab.new", args: { space: s.id } } } } },
            { sep: true },
            { label: "重命名", act: { dialog: { kind: "prompt", title: "重命名", text: "输入此空间的新名称：", icon: "folder", value: s.name, command: { name: "space.rename", args: { id: s.id } } } } },
            { label: "删除", act: { dialog: { kind: "confirm", ...closeSpaceAsk(s) } } },
            { sep: true },
            {
              label: "属性",
              act: {
                dialog: {
                  kind: "message",
                  title: `${s.name} Properties`,
                  icon: "folder",
                  text: `类型：  空间\n位置：  ${s.machine ?? "本机"}\n文件夹：  ${s.folder || "~"}\n分支：  ${s.branch ?? "（无）"}\n包含：  ${s.tabs.length} 个标签页\n状态：  ${{ working: "工作中", blocked: "需要你", done: "已完成", idle: "空闲" }[s.status] ?? "空闲"}`,
                },
              },
            },
          ],
        }),
      ),
      this.item(u, "mines", "mines", "扫雷", { open: () => perform({ app: "mines" }) }),
      this.item(u, "sol", "sol", "纸牌", { open: () => perform({ app: "sol" }) }),
      this.item(u, "net", "network", "网上邻居", { open: () => openDialog("network", {}) }),
    ];
    return root(
      u,
      v_flex()
        .id("desktop")
        .size_full()
        .pt(u(6))
        .items_center()
        .overflow_y_scroll()
        .on_mouse_down("left", (_e, cx) => {
          this.sel = null;
          cx.notify();
        })
        .on_mouse_down("right", () => {
          sfx("menu");
          openMenu([
            { label: "排列图标", sub: [{ label: "按名称", disabled: true }, { label: "按类型", disabled: true }, { label: "自动排列", checked: true, disabled: true }] },
            { label: "对齐图标", disabled: true },
            { sep: true },
            { label: "刷新", act: { run: ["layout.switch", { name: "win98" }] } },
            { sep: true },
            { label: "粘贴", disabled: true },
            { label: "粘贴快捷方式", disabled: true },
            { sep: true },
            {
              label: "新建",
              sub: [
                { label: "空间...", icon: "folder", act: { dialog: { kind: "prompt", title: "新建空间", text: "输入新空间的名称：", icon: "folder", machines: true, command: { name: "space.new", args: {} } } } },
                { label: "标签页...", icon: "dos", act: { dialog: { kind: "prompt", title: "新建标签页", text: "输入新标签页的名称：", icon: "dos", command: { name: "tab.new", args: {} } } } },
              ],
            },
            { sep: true },
            { label: "属性", act: { dialog: { kind: "display" } } },
          ]);
        }),
    ).children(items);
  }
}
