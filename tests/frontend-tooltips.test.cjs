const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const uiKitSrc = fs.readFileSync(path.join(ROOT, "static/js/ui-kit.js"), "utf8");
const stylesCss = fs.readFileSync(path.join(ROOT, "static/styles.css"), "utf8");
const uiCss = fs.readFileSync(path.join(ROOT, "static/ui.css"), "utf8");
const rustAppSrc = fs.readFileSync(path.join(ROOT, "src/bin/SancordApp.rs"), "utf8");

function createMockDom({ vw = 1280, vh = 720, hasTitlebar = true, titlebarHeight = 30 } = {}) {
  const docListeners = new Map();
  const winListeners = new Map();

  function makeElement(tag, id = "") {
    const attrs = new Map();
    const classes = new Set();
    const elListeners = new Map();
    const styleProps = new Map();
    let rect = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };

    const el = {
      tagName: String(tag || "DIV").toUpperCase(),
      id,
      title: "",
      disabled: false,
      textContent: "",
      dataset: {},
      parentElement: null,
      children: [],
      isConnected: true,
      _closestMap: new Map(),
      style: {
        left: "0px",
        top: "0px",
        setProperty(k, v) {
          styleProps.set(k, String(v));
        },
        getPropertyValue(k) {
          return styleProps.get(k) || "";
        },
      },
      classList: {
        add(...names) {
          for (const n of names) classes.add(n);
        },
        remove(...names) {
          for (const n of names) classes.delete(n);
        },
        contains(n) {
          return classes.has(n);
        },
        toggle(n, force) {
          const next = force !== undefined ? Boolean(force) : !classes.has(n);
          if (next) classes.add(n);
          else classes.delete(n);
          return next;
        },
      },
      hasAttribute(k) {
        return attrs.has(k);
      },
      getAttribute(k) {
        return attrs.has(k) ? attrs.get(k) : null;
      },
      setAttribute(k, v) {
        attrs.set(k, String(v));
        if (k === "id") el.id = String(v);
        if (k === "title") el.title = String(v);
      },
      removeAttribute(k) {
        attrs.delete(k);
        if (k === "title") el.title = "";
      },
      addEventListener(type, fn) {
        if (!elListeners.has(type)) elListeners.set(type, []);
        elListeners.get(type).push(fn);
      },
      dispatch(type, extra = {}) {
        const list = elListeners.get(type) || [];
        for (const fn of list) fn({ target: el, currentTarget: el, ...extra });
      },
      listenerCount(type) {
        return (elListeners.get(type) || []).length;
      },
      appendChild(child) {
        child.parentElement = el;
        child.isConnected = true;
        if (!el.children.includes(child)) el.children.push(child);
        return child;
      },
      remove() {
        el.isConnected = false;
        if (el.parentElement) {
          el.parentElement.children = el.parentElement.children.filter((c) => c !== el);
          el.parentElement = null;
        }
      },
      contains(other) {
        let cur = other;
        while (cur) {
          if (cur === el) return true;
          cur = cur.parentElement;
        }
        return false;
      },
      closest(sel) {
        if (el._closestMap.has(sel)) return el._closestMap.get(sel);
        for (const [k, v] of el._closestMap.entries()) {
          if (sel.includes(k)) return v;
        }
        if (
          sel.includes("[title]") ||
          sel.includes("[data-ui-tooltip]") ||
          sel.includes("[data-tooltip]")
        ) {
          if (el.title || el.dataset.uiTooltip || el.dataset.tooltip) return el;
        }
        return null;
      },
      setRect(r) {
        const left = r.left ?? 0;
        const top = r.top ?? 0;
        const width = r.width ?? 0;
        const height = r.height ?? 0;
        rect = {
          left,
          top,
          width,
          height,
          right: r.right ?? left + width,
          bottom: r.bottom ?? top + height,
        };
      },
      getBoundingClientRect() {
        if (el.className === "sancord-tooltip" && rect.width === 0 && rect.height === 0) {
          const w = Math.min(260, Math.max(64, String(el.textContent || "").length * 7 + 20));
          return { left: 0, top: 0, width: w, height: 32, right: w, bottom: 32 };
        }
        return { ...rect };
      },
    };
    return el;
  }

  const body = makeElement("BODY");
  const titlebar = makeElement("DIV", "sancord-native-titlebar");
  titlebar.setRect({ left: 0, top: 0, width: vw, height: titlebarHeight });
  if (hasTitlebar) body.appendChild(titlebar);

  const document = {
    body,
    documentElement: { clientWidth: vw, clientHeight: vh },
    activeElement: null,
    createElement: (tag) => makeElement(tag),
    getElementById(id) {
      if (id === "sancord-native-titlebar") return hasTitlebar ? titlebar : null;
      return body.children.find((c) => c.id === id) || null;
    },
    addEventListener(type, fn) {
      if (!docListeners.has(type)) docListeners.set(type, []);
      docListeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      if (!docListeners.has(type)) return;
      docListeners.set(
        type,
        docListeners.get(type).filter((f) => f !== fn)
      );
    },
    dispatch(type, event) {
      for (const fn of docListeners.get(type) || []) fn(event);
    },
  };

  const window = {
    innerWidth: vw,
    innerHeight: vh,
    document,
    getComputedStyle: () => ({ display: "block", visibility: "visible" }),
    addEventListener(type, fn) {
      if (!winListeners.has(type)) winListeners.set(type, []);
      winListeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      if (!winListeners.has(type)) return;
      winListeners.set(
        type,
        winListeners.get(type).filter((f) => f !== fn)
      );
    },
    dispatch(type, event = {}) {
      for (const fn of winListeners.get(type) || []) fn(event);
    },
  };

  const ctx = vm.createContext({
    window,
    document,
    console,
    setTimeout,
    clearTimeout,
    URL: { createObjectURL: () => "blob:test" },
    Blob: class {},
    atob: (s) => Buffer.from(s, "base64").toString("binary"),
  });
  vm.runInContext(`${uiKitSrc}\nthis.SancordUI = SancordUI;`, ctx);

  return { SancordUI: ctx.SancordUI, document, window, body, titlebar, makeElement };
}

test("hierarquia z-index garante tooltip acima da titlebar nativa e dos modais", () => {
  assert.match(uiCss, /--z-titlebar:\s*9000;/);
  assert.match(uiCss, /--z-tooltip:\s*110000;/);
  assert.match(uiCss, /body\s+#sancord-native-titlebar\s*\{[\s\S]*?z-index:\s*var\(--z-titlebar,\s*9000\)\s*!important;/);
  assert.match(stylesCss, /\.sancord-tooltip\s*\{[\s\S]*?z-index:\s*var\(--z-tooltip,\s*110000\);/);
  assert.match(rustAppSrc, /#sancord-native-titlebar\s*\{[\s\S]*?z-index:\s*var\(--z-titlebar,\s*9000\);/);
});

test("botão próximo à topbar faz flip automático de top para bottom sem ser coberto pela faixa superior", () => {
  const { SancordUI, makeElement, body } = createMockDom({ vw: 1280, vh: 720, hasTitlebar: true, titlebarHeight: 30 });
  const btn = makeElement("BUTTON");
  btn.setRect({ left: 600, top: 38, width: 32, height: 32 }); // logo abaixo da titlebar de 30px
  body.appendChild(btn);

  SancordUI.showTooltip(btn, "Mensagens Fixadas", "top");
  const tip = body.children.find((c) => c.className === "sancord-tooltip");
  assert.ok(tip, "tooltip deve ser montado no portal do document.body");
  assert.equal(tip.classList.contains("visible"), true);
  assert.equal(tip.dataset.side, "bottom", "deve inverter automaticamente para bottom quando não cabe acima por causa da topbar");
  const topPx = parseInt(tip.style.top, 10);
  assert.ok(topPx >= 70, `tooltip deve abrir abaixo do botão (top=${topPx}px >= 70px) e nunca dentro da faixa 0..30px da titlebar`);
});

test("ícones da barra lateral (.guild-rail) perto do topo abrem à direita, respeitam a topbar e ancoram a seta", () => {
  const { SancordUI, makeElement, body } = createMockDom({ vw: 1280, vh: 720, hasTitlebar: true, titlebarHeight: 30 });
  const homeBtn = makeElement("BUTTON");
  homeBtn._closestMap.set(".guild-rail, #guild-rail-list", true);
  homeBtn.setRect({ left: 12, top: 34, width: 48, height: 48 });
  body.appendChild(homeBtn);

  SancordUI.showTooltip(homeBtn, "Início Sanvo — Amigos e DMs");
  const tip = body.children.find((c) => c.className === "sancord-tooltip");
  assert.equal(tip.dataset.side, "right", "ícones da guild-rail devem abrir preferencialmente para a direita");
  const leftPx = parseInt(tip.style.left, 10);
  const topPx = parseInt(tip.style.top, 10);
  assert.ok(leftPx >= 68, `tooltip deve abrir à direita do ícone (left=${leftPx}px)`);
  assert.ok(topPx >= 40, `tooltip deve respeitar a margem de segurança abaixo da titlebar (top=${topPx}px >= 40px)`);
  const arrowY = parseInt(tip.style.getPropertyValue("--tooltip-arrow-y"), 10);
  assert.ok(arrowY >= 4 && arrowY <= 28, `seta vertical deve ficar ancorada ao centro do botão (arrowY=${arrowY}px)`);
});

test("clamp/shift horizontal perto das bordas esquerda e direita mantém o tooltip 100% visível e ajusta a seta", () => {
  const { SancordUI } = createMockDom({ vw: 800, vh: 600, hasTitlebar: true, titlebarHeight: 30 });
  const safe = SancordUI.getTooltipSafeBounds(10);

  // Perto da borda esquerda
  const leftPos = SancordUI.computeTooltipPosition(
    { left: 6, top: 200, right: 34, bottom: 228, width: 28, height: 28 },
    { width: 180, height: 32 },
    "top",
    safe,
    8
  );
  assert.equal(leftPos.side, "top");
  assert.ok(leftPos.x >= 10, `não pode sair pela esquerda (x=${leftPos.x})`);
  assert.ok(leftPos.arrowX < 90, `seta deve acompanhar o alvo à esquerda (arrowX=${leftPos.arrowX})`);

  // Perto da borda direita
  const rightPos = SancordUI.computeTooltipPosition(
    { left: 764, top: 200, right: 792, bottom: 228, width: 28, height: 28 },
    { width: 200, height: 32 },
    "top",
    safe,
    8
  );
  assert.equal(rightPos.side, "top");
  assert.ok(rightPos.x + 200 <= 790, `não pode sair pela direita (x+w=${rightPos.x + 200} <= 790)`);
  assert.ok(rightPos.arrowX > 100, `seta deve acompanhar o alvo à direita (arrowX=${rightPos.arrowX})`);
});

test("flip horizontal (right -> left e left -> right) e flip inferior (bottom -> top)", () => {
  const { SancordUI } = createMockDom({ vw: 800, vh: 600, hasTitlebar: true, titlebarHeight: 30 });
  const safe = SancordUI.getTooltipSafeBounds(10);

  // Preferência right na borda direita -> inverte para left
  const flipLeft = SancordUI.computeTooltipPosition(
    { left: 740, top: 250, right: 780, bottom: 290, width: 40, height: 40 },
    { width: 160, height: 32 },
    "right",
    safe,
    8
  );
  assert.equal(flipLeft.side, "left");
  assert.equal(flipLeft.flipped, true);
  assert.ok(flipLeft.x + 160 <= 740);

  // Preferência left na borda esquerda -> inverte para right
  const flipRight = SancordUI.computeTooltipPosition(
    { left: 14, top: 250, right: 54, bottom: 290, width: 40, height: 40 },
    { width: 160, height: 32 },
    "left",
    safe,
    8
  );
  assert.equal(flipRight.side, "right");
  assert.equal(flipRight.flipped, true);
  assert.ok(flipRight.x >= 54);

  // Preferência bottom na borda inferior -> inverte para top
  const flipTop = SancordUI.computeTooltipPosition(
    { left: 300, top: 555, right: 340, bottom: 585, width: 40, height: 30 },
    { width: 150, height: 32 },
    "bottom",
    safe,
    8
  );
  assert.equal(flipTop.side, "top");
  assert.equal(flipTop.flipped, true);
  assert.ok(flipTop.y + 32 <= 555);
});

test("scroll, resize e Escape atualizam ou ocultam o tooltip em portal sem acumular listeners duplicados", () => {
  const { SancordUI, document, window, makeElement, body } = createMockDom({ vw: 1280, vh: 720, hasTitlebar: true });
  const btn = makeElement("BUTTON");
  btn.setRect({ left: 400, top: 300, width: 40, height: 40 });
  body.appendChild(btn);

  // Chamadas repetidas de SancordUI.tooltip não devem empilhar listeners duplicados
  SancordUI.tooltip(btn, "Primeiro texto", "top");
  SancordUI.tooltip(btn, "Texto atualizado", "bottom");
  assert.equal(btn.listenerCount("mouseenter"), 1, "deve registrar apenas 1 listener de mouseenter");
  assert.equal(btn.getAttribute("aria-label"), "Texto atualizado");

  btn.dispatch("mouseenter");
  const tip = body.children.find((c) => c.className === "sancord-tooltip");
  assert.equal(tip.classList.contains("visible"), true);
  assert.equal(tip.textContent, "Texto atualizado");
  assert.equal(tip.dataset.side, "bottom");

  // Resize para janela pequena reposiciona automaticamente
  window.innerWidth = 440;
  window.innerHeight = 350;
  window.dispatch("resize");
  assert.equal(tip.dataset.side, "top", "após resize que reduz a altura útil abaixo do botão, deve inverter para top");

  // Scroll em qualquer container oculta o tooltip imediatamente
  document.dispatch("scroll", {});
  assert.equal(tip.classList.contains("visible"), false);
});
