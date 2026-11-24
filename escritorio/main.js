// Pixel Deck — proceso principal (Electron)
const { app, BrowserWindow, ipcMain, protocol, dialog, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const { Readable } = require('stream');
const mm = require('music-metadata');
const { S3Client, ListObjectsV2Command, GetObjectCommand } = require('@aws-sdk/client-s3');

// Esquema propio: media://local/<ruta> (disco) y media://cloud/<clave> (R2), con soporte de "Range"
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'media',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true, bypassCSP: true }
  }
]);

const MIME = {
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.aif': 'audio/aiff',
  '.aiff': 'audio/aiff'
};
const AUDIO_EXT = new Set(Object.keys(MIME));
const collator = new Intl.Collator('es', { numeric: true, sensitivity: 'base' });
const isCloudPath = (p) => typeof p === 'string' && p.startsWith('r2://');

// ---------------- Disco local ----------------
function walk(p, out) {
  let st;
  try { st = fs.statSync(p); } catch { return; }
  if (st.isDirectory()) {
    let entries = [];
    try { entries = fs.readdirSync(p); } catch { return; }
    entries
      .filter((n) => !n.startsWith('.'))
      .sort(collator.compare)
      .forEach((n) => walk(path.join(p, n), out));
  } else if (AUDIO_EXT.has(path.extname(p).toLowerCase())) {
    out.push(p);
  }
}

const playlistFile = () => path.join(app.getPath('userData'), 'playlist.json');

// ---------------- Nube (Cloudflare R2) ----------------
const cloudFile = () => path.join(app.getPath('userData'), 'cloud.json');
let cloud = null; // { client, bucket, endpoint, accessKeyId, secretAccessKey }

function cleanEndpoint(e) {
  try { return new URL(String(e).trim()).origin; } catch { return String(e || '').trim().replace(/\/+$/, ''); }
}
function makeCloud(cfg) {
  const endpoint = cleanEndpoint(cfg.endpoint);
  return {
    endpoint,
    bucket: cfg.bucket.trim(),
    accessKeyId: cfg.accessKeyId.trim(),
    secretAccessKey: cfg.secretAccessKey.trim(),
    client: new S3Client({
      region: 'auto',
      endpoint,
      forcePathStyle: true,
      credentials: { accessKeyId: cfg.accessKeyId.trim(), secretAccessKey: cfg.secretAccessKey.trim() }
    })
  };
}
function encryptSecret(s) {
  if (safeStorage.isEncryptionAvailable()) return { secretEnc: safeStorage.encryptString(s).toString('base64') };
  return { secretPlain: Buffer.from(s).toString('base64') };
}
function decryptSecret(c) {
  if (c.secretEnc) return safeStorage.decryptString(Buffer.from(c.secretEnc, 'base64'));
  if (c.secretPlain) return Buffer.from(c.secretPlain, 'base64').toString();
  return '';
}
function loadCloud() {
  try {
    const c = JSON.parse(fs.readFileSync(cloudFile(), 'utf8'));
    const secretAccessKey = decryptSecret(c);
    if (c.endpoint && c.bucket && c.accessKeyId && secretAccessKey) {
      cloud = makeCloud({ ...c, secretAccessKey });
    }
  } catch { cloud = null; }
}
function friendlyError(e) {
  const name = e && (e.name || e.Code);
  const msg = (e && e.message) || String(e);
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|network/i.test(msg)) return 'Sin conexión a internet o el endpoint está mal escrito.';
  if (name === 'InvalidAccessKeyId' || name === 'SignatureDoesNotMatch' || /Unauthorized|signature/i.test(msg)) return 'Las claves no son correctas. Revisa el Access Key ID y el Secret.';
  if (name === 'NoSuchBucket') return 'Ese bucket no existe. Revisa el nombre.';
  if (name === 'AccessDenied' || /Access Denied/i.test(msg)) return 'La clave no tiene permiso para ese bucket.';
  if (/Invalid URL|endpoint/i.test(msg)) return 'El endpoint no es válido.';
  return msg;
}

async function cloudRange(key, start, end) {
  const out = await cloud.client.send(new GetObjectCommand({ Bucket: cloud.bucket, Key: key, Range: `bytes=${start}-${end}` }));
  return Buffer.from(await out.Body.transformToByteArray());
}

ipcMain.handle('cloud-config-get', () => {
  if (!cloud) {
    try {
      const c = JSON.parse(fs.readFileSync(cloudFile(), 'utf8'));
      return { configured: false, endpoint: c.endpoint || '', bucket: c.bucket || '', accessKeyId: c.accessKeyId || '' };
    } catch {
      return { configured: false, endpoint: '', bucket: '', accessKeyId: '' };
    }
  }
  return { configured: true, endpoint: cloud.endpoint, bucket: cloud.bucket, accessKeyId: cloud.accessKeyId };
});

ipcMain.handle('cloud-config-set', async (_e, cfg) => {
  try {
    const secret = (cfg.secretAccessKey || '').trim() || (cloud && cloud.secretAccessKey) || '';
    if (!cfg.endpoint || !cfg.bucket || !cfg.accessKeyId || !secret) return { ok: false, error: 'Completa todos los campos.' };
    const test = makeCloud({ ...cfg, secretAccessKey: secret });
    await test.client.send(new ListObjectsV2Command({ Bucket: test.bucket, MaxKeys: 1 }));
    fs.writeFileSync(cloudFile(), JSON.stringify({
      endpoint: test.endpoint, bucket: test.bucket, accessKeyId: test.accessKeyId, ...encryptSecret(secret)
    }));
    cloud = test;
    return { ok: true };
  } catch (e) {
    return { ok: false, error: friendlyError(e) };
  }
});

ipcMain.handle('cloud-list', async () => {
  if (!cloud) return { ok: false, error: 'La nube no está configurada.' };
  try {
    const items = [];
    let token;
    do {
      const out = await cloud.client.send(new ListObjectsV2Command({ Bucket: cloud.bucket, ContinuationToken: token, MaxKeys: 1000 }));
      (out.Contents || []).forEach((o) => {
        const base = o.Key.split('/').pop();
        if (base.startsWith('.')) return;
        if (!AUDIO_EXT.has(path.extname(o.Key).toLowerCase())) return;
        items.push({ path: 'r2://' + o.Key, size: o.Size });
      });
      token = out.IsTruncated ? out.NextContinuationToken : undefined;
    } while (token);
    items.sort((a, b) => collator.compare(a.path, b.path));
    return { ok: true, items };
  } catch (e) {
    return { ok: false, error: friendlyError(e) };
  }
});

// ---------------- IPC general ----------------
ipcMain.handle('expand-paths', (_e, paths) => {
  const out = [];
  (paths || []).forEach((p) => walk(p, out));
  return out;
});

function pickMeta(m) {
  return {
    title: m.common.title || null,
    artist: m.common.artist || null,
    album: m.common.album || null,
    duration: m.format.duration || null,
    bitrate: m.format.bitrate || null,
    sampleRate: m.format.sampleRate || null,
    channels: m.format.numberOfChannels || null
  };
}

ipcMain.handle('read-meta', async (_e, file, size) => {
  try {
    if (!isCloudPath(file)) {
      return pickMeta(await mm.parseFile(file, { skipCovers: true }));
    }
    // Nube: se leen solo los primeros KB (donde están las etiquetas), no la canción completa
    if (!cloud) return null;
    const key = file.slice(5);
    const ext = path.extname(key).toLowerCase();
    let buf = await cloudRange(key, 0, 131071);
    if (buf.slice(0, 3).toString('latin1') === 'ID3') {
      const tagSize = ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f);
      const need = tagSize + 10 + 8192;
      if (need > buf.length && need < 4 * 1024 * 1024) buf = await cloudRange(key, 0, need);
    }
    const m = pickMeta(await mm.parseBuffer(buf, { mimeType: MIME[ext], size }, { skipCovers: true, skipPostHeaders: true, duration: false }));
    // Duración aproximada para MP3 a partir del tamaño y el bitrate
    if (ext === '.mp3' && size && m.bitrate) m.duration = (size * 8) / m.bitrate;
    else if (m.duration && size && buf.length < size && ext !== '.mp3') m.duration = null;
    return m;
  } catch {
    return null;
  }
});

ipcMain.handle('exists', (_e, paths) => (paths || []).map((p) => (isCloudPath(p) ? true : fs.existsSync(p))));

ipcMain.handle('load-playlist', () => {
  try { return JSON.parse(fs.readFileSync(playlistFile(), 'utf8')); } catch { return null; }
});

ipcMain.handle('save-playlist', (_e, data) => {
  try {
    const tmp = playlistFile() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, playlistFile());
    return true;
  } catch {
    return false;
  }
});

ipcMain.handle('open-dialog', async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const r = await dialog.showOpenDialog(win, {
    title: 'Añadir música',
    properties: ['openFile', 'openDirectory', 'multiSelections'],
    filters: [{ name: 'Audio', extensions: [...AUDIO_EXT].map((x) => x.slice(1)) }]
  });
  return r.canceled ? [] : r.filePaths;
});

// ---------------- Protocolo media:// ----------------
function registerMediaProtocol() {
  protocol.handle('media', async (request) => {
    const u = new URL(request.url);
    const range = request.headers.get('range');

    if (u.host === 'cloud') {
      if (!cloud) return new Response('Nube no configurada', { status: 503 });
      const key = decodeURIComponent(u.pathname.slice(1));
      try {
        const out = await cloud.client.send(new GetObjectCommand({ Bucket: cloud.bucket, Key: key, Range: range || undefined }));
        const headers = {
          'Content-Type': MIME[path.extname(key).toLowerCase()] || out.ContentType || 'application/octet-stream',
          'Accept-Ranges': 'bytes',
          'Access-Control-Allow-Origin': '*'
        };
        if (out.ContentLength != null) headers['Content-Length'] = String(out.ContentLength);
        if (out.ContentRange) headers['Content-Range'] = out.ContentRange;
        return new Response(Readable.toWeb(out.Body), { status: out.ContentRange ? 206 : 200, headers });
      } catch (e) {
        const status = (e && e.$metadata && e.$metadata.httpStatusCode) || 502;
        return new Response(null, { status: status === 416 ? 416 : status >= 400 ? status : 502 });
      }
    }

    const filePath = decodeURIComponent(u.pathname.slice(1));
    let st;
    try { st = await fs.promises.stat(filePath); } catch { return new Response('No encontrado', { status: 404 }); }
    const size = st.size;
    const base = {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*'
    };
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      let start = 0;
      let end = size - 1;
      if (m) {
        if (m[1] === '' && m[2] !== '') {
          start = Math.max(0, size - parseInt(m[2], 10));
        } else {
          start = m[1] ? parseInt(m[1], 10) : 0;
          end = m[2] ? Math.min(parseInt(m[2], 10), size - 1) : size - 1;
        }
      }
      if (start >= size || start > end) {
        return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
      }
      const stream = fs.createReadStream(filePath, { start, end });
      return new Response(Readable.toWeb(stream), {
        status: 206,
        headers: { ...base, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) }
      });
    }
    return new Response(Readable.toWeb(fs.createReadStream(filePath)), {
      status: 200,
      headers: { ...base, 'Content-Length': String(size) }
    });
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 480,
    height: 760,
    minWidth: 440,
    minHeight: 580,
    backgroundColor: '#15161a',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 14 },
    title: 'Pixel Deck',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: false
    }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  loadCloud();
  registerMediaProtocol();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => app.quit());
