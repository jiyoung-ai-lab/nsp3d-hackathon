// NSP 3D — managed artifact store (browser): OPFS owns blobs, IndexedDB owns
// the queryable index. No permission prompts, no user paths. Import-time
// side-effect free (safe to import in node for the pure-helper test).
const DB_NAME = 'nsp_artifacts';
const DB_VERSION = 1;
const STORE = 'artifacts';

export function opfsPathFor(kind, filename) {
  const dir = kind === 'webm' ? 'recordings' : 'artifacts';
  return `${dir}/${filename}`;
}
export function artifactId(kind, filename) {
  return `${kind}:${filename}`;
}

function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const st = db.createObjectStore(STORE, { keyPath: 'id' });
        st.createIndex('kind', 'kind');
        st.createIndex('page', 'page');
        st.createIndex('createdAt', 'createdAt');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function idbTx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const out = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(out && 'result' in out ? out.result : undefined);
    tx.onerror = () => reject(tx.error);
  });
}
async function opfsDir(root, parts, create) {
  let dir = root;
  for (const p of parts) dir = await dir.getDirectoryHandle(p, { create: !!create });
  return dir;
}

async function opfsWrite(path, blob) {
  const root = await navigator.storage.getDirectory();
  const parts = path.split('/');
  const dir = await opfsDir(root, parts.slice(0, -1), true);
  const name = parts[parts.length - 1];
  let final = name, n = 1;
  for (;;) {
    try {
      await dir.getFileHandle(final);
    } catch (e) { break; } // missing -> usable
    n += 1;
    final = name.replace(/(\.[^.]+)$/, `_${n}$1`);
  }
  const fh = await dir.getFileHandle(final, { create: true });
  const w = await fh.createWritable();
  try {
    await w.write(blob);
  } finally {
    await w.close();
  }
  return [...parts.slice(0, -1), final].join('/');
}

export async function saveArtifact({ kind, page, source, filename, blob, mime, meta }) {
  const opfsPath = await opfsWrite(opfsPathFor(kind, filename), blob);
  const finalName = opfsPath.split('/').pop();
  const rec = {
    id: artifactId(kind, finalName), kind, page, source,
    filename: finalName, opfsPath, size: blob.size,
    mime: mime || blob.type || 'application/octet-stream',
    createdAt: new Date().toISOString(), meta: meta || null,
  };
  const db = await idbOpen();
  try {
    await idbTx(db, 'readwrite', (st) => st.put(rec));
  } finally {
    db.close();
  }
  return rec;
}

export async function listArtifacts(filter = {}) {
  const db = await idbOpen();
  try {
    const all = await idbTx(db, 'readonly', (st) => st.getAll());
    return (all || []).filter((r) =>
      (!filter.kind || r.kind === filter.kind) &&
      (!filter.page || r.page === filter.page) &&
      (!filter.since || r.createdAt >= filter.since) &&
      (!filter.until || r.createdAt <= filter.until));
  } finally {
    db.close();
  }
}

export async function getArtifactFile(id) {
  const db = await idbOpen();
  let rec;
  try {
    rec = await idbTx(db, 'readonly', (st) => st.get(id));
  } finally {
    db.close();
  }
  if (!rec) throw new Error(`artifact not found: ${id}`);
  const root = await navigator.storage.getDirectory();
  const parts = rec.opfsPath.split('/');
  const dir = await opfsDir(root, parts.slice(0, -1), false);
  return { rec, file: await (await dir.getFileHandle(parts[parts.length - 1])).getFile() };
}

export async function deleteArtifact(id) {
  const db = await idbOpen();
  let rec;
  try {
    rec = await idbTx(db, 'readonly', (st) => st.get(id));
    if (rec) await idbTx(db, 'readwrite', (st) => st.delete(id));
  } finally {
    db.close();
  }
  if (!rec) return false;
  const root = await navigator.storage.getDirectory();
  const parts = rec.opfsPath.split('/');
  const dir = await opfsDir(root, parts.slice(0, -1), false);
  await dir.removeEntry(parts[parts.length - 1]);
  return true;
}

export async function storageEstimate() {
  if (!navigator.storage || !navigator.storage.estimate) return null;
  const e = await navigator.storage.estimate();
  return { quota: e.quota || 0, usage: e.usage || 0 };
}
