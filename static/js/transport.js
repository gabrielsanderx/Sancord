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
  return Object.freeze({
    origin,
    url: backendUrl,
    imageUrl(path) {
      if (/^data:image\/(?:png|jpe?g|gif|webp|bmp|avif);base64,[a-zA-Z0-9+/=]+$/.test(path)) return path;
      return backendUrl(path);
    },
    fetch(path, options) { return fetch(backendUrl(path), options); },
    websocketUrl() { return `${origin.replace(/^http/, "ws")}/ws`; },
    sessionKey(name) { return `${name}:${origin}`; },
    link(values, endpoint = origin) {
      return `sancord://open/?${new URLSearchParams({ endpoint, ...values })}`;
    },
  });
})();
