/* Local learning records. No network calls, credentials or analytics. */
(function (root) {
  'use strict';
  const BF = root.BiliFocus || (typeof require === 'function' ? require('./logic.js') : null);
  const HISTORY_KEY = 'bilifocus_records_v1', CURRENT_KEY = 'bilifocus_record_current_v1';
  const MAX_HISTORY = 300, MAX_VIDEOS = 500, HISTORY_BYTES = 4 * 1024 * 1024, MAX_GAP = 12000;
  const num = x => Number.isFinite(Number(x)) ? Number(x) : 0;
  const dateKey = time => {
    const d = new Date(time);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  };
  function splitInterval(start, end) {
    const parts = [];
    let cursor = num(start); end = num(end);
    if (cursor <= 0 || end <= cursor) return parts;
    // Local calendar boundaries also handle DST. Bound corrupt/future data.
    for (let guard = 0; cursor < end && guard < 3660; guard++) {
      const d = new Date(cursor), midnight = new Date(d.getFullYear(), d.getMonth(), d.getDate()+1).getTime();
      const next = Math.min(end, midnight);
      if (next <= cursor) break;
      parts.push({ day: dateKey(cursor), from: cursor, to: next, ms: next-cursor }); cursor = next;
    }
    return parts;
  }
  const emptyHistory = () => ({ version: 1, sessions: [], pruned: 0 });
  function history(input) {
    if (!input || !Array.isArray(input.sessions)) return emptyHistory();
    const seen = new Set();
    return { version: 1, pruned: Math.max(0,num(input.pruned)), sessions: input.sessions.filter(r => {
      if (!r || typeof r.id !== 'string' || !num(r.startedAt) || !num(r.endedAt) || seen.has(r.id)) return false;
      seen.add(r.id); return true;
    }) };
  }
  function fresh(session) {
    return { id: session.id, mode: session.mode || 'countdown', startedAt: session.startedAt,
      plannedEnd: session.endsAt || null, endedAt: null, reason: null,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      playedMs: 0, days: {}, videos: [], visits: 0, truncated: false,
      lastCreditedAt: session.startedAt, markers: {}, lastVideoKey: null };
  }
  function ensure(input, session) {
    return input?.id === session.id && Array.isArray(input.videos) ? input : fresh(session);
  }
  function publicRecord(record) {
    if (!record) return null;
    const { markers, lastCreditedAt, lastVideoKey, ...out } = record;
    return out;
  }
  function finish(record, end, reason) {
    const result = publicRecord(record);
    result.endedAt = Math.max(result.startedAt, num(end)); result.reason = reason;
    return result;
  }
  function archive(store, record) {
    const out = history(store);
    out.sessions = out.sessions.filter(r => r.id !== record.id);
    out.sessions.push(record);
    out.sessions.sort((a,b) => a.startedAt-b.startedAt);
    while (out.sessions.length > MAX_HISTORY || (out.sessions.length > 1 && JSON.stringify(out).length*2 > HISTORY_BYTES)) {
      out.sessions.shift(); out.pruned++;
    }
    return out;
  }
  function partOf(url) {
    try { const n = Number(new URL(url).searchParams.get('p') || 1); return Number.isInteger(n) && n >= 1 && n <= 10000 ? n : 1; }
    catch (_) { return 1; }
  }
  function sample(record, input, now, stream, video) {
    // The background validates the sender, canonical BV, session and allowed URL.
    // A first sample never proves playback. Two samples + real media progress do.
    const ms = num(input.mediaTime), seq = num(input.seq);
    const validMedia = Number.isFinite(Number(input.mediaTime)) && ms >= 0;
    const key = `${video.bvid}:p${video.part}`;
    const old = record.markers[stream];
    if (old && seq <= old.seq) return 0;
    record.markers[stream] = { at: now, mediaTime: ms, seq, key,
      playing: validMedia && input.playing === true, eligible: input.eligible === true,
      rate: Math.max(.1, Math.min(16, num(input.rate) || 1)) };
    const keys = Object.keys(record.markers);
    if (keys.length > 20) keys.sort((a,b)=>record.markers[a].at-record.markers[b].at).slice(0,-20).forEach(k=>delete record.markers[k]);
    if (!old || !validMedia || old.key !== key || !old.playing || !old.eligible || input.eligible !== true || input.seeking === true) return 0;
    const gap = now-old.at, progress = ms-old.mediaTime;
    if (gap <= 0 || gap > MAX_GAP || progress <= .01) return 0;
    const rate = Math.max(old.rate, record.markers[stream].rate);
    if (progress > gap/1000 * rate * 1.75 + 1.25) return 0; // discontinuity/seek
    // Media stalls must not be counted as playback. Never credit more than wall time.
    const observed = Math.min(gap, progress / rate * 1000);
    const end = Math.min(now, record.plannedEnd || now);
    const start = Math.max(now-observed, record.startedAt, num(record.lastCreditedAt));
    const credited = Math.max(0, end-start);
    if (!credited) return 0;
    record.lastCreditedAt = end;
    record.playedMs += credited;
    const portions = splitInterval(start, end);
    portions.forEach(p => record.days[p.day] = (record.days[p.day] || 0)+p.ms);
    let item = record.videos.find(v => v.key === key);
    if (!item && record.videos.length < MAX_VIDEOS) {
      item = { key, bvid: video.bvid, part: video.part, title: video.title,
        partTitle: video.partTitle || '', uid: video.uid || '', name: video.name || '',
        firstAt: start, lastAt: end, playedMs: 0, days: {}, visits: 0 };
      record.videos.push(item);
    }
    if (record.lastVideoKey !== key) { record.visits++; if (item) item.visits++; record.lastVideoKey = key; }
    if (!item) { record.truncated = true; return credited; }
    if (video.title && video.title !== video.bvid) item.title = video.title;
    if (video.partTitle) item.partTitle = video.partTitle;
    if (video.uid) item.uid = video.uid;
    if (video.name) item.name = video.name;
    item.firstAt = Math.min(item.firstAt, start); item.lastAt = end; item.playedMs += credited;
    portions.forEach(p => item.days[p.day] = (item.days[p.day] || 0)+p.ms);
    return credited;
  }
  function allRecords(store, current) {
    const list = history(store).sessions.filter(r => r.id !== current?.id);
    if (current) list.push(publicRecord(current));
    return list.sort((a,b)=>b.startedAt-a.startedAt);
  }
  function daily(records, day, now = Date.now()) {
    const out = { day, modeMs: 0, playedMs: 0, sessionCount: 0, videoCount: 0, sessions: [] }, unique = new Set();
    for (const rec of records) {
      const end = rec.endedAt || Math.min(now, rec.plannedEnd || now);
      const ranges = splitInterval(rec.startedAt, end).filter(p=>p.day === day);
      if (!ranges.length && !(rec.endedAt === null && dateKey(rec.startedAt) === day)) continue;
      const modeMs = ranges.reduce((s,p)=>s+p.ms,0), playedMs = num(rec.days?.[day]);
      const videos = (rec.videos || []).filter(v=>num(v.days?.[day]) > 0).map(v=>({ ...v, todayMs: num(v.days[day]) }));
      videos.forEach(v=>unique.add(v.key));
      out.modeMs += modeMs; out.playedMs += playedMs; out.sessionCount++;
      out.sessions.push({ record: rec, modeMs, playedMs, videos, ranges });
    }
    out.videoCount = unique.size;
    return out;
  }
  function duration(ms) {
    const sec = Math.max(0,Math.floor(num(ms)/1000));
    if (sec < 60) return `${sec}\u79d2`;
    const m = Math.floor(sec/60), s = sec%60;
    return m >= 60 ? `${Math.floor(m/60)}\u5c0f\u65f6${m%60}\u5206${s}\u79d2` : `${m}\u5206${s}\u79d2`;
  }
  const api = { HISTORY_KEY, CURRENT_KEY, MAX_HISTORY, MAX_VIDEOS, HISTORY_BYTES, MAX_GAP,
    dateKey, splitInterval, emptyHistory, history, fresh, ensure, publicRecord, finish, archive,
    partOf, sample, allRecords, daily, duration };
  root.BFRecords = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
