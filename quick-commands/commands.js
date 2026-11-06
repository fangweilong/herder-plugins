// 快捷命令的纯数据逻辑：默认模板、配置校验、搜索、变量展开。
// 不依赖 Herdr 运行时，node --test 可以直接导入。

export const CONFIG_VERSION = 2;

// 只展开白名单变量；未识别的 ${...} 原样保留，避免和 shell 自己的变量冲突。
const SIMPLE_VARIABLES = new Set(["cwd", "repo", "branch", "home", "date", "time"]);

function entry(id, name, command, group, description = "") {
  return { id, name, command, group, description };
}

export const FALLBACK_COMMANDS = [
  entry("npm-install", "安装依赖", "npm install", "npm"),
  entry("npm-start", "启动", "npm start", "npm", "package.json 的 start 脚本"),
  entry("npm-dev", "开发模式", "npm run dev", "npm"),
  entry("npm-build", "构建", "npm run build", "npm"),
  entry("npm-test", "运行测试", "npm test", "npm"),

  entry("pnpm-install", "安装依赖", "pnpm install", "pnpm"),
  entry("pnpm-dev", "开发模式", "pnpm dev", "pnpm"),
  entry("pnpm-build", "构建", "pnpm build", "pnpm"),
  entry("pnpm-test", "运行测试", "pnpm test", "pnpm"),

  entry("cargo-run", "运行", "cargo run", "Rust"),
  entry("cargo-build", "构建", "cargo build", "Rust"),
  entry("cargo-test", "运行测试", "cargo test", "Rust"),
  entry("cargo-clippy", "Clippy 检查", "cargo clippy --all-targets --all-features", "Rust"),
  entry("cargo-fmt", "格式化", "cargo fmt", "Rust"),

  entry("mvnw-run", "启动（Maven Wrapper）", "./mvnw spring-boot:run", "Spring Boot"),
  entry("mvnw-package", "打包（Maven Wrapper）", "./mvnw clean package", "Spring Boot"),
  entry("mvn-run", "启动（mvn）", "mvn spring-boot:run", "Spring Boot"),
  entry("gradlew-bootrun", "启动（Gradle Wrapper）", "./gradlew bootRun", "Spring Boot"),
  entry("gradlew-build", "构建（Gradle Wrapper）", "./gradlew build", "Spring Boot"),

  entry("py-venv", "创建虚拟环境", "python -m venv .venv", "Python"),
  entry("pip-install", "安装依赖", "pip install -r requirements.txt", "Python"),
  entry("pytest", "运行测试", "python -m pytest", "Python"),
  entry("py-main", "运行 main.py", "python main.py", "Python"),
  entry("uv-sync", "同步依赖（uv）", "uv sync", "Python"),
  entry("uv-pytest", "运行测试（uv）", "uv run pytest", "Python"),
  entry("poetry-install", "安装依赖（Poetry）", "poetry install", "Python"),
  entry("poetry-pytest", "运行测试（Poetry）", "poetry run pytest", "Python"),

  entry("git-status", "状态", "git status", "Git"),
  entry("git-pull", "拉取", "git pull --ff-only", "Git"),
  entry("git-push", "推送", "git push", "Git"),
  entry("git-log", "最近提交", "git log --oneline -20", "Git"),
  entry("git-diff", "查看改动", "git diff --stat", "Git"),

  entry("clear", "清屏", "clear", "通用"),
];

/** 生成一个稳定且可读的新命令 id；同一毫秒内多次调用也不会撞。 */
export function makeId() {
  return `cmd-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** 首次写入磁盘的配置。项目模板由 project.js 在运行时生成，配置文件只保存用户自定义命令。 */
export function defaultConfig() {
  return { version: CONFIG_VERSION, commands: [] };
}

/**
 * 兼容 v1 的配置文件：v1 首次运行会把整套静态模板写进 commands.json。
 * 迁移时只丢掉“原封不动”的内置模板，用户改过或新增的命令保留。
 */
export function migrateConfig(raw) {
  const commands = normalizeConfig(raw);
  const version = Number(raw?.version) || 1;
  if (version >= CONFIG_VERSION) return { version: CONFIG_VERSION, commands };
  const seeds = new Map(FALLBACK_COMMANDS.map((item) => [item.id, item]));
  return {
    version: CONFIG_VERSION,
    commands: commands.filter((item) => {
      const seed = seeds.get(item.id);
      return !seed || seed.name !== item.name || seed.command !== item.command
        || seed.group !== item.group || seed.description !== item.description;
    }),
  };
}

/** 旧名字保留给已有调用方；新代码用 FALLBACK_COMMANDS。 */
export const DEFAULT_COMMANDS = FALLBACK_COMMANDS;

/**
 * 把任意 JSON 收敛成可渲染的命令数组。
 * 缺名称或命令的条目会被丢弃；重复或缺失的 id 会重新生成。
 */
export function normalizeConfig(raw) {
  const source = Array.isArray(raw) ? raw : Array.isArray(raw?.commands) ? raw.commands : [];
  const seen = new Set();
  const commands = [];
  for (const item of source) {
    if (!item || typeof item !== "object") continue;
    const name = String(item.name ?? "").trim();
    const command = String(item.command ?? "").trim();
    if (!name || !command) continue;
    let id = String(item.id ?? "").trim();
    if (!id || seen.has(id)) id = makeId();
    seen.add(id);
    commands.push({
      id,
      name,
      command,
      group: String(item.group ?? "").trim(),
      description: String(item.description ?? "").trim(),
    });
  }
  return commands;
}

export function serializeConfig(commands) {
  return JSON.stringify({ version: CONFIG_VERSION, commands }, null, 2) + "\n";
}

function fuzzyScore(text, query) {
  const hay = String(text ?? "").toLowerCase();
  const needle = query.toLowerCase();
  if (!needle) return 0;
  const at = hay.indexOf(needle);
  if (at >= 0) return at === 0 ? 0 : 1;
  let cursor = 0;
  let gaps = 0;
  let last = -1;
  for (const ch of needle) {
    const index = hay.indexOf(ch, cursor);
    if (index < 0) return null;
    if (last >= 0 && index > last + 1) gaps += index - last - 1;
    last = index;
    cursor = index + 1;
  }
  return 2 + gaps;
}

/** 先精确子串，再按字符子序列匹配；结果按相关度排序，空查询保留原顺序。 */
export function matchCommands(commands, query) {
  const q = String(query ?? "").trim();
  if (!q) return commands.slice();
  const scored = [];
  commands.forEach((command, index) => {
    let best = null;
    for (const field of [command.name, command.command, command.group, command.description]) {
      const score = fuzzyScore(field, q);
      if (score !== null && (best === null || score < best)) best = score;
    }
    if (best !== null) scored.push({ command, score: best, index });
  });
  scored.sort((a, b) => a.score - b.score || a.index - b.index);
  return scored.map((item) => item.command);
}

/**
 * 找出命令里会被替换的变量，按首次出现顺序去重。
 * kind: cwd / repo / branch / home / date / time / env / input。
 */
export function scanVariables(text) {
  const variables = [];
  const seen = new Set();
  const re = /\$\{([^{}]+)\}/g;
  let match;
  while ((match = re.exec(String(text ?? "")))) {
    const expression = match[1].trim();
    let variable = null;
    if (expression.startsWith("input:")) {
      const label = expression.slice(6).trim() || "输入";
      variable = { kind: "input", label };
      if (seen.has(`input:${label}`)) continue;
      seen.add(`input:${label}`);
    } else if (expression.startsWith("env:")) {
      const name = expression.slice(4).trim();
      if (!name) continue;
      variable = { kind: "env", name };
      if (seen.has(`env:${name}`)) continue;
      seen.add(`env:${name}`);
    } else if (SIMPLE_VARIABLES.has(expression)) {
      variable = { kind: expression };
      if (seen.has(expression)) continue;
      seen.add(expression);
    }
    if (variable) variables.push(variable);
  }
  return variables;
}

/**
 * 展开命令中的已知变量。
 * values: { cwd, repo, branch, home, date, time, inputs: { [label]: string }, env: { [name]: string } }
 * 未提供或未识别的变量保持原样。
 */
export function expandCommand(text, values = {}) {
  return String(text ?? "").replace(/\$\{([^{}]+)\}/g, (whole, raw) => {
    const expression = raw.trim();
    let value;
    if (expression.startsWith("input:")) {
      const label = expression.slice(6).trim() || "输入";
      value = values.inputs?.[label];
    } else if (expression.startsWith("env:")) {
      const name = expression.slice(4).trim();
      value = name ? values.env?.[name] : undefined;
    } else if (SIMPLE_VARIABLES.has(expression)) {
      value = values[expression];
    }
    return value === undefined || value === null ? whole : String(value);
  });
}

/** 插入或覆盖一条命令，保持原有顺序。 */
export function upsertCommand(commands, next) {
  const index = commands.findIndex((command) => command.id === next.id);
  if (index < 0) return [...commands, next];
  return commands.map((command, at) => (at === index ? next : command));
}

export function removeCommand(commands, id) {
  return commands.filter((command) => command.id !== id);
}
