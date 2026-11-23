// A chave é protegida pelo mesmo DPAPI usado na sessão. Texto e anexos ficam cifrados no IndexedDB.
const SanotedStorage = (() => {
  let database;

  function openDatabase() {
    if (!database) database = new Promise((resolve, reject) => {
      const request = indexedDB.open("sanvo-sanoted", 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("keys");
        request.result.createObjectStore("documents");
        request.result.createObjectStore("files");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }).catch(error => { database = null; throw error; });
    return database;
  }

  function transaction(db, store, mode, operation) {
    return new Promise((resolve, reject) => {
      const txn = db.transaction(store, mode, mode === "readwrite" ? { durability: "strict" } : undefined);
      const request = operation(txn.objectStore(store));
      txn.oncomplete = () => resolve(request.result);
      txn.onabort = () => reject(txn.error || request.error || new Error("A gravação local foi interrompida."));
    });
  }

  async function accountKey(db, scope) {
    const get = () => transaction(db, "keys", "readonly", store => store.get(scope));
    let sealed = await get();
    if (!sealed) {
      const raw = crypto.getRandomValues(new Uint8Array(32));
      sealed = await SancordSessions.protectPrivate("seal", scope, btoa(String.fromCharCode(...raw)));
      if (!sealed) throw Error("O armazenamento protegido do Windows está indisponível.");
      try { await transaction(db, "keys", "readwrite", store => store.add(sealed, scope)); }
      catch (err) {
        if (err?.name !== "ConstraintError") throw err;
        sealed = await get();
      }
    }
    const raw = await SancordSessions.protectPrivate("open", scope, sealed);
    if (!raw) throw Error("O Windows não conseguiu abrir o armazenamento das notas.");
    return crypto.subtle.importKey("raw", Uint8Array.from(atob(raw), char => char.charCodeAt(0)), "AES-GCM", false, ["encrypt", "decrypt"]);
  }

  async function open(accountId) {
    const utf8 = new TextEncoder();
    const decoder = new TextDecoder();
    const scope = `sanoted:${accountId}:${SancordNet.origin}`;
    const db = await openDatabase();
    const key = await accountKey(db, scope);
    const range = prefix => IDBKeyRange.bound([scope, prefix], [scope, prefix + "\uffff"]);
    function crypt(store, id, iv) {
      return { name: "AES-GCM", iv, additionalData: utf8.encode(JSON.stringify([scope, store, id])) };
    }
    async function encrypt(store, id, bytes) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      return { id, iv, data: await crypto.subtle.encrypt(crypt(store, id, iv), key, bytes) };
    }
    function decrypt(store, item) {
      return crypto.subtle.decrypt(crypt(store, item.id, item.iv), key, item.data);
    }
    async function put(store, id, bytes, mime) {
      const item = await encrypt(store, id, bytes);
      if (mime) item.mime = mime;
      await transaction(db, store, "readwrite", records => records.put(item, [scope, id]));
    }
    return {
      async records() {
        const sealed = await transaction(db, "documents", "readonly", store => store.getAll(range("")));
        return Promise.all(sealed.map(async item => JSON.parse(decoder.decode(await decrypt("documents", item)))));
      },
      putDocument(id, value) { return put("documents", id, utf8.encode(JSON.stringify(value))); },
      removeDocument(id) { return transaction(db, "documents", "readwrite", store => store.delete([scope, id])); },
      async putFile(note, id, blob) { await put("files", `${note}:${id}`, await blob.arrayBuffer(), blob.type); },
      async getFile(note, id) {
        const item = await transaction(db, "files", "readonly", store => store.get([scope, `${note}:${id}`]));
        return item ? new Blob([await decrypt("files", item)], { type: item.mime }) : null;
      },
      removeFile(note, id) { return transaction(db, "files", "readwrite", store => store.delete([scope, `${note}:${id}`])); },
      removeFiles(note) { return transaction(db, "files", "readwrite", store => store.delete(range(`${note}:`))); },
    };
  }

  return { open };
})();
