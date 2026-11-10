'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Tracker, classify, commandKind } = require('../src/tracker');

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
  assert.deepStrictEqual(classify({ type: 'system', subtype: 'api_error', retryInMs: 600 }), { kind: 'work', activity: 'wait' });
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

const call = (name, input, id) => ({
  type: 'assistant',
  message: { role: 'assistant', stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name, input }] },
});
const created = (toolUseId, taskId) => ({
  type: 'user',
  toolUseResult: { task: { id: taskId, subject: 'x' } },
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content: `Task #${taskId} created` }] },
});

test('TodoWrite replaces the whole list', async (t) => {
  const s = setup();
  t.after(s.cleanup);
  await s.tracker.tick();
  s.write(s.file, user('x'), call('TodoWrite', { todos: [{ status: 'completed' }, { status: 'in_progress' }, { status: 'pending' }] }, 't1'));
  await s.tracker.tick();
  assert.deepStrictEqual(s.last().agents[0].tasks, ['completed', 'in_progress', 'pending']);
  s.write(s.file, call('TodoWrite', { todos: [{ status: 'completed' }] }, 't2'));
  await s.tracker.tick();
  assert.deepStrictEqual(s.last().agents[0].tasks, ['completed']);
});

test('TaskCreate and TaskUpdate follow one task at a time', async (t) => {
  const s = setup();
  t.after(s.cleanup);
  await s.tracker.tick();
  s.write(s.file, user('x'), call('TaskCreate', { subject: 'a' }, 'c1'), created('c1', 1), call('TaskCreate', { subject: 'b' }, 'c2'), created('c2', '2'));
  await s.tracker.tick();
  assert.deepStrictEqual(s.last().agents[0].tasks, ['pending', 'pending']);
  s.write(s.file, call('TaskUpdate', { taskId: '1', status: 'in_progress' }, 'u1'));
  await s.tracker.tick();
  assert.deepStrictEqual(s.last().agents[0].tasks, ['in_progress', 'pending']);
  s.write(s.file, call('TaskUpdate', { id: 1, status: 'completed' }, 'u2'), call('TaskUpdate', { taskId: '2', status: 'deleted' }, 'u3'));
  await s.tracker.tick();
  assert.deepStrictEqual(s.last().agents[0].tasks, ['completed']);
});

test('a task whose creation failed is dropped', async (t) => {
  const s = setup();
  t.after(s.cleanup);
  await s.tracker.tick();
  s.write(s.file, user('x'), call('TaskCreate', { subject: 'a' }, 'c1'), {
    type: 'user',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c1', is_error: true, content: 'no' }] },
  });
  await s.tracker.tick();
  assert.deepStrictEqual(s.last().agents[0].tasks, []);
});

test('no list is reported until one is defined', async (t) => {
  const s = setup();
  t.after(s.cleanup);
  await s.tracker.tick();
  s.write(s.file, user('x'), tool('Bash'));
  await s.tracker.tick();
  assert.deepStrictEqual(s.last().agents[0].tasks, []);
});

test('a finished list is cleared by the next request, an unfinished one is kept', async (t) => {
  const s = setup();
  t.after(s.cleanup);
  await s.tracker.tick();
  s.write(s.file, user('x'), call('TodoWrite', { todos: [{ status: 'completed' }, { status: 'pending' }] }, 't1'));
  await s.tracker.tick();
  s.write(s.file, user('continua'));
  await s.tracker.tick();
  assert.strictEqual(s.last().agents[0].tasks.length, 2);

  s.write(s.file, call('TodoWrite', { todos: [{ status: 'completed' }, { status: 'completed' }] }, 't2'));
  await s.tracker.tick();
  assert.strictEqual(s.last().agents[0].tasks.length, 2, 'stays visible while the turn runs');
  s.write(s.file, user('altra richiesta'));
  await s.tracker.tick();
  assert.deepStrictEqual(s.last().agents[0].tasks, []);
});

const PLAN = 'mcp__ccd_turn__update_plan';
const items = (...statuses) => ({ items: statuses.map((status) => ({ content: 'x', status })), scope: 'new_task' });

test('the desktop plan is followed through advance, done and start', async (t) => {
  const s = setup();
  t.after(s.cleanup);
  await s.tracker.tick();
  s.write(s.file, user('x'), call(PLAN, items('in_progress', 'pending', 'pending', 'pending'), 'p1'));
  await s.tracker.tick();
  assert.strictEqual(s.last().agents[0].activity, 'plan');
  assert.deepStrictEqual(s.last().agents[0].tasks, ['in_progress', 'pending', 'pending', 'pending']);
  s.write(s.file, call(PLAN, { advance: true }, 'p2'));
  await s.tracker.tick();
  assert.deepStrictEqual(s.last().agents[0].tasks, ['completed', 'in_progress', 'pending', 'pending']);
  s.write(s.file, call(PLAN, { done: [2], start: 4 }, 'p3'));
  await s.tracker.tick();
  assert.deepStrictEqual(s.last().agents[0].tasks, ['completed', 'completed', 'pending', 'in_progress']);
});

test('the most recently updated open list wins', async (t) => {
  const s = setup();
  t.after(s.cleanup);
  await s.tracker.tick();
  s.write(s.file, user('x'), call(PLAN, items('in_progress'), 'p1'), call('TodoWrite', { todos: [{ status: 'pending' }, { status: 'pending' }] }, 't1'));
  await s.tracker.tick();
  assert.strictEqual(s.last().agents[0].tasks.length, 2);
  s.write(s.file, call(PLAN, items('in_progress', 'pending', 'pending'), 'p2'));
  await s.tracker.tick();
  assert.strictEqual(s.last().agents[0].tasks.length, 3);
});

test('an orchestrator without a list shows its agents as dots', async (t) => {
  const s = setup();
  t.after(s.cleanup);
  await s.tracker.tick();
  s.write(s.file, user('x'), call('Agent', {}, 'spawn-a'));
  s.write(s.subFile('a'), user('task'));
  s.write(s.subFile('b'), user('task'));
  await s.tracker.tick();
  await s.tracker.tick();
  const boss = () => s.tracker.snapshot().find((a) => a.id === SESSION);
  assert.deepStrictEqual(boss().tasks, ['in_progress', 'in_progress']);

  s.write(s.subFile('a'), done());
  await s.tracker.tick();
  s.advance(1600);
  await s.tracker.tick();
  assert.deepStrictEqual([...boss().tasks].sort(), ['completed', 'in_progress']);
});

test('an open list beats the agent dots, a finished one does not', async (t) => {
  const s = setup();
  t.after(s.cleanup);
  await s.tracker.tick();
  s.write(s.file, user('x'), call('TodoWrite', { todos: [{ status: 'in_progress' }, { status: 'pending' }, { status: 'pending' }] }, 't1'));
  s.write(s.subFile('a'), user('task'));
  await s.tracker.tick();
  await s.tracker.tick();
  const boss = () => s.tracker.snapshot().find((a) => a.id === SESSION);
  assert.strictEqual(boss().tasks.length, 3);
  s.write(s.file, call('TodoWrite', { todos: [{ status: 'completed' }, { status: 'completed' }, { status: 'completed' }] }, 't2'));
  await s.tracker.tick();
  assert.deepStrictEqual(boss().tasks, ['in_progress']);
});

test('agents of an earlier request are forgotten, running ones stay', async (t) => {
  const s = setup();
  t.after(s.cleanup);
  await s.tracker.tick();
  s.write(s.file, user('x'), call('Agent', {}, 'spawn-a'));
  s.write(s.subFile('a'), user('task'));
  s.write(s.subFile('b'), user('task'));
  await s.tracker.tick();
  await s.tracker.tick();
  s.write(s.subFile('a'), done());
  await s.tracker.tick();
  s.advance(1600);
  await s.tracker.tick();
  s.write(s.file, user('<task-notification>a finished</task-notification>'));
  await s.tracker.tick();
  assert.strictEqual(s.tracker.snapshot().find((a) => a.id === SESSION).tasks.length, 2, 'a notification is not a new request');
  s.write(s.file, user('nuova richiesta'));
  await s.tracker.tick();
  assert.deepStrictEqual(s.tracker.snapshot().find((a) => a.id === SESSION).tasks, ['in_progress']);
});

test('an agent that was stopped is not shown as completed', async (t) => {
  const s = setup({ staleMs: 5000 });
  t.after(s.cleanup);
  await s.tracker.tick();
  s.write(s.file, user('x'), call('Agent', {}, 'spawn-a'));
  s.write(s.subFile('a'), user('task'));
  s.write(s.subFile('b'), user('task'));
  await s.tracker.tick();
  await s.tracker.tick();
  s.write(s.subFile('a'), user('[Request interrupted by user]'));
  await s.tracker.tick();
  assert.deepStrictEqual([...s.tracker.snapshot().find((a) => a.id === SESSION).tasks].sort(), ['in_progress', 'pending']);
});

test('without a list, past steps are reported as steps and never as dots', async (t) => {
  const s = setup();
  t.after(s.cleanup);
  await s.tracker.tick();
  s.write(s.file, user('x'));
  await s.tracker.tick();
  assert.strictEqual(s.last().agents[0].steps, null, 'no tool has run yet');

  s.write(s.file, tool('Read'), toolResult(), tool('Grep'), toolResult());
  await s.tracker.tick();
  assert.deepStrictEqual(s.last().agents[0].tasks, []);
  assert.deepStrictEqual(s.last().agents[0].steps, { count: 2, kind: 'read' });

  s.write(s.file, tool('Edit'), toolResult(), tool('Bash'));
  await s.tracker.tick();
  assert.deepStrictEqual(s.last().agents[0].tasks, []);
  assert.deepStrictEqual(s.last().agents[0].steps, { count: 4, kind: 'run' });
});

test('steps restart with a new request and yield to a real list', async (t) => {
  const s = setup();
  t.after(s.cleanup);
  await s.tracker.tick();
  s.write(s.file, user('x'), tool('Read'), tool('Edit'));
  await s.tracker.tick();
  assert.strictEqual(s.last().agents[0].steps.count, 2);

  s.write(s.file, call('TodoWrite', { todos: [{ status: 'in_progress' }] }, 't1'));
  await s.tracker.tick();
  assert.deepStrictEqual(s.last().agents[0].tasks, ['in_progress']);
  assert.strictEqual(s.last().agents[0].steps, null);

  s.write(s.file, call('TodoWrite', { todos: [{ status: 'completed' }] }, 't2'));
  await s.tracker.tick();
  assert.deepStrictEqual(s.last().agents[0].tasks, ['completed'], 'a finished list is real and stays');

  s.write(s.file, user('nuova richiesta'), tool('Read'));
  await s.tracker.tick();
  assert.deepStrictEqual(s.last().agents[0].tasks, []);
  assert.deepStrictEqual(s.last().agents[0].steps, { count: 1, kind: 'read' });
});

test('bookkeeping tools are not steps', async (t) => {
  const s = setup();
  t.after(s.cleanup);
  await s.tracker.tick();
  s.write(s.file, user('x'), tool('Read'), tool('TaskList'), tool('AskUserQuestion'), tool('Read'));
  await s.tracker.tick();
  assert.strictEqual(s.tracker.entries.get(s.file).stepCount, 2);
});

test('each agent keeps its own list', async (t) => {
  const s = setup();
  t.after(s.cleanup);
  await s.tracker.tick();
  s.write(s.file, user('x'), call('TodoWrite', { todos: [{ status: 'pending' }] }, 't1'));
  s.write(s.subFile('a'), user('task'), call('TodoWrite', { todos: [{ status: 'completed' }, { status: 'in_progress' }] }, 't2'));
  s.write(s.subFile('b'), user('task'));
  await s.tracker.tick();
  const byId = Object.fromEntries(s.last().agents.map((a) => [a.id, a.tasks]));
  assert.deepStrictEqual(byId, { [SESSION]: ['pending'], 'agent-a': ['completed', 'in_progress'], 'agent-b': [] });
});

test('an orchestrator supervises running agents and celebrates after them', async (t) => {
  const s = setup();
  t.after(s.cleanup);
  await s.tracker.tick();
  s.write(s.file, user('x'), done());
  s.write(s.subFile('a'), user('task'));
  await s.tracker.tick();
  s.advance(1600);
  await s.tracker.tick();
  assert.deepStrictEqual(s.last().completed, []);
  assert.strictEqual(s.last().agents.find((a) => a.id === SESSION).activity, 'supervise');

  s.write(s.subFile('a'), done());
  await s.tracker.tick();
  s.advance(1600);
  await s.tracker.tick();
  assert.deepStrictEqual([...s.last().completed].sort(), ['agent-a', SESSION].sort());
  assert.deepStrictEqual(s.last().agents, []);
});

test('a nested agent is linked to the agent that launched it', async (t) => {
  const s = setup();
  t.after(s.cleanup);
  await s.tracker.tick();
  s.write(s.file, user('x'), call('Agent', {}, 'spawn-a'));
  s.write(s.subFile('a'), user('task'), call('Agent', {}, 'spawn-b'));
  s.write(s.subFile('b'), user('task'));
  fs.writeFileSync(s.subFile('b').replace('.jsonl', '.meta.json'), JSON.stringify({ toolUseId: 'spawn-b' }));
  await s.tracker.tick();
  await s.tracker.tick();
  const b = s.tracker.snapshot().find((a) => a.id === 'agent-b');
  assert.strictEqual(b.parentId, 'agent-a');
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

test('every sidebar view is switched by a setting that exists and is localized', () => {
  const root = path.join(__dirname, '..');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const views = Object.values(manifest.contributes.views).flat();
  const settings = manifest.contributes.configuration.properties;
  assert.strictEqual(new Set(views.map((v) => v.id)).size, views.length);
  for (const file of ['package.nls.json', 'package.nls.it.json']) {
    const strings = JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
    for (const view of views) {
      const setting = settings[view.when.replace(/^config\./, '')];
      assert.strictEqual(setting && setting.type, 'boolean', view.id);
      assert.ok(strings[setting.description.slice(1, -1)], view.id + ' in ' + file);
    }
  }
});

test('commandKind recognizes what a command does', () => {
  const expected = {
    'npm test': 'test',
    'npm run test:unit': 'test',
    'cd "C:/x" && node --test': 'test',
    'CI=1 npx --yes vitest run': 'test',
    'python -m pytest -q | tail -5': 'test',
    'npm run package': 'build',
    'npx --yes @vscode/vsce package': 'build',
    'tsc --noEmit': 'build',
    'npm ci': 'install',
    'pip install flask': 'install',
    'git commit -m "x"': 'commit',
    'git -C "/repo" commit -m "x"': 'commit',
    'git push origin main': 'push',
    'git clone https://example.com/x.git': 'pull',
    'npx --yes @vscode/vsce publish --oidc': 'deploy',
    'wrangler deploy': 'deploy',
    'gh workflow run publish.yml --repo a/b': 'deploy',
  };
  for (const [command, kind] of Object.entries(expected)) assert.strictEqual(commandKind(command), kind, command);
});

test('commandKind names a chained command after its last stage', () => {
  assert.strictEqual(commandKind('npm test && git add . && git commit -m x && git push'), 'push');
  assert.strictEqual(commandKind('npm run build; npm test'), 'test');
});

test('commandKind ignores commands that are only mentioned', () => {
  for (const command of [
    'ls -la',
    'echo "npm test"',
    'grep "git push" notes.txt',
    'git log --oneline',
    'git status',
    'code --install-extension x.vsix',
    "cat <<'EOF'\nnpm test\nEOF",
  ]) {
    assert.strictEqual(commandKind(command), null, command);
  }
  assert.strictEqual(commandKind(undefined), null);
  assert.strictEqual(commandKind('git commit -m "$(cat <<\'EOF\'\nthen git push\nEOF\n)"'), 'commit');
});

test('classify reads the command behind shell tools only', () => {
  const shell = (name, command) => ({
    type: 'assistant',
    message: { stop_reason: 'tool_use', content: [{ type: 'tool_use', name, input: { command } }] },
  });
  assert.strictEqual(classify(shell('Bash', 'npm test')).activity, 'test');
  assert.strictEqual(classify(shell('PowerShell', 'git push')).activity, 'push');
  assert.strictEqual(classify(shell('Bash', 'ls')).activity, 'run');
  assert.strictEqual(classify(shell('Other', 'npm test')).activity, 'tool');
});

function testRun(id, input = {}) {
  return {
    type: 'assistant',
    message: { stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name: 'Bash', input: { command: 'npm test', ...input } }] },
  };
}
const resultOf = (id, content, extra = {}) => ({
  type: 'user',
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, ...extra }] },
});

test('a test run ends in passed or error according to its result', async (t) => {
  const outcomes = [
    [resultOf('r1', '# pass 31\n# fail 0'), 'passed'],
    [resultOf('r1', 'Exit code 1', { is_error: true }), 'error'],
    [resultOf('r1', [{ type: 'text', text: 'Tests: 2 failed, 9 passed' }]), 'error'],
    [resultOf('r1', 'ok\n# fail 3\n'), 'error'],
    [resultOf('other', 'ok'), 'think'],
  ];
  for (const [result, activity] of outcomes) {
    const s = setup();
    t.after(s.cleanup);
    await s.tracker.tick();
    s.write(s.file, user('x'), testRun('r1'));
    await s.tracker.tick();
    assert.strictEqual(s.last().agents[0].activity, 'test');
    s.write(s.file, result);
    await s.tracker.tick();
    assert.strictEqual(s.last().agents[0].activity, activity);
  }
});

test('a test run in the background has no outcome to report', async (t) => {
  const s = setup();
  t.after(s.cleanup);
  await s.tracker.tick();
  s.write(s.file, user('x'), testRun('r1', { run_in_background: true }), resultOf('r1', 'started'));
  await s.tracker.tick();
  assert.strictEqual(s.last().agents[0].activity, 'think');
});

test('a compaction is reported once, even for a resting session', async (t) => {
  const s = setup();
  t.after(s.cleanup);
  await s.tracker.tick();
  s.write(s.file, { type: 'system', subtype: 'compact_boundary' });
  await s.tracker.tick();
  assert.deepStrictEqual(s.last(), { agents: [], completed: [], compacted: [SESSION] });
  const before = s.events.length;
  await s.tracker.tick();
  assert.strictEqual(s.events.length, before);
});

test('a compaction found while catching up is not replayed', async (t) => {
  const s = setup();
  t.after(s.cleanup);
  s.write(s.file, { type: 'system', subtype: 'compact_boundary' }, user('x'));
  await s.tracker.tick();
  assert.strictEqual(s.last().compacted, undefined);
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
