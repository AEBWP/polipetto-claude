# Polipetto per Claude Code

*[Leggi in italiano](README.it.md)*

A small pixel-art octopus that lives in the VS Code Explorer sidebar and acts out what Claude Code is really doing.

> Unofficial fan project. It is not made by, endorsed by, or affiliated with Anthropic.

![Polipetto working](media/preview.png)

## What it does

When Claude is idle, the octopus relaxes in its corner: it breathes, blinks, wanders around and eventually falls asleep.

When Claude works, the animation follows the real activity:

| Claude is... | The octopus... | Speech bubble |
| --- | --- | --- |
| Running a script or command | works at the computer | terminal |
| Editing or writing files | works at the computer | pencil |
| Browsing the web | works at the computer | globe |
| Using another tool (MCP and others) | works at the computer | gear |
| Reading a file | reads a book | page of text |
| Searching the code | reads a book | magnifying glass |
| Thinking | looks up | dots or light bulb |
| Delegating to an agent | looks up | little octopus |
| Planning its tasks | looks up | checklist |
| Asking you something | raises a hand | question mark |
| Hitting an error | shakes | red cross |

The bubble switches side at every step, so you can follow the sequence of actions.

Every agent gets its own octopus, and new ones split off from the agent that launched them. When an agent finishes it celebrates with confetti, then disappears, until one octopus is left to relax again.

Click an octopus to start a new Claude Code session in a tab.

## Requirements

[Claude Code](https://claude.com/claude-code), as the VS Code extension or the command-line tool. Opening a new session with a click needs the VS Code extension.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `polipetto.scope` | `all` | `all` reacts to every session on this computer, `workspace` only to sessions started in the folders open in this window. |

## Privacy

The extension only reads the session files Claude Code keeps on your computer, in `~/.claude/projects` or `CLAUDE_CONFIG_DIR`. It uses them to know which tool is running. It does not change Claude Code's configuration, send anything over the network, or collect data.

## Known limits

Claude Code does not record when it is waiting for a permission, so the octopus keeps working during that wait. A session that stays silent for 10 minutes goes back to idle.

## Development

- `npm test` runs the tests.
- `npm run package` builds the `.vsix` file.

## License

[MIT](LICENSE)
