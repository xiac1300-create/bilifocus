
from pathlib import Path
import json, re, traceback
from playwright.sync_api import sync_playwright, expect

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT / "tests" / "ui-output"
OUT.mkdir(exist_ok=True)
RESULTS=[]
V1="BV1xx411c7mD"; V2="BV1ab411c7mD"
mock=r"""
(() => {
 const BFKEY='bilifocus_v1';
 window.__state={settings:{videos:[{bvid:'BV1xx411c7mD',title:'示例课程 · 知识体系整理'}],uploaders:[],duration:45,hideComments:true},session:null};
 window.__messages=[]; window.__listeners=[]; window.__runtimeListeners=[];
 const emit=()=>{
  window.__listeners.forEach(fn=>fn({[BFKEY]:{newValue:structuredClone(window.__state)}},'local'));
  window.__runtimeListeners.forEach(fn=>fn({type:'BILIFOCUS_STATE_CHANGED',state:structuredClone(window.__state)},{id:'uitest'}));
 };
 window.__setState=s=>{window.__state=structuredClone(s);emit();};
 const start=(duration)=>{
  const now=Date.now(); window.__state.session={startedAt:now,endsAt:now+duration*60000,grants:[]};
 };
 const runtime={
  onMessage:{addListener:fn=>window.__runtimeListeners.push(fn)},
  id:'uitest',getURL:p=>'http://127.0.0.1:8769/'+p,
  sendMessage:async m=>{
   window.__messages.push(structuredClone(m));
   if(m.type==='GET_STATE') return {ok:true,state:structuredClone(window.__state)};
   if(m.type==='OPEN_LIBRARY'||m.type==='OPEN_OPTIONS') return {ok:true};
   if(m.type==='PAGE_START'){
    const id=new URL(location.href).pathname.split('/')[2];
    if(!window.__state.settings.videos.some(v=>v.bvid===id))window.__state.settings.videos.push({bvid:id,title:'示例课程'});
    window.__state.settings.duration=m.duration;
    if(m.includeUploader)window.__state.settings.uploaders=[{uid:'417302260',name:'众合教育'}];
    start(m.duration);emit();return {ok:true,state:structuredClone(window.__state)};
   }
   if(m.type==='SAVE'||m.type==='START'){
    window.__state.settings=structuredClone(m.settings);
    if(m.type==='START')start(m.settings.duration);
    emit();return {ok:true,state:structuredClone(window.__state)};
   }
   if(m.type==='STOP'||m.type==='PAGE_STOP'){
    window.__state.session=null;emit();return {ok:true,state:structuredClone(window.__state)};
   }
   if(m.type==='VERIFY_VIDEO') return {ok:false,error:'模拟接口失败：保持拦截，请重试。'};
   return {ok:true,state:structuredClone(window.__state)};
  }
 };
 window.chrome = {
  runtime,
  storage:{local:{get:async key=>({[key]:structuredClone(window.__state)})},onChanged:{addListener:fn=>window.__listeners.push(fn)}},
  tabs:{query:async()=>[{id:1,url:'https://www.bilibili.com/video/BV1xx411c7mD/',title:'示例视频'}]}
 };
})();
"""
def check(name, fn):
 try:
  fn();RESULTS.append({'test':name,'passed':True}); print('PASS',name)
 except Exception as e:
  RESULTS.append({'test':name,'passed':False,'error':str(e)}); print('FAIL',name,str(e)[:350])
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
 ctx=browser.new_context(viewport={'width':1400,'height':1100},device_scale_factor=1)

 ctx.set_default_timeout(4000)
 errors=[]
 def load(name, width=1400, height=1100):
  p=ctx.new_page()
  p.set_viewport_size({'width':width,'height':height})
  p.on('pageerror',lambda error:errors.append(str(error)))
  html=(ROOT/name).read_text(encoding='utf-8')
  scripts=re.findall(r'<script src="([^"]+)"></script>',html)
  html=re.sub(r'<script src="[^"]+"></script>','',html)
  html=re.sub(r'<link rel="stylesheet" href="[^"]+">','',html)
  p.set_content(html)
  p.add_style_tag(content=(ROOT/'ui.css').read_text(encoding='utf-8'))
  p.add_script_tag(content=mock)
  if name=='gate.html':
   p.add_script_tag(content="window.__testLocation={hash:'#https%3A%2F%2Fwww.bilibili.com%2Fvideo%2FBV1ab411c7mD%2F',replace:u=>{window.__navigated=u;}}")
  for script in scripts:
   code=(ROOT/script).read_text(encoding='utf-8')
   if script=='gate.js':code=code.replace('location.hash','window.__testLocation.hash').replace('location.replace','window.__testLocation.replace')
   p.add_script_tag(content=code)
  p.wait_for_timeout(100)
  return p
 page=load('options.html')
 def options_defaults():
  expect(page.locator('#videos')).to_contain_text('') # textarea value checked separately
  assert V1 in page.locator('#videos').input_value()
  assert page.locator('#uploaders').input_value()==''
 check('options loads migrated video list and empty uploader list',options_defaults)
 def add_example():
  page.get_by_role('button',name='添加众合教育',exact=True).click()
  assert '417302260' in page.locator('#uploaders').input_value()
  page.get_by_role('button',name='保存两份名单',exact=True).click()
  expect(page.locator('#up-count')).to_have_text('1 位 UP 主')
  expect(page.locator('#up-queue a')).to_have_attribute('href','https://space.bilibili.com/417302260/video')
 check('add named uploader example and save both lists',add_example)
 page.screenshot(path=str(OUT/'BiliFocus-v0.3.2-settings.png'),full_page=True)
 def invalid_name():
  page.locator('#uploaders').fill('仅有昵称')
  page.get_by_role('button',name='保存两份名单',exact=True).click()
  expect(page.locator('#notice')).to_contain_text('UID')
  page.locator('#uploaders').fill('众合教育 | https://space.bilibili.com/417302260')
 check('bare uploader name is rejected rather than guessed',invalid_name)
 def start_lock():
  page.locator('#duration').fill('1')
  page.get_by_role('button',name='保存并开始学习',exact=True).click()
  expect(page.locator('#videos')).to_be_disabled()
  expect(page.locator('#uploaders')).to_be_disabled()
  expect(page.locator('#add-example')).to_be_disabled()
  expect(page.locator('#start')).to_be_hidden()
 check('starting locks video and uploader settings',start_lock)
 def stop_direct():
  assert page.locator('#confirmation').count()==0
  page.locator('#stop').click()
  expect(page.locator('#videos')).to_be_enabled()
  expect(page.locator('#session-controls')).to_be_hidden()
 check('learning-space end is a single click with no typing field',stop_direct)
 # Read-only directory and block page have no buttons or links to options.
 for filename in ['library.html','blocked.html']:
  page=load(filename)
  page.evaluate("""()=>{const now=Date.now();window.__setState({settings:{videos:[{bvid:'BV1xx411c7mD',title:'课程'}],uploaders:[{uid:'417302260',name:'众合教育'}],duration:45,hideComments:true},session:{startedAt:now,endsAt:now+2700000,grants:[]}})}""")
  def no_exit():
   assert page.locator('button').count()==0
   assert page.locator('a[href*="options"]').count()==0
   expect(page.locator('#home')).to_be_hidden()
   expect(page.locator('#up-queue a')).to_have_attribute('href','https://space.bilibili.com/417302260/video')
  check(filename+' is read-only with no early-exit shortcut',no_exit)
 # Actual content.js against a simulated Bilibili document, not the live site.
 sample=r"""<!doctype html><html><head><meta charset="utf-8"><title>课程页面 · 模拟测试</title></head><body style="margin:0;background:#f3f5f6;font-family:system-ui,'Microsoft YaHei',sans-serif;color:#26332c">
 <div class="bili-header" style="height:64px;background:#fff;padding:15px 5%;box-sizing:border-box">B站页面结构模拟 · 以下内容仅用于界面测试</div>
 <main style="max-width:1160px;margin:36px auto"><h1 style="font-size:25px">示例课程｜把知识整理成可用的体系</h1><p style="color:#778278">这是模拟视频页，不是 B站直播画面，也不包含真实课程内容。</p>
 <div style="display:flex;gap:28px;margin-top:24px"><div style="height:470px;background:#202b27;flex:1;border-radius:14px;display:grid;place-items:center;color:#dae5db;font-size:20px">播放器区域 · 保留原播放器与倍速操作</div>
 <aside class="recommend-list" style="width:245px;border-radius:14px;background:#fff;padding:20px">推荐列表（学习时隐藏）</aside></div>
 <section id="comment" style="background:#fff;margin-top:22px;padding:22px">评论区（开启隐藏后不显示）</section></main></body></html>"""

 cp=ctx.new_page();cp.on('pageerror',lambda error:errors.append(str(error)))
 cp.set_content(sample)
 cp.add_script_tag(content=mock)
 cp.add_script_tag(content="window.__testLocation={href:'https://www.bilibili.com/video/BV1xx411c7mD/',replace:u=>{window.__navigated=u;},assign:u=>{window.__navigated=u;}}")
 # PAGE_START test mock reads the simulated location, just like the content script.
 cp.evaluate("()=>{window.__messages.length=0;}")
 # Override only the URL read in the mock, without making any network request.
 cp.add_script_tag(content=mock.replace('location.href','window.__testLocation.href'))
 cp.add_script_tag(content=(ROOT/'logic.js').read_text(encoding='utf-8'))
 cp.add_style_tag(content=(ROOT/'content.css').read_text(encoding='utf-8'))
 code=(ROOT/'content.js').read_text(encoding='utf-8')
 code=code.replace('location.href','window.__testLocation.href').replace('location.replace','window.__testLocation.replace').replace('location.assign','window.__testLocation.assign')
 cp.add_script_tag(content=code)
 def page_entry():
  expect(cp.get_by_role('button',name='开始学习',exact=True)).to_be_visible()
  expect(cp.get_by_role('button',name='打开学习空间',exact=True)).to_be_visible()
  expect(cp.locator('#bilifocus-panel')).to_be_visible()
 check('video page shows direct start and the options shortcut',page_entry)
 cp.screenshot(path=str(OUT/'BiliFocus-v0.3.2-page-start.png'))
 def one_click_start():
  cp.get_by_role('spinbutton',name='学习分钟数').fill('25')
  cp.get_by_role('checkbox').check()
  cp.get_by_role('button',name='开始学习',exact=True).click()
  expect(cp.get_by_role('button',name='换个学习视频',exact=True)).to_be_visible()
  assert cp.get_by_role('button',name='开始学习',exact=True).count()==0
  expect(cp.get_by_role('button',name='结束学习',exact=True)).to_be_visible()
  call=cp.evaluate("window.__messages.find(m=>m.type==='PAGE_START')")
  assert call['duration']==25 and call['includeUploader'] is True
  expect(cp.locator('.recommend-list')).to_be_hidden()
  expect(cp.locator('#comment')).to_be_hidden()
 check('page start retains uploader checkbox and shows one-click end',one_click_start)
 cp.mouse.move(20,20)
 cp.screenshot(path=str(OUT/'BiliFocus-v0.3.2-page-active.png'))
 cp.locator('#bilifocus-panel .clock-peek').hover()
 cp.screenshot(path=str(OUT/'BiliFocus-v0.3.2-page-hover.png'))
 cp.mouse.move(20,20)
 def directory_click():
  cp.get_by_role('button',name='换个学习视频',exact=True).click()
  assert cp.evaluate("window.__messages.at(-1).type")=='OPEN_LIBRARY'
 check('switch-video control opens only the read-only directory',directory_click)
 def external_stop_update():
  cp.evaluate("()=>{const s=structuredClone(window.__state);s.session=null;window.__setState(s)}")
  expect(cp.get_by_role('button',name='开始学习',exact=True)).to_be_visible()
  expect(cp.locator('.recommend-list')).to_be_visible()
  expect(cp.locator('#comment')).to_be_visible()
 check('external session end restores UI and one-click entry',external_stop_update)
 def spa_nonvideo_hides():
  cp.evaluate("window.__testLocation.href='https://www.bilibili.com/'")
  expect(cp.locator('#bilifocus-panel')).to_have_count(0)
  cp.evaluate("window.__testLocation.href='https://www.bilibili.com/video/BV1xx411c7mD/'")
  expect(cp.get_by_role('button',name='开始学习',exact=True)).to_be_visible()
 check('SPA route changes remove and restore video-page entry',spa_nonvideo_hides)
 def responsive():
  small=load('options.html',390,850)
  assert small.evaluate("document.documentElement.scrollWidth <= window.innerWidth")==True
 check('settings fit a narrow window without horizontal overflow',responsive)

 def failed_gate():
  gp=load('gate.html')
  expect(gp.locator('#retry')).to_be_visible()
  expect(gp.locator('#notice')).to_contain_text('模拟接口失败')
  assert gp.evaluate("window.__navigated||null") is None
 check('gate displays a retry on API failure and does not navigate to video',failed_gate)
 check('no uncaught browser JavaScript errors',lambda: (_ for _ in ()).throw(AssertionError(errors)) if errors else None)
 browser.close()
(OUT/'ui-results.json').write_text(json.dumps(RESULTS,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'tests':len(RESULTS),'passed':sum(r['passed'] for r in RESULTS)},indent=2))
if not all(r['passed'] for r in RESULTS):raise SystemExit(1)
