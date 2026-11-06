// 按当前终端所在项目生成快捷命令：只排列这个项目实际用得上的启动、构建、测试命令。
// 纯函数，不读取文件系统；main.js 负责收集 facts，测试可以直接构造 facts。

import { FALLBACK_COMMANDS } from "./commands.js";

const SCRIPT_ORDER = {
  start: 0,
  dev: 1,
  develop: 2,
  serve: 3,
  build: 4,
  test: 5,
  "test:unit": 6,
  "test:e2e": 7,
  lint: 8,
  format: 9,
  fmt: 10,
  typecheck: 11,
  "type-check": 12,
  preview: 13,
  watch: 14,
  clean: 30,
};

const SCRIPT_LABELS = {
  start: "启动",
  dev: "开发",
  develop: "开发",
  serve: "开发",
  build: "构建",
  test: "测试",
  "test:unit": "单元测试",
  "test:e2e": "端到端测试",
  lint: "检查",
  format: "格式化",
  fmt: "格式化",
  typecheck: "类型检查",
  "type-check": "类型检查",
  preview: "预览",
  watch: "监听",
  clean: "清理",
};

const PROJECT_MARKERS = [
  "package.json",
  "Cargo.toml",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "pyproject.toml",
  "requirements.txt",
  "setup.py",
  "setup.cfg",
  "uv.lock",
  "poetry.lock",
];

function generated(id, name, command, group, description = "") {
  return { id: `auto:${id}`, name, command, group, description, generated: true };
}

function unique(list) {
  const commands = new Set();
  const ids = new Set();
  return list.filter((item) => {
    if (commands.has(item.command) || ids.has(item.id)) return false;
    commands.add(item.command);
    ids.add(item.id);
    return true;
  });
}

function norm(path) {
  return String(path ?? "").replace(/\\/g, "/").replace(/\/+$/, "");
}

function samePath(a, b) {
  return norm(a).toLowerCase() === norm(b).toLowerCase();
}

/** 先看终端目录，再看 git 根目录；这两处覆盖了单仓库和 monorepo 子包。 */
export function rootCandidates(cwd, gitRoot) {
  const roots = [];
  if (cwd) roots.push(cwd);
  if (gitRoot && !roots.some((root) => samePath(root, gitRoot))) roots.push(gitRoot);
  return roots;
}

export function packageManagerFor(files) {
  if (files.has("pnpm-lock.yaml")) return "pnpm";
  if (files.has("yarn.lock")) return "yarn";
  if (files.has("bun.lockb") || files.has("bun.lock")) return "bun";
  return "npm";
}

export function parseScripts(text) {
  try {
    // 某些 Windows 编辑器会给 package.json 加 BOM，JSON.parse 不认。
    const source = String(text ?? "");
    const data = JSON.parse(source.charCodeAt(0) === 0xfeff ? source.slice(1) : source);
    if (!data || Array.isArray(data.scripts) || typeof data.scripts !== "object" || !data.scripts) return [];
    return Object.entries(data.scripts)
      .filter(([, value]) => typeof value === "string" && value.trim())
      .map(([name]) => name);
  } catch {
    return [];
  }
}

export function hasProjectMarkers(facts) {
  if (facts.mainPy || facts.compose) return true;
  return PROJECT_MARKERS.some((name) => facts.files.has(name));
}

function nodeCommands(facts) {
  if (!facts.files.has("package.json")) return [];
  const manager = packageManagerFor(facts.files);
  const scripts = parseScripts(facts.packageJson ?? "");
  const ordered = scripts
    .map((name, index) => ({ name, index }))
    .sort((a, b) => (SCRIPT_ORDER[a.name] ?? 20) - (SCRIPT_ORDER[b.name] ?? 20) || a.index - b.index);

  const commands = ordered.map(({ name }) => {
    const label = SCRIPT_LABELS[name];
    const display = label && label !== name ? `${label} (${name})` : (label ?? name);
    let command;
    if (manager === "npm" && name === "start") command = "npm start";
    else if (manager === "npm" && name === "test") command = "npm test";
    else if (manager === "yarn") command = `yarn ${name}`;
    else if (manager === "bun") command = `bun run ${name}`;
    else command = `${manager} run ${name}`;
    return generated(`node-${name}`, display, command, manager);
  });

  const install = manager === "yarn" ? "yarn install" : `${manager} install`;
  commands.push(generated("node-install", "安装依赖", install, manager));
  return commands;
}

function rustCommands(facts) {
  if (!facts.files.has("Cargo.toml")) return [];
  return [
    generated("rust-run", "运行", "cargo run", "Rust"),
    generated("rust-build", "构建", "cargo build", "Rust"),
    generated("rust-test", "运行测试", "cargo test", "Rust"),
    generated("rust-clippy", "Clippy 检查", "cargo clippy --all-targets --all-features", "Rust"),
    generated("rust-fmt", "格式化", "cargo fmt", "Rust"),
  ];
}

function wrapper(facts, unixName, windowsName) {
  // Windows 的 PowerShell/cmd 不能直接执行无扩展名的 shell wrapper，缺少 .cmd/.bat 时回退到全局命令。
  if (facts.platform === "windows") {
    return facts.files.has(windowsName) ? `.\\${windowsName}` : null;
  }
  return facts.files.has(unixName) ? `./${unixName}` : null;
}

function javaCommands(facts) {
  const commands = [];
  const pom = facts.pom ?? "";
  const gradleText = `${facts.gradle ?? ""}\n${facts.gradleKts ?? ""}`;
  const springMaven = /spring-boot|springframework\.boot/i.test(pom);
  const springGradle = /spring-boot|org\.springframework\.boot/i.test(gradleText);

  if (facts.files.has("pom.xml")) {
    const prefix = wrapper(facts, "mvnw", "mvnw.cmd") ?? "mvn";
    const group = springMaven ? "Spring Boot" : "Maven";
    if (springMaven) commands.push(generated("spring-maven-run", "启动", `${prefix} spring-boot:run`, group));
    commands.push(generated("maven-package", "打包", `${prefix} clean package`, group));
    commands.push(generated("maven-test", "测试", `${prefix} test`, group));
  }

  if (facts.files.has("build.gradle") || facts.files.has("build.gradle.kts")) {
    const prefix = wrapper(facts, "gradlew", "gradlew.bat") ?? "gradle";
    const group = springGradle ? "Spring Boot" : "Gradle";
    if (springGradle) commands.push(generated("spring-gradle-run", "启动", `${prefix} bootRun`, group));
    commands.push(generated("gradle-build", "构建", `${prefix} build`, group));
    commands.push(generated("gradle-test", "测试", `${prefix} test`, group));
  }
  return commands;
}

function pythonCommands(facts) {
  const hasRequirements = facts.files.has("requirements.txt");
  const hasPython = facts.files.has("pyproject.toml") || hasRequirements
    || facts.files.has("setup.py") || facts.files.has("setup.cfg")
    || facts.files.has("uv.lock") || facts.files.has("poetry.lock") || facts.mainPy;
  if (!hasPython) return [];

  const pyproject = facts.pyproject ?? "";
  const uv = facts.files.has("uv.lock") || /\[tool\.uv\]/.test(pyproject);
  const poetry = facts.files.has("poetry.lock") || /\[tool\.poetry\]/.test(pyproject);
  const commands = [];

  if (uv) {
    commands.push(generated("python-uv-sync", "同步依赖（uv）", "uv sync", "Python"));
    commands.push(generated("python-uv-test", "运行测试", "uv run pytest", "Python"));
    if (facts.mainPy) commands.push(generated("python-uv-run", "运行 main.py", "uv run python main.py", "Python"));
    return commands;
  }
  if (poetry) {
    commands.push(generated("python-poetry-install", "安装依赖（Poetry）", "poetry install", "Python"));
    commands.push(generated("python-poetry-test", "运行测试", "poetry run pytest", "Python"));
    if (facts.mainPy) commands.push(generated("python-poetry-run", "运行 main.py", "poetry run python main.py", "Python"));
    return commands;
  }

  commands.push(generated("python-venv", "创建虚拟环境", "python -m venv .venv", "Python"));
  if (hasRequirements) commands.push(generated("python-pip-install", "安装依赖", "pip install -r requirements.txt", "Python"));
  if (facts.files.has("pyproject.toml") || hasRequirements) {
    commands.push(generated("python-pytest", "运行测试", "python -m pytest", "Python"));
  }
  if (facts.mainPy) commands.push(generated("python-run", "运行 main.py", "python main.py", "Python"));
  return commands;
}

function dockerCommands(facts) {
  if (!facts.compose) return [];
  return [
    generated("docker-up", "启动（前台）", "docker compose up", "Docker"),
    generated("docker-up-d", "启动（后台）", "docker compose up -d", "Docker"),
    generated("docker-down", "停止", "docker compose down", "Docker"),
    generated("docker-logs", "日志", "docker compose logs -f", "Docker"),
  ];
}

function gitCommands(facts) {
  if (!facts.git) return [];
  return [
    generated("git-status", "状态", "git status", "Git"),
    generated("git-log", "最近提交", "git log --oneline -20", "Git"),
    generated("git-diff", "查看改动", "git diff --stat", "Git"),
    generated("git-pull", "拉取", "git pull --ff-only", "Git"),
    generated("git-push", "推送", "git push", "Git"),
  ];
}

/**
 * facts:
 *   root, platform ("windows" | "unix"), git, files (Set), mainPy, compose,
 *   packageJson / pom / gradle / gradleKts / pyproject (文件原文，缺省 null)
 *
 * 有项目标记时只返回这个项目的命令；只有 git 时返回 Git + 清屏；
 * 纯文件夹才回退到完整的静态模板。
 */
export function buildProjectCommands(facts) {
  if (hasProjectMarkers(facts)) {
    return unique([
      ...nodeCommands(facts),
      ...rustCommands(facts),
      ...javaCommands(facts),
      ...pythonCommands(facts),
      ...dockerCommands(facts),
      ...gitCommands(facts),
      generated("clear", "清屏", "clear", "通用"),
    ]);
  }
  if (facts.git) {
    return unique([...gitCommands(facts), generated("clear", "清屏", "clear", "通用")]);
  }
  return unique(FALLBACK_COMMANDS
    .filter((item) => item.group !== "Git")
    .map((item) => ({ ...item, generated: true })));
}
