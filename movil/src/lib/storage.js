// Capa única de guardado: ajustes en Preferences, listas grandes como archivos JSON.
import { Preferences } from '@capacitor/preferences';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';

export async function getPref(key, fallback) {
  try {
    const { value } = await Preferences.get({ key });
    return value == null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}

export async function setPref(key, value) {
  await Preferences.set({ key, value: JSON.stringify(value) });
}

export async function removePref(key) {
  await Preferences.remove({ key });
}

export async function readJSON(name, fallback) {
  try {
    const r = await Filesystem.readFile({ path: name, directory: Directory.Data, encoding: Encoding.UTF8 });
    return JSON.parse(typeof r.data === 'string' ? r.data : await r.data.text());
  } catch {
    return fallback;
  }
}

export async function writeJSON(name, value) {
  await Filesystem.writeFile({ path: name, directory: Directory.Data, encoding: Encoding.UTF8, data: JSON.stringify(value), recursive: true });
}
