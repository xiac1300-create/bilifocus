const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const B = require('../logic.js');
const R = require('../records.js');
const source = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
const video = 'https://www.bilibili.com/video/BV1xx411c7mD/';
const settings = { videos: [{ bvid: 'BV1xx411c7mD', title: 'Lesson' }], uploaders: [], mode: 'countup', duration: 45 };
function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
function worker(access = Promise.resolve()) {
  const store = {}, events = {}, calls = [], sent = [], errors = [];
  let trusted = false;
  const chrome = {
    storage: {
      local: {
        setAccessLevel: config => {
          calls.push(['access', structuredClone(config)]);
          return access.then(() => { trusted = true; });
        },
        get: async key => {
          assert.equal(trusted, true, 'storage read before trusted access was applied');
          calls.push(['get', key]); return { [key]: structuredClone(store[key]) };
        },
        set: async data => {
          assert.equal(trusted, true, 'storage write before trusted access was applied');
          const changes = {};
          for (const [key, value] of Object.entries(data)) {
            changes[key] = { oldValue: structuredClone(store[key]), newValue: structuredClone(value) };
            store[key] = structuredClone(value);
          }
          events.storage(changes, 'local');
        }
      },
      onChanged: { addListener: fn => events.storage = fn }
    },
    declarativeNetRequest: { getDynamicRules: async () => [], updateDynamicRules: async () => {} },
    alarms: { clear: async () => {}, create: async () => {}, onAlarm: { addListener: fn => events.alarm = fn } },
    action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
    tabs: {
      query: async () => [{ id: 1, url: video }, { id: 2, url: 'https://space.bilibili.com/123/video' }, { id: 3, url: 'https://example.org/' }],
      update: async () => {},
      sendMessage: async (id, message, options) => sent.push(structuredClone({ id, message, options }))
    },
    runtime: {
      id: 'test', getURL: p => 'chrome-extension://test/' + p,
      onMessage: { addListener: fn => events.message = fn },
      onInstalled: { addListener: fn => events.installed = fn },
      onStartup: { addListener: fn => events.startup = fn }
    }
  };
  const context = vm.createContext({ chrome, URL, Date, Intl, setTimeout, clearTimeout, console: { error: e => errors.push(e) } });
  context.importScripts = name => vm.runInContext(source(name), context);
  vm.runInContext(source('background.js'), context);
  const send = message => new Promise(resolve => events.message(message, { id: 'test', url: 'chrome-extension://test/options.html' }, resolve));
  return { store, events, calls, sent, errors, send };
}
test('trusted storage access completes before any read or write', async () => {
  const gate = deferred(), e = worker(gate.promise);
  const response = e.send({ type: 'GET_STATE' });
  await flush();
  assert.deepEqual(e.calls, [['access', { accessLevel: 'TRUSTED_CONTEXTS' }]]);
  gate.resolve();
  assert.equal((await response).ok, true);
  assert.equal(e.calls[1][0], 'get');
});
test('failed trusted storage configuration prevents storage reads', async () => {
  const gate = deferred(), e = worker(gate.promise);
  const response = e.send({ type: 'GET_STATE' });
  gate.reject(new Error('Access setup failed'));
  assert.equal((await response).ok, false);
  assert.equal(e.calls.some(([operation]) => operation === 'get'), false);
});
test('state broadcasts reach matching top frames without records or internal markers', async () => {
  const e = worker();
  e.store[R.HISTORY_KEY] = { sessions: [{ privateNote: 'PRIVATE_HISTORY' }] };
  assert.equal((await e.send({ type: 'START', settings })).ok, true);
  await flush(); await flush();
  assert.deepEqual(e.sent.map(item => item.id), [1, 2]);
  for (const item of e.sent) {
    assert.deepEqual(item.options, { frameId: 0 });
    assert.deepEqual(Object.keys(item.message).sort(), ['state', 'type']);
    assert.equal(item.message.type, 'BILIFOCUS_STATE_CHANGED');
    assert.deepEqual(Object.keys(item.message.state).sort(), ['session', 'settings']);
    assert.equal(item.message.state.session.mode, 'countup');
    assert.doesNotMatch(JSON.stringify(item), /PRIVATE_HISTORY|markers|bilifocus_records|bilifocus_current/);
  }
});
test('history and playback-only storage changes do not broadcast to content', async () => {
  const e = worker();
  e.events.storage({ [R.HISTORY_KEY]: { newValue: { private: true } }, [R.CURRENT_KEY]: { newValue: { markers: {} } } }, 'local');
  e.events.storage({ [B.KEY]: { newValue: {} } }, 'sync');
  await flush();
  assert.equal(e.sent.length, 0);
});
function node(tag = 'div') {
  const classes = new Set();
  const out = {
    tag, children: [], attributes: {}, style: {}, isConnected: true,
    classList: { add: n => classes.add(n), remove: n => classes.delete(n), toggle: (n, yes) => yes ? classes.add(n) : classes.delete(n), contains: n => classes.has(n) },
    setAttribute(name, value) { this.attributes[name] = value; },
    append(...items) { items.forEach(item => { item.parent = this; this.children.push(item); }); },
    remove() { this.isConnected = false; if (this.parent) this.parent.children = this.parent.children.filter(item => item !== this); },
    attachShadow() { return this.shadow = node('shadow'); },
    addEventListener() {}
  };
  return out;
}
async function content(initialState = { settings, session: null }, boot) {
  const root = node('html'), body = node('body'), messages = [];
  let receive;
  const chrome = {
    runtime: {
      id: 'test', getURL: p => 'chrome-extension://test/' + p,
      sendMessage: async message => { messages.push(message); return boot ? boot : { ok: true, state: initialState }; },
      onMessage: { addListener: fn => receive = fn }
    },
    get storage() { throw new Error('Content must not access extension storage'); }
  };
  const document = { documentElement: root, body, createElement: node, addEventListener() {}, querySelectorAll: () => [] };
  const context = vm.createContext({ chrome, document, BiliFocus: B, URL, Date, location: { href: video },
    window: { addEventListener() {} }, setTimeout: () => 1, clearTimeout() {}, setInterval() {} });
  vm.runInContext(source('content.js'), context);
  await flush();
  return { root, body, messages, receive, active: () => root.classList.contains('bf-active') };
}
const activeState = () => ({ settings, session: { id: 'session-test', startedAt: Date.now(), endsAt: null, mode: 'countup', grants: [] } });
test('content bootstraps through GET_STATE while storage is unavailable', async () => {
  const e = await content();
  assert.deepEqual(e.messages.map(message => message.type), ['GET_STATE']);
  assert.equal(e.body.children.length, 1);
  assert.equal(e.active(), false);
});
test('trusted state messages retain overlay start/end updates and reject foreign senders', async () => {
  const e = await content();
  e.receive({ type: 'BILIFOCUS_STATE_CHANGED', state: activeState() }, { id: 'other' });
  assert.equal(e.active(), false);
  e.receive({ type: 'BILIFOCUS_STATE_CHANGED', state: activeState() }, { id: 'test' });
  assert.equal(e.active(), true);
  e.receive({ type: 'BILIFOCUS_STATE_CHANGED', state: { settings, session: null } }, { id: 'test' });
  assert.equal(e.active(), false);
  assert.equal(e.body.children.length, 1);
});
test('a delayed bootstrap cannot replace a newer pushed session state', async () => {
  const gate = deferred(), e = await content(undefined, gate.promise);
  e.receive({ type: 'BILIFOCUS_STATE_CHANGED', state: activeState() }, { id: 'test' });
  gate.resolve({ ok: true, state: { settings, session: null } });
  await flush();
  assert.equal(e.active(), true);
});
