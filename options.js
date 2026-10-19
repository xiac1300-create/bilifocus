'use strict';
const BF = BiliFocus, $ = id => document.getElementById(id);
let state = BF.normalizeState(null), dirty = false, busy = false, wasActive = false;
function collect() {
  const duration = Number($('duration').value);
  if (!Number.isInteger(duration) || duration < 1 || duration > 480) throw new Error('学习时长须为 1 至 480 分钟的整数。');
  return { videos: BF.parseList($('videos').value), uploaders: BF.parseUploaders($('uploaders').value),
    duration, mode: $('mode').value, hideComments: $('hideComments').checked };
}
function updateTimer() {
  const on = BF.active(state);
  const mode = on ? state.session.mode : $('mode').value;
  $('timer').textContent = on ? BF.sessionClock(state.session) : BF.clock(mode === 'countup' ? 0 : Number($('duration').value || 45)*60000);
  $('duration-field').hidden = mode === 'countup';
  $('timer-caption').textContent = mode === 'countup'
    ? '\u4ece\u96f6\u5f00\u59cb\u7d2f\u8ba1\uff0c\u53ef\u5728\u89c6\u9891\u9875\u76f4\u63a5\u7ed3\u675f\u3002\u5173\u95ed\u9762\u677f\u4e0d\u4f1a\u505c\u6b62\u3002'
    : '\u5230\u65f6\u81ea\u52a8\u7ed3\u675f\u5e76\u5b58\u6863\u3002\u5173\u95ed\u9762\u677f\u4e0d\u4f1a\u505c\u6b62\u3002';
  if (wasActive && !on) {
    wasActive = false;
    UI.send('GET_STATE').then(s => { state = s; render(true); UI.notify('本次学习已结束并保存记录，已恢复自由浏览。'); }).catch(e => UI.notify(e.message, true));
  }
}
function render(syncEditor = false) {
  const on = BF.active(state);
  if (syncEditor || !dirty || on) {
    $('videos').value = BF.serializeList(state.settings.videos);
    $('uploaders').value = BF.serializeUploaders(state.settings.uploaders);
    $('duration').value = state.settings.duration;
    $('mode').value = state.settings.mode;
    $('hideComments').checked = state.settings.hideComments;
    dirty = false;
  }
  $('count').textContent = `${state.settings.videos.length} 个视频`;
  $('up-count').textContent = `${state.settings.uploaders.length} 位 UP 主`;
  $('status').textContent = on ? '学习模式已开启' : '自由浏览';
  $('status').classList.toggle('on', on);
  ['videos','uploaders','duration','mode','hideComments','save','start','add-example'].forEach(id => $(id).disabled = on || busy);
  $('start').hidden = on; $('locked').hidden = !on; $('session-controls').hidden = !on;
  $('timer-heading').textContent = on ? '这一段时间，留给学习' : '留一段完整的时间';
  UI.fillQueue($('queue'), state.settings.videos, true);
  UI.fillUploaders($('up-queue'), state.settings.uploaders, true);
  wasActive = on; updateTimer();
}
async function act(type, extra = {}) {
  if (busy) return;
  busy = true;
  ['save','start','stop'].forEach(id => $(id).disabled = true);
  try {
    const payload = ['SAVE','START'].includes(type) ? { settings: collect() } : extra;
    state = await UI.send(type, payload); dirty = false;
    UI.notify(type === 'SAVE' ? '两份名单已保存。也可以回到视频页直接开始。'
      : type === 'START' ? '学习模式已开启。两份白名单在本次学习期间锁定。' : '本次学习已结束并保存记录，已恢复自由浏览。');
  } catch (error) { UI.notify(error.message, true); }
  finally { busy = false; $('stop').disabled = false; render(false); }
}
$('save').addEventListener('click', () => act('SAVE'));
$('start').addEventListener('click', () => act('START'));
$('stop').addEventListener('click', () => act('STOP', { sessionId: state.session?.id }));
$('add-example').addEventListener('click', () => {
  try {
    const list = BF.parseUploaders($('uploaders').value);
    if (!list.some(up => up.uid === '417302260')) list.push({ uid: '417302260', name: '众合教育' });
    $('uploaders').value = BF.serializeUploaders(list); dirty = true;
    UI.notify('已填入众合教育（UID 417302260），点击「保存两份名单」后生效。');
  } catch (error) { UI.notify(error.message, true); }
});
['videos','uploaders','duration','mode','hideComments'].forEach(id => $(id).addEventListener('input', () => { dirty = true; updateTimer(); }));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[BF.KEY]) { state = BF.normalizeState(changes[BF.KEY].newValue); render(false); }
});
UI.send('GET_STATE').then(s => { state = s; render(true); }).catch(e => UI.notify(e.message, true));
setInterval(updateTimer, 1000);
