# claude-plugins-marketplace

Marketplace of plugins for [Claude Code](https://code.claude.com), published and maintained by Next.

## Installation

Add this marketplace once:

```
/plugin marketplace add nextsrlit/claude-plugins-marketplace
```

Then install only the plugin(s) you need — each is independent:

```
/plugin install diarize-call@next-plugins
```

```
/plugin install commit-report@next-plugins
```

```
/plugin install tickets@next-plugins
```

Restart the Claude Code session after installing for the new commands to load.

Same thing from a shell (non-interactive):

```
claude plugin marketplace add nextsrlit/claude-plugins-marketplace
claude plugin install diarize-call@next-plugins
```

## Available plugins

### `diarize-call`

Transcribes and diarizes recorded calls/meetings (OBS, Teams, Meet) or any audio/video file. Produces:

- speaker-diarized transcript
- identification of real participants by reading frames where Teams/Meet highlights who is speaking
- narrative summary of the call

Typical use: "transcribe this call", "summarize the meeting", "who said what in this video", "diarize this".

### `commit-report`

Extracts git commits from one or more repositories over a date range and produces:

1. per-contributor stats: commit count, lines added/removed per repo and total
2. code-quality review of each commit, checked against the repo's own best-practices file (CLAUDE.md/AGENTS.md) when present, otherwise against general best practices for the detected stack

The result is a self-contained HTML dashboard published via Artifact.

Typical use: "commit report", "yesterday's commits report", "commit stats", "commit quality report for [user]".

### `tickets`

File-based ticket tracker: one markdown file per ticket with YAML frontmatter, living in
`tickets/` inside the project it belongs to (closed ones in `tickets/done/`). Tickets are
identified by a plain number — phase, kind and area are just tags.

Ships a `tk` CLI (`list`, `show`, `new`, `set`, `tag`, `link`, `close`, `reopen`, `validate`,
`stats`, `report-data`) so IDs are always allocated and frontmatter is never hand-edited, plus a
renderer that turns ticket data into a self-contained client-facing HTML status page.

Typical use: "which tickets are open?", "open a ticket for this", "close 163", "ticket report for
the client".

## Development

Kept separate from the plugins installed in `~/.claude` — edit here, test with a local marketplace:

```
/plugin marketplace add ~/code/claude-plugins-marketplace
/plugin marketplace update
```

Push to this repo to make updates available to everyone.

## Structure

```
.claude-plugin/marketplace.json      # marketplace catalog
plugins/
  diarize-call-plugin/
    .claude-plugin/plugin.json
    skills/diarize-call/
  commit-report-plugin/
    .claude-plugin/plugin.json
    skills/commit-report/
  tickets-plugin/
    .claude-plugin/plugin.json
    skills/tickets/
```
