/**
 * `@kernlize/modules/catalog`: the catalog module on its own, so a host that lists it bundles only what it needs (D-068).
 *
 * @packageDocumentation
 */
export type { AppletCatalog } from '../catalog/types.js';
export { catalogModule } from '../modules/catalog.js';
export { addressOf, newestEntries, toCatalogEntry, type CatalogEntry } from '../catalog/entry.js';
export { CATALOG_EMIT_MS, CATALOG_LIMIT, CATALOG_SETTLE_MS, CATALOG_TIMEOUT_MS, catalogRelays, loadCatalog, streamCatalog, type LoadCatalogOptions } from '../catalog/fetch.js';
export { fuzzyScore, popularTopics, searchCatalog, type CatalogQuery, type TopicCount } from '../catalog/search.js';
