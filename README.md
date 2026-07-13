# claude-plugins-marketplace

Marketplace di plugin per [Claude Code](https://code.claude.com), pubblicati e mantenuti da Next.

## Installazione

```
/plugin marketplace add nextsrlit/claude-plugins-marketplace
```

Poi installa i plugin che ti interessano:

```
/plugin install diarize-call@next-plugins
/plugin install commit-report@next-plugins
```

## Plugin disponibili

### `diarize-call`

Trascrive e diarizza chiamate/meeting registrati (OBS, Teams, Meet) o qualsiasi file audio/video. Produce:

- trascrizione con speaker diarization
- identificazione dei partecipanti reali leggendo i frame dove Teams/Meet evidenzia chi parla
- riassunto narrativo della call

Uso tipico: "trascrivi questa call", "riassumi il meeting", "chi ha detto cosa in questo video", "diarizza questo".

### `commit-report`

Estrae i commit git da uno o più repository su un intervallo di date e produce:

1. statistiche per contributor: numero commit, righe aggiunte/rimosse per repo e totale
2. review di qualità del codice per ogni commit, confrontata con le best practice del repo (CLAUDE.md/AGENTS.md) se presenti, altrimenti con best practice generiche per lo stack rilevato

Il risultato è una dashboard HTML self-contained pubblicata via Artifact.

Uso tipico: "commit report", "report commit di ieri", "statistiche commit", "report qualità commit per [utente]".

## Sviluppo

Repo separato dai plugin installati in `~/.claude` — modifica qui, testa con marketplace locale:

```
/plugin marketplace add ~/code/claude-plugins-marketplace
/plugin marketplace update
```

Poi push su questo repo per rendere disponibili gli aggiornamenti a tutti.

## Struttura

```
.claude-plugin/marketplace.json      # catalogo marketplace
plugins/
  diarize-call-plugin/
    .claude-plugin/plugin.json
    skills/diarize-call/
  commit-report-plugin/
    .claude-plugin/plugin.json
    skills/commit-report/
```
