from pathlib import Path
from playwright.sync_api import sync_playwright, expect
import json,re,traceback
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'tests'/'ui-v032-output';OUT.mkdir(exist_ok=True)
RESULTS=[];ERRORS=[]
MOCK=r'''
(() => {
 const store={bilifocus_v1:{settings:{videos:[{bvid:'BV1xx411c7mD',title:'\u6c11\u6cd5\u5b66\u4e60'}],uploaders:[{uid:'417302260',name:'\u4f17\u5408\u6559\u80b2'},{uid:'999',name:'\u82f1\u8bed\u5b66\u4e60\u793a\u4f8b UP'}],duration:45,mode:'countdown',hideComments:true},session:null}};
 const listeners=[],contentMessages=[],events={},rules=[],alarms={};window.__store=store;window.__messages=[];window.__created=[];
 window.__testLocation={href:'https://www.bilibili.com/video/BV1xx411c7mD/',replace:u=>{window.__nav=u;},assign:u=>{window.__nav=u;}};
 let chrome={
  storage:{local:{setAccessLevel:async value=>{window.__storageAccess=value.accessLevel;},get:async k=>({[k]:structuredClone(store[k])}),set:async data=>{if(window.__failWrites)throw Error('Test: local storage write failed');const changes={};for(const [k,v] of Object.entries(data)){changes[k]={oldValue:structuredClone(store[k]),newValue:structuredClone(v)};store[k]=structuredClone(v);}queueMicrotask(()=>listeners.forEach(f=>f(changes,'local')));}},onChanged:{addListener:f=>listeners.push(f)}},
  declarativeNetRequest:{getDynamicRules:async()=>structuredClone(rules),updateDynamicRules:async cfg=>rules.splice(0,rules.length,...structuredClone(cfg.addRules))},
  alarms:{clear:async name=>delete alarms[name],create:async(n,v)=>alarms[n]=v,onAlarm:{addListener:f=>events.alarm=f}},
  action:{setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{}},
  tabs:{sendMessage:async(id,message,sender)=>{contentMessages.forEach(fn=>fn(structuredClone(message),{id:'test'}));},query:async()=>[{id:2,url:window.__testLocation.href,title:'\u6c11\u6cd5\u5b66\u4e60',active:true}],get:async id=>({id,url:window.__testLocation.href,title:'\u6c11\u6cd5\u5b66\u4e60',active:true}),update:async(id,data)=>{window.__created.push(data);},create:async data=>window.__created.push(data)},
  runtime:{id:'test',getURL:p=>'chrome-extension://test/'+p,openOptionsPage:async()=>{if(window.__failOpenOptions)throw Error('Test: options unavailable');window.__openedOptions=true;},onMessage:{addListener:f=>{if(!events.message)events.message=f;else contentMessages.push(f);}},onInstalled:{addListener:f=>events.installed=f},onStartup:{addListener:f=>events.startup=f}}
 };
 window.chrome=chrome;
 chrome.runtime.sendMessage=message=>{window.__messages.push(message);const sender=window.__role==='content'?{id:'test',url:window.__testLocation.href,frameId:0,tab:{id:2}}:{id:'test',url:'chrome-extension://test/'+window.__role};return new Promise(resolve=>events.message(message,sender,resolve));};
 window.__fetch=async address=>({ok:true,json:async()=>({code:0,data:{bvid:new URL(address).searchParams.get('bvid'),owner:{mid:'417302260',name:'\u4f17\u5408\u6559\u80b2'},title:'\u6c11\u6cd5\u5b66\u4e60'}})});
 window.__downloads=[];const blobs={};const originalCreate=URL.createObjectURL.bind(URL);
 URL.createObjectURL=blob=>{const url=originalCreate(blob);blobs[url]=blob;return url;};
 const originalClick=HTMLAnchorElement.prototype.click;
 HTMLAnchorElement.prototype.click=function(){if(this.download){const name=this.download;blobs[this.href].text().then(text=>window.__downloads.push({name,text}));return;}return originalClick.call(this);};
})();
'''
SEED=r'''
(async()=>{
 const d='2026-10-12',t=(h,m)=>new Date(2026,9,12,h,m).getTime();
 const a={id:'demo-a',mode:'countdown',startedAt:t(9,0),plannedEnd:t(9,45),endedAt:t(9,45),reason:'completed',playedMs:2240000,days:{[d]:2240000},videos:[
 {key:'BV1xx411c7mD:p1',bvid:'BV1xx411c7mD',part:1,title:'\u6c11\u6cd5 | \u7269\u6743\u53d8\u52a8\u7684\u4f53\u7cfb\u4e0e\u8981\u4ef6',uid:'417302260',name:'\u4f17\u5408\u6559\u80b2',firstAt:t(9,0),lastAt:t(9,23),playedMs:1320000,days:{[d]:1320000}},
 {key:'BV1ab411c7mD:p2',bvid:'BV1ab411c7mD',part:2,title:'\u6c11\u6cd5 | \u62c5\u4fdd\u7269\u6743\u6848\u4f8b\u7ec3\u4e60',uid:'417302260',name:'\u4f17\u5408\u6559\u80b2',firstAt:t(9,25),lastAt:t(9,44),playedMs:920000,days:{[d]:920000}}]};
 const b={id:'demo-b',mode:'countup',startedAt:t(14,0),plannedEnd:null,endedAt:t(14,55),reason:'manual',playedMs:2590000,days:{[d]:2590000},videos:[
 {key:'BV1cd411c7mD:p1',bvid:'BV1cd411c7mD',part:1,title:'\u82f1\u8bed\u9605\u8bfb | \u5e72\u6270\u9879\u6392\u9664\u4e0e\u9519\u56e0\u590d\u76d8',uid:'999',name:'\u82f1\u8bed\u5b66\u4e60\u793a\u4f8b UP',firstAt:t(14,0),lastAt:t(14,25),playedMs:1390000,days:{[d]:1390000}},
 {key:'BV1ef411c7mD:p1',bvid:'BV1ef411c7mD',part:1,title:'\u5211\u6cd5 | \u5171\u540c\u72af\u7f6a\u7684\u8ba4\u5b9a\u8def\u5f84',uid:'417302260',name:'\u4f17\u5408\u6559\u80b2',firstAt:t(14,30),lastAt:t(14,53),playedMs:1200000,days:{[d]:1200000}}]};
 await chrome.storage.local.set({bilifocus_records_v1:{version:1,sessions:[a,b],pruned:0}});
})();
'''
def check(name,fn):
 try:fn();RESULTS.append({'test':name,'passed':True});print('PASS',name)
 except Exception as ex:RESULTS.append({'test':name,'passed':False,'error':str(ex)});print('FAIL',name,str(ex)[:400]);traceback.print_exc()
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
 ctx=browser.new_context(viewport={'width':1400,'height':1100},device_scale_factor=1,locale='zh-CN',timezone_id='Asia/Shanghai')
 ctx.set_default_timeout(4000)
 backend='\n'.join((ROOT/f).read_text() for f in ['logic.js','records.js'])+'\n'+re.sub(r"importScripts\('[^']+'\);",'',(ROOT/'background.js').read_text())
 def load(role='options.html'):
  page=ctx.new_page();page.on('pageerror',lambda error:ERRORS.append(str(error)))
  if role=='content':
   page.set_content('<html><body style="padding:40px;background:#f5f6f7"><h1 class="video-title" title="Learning demo">Learning demo</h1><div style="width:70vw;height:70vh;background:#202928;color:#fff;display:grid;place-content:center">BiliFocus / OFFLINE VIDEO FIXTURE</div><video></video><div class="up-info-container"><a class="up-name" href="https://space.bilibili.com/417302260">Course provider</a></div></body></html>')
   scripts=['content.js']
  else:
   html=(ROOT/role).read_text();scripts=re.findall(r'<script src="([^"]+)"></script>',html)
   html=re.sub(r'<script src="[^"]+"></script>','',html);html=re.sub(r'<link rel="stylesheet" href="[^"]+">','',html)
   page.set_content(html);page.add_style_tag(content=(ROOT/'ui.css').read_text())
  page.add_script_tag(content='window.__role='+json.dumps(role)+';')
  page.add_script_tag(content=MOCK)
  page.evaluate('(code)=>{new Function("chrome","fetch",code)(window.chrome,window.__fetch);}',backend)
  for script in scripts:
   if script in ['logic.js','records.js']:continue
   code=(ROOT/script).read_text()
   if script=='content.js':code=code.replace('location.href','window.__testLocation.href').replace('location.replace','window.__testLocation.replace').replace('location.assign','window.__testLocation.assign')
   page.add_script_tag(content=code)
  page.wait_for_timeout(100)
  return page
 page=load()
 check('records tab opens the empty state without errors',lambda:(page.locator('#records-tab').click(),expect(page.locator('.empty-records')).to_be_visible()))
 page.evaluate(SEED)
 page.locator('#record-date').fill('2026-10-12');page.locator('#record-date').dispatch_event('change');page.wait_for_timeout(200)
 def daily_metrics():
  expect(page.locator('#day-count')).to_have_text('2');expect(page.locator('#day-videos')).to_have_text('4')
  assert page.locator('#day-mode').inner_text()=='1\u5c0f\u65f640\u52060\u79d2'
  assert page.locator('#day-played').inner_text()=='1\u5c0f\u65f620\u520630\u79d2'
 check('daily totals aggregate two modes and four videos correctly',daily_metrics)
 check('session cards retain distinct start/end times and playback details',lambda:(expect(page.locator('.record-session')).to_have_count(2),expect(page.locator('.record-video')).to_have_count(4)))
 def screenshot():
  page.locator('details.record-session').evaluate_all('(els)=>els.forEach(e=>e.open=true)')
  page.locator('.hero h1').evaluate("e=>e.textContent='\u5b66\u4e60\u8bb0\u5f55\uff0c\u770b\u5f97\u89c1\u3002'")
  page.locator('.hero p:last-child').evaluate("e=>e.textContent='\u6d4b\u8bd5\u6570\u636e\u00b7\u754c\u9762\u9884\u89c8\uff08\u4e0d\u662f\u771f\u5b9e\u89c2\u770b\u8bb0\u5f55\uff09'")
  page.locator('.record-intro h2').click();page.screenshot(path=str(OUT/'records-desktop.png'),full_page=True)
 check('records screenshot renders with explicit demo-data label',screenshot)
 def exports():
  page.locator('#export-day').click();page.wait_for_function('window.__downloads.length>=1')
  d=page.evaluate('window.__downloads[0]');assert d['name']=='BiliFocus-2026-10-12.md';assert '\u4f17\u5408\u6559\u80b2' in d['text']
  page.locator('#export-records').click();page.wait_for_function('window.__downloads.length>=2')
  data=json.loads(page.evaluate('window.__downloads[1].text'));assert len(data['history']['sessions'])==2
 check('daily Markdown and full JSON export contain expected records',exports)
 def dates():
  page.locator('#date-prev').click();expect(page.locator('#day-count')).to_have_text('0');page.locator('#date-next').click();expect(page.locator('#day-count')).to_have_text('2')
 check('date navigation changes the day instead of losing archives',dates)
 def xss():
  page.evaluate("async()=>{const h=structuredClone(__store.bilifocus_records_v1);h.sessions[0].videos[0].title='<img src=x onerror=alert(1)>';await chrome.storage.local.set({bilifocus_records_v1:h});}")
  page.wait_for_timeout(200);assert page.locator('.record-video img').count()==0
  assert '<img src=x onerror=alert(1)>' in '\n'.join(page.locator('.record-video a').all_text_contents())
 check('video titles render as text, not executable HTML',xss)
 def narrow():
  page.set_viewport_size({'width':480,'height':950});assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
  page.screenshot(path=str(OUT/'records-narrow.png'),full_page=True)
 check('history and metrics fit narrow windows',narrow)
 page.set_viewport_size({'width':1400,'height':1100});page.locator('#settings-tab').click()
 def countup():
  page.locator('#mode').select_option('countup');expect(page.locator('#duration-field')).to_be_hidden();expect(page.locator('#timer')).to_have_text('00:00')
  page.locator('#start').click();expect(page.locator('#mode')).to_be_disabled();page.wait_for_timeout(1200)
  expect(page.locator('#timer')).not_to_have_text('00:00'); assert page.locator('#timer').inner_text() != 'NaN:NaN'
  assert page.evaluate('__store.bilifocus_v1.session.endsAt') is None
 check('countup starts from zero, accumulates and locks settings',countup)
 def live_record():
  page.locator('#records-tab').click();page.locator('#date-today').click();expect(page.locator('#clear-records')).to_be_disabled()
  assert page.evaluate('__store.bilifocus_record_current_v1.mode')=='countup'
 check('active countup appears in history and cannot be erased mid-session',live_record)
 def stop_archive():
  page.locator('#settings-tab').click();assert page.locator('#confirmation').count()==0;page.locator('#stop').click()
  expect(page.locator('#mode')).to_be_enabled();assert page.evaluate('__store.bilifocus_records_v1.sessions.length')==3
  assert page.evaluate('__store.bilifocus_record_current_v1') is None
 check('one-click learning-space finish archives session and unlocks settings',stop_archive)

 def timer_checks(v, label):
  timer=v.locator('#bilifocus-panel .clock')
  target=v.locator('#bilifocus-panel .clock-peek')
  hint=v.locator('#bilifocus-panel .clock-hint')
  def concealed():
   v.mouse.click(20,20);expect(timer).to_be_hidden();expect(hint).to_be_visible()
   assert v.locator('#bilifocus-panel .mode-select').count()==0
  check(label+' clock is hidden by default while the session remains active',concealed)
  def hover():
   before=v.locator('#bilifocus-panel').bounding_box();target.hover()
   expect(timer).to_be_visible();expect(hint).to_be_hidden()
   text=timer.inner_text();v.wait_for_timeout(1150);assert text!=timer.inner_text()
   assert before==v.locator('#bilifocus-panel').bounding_box()
   assert target.get_attribute('aria-label')
  check(label+' hover reveals a live clock without changing panel size',hover)
  def leave_after_click():
   target.click();v.mouse.move(20,20);expect(timer).to_be_hidden();expect(hint).to_be_visible()
   v.get_by_role('button',name='\u7ed3\u675f\u5b66\u4e60',exact=True).hover();expect(timer).to_be_hidden()
  check(label+' mouse exit hides time even after clicking; unrelated hover stays quiet',leave_after_click)
  def keyboard():
   v.mouse.move(20,20);v.keyboard.press('Tab');target.focus()
   expect(timer).to_be_visible();expect(hint).to_be_hidden()
   v.keyboard.press('Tab');expect(timer).to_be_hidden()
  check(label+' keyboard focus can reveal the clock and moving focus hides it',keyboard)

 video=load('content')
 def idle_options():
  button=video.get_by_role('button',name='\u6253\u5f00\u5b66\u4e60\u7a7a\u95f4',exact=True)
  expect(button).to_be_visible();button.click()
  assert video.evaluate('__openedOptions') is True
  assert video.evaluate('__store.bilifocus_v1.session') is None
  assert video.evaluate('window.__nav || null') is None
  video.evaluate('window.__openedOptions=false')
 check('idle video page opens learning space without starting or navigating the video',idle_options)
 def page_mode():
  video.get_by_label('\u8ba1\u65f6\u65b9\u5f0f').select_option('countup')
  expect(video.get_by_label('\u5b66\u4e60\u5206\u949f\u6570')).to_be_hidden()
  video.get_by_role('button',name='\u5f00\u59cb\u5b66\u4e60',exact=True).click()
  expect(video.locator('#bilifocus-panel .active')).to_be_visible()
  assert video.evaluate('__store.bilifocus_v1.session.mode')=='countup'
  assert video.locator('#bilifocus-panel button').all_text_contents()==['\u7ed3\u675f\u5b66\u4e60','\u6362\u4e2a\u5b66\u4e60\u89c6\u9891','\u5207\u6362','\u6253\u5f00\u5b66\u4e60\u7a7a\u95f4']
 check('video-page countup has a direct end button',page_mode)

 timer_checks(video,'countup')
 def active_options():
  before=video.evaluate('JSON.stringify(__store.bilifocus_v1)')
  video.get_by_role('button',name='\u6253\u5f00\u5b66\u4e60\u7a7a\u95f4',exact=True).click()
  assert video.evaluate('__openedOptions') is True
  assert video.evaluate('JSON.stringify(__store.bilifocus_v1)')==before
  assert video.evaluate('window.__nav || null') is None
  assert not video.evaluate('__store.bilifocus_records_v1')
  video.evaluate('window.__openedOptions=false')
 check('active video page opens learning space without ending or resetting learning',active_options)
 def synthetic_options():
  n=video.evaluate('__messages.filter(m=>m.type==="OPEN_OPTIONS").length')
  video.locator('#bilifocus-panel .options').evaluate('e=>e.click()')
  assert video.evaluate('__messages.filter(m=>m.type==="OPEN_OPTIONS").length')==n
  assert video.evaluate('__openedOptions') is False
 check('synthetic page clicks cannot open learning space',synthetic_options)
 def failed_options():
  before=video.evaluate('__store.bilifocus_v1.session.id')
  video.evaluate('window.__failOpenOptions=true')
  button=video.get_by_role('button',name='\u6253\u5f00\u5b66\u4e60\u7a7a\u95f4',exact=True)
  button.click();expect(video.locator('#bilifocus-panel .error')).to_contain_text('options unavailable')
  expect(button).to_be_enabled();assert video.evaluate('__store.bilifocus_v1.session.id')==before
  video.evaluate('window.__failOpenOptions=false');button.click()
  expect(video.locator('#bilifocus-panel .error')).to_be_hidden()
  assert video.evaluate('__openedOptions') is True
  video.evaluate('window.__openedOptions=false')
 check('options errors leave learning intact and the shortcut can retry',failed_options)
 def player_sample():
  video.evaluate("""()=>{const v=document.querySelector('video');Object.defineProperties(v,{currentTime:{value:0,writable:true},paused:{value:false,writable:true},ended:{value:false},seeking:{value:false},readyState:{value:4},playbackRate:{value:1}});v.dispatchEvent(new Event('playing',{bubbles:true}));}""")
  video.wait_for_timeout(350)
  video.evaluate("()=>{const v=document.querySelector('video');v.currentTime=.35;v.paused=true;v.dispatchEvent(new Event('pause',{bubbles:true}));}")
  video.wait_for_timeout(150)
  assert video.evaluate('__store.bilifocus_record_current_v1.playedMs')>100
  assert video.evaluate('__store.bilifocus_record_current_v1.videos.length')==1
 check('content samples reach real background logic and record observed progress',player_sample)
 def cross_up():
  video.get_by_label('\u5207\u6362\u767d\u540d\u5355 UP \u4e3b').select_option('999');video.get_by_role('button',name='\u5207\u6362',exact=True).click()
  assert video.evaluate('window.__nav')=='https://space.bilibili.com/999/video';assert video.evaluate('__store.bilifocus_v1.session.mode')=='countup'
  video.screenshot(path=str(OUT/'page-active.png'),full_page=True)
 check('cross-UP switch targets selected allowed uploader without ending session',cross_up)

 def synthetic_click():
  video.locator('#bilifocus-panel .stop').evaluate('e=>e.click()')
  assert video.evaluate('__store.bilifocus_v1.session !== null')
  assert video.evaluate('__messages.filter(m=>m.type==="PAGE_STOP").length')==0
 check('a page-script synthetic click cannot end the session',synthetic_click)
 def direct_end():
  video.evaluate('window.__nav=null')
  video.evaluate("()=>{const v=document.querySelector('video');v.paused=false;v.dispatchEvent(new Event('playing',{bubbles:true}));}")
  video.wait_for_timeout(300)
  before=video.evaluate('__store.bilifocus_record_current_v1.playedMs')
  video.evaluate("document.querySelector('video').currentTime+=.30")
  video.get_by_role('button',name='\u7ed3\u675f\u5b66\u4e60',exact=True).click()
  expect(video.get_by_role('button',name='\u5f00\u59cb\u5b66\u4e60',exact=True)).to_be_visible()
  expect(video.locator('#bilifocus-panel .notice')).to_contain_text('\u8bb0\u5f55\u5df2\u4fdd\u5b58')
  assert video.evaluate('__store.bilifocus_v1.session') is None
  assert video.evaluate('__store.bilifocus_records_v1.sessions.length')==1
  assert video.evaluate('__store.bilifocus_records_v1.sessions[0].playedMs')>before
  assert video.evaluate('__store.bilifocus_records_v1.sessions[0].reason')=='manual'
  assert not video.evaluate('document.documentElement.classList.contains("bf-active")')
  assert video.evaluate('window.__nav') is None
  assert not video.evaluate('window.__openedOptions || false')
  assert video.evaluate('__messages.at(-1).type')=='PAGE_STOP'
  video.screenshot(path=str(OUT/'page-ended.png'),full_page=True)
 check('video-page click flushes playback, saves and restores browsing without navigation',direct_end)
 def restart_after_end():
  video.get_by_label('\u8ba1\u65f6\u65b9\u5f0f').select_option('countdown')
  video.get_by_label('\u5b66\u4e60\u5206\u949f\u6570').fill('1')
  video.get_by_role('button',name='\u5f00\u59cb\u5b66\u4e60',exact=True).click()
  expect(video.locator('#bilifocus-panel .active')).to_be_visible()
  assert video.evaluate('__store.bilifocus_records_v1.sessions.length')==1
  assert video.evaluate('__store.bilifocus_v1.session.mode')=='countdown'
  assert video.evaluate('__store.bilifocus_v1.settings.uploaders.length')==2
 check('another session starts directly and preserves history plus UP whitelist',restart_after_end)
 timer_checks(video,'countdown')
 def failure_and_retry():
  video.evaluate('window.__failWrites=true')
  video.get_by_role('button',name='\u7ed3\u675f\u5b66\u4e60',exact=True).click()
  expect(video.locator('#bilifocus-panel .error')).to_contain_text('write failed')
  expect(video.get_by_role('button',name='\u7ed3\u675f\u5b66\u4e60',exact=True)).to_be_enabled()
  assert video.evaluate('__store.bilifocus_v1.session !== null')
  assert video.evaluate('__store.bilifocus_records_v1.sessions.length')==1
  video.evaluate('window.__failWrites=false')
  video.get_by_role('button',name='\u7ed3\u675f\u5b66\u4e60',exact=True).click()
  expect(video.get_by_role('button',name='\u5f00\u59cb\u5b66\u4e60',exact=True)).to_be_visible()
  assert video.evaluate('__store.bilifocus_records_v1.sessions.length')==2
 check('failed saving keeps session active and permits a successful one-click retry',failure_and_retry)
 def narrow_controls():
  video.set_viewport_size({'width':390,'height':850})
  video.get_by_role('button',name='\u5f00\u59cb\u5b66\u4e60',exact=True).click()
  rect=video.locator('#bilifocus-panel').bounding_box()
  assert rect['x']>=0 and rect['x']+rect['width']<=390
  expect(video.get_by_role('button',name='\u7ed3\u675f\u5b66\u4e60',exact=True)).to_be_visible()
  video.screenshot(path=str(OUT/'page-narrow.png'),full_page=True)
  video.get_by_role('button',name='\u7ed3\u675f\u5b66\u4e60',exact=True).click()
 check('start and end controls remain accessible in a narrow browser window',narrow_controls)
 check('no uncaught UI or background JavaScript errors',lambda:assert_no_errors()) if False else None
 if ERRORS:RESULTS.append({'test':'no uncaught JavaScript errors','passed':False,'errors':ERRORS});print('FAIL JS',ERRORS)
 else:RESULTS.append({'test':'no uncaught JavaScript errors','passed':True});print('PASS no uncaught JavaScript errors')
 browser.close()
(OUT/'results.json').write_text(json.dumps(RESULTS,ensure_ascii=False,indent=2))
print(json.dumps({'tests':len(RESULTS),'passed':sum(t['passed'] for t in RESULTS)}))
raise SystemExit(0 if all(t['passed'] for t in RESULTS) else 1)
