import { expect } from 'vitest';
import { Given, Then, When } from 'quickpickle';
import type { AppletSummary } from '../../src/shell/contract.ts';
import { SAMPLES, renderPreviewApplet, sampleAddressOf, sampleSummary } from '../../src/shell/preview-applet.ts';
import './preview-state.ts';

interface AppletScratch {
  summary?: AppletSummary | undefined;
  address?: string | undefined;
  html?: string;
  domains: string[];
  labels: string[];
}

interface AppletWorld {
  previewApplet?: AppletScratch;
}

const split = (list: string): string[] => (list === '' ? [] : list.split(',').map((part) => part.trim()));

function state(world: AppletWorld): AppletScratch {
  world.previewApplet ??= { domains: [], labels: [] };
  return world.previewApplet;
}

function html(world: AppletWorld): string {
  const value = state(world).html;
  if (value === undefined) throw new Error('render the preview applet first');
  return value;
}

/** The `<li>` markup for one action button, so assertions read one row at a time. */
function actionRow(world: AppletWorld, action: string): string {
  const row = html(world)
    .split('<li>')
    .find((item) => item.includes(`data-action="${action}"`));
  if (!row) throw new Error(`no "${action}" button`);
  return row;
}

Then('the preview applet offers the samples {string}', (_world: AppletWorld, titles: string) => {
  expect(SAMPLES.map((sample) => sample.title)).toEqual(split(titles));
  for (const sample of SAMPLES) expect(sample.blurb).not.toBe('');
});

When('the preview applet looks up the sample at {string}', (world: AppletWorld, address: string) => {
  state(world).summary = sampleSummary(address);
});

Then('the preview applet finds the sample {string} with key {string}', (world: AppletWorld, title: string, dTag: string) => {
  const summary = state(world).summary;
  expect(summary?.title).toBe(title);
  expect(summary?.identity.dTag).toBe(dTag);
  expect(summary?.manifest.dTag).toBe(dTag);
  expect(summary?.manifest.catalogId.endsWith(`:${dTag}`)).toBe(true);
  expect(summary?.manifest.artifactHash).toBe(summary?.identity.hash);
});

Then('the preview applet sample requires {string} and optionally uses {string}', (world: AppletWorld, requires: string, optional: string) => {
  const summary = state(world).summary;
  expect(summary?.requires).toEqual(split(requires));
  expect(summary?.optional).toEqual(split(optional));
  expect(summary?.manifest.requires).toEqual(split(requires));
  expect(summary?.manifest.optional).toEqual(split(optional));
});

Then('the preview applet finds no sample', (world: AppletWorld) => {
  expect(state(world).summary).toBeUndefined();
});

When('the preview applet asks for the address of the sample keyed {string}', (world: AppletWorld, dTag: string) => {
  state(world).address = sampleAddressOf({ dTag });
});

Then('the preview applet sample address is {string}', (world: AppletWorld, address: string) => {
  expect(state(world).address).toBe(address);
});

Then('the preview applet has no sample address', (world: AppletWorld) => {
  expect(state(world).address).toBeUndefined();
});

Given('the preview applet is granted {string} shown as {string}', (world: AppletWorld, domains: string, labels: string) => {
  state(world).domains = split(domains);
  state(world).labels = split(labels);
});

When('the preview applet renders sample {string} titled {string}', (world: AppletWorld, sample: string, title: string) => {
  const { domains, labels } = state(world);
  state(world).html = renderPreviewApplet({
    title,
    csp: "default-src 'none'; script-src 'unsafe-inline'",
    domains,
    domainLabels: labels,
    identity: `${sample}@preview`,
    sample,
  });
});

Then('the preview applet document contains {string}', (world: AppletWorld, text: string) => {
  expect(html(world)).toContain(text);
});

Then('the preview applet document does not contain {string}', (world: AppletWorld, text: string) => {
  expect(html(world)).not.toContain(text);
});

Then('the preview applet escapes the policy into its meta tag', (world: AppletWorld) => {
  expect(html(world)).toContain('content="default-src &#39;none&#39;; script-src &#39;unsafe-inline&#39;"');
});

Then('the preview applet runs the network sweep, then the frame lock, before its own scripts', (world: AppletWorld) => {
  const doc = html(world);
  const policy = doc.indexOf('Content-Security-Policy');
  const sweep = doc.indexOf('<script>(() => {');
  const lock = doc.indexOf('<script data-kernl-frame-lock>');
  expect(doc.split('<script data-kernl-frame-lock>')).toHaveLength(2);
  expect(policy).toBeGreaterThan(-1);
  expect(sweep).toBeGreaterThan(policy);
  expect(doc.slice(sweep, lock)).toContain('RTCPeerConnection');
  expect(lock).toBeGreaterThan(sweep);
  expect(lock).toBeLessThan(doc.indexOf('<title>'));
});

Then('the preview applet button {string} is available', (world: AppletWorld, action: string) => {
  const row = actionRow(world, action);
  expect(row).not.toContain('data-missing');
  expect(row).not.toContain('(not granted)');
});

Then('the preview applet button {string} is marked not granted', (world: AppletWorld, action: string) => {
  const row = actionRow(world, action);
  expect(row).toContain('data-missing="1"');
  expect(row).toContain('(not granted)');
});

Then('the preview applet has no {string} button', (world: AppletWorld, action: string) => {
  expect(html(world)).not.toContain(`data-action="${action}"`);
});
