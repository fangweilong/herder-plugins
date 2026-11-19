import test from "node:test";
import assert from "node:assert/strict";
import { injectSettings, MARK } from "../settings-patch.js";

// 与 frame/settings/main.js 的关键结构一致；Herdr 改版时这里也要跟着调整。
const BASE = `import { View, div } from "gpui-kit";
import { hc, run, theme } from "herdr";
import Shortcuts from "./shortcuts.js";

const I = (name) => \`frame/settings/\${name}.svg\`;

const SECTIONS = [
  { id: "look", title: "外观", icon: "palette" },
  { id: "machines", title: "机器", icon: "server" },
  { id: "privacy", title: "隐私", icon: "shield" },
];

export default class Settings extends View {
  render(cx) {
    return h_flex()
      .child(
        this.section === "look"
          ? this.look(t, cx)
          : this.section === "keys"
            ? Shortcuts(t, cx)
          : this.section === "keyboard"
            ? this.keyboard(t)
          : this.section === "machines"
            ? this.machines(t)
            : this.updates(t),
      );
  }
}
`;

test("injectSettings：加入导入、SECTIONS 项和页面分支", () => {
  const next = injectSettings(BASE);
  assert.ok(next.includes('import EditorsSettings from "./files-plus-settings.js";'));
  assert.ok(next.includes(MARK));
  assert.ok(next.includes('{ id: "editors", title: "编辑器", icon: "files-plus" },'));
  assert.ok(next.includes(': this.section === "editors"\n            ? EditorsSettings(t, cx)\n          : this.section === "keyboard"'));
  // 只插入一次；原有分支保持不变。
  assert.equal(next.match(/files-plus-settings/g).length, 2);
  assert.ok(next.includes(': this.section === "keys"\n            ? Shortcuts(t, cx)'));
});

test("injectSettings：已注入时原样返回", () => {
  const once = injectSettings(BASE);
  assert.equal(injectSettings(once), once);
});

test("injectSettings：没有 keyboard 分支时退回 machines", () => {
  const text = BASE.replace('          : this.section === "keyboard"\n            ? this.keyboard(t)\n', "");
  const next = injectSettings(text);
  assert.ok(next.includes(': this.section === "editors"'));
  assert.ok(next.includes(': this.section === "machines"'));
});

test("injectSettings：锚点缺失时抛错，不返回半成品", () => {
  assert.throws(() => injectSettings("export default class Settings {}\n"), /结构已变化/);
  const noSections = BASE.replace("const SECTIONS = [", "const OTHER = [");
  assert.throws(() => injectSettings(noSections), /结构已变化/);
  const noPage = BASE.replace(': this.section === "keyboard"', ': this.section === "other"').replace(': this.section === "machines"', ': this.section === "other"');
  assert.throws(() => injectSettings(noPage), /结构已变化/);
});
