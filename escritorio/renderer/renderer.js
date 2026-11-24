// Pixel Deck — interfaz y reproducción (disco local + nube R2)
const $ = (id) => document.getElementById(id);
const isCloud = (p) => typeof p === 'string' && p.startsWith('r2://');
const cloudKey = (p) => p.slice(5);

// ---------- Estado ----------
const state = {
  tracks: [],          // MI LISTA: pistas del disco o de la nube
  cloud: [],           // NUBE: biblioteca completa del bucket
  view: 'list',        // vista visible: list | cloud
  playView: 'list',    // de qué vista viene lo que suena
  current: -1,
  selected: new Set(),
  anchor: -1,
  shuffle: false,
  repeat: 'off',       // off | all | one
  volume: 0.8,
  eqOn: true,
  eqOpen: false,
  preamp: 0,
  bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  showRemaining: false,
  filter: '',
  folder: '',         // carpeta elegida en la vista NUBE
  cloudReady: false
};
const history = [];
let failStreak = 0;
let playingCloud = false;
let cloudKeys = new Set();

const arr = (v = state.view) => (v === 'cloud' ? state.cloud : state.tracks);
const qArr = () => arr(state.playView);
const curTrack = () => qArr()[state.current];

const FREQS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const FREQ_LABELS = ['31', '62', '125', '250', '500', '1K', '2K', '4K', '8K', '16K'];
const PRESETS = {
  'Plano': [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  'Rock': [5, 4, 2, -1, -2, -1, 2, 4, 5, 5],
  'Pop': [-1, 1, 3, 4, 3, 0, -1, -1, 1, 2],
  'Bajos +': [7, 6, 5, 3, 1, 0, 0, 0, 0, 0],
  'Voces': [-2, -2, -1, 1, 4, 5, 4, 2, 0, -1],
  'Electrónica': [6, 5, 2, 0, -2, 1, 1, 3, 5, 6],
  'Clásica': [0, 0, 0, 0, 0, 0, -2, -3, -3, -4],
  'Acústica': [3, 3, 2, 1, 2, 2, 3, 3, 2, 1]
};

// ---------- Audio ----------
const audio = new Audio();
audio.crossOrigin = 'anonymous';
audio.preload = 'auto';
let ctx = null, preampNode = null, filters = [], analyser = null;

function ensureAudioGraph() {
  if (ctx) return;
  ctx = new AudioContext();
  const src = ctx.createMediaElementSource(audio);
  preampNode = ctx.createGain();
  filters = FREQS.map((f, i) => {
    const b = ctx.createBiquadFilter();
    b.type = i === 0 ? 'lowshelf' : i === FREQS.length - 1 ? 'highshelf' : 'peaking';
    b.frequency.value = f;
    b.Q.value = 1.1;
    return b;
  });
  analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.7;
  let node = src;
  node.connect(preampNode);
  node = preampNode;
  filters.forEach((f) => { node.connect(f); node = f; });
  node.connect(analyser);
  analyser.connect(ctx.destination);
  applyEq();
}

function applyEq() {
  if (!ctx) return;
  const on = state.eqOn;
  preampNode.gain.value = Math.pow(10, (on ? state.preamp : 0) / 20);
  filters.forEach((f, i) => { f.gain.value = on ? state.bands[i] : 0; });
}

const mediaUrl = (p) => (isCloud(p)
  ? 'media://cloud/' + encodeURIComponent(cloudKey(p))
  : 'media://local/' + encodeURIComponent(p));

// ---------- Utilidades ----------
function fmt(sec) {
  if (sec == null || !isFinite(sec)) return '--:--';
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
function baseName(p) {
  const n = p.split('/').pop();
  return n.replace(/\.[^.]+$/, '');
}
function folderOf(p) {
  const parts = (isCloud(p) ? cloudKey(p) : p).split('/');
  return parts.length > 1 ? parts[parts.length - 2] : '';
}
function norm(s) {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
function dedupeKey(t) {
  if (t.title) return norm((t.artist || '') + ' ' + t.title);
  return norm(baseName(t.path).replace(/^\s*\d{1,3}\s*[-._)]\s*/, ''));
}
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function highlight(text, words) {
  if (!words.length) return escapeHtml(text);
  const folded = text.normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (folded.length !== text.length) return escapeHtml(text);
  const low = folded.toLowerCase();
  const marks = new Array(text.length).fill(false);
  words.forEach((w) => {
    let i = low.indexOf(w);
    while (w && i >= 0) {
      for (let k = i; k < i + w.length; k++) marks[k] = true;
      i = low.indexOf(w, i + w.length);
    }
  });
  let out = '', open = false;
  for (let i = 0; i < text.length; i++) {
    if (marks[i] && !open) { out += '<mark>'; open = true; }
    if (!marks[i] && open) { out += '</mark>'; open = false; }
    out += escapeHtml(text[i]);
  }
  return out + (open ? '</mark>' : '');
}
const searchWords = () => norm(state.filter).split(' ').filter(Boolean);
function label(t) {
  if (t.artist && t.title) return `${t.artist} - ${t.title}`;
  if (t.title) return t.title;
  return baseName(t.path);
}
let toastTimer;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}
const strip = ({ missing, cloudAlt, _busy, _queued, ...t }) => t;

// ---------- Guardado ----------
let saveTimer;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    window.deck.save({
      version: 2,
      tracks: state.tracks.map(strip),
      cloud: state.cloud.map(strip),
      settings: {
        current: state.current, playView: state.playView, view: state.view,
        shuffle: state.shuffle, repeat: state.repeat, volume: state.volume,
        eqOn: state.eqOn, eqOpen: state.eqOpen, preamp: state.preamp, bands: state.bands, showRemaining: state.showRemaining, folder: state.folder
      }
    });
  }, 800);
}

// ---------- Respaldo en la nube para pistas del disco ----------
function rebuildCloudKeys() { cloudKeys = new Set(state.cloud.map((t) => cloudKey(t.path))); }
// Busca en la nube la misma canción: /Volumes/MiDisco/Musica/ROCK/x.mp3 -> ROCK/x.mp3
function cloudFallback(localPath) {
  if (!cloudKeys.size) return null;
  const segs = localPath.split('/').filter(Boolean);
  for (let i = 0; i < segs.length; i++) {
    const cand = segs.slice(i).join('/');
    if (cloudKeys.has(cand)) return 'r2://' + cand;
  }
  return null;
}

// ---------- Lista ----------
const MAX_ROWS = 1500;

const topFolder = (t) => { const parts = cloudKey(t.path).split('/'); return parts.length > 1 ? parts[0] : 'Sin carpeta'; };

function visibleIndexes() {
  const words = searchWords();
  const items = arr();
  let all = items.map((_, i) => i);
  if (state.view === 'cloud' && state.folder) all = all.filter((i) => topFolder(items[i]) === state.folder);
  if (!words.length) return all;
  return all.filter((i) => {
    const t = items[i];
    const where = isCloud(t.path) ? cloudKey(t.path) : baseName(t.path) + ' ' + folderOf(t.path);
    const hay = norm(label(t) + ' ' + (t.album || '') + ' ' + where);
    return words.every((w) => hay.includes(w));
  });
}

function rowClass(i) {
  const t = arr()[i];
  let c = 'row';
  if (state.selected.has(i)) c += ' sel';
  if (state.view === state.playView && i === state.current) c += ' playing';
  if (t.missing && t.cloudAlt && state.cloudReady) c += ' viacloud';
  else if (t.missing) c += ' missing';
  return c;
}

function rowHtml(i, t, words) {
  const badge = state.view === 'list' && isCloud(t.path) ? '<span class="src">☁</span>' : '';
  const folder = state.view === 'cloud' ? `<span class="f">${escapeHtml(folderOf(t.path))}</span>` : '';
  return `<span class="n">${i + 1}.</span><span class="t">${highlight(label(t), words)}${badge}${folder}</span><span class="d">${fmt(t.duration)}</span>`;
}

// ---------- Carpetas (vista NUBE) ----------
function renderChips() {
  const box = $('chips');
  const show = state.view === 'cloud' && state.cloudReady && state.cloud.length > 0;
  box.classList.toggle('hidden', !show);
  if (!show) return;
  const counts = new Map();
  state.cloud.forEach((t) => { const f = topFolder(t); counts.set(f, (counts.get(f) || 0) + 1); });
  if (state.folder && !counts.has(state.folder)) state.folder = '';
  const coll = new Intl.Collator('es', { numeric: true, sensitivity: 'base' });
  const folders = [...counts.entries()].sort((a, b) => coll.compare(a[0], b[0]));
  box.innerHTML = '';
  const make = (name, label) => {
    const b = document.createElement('button');
    b.className = 'chip' + (state.folder === name ? ' on' : '');
    b.textContent = label;
    b.title = name || 'Todas las carpetas';
    b.onclick = () => {
      state.folder = state.folder === name ? '' : name;
      state.selected.clear();
      state.anchor = -1;
      renderChips();
      renderList();
      $('list').scrollTop = 0;
      const on = box.querySelector('.chip.on');
      if (on) on.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    };
    box.appendChild(b);
  };
  make('', `TODAS · ${state.cloud.length}`);
  folders.forEach(([f, n]) => make(f, `${f} · ${n}`));
}
// rueda del mouse: desplaza la fila de carpetas hacia los lados
$('chips').addEventListener('wheel', (e) => {
  if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { e.preventDefault(); $('chips').scrollLeft += e.deltaY; }
}, { passive: false });

function renderList() {
  renderChips();
  const list = $('list');
  list.innerHTML = '';
  const items = arr();
  if (state.view === 'cloud' && !state.cloudReady) {
    list.innerHTML = '<div class="empty">Tu música en la nube aparecerá aquí.<br><button id="emptyCfg" class="pill on">⚙ CONECTAR LA NUBE</button></div>';
    $('emptyCfg').onclick = openModal;
  } else if (!items.length) {
    list.innerHTML = state.view === 'cloud'
      ? '<div class="empty">No hay canciones en la nube todavía.<br><button id="emptyRefresh" class="pill on">↻ ACTUALIZAR</button></div>'
      : '<div class="empty">Arrastra canciones o carpetas<br>desde tu disco duro hasta aquí<br><br>o usa “+ AÑADIR”,<br>o añade canciones desde ☁ NUBE</div>';
    if ($('emptyRefresh')) $('emptyRefresh').onclick = refreshCloud;
  } else {
    const frag = document.createDocumentFragment();
    const words = searchWords();
    const vis = visibleIndexes();
    vis.slice(0, MAX_ROWS).forEach((i) => {
      const t = items[i];
      const row = document.createElement('div');
      row.className = rowClass(i);
      row.dataset.i = i;
      row.draggable = state.view === 'list';
      row.innerHTML = rowHtml(i, t, words);
      row.title = isCloud(t.path) ? 'Nube: ' + cloudKey(t.path) : t.path;
      frag.appendChild(row);
    });
    if (vis.length > MAX_ROWS) {
      const more = document.createElement('div');
      more.className = 'more';
      more.textContent = `… y ${vis.length - MAX_ROWS} más. Usa el buscador para encontrarlas.`;
      frag.appendChild(more);
    }
    if (!vis.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'Sin resultados para “' + state.filter.trim() + '”';
      frag.appendChild(empty);
    }
    list.appendChild(frag);
  }
  updateFooter();
  scheduleVisibleMeta();
}

function updateRow(view, i) {
  if (view !== state.view) return;
  const row = $('list').querySelector(`.row[data-i="${i}"]`);
  if (!row) return;
  const t = arr()[i];
  row.className = rowClass(i);
  row.innerHTML = rowHtml(i, t, searchWords());
}

function refreshRowClasses() {
  $('list').querySelectorAll('.row').forEach((r) => { r.className = rowClass(+r.dataset.i); });
  updateToListButton();
}

function updateToListButton() {
  const b = $('btnToList');
  if (!b) return;
  const filtered = state.view === 'cloud' && (state.folder || searchWords().length);
  b.textContent = !state.selected.size && filtered ? '+ ESTAS A MI LISTA' : '+ A MI LISTA';
}

function updateFooter() {
  updateToListButton();
  const items = arr();
  const n = items.length;
  const unit = state.view === 'cloud' ? (n === 1 ? 'canción' : 'canciones') : (n === 1 ? 'pista' : 'pistas');
  const filtered = searchWords().length || (state.view === 'cloud' && state.folder);
  $('plCount').textContent = filtered ? `${visibleIndexes().length} de ${n}` : `${n} ${unit}`;
  if (state.view === 'list') {
    $('plTotal').textContent = fmt(state.tracks.reduce((s, t) => s + (t.duration || 0), 0));
  } else {
    const bytes = state.cloud.reduce((s, t) => s + (t.size || 0), 0);
    $('cloudTotal').textContent = (bytes / 1e9).toFixed(1) + ' GB';
  }
}

function setView(v) {
  if (state.view === v) return;
  state.view = v;
  state.selected.clear();
  state.anchor = -1;
  state.filter = '';
  $('search').value = '';
  $('tabList').classList.toggle('on', v === 'list');
  $('tabCloud').classList.toggle('on', v === 'cloud');
  $('footList').classList.toggle('hidden', v !== 'list');
  $('footCloud').classList.toggle('hidden', v !== 'cloud');
  renderList();
  if (state.view === state.playView) scrollToCurrent();
  else $('list').scrollTop = 0;
  save();
}
$('tabList').onclick = () => setView('list');
$('tabCloud').onclick = () => setView('cloud');

// ---------- Añadir pistas del disco ----------
async function addPaths(paths, insertAt = null) {
  if (!paths.length) return;
  if (state.view !== 'list') setView('list');
  const found = await window.deck.expand(paths);
  if (!found.length) { toast('No se encontraron archivos de audio'); return; }
  const known = new Set(state.tracks.map((t) => t.path));
  const files = found.filter((p) => (known.has(p) ? false : (known.add(p), true)));
  const skipped = found.length - files.length;
  if (!files.length) { toast('Esas canciones ya estaban en la lista'); return; }
  const newTracks = files.map((p) => ({ path: p, title: null, artist: null, album: null, duration: null, metaDone: false }));
  const pos = insertAt == null ? state.tracks.length : insertAt;
  if (state.playView === 'list' && state.current >= pos) state.current += newTracks.length;
  state.tracks.splice(pos, 0, ...newTracks);
  state.selected.clear();
  renderList();
  save();
  toast(`${files.length} ${files.length === 1 ? 'canción añadida' : 'canciones añadidas'}` + (skipped ? ` · ${skipped} ya estaban` : ''));
  newTracks.forEach((t) => enqueueMeta(t));
}

// Pasar canciones de la NUBE a MI LISTA
function addSelectedToList() {
  let idx = [...state.selected].sort((a, b) => a - b);
  // sin selección pero con carpeta o búsqueda activa: agrega todo lo que se ve
  if (!idx.length && (state.folder || searchWords().length)) idx = visibleIndexes();
  if (!idx.length) { toast('Selecciona canciones de la nube primero'); return; }
  const known = new Set(state.tracks.map((t) => t.path));
  let added = 0;
  idx.forEach((i) => {
    const t = state.cloud[i];
    if (known.has(t.path)) return;
    known.add(t.path);
    state.tracks.push({ ...strip(t) });
    added++;
  });
  save();
  toast(added ? `${added} ${added === 1 ? 'canción añadida' : 'canciones añadidas'} a MI LISTA` : 'Ya estaban en MI LISTA');
  if (added) removeDuplicates(true);
}

// ---------- Etiquetas (artista, título, duración) en segundo plano ----------
const metaQueue = [];
let metaWorkers = 0;
function enqueueMeta(t, front = false) {
  if (!t || t.metaDone || t._queued) return;
  if (isCloud(t.path) && !state.cloudReady) return;
  t._queued = true;
  front ? metaQueue.unshift(t) : metaQueue.push(t);
  pumpMeta();
}
function pumpMeta() {
  while (metaWorkers < 4 && metaQueue.length) {
    const t = metaQueue.shift();
    metaWorkers++;
    (async () => {
      const m = await window.deck.meta(t.path, t.size || null);
      t.metaDone = true;
      t._queued = false;
      if (m) {
        // no pisar una duración real (medida al reproducir) con una estimada
        if (t.duration && m.duration && t._realDuration) delete m.duration;
        Object.assign(t, m);
      }
      // la misma canción puede estar en las dos listas
      [['list', state.tracks], ['cloud', state.cloud]].forEach(([v, a]) => {
        a.forEach((x, i) => {
          if (x.path === t.path) {
            if (x !== t) { x.metaDone = true; if (m) Object.assign(x, m); }
            updateRow(v, i);
          }
        });
      });
      const c = curTrack();
      if (c && c.path === t.path) updateDisplayInfo();
      updateFooter();
      save();
      metaWorkers--;
      if (!metaQueue.length && !metaWorkers) removeDuplicates();
      pumpMeta();
    })();
  }
}
// En la nube solo se leen las etiquetas de lo que está a la vista
let visTimer;
function scheduleVisibleMeta() {
  clearTimeout(visTimer);
  visTimer = setTimeout(() => {
    const list = $('list');
    const top = list.scrollTop, bottom = top + list.clientHeight + 200;
    list.querySelectorAll('.row').forEach((r) => {
      if (r.offsetTop + r.offsetHeight >= top && r.offsetTop <= bottom) {
        const t = arr()[+r.dataset.i];
        if (t && isCloud(t.path)) enqueueMeta(t, true);
      }
    });
  }, 250);
}
$('list').addEventListener('scroll', scheduleVisibleMeta);

// Quita canciones repetidas en MI LISTA
function removeDuplicates(silent = false) {
  const playingList = state.playView === 'list';
  const cur = playingList ? state.tracks[state.current] : null;
  const seen = new Set();
  if (cur && cur.metaDone) seen.add(dedupeKey(cur));
  let removed = 0;
  const keep = state.tracks.filter((t) => {
    if (!t.metaDone) return true;
    const k = dedupeKey(t);
    if (!k || t === cur) return true;
    if (seen.has(k)) { removed++; return false; }
    seen.add(k);
    return true;
  });
  if (!removed) return 0;
  state.tracks = keep;
  if (playingList) state.current = cur ? state.tracks.indexOf(cur) : -1;
  if (state.view === 'list') { state.selected.clear(); renderList(); }
  updateDisplayInfo(); save();
  if (!silent || removed) toast(`${removed} ${removed === 1 ? 'canción repetida quitada' : 'canciones repetidas quitadas'}`);
  return removed;
}

// ---------- Disco conectado / desconectado ----------
async function checkMissing() {
  const local = state.tracks.filter((t) => !isCloud(t.path));
  if (!local.length) return;
  const ex = await window.deck.exists(local.map((t) => t.path));
  let changed = false;
  ex.forEach((ok, k) => {
    const t = local[k];
    const alt = ok ? null : cloudFallback(t.path);
    if (t.missing === ok || (t.cloudAlt || null) !== alt) changed = true;
    t.missing = !ok;
    t.cloudAlt = alt;
  });
  if (changed) {
    if (state.view === 'list') refreshRowClasses();
    local.forEach((t) => { if (!t.missing) enqueueMeta(t); });
  }
}

// ---------- Nube ----------
async function refreshCloud(quiet = false) {
  if (!state.cloudReady) { openModal(); return; }
  if (!quiet) toast('Leyendo tu biblioteca en la nube…');
  const r = await window.deck.cloudList();
  if (!r.ok) { if (!quiet) toast('Nube: ' + r.error); return; }
  const prev = new Map(state.cloud.map((t) => [t.path, t]));
  const playing = state.playView === 'cloud' ? curTrack() : null;
  state.cloud = r.items.map((it) => {
    const old = prev.get(it.path);
    return old ? { ...old, size: it.size } : { path: it.path, size: it.size, title: null, artist: null, album: null, duration: null, metaDone: false };
  });
  if (state.playView === 'cloud') state.current = playing ? state.cloud.findIndex((t) => t.path === playing.path) : -1;
  rebuildCloudKeys();
  if (state.view === 'cloud') { state.selected.clear(); renderList(); } else updateFooter();
  await checkMissing();
  save();
  if (!quiet) toast(`${state.cloud.length} canciones en la nube`);
}

async function openModal() {
  const c = await window.deck.cloudGet();
  $('cfEndpoint').value = c.endpoint || '';
  $('cfBucket').value = c.bucket || '';
  $('cfKey').value = c.accessKeyId || '';
  $('cfSecret').value = '';
  $('cfSecret').placeholder = c.configured ? '•••••••• (guardada, déjalo vacío para mantenerla)' : '';
  $('cfStatus').textContent = '';
  $('cfStatus').className = 'status';
  $('modal').classList.remove('hidden');
  ($('cfEndpoint').value ? $('cfKey') : $('cfEndpoint')).focus();
}
function closeModal() { $('modal').classList.add('hidden'); }
$('cfCancel').onclick = closeModal;
$('cfSave').onclick = async () => {
  const st = $('cfStatus');
  st.className = 'status';
  st.textContent = 'Probando conexión…';
  $('cfSave').disabled = true;
  const r = await window.deck.cloudSet({
    endpoint: $('cfEndpoint').value,
    bucket: $('cfBucket').value,
    accessKeyId: $('cfKey').value,
    secretAccessKey: $('cfSecret').value
  });
  $('cfSave').disabled = false;
  if (!r.ok) { st.className = 'status err'; st.textContent = r.error; return; }
  st.className = 'status ok';
  st.textContent = '¡Conectado! Cargando tu música…';
  state.cloudReady = true;
  setTimeout(closeModal, 700);
  if (state.view !== 'cloud') setView('cloud');
  await refreshCloud();
};
$('btnCloudCfg').onclick = openModal;
$('btnRefresh').onclick = () => refreshCloud();
$('btnToList').onclick = addSelectedToList;

// ---------- Reproducción ----------
async function playAt(view, i, fromHistory = false) {
  const list = arr(view);
  if (i < 0 || i >= list.length) return;
  ensureAudioGraph();
  if (ctx.state === 'suspended') await ctx.resume();
  if (!fromHistory && state.current >= 0 && !(state.playView === view && state.current === i)) history.push([state.playView, state.current]);
  state.playView = view;
  state.current = i;
  const t = list[i];
  refreshRowClasses();
  scrollToCurrent();
  updateDisplayInfo();
  save();

  let url = null;
  if (isCloud(t.path)) {
    if (!state.cloudReady) { onFail('NUBE NO CONECTADA · ⚙ NUBE'); return; }
    url = mediaUrl(t.path);
    playingCloud = true;
  } else {
    const [ok] = await window.deck.exists([t.path]);
    t.missing = !ok;
    t.cloudAlt = ok ? null : cloudFallback(t.path);
    if (ok) { url = mediaUrl(t.path); playingCloud = false; }
    else if (t.cloudAlt && state.cloudReady) { url = mediaUrl(t.cloudAlt); playingCloud = true; }
    refreshRowClasses();
    if (!url) { onFail('ARCHIVO NO ENCONTRADO · ¿DISCO DESCONECTADO?'); return; }
  }
  $('srcLamp').classList.toggle('on', playingCloud);
  audio.src = url;
  audio.play().catch(() => {});
  if (isCloud(t.path)) enqueueMeta(t, true);
  else if (t.cloudAlt && playingCloud) {
    const c = state.cloud.find((x) => x.path === t.cloudAlt);
    if (c && c.metaDone && !t.metaDone) {
      const { title, artist, album, duration, bitrate, sampleRate, channels } = c;
      Object.assign(t, { title, artist, album, duration, bitrate, sampleRate, channels, metaDone: true });
      updateDisplayInfo();
    } else if (c && !c.metaDone) enqueueMeta(c, true);
  }
}

function onFail(msg) {
  failStreak++;
  setMarquee(msg);
  $('stateIcon').textContent = '!';
  if (failStreak >= Math.min(qArr().length, 15)) {
    toast(playingCloud ? 'No se puede conectar con la nube. ¿Hay internet?' : 'No se encuentran los archivos. ¿Conectaste el disco?');
    failStreak = 0;
    stop();
    return;
  }
  setTimeout(() => next(true), 1000);
}

function play() {
  if (state.current < 0 || !qArr()[state.current]) {
    const items = arr();
    if (items.length) playAt(state.view, firstIndex());
    return;
  }
  if (!audio.src) { playAt(state.playView, state.current); return; }
  ensureAudioGraph();
  if (ctx.state === 'suspended') ctx.resume();
  if (audio.paused) audio.play().catch(() => {});
  else audio.currentTime = 0;
}
function pause() { if (audio.src) { audio.paused ? audio.play().catch(() => {}) : audio.pause(); } }
function stop() { audio.pause(); try { audio.currentTime = 0; } catch {} updateState(); updateTime(); }

function firstIndex() {
  const sel = [...state.selected].sort((a, b) => a - b)[0];
  if (sel != null) return sel;
  const vis = visibleIndexes();
  if (state.shuffle) return vis[Math.floor(Math.random() * vis.length)] ?? 0;
  return vis[0] ?? 0;
}

function next(auto = false) {
  const items = qArr();
  const n = items.length;
  if (!n) return;
  if (auto && state.repeat === 'one' && failStreak === 0) { playAt(state.playView, state.current, true); return; }
  if (state.shuffle) {
    let j = Math.floor(Math.random() * n);
    if (n > 1) while (j === state.current) j = Math.floor(Math.random() * n);
    playAt(state.playView, j);
    return;
  }
  let j = state.current + 1;
  if (j >= n) {
    if (state.repeat === 'off' && auto) { stop(); return; }
    j = 0;
  }
  playAt(state.playView, j);
}

function prev() {
  if (audio.currentTime > 3) { audio.currentTime = 0; return; }
  if (state.shuffle && history.length) { const [v, i] = history.pop(); playAt(v, i, true); return; }
  const n = qArr().length;
  if (!n) return;
  playAt(state.playView, state.current <= 0 ? n - 1 : state.current - 1);
}

audio.addEventListener('ended', () => next(true));
audio.addEventListener('playing', () => { failStreak = 0; });
audio.addEventListener('error', () => {
  if (!audio.src || state.current < 0) return;
  onFail(playingCloud ? 'ERROR AL CARGAR DESDE LA NUBE' : 'NO SE PUDO REPRODUCIR');
});
audio.addEventListener('play', updateState);
audio.addEventListener('pause', updateState);
audio.addEventListener('timeupdate', updateTime);
audio.addEventListener('loadedmetadata', () => {
  const t = curTrack();
  if (t && isFinite(audio.duration) && (!t.duration || Math.abs(t.duration - audio.duration) > 2)) {
    t.duration = audio.duration;
    t._realDuration = true;
    updateRow(state.playView, state.current);
    updateFooter();
    save();
  }
});

function scrollToCurrent() {
  if (state.view !== state.playView) return;
  const row = $('list').querySelector(`.row[data-i="${state.current}"]`);
  if (row) row.scrollIntoView({ block: 'nearest' });
}

// ---------- Pantalla ----------
let marqueeText = '', marqueePos = 0;
function setMarquee(text) {
  marqueeText = text;
  marqueePos = 0;
  $('marquee').textContent = text;
}
function updateDisplayInfo() {
  const t = curTrack();
  if (!t) { setMarquee('PIXEL DECK · ARRASTRA TU MÚSICA AQUÍ'); $('srcLamp').classList.remove('on'); return; }
  setMarquee(`${state.current + 1}. ${label(t).toUpperCase()} (${fmt(t.duration)})`);
  $('kbps').textContent = t.bitrate ? Math.round(t.bitrate / 1000) : '---';
  $('khz').textContent = t.sampleRate ? Math.round(t.sampleRate / 1000) : '--';
  $('chan').classList.toggle('on', (t.channels || 2) >= 2);
}
setInterval(() => {
  const el = $('marquee');
  const width = el.parentElement.clientWidth;
  const fits = Math.floor(width / 7.8);
  if (marqueeText.length <= fits) { el.textContent = marqueeText; return; }
  const loop = marqueeText + '   ***   ';
  marqueePos = (marqueePos + 1) % loop.length;
  el.textContent = (loop + loop).slice(marqueePos, marqueePos + fits + 2);
}, 220);

function updateState() {
  const icon = $('stateIcon');
  if (!audio.src || (audio.paused && audio.currentTime === 0)) icon.textContent = '■';
  else icon.textContent = audio.paused ? '❚❚' : '▶';
}
function updateTime() {
  const d = audio.duration, c = audio.currentTime || 0;
  const clock = $('clock');
  if (state.showRemaining && isFinite(d)) clock.textContent = '-' + fmt(d - c);
  else clock.textContent = fmt(c).padStart(5, '0');
  if (!seeking) {
    const p = isFinite(d) && d > 0 ? (c / d) * 1000 : 0;
    $('seek').value = p;
    $('seek').style.setProperty('--p', p / 10 + '%');
  }
}

// Espectro
const canvas = $('spectrum');
const g = canvas.getContext('2d');
const BARS = 28;
const peaks = new Array(BARS).fill(0);
function drawSpectrum() {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== w * dpr) { canvas.width = w * dpr; canvas.height = h * dpr; }
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  let data = null;
  if (analyser && !audio.paused) {
    data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(data);
  }
  const gap = 3, bw = (w - gap * (BARS - 1)) / BARS, seg = 4;
  for (let i = 0; i < BARS; i++) {
    let v = 0;
    if (data) {
      const a = Math.floor(Math.pow(i / BARS, 1.7) * (data.length * 0.85));
      const b = Math.max(a + 1, Math.floor(Math.pow((i + 1) / BARS, 1.7) * (data.length * 0.85)));
      let s = 0;
      for (let k = a; k < b; k++) s += data[k];
      v = s / (b - a) / 255;
    }
    const bh = Math.round((v * h) / seg) * seg;
    peaks[i] = Math.max(peaks[i] - 0.6, bh);
    const x = i * (bw + gap);
    for (let y = h - seg; y >= h - bh; y -= seg) {
      const lvl = 1 - y / h;
      g.fillStyle = lvl > 0.8 ? '#ff6a3a' : lvl > 0.55 ? '#ffc04a' : '#ffa62b';
      g.globalAlpha = 0.95;
      g.fillRect(x, y + 1, bw, seg - 1.5);
    }
    g.globalAlpha = 0.12;
    g.fillStyle = '#ffa62b';
    g.fillRect(x, h - 2, bw, 2);
    g.globalAlpha = 0.9;
    if (peaks[i] > 2) g.fillRect(x, h - peaks[i] - 2, bw, 1.5);
  }
  g.globalAlpha = 1;
  requestAnimationFrame(drawSpectrum);
}
requestAnimationFrame(drawSpectrum);

// ---------- Controles ----------
$('btnPlay').onclick = play;
$('btnPause').onclick = pause;
$('btnStop').onclick = stop;
$('btnNext').onclick = () => next(false);
$('btnPrev').onclick = prev;
$('clock').onclick = () => { state.showRemaining = !state.showRemaining; updateTime(); save(); };

let seeking = false;
const seek = $('seek');
seek.addEventListener('input', () => {
  seeking = true;
  seek.style.setProperty('--p', seek.value / 10 + '%');
});
seek.addEventListener('change', () => {
  if (isFinite(audio.duration)) audio.currentTime = (seek.value / 1000) * audio.duration;
  seeking = false;
});

$('volume').addEventListener('input', (e) => {
  state.volume = e.target.value / 100;
  audio.volume = state.volume;
  save();
});

function renderToggles() {
  $('btnShuffle').classList.toggle('on', state.shuffle);
  const r = { off: 'REP: NO', all: 'REP: TODO', one: 'REP: UNA' }[state.repeat];
  $('btnRepeat').textContent = r;
  $('btnRepeat').classList.toggle('on', state.repeat !== 'off');
  $('btnEq').classList.toggle('on', state.eqOpen);
  $('eqPanel').classList.toggle('hidden', !state.eqOpen);
  $('eqOn').classList.toggle('on', state.eqOn);
  $('eqOn').textContent = state.eqOn ? 'EQ ON' : 'EQ OFF';
}
$('btnShuffle').onclick = () => { state.shuffle = !state.shuffle; renderToggles(); save(); };
$('btnRepeat').onclick = () => {
  state.repeat = { off: 'all', all: 'one', one: 'off' }[state.repeat];
  renderToggles(); save();
};
$('btnEq').onclick = () => { state.eqOpen = !state.eqOpen; renderToggles(); save(); };
$('eqOn').onclick = () => { state.eqOn = !state.eqOn; applyEq(); renderToggles(); save(); };

function buildEq() {
  const wrap = $('eqBands');
  wrap.innerHTML = '';
  const make = (lbl, value, onInput, extra = '') => {
    const d = document.createElement('div');
    d.className = 'band ' + extra;
    const inp = document.createElement('input');
    inp.type = 'range'; inp.min = -12; inp.max = 12; inp.step = 0.5; inp.value = value;
    inp.addEventListener('input', () => onInput(parseFloat(inp.value)));
    inp.addEventListener('dblclick', () => { inp.value = 0; onInput(0); });
    const l = document.createElement('label');
    l.textContent = lbl;
    d.append(inp, l);
    wrap.appendChild(d);
  };
  make('PRE', state.preamp, (v) => { state.preamp = v; applyEq(); save(); }, 'preamp');
  FREQS.forEach((_, i) => make(FREQ_LABELS[i], state.bands[i], (v) => { state.bands[i] = v; applyEq(); save(); }));
}
const presetSel = $('eqPreset');
Object.keys(PRESETS).forEach((k) => {
  const o = document.createElement('option');
  o.value = k; o.textContent = k;
  presetSel.appendChild(o);
});
presetSel.onchange = () => {
  const p = PRESETS[presetSel.value];
  if (p) { state.bands = [...p]; buildEq(); applyEq(); save(); }
  presetSel.value = '';
};
$('eqReset').onclick = () => { state.bands = new Array(10).fill(0); state.preamp = 0; buildEq(); applyEq(); save(); };

// Botones de MI LISTA
$('btnAdd').onclick = async () => addPaths(await window.deck.openDialog());
$('btnRemove').onclick = removeSelected;
let clearArmed = false, clearTimer;
$('btnClear').onclick = () => {
  if (!state.tracks.length) return;
  if (!clearArmed) {
    clearArmed = true;
    $('btnClear').textContent = '¿SEGURO?';
    clearTimeout(clearTimer);
    clearTimer = setTimeout(() => { clearArmed = false; $('btnClear').textContent = 'LIMPIAR'; }, 2500);
    return;
  }
  clearArmed = false;
  $('btnClear').textContent = 'LIMPIAR';
  if (state.playView === 'list') { stop(); audio.removeAttribute('src'); state.current = -1; }
  state.tracks = []; state.selected.clear();
  renderList(); updateDisplayInfo(); save();
};
$('btnSort').onclick = () => {
  const cur = state.playView === 'list' ? state.tracks[state.current] : null;
  const coll = new Intl.Collator('es', { numeric: true, sensitivity: 'base' });
  state.tracks.sort((a, b) => coll.compare(label(a), label(b)));
  if (state.playView === 'list') state.current = cur ? state.tracks.indexOf(cur) : -1;
  state.selected.clear();
  renderList(); updateDisplayInfo(); save();
  toast('Lista ordenada por artista / título');
};

function removeSelected() {
  if (state.view !== 'list' || !state.selected.size) return;
  const playingList = state.playView === 'list';
  const cur = playingList ? state.tracks[state.current] : null;
  const rm = state.selected;
  state.tracks = state.tracks.filter((_, i) => !rm.has(i));
  if (playingList) {
    if (cur && !state.tracks.includes(cur)) { stop(); audio.removeAttribute('src'); state.current = -1; }
    else state.current = cur ? state.tracks.indexOf(cur) : -1;
  }
  state.selected = new Set();
  renderList(); updateDisplayInfo(); save();
}

// Búsqueda en vivo
let searchTimer;
const searchBox = $('search');
searchBox.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { state.filter = searchBox.value; renderList(); $('list').scrollTop = 0; }, 120);
});
searchBox.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    searchBox.value = ''; state.filter = ''; renderList(); searchBox.blur(); scrollToCurrent();
  } else if (e.key === 'Enter') {
    clearTimeout(searchTimer);
    state.filter = searchBox.value; renderList();
    const first = visibleIndexes()[0];
    if (first != null) playAt(state.view, first);
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    const first = visibleIndexes()[0];
    if (first == null) return;
    state.selected = new Set([first]); state.anchor = first;
    refreshRowClasses();
    searchBox.blur(); $('list').focus();
  }
});

// Selección y doble clic
const list = $('list');
list.addEventListener('mousedown', (e) => {
  const row = e.target.closest('.row');
  if (!row) return;
  const i = +row.dataset.i;
  if (e.shiftKey && state.anchor >= 0) {
    const vis = visibleIndexes();
    const a = vis.indexOf(state.anchor), b = vis.indexOf(i);
    const [s, t] = a < b ? [a, b] : [b, a];
    if (!e.metaKey) state.selected.clear();
    vis.slice(s, t + 1).forEach((k) => state.selected.add(k));
  } else if (e.metaKey) {
    state.selected.has(i) ? state.selected.delete(i) : state.selected.add(i);
    state.anchor = i;
  } else if (!state.selected.has(i)) {
    state.selected = new Set([i]);
    state.anchor = i;
  }
  refreshRowClasses();
});
list.addEventListener('click', (e) => {
  const row = e.target.closest('.row');
  if (!row || e.shiftKey || e.metaKey) return;
  const i = +row.dataset.i;
  if (state.selected.size > 1 && !dragging) { state.selected = new Set([i]); state.anchor = i; refreshRowClasses(); }
});
list.addEventListener('dblclick', (e) => {
  const row = e.target.closest('.row');
  if (row) playAt(state.view, +row.dataset.i);
});

// Atajos de teclado
document.addEventListener('keydown', (e) => {
  if (!$('modal').classList.contains('hidden')) {
    if (e.key === 'Escape') closeModal();
    if (e.key === 'Enter') $('cfSave').click();
    return;
  }
  if (e.metaKey && e.key === 'f') { e.preventDefault(); searchBox.focus(); searchBox.select(); return; }
  if (e.target.tagName === 'INPUT' && e.target.type !== 'range') return;
  if (e.target.tagName === 'SELECT') return;
  if (!e.metaKey && !e.ctrlKey && !e.altKey && e.key.length === 1 && e.key !== ' ' && document.activeElement === list) {
    searchBox.focus();
    return;
  }
  if (e.code === 'Space') { e.preventDefault(); audio.src && !audio.paused ? audio.pause() : play(); }
  else if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); removeSelected(); }
  else if (e.key === 'Enter') { const s = [...state.selected][0]; if (s != null) playAt(state.view, s); }
  else if (e.metaKey && e.key === 'a') { e.preventDefault(); state.selected = new Set(visibleIndexes()); refreshRowClasses(); }
  else if (e.key === 'ArrowRight' && e.metaKey) next(false);
  else if (e.key === 'ArrowLeft' && e.metaKey) prev();
  else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const vis = visibleIndexes();
    if (!vis.length) return;
    const cur = state.anchor >= 0 ? vis.indexOf(state.anchor) : -1;
    const n = Math.max(0, Math.min(vis.length - 1, cur + (e.key === 'ArrowDown' ? 1 : -1)));
    state.anchor = vis[n];
    state.selected = new Set([vis[n]]);
    refreshRowClasses();
    const row = list.querySelector(`.row[data-i="${vis[n]}"]`);
    if (row) row.scrollIntoView({ block: 'nearest' });
  }
});

// ---------- Arrastrar y soltar ----------
let dragging = false;
let dragDepth = 0;
const INTERNAL = 'application/x-pixeldeck-rows';

list.addEventListener('dragstart', (e) => {
  const row = e.target.closest('.row');
  if (!row || state.view !== 'list') { e.preventDefault(); return; }
  const i = +row.dataset.i;
  if (!state.selected.has(i)) { state.selected = new Set([i]); refreshRowClasses(); }
  dragging = true;
  e.dataTransfer.setData(INTERNAL, '1');
  e.dataTransfer.effectAllowed = 'move';
});
list.addEventListener('dragend', () => { dragging = false; clearDropMarks(); });

function clearDropMarks() { list.querySelectorAll('.drop-before').forEach((r) => r.classList.remove('drop-before')); }
function dropTargetIndex(e) {
  const row = e.target.closest && e.target.closest('.row');
  if (!row) return state.tracks.length;
  const r = row.getBoundingClientRect();
  const i = +row.dataset.i;
  return e.clientY > r.top + r.height / 2 ? i + 1 : i;
}

document.addEventListener('dragenter', (e) => {
  if (e.dataTransfer.types.includes('Files')) { dragDepth++; $('dropzone').classList.add('show'); }
});
document.addEventListener('dragleave', (e) => {
  if (e.dataTransfer.types.includes('Files')) {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) $('dropzone').classList.remove('show');
  }
});
document.addEventListener('dragover', (e) => {
  e.preventDefault();
  if (dragging) {
    clearDropMarks();
    const row = e.target.closest && e.target.closest('.row');
    if (row) {
      const r = row.getBoundingClientRect();
      const target = e.clientY > r.top + r.height / 2 ? row.nextElementSibling : row;
      if (target) target.classList.add('drop-before');
    }
  }
});
document.addEventListener('drop', async (e) => {
  e.preventDefault();
  dragDepth = 0;
  $('dropzone').classList.remove('show');
  if (dragging) {
    const to = dropTargetIndex(e);
    const idx = [...state.selected].sort((a, b) => a - b);
    const cur = state.playView === 'list' ? state.tracks[state.current] : null;
    const moving = idx.map((i) => state.tracks[i]);
    const before = idx.filter((i) => i < to).length;
    state.tracks = state.tracks.filter((_, i) => !state.selected.has(i));
    const at = to - before;
    state.tracks.splice(at, 0, ...moving);
    if (state.playView === 'list') state.current = cur ? state.tracks.indexOf(cur) : -1;
    state.selected = new Set(moving.map((_, k) => at + k));
    dragging = false;
    clearDropMarks();
    renderList(); updateDisplayInfo(); save();
    return;
  }
  const files = [...(e.dataTransfer.files || [])];
  if (!files.length) return;
  const paths = files.map((f) => window.deck.pathFor(f)).filter(Boolean);
  const insertAt = state.view === 'list' && e.target.closest && e.target.closest('.row') ? dropTargetIndex(e) : null;
  addPaths(paths, insertAt);
});

// ---------- Inicio ----------
(async function init() {
  const data = await window.deck.load();
  if (data && Array.isArray(data.tracks)) {
    state.tracks = data.tracks.map((t) => ({ ...t }));
    state.cloud = Array.isArray(data.cloud) ? data.cloud.map((t) => ({ ...t })) : [];
    const s = data.settings || {};
    const pv = s.playView === 'cloud' ? 'cloud' : 'list';
    Object.assign(state, {
      playView: pv,
      current: Number.isInteger(s.current) && s.current < arr(pv).length ? s.current : -1,
      shuffle: !!s.shuffle,
      repeat: s.repeat || 'off',
      volume: typeof s.volume === 'number' ? s.volume : 0.8,
      eqOn: s.eqOn !== false,
      eqOpen: !!s.eqOpen,
      preamp: s.preamp || 0,
      bands: Array.isArray(s.bands) && s.bands.length === 10 ? s.bands : state.bands,
      showRemaining: !!s.showRemaining,
      folder: s.folder || ''
    });
    if (s.view === 'cloud') {
      state.view = 'cloud';
      $('tabList').classList.remove('on'); $('tabCloud').classList.add('on');
      $('footList').classList.add('hidden'); $('footCloud').classList.remove('hidden');
    }
  }
  rebuildCloudKeys();
  const cfg = await window.deck.cloudGet();
  state.cloudReady = !!cfg.configured;
  audio.volume = state.volume;
  $('volume').value = Math.round(state.volume * 100);
  buildEq();
  renderToggles();
  renderList();
  updateDisplayInfo();
  updateTime();
  await checkMissing();
  state.tracks.forEach((t) => { if (!isCloud(t.path) && !t.missing) enqueueMeta(t); else if (isCloud(t.path)) enqueueMeta(t); });
  if (state.current >= 0) scrollToCurrent();
  if (state.cloudReady) refreshCloud(true); // actualiza la biblioteca en silencio al abrir
})();

window.addEventListener('focus', checkMissing);
setInterval(checkMissing, 8000);
