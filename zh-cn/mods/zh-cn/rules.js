/**
 * 规则匹配：与 Herdr 启动后还原出来的英文界面逐条比对。
 *
 * @param {string} text 当前文件内容（已统一为 LF）。
 * @param {{old?: string, new?: string, core_old?: string, core_new?: string, lines?: [string, string][]}} rule
 *   一条规则。`old` / `core_old` 要求全文只出现一次；`lines` 是上游改动导致整段
 *   失配时的逐行备用匹配，同样要求该行唯一。
 * @returns {{text: string, hit: boolean}} 替换后的内容，以及是否命中。
 */
export function applyRule(text, rule) {
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
