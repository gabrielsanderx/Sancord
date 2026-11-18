// ============================================================================
// Sancord UI Kit — componentes reutilizáveis
//   SancordUI.contextMenu(x, y, items)    menu de botão direito / dropdown
//   SancordUI.formDialog({...})           modal de formulário (Promise)
//   SancordUI.confirm({...})              confirmação (Promise<boolean>)
//   SancordUI.tooltip(el, text, side)     tooltip leve
// Todos usam textContent (nunca innerHTML com dados do usuário).
// ============================================================================

const SancordUI = (() => {
  let menuEl = null;
  let menuCleanup = null;

  function closeContextMenu() {
    if (menuCleanup) menuCleanup();
    menuCleanup = null;
    menuEl?.remove();
    menuEl = null;
  }

  /**
   * items: { label, onSelect, danger?, disabled?, hint?, icon? } | { separator: true } | { header: "..." }
   */
  function contextMenu(x, y, items, { anchor = null } = {}) {
    closeContextMenu();
    const visible = items.filter(Boolean);
    if (visible.length === 0) return;
    const prevFocus = document.activeElement;

    menuEl = document.createElement("div");
    menuEl.className = "msg-context-menu sancord-menu";
    menuEl.setAttribute("role", "menu");
    const buttons = [];
    for (const item of visible) {
      if (item.separator) {
        const sep = document.createElement("div");
        sep.className = "sancord-menu-sep";
        sep.setAttribute("role", "separator");
        menuEl.appendChild(sep);
        continue;
      }
      if (item.header) {
        const h = document.createElement("div");
        h.className = "sancord-menu-header";
        h.textContent = item.header;
        menuEl.appendChild(h);
        continue;
      }
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `msg-ctx-item${item.danger ? " danger" : ""}`;
      btn.setAttribute("role", "menuitem");
      btn.disabled = Boolean(item.disabled);
      const left = document.createElement("span");
      left.className = "msg-ctx-item-left";
      if (item.icon) {
        const ic = document.createElement("span");
        ic.className = "sancord-menu-icon";
        ic.textContent = item.icon;
        ic.setAttribute("aria-hidden", "true");
        left.appendChild(ic);
      }
      const lbl = document.createElement("span");
      lbl.textContent = item.label;
      left.appendChild(lbl);
      btn.appendChild(left);
      if (item.hint) {
        const hint = document.createElement("span");
        hint.className = "sancord-menu-hint";
        hint.textContent = item.hint;
        btn.appendChild(hint);
      }
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        closeContextMenu();
        try {
          item.onSelect?.();
        } catch (err) {
          console.error("[Sancord] Erro na ação do menu:", err);
        }
      });
      buttons.push(btn);
      menuEl.appendChild(btn);
    }
    document.body.appendChild(menuEl);

    // Posiciona dentro da janela.
    let px = x;
    let py = y;
    if (anchor) {
      const r = anchor.getBoundingClientRect();
      px = r.left;
      py = r.bottom + 4;
    }
    const rect = menuEl.getBoundingClientRect();
    menuEl.style.left = `${Math.max(8, Math.min(px, window.innerWidth - rect.width - 8))}px`;
    menuEl.style.top = `${Math.max(8, Math.min(py, window.innerHeight - rect.height - 8))}px`;

    const enabled = buttons.filter((b) => !b.disabled);
    enabled[0]?.focus({ preventScroll: true });

    const onKey = (e) => {
      const idx = enabled.indexOf(document.activeElement);
      if (e.key === "Escape") {
        e.preventDefault();
        closeContextMenu();
        prevFocus?.focus?.({ preventScroll: true });
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        enabled[(idx + 1) % enabled.length]?.focus();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        enabled[(idx - 1 + enabled.length) % enabled.length]?.focus();
      } else if (e.key === "Tab") {
        closeContextMenu();
      }
    };
    const onDown = (e) => {
      if (menuEl && !menuEl.contains(e.target)) closeContextMenu();
    };
    const onScrollOrResize = () => closeContextMenu();
    document.addEventListener("keydown", onKey, true);
    setTimeout(() => document.addEventListener("mousedown", onDown, true), 0);
    window.addEventListener("resize", onScrollOrResize);
    window.addEventListener("blur", onScrollOrResize);
    menuCleanup = () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("resize", onScrollOrResize);
      window.removeEventListener("blur", onScrollOrResize);
    };
  }

  /**
   * fields: [{ name, label, type: "text"|"textarea"|"select"|"color"|"cards", value, options:[{value,label,hint,icon}],
   *            placeholder, maxlength, required, hint, visibleWhen: (values) => bool }]
   * Resolve com os valores ou null se cancelado.
   */
  function formDialog({ title, description = "", fields = [], submitLabel = "Salvar", danger = false, extraAction = null }) {
    return new Promise((resolve) => {
      const prevFocus = document.activeElement;
      const backdrop = document.createElement("div");
      backdrop.className = "modal-backdrop sancord-dialog-backdrop";
      backdrop.setAttribute("role", "dialog");
      backdrop.setAttribute("aria-modal", "true");

      const card = document.createElement("div");
      card.className = "modal-card compact-modal sancord-dialog";
      const h = document.createElement("h2");
      h.textContent = title;
      h.id = `dlg-${Math.random().toString(36).slice(2)}`;
      backdrop.setAttribute("aria-labelledby", h.id);
      card.appendChild(h);
      if (description) {
        const p = document.createElement("p");
        p.textContent = description;
        card.appendChild(p);
      }

      const form = document.createElement("form");
      form.noValidate = true;
      const inputs = {};
      const rows = [];
      for (const f of fields) {
        const row = document.createElement("div");
        row.className = "settings-field sancord-dialog-field";
        const id = `f-${f.name}-${Math.random().toString(36).slice(2, 7)}`;
        if (f.label) {
          const label = document.createElement("label");
          label.textContent = f.label;
          label.htmlFor = id;
          row.appendChild(label);
        }
        let input;
        if (f.type === "textarea") {
          input = document.createElement("textarea");
          input.rows = f.rows || 3;
        } else if (f.type === "select") {
          input = document.createElement("select");
          for (const opt of f.options || []) {
            const o = document.createElement("option");
            o.value = opt.value ?? "";
            o.textContent = opt.label;
            input.appendChild(o);
          }
        } else if (f.type === "cards") {
          input = document.createElement("div");
          input.className = "sancord-cards";
          input.setAttribute("role", "radiogroup");
          for (const opt of f.options || []) {
            const lab = document.createElement("label");
            lab.className = "sancord-card-option";
            const radio = document.createElement("input");
            radio.type = "radio";
            radio.name = id;
            radio.value = opt.value;
            radio.checked = opt.value === f.value;
            radio.disabled = Boolean(opt.disabled);
            const body = document.createElement("span");
            const strong = document.createElement("strong");
            strong.textContent = `${opt.icon ? `${opt.icon}  ` : ""}${opt.label}`;
            body.appendChild(strong);
            if (opt.hint) {
              const small = document.createElement("small");
              small.textContent = opt.hint;
              body.appendChild(small);
            }
            lab.append(radio, body);
            radio.addEventListener("change", updateVisibility);
            input.appendChild(lab);
          }
        } else if (f.type === "checklist") {
          // Seleção múltipla (ex.: amigos de um grupo). Valor = array de `value`.
          input = document.createElement("div");
          input.className = "sancord-checklist";
          const selected = new Set(Array.isArray(f.value) ? f.value : []);
          if ((f.options || []).length === 0 && f.emptyText) {
            const empty = document.createElement("div");
            empty.className = "settings-hint-text";
            empty.textContent = f.emptyText;
            input.appendChild(empty);
          }
          for (const opt of f.options || []) {
            const lab = document.createElement("label");
            lab.className = "sancord-check-option";
            const box = document.createElement("input");
            box.type = "checkbox";
            box.value = opt.value;
            box.checked = selected.has(opt.value);
            box.disabled = Boolean(opt.disabled);
            const text = document.createElement("span");
            text.textContent = opt.label;
            lab.append(box, text);
            if (opt.hint) {
              const small = document.createElement("small");
              small.textContent = opt.hint;
              lab.appendChild(small);
            }
            box.addEventListener("change", () => {
              if (f.max) {
                const count = input.querySelectorAll("input:checked").length;
                input.querySelectorAll("input:not(:checked)").forEach((b) => {
                  b.disabled = count >= f.max;
                });
              }
              updateVisibility();
            });
            input.appendChild(lab);
          }
        } else {
          input = document.createElement("input");
          input.type = f.type || "text";
        }
        if (f.type !== "cards" && f.type !== "checklist") {
          input.id = id;
          if (f.value !== undefined && f.value !== null) input.value = f.value;
          if (f.placeholder) input.placeholder = f.placeholder;
          if (f.maxlength) input.maxLength = f.maxlength;
          input.addEventListener("change", updateVisibility);
        }
        inputs[f.name] = input;
        row.appendChild(input);
        if (f.hint) {
          const hint = document.createElement("div");
          hint.className = "settings-hint-text";
          hint.textContent = f.hint;
          row.appendChild(hint);
        }
        rows.push({ f, row });
        form.appendChild(row);
      }

      const error = document.createElement("div");
      error.className = "add-friend-feedback err hidden";
      error.setAttribute("role", "alert");
      form.appendChild(error);

      const actions = document.createElement("div");
      actions.className = "modal-actions-row";
      if (extraAction) {
        const extra = document.createElement("button");
        extra.type = "button";
        extra.className = `btn-secondary${extraAction.danger ? " danger-text" : ""} sancord-dialog-extra`;
        extra.textContent = extraAction.label;
        extra.addEventListener("click", () => {
          close(null);
          extraAction.onSelect?.();
        });
        actions.appendChild(extra);
      }
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "btn-secondary";
      cancel.textContent = "Cancelar";
      const submit = document.createElement("button");
      submit.type = "submit";
      submit.className = danger ? "btn-primary btn-danger" : "btn-primary";
      submit.textContent = submitLabel;
      actions.append(cancel, submit);
      form.appendChild(actions);
      card.appendChild(form);
      backdrop.appendChild(card);
      document.body.appendChild(backdrop);

      function values() {
        const out = {};
        for (const f of fields) {
          const el = inputs[f.name];
          if (f.type === "cards") {
            out[f.name] = el.querySelector("input:checked")?.value ?? f.value;
          } else if (f.type === "checklist") {
            out[f.name] = Array.from(el.querySelectorAll("input:checked")).map((b) => b.value);
          } else {
            out[f.name] = el.value;
          }
        }
        return out;
      }
      function updateVisibility() {
        const v = values();
        for (const { f, row } of rows) {
          if (f.visibleWhen) row.classList.toggle("hidden", !f.visibleWhen(v));
        }
      }
      updateVisibility();

      function close(result) {
        document.removeEventListener("keydown", onKey, true);
        backdrop.remove();
        prevFocus?.focus?.({ preventScroll: true });
        resolve(result);
      }
      function onKey(e) {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          close(null);
        }
      }
      document.addEventListener("keydown", onKey, true);
      cancel.addEventListener("click", () => close(null));
      backdrop.addEventListener("mousedown", (e) => {
        if (e.target === backdrop) close(null);
      });
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const v = values();
        for (const { f } of rows) {
          const hidden = f.visibleWhen && !f.visibleWhen(v);
          const empty = Array.isArray(v[f.name]) ? v[f.name].length === 0 : !String(v[f.name] || "").trim();
          if (!hidden && f.required && empty) {
            error.textContent = `Preencha: ${f.label || f.name}.`;
            error.classList.remove("hidden");
            inputs[f.name].focus?.();
            return;
          }
        }
        close(v);
      });

      const first = form.querySelector("input:not([type=radio]), textarea, select") || form.querySelector("input");
      setTimeout(() => {
        first?.focus();
        first?.select?.();
      }, 0);
    });
  }

  function confirm({ title, message, confirmLabel = "Confirmar", danger = false }) {
    return formDialog({ title, description: message, fields: [], submitLabel: confirmLabel, danger }).then((v) => v !== null);
  }

  let tipEl = null;
  let tipTarget = null;
  // Elementos re-renderizados não disparam "mouseleave"; então escondemos o
  // tooltip sempre que o ponteiro sai do alvo atual ou a página rola.
  document.addEventListener(
    "pointerover",
    (e) => {
      if (tipTarget && (!tipTarget.isConnected || !tipTarget.contains(e.target))) hideTooltip();
    },
    true
  );
  document.addEventListener("scroll", () => hideTooltip(), true);

  function showTooltip(target, text, side) {
    if (!text) return;
    tipTarget = target;
    if (!tipEl) {
      tipEl = document.createElement("div");
      tipEl.className = "sancord-tooltip";
      tipEl.setAttribute("role", "tooltip");
      document.body.appendChild(tipEl);
    }
    tipEl.textContent = text;
    tipEl.dataset.side = side;
    tipEl.classList.add("visible");
    const r = target.getBoundingClientRect();
    const t = tipEl.getBoundingClientRect();
    let x;
    let y;
    if (side === "right") {
      x = r.right + 12;
      y = r.top + r.height / 2 - t.height / 2;
    } else {
      x = r.left + r.width / 2 - t.width / 2;
      y = r.top - t.height - 8;
    }
    tipEl.style.left = `${Math.max(4, Math.min(x, window.innerWidth - t.width - 4))}px`;
    tipEl.style.top = `${Math.max(4, y)}px`;
  }
  function hideTooltip() {
    tipTarget = null;
    tipEl?.classList.remove("visible");
  }
  /** Tooltip leve: aparece no hover e no foco do teclado. */
  function tooltip(el, text, side = "right") {
    el.setAttribute("aria-label", text);
    el.removeAttribute("title");
    el.addEventListener("mouseenter", () => showTooltip(el, text, side));
    el.addEventListener("focus", () => showTooltip(el, text, side));
    el.addEventListener("mouseleave", hideTooltip);
    el.addEventListener("blur", hideTooltip);
    el.addEventListener("mousedown", hideTooltip);
  }

  return { contextMenu, closeContextMenu, formDialog, confirm, tooltip, hideTooltip };
})();
