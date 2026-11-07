// Theme and language. Inside pi-webapp they follow the host (its Settings → Appearance / Language,
// sent on connect and on every change); standalone they follow the system and the browser, as
// OpenPencil's own app does.
import { reactive, watch } from 'vue';
import { locale, localeSetting } from '@open-pencil/vue/i18n';
import { host, hosted } from '../host.js';

const scheme = matchMedia('(prefers-color-scheme: light)');
export const appearance = reactive({ theme: 'dark', locale: 'en' });

const hostTheme = () => (host.mount?.theme === 'light' || host.mount?.theme === 'dark' ? host.mount.theme : null);
const hostLocale = () => (host.mount?.locale === 'zh' ? 'zh-CN' : host.mount?.locale === 'en' ? 'en' : null);

function apply() {
  appearance.theme = (hosted && hostTheme()) || (scheme.matches ? 'light' : 'dark');
  document.documentElement.dataset.theme = appearance.theme;
  // Not setLocale(): that persists the choice, and the host owns it. Standalone, the SDK resolves
  // the browser's language itself.
  const wanted = hosted ? hostLocale() : null;
  if (wanted && localeSetting.get() !== wanted) localeSetting.set(wanted);
  appearance.locale = String(locale.get());
  document.documentElement.lang = appearance.locale;
}

export function followAppearance() {
  apply();
  scheme.addEventListener('change', apply);
  watch(() => [host.mount?.theme, host.mount?.locale], apply);
}
