'use strict';

const fsp = require('fs/promises');
const path = require('path');

const DEFAULTS = {
  discoverEveryMs: 3000,
  // Blocks of one message are separate records, so "end" must survive a short silence.
  endDebounceMs: 1500,
  // Longer than the longest foreground tool call: silence past this means the session died.
  staleMs: 10 * 60 * 1000,
  hotWindowMs: 15 * 60 * 1000,
  // A file first seen with a write this recent was born while we were watching.
  freshFileMs: 30 * 1000,
  tailBytes: 256 * 1024,
  maxReadBytes: 16 * 1024 * 1024,
};

const TOOL_ACTIVITY = {
  Bash: 'run',
  PowerShell: 'run',
  BashOutput: 'run',
  KillShell: 'run',
  Monitor: 'run',
  TaskStop: 'run',
  Edit: 'write',
  MultiEdit: 'write',
  Write: 'write',
  NotebookEdit: 'write',
  Read: 'read',
  NotebookRead: 'read',
  LS: 'read',
  Grep: 'search',
  Glob: 'search',
  ToolSearch: 'search',
  SearchPlugins: 'search',
  WebFetch: 'web',
  WebSearch: 'web',
  Agent: 'delegate',
  Task: 'delegate',
  Workflow: 'delegate',
  SendMessage: 'delegate',
  SubagentHandback: 'delegate',
  AskUserQuestion: 'ask',
  ExitPlanMode: 'ask',
  TodoWrite: 'plan',
  TaskCreate: 'plan',
  TaskUpdate: 'plan',
  TaskList: 'plan',
  EnterPlanMode: 'plan',
};

function activityForTool(name) {
  if (name.startsWith('mcp__') && /browser|chrome/i.test(name)) return 'web';
  return TOOL_ACTIVITY[name] || 'tool';
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter((b) => b && b.type === 'text').map((b) => b.text || '').join('\n');
}

/** Maps one transcript record to null, {kind:'work',activity}, {kind:'end'} or {kind:'abort'}. */
function classify(rec) {
  if (rec && rec.type === 'system' && rec.subtype === 'api_error') return { kind: 'work', activity: 'error' };
  if (!rec || !rec.message) return null;
  const content = rec.message.content;

  if (rec.type === 'user') {
    if (rec.isMeta || rec.isCompactSummary || rec.isVisibleInTranscriptOnly) return null;
    const text = textOf(content);
    if (text.includes('[Request interrupted by user')) return { kind: 'abort' };
    // Local slash commands and "!" shell lines are logged as user text but never reach the model.
    if (/^\s*<(command-|local-command|bash-)/.test(text)) return null;
    const failed = Array.isArray(content) && content.some((b) => b && b.type === 'tool_result' && b.is_error);
    return { kind: 'work', activity: failed ? 'error' : 'think' };
  }

  if (rec.type === 'assistant') {
    const blocks = Array.isArray(content) ? content : [];
    const tool = blocks.find((b) => b && b.type === 'tool_use');
    if (tool) return { kind: 'work', activity: activityForTool(tool.name) };
    const stop = rec.message.stop_reason;
    if (stop === 'tool_use' || !stop || stop === 'pause_turn') return { kind: 'work', activity: 'think' };
    return { kind: 'end' };
  }

  return null;
}

class Tracker {
  /**
   * @param {object} opts
   * @param {string} opts.root      projects directory
   * @param {(d:string)=>boolean} [opts.filter]  keeps only some project directories
   * @param {(s:{agents:object[],completed:string[]})=>void} [opts.onChange]
   * @param {()=>number} [opts.now]
   */
  constructor(opts) {
    this.root = opts.root;
    this.filter = opts.filter || (() => true);
    this.onChange = opts.onChange || (() => {});
    this.now = opts.now || Date.now;
    this.cfg = { ...DEFAULTS, ...opts };
    this.entries = new Map();
    this.baselined = false;
    this.lastDiscover = -Infinity;
    this.lastKey = '[]';
    this.ticking = false;
  }

  snapshot() {
    const agents = [];
    for (const e of this.entries.values()) {
      if (e.state === 'working') {
        agents.push({ id: e.id, kind: e.kind, parentId: e.parentId, activity: e.activity, step: e.step });
      }
    }
    agents.sort((a, b) => (a.kind === b.kind ? a.id.localeCompare(b.id) : a.kind === 'session' ? -1 : 1));
    return agents;
  }

  async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const now = this.now();
      if (now - this.lastDiscover >= this.cfg.discoverEveryMs) {
        this.lastDiscover = now;
        await this._discover(now);
      }
      for (const e of this.entries.values()) {
        if (e.state === 'working' || now - e.mtime < this.cfg.hotWindowMs) await this._pump(e, now);
      }
      await this._settle(now);
    } finally {
      this.ticking = false;
    }
  }

  async _discover(now) {
    const dirs = await listDir(this.root);
    for (const d of dirs) {
      if (!d.isDirectory() || !this.filter(d.name)) continue;
      const projectDir = path.join(this.root, d.name);
      for (const f of await listDir(projectDir)) {
        if (!f.isFile() || !f.name.endsWith('.jsonl')) continue;
        const file = path.join(projectDir, f.name);
        const id = f.name.slice(0, -'.jsonl'.length);
        const session = await this._ensure(file, { id, kind: 'session', parentId: null }, now);
        if (session && now - session.mtime < this.cfg.hotWindowMs) {
          await this._discoverSubagents(path.join(projectDir, id, 'subagents'), id, now);
        }
      }
    }
    this.baselined = true;
  }

  async _discoverSubagents(dir, parentId, now) {
    for (const f of await listDir(dir)) {
      const p = path.join(dir, f.name);
      if (f.isDirectory()) {
        await this._discoverSubagents(p, parentId, now);
      } else if (f.name.endsWith('.jsonl')) {
        await this._ensure(p, { id: f.name.slice(0, -'.jsonl'.length), kind: 'subagent', parentId }, now);
      }
    }
  }

  async _ensure(file, identity, now) {
    const stat = await statOf(file);
    if (!stat) return null;
    let e = this.entries.get(file);
    if (e) {
      e.mtime = stat.mtimeMs;
      return e;
    }
    e = {
      ...identity,
      file,
      offset: 0,
      partial: Buffer.alloc(0),
      state: 'idle',
      activity: 'think',
      step: 0,
      endAt: null,
      lastWriteAt: Math.min(now, stat.mtimeMs),
      mtime: stat.mtimeMs,
      metaMtime: 0,
    };
    this.entries.set(file, e);
    const bornWatching = this.baselined && now - stat.mtimeMs < this.cfg.freshFileMs;
    if (!bornWatching) await this._baseline(e, stat.size, now);
    return e;
  }

  /** Starts at end of file, recovering the current state from the tail without firing "completed". */
  async _baseline(e, size, now) {
    e.offset = size;
    if (now - e.mtime >= this.cfg.staleMs) return;
    const start = Math.max(0, size - this.cfg.tailBytes);
    const buf = await readRange(e.file, start, size - start);
    if (!buf) return;
    const text = buf.toString('utf8');
    const lines = text.split('\n');
    if (start > 0) lines.shift();
    for (const line of lines) this._apply(e, parse(line), now);
    if (e.endAt !== null) {
      e.state = 'idle';
      e.endAt = null;
    }
  }

  async _pump(e, now) {
    const stat = await statOf(e.file);
    if (!stat) {
      e.state = 'idle';
      e.endAt = null;
      return;
    }
    e.mtime = stat.mtimeMs;
    if (stat.size < e.offset) {
      e.offset = stat.size;
      e.partial = Buffer.alloc(0);
      return;
    }
    if (stat.size === e.offset) return;

    const length = Math.min(stat.size - e.offset, this.cfg.maxReadBytes);
    const chunk = await readRange(e.file, e.offset, length);
    if (!chunk) return;
    e.offset += chunk.length;
    e.lastWriteAt = now;

    // Work on bytes: a read can stop inside a multi-byte character.
    let data = e.partial.length ? Buffer.concat([e.partial, chunk]) : chunk;
    let nl = data.indexOf(0x0a);
    while (nl !== -1) {
      this._apply(e, parse(data.toString('utf8', 0, nl)), now);
      data = data.subarray(nl + 1);
      nl = data.indexOf(0x0a);
    }
    e.partial = Buffer.from(data);
  }

  _apply(e, rec, now) {
    if (!rec || (e.kind === 'session' && rec.isSidechain)) return;
    const ev = classify(rec);
    if (!ev) return;
    if (ev.kind === 'work') {
      e.state = 'working';
      e.activity = ev.activity;
      e.step++;
      e.endAt = null;
    } else if (ev.kind === 'end') {
      if (e.state === 'working') e.endAt = now;
    } else {
      e.state = 'idle';
      e.endAt = null;
    }
  }

  async _settle(now) {
    const completed = [];
    // A foreground subagent keeps its parent alive while the parent's own file is silent.
    const latestChild = new Map();
    for (const e of this.entries.values()) {
      if (e.kind === 'subagent' && e.state === 'working') {
        latestChild.set(e.parentId, Math.max(latestChild.get(e.parentId) || 0, e.lastWriteAt));
      }
    }

    for (const e of this.entries.values()) {
      if (e.state !== 'working') continue;
      if (e.kind === 'subagent' && e.endAt === null && (await this._metaSaysFinished(e))) {
        e.endAt = now - this.cfg.endDebounceMs;
      }
      if (e.endAt !== null) {
        if (now - e.endAt >= this.cfg.endDebounceMs) {
          e.state = 'idle';
          e.endAt = null;
          completed.push(e.id);
        }
      } else if (now - Math.max(e.lastWriteAt, latestChild.get(e.id) || 0) >= this.cfg.staleMs) {
        e.state = 'idle';
      }
    }

    const agents = this.snapshot();
    const key = JSON.stringify(agents);
    if (key !== this.lastKey || completed.length) {
      this.lastKey = key;
      this.onChange({ agents, completed });
    }
  }

  /** Covers subagents that were stopped and so never wrote a final message. */
  async _metaSaysFinished(e) {
    const metaFile = e.file.replace(/\.jsonl$/, '.meta.json');
    const stat = await statOf(metaFile);
    if (!stat || stat.mtimeMs === e.metaMtime) return false;
    e.metaMtime = stat.mtimeMs;
    const buf = await readRange(metaFile, 0, stat.size);
    const meta = buf && parse(buf.toString('utf8'));
    return !!(meta && meta.finished === true);
  }
}

function parse(line) {
  if (!line) return null;
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

async function listDir(dir) {
  try {
    return await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function statOf(file) {
  try {
    return await fsp.stat(file);
  } catch {
    return null;
  }
}

async function readRange(file, position, length) {
  let fh;
  try {
    fh = await fsp.open(file, 'r');
    const buf = Buffer.alloc(length);
    const { bytesRead } = await fh.read(buf, 0, length, position);
    return buf.subarray(0, bytesRead);
  } catch {
    return null;
  } finally {
    if (fh) await fh.close().catch(() => {});
  }
}

module.exports = { Tracker, classify, activityForTool };
