'use strict';
let target = '', busy = false, state = BiliFocus.normalizeState(null), finishing = false;
const $ = id => document.getElementById(id);
try {
  const fragment = location.hash.slice(1);
  target = /^https?:\/\//.test(fragment) ? fragment : decodeURIComponent(fragment);
  if (!BiliFocus.videoId(target)) throw new Error('invalid');
} catch (_) { target = ''; }
async function verify() {
  if (busy) return;
  if (!target) { UI.notify('视频地址无效，请从学习目录重新打开。', true); return; }
  busy = true; $('retry').hidden = true; $('heading').textContent = '正在核验发布账号。';
  UI.notify('正在向 B站查询公开的视频信息…');
  try {
    const response = await chrome.runtime.sendMessage({ type: 'VERIFY_VIDEO', url: target });
    if (!response?.ok) throw new Error(response?.error || '扩展后台未响应。');
    state = BiliFocus.normalizeState(response.state);
    location.replace(response.allowed ? target : chrome.runtime.getURL('blocked.html'));
  } catch (error) {
    $('heading').textContent = '暂时无法确认这条视频。';
    UI.notify(error.message, true); $('retry').hidden = false;
  } finally { busy = false; }
}
async function tick() {
  const on = BiliFocus.active(state);
  $('timer').textContent = on ? `剩余 ${BiliFocus.clock(state.session.endsAt - Date.now())}` : '';
  if (!on && state.session && !finishing) {
    finishing = true;
    try {
      state = await UI.send('GET_STATE');
      if (!BiliFocus.active(state) && target) location.replace(target);
    } catch (_) {} finally { finishing = false; }
  }
}
$('retry').addEventListener('click', verify);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[BiliFocus.KEY]) {
    state = BiliFocus.normalizeState(changes[BiliFocus.KEY].newValue);
    if (!BiliFocus.active(state) && target) location.replace(target);
  }
});
UI.send('GET_STATE').then(s => { state = s; return verify(); }).catch(e => UI.notify(e.message, true));
setInterval(tick, 1000);
