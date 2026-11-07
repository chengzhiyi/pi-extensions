// The editor (loaded by main.js after the host handshake listener exists).
// Order matters: point Core at its emitted runtime assets before anything loads CanvasKit/fonts.
import '@open-pencil/core/runtime-assets/install';
import { fontManager, WEB_FONT_PROVIDER_IDS } from '@open-pencil/core/text';
import { createApp } from 'vue';
import App from './App.vue';
import './editor/theme.css';
import { followAppearance } from './editor/appearance.js';

// Offline: no online font providers; CJK comes from the plugin's own origin.
fontManager.setOnlineFontProviders(Object.fromEntries(WEB_FONT_PROVIDER_IDS.map((id) => [id, false])));
const CJK = {
  Regular: new URL('../../.cache/fonts/NotoSansSC-Regular.ttf', import.meta.url).href,
  Medium: new URL('../../.cache/fonts/NotoSansSC-Medium.ttf', import.meta.url).href,
  Bold: new URL('../../.cache/fonts/NotoSansSC-Bold.ttf', import.meta.url).href,
};
const cache = new Map();
fontManager.setHostFontLoader(async (family, style) => {
  if (family !== 'Noto Sans SC' && !/Noto Sans CJK|Source Han|PingFang|Hiragino|Microsoft YaHei/i.test(family)) return null;
  const key = CJK[style] ? style : /bold/i.test(style) ? 'Bold' : /medium|semi/i.test(style) ? 'Medium' : 'Regular';
  if (!cache.has(key)) cache.set(key, fetch(CJK[key]).then((r) => r.ok ? r.arrayBuffer() : null));
  const buffer = await cache.get(key);
  return buffer ? buffer.slice(0) : null;
});
fontManager.setCJKFallbackFamily('Noto Sans SC');

// Theme and language follow the host inside pi-webapp, else the system and browser.
followAppearance();

createApp(App).mount('#app');
