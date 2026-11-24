import { EQ_LABELS, EQ_PRESETS } from '../lib/engine.js';
import { tap, tick } from '../lib/haptics.js';

const XFADES = [[0, 'NO'], [3, '3 s'], [6, '6 s'], [10, '10 s']];

// Hoja inferior: transición entre canciones, modo fiesta y ecualizador con master
export default function SoundSheet({ open, onClose, eq, setEq, mix, setMix }) {
  const setBand = (i, v) => { const bands = [...eq.bands]; bands[i] = v; setEq({ ...eq, bands }); };
  const slider = (label, value, onChange, cls = '') => (
    <div className={'band ' + cls} key={label}>
      <span className="db">{value > 0 ? '+' : ''}{Number(value).toFixed(0)}</span>
      <input type="range" min="-12" max="12" step="0.5" value={value}
        onChange={(e) => { onChange(parseFloat(e.target.value)); }}
        onDoubleClick={() => onChange(0)} />
      <label>{label}</label>
    </div>
  );

  return (
    <div className={'sheet-wrap' + (open ? ' open' : '')} onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="grabber" />
        <div className="sheet-head">
          <h3>SONIDO</h3>
          <button className="pill" onClick={() => { tap(); onClose(); }}>LISTO</button>
        </div>

        <div className="section-title">TRANSICIÓN ENTRE CANCIONES</div>
        <div className="seg">
          {XFADES.map(([v, l]) => (
            <button key={v} className={mix.crossfade === v ? 'on' : ''} onClick={() => { tick(); setMix({ ...mix, crossfade: v }); }}>{l}</button>
          ))}
        </div>

        <button className={'party-card' + (mix.party ? ' on' : '')} onClick={() => { tap(); setMix({ ...mix, party: !mix.party }); }}>
          <span className="party-title">🎉 MODO FIESTA {mix.party ? 'ACTIVADO' : ''}</span>
          <span className="party-desc">Mezcla larga estilo DJ (cambio de graves entre canciones), orden aleatorio sin repetir y luces que siguen el ritmo.</span>
        </button>

        <div className="section-title eq-title">
          ECUALIZADOR
          <button className={'pill small' + (eq.on ? ' on' : '')} onClick={() => { tap(); setEq({ ...eq, on: !eq.on }); }}>{eq.on ? 'ON' : 'OFF'}</button>
        </div>
        <div className="presets">
          {Object.keys(EQ_PRESETS).map((p) => (
            <button key={p} className="chip" onClick={() => { tick(); setEq({ ...eq, on: true, bands: [...EQ_PRESETS[p]] }); }}>{p}</button>
          ))}
        </div>
        <div className={'eq-bands' + (eq.on ? '' : ' off')}>
          {slider('PRE', eq.preamp, (v) => setEq({ ...eq, preamp: v }), 'pre')}
          {EQ_LABELS.map((l, i) => slider(l, eq.bands[i], (v) => setBand(i, v)))}
          {slider('MASTER', eq.master, (v) => setEq({ ...eq, master: v }), 'master')}
        </div>
        <p className="sheet-hint">Doble toque en un control lo deja en 0. Un limitador protege el sonido para que no se sature aunque subas el MASTER.</p>
      </div>
    </div>
  );
}
