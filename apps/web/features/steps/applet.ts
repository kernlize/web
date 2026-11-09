import { expect } from 'vitest';
import { Given, Then, When } from 'quickpickle';
import { renderNappletCspMeta, renderNappletNamespacePrelude, type NappletCspOptions } from '@kehto/shell';
import type { AppletSummary } from '../../src/shell/contract.ts';
import { PREVIEW_CATALOG, renderPreviewApplet, sampleAddressOf, sampleSummary } from '../../src/shell/preview-applet.ts';
import './preview-state.ts';

/** A policy that differs from kehto's baseline, so the meta shows the guard's directives were applied. */
const PREVIEW_CSP: NappletCspOptions = { directives: { 'img-src': ['data:'] } };

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

Then('the preview store lists {string}', (_world: AppletWorld, titles: string) => {
  expect(PREVIEW_CATALOG.map((entry) => entry.title)).toEqual(split(titles));
  for (const entry of PREVIEW_CATALOG) {
    expect(entry.description).not.toBe('');
    expect(entry.catalogId).toBe(`nip5d:35129:${entry.publisher}:${entry.address.slice('preview:'.length)}`);
  }
});

function catalogEntry(title: string) {
  const entry = PREVIEW_CATALOG.find((candidate) => candidate.title === title);
  if (!entry) throw new Error(`no entry ${title}`);
  return entry;
}

Then('the preview store entry {string} takes requests to {string} and carries topics {string}', (_world: AppletWorld, title: string, conventions: string, topics: string) => {
  const entry = catalogEntry(title);
  expect(entry.conventions).toEqual(split(conventions));
  expect(entry.archetypes).toEqual(split(conventions).map((convention) => convention.split(':')[1]?.split('/')[0]));
  expect(entry.topics).toEqual(split(topics));
});

Then('the preview store entry {string} takes no requests and requires {string}', (_world: AppletWorld, title: string, requires: string) => {
  const entry = catalogEntry(title);
  expect(entry.conventions).toEqual([]);
  expect(entry.requires).toEqual(split(requires));
});

Then('the preview applet sample takes {string} as role {string} with address {string}', (world: AppletWorld, convention: string, role: string, address: string) => {
  const summary = state(world).summary;
  expect(summary?.address).toBe(address);
  expect(summary?.archetypes).toEqual([role]);
  expect(summary?.manifest.archetypes).toEqual([{ slug: role, convention, params: ['pubkey'] }]);
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
    csp: PREVIEW_CSP,
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

Then("the preview applet carries kehto's locked policy in its meta tag", (world: AppletWorld) => {
  const doc = html(world);
  expect(doc).toContain(renderNappletCspMeta(PREVIEW_CSP, true));
  expect(doc).toContain("img-src data:; font-src");
  expect(doc).toContain("; require-trusted-types-for 'script'; trusted-types default\">");
});

Then("the preview applet runs kehto's locked prelude, then the insertion lock, before its own scripts", (world: AppletWorld) => {
  const doc = html(world);
  const policy = doc.indexOf('Content-Security-Policy');
  const prelude = doc.indexOf('<script data-kehto-nip5d-injection>');
  const lock = doc.indexOf('<script data-kernl-insertion-lock>');
  expect(doc.split('<script data-kernl-insertion-lock>')).toHaveLength(2);
  expect(policy).toBeGreaterThan(-1);
  expect(prelude).toBeGreaterThan(policy);
  expect(doc).toContain(renderNappletNamespacePrelude({ domains: state(world).domains, experimental: { nestedContextLock: true } }) + '<script data-kernl-insertion-lock>');
  expect(doc.slice(prelude, lock)).toContain('RTCPeerConnection');
  expect(doc.slice(prelude, lock)).toContain('kehto: napplets may not create nested browsing contexts');
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
