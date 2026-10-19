/* Shared validation and routing. This file performs no network requests. */
(function (root) {
  'use strict';
  const KEY = 'bilifocus_v1'; // Keep v0.1 storage when the existing installation is reloaded.
  const VIDEO_PATTERN = /^BV[0-9A-Za-z]{10}$/;
  const UID_PATTERN = /^[1-9][0-9]{0,19}$/;
  const MAX_VIDEOS = 200, MAX_UPLOADERS = 50, MAX_GRANTS = 300;
  const cleanLabel = (value, fallback) => String(value || fallback).replace(/[\r\n|]/g, ' ').trim().slice(0, 100) || fallback;
  const defaults = () => ({ videos: [], uploaders: [], duration: 45, mode: 'countdown', hideComments: true });
  function normalizeSettings(input) {
    const out = defaults();
    if (!input || typeof input !== 'object') return out;
    const bvSeen = new Set(), uidSeen = new Set();
    for (const item of (Array.isArray(input.videos) ? input.videos : [])) {
      if (!item || !VIDEO_PATTERN.test(item.bvid) || bvSeen.has(item.bvid)) continue;
      bvSeen.add(item.bvid);
      out.videos.push({ bvid: item.bvid, title: cleanLabel(item.title, item.bvid) });
      if (out.videos.length >= MAX_VIDEOS) break;
    }
    for (const item of (Array.isArray(input.uploaders) ? input.uploaders : [])) {
      const uid = String(item?.uid || '');
      if (!UID_PATTERN.test(uid) || uidSeen.has(uid)) continue;
      uidSeen.add(uid);
      out.uploaders.push({ uid, name: cleanLabel(item.name, `UP ${uid}`) });
      if (out.uploaders.length >= MAX_UPLOADERS) break;
    }
    if (Number.isInteger(Number(input.duration)) && Number(input.duration) >= 1 && Number(input.duration) <= 480) {
      out.duration = Number(input.duration);
    }
    out.mode = input.mode === 'countup' ? 'countup' : 'countdown';
    out.hideComments = input.hideComments !== false;
    return out;
  }
  function normalizeState(input) {
    const value = input && typeof input === 'object' ? input : {};
    const settings = normalizeSettings(value.settings);
    const start = Number(value.session?.startedAt), end = Number(value.session?.endsAt);
    let session = null;
    const mode = value.session?.mode === 'countup' ? 'countup' : 'countdown';
    if (Number.isFinite(start) && start > 0 && (mode === 'countup' || (Number.isFinite(end) && end > start))) {
      const grants = [], seen = new Set();
      for (const item of (Array.isArray(value.session?.grants) ? value.session.grants : [])) {
        if (!item || !VIDEO_PATTERN.test(item.bvid) || seen.has(item.bvid)) continue;
        const uid = String(item.uid);
        if (!settings.uploaders.some(up => up.uid === uid)) continue;
        seen.add(item.bvid);
        grants.push({ bvid: item.bvid, uid });
      }
      session = { id: String(value.session.id || ('legacy-' + start)).slice(0, 100), mode, startedAt: start,
        endsAt: mode === 'countup' ? null : end, grants: grants.slice(-MAX_GRANTS) };
    }
    return { settings, session };
  }
  const active = (state, now = Date.now()) => !!(state?.session && (state.session.mode === 'countup' || state.session.endsAt > now));
  function parsedUrl(value) {
    try {
      const url = new URL(value);
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) return null;
      return url;
    } catch (_) { return null; }
  }
  function videoId(value) {
    const url = parsedUrl(value);
    if (url?.hostname !== 'www.bilibili.com') return null;
    return url.pathname.match(/^\/video\/(BV[0-9A-Za-z]{10})(?:\/)?$/)?.[1] || null;
  }
  // Support canonical, older /video, newer /upload/video, and localized space URLs.
  function spaceInfo(value) {
    const url = parsedUrl(value);
    if (url?.hostname !== 'space.bilibili.com') return null;
    const match = url.pathname.match(/^\/(?:[a-z]{2}(?:-[A-Za-z]{2,8})?\/)?([1-9][0-9]{0,19})(?:\/(.*))?$/);
    if (!match) return null;
    const path = (match[2] || '').replace(/\/$/, '');
    return { uid: match[1], section: !path ? 'root' : /^(?:video|upload\/video)$/.test(path) ? 'video' : 'other' };
  }
  const upUrl = uid => `https://space.bilibili.com/${uid}/video`;
  function route(value, state) {
    const url = parsedUrl(value);
    if (!url) return { kind: 'block' };
    if (url.hostname !== 'bilibili.com' && !url.hostname.endsWith('.bilibili.com')) return { kind: 'external' };
    if (url.hostname === 'passport.bilibili.com') return { kind: 'allow' };
    const bvid = videoId(value), settings = state.settings;
    if (bvid) {
      if (settings.videos.some(v => v.bvid === bvid)) return { kind: 'allow', bvid };
      const grant = (state.session?.grants || []).find(g => g.bvid === bvid && settings.uploaders.some(up => up.uid === g.uid));
      if (grant) return { kind: 'allow', bvid, uid: grant.uid };
      return { kind: settings.uploaders.length ? 'verify' : 'block', bvid };
    }
    const space = spaceInfo(value);
    if (space && settings.uploaders.some(up => up.uid === space.uid)) {
      if (space.section === 'root') return { kind: 'redirect', url: upUrl(space.uid) };
      if (space.section === 'video') return { kind: 'allow', uid: space.uid };
    }
    return { kind: 'block' };
  }
  function allowedUrl(value, settings, session = null) {
    return route(value, { settings: normalizeSettings(settings), session }).kind === 'allow';
  }
  function parseList(text) {
    const out = [], seen = new Set();
    for (const [index, raw] of String(text).split(/\r?\n/).entries()) {
      const line = raw.trim();
      if (!line) continue;
      const matches = [...line.matchAll(/\bBV[0-9A-Za-z]{10}\b/g)];
      if (!matches.length) throw new Error(`第 ${index + 1} 行没有完整 BV 号。短链接请先打开，再复制完整视频地址。`);
      const label = line.includes('|') ? line.split('|')[0].trim() : '';
      for (const [bvid] of matches) {
        if (seen.has(bvid)) continue;
        seen.add(bvid); out.push({ bvid, title: cleanLabel(label, bvid) });
      }
    }
    if (out.length > MAX_VIDEOS) throw new Error(`最多保存 ${MAX_VIDEOS} 个视频。`);
    return out;
  }
  function parseUploaders(text) {
    const out = [], seen = new Set();
    for (const [index, raw] of String(text).split(/\r?\n/).entries()) {
      const line = raw.trim();
      if (!line) continue;
      const split = line.indexOf('|'), label = split >= 0 ? line.slice(0, split).trim() : '';
      const value = (split >= 0 ? line.slice(split + 1) : line).trim();
      const uid = UID_PATTERN.test(value) ? value : spaceInfo(value)?.uid;
      if (!uid) throw new Error(`UP 主第 ${index + 1} 行需要空间链接或数字 UID。仅凭昵称无法可靠识别账号。`);
      if (seen.has(uid)) continue;
      seen.add(uid); out.push({ uid, name: cleanLabel(label, `UP ${uid}`) });
    }
    if (out.length > MAX_UPLOADERS) throw new Error(`最多保存 ${MAX_UPLOADERS} 位 UP 主。`);
    return out;
  }
  const serializeList = videos => videos.map(v => `${cleanLabel(v.title, v.bvid)} | https://www.bilibili.com/video/${v.bvid}/`).join('\n');
  const serializeUploaders = ups => ups.map(up => `${cleanLabel(up.name, `UP ${up.uid}`)} | https://space.bilibili.com/${up.uid}`).join('\n');
  function buildRules(settingsOrVideos, session = null, extensionRoot = 'chrome-extension://test/') {
    const settings = normalizeSettings(Array.isArray(settingsOrVideos) ? { videos: settingsOrVideos } : settingsOrVideos);
    const condition = regexFilter => ({ regexFilter, resourceTypes: ['main_frame'], isUrlFilterCaseSensitive: true });
    const rules = [
      { id: 1, priority: 1, action: { type: 'redirect', redirect: { extensionPath: '/blocked.html' } },
        condition: condition('^https?://([a-z0-9-]+\\.)*bilibili\\.com(/|$)') },
      { id: 2, priority: 100, action: { type: 'allow' },
        condition: condition('^https?://passport\\.bilibili\\.com(/|$)') }
    ];
    const bvRegex = id => `^https?://www\\.bilibili\\.com/video/${id}/?([?#].*)?$`;
    const ids = [...new Set([...settings.videos.map(v => v.bvid),
      ...(session?.grants || []).filter(g => settings.uploaders.some(up => up.uid === g.uid)).map(g => g.bvid)])];
    ids.forEach((bvid, i) => {
      if (!VIDEO_PATTERN.test(bvid)) throw new Error('Invalid BV identifier');
      rules.push({ id: 100 + i, priority: 100, action: { type: 'allow' }, condition: condition(bvRegex(bvid)) });
    });
    if (settings.uploaders.length) {
      rules.push({ id: 3, priority: 20,
        action: { type: 'redirect', redirect: { regexSubstitution: extensionRoot + 'gate.html#\\0' } },
        condition: condition(bvRegex('BV[0-9A-Za-z]{10}')) });
    }
    settings.uploaders.forEach((up, i) => {
      const prefix = `^https?://space\\.bilibili\\.com/([a-z]{2}(-[A-Za-z]{2,8})?/)?${up.uid}`;
      rules.push({ id: 2000 + i, priority: 100, action: { type: 'allow' },
        condition: condition(prefix + '/(video|upload/video)/?([?#].*)?$') });
      rules.push({ id: 3000 + i, priority: 100, action: { type: 'redirect', redirect: { url: upUrl(up.uid) } },
        condition: condition(prefix + '/?([?#].*)?$') });
    });
    return rules;
  }
  const sessionClock = (session, now = Date.now()) => clock(session?.mode === 'countup' ? Math.floor((now - session.startedAt) / 1000) * 1000 : (session?.endsAt || now) - now);
  const clockLabel = session => session?.mode === 'countup' ? '\u5df2\u5b66\u4e60' : '\u5269\u4f59';
  function clock(ms) {
    const s = Math.max(0, Math.ceil((Number(ms) || 0) / 1000));
    if (s >= 3600) return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }
  const api = { KEY, VIDEO_PATTERN, UID_PATTERN, MAX_VIDEOS, MAX_UPLOADERS, MAX_GRANTS, cleanLabel,
    defaults, normalizeSettings, normalizeState, active, parsedUrl, videoId, spaceInfo, upUrl, route, allowedUrl,
    parseList, parseUploaders, serializeList, serializeUploaders, buildRules, clock, sessionClock, clockLabel };
  root.BiliFocus = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
