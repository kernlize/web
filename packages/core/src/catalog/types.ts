import type { Observable } from 'rxjs';
import type { CatalogEntry } from './entry.js';
import type { LoadCatalogOptions } from './fetch.js';

/** The applet store's catalogue. */
export interface AppletCatalog {
  /** List the applets published to the store's relays, newest first, once every relay has finished. */
  load(options?: LoadCatalogOptions): Promise<readonly CatalogEntry[]>;
  /** The same list, emitted again as manifests arrive; completes when every relay has finished. */
  stream(options?: LoadCatalogOptions): Observable<readonly CatalogEntry[]>;
}
