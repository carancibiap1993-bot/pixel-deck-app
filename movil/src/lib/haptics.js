// Vibración corta al presionar botones
import { Haptics, ImpactStyle } from '@capacitor/haptics';

export const tap = () => { Haptics.impact({ style: ImpactStyle.Light }).catch(() => {}); };
export const thump = () => { Haptics.impact({ style: ImpactStyle.Medium }).catch(() => {}); };
export const tick = () => { Haptics.selectionChanged().catch(() => {}); };
