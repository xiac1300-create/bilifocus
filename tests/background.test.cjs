const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const dir=require('node:path').join(__dirname,'..')+'/';
function env(){
 const store={},rules=[],alarms={},events={},updates=[];
 const chrome={
  storage:{onChanged:{addListener:fn=>events.storage=fn},local:{setAccessLevel:async()=>{},get:async key=>({[key]:store[key]}),set:async data=>Object.assign(store,structuredClone(data))}},
  declarativeNetRequest:{getDynamicRules:async()=>structuredClone(rules),updateDynamicRules:async cfg=>{rules.splice(0,rules.length,...structuredClone(cfg.addRules));}},
  alarms:{clear:async name=>delete alarms[name],create:async(name,value)=>alarms[name]=value,onAlarm:{addListener:fn=>events.alarm=fn}},
  action:{setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{}},
  tabs:{sendMessage:async()=>{},query:async()=>[{id:1,url:'https://www.bilibili.com/'},{id:2,url:'https://www.bilibili.com/video/BV1xx411c7mD/'}],update:async(id,data)=>updates.push({id,...data})},
  runtime:{id:'test',getURL:path=>'chrome-extension://test/'+path,openOptionsPage:async()=>{},onMessage:{addListener:fn=>events.message=fn},onInstalled:{addListener:fn=>events.installed=fn},onStartup:{addListener:fn=>events.startup=fn}}
 };
 const context=vm.createContext({chrome,console,URL,Date,setTimeout,clearTimeout});
 context.importScripts=name=>vm.runInContext(fs.readFileSync(dir+name,'utf8'),context);
 vm.runInContext(fs.readFileSync(dir+'background.js','utf8'),context);
 const send=(msg,sender={id:'test',url:'chrome-extension://test/options.html'})=>new Promise(resolve=>events.message(msg,sender,resolve));
 return {store,rules,alarms,updates,events,send};
}
const settings={videos:[{bvid:'BV1xx411c7mD',title:'Course'}],duration:45,hideComments:true};
test('saves a list without installing restrictions',async()=>{
 const e=env();const out=await e.send({type:'SAVE',settings});assert.equal(out.ok,true);assert.equal(e.rules.length,0);assert.equal(out.state.settings.videos.length,1);
});
test('starts, installs redirect plus allow rules, and redirects an existing unrelated tab',async()=>{
 const e=env();const out=await e.send({type:'START',settings});assert.equal(out.ok,true);assert.equal(e.rules.length,3);assert.equal(e.updates.length,1);assert.equal(e.updates[0].id,1);assert.ok(e.alarms['bilifocus-end']);
});
test('does not start an empty list',async()=>{
 const e=env();const out=await e.send({type:'START',settings:{...settings,videos:[]}});assert.equal(out.ok,false);assert.equal(e.rules.length,0);
});
test('active lists are locked',async()=>{
 const e=env();await e.send({type:'START',settings});assert.equal((await e.send({type:'SAVE',settings})).ok,false);assert.equal((await e.send({type:'ADD_VIDEO',url:'https://www.bilibili.com/video/BV1ab411c7mD/'})).ok,false);
});
test('settings stop needs no typing and removes all rules',async()=>{
 const e=env();await e.send({type:'START',settings});
 assert.equal((await e.send({type:'STOP'})).ok,true);assert.equal(e.rules.length,0);assert.equal(e.store.bilifocus_v1.session,null);
});
test('GET_STATE clears an expired session and durable rules',async()=>{
 const e=env();await e.send({type:'START',settings});e.store.bilifocus_v1.session.endsAt=Date.now()-1;
 const out=await e.send({type:'GET_STATE'});assert.equal(out.state.session,null);assert.equal(e.rules.length,0);
});
test('rejects settings calls from web pages/content scripts',async()=>{
 const e=env();const out=await e.send({type:'START',settings},{id:'test',url:'https://www.bilibili.com/'});assert.equal(out.ok,false);
});
test('adds an active tab video and rejects wrong hosts',async()=>{
 const e=env();assert.equal((await e.send({type:'ADD_VIDEO',url:'https://www.bilibili.com/video/BV1xx411c7mD/',title:'Course'})).ok,true);
 assert.equal((await e.send({type:'ADD_VIDEO',url:'https://bad.test/'})).ok,false);assert.equal(e.store.bilifocus_v1.settings.videos.length,1);
});
test('concurrent additions serialize without losing a video',async()=>{
 const e=env();await Promise.all(['BV1xx411c7mD','BV1ab411c7mD'].map(id=>e.send({type:'ADD_VIDEO',url:'https://www.bilibili.com/video/'+id+'/'})));
 assert.equal(e.store.bilifocus_v1.settings.videos.length,2);
});
