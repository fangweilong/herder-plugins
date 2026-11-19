// 设置界面的注入补丁：纯字符串处理，单独放这里方便 node --test 覆盖。
//
// 只改三处：导入页面模块、在 SECTIONS 里加一项、在页面分发链里加一个分支。
// 任何锚点缺失都抛错，调用方保留原文件并显示错误；绝不写坏设置界面。

export const MARK = "/* files-plus-settings */";

export function injectSettings(text) {
  if (text.includes(MARK)) return text;

  const IMPORT = /^import \{[^\n]*\} from "herdr";$/m;
  if (!IMPORT.test(text)) throw new Error("Herdr 的设置界面结构已变化，暂时无法加入编辑器页");
  let next = text.replace(IMPORT, (line) => `${line}\nimport EditorsSettings from "./files-plus-settings.js";`);

  // 直接加进 SECTIONS：导航、初始 section 校验和 app.settings {section:"editors"} 都走它。
  const start = next.indexOf("const SECTIONS = [");
  const end = start < 0 ? -1 : next.indexOf("\n];", start);
  if (start < 0 || end < 0) throw new Error("Herdr 的设置界面结构已变化，暂时无法加入编辑器页");
  next =
    next.slice(0, end) +
    `\n  ${MARK}\n  { id: "editors", title: "编辑器", icon: "files-plus" },` +
    next.slice(end);

  // 页面分发：插在原有分支之间，避开 shortcuts 注入的 look/keys 锚点。
  const page = /^([ \t]*): this\.section === "(?:keyboard|machines)"[ \t]*$/m.exec(next);
  if (!page) throw new Error("Herdr 的设置界面结构已变化，暂时无法加入编辑器页");
  const indent = page[1];
  next = next.replace(
    page[0],
    `${indent}: this.section === "editors"\n${indent}  ? EditorsSettings(t, cx)\n${page[0]}`,
  );

  return next;
}
