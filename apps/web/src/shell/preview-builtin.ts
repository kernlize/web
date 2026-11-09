import type { AppletPointer, AppletSummary, BuiltinApplet, Grants } from './contract';

const ADDRESS = /^kernl:([a-z][a-z0-9-]*)$/;

/** The preview's hold on the applets the shell ships: their addresses, their bytes, their first grants. */
export interface PreviewBuiltins {
  /** A built-in pointer for `kernl:<id>`, or undefined for any other address. */
  decode(address: string): AppletPointer | undefined;
  /** Load the applet, check it against its pin and, on its first run, switch on the domains it starts with. */
  resolve(id: string): Promise<AppletSummary>;
  /** The checked document for a summary `resolve` returned; undefined for the preview's samples. */
  documentOf(summary: AppletSummary): string | undefined;
}

/**
 * Built-in applets in the preview. The check is the live shell's own (`resolveBuiltin`, loaded with
 * the core on first use), so the preview opens exactly the bytes the live shell would, or refuses
 * them for the same reason.
 */
export function createPreviewBuiltins(builtins: readonly BuiltinApplet[], grants: Grants): PreviewBuiltins {
  const documents = new Map<string, string>();
  return {
    decode(address) {
      const id = ADDRESS.exec(address)?.[1];
      return id === undefined ? undefined : { kind: 'builtin', id, relays: [] };
    },
    async resolve(id) {
      const { resolveBuiltin } = await import('@kernlize/core');
      const { summary, indexHtml } = await resolveBuiltin(builtins, id);
      documents.set(summary.identity.hash, indexHtml);
      if (!grants.get(summary.identity)) {
        const wanted = builtins.find((applet) => applet.id === id)?.grants ?? [];
        for (const domain of wanted) if (grants.availableDomains().includes(domain)) grants.allowDomain(summary.identity, domain);
      }
      return summary;
    },
    documentOf: (summary) => (summary.builtin ? documents.get(summary.identity.hash) : undefined),
  };
}
