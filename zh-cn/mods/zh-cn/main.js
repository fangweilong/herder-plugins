// Herdr 中文语言包：Herdr 每次启动都会用自带内容还原 frame/ 和内置 mods/，
// 所以补丁在窗口加载后（由中文布局里的隐形浮动块触发）就地翻译这些文件。
// 规则按“英文原文 -> 中文”保存在 patches.json：Herdr 升级后原文件变了，
// 能匹配上的片段继续翻译，匹配不上的保留英文，不绑定版本、不会写坏新界面。

import { View, div } from "gpui-kit";
import * as fsp from "fs/promises";
import { appHome, notify } from "herdr";


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

// 与 Herdr 的 installed.json 相同的 FNV-1a 64 位指纹：告诉应用这些内置 mod 仍是“它装的”，
// 否则下次启动会把翻译当成用户改动，克隆出 *-edited 目录。
function fingerprint(text) {
  let h = 0xcbf29ce484222325n;
  for (const b of utf8(text)) {
    h = ((h ^ BigInt(b)) * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, "0");
}

// 只替换唯一出现的片段：同一段英文若在文件里有多处，交给带上下文的规则判断，
// 避免把开关、命令名等不该翻译的地方一起改掉。
function applyRule(text, rule) {
  if (rule.old && text.includes(rule.old) && text.indexOf(rule.old) === text.lastIndexOf(rule.old)) {
    return { text: text.replace(rule.old, rule.new), hit: true };
  }
  if (rule.core_old && text.includes(rule.core_old) && text.indexOf(rule.core_old) === text.lastIndexOf(rule.core_old)) {
    return { text: text.replace(rule.core_old, rule.core_new), hit: true };
  }
  // 上游在同一段里插入或改写了别的行时整段匹配会失败；被翻译的那几行往往还在，
  // 就逐行替换（仍要求该行在文件里唯一出现），新版本改动只影响它自己那一行。
  let hit = false;
  for (const [old, next] of rule.lines ?? []) {
    if (text.includes(old) && text.indexOf(old) === text.lastIndexOf(old)) {
      text = text.replace(old, next);
      hit = true;
    }
  }
  return { text, hit };
}

export default class ZhPack extends View {
  init(_props, cx) {
    cx.spawn(async () => {
      const home = appHome();
      const base = `${home}/mods/zh-cn`;
      try {
        const pack = JSON.parse(await fsp.readFile(`${base}/patches.json`, "utf8"));
        const installed = JSON.parse(await fsp.readFile(`${home}/installed.json`, "utf8"));
        let recordChanged = false;
        let applied = 0;
        let missed = 0;
        for (const [rel, rules] of Object.entries(pack.files)) {
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
          if (!hits || text === raw) continue;
          await fsp.writeFile(dst, text, "utf8");
          const parts = rel.split("/");
          if (parts[0] === "mods" && parts.length > 2) {
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
        console.log(`zh-cn: ${applied} 条规则已应用，${missed} 条未匹配（可能是 Herdr 新版本的改动）`);
      } catch (error) {
        notify({
          title: "中文语言包应用失败",
          body: String(error?.message ?? error),
          level: "error",
          timeout: 12000,
        });
      }
    });
  }

  render() {
    return div();
  }
}
