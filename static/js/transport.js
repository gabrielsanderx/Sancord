// A interface vive no executável; somente dados e mídia vêm do backend.
const SancordNet = (() => {
  const params = new URLSearchParams(window.location.search);
  const configured = params.get("endpoint") || window.location.origin;
  const server = new URL(configured);
  if (!["http:", "https:"].includes(server.protocol) || server.username || server.password) {
    throw new Error("Endereço de servidor inválido.");
  }
  const origin = server.origin;
  const secureForAuth = server.protocol === "https:" ||
    server.hostname === "localhost" || server.hostname === "[::1]" || /^127(?:\.\d{1,3}){3}$/.test(server.hostname);
  const backendUrl = path => {
    const url = new URL(path, `${origin}/`);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("URL de recurso inválida.");
    return url.href;
  };
  const INVITE_BASE_URL = "sancord://open/"; // LEGACY COMPATIBILITY: protocolo mantido para clientes antigos; Sanvo aceita sanvo:// e sancord://
  const SANVO_INVITE_BASE_URL = "sanvo://open/";
  function inviteUrl(code, endpoint = origin) {
    const clean = String(code || "").trim();
    return `${INVITE_BASE_URL}?${new URLSearchParams({ endpoint, invite: clean })}`;
  }
  function sanvoInviteUrl(code, endpoint = origin) {
    const clean = String(code || "").trim();
    return `${SANVO_INVITE_BASE_URL}?${new URLSearchParams({ endpoint, invite: clean })}`;
  }
  function extractInviteCode(raw) {
    const txt = String(raw || "").trim();
    if (!txt) return "";
    const qIdx = txt.indexOf("invite=");
    if (qIdx !== -1) {
      return txt.slice(qIdx + 7).split(/[&#\s]/)[0].trim();
    }
    const protoIdx = txt.indexOf("://invite/");
    if (protoIdx !== -1) {
      return txt.slice(protoIdx + 10).split(/[?#/\s]/)[0].trim();
    }
    const pathIdx = txt.indexOf("/invite/");
    if (pathIdx !== -1) {
      return txt.slice(pathIdx + 8).split(/[?#/\s]/)[0].trim();
    }
    const sanvoShortIdx = txt.indexOf("sanvo.gg/");
    if (sanvoShortIdx !== -1) {
      return txt.slice(sanvoShortIdx + 9).split(/[?#/\s]/)[0].trim();
    }
    // LEGACY COMPATIBILITY: aceita links curtos legados sancord.gg/
    const shortIdx = txt.indexOf("sancord.gg/");
    if (shortIdx !== -1) {
      return txt.slice(shortIdx + 11).split(/[?#/\s]/)[0].trim();
    }
    return txt.replace(/^\/+|\/+$/g, "");
  }
  const uploads = new Set();
  async function backendFetch(path, options) {
    const url = backendUrl(path);
    const upload = new URL(url).pathname === "/api/attachments" && options?.method === "POST";
    if (upload && typeof SancordConnection !== "undefined" && SancordConnection.isInterrupted()) {
      throw new Error("Upload interrompido");
    }
    const controller = upload ? new AbortController() : null;
    const authorization = options?.headers?.Authorization;
    if (controller) uploads.add(controller);
    try {
      const response = await fetch(url, controller ? { ...options, signal: controller.signal } : options);
      if (response.status === 401 && authorization && typeof getStoredToken === "function"
        && authorization === `Bearer ${getStoredToken()}`) SancordConnection.reject();
      return response;
    } finally {
      if (controller) uploads.delete(controller);
    }
  }
  return Object.freeze({
    origin,
    secureForAuth,
    INVITE_BASE_URL,
    SANVO_INVITE_BASE_URL,
    url: backendUrl,
    imageUrl(path) {
      if (/^data:image\/(?:png|jpe?g|gif|webp|bmp|avif);base64,[a-zA-Z0-9+/=]+$/.test(path)) return path;
      return backendUrl(path);
    },
    fetch: backendFetch,
    interruptUploads() { for (const controller of uploads) controller.abort(); },
    websocketUrl() { return `${origin.replace(/^http/, "ws")}/ws`; },
    sessionKey(name) { return `${name}:${origin}`; },
    inviteUrl,
    sanvoInviteUrl,
    extractInviteCode,
    link(values, endpoint = origin) {
      return `${INVITE_BASE_URL}?${new URLSearchParams({ endpoint, ...values })}`;
    },
    sanvoLink(values, endpoint = origin) {
      return `${SANVO_INVITE_BASE_URL}?${new URLSearchParams({ endpoint, ...values })}`;
    },
  });
})();
const SanvoNet = SancordNet;
if (typeof globalThis !== "undefined") {
  globalThis.SanvoNet = SancordNet;
  globalThis.SancordNet = SancordNet; // LEGACY COMPATIBILITY
}
