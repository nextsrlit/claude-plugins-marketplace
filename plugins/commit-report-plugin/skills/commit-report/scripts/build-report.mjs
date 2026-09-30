#!/usr/bin/env node
// Renders the commit-report dashboard: injects a report-data JSON into assets/report-template.html.
// Usage: node build-report.mjs <data.json> <out.html>
import { readFileSync, writeFileSync } from 'node:fs';

const [dataPath, outPath] = process.argv.slice(2);
if (!dataPath || !outPath) {
  console.error('Usage: node build-report.mjs <data.json> <out.html>');
  process.exit(2);
}

const data = JSON.parse(readFileSync(dataPath, 'utf8'));
const template = readFileSync(new URL('../assets/report-template.html', import.meta.url), 'utf8');

const errors = [];
const need = (cond, msg) => { if (!cond) errors.push(msg); };
const QUALITY = new Set(['ok', 'warn', 'impr', 'bad', null]);

need(['it', 'en'].includes(data.lang), 'lang must be "it" or "en"');
need(typeof data.periodLabel === 'string', 'periodLabel (string) is required');
need(typeof data.generatedLabel === 'string', 'generatedLabel (string) is required');
need(Array.isArray(data.repos) && data.repos.length, 'repos must be a non-empty array');
need(Array.isArray(data.people), 'people must be an array');
need(Array.isArray(data.commits), 'commits must be an array');
if (errors.length) fail();

const repoNames = new Set(data.repos.map(r => r.name));
const personIds = new Set(data.people.map(p => p.id));
for (const r of data.repos) {
  need(r.name, 'every repo needs a name');
  if (r.commitUrl) need(r.commitUrl.includes('{hash}'), `repo ${r.name}: commitUrl must contain {hash}`);
  need(!r.review || ['guidelines', 'generic', 'off'].includes(r.review.mode), `repo ${r.name}: review.mode must be guidelines|generic|off`);
}
for (const p of data.people) need(p.id && p.name, 'every person needs id and name');
data.commits.forEach((c, i) => {
  const at = `commits[${i}] ${c.h?.slice(0, 8) ?? ''}`;
  need(/^[0-9a-f]{40}$/.test(c.h ?? ''), `${at}: h must be the full 40-char hash`);
  need(repoNames.has(c.r), `${at}: unknown repo "${c.r}"`);
  need(personIds.has(c.a), `${at}: unknown person "${c.a}"`);
  need(typeof c.m === 'string', `${at}: m (message) is required`);
  need(Number.isInteger(c.add) && Number.isInteger(c.del), `${at}: add/del must be integers`);
  need(QUALITY.has(c.q ?? null), `${at}: q must be ok|warn|impr|bad|null`);
  need(!c.notes || Array.isArray(c.notes), `${at}: notes must be an array of strings`);
});
if (errors.length) fail();

const escHtml = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// `<` escaped so no string inside the JSON can close the <script> block.
const json = JSON.stringify(data).replace(/</g, '\\u003c');
const title = data.title || `Commit Report — ${data.repos.map(r => r.name).join(' + ')} — ${data.periodLabel}`;

const html = template
  .replace('__REPORT_LANG__', data.lang)
  .replace('__REPORT_TITLE__', escHtml(title))
  .replace('/*__REPORT_DATA__*/null', () => json);
writeFileSync(outPath, html);
console.log(`Wrote ${outPath} — ${data.commits.length} commits, ${data.people.length} people, ${data.repos.length} repo(s)`);

function fail() {
  console.error('Invalid report data:\n- ' + errors.join('\n- '));
  process.exit(1);
}
