/* Study-history UI. Only options.html loads this file. */
(() => {
  'use strict';
  const R = BFRecords, B = BiliFocus, by = id => document.getElementById(id);
  let store = R.emptyHistory(), current = null, records = [], view = 'settings';
  let busy = false, followToday = true, rendered = false, lastSignature = '';
  by('record-date').value = R.dateKey(Date.now());
  const el = (tag, text, cls) => {
    const node = document.createElement(tag); if (text != null) node.textContent = text;
    if (cls) node.className = cls; return node;
  };
  const time = ts => new Date(ts).toLocaleTimeString('zh-CN', { hour12:false, hour:'2-digit', minute:'2-digit', second:'2-digit' });
  const dateTime = ts => `${R.dateKey(ts)} ${time(ts)}`;
  const modeName = r => r.mode === 'countup' ? '\u6b63\u8ba1\u65f6' : '\u5012\u8ba1\u65f6';
  const endName = r => !r.endedAt ? '\u8fdb\u884c\u4e2d' : r.reason === 'completed' ? '\u5230\u65f6\u5b8c\u6210' : '\u624b\u52a8\u7ed3\u675f';
  function dayData() { return R.daily(records, by('record-date').value); }
  function metrics(day) {
    by('day-mode').textContent = R.duration(day.modeMs);
    by('day-played').textContent = R.duration(day.playedMs);
    by('day-count').textContent = day.sessionCount;
    by('day-videos').textContent = day.videoCount;
  }
  function draw(force = false) {
    if (followToday && by('record-date').value !== R.dateKey(Date.now())) { by('record-date').value = R.dateKey(Date.now()); force = true; }
    const day = dayData(); metrics(day);
    by('records-status').textContent = current ? '\u6b63\u5728\u8bb0\u5f55\u672c\u6b21\u5b66\u4e60' : '\u672c\u673a\u4fdd\u5b58';
    by('records-status').classList.toggle('on', !!current);
    by('clear-records').disabled = !!current;
    by('retention-note').textContent = `\u6700\u591a\u4fdd\u7559\u6700\u8fd1 ${R.MAX_HISTORY} \u6b21\u5b66\u4e60\uff08\u5386\u53f2\u7ea6 4 MB \u4ee5\u5185\uff09\u3002\u8d85\u9650\u65f6\u4f1a\u6e05\u7406\u6700\u65e9\u8bb0\u5f55\uff0c\u5efa\u8bae\u5b9a\u671f\u5bfc\u51fa\u3002${store.pruned ? `\u5df2\u6e05\u7406 ${store.pruned} \u6b21\u65e9\u671f\u8bb0\u5f55\u3002` : ''}`;
    const signature = by('record-date').value + ':' + JSON.stringify(records);
    if (!force && rendered && signature === lastSignature) return;
    lastSignature = signature;
    const parent = by('record-sessions');
    const open = new Set([...parent.querySelectorAll('details[open]')].map(n=>n.dataset.record));
    const first = !rendered; rendered = true; parent.replaceChildren();
    if (!day.sessions.length) {
      const empty = el('section', null, 'card empty-records');
      empty.append(el('h3', '\u8fd9\u4e00\u5929\uff0c\u8fd8\u6ca1\u6709\u5b66\u4e60\u8bb0\u5f55\u3002'),
        el('p', '\u4ece\u89c6\u9891\u9875\u6216\u5b66\u4e60\u8bbe\u7f6e\u5f00\u59cb\u8ba1\u65f6\uff0c\u672c\u6b21\u5b66\u4e60\u4f1a\u81ea\u52a8\u51fa\u73b0\u5728\u8fd9\u91cc\u3002\u4ec5\u6253\u5f00\u89c6\u9891\u3001\u6ca1\u6709\u5b9e\u9645\u64ad\u653e\uff0c\u4e0d\u4f1a\u589e\u52a0\u89c6\u9891\u6570\u3002'));
      parent.append(empty); return;
    }
    day.sessions.forEach((entry,index) => {
      const rec = entry.record, details = el('details', null, 'card record-session');
      details.dataset.record = rec.id;
      details.open = open.has(rec.id) || (first && index === 0) || !rec.endedAt;
      const summary = el('summary');
      const sameDay = !rec.endedAt || R.dateKey(rec.startedAt) === R.dateKey(rec.endedAt);
      const title = el('div', null, 'session-title');
      title.append(el('span', `${sameDay ? time(rec.startedAt) : dateTime(rec.startedAt)} \u2014 ${rec.endedAt ? (sameDay ? time(rec.endedAt) : dateTime(rec.endedAt)) : '\u8fdb\u884c\u4e2d'}`),
        el('span', modeName(rec), 'tag'), el('span', endName(rec), 'tag'));
      const sub = el('div', `${R.dateKey(rec.startedAt)} \u5f00\u59cb\u00b7\u672c\u6b21\u5df2\u8bb0\u5f55 ${(rec.videos || []).length} \u4e2a\u89c6\u9891\uff08\u5206 P \u5206\u5f00\uff09\u00b7\u70b9\u51fb\u5c55\u5f00 / \u6536\u8d77`, 'session-sub');
      const chips = el('div', null, 'session-chips');
      chips.append(el('span', `\u5f53\u65e5\u6a21\u5f0f\u65f6\u957f ${R.duration(entry.modeMs)}`),
        el('span', `\u5f53\u65e5\u64ad\u653e ${R.duration(entry.playedMs)}`));
      summary.append(title, sub, chips); details.append(summary);
      const videos = el('div', null, 'session-videos');
      if (!entry.videos.length) videos.append(el('p', '\u8fd9\u4e2a\u65f6\u6bb5\u6682\u65e0\u88ab\u786e\u8ba4\u7684\u524d\u53f0\u64ad\u653e\u3002\u53ef\u80fd\u5728\u9009\u8bfe\u3001\u6682\u505c\u6216\u540e\u53f0\uff0c\u4e5f\u53ef\u80fd\u64ad\u653e\u5668\u5c1a\u672a\u9002\u914d\u3002', 'help'));
      entry.videos.sort((a,b)=>a.firstAt-b.firstAt).forEach(video => {
        const row = el('div', null, 'record-video'), info = el('div');
        const link = el('a', `${video.title || video.bvid}${video.part > 1 ? ' / P'+video.part : ''}`);
        link.href = `https://www.bilibili.com/video/${video.bvid}/?p=${video.part}`; link.target = '_blank'; link.rel = 'noopener';
        info.append(link,
          el('small', `${video.name || (video.uid ? 'UP '+video.uid : '\u53d1\u5e03\u8d26\u53f7\u672a\u8bc6\u522b')} \u00b7 P${video.part}${video.partTitle ? ' \u00b7 '+video.partTitle : ''} \u00b7 ${video.bvid}`),
          el('small', `\u672c\u6b21\u9996\u64ad ${dateTime(video.firstAt)} \u00b7 \u6700\u540e ${dateTime(video.lastAt)}`));
        row.append(info, el('span', R.duration(video.todayMs), 'video-duration')); videos.append(row);
      });
      if (rec.truncated) videos.append(el('p', '\u672c\u6b21\u89c6\u9891\u660e\u7ec6\u5df2\u8fbe\u4fdd\u5b58\u4e0a\u9650\uff0c\u540e\u7eed\u4ec5\u7d2f\u8ba1\u603b\u64ad\u653e\u65f6\u957f\u3002', 'record-warning'));
      details.append(videos); parent.append(details);
    });
  }
  async function refresh(force = false) {
    if (busy) return; busy = true;
    try {
      const result = await chrome.runtime.sendMessage({ type: 'GET_RECORDS' });
      if (!result?.ok) throw new Error(result?.error || '\u6682\u65f6\u65e0\u6cd5\u8bfb\u53d6\u5b66\u4e60\u8bb0\u5f55');
      store = R.history(result.history); current = result.current || null;
      records = R.allRecords(store,current); draw(force);
      by('records-updated').textContent = `\u66f4\u65b0\u4e8e ${time(Date.now())}`;
    } catch(error) { UI.notify(error.message,true); }
    finally { busy = false; }
  }
  function switchView(next) {
    view = next;
    ['settings','records'].forEach(name => {
      by(name+'-view').hidden = name !== next;
      by(name+'-tab').classList.toggle('selected', name === next);
      by(name+'-tab').setAttribute('aria-selected', String(name === next));
    });
    if (next === 'records') refresh(true);
  }
  by('settings-tab').addEventListener('click',()=>switchView('settings'));
  by('records-tab').addEventListener('click',()=>switchView('records'));
  by('record-date').addEventListener('change',()=>{
    if (!/^\d{4}-\d{2}-\d{2}$/.test(by('record-date').value)) by('record-date').value = R.dateKey(Date.now());
    followToday = false; draw(true);
  });
  function moveDate(delta) {
    const d = new Date(by('record-date').value+'T12:00:00'); d.setDate(d.getDate()+delta);
    by('record-date').value = R.dateKey(d.getTime()); followToday = false; draw(true);
  }
  by('date-prev').addEventListener('click',()=>moveDate(-1));
  by('date-next').addEventListener('click',()=>moveDate(1));
  by('date-today').addEventListener('click',()=>{ followToday = true; by('record-date').value = R.dateKey(Date.now()); draw(true); });
  function download(name,text,type) {
    const url = URL.createObjectURL(new Blob([text],{type}));
    const a = el('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  by('export-records').addEventListener('click',async()=>{
    await refresh();
    download(`BiliFocus-records-${R.dateKey(Date.now())}.json`,JSON.stringify({
      format:'BiliFocus records',version:1,exportedAt:new Date().toISOString(),
      history:store,current,definition:'Session wall time includes pauses/sleep. Playback is observed visible/PiP wall time, not proof of attention.'
    },null,2),'application/json');
  });
  by('export-day').addEventListener('click',async()=>{
    await refresh(); const day = dayData();
    const lines = [`# BiliFocus \u5b66\u4e60\u65e5\u62a5 | ${day.day}`,'',
      `\u6a21\u5f0f\u65f6\u957f\uff1a${R.duration(day.modeMs)}`,`\u89c6\u9891\u64ad\u653e\uff1a${R.duration(day.playedMs)}`,
      `\u5b66\u4e60\u573a\u6b21\uff1a${day.sessionCount}\uff1b\u89c6\u9891\uff08\u5206 P\uff09\uff1a${day.videoCount}`,''];
    day.sessions.forEach(entry=>{
      const r=entry.record;
      lines.push(`## ${dateTime(r.startedAt)} - ${r.endedAt ? dateTime(r.endedAt) : '\u8fdb\u884c\u4e2d'} | ${modeName(r)}`,
        `\u5f53\u65e5\u6a21\u5f0f\u65f6\u957f ${R.duration(entry.modeMs)} / \u5f53\u65e5\u64ad\u653e ${R.duration(entry.playedMs)}`,'');
      entry.videos.forEach(v=>lines.push(`- ${v.title} / P${v.part} | ${v.name || v.uid || '\u672a\u8bc6\u522b UP'} | ${R.duration(v.todayMs)} | ${v.bvid}`));
      lines.push('');
    });
    lines.push('---','\u6a21\u5f0f\u65f6\u957f\u5305\u542b\u6682\u505c\u4e0e\u4f11\u7720\uff1b\u64ad\u653e\u7528\u65f6\u4e3a\u524d\u53f0 / \u753b\u4e2d\u753b\u64ad\u653e\u7684\u4fdd\u5b88\u4f30\u7b97\uff0c\u4e0d\u4ee3\u8868\u6ce8\u610f\u529b\u6301\u7eed\u65f6\u95f4\u3002');
    download(`BiliFocus-${day.day}.md`, lines.join('\n'), 'text/markdown;charset=utf-8');
  });
  by('clear-records').addEventListener('click',async()=>{
    if (current) return;
    const text = prompt('\u8fd9\u4f1a\u5220\u9664\u6240\u6709\u672c\u673a\u5b66\u4e60\u5386\u53f2\uff0c\u4e0d\u5220\u9664\u767d\u540d\u5355\u3002\u5efa\u8bae\u5148\u5bfc\u51fa\u3002\u8bf7\u8f93\u5165\u300c\u6e05\u7a7a\u5b66\u4e60\u8bb0\u5f55\u300d\u786e\u8ba4\uff1a');
    if (text !== '\u6e05\u7a7a\u5b66\u4e60\u8bb0\u5f55') return;
    try { await UI.send('CLEAR_RECORDS', {confirmation:text}); await refresh(true); UI.notify('\u5386\u53f2\u8bb0\u5f55\u5df2\u6e05\u7a7a\uff0c\u767d\u540d\u5355\u4fdd\u7559\u3002'); }
    catch(error) { UI.notify(error.message,true); }
  });
  chrome.storage.onChanged.addListener((changes,area)=>{
    if (area === 'local' && view === 'records' && (changes[R.CURRENT_KEY] || changes[R.HISTORY_KEY] || changes[B.KEY])) refresh();
  });
  setInterval(()=>{ if(view === 'records') refresh(); },5000);
  setInterval(()=>{ if(view === 'records') draw(); },1000);
})();
