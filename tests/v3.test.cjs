const test = require('node:test'), assert = require('node:assert/strict');
const vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
const B = require('../logic.js'), R = require('../records.js');
const V1='BV1xx411c7mD',V2='BV1ab411c7mD',V3='BV1cd411c7mD',UID='417302260';
const url = (id=V1,p=1)=>`https://www.bilibili.com/video/${id}/?p=${p}`;
const opts={id:'test',url:'chrome-extension://test/options.html'};
const base={videos:[{bvid:V1,title:'One'},{bvid:V2,title:'Two'}],uploaders:[{uid:UID,name:'School'}],duration:45,mode:'countup'};
function env(initial={},time=new Date(2026,9,12,10).getTime()) {
  let now=time, failWrite=false;
  class Clock extends Date { constructor(...args){super(...(args.length ? args : [now]));} static now(){return now;} }
  const store=initial,rules=[],alarms={},events={},writes=[];
  const tabs=[{id:2,url:url(),title:'Video One',active:true},{id:3,url:url(V2),active:true}];
  const chrome={
    storage:{onChanged:{addListener:fn=>events.storage=fn},local:{setAccessLevel:async()=>{},get:async k=>({[k]:structuredClone(store[k])}),set:async data=>{if(failWrite)throw Error('quota');writes.push(Object.keys(data));Object.assign(store,structuredClone(data));}}},
    declarativeNetRequest:{getDynamicRules:async()=>structuredClone(rules),updateDynamicRules:async cfg=>rules.splice(0,rules.length,...structuredClone(cfg.addRules))},
    alarms:{clear:async name=>delete alarms[name],create:async(n,v)=>alarms[n]=v,onAlarm:{addListener:f=>events.alarm=f}},
    action:{setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{}},
    tabs:{sendMessage:async()=>{},query:async()=>structuredClone(tabs),get:async id=>structuredClone(tabs.find(t=>t.id===id)),update:async()=>{},create:async()=>{}},
    runtime:{id:'test',getURL:p=>'chrome-extension://test/'+p,openOptionsPage:async()=>{},onMessage:{addListener:f=>events.message=f},onInstalled:{addListener:f=>events.installed=f},onStartup:{addListener:f=>events.startup=f}}
  };
  const ctx=vm.createContext({chrome,console,URL,Date:Clock,Intl,setTimeout,clearTimeout,AbortController,
    fetch:async address=>({ok:true,json:async()=>({code:0,data:{bvid:new URL(address).searchParams.get('bvid'),owner:{mid:UID,name:'School'},title:'Title'}})})});
  ctx.importScripts=name=>vm.runInContext(fs.readFileSync(path.join(__dirname,'..',name),'utf8'),ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'..','background.js'),'utf8'),ctx);
  const send=(message,sender=opts)=>new Promise(resolve=>events.message(message,sender,resolve));
  const start=async(settings=base)=>send({type:'START',settings});
  const stop=async()=>send({type:'STOP',sessionId:store[B.KEY]?.session?.id});
  const sample=async(seq,mediaTime,extra={},tabId=2)=>{
    const tab=tabs.find(t=>t.id===tabId);
    return send({type:'TRACK_PLAYBACK',sessionId:store[B.KEY]?.session?.id,documentToken:'doc-'+tabId,seq,
      url:tab.url,playing:true,eligible:true,mediaTime,rate:1,title:tab.title,uid:UID,name:'School',...extra},
      {id:'test',url:tab.url,frameId:0,tab:{id:tabId}});
  };
  return {store,rules,alarms,events,tabs,writes,send,start,stop,sample,
    now:()=>now,advance:ms=>now+=ms,fail:()=>failWrite=true};
}
const cur=e=>e.store[R.CURRENT_KEY];
const closeTo=(a,b)=>assert.ok(Math.abs(a-b)<.1,`${a} != ${b}`);
test('mode defaults to countdown and legacy countdown migrates',()=>{
 const s=B.normalizeState({settings:{duration:25},session:{startedAt:10,endsAt:100}});
 assert.equal(s.settings.mode,'countdown');assert.equal(s.session.mode,'countdown');assert.equal(s.session.id,'legacy-10');
});
test('countup is active without a deadline; malformed countup still rejects missing start',()=>{
 const s=B.normalizeState({session:{startedAt:10,mode:'countup',endsAt:null}});
 assert.equal(s.session.endsAt,null);assert.equal(B.active(s,999999999),true);assert.equal(B.normalizeState({session:{mode:'countup'}}).session,null);
});
test('clock supports hours and never displays NaN',()=>{
 assert.equal(B.clock(3661000),'01:01:01');assert.equal(B.clock(NaN),'00:00');assert.equal(B.sessionClock({mode:'countup',startedAt:1000},62000),'01:01');
});
test('countup starts and creates a periodic reconciliation alarm',async()=>{
 const e=env();const r=await e.start();assert.equal(r.ok,true);assert.equal(r.state.session.endsAt,null);assert.equal(e.alarms['bilifocus-end'].periodInMinutes,1);assert.equal(cur(e).id,r.state.session.id);
});
test('one-click countup end archives the exact wall interval',async()=>{
 const e=env();await e.start();const start=e.now();e.advance(73500);
 await e.stop();const rec=e.store[R.HISTORY_KEY].sessions[0];assert.equal(rec.startedAt,start);assert.equal(rec.endedAt,start+73500);assert.equal(rec.reason,'manual');assert.equal(e.rules.length,0);assert.equal(cur(e),null);
});
test('late countdown reconciliation ends at deadline, not wake time',async()=>{
 const e=env();const r=await e.start({...base,mode:'countdown',duration:1});e.advance(240000);
 await e.send({type:'GET_STATE'});const rec=e.store[R.HISTORY_KEY].sessions[0];assert.equal(rec.endedAt,r.state.session.endsAt);assert.equal(rec.reason,'completed');assert.equal(e.store[B.KEY].session,null);
});
test('repeated stop and reads never duplicate archives',async()=>{
 const e=env();await e.start();e.advance(500);await e.stop();await e.stop();await e.send({type:'GET_STATE'});assert.equal(e.store[R.HISTORY_KEY].sessions.length,1);
});
test('worker reload keeps the same running session and previous playback data',async()=>{
 const e=env();await e.start();await e.sample(1,0);e.advance(5000);await e.sample(2,5);
 const f=env(structuredClone(e.store),e.now()+2000);const r=await f.send({type:'GET_RECORDS'});
 assert.equal(r.current.id,cur(e).id);closeTo(r.current.playedMs,5000);assert.equal(r.state.session.mode,'countup');
});
test('opening a page and its first sample are not counted as a viewed video',async()=>{
 const e=env();await e.start();await e.sample(1,0);assert.equal(cur(e).videos.length,0);assert.equal(cur(e).playedMs,0);
});
test('actual progress credits wall playback and metadata, once',async()=>{
 const e=env();await e.start();await e.sample(1,0);e.advance(5000);const r=await e.sample(2,5);
 assert.equal(r.recorded,true);closeTo(cur(e).playedMs,5000);assert.equal(cur(e).videos[0].uid,UID);assert.equal(cur(e).videos[0].part,1);
 await e.sample(2,5);closeTo(cur(e).playedMs,5000);
});
test('paused samples do not accrue future playback',async()=>{
 const e=env();await e.start();await e.sample(1,0,{playing:false});e.advance(5000);await e.sample(2,0,{playing:false});assert.equal(cur(e).playedMs,0);
});
test('background/ineligible player and inactive tab do not accrue',async()=>{
 const e=env();await e.start();await e.sample(1,0,{eligible:false});e.advance(5000);await e.sample(2,5,{eligible:false});assert.equal(cur(e).playedMs,0);
 e.tabs[0].active=false;await e.sample(3,5);e.advance(5000);await e.sample(4,10);assert.equal(cur(e).playedMs,0);
});
test('picture in picture can count an inactive tab',async()=>{
 const e=env();await e.start();e.tabs[0].active=false;await e.sample(1,0,{pip:true});e.advance(5000);await e.sample(2,5,{pip:true});closeTo(cur(e).playedMs,5000);
});
test('stalled media contributes zero',async()=>{
 const e=env();await e.start();await e.sample(1,7);e.advance(5000);await e.sample(2,7);assert.equal(cur(e).playedMs,0);
});
test('partial buffering credits only observed progress, conservatively',async()=>{
 const e=env();await e.start();await e.sample(1,0);e.advance(5000);await e.sample(2,2);closeTo(cur(e).playedMs,2000);
});
test('2x speed credits real time, not video content duration',async()=>{
 const e=env();await e.start();await e.sample(1,0,{rate:2});e.advance(5000);await e.sample(2,10,{rate:2});closeTo(cur(e).playedMs,5000);
});
test('seek/discontinuity does not inflate playback totals',async()=>{
 const e=env();await e.start();await e.sample(1,0);e.advance(5000);await e.sample(2,600,{seeking:true});assert.equal(cur(e).playedMs,0);
 e.advance(5000);await e.sample(3,605);closeTo(cur(e).playedMs,5000);
});
test('long heartbeat gaps/sleep are not backfilled',async()=>{
 const e=env();await e.start();await e.sample(1,0);e.advance(60000);await e.sample(2,60);assert.equal(cur(e).playedMs,0);
});
test('two visible tabs cannot double count overlapping playback',async()=>{
 const e=env();await e.start();await e.sample(1,0);await e.sample(1,0,{},3);
 e.advance(5000);await e.sample(2,5);await e.sample(2,5,{},3);closeTo(cur(e).playedMs,5000);
 e.advance(5000);await e.sample(3,10,{},3);await e.sample(3,10);closeTo(cur(e).playedMs,10000);assert.equal(cur(e).videos.length,2);
});
test('different parts and different uploaders are separate video entries',async()=>{
 const e=env();await e.start();await e.sample(1,0);e.advance(5000);await e.sample(2,5);
 e.tabs[0].url=url(V1,2);await e.sample(3,0);e.advance(5000);await e.sample(4,5);
 assert.deepEqual(cur(e).videos.map(v=>v.part),[1,2]);closeTo(cur(e).playedMs,10000);
});
test('cross-midnight playback is split into the correct local days',async()=>{
 const t=new Date(2026,9,12,23,59,58).getTime(),e=env({},t);await e.start();await e.sample(1,0);e.advance(5000);await e.sample(2,5);
 closeTo(cur(e).days['2026-10-12'],2000);closeTo(cur(e).days['2026-10-13'],3000);
});
test('daily session durations split at midnight while retaining one session',()=>{
 const start=new Date(2026,9,12,23,30).getTime(),end=new Date(2026,9,13,0,30).getTime();
 const rec=R.finish(R.fresh({id:'s',mode:'countup',startedAt:start}),end,'manual');
 closeTo(R.daily([rec],'2026-10-12').modeMs,1800000);closeTo(R.daily([rec],'2026-10-13').modeMs,1800000);
});
test('records are available only from the options page',async()=>{
 const e=env();await e.start();
 for(const file of ['popup.html','library.html','blocked.html','gate.html']) assert.equal((await e.send({type:'GET_RECORDS'},{id:'test',url:'chrome-extension://test/'+file})).ok,false);
 assert.equal((await e.send({type:'GET_RECORDS'})).ok,true);
});
test('history cannot be cleared while studying or without confirmation',async()=>{
 const e=env();await e.start();const m={type:'CLEAR_RECORDS',confirmation:'\u6e05\u7a7a\u5b66\u4e60\u8bb0\u5f55'};
 assert.equal((await e.send(m)).ok,false);await e.stop();assert.equal((await e.send({...m,confirmation:'bad'})).ok,false);
 assert.equal((await e.send(m)).ok,true);assert.equal(e.store[R.HISTORY_KEY].sessions.length,0);assert.equal(e.store[B.KEY].settings.videos.length,2);
});
test('stale session samples cannot resurrect stopped records',async()=>{
 const e=env();await e.start();const id=cur(e).id;await e.stop();const r=await e.sample(1,0,{sessionId:id});assert.equal(r.recorded,false);assert.equal(cur(e),null);
});
test('sample cannot target a different BV or part from the actual tab',async()=>{
 const e=env();await e.start();assert.equal((await e.sample(1,0,{url:url(V2)})).ok,false);
 const r=await e.sample(1,0,{url:url(V1,3)});assert.equal(r.recorded,false);
});
test('record metadata never authorizes a non-whitelisted video',async()=>{
 const e=env();await e.start();e.tabs[0].url=url(V3);const r=await e.sample(1,0,{uid:UID});assert.equal(r.recorded,false);assert.equal(cur(e).videos.length,0);
});
test('public records and archive omit internal stream markers',async()=>{
 const e=env();await e.start();await e.sample(1,0);const out=await e.send({type:'GET_RECORDS'});assert.equal(out.current.markers,undefined);
 e.advance(5000);await e.stop();assert.equal(e.store[R.HISTORY_KEY].sessions[0].markers,undefined);
});
test('playback persistence does not rewrite the entire archive every heartbeat',async()=>{
 const e=env();await e.start();e.writes.length=0;await e.sample(1,0);e.advance(5000);await e.sample(2,5);
 assert.ok(e.writes.every(keys=>keys.length===1&&keys[0]===R.CURRENT_KEY));
});
test('failed stop persistence restores restrictions and preserves running record',async()=>{
 const e=env();await e.start();const id=cur(e).id;const n=e.rules.length;e.advance(5000);e.fail();
 assert.equal((await e.stop()).ok,false);assert.equal(cur(e).id,id);assert.equal(e.rules.length,n);assert.equal(e.store[R.HISTORY_KEY],undefined);
});
test('retention trims oldest archived sessions and tracks pruning',()=>{
 let h=R.emptyHistory();for(let i=0;i<305;i++)h=R.archive(h,{id:'s'+i,startedAt:1000+i,endedAt:2000+i,videos:[]});
 assert.equal(h.sessions.length,300);assert.equal(h.pruned,5);assert.equal(h.sessions[0].id,'s5');
});
test('saving or adding whitelist entries preserves history',async()=>{
 const e=env();await e.start();e.advance(5000);await e.stop();const rec=structuredClone(e.store[R.HISTORY_KEY]);
 await e.send({type:'SAVE',settings:{...base,mode:'countdown'}});assert.deepEqual(e.store[R.HISTORY_KEY],rec);
});
test('early manual countdown end does not claim planned duration',async()=>{
 const e=env();await e.start({...base,mode:'countdown'});const start=e.now();e.advance(10000);await e.stop();const r=e.store[R.HISTORY_KEY].sessions[0];assert.equal(r.endedAt-start,10000);assert.equal(r.reason,'manual');
});
test('video count is deduplicated across sessions on the same day',()=>{
 const start=new Date(2026,9,12,10).getTime();const one=R.fresh({id:'a',startedAt:start,mode:'countup'});
 one.days={'2026-10-12':1000};one.videos=[{key:V1+':p1',days:{'2026-10-12':1000}}];
 const two={...R.finish(one,start+5000,'manual'),id:'b',startedAt:start+10000,endedAt:start+15000};
 const day=R.daily([R.finish(one,start+5000,'manual'),two],'2026-10-12');assert.equal(day.sessionCount,2);assert.equal(day.videoCount,1);assert.equal(day.playedMs,2000);
});

// v0.3.1 one-click page termination regressions.
const pageSender = (e,tabId=2) => ({id:'test',url:e.tabs.find(t=>t.id===tabId).url,frameId:0,tab:{id:tabId}});
const pageStop = (e,id=e.store[B.KEY]?.session?.id,tabId=2) => e.send({type:'PAGE_STOP',sessionId:id,url:e.tabs.find(t=>t.id===tabId).url},pageSender(e,tabId));
test('page countup stop needs no confirmation and archives wall time',async()=>{
 const e=env();await e.start();const start=e.now();e.advance(8300);
 const r=await pageStop(e);assert.equal(r.ok,true);assert.equal(r.state.session,null);
 const rec=e.store[R.HISTORY_KEY].sessions[0];assert.equal(rec.endedAt-start,8300);assert.equal(rec.reason,'manual');assert.equal(e.rules.length,0);
});
test('page countdown stop archives actual interval, not the whole planned duration',async()=>{
 const e=env();await e.start({...base,mode:'countdown'});const start=e.now();e.advance(1200);assert.equal((await pageStop(e)).ok,true);
 const rec=e.store[R.HISTORY_KEY].sessions[0];assert.equal(rec.endedAt-start,1200);assert.equal(rec.mode,'countdown');assert.equal(rec.reason,'manual');
});
test('page end just after countdown expiry records completed once at the deadline',async()=>{
 const e=env();await e.start({...base,mode:'countdown',duration:1});const id=cur(e).id,end=e.store[B.KEY].session.endsAt;
 e.advance(62000);assert.equal((await pageStop(e,id)).ok,true);assert.equal(e.store[R.HISTORY_KEY].sessions.length,1);assert.equal(e.store[R.HISTORY_KEY].sessions[0].endedAt,end);assert.equal(e.store[R.HISTORY_KEY].sessions[0].reason,'completed');
});
test('simultaneous page end from two video tabs creates only one archive',async()=>{
 const e=env();await e.start();const id=cur(e).id;e.advance(5000);
 const replies=await Promise.all([pageStop(e,id,2),pageStop(e,id,3)]);
 assert.ok(replies.every(r=>r.ok));assert.equal(e.store[R.HISTORY_KEY].sessions.length,1);assert.equal(e.rules.length,0);
});
test('a delayed page end cannot terminate a subsequently started session',async()=>{
 const e=env();await e.start();const old=cur(e).id;await pageStop(e);e.advance(1);await e.start();const next=cur(e).id;
 assert.equal((await pageStop(e,old)).ok,false);assert.equal(cur(e).id,next);assert.ok(e.rules.length>0);assert.equal(e.store[R.HISTORY_KEY].sessions.length,1);
});
test('page end rejects a missing session ID',async()=>{
 const e=env();await e.start();assert.equal((await pageStop(e,'')).ok,false);assert.ok(cur(e));
});
test('page end rejects a stale video target',async()=>{
 const e=env();await e.start();const r=await e.send({type:'PAGE_STOP',sessionId:cur(e).id,url:url(V2)},pageSender(e));assert.equal(r.ok,false);assert.ok(cur(e));
});
test('page end rejects subframes and another extension identity',async()=>{
 const e=env();await e.start();const m={type:'PAGE_STOP',sessionId:cur(e).id,url:url()};
 for(const patch of [{frameId:1},{id:'other'},{url:'https://example.test/video/'+V1}])assert.equal((await e.send(m,{...pageSender(e),...patch})).ok,false);
 assert.ok(cur(e));
});
test('extension directory and gate cannot impersonate page end',async()=>{
 const e=env();await e.start();for(const f of ['options.html','popup.html','library.html','gate.html','blocked.html']){
 assert.equal((await e.send({type:'PAGE_STOP',sessionId:cur(e).id,url:url()},{id:'test',url:'chrome-extension://test/'+f})).ok,false);}
 assert.ok(cur(e));
});
test('page end is available on a whitelisted uploader video listing',async()=>{
 const e=env();await e.start();e.tabs[0].url=`https://space.bilibili.com/${UID}/video`;
 assert.equal((await pageStop(e)).ok,true);assert.equal(e.store[R.HISTORY_KEY].sessions.length,1);
});
test('an unlisted uploader page cannot use page end',async()=>{
 const e=env();await e.start();e.tabs[0].url='https://space.bilibili.com/123/video';assert.equal((await pageStop(e)).ok,false);assert.ok(cur(e));
});
test('a Bilibili homepage cannot use page end',async()=>{
 const e=env();await e.start();e.tabs[0].url='https://www.bilibili.com/';assert.equal((await pageStop(e)).ok,false);assert.ok(cur(e));
});
test('a video awaiting uploader verification cannot call page end',async()=>{
 const e=env();await e.start();e.tabs[0].url=url(V3);assert.equal((await pageStop(e)).ok,false);assert.ok(cur(e));
});
test('page end persistence failure restores restrictions and does not claim success',async()=>{
 const e=env();await e.start();const id=cur(e).id,ruleCount=e.rules.length;e.fail();
 const r=await pageStop(e);assert.equal(r.ok,false);assert.equal(cur(e).id,id);assert.equal(e.rules.length,ruleCount);assert.equal(e.store[R.HISTORY_KEY],undefined);
});
test('final playback sample queued before page end is included in archive',async()=>{
 const e=env();await e.start();const id=cur(e).id;await e.sample(1,0);e.advance(4000);
 const [sample,stop]=await Promise.all([e.sample(2,4),pageStop(e,id)]);assert.equal(sample.recorded,true);assert.equal(stop.ok,true);
 const rec=e.store[R.HISTORY_KEY].sessions[0];assert.equal(rec.playedMs,4000);assert.equal(rec.videos.length,1);
});
test('playback arriving after page end cannot mutate the archived record',async()=>{
 const e=env();await e.start();const id=cur(e).id;await e.sample(1,0);e.advance(4000);await e.sample(2,4);await pageStop(e,id);const before=JSON.stringify(e.store[R.HISTORY_KEY]);
 e.advance(1000);assert.equal((await e.sample(3,5,{sessionId:id})).recorded,false);assert.equal(JSON.stringify(e.store[R.HISTORY_KEY]),before);
});
test('page end preserves both lists and existing daily history',async()=>{
 const e=env();await e.start();await pageStop(e);const settings=JSON.stringify(e.store[B.KEY].settings),old=JSON.stringify(e.store[R.HISTORY_KEY].sessions[0]);
 e.advance(1000);await e.start();await pageStop(e);assert.equal(e.store[R.HISTORY_KEY].sessions.length,2);assert.equal(JSON.stringify(e.store[R.HISTORY_KEY].sessions[0]),old);assert.equal(JSON.stringify(e.store[B.KEY].settings),settings);
});
test('new settings UI session token rejects stale end without requiring typed text',async()=>{
 const e=env();await e.start();const id=cur(e).id;assert.equal((await e.send({type:'STOP',sessionId:'old'})).ok,false);assert.equal(cur(e).id,id);assert.equal((await e.send({type:'STOP',sessionId:id})).ok,true);
});
