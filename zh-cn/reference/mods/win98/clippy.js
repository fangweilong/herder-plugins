// The Office Assistant, floating over the desktop. When an agent needs you
// (blocked) or finished while you looked away (done), it pops a balloon that
// takes you there. Click it for a tip. Display Properties (or its balloon)
// hides it; Start > Programs > Accessories brings it back.

import { div, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { agents, run, shared, setShared, placement } from "herdr";
import { C, ASSETS, unit, root, button, label, sfx, own } from "./kit.js";

const TIPS = [
  "看起来你在放牧智能体。\n\n知道吗？Ctrl+Esc 可以打开开始菜单。",
  "标签页显示时点击它的任务栏按钮\n可以最小化（Herdr 会固定它）。\n再点一次即可恢复。",
  "Ctrl+Shift+Esc 打开关闭程序：\nHerdr 运行的所有终端，以及结束任务。",
  "在桌面上右键单击文件夹，\n可以重命名或关闭该空间。",
  "在等智能体？桌面上有扫雷。\n我不会告诉别人。",
  "双击窗口标题栏可以最大化，\n再双击一次即可还原。",
  "开始 > 运行... 会在新窗口中打开\n任意命令行，仿佛回到 1998 年。",
  "关闭系统 > 以 DOS 模式重新启动\n会切换到「Terminals」布局。",
  "注销会回到 Herdr 的常规布局。\n我会想你的。",
];

export default class Clippy {
  init() {
    this.dismissed = new Set();
    this.tip = null;
  }

  news() {
    const list = agents()
      .filter((a) => (a.status === "blocked" || a.status === "done") && !a.focused)
      .filter((a) => !this.dismissed.has(`${a.address}:${a.status}`))
      .sort((a, b) => (a.status === "blocked") - (b.status === "blocked") || a.seq - b.seq);
    return list.pop() ?? null;
  }

  render(_cx) {
    if (shared("win98.clippy") === "off") return div();
    const u = unit();
    const a = this.news();
    const right = placement()?.edge !== "left";
    let balloon = null;
    if (a) {
      const name = a.program?.name ?? a.app ?? "你的智能体";
      const where = `'${a.space_name} \\ ${a.tab_name}'`;
      const text =
        a.status === "blocked"
          ? `${name} 在 ${where}\n里等你。\n\n需要帮忙吗？`
          : `${name} 已在 ${where}\n完成。\n\n想看看它做了什么吗？`;
      balloon = this.balloon(u, text, [
        ["带我去", () => {
          run("agent.focus", { terminal: a.address });
          this.dismissed.add(`${a.address}:${a.status}`);
        }],
        ["稍后", () => this.dismissed.add(`${a.address}:${a.status}`)],
      ]);
    } else if (this.tip !== null) {
      balloon = this.balloon(u, TIPS[this.tip % TIPS.length], [
        ["下一条", () => (this.tip = (this.tip + 1) % TIPS.length)],
        ["关闭", () => (this.tip = null)],
        ["隐藏我", () => setShared("win98.clippy", "off")],
      ]);
    }
    // Clean the dismissed list once their agents moved on.
    for (const k of [...this.dismissed]) {
      const [addr, st] = k.split(":");
      if (!agents().some((x) => x.address === addr && x.status === st)) this.dismissed.delete(k);
    }
    const clip = own(
      div()
        .id("clippy")
        .relative()
        .flex_none()
        .cursor_pointer()
        .when(Boolean(a), (el) => el.loop("top", { from: 0, to: u(-5), period: 800 }))
        .on_click((_e, cx) => {
          this.tip = this.tip === null ? Math.floor(Math.random() * TIPS.length) : null;
          sfx("clippy");
          cx.notify();
        })
        .child(image(`${ASSETS}/img/clippy.svg`).w(u(64)).h(u(80))),
    );
    return root(
      u,
      v_flex()
        .p(u(4))
        .gap(u(2))
        .map((el) => (right ? el.items_end() : el.items_start())),
    )
      .when(Boolean(balloon), (el) => el.child(balloon))
      .child(clip);
  }

  balloon(u, text, actions) {
    return v_flex()
      .w(u(200))
      .p(u(8))
      .gap(u(8))
      .bg(C.tip)
      .border(u(1))
      .border_color(C.text)
      .rounded(u(8))
      .child(
        v_flex().children(
          String(text)
            .split("\n")
            .map((l) => div().child(l || " ")),
        ),
      )
      .child(
        v_flex()
          .gap(u(3))
          .children(
            actions.map(([t, fn], i) =>
              own(
                h_flex()
                  .id(`clip-${i}`)
                  .gap(u(5))
                  .items_center()
                  .cursor_pointer()
                  .on_click((_e, cx) => {
                    fn();
                    cx.notify();
                  })
                  .child(div().w(u(7)).h(u(7)).rounded(u(4)).bg(C.navy))
                  .child(div().text_color(C.navy).underline().child(t)),
              ),
            ),
          ),
      );
  }
}
