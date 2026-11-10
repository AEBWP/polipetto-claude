'use strict';

const vscode = require('vscode');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { Tracker } = require('./tracker');

const TICK_MS = 1000;

function projectsRoot() {
  const base = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  return path.join(base, 'projects');
}

/** Claude Code names each project directory after its path, with every non-alphanumeric as "-". */
function encodeProject(fsPath) {
  return fsPath.replace(/[^a-zA-Z0-9]/g, '-');
}

function makeFilter() {
  const scope = vscode.workspace.getConfiguration('polipetto').get('scope');
  if (scope !== 'workspace') return () => true;
  const allowed = new Set((vscode.workspace.workspaceFolders || []).map((f) => encodeProject(f.uri.fsPath)));
  return (dir) => allowed.has(dir);
}

class PolipettoView {
  constructor(context) {
    this.context = context;
    this.view = null;
    this.tracker = null;
    this.timer = null;
    this.restart();
  }

  newSession() {
    vscode.commands.executeCommand('claude-vscode.editor.open').then(undefined, () => {
      vscode.window.showWarningMessage(vscode.l10n.t('Polipetto: could not open Claude Code. Is its extension installed?'));
    });
  }

  restart() {
    this.stop();
    this.tracker = new Tracker({
      root: projectsRoot(),
      filter: makeFilter(),
      onChange: (s) => this.post(s),
    });
    const tick = () => this.tracker.tick().catch((err) => console.error('[polipetto]', err));
    tick();
    this.timer = setInterval(tick, TICK_MS);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  post(snapshot) {
    if (this.view) this.view.webview.postMessage({ type: 'agents', ...snapshot });
  }

  resolveWebviewView(view) {
    this.view = view;
    const media = vscode.Uri.joinPath(this.context.extensionUri, 'media');
    view.webview.options = { enableScripts: true, localResourceRoots: [media] };
    view.webview.onDidReceiveMessage((m) => {
      if (!m) return;
      if (m.type === 'ready') {
        this.post({ agents: this.tracker.snapshot(), completed: [] });
      } else if (m.type === 'newSession') {
        this.newSession();
      }
    });
    view.onDidDispose(() => {
      this.view = null;
    });
    view.webview.html = this.html(view.webview, media);
  }

  html(webview, media) {
    const nonce = crypto.randomBytes(16).toString('hex');
    const script = webview.asWebviewUri(vscode.Uri.joinPath(media, 'polipetto.js'));
    return `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">
  html, body { height: 100%; margin: 0; padding: 0; overflow: hidden; background: transparent; }
  canvas { display: block; width: 100%; height: 100%; }
</style>
</head>
<body><canvas id="scene" aria-label="Polipetto"></canvas>
<script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
  }
}

function activate(context) {
  const provider = new PolipettoView(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('polipetto.view', provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('polipetto.scope')) provider.restart();
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => provider.restart()),
    { dispose: () => provider.stop() }
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
