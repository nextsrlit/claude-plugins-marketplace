# commit-report

A [Claude Code](https://claude.com/claude-code) / Claude skill that turns your git history into
a polished, self-contained HTML dashboard.

Point it at one or more repositories and a date range, and it produces:

- **Per-contributor statistics** — commit count and lines added/removed, per repo and total.
- **Per-repo commit detail** — every commit with author, message, file count and clickable
  links back to the commit on GitHub/GitLab.
- **Code-quality review** — each commit's diff is graded ✅ / 🟡 / 🟠 / 🔴. When a repo ships a
  `CLAUDE.md` or `AGENTS.md`, it's reviewed against *those* rules (🛡️ guidelines mode); otherwise
  it falls back to general best practices for the detected stack, using the model's knowledge and
  occasional web lookups (🌐 generic mode). Each report states which mode it used. Turn the review
  off per-repo (`"qualityReview": false`) or by asking for "stats only".

Everything is rendered as a single self-contained HTML file (inline CSS, vanilla JS, inline SVG
charts — no CDN, no external assets) and published through the Artifact tool.

## Install

Copy the `commit-report/` folder into your skills directory:

```bash
# Claude Code (user-level skills)
cp -r commit-report ~/.claude/skills/

# or a project-level skill
cp -r commit-report /path/to/project/.claude/skills/
```

The skill is then available to Claude automatically.

## Requirements

The skill is pure instructions — no install step, no runtime of its own. It only leans on tools
the host already has:

| Tool | When needed |
|---|---|
| **`git`** (CLI) | Optional but recommended — required to read commit history from local repos and to shallow-clone remote ones. Without it, only the (more limited) host fallbacks apply. |
| Network access | Only to analyze a **remote** repo (the shallow clone) or for the occasional `mgrep --web` lookup in generic quality mode. |
| `gh` / SSH key / token | Only to clone **private** remote repos. |

## Usage

Just ask, in natural language:

- `commit report` — yesterday, current repo
- `commit report for this week`
- `daily commit report for alice`
- `how many commits last week across frontend and backend`
- `commit report from 2026-06-20 to 2026-06-23`
- `commit report for https://github.com/owner/repo this week` — analyze a remote repo

### Analyzing a remote repo (no local clone needed)

Pass a repo URL (`https://github.com/owner/repo`, `git@github.com:owner/repo.git`, GitLab, etc.)
and the skill **shallow-clones it to a temp folder**, runs the full report (stats *and* quality
review), then deletes the clone. You don't have to be inside a git folder. Private repos work only
if credentials are already set up (`gh auth login`, an SSH key, or a token). Bounding the request
to a date range keeps even huge repos fast.

### Repo resolution

The skill is zero-setup. It figures out which repos to analyze in this order:

1. **A repo URL in your message** → shallow-cloned to a temp folder and analyzed (see above).
2. **`commit-report.config.json`** in the current directory, if present.
3. Otherwise, if you're inside a git repo, it uses the **current repository** and tells you so.
4. Otherwise, if the current directory contains several git repos as subfolders, it proposes
   the list and asks you to confirm.
5. Otherwise, it asks you for the repo paths.

### Configuration (optional)

For multi-repo reports or custom behavior, drop a `commit-report.config.json` next to where you
run the skill. See [`config.example.json`](./config.example.json). All fields are optional:

| Field | Purpose | Default |
|---|---|---|
| `repos[].path` | Repo location | — |
| `repos[].name` | Display name | folder basename |
| `repos[].commitUrlTemplate` | Commit link, with `{hash}` | derived from `origin` remote |
| `repos[].guidelines` | Best-practices files for the quality review | auto-detect `CLAUDE.md` / `AGENTS.md` |
| `publish` | Extra destination (SCP/rsync) on top of the Artifact | Artifact only |

### Date ranges

`yesterday` (default) · a specific date · `this week` · `last week` · `last N days` ·
explicit `from … to …` ranges. The HTML output matches the language of your request.

### Publishing elsewhere

By default the report lives only as an Artifact. Ask the skill to "also save it to
`/some/path`" or to SCP it to a host, and it will — or configure a persistent `publish` block.

## What the quality review checks

Two modes, picked automatically per repo:

- **🛡️ Guidelines mode** — when a `CLAUDE.md` / `AGENTS.md` exists, the review is driven *entirely*
  by it and imposes no external conventions. If your doc forbids a library or pattern, or mandates a
  commit-message format, commits that break those rules are flagged.
- **🌐 Generic mode** — with no such file, commits are reviewed against widely-accepted best
  practices for the detected stack (correctness, security, error handling, naming, tests, commit
  hygiene), using the model's knowledge plus occasional `mgrep --web` lookups for fast-moving
  ecosystems. Grades are badged as generic so they aren't mistaken for repo-endorsed rules.

Set `"qualityReview": false` on a repo, or ask for "stats only", to skip the review entirely.

## Bots & merges

Merge commits (`--no-merges`) and bot authors (emails containing `bot` or `noreply`, e.g.
`dependabot`, `github-actions[bot]`) are excluded from both the stats and the review.

## Credits

Created by [Francesco Strappini](https://www.linkedin.com/in/fstraps/) at
[Next](https://mynext.it).

## License

[MIT](./LICENSE) © Next S.r.l. unipersonale
