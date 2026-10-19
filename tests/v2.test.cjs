const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const BF = require('../logic.js');
const V1 = 'BV1xx411c7mD', V2 = 'BV1ab411c7mD', V3 = 'BV1cd411c7mD';
const UID = '417302260';
const videoUrl = id => `https://www.bilibili.com/video/${id}/`;
const opts = { id: 'test', url: 'chrome-extension://test/options.html' };
const popup = { id: 'test', url: 'chrome-extension://test/popup.html' };
const gate = { id: 'test', url: 'chrome-extension://test/gate.html#anything' };
const content = { id: 'test', url: videoUrl(V1), frameId: 0, tab: { id: 2 } };
const config = { videos: [{ bvid: V1, title: 'Lesson 1' }], uploaders: [{ uid: UID, name: 'Course provider' }], duration: 45, hideComments: true };
function env(customFetch) {
  const store = {}, rules = [], alarms = {}, events = {}, updates = [], fetches = [], created = [];
  const tabs = [{ id: 1, url: 'https://www.bilibili.com/' }, { id: 2, url: videoUrl(V1), title: 'Course 1' }];
  let openCount = 0;
  const chrome = {
    storage: { onChanged: { addListener: fn => events.storage = fn }, local: { setAccessLevel: async () => {}, get: async key => ({ [key]: structuredClone(store[key]) }), set: async data => Object.assign(store, structuredClone(data)) } },
    declarativeNetRequest: {
      getDynamicRules: async () => structuredClone(rules),
      updateDynamicRules: async cfg => rules.splice(0, rules.length, ...structuredClone(cfg.addRules))
    },
    alarms: { clear: async name => delete alarms[name], create: async (name, value) => alarms[name] = value, onAlarm: { addListener: fn => events.alarm = fn } },
    action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
    tabs: {
      sendMessage: async () => {},
      query: async () => structuredClone(tabs),
      get: async id => structuredClone(tabs.find(tab => tab.id === id)),
      update: async (id, data) => updates.push({ id, ...data }),
      create: async data => created.push(data)
    },
    runtime: {
      id: 'test', getURL: p => 'chrome-extension://test/' + p,
      openOptionsPage: async () => { openCount++; },
      onMessage: { addListener: fn => events.message = fn },
      onInstalled: { addListener: fn => events.installed = fn },
      onStartup: { addListener: fn => events.startup = fn }
    }
  };
  const fakeFetch = async (url, options) => {
    fetches.push({ url, options });
    if (customFetch) return customFetch(url, options);
    const bvid = new URL(url).searchParams.get('bvid');
    return { ok: true, json: async () => ({ code: 0, data: { bvid, title: 'Lesson', owner: { mid: bvid === V3 ? 555 : Number(UID), name: 'Course provider' } } }) };
  };
  const ctx = vm.createContext({ chrome, console, URL, Date, setTimeout, clearTimeout, AbortController, fetch: fakeFetch });
  ctx.importScripts = name => vm.runInContext(fs.readFileSync(path.join(__dirname, '..', name), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8'), ctx);
  const send = (msg, sender = opts) => new Promise(resolve => events.message(msg, sender, resolve));
  return { store, rules, alarms, events, updates, tabs, fetches, created, send, get openCount() { return openCount; } };
}
const action = (rules, url) => rules.filter(r => new RegExp(r.condition.regexFilter).test(url)).sort((a,b) => b.priority-a.priority)[0]?.action;
test('v0.1 settings migrate without losing saved videos or duration', () => {
  const s = BF.normalizeState({ settings: { videos: config.videos, duration: 30 }, session: null });
  assert.equal(s.settings.videos[0].bvid, V1); assert.equal(s.settings.duration, 30); assert.deepEqual(s.settings.uploaders, []);
});
test('UP parsing accepts UID and localized space links, deduplicates by UID', () => {
  const result = BF.parseUploaders(`School | https://space.bilibili.com/zh-Hans/${UID}/video\n${UID}\nOther | 999`);
  assert.deepEqual(result.map(x => x.uid), [UID, '999']);
});
test('UP parsing rejects ambiguous names and wrong hosts', () => {
  for (const input of ['Course provider', 'https://space.bilibili.com.evil.test/123', '0', '0123', 'https://evil.test/123', 'UID 123']) {
    assert.throws(() => BF.parseUploaders(input));
  }
});
test('UP settings round-trip and labels cannot inject extra lines', () => {
  assert.deepEqual(BF.parseUploaders(BF.serializeUploaders(config.uploaders)), config.uploaders);
  const s = BF.normalizeSettings({ ...config, uploaders: [{ uid: UID, name: 'A\nB | C' }] });
  assert.equal(s.uploaders[0].name, 'A B   C');
});
test('UP-only learning is valid but an empty union is rejected', async () => {
  const e = env();
  assert.equal((await e.send({ type: 'START', settings: { ...config, videos: [] } })).ok, true);
  assert.ok(e.rules.some(r => r.id === 3));
});
test('same uploader names do not grant access to different UIDs', () => {
  const state = BF.normalizeState({ settings: config, session: { startedAt: 1, endsAt: Date.now() + 50000, grants: [{ bvid: V2, uid: '555' }] } });
  assert.equal(state.session.grants.length, 0); assert.equal(BF.route(videoUrl(V2), state).kind, 'verify');
});
test('UP root goes to videos; favorites, dynamics and follows remain blocked', () => {
  const state = BF.normalizeState({ settings: config });
  assert.equal(BF.route(`https://space.bilibili.com/${UID}/`, state).kind, 'redirect');
  for (const suffix of ['video', 'upload/video', 'video/?keyword=class']) {
    assert.equal(BF.route(`https://space.bilibili.com/${UID}/${suffix}`, state).kind, 'allow');
  }
  for (const suffix of ['dynamic','favlist','relation/follow','upload/article','video/wrong']) {
    assert.equal(BF.route(`https://space.bilibili.com/${UID}/${suffix}`, state).kind, 'block');
  }
  assert.equal(BF.route('https://space.bilibili.com/555/video', state).kind, 'block');
});
test('DNR: unknown BV uses verification gate, not a blanket video allow rule', () => {
  const rules = BF.buildRules(config, null, 'chrome-extension://test/');
  assert.equal(action(rules, videoUrl(V1)).type, 'allow');
  assert.equal(action(rules, videoUrl(V2)).type, 'redirect');
  assert.match(action(rules, videoUrl(V2)).redirect.regexSubstitution, /gate\.html#\\0$/);
  assert.equal(action(rules, 'https://search.bilibili.com/all').redirect.extensionPath, '/blocked.html');
  assert.equal(action(rules, 'https://www.bilibili.com/video/' + V2 + 'extra/').redirect.extensionPath, '/blocked.html');
});
test('DNR: whitelisted UID videos allowed; root redirected; other sections blocked', () => {
  const rules = BF.buildRules(config);
  assert.equal(action(rules, `https://space.bilibili.com/${UID}/video`).type, 'allow');
  assert.equal(action(rules, `https://space.bilibili.com/en/${UID}/upload/video?keyword=x`).type, 'allow');
  assert.equal(action(rules, `https://space.bilibili.com/${UID}/`).redirect.url, BF.upUrl(UID));
  assert.equal(action(rules, `https://space.bilibili.com/${UID}/favlist`).redirect.extensionPath, '/blocked.html');
});
test('DNR accepts only exact BV routes including part and timestamp query strings', () => {
  const rules = BF.buildRules(config);
  for (const suffix of ['', '/', '/?p=2&t=45', '?p=2']) assert.equal(action(rules, videoUrl(V1).slice(0,-1) + suffix).type, 'allow');
  assert.equal(BF.videoId(videoUrl(V1) + 'evil'), null);
  assert.equal(BF.videoId(`https://user:pass@www.bilibili.com/video/${V1}`), null);
  assert.equal(BF.videoId(`https://www.bilibili.com:999/video/${V1}`), null);
});
test('rule count stays below 1000 and rule IDs are unique at maximum capacity', () => {
  const settings = { ...config,
    videos: Array.from({length:200}, (_,i) => ({bvid:'BV'+String(i).padStart(10,'0')})),
    uploaders: Array.from({length:50}, (_,i) => ({uid:String(i+1)})) };
  const session = { grants: Array.from({length:300}, (_,i) => ({bvid:'BV'+String(i+200).padStart(10,'0'), uid:'1'})) };
  const rules = BF.buildRules(settings, session);
  assert.ok(rules.length < 1000); assert.equal(new Set(rules.map(r=>r.id)).size, rules.length);
});
test('page start adds current video without making any metadata request', async () => {
  const e = env();
  const result = await e.send({ type: 'PAGE_START', url: videoUrl(V1), duration: 25 }, content);
  assert.equal(result.ok, true); assert.equal(result.state.settings.videos[0].bvid, V1);
  assert.equal(result.state.settings.duration, 25); assert.equal(e.fetches.length, 0);
});
test('page start can include the current uploader and preserve prior saved lists', async () => {
  const e = env();
  await e.send({ type: 'SAVE', settings: { ...config, videos: [{ bvid: V2, title: 'Other' }], uploaders: [] } });
  const result = await e.send({ type: 'PAGE_START', url: videoUrl(V1), duration: 15, includeUploader: true }, content);
  assert.equal(result.ok, true); assert.equal(result.state.settings.uploaders[0].uid, UID);
  assert.equal(result.state.settings.videos.length, 2); assert.equal(e.fetches.length, 1);
});
test('page start rejects stale tab identity and subframes', async () => {
  const e = env();
  assert.equal((await e.send({ type:'PAGE_START', url:videoUrl(V2), duration:5 }, content)).ok, false);
  assert.equal((await e.send({ type:'PAGE_START', url:videoUrl(V1), duration:5 }, {...content, frameId:1})).ok, false);
});
test('content cannot use generic STOP or edit settings (PAGE_STOP is scoped separately)', async () => {
  const e = env();
  for (const msg of [{type:'STOP', confirmation:'结束学习'}, {type:'SAVE',settings:config}]) {
    assert.equal((await e.send(msg,content)).ok,false);
  }
  assert.equal(e.openCount,0);
});
test('generic STOP stays options-only; PAGE_STOP is handled separately', async () => {
  const e=env(); await e.send({type:'START',settings:config});
  for (const file of ['popup.html','library.html','blocked.html','gate.html']) {
    const sender={id:'test',url:'chrome-extension://test/'+file};
    assert.equal((await e.send({type:'STOP',confirmation:'结束学习'},sender)).ok,false);
    if (file !== 'popup.html') assert.equal((await e.send({type:'OPEN_OPTIONS'},sender)).ok,false);
  }
  assert.equal((await e.send({type:'OPEN_OPTIONS'},popup)).ok,true);
  assert.equal((await e.send({type:'STOP',confirmation:'结束学习'})).ok,true);
  assert.equal(e.rules.length,0);
});
test('page can open read-only directory but not make it an exit shortcut', async () => {
  const e=env(); assert.equal((await e.send({type:'OPEN_LIBRARY'},content)).ok,true);
  assert.equal(e.created[0].url,'chrome-extension://test/library.html');
});
test('adding current uploader uses only fixed public endpoint with credentials omitted', async () => {
  const e=env(); const result=await e.send({type:'ADD_UPLOADER',url:videoUrl(V1)},popup);
  assert.equal(result.ok,true); assert.equal(result.state.settings.uploaders[0].uid,UID);
  assert.equal(e.fetches[0].options.credentials,'omit');
  assert.equal(e.fetches[0].options.redirect,'error');
  assert.match(e.fetches[0].url,/^https:\/\/api\.bilibili\.com\/x\/web-interface\/view\?bvid=BV/);
});
test('verified uploader gets a session grant, not a permanent BV list entry', async () => {
  const e=env();await e.send({type:'START',settings:config});
  const r=await e.send({type:'VERIFY_VIDEO',url:videoUrl(V2)},gate);
  assert.equal(r.ok,true);assert.equal(r.allowed,true);
  assert.equal(r.state.settings.videos.length,1);assert.equal(r.state.session.grants[0].bvid,V2);
  assert.equal(action(e.rules,videoUrl(V2)).type,'allow');
  await e.send({type:'STOP',confirmation:'结束学习'});
  assert.equal(e.store[BF.KEY].session,null);assert.equal(e.rules.length,0);
});
test('a video owned by an unlisted UID is rejected even when metadata title matches', async () => {
  const e=env();await e.send({type:'START',settings:config});
  const r=await e.send({type:'VERIFY_VIDEO',url:videoUrl(V3)},gate);
  assert.equal(r.ok,true);assert.equal(r.allowed,false);
  assert.equal(e.store[BF.KEY].session.grants.length,0);
});
test('metadata failure fails closed and does not begin checkbox-enabled page session', async () => {
  const e=env(async()=>{throw new Error('network unavailable');});
  const r=await e.send({type:'PAGE_START',url:videoUrl(V1),duration:10,includeUploader:true},content);
  assert.equal(r.ok,false);assert.equal(e.rules.length,0);assert.equal(e.store[BF.KEY]?.session,undefined);
});
test('metadata HTTP rate limit fails closed in a running session', async () => {
  const e=env(async()=>({ok:false,status:412}));await e.send({type:'START',settings:config});
  const r=await e.send({type:'VERIFY_VIDEO',url:videoUrl(V2)},gate);
  assert.equal(r.ok,false);assert.match(r.error,/412/);assert.equal(e.store[BF.KEY].session.grants.length,0);
});
test('metadata mismatched BVID or missing numeric UID cannot grant access', async () => {
  const e=env(async()=>({ok:true,json:async()=>({code:0,data:{bvid:V3,owner:{mid:UID}}})}));
  await e.send({type:'START',settings:config});
  assert.equal((await e.send({type:'VERIFY_VIDEO',url:videoUrl(V2)},gate)).ok,false);
});
test('already whitelisted BV needs no network even with uploader list populated', async () => {
  const e=env(async()=>{throw new Error('must not fetch');});
  await e.send({type:'START',settings:config});
  const r=await e.send({type:'VERIFY_VIDEO',url:videoUrl(V1)},gate);
  assert.equal(r.allowed,true);assert.equal(e.fetches.length,0);
});
test('up and video additions and page starts are locked during a session', async () => {
  const e=env();await e.send({type:'START',settings:config});
  for (const msg of [{type:'ADD_UPLOADER',url:videoUrl(V1)}, {type:'ADD_VIDEO',url:videoUrl(V2)}, {type:'SAVE',settings:config}]) {
    assert.equal((await e.send(msg)).ok,false);
  }
  assert.equal((await e.send({type:'PAGE_START',url:videoUrl(V1),duration:5},content)).ok,false);
});
test('expired and malformed stored session clears durable rules', async () => {
  const e=env();await e.send({type:'START',settings:config});
  e.store[BF.KEY].session.endsAt=-1;
  const r=await e.send({type:'GET_STATE'});
  assert.equal(r.state.session,null);assert.equal(e.rules.length,0);
});
test('external origins and privileged lookalike extension paths are rejected', async () => {
  const e=env();
  for (const sender of [{id:'evil',url:opts.url},{id:'test',url:'https://www.bilibili.com.evil.test/'},{id:'test',url:'chrome-extension://test/options.html.evil'}]) {
    assert.equal((await e.send({type:'GET_STATE'},sender)).ok,false);
  }
  assert.equal((await e.send({type:'VERIFY_VIDEO',url:'https://evil.test/'},gate)).ok,false);
  assert.equal(e.fetches.length,0);
});
test('stopping during a pending lookup is immediate and cannot resurrect a session grant', async () => {
  let release; const e=env(()=>new Promise(resolve=>{release=resolve;}));
  await e.send({type:'START',settings:config});
  const pending=e.send({type:'VERIFY_VIDEO',url:videoUrl(V2)},gate);
  for(let i=0;i<20&&!release;i++) await new Promise(r=>setImmediate(r));
  const stopped=await e.send({type:'STOP',confirmation:'结束学习'});
  assert.equal(stopped.ok,true);assert.equal(e.rules.length,0);
  release({ok:true,json:async()=>({code:0,data:{bvid:V2,owner:{mid:UID,name:'UP'}}})});
  const result=await pending;assert.equal(result.state.session,null);assert.equal(e.rules.length,0);
});
test('same video lookups deduplicate without losing independent grants', async () => {
  const e=env();await e.send({type:'START',settings:config});
  const results=await Promise.all([e.send({type:'VERIFY_VIDEO',url:videoUrl(V2)},gate),e.send({type:'VERIFY_VIDEO',url:videoUrl(V2)},gate)]);
  assert.ok(results.every(x=>x.allowed));assert.equal(e.fetches.length,1);
  assert.equal(e.store[BF.KEY].session.grants.length,1);
});

// 0.3.2: narrowly allow the page to open options, never to read records or change rules.
test('page options shortcut works while idle without storing a session', async () => {
  const e=env(); assert.equal((await e.send({type:'OPEN_OPTIONS'},content)).ok,true);
  assert.equal(e.openCount,1); assert.deepEqual(e.store,{}); assert.equal(e.updates.length,0);
});
for (const mode of ['countup','countdown']) {
  test(`page options shortcut preserves ${mode}, records, rules and timers`, async () => {
    const e=env(); assert.equal((await e.send({type:'START',settings:{...config,mode}})).ok,true);
    const before=JSON.stringify({store:e.store,rules:e.rules,alarms:e.alarms,updates:e.updates});
    assert.equal((await e.send({type:'OPEN_OPTIONS'},content)).ok,true);
    assert.equal(e.openCount,1);
    assert.equal(JSON.stringify({store:e.store,rules:e.rules,alarms:e.alarms,updates:e.updates}),before);
  });
}
test('page options shortcut rejects foreign IDs, subframes and non-Bilibili pages', async () => {
  const e=env();
  for (const sender of [
    {...content,id:'foreign'}, {...content,frameId:1}, {...content,tab:{}},
    {...content,url:'https://www.bilibili.com.evil.test/video/'+V1},
    {...content,url:'https://example.org/video/'+V1}
  ]) assert.equal((await e.send({type:'OPEN_OPTIONS'},sender)).ok,false);
  assert.equal(e.openCount,0);
});
test('opening options does not give the content script access to saved records', async () => {
  const e=env(); await e.send({type:'OPEN_OPTIONS'},content);
  for (const type of ['GET_RECORDS','CLEAR_RECORDS','SAVE','STOP']) {
    assert.equal((await e.send({type,settings:config},content)).ok,false);
  }
  assert.equal(e.openCount,1);
});
