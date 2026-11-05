// Git 访问层：所有命令都通过 herdr 的 exec 在用户真实环境里运行。
// 读操作附加 --no-optional-locks，避免刷新本身写入 .git 又触发 watchFolder。

import { exec, readTextFile } from "herdr";
import {
  LOG_FORMAT,
  buildStatusFiles,
  parseAheadBehind,
  parseBlame,
  parseBranches,
  parseLog,
  parseNameStatusZ,
  parseNumstatZ,
  parseStatusZ,
  repoName,
} from "./git-parse.js";
import { countChanges, parseUnifiedDiff, wholeFileDiff } from "./diff.js";

const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false"];
const MAX_DIFF_BYTES = 1_500_000;

/**
 * 运行 git。命令无法启动时也返回结果对象，交给界面显示。
 * @param {string} cwd
 * @param {string[]} args
 * @param {{on?: string|null, read?: boolean}} [options]
 */
async function runGit(cwd, args, { on = null, read = true } = {}) {
  const full = read ? [...READ, ...args] : args;
  try {
    const r = await exec("git", full, { cwd, on });
    return { ok: r.code === 0, code: r.code, out: r.stdout ?? "", err: (r.stderr || r.stdout || "").trim() };
  } catch (error) {
    return { ok: false, code: -1, out: "", err: error?.message ?? String(error) };
  }
}

/**
 * 找到 cwd 所属仓库。
 * @returns {Promise<{root:string, name:string, branch:string|null, head:string|null, on:string|null, bare:boolean}|null>}
 */
export async function findRepo(cwd, on = null) {
  if (!cwd) return null;
  const top = await runGit(cwd, ["rev-parse", "--show-toplevel"], { on });
  if (!top.ok) return null;
  const root = top.out.trim();
  if (!root) return null;
  const [branch, head, bare] = await Promise.all([
    runGit(root, ["branch", "--show-current"], { on }),
    runGit(root, ["rev-parse", "--short", "HEAD"], { on }),
    runGit(root, ["rev-parse", "--is-bare-repository"], { on }),
  ]);
  return {
    root,
    name: repoName(root),
    branch: branch.ok ? branch.out.trim() || null : null,
    head: head.ok ? head.out.trim() : null,
    on,
    bare: bare.ok && bare.out.trim() === "true",
  };
}

/** 当前仓库的 HEAD 是否存在（空仓库为 false）。 */
export async function hasHead(root, on = null) {
  return (await runGit(root, ["rev-parse", "--verify", "HEAD"], { on })).ok;
}

/**
 * 读取一页提交。rev 可以是 HEAD、分支名或 hash。
 * @returns {Promise<{ok:boolean, commits:Array, err:string}>}
 */
export async function loadLog(root, on, { limit = 150, skip = 0, rev = "HEAD", grep = null } = {}) {
  const args = ["log", "--no-color", `--pretty=format:${LOG_FORMAT}`, "-n", String(limit)];
  if (skip > 0) args.push("--skip", String(skip));
  if (grep) args.push("--fixed-strings", "-i", `--grep=${grep}`);
  args.push(rev);
  const r = await runGit(root, args, { on });
  if (!r.ok) return { ok: false, commits: [], err: r.err };
  return { ok: true, commits: parseLog(r.out), err: "" };
}

/** 一个提交的完整说明与父提交。 */
export async function loadCommitMeta(root, on, hash) {
  const [body, parents] = await Promise.all([
    runGit(root, ["show", "-s", "--format=%B", hash], { on }),
    runGit(root, ["rev-list", "--parents", "-n", "1", hash], { on }),
  ]);
  const parentList = parents.ok ? (parents.out.trim().split(/\s+/).slice(1)) : [];
  return { body: body.ok ? body.out.replace(/\n+$/, "") : "", parents: parentList };
}

/**
 * 一个提交改动的文件列表。
 * 合并提交相对第一父显示；根提交用 --root。
 */
export async function loadCommitFiles(root, on, hash, parents = []) {
  const rootCommit = parents.length === 0;
  const merge = parents.length > 1;
  const base = merge
    ? ["diff", "--no-renames", `${hash}^1`, hash]
    : ["diff-tree", "--root", "--no-commit-id", "-r", hash];
  const [names, stats] = await Promise.all([
    runGit(root, [...base, "--name-status", "-z"], { on }),
    runGit(root, [...base, "--numstat", "-z"], { on }),
  ]);
  if (!names.ok) return { ok: false, files: [], err: names.err };
  const statMap = new Map((stats.ok ? parseNumstatZ(stats.out) : []).map((s) => [s.path, s]));
  const files = parseNameStatusZ(names.out).map(({ status, path, oldPath }) => {
    const stat = statMap.get(path) ?? statMap.get(oldPath ?? "") ?? { add: 0, del: 0, binary: false };
    return { path, oldPath, status: statusLetterFromGit(status), add: stat.add, del: stat.del, binary: stat.binary };
  });
  return { ok: true, files, err: "", rootCommit };
}

function statusLetterFromGit(status) {
  if (status === "A" || status === "C") return "A";
  if (status === "D") return "D";
  if (status === "R") return "R";
  if (status === "U") return "U";
  return "M";
}

/**
 * 读取单个文件的 diff 文本。
 * spec.kind: "commit"（相对第一父）、"range"（A→B）、"work"、"staged"。
 */
export async function loadFileDiff(root, on, spec) {
  const common = ["--no-color", "--no-ext-diff", "--no-textconv", "--no-renames", "--unified=3"];
  let args;
  if (spec.kind === "commit") {
    // 有父提交时相对第一父；根提交用 show 得到整文件新增。
    args = spec.base
      ? ["diff", ...common, spec.base, spec.to, "--", spec.path]
      : ["show", "--format=", ...common, spec.to, "--", spec.path];
  } else if (spec.kind === "range") {
    args = ["diff", ...common, spec.from, ...(spec.to ? [spec.to] : []), "--", spec.path];
  } else if (spec.kind === "staged") {
    args = ["diff", "--cached", ...common, "--", spec.path];
  } else {
    args = ["diff", ...common, "--", spec.path];
  }
  const r = await runGit(root, args, { on });
  if (!r.ok) return { ok: false, parsed: null, err: r.err, truncated: false };
  const text = r.out.length > MAX_DIFF_BYTES ? r.out.slice(0, MAX_DIFF_BYTES) : r.out;
  return { ok: true, parsed: parseUnifiedDiff(text), err: "", truncated: r.out.length > MAX_DIFF_BYTES };
}

/** 未跟踪文件按整文件新增处理。 */
export async function loadUntrackedDiff(root, on, path) {
  const text = await readTextFile(`${root}/${path}`, { on }).catch(() => null);
  if (text === null) return { ok: false, parsed: null, err: "无法读取该文件（二进制、过大或不可访问）" };
  if (text.includes("\0")) return { ok: false, parsed: null, err: "二进制文件，没有文本 diff" };
  const clipped = text.length > MAX_DIFF_BYTES ? text.slice(0, MAX_DIFF_BYTES) : text;
  return { ok: true, parsed: wholeFileDiff(clipped), err: "", truncated: text.length > MAX_DIFF_BYTES };
}

/** 工作区状态：暂存、未暂存、未跟踪，以及每个文件的行数。 */
export async function loadStatus(root, on) {
  const head = await hasHead(root, on);
  const [status, stagedStats, workStats] = await Promise.all([
    runGit(root, ["status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"], { on }),
    runGit(root, ["diff", "--cached", "--numstat", "-z", "--no-renames"], { on }),
    runGit(root, ["diff", "--numstat", "-z", "--no-renames"], { on }),
  ]);
  if (!status.ok) return { ok: false, files: [], err: status.err, hasHead: head };
  const stagedMap = new Map((stagedStats.ok ? parseNumstatZ(stagedStats.out) : []).map((s) => [s.path, s]));
  const workMap = new Map((workStats.ok ? parseNumstatZ(workStats.out) : []).map((s) => [s.path, s]));
  const entries = parseStatusZ(status.out);
  const files = buildStatusFiles(entries, stagedMap, workMap);

  // 未跟踪文件没有 numstat：读文本数行，最多补 300 个，避免一次打开上千个文件。
  const untracked = files.filter((f) => f.untracked).slice(0, 300);
  await Promise.all(untracked.map(async (file) => {
    const text = await readTextFile(`${root}/${file.path}`, { on }).catch(() => null);
    if (text === null) { file.binary = true; return; }
    if (text.includes("\0")) { file.binary = true; return; }
    file.add = text ? text.split("\n").length - Number(text.endsWith("\n")) : 0;
  }));

  return { ok: true, files, err: "", hasHead: head };
}

/**
 * 两点之间的文件列表。to 为空表示工作区。
 * @param {string} from 分支、标签或 hash
 * @param {string|null} to 同上；为空表示工作区
 */
export async function loadRangeFiles(root, on, from, to) {
  const common = ["diff", "--no-renames", from, ...(to ? [to] : [])];
  const [names, stats] = await Promise.all([
    runGit(root, [...common, "--name-status", "-z"], { on }),
    runGit(root, [...common, "--numstat", "-z"], { on }),
  ]);
  if (!names.ok) return { ok: false, files: [], err: names.err };
  const statMap = new Map((stats.ok ? parseNumstatZ(stats.out) : []).map((s) => [s.path, s]));
  const files = parseNameStatusZ(names.out).map(({ status, path, oldPath }) => {
    const stat = statMap.get(path) ?? statMap.get(oldPath ?? "") ?? { add: 0, del: 0, binary: false };
    return { path, oldPath, status: statusLetterFromGit(status), add: stat.add, del: stat.del, binary: stat.binary };
  });
  return { ok: true, files, err: "" };
}

/** 本地/远程分支与标签。 */
export async function loadBranches(root, on) {
  const format = [
    "%(refname)",
    "%(refname:short)",
    "%(objectname:short)",
    "%(HEAD)",
    "%(upstream:short)",
    "%(upstream:track)",
    "%(committerdate:iso-strict)",
    "%(contents:subject)",
    "%(symref)",
    "%(authorname)",
  ].join("|");
  const r = await runGit(root, ["for-each-ref", `--format=${format}`, "refs/heads", "refs/remotes", "refs/tags"], { on });
  if (!r.ok) return { ok: false, branches: [], err: r.err };
  return { ok: true, branches: parseBranches(r.out).filter((branch) => !branch.symbolic), err: "" };
}

/** 远程列表。 */
export async function loadRemotes(root, on) {
  const r = await runGit(root, ["remote"], { on });
  return r.ok ? r.out.split("\n").map((s) => s.trim()).filter(Boolean) : [];
}

/** 仓库里的文件：已跟踪 + 未跟踪（遵守 .gitignore），用于文件选择。 */
export async function loadFiles(root, on) {
  const r = await runGit(root, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { on });
  if (!r.ok) return { ok: false, files: [], err: r.err };
  return { ok: true, files: r.out.split("\0").filter(Boolean), err: "" };
}

/** 两点的 ahead/behind。 */
export async function aheadBehind(root, on, a, b) {
  const r = await runGit(root, ["rev-list", "--left-right", "--count", `${a}...${b}`], { on });
  return r.ok ? parseAheadBehind(r.out) : { ahead: 0, behind: 0 };
}

/** 逐行 blame，最多 maxLines 行。 */
export async function loadBlame(root, on, path, maxLines = 5000, rev = "") {
  const r = await runGit(root, ["blame", "--line-porcelain", "-L", `1,${maxLines}`, ...(rev ? [rev] : []), "--", path], { on });
  if (!r.ok) return { ok: false, lines: [], err: r.err };
  return { ok: true, lines: parseBlame(r.out), err: "" };
}

/** 单文件历史（--follow 跨重命名）。 */
export async function loadFileHistory(root, on, path, limit = 200) {
  const r = await runGit(root, ["log", "--no-color", "--follow", "--pretty=format:" + LOG_FORMAT, "-n", String(limit), "--", path], { on });
  if (!r.ok) return { ok: false, commits: [], err: r.err };
  return { ok: true, commits: parseLog(r.out), err: "" };
}

/** 文件在工作区（或某个提交里）的文本，用于 blame 头部与比较。 */
export async function readFileAt(root, on, path, rev = null) {
  if (rev) {
    const r = await runGit(root, ["show", `${rev}:${path}`], { on });
    return r.ok ? r.out : null;
  }
  return readTextFile(`${root}/${path}`, { on }).catch(() => null);
}

/** 仓库是否有未推送提交对应的 upstream。 */
export async function upstreamOf(root, on, branch) {
  const r = await runGit(root, ["rev-parse", "--abbrev-ref", `${branch}@{upstream}`], { on });
  return r.ok ? r.out.trim() : null;
}

// ---- 写操作 -------------------------------------------------------------

/**
 * 执行一个写操作。调用方必须已经让用户确认过。
 * @param {string} root
 * @param {string|null} on
 * @param {string[]} args
 */
export async function runWrite(root, on, args) {
  return runGit(root, args, { on, read: false });
}

export const write = {
  stage: (root, on, paths) => runWrite(root, on, ["add", "--", ...paths]),
  stageAll: (root, on) => runWrite(root, on, ["add", "-A"]),
  unstage: (root, on, paths) => runWrite(root, on, ["restore", "--staged", "--", ...paths]),
  unstageAll: (root, on) => runWrite(root, on, ["restore", "--staged", "--", "."]),
  restore: (root, on, paths) => runWrite(root, on, ["restore", "--", ...paths]),
  restoreAll: (root, on) => runWrite(root, on, ["restore", "--", "."]),
  commit: (root, on, message, amend = false) =>
    runWrite(root, on, amend ? ["commit", "--amend", "-m", message] : ["commit", "-m", message]),
  switchBranch: (root, on, name) => runWrite(root, on, ["switch", name]),
  createBranch: (root, on, name, rev = "HEAD") => runWrite(root, on, ["switch", "-c", name, rev]),
  deleteBranch: (root, on, name, force = false) => runWrite(root, on, ["branch", force ? "-D" : "-d", name]),
  merge: (root, on, rev) => runWrite(root, on, ["merge", "--no-edit", rev]),
  rebase: (root, on, rev) => runWrite(root, on, ["rebase", rev]),
  cherryPick: (root, on, hash) => runWrite(root, on, ["cherry-pick", hash]),
  revert: (root, on, hash) => runWrite(root, on, ["revert", "--no-edit", hash]),
  reset: (root, on, mode, rev) => runWrite(root, on, ["reset", `--${mode}`, rev]),
  stash: (root, on, includeUntracked = false) =>
    runWrite(root, on, includeUntracked ? ["stash", "push", "-u"] : ["stash", "push"]),
  stashPop: (root, on) => runWrite(root, on, ["stash", "pop"]),
  fetch: (root, on) => runWrite(root, on, ["fetch", "--all", "--prune"]),
  pull: (root, on) => runWrite(root, on, ["pull", "--ff-only"]),
  push: (root, on, setNameUpstream = false) =>
    runWrite(root, on, setNameUpstream ? ["push", "-u", "origin", "HEAD"] : ["push"]),
  tag: (root, on, name, rev = "HEAD") => runWrite(root, on, ["tag", name, rev]),
  deleteTag: (root, on, name) => runWrite(root, on, ["tag", "-d", name]),
};

/** 供界面显示：把 hunk 统计成 +N -N。 */
export function diffStats(parsed) {
  return parsed ? countChanges(parsed.hunks) : { add: 0, del: 0 };
}
