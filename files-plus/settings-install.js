// 把「编辑器」页注入 Herdr 的设置界面。
//
// Herdr 每次启动都会用自带内容还原 frame/，所以不能只安装时改一次；文件面板启动时
// 重新写入页面模块并打补丁。和 zh-cn 的「快捷键」页一样，只按代码锚点注入；锚点缺失
// 时保持设置界面原样并报告，不写坏它。
//
// 沙箱里的 fs/promises 只有 exists/mkdir/readFile/readdir/rmdir/unlink/writeFile。

import * as fsp from "fs/promises";
import { appHome } from "herdr";
import { injectSettings, MARK } from "./settings-patch.js";

const LOCK = ".files-plus-settings-lock";

const ICON = `<svg
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <polyline points="16 18 22 12 16 6" />
  <polyline points="8 6 2 12 8 18" />
</svg>
`;

const wait = (cx, ms) => new Promise((resolve) => cx.timer.after(ms, () => resolve()));

async function writeIfChanged(path, text) {
  const old = await fsp.readFile(path, "utf8").catch(() => null);
  if (old !== text) await fsp.writeFile(path, text, "utf8");
}

// 语言包和 shortcuts mod 都会在启动时改 settings/main.js；等它们写完再注入，
// 否则会互相覆盖或让它们的锚点匹配失败。
async function waitForMarker(cx, file, marker, ms) {
  const until = Date.now() + ms;
  for (;;) {
    const raw = await fsp.readFile(file, "utf8").catch(() => "");
    if (raw.includes(marker) || Date.now() >= until) return;
    await wait(cx, 100);
  }
}

async function installed(home, name) {
  return (await fsp.readFile(`${home}/mods/${name}/mod.json`, "utf8").catch(() => null)) !== null;
}

// mkdir 是原子的：抢到目录才算拿到锁；超过 15 秒的锁当作上次崩溃留下的。
async function acquire(cx, home) {
  const dir = `${home}/${LOCK}`;
  for (let i = 0; i < 150; i++) {
    try {
      await fsp.mkdir(dir);
      await fsp.writeFile(`${dir}/at`, String(Date.now()), "utf8");
      return true;
    } catch {
      const at = Number(await fsp.readFile(`${dir}/at`, "utf8").catch(() => "0"));
      if (Date.now() - at > 15000) {
        await fsp.unlink(`${dir}/at`).catch(() => {});
        await fsp.rmdir(dir).catch(() => {});
        continue;
      }
      await wait(cx, 100);
    }
  }
  return false;
}

async function release(home) {
  await fsp.unlink(`${home}/${LOCK}/at`).catch(() => {});
  await fsp.rmdir(`${home}/${LOCK}`).catch(() => {});
}

/** 安装/更新设置页。抛出的错误由调用方显示；不会静默跳过。 */
export async function installSettingsPage(cx) {
  const home = appHome();
  const mod = `${home}/mods/files-plus`;
  const dir = `${home}/frame/settings`;
  await fsp.mkdir(dir, { recursive: true });

  if (await installed(home, "zh-cn")) await waitForMarker(cx, `${dir}/main.js`, 'child("设置")', 3000);
  if (await installed(home, "shortcuts")) await waitForMarker(cx, `${dir}/main.js`, "st-s-keys", 3000);

  // 页面模块必须放在 settings 目录里：frame 的模块不能 import mods/ 下的文件。
  // 依赖的纯函数文件跟着改名复制，避免和 Herdr 自己的同名模块冲突。
  const discovery = await fsp.readFile(`${mod}/editors.js`, "utf8");
  await writeIfChanged(
    `${dir}/files-plus-discovery.js`,
    discovery
      .replace('from "./uri.js"', 'from "./files-plus-uri.js"')
      .replace('from "./windows-env.js"', 'from "./files-plus-windows-env.js"'),
  );
  await writeIfChanged(`${dir}/files-plus-uri.js`, await fsp.readFile(`${mod}/uri.js`, "utf8"));
  await writeIfChanged(`${dir}/files-plus-windows-env.js`, await fsp.readFile(`${mod}/windows-env.js`, "utf8"));
  await writeIfChanged(`${dir}/files-plus-settings.js`, await fsp.readFile(`${mod}/settings.js`, "utf8"));
  await writeIfChanged(`${dir}/files-plus.svg`, ICON);

  const locked = await acquire(cx, home);
  try {
    const raw = await fsp.readFile(`${dir}/main.js`, "utf8");
    const text = raw.replace(/\r\n/g, "\n");
    const next = injectSettings(text);
    if (next === text) {
      if (text.includes(MARK)) return;
      throw new Error("Herdr 的设置界面结构已变化，暂时无法加入编辑器页");
    }
    await fsp.writeFile(`${dir}/main.js`, next, "utf8");
    const back = await fsp.readFile(`${dir}/main.js`, "utf8");
    if (!back.includes(MARK)) throw new Error("编辑器设置页写入后未生效");
  } finally {
    if (locked) await release(home);
  }
}
