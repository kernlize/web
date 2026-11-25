import type { NamespacedStore } from '@kernlize/kernel';

const STORE_KEY = 'nzb-handles:v1';

/** The job a handle stands for; `gone` once the downloader no longer has it, after which the handle is never bound again. */
export interface NzbJobHandle {
  readonly applet: string;
  /** The handle the applet holds. */
  readonly id: string;
  /** The downloader's key in the shell. */
  readonly key: string;
  /** The downloader's own id for the job. */
  readonly backend: string;
  readonly gone: boolean;
}

interface DownloaderHandle {
  readonly applet: string;
  readonly id: string;
  readonly key: string;
}

interface CategoryHandle extends DownloaderHandle {
  /** The downloader's own name for the category. */
  readonly name: string;
}

interface HandleTable {
  downloaders: DownloaderHandle[];
  categories: CategoryHandle[];
  jobs: NzbJobHandle[];
}

/** The shell-issued names an applet knows downloaders, categories and jobs by, kept so they survive a reload. */
export interface NzbHandles {
  /** The applet's handle for a downloader, issued on first use. */
  downloaderId(applet: string, key: string): string;
  /** The downloader key a handle of this applet stands for. */
  downloaderKey(applet: string, id: string): string | undefined;
  /** The applet's handle for a downloader's category; issued on first use when `issue` is set. */
  categoryId(applet: string, key: string, name: string, issue?: boolean): string | undefined;
  /** The downloader's own category name a handle of this applet stands for on that downloader. */
  categoryName(applet: string, key: string, id: string): string | undefined;
  /** The applet's handle for a job it submitted; a new one unless a live handle already stands for that job. */
  jobId(applet: string, key: string, backend: string): string;
  /** The job a handle of this applet stands for, gone or not. */
  job(applet: string, id: string): NzbJobHandle | undefined;
  /** The applet's jobs on one downloader that are not gone. */
  jobs(applet: string, key: string): readonly NzbJobHandle[];
  /** Marks a job gone: the handle answers `not_found` from now on and is never bound to another job. */
  retire(applet: string, id: string): void;
  /** Drops the applet's gone handles that nothing can replay any more. */
  forget(applet: string, keep: ReadonlySet<string>): void;
}

type Row = Readonly<Record<string, unknown>>;

function rows<T>(value: unknown, fields: Readonly<Record<string, string>>): T[] {
  if (!Array.isArray(value)) return [];
  const sound = (row: unknown): boolean => typeof row === 'object' && row !== null && Object.entries(fields).every(([field, type]) => typeof (row as Row)[field] === type);
  return value.filter(sound) as T[];
}

const TEXT = { applet: 'string', id: 'string', key: 'string' } as const;

/**
 * The handle table over the shell's store. Handles are random, mean nothing outside
 * the applet they were issued to, and never carry a downloader's key, a category's own
 * name or a job's own id (NAP-NZB, Common values). Whatever comes back out of storage
 * is checked row by row; a row that is not sound is set aside.
 *
 * @param store - The shell's namespaced store.
 * @returns The handle table.
 * @example
 * ```ts
 * const handles = createNzbHandles(createNamespacedStore(localStorage, 'kernl'));
 * handles.downloaderId('reader', 'nzbget'); // '3f0c…'
 * ```
 */
export function createNzbHandles(store: NamespacedStore): NzbHandles {
  const load = (): HandleTable => {
    const raw = store.getJson<Row | null>(STORE_KEY, null) ?? {};
    return {
      downloaders: rows(raw.downloaders, TEXT),
      categories: rows(raw.categories, { ...TEXT, name: 'string' }),
      jobs: rows(raw.jobs, { ...TEXT, backend: 'string', gone: 'boolean' }),
    };
  };
  const issue = <T extends DownloaderHandle>(pick: (table: HandleTable) => T[], row: Omit<T, 'id'>): string => {
    const table = load();
    const id = crypto.randomUUID();
    pick(table).push({ ...row, id } as T);
    store.setJson(STORE_KEY, table);
    return id;
  };
  const mine = <T extends DownloaderHandle>(list: readonly T[], applet: string, key: string): T[] => list.filter((row) => row.applet === applet && row.key === key);
  return {
    downloaderId: (applet, key) => mine(load().downloaders, applet, key)[0]?.id ?? issue((table) => table.downloaders, { applet, key }),
    downloaderKey: (applet, id) => load().downloaders.find((row) => row.applet === applet && row.id === id)?.key,
    categoryId(applet, key, name, create = false) {
      const known = mine(load().categories, applet, key).find((row) => row.name === name)?.id;
      return known ?? (create ? issue((table) => table.categories, { applet, key, name }) : undefined);
    },
    categoryName: (applet, key, id) => mine(load().categories, applet, key).find((row) => row.id === id)?.name,
    jobId(applet, key, backend) {
      const live = mine(load().jobs, applet, key).find((row) => row.backend === backend && !row.gone)?.id;
      return live ?? issue((table) => table.jobs, { applet, key, backend, gone: false });
    },
    job: (applet, id) => load().jobs.find((row) => row.applet === applet && row.id === id),
    jobs: (applet, key) => mine(load().jobs, applet, key).filter((row) => !row.gone),
    retire(applet, id) {
      const table = load();
      table.jobs = table.jobs.map((row) => (row.applet === applet && row.id === id ? { ...row, gone: true } : row));
      store.setJson(STORE_KEY, table);
    },
    forget(applet, keep) {
      const table = load();
      table.jobs = table.jobs.filter((row) => row.applet !== applet || !row.gone || keep.has(row.id));
      store.setJson(STORE_KEY, table);
    },
  };
}
