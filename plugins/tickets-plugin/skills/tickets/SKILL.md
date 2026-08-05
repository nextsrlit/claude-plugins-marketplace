---
name: tickets
description: "File-based ticket management — markdown tickets with YAML frontmatter in tickets/, closed ones in tickets/done/. Use when the user asks about tickets: open tickets, ticket status, create/close/link a ticket, ticket report or client status page, or refers to a ticket by number. A ticket is just a ticket, identified by a number; phase, kind and area are tags."
trigger: /tickets
---

# tickets

Lightweight ticket tracker made of plain markdown files, one per ticket, versionable
alongside the project it belongs to. Works in any repo, any client, any language.

**A ticket is just a ticket.** Its identity is a **plain number** — no prefix, no series,
no letter codes. There is no notion of "area", "subsystem", "kind" or "phase" in the
schema: all of that is `tags`, free strings the tooling never interprets. Per-project
vocabulary lives in `_config.json`, not in this skill.

When a project has historically used prefixed IDs (`POST-118`, `BUG-004`), the prefix was
always a phase or a category — migrate it to a tag and keep the number.

## Layout

```
<project>/tickets/
├── _config.json                 # per-project config (optional but recommended)
├── 163-<slug>.md                # open / in-corso / in-attesa (id zero-padded to idPad)
└── done/
    └── 162-<slug>.md            # chiusi
```

## Ticket file

```markdown
---
id: 163
title: Inbound 0160238810 — colli confermati a SAP ma senza giacenza
tags: [post, mp]
priority: high
requester: Ermes Iuliano
assignee: N/A
created: 2026-07-30
closed: N/A
status: open
related: [152, 157]
---

# 163 — Inbound 0160238810: colli confermati a SAP ma senza giacenza

## Description
...free markdown: analysis, SQL, tables, timelines, to-do checklists...
```

**The schema is English; the prose is not.** Field names, vocabularies and CLI flags are
always English, whatever language the project speaks. Titles, bodies and report text are
written in the project's language — for an Italian client, an Italian body under an
English `title:` key is exactly right.

- `id` — a plain integer, unique across open and closed. `tk` allocates it as `max + 1`;
  never invent one. Filenames zero-pad it (`idPad`, default 3) so they sort numerically.
- `tags` — lowercase, `-` for spaces. Anything: `mp`, `pf`, `bug`, `backend`, `quot`.
- `priority` — from `priorities` in `_config.json`; **first entry is the most urgent**.
- `status` — from `statuses`; **first is the open state, last is the closed one**.
- `created` / `closed` — ISO dates, or `N/A`. Unset values are the literal `N/A`, never empty.
- `related` is **bidirectional** — always link both ways (`tk link` does it).
- The body heading for a new ticket comes from `bodySection` (default `Description`).

## The `tk` CLI

Always use it instead of hand-editing frontmatter or eyeballing `ls` for the next ID.

```bash
SK="${CLAUDE_PLUGIN_ROOT:-$HOME/.claude}/skills/tickets"   # plugin install, or standalone skill
TK="$SK/scripts/tk.js"

node $TK list                                  # open, sorted priority → date desc
node $TK list --tag mp,post --json
node $TK list --done --since 2026-07-17
node $TK list --grep 'inbound' --all
node $TK show 163
node $TK tags                                  # tag census with counts

node $TK new --title "..." --tags mp,post --requester "Ermes Iuliano" --priority high
node $TK set 163 priority=medium status=waiting
node $TK tag 163 kanban                        # --remove to drop
node $TK link 163 157                          # both directions
node $TK close 163                             # stamps date, moves to done/
node $TK reopen 163

node $TK validate            # errors only, exit 1 if any
node $TK validate --warn     # + incomplete-data warnings
node $TK validate --fix      # normalize aliases/tags, reciprocate relations, fix filenames
node $TK stats
```

`tk` finds `tickets/` by walking up from the cwd; `--root <dir>` overrides.

## Workflows

### "quali sono i ticket aperti?"

`node $TK list`. Present as a bullet list in the user's language, priority high → low,
newest first within a priority. Flag any status that is neither open nor closed
(`waiting`, `in-progress`) explicitly. Do **not** dump the raw table.

**Refer to a ticket by its bare number** — `163`, or `#163` where a bare numeral would be
ambiguous. Never re-attach a phase or category prefix (`POST-163`): that information is a
tag, and repeating it in the identifier is exactly the coupling this schema removes.

### New ticket

Ask only for what is missing and cannot be inferred. Then `tk new`, then open the file
and write a real body — the CLI only scaffolds the frontmatter and a `## Segnalazione`
stub. Keep the analysis (queries run, findings, "Da fare" checklist) inside the file:
the ticket is the record, the conversation is not.

### Closing

`tk close <id>`. Before closing, make sure the body says **what was actually done** —
a closed ticket with no resolution note is worthless three months later.

### Report / client status page

Two steps, on purpose: the numbers are computed, the prose is written.

1. `node $TK report-data > /tmp/.../data.json` — counts, the open list already sorted,
   the tickets closed inside the window, and each ticket's raw body.
2. Read it and build a **render input JSON** (shape in
   `references/report-input.example.json`), writing one client-facing paragraph per
   ticket from its body. Then:
   ```bash
   node "$SK/scripts/render-report.js" input.json > report.html
   ```
3. Publish, if the project's `_config.json` has a `report.host`:
   ```bash
   scp report.html <host>:<path>/<file>
   ssh <host> chmod 644 <path>/<file>
   ```
   **Always reuse the same filename** — the URL has already been shared with the client.

Client-facing rules for the prose:
- strip server paths, DB table/column names, internal links, agent/service names
- keep business identifiers: article codes, SSCC, delivery numbers, movement codes
- tickets whose `requester` is in `people.internal` are shown as `people.internalLabel`
  (`tk report-data` already does this substitution)
- state facts, not blame; no speculation about causes unless it's been confirmed

## Config

`<project>/tickets/_config.json`, copied from `references/config.example.json`. Every
field is optional. What it controls:

| key | effect |
| --- | --- |
| `name`, `title`, `lang` | report headings |
| `idPad` | zero-padding width for filenames (default 3) |
| `priorities` | vocabulary **and sort order** (first = most urgent) |
| `statuses` | allowed `status` values (first = open, last = closed) |
| `bodySection` | heading of the stub section in a new ticket body |
| `knownTags` | typo guard; empty = anything allowed |
| `tagLabels` | display names for tags in the report |
| `people.internal` / `internalLabel` | who gets anonymized in client reports |
| `people.aliases` | `"Ermes" → "Ermes Iuliano"`, applied by `new`/`set`/`validate --fix` |
| `report.*` | output filename, scp host/path, public URL, window in days |

## Bootstrapping a new project

```bash
mkdir -p tickets/done
cp "$SK/references/config.example.json" tickets/_config.json
$EDITOR tickets/_config.json
```

Then add to the project's `CLAUDE.md` only what is genuinely project-specific: the
public report URL and any convention the config can't express. Everything else is here.

## Rules

- Never hand-write an ID — `tk new` / `tk next-id` allocate it.
- Never write a prefixed ID (`POST-163`) anywhere, in files or in replies. Numbers only.
- Never edit frontmatter by hand when a `tk` command exists for it.
- Run `tk validate` after any bulk change.
- Closed tickets live in `done/`; the closed `status` and the directory must agree.
- Never delete a ticket. Close it, or fix it.
