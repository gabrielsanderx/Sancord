/**
 * SanvoCosmeticsVFX v5 — Motor Híbrido de Sprites Pintados WebP + Física 2D em Loop Único.
 *
 * Responsabilidades:
 *  - Preload e cache em memória dos sprites pintados HiDPI WebP (`/cosmetics/assets/fx_*.webp`);
 *  - Coreografia narrativa em 4 atos (`PLAY_ON_OPEN` / `ONE_SHOT`, 3.6s) para os 4 Profile Effects
 *    flagship (Astralium, Hanami, Glacium, Synth-Neko) com física direcional, inércia e parallax;
 *  - Coordenação automática com a Profile Frame (`.cos-effect-climax`) durante o clímax do efeito;
 *  - Micro-VFX secundários sutis para complementar as camadas pintadas das Avatar Decorations e
 *    Profile Frames (pétalas pintadas soltas, poeira estelar, refração glacial, faíscas cyber);
 *  - Independência de refresh rate (60/144/240 Hz via dt), pausa offscreen/janela inativa,
 *    0 canvases na MEMBER_LIST e modo hover-only em miniaturas MINI.
 */
(function initSanvoCosmeticsVFX(global) {
  const MAX_ACTIVE_VFX = 10;
  const instances = new Map();
  let rafId = null;
  let lastTs = 0;
  const canvasObserver = typeof IntersectionObserver === "function" ? new IntersectionObserver(entries => {
    for (const entry of entries) {
      const rec = instances.get(entry.target);
      if (rec) rec.visible = entry.isIntersecting && entry.intersectionRatio > 0;
    }
    kickLoop();
  }) : null;

  function unregisterCanvas(canvas) {
    canvasObserver?.unobserve(canvas);
    instances.delete(canvas);
  }

  const SPRITE_URLS = Object.freeze({
    petal: "/cosmetics/assets/fx_sakura_petal.webp",
    blossom: "/cosmetics/assets/fx_sakura_blossom.webp",
    crystal: "/cosmetics/assets/fx_frost_crystal.webp",
    comet: "/cosmetics/assets/fx_astral_comet.webp",
    prism: "/cosmetics/assets/fx_cyber_prism.webp",
    ember: "/cosmetics/assets/fx_infernal_ember.webp",
    flame: "/cosmetics/assets/fx_infernal_flame.webp",
    sigil: "/cosmetics/assets/fx_arcane_sigil.webp",
    rune: "/cosmetics/assets/fx_arcane_rune.webp",
    jelly: "/cosmetics/assets/fx_abyssal_jelly.webp",
    bubble: "/cosmetics/assets/fx_abyssal_bubble.webp",
    feather: "/cosmetics/assets/fx_seraph_feather.webp",
    seraphStar: "/cosmetics/assets/fx_seraph_star.webp",
  });

  const PRELOAD_ART_URLS = Object.freeze([
    "/cosmetics/assets/deco_astral_back.webp",
    "/cosmetics/assets/deco_astral_front.webp",
    "/cosmetics/assets/deco_sakura_back.webp",
    "/cosmetics/assets/deco_sakura_front.webp",
    "/cosmetics/assets/deco_frost_back.webp",
    "/cosmetics/assets/deco_frost_front.webp",
    "/cosmetics/assets/deco_cyber_back.webp",
    "/cosmetics/assets/deco_cyber_front.webp",
    "/cosmetics/assets/deco_cyber_blink.webp",
    "/cosmetics/assets/deco_infernal_back.webp",
    "/cosmetics/assets/deco_infernal_front.webp",
    "/cosmetics/assets/deco_arcane_back.webp",
    "/cosmetics/assets/deco_arcane_front.webp",
    "/cosmetics/assets/deco_abyssal_back.webp",
    "/cosmetics/assets/deco_abyssal_front.webp",
    "/cosmetics/assets/deco_seraph_back.webp",
    "/cosmetics/assets/deco_seraph_front.webp",
    "/cosmetics/assets/deco_sovereign_back.webp",
    "/cosmetics/assets/deco_sovereign_front.webp",
    "/cosmetics/assets/frame_astral_tl.webp",
    "/cosmetics/assets/frame_astral_tr.webp",
    "/cosmetics/assets/frame_astral_br.webp",
    "/cosmetics/assets/frame_sakura_tl.webp",
    "/cosmetics/assets/frame_sakura_tr.webp",
    "/cosmetics/assets/frame_sakura_br.webp",
    "/cosmetics/assets/frame_frost_tl.webp",
    "/cosmetics/assets/frame_frost_tr.webp",
    "/cosmetics/assets/frame_frost_br.webp",
    "/cosmetics/assets/frame_cyber_tl.webp",
    "/cosmetics/assets/frame_cyber_tr.webp",
    "/cosmetics/assets/frame_cyber_br.webp",
    "/cosmetics/assets/frame_infernal_tl.webp",
    "/cosmetics/assets/frame_infernal_tr.webp",
    "/cosmetics/assets/frame_infernal_br.webp",
    "/cosmetics/assets/frame_arcane_tl.webp",
    "/cosmetics/assets/frame_arcane_tr.webp",
    "/cosmetics/assets/frame_arcane_br.webp",
    "/cosmetics/assets/frame_abyssal_tl.webp",
    "/cosmetics/assets/frame_abyssal_tr.webp",
    "/cosmetics/assets/frame_abyssal_br.webp",
    "/cosmetics/assets/frame_seraph_tl.webp",
    "/cosmetics/assets/frame_seraph_tr.webp",
    "/cosmetics/assets/frame_seraph_br.webp",
    "/cosmetics/assets/frame_sovereign_tl.webp",
    "/cosmetics/assets/frame_sovereign_tr.webp",
    "/cosmetics/assets/frame_sovereign_br.webp",
  ]);

  const spriteCache = new Map();
  let preloaded = false;

  function loadImageCached(url) {
    if (typeof Image === "undefined") return null;
    if (typeof navigator !== "undefined" && /jsdom/i.test(navigator.userAgent || "")) return null;
    if (spriteCache.has(url)) return spriteCache.get(url);
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    spriteCache.set(url, img);
    return img;
  }

  function getSprite(key) {
    const url = SPRITE_URLS[key];
    if (!url) return null;
    const img = loadImageCached(url);
    return img && img.complete && img.naturalWidth > 0 ? img : null;
  }

  function preloadAssets() {
    if (preloaded) return;
    preloaded = true;
    for (const url of Object.values(SPRITE_URLS)) loadImageCached(url);
    for (const url of PRELOAD_ART_URLS) loadImageCached(url);
  }

  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const smoothstep = (a, b, x) => {
    const t = clamp01((x - a) / (b - a || 1));
    return t * t * (3 - 2 * t);
  };
  const easeOutCubic = (t) => 1 - Math.pow(1 - clamp01(t), 3);

  function hashSeed(str) {
    let h = 2166136261 >>> 0;
    const s = String(str || "sanvo");
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  function prng(seed, idx) {
    let x = (seed + Math.imul(idx + 1, 374761393)) >>> 0;
    x = Math.imul(x ^ (x >>> 13), 1274126177) >>> 0;
    return ((x ^ (x >>> 16)) >>> 0) / 4294967295;
  }

  function isReducedMotion() {
    if (typeof document === "undefined" || !document.body) return false;
    return document.body.classList.contains("reduce-motion") || document.body.classList.contains("anim-policy-never");
  }

  function isWindowActive() {
    if (typeof document === "undefined") return true;
    if (document.hidden || document.documentElement.classList.contains("visual-window-hidden")) return false;
    return !document.body?.classList?.contains("profile-window-inactive");
  }

  function resolveDensity(host) {
    if (!host) return 1.0;
    if (host.closest?.(".members-sidebar, .member-item")) return 0;
    if (host.closest?.(".pe-choice, .cosmetic-choice")) return 0.55;
    if (host.closest?.(".self-profile-menu")) return 0.65;
    if (host.closest?.("#compact-profile-modal, .compact-profile-dialog")) return 0.85;
    return 1.0;
  }

  function isMiniHoveredOrSelected(host) {
    const btn = host?.closest?.(".pe-choice, .cosmetic-choice");
    if (!btn) return true;
    return btn.matches?.(":hover, :focus-within, .selected") || false;
  }

  function syncCanvasSize(rec) {
    const { canvas } = rec;
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(0, Math.round(rect.width));
    const h = Math.max(0, Math.round(rect.height));
    if (w < 8 || h < 8) return false;
    const dpr = Math.min(2, (typeof window !== "undefined" ? window.devicePixelRatio : 1) || 1);
    const pw = Math.round(w * dpr);
    const ph = Math.round(h * dpr);
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
    }
    rec.w = w;
    rec.h = h;
    rec.dpr = dpr;
    if (rec.ctx) rec.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return true;
  }

  function drawSpark(ctx, x, y, r, color, alpha, rot = 0) {
    if (alpha <= 0.01 || r <= 0.2) return;
    ctx.save();
    ctx.translate(x, y);
    if (rot) ctx.rotate(rot);
    ctx.globalAlpha = clamp01(alpha);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 2.4);
    g.addColorStop(0, "#ffffff");
    g.addColorStop(0.32, color);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, r * 2.4, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    const ir = r * 0.22;
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      const rad = i % 2 === 0 ? r : ir;
      if (i === 0) ctx.moveTo(Math.cos(a) * rad, Math.sin(a) * rad);
      else ctx.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawSprite(ctx, img, x, y, size, rot, alpha, scaleX = 1, scaleY = 1) {
    if (!img || alpha <= 0.01 || size <= 1) return;
    ctx.save();
    ctx.translate(x, y);
    if (rot) ctx.rotate(rot);
    if (scaleX !== 1 || scaleY !== 1) ctx.scale(scaleX, scaleY);
    ctx.globalAlpha = clamp01(alpha);
    ctx.drawImage(img, -size * 0.5, -size * 0.5, size, size);
    ctx.restore();
  }

  // ============================================================================
  // 1. AVATAR SECONDARY VFX (complementa as camadas pintadas WebP, sem poluir!)
  // ============================================================================
  function renderAvatarVfx(ctx, w, h, id, depth, t, seed, density) {
    ctx.clearRect(0, 0, w, h);
    const cx = w * 0.5;
    const cy = h * 0.5;
    const R = Math.min(w, h) * 0.35;
    const isFront = depth === "front";

    if (id === "galaxy-portal") {
      // Poeira estelar + cometa ocasional orbitando atrás -> frente
      const count = Math.max(4, Math.round(9 * density));
      for (let i = 0; i < count; i++) {
        const speed = 0.22 + prng(seed, i) * 0.26;
        const phase = prng(seed, i + 20) * Math.PI * 2;
        const ang = t * speed + phase;
        const z = Math.sin(ang);
        if ((isFront && z < 0) || (!isFront && z >= 0)) continue;
        const rx = R * (1.06 + prng(seed, i + 40) * 0.16);
        const ry = rx * 0.44;
        const lx = Math.cos(ang) * rx;
        const ly = Math.sin(ang) * ry;
        const tilt = -0.42;
        const x = cx + lx * Math.cos(tilt) - ly * Math.sin(tilt);
        const y = cy + lx * Math.sin(tilt) + ly * Math.cos(tilt);
        const tw = 0.45 + 0.55 * Math.sin(t * 2.6 + i * 1.7);
        drawSpark(ctx, x, y, (1.8 + prng(seed, i + 60) * 2.6) * (0.75 + 0.35 * Math.abs(z)), i % 2 === 0 ? "#fde68a" : "#93c5fd", tw * 0.85, t * 0.6);
      }
      // Evento secundário a cada ~11s: cometa pintado cruza na frente
      if (isFront) {
        const cycle = t % 11.4;
        if (cycle < 1.35) {
          const p = cycle / 1.35;
          const ease = easeOutCubic(p);
          const x = cx - R * 1.1 + ease * R * 2.35;
          const y = cy - R * 0.88 + ease * R * 0.92;
          const alpha = Math.sin(p * Math.PI);
          const comet = getSprite("comet");
          if (comet) drawSprite(ctx, comet, x, y, R * 0.72, 0.38, alpha * 0.92);
          else drawSpark(ctx, x, y, 5, "#fde68a", alpha);
        }
      }
      return;
    }

    if (id === "sakura-glow") {
      if (!isFront) return;
      // Pétalas pintadas WebP se soltando do ramo superior com gravidade e balanço 3D
      const petalImg = getSprite("petal");
      const count = Math.max(2, Math.round(5 * density));
      for (let i = 0; i < count; i++) {
        const dur = 5.4 + prng(seed, i) * 3.2;
        const lt = ((t + prng(seed, i + 10) * dur) % dur) / dur;
        const startX = cx - R * 0.65 + prng(seed, i + 25) * R * 1.35;
        const startY = cy - R * 0.98 + prng(seed, i + 35) * R * 0.35;
        const x = startX + Math.sin(lt * Math.PI * 2 + i) * R * 0.32 + lt * R * 0.42;
        const y = startY + lt * R * 2.15;
        const alpha = smoothstep(0, 0.14, lt) * (1 - smoothstep(0.75, 1, lt)) * 0.92;
        const sz = R * (0.19 + prng(seed, i + 45) * 0.1);
        const tilt = Math.max(0.32, Math.abs(Math.cos(lt * 5.2 + i)));
        if (petalImg) {
          drawSprite(ctx, petalImg, x, y, sz, lt * 2.8 + i, alpha, 1, tilt);
        } else {
          drawSpark(ctx, x, y, 2.6, "#fbcfe8", alpha);
        }
      }
      return;
    }

    if (id === "frost-crown") {
      // Micro-flocos cristalinos e brilhos refrativos nas pontas dos cristais
      const count = Math.max(3, Math.round(7 * density));
      for (let i = 0; i < count; i++) {
        if ((i % 2 === 0) !== isFront) continue;
        const dur = 4.6 + prng(seed, i) * 3.0;
        const lt = ((t + prng(seed, i + 12) * dur) % dur) / dur;
        const ang = -Math.PI * 0.85 + prng(seed, i + 22) * Math.PI * 1.7;
        const dist = R * (0.98 + lt * 0.32);
        const x = cx + Math.cos(ang) * dist + Math.sin(t * 1.5 + i) * 3;
        const y = cy + Math.sin(ang) * dist - lt * R * 0.25;
        const alpha = Math.sin(lt * Math.PI) * 0.88;
        drawSpark(ctx, x, y, 2.0 + prng(seed, i + 32) * 2.4, "#7dd3fc", alpha, t * 0.5 + i);
      }
      return;
    }

    if (id === "cat-gamer") {
      // Faíscas holográficas sutis perto dos fones e da ponta da cauda energética
      if (!isFront) {
        const pulse = 0.5 + 0.5 * Math.sin(t * 2.4);
        drawSpark(ctx, cx + R * 1.18, cy - R * 0.72, 4.5 + pulse * 2.5, "#f472b6", 0.5 + pulse * 0.45, t);
        return;
      }
      const count = Math.max(2, Math.round(4 * density));
      for (let i = 0; i < count; i++) {
        const dur = 3.6 + prng(seed, i) * 2.4;
        const lt = ((t + prng(seed, i + 15) * dur) % dur) / dur;
        const side = i % 2 === 0 ? -1 : 1;
        const x = cx + side * R * (0.55 + lt * 0.45);
        const y = cy - R * (0.85 + lt * 0.35);
        const alpha = Math.sin(lt * Math.PI) * 0.82;
        drawSpark(ctx, x, y, 2.2 + prng(seed, i + 25) * 2.0, side < 0 ? "#38e8ff" : "#f43f9e", alpha, t * 1.4);
      }
      return;
    }

    if (id === "dragon-fire") {
      // Brasas vivas subindo das chamas laterais com turbulência térmica
      const emberImg = getSprite("ember");
      const count = Math.max(4, Math.round(9 * density));
      for (let i = 0; i < count; i++) {
        if ((i % 2 === 0) !== isFront) continue;
        const dur = 3.2 + prng(seed, i) * 2.4;
        const lt = ((t + prng(seed, i + 12) * dur) % dur) / dur;
        const side = i % 3 === 0 ? 0 : (i % 2 === 0 ? -1 : 1);
        const x = cx + side * R * (0.78 + prng(seed, i + 20) * 0.32) + Math.sin(lt * 7 + i) * 6;
        const y = cy + R * 0.95 - lt * R * 2.1;
        const alpha = smoothstep(0, 0.16, lt) * (1 - smoothstep(0.68, 1, lt)) * 0.92;
        if (emberImg && i % 3 === 0) drawSprite(ctx, emberImg, x, y, R * 0.2, lt * 3 + i, alpha);
        else drawSpark(ctx, x, y, 2.0 + prng(seed, i + 30) * 2.6, i % 2 === 0 ? "#fb923c" : "#fef08a", alpha, t * 1.5);
      }
      return;
    }

    if (id === "blood-moon") {
      // Runas ametista e estrelas carmesim em órbita inclinada 3D
      const runeImg = getSprite("rune");
      const count = Math.max(4, Math.round(8 * density));
      for (let i = 0; i < count; i++) {
        const speed = 0.26 + prng(seed, i) * 0.22;
        const ang = t * speed + prng(seed, i + 18) * Math.PI * 2;
        const z = Math.sin(ang);
        if ((isFront && z < 0) || (!isFront && z >= 0)) continue;
        const rx = R * (1.08 + prng(seed, i + 32) * 0.16);
        const ry = rx * 0.42;
        const lx = Math.cos(ang) * rx;
        const ly = Math.sin(ang) * ry;
        const tilt = 0.35;
        const x = cx + lx * Math.cos(tilt) - ly * Math.sin(tilt);
        const y = cy + lx * Math.sin(tilt) + ly * Math.cos(tilt);
        const tw = 0.45 + 0.55 * Math.sin(t * 2.4 + i);
        if (runeImg && i === 0) drawSprite(ctx, runeImg, x, y, R * 0.28, t * 0.6, tw * 0.9);
        else drawSpark(ctx, x, y, 2.0 + prng(seed, i + 50) * 2.4, i % 2 === 0 ? "#e879f9" : "#fb7185", tw * 0.88, t);
      }
      return;
    }

    if (id === "ocean-bubbles") {
      // Bolhas iridescentes subindo ao redor do avatar com brilho bioluminescente
      const bubbleImg = getSprite("bubble");
      const count = Math.max(3, Math.round(7 * density));
      for (let i = 0; i < count; i++) {
        if ((i % 2 === 0) !== isFront) continue;
        const dur = 4.6 + prng(seed, i) * 3.2;
        const lt = ((t + prng(seed, i + 14) * dur) % dur) / dur;
        const x = cx + (prng(seed, i + 26) - 0.5) * R * 2.3 + Math.sin(lt * 5.5 + i) * 7;
        const y = cy + R * 1.15 - lt * R * 2.35;
        const alpha = smoothstep(0, 0.15, lt) * (1 - smoothstep(0.75, 1, lt)) * 0.88;
        if (bubbleImg) drawSprite(ctx, bubbleImg, x, y, R * (0.14 + prng(seed, i + 40) * 0.12), 0, alpha);
        else drawSpark(ctx, x, y, 2.2, "#67e8f9", alpha);
      }
      return;
    }

    if (id === "angel-wings") {
      // Plumas douradas caindo lentamente + cintilação solar
      const featherImg = getSprite("feather");
      const count = Math.max(3, Math.round(6 * density));
      for (let i = 0; i < count; i++) {
        if ((i % 2 === 0) !== isFront) continue;
        const dur = 5.8 + prng(seed, i) * 3.0;
        const lt = ((t + prng(seed, i + 10) * dur) % dur) / dur;
        const x = cx + (prng(seed, i + 22) - 0.5) * R * 2.2 + Math.sin(lt * Math.PI * 2 + i) * 14;
        const y = cy - R * 1.1 + lt * R * 2.2;
        const alpha = smoothstep(0, 0.18, lt) * (1 - smoothstep(0.74, 1, lt)) * 0.9;
        if (featherImg && i < 3) drawSprite(ctx, featherImg, x, y, R * 0.28, Math.sin(lt * 5 + i) * 0.5, alpha);
        else drawSpark(ctx, x, y, 2.4, "#fde68a", alpha, t * 0.6);
      }
      return;
    }

    if (id === "eclipse-sovereign") {
      // Centelhas imperiais de ouro e rubi orbitando a coroa
      const count = Math.max(4, Math.round(8 * density));
      for (let i = 0; i < count; i++) {
        const ang = t * (0.3 + prng(seed, i) * 0.2) + prng(seed, i + 16) * Math.PI * 2;
        const z = Math.sin(ang);
        if ((isFront && z < 0) || (!isFront && z >= 0)) continue;
        const x = cx + Math.cos(ang) * R * 1.12;
        const y = cy + Math.sin(ang) * R * 0.68 - R * 0.12;
        const tw = 0.5 + 0.5 * Math.sin(t * 3.2 + i * 1.9);
        drawSpark(ctx, x, y, 2.2 + prng(seed, i + 32) * 2.6, i % 2 === 0 ? "#fde047" : "#fb7185", tw * 0.92, t * 0.8);
      }
    }
  }

  // ============================================================================
  // 2. PROFILE FRAME AMBIENT VFX (perimetral, discreto, nunca cobre conteúdo!)
  // ============================================================================
  function renderFrameVfx(ctx, w, h, id, t, seed, density, host) {
    ctx.clearRect(0, 0, w, h);
    const dim = host?.classList?.contains("cos-effect-climax") ? 0.35 : 1;
    const bannerH = Math.min(135, Math.max(76, h * 0.24));

    if (id === "cosmic-drift" || id === "founder" || id === "early-user") {
      const n = Math.max(4, Math.round(9 * density));
      for (let i = 0; i < n; i++) {
        const x = prng(seed, i + 1) * w;
        const y = 8 + prng(seed, i + 11) * (bannerH * 0.82);
        const tw = 0.3 + 0.7 * Math.pow(0.5 + 0.5 * Math.sin(t * (1.4 + prng(seed, i + 21) * 1.4) + i * 2.1), 2);
        drawSpark(ctx, x, y, 1.8 + prng(seed, i + 31) * 2.8, id === "founder" ? "#fbbf24" : i % 2 ? "#93c5fd" : "#fde68a", tw * 0.82 * dim, t * 0.4);
      }
      return;
    }

    if (id === "sakura-wind") {
      // 3 pétalas pintadas lentas escorrendo pela lateral direita do card
      const petalImg = getSprite("petal");
      const n = Math.max(2, Math.round(4 * density));
      for (let i = 0; i < n; i++) {
        const dur = 7.5 + prng(seed, i) * 4.0;
        const lt = ((t + prng(seed, i + 10) * dur) % dur) / dur;
        const x = w - 18 - prng(seed, i + 20) * 52 + Math.sin(lt * 5 + i) * 14;
        const y = 18 + lt * (h - 48);
        const alpha = smoothstep(0, 0.12, lt) * (1 - smoothstep(0.8, 1, lt)) * 0.75 * dim;
        if (petalImg) drawSprite(ctx, petalImg, x, y, 13 + prng(seed, i + 30) * 6, lt * 3.4 + i, alpha, 1, Math.max(0.35, Math.abs(Math.cos(lt * 6 + i))));
      }
      return;
    }

    if (id === "frost-glint" || id === "winter-2026") {
      const n = Math.max(4, Math.round(8 * density));
      for (let i = 0; i < n; i++) {
        const dur = 6.5 + prng(seed, i) * 4;
        const lt = ((t + prng(seed, i + 10) * dur) % dur) / dur;
        const edgeX = i % 2 === 0 ? 12 + prng(seed, i + 20) * 44 : w - 12 - prng(seed, i + 20) * 44;
        const x = edgeX + Math.sin(lt * 4 + i) * 8;
        const y = 12 + lt * (bannerH + 60);
        const alpha = Math.sin(lt * Math.PI) * 0.78 * dim;
        drawSpark(ctx, x, y, 1.8 + prng(seed, i + 30) * 2.2, "#bae6fd", alpha, t * 0.6 + i);
      }
      return;
    }

    if (id === "holographic" || id === "developer") {
      // Varredura especular sutil no topo do banner + micro-pulso HUD
      const color = id === "developer" ? "#34d399" : "#38e8ff";
      const cycle = (t % 7.5) / 7.5;
      if (cycle < 0.28) {
        const p = cycle / 0.28;
        const sx = -40 + p * (w + 80);
        const g = ctx.createLinearGradient(sx - 35, 0, sx + 35, 0);
        g.addColorStop(0, "rgba(0,0,0,0)");
        g.addColorStop(0.5, id === "developer" ? "rgba(52,211,153,0.18)" : "rgba(56,232,255,0.2)");
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.save();
        ctx.globalAlpha = dim;
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, 5);
        ctx.restore();
      }
      drawSpark(ctx, w - 26, 26, 2.5 + 1.5 * Math.sin(t * 3.2), color, 0.72 * dim, 0);
      return;
    }

    if (id === "ember-trail") {
      const n = Math.max(4, Math.round(8 * density));
      for (let i = 0; i < n; i++) {
        const dur = 4.5 + prng(seed, i) * 3.2;
        const lt = ((t + prng(seed, i + 10) * dur) % dur) / dur;
        const edgeX = i % 2 === 0 ? 12 + prng(seed, i + 20) * 52 : w - 12 - prng(seed, i + 20) * 52;
        const x = edgeX + Math.sin(lt * 6 + i) * 8;
        const y = h - 18 - lt * (h * 0.55);
        const alpha = Math.sin(lt * Math.PI) * 0.82 * dim;
        drawSpark(ctx, x, y, 1.8 + prng(seed, i + 30) * 2.6, i % 2 === 0 ? "#fb923c" : "#fef08a", alpha, t);
      }
      return;
    }

    if (id === "arcane-grimoire" || id === "sovereign-crest") {
      const n = Math.max(4, Math.round(9 * density));
      const c1 = id === "sovereign-crest" ? "#fb7185" : "#e879f9";
      const c2 = "#fde68a";
      for (let i = 0; i < n; i++) {
        const x = 14 + prng(seed, i + 2) * (w - 28);
        const y = 10 + prng(seed, i + 14) * (bannerH * 0.85);
        const tw = 0.35 + 0.65 * Math.pow(0.5 + 0.5 * Math.sin(t * (1.8 + prng(seed, i + 24)) + i * 2), 2);
        drawSpark(ctx, x, y, 2.0 + prng(seed, i + 34) * 2.8, i % 2 === 0 ? c1 : c2, tw * 0.85 * dim, t * 0.5);
      }
      return;
    }

    if (id === "liquid") {
      const bubbleImg = getSprite("bubble");
      const n = Math.max(3, Math.round(6 * density));
      for (let i = 0; i < n; i++) {
        const dur = 6.5 + prng(seed, i) * 4;
        const lt = ((t + prng(seed, i + 10) * dur) % dur) / dur;
        const x = (i % 2 === 0 ? 18 + prng(seed, i + 20) * 44 : w - 18 - prng(seed, i + 20) * 44) + Math.sin(lt * 4 + i) * 10;
        const y = h - 20 - lt * (h - 40);
        const alpha = Math.sin(lt * Math.PI) * 0.72 * dim;
        if (bubbleImg) drawSprite(ctx, bubbleImg, x, y, 10 + prng(seed, i + 30) * 8, 0, alpha);
        else drawSpark(ctx, x, y, 2, "#67e8f9", alpha);
      }
      return;
    }

    if (id === "seraphim-arch") {
      const featherImg = getSprite("feather");
      const n = Math.max(2, Math.round(4 * density));
      for (let i = 0; i < n; i++) {
        const dur = 8.0 + prng(seed, i) * 3.5;
        const lt = ((t + prng(seed, i + 10) * dur) % dur) / dur;
        const x = w - 20 - prng(seed, i + 20) * 60 + Math.sin(lt * 4.5 + i) * 16;
        const y = 16 + lt * (h - 48);
        const alpha = smoothstep(0, 0.14, lt) * (1 - smoothstep(0.8, 1, lt)) * 0.78 * dim;
        if (featherImg) drawSprite(ctx, featherImg, x, y, 18 + prng(seed, i + 30) * 8, Math.sin(lt * 4 + i) * 0.45, alpha);
      }
    }
  }

  // ============================================================================
  // 3. PROFILE EFFECTS NARRATIVOS EM 4 ATOS (PLAY_ON_OPEN / ONE_SHOT, 3.6s)
  //    Com sprites WebP pintados + física direcional + coordenação de moldura!
  // ============================================================================
  function renderProfileEffectVfx(ctx, w, h, id, p, seed) {
    ctx.clearRect(0, 0, w, h);
    if (p <= 0 || p >= 1) return;

    // Envelope cinematográfico: entrada suave -> clímax -> desaceleração & dissipação limpa
    const intro = smoothstep(0.0, 0.14, p);
    const outro = 1 - smoothstep(0.76, 1.0, p);
    const env = intro * outro;
    const climax = Math.sin(smoothstep(0.32, 0.78, p) * Math.PI);

    if (id === "star-trail") {
      // ECLIPSE DA NEBULOSA:
      // Ato 1: véu cósmico nasce no topo; Ato 2: 2 cometas pintados cruzam em diagonal com parallax;
      // Ato 3: pulso estelar no topo do perfil; Ato 4: poeira desacelera e some limpo.
      const wash = ctx.createRadialGradient(w * 0.52, h * 0.2, 8, w * 0.52, h * 0.22, w * 0.85);
      wash.addColorStop(0, `rgba(129, 140, 248, ${(0.24 * climax * env).toFixed(3)})`);
      wash.addColorStop(0.55, `rgba(168, 85, 247, ${(0.12 * env).toFixed(3)})`);
      wash.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = wash;
      ctx.fillRect(0, 0, w, h);

      // Cometa herói pintado cruzando esquerda-topo -> direita-meio
      const comet = getSprite("comet");
      const c1 = smoothstep(0.08, 0.68, p);
      if (c1 > 0 && c1 < 1) {
        const ease = easeOutCubic(c1);
        const cx = -60 + ease * (w + 140);
        const cy = h * 0.08 + ease * h * 0.34 - Math.sin(c1 * Math.PI) * 28;
        const a = Math.sin(c1 * Math.PI);
        if (comet) drawSprite(ctx, comet, cx, cy, Math.min(138, w * 0.38), 0.34, a * 0.95);
        else drawSpark(ctx, cx, cy, 10, "#fde68a", a);
      }
      // Segundo cometa menor em profundidade oposta (parallax!)
      const c2 = smoothstep(0.28, 0.84, p);
      if (c2 > 0 && c2 < 1) {
        const ease = easeOutCubic(c2);
        const cx = w + 40 - ease * (w + 110);
        const cy = h * 0.14 + ease * h * 0.42;
        const a = Math.sin(c2 * Math.PI) * 0.78;
        if (comet) drawSprite(ctx, comet, cx, cy, Math.min(88, w * 0.24), Math.PI - 0.4, a);
      }
      // Campo de constelação surgindo e apagando com inércia
      for (let i = 0; i < 24; i++) {
        const sx = prng(seed, i) * w;
        const sy = prng(seed, i + 30) * h * 0.68;
        const st = smoothstep(0.06 + prng(seed, i + 60) * 0.35, 0.96, p);
        const a = Math.sin(st * Math.PI) * (0.45 + 0.55 * prng(seed, i + 90));
        drawSpark(ctx, sx, sy + st * 14, 1.8 + prng(seed, i + 120) * 3.4, i % 3 === 0 ? "#fde68a" : "#93c5fd", a, p * 2.2 + i);
      }
      return;
    }

    if (id === "petal-drift") {
      // RAJADA DE CEREJEIRA:
      // Ato 1: brisa suave entra pela esquerda; Ato 2: pétalas pintadas em 2 camadas (fundo + frente)
      // atravessam em curva S; Ato 3: flor de sakura herói gira e desacelera; Ato 4: poucas pétalas caem limpo.
      const petalImg = getSprite("petal");
      const blossomImg = getSprite("blossom");

      // Faixa de brisa translúcida direcional
      const wind = smoothstep(0.05, 0.62, p);
      if (wind > 0 && wind < 1) {
        ctx.save();
        ctx.globalAlpha = Math.sin(wind * Math.PI) * 0.26;
        ctx.strokeStyle = "#fbcfe8";
        ctx.lineWidth = 2.5;
        for (let r = 0; r < 3; r++) {
          ctx.beginPath();
          const baseY = h * (0.14 + r * 0.14);
          for (let s = 0; s <= 18; s++) {
            const frac = s / 18;
            const px = -30 + (wind * 0.85 + frac * 0.55 - 0.2) * (w + 60);
            const py = baseY + Math.sin(frac * Math.PI * 2 + r) * 22 + frac * 34;
            if (s === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
          }
          ctx.stroke();
        }
        ctx.restore();
      }

      // 22 pétalas pintadas em 2 planos de parallax (longe + perto)
      for (let i = 0; i < 22; i++) {
        const start = prng(seed, i) * 0.36;
        const dur = 0.48 + prng(seed, i + 30) * 0.22;
        const lt = clamp01((p - start) / dur);
        if (lt <= 0 || lt >= 1) continue;
        const depthScale = i < 10 ? 0.62 : 1.05;
        const ease = easeOutCubic(lt);
        const x = -28 + ease * (w + 76) * (0.8 + prng(seed, i + 60) * 0.35);
        const y = h * (0.04 + prng(seed, i + 90) * 0.42) + lt * h * 0.44 + Math.sin(lt * 7.5 + i) * 18;
        const a = smoothstep(0, 0.12, lt) * (1 - smoothstep(0.75, 1, lt)) * (i < 10 ? 0.58 : 0.94);
        const sz = (16 + prng(seed, i + 120) * 14) * depthScale;
        const tilt = Math.max(0.3, Math.abs(Math.cos(lt * 6 + i)));
        if (petalImg) drawSprite(ctx, petalImg, x, y, sz, lt * 4.4 + i, a, 1, tilt);
        else drawSpark(ctx, x, y, 3, "#f9a8d4", a);
      }

      // Flor de sakura herói entrando no clímax e desacelerando suavemente
      const hero = smoothstep(0.18, 0.88, p);
      if (hero > 0 && hero < 1 && blossomImg) {
        const ease = easeOutCubic(hero);
        const hx = w * 0.14 + ease * w * 0.68;
        const hy = h * 0.16 + Math.sin(hero * Math.PI) * 32 + ease * 42;
        const a = smoothstep(0, 0.18, hero) * (1 - smoothstep(0.74, 1, hero)) * 0.92;
        drawSprite(ctx, blossomImg, hx, hy, Math.min(72, w * 0.2), ease * 1.45, a);
      }
      return;
    }

    if (id === "polar-ribbon") {
      // TEMPESTADE POLAR:
      // Ato 1: aurora fria nasce no topo; Ato 2: cristais de gelo pintados rasgam em arco diagonal;
      // Ato 3: brilho prismático frio no topo; Ato 4: cristais desaceleram e evaporam em névoa.
      const crysImg = getSprite("crystal");

      // Cortina boreal no topo
      ctx.save();
      const aur = ctx.createLinearGradient(0, 0, w, h * 0.42);
      aur.addColorStop(0, `rgba(56, 189, 248, ${(0.28 * env).toFixed(3)})`);
      aur.addColorStop(0.5, `rgba(186, 230, 253, ${(0.24 * climax * env).toFixed(3)})`);
      aur.addColorStop(1, `rgba(99, 102, 241, ${(0.18 * env).toFixed(3)})`);
      ctx.fillStyle = aur;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(w, 0);
      for (let x = w; x >= 0; x -= 20) {
        const wave = Math.sin(x * 0.02 + p * 7.5) * 18 + Math.cos(x * 0.035 - p * 5) * 10;
        ctx.lineTo(x, h * (0.24 + 0.1 * climax) + wave);
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      // Cristais pintados em voo direcional (com desaceleração suave)
      for (let i = 0; i < 12; i++) {
        const start = prng(seed, i) * 0.34;
        const lt = clamp01((p - start) / 0.56);
        if (lt <= 0 || lt >= 1) continue;
        const ease = easeOutCubic(lt);
        const fromLeft = i % 2 === 0;
        const x = fromLeft ? -20 + ease * (w * 0.72 + prng(seed, i + 20) * w * 0.35) : w + 20 - ease * (w * 0.72 + prng(seed, i + 20) * w * 0.35);
        const y = h * (0.06 + prng(seed, i + 40) * 0.36) + ease * h * 0.24;
        const a = smoothstep(0, 0.16, lt) * (1 - smoothstep(0.72, 1, lt)) * 0.9;
        const sz = 22 + prng(seed, i + 60) * 26;
        if (crysImg) drawSprite(ctx, crysImg, x, y, sz, (fromLeft ? 1.1 : -1.1) + lt * 0.6, a);
        else drawSpark(ctx, x, y, 4, "#bae6fd", a);
      }
      for (let i = 0; i < 18; i++) {
        const sx = prng(seed, i + 100) * w;
        const sy = prng(seed, i + 130) * h * 0.65 + p * 30;
        drawSpark(ctx, sx, sy, 2 + prng(seed, i + 160) * 2.5, "#e0f2fe", env * (0.4 + 0.6 * Math.sin(p * 10 + i)), p * 2);
      }
      return;
    }

    if (id === "circuit-boot") {
      // INICIALIZAÇÃO HOLOGRÁFICA:
      // Ato 1: linha de scan desce do topo; Ato 2: prismas holográficos pintados se projetam dos cantos;
      // Ato 3: pulso ciano-magenta sincronizado; Ato 4: retração elástica limpa.
      const prismImg = getSprite("prism");
      const scanP = smoothstep(0.02, 0.56, p);
      if (scanP > 0 && scanP < 1) {
        const sy = scanP * h * 0.92;
        const g = ctx.createLinearGradient(0, sy - 24, 0, sy + 24);
        g.addColorStop(0, "rgba(56,232,255,0)");
        g.addColorStop(0.5, `rgba(56,232,255,${(0.45 * (1 - scanP * 0.6)).toFixed(3)})`);
        g.addColorStop(1, "rgba(244,63,158,0)");
        ctx.fillStyle = g;
        ctx.fillRect(0, sy - 24, w, 48);
        ctx.fillStyle = `rgba(255,255,255,${(0.75 * Math.sin(scanP * Math.PI)).toFixed(3)})`;
        ctx.fillRect(0, sy, w, 2);
      }

      // Prismas pintados projetando-se dos cantos com parallax
      for (let i = 0; i < 10; i++) {
        const start = 0.08 + prng(seed, i) * 0.28;
        const lt = clamp01((p - start) / 0.58);
        if (lt <= 0 || lt >= 1) continue;
        const ease = easeOutCubic(lt);
        const side = i % 2 === 0 ? 1 : -1;
        const x = (side > 0 ? 18 : w - 18) + side * ease * (w * 0.28 + prng(seed, i + 25) * w * 0.3);
        const y = h * (0.1 + prng(seed, i + 50) * 0.52) - ease * 26;
        const a = smoothstep(0, 0.16, lt) * (1 - smoothstep(0.72, 1, lt)) * 0.9;
        const sz = 24 + prng(seed, i + 75) * 28;
        if (prismImg) drawSprite(ctx, prismImg, x, y, sz, side * 0.35 + lt * 0.9, a);
        else drawSpark(ctx, x, y, 4, side > 0 ? "#38e8ff" : "#f43f9e", a);
      }
      // Pulso central de sincronização no clímax
      if (climax > 0.02) {
        ctx.save();
        ctx.strokeStyle = `rgba(244, 63, 158, ${(climax * 0.42 * env).toFixed(3)})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(w * 0.5, h * 0.26, 20 + smoothstep(0.28, 0.85, p) * w * 0.52, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
      return;
    }

    if (id === "embers") {
      // ERUPÇÃO DE BRASAS (4 atos):
      // Ato 1: calor vulcânico nasce na base; Ato 2: labaredas pintadas sobem em diagonal;
      // Ato 3: estilhaços de magma cruzam no clímax; Ato 4: cinzas douradas desaceleram e apagam.
      const emberImg = getSprite("ember");
      const flameImg = getSprite("flame");
      const heat = ctx.createLinearGradient(0, h, 0, h * 0.2);
      heat.addColorStop(0, `rgba(234, 88, 12, ${(0.28 * climax * env).toFixed(3)})`);
      heat.addColorStop(0.55, `rgba(153, 27, 27, ${(0.14 * env).toFixed(3)})`);
      heat.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = heat;
      ctx.fillRect(0, 0, w, h);

      for (let i = 0; i < 6; i++) {
        const start = i * 0.06;
        const lt = clamp01((p - start) / 0.58);
        if (lt <= 0 || lt >= 1 || !flameImg) continue;
        const ease = easeOutCubic(lt);
        const x = w * (0.12 + prng(seed, i) * 0.76) + Math.sin(lt * 5 + i) * 22;
        const y = h + 30 - ease * (h * 0.85);
        const a = smoothstep(0, 0.16, lt) * (1 - smoothstep(0.68, 1, lt)) * 0.88;
        drawSprite(ctx, flameImg, x, y, 48 + prng(seed, i + 12) * 38, Math.sin(lt * 4 + i) * 0.25, a);
      }
      for (let i = 0; i < 20; i++) {
        const start = prng(seed, i + 30) * 0.34;
        const lt = clamp01((p - start) / 0.56);
        if (lt <= 0 || lt >= 1) continue;
        const ease = easeOutCubic(lt);
        const x = w * prng(seed, i + 50) + ease * (prng(seed, i + 70) - 0.4) * 90;
        const y = h * (0.85 + prng(seed, i + 90) * 0.2) - ease * (h * 0.95);
        const a = smoothstep(0, 0.14, lt) * (1 - smoothstep(0.72, 1, lt)) * 0.95;
        if (emberImg && i < 10) drawSprite(ctx, emberImg, x, y, 18 + prng(seed, i + 110) * 18, lt * 5 + i, a);
        else drawSpark(ctx, x, y, 2.2 + prng(seed, i + 130) * 3, "#fef08a", a, lt * 3);
      }
      return;
    }

    if (id === "arcane-sigil") {
      // SELO DO ECLIPSE (4 atos):
      // Ato 1: névoa ametista abre no topo; Ato 2: mandala arcana pintada se expande e gira;
      // Ato 3: runas cristalinas orbitam com brilho dourado; Ato 4: selo se dissolve em estrelas.
      const sigilImg = getSprite("sigil");
      const runeImg = getSprite("rune");
      const wash = ctx.createRadialGradient(w * 0.5, h * 0.28, 12, w * 0.5, h * 0.28, w * 0.82);
      wash.addColorStop(0, `rgba(192, 38, 211, ${(0.28 * climax * env).toFixed(3)})`);
      wash.addColorStop(0.55, `rgba(88, 28, 135, ${(0.14 * env).toFixed(3)})`);
      wash.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = wash;
      ctx.fillRect(0, 0, w, h);

      if (sigilImg) {
        const sP = smoothstep(0.06, 0.92, p);
        const scale = 0.42 + easeOutCubic(Math.min(1, sP * 1.4)) * 0.65;
        const sz = Math.min(w * 0.62, 230) * scale;
        const a = smoothstep(0, 0.18, sP) * (1 - smoothstep(0.72, 1, sP)) * 0.82;
        drawSprite(ctx, sigilImg, w * 0.5, h * 0.26, sz, sP * 1.15, a);
      }
      for (let i = 0; i < 8; i++) {
        const start = 0.08 + prng(seed, i) * 0.22;
        const lt = clamp01((p - start) / 0.64);
        if (lt <= 0 || lt >= 1) continue;
        const ang = (i / 8) * Math.PI * 2 + lt * 1.8;
        const rad = 28 + easeOutCubic(lt) * (w * 0.44);
        const x = w * 0.5 + Math.cos(ang) * rad;
        const y = h * 0.26 + Math.sin(ang) * rad * 0.72;
        const a = smoothstep(0, 0.16, lt) * (1 - smoothstep(0.72, 1, lt)) * 0.92;
        if (runeImg) drawSprite(ctx, runeImg, x, y, 28 + prng(seed, i + 20) * 16, ang + 0.5, a);
        else drawSpark(ctx, x, y, 4, "#fde68a", a);
      }
      return;
    }

    if (id === "abyssal-tide") {
      // MARÉ BIOLUMINESCENTE (4 atos):
      // Ato 1: correnteza turquesa atravessa o cartão; Ato 2: águas-vivas pintadas sobem em parallax;
      // Ato 3: bolhas iridescentes estouram em brilho; Ato 4: águas-vivas saem pelo topo limpo.
      const jellyImg = getSprite("jelly");
      const bubbleImg = getSprite("bubble");
      const wash = ctx.createLinearGradient(0, h, w, 0);
      wash.addColorStop(0, `rgba(14, 116, 144, ${(0.24 * env).toFixed(3)})`);
      wash.addColorStop(0.5, `rgba(34, 211, 238, ${(0.22 * climax * env).toFixed(3)})`);
      wash.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = wash;
      ctx.fillRect(0, 0, w, h);

      for (let i = 0; i < 4; i++) {
        const start = i * 0.08;
        const lt = clamp01((p - start) / 0.72);
        if (lt <= 0 || lt >= 1 || !jellyImg) continue;
        const ease = easeOutCubic(lt);
        const x = w * (0.18 + i * 0.22) + Math.sin(lt * 5.2 + i) * 24;
        const y = h + 40 - ease * (h + 110);
        const a = smoothstep(0, 0.16, lt) * (1 - smoothstep(0.76, 1, lt)) * (i % 2 === 0 ? 0.92 : 0.72);
        const sz = i % 2 === 0 ? 78 : 54;
        drawSprite(ctx, jellyImg, x, y, sz, Math.sin(lt * 4 + i) * 0.2, a);
      }
      for (let i = 0; i < 20; i++) {
        const start = prng(seed, i) * 0.34;
        const lt = clamp01((p - start) / 0.6);
        if (lt <= 0 || lt >= 1) continue;
        const x = w * prng(seed, i + 25) + Math.sin(lt * 6 + i) * 14;
        const y = h + 16 - easeOutCubic(lt) * (h + 48);
        const a = smoothstep(0, 0.14, lt) * (1 - smoothstep(0.76, 1, lt)) * 0.88;
        if (bubbleImg) drawSprite(ctx, bubbleImg, x, y, 12 + prng(seed, i + 50) * 18, 0, a);
      }
      return;
    }

    if (id === "seraphim-fall") {
      // CHUVA DE PLUMAS (4 atos):
      // Ato 1: feixe solar diagonal desce do topo; Ato 2: plumas marfim-ouro planam com pêndulo suave;
      // Ato 3: estrelas solares abrem no clímax; Ato 4: plumas desaceleram e dissolvem em luz.
      const featherImg = getSprite("feather");
      const starImg = getSprite("seraphStar");

      // Feixe de luz celestial diagonal
      ctx.save();
      const beam = ctx.createLinearGradient(0, 0, w * 0.85, h * 0.85);
      beam.addColorStop(0, `rgba(254, 249, 195, ${(0.28 * climax * env).toFixed(3)})`);
      beam.addColorStop(0.5, `rgba(251, 191, 36, ${(0.16 * env).toFixed(3)})`);
      beam.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = beam;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();

      for (let i = 0; i < 16; i++) {
        const start = prng(seed, i) * 0.36;
        const lt = clamp01((p - start) / 0.6);
        if (lt <= 0 || lt >= 1) continue;
        const ease = easeOutCubic(lt);
        const x = w * (0.05 + prng(seed, i + 20) * 0.9) + Math.sin(lt * 5.2 + i) * 28 + lt * 34;
        const y = -28 + ease * (h + 68);
        const a = smoothstep(0, 0.15, lt) * (1 - smoothstep(0.75, 1, lt)) * (i < 7 ? 0.64 : 0.94);
        const sz = (i < 7 ? 24 : 38) + prng(seed, i + 40) * 16;
        if (featherImg) drawSprite(ctx, featherImg, x, y, sz, Math.sin(lt * 5 + i) * 0.55 + 0.2, a);
      }
      if (starImg) {
        for (let i = 0; i < 5; i++) {
          const st = smoothstep(0.14 + i * 0.08, 0.88, p);
          if (st <= 0 || st >= 1) continue;
          const sx = w * (0.18 + i * 0.17);
          const sy = h * (0.12 + prng(seed, i + 80) * 0.34);
          drawSprite(ctx, starImg, sx, sy, 34 + prng(seed, i + 90) * 24, st * 0.8, Math.sin(st * Math.PI) * 0.85);
        }
      }
    }
  }

  // ============================================================================
  // 4. LOOP ÚNICO COMPARTILHADO (60 / 144 / 240 Hz independente de refresh rate)
  // ============================================================================
  function drawInstance(rec, dt) {
    if (!rec.ctx) return;
    if (!syncCanvasSize(rec)) return;
    if (rec.kind === "effect") {
      rec.elapsedMs += dt * 1000;
      const p = rec.elapsedMs / rec.durationMs;
      const card = rec.host?.closest?.(".profile-card");
      if (p >= 1) {
        rec.ctx.clearRect(0, 0, rec.w, rec.h);
        card?.classList?.remove("cos-effect-climax");
        rec.done = true;
        unregisterCanvas(rec.canvas);
        return;
      }
      if (card) card.classList.toggle("cos-effect-climax", p >= 0.38 && p <= 0.78);
      renderProfileEffectVfx(rec.ctx, rec.w, rec.h, rec.id, p, rec.seed);
      return;
    }
    rec.t += dt;
    if (rec.kind === "avatar") {
      renderAvatarVfx(rec.ctx, rec.w, rec.h, rec.id, rec.depth, rec.t, rec.seed, rec.density);
    } else if (rec.kind === "frame") {
      renderFrameVfx(rec.ctx, rec.w, rec.h, rec.id, rec.t, rec.seed, rec.density, rec.host);
    }
  }

  function tick(ts) {
    rafId = null;
    if (!instances.size || !isWindowActive()) { lastTs = 0; return; }
    const rawDt = lastTs ? (ts - lastTs) / 1000 : 0.016;
    const dt = Math.min(0.05, Math.max(0.002, rawDt));
    lastTs = ts;

    const reduced = isReducedMotion();
    let anyRunning = false;
    let drawnThisFrame = 0;

    for (const [canvas, rec] of [...instances.entries()]) {
      if (!canvas.isConnected || rec.done) {
        unregisterCanvas(canvas);
        continue;
      }
      if (!rec.visible || !rec.ctx || canvas.closest(".hidden, [hidden]")) continue;

      if (rec.kind === "effect") {
        if (reduced) {
          rec.ctx?.clearRect(0, 0, rec.w || 1, rec.h || 1);
          rec.host?.closest?.(".profile-card")?.classList?.remove("cos-effect-climax");
          rec.done = true;
          unregisterCanvas(canvas);
          continue;
        }
        drawInstance(rec, dt);
        if (!rec.done) anyRunning = true;
        continue;
      }

      if (rec.kind === "avatar" && document.body?.classList?.contains("profile-static-decorations")) {
        if (!rec.stillRendered) { rec.t = 1.4; drawInstance(rec, 0); rec.stillRendered = true; }
        continue;
      }
      if (rec.kind === "frame" && document.body?.classList?.contains("profile-static-frames")) {
        if (!rec.stillRendered) { rec.t = 1.4; drawInstance(rec, 0); rec.stillRendered = true; }
        continue;
      }
      if (reduced) {
        if (!rec.stillRendered) { rec.t = 1.4; drawInstance(rec, 0); rec.stillRendered = true; }
        continue;
      }
      rec.stillRendered = false;

      if (rec.isMini && !isMiniHoveredOrSelected(rec.host)) {
        if (!rec.miniStillDrawn) { rec.t = 1.4; drawInstance(rec, 0); rec.miniStillDrawn = true; }
        continue;
      }
      if (drawnThisFrame >= MAX_ACTIVE_VFX) continue;
      drawnThisFrame++;
      drawInstance(rec, dt);
      anyRunning = true;
    }

    if (anyRunning && typeof requestAnimationFrame === "function") {
      rafId = requestAnimationFrame(tick);
    } else {
      lastTs = 0;
    }
  }

  function kickLoop() {
    let hasVisibleCanvas = false;
    for (const [canvas, rec] of instances) {
      if (canvas.isConnected) {
        rec.mounted = true;
        hasVisibleCanvas ||= rec.visible && Boolean(rec.ctx);
      } else if (rec.mounted) {
        unregisterCanvas(canvas);
      }
    }
    if (!isWindowActive()) {
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = null;
      lastTs = 0;
      return;
    }
    if (rafId !== null || !hasVisibleCanvas) return;
    if (typeof requestAnimationFrame !== "function") return;
    lastTs = 0;
    rafId = requestAnimationFrame(tick);
  }

  function registerCanvas(canvas, config) {
    if (!canvas) return false;
    preloadAssets();
    let ctx = null;
    const isJsdom = typeof navigator !== "undefined" && /jsdom/i.test(navigator.userAgent || "");
    if (!isJsdom && typeof canvas.getContext === "function") {
      try { ctx = canvas.getContext("2d"); } catch (_) { ctx = null; }
    }
    const rec = {
      canvas,
      ctx,
      kind: config.kind,
      id: config.id,
      depth: config.depth || "front",
      host: config.host || canvas.parentElement,
      density: config.density ?? resolveDensity(config.host || canvas.parentElement),
      isMini: Boolean((config.host || canvas).closest?.(".pe-choice, .cosmetic-choice")),
      seed: hashSeed(`${config.kind}:${config.id}:${config.depth || ""}`),
      t: (hashSeed(config.id) % 100) / 25,
      elapsedMs: 0,
      durationMs: config.durationMs || 3600,
      done: false,
      stillRendered: false,
      miniStillDrawn: false,
      visible: !canvasObserver,
      mounted: canvas.isConnected,
      w: 0,
      h: 0,
    };
    if (rec.density <= 0) return false;
    instances.set(canvas, rec);
    canvasObserver?.observe(canvas);
    kickLoop();
    return true;
  }

  function attachAvatarVfx(wrapEl, id) {
    try {
      if (!wrapEl) return;
      detachAvatarVfx(wrapEl);
      if (!id || wrapEl.closest?.(".members-sidebar, .member-item")) return;
      const density = resolveDensity(wrapEl);
      if (density <= 0) return;

      for (const depth of ["back", "front"]) {
        const layer = wrapEl.querySelector(`:scope > .avatar-art-${depth}`);
        if (!layer) continue;
        const c = document.createElement("canvas");
        c.className = `cos-vfx-canvas cos-vfx-avatar-${depth}`;
        c.setAttribute("aria-hidden", "true");
        layer.appendChild(c);
        registerCanvas(c, { kind: "avatar", id, depth, host: wrapEl, density });
      }
    } catch (_) {}
  }

  function detachAvatarVfx(wrapEl) {
    if (!wrapEl) return;
    wrapEl.querySelectorAll(":scope > .deco-svg-layer > .cos-vfx-canvas").forEach((c) => {
      unregisterCanvas(c);
      c.remove();
    });
  }

  function attachFrameVfx(cardEl, id) {
    try {
      if (!cardEl) return;
      detachFrameVfx(cardEl);
      if (!id) return;
      const layer = cardEl.querySelector(":scope > .pf-layer > .cos-v5-frame, :scope > .pf-layer > .cos-v3-frame, :scope > .pf-layer");
      if (!layer) return;
      const density = resolveDensity(cardEl);
      if (density <= 0) return;
      const c = document.createElement("canvas");
      c.className = "cos-vfx-canvas cos-vfx-frame";
      c.setAttribute("aria-hidden", "true");
      layer.appendChild(c);
      registerCanvas(c, { kind: "frame", id, host: cardEl, density });
    } catch (_) {}
  }

  function detachFrameVfx(cardEl) {
    if (!cardEl) return;
    cardEl.querySelectorAll(":scope > .pf-layer .cos-vfx-frame").forEach((c) => {
      unregisterCanvas(c);
      c.remove();
    });
  }

  function startEffectVfx(layerEl, id, durationMs) {
    try {
      stopEffectVfx(layerEl);
      if (!layerEl || !id || isReducedMotion()) return false;
      const host = layerEl.querySelector(".profile-effect-timeline") || layerEl;
      const c = document.createElement("canvas");
      c.className = "cos-vfx-canvas cos-vfx-effect";
      c.setAttribute("aria-hidden", "true");
      host.appendChild(c);
      return registerCanvas(c, { kind: "effect", id, host: layerEl, density: 1, durationMs: durationMs || 3600 });
    } catch (_) {
      return false;
    }
  }

  function stopEffectVfx(layerEl) {
    if (!layerEl) return;
    layerEl.closest?.(".profile-card")?.classList?.remove("cos-effect-climax");
    layerEl.querySelectorAll(".cos-vfx-effect").forEach((c) => {
      unregisterCanvas(c);
      c.remove();
    });
  }

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", kickLoop);
    document.addEventListener("sanvo:visual-visibility", kickLoop);
    global.addEventListener?.("focus", kickLoop);
    document.addEventListener("pointerover", (e) => {
      if (e.target instanceof Element && e.target.closest(".pe-choice, .cosmetic-choice")) kickLoop();
    });
    if (document.readyState === "complete") preloadAssets();
    else global.addEventListener?.("load", preloadAssets, { once: true });
  }

  const api = {
    VERSION: 5,
    attachAvatarVfx,
    detachAvatarVfx,
    attachFrameVfx,
    detachFrameVfx,
    startEffectVfx,
    stopEffectVfx,
    preloadAssets,
    kickLoop,
    getActiveCanvasCount: () => instances.size,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (global) {
    global.SanvoCosmeticsVFX = api;
    global.SancordCosmeticsVFX = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
