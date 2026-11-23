// Geometria vetorial própria e compartilhada. Emojis de mensagens, reações e
// personalização continuam sendo conteúdo; somente controles usam estes ícones.
const SancordIcons = (() => {
  const paths = {
    hash: '<path d="M9 3 7 21M17 3l-2 18M4 9h17M3 15h17"/>',
    voice: '<path d="m11 4-5 4H3v8h3l5 4zM15 8q5 4 0 8M18 5q8 7 0 14"/>',
    mic: '<rect x="9" y="3" width="6" height="12" rx="3"/><path d="M6 11v1a6 6 0 0 0 12 0v-1M12 18v3M8 21h8"/>',
    'mic-off': '<path d="M9 6V5a3 3 0 0 1 6 0v6M6 11v1a6 6 0 0 0 10 4M18 11v1M12 18v3M8 21h8M3 3l18 18"/>',
    headphones: '<path d="M4 14v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="12" width="5" height="9" rx="2"/><rect x="16" y="12" width="5" height="9" rx="2"/>',
    'headphones-off': '<path d="M4 10a8 8 0 0 1 13-5M20 9v5M3 3l18 18"/><rect x="3" y="12" width="5" height="9" rx="2"/><path d="M16 16v3a2 2 0 0 0 2 2h1"/>',
    settings: '<path d="m9 3-1 3-3 1 1 4-2 2 2 4 4-1 2 3 4-1 1-4 3-1-1-4-3-1-1-3z"/><circle cx="12" cy="11" r="3"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 6 0 0 1 16 0v2"/>',
    'user-plus': '<circle cx="9" cy="8" r="3.5"/><path d="M2 20v-1.5a7 5 0 0 1 14 0V20M19 8v6M16 11h6"/>',
    users: '<circle cx="9" cy="8" r="3"/><path d="M2 21v-3a7 5 0 0 1 14 0v3M17 5a3 3 0 0 1 0 6M19 14q3 1 3 5v2"/>',
    pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
    play: '<path d="M6 4l14 8-14 8z"/>',
    chat: '<path d="M4 4h16v12H9l-5 4zM8 8h8M8 12h5"/>',
    forum: '<path d="M3 3h14v11H8l-5 4zM9 18h8l4 3V9h-2"/>',
    announcement: '<path d="m3 10 16-6v16L3 14zM7 15l2 6h4l-2-5M22 9v6"/>',
    search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
    plus: '<path d="M12 4v16M4 12h16"/>',
    close: '<path d="m5 5 14 14M19 5 5 19"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>',
    reply: '<path d="m9 5-6 6 6 6M3 11h10a8 8 0 0 1 8 8"/>',
    edit: '<path d="m4 15 11-11 5 5L9 20l-6 1zM13 6l5 5"/>',
    more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    smile: '<circle cx="12" cy="12" r="9"/><path d="M8 15q4 4 8 0M8 8v1M16 8v1"/>',
    pin: '<path d="M8 3h8l-1 7 4 5H5l4-5zM12 15v7"/>',
    bell: '<path d="M5 16h14l-2-3V9a5 5 0 0 0-10 0v4zM10 20h4"/>',
    camera: '<rect x="2" y="5" width="14" height="14" rx="2"/><path d="m16 10 6-4v12l-6-4"/>',
    screen: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M12 17v4M7 21h10m-9-12 4-4 4 4M12 5v8"/>',
    expand: '<path d="M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5"/>',
    phone: '<path d="M5 3 2 6q1 13 16 16l4-4-6-4-3 3q-5-2-7-7l3-3z"/>',
    disconnect: '<path d="M3 16v-5q9-8 18 0v5h-6v-5q-3-2-6 0v5z"/>',
    folder: '<path d="M3 5h7l2 3h9v13H3z"/>',
    file: '<path d="M5 2h9l5 5v15H5zM14 2v6h5M8 13h8M8 17h6"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="2"/><path d="m3 18 6-6 4 4 3-5 5 7"/>',
    sticker: '<path d="M20 12v-7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h6l8-8zM12 20v-7a1 1 0 0 1 1-1h7M8 8h.01M13 8h.01"/>',
    lock: '<rect x="4" y="10" width="16" height="12" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4M12 15v3"/>',
    shield: '<path d="m12 2 9 4v6q0 7-9 10-9-3-9-10V6zM8 12l3 3 5-6"/>',
    link: '<path d="m10 7 3-3a5 5 0 0 1 7 7l-3 3M14 17l-3 3a5 5 0 0 1-7-7l3-3M8 16l8-8"/>',
    copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 5V3H3v13h2"/>',
    trash: '<path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 2v6M17 2v6M3 10h18M7 14h3M14 14h3M7 18h3"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 3"/>',
    poll: '<path d="M3 21h18M6 17V9h3v8M11 17V3h3v14M16 17v-5h3v5"/>',
    star: '<path d="m12 2 3 6 7 1-5 5 1 8-6-4-6 4 1-8-5-5 7-1z"/>',
    download: '<path d="M12 3v12m-5-5 5 5 5-5M3 16v5h18v-5"/>',
    logout: '<path d="M10 3H3v18h7M8 12h14m-5-5 5 5-5 5"/>',
    palette: '<path d="M12 3a9 9 0 1 0 0 18h2q2-1 0-3-1-2 2-3h2q4 0 3-5-2-7-9-7z"/><circle cx="7" cy="9" r="1"/><circle cx="11" cy="6" r="1"/><circle cx="16" cy="8" r="1"/>',
    arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
    'arrow-up': '<path d="M12 20V4m-6 6 6-6 6 6"/>',
    'arrow-down': '<path d="M12 4v16m-6-6 6 6 6-6"/>',
    check: '<path d="m4 12 5 5L20 6"/>',
    square: '<rect x="4" y="4" width="16" height="16" rx="3"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3q-7 9 0 18M12 3q7 9 0 18"/>',
    eye: '<path d="M2 12q10-16 20 0-10 16-20 0z"/><circle cx="12" cy="12" r="3"/>',
    'eye-off': '<path d="M3 3l18 18M8 6q8-4 14 6-2 3-5 5M14 19q-7 1-12-7 2-3 4-4M10 10a3 3 0 0 0 4 4"/>',
    rotate: '<path d="M3 10V3m0 7h7M3 10a9 9 0 1 1 1 9"/>',
    moon: '<path d="M20 15A9 9 0 0 1 9 4 9 9 0 1 0 20 15z"/>',
    noise: '<path d="M3 10v4M7 6v12M12 3v18M17 7v10M21 10v4"/>',
    ban: '<circle cx="12" cy="12" r="9"/><path d="m6 6 12 12"/>',
    tag: '<path d="M3 3h9l10 10-9 9L3 12z"/><circle cx="7" cy="7" r="1"/>',
    archive: '<path d="M3 3h18v5H3zM5 8v13h14V8M9 12h6"/>',
    move: '<path d="M3 12h18m-5-5 5 5-5 5M8 7l-5 5 5 5"/>',
    'bell-off': '<path d="M5 16h14l-2-3V9a5 5 0 0 0-10 0v4zM10 20h4M3 3l18 18"/>',
    thread: '<path d="M6 3v11a4 4 0 0 0 4 4h8"/><circle cx="6" cy="3" r="2"/><circle cx="20" cy="18" r="2"/>',
    signal: '<path d="M2 8q10-9 20 0M5 12q7-7 14 0M8 16q4-4 8 0"/><circle cx="12" cy="20" r="1"/>',
  };
  const aliases = { '⚙':'settings','🔊':'voice','🎙':'mic','🎧':'headphones','👤':'user','👥':'users','💬':'chat','🧵':'forum','📢':'announcement','🔍':'search','＋':'plus','➕':'plus','✕':'close','↩':'reply','✏':'edit','⋯':'more','😊':'smile','📌':'pin','🔔':'bell','📹':'camera','🖥':'screen','📞':'phone','📁':'folder','📄':'file','🖼':'image','🔒':'lock','🛡':'shield','🔗':'link','📋':'copy','🗑':'trash','📅':'calendar','⏱':'clock','📊':'poll','★':'star','⭐':'star','🚪':'logout','↑':'arrow','↓':'arrow' };
  Object.assign(aliases, {'#':'hash','↔':'move','⏏':'logout','✔':'check','🆔':'file','🎨':'palette','🏷':'tag','📂':'folder','📦':'archive','📷':'camera','🔇':'mic-off','🔕':'bell-off','🕘':'clock','🗂':'folder','🚫':'ban'});
  Object.assign(aliases, {'↑':'arrow-up','↓':'arrow-down'});
  function resolve(name) {
    const value = String(name || '').replace(/\uFE0F/g, '');
    return Object.hasOwn(paths, value) ? value : Object.hasOwn(aliases, value) ? aliases[value] : 'more';
  }
  function html(name) {
    const key = resolve(name);
    return `<svg class="ui-icon" data-sancord-icon="${key}" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths[key]}</svg>`;
  }
  function node(name) { const template = document.createElement('template'); template.innerHTML = html(name); return template.content.firstElementChild; }
  const ids = { 'open-settings-btn':'settings','attach-image-btn':'plus','poll-create-btn':'poll','emoji-picker-btn':'smile','cancel-reply-btn':'close','remove-image-btn':'close','open-events-btn':'calendar','pinned-msgs-btn':'pin','toggle-members-btn':'users','open-server-settings-btn':'settings','copy-invite-btn':'users','leave-server-btn':'logout','open-add-server-btn':'plus','dm-call-btn':'phone','dm-video-call-btn':'camera','toggle-stage-btn':'screen','toggle-camera-btn':'camera','share-screen-btn':'screen','disconnect-voice-btn':'disconnect','mic-quick-chevron':'chevron','spk-quick-chevron':'chevron','server-menu-btn':'chevron','tb-close':'close' };
  Object.assign(ids, {'close-settings-btn':'close','settings-logout-btn':'logout','close-profile-card-btn':'close','open-friends-tab-btn':'users','open-starred-tab-btn':'star','check-updates-btn':'download','quick-switcher-close':'close','events-close-btn':'close'});
  Object.assign(ids, {'open-discover-servers-btn':'globe','quick-krisp-btn':'noise','leave-voice-btn':'disconnect','avatar-rotate-btn':'rotate'});
  const tabs = {account:'user',profile:'edit',security:'lock',devices:'screen',connections:'link',privacy:'shield',social:'users',requests:'chat',blocked:'ban',activity:'signal',voice:'headphones',notifications:'bell',appearance:'palette',accessibility:'eye',chat:'chat',language:'globe',shortcuts:'settings',windows:'screen',updates:'download',advanced:'settings',diagnostics:'signal',about:'globe'};
  const actions = {dm:'chat',call:'phone',more:'more',reply:'reply',edit:'edit',react:'smile',accept:'check',reject:'close',remove:'close'};
  const contextActions = {'react-more':'smile',reply:'reply','create-thread':'thread',forward:'arrow','copy-text':'copy',pin:'pin',star:'star','mark-unread':'eye','copy-link':'link',edit:'edit',delete:'trash'};
  const classes = { 'send-btn':'arrow','add-channel-btn':'plus','channel-edit-btn':'settings','pw-eye-btn':'eye','swatch-auto':'moon' };
  function decorate(root) {
    const graphics = [...(root.matches?.('[data-ui-icon]') ? [root] : []), ...root.querySelectorAll('[data-ui-icon]')];
    for (const graphic of graphics) {
      const key = resolve(graphic.dataset.uiIcon);
      if (graphic.querySelector(`svg[data-sancord-icon="${key}"]`)) continue;
      const svg = node(key);
      if (graphic.tagName.toLowerCase() === 'svg') {
        for (const name of graphic.classList) svg.classList.add(name);
        graphic.replaceWith(svg);
      } else graphic.replaceChildren(svg);
    }
    const controls = [...(root.matches?.('button') ? [root] : []), ...root.querySelectorAll('button')];
    for (const el of controls) {
      const text = el.textContent.trim().replace(/\uFE0F/g, '');
      const contentIcon = !el.matches('.reaction-pill, .emoji-choice-btn, .emoji-tab, .guild-icon, .guild-folder-toggle, [data-quick-react], [data-ctx-react]') && Object.hasOwn(aliases, text) ? aliases[text] : null;
      const classIcon = Object.keys(classes).find(name => el.classList.contains(name));
      const key = ids[el.id] || tabs[el.dataset.settingsTab] || actions[el.dataset.act] || contextActions[el.dataset.ctxAct] || classes[classIcon] || contentIcon;
      if (!key || el.querySelector(`svg[data-sancord-icon="${key}"]`)) continue;
      const svg = node(key);
      const previous = el.querySelector('svg');
      if (previous) {
        for (const name of previous.classList) svg.classList.add(name);
        previous.replaceWith(svg);
      }
      else if (contentIcon || ['＋','+','⌄','✕','📊','×'].includes(text)) el.replaceChildren(svg);
      else if (el.id === 'open-events-btn') el.querySelector('[aria-hidden]')?.replaceChildren(svg);
      if (!el.hasAttribute('aria-label') && el.title) el.setAttribute('aria-label', el.title);
    }
  }
  return { html, node, resolve, decorate };
})();

// Só visita subárvores recém-inseridas. Não revarre o histórico a cada mensagem.
if (typeof document !== 'undefined' && typeof document.querySelectorAll === 'function' && typeof MutationObserver === 'function') {
  SancordIcons.decorate(document);
  new MutationObserver(records => {
    for (const record of records) for (const root of record.addedNodes) {
      const target = root.nodeType === 3 ? root.parentElement : root;
      if (target?.nodeType === 1 && !target.closest('svg')) SancordIcons.decorate(target);
    }
  }).observe(document.body, {childList:true, subtree:true});
}
const SanvoIcons = SancordIcons;
if (typeof globalThis !== "undefined") {
  globalThis.SanvoIcons = SancordIcons;
  globalThis.SancordIcons = SancordIcons; // LEGACY COMPATIBILITY
}
