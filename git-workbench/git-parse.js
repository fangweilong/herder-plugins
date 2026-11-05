// git 输出解析：纯函数，不 import herdr，便于 node --test 直接跑。

/** 提交日志的字段分隔符（%x1f）与记录分隔符（%x1e），与 git.js 中的格式串一致。 */
export const FIELD = "\x1f";
export const RECORD = "\x1e";

export const LOG_FORMAT = [
  "%H", // 完整 hash
  "%h", // 短 hash
  "%an", // 作者
  "%ae", // 邮箱
  "%aI", // ISO 时间
  "%P", // 父提交
  "%s", // 标题
  "%D", // refs
].join("%x1f") + "%x1e";

/**
 * 解析 `git log --pretty=format:<LOG_FORMAT>`。
 * @param {string} out
 * @returns {Array<{hash:string, short:string, author:string, email:string, date:string, parents:string[], subject:string, refs:string[], merge:boolean}>}
 */
export function parseLog(out) {
  return String(out ?? "")
    .split(RECORD)
    .map((chunk) => chunk.replace(/^\n+|\n+$/g, ""))
    .filter(Boolean)
    .map((chunk) => {
      const [hash, short, author, email, date, parents, subject, refs] = chunk.split(FIELD);
      const parentList = parents ? parents.trim().split(/\s+/).filter(Boolean) : [];
      return {
        hash,
        short,
        author,
        email,
        date,
        parents: parentList,
        subject: subject ?? "",
        refs: parseRefs(refs),
        merge: parentList.length > 1,
      };
    });
}

/** `%D` 的 "HEAD -> main, origin/main, tag: v1" 转成简短标签。 */
export function parseRefs(text) {
  if (!text) return [];
  return text.split(",").map((ref) => ref.trim()).filter(Boolean).map((ref) => {
    if (ref.startsWith("HEAD -> ")) return { name: ref.slice(8), head: true, kind: "branch" };
    if (ref.startsWith("tag: ")) return { name: ref.slice(5), head: false, kind: "tag" };
    if (ref === "HEAD") return { name: "HEAD", head: true, kind: "head" };
    return { name: ref, head: false, kind: /^[^/]+\//.test(ref) ? "remote" : "branch" };
  });
}

/**
 * 解析 `git status --porcelain=v1 -z --no-renames`。
 * @param {string} out
 * @returns {Array<{x:string, y:string, path:string}>}
 */
export function parseStatusZ(out) {
  return String(out ?? "")
    .split("\0")
    .filter(Boolean)
    .map((entry) => {
      const x = entry[0];
      const y = entry[1];
      const path = entry.slice(3);
      return { x, y, path };
    });
}

/**
 * 解析 `git diff --numstat -z`。
 * 输出是 "add\tdel\tpath\0"；二进制文件的 add/del 为 "-"。
 * @param {string} out
 * @returns {Array<{path:string, add:number, del:number, binary:boolean}>}
 */
export function parseNumstatZ(out) {
  const result = [];
  for (const entry of String(out ?? "").split("\0")) {
    if (!entry) continue;
    const first = entry.indexOf("\t");
    const second = entry.indexOf("\t", first + 1);
    if (first < 0 || second < 0) continue;
    const add = entry.slice(0, first);
    const del = entry.slice(first + 1, second);
    const path = entry.slice(second + 1);
    result.push({
      path,
      add: Number(add) || 0,
      del: Number(del) || 0,
      binary: add === "-" || del === "-",
    });
  }
  return result;
}

/**
 * 解析 `git diff --name-status -z`。
 * 输出是 "M\0path\0"；重命名是 "R100\0old\0new\0"，这里未启用重命名检测。
 * @param {string} out
 * @returns {Array<{status:string, path:string, oldPath:string|null}>}
 */
export function parseNameStatusZ(out) {
  const parts = String(out ?? "").split("\0");
  const result = [];
  for (let i = 0; i < parts.length;) {
    const status = parts[i++];
    if (!status) continue;
    if (status.startsWith("R") || status.startsWith("C")) {
      const oldPath = parts[i++];
      const path = parts[i++];
      result.push({ status: status[0], path, oldPath });
    } else {
      const path = parts[i++];
      if (path !== undefined) result.push({ status: status[0], path, oldPath: null });
    }
  }
  return result;
}

/**
 * 合并 status、numstat 与 name-status，得到文件树需要的行。
 * @param {Array<{x:string,y:string,path:string}>} entries
 * @param {Map<string,{add:number,del:number,binary:boolean}>} stagedStats
 * @param {Map<string,{add:number,del:number,binary:boolean}>} workStats
 */
export function buildStatusFiles(entries, stagedStats, workStats) {
  return entries.map(({ x, y, path }) => {
    const untracked = x === "?" && y === "?";
    const staged = !untracked && x !== " " && x !== "?";
    const unstaged = !untracked && y !== " " && y !== "?";
    const conflict = x === "U" || y === "U" || (x === "A" && y === "A") || (x === "D" && y === "D");
    const stat = (staged ? stagedStats.get(path) : null) || (unstaged ? workStats.get(path) : null) || { add: 0, del: 0, binary: false };
    return { path, x, y, untracked, staged, unstaged, conflict, add: stat.add, del: stat.del, binary: stat.binary };
  });
}

/** 文件状态字母：冲突 > 删除 > 新增 > 修改。 */
export function statusLetter(file) {
  if (file.conflict) return "U";
  if (file.untracked) return "A";
  if (file.x === "D" || file.y === "D") return "D";
  if (file.x === "A" || file.y === "A") return "A";
  if (file.x === "R" || file.y === "R") return "R";
  return "M";
}

/**
 * 解析 `git for-each-ref --format=...` 的分支列表。
 * 字段：完整 ref、short name、hash、HEAD 标记、upstream、upstream:track、时间、主题、symref、作者。
 * @param {string} out
 * @returns {Array<{name:string, hash:string, current:boolean, upstream:string|null, ahead:number, behind:number, date:string, subject:string, author:string, kind:"branch"|"remote"|"tag"}>}
 */
export function parseBranches(out, separator = "|") {
  const result = [];
  for (const line of String(out ?? "").split("\n")) {
    if (!line.trim()) continue;
    const [ref, name, hash, head, upstream, track, date, subject, symref, author] = line.split(separator);
    if (!name) continue;
    const ahead = /ahead (\d+)/.exec(track ?? "");
    const behind = /behind (\d+)/.exec(track ?? "");
    const kind = ref.startsWith("refs/tags/") ? "tag" : ref.startsWith("refs/remotes/") ? "remote" : "branch";
    result.push({
      name,
      hash,
      current: head === "*",
      upstream: upstream || null,
      ahead: ahead ? Number(ahead[1]) : 0,
      behind: behind ? Number(behind[1]) : 0,
      date: date ?? "",
      subject: subject ?? "",
      author: author ?? "",
      kind,
      // 远程 HEAD 是符号引用（refs/remotes/origin/HEAD → origin/main），不当作分支列出。
      symbolic: Boolean(symref),
    });
  }
  return result;
}

/**
 * 解析 `git blame --line-porcelain`。
 * 每块首行：<hash> <orig-line> <final-line> <count>，之后是头部键值，\t 开头的是代码行。
 * @param {string} out
 * @returns {Array<{hash:string, short:string, author:string, time:number, summary:string, line:number, code:string}>}
 */
export function parseBlame(out) {
  const lines = [];
  let meta = null;
  for (const raw of String(out ?? "").split("\n")) {
    if (raw.startsWith("\t")) {
      if (meta) {
        meta.code = raw.slice(1);
        lines.push(meta);
        meta = null;
      }
      continue;
    }
    const header = /^(\^?[0-9a-f]{7,40}) \d+ (\d+)(?: \d+)?$/.exec(raw);
    if (header) {
      meta = { hash: header[1].replace(/^\^/, ""), line: Number(header[2]), author: "", time: 0, summary: "", code: "" };
      continue;
    }
    if (!meta) continue;
    if (raw.startsWith("author ")) meta.author = raw.slice(7);
    else if (raw.startsWith("author-time ")) meta.time = Number(raw.slice(12)) || 0;
    else if (raw.startsWith("summary ")) meta.summary = raw.slice(8);
  }
  for (const line of lines) line.short = line.hash.slice(0, 7);
  return lines;
}

/**
 * 解析 `git rev-list --left-right --count A...B`，返回 [ahead, behind]。
 * 输出形如 "3\t5"。
 */
export function parseAheadBehind(out) {
  const [ahead, behind] = String(out ?? "").trim().split(/\s+/);
  return { ahead: Number(ahead) || 0, behind: Number(behind) || 0 };
}

/** 相对时间，输入 ISO 8601 或 unix 秒。 */
export function relativeTime(value, now = Date.now()) {
  const ms = typeof value === "number" ? value * 1000 : Date.parse(value);
  if (!Number.isFinite(ms)) return "";
  const diff = Math.max(0, now - ms);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return "刚刚";
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`;
  if (diff < 30 * day) return `${Math.floor(diff / day)} 天前`;
  const date = new Date(ms);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const dayOfMonth = String(date.getDate()).padStart(2, "0");
  return sameYear ? `${month}-${dayOfMonth}` : `${date.getFullYear()}-${month}-${dayOfMonth}`;
}

/** 截断过长的单行，避免一行几 MB 撑爆布局。 */
export function clipLine(text, max = 4000) {
  return text.length > max ? `${text.slice(0, max)}… (行已截断)` : text;
}

/** 仓库根目录的最后一段，作为显示名。 */
export function repoName(root) {
  return String(root ?? "").split(/[\\/]/).filter(Boolean).pop() ?? "";
}
