const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('js/prompt-lab.js','utf8');
function func(name){const start=source.indexOf('function '+name+'(');let i=source.indexOf(') {',start)+2,depth=1,j=i+1;while(depth&&j<source.length){if(source[j]==='{')depth++;if(source[j]==='}')depth--;j++;}return source.slice(start,j);}
function storage(lesson,items){const ctx={window:{localStorage:{getItem:k=>items[k]??null}},PAGE_LESSON_KEY:lesson};vm.createContext(ctx);vm.runInContext(func('readStorage'),ctx);return key=>ctx.readStorage(key);}
test('matching legacy draft remains readable on its lesson page',()=>{const read=storage('free-lab',{'funlab-prompt-lab-draft':JSON.stringify({lessonKey:'free-lab',freePrompt:'dragon'})});assert.equal(read('funlab-prompt-lab-draft:free-lab').freePrompt,'dragon');});
test('another lesson legacy draft never enters this page',()=>{const read=storage('image-lab',{'funlab-prompt-lab-draft':JSON.stringify({lessonKey:'free-lab',freePrompt:'dragon'})});assert.equal(read('funlab-prompt-lab-draft:image-lab'),null);});
test('scoped saved draft wins over legacy draft',()=>{const read=storage('free-lab',{'funlab-prompt-lab-draft:free-lab':JSON.stringify({freePrompt:'new'}),'funlab-prompt-lab-draft':JSON.stringify({lessonKey:'free-lab',freePrompt:'old'})});assert.equal(read('funlab-prompt-lab-draft:free-lab').freePrompt,'new');});
test('damaged local storage does not crash lesson startup',()=>{assert.equal(storage('image-lab',{'x':'broken'})('x'),null);});
test('fixed routes reject silent switching to another lesson',()=>{const ctx={PAGE_LESSON_KEY:'free-lab',normalizeLessonKey:x=>x};vm.createContext(ctx);assert.throws(()=>vm.runInContext(func('setLessonKey')+";setLessonKey('comic-lab');",ctx),/LESSON_ROUTE_MISMATCH/);});test('leaving a migrated lesson does not resurrect the old legacy session',()=>{
 const items={'funlab-prompt-lab-session':JSON.stringify({lessonKey:'image-lab',sessionId:'old-session'})};
 const ctx={PAGE_LESSON_KEY:'image-lab',window:{localStorage:{getItem:k=>items[k]??null,setItem:(k,v)=>items[k]=v,removeItem:k=>delete items[k]}}};
 vm.createContext(ctx);vm.runInContext(func('readStorage')+';'+func('removeStorage'),ctx);
 assert.equal(ctx.readStorage('funlab-prompt-lab-session:image-lab').sessionId,'old-session');
 ctx.removeStorage('funlab-prompt-lab-session:image-lab');
 assert.equal(ctx.readStorage('funlab-prompt-lab-session:image-lab'),null);
 assert.ok(items['funlab-prompt-lab-session'],'legacy data preserved for other pages');
});