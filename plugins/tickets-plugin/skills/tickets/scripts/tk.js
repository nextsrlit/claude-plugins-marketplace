#!/usr/bin/env node
/**
 * tk — file-based ticket manager. Markdown files with YAML frontmatter.
 *
 * A ticket is just a ticket. Everything domain-specific (area, kind, phase,
 * subsystem, ...) lives in `tags`, which this tool treats as opaque strings.
 *
 * Layout:
 *   tickets/            open / in-progress / waiting
 *   tickets/done/       closed
 *   tickets/_config.json
 *
 * IDs are plain integers — a ticket has a number, nothing else. Phase, kind, area
 * and every other classification is a tag. Filenames are <zero-padded id>-<slug>.md.
 *
 * Schema and CLI are English. Prose inside a ticket body is whatever language the
 * project speaks; `priorities` / `statuses` vocabularies are configurable per project.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------- config

const NA = 'N/A';

const DEFAULT_CONFIG = {
  name: 'Tickets',
  title: 'Ticket status',
  lang: 'en',
  idPad: 3,
  priorities: ['high', 'medium', 'low'],
  statuses: ['open', 'in-progress', 'waiting', 'closed'],
  fields: [
    'id', 'title', 'tags', 'priority', 'requester', 'assignee',
    'created', 'closed', 'status', 'related',
  ],
  // Optional: declare known tags to catch typos. Empty = anything goes.
  knownTags: [],
  // Optional: display names for tags in the report.
  tagLabels: {},
  // Heading used for the stub section in a new ticket body.
  bodySection: 'Description',
  people: { internal: [], internalLabel: 'Internal', aliases: {} },
  report: { file: 'tickets.html', windowDays: 14 },
};

/**
 * A directory is a ticket root only if it looks like one: a _config.json or a done/
 * subdir. Matching on the name alone would happily adopt any unrelated "tickets" folder.
 */
function isRoot(dir) {
  return fs.existsSync(path.join(dir, '_config.json')) || fs.existsSync(path.join(dir, 'done'));
}

function findRoot(start) {
  let dir = path.resolve(start);
  for (;;) {
    if (isRoot(dir) && (path.basename(dir) === 'tickets' || fs.existsSync(path.join(dir, '_config.json')))) return dir;
    const sub = path.join(dir, 'tickets');
    if (fs.existsSync(sub) && isRoot(sub)) return sub;
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  die('no ticket root found (need a tickets/ dir with _config.json or done/, searched upward from ' + start + ')');
}

function loadConfig(root) {
  const file = path.join(root, '_config.json');
  let user = {};
  if (fs.existsSync(file)) {
    try { user = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (e) { die('invalid _config.json: ' + e.message); }
  }
  const cfg = Object.assign({}, DEFAULT_CONFIG, user);
  cfg.people = Object.assign({}, DEFAULT_CONFIG.people, user.people || {});
  cfg.report = Object.assign({}, DEFAULT_CONFIG.report, user.report || {});
  cfg.root = root;
  cfg.doneDir = path.join(root, 'done');
  cfg.CLOSED = cfg.statuses[cfg.statuses.length - 1];   // last status = the closed one
  cfg.OPEN = cfg.statuses[0];
  return cfg;
}

// ---------------------------------------------------------------- frontmatter

/** Minimal frontmatter reader — flat scalars plus [] lists. */
function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return { fm: null, body: text };
  const fm = {};
  const order = [];
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(line);
    if (!kv) continue;
    let val = kv[2].trim();
    if (/^\[.*\]$/.test(val)) {
      val = val.slice(1, -1).split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    } else {
      val = val.replace(/^["']|["']$/g, '');
    }
    fm[kv[1]] = val;
    order.push(kv[1]);
  }
  Object.defineProperty(fm, '__order', { value: order, enumerable: false });
  return { fm, body: m[2] };
}

const LIST_FIELDS = new Set(['tags', 'related']);

function serializeFrontmatter(fm, fieldOrder) {
  const keys = [];
  for (const k of fieldOrder) if (k in fm) keys.push(k);
  for (const k of (fm.__order || Object.keys(fm))) if (!keys.includes(k)) keys.push(k);
  const lines = keys.map(k => {
    const v = fm[k];
    if (Array.isArray(v) || LIST_FIELDS.has(k)) return `${k}: [${(Array.isArray(v) ? v : []).join(', ')}]`;
    return `${k}: ${v === undefined || v === '' ? NA : v}`;
  });
  return '---\n' + lines.join('\n') + '\n---\n';
}

// ---------------------------------------------------------------- load

function listFiles(cfg) {
  const out = [];
  const scan = (dir, done) => {
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.md') || f.startsWith('_')) continue;
      out.push({ file: path.join(dir, f), done });
    }
  };
  scan(cfg.root, false);
  scan(cfg.doneDir, true);
  return out;
}

/** `done` = the file lives in done/. Distinct from fm.status, which validate cross-checks. */
function loadAll(cfg) {
  return listFiles(cfg).map(({ file, done }) => {
    const { fm, body } = parseFrontmatter(fs.readFileSync(file, 'utf8'));
    // No frontmatter, or frontmatter without an id: not a ticket. Reported by validate.
    if (!fm || fm.id == null) return { file, done, fm: null, body, id: 0 };
    fm.id = parseId(fm.id);
    if (!Array.isArray(fm.tags)) fm.tags = fm.tags ? [String(fm.tags)] : [];
    const rel = Array.isArray(fm.related) ? fm.related : fm.related ? [fm.related] : [];
    fm.related = rel.map(parseId).filter(Boolean).sort((a, b) => a - b);
    return { file, done, fm, body, id: fm.id };
  });
}

/** Accepts 7, "007", "#7" and legacy prefixed forms like "POST-118" — the digits win. */
function parseId(raw) {
  const m = /(\d+)\s*$/.exec(String(raw).trim());
  return m ? parseInt(m[1], 10) : 0;
}

function byId(all, id) {
  const want = parseId(id);
  return want ? all.find(t => t.id === want) : undefined;
}

// ---------------------------------------------------------------- helpers

function die(msg) { process.stderr.write('tk: ' + msg + '\n'); process.exit(1); }
function today() { return new Date().toISOString().slice(0, 10); }

function slugify(s) {
  return String(s).toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

function normTag(t) { return String(t).trim().toLowerCase().replace(/\s+/g, '-'); }

function parseTags(v) {
  if (!v || v === true) return [];
  return String(v).split(',').map(normTag).filter(Boolean);
}

function parseIds(v) {
  if (!v || v === true) return [];
  return String(v).split(',').map(parseId).filter(Boolean);
}

function canonPerson(cfg, raw) {
  if (!raw || raw === NA) return NA;
  const aliases = cfg.people.aliases || {};
  return String(raw).split(',').map(p => {
    const t = p.trim();
    return aliases[t] || t;
  }).filter(Boolean).join(', ');
}

function isInternal(cfg, who) {
  const list = cfg.people.internal || [];
  if (!who || who === NA) return false;
  return String(who).split(',').every(p => list.includes(p.trim()));
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** "N/A" must never compare greater than a real date — gate on the format first. */
function closedSince(t, since) {
  return ISO_DATE.test(t.fm.closed) && t.fm.closed >= since;
}

function prioRank(cfg, p) {
  const i = (cfg.priorities || []).indexOf(p);
  return i === -1 ? 99 : i;
}

/** open tickets: priority asc, then created desc, then id desc */
function sortOpen(cfg, tickets) {
  return tickets.slice().sort((a, b) => {
    const pr = prioRank(cfg, a.fm.priority) - prioRank(cfg, b.fm.priority);
    if (pr) return pr;
    const da = a.fm.created, db = b.fm.created;
    const va = ISO_DATE.test(da), vb = ISO_DATE.test(db);
    if (va && vb && da !== db) return db.localeCompare(da);
    if (va !== vb) return va ? -1 : 1;
    return b.id - a.id;
  });
}

function writeTicket(t, cfg) {
  fs.writeFileSync(t.file, serializeFrontmatter(t.fm, cfg.fields) + t.body);
}

/** Zero-padded so filenames sort the same way the numbers do. */
function pad(cfg, id) {
  return String(id).padStart(cfg.idPad || 3, '0');
}

/** Filenames are <padded id>-<slug>.md; the slug is free text, only the number is enforced. */
function filenameOk(cfg, t) {
  return path.basename(t.file).startsWith(pad(cfg, t.id) + '-');
}

function renameToTitle(cfg, t) {
  const want = path.join(path.dirname(t.file), `${pad(cfg, t.id)}-${slugify(t.fm.title)}.md`);
  if (want !== t.file) { fs.renameSync(t.file, want); t.file = want; }
}

function args(argv) {
  const pos = [], flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) flags[a.slice(2, eq)] = a.slice(eq + 1);
      else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) flags[a.slice(2)] = argv[++i];
      else flags[a.slice(2)] = true;
    } else pos.push(a);
  }
  return { pos, flags };
}

/** --tag a,b matches tickets carrying ALL of a and b; --any-tag a,b matches either. */
function tagFilter(ts, flags) {
  const has = (t, w) => t.fm.tags.map(normTag).includes(w);
  if (flags.tag) {
    const want = parseTags(flags.tag);
    ts = ts.filter(t => want.every(w => has(t, w)));
  }
  if (flags['any-tag']) {
    const want = parseTags(flags['any-tag']);
    ts = ts.filter(t => want.some(w => has(t, w)));
  }
  if (flags['no-tag']) {
    const want = parseTags(flags['no-tag']);
    ts = ts.filter(t => !want.some(w => has(t, w)));
  }
  return ts;
}

// ---------------------------------------------------------------- commands

const cmds = {};

cmds.list = (cfg, all, { flags }) => {
  let ts = all.filter(t => t.fm);
  const scope = flags.all ? 'all' : flags.done ? 'done' : 'open';
  if (scope === 'open') ts = ts.filter(t => !t.done);
  if (scope === 'done') ts = ts.filter(t => t.done);
  ts = tagFilter(ts, flags);
  if (flags.priority) ts = ts.filter(t => t.fm.priority === flags.priority);
  if (flags.status) ts = ts.filter(t => t.fm.status === flags.status);
  if (flags.since) ts = ts.filter(t => closedSince(t, flags.since));
  if (flags.grep) {
    const re = new RegExp(flags.grep, 'i');
    ts = ts.filter(t => re.test(t.fm.title) || re.test(t.body));
  }

  ts = scope === 'done'
    ? ts.sort((a, b) => String(b.fm.closed).localeCompare(String(a.fm.closed)) || b.id - a.id)
    : sortOpen(cfg, ts);

  if (flags.json) {
    console.log(JSON.stringify(ts.map(t => Object.assign({}, t.fm, {
      file: path.relative(cfg.root, t.file), done: t.done, body: flags.body ? t.body : undefined,
    })), null, 2));
    return;
  }
  for (const t of ts) {
    const st = t.fm.status !== cfg.OPEN && t.fm.status !== cfg.CLOSED ? ` [${t.fm.status}]` : '';
    console.log(`${String(t.id).padStart(4)}  ${String(t.fm.priority).padEnd(7)} ${t.fm.tags.join(',').padEnd(14)} ${String(t.fm.created).padEnd(11)} ${t.fm.title}${st}`);
  }
  if (!flags.quiet) console.error(`— ${ts.length} ticket${ts.length === 1 ? '' : 's'}`);
};

cmds.show = (cfg, all, { pos }) => {
  if (!pos[0]) die('usage: tk show <id>');
  const t = byId(all, pos[0]);
  if (!t) die('ticket not found: ' + pos[0]);
  process.stdout.write(fs.readFileSync(t.file, 'utf8'));
};

cmds.tags = (cfg, all, { flags }) => {
  const counts = new Map();
  for (const t of all.filter(t => t.fm && (flags.all || !t.done)))
    for (const g of t.fm.tags.map(normTag)) counts.set(g, (counts.get(g) || 0) + 1);
  const rows = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (flags.json) return void console.log(JSON.stringify(Object.fromEntries(rows), null, 2));
  for (const [g, n] of rows) console.log(`${String(n).padStart(4)}  ${g}`);
};

function nextId(all) {
  return all.reduce((m, t) => Math.max(m, t.id), 0) + 1;
}

cmds['next-id'] = (cfg, all) => { console.log(nextId(all)); };

cmds.new = (cfg, all, { pos, flags }) => {
  const title = flags.title || pos.join(' ') || die('usage: tk new --title "..." [--tags a,b]');
  const id = flags.id ? parseId(flags.id) : nextId(all);
  if (byId(all, id)) die('id already exists: ' + id);

  const tags = parseTags(flags.tags || flags.tag);
  if (cfg.knownTags.length) {
    const unknown = tags.filter(g => !cfg.knownTags.map(normTag).includes(g));
    if (unknown.length && !flags.force)
      die(`unknown tag(s): ${unknown.join(', ')} — known: ${cfg.knownTags.join(', ')} (use --force to add anyway)`);
  }
  const related = parseIds(flags.related);

  const fm = {
    id,
    title,
    tags,
    priority: flags.priority || cfg.priorities[Math.floor(cfg.priorities.length / 2)],
    requester: canonPerson(cfg, flags.requester || NA),
    assignee: canonPerson(cfg, flags.assignee || NA),
    created: flags.date || today(),
    closed: NA,
    status: flags.status || cfg.OPEN,
    related,
  };
  if (!cfg.priorities.includes(fm.priority)) die(`unknown priority "${fm.priority}" — known: ${cfg.priorities.join(', ')}`);
  if (!cfg.statuses.includes(fm.status)) die(`unknown status "${fm.status}" — known: ${cfg.statuses.join(', ')}`);

  const file = path.join(cfg.root, `${pad(cfg, id)}-${slugify(title)}.md`);
  if (fs.existsSync(file)) die('file already exists: ' + file);
  const body = `\n# ${id} — ${title}\n\n## ${cfg.bodySection}\n\n${flags.body || 'TODO'}\n`;
  fs.mkdirSync(cfg.root, { recursive: true });
  fs.writeFileSync(file, serializeFrontmatter(fm, cfg.fields) + body);

  for (const other of related) addLink(cfg, all, other, id);
  console.log(path.relative(process.cwd(), file));
};

function addLink(cfg, all, targetId, newId) {
  const t = byId(all, targetId);
  if (!t || !t.fm) return false;
  if (t.fm.related.includes(newId)) return false;
  t.fm.related = t.fm.related.concat(newId).sort((a, b) => a - b);
  writeTicket(t, cfg);
  return true;
}

cmds.link = (cfg, all, { pos }) => {
  const [a, b] = pos;
  if (!a || !b) die('usage: tk link <id-a> <id-b>');
  const ta = byId(all, a), tb = byId(all, b);
  if (!ta) die('not found: ' + a);
  if (!tb) die('not found: ' + b);
  addLink(cfg, all, ta.id, tb.id);
  addLink(cfg, all, tb.id, ta.id);
  console.log(`${ta.id} <-> ${tb.id}`);
};

cmds.tag = (cfg, all, { pos, flags }) => {
  if (!pos[0]) die('usage: tk tag <id> <tag>[,<tag>] [--remove]');
  const t = byId(all, pos[0]);
  if (!t) die('not found: ' + pos[0]);
  const want = parseTags(pos.slice(1).join(','));
  if (!want.length) die('no tags given');
  const cur = t.fm.tags.map(normTag);
  t.fm.tags = flags.remove
    ? cur.filter(g => !want.includes(g))
    : cur.concat(want.filter(g => !cur.includes(g)));
  writeTicket(t, cfg);
  console.log(`${t.id} tags: [${t.fm.tags.join(', ')}]`);
};

cmds.close = (cfg, all, { pos, flags }) => {
  if (!pos.length) die('usage: tk close <id>... [--date YYYY-MM-DD]');
  for (const id of pos) {
    const t = byId(all, id);
    if (!t) die('not found: ' + id);
    t.fm.status = cfg.CLOSED;
    t.fm.closed = flags.date || today();
    writeTicket(t, cfg);
    if (!t.done) {
      fs.mkdirSync(cfg.doneDir, { recursive: true });
      const dest = path.join(cfg.doneDir, path.basename(t.file));
      fs.renameSync(t.file, dest);
      t.file = dest; t.done = true;
    }
    console.log(`${t.id} closed ${t.fm.closed}`);
  }
};

cmds.reopen = (cfg, all, { pos, flags }) => {
  if (!pos.length) die('usage: tk reopen <id>... [--status S]');
  for (const id of pos) {
    const t = byId(all, id);
    if (!t) die('not found: ' + id);
    t.fm.status = flags.status || cfg.OPEN;
    t.fm.closed = NA;
    writeTicket(t, cfg);
    if (t.done) {
      const dest = path.join(cfg.root, path.basename(t.file));
      fs.renameSync(t.file, dest);
      t.file = dest; t.done = false;
    }
    console.log(`${t.id} reopened (${t.fm.status})`);
  }
};

cmds.set = (cfg, all, { pos, flags }) => {
  if (!pos[0]) die('usage: tk set <id> field=value ...');
  const t = byId(all, pos[0]);
  if (!t) die('not found: ' + pos[0]);
  for (const kv of pos.slice(1)) {
    const i = kv.indexOf('=');
    if (i === -1) die('bad assignment: ' + kv);
    const k = kv.slice(0, i), v = kv.slice(i + 1);
    if (k === 'tags') t.fm.tags = parseTags(v);
    else if (k === 'related') t.fm.related = parseIds(v);
    else if (k === 'requester' || k === 'assignee') t.fm[k] = canonPerson(cfg, v);
    else t.fm[k] = v;
  }
  writeTicket(t, cfg);
  if (flags.rename) renameToTitle(cfg, t);
  console.log(`${t.id} updated`);
};

/**
 * Two severities. `error` = the file breaks the schema and tooling can misread it.
 * `warn` = incomplete data (typically legacy tickets); shown with --warn, never fails.
 */
cmds.validate = (cfg, all, { flags }) => {
  const fix = !!flags.fix;
  const errors = [], warns = [];
  const seen = new Map();
  const ids = new Set(all.filter(t => t.fm).map(t => t.id));
  const known = cfg.knownTags.map(normTag);

  for (const t of all) {
    const rel = path.relative(cfg.root, t.file);
    const err = m => errors.push([rel, m]);
    const warn = m => warns.push([rel, m]);
    if (!t.fm) { err('not a ticket: no frontmatter, or frontmatter without an id'); continue; }

    for (const f of cfg.fields) if (!(f in t.fm)) err(`missing field: ${f}`);
    for (const k of Object.keys(t.fm)) if (!cfg.fields.includes(k)) err(`unknown field: ${k}`);

    if (seen.has(t.id)) err(`duplicate id ${t.id} (also ${path.relative(cfg.root, seen.get(t.id))})`);
    else seen.set(t.id, t.file);

    if (!filenameOk(cfg, t)) {
      err(`filename must start with "${pad(cfg, t.id)}-"${fix ? ' [fixed]' : ''}`);
      if (fix) renameToTitle(cfg, t);
    }

    for (const g of t.fm.tags) {
      if (normTag(g) !== g) err(`tag "${g}" not normalized → "${normTag(g)}"${fix ? ' [fixed]' : ''}`);
      if (known.length && !known.includes(normTag(g))) warn(`unknown tag: ${g}`);
    }
    if (!t.fm.tags.length) warn('no tags');
    if (fix) {
      const norm = [...new Set(t.fm.tags.map(normTag))];
      if (norm.join() !== t.fm.tags.join()) { t.fm.tags = norm; writeTicket(t, cfg); }
    }

    if (!cfg.priorities.includes(t.fm.priority)) err(`unknown priority: ${t.fm.priority}`);
    if (!cfg.statuses.includes(t.fm.status)) err(`unknown status: ${t.fm.status}`);

    if (t.done !== (t.fm.status === cfg.CLOSED))
      err(`status "${t.fm.status}" inconsistent with ${t.done ? 'done/' : 'open'} directory`);
    if (t.fm.status !== cfg.CLOSED && t.fm.closed !== NA)
      err('open ticket with a closing date');
    if (!ISO_DATE.test(t.fm.created) && t.fm.created !== NA)
      err(`bad created date: ${t.fm.created}`);
    if (ISO_DATE.test(t.fm.created) && ISO_DATE.test(t.fm.closed) && t.fm.closed < t.fm.created)
      err('closed before created');

    if (t.fm.status === cfg.CLOSED && t.fm.closed === NA) warn('closed without a closing date');
    if (t.fm.created === NA) warn('no created date');

    for (const who of ['requester', 'assignee']) {
      const canon = canonPerson(cfg, t.fm[who]);
      if (canon !== t.fm[who]) {
        err(`${who} "${t.fm[who]}" → "${canon}"${fix ? ' [fixed]' : ''}`);
        if (fix) { t.fm[who] = canon; writeTicket(t, cfg); }
      }
    }

    for (const l of t.fm.related) {
      if (!ids.has(l)) { err(`related to unknown ticket: ${l}`); continue; }
      const other = byId(all, l);
      if (!other.fm.related.includes(t.id)) {
        err(`relation ${t.id}→${l} not reciprocated${fix ? ' [fixed]' : ''}`);
        if (fix) addLink(cfg, all, l, t.id);
      }
    }
  }
  for (const [file, msg] of errors) console.log(`ERROR ${file}: ${msg}`);
  if (flags.warn || flags.all) for (const [file, msg] of warns) console.log(`warn  ${file}: ${msg}`);
  console.error(`— ${errors.length} error, ${warns.length} warning${flags.warn || flags.all ? '' : ' (--warn to list)'}`);
  if (errors.length && !fix) process.exitCode = 1;
};

cmds.stats = (cfg, all, { flags }) => {
  const days = parseInt(flags.window || cfg.report.windowDays, 10);
  const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  const open = all.filter(t => t.fm && !t.done);
  const done = all.filter(t => t.fm && t.done);
  const out = {
    open: open.length,
    by_priority: {},
    by_status: {},
    by_tag: {},
    closed_in_window: done.filter(t => closedSince(t, since)).length,
    closed_total: done.length,
    window_from: since,
    window_to: today(),
  };
  for (const t of open) {
    out.by_priority[t.fm.priority] = (out.by_priority[t.fm.priority] || 0) + 1;
    out.by_status[t.fm.status] = (out.by_status[t.fm.status] || 0) + 1;
    for (const g of t.fm.tags) out.by_tag[g] = (out.by_tag[g] || 0) + 1;
  }
  console.log(JSON.stringify(out, null, 2));
};

/** Everything the HTML report needs, in one JSON bundle. */
cmds['report-data'] = (cfg, all, { flags }) => {
  const days = parseInt(flags.window || cfg.report.windowDays, 10);
  const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  let pool = tagFilter(all.filter(t => t.fm), flags);
  const pub = t => ({
    id: t.id,
    title: t.fm.title,
    tags: t.fm.tags,
    priority: t.fm.priority,
    status: t.fm.status,
    requester: isInternal(cfg, t.fm.requester) ? cfg.people.internalLabel : t.fm.requester,
    created: t.fm.created,
    closed: t.fm.closed,
    file: path.relative(cfg.root, t.file),
    body: t.body.trim(),
  });
  const open = sortOpen(cfg, pool.filter(t => !t.done));
  const recent = pool.filter(t => t.done && closedSince(t, since))
    .sort((a, b) => b.fm.closed.localeCompare(a.fm.closed) || b.id - a.id);
  const TOP = cfg.priorities[0];
  console.log(JSON.stringify({
    config: { name: cfg.name, title: cfg.title, lang: cfg.lang, tagLabels: cfg.tagLabels, report: cfg.report },
    generated: today(),
    window: { from: since, to: today(), days },
    counts: {
      open: open.length,
      top_priority: open.filter(t => t.fm.priority === TOP).length,
      by_status: open.reduce((a, t) => (a[t.fm.status] = (a[t.fm.status] || 0) + 1, a), {}),
      closed_in_window: recent.length,
      closed_total: pool.filter(t => t.done).length,
    },
    top: open.filter(t => t.fm.priority === TOP).map(pub),
    rest: open.filter(t => t.fm.priority !== TOP).map(pub),
    closed: recent.map(pub),
  }, null, 2));
};

cmds.help = () => {
  process.stdout.write(`tk — file-based ticket manager (a ticket is just a ticket; everything else is a tag)

  tk list [--open|--done|--all] [--tag a,b] [--any-tag a,b] [--no-tag a]
          [--priority P] [--status S] [--since YYYY-MM-DD] [--grep RE] [--json] [--body]
  tk show <id>
  tk tags [--all] [--json]                 # tag census with counts
  tk next-id
  tk new --title "..." [--tags a,b] [--priority P] [--requester N] [--assignee N]
         [--date YYYY-MM-DD] [--status S] [--related 1,2] [--id N] [--body "..."]
  tk tag <id> <tag>[,<tag>] [--remove]
  tk set <id> field=value ... [--rename]   # --rename syncs the filename to the title
  tk close <id>... [--date YYYY-MM-DD]     # stamps the date, moves to done/
  tk reopen <id>... [--status S]
  tk link <id-a> <id-b>                    # bidirectional
  tk validate [--warn] [--fix]             # schema, filenames, dates, aliases, tags, relations
  tk stats [--window N]
  tk report-data [--window N] [--tag a,b]  # JSON bundle for the HTML report

Fields: id, title, tags, priority, requester, assignee, created, closed, status, related.
Config: <tickets>/_config.json — see references/config.example.json.
Root auto-detected upward from --root or cwd.
`);
};

// ---------------------------------------------------------------- main

function main() {
  const parsed = args(process.argv.slice(2));
  const cmd = parsed.pos.shift() || 'help';
  if (cmd === 'help' || parsed.flags.help) return cmds.help();
  if (!cmds[cmd]) die(`unknown command "${cmd}" (tk help)`);
  const root = findRoot(parsed.flags.root || process.cwd());
  const cfg = loadConfig(root);
  cmds[cmd](cfg, loadAll(cfg), parsed);
}

main();
