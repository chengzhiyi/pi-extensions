// The frame never fetches web fonts (online providers are disabled); unifont's Node-only proxy
// path dynamically imports undici. Fail loudly if anything ever reaches it.
export default {};
export class ProxyAgent { constructor() { throw new Error('pi-pencil: network proxy unavailable in the editor frame'); } }
export function setGlobalDispatcher() { throw new Error('pi-pencil: network dispatcher unavailable'); }
