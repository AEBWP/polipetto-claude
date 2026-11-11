'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const https = require('https');

const DEFAULT_URL = 'https://api.anthropic.com';
const TIMEOUT_MS = 6000;
const ONLINE_EVERY_MS = 30000;
const OFFLINE_EVERY_MS = 10000;

function configDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

function readSettingsUrl(file) {
  try {
    const settings = JSON.parse(fs.readFileSync(file, 'utf8'));
    const url = settings && settings.env && settings.env.ANTHROPIC_BASE_URL;
    return typeof url === 'string' && url.trim() ? url.trim() : null;
  } catch {
    return null;
  }
}

/**
 * The address Claude Code talks to, in the order Claude Code itself would pick it:
 * the user's explicit choice, the environment, then Claude Code's own settings.
 */
function resolveUrl({ configured, env = process.env, settingsFiles } = {}) {
  if (configured && configured.trim()) return configured.trim();
  if (env.ANTHROPIC_BASE_URL && env.ANTHROPIC_BASE_URL.trim()) return env.ANTHROPIC_BASE_URL.trim();
  const files = settingsFiles || [path.join(configDir(), 'settings.local.json'), path.join(configDir(), 'settings.json')];
  for (const file of files) {
    const url = readSettingsUrl(file);
    if (url) return url;
  }
  return DEFAULT_URL;
}

/** Any HTTP answer, even an error status, means the server is reachable. */
function probe(url, timeoutMs = TIMEOUT_MS) {
  return new Promise((resolve) => {
    let target;
    try {
      target = new URL(url);
    } catch {
      resolve(false);
      return;
    }
    const lib = target.protocol === 'http:' ? http : https;
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    const req = lib.request(target, { method: 'HEAD', timeout: timeoutMs }, (res) => {
      res.resume();
      finish(true);
    });
    req.on('timeout', () => {
      req.destroy();
      finish(false);
    });
    req.on('error', () => finish(false));
    req.end();
  });
}

class Connectivity {
  constructor({ url, onChange, check = probe }) {
    this.url = url;
    this.onChange = onChange;
    this.check = check;
    this.online = null; // unknown until the first answer
    this.checking = false;
    this.timer = null;
    this.stopped = false;
  }

  state() {
    return { online: this.online, checking: this.checking };
  }

  start() {
    this.stopped = false;
    this.run();
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Checks right away, for example when the user clicks the sleeping octopus. */
  now() {
    if (this.checking || this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.run();
  }

  async run() {
    this.timer = null;
    this.checking = true;
    this.onChange(this.state());
    let ok = false;
    try {
      ok = await this.check(this.url);
    } catch {
      ok = false;
    }
    if (this.stopped) return;
    this.checking = false;
    this.online = ok;
    this.onChange(this.state());
    this.timer = setTimeout(() => this.run(), ok ? ONLINE_EVERY_MS : OFFLINE_EVERY_MS);
  }
}

module.exports = { Connectivity, resolveUrl, probe, DEFAULT_URL };
