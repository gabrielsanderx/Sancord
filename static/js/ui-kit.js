// ============================================================================
// Sancord UI Kit — componentes reutilizáveis
//   SancordUI.contextMenu(x, y, items)    menu de botão direito / dropdown
//   SancordUI.formDialog({...})           modal de formulário (Promise)
//   SancordUI.confirm({...})              confirmação (Promise<boolean>)
//   SancordUI.tooltip(el, text, side)     tooltip leve
// Todos usam textContent (nunca innerHTML com dados do usuário).
// ============================================================================

// Cache de imagens (Fase 9, seção 63): avatares chegam como data URL de dezenas
// de KB e eram repetidos por inteiro em cada mensagem (42 MB de HTML com 300
// mensagens). Cada imagem é decodificada uma vez e vira um "blob:" curto.
const MEDIA_URL_CACHE = new Map();
const MEDIA_URL_CACHE_MAX = 500;
const MEDIA_URL_CACHE_MAX_BYTES = 32 * 1024 * 1024;
const MEDIA_URL_MIN_LENGTH = 2048;
let mediaUrlCacheBytes = 0;

function cachedMediaUrl(url) {
  // Perfil P1: avatar/banner novos são caminhos do servidor ("/api/attachments/…"),
  // imutáveis por ID — o navegador guarda em cache e a troca muda o endereço.
  if (typeof url === "string" && url.startsWith("/api/") && typeof SancordNet !== "undefined") return SancordNet.imageUrl(url);
  if (typeof url !== "string" || url.length < MEDIA_URL_MIN_LENGTH || !url.startsWith("data:")) return url;
  const hit = MEDIA_URL_CACHE.get(url);
  if (hit) return hit;
  // Não descarta URLs ainda usadas pelo DOM ou por um render em preparação.
  // Ao atingir o orçamento, imagens novas continuam usando sua URL original.
  if (MEDIA_URL_CACHE.size >= MEDIA_URL_CACHE_MAX || mediaUrlCacheBytes >= MEDIA_URL_CACHE_MAX_BYTES) return url;
  try {
    const comma = url.indexOf(",");
    const meta = url.slice(5, comma);
    if (!meta.endsWith(";base64")) return url;
    const mime = meta.slice(0, -";base64".length);
    if (!/^image\/(png|jpeg|jpg|gif|webp)$/.test(mime)) return url;
    const bin = atob(url.slice(comma + 1));
    if (bin.length > MEDIA_URL_CACHE_MAX_BYTES - mediaUrlCacheBytes) return url;
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const blobUrl = URL.createObjectURL(new Blob([bytes], { type: mime }));
    MEDIA_URL_CACHE.set(url, blobUrl);
    mediaUrlCacheBytes += bin.length;
    return blobUrl;
  } catch (_) {
    return url;
  }
}

const SancordUI = (() => {
  let menuEl = null;
  let menuCleanup = null;

  function closeContextMenu() {
    const cleanup = menuCleanup;
    menuCleanup = null;
    menuEl?.remove();
    menuEl = null;
    cleanup?.();
  }

  /**
   * Construtores reutilizáveis para menus contextuais (DM, mensagens, servidores, canais, membros).
   */
  const ContextMenuItem = (opts) => ({ ...opts });
  const ContextMenuDangerItem = (opts) => ({ ...opts, danger: true });
  const ContextMenuSubmenu = (opts) => ({ ...opts, submenu: Array.isArray(opts.submenu) ? opts.submenu : [] });
  const ContextMenuSeparator = () => ({ separator: true });
  const ContextMenuLabel = (header) => ({ header: String(header || "") });

  function buildMenuItemButton(item, { onActivate, onSubmenuOpen, onSubmenuHover, onSubmenuLeave }) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `msg-ctx-item${item.danger ? " danger" : ""}${item.sublabel ? " has-sublabel" : ""}${item.checked ? " is-checked" : ""}`;
    btn.setAttribute("role", item.checked !== undefined ? "menuitemradio" : "menuitem");
    if (item.checked !== undefined) btn.setAttribute("aria-checked", item.checked ? "true" : "false");
    btn.disabled = Boolean(item.disabled);
    if (item.id) btn.dataset.ctxId = item.id;
    if (item.ariaLabel) btn.setAttribute("aria-label", item.ariaLabel);

    const left = document.createElement("span");
    left.className = "msg-ctx-item-left";
    if (item.icon) {
      const ic = document.createElement("span");
      ic.className = "sancord-menu-icon";
      if (typeof SancordIcons !== "undefined") ic.appendChild(SancordIcons.node(item.icon));
      else ic.textContent = item.icon;
      ic.setAttribute("aria-hidden", "true");
      left.appendChild(ic);
    }
    const textWrap = document.createElement("span");
    textWrap.className = "sancord-menu-text";
    const lbl = document.createElement("span");
    lbl.className = "sancord-menu-label";
    lbl.textContent = item.label;
    textWrap.appendChild(lbl);
    if (item.sublabel) {
      const sub = document.createElement("span");
      sub.className = "sancord-menu-sublabel";
      sub.textContent = item.sublabel;
      textWrap.appendChild(sub);
    }
    left.appendChild(textWrap);
    btn.appendChild(left);

    const right = document.createElement("span");
    right.className = "sancord-menu-right";
    if (item.hint) {
      const hint = document.createElement("span");
      hint.className = "sancord-menu-hint";
      hint.textContent = item.hint;
      right.appendChild(hint);
    }
    if (item.checked) {
      const chk = document.createElement("span");
      chk.className = "sancord-menu-check";
      if (typeof SancordIcons !== "undefined") chk.appendChild(SancordIcons.node("check"));
      else chk.textContent = "✓";
      chk.setAttribute("aria-hidden", "true");
      right.appendChild(chk);
    }
    if (item.submenu) {
      btn.setAttribute("aria-haspopup", "menu");
      btn.setAttribute("aria-expanded", "false");
      const chev = document.createElement("span");
      chev.className = "sancord-menu-chevron";
      if (typeof SancordIcons !== "undefined") chev.appendChild(SancordIcons.node("chevron"));
      else chev.textContent = "›";
      chev.setAttribute("aria-hidden", "true");
      right.appendChild(chev);
    }
    if (right.childElementCount > 0) btn.appendChild(right);

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (btn.disabled) return;
      if (item.submenu) {
        onSubmenuOpen?.(btn, item, true);
        return;
      }
      onActivate?.(item);
    });
    if (item.submenu && !btn.disabled) {
      btn.addEventListener("mouseenter", () => onSubmenuHover?.(btn, item));
      btn.addEventListener("mouseleave", () => onSubmenuLeave?.());
    }
    return btn;
  }

  /**
   * items: { label, sublabel?, onSelect, danger?, disabled?, hint?, icon?, checked?, submenu? }
   *        | { separator: true } | { header: "..." }
   */
  function contextMenu(x, y, items, { anchor = null, above = false, onClose = null, label = null, compact = false, className = "" } = {}) {
    closeContextMenu();
    const visible = items.filter(Boolean);
    if (visible.length === 0) return;
    const prevFocus = document.activeElement;

    menuEl = document.createElement("div");
    menuEl.className = `msg-context-menu sancord-menu${compact ? " is-compact" : ""}${className ? ` ${className}` : ""}`;
    menuEl.setAttribute("role", "menu");
    if (label) menuEl.setAttribute("aria-label", label);
    const buttons = [];
    let submenu = null;
    let submenuTrigger = null;
    let hoverOpenTimer = null;
    let hoverCloseTimer = null;

    function clearHoverTimers() {
      clearTimeout(hoverOpenTimer);
      clearTimeout(hoverCloseTimer);
      hoverOpenTimer = null;
      hoverCloseTimer = null;
    }

    function closeSubmenu(restoreFocus = false) {
      clearHoverTimers();
      submenu?.remove();
      submenu = null;
      submenuTrigger?.setAttribute("aria-expanded", "false");
      if (restoreFocus) submenuTrigger?.focus({ preventScroll: true });
      submenuTrigger = null;
    }

    function scheduleCloseSubmenu() {
      clearTimeout(hoverCloseTimer);
      hoverCloseTimer = setTimeout(() => closeSubmenu(false), 180);
    }

    function activateItem(item) {
      if (item.keepOpen !== true) closeContextMenu();
      try {
        item.onSelect?.();
      } catch (err) {
        console.error("[Sancord] Erro na ação do menu:", err);
      }
    }

    function openSubmenu(trigger, item, focusFirst = false) {
      clearHoverTimers();
      if (submenuTrigger === trigger && submenu) {
        if (focusFirst) submenu.querySelector("button:not(:disabled)")?.focus({ preventScroll: true });
        return;
      }
      closeSubmenu(false);
      submenuTrigger = trigger;
      trigger.setAttribute("aria-expanded", "true");
      submenu = document.createElement("div");
      submenu.className = "msg-context-menu sancord-menu sancord-submenu";
      submenu.setAttribute("role", "menu");
      submenu.setAttribute("aria-label", item.label);
      submenu.addEventListener("mouseenter", clearHoverTimers);
      submenu.addEventListener("mouseleave", scheduleCloseSubmenu);

      const children = (item.submenu || []).filter(Boolean);
      for (const child of children) {
        if (child.separator) {
          const sep = document.createElement("div");
          sep.className = "sancord-menu-sep";
          sep.setAttribute("role", "separator");
          submenu.appendChild(sep);
          continue;
        }
        if (child.header) {
          const h = document.createElement("div");
          h.className = "sancord-menu-header";
          h.textContent = child.header;
          submenu.appendChild(h);
          continue;
        }
        const opt = buildMenuItemButton(child, { onActivate: activateItem });
        submenu.appendChild(opt);
      }
      document.body.appendChild(submenu);
      const root = menuEl.getBoundingClientRect();
      const trigRect = trigger.getBoundingClientRect();
      const rect = submenu.getBoundingClientRect();
      const fitsRight = root.right + rect.width + 12 <= window.innerWidth;
      const sx = fitsRight ? root.right + 4 : root.left - rect.width - 4;
      const sy = Math.max(8, Math.min(trigRect.top - 4, window.innerHeight - rect.height - 8));
      submenu.style.left = `${Math.max(8, Math.min(sx, window.innerWidth - rect.width - 8))}px`;
      submenu.style.top = `${sy}px`;
      if (focusFirst) submenu.querySelector("button:not(:disabled)")?.focus({ preventScroll: true });
    }

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
      if (item.control) {
        menuEl.appendChild(item.control);
        continue;
      }
      const btn = buildMenuItemButton(item, {
        onActivate: activateItem,
        onSubmenuOpen: (b, it) => openSubmenu(b, it, true),
        onSubmenuHover: (b, it) => {
          clearHoverTimers();
          hoverOpenTimer = setTimeout(() => openSubmenu(b, it, false), 90);
        },
        onSubmenuLeave: scheduleCloseSubmenu,
      });
      if (!item.submenu) {
        btn.addEventListener("mouseenter", () => {
          if (submenu) scheduleCloseSubmenu();
        });
      }
      buttons.push(btn);
      menuEl.appendChild(btn);
    }
    document.body.appendChild(menuEl);

    // Posiciona dentro da janela sem cortar bordas.
    let px = x;
    let py = y;
    if (anchor) {
      const r = anchor.getBoundingClientRect();
      px = r.left;
      py = above ? r.top - menuEl.offsetHeight - 6 : r.bottom + 4;
    }
    const rect = menuEl.getBoundingClientRect();
    menuEl.style.left = `${Math.max(8, Math.min(px, window.innerWidth - rect.width - 8))}px`;
    menuEl.style.top = `${Math.max(8, Math.min(py, window.innerHeight - rect.height - 8))}px`;

    const enabled = buttons.filter((b) => !b.disabled);
    enabled[0]?.focus({ preventScroll: true });

    const onKey = (e) => {
      const inSub = Boolean(submenu && submenu.contains(document.activeElement));
      const active = inSub
        ? [...submenu.querySelectorAll("button:not(:disabled)")]
        : enabled;
      const idx = active.indexOf(document.activeElement);
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        if (submenu) { closeSubmenu(true); return; }
        closeContextMenu();
        (anchor || prevFocus)?.focus?.({ preventScroll: true });
      } else if (e.key === "ArrowRight" && !inSub && e.target.getAttribute?.("aria-haspopup") === "menu") {
        e.preventDefault();
        e.target.click();
      } else if (e.key === "ArrowLeft" && submenu) {
        e.preventDefault();
        closeSubmenu(true);
      } else if (e.target.type === "range" && e.key !== "Tab") {
        return;
      } else if (e.key === "ArrowDown" && active.length) {
        e.preventDefault();
        active[(idx + 1 + active.length) % active.length]?.focus({ preventScroll: true });
      } else if (e.key === "ArrowUp" && active.length) {
        e.preventDefault();
        active[(idx - 1 + active.length) % active.length]?.focus({ preventScroll: true });
      } else if (e.key === "Tab" && !menuEl.querySelector('input[type="range"]')) {
        closeContextMenu();
      } else if (e.key === "Tab") {
        const controls = [...menuEl.querySelectorAll("button:not(:disabled), input:not(:disabled)")];
        if ((e.shiftKey && document.activeElement === controls[0]) || (!e.shiftKey && document.activeElement === controls.at(-1))) {
          e.preventDefault();
          controls[e.shiftKey ? controls.length - 1 : 0]?.focus();
        }
      }
    };
    const onDown = (e) => {
      if (menuEl && !menuEl.contains(e.target) && !submenu?.contains(e.target) && !anchor?.contains(e.target)) closeContextMenu();
    };
    const onResizeOrBlur = () => closeContextMenu();
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onDown, true);
    window.addEventListener("resize", onResizeOrBlur);
    window.addEventListener("blur", onResizeOrBlur);
    menuCleanup = () => {
      closeSubmenu(false);
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("resize", onResizeOrBlur);
      window.removeEventListener("blur", onResizeOrBlur);
      onClose?.();
    };
  }

  /**
   * fields: [{ name, label, type: "text"|"textarea"|"select"|"color"|"cards", value, options:[{value,label,hint,icon}],
   *            placeholder, maxlength, required, hint, visibleWhen: (values) => bool }]
   * Resolve com os valores ou null se cancelado.
   */
  function formDialog({ title, description = "", fields = [], submitLabel, cancelLabel, submitKey = "common.save", danger = false, extraAction = null, preview = null, onPreview = null }) {
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
        if (f.type === "text-list") {
          input = document.createElement("div");
          input.className = "dialog-text-list";
          input.setAttribute("role", "group");
          input.setAttribute("aria-label", f.label || "Opções");
          const add = document.createElement("button");
          add.type = "button";
          add.className = "btn-secondary small-btn";
          add.textContent = f.addLabel || "Adicionar";
          const append = () => {
            const index = input.querySelectorAll("input").length + 1;
            const entry = document.createElement("input");
            entry.type = "text";
            entry.id = index === 1 ? id : `${id}-${index}`;
            entry.maxLength = f.maxlength || 80;
            entry.placeholder = `${f.itemLabel || "Opção"} ${index}`;
            entry.setAttribute("aria-label", entry.placeholder);
            input.insertBefore(entry, add);
            add.disabled = index >= (f.max || 10);
            return entry;
          };
          input.append(add);
          for (let i = 0; i < (f.min || 2); i++) append();
          add.addEventListener("click", () => append().focus());
        } else if (f.type === "textarea") {
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
        if (!["cards", "checklist", "text-list"].includes(f.type)) {
          input.id = id;
          if (f.readOnly) input.readOnly = true;
          if (f.value !== undefined && f.value !== null) input.value = f.value;
          if (f.placeholder) input.placeholder = f.placeholder;
          if (f.maxlength) input.maxLength = f.maxlength;
          if (f.type === "file" && f.accept) input.accept = f.accept;
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
      cancel.dataset.i18n = "common.cancel";
      cancel.textContent = typeof t === "function" ? t("common.cancel") : "Cancelar";
      if (cancelLabel) {
        delete cancel.dataset.i18n;
        cancel.textContent = cancelLabel;
      }
      const submit = document.createElement("button");
      submit.type = "submit";
      submit.className = danger ? "btn-primary btn-danger" : "btn-primary";
      if (submitLabel === undefined) {
        submit.dataset.i18n = submitKey;
        submit.textContent = typeof t === "function" ? t(submitKey) : submitKey === "common.confirm" ? "Confirmar" : "Salvar";
      } else submit.textContent = submitLabel;
      actions.append(cancel, submit);
      form.appendChild(actions);
      card.appendChild(form);
      if (preview) {
        card.classList.add("sancord-dialog-with-preview");
        card.appendChild(preview);
        form.addEventListener("input", () => onPreview?.(values()));
        form.addEventListener("change", () => onPreview?.(values()));
      }
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
          } else if (f.type === "text-list") {
            out[f.name] = [...el.querySelectorAll("input")].map(input => input.value.trim()).filter(Boolean);
          } else if (f.type === "file") {
            out[f.name] = el.files[0] || null;
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
      onPreview?.(values());

      function close(result) {
        document.removeEventListener("keydown", onKey, true);
        backdrop.remove();
        prevFocus?.focus?.({ preventScroll: true });
        resolve(result);
      }
      function focusable() {
        return [...form.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex]')]
          .filter(el => el.tabIndex >= 0 && el.type !== "hidden" && !el.closest('.hidden, [hidden]') &&
            window.getComputedStyle(el).display !== "none" && window.getComputedStyle(el).visibility !== "hidden");
      }
      function onKey(e) {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          close(null);
        } else if (e.key === "Tab") {
          const items = focusable();
          const index = items.indexOf(document.activeElement);
          if (index < 0 || (e.shiftKey ? index === 0 : index === items.length - 1)) {
            e.preventDefault();
            (e.shiftKey ? items.at(-1) : items[0])?.focus();
          }
          e.stopPropagation();
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
            error.textContent = typeof t === "function" ? t("common.required", { field: f.label || f.name }) : `Preencha: ${f.label || f.name}.`;
            error.classList.remove("hidden");
            inputs[f.name].focus?.();
            return;
          }
        }
        close(v);
      });

      setTimeout(() => {
        if (!backdrop.isConnected) return;
        const first = focusable().find(el => el.matches("input, textarea, select")) || cancel;
        first?.focus();
        if (first.matches('textarea, input:not([type=checkbox]):not([type=radio]):not([type=color])')) first.select?.();
      }, 0);
    });
  }

  function confirm({ title, message, confirmLabel, danger = false }) {
    return formDialog({ title, description: message, fields: [], submitLabel: confirmLabel, submitKey: "common.confirm", danger }).then((v) => v !== null);
  }

  let tipEl = null;
  let tipTarget = null;
  function tooltipText(control) {
    if (control.title) {
      if (!control.hasAttribute("aria-label") || control.getAttribute("aria-label") === control.dataset.uiTooltip) control.setAttribute("aria-label", control.title);
      control.dataset.uiTooltip = control.title;
      control.removeAttribute("title");
    }
    return control.dataset.uiTooltip;
  }
  // Elementos re-renderizados não disparam "mouseleave"; então escondemos o
  // tooltip sempre que o ponteiro sai do alvo atual ou a página rola.
  document.addEventListener(
    "pointerover",
    (e) => {
      if (tipTarget && (!tipTarget.isConnected || !tipTarget.contains(e.target))) hideTooltip();
      const control = e.target?.closest?.('button[title], button[data-ui-tooltip], [role="button"][title], [role="button"][data-ui-tooltip]');
      if (control && !control.disabled) {
        showTooltip(control, tooltipText(control), "top");
      }
    },
    true
  );
  document.addEventListener("scroll", () => hideTooltip(), true);
  document.addEventListener("focusin", e => {
    const control = e.target?.closest?.('button[title], button[data-ui-tooltip], [role="button"][title], [role="button"][data-ui-tooltip]');
    if (control && !control.disabled) {
      showTooltip(control, tooltipText(control), "top");
    }
  });
  document.addEventListener("focusout", hideTooltip);
  document.addEventListener("pointerout", e => { if (tipTarget && !tipTarget.contains(e.relatedTarget)) hideTooltip(); });

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

  function emptyHTML({ icon = "chat", title, description = "" }) {
    const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const graphic = typeof SancordIcons !== "undefined" ? SancordIcons.html(icon) : "";
    return `<div class="ui-empty" role="status">${graphic}<strong>${escape(title)}</strong>${description ? `<span>${escape(description)}</span>` : ""}</div>`;
  }
  return {
    contextMenu,
    closeContextMenu,
    ContextMenu: contextMenu,
    ContextMenuItem,
    ContextMenuDangerItem,
    ContextMenuSubmenu,
    ContextMenuSeparator,
    ContextMenuLabel,
    formDialog,
    confirm,
    tooltip,
    hideTooltip,
    emptyHTML,
  };
})();
