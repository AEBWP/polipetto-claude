# Polipetto per Claude Code

Un polipetto in pixel art nella sidebar Esplora di VS Code. Sta tranquillo quando Claude è fermo,
lavora quando Claude lavora, si moltiplica con gli agenti e festeggia quando hanno finito.

L'estensione legge in sola lettura le trascrizioni in `~/.claude/projects` (o `CLAUDE_CONFIG_DIR`).
Non modifica la configurazione di Claude Code e non usa la rete.

## Comandi

- `npm test` esegue i test del rilevamento.
- `npm run package` crea il file `.vsix`.

## Impostazioni

- `polipetto.scope`: `all` (tutte le sessioni, predefinito) oppure `workspace` (solo le cartelle aperte).

Un clic sul polipetto apre una nuova sessione di Claude Code in una scheda.

## Nota

Il personaggio richiama la mascotte di Claude Code, che è di Anthropic. L'estensione è pensata per
uso personale: prima di pubblicarla sul Marketplace serve un personaggio e un nome propri.
