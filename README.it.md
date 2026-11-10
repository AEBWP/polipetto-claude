# Polipetto per Claude Code

*[Read in English](README.md)*

Un piccolo polipetto in pixel art che vive nella sidebar Esplora di VS Code e mette in scena quello che Claude Code sta facendo davvero.

> Progetto amatoriale non ufficiale. Non è realizzato, approvato o affiliato ad Anthropic.

![Il polipetto al lavoro](media/preview.png)

## Cosa fa

Quando Claude è fermo, il polipetto si rilassa nel suo angolino: respira, sbatte gli occhi, passeggia e alla fine si addormenta.

Quando Claude lavora, l'animazione segue l'attività reale:

| Claude sta... | Il polipetto... | Vignetta |
| --- | --- | --- |
| Eseguendo uno script o un comando | lavora al computer | terminale |
| Modificando o scrivendo file | lavora al computer | matita |
| Navigando sul web | lavora al computer | globo |
| Usando un altro strumento (MCP e altri) | lavora al computer | ingranaggio |
| Leggendo un file | legge un libro | pagina di testo |
| Cercando nel codice | legge un libro | lente |
| Pensando | guarda in alto | puntini o lampadina |
| Delegando a un agente | guarda in alto | polipetto |
| Pianificando i compiti | guarda in alto | lista |
| Facendoti una domanda | alza la mano | punto interrogativo |
| Trovando un errore | trema | croce rossa |

La vignetta cambia lato a ogni passo, così puoi seguire la sequenza delle azioni.

Ogni agente ha il suo polipetto, e i nuovi nascono da quello che li ha lanciati. Quando un agente finisce festeggia con i coriandoli e poi sparisce, finché ne resta uno a rilassarsi.

Clicca un polipetto per aprire una nuova sessione di Claude Code in una scheda.

## Requisiti

[Claude Code](https://claude.com/claude-code), come estensione di VS Code o da riga di comando. Per aprire una nuova sessione con un clic serve l'estensione di VS Code.

## Impostazioni

| Impostazione | Predefinito | Descrizione |
| --- | --- | --- |
| `polipetto.scope` | `all` | `all` reagisce a tutte le sessioni su questo computer, `workspace` solo a quelle avviate nelle cartelle aperte in questa finestra. |

## Privacy

L'estensione legge solo i file di sessione che Claude Code tiene sul tuo computer, in `~/.claude/projects` o `CLAUDE_CONFIG_DIR`, per sapere quale strumento è in uso. Non modifica la configurazione di Claude Code, non invia nulla in rete e non raccoglie dati.

## Limiti noti

Claude Code non registra quando aspetta un'autorizzazione, quindi il polipetto continua a lavorare durante quell'attesa. Una sessione muta per 10 minuti torna a riposo.

## Sviluppo

- `npm test` esegue i test.
- `npm run package` crea il file `.vsix`.

## Licenza

[MIT](LICENSE)
