// 注入到 frame/settings/main.js 的「审批」页方法（由 approval-relay 启动时写入）。
// 依赖 settings/main.js 已有的导入：readTextFile、writeTextFile、appHome、shared、
// v_flex、h_flex、div。

  // APPROVAL_SETTINGS_METHODS
  approvalPage(t, cx) {
    if (this.approvalConfig === undefined) {
      this.approvalConfig = null;
      cx.spawn(async (cx) => { await this.loadApprovals(cx); cx.notify(); });
    }
    if (!this.approvalConfig) {
      return v_flex().w_full().child(this.heading(t, "审批中继")).child(div().text_size(13).text_color(t.dim).child("载入中…"));
    }
    const cfg = this.approvalConfig;
    const tr = cfg.translation ?? {};
    const on = cfg.enabled !== false;
    const translate = tr.enabled !== false;
    const order = Array.isArray(tr.order) ? tr.order : ["google", "microsoft"];
    const zh = String(shared("layout") ?? "").startsWith("zh");
    const L = (z, e) => (zh ? z : e);
    const notice = this.approvalError ?? this.approvalNotice ?? L("配置保存在 data/approval-relay/config.json。", "Saved in data/approval-relay/config.json.");
    return v_flex()
      .w_full()
      .relative()
      .child(this.heading(t, L("审批中继", "Approvals")))
      .child(div().pb(6).text_size(12.5).line_height("18px").text_color(t.dim).child(
        L(
          "agent 进入 blocked 时的弹窗和翻译。只转发你点过的选择，不自动批准。",
          "Popup and translation for blocked agents. Only your explicit choices are sent; nothing is auto-approved."
        )
      ))
      .child(
        this.row(
          t,
          L("启用审批中继", "Enable approvals"),
          L("关闭后不再发现新的 blocked，也不会弹窗；已在队列里的请求仍可在助手窗口回答。", "No new blocked agents are picked up while off; queued requests can still be answered."),
          this.toggle(t, "st-approval-on", on, (_e, cx) => this.saveApprovals(cx, { enabled: !on }))
        )
      )
      .child(
        this.row(
          t,
          L("翻译审批文本", "Translate prompts"),
          L("弹窗里的「翻译」/T 使用 Google 和 Microsoft；关闭后不联网。", "The Translate button and T use Google and Microsoft; off keeps it offline."),
          this.toggle(t, "st-approval-translate", translate, (_e, cx) => this.saveApprovals(cx, { translation: { ...(this.approvalConfig.translation ?? {}), enabled: !translate } }))
        )
      )
      .child(div().pt(10).text_size(12.5).font_medium().text_color(t.foreground).child(L("翻译顺序", "Translation order")))
      .child(div().pb(6).text_size(12).line_height("17px").text_color(t.dim).child(
        L(
          "按住左侧 ⠿ 拖动排序，不是单击；第一个先试，失败再按下面的顺序换。新增接口只要加进这个列表。",
          "Press and drag the ⠿ handle to reorder (a click does nothing). The first provider is tried first; the rest are fallbacks."
        )
      ))
      .child(
        v_flex().w_full().gap(5).pb(4).children(
          order.map((id, index) =>
            h_flex()
              .id(`st-approval-provider-${id}`)
              .w_full()
              .gap(10)
              .px(10)
              .py(8)
              .rounded(7)
              .cursor_grab()
              .hover((s) => s.bg(t.hover))
              .tooltip(L("按住拖动排序", "Drag to reorder"))
              .border_1()
              .border_color(this.trOver === index && this.trDrag !== null && this.trDrag !== index ? t.accent : t.border)
              .bg(this.trDrag === index ? t.hover : t.raised)
              .when(this.trDrag === index, (el) => el.opacity(0.55))
              .on_mouse_down("left", (e, cx) => {
                const height = e.bounds?.height ?? 36;
                this.trDrag = index;
                this.trOver = index;
                this.trRowStep = height + 5;
                this.trListTop = (e.bounds?.y ?? 0) - index * this.trRowStep;
                cx.notify();
              })
              .on_mouse_move((_e, cx) => {
                if (this.trDrag !== null && this.trOver !== index) { this.trOver = index; cx.notify(); }
              })
              .on_mouse_up("left", (_e, cx) => this.finishProviderDrag(cx))
              .child(div().text_size(14).text_color(t.dim).child("⠿"))
              .child(div().flex_1().text_size(13).text_color(t.foreground).child(({ google: "Google", microsoft: "Microsoft" })[id] ?? id))
              .child(div().text_size(11).text_color(index === 0 ? t.accent : t.dim).child(index === 0 ? L("先试", "first") : L("备用", "fallback")))
          )
        )
      )
      .child(div().pt(8).text_size(12.5).text_color(this.approvalError ? t.blocked : t.ansi2).child(notice))
      .child(div().pt(4).text_size(11.5).text_color(t.dim).child(
        L(
          `当前：${on ? "启用" : "停用"} · 翻译${translate ? "开" : "关"}`,
          `Now: ${on ? "on" : "off"} · translation ${translate ? "on" : "off"}`
        )
      ))
      .child(div().pt(2).text_size(11.5).text_color(t.dim).child(
        L(
          "快捷键在「设置 → 快捷键」统一管理；本页只控制行为。",
          "Shortcuts live in Settings → Keys; this page only controls behavior."
        )
      ))
      .when(this.trDrag !== null, (el) =>
        el.child(
          div().absolute().inset_0().cursor_grabbing()
            .on_mouse_move((e, cx) => {
              const step = this.trRowStep || 41;
              const index = Math.max(0, Math.min(order.length - 1, Math.floor((e.position.y - this.trListTop) / step)));
              if (index !== this.trOver) { this.trOver = index; cx.notify(); }
            })
            .on_mouse_up("left", (_e, cx) => this.finishProviderDrag(cx))
        )
      );
  }

  finishProviderDrag(cx) {
    const from = this.trDrag;
    const to = this.trOver;
    this.trDrag = null;
    this.trOver = null;
    if (from !== null && to !== null && from !== to) {
      const current = [...(this.approvalConfig.translation?.order ?? [])];
      const [moved] = current.splice(from, 1);
      if (moved !== undefined) {
        current.splice(to, 0, moved);
        this.saveApprovals(cx, { translation: { ...(this.approvalConfig.translation ?? {}), order: current } });
      }
    } else {
      cx.notify();
    }
  }

  async loadApprovals(cx) {
    const home = appHome();
    let raw = null;
    try { raw = await readTextFile(`${home}/data/approval-relay/config.json`); } catch {}
    let cfg = { enabled: true, translation: { enabled: true, order: ["google", "microsoft"] } };
    if (raw) {
      try { cfg = JSON.parse(raw); } catch {}
    }
    cfg.translation = cfg.translation ?? {};
    if (cfg.translation.enabled === undefined) cfg.translation.enabled = cfg.translation.provider !== "off";
    if (!Array.isArray(cfg.translation.order)) {
      cfg.translation.order = cfg.translation.provider === "microsoft" ? ["microsoft", "google"] : ["google", "microsoft"];
    }
    this.approvalConfig = cfg;
    this.approvalRaw = raw;
    this.trDrag = null;
    this.trOver = null;
    this.approvalError = null;
    this.approvalNotice = null;
    cx.notify();
  }

  async saveApprovals(cx, patch) {
    const next = { ...this.approvalConfig, ...patch };
    if (patch.translation) next.translation = { ...(this.approvalConfig.translation ?? {}), ...patch.translation };
    this.approvalConfig = next;
    try {
      const text = JSON.stringify(next, null, 2) + "\n";
      await writeTextFile(`${appHome()}/data/approval-relay/config.json`, text, this.approvalRaw ?? null);
      this.approvalRaw = text;
      this.approvalError = null;
      this.approvalNotice = String(shared("layout") ?? "").startsWith("zh") ? "已保存。" : "Saved.";
    } catch (error) {
      this.approvalError = String(error?.message ?? error);
    }
    cx.notify();
  }

