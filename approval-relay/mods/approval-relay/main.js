// 审批中继：Herdr App 侧的 Windows 审批弹窗。
//
// 本 mod 只在 App 窗口开着时检测：轮询 agents() 的 blocked，读可见屏幕确认还有“活的”
// 选择框，再把请求写进 data/approval-relay/queue；置顶弹窗和托盘由
// helper/approval-popup.ps1 负责，用户点选后 helper 直接调用 hc keys / hc send --force。
// 弹窗关闭或 App 退出不会自动批准任何东西；没有解析出对话框就不弹。

import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import * as fsp from "fs/promises";
import { agents, appHome, exec, hc, nextCommand, notify, run, setShared, shared, theme, window } from "herdr";
import { parseApproval, screenHash } from "./parse.js";

function approvalSignature(parsed) {
  return JSON.stringify({
    kind: parsed.kind ?? (parsed.generic ? "text" : "options"),
    question: parsed.question ?? "",
    options: (parsed.options ?? []).map((option) => ({
      label: option.label,
      keys: option.keys,
      selected: Boolean(option.selected),
      other: Boolean(option.other),
    })),
  });
}
import { resolveLanguage, makeT, findShortcut } from "./i18n.js";

const VERSION = "0.2.0";
const DEFAULT_CONFIG = {
  enabled: true,
  skipFocused: true,
  language: "auto",
  translation: { enabled: true, order: ["google", "microsoft"] },
  readCooldownMs: 7000,
  maxAttempts: 3,
  // 弹窗助手空闲这么久后退出；下次有请求时按需拉起，避免长期常驻。
  helperIdleSeconds: 120,
};

function q(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function safeName(address) {
  return String(address).replace(/[^A-Za-z0-9_.-]+/g, "_");
}



export default class ApprovalRelay extends View {
  init(_props, cx) {
    this.home = appHome();
    this.data = `${this.home}/data/approval-relay`;
    this.queueDir = `${this.data}/queue`;
    this.answersDir = `${this.data}/answers`;
    this.config = { ...DEFAULT_CONFIG };
    this.dict = {};
    this.lang = "zh";
    this.t = (key) => key;
    this.openKey = "Ctrl+Shift+A";
    this.pending = new Map(); // address -> request
    this.reading = new Set();
    this.lastRead = new Map();
    this.attempts = new Map();
    this.ignored = new Map(); // address -> screen hash
    this.audit = [];
    this.helper = { at: 0, pid: null };
    this.lastLaunch = 0;
    this.configAt = 0;
    this.busy = false;
    this.stats = { detected: 0, answered: 0, dismissed: 0, external: 0 };
    this.handle = cx.focus_handle();

    cx.spawn(async (cx) => {
      try {
        await this.setup();
        await this.collectAnswers();
        // 只在已有排队请求时拉起助手；没有请求就保持不常驻。
        if (await this.hasQueuedRequest()) await this.ensureHelper();
        await this.loadAudit();
        this.installSettings(cx);
        this.tick(cx);
      } catch (error) {
        notify({ title: "审批中继启动失败", body: String(error?.message ?? error), level: "error", timeout: 12000 });
      }
    });

    cx.timer.every(1500, (cx) => this.tick(cx));
    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        if (command === "open") await this.wake();
        if (command === "rescan") this.tick(cx);
        if (command === "lang") await this.setLanguage(cx);
        cx.notify();
      }
    });
  }

  async setup() {
    await fsp.mkdir(this.queueDir, { recursive: true });
    await fsp.mkdir(this.answersDir, { recursive: true });
    let parsed = null;
    try {
      parsed = JSON.parse(await fsp.readFile(`${this.data}/config.json`, "utf8"));
    } catch {}
    const merged = { ...DEFAULT_CONFIG, ...(parsed ?? {}) };
    delete merged.pollMs;
    this.config = merged;
    if (!parsed || JSON.stringify(merged) !== JSON.stringify(parsed)) {
      await fsp.writeFile(`${this.data}/config.json`, JSON.stringify(merged, null, 2) + "\n", "utf8").catch(() => {});
    }
    try {
      this.dict = JSON.parse(await fsp.readFile(`${this.home}/mods/approval-relay/i18n.json`, "utf8"));
    } catch {}
    let keys = null;
    try {
      keys = JSON.parse(await fsp.readFile(`${this.home}/keys.json`, "utf8"));
    } catch {}
    let layoutName = "";
    try {
      layoutName = String(shared("layout") ?? "");
    } catch {}
    this.lang = resolveLanguage(this.config, undefined, layoutName);
    this.t = makeT(this.dict, this.lang);
    this.openKey =
      findShortcut(keys, "layout.toggle:approval-relay-panel") ||
      findShortcut(keys, "approval-relay.open") ||
      "Ctrl+Shift+A";
    await fsp.writeFile(`${this.data}/lang`, this.lang, "utf8").catch(() => {});
  }

  async setLanguage(cx) {
    const next = this.lang === "zh" ? "en" : "zh";
    this.config = { ...this.config, language: next };
    this.lang = next;
    this.t = makeT(this.dict, next);
    await fsp.writeFile(`${this.data}/config.json`, JSON.stringify(this.config, null, 2) + "\n", "utf8").catch(() => {});
    await fsp.writeFile(`${this.data}/lang`, next, "utf8").catch(() => {});
    cx.notify();
  }

  age(ms) {
    const seconds = Math.max(0, Math.round(ms / 1000));
    if (seconds < 60) return this.t("time.seconds", { n: seconds });
    return this.t("time.minutes", { m: Math.floor(seconds / 60), s: seconds % 60 });
  }

  async installSettings(cx) {
    const file = `${this.home}/frame/settings/main.js`;
    const methodsPath = `${this.home}/mods/approval-relay/settings-methods.js`;
    let raw = null;
    const until = Date.now() + 5000;
    for (;;) {
      raw = await fsp.readFile(file, "utf8").catch(() => null);
      if (raw) {
        const text = raw.replace(/\r\n/g, "\n");
        if (text.includes('child("设置")') || Date.now() > until) break;
      }
      if (Date.now() > until) {
        raw = await fsp.readFile(file, "utf8").catch(() => null);
        break;
      }
      await new Promise((resolve) => cx.timer.after(200, resolve));
    }
    if (!raw) return;
    const methods = await fsp.readFile(methodsPath, "utf8").catch(() => "");
    if (!methods) return;
    const locked = await this.acquireSettingsLock(cx);
    try {
      raw = await fsp.readFile(file, "utf8").catch(() => null);
      if (!raw) return;
      const text = raw.replace(/\r\n/g, "\n");
      if (text.includes("APPROVAL_SETTINGS_METHODS")) return;
      let next = text;
      // 审批放在设置导航的最后；先移除旧位置，再插到 SECTIONS 的 ] 前。
      next = next.replace(/^\s*\.\.\.\(\(shared\("layout"\).*?approvals.*?\n/gm, "");
      const sectionStart = next.indexOf("const SECTIONS = [");
      if (sectionStart >= 0) {
        const sectionEnd = next.indexOf("];", sectionStart);
        if (sectionEnd > sectionStart && !next.slice(sectionStart, sectionEnd).includes('id: "approvals"')) {
          const item =
            '  ...((shared("layout") ?? "").startsWith("zh") ? [{ id: "approvals", title: "审批", icon: "shield" }] : [{ id: "approvals", title: "Approvals", icon: "shield" }]),\n';
          next = next.slice(0, sectionEnd) + item + next.slice(sectionEnd);
        }
      }
      if (!next.includes('this.section === "approvals"')) {
        const keyboard = '                      : this.section === "keyboard"';
        const machines = '                      : this.section === "machines"';
        if (next.includes(keyboard)) {
          next = next.replace(keyboard, '                      : this.section === "approvals"\n                        ? this.approvalPage(t, cx)\n' + keyboard);
        } else if (next.includes(machines)) {
          next = next.replace(machines, '                      : this.section === "approvals"\n                        ? this.approvalPage(t, cx)\n' + machines);
        }
      }
      if (!next.includes("APPROVAL_SETTINGS_METHODS") && next.includes("  render(cx) {")) {
        next = next.replace("  render(cx) {", methods.trimEnd() + "\n\n  render(cx) {");
      }
      if (next === text) return;
      await fsp.writeFile(file, next, "utf8");
      await this.appendAudit({ event: "settings-injected" });
    } catch (error) {
      console.log("approval-relay settings injection:", String(error?.stack ?? error));
    } finally {
      if (locked) await this.releaseSettingsLock();
    }
  }

  async acquireSettingsLock(cx) {
    const dir = `${this.home}/.shortcuts-lock`;
    for (let i = 0; i < 150; i++) {
      try {
        await fsp.mkdir(dir);
        await fsp.writeFile(`${dir}/at`, String(Date.now()), "utf8");
        return true;
      } catch {
        const at = Number(await fsp.readFile(`${dir}/at`, "utf8").catch(() => "0"));
        if (Date.now() - at > 15000) {
          await fsp.unlink(`${dir}/at`).catch(() => {});
          await fsp.rmdir(dir).catch(() => {});
          continue;
        }
        await new Promise((resolve) => cx.timer.after(100, resolve));
      }
    }
    return false;
  }

  async releaseSettingsLock() {
    await fsp.unlink(`${this.home}/.shortcuts-lock/at`).catch(() => {});
    await fsp.rmdir(`${this.home}/.shortcuts-lock`).catch(() => {});
  }

  async refreshRuntimeConfig() {
    if (this.configAt && Date.now() - this.configAt < 3000) return;
    try {
      const raw = await fsp.readFile(`${this.data}/config.json`, "utf8");
      const merged = { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
      delete merged.pollMs;
      this.config = merged;
      this.configAt = Date.now();
    } catch {}
    try {
      const keys = JSON.parse(await fsp.readFile(`${this.home}/keys.json`, "utf8"));
      this.openKey =
        findShortcut(keys, "layout.toggle:approval-relay-panel") ||
        findShortcut(keys, "approval-relay.open") ||
        "Ctrl+Shift+A";
    } catch {}
  }

  async loadAudit() {
    try {
      const raw = await fsp.readFile(`${this.data}/audit.jsonl`, "utf8");
      this.audit = raw
        .split("\n")
        .filter(Boolean)
        .slice(-30)
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter(Boolean);
    } catch {}
  }

  async appendAudit(entry) {
    const line = JSON.stringify({ at: Date.now(), ...entry }) + "\n";
    try {
      let old = "";
      try {
        old = await fsp.readFile(`${this.data}/audit.jsonl`, "utf8");
      } catch {}
      await fsp.writeFile(`${this.data}/audit.jsonl`, old + line, "utf8");
      this.audit.push(JSON.parse(line));
      if (this.audit.length > 60) this.audit = this.audit.slice(-60);
    } catch {}
  }

  async helperAlive() {
    try {
      const beat = JSON.parse(await fsp.readFile(`${this.data}/helper.json`, "utf8"));
      this.helper = beat;
      return Number(beat.at) > 0 && Date.now() - Number(beat.at) < 8000;
    } catch {
      // heartbeat 是原子替换的：极短时间读不到不代表助手退出，沿用上一次心跳。
      return Number(this.helper?.at) > 0 && Date.now() - Number(this.helper.at) < 8000;
    }
  }

  async hasQueuedRequest() {
    try {
      return (await fsp.readdir(this.queueDir)).some((name) => name.endsWith(".json"));
    } catch {
      return false;
    }
  }

  async ensureHelper() {
    if (window()?.platform !== "windows") return;
    if (await this.helperAlive()) return;
    if (Date.now() - this.lastLaunch < 15000) return;
    this.lastLaunch = Date.now();
    const script = `${this.home}/mods/approval-relay/helper/approval-popup.ps1`;
    const argList = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-AppHome", this.home].map(q).join(",");
    const command = `Start-Process -WindowStyle Hidden -FilePath 'powershell.exe' -ArgumentList @(${argList})`;
    const result = await exec("powershell.exe", ["-NoProfile", "-WindowStyle", "Hidden", "-Command", command]).catch((error) => ({ code: -1, stderr: String(error) }));
    if (result?.code !== 0) {
      notify({ title: "审批中继：弹窗助手启动失败", body: result?.stderr || result?.stdout || "powershell 启动失败", level: "error", timeout: 12000 });
    }
  }

  async wake() {
    try {
      await fsp.writeFile(`${this.data}/wake.flag`, String(Date.now()), "utf8");
      await this.ensureHelper();
    } catch {}
  }

  tick(cx) {
    if (this.busy) return;
    this.busy = true;
    cx.spawn(async (cx) => {
      try {
        await this.refreshRuntimeConfig();
        if (!this.config.enabled) {
          try { setShared("approval-relay.pending", this.pending.size); } catch {}
          return;
        }
        const alive = await this.helperAlive();
        if (!alive && this.pending.size > 0) await this.ensureHelper();
        await this.collectAnswers();
        const now = agents();
        const blocked = now.filter((agent) => agent.status === "blocked");
        for (const agent of now) {
          if (agent.status !== "blocked") {
            this.ignored.delete(agent.address);
            this.attempts.delete(agent.address);
          }
        }
        await this.reconcile(now);
        for (const agent of blocked) await this.inspect(agent, cx);
      } catch (error) {
        console.log("approval-relay tick:", String(error?.stack ?? error));
      } finally {
        this.busy = false;
        try { setShared("approval-relay.pending", this.pending.size); } catch {}
        cx.notify();
      }
    });
  }

  async reconcile(now) {
    const live = new Set(now.map((agent) => agent.address));
    for (const [address, request] of [...this.pending]) {
      if (live.has(address) && now.find((a) => a.address === address)?.status === "blocked") continue;
      await this.cancelRequest(address, "external");
    }
  }

  async inspect(agent, _cx) {
    const address = agent.address;
    const ignoredHash = this.ignored.get(address);
    if (ignoredHash && ignoredHash === this.lastHash?.[address]) return;
    const pending = this.pending.get(address);
    const attempts = this.attempts.get(address) ?? 0;
    if (attempts >= this.config.maxAttempts) return;
    if (this.config.skipFocused && agent.focused && window()?.active) return;
    const due = (this.lastRead.get(address) ?? 0) + this.config.readCooldownMs;
    const checked = pending?.checkedAt ?? pending?.updatedAt ?? 0;
    if (pending && Date.now() - checked < this.config.readCooldownMs) return;
    if (Date.now() < due || this.reading.has(address)) return;

    this.reading.add(address);
    this.lastRead.set(address, Date.now());
    try {
      const result = await hc(["read", address, "--lines", "0", "--json"]);
      if (result.code !== 0) return;
      let payload = null;
      try {
        payload = JSON.parse(result.stdout);
      } catch {
        return;
      }
      const screen = payload?.text ?? "";
      if (!screen.trim()) return;
      const hash = screenHash(screen);
      this.lastHash = this.lastHash ?? {};
      this.lastHash[address] = hash;
      if (this.ignored.get(address) === hash) return;
      if (pending && pending.hash === hash) {
        pending.checkedAt = Date.now();
        return;
      }
      const parsed = parseApproval(screen, { app: agent.app });
      if (!parsed) return;
      const signature = approvalSignature(parsed);
      if (pending && pending.signature === signature) {
        pending.checkedAt = Date.now();
        return;
      }
      if (pending) await this.cancelRequest(address, "updated", false);
      await this.enqueue(agent, parsed, screen, hash, signature);
    } finally {
      this.reading.delete(address);
    }
  }

  async removeQueued(address) {
    let names = [];
    try { names = await fsp.readdir(this.queueDir); } catch { return; }
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      const path = `${this.queueDir}/${name}`;
      try {
        const request = JSON.parse(await fsp.readFile(path, "utf8"));
        if (request.address === address) await fsp.unlink(path);
      } catch {}
    }
  }

  async enqueue(agent, parsed, screen, hash, signature = "") {
    const id = `${safeName(agent.address)}-${Date.now().toString(36)}`;
    await this.removeQueued(agent.address);
    const request = {
      version: 1,
      id,
      address: agent.address,
      app: agent.app ?? null,
      space: agent.space_name ?? null,
      tab: agent.tab_name ?? null,
      tabIndex: agent.tab_index ?? null,
      title: agent.title ?? "",
      question: parsed.question ?? "",
      questionCount: parsed.questionCount ?? 1,
      multiQuestion: Boolean(parsed.multiQuestion),
      kind: parsed.kind ?? (parsed.generic ? "text" : "options"),
      generic: Boolean(parsed.generic),
      options: parsed.options ?? [],
      screen: String(screen).slice(-8000),
      lang: this.lang,
      openKey: this.openKey,
      hash,
      signature,
      attempts: this.attempts.get(agent.address) ?? 0,
      created: Date.now(),
      updated: Date.now(),
    };
    await fsp.writeFile(`${this.queueDir}/${id}.json`, JSON.stringify(request, null, 2), "utf8");
    this.pending.set(agent.address, { ...request, updatedAt: Date.now() });
    this.stats.detected++;
    await this.appendAudit({ event: "detected", id, address: agent.address, app: request.app, title: request.title, hash });
    if (this.pending.size === 1) await this.wake();
  }

  async cancelRequest(address, event = "cancelled", audit = true) {
    const request = this.pending.get(address);
    if (!request) return;
    await fsp.unlink(`${this.queueDir}/${request.id}.json`).catch(() => {});
    this.pending.delete(address);
    if (audit) {
      if (event === "external") this.stats.external++;
      await this.appendAudit({ event, id: request.id, address, app: request.app, title: request.title });
    }
  }

  async collectAnswers() {
    let names = [];
    try {
      names = await fsp.readdir(this.answersDir);
    } catch {
      return;
    }
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      const path = `${this.answersDir}/${name}`;
      let answer = null;
      try {
        answer = JSON.parse(await fsp.readFile(path, "utf8"));
      } catch {}
      await fsp.unlink(path).catch(() => {});
      if (!answer) continue;
      const address = answer.address;
      const request = this.pending.get(address);
      if (request) await fsp.unlink(`${this.queueDir}/${request.id}.json`).catch(() => {});
      this.pending.delete(address);
      if (answer.action === "dismiss") {
        this.ignored.set(address, answer.hash ?? request?.hash);
        this.stats.dismissed++;
        await this.appendAudit({ event: "dismissed", id: answer.id, address, app: request?.app, title: request?.title });
        continue;
      }
      if (answer.ok) {
        this.stats.answered++;
        if (answer.stillBlocked) {
          const attempts = (this.attempts.get(address) ?? 0) + 1;
          this.attempts.set(address, attempts);
          if (attempts >= this.config.maxAttempts) {
            this.ignored.set(address, answer.hash ?? request?.hash);
            notify({
              title: "审批中继：仍未离开 blocked",
              body: `${address} 已发送 ${answer.choice ?? answer.text ?? "回答"}，但 agent 仍在等待。请到终端查看。`,
              level: "warning",
              timeout: 12000,
              action: { name: "agent.focus", args: { terminal: address } },
            });
          }
          await this.appendAudit({ event: "still-blocked", id: answer.id, address, choice: answer.choice, attempts });
        } else {
          this.attempts.delete(address);
          await this.appendAudit({ event: "answered", id: answer.id, address, choice: answer.choice, text: answer.text ?? null, latencyMs: answer.at ? Date.now() - answer.at : null });
        }
      } else {
        await this.appendAudit({ event: "failed", id: answer.id, address, error: answer.error ?? "unknown" });
        notify({ title: "审批中继：发送失败", body: answer.error ?? "hc 返回错误", level: "error", timeout: 12000 });
      }
    }
  }

  render(cx) {
    const themeColors = theme();
    const tr = this.t;
    const pending = [...this.pending.values()];
    const alive = Number(this.helper?.at) > 0 && Date.now() - Number(this.helper.at) < 8000;
    const dot = alive ? themeColors.done : themeColors.dim;
    return v_flex()
      .id("approval-relay")
      .size_full()
      .bg(themeColors.surface)
      .text_size(12.5)
      .child(
        h_flex().h(38).px(12).gap(8).items_center().border_b(1).border_color(themeColors.border)
          .child(div().size(7).rounded_full().bg(dot))
          .child(div().font_semibold().text_color(themeColors.foreground).child(tr("panel.title")))
          .child(div().flex_1())
          .child(div().id("approval-close").px(6).py(2).rounded(6).cursor_pointer().hover((s) => s.bg(themeColors.hover))
            .text_size(13).text_color(themeColors.muted)
            .on_click(() => run("layout.hide", { id: "approval-relay-panel" })).child("×"))
          .child(div().id("approval-lang").px(7).py(3).rounded(6).bg(themeColors.raised).cursor_pointer()
            .hover((s) => s.bg(themeColors.hover)).text_size(10.5).text_color(themeColors.muted)
            .on_click((_e, cx) => { this.setLanguage(cx); }).child(this.lang === "zh" ? "中" : "EN"))
          .child(div().px(7).py(3).rounded(6).bg(themeColors.raised).text_size(10.5).text_color(themeColors.muted).child(this.openKey))
      )
      .child(
        h_flex().px(12).py(7).gap(7).items_center()
          .child(div().text_color(pending.length ? themeColors.blocked : themeColors.dim).child(pending.length ? tr("panel.pending", { n: pending.length }) : tr("panel.empty")))
          .child(div().flex_1())
          .child(div().id("approval-wake").px(8).py(4).rounded(6).cursor_pointer().hover((s) => s.bg(themeColors.hover)).text_color(themeColors.muted)
            .on_click((_e, cx) => { this.wake(); cx.notify(); }).child(tr("panel.popup")))
          .child(div().id("approval-rescan").px(8).py(4).rounded(6).cursor_pointer().hover((s) => s.bg(themeColors.hover)).text_color(themeColors.muted)
            .on_click((_e, cx) => { this.lastRead.clear(); this.tick(cx); }).child(tr("panel.scan")))
      )
      .child(
        v_flex().flex_1().overflow_y_scrollbar().px(10).gap(8)
          .children(
            pending.length
              ? pending.map((request) => this.row(request, themeColors, tr))
              : [
                  v_flex().items_center().gap(5).py(26).px(12)
                    .child(div().text_color(themeColors.foreground).child(tr("panel.empty")))
                    .child(div().text_size(11).text_color(themeColors.dim).child(tr("panel.emptyHint")))
                    .child(h_flex().gap(4).pt(4)
                      .child(div().px(6).py(2).rounded(5).bg(themeColors.raised).text_size(10.5).text_color(themeColors.muted).child(this.openKey))
                      .child(div().px(6).py(2).rounded(5).bg(themeColors.raised).text_size(10.5).text_color(themeColors.muted).child("1–9"))
                      .child(div().px(6).py(2).rounded(5).bg(themeColors.raised).text_size(10.5).text_color(themeColors.muted).child("Enter")))
                ]
          )
      )
      .child(
        v_flex().border_t(1).border_color(themeColors.border).px(12).py(7).gap(3)
          .child(div().text_size(10.5).text_color(themeColors.dim).child(tr("panel.recent")))
          .children(
            this.audit.slice(-4).reverse().map((entry) =>
              h_flex().gap(6).items_center()
                .child(div().text_size(10).text_color(themeColors.dim).child(new Date(entry.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })))
                .child(div().truncate().text_size(10.5).text_color(themeColors.muted).child(this.auditLabel(entry, tr)))
            )
          )
          .when(!this.audit.length, (el) => el.child(div().text_size(10.5).text_color(themeColors.dim).child(tr("panel.noAudit"))))
          .child(div().pt(3).text_size(10).text_color(themeColors.dim).child(tr("panel.keyboard", { key: this.openKey })))
      );
  }

  row(request, c, tr) {
    const options = (request.options ?? []).slice(0, 3);
    return v_flex()
      .id(`approval-${request.id}`)
      .gap(5)
      .p(10)
      .rounded(9)
      .border(1)
      .border_color(c.border)
      .bg(c.canvas)
      .child(
        h_flex().gap(6).items_center()
          .child(div().px(6).py(1).rounded(4).bg(c.raised).text_size(10).text_color(c.accent).child(request.app ?? "agent"))
          .child(div().flex_1())
          .child(div().text_size(10).text_color(c.dim).child(this.age(Date.now() - (request.created ?? Date.now()))))
      )
      .child(div().font_medium().text_color(c.foreground).truncate().child(request.title || request.address))
      .child(div().text_size(10.5).text_color(c.dim).truncate().child(`${request.space ?? "?"} / ${request.tab ?? "?"}`))
      .when(Boolean(request.question), (el) =>
        el.child(div().text_size(11).text_color(c.muted).max_h(34).child(request.question.replace(/\s+/g, " ").slice(0, 120)))
      )
      .when(options.length > 0, (el) =>
        el.child(
          v_flex().gap(3).pt(2).children(
            options.map((option, index) => {
              const label = String(option.label ?? "").replace(/^\s*\d+[.)]\s+/, "");
              const badge = option.default || option.selected ? String(index + 1) : String(index + 1);
              return h_flex().gap(6).items_center().px(6).py(3).rounded(5)
                .bg(option.default ? c.raised : c.surface)
                .child(div().w(14).h(14).rounded(4).bg(option.default ? c.accent : c.raised).text_size(9).text_color(option.default ? c.accent_foreground : c.muted).child(badge))
                .child(div().flex_1().truncate().text_size(10.5).text_color(option.default ? c.foreground : c.muted).child(label))
                .when(option.default, (row) => row.child(div().text_size(9).text_color(c.dim).child("Enter")));
            })
          )
        )
      )
      .child(
        h_flex().gap(6).pt(2).items_center()
          .child(div().id(`approval-open-${request.id}`).px(7).py(3).rounded(5).cursor_pointer().hover((s) => s.bg(c.hover)).text_color(c.accent)
            .on_click(() => run("agent.focus", { terminal: request.address })).child(tr("panel.openAgent")))
          .child(div().id(`approval-show-${request.id}`).px(7).py(3).rounded(5).cursor_pointer().hover((s) => s.bg(c.hover)).text_color(c.muted)
            .on_click(() => this.wake()).child(tr("panel.popup")))
      );
  }

  auditLabel(entry, tr) {
    const name = entry.title || entry.address || "";
    if (entry.event === "detected") return tr("panel.detected", { name });
    if (entry.event === "answered") return tr("panel.answered", { choice: entry.choice ?? "OK", name });
    if (entry.event === "dismissed") return tr("panel.dismissed", { name });
    if (entry.event === "external") return tr("panel.external", { name });
    if (entry.event === "still-blocked") return tr("panel.stillBlocked", { name });
    if (entry.event === "failed") return tr("panel.failed", { name });
    return `${entry.event} ${name}`;
  }
}
