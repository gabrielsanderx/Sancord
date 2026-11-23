// No .exe, o armazenamento do WebView2 recebe somente o valor protegido pelo Windows.
const SancordSessions = (() => {
  const protectedNative = window.__SANCORD_AUTH_DPAPI === true;
  const sessionNames = ["sancord_token", "sancord_username", "sancord_accounts", "sancord_offline_snapshot"];
  const buckets = new Map([[localStorage, new Map()], [sessionStorage, new Map()]]);
  const requests = new Map();

  window.addEventListener("sancord-auth-storage", event => {
    const { id, value } = event.detail || {};
    requests.get(id)?.(typeof value === "string" ? value : null);
  });

  function protect(action, scope, value) {
    return new Promise(resolve => {
      const nonce = crypto.getRandomValues(new Uint32Array(4));
      const id = Array.from(nonce, number => number.toString(16).padStart(8, "0")).join("");
      const finish = result => {
        requests.delete(id);
        clearTimeout(timer);
        resolve(result);
      };
      const timer = setTimeout(() => finish(null), 4000);
      requests.set(id, finish);
      try {
        window.ipc.postMessage("auth-storage:" + JSON.stringify({ id, action, scope, value }));
      } catch (_) {
        finish(null);
      }
    });
  }

  const keyFor = name => SancordNet.sessionKey(name);
  const nativeScope = (storage, key) => `${storage === localStorage ? "persistente" : "temporaria"}:${key}`;
  const protectedKey = key => `${key}:dpapi`;
  function read(storage, key) {
    try { return storage.getItem(key); } catch (_) { return null; }
  }

  async function persist(storage, key, entry) {
    const sealed = await protect("seal", nativeScope(storage, key), entry.value);
    if (!sealed || buckets.get(storage).get(key) !== entry) return false;
    try {
      storage.setItem(protectedKey(key), sealed);
      storage.removeItem(key);
      return true;
    } catch (_) { return false; }
  }

  async function openBucket(storage, cache) {
    await Promise.all(sessionNames.map(async name => {
      const key = keyFor(name);
      const sealed = read(storage, protectedKey(key));
      const value = sealed ? await protect("open", nativeScope(storage, key), sealed) : read(storage, key);
      if (value === null || cache.has(key)) return;
      const entry = { value };
      cache.set(key, entry);
      if (!sealed) await persist(storage, key, entry);
    }));
  }

  const ready = protectedNative && SancordNet.secureForAuth
    ? Promise.all([...buckets.entries()].map(([storage, cache]) => openBucket(storage, cache)))
    : Promise.resolve();

  return {
    ready,
    get(storage, name) {
      const key = keyFor(name);
      return protectedNative ? buckets.get(storage).get(key)?.value ?? null : read(storage, key);
    },
    set(storage, name, value) {
      const key = keyFor(name);
      if (protectedNative) {
        const entry = { value };
        buckets.get(storage).set(key, entry);
        return persist(storage, key, entry);
      }
      try {
        storage.setItem(key, value);
        return true;
      } catch (_) { return false; }
    },
    remove(storage, name) {
      const key = keyFor(name);
      buckets.get(storage).delete(key);
      try {
        storage.removeItem(key);
        storage.removeItem(protectedKey(key));
      } catch (_) {}
    },
  };
})();
