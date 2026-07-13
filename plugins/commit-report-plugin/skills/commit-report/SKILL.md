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
git -C <path> log --all --no-merges \
  --since="YYYY-MM-DD 00:00:00" \
  --until="YYYY-MM-DD 23:59:59" \
  --pretty=format:"%H|||%ae|||%an|||%s" \
  --numstat \
  [--author="<pattern>"]   # only if a user filter was requested
```

**Parse output**: lines alternate between `%H|||%ae|||%an|||%s` headers and numstat rows
(`+\t-\tfile`). Aggregate per author (use `%ae` as the key, `%an` as the display name).

**Exclude merge commits** with `--no-merges` (already in the command above).

**Exclude bots**: discard any commit whose `%ae` contains `bot` or `noreply`
(e.g. `github-actions[bot]@users.noreply.github.com`, `dependabot[bot]@...`). These commits
appear neither in the table nor in the quality review.

**Normalize authors**: for real users (not bots) with `*@users.noreply.github.com` emails,
extract the username from the local part.

## Step 2 — Summary table

Show a markdown table with one column group per repo:

| Contributor | <repo> commits | <repo> +/- | … | **Total commits** | **Total +lines** | **Total -lines** |
|---|---|---|---|---|---|---|

Sort by `Total commits` descending. Omit a repo's columns if it has 0 commits across everyone.

## Commit links

Every hash in the details and quality cards must be a clickable link.

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
3. If no remote can be resolved, render the hash as plain text (no link).

In `href` attributes use the **full** 40-char hash. Show only the first 8 chars as visible text.

## Step 3 — Per-repo detail

For each repo with at least 1 commit, a section:
```
### 📦 Repo: <name>
| Commit | Author | Message | +lines | -lines | Files |
```
Use the short hash (8 chars) as the visible text, linked to the commit (see "Commit links").

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
  **Badge this mode clearly** so generic grades aren't mistaken for repo-endorsed rules (see
  "Review-mode badge" below).

Disable either mode by setting `"qualityReview": false` on a repo in config, or when the user asks
for "stats only" / "no quality review". Generic mode only runs as a fallback — if a guidelines file
exists, guidelines mode always wins.

For each commit in the repo:
```bash
git -C <path> show <hash> --stat --patch
```

For each commit, produce:
- **Quantitative**: real complexity (meaningful lines, not boilerplate)
- **Qualitative**: correct patterns followed, problems found, suggestions

### Review-mode badge

Every report states which mode each repo used, so readers know the basis of the grades:
- Guidelines mode → `🛡️ reviewed against CLAUDE.md` (or the actual file/list).
- Generic mode → `🌐 generic best-practices review (no repo guidelines)`.

Show this badge next to the repo name in the quality section header and in the per-repo detail.

### Quality scale

("rules" below = the repo's guidelines in guidelines mode, or accepted best practices in generic mode.)

| Emoji | Level | Criterion |
|---|---|---|
| ✅ | Excellent | Follows all rules, clean code |
| 🟡 | Good | Minor warnings, nothing critical |
| 🟠 | Improvable | Sub-optimal patterns, technical debt |
| 🔴 | Problematic | Violates rules, uses banned/unsafe patterns |

### Per-commit quality output

```
#### [short-hash] — [message]
- **Author**: [name]
- **Files**: [main files]
- **Quality**: ✅/🟡/🟠/🔴 [level]
- **Notes**: [specific observations, max 3 bullets]
```

## Step 5 — Final summary

A closing section with:
- Most active repo of the period
- Most active contributor
- For each reviewed repo: average commit quality (percentage ✅/🟡/🟠/🔴)
- Any critical flags (🔴)

## Step 6 — Generate HTML and publish as an Artifact

Generate the HTML and publish it with the **Artifact** tool (do not save verbose markdown,
do not dump to /tmp).

The file must be **fully self-contained** (no CDN, no external assets). Use vanilla JS + inline
SVG for the charts.

### Mandatory first line

The HTML file must always start with:
```html
<meta charset="UTF-8">
```
Without this tag, web servers may serve it as ISO-8859-1 and UTF-8 characters
(−, —, emoji, accents) appear corrupted.

### Design system (always respect these values)

```css
:root {
  --bg:      #f2f4f9;
  --surface: #ffffff;
  --surface2:#eaecf4;
  --border:  #d4d8e8;
  --text:    #1a1d2e;
  --text2:   #586080;
  --accent:  #2563c9;
  --accent-l:#dbeafe;
  --green:   #15803d;
  --red:     #b91c1c;
  --q-ok:    #059669; --q-ok-l:  #d1fae5;
  --q-warn:  #b45309; --q-warn-l:#fef3c7;
  --q-impr:  #c2410c; --q-impr-l:#ffedd5;
  --q-bad:   #991b1b; --q-bad-l: #fee2e2;
  --radius:  6px;
  --mono: 'SF Mono','Cascadia Code','Fira Code','Consolas',monospace;
  /* header is ALWAYS dark, independent of light/dark theme — never derive it from --text/--bg,
     which flip per theme and would turn light-on-light or dark-on-dark */
  --header-bg:   #1a1d2e;
  --header-text: #e2e8f0;
}
body { font-family: system-ui,-apple-system,'Segoe UI',sans-serif; background:var(--bg); color:var(--text); font-size:13.5px; line-height:1.55; padding:0 0 3rem; }
```

**Critical pitfall (recurring bug — check every time):** the header must use `--header-bg`/
`--header-text`, fixed hex values that do NOT change with `@media (prefers-color-scheme: dark)`
or `:root[data-theme]` overrides. Do **not** write `background: var(--text)` for the header —
`--text` itself flips between dark and light hex values across themes, so a header styled that
way renders unreadable (light text on light background) in dark mode. Before publishing, grep the
generated HTML for `.page-header` and confirm its background/color rules are NOT `var(--text)` or
`var(--bg)`.

### HTML structure

#### 1. Dark header
```html
<div class="page-header"> <!-- background: var(--header-bg), color: var(--header-text) — fixed, theme-independent -->
  <div class="date-badge">Day Month Year</div> <!-- accent-blue pill -->
  <h1>Commit Report — [repo name(s)] — [period label]</h1>
  <div class="repos-line"><!-- one entry per repo: name linked to its address -->
    <a href="{repo_url}" target="_blank">{repo_name}</a> · …
  </div>
  <div class="meta">bots excluded · generated [date]</div>
</div>
```

Put the **repo name(s)** in the `<h1>` title (single repo → its name; 2–3 → `+`-joined; 4+ →
`multi`, matching the filename rule). The `.repos-line` lists each repo as a clickable link to
its **address**: the repo's web home page derived from the `origin` remote — i.e. the
`commitUrlTemplate` with the `/commit/{hash}` (or `/-/commit/{hash}`) suffix stripped
(e.g. `https://github.com/org/repo`). If a repo has no resolvable remote, show its name as
plain text (no link).

#### 2. Stat strip (white, border-bottom)
5 pills: **Total commits · Contributors · +lines (green) · −lines (red) · Active repos**

#### 3. Charts in a 2-col grid (`display:grid; grid-template-columns:1fr 1fr; gap:1rem`)
- **Bar chart, commits per contributor** — horizontal bars, distinct color per contributor,
  label on the left (110px), value inside the bar
- **Bar chart, lines changed** — green +lines bar, red −lines value outside the bar on the right
- **Quality donut (SVG)** — only if at least one repo was reviewed; r=38, stroke-width=17,
  colors: ✅ `#059669` 🟡 `#fbbf24` 🟠 `#f97316` 🔴 `#ef4444`; legend alongside
- **Per-contributor quality table** — columns: Contributor · ✅ · 🟡 · 🟠 · 🔴

#### 4. Contributor summary table
Columns: Contributor · [one column per active repo with commits + lines] · Total commits ·
Total +lines · Total −lines. Sort by Total commits desc.
`font-variant-numeric: tabular-nums` on all numeric cells.

#### 5. Per-repo commit detail (JS accordion)
One collapsible block per repo. Each commit is a `.commit-card` with:
- `border-left: 3px solid var(--accent)` (cycle a few accent colors across repos for contrast)
- Header: `<a href="{commit_url}" target="_blank" class="hash">{short_hash}</a>` · message ·
  time · author
- Main files row
- Stats +lines / −lines

**Hashes are always clickable links** (see "Commit links").

#### 6. Quality review (only for reviewed repos)
One `.quality-card` per commit:
```html
<div class="quality-card">
  <div class="qcard-header">
    <a href="{commit_url}" target="_blank" class="hash">{short_hash}</a>
    <span class="badge q-ok|q-warn|q-impr|q-bad">✅/🟡/🟠/🔴 Level</span>
    <span class="qcard-msg">{message}</span>
    <span class="qcard-author">{author} · {time}</span>
  </div>
  <ul class="notes">
    <li>observation 1</li>
  </ul>
</div>
```

#### 7. Summary
Pills: most active repo · most active contributor · average quality · 🔴 flags · notes

#### 8. Footer
`Generated by commit-report skill · {date} · repos: {list}`

### JS accordion
```js
function toggle(btn) {
  const c = btn.nextElementSibling;
  const open = c.classList.toggle('open');
  btn.setAttribute('aria-expanded', open);
}
```

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

Write the HTML to the session scratchpad with the name computed above, then publish it with the
**Artifact** tool (favicon `📊`, label = filename without `.html`).

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

HTML language: match the language of the user's message.

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
