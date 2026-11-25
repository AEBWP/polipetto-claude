# Polipetto per Claude Code

Estensione VS Code (publisher `aebwp`, licenza MIT, repo pubblico `AEBWP/polipetto-claude`): un polpo in pixel art nella barra laterale che mima ciò che Claude Code sta facendo davvero. Progetto di fan non ufficiale: non usare marchi o grafica di Anthropic e mantenere la nota «Unofficial fan project» nei README.

Con l'utente si parla italiano. Codice, commit, README e CHANGELOG sono in inglese (commit: frase semplice all'imperativo, es. «Add progress dots…»); `README.it.md` e `l10n/bundle.l10n.it.json` sono la versione italiana e vanno aggiornati insieme a quella inglese.

## Struttura

JavaScript CommonJS puro, nessuna dipendenza e nessuna build.

- `src/extension.js`: attivazione, webview (una per barra laterale: Explorer, Source Control, Run and Debug, Testing), lettura dei file di sessione in `~/.claude/projects` o `CLAUDE_CONFIG_DIR`, filtro `polipetto.scope`, tick ogni secondo.
- `src/tracker.js` (22 KB): trasforma le righe JSONL delle sessioni in stato per ogni agente (attività corrente, fumetto, punti di avanzamento, orchestratori). È il cuore: ogni nuova animazione legata a un'attività passa da qui.
- `src/connectivity.js`: richiesta `HEAD` vuota al server di Claude (`polipetto.claudeUrl`, altrimenti `ANTHROPIC_BASE_URL`, altrimenti `https://api.anthropic.com`); ogni 30 s, ogni 10 s da spento. Qualsiasi risposta, anche un errore, conta come raggiungibile.
- `media/polipetto.js`: disegno e animazioni nel webview. `media/icon.png`, `media/preview.png`.
- `package.json` (`contributes`: viste e impostazioni `polipetto.*`), `package.nls*.json` per i testi del manifest, `l10n/` per i testi runtime.
- `test/`: `node --test`, soprattutto su `tracker.js`.

## Comandi

```bash
npm test          # test (node --test)
npm run package   # crea il .vsix (i .vsix sono ignorati da git)
```

## Regole

- **Privacy**: l'estensione legge solo i file di sessione locali e manda solo l'`HEAD` vuoto, senza dati né credenziali. Niente altro in rete, niente telemetria, mai modificare la configurazione di Claude Code. Se una funzione richiede di più, fermarsi e chiedere.
- Le animazioni seguono l'attività reale: nessuna attività inventata. Limite noto: Claude Code non registra l'attesa di un permesso.
- Ogni nuova impostazione: `package.json`, `package.nls.json` + `.it.json`, tabella Settings in entrambi i README.
- Ogni comportamento nuovo del tracker ha un test in `test/tracker.test.js`.

## Release

Solo su richiesta dell'utente.

1. Versione in `package.json`, voce nuova in cima a `CHANGELOG.md` (in inglese, elenco di frasi brevi rivolte all'utente).
2. `npm test`, `npm run package` per provare il `.vsix` in locale.
3. Commit e push; la pubblicazione sul Marketplace la fa il workflow manuale `.github/workflows/publish.yml` (`workflow_dispatch`, `vsce publish --oidc`): `gh workflow run publish.yml`.
