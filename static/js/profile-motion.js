// Mídia de perfil: originais só nos espaços visíveis reservados para animação.
const PROFILE_GIF_SLOTS = 2;
const PROFILE_FRAME_JOBS = 2;
const PROFILE_FRAME_CACHE_SIZE = 64;
const PROFILE_FRAME_EDGE = 192;
const PROFILE_GIF_MAX_BYTES = 8 * 1024 * 1024;
const PROFILE_HOVER_MS = 3500;
const profileMedia = new Map();
const profileFrames = new Map();
const profileFrameJobs = new Map();
const profileLiveContexts = ".profile-card:not(.pf-mini), .profile-context-preview";
const profileHoverContexts = ".cosmetic-choice,.message-item,.member-item,.dm-item,.friend-row,.voice-user-row,.profile-card,.name-style-showcase-box,.effect-choice-btn";
let profileWindowFocused = true;
let profileMotionFrame = null;
let profileMotionSurface = null;
let profileHoverSurface = null;
let profileFocusSurface = null;
let profileHoverTimer = null;

function profileMotionAvailable() {
  return profileWindowFocused && !document.hidden && profileAnimPolicy() !== "never";
}

function interactionSurface() {
  return profileFocusSurface || profileHoverSurface;
}

function mediaShouldAnimate(img) {
  return Boolean(profileMotionAvailable() && !img.closest(".hidden,[hidden]") &&
    (profileAnimPolicy() === "always" || interactionSurface()?.contains(img) ||
      (img.closest(profileLiveContexts) && !img.closest(".cosmetic-choice"))));
}

function queueProfileMotion() {
  if (profileMotionFrame !== null || !globalThis.document?.body?.isConnected) return;
  profileMotionFrame = requestAnimationFrame(() => {
    profileMotionFrame = null;
    updateProfileMotion();
  });
}

const profileMediaObserver = typeof IntersectionObserver === "function" ? new IntersectionObserver(entries => {
  for (const { target, isIntersecting } of entries) {
    const record = profileMedia.get(target);
    if (record) record.visible = isIntersecting;
  }
  queueProfileMotion();
}) : null;

function applyProfileImageSource(img, src, animating) {
  img.classList.toggle("anim-paused", !animating);
  if (img.getAttribute("src") === src) return;
  img.classList.remove("profile-media-ready");
  if (src) img.src = src;
  else img.removeAttribute("src");
}

function syncMediaAnimation(img) {
  if (!img.dataset.anim) return;
  if (!profileMedia.has(img)) {
    profileMedia.set(img, { visible: !profileMediaObserver, stillFor: null });
    profileMediaObserver?.observe(img);
    img.classList.add("anim-paused");
  }
  queueProfileMotion();
}

function refreshAnimatedMedia(root = document) {
  root.querySelectorAll("img[data-anim]").forEach(syncMediaAnimation);
  queueProfileMotion();
}

function readCachedProfileFrame(src) {
  const frame = profileFrames.get(src);
  if (frame !== undefined) {
    profileFrames.delete(src);
    profileFrames.set(src, frame);
  }
  return frame;
}

async function decodeProfileFrame(src, signal) {
  if (typeof ImageDecoder !== "function") return null;
  const response = await fetch(src, { signal });
  if (!response.ok || Number(response.headers.get("Content-Length")) > PROFILE_GIF_MAX_BYTES || !response.body) return null;
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > PROFILE_GIF_MAX_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  if (size < 10 || signal.aborted) return null;
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const header = new DataView(bytes.buffer);
  const width = header.getUint16(6, true);
  const height = header.getUint16(8, true);
  if (header.getUint32(0) !== 0x47494638 || !width || !height || width > 4096 || height > 4096 || width * height > 8388608) return null;
  const decoder = new ImageDecoder({ data: bytes, type: "image/gif", preferAnimation: false });
  const abort = () => decoder.close();
  signal.addEventListener("abort", abort, { once: true });
  try {
    const { image } = await decoder.decode({ frameIndex: 0 });
    const canvas = document.createElement("canvas");
    const ratio = Math.min(1, PROFILE_FRAME_EDGE / Math.max(width, height));
    canvas.width = Math.max(1, Math.round(width * ratio));
    canvas.height = Math.max(1, Math.round(height * ratio));
    try {
      canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
    } finally {
      image.close();
    }
    return await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
  } finally {
    signal.removeEventListener("abort", abort);
    if (!signal.aborted) decoder.close();
  }
}

function prepareProfileFrame(src) {
  if (profileFrameJobs.has(src) || profileFrameJobs.size >= PROFILE_FRAME_JOBS) return;
  const controller = new AbortController();
  profileFrameJobs.set(src, controller);
  const timeout = setTimeout(() => controller.abort("timeout"), 8000);
  decodeProfileFrame(src, controller.signal).catch(() => null).then(blob => {
    if (!controller.signal.aborted || controller.signal.reason === "timeout") {
      profileFrames.set(src, blob ? URL.createObjectURL(blob) : null);
      if (profileFrames.size > PROFILE_FRAME_CACHE_SIZE) {
        const [old, url] = profileFrames.entries().next().value;
        profileFrames.delete(old);
        if (url) URL.revokeObjectURL(url);
      }
    }
  }).finally(() => {
    clearTimeout(timeout);
    profileFrameJobs.delete(src);
    queueProfileMotion();
  });
}

function updateProfileMotion() {
  const foreground = profileWindowFocused && !document.hidden;
  const interaction = interactionSurface();
  const surface = (profileMotionAvailable() && (
    interaction?.isConnected && !interaction.closest(".hidden,[hidden]") ? interaction :
      [...document.querySelectorAll("#profile-popover-card,#collection-preview-card,#live-profile-preview-card,#dm-peer-panel .profile-card,.cosmetic-picker-detail .profile-card")]
        .find(card => !card.closest(".hidden,[hidden]") && card.getClientRects().length)
  )) || null;
  if (profileMotionSurface !== surface) {
    profileMotionSurface?.classList.remove("profile-motion-active");
    profileMotionSurface = surface || null;
    profileMotionSurface?.classList.add("profile-motion-active");
  }
  const visible = [];
  for (const [img, record] of profileMedia) {
    if (!img.isConnected) {
      if (img.getAttribute("src") === img.dataset.profileSrc) img.removeAttribute("src");
      profileMediaObserver?.unobserve(img);
      profileMedia.delete(img);
    } else if (record.visible && img.dataset.profileSrc && !img.closest(".hidden,[hidden]")) {
      visible.push(img);
    }
  }
  const priority = img => interaction?.contains(img) ? 2 : img.closest(profileLiveContexts) ? 1 : 0;
  const live = new Set(visible.filter(img => mediaShouldAnimate(img) && profileFrames.get(img.dataset.profileSrc))
    .sort((a, b) => priority(b) - priority(a)).slice(0, PROFILE_GIF_SLOTS));
  const visibleSet = new Set(visible);
  // Libera os slots antes de carregar outros originais.
  for (const [img, record] of profileMedia) {
    if (live.has(img)) continue;
    const src = img.dataset.profileSrc;
    const isVisible = visibleSet.has(img);
    const wasAnimated = img.getAttribute("src") === src;
    if (!isVisible && !wasAnimated) continue;
    const frame = readCachedProfileFrame(src);
    if (frame) {
      applyProfileImageSource(img, frame, false);
      record.stillFor = src;
    } else {
      if (record.stillFor !== src) applyProfileImageSource(img, null, false);
      if (foreground && isVisible && frame === undefined && (record.stillFor !== src || mediaShouldAnimate(img))) {
        prepareProfileFrame(src);
      }
    }
  }
  for (const img of live) {
    applyProfileImageSource(img, img.dataset.profileSrc, true);
    profileMedia.get(img).stillFor = null;
  }
}

function noteProfileInteraction(target, keyboard) {
  const element = target instanceof Element ? target : null;
  const surface = element?.closest(profileHoverContexts) || element?.closest(".avatar-deco-wrap,.user-avatar-wrap,.avatar") || null;
  if (keyboard) profileFocusSurface = surface;
  else if (surface !== profileHoverSurface) {
    profileHoverSurface = surface;
    clearTimeout(profileHoverTimer);
    if (surface) profileHoverTimer = setTimeout(() => {
      profileHoverSurface = null;
      queueProfileMotion();
    }, PROFILE_HOVER_MS);
  }
  queueProfileMotion();
}

document.addEventListener("pointerover", e => noteProfileInteraction(e.target, false));
document.addEventListener("pointerout", e => noteProfileInteraction(e.relatedTarget, false));
document.addEventListener("focusin", e => noteProfileInteraction(e.target, true));
document.addEventListener("focusout", e => noteProfileInteraction(e.relatedTarget, true));
document.addEventListener("load", e => {
  if (e.target.matches?.("img[data-anim][src]")) e.target.classList.add("profile-media-ready");
}, true);
document.addEventListener("error", e => {
  if (e.target.matches?.("img[data-anim]")) e.target.classList.remove("profile-media-ready");
}, true);

function syncProfileWindow() {
  const inactive = !profileWindowFocused || document.hidden;
  document.body.classList.toggle("profile-window-inactive", inactive);
  if (inactive) {
    profileFocusSurface = null;
    profileHoverSurface = null;
    for (const controller of profileFrameJobs.values()) controller.abort("background");
    updateProfileMotion();
  } else {
    queueProfileMotion();
  }
}
window.addEventListener("blur", () => { profileWindowFocused = false; syncProfileWindow(); });
window.addEventListener("focus", () => { profileWindowFocused = true; syncProfileWindow(); });
document.addEventListener("visibilitychange", syncProfileWindow);

const profileMediaMutations = new MutationObserver(records => {
  if (!globalThis.document?.body?.isConnected) return;
  let changed = false;
  for (const record of records) {
    changed ||= record.removedNodes.length > 0;
    for (const node of record.addedNodes) {
      if (!(node instanceof Element)) continue;
      if (node.matches("img[data-anim]")) syncMediaAnimation(node);
      node.querySelectorAll("img[data-anim]").forEach(syncMediaAnimation);
      changed ||= node.matches(profileLiveContexts);
    }
  }
  if (changed) queueProfileMotion();
});
profileMediaMutations.observe(document.body, { childList: true, subtree: true });
