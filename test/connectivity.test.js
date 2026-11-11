'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { Connectivity, resolveUrl, probe, DEFAULT_URL } = require('../src/connectivity');

function settingsFile(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'polipetto-'));
  const file = path.join(dir, 'settings.json');
  fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
  return file;
}

test('the configured address wins over everything else', () => {
  const file = settingsFile({ env: { ANTHROPIC_BASE_URL: 'https://from-settings' } });
  const url = resolveUrl({ configured: ' https://mine ', env: { ANTHROPIC_BASE_URL: 'https://from-env' }, settingsFiles: [file] });
  assert.strictEqual(url, 'https://mine');
});

test('the environment comes before Claude Code settings', () => {
  const file = settingsFile({ env: { ANTHROPIC_BASE_URL: 'https://from-settings' } });
  assert.strictEqual(resolveUrl({ env: { ANTHROPIC_BASE_URL: 'https://from-env' }, settingsFiles: [file] }), 'https://from-env');
});

test('Claude Code settings are used when nothing else is set', () => {
  const broken = settingsFile('{ not json');
  const file = settingsFile({ env: { ANTHROPIC_BASE_URL: 'https://gateway.example' } });
  assert.strictEqual(resolveUrl({ env: {}, settingsFiles: [broken, file] }), 'https://gateway.example');
});

test('falls back to the public API', () => {
  assert.strictEqual(resolveUrl({ env: {}, settingsFiles: [path.join(os.tmpdir(), 'missing-polipetto.json')] }), DEFAULT_URL);
});

test('any HTTP answer counts as reachable, even an error status', async () => {
  const server = http.createServer((req, res) => {
    res.statusCode = 401;
    res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  try {
    assert.strictEqual(await probe(`http://127.0.0.1:${port}/`), true);
  } finally {
    server.close();
  }
});

test('a refused connection or a bad address is unreachable', async () => {
  const server = http.createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  await new Promise((r) => server.close(r));
  assert.strictEqual(await probe(`http://127.0.0.1:${port}/`), false);
  assert.strictEqual(await probe('not a url'), false);
});

test('a server that never answers times out as unreachable', async () => {
  const server = http.createServer(() => {});
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  try {
    assert.strictEqual(await probe(`http://127.0.0.1:${port}/`, 200), false);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test('reports checking, then the result', async () => {
  const states = [];
  let answer = false;
  const link = new Connectivity({ url: 'x', check: async () => answer, onChange: (s) => states.push(s) });
  await link.run();
  answer = true;
  await link.run();
  link.stop();
  assert.deepStrictEqual(states, [
    { online: null, checking: true },
    { online: false, checking: false },
    { online: false, checking: true },
    { online: true, checking: false },
  ]);
});

test('a failing check counts as offline', async () => {
  const states = [];
  const link = new Connectivity({ url: 'x', check: async () => { throw new Error('boom'); }, onChange: (s) => states.push(s) });
  await link.run();
  link.stop();
  assert.deepStrictEqual(states[states.length - 1], { online: false, checking: false });
});
