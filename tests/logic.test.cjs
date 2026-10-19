const test = require('node:test');
const assert = require('node:assert/strict');
const BF = require('../logic.js');
const id = 'BV1xx411c7mD';
const second = 'BV1ab411c7mD';
const settings = { videos: [{ bvid: id, title: 'Lesson A' }], duration: 45, hideComments: true };
test('parses a BV and removes duplicates', () => {
  assert.equal(BF.parseList(`${id}\nhttps://www.bilibili.com/video/${id}/?p=2`).length, 1);
});
test('parses labels and multiple links', () => {
  const entries=BF.parseList(`Course | https://www.bilibili.com/video/${id}/\n${second}`);
  assert.equal(entries.length,2);assert.equal(entries[0].title,'Course');
});
test('rejects a short link and malformed line', () => {
  assert.throws(()=>BF.parseList('https://b23.tv/test'));
  assert.throws(()=>BF.parseList(id+'1'));
});
test('does not conflate case-sensitive BV identifiers',()=>{
  assert.equal(BF.parseList(`${id}\nBV1xx411c7md`).length,2);
});
test('video identity requires exact host, scheme and path', () => {
  assert.equal(BF.videoId(`https://www.bilibili.com/video/${id}/?p=2`),id);
  for(const u of [`https://evil.test/video/${id}/`,`https://www.bilibili.com.evil.test/video/${id}/`,`https://www.bilibili.com/video/${id}X`,`javascript:${id}`,`https://www.bilibili.com/read/${id}`]) assert.equal(BF.videoId(u),null);
});
test('only whitelisted videos and passport are allowed',()=>{
  assert.equal(BF.allowedUrl(`https://www.bilibili.com/video/${id}/?p=3`,settings),true);
  assert.equal(BF.allowedUrl(`https://www.bilibili.com/video/${second}/`,settings),false);
  assert.equal(BF.allowedUrl('https://www.bilibili.com/',settings),false);
  assert.equal(BF.allowedUrl('https://search.bilibili.com/all',settings),false);
  assert.equal(BF.allowedUrl('https://passport.bilibili.com/login',settings),true);
});
test('session deadline is absolute',()=>{
 const s={session:{startedAt:10,endsAt:100}};
 assert.equal(BF.active(s,99),true);assert.equal(BF.active(s,100),false);
 assert.equal(BF.active({session:null}),false);
});
test('settings normalize safely',()=>{
 const s=BF.normalizeSettings({videos:[{bvid:id},{bvid:id},null,{bvid:'bad'}],duration:-1,hideComments:false});
 assert.equal(s.videos.length,1);assert.equal(s.duration,45);assert.equal(s.hideComments,false);
});
test('round-trip list remains safe and identical',()=>{
 const entries=[{bvid:id,title:'Course'}];assert.deepEqual(BF.parseList(BF.serializeList(entries)),entries);
});
test('DNR rules distinguish videos and leave unrelated domains alone',()=>{
 const rules=BF.buildRules(settings.videos);
 const action=u=>rules.filter(r=>new RegExp(r.condition.regexFilter).test(u)).sort((a,b)=>b.priority-a.priority)[0]?.action.type;
 assert.equal(action(`https://www.bilibili.com/video/${id}/`),'allow');
 assert.equal(action(`https://www.bilibili.com/video/${second}/`),'redirect');
 assert.equal(action(`https://www.bilibili.com/video/${id}BAD/`),'redirect');
 assert.equal(action('https://live.bilibili.com/1'),'redirect');
 assert.equal(action('https://www.example.com/'),undefined);
 assert.equal(action('https://www.bilibili.com.evil.test/'),undefined);
 assert.equal(action('https://passport.bilibili.com/'),'allow');
});
test('countdown does not go negative',()=>{
 assert.equal(BF.clock(45000),'00:45');assert.equal(BF.clock(-50),'00:00');
 assert.equal(BF.clock(60001),'01:01');
});
