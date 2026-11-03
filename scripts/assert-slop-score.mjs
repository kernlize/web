#!/usr/bin/env node
import { pathToFileURL } from 'node:url';

/**
 * Judge an aislop `--json` report against a minimum score.
 * @param {{ score?: number, summary?: { errors?: number, warnings?: number }, scoreable?: boolean }} report Parsed aislop JSON output.
 * @param {number} minimum Lowest passing score.
 * @returns {{ ok: boolean, score: number, findings: number, message: string }} Verdict and a one-line summary.
 * @example
 * assess({ score: 100, summary: { errors: 0, warnings: 0 } }, 100).ok; // true
 */
export function assess(report, minimum) {
  const score = typeof report.score === 'number' ? report.score : Number.NaN;
  const findings = (report.summary?.errors ?? 0) + (report.summary?.warnings ?? 0);
  const scoreable = report.scoreable !== false;
  const ok = scoreable && score >= minimum;
  const message = `[slop] score ${Number.isNaN(score) ? 'n/a' : score} (minimum ${minimum}), ${findings} finding(s)${scoreable ? '' : ', not scoreable'}`;
  return { ok, score, findings, message };
}

/**
 * Parse the minimum score from the environment.
 * @param {string | undefined} raw `SLOP_MIN` as given.
 * @returns {number} The minimum, 100 when unset or invalid.
 * @example
 * minimumFrom('95'); // 95
 */
export function minimumFrom(raw) {
  const parsed = Number.parseInt(raw ?? '', 10);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 100 ? parsed : 100;
}

async function readStdin() {
  let data = '';
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const raw = await readStdin();
  const start = raw.indexOf('{');
  if (start < 0) {
    console.error('[slop] no JSON on stdin; run: aislop scan --json . | node scripts/assert-slop-score.mjs');
    process.exit(1);
  }
  const verdict = assess(JSON.parse(raw.slice(start)), minimumFrom(process.env.SLOP_MIN));
  console.log(verdict.message);
  process.exit(verdict.ok ? 0 : 1);
}
