'use strict';
const UI = {
  async send(type, extra = {}) {
    const response = await chrome.runtime.sendMessage({ type, ...extra });
    if (!response?.ok) throw new Error(response?.error || '扩展后台未响应，请在扩展管理页重新加载。');
    return response.state;
  },
  notify(text, bad = false) {
    const el = document.getElementById('notice');
    el.textContent = text;
    el.classList.toggle('error', bad);
    el.hidden = !text;
  },
  fillQueue(el, videos, newTab = false) {
    el.replaceChildren();
    if (!videos.length) {
      const empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = '没有单独指定的视频；也可以从上方 UP 主列表选择内容。';
      el.append(empty);
      return;
    }
    videos.forEach((video, index) => {
      const link = document.createElement('a');
      link.className = 'queue-item';
      link.href = `https://www.bilibili.com/video/${video.bvid}/`;
      if (newTab) { link.target = '_blank'; link.rel = 'noopener'; }
      const number = document.createElement('span');
      number.className = 'queue-number'; number.textContent = String(index + 1).padStart(2, '0');
      const details = document.createElement('span');
      const title = document.createElement('strong'); title.textContent = video.title;
      const sub = document.createElement('small'); sub.textContent = video.bvid;
      details.append(title, sub);
      const arrow = document.createElement('span'); arrow.textContent = '↗'; arrow.className = 'queue-arrow';
      link.append(number, details, arrow); el.append(link);
    });
  }
};

UI.fillUploaders = function (el, uploaders, newTab = false) {
  el.replaceChildren();
  if (!uploaders.length) return;
  for (const up of uploaders) {
    const link = document.createElement('a'); link.className = 'queue-item uploader-item'; link.href = BiliFocus.upUrl(up.uid);
    if (newTab) { link.target = '_blank'; link.rel = 'noopener'; }
    const badge = document.createElement('span'); badge.className = 'queue-number'; badge.textContent = 'UP';
    const details = document.createElement('span');
    const title = document.createElement('strong'); title.textContent = up.name;
    const sub = document.createElement('small'); sub.textContent = `UID ${up.uid} · 浏览该账号的全部视频`;
    details.append(title, sub);
    const arrow = document.createElement('span'); arrow.textContent = '↗'; arrow.className = 'queue-arrow';
    link.append(badge, details, arrow); el.append(link);
  }
};
