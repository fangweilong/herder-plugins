import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { applyPatch, fingerprint, readLanguage } from "../mods/zh-cn/apply.js";

const FRAME = [
  "class Settings extends View {",
  "  look(t, cx) {",
  "    return v_flex()",
  "      .w_full()",
  '      .child(this.heading(t, "Look"))',
  '      .child(this.row(t, "Terminal font weight", "", div()));',
  "  }",
  "",
  "  render(cx) {",
  "  }",
  "}",
].join("\n");

const MOD = 'const greeting = "hello";\n';

async function setup({ language } = {}) {
  const home = await mkdtemp(join(tmpdir(), "herdr-zh-cn-"));
  const base = join(home, "mods", "zh-cn");
  await mkdir(base, { recursive: true });
  await mkdir(join(home, "frame", "settings"), { recursive: true });
  await mkdir(join(home, "mods", "tabs"), { recursive: true });
  await writeFile(join(home, "frame", "settings", "main.js"), FRAME, "utf8");
  await writeFile(join(home, "mods", "tabs", "main.js"), MOD, "utf8");
  await writeFile(join(home, "installed.json"), JSON.stringify({ tabs: { "main.js": "0000000000000000" } }), "utf8");
  await writeFile(
    join(base, "patches.json"),
    JSON.stringify({
      files: {
        "mods/tabs/main.js": [{ old: "hello", new: "你好" }],
        "frame/settings/main.js": [{ old: "Look", new: "外观" }],
      },
    }),
    "utf8",
  );
  await writeFile(
    join(base, "patches-extra.json"),
    JSON.stringify({
      files: { "frame/settings/main.js": [{ old: "Terminal font weight", new: "终端字体粗细" }] },
    }),
    "utf8",
  );
  if (language) await writeFile(join(base, "language.json"), JSON.stringify({ language }), "utf8");
  return { home, base };
}

test("中文模式：翻译规则、补充规则与指纹一起生效", async () => {
  const { home } = await setup();
  try {
    const result = await applyPatch(home, "zh");
    assert.equal(result.injectFailed, false);
    assert.equal(result.missed, 0);

    const frame = await readFile(join(home, "frame", "settings", "main.js"), "utf8");
    assert.ok(frame.includes("外观"));
    assert.ok(frame.includes("终端字体粗细"));
    assert.ok(frame.includes("this.languageRow(t, cx)"));

    const mod = await readFile(join(home, "mods", "tabs", "main.js"), "utf8");
    assert.equal(mod, 'const greeting = "你好";\n');
    const installed = JSON.parse(await readFile(join(home, "installed.json"), "utf8"));
    assert.equal(installed.tabs["main.js"], fingerprint(mod));
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("英文模式：不翻译、不碰内置 mod，但仍注入语言选项", async () => {
  const { home } = await setup();
  try {
    const result = await applyPatch(home, "en");
    assert.equal(result.applied, 0);
    assert.equal(result.injectFailed, false);

    const frame = await readFile(join(home, "frame", "settings", "main.js"), "utf8");
    assert.ok(frame.includes('"Look"'));
    assert.ok(frame.includes("Terminal font weight"));
    assert.ok(frame.includes("this.languageRow(t, cx)"));

    assert.equal(await readFile(join(home, "mods", "tabs", "main.js"), "utf8"), MOD);
    const installed = JSON.parse(await readFile(join(home, "installed.json"), "utf8"));
    assert.equal(installed.tabs["main.js"], "0000000000000000");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("readLanguage 缺省为中文", async () => {
  const { home, base } = await setup();
  try {
    assert.equal(await readLanguage(base), "zh");
    await writeFile(join(base, "language.json"), '{"language":"en"}', "utf8");
    assert.equal(await readLanguage(base), "en");
    await writeFile(join(base, "language.json"), "not json", "utf8");
    assert.equal(await readLanguage(base), "zh");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});