---
name: commit-report
description: >
  Extract git commits from one or more repositories over a date range and produce:
  1. Per-contributor statistics: commit count, lines added/removed per repo and total
  2. Code-quality review of each commit — against the repo's own best-practices file
     (CLAUDE.md / AGENTS.md) when present, otherwise against general best practices for the
     detected stack

  The result is rendered as a self-contained HTML dashboard published via the Artifact tool.

  Trigger: "commit report", "daily commit report", "commit stats", "daily commit report",
  "yesterday's commits report", "this week's commits report", "commit report for [user]",
  "code quality report", "commit quality report". Use this skill whenever the user asks to analyze commits or team
  contributions, even if they don't use the exact keywords.
---

# Commit Report Skill

Generate commit reports and code-quality analysis for any set of git repositories.
Output is a self-contained HTML dashboard published as an Artifact.

The skill is **config-driven but zero-setup**: it works out of the box on the current
repository and only needs a config file when you want to report across several repos at once
or customize behavior.

## Start here — run immediately

When this skill is invoked, **execute the full workflow below now**; do not wait for further
instructions. A bare invocation with no arguments (e.g. just `/commit-report`) is a complete
request: use the defaults — **previous day**, **all contributors**, repos resolved by Step 0 —
and proceed straight through Steps 0→6 to publish the Artifact. Only pause to ask the user if
Step 0 genuinely cannot resolve a repo (no config, not inside a git repo, no git subfolders).
Anything else stated in the message just overrides a default (date range, user filter, repos).

## Step 0 — Resolve which repos to analyze

Resolve the repo list in this order:

0. **Remote URL passed in the message.** If the user gives a repo URL or clone target
   (`https://github.com/...`, `git@github.com:...`, any `*.git`, or a GitLab/other host),
   shallow-clone it to the session scratchpad and analyze that working copy — no need to be inside
   a git folder. Use a blobless clone for speed, and bound it to the requested date range so even
   large histories stay cheap:
   ```bash
   git clone --filter=blob:none --no-checkout --shallow-since="YYYY-MM-DD" <url> {scratchpad}/<repo>
   ```
   Then `git -C {scratchpad}/<repo> checkout` the default branch so the worktree files exist
   (needed for guidelines mode to find `CLAUDE.md`/`AGENTS.md`). Derive the commit-URL template and
   the repo address directly from the passed URL. **Delete the clone** from the scratchpad when the
   report is done. Private repos need credentials already present (`gh auth`, SSH key, or token);
   if the clone fails for auth, tell the user rather than retrying blindly. Multiple URLs → clone
   each. The user can mix URLs and local paths.
1. **Config file.** If `commit-report.config.json` exists in the current working directory
   (or the user points to one), use it. See "Config schema" below.
2. **No config, inside a git repo.** If the cwd is itself a git repo, use the current folder
   as the single repo. **Notify the user** ("No config found — reporting on the current
   repository `<name>`.") and proceed without asking.
3. **No config, cwd contains multiple git repos as subfolders.** Scan immediate subdirectories
   for `.git`, propose the discovered list to the user, and ask them to confirm or edit before
   proceeding.
4. **Nothing found.** Ask the user for one or more repo paths.

For each repo, derive its display **name** (config value, else the folder basename) and its
**commit-URL template** (see "Commit links").

## Parameters to interpret from the message

**Date range** (default: previous day):
- "yesterday" / no date → yesterday 00:00–23:59
- a specific date → that day 00:00–23:59
- "this week" → current Monday → today
- "last week" → previous Monday → previous Sunday
- "last N days" → N days ago → yesterday
- explicit range (e.g. "from 2026-06-20 to 2026-06-23") → that interval

**User filter** (default: everyone):
- "for [name]" / "by [name]" / "user [email]" → filter by author

## Step 1 — Fetch remotes + extract git stats

Before logging, run `git fetch --all` on each repo to pull remote commits not yet present
locally. Without a fetch, `--all` only sees local refs and may miss other developers' commits:

```bash
git -C <path> fetch --all --quiet 2>&1 || true
```

Then run the log:

```bash
git -C <path> log --all --source --no-merges \
  --since="YYYY-MM-DD 00:00:00" \
  --until="YYYY-MM-DD 23:59:59" \
  --pretty=format:"%H|||%ae|||%an|||%s|||%S" \
  --numstat \
  [--author="<pattern>"]   # only if a user filter was requested
```

**Parse output**: lines alternate between `%H|||%ae|||%an|||%s|||%S` headers and numstat rows
(`+\t-\tfile`). Aggregate per author (use `%ae` as the key, `%an` as the display name).

**Branch**: `%S` (needs `--source`) gives the ref through which the commit was reached — strip
any `refs/heads/`, `refs/remotes/origin/`, or `origin/` prefix to get the short branch name
(e.g. `master`, `feature/x`). If it resolves to `HEAD` or is empty, fall back to
`git -C <path> branch --all --contains <hash> | head -1` (strip leading `*`/whitespace and
`remotes/origin/`). Keep this branch name attached to the commit for Step 3/4/6 display.

**Exclude merge commits** with `--no-merges` (already in the command above).

**Exclude bots**: discard any commit whose `%ae` contains `bot` or `noreply`
(e.g. `github-actions[bot]@users.noreply.github.com`, `dependabot[bot]@...`). These commits
appear neither in the table nor in the quality review.

**Normalize authors**: for real users (not bots) with `*@users.noreply.github.com` emails,
extract the username from the local part.

## Step 2 — Aggregate per contributor

Aggregate in memory (do not print a table): per author, commit count and +/− lines, per repo and
total. The dashboard computes totals, bars and sorting itself from the per-commit data, so what you
need at the end is simply one `people` entry per author and one `commits` entry per commit
(see Step 6).

People get a stable short `id` (initials, e.g. `FS`; disambiguate collisions with a digit), the
full display `name`, and a `short` form for chips and rows (`F. Strappini`; single-word names stay
as they are).

## Commit links

Every hash in the report must be a clickable link.

Resolve each repo's commit-URL template in this order:
1. `commitUrlTemplate` in config (a string containing `{hash}`), else
2. Auto-derive from the repo's `origin` remote:
   ```bash
   git -C <path> remote get-url origin
   ```
   - `git@github.com:org/repo.git` or `https://github.com/org/repo.git`
     → `https://github.com/org/repo/commit/{hash}`
   - GitLab → `https://<host>/org/repo/-/commit/{hash}`
   - Other gitweb/cgit hosts → `https://<host>/<repo>.git/commit/{hash}` (best effort)
3. If no remote can be resolved, omit `commitUrl`: the template renders hashes as plain text.

The repo **address** (`url`, linked from the page title) is the same template with the
`/commit/{hash}` (or `/-/commit/{hash}`) suffix stripped, e.g. `https://github.com/org/repo`. Its
**label** is `org/repo` when derivable, else the repo name.

Always pass the **full** 40-char hash (`h`); the template shows the first 8 chars and the
`⎇ branch` tag by itself.

## Step 3 — Commit-message convention

Check whether the repo's guidelines prescribe a commit-message prefix (e.g. "Client, Topic,
description"). If they do, set `prefixConvention: true` on the repo and, for each commit, put the
leading area (e.g. `Proled`, `Framework`) in `area`; leave `area` out when the message has no
prefix — the template then shows an orange **no prefix** chip. Repos without such a convention
omit both, and no chip is shown.

## Step 4 — Code-quality review (per repo)

For each repo, look for a best-practices file at the repo root, in this priority:
`CLAUDE.md`, then `AGENTS.md`. (Also honor any explicit `guidelines: [paths]` in config.)
This determines which of two review **modes** applies — the per-commit mechanics, scale, and
output below are identical for both:

- **Guidelines mode (file found).** Read the best-practices file. If it references other
  guideline documents (a `doc/` folder, `CONTRIBUTING.md`, pattern files), read the ones relevant
  to the files actually touched. Judge strictly against what the repo's own docs say — do **not**
  impose external conventions. Flag what the guidelines forbid: banned imports/libraries, unsafe
  type casts without justification, anti-patterns the doc calls out, commit messages not following
  the documented format.

- **Generic mode (no guidelines file).** Review against widely-accepted best practices instead of
  skipping. First detect the stack from the file extensions and config/lockfiles touched (e.g.
  `.ts`/`tsx` + React, `.py` + Django, `.go`, `.rs`, `.php` + Laravel). Then judge each diff using
  your own knowledge of that stack's conventions — correctness, readability, error handling,
  security (injection, secrets, unsafe input), obvious performance traps, test coverage, naming,
  dead code, and commit-message hygiene. When unsure whether a pattern is still current for a fast-
  moving stack, confirm with a quick web lookup (`mgrep --web "<stack> <topic> best practice 2026"`)
  rather than guessing — but don't web-search every commit; reserve it for genuine uncertainty.

Disable either mode by setting `"qualityReview": false` on a repo in config, or when the user asks
for "stats only" / "no quality review". Generic mode only runs as a fallback — if a guidelines file
exists, guidelines mode always wins.

For each commit in the repo:
```bash
git -C <path> show <hash> --stat --patch
```

### Review mode in the data

Every repo states which mode it used, so readers know the basis of the grades. The template
renders it under the "Commits & code review" heading:
- Guidelines mode → `"review": { "mode": "guidelines", "files": ["CLAUDE.md", "doc/…"] }` — list
  the files you actually read.
- Generic mode → `"review": { "mode": "generic", "stack": "<detected stack>" }` — rendered with a
  🌐 badge so generic grades aren't mistaken for repo-endorsed rules.
- Review disabled → `"review": { "mode": "off" }`, and every commit of that repo gets `"q": null`.

### Quality scale

("rules" below = the repo's guidelines in guidelines mode, or accepted best practices in generic mode.)

| `q` | Level | Criterion |
|---|---|---|
| `ok` | Excellent | Follows all rules, clean code |
| `warn` | Good | Minor warnings, nothing critical |
| `impr` | Improvable | Sub-optimal patterns, technical debt |
| `bad` | Problematic | Violates rules, uses banned/unsafe patterns |

### Per-commit review output

For each reviewed commit fill:
- `q` — the level above.
- `s` — a one-line verdict (≤ 80 chars), in the report language. It is the headline of the
  expanded row and the text shown in the *Needs attention* card, so make it say *what* is wrong
  (or right), e.g. "Hardcoded 'orca' agent for delete, no test" — not "Some issues".
- `notes` — max 3 specific observations. Wrap identifiers in backticks (`` `fooBar` ``) and use
  `**bold**` sparingly: the template renders only these two, everything else is escaped.

## Step 5 — Summary

Write 2–4 `summary` points for the *Day summary* card (the template titles it *Period summary* when
`period` is `"range"`): the main threads of work and who drove them, patterns across commits (e.g.
one author repeatedly skipping the message convention), and an explicit statement when there are
no critical or security violations. Each point is one or two sentences; `**bold**` the areas.

Do not duplicate stats in the summary — commit counts, most active contributor, quality
distribution and 🔴 flags are already rendered by the template from the data. The *Needs attention*
card is also automatic: it lists every `impr`/`bad` commit with its `s` verdict.

## Step 6 — Build the HTML and publish as an Artifact

The dashboard layout is **fixed**: it lives in `assets/report-template.html` and is rendered by
`scripts/build-report.mjs` (Node, no dependencies), both inside this skill's base directory. Do
**not** hand-write or restyle the HTML — you only produce the data. This keeps every report
visually identical and saves generating ~40 KB of markup per run.

1. Write the data to `{scratchpad}/{file}.json` (see "HTML file naming" for `{file}`), following the
   schema below. `assets/example-data.json` is a complete, valid example.
2. Build:
   ```bash
   node <skill-dir>/scripts/build-report.mjs {scratchpad}/{file}.json {scratchpad}/{file}.html
   ```
   The script validates the data (full hashes, known repo/person ids, `q` values, …) and exits
   non-zero listing every problem. Fix the JSON and rerun — never patch the generated HTML.
3. Publish `{scratchpad}/{file}.html` with the **Artifact** tool (see "Output").

### What the template renders

- **Dark header** (always dark, theme-independent): kicker with `periodLabel`, repo title(s) linked
  to their address, meta line, KPI strip (commits · contributors · +/− lines · % excellent ·
  critical flags, the last one clickable → filters 🔴), quality distribution bar with legend.
- **Summary** card (`summary`) and **Needs attention** card (auto: `impr`/`bad` commits, click to
  jump; link to filter the `warn` ones).
- **Contributors** table: commits bar, +/− lines bars, per-person quality bar. Click a row to
  filter the commit list.
- **Commits & code review**: review-mode line per repo, sticky toolbar (search, sort chronological
  / critical first / largest first, expand all), filter chips (quality, contributor, repo — the
  last only with 2+ repos), one expandable row per commit with verdict, notes and a link to the
  commit.
- Light and dark theme (`prefers-color-scheme`), responsive down to phone width.

Quality-related parts (KPIs, bar, attention card, quality column and chips, critical-first sort)
disappear automatically when no commit has a `q`, so a "stats only" report needs no special
handling.

### Data schema

```jsonc
{
  "lang": "it",                        // "it" | "en" — match the user's message language
  "period": "day",                     // "day" | "range"
  "periodLabel": "martedì 29 settembre 2026",   // or "22–28 settembre 2026"
  "generatedLabel": "30 settembre 2026, 08:06",
  "title": "…",                        // optional <title>; default "Commit Report — {repos} — {periodLabel}"
  "defaultSort": "chrono",             // optional: "chrono" | "crit" | "size"
  "repos": [{
    "name": "hydra",                   // matches commits[].r
    "label": "nextsrlit/hydra",        // optional, title text; default name
    "url": "https://github.com/nextsrlit/hydra",                  // optional
    "commitUrl": "https://github.com/nextsrlit/hydra/commit/{hash}", // optional
    "prefixConvention": true,          // optional, see Step 3
    "review": { "mode": "guidelines", "files": ["CLAUDE.md"] }     // see Step 4
  }],
  "people": [{ "id": "FS", "name": "Francesco Strappini", "short": "F. Strappini" }],
  "summary": ["Point with **bold** and `code`."],
  "commits": [{
    "h": "<40-char hash>", "r": "hydra", "a": "FS", "b": "dev",
    "m": "<commit subject>", "area": "Framework",   // area optional
    "d": "29/09",                      // optional short date — set it for multi-day ranges
    "add": 206, "del": 67,
    "q": "ok", "s": "<one-line verdict>", "notes": ["…"]
  }]
}
```

List `commits` newest first (git log order): that is the "chronological" sort.

## HTML file naming

```
commit-report-{repos}-{range}[-{user}].html
```

Examples:
- `commit-report-frontend-2026-06-24.html` → single repo, single day
- `commit-report-frontend-week-2026-06-22.html` → single repo, week (from Monday)
- `commit-report-backend-2026-06-20_2026-06-24.html` → single repo, explicit range
- `commit-report-frontend-2026-06-24-smith.html` → single repo, day + user filter
- `commit-report-frontend+backend-2026-06-24.html` → two repos
- `commit-report-multi-2026-06-24.html` → 4+ repos

Rules:
- `{repos}`: the repo name(s) being reported on.
  - 1 repo → its name (e.g. `frontend`).
  - 2–3 repos → names joined with `+` (e.g. `frontend+backend`).
  - 4+ repos → the literal `multi`.
  - Slugify each name: lowercase, spaces/slashes → `-`, strip other punctuation.
- `{range}`: `YYYY-MM-DD` for a single day; `week-YYYY-MM-DD` for a week (Monday's date);
  `YYYY-MM-DD_YYYY-MM-DD` for an explicit range.
- `{user}`: if a user filter is given, append `-{lastname_lowercase}`.
- Artifact label: the same string without `.html`.

## Output

**Do not produce verbose markdown output.** Everything goes into the Artifact.

Build the HTML into the session scratchpad with the name computed above (Step 6), then publish it
with the **Artifact** tool (icon `chart`, label = filename without `.html`). Delete the `.json`
data file afterwards unless the user asks to keep it.

### Optional extra publish target

By default the report lives only in the Artifact. If the user asks to also save it somewhere —
a local path, or an SCP/rsync destination — do that in addition. For example:
```bash
scp {scratchpad_path}/{file}.html user@host:/var/www/html/commit-report/{file}.html
```
A persistent `publish` block in `commit-report.config.json` (see schema) is honored the same way.

After publishing, reply with the Artifact link (and the web URL, if an extra target was used):
```
Artifact: https://claude.ai/code/artifact/...
Web:      https://<host>/<path>/{file}.html
```

HTML language: match the language of the user's message (`lang`; the template ships `it` and `en`
labels — for any other language use `en`).

## Config schema

`commit-report.config.json` (all fields optional; the skill auto-detects sensible defaults):

```json
{
  "repos": [
    {
      "name": "myapp",
      "path": "/path/to/myapp",
      "commitUrlTemplate": "https://github.com/org/myapp/commit/{hash}",
      "guidelines": ["CLAUDE.md", "doc/PATTERNS.md"]
    }
  ],
  "publish": {
    "scp": "user@host:/var/www/html/commit-report/{file}",
    "webUrl": "https://host/commit-report/{file}"
  }
}
```

- `repos[].path` — required if you list repos explicitly.
- `repos[].name` — display name; defaults to the folder basename.
- `repos[].commitUrlTemplate` — overrides auto-derivation from the `origin` remote.
- `repos[].guidelines` — explicit best-practices files for the quality review; if omitted, the
  skill auto-detects `CLAUDE.md` / `AGENTS.md` at the repo root.
- `publish` — optional extra destination, applied on top of the Artifact. `{file}` is replaced
  with the computed HTML filename.
