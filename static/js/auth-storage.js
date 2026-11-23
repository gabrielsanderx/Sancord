// Camada centralizada de migração Sancord -> Sanvo para chaves de armazenamento local e sessão.
const LegacySancordMigration = (() => {
  const KEY_PAIRS = Object.freeze([
    ["sanvo_token", "sancord_token"],
    ["sanvo_username", "sancord_username"],
    ["sanvo_accounts", "sancord_accounts"],
    ["sanvo_offline_snapshot", "sancord_offline_snapshot"],
    ["sanvo_audio_settings", "sancord_audio_settings"],
    ["sanvo_audio_settings_v3", "sancord_audio_settings_v3"],
    ["sanvo_lang", "sancord_lang"],
    ["sanvo_trusted_domains", "sancord_trusted_domains"],
    ["sanvo_recent_emojis", "sancord_recent_emojis"],
    ["sanvo_starred_msgs", "sancord_starred_msgs"],
    ["sanvo_ignored_users", "sancord_ignored_users"],
    ["sanvo_user_notes", "sancord_user_notes"],
  ]);

  const SANVO_TO_LEGACY = Object.freeze(Object.fromEntries(KEY_PAIRS));
  const LEGACY_TO_SANVO = Object.freeze(Object.fromEntries(KEY_PAIRS.map(([s, l]) => [l, s])));

  function toCanonicalSessionName(name) {
    // LEGACY COMPATIBILITY: os scopes DPAPI existentes usam sancord_* como chave base por origin.
    return SANVO_TO_LEGACY[name] || name;
  }

  function toSanvoKey(name) {
    return LEGACY_TO_SANVO[name] || name;
  }

  function migrateStoragePrefs(storage) {
    if (!storage || typeof storage.getItem !== "function") return 0;
    let migrated = 0;
    for (const [sanvoKey, legacyKey] of KEY_PAIRS) {
      if (sanvoKey === "sanvo_token" || sanvoKey === "sanvo_username" || sanvoKey === "sanvo_accounts" || sanvoKey === "sanvo_offline_snapshot") {
        continue;
      }
      try {
        const currentSanvo = storage.getItem(sanvoKey);
        const currentLegacy = storage.getItem(legacyKey);
        if (currentSanvo === null && currentLegacy !== null) {
          storage.setItem(sanvoKey, currentLegacy);
          migrated++;
        } else if (currentLegacy === null && currentSanvo !== null) {
          storage.setItem(legacyKey, currentSanvo);
        }
      } catch (_) {}
    }
    return migrated;
  }

  function getCompatItem(storage, name) {
    if (!storage || typeof storage.getItem !== "function") return null;
    const sanvoKey = toSanvoKey(name);
    const legacyKey = SANVO_TO_LEGACY[sanvoKey] || name;
    try {
      const val = storage.getItem(sanvoKey);
      if (val !== null) return val;
      const legacyVal = storage.getItem(legacyKey);
      if (legacyVal !== null) {
        try { storage.setItem(sanvoKey, legacyVal); } catch (_) {}
      }
      return legacyVal;
    } catch (_) {
      return null;
    }
  }

  function setCompatItem(storage, name, value) {
    if (!storage || typeof storage.setItem !== "function") return false;
    const sanvoKey = toSanvoKey(name);
    const legacyKey = SANVO_TO_LEGACY[sanvoKey] || name;
    try {
      storage.setItem(sanvoKey, value);
      if (legacyKey !== sanvoKey) storage.setItem(legacyKey, value);
      return true;
    } catch (_) {
      return false;
    }
  }

  try {
    if (typeof localStorage !== "undefined") migrateStoragePrefs(localStorage);
  } catch (_) {}

  return Object.freeze({
    KEY_PAIRS,
    SANVO_TO_LEGACY,
    LEGACY_TO_SANVO,
    toCanonicalSessionName,
    toSanvoKey,
    migrateStoragePrefs,
    getCompatItem,
    setCompatItem,
  });
})();

// No .exe, o armazenamento do WebView2 recebe somente o valor protegido pelo Windows.
const SancordSessions = (() => {
  const protectedNative = window.__SANCORD_AUTH_DPAPI === true || window.__SANVO_AUTH_DPAPI === true;
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

  const keyFor = name => SancordNet.sessionKey(LegacySancordMigration.toCanonicalSessionName(name));
  const sanvoAliasKeyFor = name => SancordNet.sessionKey(LegacySancordMigration.toSanvoKey(name));
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
      const aliasKey = sanvoAliasKeyFor(name);
      const sealed = read(storage, protectedKey(key)) || read(storage, protectedKey(aliasKey));
      const value = sealed
        ? await protect("open", nativeScope(storage, key), sealed)
        : (read(storage, key) ?? read(storage, aliasKey));
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
    protectPrivate(action, scope, value) {
      return protectedNative && SancordNet.secureForAuth ? protect(action, scope, value) : Promise.resolve(null);
    },
    get(storage, name) {
      const key = keyFor(name);
      const aliasKey = sanvoAliasKeyFor(name);
      if (protectedNative) return buckets.get(storage).get(key)?.value ?? null;
      return read(storage, key) ?? read(storage, aliasKey);
    },
    set(storage, name, value) {
      const key = keyFor(name);
      const aliasKey = sanvoAliasKeyFor(name);
      if (protectedNative) {
        const entry = { value };
        buckets.get(storage).set(key, entry);
        return persist(storage, key, entry);
      }
      try {
        storage.setItem(key, value);
        if (aliasKey !== key) storage.setItem(aliasKey, value);
        return true;
      } catch (_) { return false; }
    },
    remove(storage, name) {
      const key = keyFor(name);
      const aliasKey = sanvoAliasKeyFor(name);
      buckets.get(storage).delete(key);
      try {
        storage.removeItem(key);
        storage.removeItem(protectedKey(key));
        if (aliasKey !== key) {
          storage.removeItem(aliasKey);
          storage.removeItem(protectedKey(aliasKey));
        }
      } catch (_) {}
    },
  };
})();
const SanvoSessions = SancordSessions;
if (typeof globalThis !== "undefined") {
  globalThis.LegacySancordMigration = LegacySancordMigration;
  globalThis.SanvoSessions = SancordSessions;
  globalThis.SancordSessions = SancordSessions; // LEGACY COMPATIBILITY
}
