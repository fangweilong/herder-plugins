// 语言包的纯文件操作：从 Herdr 刚还原出来的英文文件出发，按规则翻译或跳过，
// 并把语言选项注入设置页。与 UI 无关，测试可以在临时目录里完整回放。

import * as fsp from "fs/promises";
import { injectLanguage, LANG_MARK, languageOf } from "./inject.js";
import { applyRule } from "./rules.js";

function utf8(text) {
  const out = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
  }
  return out;
}

/**
 * 与 Herdr 的 installed.json 相同的 FNV-1a 64 位指纹：告诉应用这些内置 mod 仍是“它装的”，
 * 否则下次启动会把翻译当成用户改动，克隆出 *-edited 目录。
 *
 * @param {string} text
 * @returns {string} 16 位十六进制指纹。
 */
export function fingerprint(text) {
  let h = 0xcbf29ce484222325n;
  for (const b of utf8(text)) {
    h = ((h ^ BigInt(b)) * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, "0");
}

/**
 * 读取 language.json。文件缺失或损坏时按中文处理（安装后的默认状态）。
 *
 * @param {string} base `mods/zh-cn` 的绝对路径。
 * @returns {Promise<"zh" | "en">}
 */
export async function readLanguage(base) {
  try {
    return languageOf(JSON.parse(await fsp.readFile(`${base}/language.json`, "utf8")));
  } catch {
    return "zh";
  }
}

/**
 * 应用语言包。
 *
 * 中文模式：对 `patches.json` 与 `patches-extra.json` 里的文件逐条替换，并更新内置
 * mod 的 installed.json 指纹。英文模式：不翻译、不碰内置 mod，但仍把语言选项注入
 * 设置页，保证能从英文界面切回中文。
 *
 * @param {string} home Herdr 的 app home。
 * @param {"zh" | "en"} language
 * @returns {Promise<{language: "zh" | "en", applied: number, missed: number, injectFailed: boolean}>}
 */
export async function applyPatch(home, language) {
  const base = `${home}/mods/zh-cn`;
  const pack = JSON.parse(await fsp.readFile(`${base}/patches.json`, "utf8"));
  // 手工补充的规则：用于基准版本之后新增的界面文字，重新生成 patches.json 不会覆盖。
  let extra = { files: {} };
  try {
    extra = JSON.parse(await fsp.readFile(`${base}/patches-extra.json`, "utf8"));
  } catch {}
  const installed = JSON.parse(await fsp.readFile(`${home}/installed.json`, "utf8"));
  const files = { ...(pack.files ?? {}) };
  for (const [rel, rules] of Object.entries(extra.files ?? {})) {
    files[rel] = [...(files[rel] ?? []), ...rules];
  }

  let recordChanged = false;
  let applied = 0;
  let missed = 0;
  let injectFailed = false;
  for (const [rel, rules] of Object.entries(files)) {
    const dst = `${home}/${rel}`;
    let raw;
    try {
      raw = await fsp.readFile(dst, "utf8");
    } catch {
      continue;
    }
    // 规则按 LF 生成；官方文件在 Windows 上是 CRLF，先统一再匹配，写回 LF。
    let text = raw.replace(/\r\n/g, "\n");
    let hits = 0;
    if (language === "zh") {
      for (const rule of rules) {
        const result = applyRule(text, rule);
        text = result.text;
        if (result.hit) {
          applied++;
          hits++;
        } else {
          missed++;
        }
      }
    }
    // 语言选项即使切到英文也要注入，否则界面上没有切回中文的入口。
    let injected = false;
    if (rel === "frame/settings/main.js") {
      const next = injectLanguage(text);
      if (next !== text) {
        text = next;
        injected = true;
      } else if (!text.includes(LANG_MARK)) {
        injectFailed = true;
      }
    }
    if ((!hits && !injected) || text === raw) continue;
    await fsp.writeFile(dst, text, "utf8");
    const parts = rel.split("/");
    // 英文模式只注入设置页，不碰内置 mod，因此不需要更新指纹。
    if (language === "zh" && parts[0] === "mods" && parts.length > 2) {
      const name = parts[1];
      const entry = installed[name] ?? {};
      entry[parts.slice(2).join("/")] = fingerprint(text);
      installed[name] = entry;
      recordChanged = true;
    }
  }
  if (recordChanged) {
    await fsp.writeFile(`${home}/installed.json`, JSON.stringify(installed, null, 2) + "\n", "utf8");
  }
  return { language, applied, missed, injectFailed };
}
