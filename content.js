(() => {
  'use strict';
  const BF = BiliFocus;
  if (globalThis.__BILIFOCUS_V3__) return;
  globalThis.__BILIFOCUS_V3__ = true;
  let state = BF.normalizeState(null), ready = false, host, shadow, ui = {};
  let pending = false, closing = false, panelMode = '', expiryRequested = false;
  let endNotice = '', restartAfter = 0;
  const root = () => document.documentElement;
  const blockedUrl = chrome.runtime.getURL('blocked.html');
  const gateUrl = url => chrome.runtime.getURL('gate.html') + '#' + encodeURIComponent(url);
  root()?.classList.add('bf-checking');
  const initTimeout = setTimeout(() => {
    if (!ready) {
      root()?.classList.remove('bf-checking');
      // Do not leave the browser blank if an extension update invalidates this script.
    }
  }, 5000);
  async function send(type, extra = {}) {
    const result = await chrome.runtime.sendMessage({ type, ...extra });
    if (!result?.ok) throw new Error(result?.error || '扩展后台未响应，请刷新页面或重新加载扩展。');
    return result;
  }
  function pausePlayers() {
    document.querySelectorAll('video,audio,bwp-video').forEach(media => {
      try { media.pause(); } catch (_) {}
    });
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {});
  }
  function el(tag, text, attrs = {}) {
    const item = document.createElement(tag);
    if (text) item.textContent = text;
    for (const [name, value] of Object.entries(attrs)) item.setAttribute(name, value);
    return item;
  }
  function makePanel(on) {
    if (host?.isConnected && panelMode === (on ? 'active' : 'idle')) return;
    host?.remove();
    host = el('div', '', { id: 'bilifocus-panel' });
    host.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:2147483646;max-width:calc(100vw - 24px);';
    shadow = host.attachShadow({ mode: 'open' });
    const style = el('style');
    style.textContent = `
      :host{font-family:system-ui,"Microsoft YaHei",sans-serif;color:#23483b;font-size:13px}
      *{box-sizing:border-box}[hidden]{display:none!important}
      .panel{width:286px;max-width:calc(100vw - 24px);background:#f9fbf6;border:1px solid #c9d8cc;border-radius:16px;padding:16px;box-shadow:0 5px 25px #13291b20}
      .active{width:255px;background:#234c43;color:#fff;border-color:#53796a}
      .brand{font-size:11px;font-weight:750;letter-spacing:1.1px;color:#718779}
      .active .brand{color:#bad4c6}.heading{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:6px 0 10px;font-size:15px;font-weight:700}
      .clock-peek{display:grid;place-items:center;min-width:112px;min-height:34px;padding:2px 6px;border:1px solid #759887;border-radius:8px;cursor:default}
      .clock-peek>*{grid-area:1/1;white-space:nowrap}
      .clock{font-size:24px;font-variant-numeric:tabular-nums;letter-spacing:-.7px;visibility:hidden;pointer-events:none}
      .clock-hint{font-size:11px;font-weight:500;color:#d0e1d7;letter-spacing:0;pointer-events:none}
      .clock-peek:is(:hover,:focus-visible) .clock{visibility:visible}
      .clock-peek:is(:hover,:focus-visible) .clock-hint{visibility:hidden}
      .clock-peek:focus-visible{outline:3px solid #a6d4e7;outline-offset:3px}
      .options{width:100%;margin-top:10px;padding:8px;font-size:12px}
      .active .options{color:#f2f8ee;border-color:#759887}.options:hover{background:#66897718}
      .row{display:flex;gap:9px;align-items:center}
      select{font:inherit;border:1px solid #b5cbb9;border-radius:8px;padding:8px;max-width:100%;background:#fff;color:#23483b}.mode-select{width:100%;margin-bottom:10px}.switch-row{display:flex;gap:6px;margin-top:10px}.switch-row select{width:165px;min-width:0}.switch-row button{padding:7px}.active .panel{width:286px}input[type=number]{width:66px;border:1px solid #bfd0c1;border-radius:8px;padding:8px;background:#fff;color:#264536;font:inherit}
      button{font:inherit;cursor:pointer;border-radius:9px;padding:10px 12px;border:1px solid #b5cbb9;background:transparent;color:inherit}
      button:disabled{cursor:wait;opacity:.6}.start{flex:1;background:#2d6457;color:#fff;border-color:#2d6457;font-weight:700}
      .stop{width:100%;margin-top:10px;background:#f4f8ee;color:#234c43;border-color:#f4f8ee;font-weight:750}.stop:hover{background:#e3eddd}.notice{padding:9px 10px;background:#e7f1e5;border-radius:8px;color:#2e604a;font-size:12px;line-height:1.6;margin:10px 0 0}
      .library{width:100%;color:#f2f8ee;border-color:#759887;padding:8px;margin-top:8px}
      label{display:flex;gap:7px;align-items:flex-start;margin-top:12px;font-size:12px;line-height:1.5}
      input[type=checkbox]{margin-top:3px;accent-color:#2d6457}
      .help{font-size:11px;line-height:1.6;color:#6f8274;margin:10px 0 0}
      .active .help{color:#bed5c7}.error{font-size:12px;line-height:1.6;color:#b44a32;margin:10px 0 0}
      .active .error{color:#ffcebd}button:focus-visible,input:focus-visible{outline:3px solid #76a5c0;outline-offset:3px}
      @media(max-width:600px){.panel{width:250px;padding:12px}:host{font-size:12px}}
    `;
    const panel = el('section', '', { class: on ? 'panel active' : 'panel', 'aria-label': 'BiliFocus 学习控制' });
    panel.append(el('div', 'BILI / FOCUS', { class: 'brand' }));
    ui = {};
    if (on) {
      const heading = el('div', '', { class: 'heading' });
      ui.modeLabel = el('span', '\u5b66\u4e60\u4e2d'); heading.append(ui.modeLabel);
      // Keep the footprint fixed; reveal only inside the timer target, not the whole panel.
      // :focus-visible supports keyboard users without leaving time exposed after a mouse click.
      ui.timerPeek = el('div', '', { class: 'clock-peek', tabindex: '0', role: 'group' });
      ui.timerHint = el('span', '\u60ac\u505c\u67e5\u770b\u8ba1\u65f6', { class: 'clock-hint', 'aria-hidden': 'true' });
      ui.timer = el('span', '', { class: 'clock', 'aria-live': 'off', 'aria-hidden': 'true' });
      ui.timerPeek.append(ui.timerHint, ui.timer); heading.append(ui.timerPeek); panel.append(heading);
      ui.summary = el('p', '', { class: 'help' }); panel.append(ui.summary);
      ui.stop = el('button', '\u7ed3\u675f\u5b66\u4e60', {
        type: 'button', class: 'stop', title: '\u4fdd\u5b58\u672c\u6b21\u8bb0\u5f55\u5e76\u6062\u590d\u81ea\u7531\u6d4f\u89c8'
      });
      ui.stop.addEventListener('click', async event => {
        // Page scripts cannot trigger this through a synthetic click.
        if (!event.isTrusted || pending || !state.session) return;
        const sessionId = state.session.id, url = location.href;
        pending = true;
        shadow.querySelectorAll('button,select,input').forEach(item => item.disabled = true);
        ui.stop.textContent = '\u6b63\u5728\u4fdd\u5b58\u2026';
        ui.error.hidden = true;
        try {
          // Finish an in-flight sample, then sample once more before archiving.
          await samplePlayback('stop');
          const result = await send('PAGE_STOP', { sessionId, url });
          if (!state.session || state.session.id === sessionId) state = BF.normalizeState(result.state);
          endNotice = '\u672c\u6b21\u5b66\u4e60\u5df2\u7ed3\u675f\uff0c\u8bb0\u5f55\u5df2\u4fdd\u5b58\u3002';
          restartAfter = Date.now() + 600;
          ready = true; enforce();
        } catch (error) {
          if (ui.error) { ui.error.textContent = error.message; ui.error.hidden = false; }
        } finally {
          pending = false;
          shadow?.querySelectorAll('button,select,input').forEach(item => item.disabled = false);
          if (ui.stop) ui.stop.textContent = '\u7ed3\u675f\u5b66\u4e60';
          enforce();
        }
      });
      panel.append(ui.stop);
      const library = el('button', '换个学习视频', { type: 'button', class: 'library' });
      library.addEventListener('click', async event => {
        if (!event.isTrusted) return;
        try { await send('OPEN_LIBRARY'); } catch (error) { ui.error.textContent = error.message; ui.error.hidden = false; }
      });
      panel.append(library);
      if (state.settings.uploaders.length) {
        const switchRow = el('div', '', { class: 'switch-row' });
        const select = el('select', '', { 'aria-label': '\u5207\u6362\u767d\u540d\u5355 UP \u4e3b' });
        select.append(el('option', '\u9009\u62e9 UP \u4e3b', { value: '' }));
        state.settings.uploaders.forEach(up => select.append(el('option', up.name, { value: up.uid })));
        const jump = el('button', '\u5207\u6362', { type: 'button' });
        jump.addEventListener('click', event => {
          if (!event.isTrusted || !state.settings.uploaders.some(up => up.uid === select.value)) return;
          pausePlayers(); location.assign(BF.upUrl(select.value));
        });
        switchRow.append(select, jump); panel.append(switchRow);
      }
      ui.recordState = el('p', '\u64ad\u653e\u8bb0\u5f55\u4f1a\u4fdd\u5b58\u5728\u5b66\u4e60\u7a7a\u95f4\u3002', { class: 'help' }); panel.append(ui.recordState);
      ui.exitHelp = el('p', '', { class: 'help' }); panel.append(ui.exitHelp);
    } else {
      panel.append(el('div', '从这条视频开始学习', { class: 'heading' }));
      ui.notice = el('p', endNotice, { class: 'notice', role: 'status', 'aria-live': 'polite' });
      ui.notice.hidden = !endNotice; panel.append(ui.notice);
      ui.mode = el('select', '', { class: 'mode-select', 'aria-label': '\u8ba1\u65f6\u65b9\u5f0f' });
      ui.mode.append(el('option', '\u5012\u8ba1\u65f6\uff1a\u5230\u65f6\u7ed3\u675f', { value: 'countdown' }),
        el('option', '\u6b63\u8ba1\u65f6\uff1a\u624b\u52a8\u7ed3\u675f', { value: 'countup' }));
      ui.mode.value = state.settings.mode; panel.append(ui.mode);
      const row = el('div', '', { class: 'row' });
      ui.duration = el('input', '', { type: 'number', min: '1', max: '480', step: '1', 'aria-label': '学习分钟数' });
      ui.duration.value = state.settings.duration;
      const minuteLabel = el('span', '\u5206\u949f'); row.append(ui.duration, minuteLabel);
      const modeChange = () => { ui.duration.hidden = minuteLabel.hidden = ui.mode.value === 'countup'; };
      ui.mode.addEventListener('change', modeChange); modeChange();
      ui.start = el('button', '开始学习', { type: 'button', class: 'start' }); row.append(ui.start);
      panel.append(row);
      const label = el('label');
      ui.up = el('input', '', { type: 'checkbox' });
      label.append(ui.up, el('span', '同时放行当前 UP 主的全部普通投稿')); panel.append(label);
      panel.append(el('p', '一键保留已存名单并加入当前视频。勾选后将查询并添加该 UP 主。', { class: 'help' }));
      ui.start.addEventListener('click', async event => {
        if (!event.isTrusted || pending || Date.now() < restartAfter) return;
        pending = true; ui.start.disabled = true; ui.mode.disabled = true; ui.duration.disabled = true; ui.up.disabled = true;
        ui.error.hidden = true;
        try {
          const result = await send('PAGE_START', { url: location.href, duration: Number(ui.duration.value), mode: ui.mode.value, includeUploader: ui.up.checked });
          state = BF.normalizeState(result.state); endNotice = ''; ready = true; enforce();
        } catch (error) {
          if (ui.error) { ui.error.textContent = error.message; ui.error.hidden = false; }
        } finally {
          pending = false;
          if (ui.start) { ui.start.disabled = false; ui.mode.disabled = false; ui.duration.disabled = false; ui.up.disabled = false; }
          enforce();
        }
      });
    }
    // Opening options never stops or resets a session and never reads history into the page.
    ui.options = el('button', '\u6253\u5f00\u5b66\u4e60\u7a7a\u95f4', { type: 'button', class: 'options' });
    ui.options.addEventListener('click', async event => {
      if (!event.isTrusted || ui.options.disabled) return;
      const button = ui.options;
      button.disabled = true; ui.error.hidden = true;
      try { await send('OPEN_OPTIONS'); }
      catch (error) {
        if (ui.error) { ui.error.textContent = error.message; ui.error.hidden = false; }
      } finally { button.disabled = false; }
    });
    panel.append(ui.options);
    ui.error = el('p', '', { class: 'error', role: 'alert', hidden: '' }); panel.append(ui.error);
    shadow.append(style, panel); (document.body || root()).append(host);
    panelMode = on ? 'active' : 'idle';
  }
  function navigate(url) {
    root()?.classList.add('bf-checking'); pausePlayers();
    if (!closing) { closing = true; location.replace(url); }
  }
  function enforce() {
    if (!ready || !root()) return;
    const on = BF.active(state);
    root().classList.toggle('bf-active', on);
    root().classList.toggle('bf-no-comments', on && state.settings.hideComments);
    if (on) {
      const decision = BF.route(location.href, state);
      if (decision.kind === 'verify') return navigate(gateUrl(location.href));
      if (decision.kind === 'redirect') return navigate(decision.url);
      if (decision.kind === 'block') return navigate(blockedUrl);
    }
    root().classList.remove('bf-checking');
    const videoPage = !!BF.videoId(location.href), spacePage = BF.spaceInfo(location.href)?.section === 'video';
    if (videoPage || (on && spacePage)) {
      makePanel(on);
      if (on) {
        const clock = BF.sessionClock(state.session);
        if (ui.timer.textContent !== clock) {
          ui.timer.textContent = clock;
          const label = state.session.mode === 'countup' ? '\u5df2\u5b66\u4e60' : '\u5269\u4f59';
          ui.timerPeek.setAttribute('aria-label', `${label} ${clock}\uff1b\u60ac\u505c\u6216\u952e\u76d8\u805a\u7126\u67e5\u770b\u8ba1\u65f6`);
        }
        ui.modeLabel.textContent = state.session.mode === 'countup' ? '\u6b63\u8ba1\u65f6' : '\u5012\u8ba1\u65f6';
        ui.stop.disabled = pending;
        ui.exitHelp.textContent = state.session.mode === 'countup'
          ? '\u70b9\u51fb\u7ed3\u675f\u5373\u4fdd\u5b58\u8bb0\u5f55\uff0c\u65e0\u9700\u8df3\u8f6c\u6216\u8f93\u5165\u6587\u5b57\u3002'
          : '\u5230\u65f6\u81ea\u52a8\u4fdd\u5b58\uff1b\u4e5f\u53ef\u968f\u65f6\u70b9\u51fb\u7ed3\u675f\u3002';
        ui.summary.textContent = `已开放 ${state.settings.videos.length} 个视频 · ${state.settings.uploaders.length} 位 UP 主`;
      } else {
        ui.notice.textContent = endNotice; ui.notice.hidden = !endNotice;
        ui.start.disabled = pending || Date.now() < restartAfter;
      }
    } else { host?.remove(); host = null; panelMode = ''; }
    if (!on && state.session && !expiryRequested) {
      expiryRequested = true;
      send('GET_STATE').then(result => { state = BF.normalizeState(result.state); enforce(); })
        .catch(() => {}).finally(() => { expiryRequested = false; });
    }
  }
  let pushedState = false;
  function receiveState(value) {
    const next = BF.normalizeState(value);
    if (state.session && !next.session) {
      endNotice = '\u672c\u6b21\u5b66\u4e60\u5df2\u7ed3\u675f\uff0c\u8bb0\u5f55\u5df2\u4fdd\u5b58\u3002';
      restartAfter = Date.now() + 600;
    } else if (next.session) { endNotice = ''; }
    state = next; ready = true; clearTimeout(initTimeout); enforce();
  }
  chrome.runtime.onMessage.addListener((message, sender) => {
    if (sender.id !== chrome.runtime.id || message?.type !== 'BILIFOCUS_STATE_CHANGED') return;
    pushedState = true;
    receiveState(message.state);
  });
  // Content scripts do not receive chrome.storage.local values or change events.
  send('GET_STATE').then(result => {
    if (!pushedState) receiveState(result.state);
  }).catch(() => root()?.classList.remove('bf-checking'));
  document.addEventListener('play', event => {
    if (ready && BF.active(state) && BF.route(location.href, state).kind !== 'allow') {
      event.target.pause?.(); enforce();
    }
  }, true);
  document.addEventListener('click', event => {
    if (!ready || !BF.active(state)) return;
    const anchor = event.composedPath().find(node => node instanceof HTMLAnchorElement);
    if (!anchor) return;
    const parsed = BF.parsedUrl(anchor.href);
    if (!parsed || (parsed.hostname !== 'bilibili.com' && !parsed.hostname.endsWith('.bilibili.com'))) return;
    const decision = BF.route(anchor.href, state);
    const target = decision.kind === 'verify' ? gateUrl(anchor.href)
      : decision.kind === 'redirect' ? decision.url
      : decision.kind === 'block' ? blockedUrl : null;
    if (!target) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (event.ctrlKey || event.metaKey || event.shiftKey || anchor.target === '_blank') {
      window.open(target, '_blank', 'noopener');
    } else { location.assign(target); }
  }, true);
  window.addEventListener('popstate', enforce);
  window.addEventListener('pageshow', enforce);
  document.addEventListener('DOMContentLoaded', enforce, { once: true });

  // A heartbeat proves observed playback; opening a page alone is not a view.
  const documentToken = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let sampleSeq = 0, sampleInFlight = null;
  function mainPlayer() {
    return [...document.querySelectorAll('video,bwp-video')]
      .filter(v => Number.isFinite(Number(v.currentTime)))
      .sort((a,b) => Number(!b.paused)-Number(!a.paused) ||
        b.getBoundingClientRect().width*b.getBoundingClientRect().height-a.getBoundingClientRect().width*a.getBoundingClientRect().height)[0];
  }
  async function samplePlayback(reason = 'heartbeat') {
    if (pending && reason !== 'stop') return;
    if (sampleInFlight) {
      if (reason !== 'stop') return sampleInFlight;
      await sampleInFlight;
    }
    if (!ready || !BF.active(state) || !BF.videoId(location.href) || BF.route(location.href,state).kind !== 'allow') return;
    const player = mainPlayer();
    if (!player) return;
    const pip = document.pictureInPictureElement === player;
    const eligible = document.visibilityState === 'visible' || pip;
    const playing = !player.paused && !player.ended && !player.seeking && (player.readyState == null || player.readyState >= 2);
    const upLink = document.querySelector('.up-info-container a.up-name, .up-info-container .up-name a, .up-info-container a[href*="space.bilibili.com"], .up-info--right a[href*="space.bilibili.com"]');
    const titleEl = document.querySelector('h1.video-title, h1[title], h1');
    const partEl = document.querySelector('.video-pod__item.active .title, .list-box .on .part, .cur-list .on .part');
    const payload = { sessionId: state.session.id, documentToken, seq: ++sampleSeq, url: location.href,
      mediaTime: Number(player.currentTime), rate: Number(player.playbackRate) || 1,
      playing, eligible, pip, seeking: player.seeking === true || reason === 'seeking',
      title: titleEl?.getAttribute('title') || titleEl?.textContent?.trim() || document.title.replace(/_\u54d4\u54e9\u54d4\u54e9_bilibili.*$/, ''),
      uid: BF.spaceInfo(upLink?.href)?.uid || '', name: upLink?.textContent?.trim() || '',
      partTitle: partEl?.textContent?.trim() || '' };
    const task = (async () => {
    try {
      await send('TRACK_PLAYBACK', payload);
      if (ui.recordState) ui.recordState.textContent = playing && eligible
        ? '\u6b63\u5728\u8bb0\u5f55\u524d\u53f0\u64ad\u653e\uff0c\u53ef\u5728\u5b66\u4e60\u7a7a\u95f4\u56de\u770b\u3002'
        : '\u6682\u505c\u6216\u540e\u53f0\u65f6\uff0c\u4e0d\u7d2f\u8ba1\u89c6\u9891\u64ad\u653e\u65f6\u957f\u3002';
    } catch (_) {
      if (ui.recordState) ui.recordState.textContent = '\u64ad\u653e\u8bb0\u5f55\u6682\u672a\u4fdd\u5b58\uff0c\u8bf7\u68c0\u67e5\u6269\u5c55\u6216\u5237\u65b0\u9875\u9762\u3002';
    }
    })();
    sampleInFlight = task;
    try { await task; } finally { if (sampleInFlight === task) sampleInFlight = null; }
  }
  ['play','playing','pause','ended','seeking','seeked','ratechange'].forEach(name =>
    document.addEventListener(name, () => samplePlayback(name), true));
  document.addEventListener('visibilitychange', () => samplePlayback('visibility'));
  window.addEventListener('pagehide', () => samplePlayback('pagehide'));
  setInterval(samplePlayback, 5000);

  setInterval(enforce, 250);
})();
