// 按当前终端所在项目生成快捷命令：只排列这个项目实际用得上的启动、构建、测试命令。
// 纯函数，不读取文件系统；main.js 负责收集 facts，测试可以直接构造 facts。

import { FALLBACK_COMMANDS } from "./commands.js";

// 基础意图的排序：启动/开发优先，其次构建、测试、检查；脚本自己的声明顺序作为同位次顺序。
const SCRIPT_RANK = {
  start: 0,
  dev: 1,
  develop: 1,
  serve: 1,
  build: 2,
  test: 3,
  lint: 4,
  format: 4,
  fmt: 4,
  typecheck: 4,
  "type-check": 4,
  tsc: 4,
  preview: 5,
  watch: 6,
  clean: 7,
};

// 名称既用于完整脚本名，也用于「base:variant」「base-variant」里的 base。
const SCRIPT_LABELS = {
  start: "启动",
  dev: "开发",
  develop: "开发",
  serve: "本地服务",
  build: "构建",
  test: "测试",
  "test:unit": "单元测试",
  "test:e2e": "端到端测试",
  "test:coverage": "覆盖率测试",
  "test:watch": "监听测试",
  "test:docs": "文档测试",
  lint: "代码检查",
  "lint:eslint": "ESLint 检查",
  "lint:fix": "检查并修复",
  "lint:style": "样式检查",
  "lint:format": "格式化",
  "lint:lint-staged": "暂存区检查",
  format: "格式化",
  fmt: "格式化",
  typecheck: "类型检查",
  "type-check": "类型检查",
  "ts-check": "类型检查",
  "ts:check": "类型检查",
  tsc: "类型检查",
  preview: "预览",
  watch: "监听",
  clean: "清理",
  "clean:cache": "清理缓存",
  install: "安装依赖",
  i: "安装依赖",
  "dev-server": "开发服务",
  "dev:server": "开发服务",
  "serve:dev": "开发预览",
  "serve:prod": "生产预览",
  "serve:static": "静态预览",
  "build:zip": "打包 ZIP",
  check: "检查",
  generate: "生成",
  verify: "校验",
  package: "打包",
  upload: "上传",
  publish: "发布",
  release: "发布",
  prepare: "准备",
  migrate: "迁移",
  benchmark: "基准测试",
  bench: "基准测试",
};

const VARIANT_LABELS = {
  local: "本地",
  dev: "开发",
  development: "开发",
  test: "测试",
  testing: "测试",
  stage: "预发",
  staging: "预发",
  uat: "预发",
  pre: "预演",
  preview: "预演",
  prod: "生产",
  production: "生产",
  prd: "生产",
  pro: "生产",
  oa: "OA",
  server: "服务端",
  client: "客户端",
  web: "Web",
  desktop: "桌面",
  lib: "库",
  static: "静态资源",
  e2e: "端到端",
  unit: "单元",
  docs: "文档",
  doc: "文档",
  bench: "基准测试",
  benchmark: "基准测试",
  ci: "CI",
  all: "全部",
  watch: "监听",
  fix: "修复",
  zip: "ZIP",
  cache: "缓存",
  mac: "macOS",
  win: "Windows",
  linux: "Linux",
  arm64: "arm64",
  x64: "x64",
  dir: "目录",
  unsigned: "未签名",
};

const PROFILE_ORDER = [
  "local", "dev", "development", "test", "testing", "stage", "staging", "uat", "pre",
  "pro", "prod", "production", "prd",
];

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

function baseName(path) {
  const clean = norm(path);
  return clean.split("/").pop() || clean;
}

function samePath(a, b) {
  return norm(a).toLowerCase() === norm(b).toLowerCase();
}

function parentOf(path) {
  const clean = norm(path);
  const index = clean.lastIndexOf("/");
  if (index <= 0) return "";
  const parent = clean.slice(0, index);
  // Windows 盘符根目录：D: -> D:/
  return /^[a-zA-Z]:$/.test(parent) ? `${parent}/` : parent;
}

/** 先看终端目录，再看 git 根目录；这两处覆盖了单仓库和 monorepo 子包。 */
export function rootCandidates(cwd, gitRoot) {
  const roots = [];
  if (cwd) roots.push(cwd);
  if (gitRoot && !roots.some((root) => samePath(root, gitRoot))) roots.push(gitRoot);
  return roots;
}

/**
 * 从终端目录逐级向上，直到 git 根（没有 git 时到磁盘根）或 maxDepth。
 * 终端停在 `package/src`、模块子目录时也能找到最近的项目标记，行为接近 VS Code / IDEA。
 */
export function ancestorCandidates(cwd, gitRoot, maxDepth = 6) {
  const start = norm(cwd);
  const stop = norm(gitRoot);
  const roots = [];
  if (start) {
    let current = start;
    for (let depth = 0; depth < Math.max(1, maxDepth); depth++) {
      roots.push(current);
      if (stop && samePath(current, stop)) break;
      const parent = parentOf(current);
      if (!parent || samePath(parent, current)) break;
      current = parent;
    }
  }
  if (stop && !roots.some((root) => samePath(root, stop))) roots.push(stop);
  return roots;
}

/** 解析 package.json；容忍 BOM 和非法 JSON。 */
function parsePackageJson(text) {
  try {
    // 某些 Windows 编辑器会给 package.json 加 BOM，JSON.parse 不认。
    const source = String(text ?? "");
    const data = JSON.parse(source.charCodeAt(0) === 0xfeff ? source.slice(1) : source);
    return data && typeof data === "object" ? data : null;
  } catch {
    return null;
  }
}

export function packageManagerFor(files, declared = "") {
  if (files.has("pnpm-lock.yaml")) return "pnpm";
  if (files.has("yarn.lock")) return "yarn";
  if (files.has("bun.lockb") || files.has("bun.lock")) return "bun";
  const manager = /^(npm|pnpm|yarn|bun)@/.exec(String(declared ?? ""));
  return manager ? manager[1] : "npm";
}

/** 脚本名与脚本内容；内容用于说明这一行实际会执行什么。 */
export function parseScriptEntries(text) {
  const data = parsePackageJson(text);
  const scripts = data?.scripts;
  if (!scripts || typeof scripts !== "object" || Array.isArray(scripts)) return [];
  return Object.entries(scripts)
    .filter(([, value]) => typeof value === "string" && value.trim())
    .map(([name, command]) => ({ name, command: command.trim() }));
}

export function parseScripts(text) {
  return parseScriptEntries(text).map((entry) => entry.name);
}

function isInstallScript(name, body = "") {
  if (/^(npm|pnpm|yarn|bun)\s+(install|i|ci|add)\b/.test(String(body).trim())) return true;
  return /^(install|i)$/.test(String(name).trim());
}

function variantLabel(rest) {
  const parts = String(rest ?? "").split(/[:\-]/).filter(Boolean);
  return parts.map((part) => VARIANT_LABELS[part] ?? part).join(" ");
}

function splitScriptName(name) {
  const text = String(name ?? "");
  const colon = text.indexOf(":");
  if (colon > 0) return { base: text.slice(0, colon), rest: text.slice(colon + 1) };
  const dash = text.indexOf("-");
  if (dash > 0) {
    const base = text.slice(0, dash);
    const rest = text.slice(dash + 1);
    // 只有后缀能完整翻译时才按「base-variant」拆，避免把 build-with-env 之类误拆。
    const parts = rest.split("-").filter(Boolean);
    if (SCRIPT_LABELS[base] && parts.length && parts.every((part) => VARIANT_LABELS[part])) {
      return { base, rest };
    }
  }
  return null;
}

/** `dev:server` -> 开发服务，`build:prod` -> 构建（生产）；未识别的保留原名，交给搜索。 */
export function scriptLabel(name, body = "") {
  const text = String(name ?? "").trim();
  if (SCRIPT_LABELS[text]) return SCRIPT_LABELS[text];
  if (isInstallScript(text, body)) return "安装依赖";
  const split = splitScriptName(text);
  if (split) {
    const base = SCRIPT_LABELS[split.base];
    const variant = variantLabel(split.rest);
    if (base) return variant ? `${base}（${variant}）` : base;
  }
  return text;
}

function scriptRank(name, body = "") {
  if (isInstallScript(name, body)) return 8;
  const head = String(name ?? "").split(/[:\-]/)[0];
  return SCRIPT_RANK[name] ?? SCRIPT_RANK[head] ?? 9;
}

export function hasProjectMarkers(facts) {
  if (facts.mainPy || facts.compose) return true;
  return PROJECT_MARKERS.some((name) => facts.files.has(name));
}

function nodeCommands(facts) {
  if (!facts.files.has("package.json")) return [];
  const data = parsePackageJson(facts.packageJson ?? "");
  const manager = packageManagerFor(facts.files, data?.packageManager);
  const entries = parseScriptEntries(facts.packageJson ?? "");
  const ordered = entries
    .map((entry, index) => ({ ...entry, index }))
    .sort((a, b) => scriptRank(a.name, a.command) - scriptRank(b.name, b.command)
      || (a.name.includes(":") || a.name.includes("-") ? 1 : 0)
        - (b.name.includes(":") || b.name.includes("-") ? 1 : 0)
      || a.index - b.index);

  const commands = ordered.map(({ name, command }) => {
    let line;
    if (manager === "npm" && name === "start") line = "npm start";
    else if (manager === "npm" && name === "test") line = "npm test";
    else if (manager === "yarn") line = `yarn ${name}`;
    else if (manager === "bun") line = `bun run ${name}`;
    else line = `${manager} run ${name}`;
    // 说明直接给出脚本内容，和 IDEA 的 npm 脚本列表一样能看清这一行会跑什么。
    return generated(`node-${name}`, scriptLabel(name, command), line, manager, command.replace(/\s+/g, " "));
  });

  const lock = manager === "pnpm" ? "pnpm-lock.yaml"
    : manager === "yarn" ? "yarn.lock"
      : manager === "bun" ? "bun.lockb / bun.lock" : "package.json";
  const install = manager === "yarn" ? "yarn install" : `${manager} install`;
  commands.push(generated("node-install", "安装依赖", install, manager, `按 ${lock} 安装`));
  return commands;
}

function rustCommands(facts) {
  if (!facts.files.has("Cargo.toml")) return [];
  return [
    generated("rust-run", "运行", "cargo run", "Rust", "编译并运行当前 crate"),
    generated("rust-build", "构建", "cargo build", "Rust", "生成 debug 构建"),
    generated("rust-test", "运行测试", "cargo test", "Rust", "运行全部测试"),
    generated("rust-clippy", "Clippy 检查", "cargo clippy --all-targets --all-features", "Rust", "对所有目标做静态检查"),
    generated("rust-fmt", "格式化", "cargo fmt", "Rust", "按 rustfmt 格式化代码"),
  ];
}

function wrapper(facts, unixName, windowsName) {
  // Windows 的 PowerShell/cmd 不能直接执行无扩展名的 shell wrapper，缺少 .cmd/.bat 时回退到全局命令。
  if (facts.platform === "windows") {
    return facts.files.has(windowsName) ? `.\\${windowsName}` : null;
  }
  return facts.files.has(unixName) ? `./${unixName}` : null;
}

/** 相对 `src/main` 的模块目录；单模块项目返回空串。 */
export function moduleOf(path) {
  const clean = norm(path);
  const at = clean.indexOf("/src/main/");
  if (at >= 0) return clean.slice(0, at);
  if (clean.startsWith("src/main/")) return "";
  return "";
}

function javaPackage(text) {
  const match = /^\s*package\s+([A-Za-z_][\w.]*)\s*;?/m.exec(String(text ?? ""));
  return match ? match[1] : "";
}

/** 从 pom.xml 里取项目自己的 artifactId，忽略 parent 段。 */
export function mavenArtifactId(text) {
  const source = String(text ?? "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<parent>[\s\S]*?<\/parent>/i, "");
  const match = /<artifactId>([^<]+)<\/artifactId>/i.exec(source);
  return match ? match[1].trim() : "";
}

function cleanScalar(value) {
  let text = String(value ?? "").trim();
  text = text.replace(/\s+#.*$/, "").trim();
  const placeholder = /^\$\{[^:}]+:([^}]*)\}$/.exec(text);
  if (placeholder) text = placeholder[1];
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    text = text.slice(1, -1);
  }
  return text.trim();
}

/**
 * 读取 Spring 配置里的 `spring.profiles.active`、`spring.profiles.include` 和 `server.port`。
 * 支持 properties 和常见的分层 YAML；不解析锚点、多文档等高级语法。
 */
export function parseSpringConfig(text) {
  const source = String(text ?? "").replace(/^\uFEFF/, "");
  const lines = source.split(/\r?\n/);
  const profiles = [];
  let port = null;
  const addProfiles = (value) => {
    for (const item of cleanScalar(value).split(/[,;\s]+/)) {
      const name = item.trim();
      if (name && !profiles.includes(name)) profiles.push(name);
    }
  };
  const apply = (key, value) => {
    const scalar = cleanScalar(value);
    if (key === "spring.profiles.active" || key === "spring.profiles.include") addProfiles(scalar);
    else if (key === "server.port" && /^\d{2,5}$/.test(scalar)) port = Number(scalar);
  };

  const isProperties = lines.some((line) => /^[A-Za-z0-9_.\-[\]]+\s*=/.test(line));
  if (isProperties) {
    for (const line of lines) {
      const clean = line.trim();
      if (!clean || clean.startsWith("#") || clean.startsWith("!")) continue;
      const match = /^([^=:#\s]+)\s*[=:]\s*(.*)$/.exec(clean);
      if (match) apply(match[1].trim(), match[2]);
    }
    return { profiles, port };
  }

  const stack = [];
  let listPath = "";
  for (const line of lines) {
    const clean = line.trim();
    if (!clean || clean.startsWith("#") || clean.startsWith("---")) continue;
    const indent = line.length - line.trimStart().length;
    const list = /^-\s*(.*)$/.exec(clean);
    if (list) {
      if (listPath && indent > stack[stack.length - 1]?.indent) apply(listPath, list[1]);
      continue;
    }
    const match = /^([^:#][^:]*):(.*)$/.exec(clean);
    if (!match) continue;
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    const key = match[1].trim();
    const path = [...stack.map((item) => item.key), key].join(".");
    const value = match[2] ?? "";
    if (cleanScalar(value)) {
      listPath = "";
      apply(path, value);
    } else {
      listPath = path === "spring.profiles.active" || path === "spring.profiles.include" ? path : "";
    }
    stack.push({ indent, key });
  }
  return { profiles, port };
}

function profileRank(profile) {
  const index = PROFILE_ORDER.indexOf(String(profile).toLowerCase());
  return index < 0 ? 100 : index;
}

function resourceModule(path) {
  const clean = norm(path);
  const marker = "/src/main/resources/";
  const at = clean.indexOf(marker);
  if (at >= 0) return clean.slice(0, at);
  return clean.startsWith("src/main/resources/") ? "" : null;
}

function springConfigFor(module, resources) {
  const configs = resources
    .filter((item) => resourceModule(item.path) === module)
    .map((item) => ({ name: baseName(item.path), text: item.text }));

  const profiles = [];
  const profilePorts = {};
  let activeProfile = null;
  let port = null;
  for (const config of configs) {
    const match = /^application(?:-(.+))?\.(ya?ml|properties)$/i.exec(config.name);
    if (!match) continue;
    const info = parseSpringConfig(config.text);
    const profile = match[1] ?? "";
    if (!profile) {
      port = info.port;
      activeProfile = info.profiles[0] ?? null;
    } else {
      if (!profiles.includes(profile)) profiles.push(profile);
      if (info.port !== null) profilePorts[profile] = info.port;
    }
    for (const item of info.profiles) {
      if (!profiles.includes(item)) profiles.push(item);
    }
  }
  profiles.sort((a, b) => (a === activeProfile ? -1 : 0) - (b === activeProfile ? -1 : 0)
    || profileRank(a) - profileRank(b) || a.localeCompare(b));
  return { profiles, activeProfile, port, profilePorts };
}

/**
 * 把扫描到的启动逻辑资源整理成 Spring Boot 应用列表。
 *
 * input:
 *   buildTool      "maven" | "gradle"
 *   projectName    项目名，用于没找到启动类时的显示名
 *   springDetected 构建文件里出现 spring-boot 依赖/插件
 *   mainFiles      [{ path, text }]，含 @SpringBootApplication 的源文件
 *   resources      [{ path, text }]，application*.yml / properties
 */
export function buildSpringApps({
  buildTool = "maven", projectName = "", springDetected = false, mainFiles = [], resources = [],
} = {}) {
  const apps = [];
  const seen = new Set();
  for (const file of mainFiles) {
    const text = String(file?.text ?? "");
    if (!text.includes("@SpringBootApplication")) continue;
    const path = norm(file?.path);
    const module = moduleOf(path);
    const className = baseName(path).replace(/\.(java|kt)$/i, "");
    if (!className) continue;
    const pkg = javaPackage(text);
    const mainClass = pkg ? `${pkg}.${className}` : className;
    const key = `${module}|${mainClass}`;
    if (seen.has(key)) continue;
    seen.add(key);
    apps.push({ name: className, mainClass, module, buildTool, ...springConfigFor(module, resources) });
  }
  if (!apps.length && springDetected) {
    apps.push({
      name: projectName || "应用",
      mainClass: null,
      module: "",
      buildTool,
      ...springConfigFor("", resources),
    });
  }
  apps.sort((a, b) => a.module.localeCompare(b.module) || a.name.localeCompare(b.name));
  return apps;
}

function mavenPrefix(facts) {
  return wrapper(facts, "mvnw", "mvnw.cmd") ?? "mvn";
}

function gradlePrefix(facts) {
  return wrapper(facts, "gradlew", "gradlew.bat") ?? "gradle";
}

function gradleTask(module, task) {
  const parts = norm(module).split("/").filter(Boolean);
  return parts.length ? `:${parts.join(":")}:${task}` : task;
}

function runHint(app, profile) {
  const parts = [];
  if (app.module) parts.push(`模块 ${app.module}`);
  if (profile) parts.push(`profile ${profile}`);
  const port = (profile && app.profilePorts?.[profile]) ?? app.port;
  if (port) parts.push(`端口 ${port}`);
  return parts.length ? parts.join(" · ") : "默认配置";
}

function defaultRunHint(app) {
  const parts = [];
  if (app.module) parts.push(`模块 ${app.module}`);
  if (app.activeProfile) {
    parts.push(`profile ${app.activeProfile}`);
    const port = app.profilePorts?.[app.activeProfile] ?? app.port;
    if (port) parts.push(`端口 ${port}`);
  } else if (app.port) {
    parts.push("默认配置");
    parts.push(`端口 ${app.port}`);
  } else {
    parts.push("默认配置");
  }
  return parts.join(" · ");
}

function springCommands(facts, apps) {
  const tool = facts.files.has("pom.xml") ? "maven" : "gradle";
  if (!facts.files.has("pom.xml") && !facts.files.has("build.gradle") && !facts.files.has("build.gradle.kts")) return [];

  const commands = [];
  for (const app of apps) {
    const prefix = tool === "maven" ? mavenPrefix(facts) : gradlePrefix(facts);
    const module = norm(app.module);
    const run = (profile) => (tool === "maven"
      ? `${prefix}${module ? ` -pl ${module}` : ""} spring-boot:run`
        + (profile ? ` -Dspring-boot.run.profiles=${profile}` : "")
      : `${prefix} ${gradleTask(module, "bootRun")}`
        + (profile ? ` --args="--spring.profiles.active=${profile}"` : ""));

    const defaultLabel = app.profiles.length || app.activeProfile
      ? `启动 ${app.name}（${app.activeProfile ?? "默认"}）`
      : `启动 ${app.name}`;
    commands.push(generated(`spring-run-${app.module || "root"}-${app.name}`, defaultLabel, run(null), "Spring Boot", defaultRunHint(app)));

    for (const profile of app.profiles) {
      if (profile === app.activeProfile) continue;
      commands.push(generated(
        `spring-run-${app.module || "root"}-${app.name}-${profile}`,
        `启动 ${app.name}（${profile}）`,
        run(profile),
        "Spring Boot",
        runHint(app, profile),
      ));
    }

    const debug = tool === "maven"
      ? `${run(null)} -Dspring-boot.run.jvmArguments=-agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=5005`
      : `${prefix} ${gradleTask(module, "bootRun")} --debug-jvm`;
    commands.push(generated(
      `spring-debug-${app.module || "root"}-${app.name}`,
      `调试 ${app.name}`,
      debug,
      "Spring Boot",
      "JDWP 5005 · 默认配置",
    ));
  }

  if (tool === "maven") {
    const prefix = mavenPrefix(facts);
    commands.push(generated("maven-package", "打包", `${prefix} clean package`, "Spring Boot", "clean package，生成可执行 jar"));
    commands.push(generated("maven-test", "测试", `${prefix} test`, "Spring Boot", "运行项目测试"));
  } else {
    const prefix = gradlePrefix(facts);
    commands.push(generated("gradle-build", "构建", `${prefix} build`, "Spring Boot", "build，生成可执行 jar"));
    commands.push(generated("gradle-test", "测试", `${prefix} test`, "Spring Boot", "运行项目测试"));
  }
  return commands;
}

function javaCommands(facts) {
  const apps = facts.springApps ?? [];
  if (apps.length) return springCommands(facts, apps);

  const commands = [];
  if (facts.files.has("pom.xml")) {
    const prefix = mavenPrefix(facts);
    const spring = /spring-boot|springframework\.boot/i.test(facts.pom ?? "");
    const group = spring ? "Spring Boot" : "Maven";
    if (spring) commands.push(generated("spring-maven-run", "启动", `${prefix} spring-boot:run`, group, "默认配置"));
    commands.push(generated("maven-package", "打包", `${prefix} clean package`, group, "clean package，生成可执行 jar"));
    commands.push(generated("maven-test", "测试", `${prefix} test`, group, "运行项目测试"));
  }

  if (facts.files.has("build.gradle") || facts.files.has("build.gradle.kts")) {
    const prefix = gradlePrefix(facts);
    const spring = /spring-boot|org\.springframework\.boot/i.test(`${facts.gradle ?? ""}\n${facts.gradleKts ?? ""}`);
    const group = spring ? "Spring Boot" : "Gradle";
    if (spring) commands.push(generated("spring-gradle-run", "启动", `${prefix} bootRun`, group, "默认配置"));
    commands.push(generated("gradle-build", "构建", `${prefix} build`, group, "build，生成可执行 jar"));
    commands.push(generated("gradle-test", "测试", `${prefix} test`, group, "运行项目测试"));
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
    commands.push(generated("python-uv-sync", "同步依赖（uv）", "uv sync", "Python", "按 pyproject.toml 同步虚拟环境"));
    commands.push(generated("python-uv-test", "运行测试", "uv run pytest", "Python", "在 uv 环境里运行 pytest"));
    if (facts.mainPy) commands.push(generated("python-uv-run", "运行 main.py", "uv run python main.py", "Python", "在 uv 环境里运行 main.py"));
    return commands;
  }
  if (poetry) {
    commands.push(generated("python-poetry-install", "安装依赖（Poetry）", "poetry install", "Python", "按 pyproject.toml 安装依赖"));
    commands.push(generated("python-poetry-test", "运行测试", "poetry run pytest", "Python", "在 Poetry 环境里运行 pytest"));
    if (facts.mainPy) commands.push(generated("python-poetry-run", "运行 main.py", "poetry run python main.py", "Python", "在 Poetry 环境里运行 main.py"));
    return commands;
  }

  commands.push(generated("python-venv", "创建虚拟环境", "python -m venv .venv", "Python", "在 .venv 创建虚拟环境"));
  if (hasRequirements) commands.push(generated("python-pip-install", "安装依赖", "pip install -r requirements.txt", "Python", "按 requirements.txt 安装"));
  if (facts.files.has("pyproject.toml") || hasRequirements) {
    commands.push(generated("python-pytest", "运行测试", "python -m pytest", "Python", "运行项目里的 pytest"));
  }
  if (facts.mainPy) commands.push(generated("python-run", "运行 main.py", "python main.py", "Python", "直接运行 main.py"));
  return commands;
}

function dockerCommands(facts) {
  if (!facts.compose) return [];
  return [
    generated("docker-up", "启动（前台）", "docker compose up", "Docker", "前台运行全部服务"),
    generated("docker-up-d", "启动（后台）", "docker compose up -d", "Docker", "后台运行全部服务"),
    generated("docker-down", "停止", "docker compose down", "Docker", "停止并移除容器"),
    generated("docker-logs", "日志", "docker compose logs -f", "Docker", "跟随全部服务日志"),
  ];
}

function gitCommands(facts) {
  if (!facts.git) return [];
  return [
    generated("git-status", "状态", "git status", "Git", "查看工作区状态"),
    generated("git-log", "最近提交", "git log --oneline -20", "Git", "最近 20 条提交"),
    generated("git-diff", "查看改动", "git diff --stat", "Git", "工作区改动统计"),
    generated("git-pull", "拉取", "git pull --ff-only", "Git", "仅快进拉取当前分支"),
    generated("git-push", "推送", "git push", "Git", "推送当前分支"),
  ];
}

/** 面板顶部的一行项目说明，例如 `Spring Boot（Maven）· Node.js（pnpm）`。 */
export function projectSummary(facts) {
  const files = facts.files;
  const parts = [];
  const apps = facts.springApps ?? [];
  const pom = files.has("pom.xml");
  const gradle = files.has("build.gradle") || files.has("build.gradle.kts");
  const spring = apps.length > 0
    || (pom && /spring-boot|springframework\.boot/i.test(facts.pom ?? ""))
    || (gradle && /spring-boot|org\.springframework\.boot/i.test(`${facts.gradle ?? ""}\n${facts.gradleKts ?? ""}`));
  if (spring) {
    const tool = pom ? "Maven" : "Gradle";
    parts.push(`Spring Boot（${tool}${apps.length > 1 ? ` · ${apps.length} 个应用` : ""}）`);
  } else if (pom) {
    parts.push("Maven");
  } else if (gradle) {
    parts.push("Gradle");
  }
  if (files.has("package.json")) {
    const data = parsePackageJson(facts.packageJson ?? "");
    parts.push(`Node.js（${packageManagerFor(files, data?.packageManager)}）`);
  }
  if (files.has("Cargo.toml")) parts.push("Rust");
  if (files.has("uv.lock") || /\[tool\.uv\]/.test(facts.pyproject ?? "")) parts.push("Python（uv）");
  else if (files.has("poetry.lock") || /\[tool\.poetry\]/.test(facts.pyproject ?? "")) parts.push("Python（Poetry）");
  else if (files.has("pyproject.toml") || files.has("requirements.txt") || files.has("setup.py")) parts.push("Python");
  if (facts.compose) parts.push("Docker Compose");
  return parts.join(" · ");
}

/**
 * facts:
 *   root, platform ("windows" | "unix"), git, files (Set), mainPy, compose,
 *   packageJson / pom / gradle / gradleKts / pyproject (文件原文，缺省 null),
 *   springApps（main.js 扫描出的 Spring Boot 应用，缺省空）
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
      generated("clear", "清屏", "clear", "通用", "清空终端屏幕"),
    ]);
  }
  if (facts.git) {
    return unique([...gitCommands(facts), generated("clear", "清屏", "clear", "通用", "清空终端屏幕")]);
  }
  return unique(FALLBACK_COMMANDS
    .filter((item) => item.group !== "Git")
    .map((item) => ({ ...item, generated: true })));
}
