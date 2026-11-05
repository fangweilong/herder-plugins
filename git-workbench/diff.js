// 统一 diff 的解析与并排配对。纯函数，不碰文件系统，便于 node --test 直接跑。

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/;

/**
 * 把 `git diff` 的输出解析成 hunk 与逐行记录。
 * 只关心 @@ 之后的内容；文件头、二进制提示、模式变更行都忽略。
 *
 * @param {string} text `git diff --no-color` 的 stdout
 * @returns {{hunks: Array<{oldStart:number, newStart:number, title:string, rows: Array<{kind:"ctx"|"add"|"del", oldNo:number|null, newNo:number|null, text:string}>}>, binary:boolean, empty:boolean}}
 */
export function parseUnifiedDiff(text) {
  const hunks = [];
  let current = null;
  let oldNo = 0;
  let newNo = 0;
  let binary = false;

  for (const line of String(text ?? "").split("\n")) {
    if (line.startsWith("Binary files ") || line.startsWith("GIT binary patch")) binary = true;
    const hunk = HUNK.exec(line);
    if (hunk) {
      oldNo = Number(hunk[1]);
      newNo = Number(hunk[3]);
      current = { oldStart: oldNo, newStart: newNo, title: line, rows: [] };
      hunks.push(current);
      continue;
    }
    if (!current) continue;
    if (line.startsWith("\\ No newline")) {
      const last = current.rows[current.rows.length - 1];
      if (last) last.noNewline = true;
      continue;
    }
    if (line.startsWith("diff --git ") || line.startsWith("index ") || line.startsWith("--- ") || line.startsWith("+++ ")) {
      // 新文件头：当前 hunk 已结束。
      current = null;
      continue;
    }
    const marker = line[0];
    if (marker === "+") {
      current.rows.push({ kind: "add", oldNo: null, newNo: newNo++, text: line.slice(1) });
    } else if (marker === "-") {
      current.rows.push({ kind: "del", oldNo: oldNo++, newNo: null, text: line.slice(1) });
    } else if (marker === " ") {
      current.rows.push({ kind: "ctx", oldNo: oldNo++, newNo: newNo++, text: line.slice(1) });
    } else if (line === "") {
      // 某些命令在末尾多一个空行；不当作上下文。
      continue;
    }
  }

  return { hunks, binary, empty: hunks.length === 0 && !binary };
}

/** 统计 hunk 里的增删行数。 */
export function countChanges(hunks) {
  let add = 0;
  let del = 0;
  for (const hunk of hunks) {
    for (const row of hunk.rows) {
      if (row.kind === "add") add++;
      else if (row.kind === "del") del++;
    }
  }
  return { add, del };
}

/**
 * 把词切成可比较的 token：连续标识符、空白、单个符号。
 * 中文等非 ASCII 字母按单字切分，两侧仍能对齐。
 */
export function tokenize(text) {
  return String(text ?? "").match(/\s+|[A-Za-z0-9_]+|[^\sA-Za-z0-9_]/g) ?? [];
}

/**
 * 词级最长公共子序列，返回两侧的变更标记。
 * token 数过多时退化为整行标记，避免长行拖慢渲染。
 *
 * @param {string} left
 * @param {string} right
 * @returns {{left: Array<{text:string, changed:boolean}>, right: Array<{text:string, changed:boolean}>}}
 */
export function inlineSegments(left, right) {
  const a = tokenize(left);
  const b = tokenize(right);
  if (!a.length || !b.length || a.length * b.length > 40000) {
    return {
      left: left ? [{ text: left, changed: true }] : [],
      right: right ? [{ text: right, changed: true }] : [],
    };
  }

  // dp[i][j] = a[0..i) 与 b[0..j) 的 LCS 长度。
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp = new Uint16Array(rows * cols);
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      dp[i * cols + j] = a[i - 1] === b[j - 1]
        ? dp[(i - 1) * cols + (j - 1)] + 1
        : Math.max(dp[(i - 1) * cols + j], dp[i * cols + (j - 1)]);
    }
  }

  const leftKept = new Uint8Array(a.length);
  const rightKept = new Uint8Array(b.length);
  for (let i = a.length, j = b.length; i > 0 && j > 0;) {
    if (a[i - 1] === b[j - 1]) {
      leftKept[i - 1] = 1;
      rightKept[j - 1] = 1;
      i--;
      j--;
    } else if (dp[(i - 1) * cols + j] >= dp[i * cols + (j - 1)]) {
      i--;
    } else {
      j--;
    }
  }

  return { left: mergeTokens(a, leftKept), right: mergeTokens(b, rightKept) };
}

function mergeTokens(tokens, kept) {
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const changed = kept[i] === 0;
    const last = out[out.length - 1];
    if (last && last.changed === changed) last.text += tokens[i];
    else out.push({ text: tokens[i], changed });
  }
  return out;
}

/**
 * 两行相似度：用 LCS 长度除以较长一方的 token 数。
 * 用来决定删/增行是否值得并排配对。
 */
export function similarity(left, right) {
  if (left === right) return 1;
  const a = tokenize(left);
  const b = tokenize(right);
  if (!a.length || !b.length) return 0;
  if (a.length * b.length > 40000) return 0;
  const cols = b.length + 1;
  let prev = new Uint16Array(cols);
  let cur = new Uint16Array(cols);
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      cur[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1] + 1
        : Math.max(prev[j], cur[j - 1]);
    }
    [prev, cur] = [cur, prev];
    cur.fill(0);
  }
  const lcs = prev[b.length];
  return (2 * lcs) / (a.length + b.length);
}

/**
 * 在一个变更块内配对删行与增行。
 * 先按文本完全相等配对，再按相似度贪心配对；相似度低于阈值的不配，
 * 宁可左右各占一行，也不把两行不相干的代码硬放在一起。
 */
function pairBlock(dels, adds) {
  const pairs = [];
  const usedAdd = new Uint8Array(adds.length);

  // 完全相等的行优先，保持原有顺序。
  for (const del of dels) {
    const index = adds.findIndex((add, i) => !usedAdd[i] && add.text === del.text);
    if (index >= 0) {
      usedAdd[index] = 1;
      pairs.push({ del, add: adds[index] });
    } else {
      pairs.push({ del, add: null });
    }
  }

  const freeAdds = adds.filter((_, i) => !usedAdd[i]);
  for (const pair of pairs) {
    if (pair.add) continue;
    let best = -1;
    let bestScore = 0.34;
    for (let i = 0; i < freeAdds.length; i++) {
      if (!freeAdds[i]) continue;
      const score = similarity(pair.del.text, freeAdds[i].text);
      if (score > bestScore) {
        best = i;
        bestScore = score;
      }
    }
    if (best >= 0) {
      pair.add = freeAdds[best];
      freeAdds[best] = null;
    }
  }
  for (const add of freeAdds) if (add) pairs.push({ del: null, add });
  return pairs;
}

/**
 * 把一个 hunk 排成并排行。
 * 每行：{ left, right }，各自是 { no, text, kind, segments } 或 null。
 * kind: "ctx" | "del" | "add" | "empty"。
 *
 * @param {{rows: Array<{kind:string, oldNo:number|null, newNo:number|null, text:string}>}} hunk
 */
export function sideBySide(hunk) {
  const out = [];
  let i = 0;
  const rows = hunk.rows;
  while (i < rows.length) {
    const row = rows[i];
    if (row.kind === "ctx") {
      out.push({
        left: { no: row.oldNo, text: row.text, kind: "ctx", segments: null },
        right: { no: row.newNo, text: row.text, kind: "ctx", segments: null },
      });
      i++;
      continue;
    }

    // 连续的删/增行组成一个变更块。
    const dels = [];
    const adds = [];
    while (i < rows.length && rows[i].kind !== "ctx") {
      if (rows[i].kind === "del") dels.push(rows[i]);
      else adds.push(rows[i]);
      i++;
    }

    for (const { del, add } of pairBlock(dels, adds)) {
      if (del && add) {
        const segs = inlineSegments(del.text, add.text);
        out.push({
          left: { no: del.oldNo, text: del.text, kind: "del", segments: segs.left },
          right: { no: add.newNo, text: add.text, kind: "add", segments: segs.right },
        });
      } else if (del) {
        out.push({
          left: { no: del.oldNo, text: del.text, kind: "del", segments: null },
          right: null,
        });
      } else if (add) {
        out.push({
          left: null,
          right: { no: add.newNo, text: add.text, kind: "add", segments: null },
        });
      }
    }
  }
  return out;
}

/** 把文件内容包成“全新增”的 diff，用于未跟踪文件。 */
export function wholeFileDiff(text) {
  const lines = String(text ?? "").replace(/\n$/, "").split("\n");
  const rows = lines.map((line, index) => ({
    kind: "add",
    oldNo: null,
    newNo: index + 1,
    text: line,
  }));
  return {
    hunks: rows.length ? [{ oldStart: 0, newStart: 1, title: `@@ -0,0 +1,${rows.length} @@`, rows }] : [],
    binary: false,
    empty: rows.length === 0,
  };
}
