// Controles en la notificación / pantalla de bloqueo. En Android además mantiene
// un servicio en primer plano para que la música siga sonando con la pantalla apagada.
import { MediaSession } from '@capgo/capacitor-media-session';

const safe = (p) => p.catch(() => {});

export function setNowPlaying({ title, artist, album }) {
  safe(MediaSession.setMetadata({ title: title || 'Pixel Deck', artist: artist || '', album: album || '' }));
}

export function setPlaying(state) {
  safe(MediaSession.setPlaybackState({ playbackState: state }));
}

export function setPosition(duration, position) {
  if (!isFinite(duration) || duration <= 0) return;
  safe(MediaSession.setPositionState({ duration, position: Math.min(position, duration), playbackRate: 1 }));
}

export function bindActions(handlers) {
  const map = {
    play: handlers.play,
    pause: handlers.pause,
    stop: handlers.pause,
    nexttrack: handlers.next,
    previoustrack: handlers.prev,
    seekto: (d) => d && d.seekTime != null && handlers.seek(d.seekTime),
    seekforward: () => handlers.skip(15),
    seekbackward: () => handlers.skip(-15)
  };
  Object.entries(map).forEach(([action, fn]) => safe(MediaSession.setActionHandler({ action }, fn)));
}
