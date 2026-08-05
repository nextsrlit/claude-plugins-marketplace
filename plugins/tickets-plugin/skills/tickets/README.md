# tickets

A [Claude Code](https://claude.com/claude-code) skill that turns a folder of markdown files into
a working ticket tracker — versionable alongside the project it belongs to, in any repo, any
language.

A ticket is just a ticket. Its identity is a **plain number** — no prefix, no series, no letter
codes. Phase, kind and area are `tags`, free strings the tooling never interprets. Per-project
vocabulary (priorities, statuses, known tags, people, report target) lives in
`tickets/_config.json`.

## Layout

```
<project>/tickets/
├── _config.json       # per-project config (optional)
├── 163-<slug>.md      # open tickets
└── done/
    └── 162-<slug>.md  # closed tickets
```

Each ticket is YAML frontmatter (`id`, `title`, `tags`, `priority`, `requester`, `assignee`,
`created`, `closed`, `status`, `related`) followed by free markdown — analysis, SQL, tables,
timelines, checklists. The ticket file is the record; the conversation is not.

## The `tk` CLI

```bash
SK="${CLAUDE_PLUGIN_ROOT:-$HOME/.claude}/skills/tickets"
TK="$SK/scripts/tk.js"

node $TK list                       # open, sorted priority → date desc
node $TK list --tag mp,post --json
node $TK list --done --since 2026-07-17
node $TK show 163
node $TK tags                       # tag census with counts

node $TK new --title "..." --tags mp,post --requester "Jane Doe" --priority high
node $TK set 163 priority=medium status=waiting
node $TK tag 163 kanban             # --remove to drop
node $TK link 163 157               # bidirectional
node $TK close 163                  # stamps date, moves to done/
node $TK reopen 163

node $TK validate [--warn|--fix]
node $TK stats
node $TK report-data                # JSON input for the report
```

`tk` finds `tickets/` by walking up from the cwd; `--root <dir>` overrides.

## Reports

Two steps on purpose — the numbers are computed, the prose is written:

1. `node $TK report-data > data.json` — counts, sorted open list, tickets closed in the window,
   plus each ticket's raw body.
2. Build a render-input JSON (shape in `references/report-input.example.json`) with one
   client-facing paragraph per ticket, then:

```bash
node "$SK/scripts/render-report.js" input.json > report.html
```

The output is a single self-contained HTML file. If `_config.json` sets `report.host`, the skill
scp's it to the shared URL, always reusing the same filename.

Client-facing prose strips server paths, DB identifiers and internal service names, keeps business
identifiers (article codes, SSCC, delivery numbers), anonymizes internal requesters via
`people.internal`, and states facts without speculating about causes.

## Requirements

`node` on PATH. Nothing else — no dependencies, no install step. `scp`/`ssh` only if you publish
reports to a host.

## Bootstrapping a project

```bash
mkdir -p tickets/done
cp "$SK/references/config.example.json" tickets/_config.json
$EDITOR tickets/_config.json
```

## License

MIT — see `LICENSE`.
