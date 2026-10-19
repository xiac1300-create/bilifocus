'use strict';
let state = BiliFocus.normalizeState(null), expiring = false;
const library = document.body.dataset.page === 'library', $ = id => document.getElementById(id);
function render() {
  const on = BiliFocus.active(state);
  $('heading').textContent = on ? (library ? '自由切换，仍在计划之内。' : '这条路，先留到学习之后。') : '这段时间，由你选择。';
  $('description').textContent = on
    ? (library ? '白名单 UP 主的投稿和指定视频都在这里。名单在本次学习期间保持不变。' : '当前页面不在白名单内。可以继续下方内容，无需退出学习。')
    : '目前没有学习限制。可以继续看已选内容，也可以回到 B站自由浏览。';
  $('home').hidden = on;
  $('count').textContent = `${state.settings.videos.length} 个视频`;
  $('up-count').textContent = `${state.settings.uploaders.length} 位 UP 主`;
  UI.fillQueue($('queue'), state.settings.videos);
  UI.fillUploaders($('up-queue'), state.settings.uploaders);
  tick();
}
function tick() {
  $('timer').textContent = BiliFocus.active(state) ? `${BiliFocus.clockLabel(state.session)} ${BiliFocus.sessionClock(state.session)}` : '自由浏览';
  if (!BiliFocus.active(state) && state.session && !expiring) {
    expiring = true;
    UI.send('GET_STATE').then(s => { state = s; render(); }).catch(e => UI.notify(e.message, true)).finally(() => { expiring = false; });
  }
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[BiliFocus.KEY]) { state = BiliFocus.normalizeState(changes[BiliFocus.KEY].newValue); render(); }
});
UI.send('GET_STATE').then(s => { state = s; render(); }).catch(e => UI.notify(e.message, true));
setInterval(tick, 1000);
