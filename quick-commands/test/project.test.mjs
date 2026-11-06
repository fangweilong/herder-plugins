import test from "node:test";
import assert from "node:assert/strict";
import { FALLBACK_COMMANDS } from "../commands.js";
import {
  buildProjectCommands,
  hasProjectMarkers,
  packageManagerFor,
  parseScripts,
  rootCandidates,
} from "../project.js";

function facts(overrides = {}) {
  return {
    root: "D:/work/app",
    platform: "unix",
    git: false,
    files: new Set(),
    mainPy: false,
    compose: null,
    packageJson: null,
    pom: null,
    gradle: null,
    gradleKts: null,
    pyproject: null,
    ...overrides,
  };
}

function commandsOf(list) {
  return list.map((item) => item.command);
}

test("package.json 按启动、开发、构建、测试的优先级排列，并跟随 pnpm 锁文件", () => {
  const list = buildProjectCommands(facts({
    files: new Set(["package.json", "pnpm-lock.yaml"]),
    packageJson: JSON.stringify({
      scripts: { lint: "eslint .", test: "vitest", build: "vite build", dev: "vite", start: "node ." },
    }),
  }));
  assert.deepEqual(commandsOf(list), [
    "pnpm run start",
    "pnpm run dev",
    "pnpm run build",
    "pnpm run test",
    "pnpm run lint",
    "pnpm install",
    "clear",
  ]);
  assert.ok(list.every((item) => item.generated));
  assert.ok(list.filter((item) => item.command !== "clear").every((item) => item.group === "pnpm"));
});

test("npm 的 start/test 使用原生快捷写法，其余脚本走 run", () => {
  const list = buildProjectCommands(facts({
    files: new Set(["package.json", "yarn.lock"]),
    packageJson: JSON.stringify({ scripts: { build: "vite build", test: "vitest", start: "node ." } }),
  }));
  assert.deepEqual(commandsOf(list), ["yarn start", "yarn build", "yarn test", "yarn install", "clear"]);

  const npm = buildProjectCommands(facts({
    files: new Set(["package.json"]),
    packageJson: JSON.stringify({ scripts: { build: "vite build", test: "vitest", start: "node ." } }),
  }));
  assert.deepEqual(commandsOf(npm), ["npm start", "npm run build", "npm test", "npm install", "clear"]);
});

test("Rust 项目只生成 cargo 命令", () => {
  const list = buildProjectCommands(facts({ files: new Set(["Cargo.toml"]) }));
  assert.deepEqual(commandsOf(list), [
    "cargo run",
    "cargo build",
    "cargo test",
    "cargo clippy --all-targets --all-features",
    "cargo fmt",
    "clear",
  ]);
  assert.ok(list.every((item) => item.group === "Rust" || item.group === "通用"));
});

test("Windows 下优先使用 Maven Wrapper 的 .cmd，并识别 Spring Boot", () => {
  const list = buildProjectCommands(facts({
    platform: "windows",
    files: new Set(["pom.xml", "mvnw.cmd"]),
    pom: "<project><artifactId>spring-boot-starter-parent</artifactId></project>",
  }));
  assert.deepEqual(commandsOf(list), [
    ".\\mvnw.cmd spring-boot:run",
    ".\\mvnw.cmd clean package",
    ".\\mvnw.cmd test",
    "clear",
  ]);
  assert.ok(list.slice(0, 3).every((item) => item.group === "Spring Boot"));
});

test("Windows 下缺少 .cmd wrapper 时回退到全局 mvn", () => {
  const list = buildProjectCommands(facts({
    platform: "windows",
    files: new Set(["pom.xml", "mvnw"]),
    pom: "<project/>",
  }));
  assert.deepEqual(commandsOf(list), ["mvn clean package", "mvn test", "clear"]);
  assert.ok(list.slice(0, 2).every((item) => item.group === "Maven"));
});

test("Unix 下使用 Gradle Wrapper 的 ./gradlew，并识别 Spring Boot 插件", () => {
  const list = buildProjectCommands(facts({
    files: new Set(["build.gradle", "gradlew"]),
    gradle: "plugins { id 'org.springframework.boot' version '3.3.0' }",
  }));
  assert.deepEqual(commandsOf(list), [
    "./gradlew bootRun",
    "./gradlew build",
    "./gradlew test",
    "clear",
  ]);
  assert.ok(list.slice(0, 3).every((item) => item.group === "Spring Boot"));
});

test("uv 项目生成 uv sync、pytest 和 main.py 运行命令", () => {
  const list = buildProjectCommands(facts({
    files: new Set(["pyproject.toml", "uv.lock", "main.py"]),
    mainPy: true,
    pyproject: "[project]\nname = \"demo\"",
  }));
  assert.deepEqual(commandsOf(list), [
    "uv sync",
    "uv run pytest",
    "uv run python main.py",
    "clear",
  ]);
});

test("Poetry 项目生成 poetry 安装与测试命令", () => {
  const list = buildProjectCommands(facts({
    files: new Set(["pyproject.toml", "poetry.lock"]),
    pyproject: "[tool.poetry]\nname = \"demo\"",
  }));
  assert.deepEqual(commandsOf(list), [
    "poetry install",
    "poetry run pytest",
    "clear",
  ]);
});

test("普通 Python 项目回退到 venv 与 pip", () => {
  const list = buildProjectCommands(facts({
    files: new Set(["requirements.txt", "main.py"]),
    mainPy: true,
  }));
  assert.deepEqual(commandsOf(list), [
    "python -m venv .venv",
    "pip install -r requirements.txt",
    "python -m pytest",
    "python main.py",
    "clear",
  ]);
});

test("只有 Git 的项目不生成 npm 等无关模板", () => {
  const list = buildProjectCommands(facts({ git: true }));
  assert.deepEqual(commandsOf(list), [
    "git status",
    "git log --oneline -20",
    "git diff --stat",
    "git pull --ff-only",
    "git push",
    "clear",
  ]);
});

test("纯文件夹回退到静态模板，并过滤 Git 命令", () => {
  const list = buildProjectCommands(facts());
  assert.ok(list.some((item) => item.command === "npm run build"));
  assert.ok(!list.some((item) => item.command.startsWith("git ")));
  assert.ok(list.every((item) => item.generated));
  assert.equal(list.length, FALLBACK_COMMANDS.filter((item) => item.group !== "Git").length);
});

test("hasProjectMarkers 识别 main.py 与 compose 文件", () => {
  assert.equal(hasProjectMarkers(facts({ mainPy: true })), true);
  assert.equal(hasProjectMarkers(facts({ compose: "compose.yaml" })), true);
  assert.equal(hasProjectMarkers(facts()), false);
});

test("parseScripts 忽略非法 JSON 和非字符串脚本", () => {
  assert.deepEqual(parseScripts("not json"), []);
  assert.deepEqual(parseScripts(JSON.stringify({ scripts: { build: "vite build", empty: "" } })), ["build"]);
  assert.deepEqual(parseScripts(String.fromCharCode(0xfeff) + JSON.stringify({ scripts: { dev: "vite" } })), ["dev"]);
  assert.deepEqual(parseScripts(JSON.stringify({ scripts: ["dev"] })), []);
});

test("packageManagerFor 按锁文件优先级选择包管理器", () => {
  assert.equal(packageManagerFor(new Set(["pnpm-lock.yaml", "yarn.lock"])), "pnpm");
  assert.equal(packageManagerFor(new Set(["yarn.lock", "bun.lockb"])), "yarn");
  assert.equal(packageManagerFor(new Set(["bun.lock"])), "bun");
  assert.equal(packageManagerFor(new Set()), "npm");
});

test("rootCandidates 先终端目录再 git 根，并去重", () => {
  assert.deepEqual(rootCandidates("D:/work/app/src", "D:/work/app"), ["D:/work/app/src", "D:/work/app"]);
  assert.deepEqual(rootCandidates("D:\\work\\app", "D:/work/app/"), ["D:\\work\\app"]);
  assert.deepEqual(rootCandidates("", "D:/work/app"), ["D:/work/app"]);
});
