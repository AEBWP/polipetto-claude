# Changelog

## 0.7.0

- The octopus starts switched off, with its plug out of the socket and a cloud for Claude's server, and wakes up once the server answers.
- If Claude's server stops answering, for example when a VPN drops, the octopus switches off again. The connection is checked every 30 seconds, every 10 seconds while off, or right away by clicking the switched-off octopus.
- New settings: `polipetto.connectionCheck` to turn this off, and `polipetto.claudeUrl` for a custom server address.
- Fixed the celebration, which stopped the animation after an agent finished.

## 0.6.1

- When Claude has not declared its steps in advance, coloured bubbles rise at each step instead of a column of green dots.
- Builds show a wall of bricks going up.
- A clearer light bulb for thinking, which switches on and off.

## 0.6.0

- A column of dots beside each octopus shows real progress: task lists, the Claude desktop app's plan, launched agents, or the phases of the work.
- An agent that launches others turns purple, moves above them and is connected to them by lines.
- Reading and searching now use real glasses.
- Dedicated animations for tests (with their result), builds, git commit, push and pull, installing dependencies and publishing.
- An hourglass while Claude Code retries after a connection problem or a rate limit, instead of an error.
- A short squash after the conversation is compacted.
- The octopus also appears in Source Control, and can be turned on or off for Explorer, Source Control, Run and Debug and Testing in the settings.

## 0.5.1

- The sidebar section is now called "Claude Worker".

## 0.5.0

First public release.

- One octopus per Claude Code agent, driven by the real session activity.
- A dedicated animation and speech bubble for scripts, edits, reading, searching, web, thinking, delegating, planning, questions and errors.
- Celebration when an agent finishes.
- Click an octopus to open a new session.
- English and Italian.
