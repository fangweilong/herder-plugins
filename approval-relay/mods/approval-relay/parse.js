// 审批对话框解析：Herdr 的 blocked 只是 agent 上报的“需要人”，也可能来自普通输出，
// 所以这里按可见屏幕的结构判断是不是一个“活的”选择框：选项必须在底部，下面只能有
// 按键提示/状态栏。解析不出来就不弹窗，宁可漏也不误弹。

const OSC = /\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)/g;
const CSI = /\x1B\[[0-9;?]*[ -/]*[@-~]/g;
const ESC = /\x1B[@-_]/g;

// Claude Code / Codex / omp 等常见选择框：❯ 1. Yes / > 1. Yes / 1) Yes
// 1. Yes / 1) Yes / 1、Yes，以及 Pi 的 “❯ 1  yes”（数字后只有空格）。
const NUMBERED = /^\s*(?:([❯›▶►>])\s*)?(\d{1,2})(?:[.)、]\s+|\s{2,})(\S.*?)\s*$/;
const YESNO = /(?:\[|\()\s*([YyNn])\s*\/\s*([YyNn])\s*(?:\]|\))/;
const QUESTION = /[?？]\s*$/;
const DIALOG =
  /\b(do you want|would you like|allow |approve|permission|confirm|proceed|continue|run this|make this edit|use this|trust this|accept)\b/i;
// 问答型审批：问题不一定带问号，可能是 “What ... / Which ... / Tell me ...”。
const ASK = /\b(what|which|who|when|where|why|how|tell me|describe|explain|choose|select|answer|reply)\b/i;
const HINT = /(?:^|[^\w])(enter|esc|escape|tab|↑|↓|←|→|shift\+tab|press|select|space|ctrl\+|y\/n|yes\/no|\? for shortcuts)(?:[^\w]|$)/i;
const STATUS = /(?:\btok\/s\b|\d+(?:\.\d+)?\s*[kKmM]?\/s|⏱|⤵|⤴|💾|\b\d{1,3}%\b|\b\d+[kKmM]?\s*tokens?\b)/i;
const BOX = /^\s*[│┃║╭╮╰╯─━┄┅┈┉╌╍═╞╡├┤┬┴┼┌┐└┘|]/;
// 终端里的自由输入行："> "、"❯ "、空提示行，或明确要求输入。
const INPUT = /^\s*(?:[│┃║|]\s*)?[>❯›]\s*[▌█_|]?$|\b(type|answer|reply|response|input)\b/i;
// 无编号的选择列表：omp / opencode 这类 TUI 用高亮而不是数字，常见行是
// Approve / Approve <tool> for this session / Deny，Allow once / Always allow / Reject。
const CHOICE = /^(approve|deny|allow|reject|always allow|always approve|allow once|approve once|confirm|cancel|yes|no)\b/i;
const CHECKBOX = /^[☐☑□■]\s+/;
const RADIO = /^[○●◉◯]\s+/;
const MARKER = /^[❯›▶►]\s+(.+)$/;
const OTHER = /^(other|其他|自己输入|自定义|type something|specify|custom|输入)/i;
const KEYED = [
  /^\[([A-Za-z])\]\s*(.+)$/,
  /^\(([A-Za-z])\)\s*(.+)$/,
  /^([A-Za-z])\)\s+(.+)$/,
];

export function cleanScreen(text) {
  return String(text ?? "")
    .replace(OSC, "")
    .replace(CSI, "")
    .replace(ESC, "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/\s+$/g, ""))
    .join("\n");
}

export function screenHash(text) {
  const lines = cleanScreen(text)
    .split("\n")
    .filter((line) => line.trim())
    .slice(-50);
  const body = lines.join("\n");
  let hash = 0x811c9dc5;
  for (let i = 0; i < body.length; i++) {
    hash ^= body.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function stripBox(line) {
  return line
    .replace(BOX, "")
    .replace(/^[│┃║|]\s?/, "")
    .replace(/\s?[│┃║|]$/, "")
    .trim();
}

function numberedRuns(lines) {
  const runs = [];
  let cur = null;
  for (let i = 0; i < lines.length; i++) {
    const cleaned = isBorder(lines[i]) ? "" : stripBox(lines[i]);
    const m = cleaned.match(NUMBERED);
    if (!m) {
      if (cur) {
        runs.push(cur);
        cur = null;
      }
      continue;
    }
    const number = Number(m[2]);
    const item = {
      number,
      marker: m[1] ?? "",
      label: stripBox(m[3]).slice(0, 200),
      line: i,
    };
    if (cur && number === cur.last + 1) {
      cur.items.push(item);
      cur.last = number;
      cur.end = i;
    } else {
      if (cur) runs.push(cur);
      cur = { start: i, end: i, last: number, items: [item] };
    }
  }
  if (cur) runs.push(cur);
  return runs;
}

function isBorder(line) {
  return /^[\s│┃║╭╮╰╯─━┄┅┈┉╌╍═╞╡├┤┬┴┼┌┐└┘|]+$/.test(line);
}

function tailIsQuiet(lines, end, allowInput = false) {
  // 选项下面只能有按键提示、状态栏和空行；出现新的正文说明这是一个已经结束/被打印出来的框。
  // 带 Other 的选项允许下面跟一个自由输入行。
  for (let i = end + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*[╰└]/.test(line)) return true;
    if (isBorder(line)) continue;
    const text = stripBox(line);
    if (!text) continue;
    if (HINT.test(text) || STATUS.test(text)) continue;
    if (/^\S*[$#>❯]\s*$/.test(text)) {
      if (allowInput) continue;
      return false;
    }
    if (text.length > 4) return false;
  }
  return true;
}

function isOther(label) {
  return OTHER.test(String(label).replace(/^\d{1,2}[.)、]\s*/, "").trim());
}

function questionBefore(lines, start) {
  const picked = [];
  let marker = false;
  for (let i = start - 1, seen = 0; i >= 0 && seen < 24; i--, seen++) {
    const text = stripBox(lines[i])
      .replace(/^[─━┄┅┈┉╌╍═╭╮╰╯]+/, "")
      .replace(/[─━┄┅┈┉╌╍═╭╮╰╯]+$/, "")
      .trim();
    if (!text) continue;
    if (HINT.test(text) || STATUS.test(text)) continue;
    picked.unshift(text);
    if (QUESTION.test(text) || DIALOG.test(text)) marker = true;
    if (picked.length >= 8) break;
  }
  return { text: picked.join("\n").slice(-800), marker };
}

function questionNear(lines, index) {
  const picked = [];
  for (let i = index; i >= 0 && picked.length < 4; i--) {
    const text = stripBox(lines[i]);
    if (!text) {
      if (picked.length) break;
      continue;
    }
    if (isBorder(text)) break;
    picked.unshift(text);
    if (QUESTION.test(text) || DIALOG.test(text) || ASK.test(text)) break;
  }
  return picked.join("\n").slice(-800);
}

function yesNo(lines) {
  for (let i = lines.length - 1; i >= 0 && i >= lines.length - 24; i--) {
    const m = stripBox(lines[i]).match(YESNO);
    if (!m) continue;
    const yesDefault = m[1] === "Y";
    return {
      line: i,
      question: questionBefore(lines, i).text,
      options: [
        { id: "yes", label: "Yes", keys: ["y", "enter"] },
        { id: "no", label: "No", keys: ["n", "enter"] },
      ],
      defaultOption: yesDefault ? "yes" : "no",
    };
  }
  return null;
}

function choiceLine(text) {
  if (NUMBERED.test(text)) return null;
  if (/^allow tool\b/i.test(text) || /^permission\b/i.test(text)) return null;
  const marker = text.match(MARKER);
  if (marker) {
    let label = marker[1].trim();
    if (RADIO.test(label)) label = label.replace(RADIO, "").trim();
    else if (CHECKBOX.test(label)) label = label.replace(CHECKBOX, "").trim();
    if (!label || NUMBERED.test(label)) return null;
    return { label, answer: true, marker: true, key: null };
  }
  if (RADIO.test(text)) {
    return { label: text.replace(RADIO, "").trim(), answer: true, marker: false, key: null };
  }
  if (CHECKBOX.test(text)) {
    return { label: text.replace(CHECKBOX, "").trim(), answer: false, marker: false, key: null };
  }
  for (const pattern of KEYED) {
    const m = text.match(pattern);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const rest = m[2].trim();
    if (!rest) return null;
    const label = rest[0] === key ? rest : `${key}${rest}`;
    return { label, answer: true, marker: false, key };
  }
  if (CHOICE.test(text) && text.length <= 100 && !text.endsWith("?")) {
    return { label: text.trim(), answer: true, marker: false, key: null };
  }
  return null;
}

function choiceRun(lines) {
  let end = -1;
  for (let i = lines.length - 1; i >= 0 && i >= lines.length - 30; i--) {
    if (isBorder(lines[i])) continue;
    const text = stripBox(lines[i]);
    if (!text) { if (end >= 0) break; continue; }
    if (HINT.test(text) || STATUS.test(text)) continue;
    if (choiceLine(text)) { end = i; break; }
    // 状态栏/页脚可能在对话框下面，继续向上找实际的选项行。
  }
  if (end < 0) return null;
  const rows = [];
  for (let i = end; i >= 0 && i >= end - 12; i--) {
    if (isBorder(lines[i])) break;
    const text = stripBox(lines[i]);
    if (!text) break;
    const choice = choiceLine(text);
    if (!choice) {
      const marked = rows.some((row) => row.marker);
      const plain = marked && text.length <= 80 && !/[?？:：]$/.test(text) && !/^(always yes for|scope:|select|choose)\b/i.test(text);
      if (plain) {
        rows.unshift({ label: text, answer: true, marker: false, key: null, line: i });
        continue;
      }
      break;
    }
    rows.unshift({ ...choice, line: i });
  }
  if (rows.length < 2) return null;
  const start = rows[0].line;
  const last = rows[rows.length - 1].line;
  if (!tailIsQuiet(lines, last)) return null;
  return { start, end: last, rows };
}

function sectionOption(text) {
  let value = text.trim();
  if (/^[❯›▶►]\s+/.test(value)) value = value.replace(/^[❯›▶►]\s+/, "").trim();
  let matched = value.match(RADIO);
  let multi = false;
  if (!matched) { matched = value.match(CHECKBOX); multi = Boolean(matched); }
  if (!matched) return null;
  const label = value.slice(matched[0].length).trim();
  if (!label) return null;
  return {
    label,
    multi,
    marker: /^[❯›▶►]\s+/.test(text.trim()),
    other: /^(other|其他|自己输入|自定义|type something|specify|custom|输入)/i.test(label),
  };
}

function sectionQuestions(lines) {
  const questions = [];
  for (let i = 0; i < lines.length; i++) {
    const text = stripBox(lines[i]).replace(/^[─━┄┅┈┉╌╍═╭╮╰╯├┤┬┴┼]+\s*/, "");
    const header = text.match(/^\[([^\]]+)\]\s*·\s*(multi\s*·\s*)?options:(\d+)/i);
    if (!header) continue;
    const options = [];
    const prompt = [];
    for (let j = i + 1; j < lines.length; j++) {
      const text = stripBox(lines[j]);
      if (!text) continue;
      if (/^[─━┄┅┈┉╌╍═╭╮╰╯]*\s*\[[^\]]+\]\s*·\s*(?:multi\s*·\s*)?options:/i.test(text)) break;
      if (/^[╰└]/.test(lines[j])) break;
      const option = sectionOption(text);
      if (option) options.push(option);
      else if (!options.length && !isBorder(lines[j])) prompt.push(text);
    }
    if (options.length) {
      if (!options.some((o) => o.other)) options.push({ label: "Other (type your own)", other: true });
      questions.push({
        id: header[1],
        question: prompt.join("\n").slice(-800),
        options,
        multi: Boolean(header[2]),
      });
    }
  }
  return questions;
}

function questionInBox(lines, start, boxStart) {
  const picked = [];
  for (let i = start - 1; i > boxStart && picked.length < 3; i--) {
    const text = stripBox(lines[i]);
    if (!text || /^[├┤┬┴┼─]+$/.test(text)) continue;
    if (/^(Ask|Submit|认证方式\s+弹窗触发)/i.test(text)) continue;
    picked.unshift(text);
    if (QUESTION.test(text) || DIALOG.test(text) || ASK.test(text)) break;
  }
  return picked.join("\n").slice(-800);
}

// omp 的 Ask 面板用 ○ 单选项，每个选项下面可以跟一段说明；只取面板里的选项行，
// 跳过说明文字，避免把长描述当成新的正文。
function radioRun(lines) {
  let boxStart = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^\s*[╭┌].*\bAsk\b/i.test(lines[i])) { boxStart = i; break; }
  }
  if (boxStart < 0) return null;
  const rows = [];
  for (let i = boxStart + 1; i < lines.length; i++) {
    if (/^\s*[╰└]/.test(lines[i])) break;
    const text = stripBox(lines[i]);
    if (!text) continue;
    const choice = choiceLine(text);
    if (choice && choice.marker || choice && RADIO.test(text)) rows.push({ ...choice, line: i });
  }
  if (rows.length < 2) return null;
  const start = rows[0].line;
  const last = rows[rows.length - 1].line;
  if (!tailIsQuiet(lines, last)) return null;
  return { start, end: last, rows, question: questionInBox(lines, start, boxStart) };
}

function choiceOptions(run) {
  const selected = run.rows.findIndex((row) => row.marker);
  const approveOnce = run.rows.findIndex((row) => /^(approve once|approve|allow once)$/i.test(row.label));
  const base = selected >= 0 ? selected : Math.max(0, approveOnce);
  const options = [];
  run.rows.forEach((row, index) => {
    if (!row.answer) return;
    let keys;
    if (row.key) {
      keys = [row.key];
    } else if (index === base) {
      keys = ["enter"];
    } else {
      const step = index > base ? "down" : "up";
      keys = [...Array(Math.abs(index - base)).fill(step), "enter"];
    }
    options.push({
      id: `u${index}`,
      label: row.label.slice(0, 220),
      keys,
      selected: row.marker,
      default: index === base,
      other: /^(other|其他|自己输入|自定义|type something|specify|custom|输入)/i.test(row.label),
    });
  });
  return options.length >= 2 ? options : null;
}

export function parseApproval(raw, options = {}) {
  const text = cleanScreen(raw);
  const lines = text.split("\n");
  const runs = numberedRuns(lines).filter((run) => run.items.length >= 2);
  const askCount = Number((text.match(/\bAsk\s+(\d+)\s+questions\b/i) ?? [])[1] ?? 1);
  const sectionCount = (text.match(/\[[^\]\n]+\]\s*·\s*(?:multi\s*·\s*)?options:\d+/gi) ?? []).length;
  const questionCount = Math.max(askCount || 1, sectionCount, 1);
  const questions = sectionQuestions(lines);

  // 取最靠近底部的一段选项；中间夹着描述行也算同一段（只保留连续编号的项）。
  const quietRuns = runs.filter((r) => {
    const hasOther = r.items.some((item) => isOther(item.label));
    return r.end >= lines.length - 20 && tailIsQuiet(lines, r.end, hasOther);
  });
  // 多问题表单会把几个选择块叠在一起：当前块有 ❯，即使下面还有别的块也优先它。
  const markedRuns = runs.filter((r) => r.end >= lines.length - 45 && r.items.some((item) => item.marker));
  const run = (markedRuns.length ? markedRuns : quietRuns).sort((a, b) => b.end - a.end)[0];

  if (run) {
    const before = questionBefore(lines, run.start);
    const selected = run.items.some((item) => item.marker);
    if (!before.marker && !selected) return null;
    // Codex 的提示是 “Press a number to choose”，数字本身即确认；再发 Enter 可能多提交一次。
    const codex = /codex/i.test(String(options.app ?? ""));
    return {
      kind: "options",
      generic: false,
      question: before.text,
      options: run.items.map((item, index) => ({
        id: `n${item.number}`,
        label: `${item.number}. ${item.label}`.slice(0, 220),
        keys: codex ? [String(item.number)] : [String(item.number), "enter"],
        selected: Boolean(item.marker),
        default: index === 0,
        other: isOther(item.label),
      })),
      questionCount,
      multiQuestion: questionCount > 1,
      questions,
    };
  }

  const yn = yesNo(lines);
  if (yn && tailIsQuiet(lines, yn.line)) {
    return { kind: "options", generic: false, question: yn.question, options: yn.options, defaultOption: yn.defaultOption, questionCount, multiQuestion: questionCount > 1, questions };
  }

  // 无编号 / 高亮选择列表：omp、opencode、Pi 的二级菜单。
  const choices = radioRun(lines) || choiceRun(lines);
  if (choices) {
    const opts = choiceOptions(choices);
    const before = choices.question ? { text: choices.question, marker: true } : questionBefore(lines, choices.start);
    const hasMarker = choices.rows.some((row) => row.marker);
    const hasKnown = choices.rows.some((row) => row.answer && CHOICE.test(row.label));
    if (opts && (before.marker || hasMarker || hasKnown)) {
      return { kind: "options", generic: false, question: before.text, options: opts, questionCount, multiQuestion: questionCount > 1, questions };
    }
  }

  // 认得是“需要人”的框，但选项结构没解析出来：交给弹窗显示原文 + 通用按键。
  const tailStart = Math.max(0, lines.length - 20);
  let askIndex = -1;
  let canAnswer = false;
  for (let i = tailStart; i < lines.length; i++) {
    const text = stripBox(lines[i]);
    if (QUESTION.test(text) || DIALOG.test(text) || ASK.test(text)) askIndex = i;
    if (HINT.test(text) || INPUT.test(text)) canAnswer = true;
  }
  if (askIndex >= 0 && canAnswer) {
    return { kind: "text", generic: true, question: questionNear(lines, askIndex), options: [], questionCount, multiQuestion: questionCount > 1, questions };
  }

  return null;
}
