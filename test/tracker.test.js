'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Tracker, classify } = require('../src/tracker');

const SESSION = 'sess-1';
const user = (text) => ({ type: 'user', message: { role: 'user', content: text } });
const toolResult = () => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } });
const tool = (name) => ({
  type: 'assistant',
  message: { role: 'assistant', stop_reason: 'tool_use', content: [{ type: 'tool_use', name }] },
});
const done = () => ({
  type: 'assistant',
  message: { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: 'fine' }] },
});

function setup(opts = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'polipetto-'));
  const project = path.join(root, 'proj');
  fs.mkdirSync(project);
  const file = path.join(project, SESSION + '.jsonl');
  const events = [];
  let offset = 0;
  const tracker = new Tracker({
    root,
    discoverEveryMs: 0,
    now: () => Date.now() + offset,
    onChange: (s) => events.push(s),
    ...opts,
  });
  const write = (f, ...recs) => {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.appendFileSync(f, recs.map((r) => JSON.stringify(r) + '\n').join(''));
  };
  return {
    tracker,
    file,
    project,
    events,
    write,
    advance: (ms) => {
      offset += ms;
    },
    last: () => events[events.length - 1],
    subFile: (id) => path.join(project, SESSION, 'subagents', `agent-${id}.jsonl`),
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

test('classify ignores local commands and meta records', () => {
  assert.strictEqual(classify(user('<command-name>/clear</command-name>')), null);
  assert.strictEqual(classify(user('<local-command-stdout>x</local-command-stdout>')), null);
  assert.strictEqual(classify({ ...user('x'), isMeta: true }), null);
  assert.strictEqual(classify({ type: 'attachment' }), null);
});

test('classify maps tools to activities', () => {
  const expected = {
    Bash: 'run',
    PowerShell: 'run',
    Edit: 'write',
    Write: 'write',
    Read: 'read',
    Grep: 'search',
    Glob: 'search',
    WebSearch: 'web',
    mcp__Claude_Browser__navigate: 'web',
    Agent: 'delegate',
    AskUserQuestion: 'ask',
    TodoWrite: 'plan',
    mcp__github__list_issues: 'tool',
  };
  for (const [name, activity] of Object.entries(expected)) {
    assert.strictEqual(classify(tool(name)).activity, activity, name);
  }
  assert.strictEqual(classify(user('[Request interrupted by user]')).kind, 'abort');
});

test('classify reports failed tools and API errors', () => {
  const failed = { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', is_error: true, content: 'Exit code 1' }] } };
  assert.deepStrictEqual(classify(failed), { kind: 'work', activity: 'error' });
  assert.deepStrictEqual(classify({ type: 'system', subtype: 'api_error' }), { kind: 'work', activity: 'error' });
  assert.strictEqual(classify(toolResult()).activity, 'think');
  assert.strictEqual(classify({ type: 'system', subtype: 'stop_hook_summary' }), null);
});

test('a turn goes working, follows tools, then completes once', async (t) => {
  const s = setup();
  t.after(s.cleanup);
  await s.tracker.tick();
  s.write(s.file, user('ciao'));
  await s.tracker.tick();
  assert.strictEqual(s.last().agents[0].activity, 'think');

  s.write(s.file, tool('Read'));
  await s.tracker.tick();
  assert.strictEqual(s.last().agents[0].activity, 'read');

  s.write(s.file, toolResult(), done());
  await s.tracker.tick();
  assert.strictEqual(s.last().agents.length, 1, 'still working during debounce');

  s.advance(1600);
  await s.tracker.tick();
  assert.deepStrictEqual(s.last(), { agents: [], completed: [SESSION] });

  const count = s.events.length;
  s.advance(5000);
  await s.tracker.tick();
  assert.strictEqual(s.events.length, count, 'no repeated completion');
});

test('each step notifies even when the activity stays the same', async (t) => {
  const s = setup();
  t.after(s.cleanup);
  await s.tracker.tick();
  s.write(s.file, user('x'));
  await s.tracker.tick();
  const first = s.last().agents[0].step;
  s.write(s.file, toolResult());
  await s.tracker.tick();
  assert.strictEqual(s.last().agents[0].activity, 'think');
  assert.ok(s.last().agents[0].step > first);
});

test('a second message block during debounce cancels completion', async (t) => {
  const s = setup();
  t.after(s.cleanup);
  await s.tracker.tick();
  s.write(s.file, user('x'), done());
  await s.tracker.tick();
  s.advance(1000);
  s.write(s.file, tool('Edit'));
  await s.tracker.tick();
  s.advance(2000);
  await s.tracker.tick();
  assert.deepStrictEqual(s.last().completed, []);
  assert.strictEqual(s.last().agents[0].activity, 'write');
});

test('subagents appear one per agent and complete independently', async (t) => {
  const s = setup();
  t.after(s.cleanup);
  await s.tracker.tick();
  s.write(s.file, user('x'), tool('Agent'));
  s.write(s.subFile('a'), user('task a'), tool('Read'));
  s.write(s.subFile('b'), user('task b'), tool('Bash'));
  await s.tracker.tick();
  assert.deepStrictEqual(s.last().agents.map((a) => a.id), [SESSION, 'agent-a', 'agent-b']);
  assert.strictEqual(s.last().agents[1].parentId, SESSION);

  s.write(s.subFile('a'), done());
  await s.tracker.tick();
  s.advance(1600);
  await s.tracker.tick();
  assert.deepStrictEqual(s.last().completed, ['agent-a']);
  assert.deepStrictEqual(s.last().agents.map((a) => a.id), [SESSION, 'agent-b']);
});

test('a stopped subagent finishes through its meta file', async (t) => {
  const s = setup();
  t.after(s.cleanup);
  await s.tracker.tick();
  s.write(s.subFile('a'), user('task'));
  await s.tracker.tick();
  // The session file must exist for the subagent directory to be scanned.
  assert.ok(s.events.length === 0 || s.last().agents.length === 0);
  s.write(s.file, user('x'));
  await s.tracker.tick();
  assert.strictEqual(s.last().agents.length, 2);
  fs.writeFileSync(s.subFile('a').replace('.jsonl', '.meta.json'), '{"finished":true}');
  await s.tracker.tick();
  assert.deepStrictEqual(s.last().completed, ['agent-a']);
});

test('history already on disk never celebrates', async (t) => {
  const s = setup();
  t.after(s.cleanup);
  s.write(s.file, user('old'), done());
  s.write(s.subFile('old'), user('old task'), done());
  await s.tracker.tick();
  s.advance(5000);
  await s.tracker.tick();
  assert.strictEqual(s.events.length, 0);
});

test('a session already working at startup is picked up', async (t) => {
  const s = setup();
  t.after(s.cleanup);
  s.write(s.file, user('running'), tool('Grep'));
  await s.tracker.tick();
  assert.strictEqual(s.last().agents[0].activity, 'search');
  assert.deepStrictEqual(s.last().completed, []);
});

test('interrupt returns to idle without celebrating', async (t) => {
  const s = setup();
  t.after(s.cleanup);
  await s.tracker.tick();
  s.write(s.file, user('x'));
  await s.tracker.tick();
  s.write(s.file, user('[Request interrupted by user]'));
  await s.tracker.tick();
  assert.deepStrictEqual(s.last(), { agents: [], completed: [] });
});

test('a silent session goes stale quietly, but a live subagent keeps it alive', async (t) => {
  const s = setup({ staleMs: 10000 });
  t.after(s.cleanup);
  await s.tracker.tick();
  s.write(s.file, user('x'), tool('Agent'));
  s.write(s.subFile('a'), user('task'));
  await s.tracker.tick();

  s.advance(8000);
  s.write(s.subFile('a'), tool('Read'));
  await s.tracker.tick();
  s.advance(8000);
  await s.tracker.tick();
  assert.strictEqual(s.last().agents.length, 2, 'parent kept alive by child');

  s.advance(3000);
  await s.tracker.tick();
  assert.deepStrictEqual(s.last(), { agents: [], completed: [] });
});

test('a record split across reads, inside a multi-byte character, is parsed', async (t) => {
  const s = setup();
  t.after(s.cleanup);
  await s.tracker.tick();
  const line = Buffer.from(JSON.stringify(user('perché 🐙')) + '\n');
  const cut = line.indexOf(Buffer.from('🐙')) + 2;
  fs.mkdirSync(path.dirname(s.file), { recursive: true });
  fs.writeFileSync(s.file, line.subarray(0, cut));
  await s.tracker.tick();
  assert.ok(s.events.length === 0 || s.last().agents.length === 0);
  fs.appendFileSync(s.file, line.subarray(cut));
  await s.tracker.tick();
  assert.strictEqual(s.last().agents.length, 1);
});
