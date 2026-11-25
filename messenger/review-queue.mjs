// NorthLight Messenger M5: single-item review and atomic adapter contract.
// Test adapter is intentionally in-memory. No messaging or production credentials.
function eligible(row){
 return !!row&&typeof row.id==="string"&&row.id.length>0&&Number.isSafeInteger(row.revision)&&row.revision>=0&&row.state==="PENDING"&&row.historyCleared===true&&row.suppressed===false&&row.consentVerified===true&&row.consentChannel===row.channel&&["sms","imessage","email"].includes(row.channel)&&typeof row.recipient==="string"&&(row.channel==="email"?/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.recipient):/^\+642\d{7,8}$/.test(row.recipient))&&typeof row.draft==="string"&&row.draft.trim().length>0&&row.draft.length<=(row.channel==="email"?1200:row.channel==="sms"?320:500)&&typeof row.evidenceRef==="string"&&row.evidenceRef.trim().length>0&&typeof row.consentRef==="string"&&row.consentRef.trim().length>0&&row.draft.includes("NorthLight Studios")&&/reply STOP/i.test(row.draft)&&(row.channel==="email"?typeof row.subject==="string"&&row.subject.trim().length>0&&!/[\r\n]/.test(row.subject):row.subject==null);
}

function snapshot(row){
 return {id:row.id,revision:row.revision,name:row.name??"",channel:row.channel,recipient:row.recipient,subject:row.subject??null,draft:row.draft,evidenceRef:row.evidenceRef,consentRef:row.consentRef};
}

function sameSnapshot(a,b){
 return !!a&&!!b&&["id","revision","name","channel","recipient","subject","draft","evidenceRef","consentRef"].every(k=>a[k]===b[k]);
}

function createReviewQueue({store,authorize,now=()=>new Date().toISOString()}){
 if(!store||typeof store.list!=="function"||typeof store.commitDecision!=="function"||typeof authorize!=="function")throw new Error("Required trusted adapter and authorization");
 const result=(status,extra={})=>({status,sendAllowed:false,...extra});
 async function next(actor){
  if(!await authorize(actor))return result("UNAUTHORIZED");
  try{
   const rows=await store.list();
   if(!Array.isArray(rows))return result("STORE_UNAVAILABLE");
   const row=rows.find(eligible);
   return row?result("READY",{item:snapshot(row)}):result("EMPTY");
  }catch{return result("STORE_UNAVAILABLE")}
 }
 async function decide(actor,shown,decision,requestId){
  if(!await authorize(actor))return result("UNAUTHORIZED");
  if(!["APPROVE","DISAPPROVE"].includes(decision)||typeof requestId!=="string"||!requestId.trim()||!shown||typeof shown.id!=="string")return result("INVALID_REQUEST");
  try{
   // The production adapter must atomically recheck the current row and global suppression,
   // commit the exact snapshot and audit record, and deduplicate request IDs.
   const saved=await store.commitDecision({shown,decision,requestId,actor,at:now()});
   if(!saved||saved.status!=="SAVED")return result(saved?.status??"STORE_UNAVAILABLE");
   const following=await next(actor);
   return result("SAVED",{decision,record:saved.record,next:following});
  }catch{return result("STORE_UNAVAILABLE")}
 }
 return {next,decide};
}

function createMemoryStore(initialRows){
 // Synthetic test adapter only; no durable storage, authentication or external contact.
 const clone=x=>JSON.parse(JSON.stringify(x));
 const rows=clone(initialRows), audit=[], requests=new Map();
 return {
  async list(){return clone(rows)},
  async commitDecision({shown,decision,requestId,actor,at}){
   const key=JSON.stringify([actor,requestId]);
   if(requests.has(key)){
    const existing=requests.get(key);
    return existing.decision===decision&&sameSnapshot(existing.shown,shown)?{status:"SAVED",record:clone(existing.record)}:{status:"REQUEST_CONFLICT"};
   }
   const row=rows.find(x=>x.id===shown.id);
   if(!eligible(row)||!sameSnapshot(snapshot(row),shown))return {status:"STALE_OR_BLOCKED"};
   // Recheck known matching opt-outs in the same atomic operation.
   if(rows.some(x=>x.suppressed===true&&x.recipient===row.recipient))return {status:"STALE_OR_BLOCKED"};
   const record={id:row.id,decision,actor,at,requestId,approvedSnapshot:decision==="APPROVE"?clone(shown):null,sendAllowed:false};
   row.state=decision==="APPROVE"?"APPROVED":"DISAPPROVED";
   row.revision++;
   if(decision==="DISAPPROVE")row.excludeFromNewOutreach=true;
   audit.push(record);requests.set(key,{shown:clone(shown),decision,record});
   return {status:"SAVED",record:clone(record)};
  },
  async mutateForTest(id,patch){Object.assign(rows.find(x=>x.id===id),patch)},
  async auditForTest(){return clone(audit)}
 };
}

async function runQueueTests(){
 const fixture=(id,patch={})=>({id,revision:0,state:"PENDING",name:"Synthetic "+id,channel:"sms",recipient:"+64210000001",subject:null,draft:"Hi, we're NorthLight Studios. Reply STOP to opt out.",historyCleared:true,suppressed:false,consentVerified:true,consentChannel:"sms",evidenceRef:"synthetic-opportunity",consentRef:"synthetic-consent",...patch});
 const make=(rows)=>{const store=createMemoryStore(rows);return {store,q:createReviewQueue({store,authorize:actor=>actor==="reviewer",now:()=>"2026-11-26T00:00:00Z"})}};
 const tests=[];function t(name,value){tests.push({name,pass:value===true})}
 let {q,store}=make([fixture("a"),fixture("b",{recipient:"+64210000002"})]);
 let first=await q.next("reviewer");t("First eligible row shown",first.item?.id==="a");
 let r=await q.decide("reviewer",first.item,"APPROVE","req1");
 t("Approval saved and next returned",r.status==="SAVED"&&r.next.item?.id==="b");
 t("Approval binds exact recipient and message",r.record.approvedSnapshot.draft===first.item.draft&&r.record.approvedSnapshot.recipient===first.item.recipient);
 t("Approval never sends",r.sendAllowed===false&&r.record.sendAllowed===false);
 let repeat=await q.decide("reviewer",first.item,"APPROVE","req1");t("Retry is idempotent",repeat.status==="SAVED"&&(await store.auditForTest()).length===1);
 t("Request ID conflict blocked",(await q.decide("reviewer",first.item,"DISAPPROVE","req1")).status==="REQUEST_CONFLICT");
 let second=await q.decide("reviewer",r.next.item,"DISAPPROVE","req2");
 t("Disapproval advances to empty",second.status==="SAVED"&&second.next.status==="EMPTY");
 t("Disapproval excludes from new outreach",(await store.list())[1].excludeFromNewOutreach===true&&second.record.approvedSnapshot===null);
 t("Unauthorized actor cannot read",(await q.next("other")).status==="UNAUTHORIZED");
 t("Unauthorized actor cannot decide",(await q.decide("other",first.item,"APPROVE","req3")).status==="UNAUTHORIZED");
 ({q,store}=make([fixture("a")]));
 first=await q.next("reviewer");await store.mutateForTest("a",{draft:"Changed",revision:1});
 t("Changed draft cannot be approved",(await q.decide("reviewer",first.item,"APPROVE","req4")).status==="STALE_OR_BLOCKED");
 ({q,store}=make([fixture("a")]));
 first=await q.next("reviewer");await store.mutateForTest("a",{recipient:"+64210000009"});
 t("Changed recipient cannot be approved",(await q.decide("reviewer",first.item,"APPROVE","req5")).status==="STALE_OR_BLOCKED");
 ({q,store}=make([fixture("a")]));
 first=await q.next("reviewer");await store.mutateForTest("a",{suppressed:true});
 t("New opt-out blocks stale approval",(await q.decide("reviewer",first.item,"APPROVE","req6")).status==="STALE_OR_BLOCKED");
 ({q,store}=make([fixture("a"),fixture("blocked",{suppressed:true})]));
 first=await q.next("reviewer");t("Other matching opt-out blocks commit",(await q.decide("reviewer",first.item,"APPROVE","req7")).status==="STALE_OR_BLOCKED");
 ({q,store}=make([fixture("missing",{historyCleared:false}),fixture("consent",{consentVerified:false}),fixture("wrong",{consentChannel:"email"}),fixture("truncated",{recipient:"+642100…"}),fixture("no-stop",{draft:"NorthLight Studios"}),fixture("valid")]));
 t("Unqualified rows skipped",(await q.next("reviewer")).item?.id==="valid");
 ({q,store}=make([fixture("a")]));
 first=await q.next("reviewer");const simultaneous=await Promise.all([q.decide("reviewer",first.item,"APPROVE","req8"),q.decide("reviewer",first.item,"DISAPPROVE","req9")]);
 t("Concurrent conflicting decisions only save once",simultaneous.filter(x=>x.status==="SAVED").length===1&&(await store.auditForTest()).length===1);
 const broken=createReviewQueue({store:{list:async()=>[fixture("a")],commitDecision:async()=>{throw new Error("failure")}},authorize:()=>true});
 t("Failed persistence does not advance",(await broken.decide("reviewer",snapshot(fixture("a")),"APPROVE","req10")).status==="STORE_UNAVAILABLE");
 t("Unknown action rejected",(await q.decide("reviewer",first.item,"SEND","req11")).status==="INVALID_REQUEST");
 return tests;
}

export {eligible,createReviewQueue,createMemoryStore,runQueueTests};
if(typeof process!=='undefined'&&process.argv.includes('--test')){const tests=await runQueueTests();for(const t of tests)console.log(`${t.pass?'PASS':'FAIL'} ${t.name}`);console.log(`${tests.filter(t=>t.pass).length}/${tests.length} passed`);if(tests.some(t=>!t.pass))process.exitCode=1;}
