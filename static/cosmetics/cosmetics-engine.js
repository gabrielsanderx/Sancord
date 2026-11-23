// ============================================================================
// Sancord — Motor Unificado de Cosméticos (v3)
//   • Asset Pipeline estruturado por categoria com metadata completa
//   • Renderers compartilhados: DecoratedAvatar, ProfileFrameRenderer,
//     ProfileEffectRenderer (timeline multi-estágio), NameplateRenderer,
//     DisplayNameRenderer
//   • Scheduler IDLE_WITH_EVENTS consciente de visibilidade, contexto, budget
//     e Reduced Motion (eventos secundários e raros orgânicos sem loop robótico)
// ============================================================================
(function (global) {
  "use strict";

  const COSMETIC_ENGINE_VERSION = 5;

  const CONTEXTS = Object.freeze({
    EDITOR_PREVIEW: "EDITOR_PREVIEW",
    FULL_PROFILE: "FULL_PROFILE",
    PROFILE_POPOUT: "PROFILE_POPOUT",
    SELF_PROFILE_MENU: "SELF_PROFILE_MENU",
    CHAT: "CHAT",
    MEMBER_LIST: "MEMBER_LIST",
    DM_LIST: "DM_LIST",
    MINI: "MINI",
  });

  const ANIMATION_MODES = Object.freeze({
    STATIC: "STATIC",
    LOOP: "LOOP",
    HOVER: "HOVER",
    PLAY_ON_OPEN: "PLAY_ON_OPEN",
    ONE_SHOT: "ONE_SHOT",
    IDLE_WITH_EVENTS: "IDLE_WITH_EVENTS",
    REACTIVE: "REACTIVE",
  });

  // Orçamento de performance: nunca animar 100 itens na lista de membros ou fora da tela.
  const BUDGET = Object.freeze({
    maxConcurrentIdleHosts: 6,
    maxActiveProfileEffects: 1,
    firstSecondaryMinMs: 3200,
    firstSecondaryMaxMs: 5600,
    secondaryMinMs: 8000,
    secondaryMaxMs: 14500,
    secondaryDurationMs: 1850,
    rareMinMs: 16500,
    rareMaxMs: 26000,
    rareDurationMs: 2400,
  });

  // Classificação canônica de animação de TODOS os cosméticos do catálogo (v1/v2/v3).
  // Itens originalmente estáticos permanecem STATIC; nenhum item animado é rebaixado para estático
  // e nem tudo vira LOOP robótico.
  const COSMETIC_ANIMATION_MAP = Object.freeze({
    avatar_decoration: Object.freeze({
      // v4 Multi-camada + Canvas VFX (IDLE_WITH_EVENTS)
      "galaxy-portal": ANIMATION_MODES.IDLE_WITH_EVENTS,
      "sakura-glow": ANIMATION_MODES.IDLE_WITH_EVENTS,
      "core-orbit": ANIMATION_MODES.IDLE_WITH_EVENTS,
      "cat-gamer": ANIMATION_MODES.IDLE_WITH_EVENTS,
      "frost-crown": ANIMATION_MODES.IDLE_WITH_EVENTS,
      "dragon-fire": ANIMATION_MODES.IDLE_WITH_EVENTS,
      "angel-wings": ANIMATION_MODES.IDLE_WITH_EVENTS,
      "blood-moon": ANIMATION_MODES.IDLE_WITH_EVENTS,
      "ocean-bubbles": ANIMATION_MODES.IDLE_WITH_EVENTS,
      "electric-pulse": ANIMATION_MODES.IDLE_WITH_EVENTS,
      "cyber-ring": ANIMATION_MODES.IDLE_WITH_EVENTS,
      lunar: ANIMATION_MODES.IDLE_WITH_EVENTS,
      "eclipse-sovereign": ANIMATION_MODES.IDLE_WITH_EVENTS,
      // Legadas preservadas para compatibilidade (LOOP)
      "flame-violet": ANIMATION_MODES.LOOP,
      "devil-horns": ANIMATION_MODES.LOOP,
      "cyber-cyan": ANIMATION_MODES.LOOP,
      "golden-halo": ANIMATION_MODES.LOOP,
      "crimson-vortex": ANIMATION_MODES.LOOP,
      "rainbow-prism": ANIMATION_MODES.LOOP,
      "electric-surge": ANIMATION_MODES.LOOP,
      "heart-pixel": ANIMATION_MODES.LOOP,
      "neon-glitch": ANIMATION_MODES.LOOP,
      "nebula-orbit": ANIMATION_MODES.LOOP,
      "sakura-fall": ANIMATION_MODES.LOOP,
      ember: ANIMATION_MODES.LOOP,
      snowfall: ANIMATION_MODES.LOOP,
      "digital-rain": ANIMATION_MODES.LOOP,
      "retro-pixels": ANIMATION_MODES.LOOP,
      // Estáticas de alta definição (STATIC)
      "static-royal-crown": ANIMATION_MODES.STATIC,
      "static-gold": ANIMATION_MODES.STATIC,
      "static-cyber-hud": ANIMATION_MODES.STATIC,
      "static-crimson": ANIMATION_MODES.STATIC,
      "static-diamond": ANIMATION_MODES.STATIC,
      "static-blurple": ANIMATION_MODES.STATIC,
      "static-emerald": ANIMATION_MODES.STATIC,
      "static-angel": ANIMATION_MODES.STATIC,
    }),
    profile_frame: Object.freeze({
      // v4 Arquitetônicas vivas + Canvas Ambient VFX (IDLE_WITH_EVENTS)
      "core-pulse": ANIMATION_MODES.IDLE_WITH_EVENTS,
      "cosmic-drift": ANIMATION_MODES.IDLE_WITH_EVENTS,
      "sakura-wind": ANIMATION_MODES.IDLE_WITH_EVENTS,
      "frost-glint": ANIMATION_MODES.IDLE_WITH_EVENTS,
      "ember-trail": ANIMATION_MODES.IDLE_WITH_EVENTS,
      liquid: ANIMATION_MODES.IDLE_WITH_EVENTS,
      holographic: ANIMATION_MODES.IDLE_WITH_EVENTS,
      "neon-pulse": ANIMATION_MODES.IDLE_WITH_EVENTS,
      "arcane-grimoire": ANIMATION_MODES.IDLE_WITH_EVENTS,
      "eclipse-crown": ANIMATION_MODES.IDLE_WITH_EVENTS,
      "seraphim-arch": ANIMATION_MODES.IDLE_WITH_EVENTS,
      "dream-sanctuary": ANIMATION_MODES.IDLE_WITH_EVENTS,
      founder: ANIMATION_MODES.IDLE_WITH_EVENTS,
      developer: ANIMATION_MODES.IDLE_WITH_EVENTS,
      "sovereign-crest": ANIMATION_MODES.IDLE_WITH_EVENTS,
      "winter-2026": ANIMATION_MODES.IDLE_WITH_EVENTS,
      // Reativas a presença/voz (REACTIVE)
      "reactive-aura": ANIMATION_MODES.REACTIVE,
      "voice-pulse": ANIMATION_MODES.REACTIVE,
      // Estáticas de colecionador (STATIC)
      minimal: ANIMATION_MODES.STATIC,
      "cyber-corners": ANIMATION_MODES.STATIC,
      royal: ANIMATION_MODES.STATIC,
      "early-user": ANIMATION_MODES.STATIC,
    }),
    profile_effect: Object.freeze({
      // v4 Coreografia cinematográfica em 4 atos (PLAY_ON_OPEN / ONE_SHOT)
      "core-signal": ANIMATION_MODES.PLAY_ON_OPEN,
      "star-trail": ANIMATION_MODES.PLAY_ON_OPEN,
      "petal-drift": ANIMATION_MODES.PLAY_ON_OPEN,
      "circuit-boot": ANIMATION_MODES.PLAY_ON_OPEN,
      "polar-ribbon": ANIMATION_MODES.PLAY_ON_OPEN,
      embers: ANIMATION_MODES.PLAY_ON_OPEN,
      "arcane-sigil": ANIMATION_MODES.PLAY_ON_OPEN,
      "eclipse-flare": ANIMATION_MODES.PLAY_ON_OPEN,
      "abyssal-tide": ANIMATION_MODES.PLAY_ON_OPEN,
      "seraphim-fall": ANIMATION_MODES.PLAY_ON_OPEN,
      "synth-overdrive": ANIMATION_MODES.PLAY_ON_OPEN,
      "dream-butterflies": ANIMATION_MODES.PLAY_ON_OPEN,
    }),
    nameplate: Object.freeze({
      // v4 Ilustradas animadas (IDLE_WITH_EVENTS)
      "starlit-silt": ANIMATION_MODES.IDLE_WITH_EVENTS,
      "twilight-garden": ANIMATION_MODES.IDLE_WITH_EVENTS,
      "core-stripe": ANIMATION_MODES.IDLE_WITH_EVENTS,
      "tide-glass": ANIMATION_MODES.IDLE_WITH_EVENTS,
      "ember-line": ANIMATION_MODES.IDLE_WITH_EVENTS,
      "arcane-velvet": ANIMATION_MODES.IDLE_WITH_EVENTS,
      "eclipse-gold": ANIMATION_MODES.IDLE_WITH_EVENTS,
      "dream-mist": ANIMATION_MODES.IDLE_WITH_EVENTS,
      // Estáticas ilustradas (STATIC)
      "circuit-weave": ANIMATION_MODES.STATIC,
      "gold-leaf": ANIMATION_MODES.STATIC,
      "frost-vein": ANIMATION_MODES.STATIC,
    }),
    name_style: Object.freeze({
      // Materiais animados (apenas no preenchimento/brilho, texto nunca desloca)
      gradient: ANIMATION_MODES.LOOP,
      "custom-gradient": ANIMATION_MODES.LOOP,
      prism: ANIMATION_MODES.LOOP,
      holographic: ANIMATION_MODES.LOOP,
      cosmic: ANIMATION_MODES.LOOP,
      neon: ANIMATION_MODES.LOOP,
      glow: ANIMATION_MODES.LOOP,
      sakura: ANIMATION_MODES.LOOP,
      chrome: ANIMATION_MODES.IDLE_WITH_EVENTS,
      royal: ANIMATION_MODES.IDLE_WITH_EVENTS,
      // Fontes e acabamentos estáticos (STATIC)
      gta: ANIMATION_MODES.STATIC,
      fire: ANIMATION_MODES.STATIC,
      ice: ANIMATION_MODES.STATIC,
      retro: ANIMATION_MODES.STATIC,
      gothic: ANIMATION_MODES.STATIC,
      toxic: ANIMATION_MODES.STATIC,
      modern: ANIMATION_MODES.STATIC,
      rounded: ANIMATION_MODES.STATIC,
      mono: ANIMATION_MODES.STATIC,
      editorial: ANIMATION_MODES.STATIC,
      bubble: ANIMATION_MODES.STATIC,
      cyber: ANIMATION_MODES.STATIC,
      fantasy: ANIMATION_MODES.STATIC,
      outline: ANIMATION_MODES.STATIC,
      gummy: ANIMATION_MODES.STATIC,
      ink: ANIMATION_MODES.STATIC,
    }),
  });

  // Aliases transparentes de itens legados descartados → sucessores V5 Flagship pintados
  // (preserva contas/presets salvos no banco sem poluir a vitrine com protótipos antigos).
  const LEGACY_COSMETIC_ALIASES = Object.freeze({
    avatar_decoration: Object.freeze({
      "core-orbit": "galaxy-portal",
      "electric-pulse": "cat-gamer",
      "cyber-ring": "cat-gamer",
      lunar: "blood-moon",
      "flame-violet": "dragon-fire",
      "devil-horns": "dragon-fire",
      "cyber-cyan": "cat-gamer",
      "golden-halo": "angel-wings",
      "crimson-vortex": "blood-moon",
      "rainbow-prism": "cat-gamer",
      "electric-surge": "cat-gamer",
      "heart-pixel": "sakura-glow",
      "neon-glitch": "cat-gamer",
      "nebula-orbit": "galaxy-portal",
      "sakura-fall": "sakura-glow",
      ember: "dragon-fire",
      snowfall: "frost-crown",
      "digital-rain": "cat-gamer",
      "retro-pixels": "cat-gamer",
      "static-gold": "static-royal-crown",
      "static-crimson": "static-royal-crown",
      "static-blurple": "static-cyber-hud",
      "static-angel": "static-diamond",
    }),
    profile_frame: Object.freeze({
      "core-pulse": "cosmic-drift",
      "neon-pulse": "holographic",
      "eclipse-crown": "arcane-grimoire",
      "dream-sanctuary": "sakura-wind",
      "reactive-aura": "holographic",
      "voice-pulse": "holographic",
      minimal: "holographic",
      carbon: "cyber-corners",
      "sakura-corners": "sakura-wind",
      "retro-pixel": "holographic",
      cosmic: "cosmic-drift",
      inferno: "ember-trail",
      frost: "frost-glint",
      "prism-flow": "holographic",
      electric: "holographic",
      "digital-glitch": "holographic",
      "bug-hunter": "developer",
      community: "cosmic-drift",
      "event-champion": "founder",
    }),
    profile_effect: Object.freeze({
      "core-signal": "circuit-boot",
      "eclipse-flare": "arcane-sigil",
      "synth-overdrive": "circuit-boot",
      "dream-butterflies": "petal-drift",
      sparkles: "star-trail",
      galaxy: "star-trail",
      "gravity-well": "star-trail",
      sakura: "petal-drift",
      matrix: "circuit-boot",
      cyber: "circuit-boot",
      glitch: "circuit-boot",
      "pixel-assembly": "circuit-boot",
      lightning: "circuit-boot",
      snow: "polar-ribbon",
      aurora: "polar-ribbon",
      confetti: "seraphim-fall",
      hellfire: "embers",
    }),
    nameplate: Object.freeze({
      "dream-mist": "twilight-garden",
      "circuit-weave": "core-stripe",
      crimson: "ember-line",
      nebula: "starlit-silt",
      aurora: "tide-glass",
      sakura: "twilight-garden",
      gold: "eclipse-gold",
      cyber: "core-stripe",
      hellfire: "ember-line",
      frost: "frost-vein",
      void: "arcane-velvet",
      toxic: "core-stripe",
      synthwave: "core-stripe",
      "retro-horizon": "starlit-silt",
    }),
  });

  // Assets pintados HiDPI WebP da Biblioteca Flagship V5 (gerados em 1024px / 640px com alfa real).
  const V5_AVATAR_ART = Object.freeze({
    "galaxy-portal": Object.freeze({
      back: "/cosmetics/assets/deco_astral_back.webp",
      front: "/cosmetics/assets/deco_astral_front.webp",
      bleed: 24.5,
      motion: "astral",
    }),
    "sakura-glow": Object.freeze({
      back: "/cosmetics/assets/deco_sakura_back.webp",
      front: "/cosmetics/assets/deco_sakura_front.webp",
      bleed: 24.5,
      motion: "sakura",
    }),
    "frost-crown": Object.freeze({
      back: "/cosmetics/assets/deco_frost_back.webp",
      front: "/cosmetics/assets/deco_frost_front.webp",
      bleed: 24.5,
      motion: "frost",
    }),
    "cat-gamer": Object.freeze({
      back: "/cosmetics/assets/deco_cyber_back.webp",
      front: "/cosmetics/assets/deco_cyber_front.webp",
      blink: "/cosmetics/assets/deco_cyber_blink.webp",
      bleed: 24.5,
      motion: "cyber-cat",
    }),
    "dragon-fire": Object.freeze({
      back: "/cosmetics/assets/deco_infernal_back.webp",
      front: "/cosmetics/assets/deco_infernal_front.webp",
      bleed: 24.5,
      motion: "infernal",
    }),
    "blood-moon": Object.freeze({
      back: "/cosmetics/assets/deco_arcane_back.webp",
      front: "/cosmetics/assets/deco_arcane_front.webp",
      bleed: 24.5,
      motion: "arcane",
    }),
    "ocean-bubbles": Object.freeze({
      back: "/cosmetics/assets/deco_abyssal_back.webp",
      front: "/cosmetics/assets/deco_abyssal_front.webp",
      bleed: 24.5,
      motion: "abyssal",
    }),
    "angel-wings": Object.freeze({
      back: "/cosmetics/assets/deco_seraph_back.webp",
      front: "/cosmetics/assets/deco_seraph_front.webp",
      bleed: 24.5,
      motion: "seraph",
    }),
    "eclipse-sovereign": Object.freeze({
      back: "/cosmetics/assets/deco_sovereign_back.webp",
      front: "/cosmetics/assets/deco_sovereign_front.webp",
      bleed: 24.5,
      motion: "sovereign",
    }),
  });

  const V5_FRAME_ART = Object.freeze({
    "cosmic-drift": Object.freeze({
      tl: "/cosmetics/assets/frame_astral_tl.webp",
      tr: "/cosmetics/assets/frame_astral_tr.webp",
      br: "/cosmetics/assets/frame_astral_br.webp",
      theme: "cosmic",
      motion: "astral",
    }),
    "sakura-wind": Object.freeze({
      tl: "/cosmetics/assets/frame_sakura_tl.webp",
      tr: "/cosmetics/assets/frame_sakura_tr.webp",
      br: "/cosmetics/assets/frame_sakura_br.webp",
      theme: "sakura",
      motion: "sakura",
    }),
    "frost-glint": Object.freeze({
      tl: "/cosmetics/assets/frame_frost_tl.webp",
      tr: "/cosmetics/assets/frame_frost_tr.webp",
      br: "/cosmetics/assets/frame_frost_br.webp",
      theme: "frost",
      motion: "frost",
    }),
    holographic: Object.freeze({
      tl: "/cosmetics/assets/frame_cyber_tl.webp",
      tr: "/cosmetics/assets/frame_cyber_tr.webp",
      br: "/cosmetics/assets/frame_cyber_br.webp",
      theme: "cyber",
      motion: "cyber",
    }),
    "ember-trail": Object.freeze({
      tl: "/cosmetics/assets/frame_infernal_tl.webp",
      tr: "/cosmetics/assets/frame_infernal_tr.webp",
      br: "/cosmetics/assets/frame_infernal_br.webp",
      theme: "inferno",
      motion: "infernal",
    }),
    "arcane-grimoire": Object.freeze({
      tl: "/cosmetics/assets/frame_arcane_tl.webp",
      tr: "/cosmetics/assets/frame_arcane_tr.webp",
      br: "/cosmetics/assets/frame_arcane_br.webp",
      theme: "arcane",
      motion: "arcane",
    }),
    liquid: Object.freeze({
      tl: "/cosmetics/assets/frame_abyssal_tl.webp",
      tr: "/cosmetics/assets/frame_abyssal_tr.webp",
      br: "/cosmetics/assets/frame_abyssal_br.webp",
      theme: "abyssal",
      motion: "abyssal",
    }),
    "seraphim-arch": Object.freeze({
      tl: "/cosmetics/assets/frame_seraph_tl.webp",
      tr: "/cosmetics/assets/frame_seraph_tr.webp",
      br: "/cosmetics/assets/frame_seraph_br.webp",
      theme: "seraphim",
      motion: "seraph",
    }),
    "sovereign-crest": Object.freeze({
      tl: "/cosmetics/assets/frame_sovereign_tl.webp",
      tr: "/cosmetics/assets/frame_sovereign_tr.webp",
      br: "/cosmetics/assets/frame_sovereign_br.webp",
      theme: "founder",
      motion: "sovereign",
    }),
    founder: Object.freeze({
      tl: "/cosmetics/assets/frame_founder_tl.webp",
      tr: "/cosmetics/assets/frame_astral_tr.webp",
      br: "/cosmetics/assets/frame_astral_br.webp",
      theme: "founder",
      motion: "astral",
    }),
    developer: Object.freeze({
      tl: "/cosmetics/assets/frame_dev_tl.webp",
      tr: "/cosmetics/assets/frame_cyber_tr.webp",
      br: "/cosmetics/assets/frame_cyber_br.webp",
      theme: "developer",
      motion: "cyber",
    }),
    "winter-2026": Object.freeze({
      tl: "/cosmetics/assets/frame_frost_tl.webp",
      tr: "/cosmetics/assets/frame_frost_tr.webp",
      br: "/cosmetics/assets/frame_frost_br.webp",
      theme: "frost",
      motion: "frost",
    }),
    "early-user": Object.freeze({
      tl: "/cosmetics/assets/frame_astral_tl.webp",
      tr: "/cosmetics/assets/frame_astral_tr.webp",
      br: "/cosmetics/assets/frame_astral_br.webp",
      theme: "cosmic",
      motion: "static",
    }),
  });

  function resolveCosmeticId(kind, id) {
    if (!id || id === "none") return null;
    const aliases = LEGACY_COSMETIC_ALIASES[kind];
    if (aliases && Object.hasOwn(aliases, id)) return aliases[id];
    return id;
  }

  function getAnimationMode(kind, id) {
    const table = Object.hasOwn(COSMETIC_ANIMATION_MAP, kind) ? COSMETIC_ANIMATION_MAP[kind] : null;
    if (!table || !id || id === "none") return ANIMATION_MODES.STATIC;
    // Preserva classificações explicitamente STATIC/REACTIVE mesmo quando aliasadas visualmente
    if (Object.hasOwn(table, id) && (table[id] === ANIMATION_MODES.STATIC || table[id] === ANIMATION_MODES.REACTIVE)) {
      return table[id];
    }
    const resolved = resolveCosmeticId(kind, id) || id;
    if (Object.hasOwn(table, resolved)) return table[resolved];
    if (Object.hasOwn(table, id)) return table[id];
    return ANIMATION_MODES.STATIC;
  }

  function normalizeContext(raw) {
    const s = String(raw || "").trim().toLowerCase();
    if (s === "editor-full" || s === "editor_preview" || s === "editor") return CONTEXTS.EDITOR_PREVIEW;
    if (s === "full" || s === "full_profile") return CONTEXTS.FULL_PROFILE;
    if (s === "compact" || s === "profile_popout" || s === "popout") return CONTEXTS.PROFILE_POPOUT;
    if (s === "self_profile_menu" || s === "self-profile-menu") return CONTEXTS.SELF_PROFILE_MENU;
    if (s === "chat") return CONTEXTS.CHAT;
    if (s === "member_list" || s === "members") return CONTEXTS.MEMBER_LIST;
    if (s === "dm_list" || s === "dm") return CONTEXTS.DM_LIST;
    if (s === "mini") return CONTEXTS.MINI;
    return CONTEXTS.PROFILE_POPOUT;
  }

  function detectElementContext(el) {
    if (!el || typeof el.closest !== "function") return CONTEXTS.PROFILE_POPOUT;
    const card = el.closest("[data-profile-render-context]");
    if (card) return normalizeContext(card.dataset.profileRenderContext);
    if (el.closest(".pf-mini, .pe-choice, .cosmetic-choice")) return CONTEXTS.MINI;
    if (el.closest("#live-profile-preview-card, #settings-tab-profile")) return CONTEXTS.EDITOR_PREVIEW;
    if (el.closest("#self-profile-menu")) return CONTEXTS.SELF_PROFILE_MENU;
    if (el.closest(".compact-profile-dialog, .compact-profile-preview")) return CONTEXTS.PROFILE_POPOUT;
    if (el.closest("#profile-popover-card")) return CONTEXTS.FULL_PROFILE;
    if (el.closest(".members-sidebar, .member-item")) return CONTEXTS.MEMBER_LIST;
    if (el.closest("#dm-list, .dm-item, .friend-row")) return CONTEXTS.DM_LIST;
    if (el.closest("#messages-list, .message-item")) return CONTEXTS.CHAT;
    return CONTEXTS.PROFILE_POPOUT;
  }

  function isReducedMotionActive() {
    if (typeof profileAnimPolicy === "function" && profileAnimPolicy() === "never") return true;
    if (typeof effectiveReduceMotion === "function" && effectiveReduceMotion()) return true;
    if (typeof state !== "undefined" && state?.audioSettings?.reduceMotion) return true;
    if (typeof state !== "undefined" && state?.audioSettings?.syncReducedMotion &&
        typeof systemPrefersReducedMotion === "function" && systemPrefersReducedMotion()) return true;
    return false;
  }

  // ===========================================================================
  // 1. AVATAR DECORATIONS — Composição em camadas (BACK / AVATAR / FRONT / PARTICLES / HIGHLIGHT)
  // ===========================================================================
  const AVATAR_DECORATIONS_V3 = {
    "galaxy-portal": {
      id: "galaxy-portal",
      type: "avatar_decoration",
      name: "Guardião Celeste",
      collection: "cosmic",
      animated: true,
      animation_mode: ANIMATION_MODES.IDLE_WITH_EVENTS,
      legacy_mode: "hover-loop",
      theme: "cosmic",
      bleed: 26,
      version: COSMETIC_ENGINE_VERSION,
      reduced_motion: "keyframe-still",
      artDirection: {
        theme: "Céu noturno e guardião estelar",
        palette: ["#1e1b4b", "#6366f1", "#7dd3fc", "#fde68a", "#e9d5ff"],
        silhouette: "Crescente astral atrás + espírito celeste apoiado na borda superior direita + cachecol de estrelas na base",
        motion: "Respiração suave (6s), cintilação de constelações",
        secondaryEvent: "Guardião pisca os olhos suavemente",
        rareEvent: "Estrela cadente cruza o arco superior",
      },
      back: `
        <defs>
          <radialGradient id="cos-gp-neb" cx="38%" cy="32%" r="64%">
            <stop offset="0%" stop-color="#818cf8" stop-opacity=".55"/>
            <stop offset="55%" stop-color="#312e81" stop-opacity=".42"/>
            <stop offset="100%" stop-color="#0f172a" stop-opacity="0"/>
          </radialGradient>
        </defs>
        <circle cx="50" cy="50" r="48" fill="url(#cos-gp-neb)" class="cos-halo-breathe"/>
        <path class="cos-back-cloud" d="M8 58C4 34 22 10 48 9c20-1 37 11 43 29-9-16-24-21-41-20C28 19 14 35 8 58Z" fill="#312e81" opacity=".78"/>
        <path d="M19 13a14 14 0 1 0 10 23a11.5 11.5 0 1 1-10-23Z" fill="#fde68a" stroke="#fef9c3" stroke-width=".6" opacity=".95" class="cos-halo-breathe"/>
        <ellipse cx="50" cy="50" rx="46" ry="18" transform="rotate(-24 50 50)" fill="none" stroke="#818cf8" stroke-width="1.2" stroke-dasharray="4 3" opacity=".65" class="cos-dash-flow"/>
        <circle cx="13" cy="36" r="1.4" fill="#e0e7ff" class="cos-twinkle"/>
        <circle cx="88" cy="24" r="1.2" fill="#bae6fd" class="cos-twinkle cos-d2"/>
      `,
      front: `
        <path class="cos-scarf-sway" d="M8 62c6 21 25 32 45 31 19-1 34-12 41-30-9 14-23 22-40 23-18 1-34-6-46-24Z" fill="#312e81" stroke="#a5b4fc" stroke-width="1.1"/>
        <path class="cos-scarf-sway" d="M14 71c12 14 30 19 48 15 11-2 21-8 28-17" fill="none" stroke="#7dd3fc" stroke-width="1.6" stroke-linecap="round"/>
        <path d="M22 80c12 8 27 10 41 6" fill="none" stroke="#fde68a" stroke-width=".9" stroke-linecap="round" stroke-dasharray="2 3"/>
        <g class="cos-companion-breathe">
          <path d="M68 18c2-7 6-11 9-11 2 4 2 8 1 11 4-2 9-2 13 0-1-3-1-7 1-11 3 0 7 4 8 11 3 4 3 10-1 14-4 4-11 5-16 5s-12-1-15-5c-3-4-3-10 0-14Z" fill="#1e1b4b" stroke="#c7d2fe" stroke-width="1.2" stroke-linejoin="round"/>
          <path d="M72 17c1-4 3-6 5-6l-1 6Zm20 0c-1-4-3-6-5-6l1 6Z" fill="#818cf8"/>
          <path d="M74 28c4 3 12 3 16 0-3 4-13 4-16 0Z" fill="#e0e7ff" opacity=".88"/>
          <circle cx="77.5" cy="24.5" r="2.1" fill="#fde68a" class="cos-eye"/>
          <circle cx="86.5" cy="24.5" r="2.1" fill="#fde68a" class="cos-eye"/>
          <circle cx="78.1" cy="23.9" r=".7" fill="#ffffff" class="cos-eye"/>
          <circle cx="87.1" cy="23.9" r=".7" fill="#ffffff" class="cos-eye"/>
          <path class="cos-eyelid" d="M75 24.5h5M84 24.5h5" stroke="#c7d2fe" stroke-width="1.3" stroke-linecap="round"/>
          <path d="M81 26.8l1 1.2 1-1.2" fill="none" stroke="#f9a8d4" stroke-width=".9" stroke-linecap="round"/>
        </g>
        <g class="avatar-art-motes">
          <path class="avatar-art-spark" d="M22 86l1.4-4 1.4 4 4 1.4-4 1.4-1.4 4-1.4-4-4-1.4Z" fill="#fde68a"/>
          <circle cx="42" cy="93" r="1.5" fill="#7dd3fc" class="cos-twinkle cos-d1"/>
          <circle cx="85" cy="72" r="1.6" fill="#e9d5ff" class="cos-twinkle cos-d3"/>
        </g>
        <g class="cos-shooting-star">
          <path d="M12 18L46 6" stroke="#fef9c3" stroke-width="1.8" stroke-linecap="round"/>
          <circle cx="46" cy="6" r="2.2" fill="#ffffff"/>
        </g>
      `,
    },

    "sakura-glow": {
      id: "sakura-glow",
      type: "avatar_decoration",
      name: "Brisa de Sakura",
      collection: "sakura",
      animated: true,
      animation_mode: ANIMATION_MODES.IDLE_WITH_EVENTS,
      legacy_mode: "hover-loop",
      theme: "sakura",
      bleed: 26,
      version: COSMETIC_ENGINE_VERSION,
      reduced_motion: "keyframe-still",
      artDirection: {
        theme: "Cerejeira em flor com galho ilustrado e amuleto suspenso",
        palette: ["#4a2534", "#f472b6", "#fbcfe8", "#fde68a", "#fff1f5"],
        silhouette: "Galho escuro saindo de trás do avatar + 3 flores detalhadas com estames + pingente oscilante à direita",
        motion: "Balanço orgânico do galho e do pingente (5.5s)",
        secondaryEvent: "Pétala se solta e desliza diagonalmente pelo avatar",
        rareEvent: "Reflexo quente de sol atravessa as pétalas",
      },
      back: `
        <path d="M4 54C6 28 22 10 49 8c18-1 35 8 44 25-9-11-23-17-40-16C28 18 12 33 4 54Z" fill="#59283b" opacity=".72"/>
        <path d="M6 46C12 24 27 14 48 11M18 22C13 15 11 11 14 7M71 14C84 20 93 33 95 49" fill="none" stroke="#5b3140" stroke-width="2.6" stroke-linecap="round"/>
        <path d="M26 14c-6-5-3-10 2-8 2-5 8-3 7 3 5 2 3 8-3 6-2 4-7 3-6-1Z" fill="#f9a8d4" stroke="#fff1f5" stroke-width=".6" opacity=".88"/>
      `,
      front: `
        <path d="M7 61c8 24 31 35 55 29 15-4 27-14 33-30" fill="none" stroke="#6b3446" stroke-width="2.2" stroke-linecap="round"/>
        <path d="M13 68c11 17 31 23 50 18" fill="none" stroke="#fbcfe8" stroke-width="1.2" stroke-linecap="round" opacity=".82"/>
        <g class="cos-branch-sway">
          <g transform="translate(17 72)">
            <path d="M0-9c3 0 5 3 2 6 4-1 7 2 5 5-2 3-6 2-7-1-1 4-6 4-7 1-2-3 1-6 5-5-3-3-1-6 2-6Z" fill="#fbcfe8" stroke="#ec4899" stroke-width=".85"/>
            <circle cx="0" cy="0" r="2.1" fill="#fde68a"/>
          </g>
          <g transform="translate(83 78) scale(.92)">
            <path d="M0-9c3 0 5 3 2 6 4-1 7 2 5 5-2 3-6 2-7-1-1 4-6 4-7 1-2-3 1-6 5-5-3-3-1-6 2-6Z" fill="#ffe4ef" stroke="#f472b6" stroke-width=".85"/>
            <circle cx="0" cy="0" r="2" fill="#f59e0b"/>
          </g>
          <g transform="translate(26 20) scale(.76)">
            <path d="M0-9c3 0 5 3 2 6 4-1 7 2 5 5-2 3-6 2-7-1-1 4-6 4-7 1-2-3 1-6 5-5-3-3-1-6 2-6Z" fill="#fbcfe8" stroke="#db2777" stroke-width=".9"/>
            <circle cx="0" cy="0" r="2" fill="#fde68a"/>
          </g>
        </g>
        <g class="cos-tassel-sway">
          <path d="M90 42v10" stroke="#fde68a" stroke-width="1.1"/>
          <rect x="86.5" y="51" width="7" height="10" rx="2" fill="#be185d" stroke="#fbcfe8" stroke-width=".8"/>
          <path d="M88.5 54h3M90 52.5v6.5" stroke="#fde68a" stroke-width=".75"/>
          <path d="M88.5 61l-1 6M90 61v7M91.5 61l1 6" stroke="#f9a8d4" stroke-width=".85" stroke-linecap="round"/>
        </g>
        <g class="avatar-art-motes">
          <path class="avatar-art-petal" d="M40 90q6-8 11-2-4 7-11 2Z"/>
          <circle cx="58" cy="92" r="1.4" fill="#fff1f5" class="avatar-art-spark"/>
        </g>
        <path class="cos-drifting-petal" d="M22 14c4-4 10-2 8 3-4 4-9 2-8-3Z" fill="#fbcfe8" stroke="#f472b6" stroke-width=".6"/>
        <path class="cos-glint-sweep" d="M8 76L88 22" stroke="#fff7ed" stroke-width="2.4" stroke-linecap="round"/>
      `,
    },

    "core-orbit": {
      id: "core-orbit",
      type: "avatar_decoration",
      name: "Núcleo Orbital Sanvo",
      collection: "sancord-core",
      animated: true,
      animation_mode: ANIMATION_MODES.IDLE_WITH_EVENTS,
      legacy_mode: "hover-loop",
      theme: "core",
      bleed: 22,
      version: COSMETIC_ENGINE_VERSION,
      reduced_motion: "keyframe-still",
      artDirection: {
        theme: "Anel cristalino chanfrado da identidade Sanvo Core",
        palette: ["#1e1b3a", "#8a6eff", "#57dbcf", "#e0dcff"],
        silhouette: "Arco chanfrado atrás + colar cristalino frontal + prismas flutuantes + micro-telemetria",
        motion: "Levitação calma dos prismas (5s)",
        secondaryEvent: "Brilho especular percorre o arco chanfrado",
        rareEvent: "Pulso harmônico ilumina as facetas",
      },
      back: `
        <path class="avatar-art-band cos-halo-breathe" d="M4 64C12 45 33 27 61 21c16-3 30-1 35 7l-7 7c-5-5-16-6-29-3C37 37 18 50 4 68Z"/>
        <path class="avatar-art-line" d="M5 62C22 39 71 14 95 29"/>
        <path class="avatar-art-facet cos-twinkle" d="m22 40 9-8 10 1-13 7zm51-21 12 1-6 6-12 1z"/>
        <path d="M12 31l5-5m63-13 8 2" stroke="#57dbcf" stroke-width="1.2" stroke-linecap="round" opacity=".8" class="cos-led-breathe"/>
      `,
      front: `
        <path class="avatar-art-band" d="M4 66c-4 12 6 24 26 24 25 1 56-13 67-42l-2-9C83 62 52 77 27 79 14 80 6 75 4 66Z"/>
        <path class="avatar-art-line" d="M5 69C6 87 30 91 59 79c17-7 31-19 37-36"/>
        <path class="avatar-art-highlight" d="M11 79C21 85 38 84 51 81m11-5 8-5m8-5 12-13"/>
        <g class="avatar-art-motes">
          <path class="avatar-art-facet" d="m17 89 9-5 10 5-12 5zm58-15 7-12 12 3-11 9z"/>
          <path class="avatar-art-spark" d="m86 57 3-6 3 6-3 5zm-33 29 2-4 2 4-2 4z"/>
          <circle cx="38" cy="93" r="1.5" class="avatar-art-spark"/>
        </g>
        <path class="cos-glint-sweep" d="M12 84L90 42" stroke="#e0dcff" stroke-width="2.6" stroke-linecap="round"/>
      `,
    },

    "cat-gamer": {
      id: "cat-gamer",
      type: "avatar_decoration",
      name: "Companheiro Felino Cyber",
      collection: "cyber",
      animated: true,
      animation_mode: ANIMATION_MODES.IDLE_WITH_EVENTS,
      legacy_mode: "hover-loop",
      theme: "cyber",
      bleed: 26,
      version: COSMETIC_ENGINE_VERSION,
      reduced_motion: "keyframe-still",
      artDirection: {
        theme: "Headset cibernético com orelhas felinas esculpidas e acústica iluminada",
        palette: ["#141824", "#22d3ee", "#f472b6", "#e0f2fe"],
        silhouette: "Arco de headset atrás + orelhas mecânicas detalhadas no topo + conchas acústicas laterais",
        motion: "Pulso respiratório nos LEDs internos (4.8s)",
        secondaryEvent: "Orelha esquerda dá uma leve mexida orgânica",
        rareEvent: "Varredura holográfica atravessa o visor lateral",
      },
      back: `
        <path d="M12 52C12 24 27 11 50 11s38 13 38 41" fill="none" stroke="#1e2436" stroke-width="6" stroke-linecap="round"/>
        <path d="M14 48C15 24 29 13 50 13s35 11 36 35" fill="none" stroke="#22d3ee" stroke-width="1.2" stroke-dasharray="6 4" opacity=".75" class="cos-dash-flow"/>
      `,
      front: `
        <g class="cos-ear-twitch">
          <path d="M15 35L21 5l22 14c-6 3-13 7-19 13l-9 3Z" fill="#141824" stroke="#22d3ee" stroke-width="1.6" stroke-linejoin="round"/>
          <path d="M21 29L24 12l13 9c-5 2-10 5-16 8Z" fill="#f472b6" opacity=".88"/>
          <path d="M23 23l8-5M24 26l6-4" stroke="#fff1f5" stroke-width=".85" stroke-linecap="round" opacity=".8"/>
        </g>
        <g>
          <path d="M85 35L79 5 57 19c6 3 13 7 19 13l9 3Z" fill="#141824" stroke="#22d3ee" stroke-width="1.6" stroke-linejoin="round"/>
          <path d="M79 29L76 12 63 21c5 2 10 5 16 8Z" fill="#f472b6" opacity=".88"/>
          <path d="M77 23l-8-5M76 26l-6-4" stroke="#fff1f5" stroke-width=".85" stroke-linecap="round" opacity=".8"/>
        </g>
        <rect x="4" y="42" width="8.5" height="19" rx="4" fill="#141824" stroke="#22d3ee" stroke-width="1.4"/>
        <rect x="87.5" y="42" width="8.5" height="19" rx="4" fill="#141824" stroke="#22d3ee" stroke-width="1.4"/>
        <path d="M8.2 46v11M91.8 46v11" stroke="#f472b6" stroke-width="1.8" stroke-linecap="round" class="cos-led-breathe"/>
        <path d="M22 86c16 8 40 8 56 0" fill="none" stroke="#22d3ee" stroke-width="1.5" stroke-linecap="round" opacity=".78"/>
        <path class="cos-glint-sweep" d="M14 14L86 62" stroke="#e0f2fe" stroke-width="2.2" stroke-linecap="round"/>
      `,
    },

    "static-royal-crown": {
      id: "static-royal-crown",
      type: "avatar_decoration",
      name: "Coroa Imperial Filigrana",
      collection: "royal",
      animated: false,
      animation_mode: ANIMATION_MODES.STATIC,
      legacy_mode: "static",
      theme: "royal",
      bleed: 26,
      version: COSMETIC_ENGINE_VERSION,
      reduced_motion: "static-native",
      artDirection: {
        theme: "Joalheria real estática com coroa facetada e louros gravados",
        palette: ["#451a03", "#d97706", "#fde68a", "#dc2626", "#fffbeb"],
        silhouette: "Coroa imperial esculpida no topo + louros dourados abraçando a base com rubi central",
        motion: "Estática (zero animação, máximo detalhamento visual)",
      },
      back: `
        <circle cx="50" cy="50" r="45.5" fill="none" stroke="#78350f" stroke-width="4.5" opacity=".7"/>
        <path d="M20 20L15 11M35 12L33 4M65 12L67 4M80 20L85 11" stroke="#fde68a" stroke-width="1.2" stroke-linecap="round" opacity=".65"/>
        <path d="M11 66C5 49 7 32 18 18M89 66C95 49 93 32 82 18" fill="none" stroke="#b45309" stroke-width="2.6" stroke-linecap="round"/>
      `,
      front: `
        <path d="M27 19L30 6l11 8 9-12 9 12 11-8 3 13c-14-3-32-3-46 0Z" fill="#f59e0b" stroke="#78350f" stroke-width="1.4" stroke-linejoin="round"/>
        <path d="M30 16l2-7 9 7 9-10 9 10 9-7 2 7" fill="none" stroke="#fef3c7" stroke-width="1.1" stroke-linejoin="round"/>
        <polygon points="50,7 53,11 50,15 47,11" fill="#dc2626" stroke="#fef3c7" stroke-width=".6"/>
        <circle cx="38" cy="13" r="1.4" fill="#fffbeb"/>
        <circle cx="62" cy="13" r="1.4" fill="#fffbeb"/>
        <path d="M13 68c9 18 26 26 37 26s28-8 37-26" fill="none" stroke="#f59e0b" stroke-width="2.4" stroke-linecap="round"/>
        <path d="M17 72l-5-3m9 9l-5-2m10 8l-4-1M83 72l5-3m-9 9l5-2m-10 8l4-1" stroke="#fde68a" stroke-width="1.8" stroke-linecap="round"/>
        <polygon points="50,89 54,93 50,97 46,93" fill="#fde68a" stroke="#78350f" stroke-width="1"/>
      `,
    },

    "static-emerald": {
      id: "static-emerald",
      type: "avatar_decoration",
      name: "Botânica Esmeralda",
      collection: "royal",
      animated: false,
      animation_mode: ANIMATION_MODES.STATIC,
      legacy_mode: "static",
      theme: "emerald",
      bleed: 24,
      version: COSMETIC_ENGINE_VERSION,
      reduced_motion: "static-native",
      artDirection: {
        theme: "Vinhas botânicas esculpidas com cristais esmeralda e fechos dourados",
        palette: ["#064e3b", "#10b981", "#6ee7b7", "#fde68a"],
        silhouette: "Folhagem profunda atrás + ramos entrelaçados e gemas facetadas na frente",
        motion: "Estática (detalhamento ilustrativo de alta definição)",
      },
      back: `
        <path d="M10 48C6 29 19 12 38 8c-6 8-8 17-5 27M90 48c4-19-9-36-28-40 6 8 8 17 5 27" fill="#065f46" stroke="#34d399" stroke-width=".9" opacity=".88"/>
        <circle cx="50" cy="50" r="44.5" fill="none" stroke="#065f46" stroke-width="3.2"/>
      `,
      front: `
        <path d="M12 64c9 21 26 29 38 29s29-8 38-29" fill="none" stroke="#059669" stroke-width="2.4" stroke-linecap="round"/>
        <path d="M16 68c-7-4-8-11-2-14 4 3 6 9 2 14Zm13 14c-7-1-10-7-6-11 5 1 8 6 6 11Zm55-14c7-4 8-11 2-14-4 3-6 9-2 14Zm-13 14c7-1 10-7 6-11-5 1-8 6-6 11Z" fill="#10b981" stroke="#a7f3d0" stroke-width=".85"/>
        <path d="M44 91c3-4 9-4 12 0" fill="none" stroke="#fde68a" stroke-width="1.6" stroke-linecap="round"/>
        <polygon points="50,84 55,91 50,97 45,91" fill="#34d399" stroke="#ecfdf5" stroke-width=".9"/>
        <polygon points="18,22 22,26 18,30 14,26" fill="#6ee7b7" stroke="#065f46" stroke-width=".8"/>
        <polygon points="82,22 86,26 82,30 78,26" fill="#6ee7b7" stroke="#065f46" stroke-width=".8"/>
      `,
    },

    "frost-crown": {
      id: "frost-crown",
      type: "avatar_decoration",
      name: "Diadema Glacial",
      collection: "frost",
      animated: true,
      animation_mode: ANIMATION_MODES.IDLE_WITH_EVENTS,
      legacy_mode: "hover-loop",
      theme: "frost",
      bleed: 26,
      version: COSMETIC_ENGINE_VERSION,
      reduced_motion: "keyframe-still",
      artDirection: {
        theme: "Cristais de gelo facetados com diadema hexagonal",
        palette: ["#0c4a6e", "#38bdf8", "#bae6fd", "#ffffff"],
        silhouette: "Lâminas cristalinas atrás + floco hexagonal esculpido no topo + filigrana gélida na base",
        motion: "Brilho cristalino calmo",
        secondaryEvent: "Reflexo prismático percorre os cristais",
        rareEvent: "Cintilação de estrelas de neve",
      },
      back: `
        <path d="M24 20l5-14 8 10 13-13 13 13 8-10 5 14" fill="#0ea5e9" fill-opacity=".35" stroke="#bae6fd" stroke-width="1.1" stroke-linejoin="round" class="cos-halo-breathe"/>
        <circle cx="50" cy="50" r="44" fill="none" stroke="#38bdf8" stroke-width="2" opacity=".55" class="cos-led-breathe"/>
      `,
      front: `
        <g transform="translate(50 11)">
          <g class="cos-crystal-shimmer">
            <path d="M0-9v18M-8-4.5l16 9M8-4.5l-16 9" stroke="#e0f2fe" stroke-width="1.6" stroke-linecap="round"/>
            <polygon points="0,-5 4.3,-2.5 4.3,2.5 0,5 -4.3,2.5 -4.3,-2.5" fill="#7dd3fc" stroke="#ffffff" stroke-width=".8"/>
          </g>
        </g>
        <path d="M11 64c9 21 25 29 39 29s30-8 39-29" fill="none" stroke="#bae6fd" stroke-width="2" stroke-linecap="round"/>
        <polygon points="15,69 19,73 15,79 11,73" fill="#e0f2fe" stroke="#0284c7" stroke-width=".7"/>
        <polygon points="85,69 89,73 85,79 81,73" fill="#e0f2fe" stroke="#0284c7" stroke-width=".7"/>
        <g class="avatar-art-motes">
          <path class="avatar-art-spark" d="M50 88l1.6-4.5 1.6 4.5 4.5 1.6-4.5 1.6-1.6 4.5-1.6-4.5-4.5-1.6Z" fill="#ffffff"/>
          <circle cx="29" cy="86" r="1.4" fill="#bae6fd" class="cos-twinkle"/>
          <circle cx="71" cy="86" r="1.4" fill="#bae6fd" class="cos-twinkle cos-d2"/>
        </g>
        <path class="cos-glint-sweep" d="M22 10L78 86" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round"/>
      `,
    },

    "dragon-fire": {
      id: "dragon-fire",
      type: "avatar_decoration",
      name: "Fênix & Brasas",
      collection: "inferno",
      animated: true,
      animation_mode: ANIMATION_MODES.IDLE_WITH_EVENTS,
      legacy_mode: "hover-loop",
      theme: "inferno",
      bleed: 26,
      version: COSMETIC_ENGINE_VERSION,
      reduced_motion: "keyframe-still",
      artDirection: {
        theme: "Plumas de fênix em obsidiana e ouro fundido com brasas vivas",
        palette: ["#450a0a", "#ea580c", "#fb923c", "#fde047"],
        silhouette: "Plumas incandescentes subindo por trás + crista de escamas douradas abraçando a base",
        motion: "Elevação térmica suave de brasas",
        secondaryEvent: "Clarão âmbar atravessa a crista dourada",
        rareEvent: "Fagulhas extras sobem pela lateral",
      },
      back: `
        <path class="cos-flame-breathe" d="M12 62C4 43 9 22 25 10c-3 10-1 18 4 24M88 62c8-19 3-40-13-52 3 10 1 18-4 24" fill="#9a3412" stroke="#fb923c" stroke-width="1.2" opacity=".88"/>
        <path class="cos-halo-breathe" d="M22 24C26 11 38 4 50 3c12 1 24 8 28 21-9-8-18-11-28-11s-19 3-28 11Z" fill="#ea580c" opacity=".55"/>
      `,
      front: `
        <path d="M9 63c8 22 25 32 41 32s33-10 41-32c-10 14-24 22-41 22S19 77 9 63Z" fill="#431407" stroke="#fb923c" stroke-width="1.3"/>
        <path d="M20 79l7-4 7 6 8-5 8 5 8-5 7 6 7-4" fill="none" stroke="#fde047" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        <polygon points="50,82 55,90 50,97 45,90" fill="#fb923c" stroke="#fef08a" stroke-width=".9"/>
        <g class="avatar-art-motes">
          <circle cx="14" cy="40" r="1.8" fill="#fde047" class="cos-ember-float"/>
          <circle cx="86" cy="36" r="1.5" fill="#fb923c" class="cos-ember-float cos-d2"/>
          <circle cx="24" cy="84" r="1.4" fill="#fef08a" class="cos-twinkle"/>
          <circle cx="76" cy="84" r="1.4" fill="#fef08a" class="cos-twinkle cos-d1"/>
        </g>
        <path class="cos-glint-sweep" d="M16 80L84 68" stroke="#fef08a" stroke-width="2.4" stroke-linecap="round"/>
      `,
    },

    "angel-wings": {
      id: "angel-wings",
      type: "avatar_decoration",
      name: "Auréola Serafim",
      collection: "seraphim",
      animated: true,
      animation_mode: ANIMATION_MODES.IDLE_WITH_EVENTS,
      legacy_mode: "hover-loop",
      theme: "seraphim",
      bleed: 28,
      version: COSMETIC_ENGINE_VERSION,
      reduced_motion: "keyframe-still",
      back: `
        <defs>
          <linearGradient id="cos-ser-w" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#ffffff"/>
            <stop offset="55%" stop-color="#fef3c7"/>
            <stop offset="100%" stop-color="#f59e0b"/>
          </linearGradient>
          <radialGradient id="cos-ser-glow" cx="50%" cy="28%" r="60%">
            <stop offset="0%" stop-color="#fef08a" stop-opacity=".55"/>
            <stop offset="100%" stop-color="#f59e0b" stop-opacity="0"/>
          </radialGradient>
        </defs>
        <circle cx="50" cy="48" r="47" fill="url(#cos-ser-glow)" class="cos-halo-breathe"/>
        <g class="cos-wing-sway-l">
          <path d="M16 42C2 32-1 17 11 12c2 8 6 13 13 17C11 32 7 39 14 48c-8 1-10 9-3 14 4 2 9 2 14-1" fill="url(#cos-ser-w)" fill-opacity=".86" stroke="#fffbeb" stroke-width="1"/>
          <path d="M9 22c3 7 8 11 14 14M6 36c4 4 9 7 15 8" stroke="#d97706" stroke-width=".75" opacity=".55"/>
        </g>
        <g class="cos-wing-sway-r">
          <path d="M84 42c14-10 17-25 5-30-2 8-6 13-13 17 13 3 17 10 10 19 8 1 10 9 3 14-4 2-9 2-14-1" fill="url(#cos-ser-w)" fill-opacity=".86" stroke="#fffbeb" stroke-width="1"/>
          <path d="M91 22c-3 7-8 11-14 14M94 36c-4 4-9 7-15 8" stroke="#d97706" stroke-width=".75" opacity=".55"/>
        </g>
      `,
      front: `
        <ellipse cx="50" cy="8.5" rx="23" ry="5.2" fill="none" stroke="#fde68a" stroke-width="2.6" class="cos-halo-breathe"/>
        <ellipse cx="50" cy="8.5" rx="23" ry="5.2" fill="none" stroke="#ffffff" stroke-width=".95" opacity=".88"/>
        <path d="M14 66c9 19 24 27 36 27s27-8 36-27" fill="none" stroke="#fde68a" stroke-width="1.8" stroke-linecap="round" opacity=".9"/>
        <path d="M24 81c9 7 18 10 26 10s17-3 26-10" fill="none" stroke="#ffffff" stroke-width=".9" stroke-linecap="round" opacity=".75"/>
        <polygon points="50,86 54.5,91.5 50,97 45.5,91.5" fill="#fef3c7" stroke="#d97706" stroke-width=".9"/>
        <path class="cos-glint-sweep" d="M22 8L78 88" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round"/>
      `,
    },

    "blood-moon": {
      id: "blood-moon",
      type: "avatar_decoration",
      name: "Eclipse Escarlate",
      collection: "eclipse",
      animated: true,
      animation_mode: ANIMATION_MODES.IDLE_WITH_EVENTS,
      legacy_mode: "hover-loop",
      theme: "eclipse",
      bleed: 26,
      version: COSMETIC_ENGINE_VERSION,
      reduced_motion: "keyframe-still",
      back: `
        <defs>
          <radialGradient id="cos-ecl-bg" cx="50%" cy="22%" r="64%">
            <stop offset="0%" stop-color="#f43f5e" stop-opacity=".6"/>
            <stop offset="55%" stop-color="#7f1d1d" stop-opacity=".35"/>
            <stop offset="100%" stop-color="#000" stop-opacity="0"/>
          </radialGradient>
        </defs>
        <circle cx="50" cy="48" r="48" fill="url(#cos-ecl-bg)" class="cos-halo-breathe"/>
        <circle cx="50" cy="50" r="45.5" fill="none" stroke="#be123c" stroke-width="3.2" opacity=".82"/>
        <path d="M16 24C24 10 37 4 50 4s26 6 34 20" fill="none" stroke="#fde68a" stroke-width="1.4" stroke-dasharray="5 3" class="cos-dash-flow"/>
      `,
      front: `
        <g transform="translate(50 11)">
          <circle cx="0" cy="0" r="9.5" fill="#0c0a12" stroke="#fde68a" stroke-width="1.6"/>
          <path d="M-9.5 0a9.5 9.5 0 0 1 19 0" fill="none" stroke="#fb7185" stroke-width="1.8" class="cos-led-breathe"/>
          <path d="M-16 2l6-2M16 2l-6-2M0-13v4" stroke="#fde68a" stroke-width="1.2" stroke-linecap="round"/>
        </g>
        <path d="M10 62c8 22 25 32 40 32s32-10 40-32c-10 15-24 23-40 23S20 77 10 62Z" fill="#180a10" fill-opacity=".86" stroke="#fb7185" stroke-width="1.2"/>
        <path d="M22 81c10 7 20 9 28 9s18-2 28-9" fill="none" stroke="#fde68a" stroke-width="1.1" stroke-linecap="round"/>
        <polygon points="50,84 54.5,90 50,96 45.5,90" fill="#f43f5e" stroke="#fef3c7" stroke-width=".9"/>
        <path class="cos-glint-sweep" d="M16 74L84 22" stroke="#fef3c7" stroke-width="2.2" stroke-linecap="round"/>
      `,
    },

    "ocean-bubbles": {
      id: "ocean-bubbles",
      type: "avatar_decoration",
      name: "Abismo Nacarado",
      collection: "ocean",
      animated: true,
      animation_mode: ANIMATION_MODES.IDLE_WITH_EVENTS,
      legacy_mode: "hover-loop",
      theme: "ocean",
      bleed: 26,
      version: COSMETIC_ENGINE_VERSION,
      reduced_motion: "keyframe-still",
      back: `
        <defs>
          <linearGradient id="cos-ocn-w" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#0ea5e9" stop-opacity=".42"/>
            <stop offset="60%" stop-color="#14b8a6" stop-opacity=".68"/>
            <stop offset="100%" stop-color="#0c4a6e" stop-opacity=".2"/>
          </linearGradient>
        </defs>
        <path class="cos-halo-breathe" d="M6 58C4 28 24 8 50 8s46 20 44 50c-6-22-22-34-44-34S12 36 6 58Z" fill="url(#cos-ocn-w)"/>
        <circle cx="50" cy="50" r="44.5" fill="none" stroke="#2dd4bf" stroke-width="1.8" opacity=".65"/>
      `,
      front: `
        <path class="cos-scarf-sway" d="M8 62c9 22 25 32 42 32s33-10 42-32c-10 13-22 20-42 20S18 75 8 62Z" fill="#083344" fill-opacity=".84" stroke="#5eead4" stroke-width="1.3"/>
        <path d="M16 74c12 10 24 14 34 14s22-4 34-14" fill="none" stroke="#e0f2fe" stroke-width="1.4" stroke-linecap="round" opacity=".88"/>
        <circle cx="50" cy="89" r="4.4" fill="#ecfeff" stroke="#2dd4bf" stroke-width="1.2"/>
        <circle cx="48.6" cy="87.6" r="1.4" fill="#ffffff"/>
        <circle cx="24" cy="82" r="2.2" fill="#a5f3fc" class="cos-twinkle"/>
        <circle cx="76" cy="82" r="2.2" fill="#a5f3fc" class="cos-twinkle cos-d2"/>
        <path class="cos-glint-sweep" d="M14 70L86 38" stroke="#ecfeff" stroke-width="2.2" stroke-linecap="round"/>
      `,
    },

    "electric-pulse": {
      id: "electric-pulse",
      type: "avatar_decoration",
      name: "Selo Arcano",
      collection: "arcane",
      animated: true,
      animation_mode: ANIMATION_MODES.IDLE_WITH_EVENTS,
      legacy_mode: "hover-loop",
      theme: "arcane",
      bleed: 26,
      version: COSMETIC_ENGINE_VERSION,
      reduced_motion: "keyframe-still",
      back: `
        <defs>
          <radialGradient id="cos-arc-g" cx="50%" cy="50%" r="52%">
            <stop offset="68%" stop-color="#7c3aed" stop-opacity=".18"/>
            <stop offset="92%" stop-color="#c084fc" stop-opacity=".46"/>
            <stop offset="100%" stop-color="#000" stop-opacity="0"/>
          </radialGradient>
        </defs>
        <circle cx="50" cy="50" r="49" fill="url(#cos-arc-g)" class="cos-halo-breathe"/>
        <circle cx="50" cy="50" r="46.5" fill="none" stroke="#a855f7" stroke-width="1.5" stroke-dasharray="8 4 2 4" class="cos-dash-flow"/>
        <circle cx="50" cy="50" r="42.5" fill="none" stroke="#fde68a" stroke-width=".9" opacity=".7"/>
      `,
      front: `
        <g class="cos-crystal-shimmer" transform="translate(50 8)">
          <polygon points="0,-7 6,0 0,7 -6,0" fill="#a855f7" stroke="#fde68a" stroke-width="1.1"/>
          <polygon points="0,-3.5 3,0 0,3.5 -3,0" fill="#fef9c3"/>
        </g>
        <path d="M12 64c9 21 25 29 38 29s29-8 38-29" fill="none" stroke="#c084fc" stroke-width="1.9" stroke-linecap="round"/>
        <path d="M22 81l8-4 8 5 12-5 12 5 8-5 8 4" fill="none" stroke="#fde68a" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round" opacity=".88"/>
        <polygon points="13,48 17,44 21,48 17,52" fill="#e9d5ff" stroke="#7c3aed" stroke-width=".7" class="cos-twinkle"/>
        <polygon points="79,48 83,44 87,48 83,52" fill="#e9d5ff" stroke="#7c3aed" stroke-width=".7" class="cos-twinkle cos-d2"/>
        <path class="cos-glint-sweep" d="M14 26L86 78" stroke="#fef9c3" stroke-width="2.2" stroke-linecap="round"/>
      `,
    },

    "cyber-ring": {
      id: "cyber-ring",
      type: "avatar_decoration",
      name: "Valsa Synthwave",
      collection: "synth",
      animated: true,
      animation_mode: ANIMATION_MODES.IDLE_WITH_EVENTS,
      legacy_mode: "hover-loop",
      theme: "synth",
      bleed: 24,
      version: COSMETIC_ENGINE_VERSION,
      reduced_motion: "keyframe-still",
      back: `
        <defs>
          <linearGradient id="cos-syn-g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#f472b6"/>
            <stop offset="50%" stop-color="#a855f7"/>
            <stop offset="100%" stop-color="#22d3ee"/>
          </linearGradient>
        </defs>
        <circle cx="50" cy="50" r="46" fill="none" stroke="url(#cos-syn-g)" stroke-width="3.2" stroke-dasharray="26 8 6 8" class="cos-dash-flow"/>
        <circle cx="50" cy="50" r="49" fill="none" stroke="#22d3ee" stroke-width="1" stroke-dasharray="4 6" opacity=".68"/>
      `,
      front: `
        <path d="M15 24l9-10h52l9 10" fill="none" stroke="#f472b6" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M14 74l10 12h52l10-12" fill="none" stroke="#22d3ee" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
        <rect x="34" y="9" width="32" height="4.5" rx="2" fill="#181228" stroke="#22d3ee" stroke-width="1"/>
        <path d="M38 11.2h24" stroke="#f472b6" stroke-width="1.8" stroke-linecap="round" class="cos-led-breathe"/>
        <polygon points="50,86 55,91 50,96 45,91" fill="#22d3ee" stroke="#fdf4ff" stroke-width=".9"/>
        <path class="cos-glint-sweep" d="M14 82L86 18" stroke="#ffffff" stroke-width="2.4" stroke-linecap="round"/>
      `,
    },

    lunar: {
      id: "lunar",
      type: "avatar_decoration",
      name: "Sonho Etéreo",
      collection: "dream",
      animated: true,
      animation_mode: ANIMATION_MODES.IDLE_WITH_EVENTS,
      legacy_mode: "hover-loop",
      theme: "dream",
      bleed: 26,
      version: COSMETIC_ENGINE_VERSION,
      reduced_motion: "keyframe-still",
      back: `
        <defs>
          <linearGradient id="cos-drm-g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#c4b5fd" stop-opacity=".55"/>
            <stop offset="50%" stop-color="#a7f3d0" stop-opacity=".4"/>
            <stop offset="100%" stop-color="#fbcfe8" stop-opacity=".5"/>
          </linearGradient>
        </defs>
        <circle cx="50" cy="50" r="46.5" fill="none" stroke="url(#cos-drm-g)" stroke-width="3.6" class="cos-halo-breathe"/>
        <path d="M15 20a13 13 0 1 0 11 21a10.5 10.5 0 1 1-11-21Z" fill="#fef08a" stroke="#ffffff" stroke-width=".6"/>
      `,
      front: `
        <path class="cos-scarf-sway" d="M10 66c8 18 23 26 40 26s32-8 40-26c-11 11-23 16-40 16S21 77 10 66Z" fill="#2e1065" fill-opacity=".68" stroke="#ddd6fe" stroke-width="1.2"/>
        <path d="M22 81c10 6 19 8 28 8s18-2 28-8" fill="none" stroke="#a7f3d0" stroke-width="1.4" stroke-linecap="round"/>
        <path d="M80 18l1.6-5 1.6 5 5 1.6-5 1.6-1.6 5-1.6-5-5-1.6Z" fill="#fef08a" class="cos-twinkle"/>
        <circle cx="24" cy="84" r="1.8" fill="#fbcfe8" class="cos-twinkle cos-d1"/>
        <circle cx="76" cy="84" r="1.8" fill="#a7f3d0" class="cos-twinkle cos-d3"/>
        <path class="cos-glint-sweep" d="M16 20L84 82" stroke="#f5f3ff" stroke-width="2.2" stroke-linecap="round"/>
      `,
    },

    "static-cyber-hud": {
      id: "static-cyber-hud",
      type: "avatar_decoration",
      name: "Chassi Tático Ônix",
      collection: "cyber",
      animated: false,
      animation_mode: ANIMATION_MODES.STATIC,
      legacy_mode: "static",
      theme: "cyber",
      bleed: 24,
      version: COSMETIC_ENGINE_VERSION,
      reduced_motion: "static-native",
      back: `
        <circle cx="50" cy="50" r="45.5" fill="none" stroke="#0f172a" stroke-width="4.5"/>
        <circle cx="50" cy="50" r="45.5" fill="none" stroke="#22d3ee" stroke-width="1.2" stroke-dasharray="16 6 4 6" opacity=".82"/>
      `,
      front: `
        <path d="M14 26L22 14h14M86 26L78 14H64M14 74l8 12h14M86 74l-8 12H64" fill="none" stroke="#38bdf8" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
        <rect x="42" y="7" width="16" height="4" rx="1.5" fill="#083344" stroke="#67e8f9" stroke-width="1"/>
        <rect x="42" y="89" width="16" height="4" rx="1.5" fill="#083344" stroke="#67e8f9" stroke-width="1"/>
      `,
    },

    "static-diamond": {
      id: "static-diamond",
      type: "avatar_decoration",
      name: "Relíquia Diamante",
      collection: "frost",
      animated: false,
      animation_mode: ANIMATION_MODES.STATIC,
      legacy_mode: "static",
      theme: "frost",
      bleed: 24,
      version: COSMETIC_ENGINE_VERSION,
      reduced_motion: "static-native",
      back: `
        <circle cx="50" cy="50" r="44.5" fill="none" stroke="#0284c7" stroke-width="2.8" opacity=".75"/>
        <circle cx="50" cy="50" r="47.5" fill="none" stroke="#bae6fd" stroke-width="1" stroke-dasharray="5 3"/>
      `,
      front: `
        <polygon points="50,1 57,9 50,17 43,9" fill="#e0f2fe" stroke="#0284c7" stroke-width="1"/>
        <polygon points="50,4 54,9 50,14 46,9" fill="#ffffff"/>
        <polygon points="50,83 56,90 50,97 44,90" fill="#bae6fd" stroke="#0369a1" stroke-width="1"/>
        <polygon points="2,50 9,44 16,50 9,56" fill="#7dd3fc" stroke="#e0f2fe" stroke-width=".9"/>
        <polygon points="84,50 91,44 98,50 91,56" fill="#7dd3fc" stroke="#e0f2fe" stroke-width=".9"/>
      `,
    },
  };

  // ===========================================================================
  // 2. PROFILE FRAMES — Molduras arquitetônicas responsivas por contexto
  // ===========================================================================
  const PROFILE_FRAMES_V3 = {
    "core-pulse": {
      id: "core-pulse",
      type: "profile_frame",
      name: "Arquitetura Sanvo Core",
      collection: "sancord-core",
      animated: true,
      animation_mode: ANIMATION_MODES.IDLE_WITH_EVENTS,
      legacy_mode: "loop",
      theme: "core",
      version: COSMETIC_ENGINE_VERSION,
      reduced_motion: "keyframe-still",
      artDirection: {
        theme: "Chassi cristalino chanfrado Sanvo Core",
        palette: ["#8a6eff", "#57dbcf", "#e0dcff"],
        silhouette: "Cantos chanfrados com incrustação + crista superior em diamante + trilhos de telemetria",
        motion: "Pulso discreto nos nós de energia; estrutura permanece sólida",
        secondaryEvent: "Sinal luminoso percorre os trilhos laterais",
      },
      cornerSvg: `
        <path class="frame-inlay" d="M1 36V10l9-9h46l-10 9H21L10 21v25Z"/>
        <path d="M1 48V10l9-9h44M10 38V20l10-10h26M18 45V28l10-10h11"/>
        <path class="frame-detail" d="m29 20 7-4 5 2-6 6zm-19 23 3-5 3 5-3 5z"/>
        <circle cx="15" cy="15" r="2.2" class="frame-node"/>
      `,
      crestSvg: `
        <path class="frame-inlay" d="M4 2h92l-10 10H14Z"/>
        <path d="M12 2h76l-8 8H20Z" stroke="var(--art-edge)" stroke-width="1.2"/>
        <polygon points="50,1 57,7 50,13 43,7" class="frame-detail"/>
      `,
      bottomSealSvg: `<path d="M16 6h68M36 2l14 7 14-7" stroke="var(--art-edge)" stroke-width="1.1"/><circle cx="50" cy="6" r="2" class="frame-detail"/>`,
    },

    "cosmic-drift": {
      id: "cosmic-drift",
      type: "profile_frame",
      name: "Observatório Celeste",
      collection: "cosmic",
      animated: true,
      animation_mode: ANIMATION_MODES.IDLE_WITH_EVENTS,
      legacy_mode: "loop",
      theme: "cosmic",
      version: COSMETIC_ENGINE_VERSION,
      reduced_motion: "keyframe-still",
      artDirection: {
        theme: "Astrolábio celeste com constelações gravadas",
        palette: ["#6366f1", "#7abaff", "#fde68a", "#e0dcff"],
        silhouette: "Arcos de astrolábio nos cantos + crescente com bússola no topo + estrelas incrustadas",
        motion: "Cintilação calma de estrelas específicas",
        secondaryEvent: "Reflexo estelar percorre o topo da moldura",
      },
      cornerSvg: `
        <path class="frame-inlay" d="M1 42C2 12 18 2 50 2 29 7 17 18 11 35l-8 14Z"/>
        <path d="M1 46C1 16 17 2 53 2M7 42C11 18 21 11 41 8M13 47q8-20 19-24"/>
        <path class="frame-detail" d="m22 17 2-6 2 6 6 2-6 2-2 6-2-6-6-2zm18-9 2-5 2 5-2 4z"/>
        <circle cx="11" cy="31" r="1.7" class="frame-node"/>
      `,
      crestSvg: `
        <path d="M8 6C26 2 74 2 92 6" stroke="var(--art-edge)" stroke-width="1.2"/>
        <path d="M50 1l3 5 6 1-4.5 3.5L56 16l-6-3-6 3 1.5-5.5L41 7l6-1Z" class="frame-detail"/>
        <circle cx="26" cy="6" r="1.6" class="frame-node"/>
        <circle cx="74" cy="6" r="1.6" class="frame-node"/>
      `,
      bottomSealSvg: `<path d="M12 6C30 9 70 9 88 6" stroke="var(--art-edge)" stroke-width="1"/><polygon points="50,2 54,6 50,10 46,6" class="frame-detail"/>`,
    },

    "sakura-wind": {
      id: "sakura-wind",
      type: "profile_frame",
      name: "Pavilhão de Sakura",
      collection: "sakura",
      animated: true,
      animation_mode: ANIMATION_MODES.IDLE_WITH_EVENTS,
      legacy_mode: "hover-loop",
      theme: "sakura",
      version: COSMETIC_ENGINE_VERSION,
      reduced_motion: "keyframe-still",
      artDirection: {
        theme: "Galhos de cerejeira e treliça delicada nos cantos",
        palette: ["#e78faf", "#ffe3ee", "#ffd3bd"],
        silhouette: "Cantos em arco floral com flores 5 pétalas + crista de flor no topo + pétalas suaves laterais",
        motion: "Balanço discreto nas pétalas da lateral",
        secondaryEvent: "Pétala leve atravessa o canto superior",
      },
      cornerSvg: `
        <path class="frame-inlay" d="M2 38C10 14 23 5 54 2 28 14 18 25 8 48Z"/>
        <path d="M2 49C4 18 24 6 53 2M8 38q8-15 26-22"/>
        <path class="frame-detail" d="M18 25C9 25 9 16 14 14l3 4 4-3c6 4 3 8-3 10Zm9-8c-3-7 3-13 8-11l-1 4 5 1c0 6-7 7-12 6Zm-16 24c0-8 6-10 10-7-1 5-6 9-10 7Z"/>
      `,
      crestSvg: `
        <path d="M14 5C34 2 66 2 86 5" stroke="var(--art-edge)" stroke-width="1.1"/>
        <g transform="translate(50 7)">
          <path d="M0-6c2 0 4 2 1.5 4 3-.6 5 1.5 3.5 3.5-1.5 2-4.5 1.5-5-.8-.8 2.8-4.2 2.8-5 .8-1.5-2 .5-4 3.5-3.5C-4-4-2-6 0-6Z" class="frame-detail"/>
        </g>
      `,
      bottomSealSvg: `<path d="M22 6C38 9 62 9 78 6" stroke="var(--art-edge)" stroke-width="1"/><circle cx="50" cy="6" r="2.2" class="frame-detail"/>`,
    },

    royal: {
      id: "royal",
      type: "profile_frame",
      name: "Filigrana Imperial",
      collection: "royal",
      animated: false,
      animation_mode: ANIMATION_MODES.STATIC,
      legacy_mode: "static",
      theme: "royal",
      version: COSMETIC_ENGINE_VERSION,
      reduced_motion: "static-native",
      artDirection: {
        theme: "Ouro barroco gravado estático com joias lapidadas",
        palette: ["#b45309", "#f59e0b", "#fef3c7"],
        silhouette: "Cantos em arabesco dourado + crista real com gema central + fecho simétrico inferior",
        motion: "Estática — elegância pura em qualquer screenshot",
      },
      cornerSvg: `
        <path class="frame-inlay" d="M2 42V8l6-6h34C27 7 15 17 8 34Z"/>
        <path d="M2 48V6l4-4h44M8 40V14l6-6h26M14 26c0-7 5-12 12-12"/>
        <polygon points="14,14 19,14 14,19 9,14" class="frame-detail"/>
        <circle cx="28" cy="8" r="1.8" class="frame-detail"/>
        <circle cx="8" cy="28" r="1.8" class="frame-detail"/>
      `,
      crestSvg: `
        <path class="frame-inlay" d="M18 3h64l-8 8H26Z"/>
        <path d="M36 10l4-8 10 6 10-6 4 8Z" class="frame-detail"/>
        <circle cx="50" cy="8" r="2.2" fill="#dc2626"/>
      `,
      bottomSealSvg: `<path d="M14 6h72M42 3l8 7 8-7" stroke="var(--art-lit)" stroke-width="1.2"/><polygon points="50,2 54,6 50,10 46,6" class="frame-detail"/>`,
    },

    "frost-glint": {
      id: "frost-glint",
      type: "profile_frame",
      name: "Palácio de Cristal",
      collection: "frost",
      animated: true,
      animation_mode: ANIMATION_MODES.IDLE_WITH_EVENTS,
      legacy_mode: "loop",
      theme: "frost",
      version: COSMETIC_ENGINE_VERSION,
      reduced_motion: "keyframe-still",
      artDirection: {
        theme: "Aglomerados de cristais de gelo lapidados",
        palette: ["#38bdf8", "#bae6fd", "#ffffff"],
        silhouette: "Pontas de cristal nos 4 cantos + floco hexagonal no topo + trilhos gélidos",
        motion: "Cintilação discreta nas facetas de gelo",
        secondaryEvent: "Brilho diamante percorre os cantos",
      },
      cornerSvg: `
        <path class="frame-inlay" d="M2 38L8 16l8-8L38 2 24 14l-10 10Z"/>
        <path d="M2 46V12l10-10h34M8 34l8-18 18-8M14 14l10 10"/>
        <polygon points="12,12 18,9 15,15 9,18" class="frame-detail"/>
        <circle cx="26" cy="8" r="1.6" class="frame-node"/>
      `,
      crestSvg: `
        <path d="M16 6h68" stroke="var(--art-edge)" stroke-width="1"/>
        <polygon points="50,1 55,6 50,12 45,6" class="frame-detail"/>
        <path d="M40 6h20M46 2l8 8M54 2l-8 8" stroke="var(--art-lit)" stroke-width=".9"/>
      `,
      bottomSealSvg: `<path d="M20 6h60" stroke="var(--art-edge)" stroke-width="1"/><polygon points="50,3 54,6 50,9 46,6" class="frame-detail"/>`,
    },

    "cyber-corners": {
      id: "cyber-corners",
      type: "profile_frame",
      name: "Chassi Tático HUD",
      collection: "cyber",
      animated: false,
      animation_mode: ANIMATION_MODES.STATIC,
      legacy_mode: "static",
      theme: "cyber",
      version: COSMETIC_ENGINE_VERSION,
      reduced_motion: "static-native",
      artDirection: {
        theme: "Chassi sci-fi técnico estático com calibração de precisão",
        palette: ["#0891b2", "#22d3ee", "#e0f2fe"],
        silhouette: "Suportes angulados nos cantos + régua de calibração + barra de sensores no topo",
        motion: "Estática — precisão industrial limpa",
      },
      cornerSvg: `
        <path class="frame-inlay" d="M1 30V7l6-6h23l-5 5H8l-2 2v17Z"/>
        <path d="M1 44V7l6-6h38M7 32V12l5-5h20M2 36h5M36 2v5"/>
        <rect x="10" y="10" width="4" height="4" class="frame-detail"/>
      `,
      crestSvg: `
        <path d="M12 4h22l4 5h24l4-5h22" stroke="var(--art-edge)" stroke-width="1.3"/>
        <rect x="44" y="4" width="12" height="3" rx="1" class="frame-detail"/>
      `,
      bottomSealSvg: `<path d="M24 6h52M38 3v6M62 3v6" stroke="var(--art-edge)" stroke-width="1.1"/>`,
    },

    "ember-trail": {
      id: "ember-trail",
      type: "profile_frame",
      name: "Forja Obsidiana",
      collection: "inferno",
      animated: true,
      animation_mode: ANIMATION_MODES.IDLE_WITH_EVENTS,
      legacy_mode: "loop",
      theme: "inferno",
      version: COSMETIC_ENGINE_VERSION,
      reduced_motion: "keyframe-still",
      artDirection: {
        theme: "Ferro forjado com veios incandescentes de magma",
        palette: ["#7f1d1d", "#f97316", "#fde047"],
        silhouette: "Cantos de ferro chanfrado + rachaduras incandescentes + emblema de forja no topo",
        motion: "Respiração lenta de calor nos veios de magma",
        secondaryEvent: "Pulso térmico acende os nós dos cantos",
      },
      cornerSvg: `
        <path class="frame-inlay" d="M1 38V8l7-7h30l-9 9H14l-4 4v15Z"/>
        <path d="M1 46V8l7-7h38M8 34l6-12 10-8 14-5"/>
        <path class="frame-detail" d="M12 24l4-7 7-5-3 6-4 4Z"/>
        <circle cx="13" cy="13" r="2" class="frame-node"/>
      `,
      crestSvg: `
        <path class="frame-inlay" d="M24 2h52l-10 9H34Z"/>
        <polygon points="50,1 56,7 50,12 44,7" class="frame-detail"/>
      `,
      bottomSealSvg: `<path d="M18 6h64" stroke="var(--art-edge)" stroke-width="1.3"/><polygon points="50,2 55,6 50,10 45,6" class="frame-detail"/>`,
    },

    liquid: {
      id: "liquid",
      type: "profile_frame",
      name: "Maré Abissal",
      collection: "ocean",
      animated: true,
      animation_mode: ANIMATION_MODES.IDLE_WITH_EVENTS,
      legacy_mode: "loop",
      theme: "ocean",
      version: COSMETIC_ENGINE_VERSION,
      reduced_motion: "keyframe-still",
      artDirection: {
        theme: "Ondas de vidro marinho com pérolas e reflexo cáustico",
        palette: ["#0369a1", "#2dd4bf", "#a5f3fc"],
        silhouette: "Curvas fluidas de onda nos cantos + concha estilizada no topo + gotículas nacaradas",
        motion: "Ondulação suave nos reflexos de luz",
        secondaryEvent: "Cintilação de pérola nos cantos",
      },
      cornerSvg: `
        <path class="frame-inlay" d="M2 40C4 16 17 4 42 2c-16 8-26 19-32 38Z"/>
        <path d="M2 46C3 17 17 3 48 2M9 38C13 20 22 12 38 8"/>
        <circle cx="15" cy="15" r="2.6" class="frame-detail"/>
        <circle cx="24" cy="10" r="1.4" class="frame-node"/>
        <circle cx="10" cy="24" r="1.4" class="frame-node"/>
      `,
      crestSvg: `
        <path d="M12 6C30 1 70 1 88 6" stroke="var(--art-edge)" stroke-width="1.2"/>
        <circle cx="50" cy="6" r="3" class="frame-detail"/>
        <path d="M40 6c3-4 17-4 20 0" stroke="var(--art-lit)" stroke-width="1"/>
      `,
      bottomSealSvg: `<path d="M18 6C36 10 64 10 82 6" stroke="var(--art-edge)" stroke-width="1.1"/><circle cx="50" cy="7" r="2" class="frame-detail"/>`,
    },

    holographic: {
      id: "holographic",
      type: "profile_frame",
      name: "Prisma Holográfico",
      collection: "cyber",
      animated: true,
      animation_mode: ANIMATION_MODES.IDLE_WITH_EVENTS,
      legacy_mode: "loop",
      theme: "synth",
      version: COSMETIC_ENGINE_VERSION,
      reduced_motion: "keyframe-still",
      cornerSvg: `
        <path class="frame-inlay" d="M1 42V8l7-7h40l-12 9H18l-8 8v24Z"/>
        <path d="M1 48V8l7-7h44M10 38V18l8-8h26M16 44V26l10-10h12"/>
        <polygon points="15,15 24,11 20,20 11,24" class="frame-detail"/>
        <circle cx="32" cy="8" r="1.8" class="frame-node"/>
        <circle cx="8" cy="32" r="1.8" class="frame-node"/>
      `,
      crestSvg: `
        <path class="frame-inlay" d="M10 2h80l-12 10H22Z"/>
        <polygon points="50,1 58,7 50,13 42,7" class="frame-detail"/>
        <path d="M18 6h22M60 6h22" stroke="var(--art-lit)" stroke-width="1.1"/>
      `,
      bottomSealSvg: `<path d="M16 6h68M38 2l12 8 12-8" stroke="var(--art-edge)" stroke-width="1.1"/><polygon points="50,2 54,6 50,10 46,6" class="frame-detail"/>`,
    },

    "neon-pulse": {
      id: "neon-pulse",
      type: "profile_frame",
      name: "Horizonte Synthwave",
      collection: "synth",
      animated: true,
      animation_mode: ANIMATION_MODES.IDLE_WITH_EVENTS,
      legacy_mode: "loop",
      theme: "synth",
      version: COSMETIC_ENGINE_VERSION,
      reduced_motion: "keyframe-still",
      cornerSvg: `
        <path class="frame-inlay" d="M1 38V6l5-5h36l-8 7H14l-6 6v24Z"/>
        <path d="M1 46V6l5-5h42M8 34V14l6-6h26M2 40h6M40 2v6"/>
        <rect x="11" y="11" width="6" height="6" rx="1" class="frame-detail"/>
        <circle cx="26" cy="11" r="1.6" class="frame-node"/>
        <circle cx="11" cy="26" r="1.6" class="frame-node"/>
      `,
      crestSvg: `
        <path d="M8 5h26l6 6h20l6-6h26" stroke="var(--art-edge)" stroke-width="1.4"/>
        <rect x="40" y="4" width="20" height="4" rx="2" class="frame-detail"/>
      `,
      bottomSealSvg: `<path d="M18 6h64M32 3h36" stroke="var(--art-lit)" stroke-width="1.1"/>`,
    },

    "arcane-grimoire": {
      id: "arcane-grimoire",
      type: "profile_frame",
      name: "Grimório Arcano",
      collection: "arcane",
      animated: true,
      animation_mode: ANIMATION_MODES.IDLE_WITH_EVENTS,
      legacy_mode: "loop",
      theme: "arcane",
      version: COSMETIC_ENGINE_VERSION,
      reduced_motion: "keyframe-still",
      cornerSvg: `
        <path class="frame-inlay" d="M2 44C4 16 18 4 46 2 28 10 16 22 10 44Z"/>
        <path d="M2 48V10l8-8h38M10 40C12 20 20 12 40 10M16 16l10 10"/>
        <polygon points="15,15 21,15 15,21 9,15" class="frame-detail"/>
        <circle cx="28" cy="9" r="1.8" class="frame-node"/>
        <circle cx="9" cy="28" r="1.8" class="frame-node"/>
      `,
      crestSvg: `
        <path d="M10 6C28 1 72 1 90 6" stroke="var(--art-edge)" stroke-width="1.2"/>
        <polygon points="50,1 56,7 50,14 44,7" class="frame-detail"/>
        <circle cx="32" cy="6" r="1.8" class="frame-node"/>
        <circle cx="68" cy="6" r="1.8" class="frame-node"/>
      `,
      bottomSealSvg: `<path d="M14 6h72M42 2l8 8 8-8" stroke="var(--art-lit)" stroke-width="1.1"/><polygon points="50,2 54,6 50,10 46,6" class="frame-detail"/>`,
    },

    "eclipse-crown": {
      id: "eclipse-crown",
      type: "profile_frame",
      name: "Coroa do Eclipse",
      collection: "eclipse",
      animated: true,
      animation_mode: ANIMATION_MODES.IDLE_WITH_EVENTS,
      legacy_mode: "loop",
      theme: "eclipse",
      version: COSMETIC_ENGINE_VERSION,
      reduced_motion: "keyframe-still",
      cornerSvg: `
        <path class="frame-inlay" d="M1 42V8l7-7h34C26 9 14 20 8 42Z"/>
        <path d="M1 48V8l7-7h42M8 38C12 20 20 12 38 8"/>
        <path class="frame-detail" d="M14 10a7 7 0 1 0 7 11 5.5 5.5 0 1 1-7-11Z"/>
        <circle cx="28" cy="8" r="1.7" class="frame-node"/>
      `,
      crestSvg: `
        <path d="M8 7C26 2 74 2 92 7" stroke="var(--art-edge)" stroke-width="1.3"/>
        <circle cx="50" cy="7" r="5" fill="#09070e" stroke="var(--art-lit)" stroke-width="1.4"/>
        <path d="M36 7h8M56 7h8" stroke="var(--art-lit)" stroke-width="1.2"/>
      `,
      bottomSealSvg: `<path d="M18 6C36 10 64 10 82 6" stroke="var(--art-edge)" stroke-width="1.2"/><circle cx="50" cy="6" r="2.2" class="frame-detail"/>`,
    },

    "seraphim-arch": {
      id: "seraphim-arch",
      type: "profile_frame",
      name: "Céu Serafim",
      collection: "seraphim",
      animated: true,
      animation_mode: ANIMATION_MODES.IDLE_WITH_EVENTS,
      legacy_mode: "loop",
      theme: "seraphim",
      version: COSMETIC_ENGINE_VERSION,
      reduced_motion: "keyframe-still",
      cornerSvg: `
        <path class="frame-inlay" d="M2 44C4 20 18 6 46 2c-16 10-26 22-34 42Z"/>
        <path d="M2 48C4 18 18 4 50 2M8 40C12 22 22 12 40 8M14 34c4-10 10-16 20-20"/>
        <path class="frame-detail" d="M12 26c0-10 8-16 18-16-6 6-10 10-12 18Z"/>
        <circle cx="14" cy="14" r="1.8" class="frame-node"/>
      `,
      crestSvg: `
        <path d="M8 8C26 2 74 2 92 8" stroke="var(--art-lit)" stroke-width="1.2"/>
        <ellipse cx="50" cy="6" rx="14" ry="3.4" stroke="var(--art-lit)" stroke-width="1.4"/>
        <polygon points="50,3 53,6 50,9 47,6" class="frame-detail"/>
      `,
      bottomSealSvg: `<path d="M20 6C38 10 62 10 80 6" stroke="var(--art-lit)" stroke-width="1.1"/><polygon points="50,2 54,6 50,10 46,6" class="frame-detail"/>`,
    },

    "dream-sanctuary": {
      id: "dream-sanctuary",
      type: "profile_frame",
      name: "Reino Onírico",
      collection: "dream",
      animated: true,
      animation_mode: ANIMATION_MODES.IDLE_WITH_EVENTS,
      legacy_mode: "loop",
      theme: "dream",
      version: COSMETIC_ENGINE_VERSION,
      reduced_motion: "keyframe-still",
      cornerSvg: `
        <path class="frame-inlay" d="M2 40C6 16 18 6 44 2c-14 10-24 20-32 38Z"/>
        <path d="M2 46C4 18 18 4 48 2M9 36C14 20 22 12 38 9"/>
        <path class="frame-detail" d="M18 14l2-5 2 5 5 2-5 2-2 5-2-5-5-2Z"/>
        <circle cx="28" cy="10" r="1.6" class="frame-node"/>
        <circle cx="10" cy="28" r="1.6" class="frame-node"/>
      `,
      crestSvg: `
        <path d="M12 6C30 2 70 2 88 6" stroke="var(--art-edge)" stroke-width="1.1"/>
        <path d="M47 2a6 6 0 1 0 5 10 4.8 4.8 0 1 1-5-10Z" class="frame-detail"/>
        <circle cx="32" cy="6" r="1.5" class="frame-node"/>
        <circle cx="68" cy="6" r="1.5" class="frame-node"/>
      `,
      bottomSealSvg: `<path d="M20 6C38 9 62 9 80 6" stroke="var(--art-edge)" stroke-width="1"/><circle cx="50" cy="6" r="2" class="frame-detail"/>`,
    },

    "reactive-aura": {
      id: "reactive-aura",
      type: "profile_frame",
      name: "Aura Reativa",
      collection: "sancord-core",
      animated: true,
      animation_mode: ANIMATION_MODES.REACTIVE,
      legacy_mode: "loop",
      theme: "core",
      version: COSMETIC_ENGINE_VERSION,
      reduced_motion: "keyframe-still",
      cornerSvg: `
        <path class="frame-inlay" d="M1 34V9l8-8h28l-8 8H16l-7 7v18Z"/>
        <path d="M1 44V9l8-8h36M9 34V18l9-9h18"/>
        <circle cx="14" cy="14" r="2.2" class="frame-node"/>
      `,
      crestSvg: `<path d="M18 6h64" stroke="var(--art-edge)" stroke-width="1.2"/><circle cx="50" cy="6" r="3" class="frame-detail"/>`,
      bottomSealSvg: `<path d="M24 6h52" stroke="var(--art-edge)" stroke-width="1"/>`,
    },

    "voice-pulse": {
      id: "voice-pulse",
      type: "profile_frame",
      name: "Pulso Acústico",
      collection: "sancord-core",
      animated: true,
      animation_mode: ANIMATION_MODES.REACTIVE,
      legacy_mode: "loop",
      theme: "core",
      version: COSMETIC_ENGINE_VERSION,
      reduced_motion: "keyframe-still",
      cornerSvg: `
        <path class="frame-inlay" d="M1 34V9l8-8h28l-8 8H16l-7 7v18Z"/>
        <path d="M1 44V9l8-8h36M10 26v-8M14 28V14M18 24v-6"/>
        <circle cx="24" cy="11" r="1.8" class="frame-node"/>
      `,
      crestSvg: `<path d="M18 6h18l4-3 4 6 6-7 6 7 4-6 4 3h18" stroke="var(--art-lit)" stroke-width="1.2"/>`,
      bottomSealSvg: `<path d="M26 6h48" stroke="var(--art-edge)" stroke-width="1"/>`,
    },

    founder: {
      id: "founder",
      type: "profile_frame",
      name: "Fundação Imperial",
      collection: "conquistas",
      animated: true,
      animation_mode: ANIMATION_MODES.IDLE_WITH_EVENTS,
      legacy_mode: "loop",
      theme: "founder",
      version: COSMETIC_ENGINE_VERSION,
      reduced_motion: "keyframe-still",
      cornerSvg: `
        <path class="frame-inlay" d="M2 44V8l6-6h36C28 9 16 19 8 44Z"/>
        <path d="M2 48V6l4-4h44M8 38V14l6-6h26"/>
        <polygon points="14,14 20,14 14,20 8,14" class="frame-detail"/>
        <circle cx="28" cy="8" r="1.9" class="frame-node"/>
        <circle cx="8" cy="28" r="1.9" class="frame-node"/>
      `,
      crestSvg: `
        <path class="frame-inlay" d="M18 2h64l-10 10H28Z"/>
        <path d="M35 11l4-9 11 6 11-6 4 9Z" class="frame-detail"/>
      `,
      bottomSealSvg: `<path d="M14 6h72" stroke="var(--art-lit)" stroke-width="1.3"/><polygon points="50,2 55,6 50,10 45,6" class="frame-detail"/>`,
    },

    developer: {
      id: "developer",
      type: "profile_frame",
      name: "Arquitetura Dev",
      collection: "conquistas",
      animated: true,
      animation_mode: ANIMATION_MODES.IDLE_WITH_EVENTS,
      legacy_mode: "loop",
      theme: "developer",
      version: COSMETIC_ENGINE_VERSION,
      reduced_motion: "keyframe-still",
      cornerSvg: `
        <path class="frame-inlay" d="M1 34V7l6-6h27l-6 6H11l-4 4v17Z"/>
        <path d="M1 44V7l6-6h38M9 32V14l5-5h20"/>
        <path class="frame-detail" d="M14 17l-3 3 3 3m6-6l3 3-3 3"/>
        <circle cx="28" cy="9" r="1.7" class="frame-node"/>
      `,
      crestSvg: `<path d="M14 6h26l4-4 4 8 4-8 4 4h26" stroke="var(--art-edge)" stroke-width="1.3"/>`,
      bottomSealSvg: `<path d="M22 6h56" stroke="var(--art-edge)" stroke-width="1.1"/>`,
    },

    "early-user": {
      id: "early-user",
      type: "profile_frame",
      name: "Pioneira Astral",
      collection: "conquistas",
      animated: false,
      animation_mode: ANIMATION_MODES.STATIC,
      legacy_mode: "static",
      theme: "frost",
      version: COSMETIC_ENGINE_VERSION,
      reduced_motion: "static-native",
      cornerSvg: `
        <path class="frame-inlay" d="M2 38V8l6-6h30C24 9 14 19 8 38Z"/>
        <path d="M2 46V6l4-4h40M9 34V14l5-5h20"/>
        <polygon points="14,14 18,14 14,18 10,14" class="frame-detail"/>
      `,
      crestSvg: `<path d="M18 6h64" stroke="var(--art-edge)" stroke-width="1.1"/><path d="M50 1l2 4 4 2-4 2-2 4-2-4-4-2 4-2Z" class="frame-detail"/>`,
      bottomSealSvg: `<path d="M24 6h52" stroke="var(--art-edge)" stroke-width="1"/>`,
    },

    "winter-2026": {
      id: "winter-2026",
      type: "profile_frame",
      name: "Solstício Glacial",
      collection: "temporada-inverno",
      animated: true,
      animation_mode: ANIMATION_MODES.IDLE_WITH_EVENTS,
      legacy_mode: "loop",
      theme: "frost",
      version: COSMETIC_ENGINE_VERSION,
      reduced_motion: "keyframe-still",
      cornerSvg: `
        <path class="frame-inlay" d="M2 40L8 16l8-8L40 2 24 14 14 24Z"/>
        <path d="M2 48V12l10-10h36M8 34l8-18 18-8"/>
        <polygon points="12,12 19,9 15,15 9,19" class="frame-detail"/>
        <circle cx="26" cy="8" r="1.8" class="frame-node"/>
      `,
      crestSvg: `<path d="M14 6h72" stroke="var(--art-lit)" stroke-width="1.1"/><polygon points="50,1 55,6 50,12 45,6" class="frame-detail"/>`,
      bottomSealSvg: `<path d="M20 6h60" stroke="var(--art-edge)" stroke-width="1"/><polygon points="50,3 54,6 50,9 46,6" class="frame-detail"/>`,
    },
  };

  // ===========================================================================
  // 3. PROFILE EFFECTS — Timeline multi-estágio com profundidade (BACK + FRONT)
  // ===========================================================================
  const PROFILE_EFFECTS_V3 = {
    "core-signal": {
      id: "core-signal",
      type: "profile_effect",
      name: "Inicialização Sanvo",
      collection: "sancord-core",
      animated: true,
      animation_mode: ANIMATION_MODES.PLAY_ON_OPEN,
      theme: "core",
      duration: 2300,
      stages: { entrance: 120, main: 450, climax: 1050, dissipate: 1650 },
      version: COSMETIC_ENGINE_VERSION,
      reduced_motion: "disabled-still",
      backSvg: `
        <g class="ef-layer-wash"><rect x="0" y="0" width="100" height="100" fill="url(#ef-core-grad)"/></g>
        <defs>
          <radialGradient id="ef-core-grad" cx="50%" cy="22%" r="72%">
            <stop offset="0%" stop-color="#8a6eff" stop-opacity=".34"/>
            <stop offset="55%" stop-color="#57dbcf" stop-opacity=".14"/>
            <stop offset="100%" stop-color="#000" stop-opacity="0"/>
          </radialGradient>
        </defs>
        <g class="ef-grid-trace" stroke="#57dbcf" stroke-width=".32" opacity=".55">
          <path d="M0 24h100M0 54h100M0 80h100M25 0v100M75 0v100"/>
        </g>
      `,
      frontSvg: `
        <g class="ef-scan-beam"><rect x="0" y="-6" width="100" height="5" fill="#9ff4e5" opacity=".48"/></g>
        <g class="ef-trace-paths" stroke="#57dbcf" stroke-width=".55" fill="none">
          <path d="M2 28h19l13-13h26l14-12h24"/>
          <path d="M4 66h22l12-12h28l18-20h14"/>
          <path d="M2 86h28l16-14h26l12-11h14"/>
        </g>
        <g class="ef-climax-burst">
          <polygon points="50,14 58,24 50,34 42,24" fill="#e0dcff" stroke="#57dbcf" stroke-width=".6"/>
          <circle cx="50" cy="24" r="14" fill="none" stroke="#b9adff" stroke-width=".6"/>
        </g>
        <g class="ef-particles">
          <circle cx="32" cy="17" r="1.4" fill="#d9fff8"/>
          <circle cx="72" cy="36" r="1.6" fill="#baadfd"/>
          <circle cx="44" cy="56" r="1.2" fill="#57dbcf"/>
          <circle cx="82" cy="74" r="1.4" fill="#e0dcff"/>
        </g>
      `,
    },

    "star-trail": {
      id: "star-trail",
      type: "profile_effect",
      name: "Travessia Cósmica",
      collection: "cosmic",
      animated: true,
      animation_mode: ANIMATION_MODES.PLAY_ON_OPEN,
      theme: "cosmic",
      duration: 2600,
      stages: { entrance: 150, main: 520, climax: 1200, dissipate: 1850 },
      version: COSMETIC_ENGINE_VERSION,
      reduced_motion: "disabled-still",
      backSvg: `
        <defs>
          <radialGradient id="ef-cos-grad" cx="72%" cy="18%" r="74%">
            <stop offset="0%" stop-color="#818cf8" stop-opacity=".40"/>
            <stop offset="50%" stop-color="#312e81" stop-opacity=".22"/>
            <stop offset="100%" stop-color="#000" stop-opacity="0"/>
          </radialGradient>
        </defs>
        <g class="ef-layer-wash"><rect x="0" y="0" width="100" height="100" fill="url(#ef-cos-grad)"/></g>
        <g class="ef-constellation" stroke="#c7d2fe" stroke-width=".35" fill="none" opacity=".75">
          <path d="M12 22L28 14L46 24L68 12L86 22"/>
          <circle cx="12" cy="22" r="1" fill="#fde68a"/><circle cx="28" cy="14" r="1.2" fill="#fff"/>
          <circle cx="46" cy="24" r="1" fill="#bae6fd"/><circle cx="68" cy="12" r="1.4" fill="#fde68a"/>
          <circle cx="86" cy="22" r="1" fill="#fff"/>
        </g>
      `,
      frontSvg: `
        <g class="ef-comet-1">
          <path d="M-12 72C18 42 52 22 108 10" stroke="#7dd3fc" stroke-width="1.2" fill="none" stroke-linecap="round"/>
          <circle cx="78" cy="18" r="2.2" fill="#ffffff"/>
        </g>
        <g class="ef-comet-2">
          <path d="M-8 92C26 62 62 34 112 26" stroke="#c4b5fd" stroke-width=".9" fill="none" stroke-linecap="round"/>
          <circle cx="62" cy="40" r="1.6" fill="#fde68a"/>
        </g>
        <g class="ef-climax-burst">
          <path d="M74 22l2-9 2 9 9 2-9 2-2 9-2-9-9-2Z" fill="#fef9c3"/>
          <circle cx="74" cy="22" r="11" fill="none" stroke="#bae6fd" stroke-width=".5"/>
        </g>
        <g class="ef-particles">
          <path d="M26 32l1-3.5 1 3.5 3.5 1-3.5 1-1 3.5-1-3.5-3.5-1Z" fill="#e0dcff"/>
          <path d="M54 64l1.2-4 1.2 4 4 1.2-4 1.2-1.2 4-1.2-4-4-1.2Z" fill="#fde68a"/>
          <circle cx="18" cy="68" r="1.2" fill="#bae6fd"/>
          <circle cx="84" cy="56" r="1.3" fill="#c4b5fd"/>
        </g>
      `,
    },

    "petal-drift": {
      id: "petal-drift",
      type: "profile_effect",
      name: "Vento de Cerejeira",
      collection: "sakura",
      animated: true,
      animation_mode: ANIMATION_MODES.PLAY_ON_OPEN,
      theme: "sakura",
      duration: 2700,
      stages: { entrance: 150, main: 500, climax: 1250, dissipate: 1950 },
      version: COSMETIC_ENGINE_VERSION,
      reduced_motion: "disabled-still",
      backSvg: `
        <defs>
          <linearGradient id="ef-sak-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#f472b6" stop-opacity=".28"/>
            <stop offset="60%" stop-color="#fda4af" stop-opacity=".10"/>
            <stop offset="100%" stop-color="#000" stop-opacity="0"/>
          </linearGradient>
        </defs>
        <g class="ef-layer-wash"><rect x="0" y="0" width="100" height="100" fill="url(#ef-sak-grad)"/></g>
        <g class="ef-wind-ribbons" fill="none" stroke="#fbcfe8" stroke-width=".45" opacity=".7">
          <path d="M-6 26C24 10 52 54 78 36s20-16 30-12"/>
          <path d="M-4 58C24 44 46 74 72 60s20-14 34-10"/>
        </g>
        <g class="ef-back-petals" fill="#f9a8d4" opacity=".68">
          <path d="M18 22c-3-4 0-8 3-7l1 3 3-1c0 4-3 6-7 5Z"/>
          <path d="M58 18c-3-4 0-8 3-7l1 3 3-1c0 4-3 6-7 5Z"/>
          <path d="M84 44c-3-4 0-8 3-7l1 3 3-1c0 4-3 6-7 5Z"/>
        </g>
      `,
      frontSvg: `
        <g class="ef-front-petals" fill="#ffe4ef" stroke="#f472b6" stroke-width=".35">
          <path d="M16 30c-6-8-1-15 3-14l1 5 5-1c1 7-4 11-9 10Z"/>
          <path d="M44 56c-5-6-2-12 2-13l3 5 4-2c1 7-5 11-9 10Z"/>
          <path d="M76 28c-6-2-9-8-6-12l4 3 4-3c6 5 4 11-2 12Z"/>
          <path d="M72 76c-7 0-11-5-9-9l4 1 3-3c5 2 7 7 2 11Z"/>
          <path d="M26 78c-5-4-4-10 0-11l2 4 4-1c2 5-2 9-6 8Z"/>
        </g>
        <g class="ef-climax-burst">
          <circle cx="52" cy="36" r="1.4" fill="#fff1f5"/>
          <circle cx="64" cy="48" r="1.1" fill="#fde68a"/>
          <circle cx="34" cy="42" r="1.2" fill="#fbcfe8"/>
        </g>
      `,
    },

    "circuit-boot": {
      id: "circuit-boot",
      type: "profile_effect",
      name: "Varredura Digital HUD",
      collection: "cyber",
      animated: true,
      animation_mode: ANIMATION_MODES.PLAY_ON_OPEN,
      theme: "cyber",
      duration: 2400,
      stages: { entrance: 100, main: 460, climax: 1100, dissipate: 1750 },
      version: COSMETIC_ENGINE_VERSION,
      reduced_motion: "disabled-still",
      backSvg: `
        <g class="ef-grid-trace" stroke="#22d3ee" stroke-width=".28" opacity=".45">
          <path d="M0 16h100M0 32h100M0 48h100M0 64h100M0 80h100"/>
        </g>
      `,
      frontSvg: `
        <g class="ef-scan-beam"><rect x="0" y="-4" width="100" height="4" fill="#22d3ee" opacity=".55"/></g>
        <g class="ef-trace-paths" stroke="#22d3ee" stroke-width=".6" fill="none">
          <path d="M6 12h22l6 6h26"/>
          <path d="M94 88H72l-6-6H40"/>
          <path d="M8 86V64l8-8V38"/>
          <path d="M92 14v22l-8 8v18"/>
        </g>
        <g class="ef-climax-burst">
          <rect x="6" y="6" width="10" height="10" fill="none" stroke="#67e8f9" stroke-width=".7"/>
          <rect x="84" y="84" width="10" height="10" fill="none" stroke="#f472b6" stroke-width=".7"/>
        </g>
      `,
    },

    "polar-ribbon": {
      id: "polar-ribbon",
      type: "profile_effect",
      name: "Véu da Aurora",
      collection: "frost",
      animated: true,
      animation_mode: ANIMATION_MODES.PLAY_ON_OPEN,
      theme: "frost",
      duration: 2800,
      stages: { entrance: 180, main: 600, climax: 1350, dissipate: 2050 },
      version: COSMETIC_ENGINE_VERSION,
      reduced_motion: "disabled-still",
      backSvg: `
        <defs>
          <linearGradient id="ef-aur-1" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#34d399" stop-opacity=".36"/>
            <stop offset="50%" stop-color="#38bdf8" stop-opacity=".28"/>
            <stop offset="100%" stop-color="#818cf8" stop-opacity="0"/>
          </linearGradient>
        </defs>
        <g class="ef-layer-wash">
          <path d="M-10 38C18 14 48 48 76 22s28 4 34 14V0H-10Z" fill="url(#ef-aur-1)"/>
        </g>
      `,
      frontSvg: `
        <g class="ef-wind-ribbons" fill="none" stroke="#a5f3fc" stroke-width=".7" opacity=".8">
          <path d="M-8 34C20 12 48 44 78 20s22 4 30 12"/>
          <path d="M-6 46C24 24 52 54 82 30s20 2 26 10" stroke="#6ee7b7"/>
        </g>
        <g class="ef-particles">
          <path d="M24 22v6M21 25h6" stroke="#ffffff" stroke-width=".8"/>
          <path d="M74 34v7M70.5 37.5h7" stroke="#bae6fd" stroke-width=".8"/>
          <circle cx="48" cy="18" r="1.4" fill="#ffffff"/>
          <circle cx="62" cy="56" r="1.1" fill="#a5f3fc"/>
        </g>
      `,
    },

    embers: {
      id: "embers",
      type: "profile_effect",
      name: "Brasas da Forja",
      collection: "inferno",
      animated: true,
      animation_mode: ANIMATION_MODES.PLAY_ON_OPEN,
      theme: "inferno",
      duration: 2500,
      stages: { entrance: 150, main: 520, climax: 1180, dissipate: 1850 },
      version: COSMETIC_ENGINE_VERSION,
      reduced_motion: "disabled-still",
      backSvg: `
        <defs>
          <linearGradient id="ef-emb-grad" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stop-color="#ea580c" stop-opacity=".42"/>
            <stop offset="48%" stop-color="#b91c1c" stop-opacity=".16"/>
            <stop offset="100%" stop-color="#000" stop-opacity="0"/>
          </linearGradient>
        </defs>
        <g class="ef-layer-wash"><rect x="0" y="0" width="100" height="100" fill="url(#ef-emb-grad)"/></g>
      `,
      frontSvg: `
        <g class="ef-ember-rise">
          <circle cx="16" cy="86" r="1.6" fill="#fde047"/>
          <circle cx="32" cy="92" r="2.1" fill="#fb923c"/>
          <circle cx="54" cy="84" r="1.4" fill="#fef08a"/>
          <circle cx="72" cy="90" r="2.0" fill="#f97316"/>
          <circle cx="86" cy="82" r="1.5" fill="#fde047"/>
          <path d="M24 94q4-10 8-16M64 96q-4-12 6-20" stroke="#fdba74" stroke-width=".6" fill="none" opacity=".75"/>
        </g>
      `,
    },

    "arcane-sigil": {
      id: "arcane-sigil",
      type: "profile_effect",
      name: "Ritual Arcano",
      collection: "arcane",
      animated: true,
      animation_mode: ANIMATION_MODES.PLAY_ON_OPEN,
      theme: "arcane",
      duration: 3400,
      stages: { entrance: 150, main: 600, climax: 1500, dissipate: 2550 },
      version: COSMETIC_ENGINE_VERSION,
      reduced_motion: "disabled-still",
      backSvg: `<g class="ef-layer-wash"><rect x="0" y="0" width="100" height="100" fill="#7c3aed" fill-opacity=".18"/></g>`,
      frontSvg: `<g class="ef-climax-burst"><circle cx="50" cy="28" r="18" fill="none" stroke="#fde68a" stroke-width=".55" stroke-dasharray="3 2"/></g>`,
    },

    "eclipse-flare": {
      id: "eclipse-flare",
      type: "profile_effect",
      name: "Chama do Eclipse",
      collection: "eclipse",
      animated: true,
      animation_mode: ANIMATION_MODES.PLAY_ON_OPEN,
      theme: "eclipse",
      duration: 3500,
      stages: { entrance: 160, main: 640, climax: 1550, dissipate: 2650 },
      version: COSMETIC_ENGINE_VERSION,
      reduced_motion: "disabled-still",
      backSvg: `<g class="ef-layer-wash"><rect x="0" y="0" width="100" height="100" fill="#991b1b" fill-opacity=".22"/></g>`,
      frontSvg: `<g class="ef-climax-burst"><circle cx="50" cy="26" r="14" fill="none" stroke="#fde68a" stroke-width=".7"/></g>`,
    },

    "abyssal-tide": {
      id: "abyssal-tide",
      type: "profile_effect",
      name: "Maré Bioluminescente",
      collection: "ocean",
      animated: true,
      animation_mode: ANIMATION_MODES.PLAY_ON_OPEN,
      theme: "ocean",
      duration: 3400,
      stages: { entrance: 150, main: 620, climax: 1500, dissipate: 2550 },
      version: COSMETIC_ENGINE_VERSION,
      reduced_motion: "disabled-still",
      backSvg: `<g class="ef-layer-wash"><rect x="0" y="0" width="100" height="100" fill="#0d9488" fill-opacity=".18"/></g>`,
      frontSvg: `<g class="ef-wind-ribbons" fill="none" stroke="#5eead4" stroke-width=".65"><path d="M-6 44C24 28 54 58 84 36s20 2 24 8"/></g>`,
    },

    "seraphim-fall": {
      id: "seraphim-fall",
      type: "profile_effect",
      name: "Bênção Celestial",
      collection: "seraphim",
      animated: true,
      animation_mode: ANIMATION_MODES.PLAY_ON_OPEN,
      theme: "seraphim",
      duration: 3600,
      stages: { entrance: 160, main: 650, climax: 1600, dissipate: 2700 },
      version: COSMETIC_ENGINE_VERSION,
      reduced_motion: "disabled-still",
      backSvg: `<g class="ef-layer-wash"><rect x="0" y="0" width="100" height="100" fill="#f59e0b" fill-opacity=".16"/></g>`,
      frontSvg: `<g class="ef-particles"><circle cx="50" cy="22" r="1.4" fill="#fef3c7"/></g>`,
    },

    "synth-overdrive": {
      id: "synth-overdrive",
      type: "profile_effect",
      name: "Horizonte Synth",
      collection: "synth",
      animated: true,
      animation_mode: ANIMATION_MODES.PLAY_ON_OPEN,
      theme: "synth",
      duration: 3200,
      stages: { entrance: 120, main: 540, climax: 1400, dissipate: 2400 },
      version: COSMETIC_ENGINE_VERSION,
      reduced_motion: "disabled-still",
      backSvg: `<g class="ef-grid-trace" stroke="#f472b6" stroke-width=".3" opacity=".45"><path d="M0 24h100M0 54h100M0 84h100"/></g>`,
      frontSvg: `<g class="ef-scan-beam"><rect x="0" y="-4" width="100" height="4" fill="#22d3ee" opacity=".5"/></g>`,
    },

    "dream-butterflies": {
      id: "dream-butterflies",
      type: "profile_effect",
      name: "Sonho Etéreo",
      collection: "dream",
      animated: true,
      animation_mode: ANIMATION_MODES.PLAY_ON_OPEN,
      theme: "dream",
      duration: 3600,
      stages: { entrance: 160, main: 660, climax: 1620, dissipate: 2750 },
      version: COSMETIC_ENGINE_VERSION,
      reduced_motion: "disabled-still",
      backSvg: `<g class="ef-layer-wash"><rect x="0" y="0" width="100" height="100" fill="#a78bfa" fill-opacity=".16"/></g>`,
      frontSvg: `<g class="ef-particles"><circle cx="38" cy="28" r="1.2" fill="#a7f3d0"/><circle cx="68" cy="34" r="1.3" fill="#fbcfe8"/></g>`,
    },
  };

  // ===========================================================================
  // 4. NAMEPLATES — Peças gráficas compostas em camadas SVG (NÃO retângulos chapados!)
  // ===========================================================================
  const NAMEPLATES_V3 = {
    "starlit-silt": {
      id: "starlit-silt",
      type: "nameplate",
      name: "Constelação Celeste",
      collection: "cosmic",
      animated: true,
      animation_mode: ANIMATION_MODES.IDLE_WITH_EVENTS,
      version: COSMETIC_ENGINE_VERSION,
      reduced_motion: "keyframe-still",
      svg: `
        <defs>
          <linearGradient id="np-cos-bg" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stop-color="#1e1b4b" stop-opacity=".08"/>
            <stop offset="45%" stop-color="#312e81" stop-opacity=".46"/>
            <stop offset="100%" stop-color="#4338ca" stop-opacity=".72"/>
          </linearGradient>
        </defs>
        <rect width="280" height="52" fill="url(#np-cos-bg)"/>
        <path d="M168 48C194 26 226 12 278 14" fill="none" stroke="#818cf8" stroke-width="1" stroke-dasharray="3 3" opacity=".65"/>
        <path d="M246 8a14 14 0 1 0 10 24a11 11 0 1 1-10-24Z" fill="#fde68a" opacity=".92"/>
        <path d="M188 18L206 10L224 22L238 14" fill="none" stroke="#c7d2fe" stroke-width=".75" opacity=".7"/>
        <circle cx="188" cy="18" r="1.5" fill="#fff" class="cos-twinkle"/>
        <circle cx="206" cy="10" r="1.8" fill="#fde68a" class="cos-twinkle cos-d1"/>
        <circle cx="224" cy="22" r="1.4" fill="#bae6fd" class="cos-twinkle cos-d2"/>
        <path d="M262 34l1.6-4.5 1.6 4.5 4.5 1.6-4.5 1.6-1.6 4.5-1.6-4.5-4.5-1.6Z" fill="#fef9c3" class="cos-twinkle cos-d3"/>
      `,
    },

    "twilight-garden": {
      id: "twilight-garden",
      type: "nameplate",
      name: "Ramo de Sakura",
      collection: "sakura",
      animated: true,
      animation_mode: ANIMATION_MODES.IDLE_WITH_EVENTS,
      version: COSMETIC_ENGINE_VERSION,
      reduced_motion: "keyframe-still",
      svg: `
        <defs>
          <linearGradient id="np-sak-bg" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stop-color="#831843" stop-opacity=".06"/>
            <stop offset="50%" stop-color="#9d174d" stop-opacity=".36"/>
            <stop offset="100%" stop-color="#be185d" stop-opacity=".62"/>
          </linearGradient>
        </defs>
        <rect width="280" height="52" fill="url(#np-sak-bg)"/>
        <path d="M280 12C252 16 226 24 196 38M244 19C236 12 228 9 218 10" fill="none" stroke="#5b2338" stroke-width="2.4" stroke-linecap="round"/>
        <g class="cos-np-sway">
          <g transform="translate(248 18)">
            <path d="M0-7c2.4 0 4 2.2 1.6 4.6 3-.6 5.4 1.6 3.8 4-1.6 2.2-4.8 1.6-5.4-.8-.8 3-4.6 3-5.4.8-1.6-2.4.8-4.6 3.8-4C-4-4.8-2.4-7 0-7Z" fill="#fbcfe8" stroke="#f472b6" stroke-width=".7"/>
            <circle cx="0" cy="0" r="1.7" fill="#fde68a"/>
          </g>
          <g transform="translate(216 28) scale(.8)">
            <path d="M0-7c2.4 0 4 2.2 1.6 4.6 3-.6 5.4 1.6 3.8 4-1.6 2.2-4.8 1.6-5.4-.8-.8 3-4.6 3-5.4.8-1.6-2.4.8-4.6 3.8-4C-4-4.8-2.4-7 0-7Z" fill="#ffe4ef" stroke="#ec4899" stroke-width=".7"/>
            <circle cx="0" cy="0" r="1.6" fill="#f59e0b"/>
          </g>
          <path d="M188 18c4-3 9-1 7 3-3 3-8 2-7-3Z" fill="#fbcfe8" opacity=".85"/>
          <path d="M266 36c4-3 8-1 6 3-3 3-7 2-6-3Z" fill="#f9a8d4" opacity=".82"/>
        </g>
      `,
    },

    "core-stripe": {
      id: "core-stripe",
      type: "nameplate",
      name: "Núcleo Sanvo",
      collection: "sancord-core",
      animated: true,
      animation_mode: ANIMATION_MODES.IDLE_WITH_EVENTS,
      version: COSMETIC_ENGINE_VERSION,
      reduced_motion: "keyframe-still",
      svg: `
        <defs>
          <linearGradient id="np-core-bg" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stop-color="#4c1d95" stop-opacity=".08"/>
            <stop offset="52%" stop-color="#5b21b6" stop-opacity=".38"/>
            <stop offset="100%" stop-color="#0f766e" stop-opacity=".62"/>
          </linearGradient>
        </defs>
        <rect width="280" height="52" fill="url(#np-core-bg)"/>
        <path d="M178 52L214 0h16l-36 52ZM214 52L250 0h10l-36 52Z" fill="#baadfd" opacity=".15"/>
        <path d="M192 42l14-14h26l12-12h24" fill="none" stroke="#57dbcf" stroke-width="1.2" opacity=".8"/>
        <polygon points="256,16 266,26 256,36 246,26" fill="#8a6eff" stroke="#e0dcff" stroke-width="1"/>
        <polygon points="256,21 261,26 256,31 251,26" fill="#57dbcf"/>
        <circle cx="228" cy="28" r="2" fill="#e0dcff" class="cos-twinkle"/>
      `,
    },

    "circuit-weave": {
      id: "circuit-weave",
      type: "nameplate",
      name: "Malha Cyber",
      collection: "cyber",
      animated: false,
      animation_mode: ANIMATION_MODES.STATIC,
      version: COSMETIC_ENGINE_VERSION,
      reduced_motion: "static-native",
      svg: `
        <defs>
          <linearGradient id="np-cyb-bg" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stop-color="#083344" stop-opacity=".08"/>
            <stop offset="55%" stop-color="#155e75" stop-opacity=".44"/>
            <stop offset="100%" stop-color="#0e7490" stop-opacity=".70"/>
          </linearGradient>
        </defs>
        <rect width="280" height="52" fill="url(#np-cyb-bg)"/>
        <path d="M168 14h28l8 8h28l8-8h34M184 38h32l10-10h24l8 8h18" fill="none" stroke="#22d3ee" stroke-width="1.15" opacity=".78"/>
        <rect x="248" y="18" width="16" height="16" rx="2" fill="#083344" stroke="#67e8f9" stroke-width="1.2"/>
        <rect x="253" y="23" width="6" height="6" fill="#22d3ee"/>
        <circle cx="204" cy="22" r="2" fill="#e0f2fe"/>
        <circle cx="226" cy="28" r="2" fill="#67e8f9"/>
      `,
    },

    "gold-leaf": {
      id: "gold-leaf",
      type: "nameplate",
      name: "Brasão Real",
      collection: "royal",
      animated: false,
      animation_mode: ANIMATION_MODES.STATIC,
      version: COSMETIC_ENGINE_VERSION,
      reduced_motion: "static-native",
      svg: `
        <defs>
          <linearGradient id="np-roy-bg" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stop-color="#451a03" stop-opacity=".06"/>
            <stop offset="50%" stop-color="#78350f" stop-opacity=".42"/>
            <stop offset="100%" stop-color="#b45309" stop-opacity=".68"/>
          </linearGradient>
        </defs>
        <rect width="280" height="52" fill="url(#np-roy-bg)"/>
        <path d="M174 8h98M174 44h98" stroke="#fde68a" stroke-width=".85" opacity=".55"/>
        <path d="M220 26c8-12 22-14 34-8-10 2-16 8-20 16M220 26c8 12 22 14 34 8" fill="none" stroke="#fde68a" stroke-width="1.2" opacity=".88"/>
        <polygon points="256,14 267,26 256,38 245,26" fill="#d97706" stroke="#fef3c7" stroke-width="1.1"/>
        <polygon points="256,20 262,26 256,32 250,26" fill="#fef3c7"/>
      `,
    },

    "tide-glass": {
      id: "tide-glass",
      type: "nameplate",
      name: "Ondas Abissais",
      collection: "ocean",
      animated: true,
      animation_mode: ANIMATION_MODES.IDLE_WITH_EVENTS,
      version: COSMETIC_ENGINE_VERSION,
      reduced_motion: "keyframe-still",
      svg: `
        <defs>
          <linearGradient id="np-ocn-bg" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stop-color="#0c4a6e" stop-opacity=".06"/>
            <stop offset="50%" stop-color="#0f766e" stop-opacity=".42"/>
            <stop offset="100%" stop-color="#0284c7" stop-opacity=".66"/>
          </linearGradient>
        </defs>
        <rect width="280" height="52" fill="url(#np-ocn-bg)"/>
        <path d="M164 42C192 26 218 46 248 26s22-8 32-4v30H164Z" fill="#2dd4bf" opacity=".24"/>
        <path d="M176 44C202 30 226 42 254 22c10-7 18-6 26-2" fill="none" stroke="#a5f3fc" stroke-width="1.3" opacity=".82"/>
        <circle cx="242" cy="18" r="3.4" fill="none" stroke="#e0f2fe" stroke-width="1" class="cos-ember-float"/>
        <circle cx="260" cy="30" r="2.2" fill="none" stroke="#bae6fd" stroke-width=".9" class="cos-ember-float cos-d2"/>
        <circle cx="222" cy="24" r="1.6" fill="#e0f2fe" class="cos-twinkle"/>
      `,
    },

    "ember-line": {
      id: "ember-line",
      type: "nameplate",
      name: "Fagulha de Obsidiana",
      collection: "inferno",
      animated: true,
      animation_mode: ANIMATION_MODES.IDLE_WITH_EVENTS,
      version: COSMETIC_ENGINE_VERSION,
      reduced_motion: "keyframe-still",
      svg: `
        <defs>
          <linearGradient id="np-emb-bg" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stop-color="#450a0a" stop-opacity=".08"/>
            <stop offset="52%" stop-color="#7c2d12" stop-opacity=".46"/>
            <stop offset="100%" stop-color="#c2410c" stop-opacity=".72"/>
          </linearGradient>
        </defs>
        <rect width="280" height="52" fill="url(#np-emb-bg)"/>
        <path d="M182 48l24-16 14 4 22-22 14 6 20-16" fill="none" stroke="#fb923c" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M206 32l14 4 22-22" fill="none" stroke="#fde047" stroke-width=".9" stroke-linecap="round"/>
        <circle cx="232" cy="36" r="1.8" fill="#fde047" class="cos-ember-float"/>
        <circle cx="256" cy="28" r="1.5" fill="#fb923c" class="cos-ember-float cos-d1"/>
        <circle cx="268" cy="18" r="2" fill="#fef08a" class="cos-twinkle"/>
      `,
    },

    "frost-vein": {
      id: "frost-vein",
      type: "nameplate",
      name: "Cristais Polares",
      collection: "frost",
      animated: false,
      animation_mode: ANIMATION_MODES.STATIC,
      version: COSMETIC_ENGINE_VERSION,
      reduced_motion: "static-native",
      svg: `
        <defs>
          <linearGradient id="np-frst-bg" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stop-color="#0c4a6e" stop-opacity=".06"/>
            <stop offset="52%" stop-color="#0369a1" stop-opacity=".40"/>
            <stop offset="100%" stop-color="#38bdf8" stop-opacity=".62"/>
          </linearGradient>
        </defs>
        <rect width="280" height="52" fill="url(#np-frst-bg)"/>
        <polygon points="248,6 260,26 248,46 236,26" fill="#bae6fd" fill-opacity=".35" stroke="#e0f2fe" stroke-width="1.1"/>
        <polygon points="264,14 274,28 264,42 254,28" fill="#7dd3fc" fill-opacity=".30" stroke="#ffffff" stroke-width=".9"/>
        <path d="M188 38l22-14 14 4 12-10M248 14v24M239 20l18 12M257 20l-18 12" stroke="#e0f2fe" stroke-width=".9" opacity=".82"/>
      `,
    },

    "arcane-velvet": {
      id: "arcane-velvet",
      type: "nameplate",
      name: "Veludo Arcano",
      collection: "arcane",
      animated: true,
      animation_mode: ANIMATION_MODES.IDLE_WITH_EVENTS,
      version: COSMETIC_ENGINE_VERSION,
      reduced_motion: "keyframe-still",
      svg: `
        <defs>
          <linearGradient id="np-arc-bg" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stop-color="#2e1065" stop-opacity=".10"/>
            <stop offset="52%" stop-color="#581c87" stop-opacity=".46"/>
            <stop offset="100%" stop-color="#7c3aed" stop-opacity=".72"/>
          </linearGradient>
        </defs>
        <rect width="280" height="52" fill="url(#np-arc-bg)"/>
        <circle cx="250" cy="26" r="18" fill="none" stroke="#c084fc" stroke-width="1" stroke-dasharray="4 3" opacity=".72"/>
        <polygon points="250,12 260,26 250,40 240,26" fill="#a855f7" fill-opacity=".35" stroke="#fde68a" stroke-width="1.1"/>
        <circle cx="212" cy="18" r="1.6" fill="#fde68a" class="cos-twinkle"/>
        <circle cx="228" cy="36" r="1.5" fill="#e9d5ff" class="cos-twinkle cos-d2"/>
      `,
    },

    "eclipse-gold": {
      id: "eclipse-gold",
      type: "nameplate",
      name: "Aurora do Eclipse",
      collection: "eclipse",
      animated: true,
      animation_mode: ANIMATION_MODES.IDLE_WITH_EVENTS,
      version: COSMETIC_ENGINE_VERSION,
      reduced_motion: "keyframe-still",
      svg: `
        <defs>
          <linearGradient id="np-ecl-bg" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stop-color="#180a10" stop-opacity=".12"/>
            <stop offset="54%" stop-color="#881337" stop-opacity=".46"/>
            <stop offset="100%" stop-color="#be123c" stop-opacity=".72"/>
          </linearGradient>
        </defs>
        <rect width="280" height="52" fill="url(#np-ecl-bg)"/>
        <circle cx="252" cy="26" r="14" fill="#0c0a12" stroke="#fde68a" stroke-width="1.6"/>
        <circle cx="252" cy="26" r="19" fill="none" stroke="#fb7185" stroke-width=".9" opacity=".62"/>
        <circle cx="216" cy="20" r="1.6" fill="#fef08a" class="cos-twinkle"/>
        <circle cx="226" cy="34" r="1.5" fill="#fda4af" class="cos-ember-float"/>
      `,
    },

    "dream-mist": {
      id: "dream-mist",
      type: "nameplate",
      name: "Névoa Onírica",
      collection: "dream",
      animated: true,
      animation_mode: ANIMATION_MODES.IDLE_WITH_EVENTS,
      version: COSMETIC_ENGINE_VERSION,
      reduced_motion: "keyframe-still",
      svg: `
        <defs>
          <linearGradient id="np-drm-bg" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stop-color="#312e81" stop-opacity=".08"/>
            <stop offset="52%" stop-color="#6d28d9" stop-opacity=".34"/>
            <stop offset="100%" stop-color="#0d9488" stop-opacity=".56"/>
          </linearGradient>
        </defs>
        <rect width="280" height="52" fill="url(#np-drm-bg)"/>
        <path d="M180 42C206 24 234 36 278 16" fill="none" stroke="#ddd6fe" stroke-width="1.1" opacity=".72"/>
        <path d="M248 12a12 12 0 1 0 9 21 9.6 9.6 0 1 1-9-21Z" fill="#fef08a" opacity=".9"/>
        <circle cx="212" cy="18" r="1.6" fill="#a7f3d0" class="cos-twinkle"/>
        <circle cx="228" cy="34" r="1.5" fill="#fbcfe8" class="cos-twinkle cos-d2"/>
      `,
    },
  };

  // ===========================================================================
  // 5. SCHEDULER IDLE_WITH_EVENTS (Delta/Timer orgânico, pausa offscreen & reduced motion)
  // ===========================================================================
  const idleHosts = new Map();
  let idleObserver = null;

  function isPrimaryContext(ctx) {
    return (
      ctx === CONTEXTS.EDITOR_PREVIEW ||
      ctx === CONTEXTS.FULL_PROFILE ||
      ctx === CONTEXTS.PROFILE_POPOUT ||
      ctx === CONTEXTS.SELF_PROFILE_MENU
    );
  }

  function isElementLikelyVisible(el) {
    if (!el || !el.isConnected) return false;
    if (el.closest(".hidden, [hidden]")) return false;
    if (typeof el.getBoundingClientRect !== "function") return true;
    const rect = el.getBoundingClientRect();
    // Em ambientes headless/jsdom sem layout real, getBoundingClientRect() retorna 0×0.
    if (!rect.width && !rect.height) {
      if (typeof navigator !== "undefined" && /jsdom/i.test(navigator.userAgent || "")) return true;
      // Para wrappers inline/SVG dentro de superfícies primárias visíveis, verificar o card pai.
      const card = el.closest(".profile-card, #self-profile-menu, #live-profile-preview-card, .compact-profile-dialog");
      if (card && card !== el) {
        const cr = card.getBoundingClientRect();
        return cr.width > 0 && cr.height > 0 && cr.bottom > 0 && cr.top < (global.innerHeight || 1080) && cr.right > 0 && cr.left < (global.innerWidth || 1920);
      }
      return false;
    }
    const vw = global.innerWidth || 1920;
    const vh = global.innerHeight || 1080;
    return rect.bottom > 0 && rect.top < vh && rect.right > 0 && rect.left < vw;
  }

  function ensureIdleObserver() {
    if (idleObserver || typeof IntersectionObserver !== "function") return;
    idleObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const rec = idleHosts.get(entry.target);
        if (rec) {
          rec.visible = entry.isIntersecting || (isPrimaryContext(rec.context) && isElementLikelyVisible(entry.target));
        }
      }
      reconcileIdleBudget();
    }, { threshold: 0.01 });
  }

  function clearHostTimers(rec) {
    if (rec.secondaryTimer) clearTimeout(rec.secondaryTimer);
    if (rec.secondaryEndTimer) clearTimeout(rec.secondaryEndTimer);
    if (rec.rareTimer) clearTimeout(rec.rareTimer);
    if (rec.rareEndTimer) clearTimeout(rec.rareEndTimer);
    rec.secondaryTimer = null;
    rec.secondaryEndTimer = null;
    rec.rareTimer = null;
    rec.rareEndTimer = null;
  }

  function jitterMs(min, max) {
    return Math.round(min + Math.random() * (max - min));
  }

  function canRunIdleEvents(el, rec) {
    if (!el || !el.isConnected) return false;
    if (document.hidden || document.documentElement.classList.contains("visual-window-hidden") || isReducedMotionActive()) return false;
    if (typeof profileWindowFocused !== "undefined" && !profileWindowFocused) return false;
    if (el.closest(".hidden, [hidden]")) return false;
    if (rec.context === CONTEXTS.MEMBER_LIST) return false;
    if (rec.visible === false && !isElementLikelyVisible(el)) return false;
    return true;
  }

  function scheduleSecondary(el, rec, initial = false) {
    if (!rec.active) return;
    const min = initial ? BUDGET.firstSecondaryMinMs : BUDGET.secondaryMinMs;
    const max = initial ? BUDGET.firstSecondaryMaxMs : BUDGET.secondaryMaxMs;
    rec.secondaryTimer = setTimeout(() => {
      if (!rec.active || !canRunIdleEvents(el, rec)) return;
      el.classList.add("is-secondary-event");
      rec.secondaryEndTimer = setTimeout(() => {
        el.classList.remove("is-secondary-event");
        if (rec.active) scheduleSecondary(el, rec, false);
      }, BUDGET.secondaryDurationMs);
    }, jitterMs(min, max));
  }

  function scheduleRare(el, rec) {
    if (!rec.active) return;
    rec.rareTimer = setTimeout(() => {
      if (!rec.active || !canRunIdleEvents(el, rec)) return;
      el.classList.add("is-rare-event");
      rec.rareEndTimer = setTimeout(() => {
        el.classList.remove("is-rare-event");
        if (rec.active) scheduleRare(el, rec);
      }, BUDGET.rareDurationMs);
    }, jitterMs(BUDGET.rareMinMs, BUDGET.rareMaxMs));
  }

  function reconcileIdleBudget() {
    try {
      const entries = [...idleHosts.entries()];
      // Prioriza superfícies primárias (Editor, Perfil Completo, Popout, Self Menu) sobre listas
      // para que um perfil aberto nunca perca seu slot de budget para itens de fundo.
      entries.sort(([, a], [, b]) => (isPrimaryContext(b.context) ? 1 : 0) - (isPrimaryContext(a.context) ? 1 : 0));

      let activeCount = 0;
      for (const [el, rec] of entries) {
        if (!el.isConnected) {
          clearHostTimers(rec);
          idleObserver?.unobserve(el);
          idleHosts.delete(el);
          continue;
        }
        rec.context = detectElementContext(el);
        if (rec.visible === false && isPrimaryContext(rec.context) && isElementLikelyVisible(el)) {
          rec.visible = true;
        }
        const eligible = canRunIdleEvents(el, rec) && activeCount < BUDGET.maxConcurrentIdleHosts;
        if (eligible) {
          activeCount++;
          if (!rec.active) {
            rec.active = true;
            el.dataset.cosmeticIdleActive = "true";
            scheduleSecondary(el, rec, true);
            scheduleRare(el, rec);
          }
        } else if (rec.active) {
          rec.active = false;
          delete el.dataset.cosmeticIdleActive;
          el.classList.remove("is-secondary-event", "is-rare-event");
          clearHostTimers(rec);
        }
      }
    } catch (_) {
      // Isolamento de erro: falha no scheduler nunca derruba a interface.
    }
  }

  function registerIdleHost(el) {
    if (!el) return;
    if (idleHosts.has(el)) {
      const existing = idleHosts.get(el);
      existing.visible = isElementLikelyVisible(el);
      reconcileIdleBudget();
      return;
    }
    ensureIdleObserver();
    const rec = {
      visible: isElementLikelyVisible(el),
      active: false,
      context: detectElementContext(el),
      secondaryTimer: null,
      secondaryEndTimer: null,
      rareTimer: null,
      rareEndTimer: null,
    };
    idleHosts.set(el, rec);
    idleObserver?.observe(el);
    reconcileIdleBudget();
  }

  function unregisterIdleHost(el) {
    const rec = idleHosts.get(el);
    if (!rec) return;
    clearHostTimers(rec);
    el.classList.remove("is-secondary-event", "is-rare-event");
    delete el.dataset.cosmeticIdleActive;
    idleObserver?.unobserve(el);
    idleHosts.delete(el);
  }

  // Disparo manual para QA / testes determinísticos
  function triggerIdleEventNow(el, kind = "secondary") {
    if (!el || isReducedMotionActive()) return false;
    const cls = kind === "rare" ? "is-rare-event" : "is-secondary-event";
    el.classList.add(cls);
    return true;
  }

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", reconcileIdleBudget);
    window.addEventListener("focus", reconcileIdleBudget);
    window.addEventListener("blur", reconcileIdleBudget);
  }

  // ===========================================================================
  // 6. RENDERERS COMPARTILHADOS V5 (arte pintada WebP em camadas + VFX + fallback seguro)
  // ===========================================================================
  function avatarArtLayerHtml(id, depth) {
    try {
      const resolved = resolveCosmeticId("avatar_decoration", id);
      const v5 = resolved && Object.hasOwn(V5_AVATAR_ART, resolved) ? V5_AVATAR_ART[resolved] : null;
      const def = resolved && Object.hasOwn(AVATAR_DECORATIONS_V3, resolved) ? AVATAR_DECORATIONS_V3[resolved] : null;
      if (v5 && v5[depth]) {
        const theme = def?.theme || v5.motion || "cosmic";
        const animMode = def?.animation_mode || ANIMATION_MODES.IDLE_WITH_EVENTS;
        const modeAttr = def?.legacy_mode || "hover-loop";
        const blinkImg =
          depth === "front" && v5.blink
            ? `<img class="cos-v5-art-img cos-v5-blink-img" src="${v5.blink}" alt="" decoding="async" draggable="false" />`
            : "";
        return (
          `<span class="deco-svg-layer avatar-art-${depth} profile-art-${theme} cos-v5-deco cos-v3-deco cos-deco-${resolved} cos-v5-motion-${v5.motion}"` +
          ` data-art-version="5"` +
          ` data-animation-mode="${modeAttr}"` +
          ` data-cosmetic-mode="${animMode}"` +
          ` data-cosmetic-id="${resolved}"` +
          ` style="--avatar-art-bleed:${v5.bleed}%" aria-hidden="true">` +
          `<img class="cos-v5-art-img cos-v5-art-${depth}" src="${v5[depth]}" alt="" decoding="async" draggable="false" />` +
          blinkImg +
          `</span>`
        );
      }
      if (!def || !def[depth]) return "";
      const modeAttr = def.legacy_mode || (def.animated ? "hover-loop" : "static");
      return (
        `<span class="deco-svg-layer avatar-art-${depth} profile-art-${def.theme} cos-v3-deco cos-deco-${def.id}"` +
        ` data-art-version="${def.version}"` +
        ` data-animation-mode="${modeAttr}"` +
        ` data-cosmetic-mode="${def.animation_mode}"` +
        ` data-cosmetic-id="${def.id}"` +
        ` style="--avatar-art-bleed:${def.bleed}%" aria-hidden="true">` +
        `<svg viewBox="0 0 100 100" overflow="visible">${def[depth]}</svg></span>`
      );
    } catch (_) {
      return "";
    }
  }

  function attachAvatarIdle(el, id) {
    try {
      const resolved = resolveCosmeticId("avatar_decoration", id);
      const v5 = resolved && Object.hasOwn(V5_AVATAR_ART, resolved) ? V5_AVATAR_ART[resolved] : null;
      const def = resolved && Object.hasOwn(AVATAR_DECORATIONS_V3, resolved) ? AVATAR_DECORATIONS_V3[resolved] : null;
      const mode = def ? def.animation_mode : (v5 ? ANIMATION_MODES.IDLE_WITH_EVENTS : null);
      if (resolved && mode === ANIMATION_MODES.IDLE_WITH_EVENTS) {
        el.dataset.cosmeticMode = ANIMATION_MODES.IDLE_WITH_EVENTS;
        registerIdleHost(el);
        if (typeof SanvoCosmeticsVFX !== "undefined") SanvoCosmeticsVFX.attachAvatarVfx(el, resolved);
      } else {
        delete el.dataset.cosmeticMode;
        unregisterIdleHost(el);
        if (typeof SanvoCosmeticsVFX !== "undefined") SanvoCosmeticsVFX.detachAvatarVfx(el);
      }
    } catch (_) {
      // Fallback estático silencioso
    }
  }

  function profileFrameArtHtml(id) {
    try {
      const resolved = resolveCosmeticId("profile_frame", id);
      const v5 = resolved && Object.hasOwn(V5_FRAME_ART, resolved) ? V5_FRAME_ART[resolved] : null;
      const def = resolved && Object.hasOwn(PROFILE_FRAMES_V3, resolved) ? PROFILE_FRAMES_V3[resolved] : null;
      if (v5) {
        const animMode = def?.animation_mode || (v5.motion === "static" ? ANIMATION_MODES.STATIC : ANIMATION_MODES.IDLE_WITH_EVENTS);
        const isStatic = animMode === ANIMATION_MODES.STATIC || v5.motion === "static";
        const glint = !isStatic ? `<span class="frame-art-glint" aria-hidden="true"></span>` : "";
        return (
          `<span class="profile-frame-art profile-art-${v5.theme} cos-v5-frame cos-v3-frame cos-frame-${resolved} cos-v5-frame-motion-${v5.motion}"` +
          ` data-art-version="5"` +
          ` data-animation-mode="${isStatic ? "static" : "loop"}"` +
          ` data-cosmetic-mode="${animMode}"` +
          ` data-cosmetic-id="${resolved}" aria-hidden="true">` +
            `<span class="frame-v5-banner-wash"></span>` +
            `<img class="frame-v5-orn frame-v5-tl" src="${v5.tl}" alt="" decoding="async" draggable="false" />` +
            `<img class="frame-v5-orn frame-v5-tr" src="${v5.tr}" alt="" decoding="async" draggable="false" />` +
            `<img class="frame-v5-orn frame-v5-br" src="${v5.br}" alt="" decoding="async" draggable="false" />` +
            glint +
          `</span>`
        );
      }
      if (!def) return "";
      const extraSvgClass = resolved === "cyber-corners" ? " pf-corners" : "";
      const corner = `<svg class="frame-corner-svg${extraSvgClass}" viewBox="0 0 56 56" aria-hidden="true">${def.cornerSvg}</svg>`;
      const corners = ["top-left", "top-right", "bottom-left", "bottom-right"]
        .map((side) => `<span class="frame-art-corner ${side}">${corner}</span>`)
        .join("");
      const crest = def.crestSvg
        ? `<span class="frame-art-crest cos-frame-crest"><svg viewBox="0 0 100 16" preserveAspectRatio="none" aria-hidden="true">${def.crestSvg}</svg></span>`
        : `<span class="frame-art-crest"></span>`;
      const bottomSeal = def.bottomSealSvg
        ? `<span class="frame-art-bottom-seal"><svg viewBox="0 0 100 12" preserveAspectRatio="none" aria-hidden="true">${def.bottomSealSvg}</svg></span>`
        : "";
      const glint = def.animated ? `<span class="frame-art-glint" aria-hidden="true"></span>` : "";
      return (
        `<span class="profile-frame-art profile-art-${def.theme} cos-v3-frame cos-frame-${def.id}"` +
        ` data-art-version="${def.version}"` +
        ` data-animation-mode="${def.legacy_mode || (def.animated ? "loop" : "static")}"` +
        ` data-cosmetic-mode="${def.animation_mode}"` +
        ` data-cosmetic-id="${def.id}">` +
          `<span class="frame-art-under"></span>` +
          corners +
          `<span class="frame-art-rail left"></span><span class="frame-art-rail right"></span>` +
          crest +
          bottomSeal +
          glint +
          `<span class="frame-art-accent"></span>` +
        `</span>`
      );
    } catch (_) {
      return "";
    }
  }

  function attachFrameIdle(cardEl, id) {
    try {
      const resolved = resolveCosmeticId("profile_frame", id);
      const v5 = resolved && Object.hasOwn(V5_FRAME_ART, resolved) ? V5_FRAME_ART[resolved] : null;
      const def = resolved && Object.hasOwn(PROFILE_FRAMES_V3, resolved) ? PROFILE_FRAMES_V3[resolved] : null;
      const mode = def ? def.animation_mode : (v5 && v5.motion !== "static" ? ANIMATION_MODES.IDLE_WITH_EVENTS : null);
      if (resolved && (mode === ANIMATION_MODES.IDLE_WITH_EVENTS || mode === ANIMATION_MODES.REACTIVE)) {
        registerIdleHost(cardEl);
        if (typeof SanvoCosmeticsVFX !== "undefined") SanvoCosmeticsVFX.attachFrameVfx(cardEl, resolved);
      } else {
        if (!cardEl.dataset.cosmeticMode) unregisterIdleHost(cardEl);
        if (typeof SanvoCosmeticsVFX !== "undefined") SanvoCosmeticsVFX.detachFrameVfx(cardEl);
      }
    } catch (_) {
      // Fallback estático silencioso
    }
  }

  function profileEffectArtHtml(id) {
    try {
      const resolved = resolveCosmeticId("profile_effect", id);
      const def = resolved && Object.hasOwn(PROFILE_EFFECTS_V3, resolved) ? PROFILE_EFFECTS_V3[resolved] : null;
      if (!def) return "";
      const isV5Flagship = [
        "star-trail", "petal-drift", "polar-ribbon", "circuit-boot",
        "embers", "arcane-sigil", "abyssal-tide", "seraphim-fall",
      ].includes(def.id);
      if (isV5Flagship) {
        return (
          `<div class="profile-effect-timeline cos-v5-effect cos-v3-effect profile-art-${def.theme} cos-effect-${def.id}"` +
          ` data-art-version="5" data-cosmetic-mode="${def.animation_mode}" data-cosmetic-id="${def.id}" aria-hidden="true">` +
            `<span class="cos-v5-effect-backdrop"></span>` +
          `</div>`
        );
      }
      return (
        `<div class="profile-effect-timeline cos-v3-effect profile-art-${def.theme} cos-effect-${def.id}"` +
        ` data-art-version="${def.version}" data-cosmetic-mode="${def.animation_mode}" data-cosmetic-id="${def.id}" aria-hidden="true">` +
          `<svg class="profile-effect-art effect-plane-back" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice">${def.backSvg}</svg>` +
          `<svg class="profile-effect-art effect-plane-front" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice">${def.frontSvg}</svg>` +
        `</div>`
      );
    } catch (_) {
      return "";
    }
  }

  function getProfileEffectDuration(id) {
    const resolved = resolveCosmeticId("profile_effect", id);
    return resolved && Object.hasOwn(PROFILE_EFFECTS_V3, resolved) ? PROFILE_EFFECTS_V3[resolved].duration : null;
  }

  // Timeline multi-estágio: init -> entrance -> main -> climax -> dissipate -> cleanup
  const activeEffectTimers = new WeakMap();

  function clearEffectTimeline(layer) {
    const timers = activeEffectTimers.get(layer);
    if (timers) {
      for (const t of timers) clearTimeout(t);
      activeEffectTimers.delete(layer);
    }
    if (typeof SanvoCosmeticsVFX !== "undefined") SanvoCosmeticsVFX.stopEffectVfx(layer);
    if (layer) {
      layer.classList.remove("ef-stage-init", "ef-stage-entrance", "ef-stage-main", "ef-stage-climax", "ef-stage-dissipate");
      delete layer.dataset.effectStage;
    }
  }

  function startEffectTimeline(layer, id) {
    try {
      clearEffectTimeline(layer);
      const resolved = resolveCosmeticId("profile_effect", id);
      const def = resolved && Object.hasOwn(PROFILE_EFFECTS_V3, resolved) ? PROFILE_EFFECTS_V3[resolved] : null;
      if (!def || !layer) return null;
      const setStage = (stage) => {
        layer.classList.remove("ef-stage-init", "ef-stage-entrance", "ef-stage-main", "ef-stage-climax", "ef-stage-dissipate");
        layer.classList.add(`ef-stage-${stage}`);
        layer.dataset.effectStage = stage;
      };
      setStage("init");
      if (typeof SanvoCosmeticsVFX !== "undefined") {
        SanvoCosmeticsVFX.startEffectVfx(layer, def.id, def.duration);
      }
      const timers = [
        setTimeout(() => setStage("entrance"), def.stages.entrance),
        setTimeout(() => setStage("main"), def.stages.main),
        setTimeout(() => setStage("climax"), def.stages.climax),
        setTimeout(() => setStage("dissipate"), def.stages.dissipate),
      ];
      activeEffectTimers.set(layer, timers);
      return def.duration;
    } catch (_) {
      clearEffectTimeline(layer);
      return null;
    }
  }

  // NameplateRenderer: injeta camada gráfica SVG dedicada sem quebrar texto/filhos existentes
  function renderNameplateArt(el, id) {
    try {
      if (!el) return;
      const prevLayer = el.querySelector(":scope > .np-art-layer");
      const resolved = resolveCosmeticId("nameplate", id);
      const def = resolved && Object.hasOwn(NAMEPLATES_V3, resolved) ? NAMEPLATES_V3[resolved] : null;
      if (!def) {
        if (prevLayer) prevLayer.remove();
        el.classList.remove("has-np-art");
        if (el.dataset.npArtId) delete el.dataset.npArtId;
        unregisterIdleHost(el);
        return;
      }
      if (el.dataset.npArtId === def.id && prevLayer) return;
      if (prevLayer) prevLayer.remove();
      el.dataset.npArtId = def.id;
      el.classList.add("has-np-art");
      const layer = document.createElement("span");
      layer.className = `np-art-layer cos-v3-nameplate np-art-${def.id}`;
      layer.dataset.artVersion = String(def.version);
      layer.dataset.cosmeticMode = def.animation_mode;
      layer.setAttribute("aria-hidden", "true");
      layer.innerHTML = `<svg viewBox="0 0 280 52" preserveAspectRatio="xMaxYMid slice">${def.svg}</svg>`;
      el.prepend(layer);
      if (def.animation_mode === ANIMATION_MODES.IDLE_WITH_EVENTS) {
        registerIdleHost(el);
      } else {
        unregisterIdleHost(el);
      }
    } catch (_) {
      // Fallback limpo: texto da linha permanece 100% legível
    }
  }

  function getMetadata(type, id) {
    if (type === "avatar_decoration") return AVATAR_DECORATIONS_V3[id] || null;
    if (type === "profile_frame") return PROFILE_FRAMES_V3[id] || null;
    if (type === "profile_effect") return PROFILE_EFFECTS_V3[id] || null;
    if (type === "nameplate") return NAMEPLATES_V3[id] || null;
    return null;
  }

  const api = {
    VERSION: COSMETIC_ENGINE_VERSION,
    CONTEXTS,
    ANIMATION_MODES,
    BUDGET,
    COSMETIC_ANIMATION_MAP,
    LEGACY_COSMETIC_ALIASES,
    V5_AVATAR_ART,
    V5_FRAME_ART,
    registry: {
      avatar_decorations: AVATAR_DECORATIONS_V3,
      frames: PROFILE_FRAMES_V3,
      profile_effects: PROFILE_EFFECTS_V3,
      nameplates: NAMEPLATES_V3,
    },
    resolveCosmeticId,
    getAnimationMode,
    normalizeContext,
    detectElementContext,
    isReducedMotionActive,
    avatarArtLayerHtml,
    attachAvatarIdle,
    profileFrameArtHtml,
    attachFrameIdle,
    profileEffectArtHtml,
    getProfileEffectDuration,
    startEffectTimeline,
    clearEffectTimeline,
    renderNameplateArt,
    registerIdleHost,
    unregisterIdleHost,
    reconcileIdleBudget,
    triggerIdleEventNow,
    getMetadata,
    getIdleHostCount: () => idleHosts.size,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (global) {
    global.SanvoCosmetics = api;
    global.SancordCosmetics = api; // LEGACY COMPATIBILITY
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
