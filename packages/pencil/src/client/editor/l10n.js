// pi-pencil's own strings (everything the OpenPencil SDK does not translate). Follows the SDK's
// locale, which follows the browser, so both read in the same language.
import { ref } from 'vue';
import { locale } from '@open-pencil/vue/i18n';

const current = ref(locale.get());
locale.subscribe((value) => { current.value = value; });
export const t = (zh, en) => (String(current.value).startsWith('zh') ? zh : en);
