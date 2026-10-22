"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const {serializeStudentActivity,recordStudentApiError}=require("../src/lib/studentActivity");
test("admin activity exposes student prompt and provider diagnostics without session credentials",()=>{
 const row=serializeStudentActivity({id:"student",data:()=>({classCode:"CLASS1",studentName:"Noam",seatNumber:2,lessonKey:"free-lab",promptSteps:{prompt:"a robot"},lastGeneratedPrompt:"robot picture",lastApiError:{provider:"openai",httpStatus:429,requestId:"req-1",response:{error:{message:"Quota exceeded"}}},lastApiErrorSteps:{prompt:"failed idea"},lastApiErrorAt:{toMillis:()=>123},secret:"never"})});
 assert.equal(row.promptSteps.prompt,"a robot");
 assert.equal(row.lastApiError.httpStatus,429);
 assert.equal(row.lastApiError.requestId,"req-1");
 assert.equal(row.lastApiErrorSteps.prompt,"failed idea");
 assert.equal(row.lastApiErrorAtMs,123);
 assert.equal(row.secret,undefined);
 assert.equal(row.sessionId,undefined);
});
test("recording a provider failure saves the exact failed prompt and diagnostic metadata",async()=>{
 let saved;
 await recordStudentApiError({set:async(data,options)=>{saved=data;assert.deepEqual(options.mergeFields,["lastApiError","lastApiErrorSteps","lastApiErrorAt","lastSeenAt"]);}},Object.assign(new Error("Quota exceeded"),{httpStatus:429,requestId:"req-1",apiResponse:{error:{message:"Quota exceeded",code:"rate_limit"}}}),{provider:"openai",stage:"image-generation",model:"image-model"},{prompt:"a fox"},123);
 assert.equal(saved.lastApiError.httpStatus,429);
 assert.equal(saved.lastApiError.code,"rate_limit");
 assert.equal(saved.lastApiError.stage,"image-generation");
 assert.equal(saved.lastApiErrorSteps.prompt,"a fox");
 assert.equal(saved.lastApiErrorAt,123);
});
test("older students without diagnostics or prompts serialize safely",()=>{
 const row=serializeStudentActivity({id:"old",data:()=>({studentName:"Old"})});
 assert.deepEqual(row.promptSteps,{});
 assert.equal(row.lastApiError,null);
 assert.equal(row.lastApiErrorAtMs,null);
});const {DocumentReference, Query, Timestamp}=require("@google-cloud/firestore");
process.env.GCLOUD_PROJECT="demo-student-activity";
const functions=require("../src/index");
test("class activity rejects unauthenticated access before reading student data",async(t)=>{
 t.mock.method(Query.prototype,"get",()=>assert.fail("Unauthenticated data read"));
 await assert.rejects(functions.adminGetClassActivity.run({data:{classCode:"CLASS1"}}),{code:"permission-denied"});
});
test("class activity is class-scoped, bounded, and strips private session IDs",async(t)=>{
 t.mock.method(DocumentReference.prototype,"get",async function(){
  if(this.path==="adminSessions/test-admin")return{exists:true,data:()=>({expiresAt:Timestamp.fromMillis(Date.now()+60000)})};
  assert.equal(this.path,"classAccessCodes/CLASS1");
  return{exists:true,data:()=>({})};
 });
 t.mock.method(DocumentReference.prototype,"set",async()=>{});
 const originalWhere=Query.prototype.where;
 t.mock.method(Query.prototype,"where",function(field,op,value){
  assert.equal(field,"classCode");assert.equal(op,"==");assert.equal(value,"CLASS1");
  return originalWhere.call(this,field,op,value);
 });
 t.mock.method(Query.prototype,"get",async()=>({docs:Array.from({length:101},(_,i)=>({id:"private-"+i,data:()=>({studentName:"Student",promptSteps:{prompt:"fox"}})}))}));
 const result=await functions.adminGetClassActivity.run({data:{sessionToken:"test-admin",classCode:"CLASS1"}});
 assert.equal(result.items.length,100);assert.equal(result.hasMore,true);
 assert.equal(result.items[0].promptSteps.prompt,"fox");
 assert.equal(result.items[0].sessionId,undefined);
});
