'use strict';
importScripts('logic.js');
importScripts('records.js');
const REC = BFRecords;
const BF = BiliFocus, ALARM = 'bilifocus-end';
// Local archives must stay in trusted extension pages, never content-script storage events.
const storageReady = chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
storageReady.catch(console.error);
let chain = Promise.resolve(), stateBroadcast = Promise.resolve();
const metadataCache = new Map(), pendingMetadata = new Map();
function serial(task) {
  const run = async () => { await storageReady; return task(); };
  const result = chain.then(run, run);
  chain = result.catch(() => {});
  return result;
}
async function read() {
  const data = await chrome.storage.local.get(BF.KEY);
  return BF.normalizeState(data[BF.KEY]);
}
async function write(state) { await chrome.storage.local.set({ [BF.KEY]: state }); }
async function applyRules(state) {
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existing.map(rule => rule.id),
    addRules: BF.active(state) ? BF.buildRules(state.settings, state.session, chrome.runtime.getURL('')) : []
  });
}
async function timerAndBadge(state) {
  await chrome.alarms.clear(ALARM);
  if (BF.active(state)) await chrome.alarms.create(ALARM, state.session.mode === 'countup' ? { periodInMinutes: 1 } : { when: state.session.endsAt });
  await chrome.action.setBadgeText({ text: BF.active(state) ? 'ON' : '' });
  await chrome.action.setBadgeBackgroundColor({ color: '#2D6457' });
}
async function commit(previous, next) {
  const extra = {};
  if (previous.session && !next.session) {
    const raw = await chrome.storage.local.get(REC.CURRENT_KEY);
    const rec = REC.ensure(raw[REC.CURRENT_KEY], previous.session);
    const end = Math.min(Date.now(), previous.session.endsAt || Date.now());
    const reason = previous.session.mode !== 'countup' && Date.now() >= previous.session.endsAt ? 'completed' : 'manual';
    const stored = await chrome.storage.local.get(REC.HISTORY_KEY);
    extra[REC.HISTORY_KEY] = REC.archive(stored[REC.HISTORY_KEY], REC.finish(rec, end, reason));
    extra[REC.CURRENT_KEY] = null;
  } else if (next.session && previous.session?.id !== next.session.id) {
    extra[REC.CURRENT_KEY] = REC.fresh(next.session);
  }
  await applyRules(next);
  try { await chrome.storage.local.set({ [BF.KEY]: next, ...extra }); }
  catch (error) { await applyRules(previous); throw error; }
  await timerAndBadge(next);
}
async function currentState() {
  const stored = await chrome.storage.local.get(BF.KEY);
  const state = BF.normalizeState(stored[BF.KEY]);
  // Even a malformed/expired stored session must clear durable DNR rules.
  if (stored[BF.KEY]?.session && !BF.active(state)) {
    const next = { settings: state.settings, session: null };
    await commit(state, next);
    return next;
  }
  return state;
}
function gateUrl(url) { return chrome.runtime.getURL('gate.html') + '#' + encodeURIComponent(url); }
async function refreshOpenTabs(state) {
  if (!BF.active(state)) return;
  const tabs = await chrome.tabs.query({ url: ['*://*.bilibili.com/*', '*://bilibili.com/*'] });
  await Promise.all(tabs.map(async tab => {
    const decision = BF.route(tab.url, state);
    const url = decision.kind === 'verify' ? gateUrl(tab.url)
      : decision.kind === 'redirect' ? decision.url
      : decision.kind === 'block' ? chrome.runtime.getURL('blocked.html') : null;
    if (url) { try { await chrome.tabs.update(tab.id, { url }); } catch (_) { /* Tab closed. */ } }
  }));
}
// Fixed public endpoint, no arbitrary fetch URL, no cookies, no account credentials.
// This is not a guaranteed public API contract. Fail closed on outages / rate limits.
async function videoMetadata(bvid) {
  if (!BF.VIDEO_PATTERN.test(bvid)) throw new Error('无效的视频编号。');
  const cached = metadataCache.get(bvid);
  if (cached && cached.until > Date.now()) return cached.data;
  if (pendingMetadata.has(bvid)) return pendingMetadata.get(bvid);
  const request = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`, {
        credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', signal: controller.signal
      });
      if (!response.ok) throw new Error(`B站信息接口返回 HTTP ${response.status}`);
      const json = await response.json();
      const data = json?.data, uid = String(data?.owner?.mid || '');
      if (json?.code !== 0 || data?.bvid !== bvid || !BF.UID_PATTERN.test(uid)) {
        throw new Error('未能确认这条视频的发布账号');
      }
      const out = { bvid, title: BF.cleanLabel(data.title, bvid), uid, name: BF.cleanLabel(data.owner.name, `UP ${uid}`) };
      if (metadataCache.size >= BF.MAX_GRANTS) metadataCache.delete(metadataCache.keys().next().value);
      metadataCache.set(bvid, { data: out, until: Date.now() + 10 * 60000 });
      return out;
    } catch (error) {
      const reason = error.name === 'AbortError' ? '查询超时' : error.message;
      throw new Error(`${reason}。没有自动放行；请稍后重试，或在学习前把该视频单独加入 BV 白名单。`);
    } finally { clearTimeout(timeout); pendingMetadata.delete(bvid); }
  })();
  pendingMetadata.set(bvid, request);
  return request;
}
function addVideo(settings, bvid, title) {
  if (settings.videos.some(v => v.bvid === bvid)) return;
  if (settings.videos.length >= BF.MAX_VIDEOS) throw new Error('视频名单已满，请先在学习空间整理。');
  settings.videos.push({ bvid, title: BF.cleanLabel(String(title || bvid).replace(/_哔哩哔哩_bilibili.*$/, ''), bvid) });
}
function addUploader(settings, metadata) {
  if (settings.uploaders.some(up => up.uid === metadata.uid)) return;
  if (settings.uploaders.length >= BF.MAX_UPLOADERS) throw new Error('UP 主名单已满。');
  settings.uploaders.push({ uid: metadata.uid, name: metadata.name });
}
function unlocked(state) {
  if (BF.active(state)) throw new Error('学习期间名单已锁定。结束后才能修改。');
}
function checkedDuration(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 480) throw new Error('学习时长须为 1 至 480 分钟的整数。');
  return n;
}
function startSession(settings) {
  if (!settings.videos.length && !settings.uploaders.length) throw new Error('请至少添加一个视频或一位 UP 主。');
  const now = Date.now();
  return { settings, session: { id: globalThis.crypto?.randomUUID?.() || `${now}-${Math.random().toString(36).slice(2)}`,
    mode: settings.mode, startedAt: now, endsAt: settings.mode === 'countup' ? null : now + settings.duration * 60000, grants: [] } };
}

// Call only inside the mutation queue. Both entry points share one archive path.
async function endSession(previous, expectedId) {
  if (previous.session && expectedId && previous.session.id !== expectedId) {
    throw new Error('\u5b66\u4e60\u72b6\u6001\u5df2\u53d8\u5316\uff0c\u8bf7\u5237\u65b0\u9875\u9762\u540e\u91cd\u8bd5\u3002');
  }
  if (!previous.session) return { state: previous }; // Double clicks are idempotent.
  const next = { settings: previous.settings, session: null };
  await commit(previous, next);
  return { state: next, endedSessionId: previous.session.id };
}

function roleOf(sender) {
  if (sender.id !== chrome.runtime.id) return null;
  try {
    const u = new URL(sender.url), origin = new URL(chrome.runtime.getURL(''));
    if (u.protocol === origin.protocol && u.host === origin.host) {
      const file = u.pathname.slice(1);
      return ['options.html','popup.html','blocked.html','library.html','gate.html'].includes(file) ? file : null;
    }
    if (sender.frameId === 0 && Number.isInteger(sender.tab?.id) &&
        ['www.bilibili.com','space.bilibili.com'].includes(u.hostname) && BF.parsedUrl(sender.url)) return 'content';
  } catch (_) {}
  return null;
}
async function currentVideoFromSender(sender, message) {
  const tab = await chrome.tabs.get(sender.tab.id);
  const bvid = BF.videoId(tab.url);
  if (!bvid || (message.url && BF.videoId(message.url) !== bvid)) throw new Error('视频页面已变化，请刷新后重试。');
  return { bvid, title: tab.title || bvid, url: tab.url };
}
async function verifyVideo(url) {
  const bvid = BF.videoId(url);
  if (!bvid) throw new Error('只支持 B站电脑版普通 BV 视频。');
  const before = await serial(currentState);
  if (!BF.active(before)) return { state: before, allowed: true };
  const decision = BF.route(url, before);
  if (decision.kind === 'allow') return { state: before, allowed: true };
  if (decision.kind !== 'verify') return { state: before, allowed: false };
  const stamp = `${before.session.startedAt}:${before.session.endsAt}`;
  const data = await videoMetadata(bvid); // Do not hold the mutation queue during a network request.
  return serial(async () => {
    const state = await currentState();
    if (!BF.active(state)) return { state, allowed: true };
    if (`${state.session.startedAt}:${state.session.endsAt}` !== stamp) throw new Error('学习状态已变化，请重试。');
    if (!state.settings.uploaders.some(up => up.uid === data.uid)) return { state, allowed: false };
    const next = BF.normalizeState(state);
    next.session.grants = next.session.grants.filter(g => g.bvid !== bvid);
    next.session.grants.push({ bvid, uid: data.uid });
    next.session.grants = next.session.grants.slice(-BF.MAX_GRANTS);
    await commit(state, next);
    return { state: next, allowed: true };
  });
}

async function recordPlayback(message, sender) {
  return serial(async () => {
    const state = await currentState();
    if (!BF.active(state) || message.sessionId !== state.session.id) return { recorded: false };
    const current = await currentVideoFromSender(sender, message);
    if (REC.partOf(current.url) !== REC.partOf(message.url) || BF.route(current.url, state).kind !== 'allow') return { recorded: false };
    const tab = await chrome.tabs.get(sender.tab.id);
    const eligible = message.eligible === true && (tab.active !== false || message.pip === true);
    const raw = await chrome.storage.local.get(REC.CURRENT_KEY);
    const rec = REC.ensure(raw[REC.CURRENT_KEY], state.session);
    const grant = state.session.grants.find(g => g.bvid === current.bvid);
    const uid = grant?.uid || (BF.UID_PATTERN.test(String(message.uid || '')) ? String(message.uid) : '');
    const up = state.settings.uploaders.find(u => u.uid === uid);
    const metadata = {
      bvid: current.bvid, part: REC.partOf(current.url),
      title: BF.cleanLabel(message.title, current.title || current.bvid),
      partTitle: message.partTitle ? BF.cleanLabel(message.partTitle, '') : '',
      uid, name: up?.name || (message.name ? BF.cleanLabel(message.name, '') : '')
    };
    const token = String(message.documentToken || '').slice(0,80);
    if (!token || !Number.isInteger(message.seq) || message.seq < 0) return { recorded: false };
    const ms = REC.sample(rec, { ...message, eligible }, Date.now(), `${sender.tab.id}:${token}`, metadata);
    await chrome.storage.local.set({ [REC.CURRENT_KEY]: rec });
    return { recorded: ms > 0 };
  });
}
async function getRecords() {
  return serial(async () => {
    const state = await currentState();
    const past = await chrome.storage.local.get(REC.HISTORY_KEY);
    const raw = await chrome.storage.local.get(REC.CURRENT_KEY);
    const store = REC.history(past[REC.HISTORY_KEY]);
    const current = state.session ? REC.publicRecord(REC.ensure(raw[REC.CURRENT_KEY], state.session)) : null;
    return { history: store, current, state };
  });
}

async function dispatch(message, sender) {
  const role = roleOf(sender);
  if (!role) throw new Error('不接受此来源的操作。');
  const type = message?.type;
  if (type === 'TRACK_PLAYBACK') {
    if (role !== 'content') throw new Error('\u53ea\u63a5\u53d7\u89c6\u9891\u9875\u64ad\u653e\u8bb0\u5f55\u3002');
    return recordPlayback(message, sender);
  }
  if (type === 'GET_RECORDS') {
    if (role !== 'options.html') throw new Error('\u8bf7\u4ece\u6269\u5c55\u5b66\u4e60\u7a7a\u95f4\u67e5\u770b\u8bb0\u5f55\u3002');
    return getRecords();
  }
  if (type === 'CLEAR_RECORDS') {
    if (role !== 'options.html' || message.confirmation !== '\u6e05\u7a7a\u5b66\u4e60\u8bb0\u5f55') throw new Error('\u9700\u8981\u5728\u5b66\u4e60\u7a7a\u95f4\u786e\u8ba4\u6e05\u7a7a\u3002');
    return serial(async () => {
      const state = await currentState(); unlocked(state);
      await chrome.storage.local.set({ [REC.HISTORY_KEY]: REC.emptyHistory(), [REC.CURRENT_KEY]: null });
      return { state };
    });
  }
  if (type === 'GET_STATE') return { state: await serial(currentState) };
  if (type === 'OPEN_OPTIONS') {
    if (!['popup.html', 'content'].includes(role)) {
      throw new Error('\u8bf7\u4ece\u89c6\u9891\u9875\u9762\u677f\u6216\u6d4f\u89c8\u5668\u6269\u5c55\u6253\u5f00\u5b66\u4e60\u7a7a\u95f4\u3002');
    }
    await chrome.runtime.openOptionsPage(); return {};
  }
  if (type === 'OPEN_LIBRARY') {
    await chrome.tabs.create({ url: chrome.runtime.getURL('library.html') }); return {};
  }
  if (type === 'VERIFY_VIDEO') {
    if (role !== 'gate.html') throw new Error('请通过视频验证页访问。');
    return verifyVideo(message.url);
  }
  if (type === 'PAGE_STOP') {
    if (role !== 'content') throw new Error('\u8bf7\u4ece\u89c6\u9891\u9875\u7ed3\u675f\u5b66\u4e60\u3002');
    if (typeof message.sessionId !== 'string' || !message.sessionId) {
      throw new Error('\u5b66\u4e60\u72b6\u6001\u4e0d\u5b8c\u6574\uff0c\u8bf7\u5237\u65b0\u9875\u9762\u540e\u91cd\u8bd5\u3002');
    }
    return serial(async () => {
      const old = await currentState();
      const tab = await chrome.tabs.get(sender.tab.id);
      const bvid = BF.videoId(tab.url), up = BF.spaceInfo(tab.url);
      const requestedUp = BF.spaceInfo(message.url);
      const sameVideo = bvid && BF.videoId(message.url) === bvid;
      const sameUp = up?.section === 'video' && requestedUp?.section === 'video' && up.uid === requestedUp.uid;
      if (!sameVideo && !sameUp) throw new Error('\u9875\u9762\u5df2\u53d8\u5316\uff0c\u8bf7\u5237\u65b0\u540e\u91cd\u8bd5\u3002');
      if (BF.active(old) && BF.route(tab.url, old).kind !== 'allow') {
        throw new Error('\u8bf7\u4ece\u5f53\u524d\u767d\u540d\u5355\u89c6\u9891\u6216 UP \u4e3b\u6295\u7a3f\u9875\u7ed3\u675f\u3002');
      }
      return endSession(old, message.sessionId);
    });
  }
  if (type === 'PAGE_START') {
    if (role !== 'content') throw new Error('请从视频页开始。');
    unlocked(await serial(currentState));
    const current = await currentVideoFromSender(sender, message);
    const data = message.includeUploader === true ? await videoMetadata(current.bvid) : null;
    return serial(async () => {
      const old = await currentState(); unlocked(old);
      // Re-read the actual tab after an asynchronous lookup.
      const latest = await currentVideoFromSender(sender, message);
      if (latest.bvid !== current.bvid) throw new Error('视频页面已变化，请重试。');
      const settings = BF.normalizeSettings(old.settings);
      settings.mode = message.mode === 'countup' ? 'countup' : message.mode === 'countdown' ? 'countdown' : settings.mode;
      settings.duration = checkedDuration(message.duration ?? settings.duration);
      addVideo(settings, current.bvid, data?.title || current.title);
      if (data) addUploader(settings, data);
      const next = startSession(settings);
      await commit(old, next); await refreshOpenTabs(next);
      return { state: next };
    });
  }
  if (!['options.html','popup.html'].includes(role)) throw new Error('此页面只能查看学习内容，不能修改名单或退出。');
  if (type === 'STOP' && role !== 'options.html') throw new Error('请从视频页或学习空间结束。');
  if (type === 'ADD_UPLOADER') {
    unlocked(await serial(currentState));
    const bvid = BF.videoId(message.url);
    if (!bvid) throw new Error('先打开该 UP 主发布的普通 BV 视频，再添加账号；也可在学习空间粘贴其空间链接。');
    const data = await videoMetadata(bvid);
    return serial(async () => {
      const old = await currentState(); unlocked(old);
      const next = BF.normalizeState(old); addUploader(next.settings, data);
      await write(next); return { state: next };
    });
  }
  return serial(async () => {
    const old = await currentState();
    switch (type) {
      case 'SAVE':
      case 'START': {
        unlocked(old);
        const settings = BF.normalizeSettings(message.settings);
        settings.duration = checkedDuration(message.settings?.duration);
        const next = type === 'START' ? startSession(settings) : { settings, session: null };
        await commit(old, next);
        if (type === 'START') await refreshOpenTabs(next);
        return { state: next };
      }
      case 'ADD_VIDEO': {
        unlocked(old);
        const bvid = BF.videoId(message.url);
        if (!bvid) throw new Error('请先打开含 BV 号的电脑版普通视频。');
        const next = BF.normalizeState(old); addVideo(next.settings, bvid, message.title);
        await write(next); return { state: next };
      }
      case 'STOP': return endSession(old, message.sessionId);
      default: throw new Error('未知操作，请重新打开扩展。');
    }
  });
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  dispatch(message || {}, sender).then(
    result => respond({ ok: true, ...result }),
    error => respond({ ok: false, error: error.message || String(error) })
  );
  return true;
});
async function reconcile() {
  const state = await currentState();
  await applyRules(state); await timerAndBadge(state); await refreshOpenTabs(state);
}
chrome.runtime.onInstalled.addListener(() => serial(reconcile).catch(console.error));
chrome.runtime.onStartup.addListener(() => serial(reconcile).catch(console.error));
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === ALARM) serial(reconcile).catch(console.error);
});

// Publish only validated settings/session state. Playback/history writes never reach tabs.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[BF.KEY]) return;
  const state = BF.normalizeState(changes[BF.KEY].newValue);
  stateBroadcast = stateBroadcast.then(async () => {
    await storageReady;
    const tabs = await chrome.tabs.query({ url: ['*://www.bilibili.com/*', '*://space.bilibili.com/*'] });
    await Promise.all(tabs.map(async tab => {
      if (!Number.isInteger(tab.id) || !['www.bilibili.com', 'space.bilibili.com'].includes(BF.parsedUrl(tab.url)?.hostname)) return;
      try {
        await chrome.tabs.sendMessage(tab.id, { type: 'BILIFOCUS_STATE_CHANGED', state }, { frameId: 0 });
      } catch (_) { /* An unmatched, closed or not-yet-loaded tab has no receiver. */ }
    }));
  }).catch(console.error);
});
