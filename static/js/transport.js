// A interface vive no executável; somente dados e mídia vêm do backend.
const SancordNet = (() => {
  const params = new URLSearchParams(window.location.search);
  const configured = params.get("endpoint") || window.location.origin;
  const server = new URL(configured);
  if (!["http:", "https:"].includes(server.protocol) || server.username || server.password) {
    throw new Error("Endereço de servidor inválido.");
  }
  const origin = server.origin;
  const backendUrl = path => {
    const url = new URL(path, `${origin}/`);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("URL de recurso inválida.");
    return url.href;
  };
  const INVITE_BASE_URL = "sancord://open/";
  function inviteUrl(code, endpoint = origin) {
    const clean = String(code || "").trim();
    return `${INVITE_BASE_URL}?${new URLSearchParams({ endpoint, invite: clean })}`;
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
    const shortIdx = txt.indexOf("sancord.gg/");
    if (shortIdx !== -1) {
      return txt.slice(shortIdx + 11).split(/[?#/\s]/)[0].trim();
    }
    return txt.replace(/^\/+|\/+$/g, "");
  }
  return Object.freeze({
    origin,
    INVITE_BASE_URL,
    url: backendUrl,
    imageUrl(path) {
      if (/^data:image\/(?:png|jpe?g|gif|webp|bmp|avif);base64,[a-zA-Z0-9+/=]+$/.test(path)) return path;
      return backendUrl(path);
    },
    fetch(path, options) { return fetch(backendUrl(path), options); },
    websocketUrl() { return `${origin.replace(/^http/, "ws")}/ws`; },
    sessionKey(name) { return `${name}:${origin}`; },
    inviteUrl,
    extractInviteCode,
    link(values, endpoint = origin) {
      return `${INVITE_BASE_URL}?${new URLSearchParams({ endpoint, ...values })}`;
    },
  });
})();
