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
  if (name === 'mcp__ccd_turn__update_plan') return 'plan';
  if (name.startsWith('mcp__') && /browser|chrome/i.test(name)) return 'web';
  return TOOL_ACTIVITY[name] || 'tool';
}

// When one line chains several steps, the last stage of the work names it.
const COMMAND_KINDS = [
  ['deploy', /^((@vscode\/)?vsce\s+publish|npm\s+publish|wrangler\s+(pages\s+)?deploy|vercel\s+(deploy|--prod)|netlify\s+deploy|firebase\s+deploy|fly\s+deploy|docker\s+push|kubectl\s+apply|gh\s+release\s+create|gh\s+workflow\s+run\s+\S*(publish|deploy|release))/],
  ['push', /^git\s+(-\S+\s+(\S+\s+)?)*push\b/],
  ['commit', /^git\s+(-\S+\s+(\S+\s+)?)*commit\b/],
  ['test', /^(npm\s+(run\s+)?t(est)?\b|yarn\s+test\b|pnpm\s+(run\s+)?test\b|bun\s+test\b|node\s+--test\b|pytest\b|python3?\s+-m\s+(pytest|unittest)\b|jest\b|vitest\b|mocha\b|playwright\s+test\b|cargo\s+test\b|go\s+test\b|dotnet\s+test\b|phpunit\b|rspec\b)/],
  ['build', /^(npm\s+run\s+(build|package|compile)\b|yarn\s+(build|package)\b|pnpm\s+(run\s+)?build\b|(@vscode\/)?vsce\s+package\b|tsc\b|webpack\b|vite\s+build\b|next\s+build\b|cargo\s+build\b|go\s+build\b|dotnet\s+build\b|docker\s+build\b|mvn\b|gradle\b|make\b|cmake\b|msbuild\b)/],
  ['install', /^(npm\s+(i|install|ci|add)\b|yarn\s+(add|install)\b|pnpm\s+(i|install|add)\b|bun\s+(add|install)\b|pip3?\s+install\b|python3?\s+-m\s+pip\s+install\b|composer\s+(install|require)\b|cargo\s+add\b|go\s+get\b|gem\s+install\b|brew\s+install\b|winget\s+install\b|choco\s+install\b|apt(-get)?\s+install\b)/],
  ['pull', /^git\s+(-\S+\s+(\S+\s+)?)*(pull|fetch|clone)\b/],
];
const COMMAND_PREFIX = /^(\(\s*|&\s*|[A-Za-z_][A-Za-z0-9_]*=\S*\s+|sudo\s+|command\s+|time\s+|timeout\s+\S+\s+|npx\s+((--yes|-y)\s+)?|\.\/|node_modules\/\.bin\/|vendor\/bin\/)/;
const TEST_FAILED = /(^|\n)\s*(#|ℹ)\s*fail\s+[1-9]|\b[1-9]\d* (failed|failing)\b/i;

/** Only real commands count: text inside strings and heredocs is not something being run. */
function commandSegments(command) {
  return command
    .replace(/<<-?\s*['"]?(\w+)['"]?[\s\S]*?^\s*\1\s*$/gm, '')
    .replace(/@(['"])[\s\S]*?^\1@/gm, '""')
    .replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, '""')
    .split(/&&|\|\||[;|\n]/)
    .map((segment) => {
      let s = segment.trim();
      for (let prev = ''; prev !== s; ) {
        prev = s;
        s = s.replace(COMMAND_PREFIX, '');
      }
      return s;
    });
}

function commandKind(command) {
  if (typeof command !== 'string') return null;
  const segments = commandSegments(command);
  const found = COMMAND_KINDS.find(([, pattern]) => segments.some((s) => pattern.test(s)));
  return found ? found[0] : null;
}

function activityForToolUse(block) {
  const kind = /^(Bash|PowerShell)$/.test(block.name) && commandKind(block.input && block.input.command);
  return kind || activityForTool(block.name);
}

/** 'passed' or 'error' when this record reports the end of a test run we were following. */
function testOutcome(e, rec) {
  const content = rec.message && rec.message.content;
  if (rec.type !== 'user' || !Array.isArray(content)) return null;
  let outcome = null;
  for (const b of content) {
    if (!b || b.type !== 'tool_result' || !e.testRuns.delete(b.tool_use_id)) continue;
    // A pipe such as "| tail" hides the exit code, but the runner's summary is still there.
    if (b.is_error || TEST_FAILED.test(textOf(b.content))) return 'error';
    outcome = 'passed';
  }
  return outcome;
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter((b) => b && b.type === 'text').map((b) => b.text || '').join('\n');
}

/** Maps one transcript record to null, {kind:'work',activity}, {kind:'end'} or {kind:'abort'}. */
function classify(rec) {
  if (rec && rec.type === 'system' && rec.subtype === 'api_error') {
    // Claude Code retries on its own, so a dropped connection or a rate limit is only a wait.
    return { kind: 'work', activity: rec.retryInMs !== undefined ? 'wait' : 'error' };
  }
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
    if (tool) return { kind: 'work', activity: activityForToolUse(tool) };
    const stop = rec.message.stop_reason;
    if (stop === 'tool_use' || !stop || stop === 'pause_turn') return { kind: 'work', activity: 'think' };
    return { kind: 'end' };
  }

  return null;
}

const TASK_STATUSES = new Set(['pending', 'in_progress', 'completed']);
const SPAWN_TOOLS = new Set(['Agent', 'Task']);

const PLAN_TOOL = 'mcp__ccd_turn__update_plan';
// A single dot is not a sequence; a long run of one kind of work still grows.
const MIN_PHASES = 2;
const CALLS_PER_DOT = 3;
let touchCounter = 0;

function taskStatus(status) {
  return TASK_STATUSES.has(status) ? status : 'pending';
}

/** The Claude desktop app's plan: a whole list, or moves through it by 1-based step number. */
function applyPlan(e, input) {
  if (Array.isArray(input.items)) {
    e.plan = input.items.map((item) => ({ status: taskStatus(item && item.status) }));
    return;
  }
  const setStep = (step, status) => {
    const item = e.plan[step - 1];
    if (item) item.status = status;
  };
  if (input.advance === true) {
    const current = e.plan.find((item) => item.status === 'in_progress');
    if (current) current.status = 'completed';
    const next = e.plan.find((item) => item.status === 'pending');
    if (next) next.status = 'in_progress';
  }
  if (Array.isArray(input.done)) input.done.forEach((step) => setStep(step, 'completed'));
  if (typeof input.start === 'number') setStep(input.start, 'in_progress');
}

/** Reading and searching are one phase of the work; bookkeeping tools are not work at all. */
function phaseForTool(name) {
  const activity = activityForTool(name);
  if (activity === 'plan' || activity === 'ask') return null;
  return activity === 'search' ? 'read' : activity;
}

function recordPhase(e, toolName) {
  const phase = phaseForTool(toolName);
  if (!phase) return;
  if (e.phases[e.phases.length - 1] === phase && e.phaseCalls < CALLS_PER_DOT) {
    e.phaseCalls++;
  } else {
    e.phases.push(phase);
    e.phaseCalls = 1;
  }
}

function isUserRequest(rec) {
  if (rec.type !== 'user') return false;
  const content = rec.message && rec.message.content;
  if (Array.isArray(content) && content.some((b) => b && b.type === 'tool_result')) return false;
  return !/^\s*<task-notification/.test(textOf(content));
}

/** Keeps e.tasks in step with TodoWrite (whole list) and TaskCreate/TaskUpdate (one item). */
function updateTasks(e, rec) {
  const content = rec.message && rec.message.content;
  if (!Array.isArray(content)) return;

  if (rec.type === 'assistant') {
    for (const b of content) {
      if (!b || b.type !== 'tool_use') continue;
      const input = b.input || {};
      if (b.name === PLAN_TOOL) {
        applyPlan(e, input);
        e.planTouched = ++touchCounter;
      } else if (b.name === 'TodoWrite' || b.name === 'TaskCreate' || b.name === 'TaskUpdate') {
        e.tasksTouched = ++touchCounter;
      }
      if (b.name === 'TodoWrite' && Array.isArray(input.todos)) {
        e.tasks = input.todos.map((t) => ({ id: null, toolUseId: null, status: taskStatus(t && t.status) }));
      } else if (b.name === 'TaskCreate') {
        e.tasks.push({ id: null, toolUseId: b.id, status: 'pending' });
      } else if (b.name === 'TaskUpdate') {
        const id = String(input.taskId !== undefined ? input.taskId : input.id !== undefined ? input.id : input.task_id);
        const task = e.tasks.find((t) => t.id === id);
        if (!task) continue;
        if (input.status === 'deleted') e.tasks = e.tasks.filter((t) => t !== task);
        else if (input.status) task.status = taskStatus(input.status);
      }
    }
  } else if (rec.type === 'user') {
    for (const b of content) {
      if (!b || b.type !== 'tool_result') continue;
      const created = e.tasks.find((t) => t.toolUseId === b.tool_use_id);
      if (!created) continue;
      created.toolUseId = null;
      if (b.is_error) {
        e.tasks = e.tasks.filter((t) => t !== created);
        continue;
      }
      const fromResult = rec.toolUseResult && rec.toolUseResult.task && rec.toolUseResult.task.id;
      const fromText = /#(\d+)/.exec(textOf(b.content));
      if (fromResult !== undefined && fromResult !== null) created.id = String(fromResult);
      else if (fromText) created.id = fromText[1];
    }
  }
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
    this.toolOwners = new Map();
    this.compacted = new Set();
    this.baselined = false;
    this.lastDiscover = -Infinity;
    this.lastKey = '[]';
    this.ticking = false;
  }

  /** Open list or plan first, then the agents this one launched, then a finished list. */
  _relevantList(e) {
    const lists = [
      { items: e.tasks, touched: e.tasksTouched },
      { items: e.plan, touched: e.planTouched },
    ]
      .filter((list) => list.items.length > 0)
      .sort((a, b) => b.touched - a.touched);
    const open = lists.find((list) => list.items.some((item) => item.status !== 'completed'));
    if (open) return open.items.map((item) => item.status);
    if (e.agentRuns.size > 0) {
      return [...e.agentRuns.values()].map((child) => {
        if (child.state === 'working') return 'in_progress';
        return child.finishedOk ? 'completed' : 'pending';
      });
    }
    if (e.phases.length >= MIN_PHASES) {
      const last = e.phases.length - 1;
      return e.phases.map((_, i) => (i === last && e.state === 'working' ? 'in_progress' : 'completed'));
    }
    return lists.length ? lists[0].items.map((item) => item.status) : [];
  }

  _rememberAgentRuns() {
    const byId = new Map();
    for (const e of this.entries.values()) byId.set(e.id, e);
    for (const e of this.entries.values()) {
      if (e.state !== 'working') continue;
      const parent = byId.get(this._parentId(e));
      if (parent) parent.agentRuns.set(e.id, e);
    }
  }

  /** A new request starts clean: finished lists and finished agents belong to the last one. */
  _startRequest(e) {
    if (e.tasks.every((t) => t.status === 'completed')) e.tasks = [];
    if (e.plan.every((t) => t.status === 'completed')) e.plan = [];
    e.phases = [];
    e.phaseCalls = 0;
    for (const [id, child] of e.agentRuns) {
      if (child.state !== 'working') e.agentRuns.delete(id);
    }
  }

  /** A nested agent answers to whoever launched it; the session is only the fallback. */
  _parentId(e) {
    if (e.kind === 'session') return null;
    const owner = e.toolUseId && this.toolOwners.get(e.toolUseId);
    return owner && owner !== e.id ? owner : e.parentId;
  }

  /** Ids of every agent that still has a working agent somewhere below it. */
  _busyParents() {
    const byId = new Map();
    for (const e of this.entries.values()) byId.set(e.id, e);
    const busy = new Set();
    for (const e of this.entries.values()) {
      if (e.state !== 'working') continue;
      let id = this._parentId(e);
      while (id && !busy.has(id)) {
        busy.add(id);
        const parent = byId.get(id);
        id = parent ? this._parentId(parent) : null;
      }
    }
    return busy;
  }

  snapshot() {
    const agents = [];
    const busy = this._busyParents();
    for (const e of this.entries.values()) {
      if (e.state === 'working' || busy.has(e.id)) {
        agents.push({
          id: e.id,
          kind: e.kind,
          parentId: this._parentId(e),
          activity: e.state === 'working' ? e.activity : 'supervise',
          step: e.step,
          tasks: this._relevantList(e),
        });
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
      tasks: [],
      plan: [],
      phases: [],
      phaseCalls: 0,
      testRuns: new Set(),
      tasksTouched: 0,
      planTouched: 0,
      agentRuns: new Map(),
      finishedOk: false,
      toolUseId: null,
      pendingCompletion: false,
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
    this.compacted.delete(e.id);
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
    // Written only once the compaction is over, so it can be a brief reaction and nothing more.
    if (rec.type === 'system' && rec.subtype === 'compact_boundary') this.compacted.add(e.id);
    updateTasks(e, rec);
    if (rec.type === 'assistant' && Array.isArray(rec.message && rec.message.content)) {
      for (const b of rec.message.content) {
        if (b && b.type === 'tool_use' && SPAWN_TOOLS.has(b.name)) this.toolOwners.set(b.id, e.id);
        if (b && b.type === 'tool_use') recordPhase(e, b.name);
        // A background run reports only that it started, which says nothing about the tests.
        if (b && b.type === 'tool_use' && activityForToolUse(b) === 'test' && !(b.input && b.input.run_in_background)) {
          e.testRuns.add(b.id);
        }
      }
    }
    const ev = classify(rec);
    if (!ev) return;
    if (ev.kind === 'work') {
      if (isUserRequest(rec)) this._startRequest(e);
      e.state = 'working';
      e.finishedOk = false;
      e.activity = testOutcome(e, rec) || ev.activity;
      e.step++;
      e.endAt = null;
      e.pendingCompletion = false;
    } else if (ev.kind === 'end') {
      if (e.state === 'working') e.endAt = now;
    } else {
      e.state = 'idle';
      e.endAt = null;
      e.pendingCompletion = false;
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
          e.pendingCompletion = true;
          e.finishedOk = true;
        }
      } else if (now - Math.max(e.lastWriteAt, latestChild.get(e.id) || 0) >= this.cfg.staleMs) {
        e.state = 'idle';
      }
    }

    // An orchestrator celebrates only once the agents below it are done.
    const busy = this._busyParents();
    for (const e of this.entries.values()) {
      if (e.pendingCompletion && !busy.has(e.id)) {
        e.pendingCompletion = false;
        completed.push(e.id);
      }
    }

    this._rememberAgentRuns();
    const agents = this.snapshot();
    const key = JSON.stringify(agents);
    const compacted = [...this.compacted];
    this.compacted.clear();
    if (key !== this.lastKey || completed.length || compacted.length) {
      this.lastKey = key;
      this.onChange(compacted.length ? { agents, completed, compacted } : { agents, completed });
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
    if (meta && meta.toolUseId) e.toolUseId = meta.toolUseId;
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

module.exports = { Tracker, classify, activityForTool, commandKind, updateTasks, phaseForTool, isUserRequest };
