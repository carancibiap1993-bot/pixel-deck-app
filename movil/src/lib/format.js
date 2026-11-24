export function fmtTime(sec) {
  if (sec == null || !isFinite(sec)) return '--:--';
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

export function fmtSize(bytes) {
  if (!bytes) return '0 MB';
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(1).replace('.', ',') + ' GB';
  return Math.max(1, Math.round(bytes / 1e6)) + ' MB';
}

export const baseName = (key) => key.split('/').pop().replace(/\.[^.]+$/, '');
export const parentFolder = (key) => { const p = key.split('/'); return p.length > 1 ? p[p.length - 2] : ''; };
export const topFolder = (key) => { const p = key.split('/'); return p.length > 1 ? p[0] : 'Sin carpeta'; };

export function norm(s) {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// Título principal y línea secundaria de una canción
export function labels(t) {
  if (t.title) return { main: t.title, sub: [t.artist, t.album || parentFolder(t.key)].filter(Boolean).join(' · ') };
  return { main: baseName(t.key), sub: parentFolder(t.key) };
}

export function displayName(t) {
  return t.artist && t.title ? `${t.artist} - ${t.title}` : t.title || baseName(t.key);
}

// Hash corto y estable para nombrar archivos descargados
export function hashKey(s) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}
