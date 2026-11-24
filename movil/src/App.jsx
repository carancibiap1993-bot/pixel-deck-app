import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { App as CapApp } from '@capacitor/app';
import { Network } from '@capacitor/network';
import Display from './components/Display.jsx';
import VirtualList from './components/VirtualList.jsx';
import SoundSheet from './components/SoundSheet.jsx';
import Setup from './screens/Setup.jsx';
import { makeR2 } from './lib/r2.js';
import { parseId3 } from './lib/id3.js';
import { getPref, setPref, readJSON, writeJSON } from './lib/storage.js';
import { createDownloads } from './lib/downloads.js';
import { createEngine } from './lib/engine.js';
import { setNowPlaying, setPlaying as setMediaPlaying, setPosition, bindActions } from './lib/media.js';
import { tap, thump, tick } from './lib/haptics.js';
import { fmtTime, fmtSize, norm, labels, displayName, topFolder, parentFolder } from './lib/format.js';

const ROW_H = 58;
const LIB_FILE = 'library.json';
const DEFAULT_EQ = { on: true, bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], preamp: 0, master: 0 };
const DEFAULT_MIX = { crossfade: 4, party: false };

// ¿El bucket permite que el ecualizador procese el audio de la nube? (CORS)
async function checkCors(r2, key) {
  try {
    const url = await r2.objectUrl(key);
    const r = await fetch(url, { headers: { Range: 'bytes=0-1' } });
    return r.ok || r.status === 206;
  } catch {
    return false;
  }
}

export default function App() {
  // ---------- estado general ----------
  const [screen, setScreen] = useState('loading');   // loading | setup | main
  const [cfg, setCfg] = useState(null);
  const [setupBusy, setSetupBusy] = useState('');
  const [setupError, setSetupError] = useState('');
  const [library, setLibrary] = useState([]);
  const [libVersion, setLibVersion] = useState(0);
  const [tab, setTab] = useState('cloud');
  const [search, setSearch] = useState('');
  const [folder, setFolder] = useState('');
  const [online, setOnline] = useState(true);
  const [toast, setToast] = useState('');
  const [confirm, setConfirm] = useState(null);
  const [, setDlTick] = useState(0);
  const [refreshing, setRefreshing] = useState('');
  const [corsOk, setCorsOk] = useState(true);

  // ---------- reproductor ----------
  const [queue, setQueue] = useState([]);
  const [qi, setQi] = useState(-1);
  const [source, setSource] = useState('');
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState('off');
  const [showRemaining, setShowRemaining] = useState(false);
  const [seeking, setSeeking] = useState(null);
  const [eq, setEqState] = useState(DEFAULT_EQ);
  const [mix, setMixState] = useState(DEFAULT_MIX);
  const [soundOpen, setSoundOpen] = useState(false);
  const [compact, setCompact] = useState(false);   // cabecera achicada al bajar en la lista
  const listEl = useRef(null);
  const [, setUi] = useState(0);

  const r2Ref = useRef(null);
  const libMap = useRef(new Map());
  const dl = useMemo(() => createDownloads(() => r2Ref.current), []);
  const st = useRef({});
  st.current = { queue, qi, shuffle: shuffle || mix.party, repeat, online, party: mix.party };
  const bag = useRef([]);            // orden aleatorio sin repetir
  const history = useRef([]);
  const pending = useRef(null);      // índice de la siguiente ya elegida
  const failStreak = useRef(0);
  const wasPlaying = useRef(false);
  const lastPos = useRef(0);

  const showToast = useCallback((msg) => {
    setToast(msg);
    clearTimeout(showToast.t);
    showToast.t = setTimeout(() => setToast(''), 2800);
  }, []);

  // ---------- cola ----------
  const buildItem = useCallback(async (index) => {
    const { queue: q, online: on } = st.current;
    const key = q[index];
    if (!key) return null;
    const t = libMap.current.get(key) || { key };
    let url = null, src = '';
    if (dl.has(key)) { url = await dl.playableUrl(key); src = 'local'; }
    else if (on && r2Ref.current) { url = await r2Ref.current.objectUrl(key); src = 'cloud'; }
    if (!url) return null;
    return { key, index, url, src, title: t.title, artist: t.artist, album: t.album };
  }, [dl]);

  const refillBag = (len, exclude) => {
    const a = [];
    for (let i = 0; i < len; i++) if (i !== exclude) a.push(i);
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    bag.current = a;
  };

  // índice siguiente (auto = al terminar la canción)
  const pickNext = (from, auto) => {
    const { queue: q, shuffle: sh, repeat: rp, party } = st.current;
    if (!q.length) return null;
    if (auto && rp === 'one') return from;
    if (sh) {
      if (!bag.current.length) {
        if (auto && rp === 'off' && !party && history.current.length >= q.length - 1) return null;
        refillBag(q.length, from);
      }
      return bag.current.shift() ?? null;
    }
    if (from + 1 < q.length) return from + 1;
    return auto && rp === 'off' ? null : 0;
  };

  // Busca la siguiente que se pueda reproducir (sin señal salta las no descargadas)
  const nextPlayable = useCallback(async (from, auto) => {
    const len = st.current.queue.length;
    let idx = from;
    for (let tries = 0; tries < Math.min(len, 200); tries++) {
      idx = pickNext(idx, auto);
      if (idx == null) return null;
      const item = await buildItem(idx);
      if (item) return item;
      if (auto && st.current.repeat === 'one') return null;
    }
    return null;
  }, [buildItem]);

  // ---------- motor de audio ----------
  const engine = useMemo(() => createEngine({
    getNext: async () => {
      const item = await nextPlayableRef.current(st.current.qi, true);
      pending.current = item ? item.index : null;
      return item;
    },
    onTrackStart: (item) => {
      if (st.current.qi >= 0 && st.current.qi !== item.index) history.current.push(st.current.qi);
      pending.current = null;
      setQi(item.index);
      setSource(item.src);
      const t = libMap.current.get(item.key) || item;
      const lb = labels({ ...t, key: item.key });
      setNowPlaying({ title: lb.main, artist: t.artist || parentFolder(item.key), album: t.album || topFolder(item.key) });
    },
    onState: () => {
      const s = engineRef.current.state();
      if (s.playing !== wasPlaying.current) {
        wasPlaying.current = s.playing;
        setMediaPlaying(s.playing ? 'playing' : 'paused');
        if (s.playing) failStreak.current = 0;
      }
      if (Math.abs(s.time - lastPos.current) > 5 || !s.playing) { lastPos.current = s.time; setPosition(s.duration, s.time); }
      setUi((n) => (n + 1) % 1e9);
    },
    onError: (item) => {
      failStreak.current++;
      if (failStreak.current > 8) { failStreak.current = 0; showToast('No se pudo reproducir. Revisa la conexión.'); return; }
      showToast('No se pudo reproducir, paso a la siguiente');
      goNextRef.current(true, item ? item.index : st.current.qi);
    }
  }), [showToast]);
  const engineRef = useRef(engine);
  const nextPlayableRef = useRef(nextPlayable);
  nextPlayableRef.current = nextPlayable;

  const playFrom = useCallback(async (list, index) => {
    tap();
    const q = list.map((t) => t.key);
    st.current.queue = q;                 // disponible de inmediato para buildItem
    setQueue(q);
    bag.current = [];
    history.current = [];
    pending.current = null;
    engine.resetNext();
    let item = await buildItem(index);
    if (!item) item = await nextPlayable(index, false);
    if (!item) { showToast('Sin señal: esa canción no está descargada'); return; }
    engine.playNow(item, st.current.party ? 1.5 : 0.6);
  }, [buildItem, engine, nextPlayable, showToast]);

  const goNext = useCallback(async (auto = false, fromIndex) => {
    const from = fromIndex ?? st.current.qi;
    let item = null;
    if (!auto && pending.current != null) item = await buildItem(pending.current);
    if (!item) item = await nextPlayable(from, auto);
    engine.resetNext();
    pending.current = null;
    if (!item) { if (!auto) showToast('No hay más canciones en la lista'); return; }
    engine.playNow(item, st.current.party ? 1.5 : 0.6);
  }, [buildItem, engine, nextPlayable, showToast]);
  const goNextRef = useRef(goNext);
  goNextRef.current = goNext;

  const goPrev = useCallback(async () => {
    const s = engine.state();
    if (s.time > 3) { engine.seek(0); return; }
    const { queue: q, qi: i, shuffle: sh } = st.current;
    if (!q.length) return;
    const idx = sh && history.current.length ? history.current.pop() : i <= 0 ? q.length - 1 : i - 1;
    const item = await buildItem(idx);
    if (!item) { showToast('Sin señal: esa canción no está descargada'); return; }
    engine.resetNext();
    engine.playNow(item, 0.4);
  }, [buildItem, engine, showToast]);

  const visibleRef = useRef([]);
  const togglePlay = useCallback(() => {
    thump();
    if (!engine.toggle() && visibleRef.current.length) playFrom(visibleRef.current, 0);
    setUi((n) => (n + 1) % 1e9);
  }, [engine, playFrom]);

  // Achicar la cabecera al bajar por la lista (con margen para que no parpadee)
  const onScrollPos = useCallback((y) => {
    setCompact((c) => (c ? y > 8 : y > 80));
  }, []);

  // Controles de la notificación / pantalla de bloqueo
  useEffect(() => {
    bindActions({
      play: () => engine.play(),
      pause: () => engine.pause(),
      next: () => goNextRef.current(false),
      prev: () => goPrev(),
      seek: (s) => engine.seek(s),
      skip: (d) => engine.skip(d)
    });
  }, [engine, goPrev]);

  // ---------- ajustes de sonido ----------
  const setEq = (e) => { setEqState(e); engine.setEq(e); setPref('eq', e); };
  const setMix = (m) => {
    setMixState(m);
    engine.setSettings(m);
    engine.resetNext();
    bag.current = [];
    setPref('mix', m);
    if (m.party !== mix.party) showToast(m.party ? '🎉 Modo fiesta activado' : 'Modo fiesta desactivado');
  };
  useEffect(() => { setPref('settings', { shuffle, repeat }); engine.resetNext(); bag.current = []; }, [shuffle, repeat, engine]);

  // ---------- guardado de la biblioteca ----------
  const saveLibTimer = useRef(null);
  const saveLibrary = useCallback(() => {
    clearTimeout(saveLibTimer.current);
    saveLibTimer.current = setTimeout(() => writeJSON(LIB_FILE, [...libMap.current.values()].map(({ _q, ...t }) => t)).catch(() => {}), 1500);
  }, []);
  const applyLibrary = useCallback((items) => {
    libMap.current = new Map(items.map((t) => [t.key, t]));
    setLibrary(items);
  }, []);

  // ---------- inicio ----------
  useEffect(() => {
    (async () => {
      const [savedCfg, settings, lib, savedEq, savedMix] = await Promise.all([
        getPref('cloud', null), getPref('settings', {}), readJSON(LIB_FILE, []), getPref('eq', DEFAULT_EQ), getPref('mix', DEFAULT_MIX)
      ]);
      setShuffle(!!settings.shuffle);
      setRepeat(settings.repeat || 'off');
      const e = { ...DEFAULT_EQ, ...savedEq }, m = { ...DEFAULT_MIX, ...savedMix };
      setEqState(e); engine.setEq(e);
      setMixState(m); engine.setSettings(m);
      applyLibrary(Array.isArray(lib) ? lib : []);
      await dl.load();
      const net = await Network.getStatus().catch(() => ({ connected: true }));
      setOnline(net.connected);
      if (savedCfg) {
        setCfg(savedCfg);
        r2Ref.current = makeR2(savedCfg);
        setScreen('main');
        if (net.connected) {
          refreshLibrary(true);
          const first = lib && lib[0];
          if (first) checkCors(r2Ref.current, first.key).then(setCorsOk);
        }
      } else {
        setScreen('setup');
      }
    })();
    const sub = dl.subscribe(() => setDlTick((n) => n + 1));
    const netSub = Network.addListener('networkStatusChange', (s) => setOnline(s.connected));
    const backSub = CapApp.addListener('backButton', () => {
      if (document.querySelector('.sheet-wrap.open')) { setSoundOpen(false); return; }
      CapApp.minimizeApp().catch(() => {});
    });
    return () => { sub(); netSub.then((x) => x.remove()); backSub.then((x) => x.remove()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- biblioteca en la nube ----------
  async function refreshLibrary(quiet = false) {
    const r2 = r2Ref.current;
    if (!r2) return;
    if (!quiet) setRefreshing('Leyendo tu biblioteca…');
    try {
      const items = await r2.listAll((n) => !quiet && setRefreshing(`Leyendo tu biblioteca… ${n}`));
      const merged = items.map((it) => {
        const old = libMap.current.get(it.key);
        return old ? { ...old, size: it.size } : { key: it.key, size: it.size };
      });
      applyLibrary(merged);
      saveLibrary();
      if (!quiet) showToast(`${merged.length} canciones en la nube`);
    } catch (e) {
      if (!quiet) showToast(e.message);
    }
    setRefreshing('');
  }

  async function saveCloud(newCfg) {
    setSetupError('');
    setSetupBusy('Conectando…');
    try {
      const r2 = makeR2(newCfg);
      const items = await r2.listAll((n) => setSetupBusy(`Conectado. Leyendo canciones… ${n}`));
      if (items.length) {
        setSetupBusy('Revisando permisos de reproducción…');
        const ok = await checkCors(r2, items[0].key);
        setCorsOk(ok);
        if (!ok) {
          setSetupError('Falta un ajuste en Cloudflare: activa CORS en el bucket (te dejé los pasos en el chat). Sin eso la música de la nube no puede pasar por el ecualizador.');
          setSetupBusy('');
          return;
        }
      }
      r2Ref.current = r2;
      await setPref('cloud', newCfg);
      setCfg(newCfg);
      const merged = items.map((it) => ({ ...(libMap.current.get(it.key) || {}), key: it.key, size: it.size }));
      applyLibrary(merged);
      saveLibrary();
      setScreen('main');
      showToast(`¡Listo! ${merged.length} canciones`);
    } catch (e) {
      setSetupError(e.message || 'No se pudo conectar.');
    }
    setSetupBusy('');
  }

  // ---------- etiquetas de lo que está a la vista ----------
  const metaQueue = useRef([]);
  const metaBusy = useRef(0);
  const pumpMeta = useCallback(() => {
    while (metaBusy.current < 3 && metaQueue.current.length) {
      const t = metaQueue.current.shift();
      metaBusy.current++;
      (async () => {
        try {
          const tags = parseId3(await r2Ref.current.range(t.key, 0, 32767));
          if (tags) Object.assign(t, tags);
        } catch { /* sin etiquetas */ }
        t.metaDone = true;
        t._q = false;
        metaBusy.current--;
        setLibVersion((v) => v + 1);
        saveLibrary();
        pumpMeta();
      })();
    }
  }, [saveLibrary]);

  const onVisible = useCallback((rows) => {
    if (!st.current.online || !r2Ref.current) return;
    rows.forEach((t) => {
      if (t.metaDone || t._q) return;
      if (!/\.mp3$/i.test(t.key)) { t.metaDone = true; return; }
      t._q = true;
      metaQueue.current.unshift(t);
    });
    metaQueue.current = metaQueue.current.slice(0, 60);
    pumpMeta();
  }, [pumpMeta]);

  // ---------- listas filtradas ----------
  const folders = useMemo(() => {
    const m = new Map();
    library.forEach((t) => { const f = topFolder(t.key); m.set(f, (m.get(f) || 0) + 1); });
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], 'es', { numeric: true }));
  }, [library]);

  const dlKeysCount = dl.keys().length;
  const visible = useMemo(() => {
    const words = norm(search).split(' ').filter(Boolean);
    let base = tab === 'downloads' ? library.filter((t) => dl.has(t.key)) : library;
    if (tab === 'cloud' && folder) base = base.filter((t) => topFolder(t.key) === folder);
    if (!words.length) return base;
    return base.filter((t) => {
      const hay = norm([t.title, t.artist, t.album, t.genre, t.year, t.key].filter(Boolean).join(' '));
      return words.every((w) => hay.includes(w));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [library, libVersion, search, folder, tab, dlKeysCount]);
  visibleRef.current = visible;

  // ---------- descargas ----------
  const dlStatus = dl.status();
  function askDownload(items) {
    const todo = items.filter((t) => !dl.has(t.key));
    if (!todo.length) { showToast('Ya están todas descargadas'); return; }
    const bytes = todo.reduce((s, t) => s + (t.size || 0), 0);
    setConfirm({
      text: `¿Descargar ${todo.length} ${todo.length === 1 ? 'canción' : 'canciones'} (${fmtSize(bytes)}) a este teléfono?\nTe recomiendo hacerlo con WiFi.`,
      ok: 'DESCARGAR',
      action: () => { dl.enqueue(todo.map((t) => ({ key: t.key, size: t.size }))); showToast('Descarga iniciada'); }
    });
  }
  function askRemove(items) {
    const keys = items.filter((t) => dl.has(t.key)).map((t) => t.key);
    if (!keys.length) return;
    setConfirm({
      text: keys.length === 1 ? '¿Quitar esta canción del teléfono? Seguirá en la nube.' : `¿Quitar ${keys.length} canciones del teléfono? Seguirán en la nube.`,
      ok: 'QUITAR',
      action: () => dl.remove(keys)
    });
  }

  // ---------- pantalla ----------
  if (screen === 'loading') return <div className="splash"><div className="brand big pulse">PIXEL<b>DECK</b></div></div>;
  if (screen === 'setup') {
    return <Setup initial={cfg} busy={setupBusy} error={setupError} onSave={saveCloud} onCancel={cfg ? () => setScreen('main') : null} />;
  }

  const es = engine.state();
  const currentKey = es.item ? es.item.key : queue[qi];
  const current = currentKey ? libMap.current.get(currentKey) || { key: currentKey } : null;
  const pos = seeking != null ? seeking : es.time;
  const dur = es.duration;
  const pct = isFinite(dur) && dur > 0 ? (pos / dur) * 100 : 0;
  const filtered = !!(search || folder);

  const renderRow = (t, i) => {
    const lb = labels(t);
    const isCur = t.key === currentKey;
    const has = dl.has(t.key);
    const pend = !has && dl.isPending(t.key);
    const cur = dlStatus.current && dlStatus.current.key === t.key ? dlStatus.current.pct : null;
    const dim = !online && !has;
    return (
      <div className={'row' + (isCur ? ' playing' : '') + (dim ? ' dim' : '')} onClick={() => playFrom(visible, i)}>
        {isCur && <span className={'eqbars' + (es.playing ? ' on' : '')}><i /><i /><i /></span>}
        <div className="row-text">
          <div className="t">{lb.main}</div>
          <div className="s">{lb.sub}</div>
        </div>
        <button className={'dlbtn' + (has ? ' ok' : '') + (cur != null ? ' busy' : '')} style={cur != null ? { '--pct': cur + '%' } : null}
          onClick={(e) => {
            e.stopPropagation();
            tick();
            if (has) askRemove([t]);
            else if (!pend) { if (!online) showToast('Necesitas internet para descargar'); else dl.enqueue([{ key: t.key, size: t.size }]); }
          }}>
          <span>{has ? '✓' : cur != null ? cur : pend ? '…' : '↓'}</span>
        </button>
      </div>
    );
  };

  const emptyMsg = tab === 'downloads'
    ? <div className="empty">Aún no tienes canciones descargadas.<br />En ☁ NUBE toca ↓ en una canción, o elige una carpeta y usa “↓ DESCARGAR ESTAS”.</div>
    : search ? <div className="empty">Sin resultados para “{search}”</div>
      : <div className="empty">No hay canciones.<br /><button className="pill on" onClick={() => refreshLibrary()}>↻ ACTUALIZAR</button></div>;

  const press = (fn) => () => { tap(); fn(); };

  return (
    <div className={'app' + (mix.party ? ' party' : '') + (compact ? ' compact' : '')}>
      <header className="titlebar">
        <span className="brand">PIXEL<b>DECK</b></span>
        <span className="maker">SOLIDPIXEL · HI-FI</span>
      </header>

      <Display
        engine={engine}
        title={current ? `${qi + 1}. ${displayName(current).toUpperCase()}` : ''}
        trackKey={currentKey}
        time={pos} duration={dur} playing={es.playing} mixing={es.mixing}
        source={current ? source : ''} offline={!online} party={mix.party}
        showRemaining={showRemaining} onToggleTime={() => { tick(); setShowRemaining((v) => !v); }}
        onExpand={() => { if (compact && listEl.current) { tap(); listEl.current.scrollTo({ top: 0, behavior: 'smooth' }); } }}
      />

      <div className="seekrow">
        <span>{fmtTime(pos)}</span>
        <input type="range" min="0" max="1000" value={Math.round(pct * 10)} style={{ '--p': pct + '%' }}
          onChange={(e) => setSeeking((e.target.value / 1000) * (dur || 0))}
          onPointerUp={(e) => { if (isFinite(dur)) engine.seek((e.target.value / 1000) * dur); setSeeking(null); }}
          onTouchEnd={(e) => { if (isFinite(dur)) engine.seek((e.target.value / 1000) * dur); setSeeking(null); }} />
        <span>{fmtTime(dur)}</span>
      </div>

      <section className="transport">
        <div className="keys">
          <button className="key" onClick={press(goPrev)}>⏮</button>
          <button className={'key play' + (es.playing ? ' active' : '')} onClick={togglePlay}>{es.playing ? '❚❚' : '▶'}</button>
          <button className="key" onClick={press(() => goNext(false))}>⏭</button>
        </div>
        <div className="toggles">
          <button className={'pill' + (shuffle || mix.party ? ' on' : '')} disabled={mix.party} onClick={press(() => setShuffle((v) => !v))}>ALEAT.</button>
          <button className={'pill' + (repeat !== 'off' ? ' on' : '')} onClick={press(() => setRepeat((r) => ({ off: 'all', all: 'one', one: 'off' }[r])))}>
            {{ off: 'REP: NO', all: 'REP: TODO', one: 'REP: UNA' }[repeat]}
          </button>
          <button className={'pill' + (eq.on && (eq.bands.some(Boolean) || eq.preamp || eq.master) ? ' on' : '')} onClick={press(() => setSoundOpen(true))}>EQ</button>
          <button className={'pill fiesta' + (mix.party ? ' on' : '')} onClick={press(() => setMix({ ...mix, party: !mix.party }))}>FIESTA</button>
        </div>
      </section>

      <section className="playlist">
        <div className="tabs">
          <button className={'tab' + (tab === 'cloud' ? ' on' : '')} onClick={press(() => setTab('cloud'))}>☁ NUBE</button>
          <button className={'tab' + (tab === 'downloads' ? ' on' : '')} onClick={press(() => setTab('downloads'))}>↓ DESCARGAS{dlKeysCount ? ` (${dlKeysCount})` : ''}</button>
          <button className="tab cfg" onClick={press(() => { setSetupError(''); setScreen('setup'); })}>⚙</button>
        </div>

        <div className="pl-head">
          <input type="search" placeholder="Buscar artista, canción o carpeta" value={search} onChange={(e) => setSearch(e.target.value)} />
          {search && <button className="clear" onClick={press(() => setSearch(''))}>✕</button>}
        </div>

        {tab === 'cloud' && (
          <div className="chips">
            <button className={'chip' + (!folder ? ' on' : '')} onClick={press(() => setFolder(''))}>TODAS · {library.length}</button>
            {folders.map(([f, n]) => (
              <button key={f} className={'chip' + (folder === f ? ' on' : '')}
                onClick={(e) => { tap(); const el = e.currentTarget; setFolder(folder === f ? '' : f); el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' }); }}>{f} · {n}</button>
            ))}
          </div>
        )}

        {!corsOk && online && (
          <div className="banner warn">Falta activar CORS en el bucket: la música de la nube podría no sonar. Revisa los pasos en el chat.</div>
        )}

        {(dlStatus.active || refreshing) && (
          <div className="banner">
            <span>{refreshing || `Descargando ${Math.min(dlStatus.done + 1, dlStatus.total)} de ${dlStatus.total}` + (dlStatus.current ? ` · ${dlStatus.current.pct}%` : '')}</span>
            {dlStatus.active && <button className="pill" onClick={press(() => dl.cancel())}>DETENER</button>}
            {dlStatus.active && <i className="banner-bar" style={{ width: `${dlStatus.total ? ((dlStatus.done + (dlStatus.current ? dlStatus.current.pct / 100 : 0)) / dlStatus.total) * 100 : 0}%` }} />}
          </div>
        )}

        <div className="pl-bar">
          <span className="count">{visible.length} {visible.length === 1 ? 'canción' : 'canciones'}</span>
          {tab === 'cloud' && filtered && visible.length > 0 && <button className="pill" onClick={press(() => askDownload(visible))}>↓ DESCARGAR ESTAS</button>}
          {tab === 'cloud' && !filtered && <button className="pill" onClick={press(() => refreshLibrary())} disabled={!online}>↻ ACTUALIZAR</button>}
          {tab === 'downloads' && dlKeysCount > 0 && <>
            <span className="count">{fmtSize(dl.usedBytes())}</span>
            <button className="pill" onClick={press(() => askRemove(visible))}>QUITAR {filtered ? 'ESTAS' : 'TODAS'}</button>
          </>}
        </div>

        <VirtualList items={visible} rowHeight={ROW_H} renderRow={renderRow} onVisible={tab === 'cloud' ? onVisible : null}
          scrollKey={tab + '|' + folder + '|' + search} empty={emptyMsg} onScrollPos={onScrollPos} listRef={listEl} />
      </section>

      <SoundSheet open={soundOpen} onClose={() => setSoundOpen(false)} eq={eq} setEq={setEq} mix={mix} setMix={setMix} />

      {confirm && (
        <div className="modal" onClick={() => setConfirm(null)}>
          <div className="card pop" onClick={(e) => e.stopPropagation()}>
            <p className="confirm-text">{confirm.text}</p>
            <div className="card-actions">
              <button className="pill" onClick={press(() => setConfirm(null))}>CANCELAR</button>
              <button className="pill on" onClick={press(() => { confirm.action(); setConfirm(null); })}>{confirm.ok}</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast" key={toast}>{toast}</div>}
    </div>
  );
}
