'use strict';
let state = BiliFocus.normalizeState(null), busy = false;
const $ = id => document.getElementById(id);
function render() {
  const on = BiliFocus.active(state);
  $('status').textContent = on ? '学习中' : '未开启'; $('status').classList.toggle('on', on);
  $('heading').textContent = on ? '继续你已经选好的内容。' : '开始和结束，都由你决定。';
  $('summary').textContent = `${state.settings.videos.length} 个视频 · ${state.settings.uploaders.length} 位 UP 主。${on ? (state.session.mode === 'countup' ? '\u6b63\u8ba1\u65f6\uff0c\u8bf7\u8fdb\u5165\u5b66\u4e60\u7a7a\u95f4\u7ed3\u675f\u3002' : '\u5230\u65f6\u81ea\u52a8\u6062\u590d\u81ea\u7531\u6d4f\u89c8\u3002') : '也可以直接在视频页开始计时。'}`;
  $('add').disabled = $('add-up').disabled = on || busy;
  tick();
}
function tick() {
  const on = BiliFocus.active(state);
  $('timer').hidden = !on;
  if (on) $('timer').textContent = BiliFocus.sessionClock(state.session);
}
$('open').addEventListener('click', () => UI.send('OPEN_OPTIONS').catch(e => UI.notify(e.message, true)));
$('library').addEventListener('click', () => UI.send('OPEN_LIBRARY').catch(e => UI.notify(e.message, true)));
async function add(type) {
  if (busy) return;
  busy = true; render();
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    state = await UI.send(type, { url: tab?.url, title: tab?.title });
    UI.notify(type === 'ADD_UPLOADER' ? '已加入此视频的 UP 主。其全部普通投稿都将放行。' : '当前视频已加入白名单。');
  } catch (error) { UI.notify(error.message, true); }
  finally { busy = false; render(); }
}
$('add').addEventListener('click', () => add('ADD_VIDEO'));
$('add-up').addEventListener('click', () => add('ADD_UPLOADER'));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[BiliFocus.KEY]) { state = BiliFocus.normalizeState(changes[BiliFocus.KEY].newValue); render(); }
});
UI.send('GET_STATE').then(s => { state = s; render(); }).catch(e => UI.notify(e.message, true));
setInterval(tick, 1000);
