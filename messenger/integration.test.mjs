// M9 synthetic end-to-end tests; no live delivery or real personal data.
import {checkCandidate} from './matcher.mjs';
import {qualify} from './qualification.mjs';
import {prepareDraft} from './message-drafts.mjs';
import {createMemoryStore,createReviewQueue} from './review-queue.mjs';
import {planDelivery,classifyOutcome} from './delivery-handoff.mjs';
import {classifyReply,suggestReply} from './response-management.mjs';
async function integration(deps){
 const {checkCandidate,qualify,prepareDraft,createMemoryStore,createReviewQueue,planDelivery,classifyOutcome,classifyReply,suggestReply}=deps;
 const tests=[];const t=(name,pass)=>tests.push({name,pass:pass===true});
 const today="2026-11-26";const channel="email";const evidence=["identity","operations","opportunity","contact","commercialFit","consent"].map((kind,i)=>({kind,url:`https://example${i%2}.invalid/${kind}`,publisher:`fixture${i%2}`,checkedAt:today,observation:"Synthetic observation for integration tests only.",...(kind==="opportunity"?{angle:"booking"}:{}),...(kind==="consent"?{channel}:{})}));
 const c={id:"fixture-1",name:"Fictional Workshop",email:"workshop@example.invalid",location:"Auckland",operating:true,opportunity:"workflow_improvement",contactType:"public_business_email",consent:"Documented express",consentChannel:channel,angle:"booking",evidence,factors:{opportunityFit:1,workflowValue:1,commercialFit:.8,operatingEvidence:1,teamFit:.8}};
 const m=checkCandidate(c,[],{historyComplete:true});const q=qualify(c,m,{today});const d=prepareDraft(c,q,channel,{replyUnsubscribeVerified:true});
 t("Fresh fictional candidate reaches review",m.decision==="REVIEW"&&q.status==="REVIEW"&&d.status==="DRAFT_READY");
 const row={id:c.id,name:c.name,revision:0,state:"PENDING",channel,recipient:c.email,subject:d.subject,draft:d.draft,historyCleared:true,suppressed:false,consentVerified:true,consentChannel:channel,evidenceRef:d.source,consentRef:d.consentEvidence};
 const store=createMemoryStore([row]);const queue=createReviewQueue({store,authorize:a=>a==="fixture-reviewer",now:()=>today+"T00:00:00Z"});
 const shown=await queue.next("fixture-reviewer");t("Generated draft enters approval queue",shown.status==="READY"&&shown.item?.draft===d.draft);
 const approval=await queue.decide("fixture-reviewer",shown.item,"APPROVE","fixture-request");
 t("Exact approval advances queue",approval.status==="SAVED"&&approval.next.status==="EMPTY");
 const current=(await store.list())[0];
 const checks={suppressionClear:true,historyClear:true,consentCurrent:true,senderContactVerified:true,sameChannelUnsubscribeFree:true,unsubscribeOperational30Days:true};
 const policy={enabled:true,channels:{email:true,sms:false,imessage:false}};
 const handoff=planDelivery({approval:approval.record,current,checks,policy});
 t("Approval prepares draft without sending",handoff.status==="HANDOFF_READY"&&handoff.sendAllowed===false&&handoff.body===d.draft&&handoff.recipient===c.email);
 t("Production delivery disabled by default",planDelivery({approval:approval.record,current,checks,policy:{enabled:false}}).status==="BLOCKED");
 const stop=classifyReply({id:"fixture-stop",kind:"reply",channel,authenticated:true,currentTextVerified:true,body:"STOP"},{identityVerified:true,existingThread:true});
 t("STOP response suppresses",stop.suppress===true&&suggestReply(stop,{suppressed:false,identityVerified:true,existingThread:true,replyPermitted:true}).status==="NO_DRAFT");
 t("Previously opted-out candidate blocked before qualification",checkCandidate(c,[{email:c.email,"Do Not Contact":true}],{historyComplete:true}).reason==="OPT_OUT_MATCH");
 t("New opt-out prevents delivery",planDelivery({approval:approval.record,current:{...current,suppressed:true},checks,policy}).status==="BLOCKED");
 t("Incomplete history blocks draft pipeline",qualify(c,checkCandidate(c,[],{historyComplete:false}),{today}).status==="BLOCK");
 t("Delivery failure does not auto retry",classifyOutcome("HANDOFF_STARTED","FAILURE").retryAllowed===false);
 return tests;
}
const tests=await integration({checkCandidate,qualify,prepareDraft,createMemoryStore,createReviewQueue,planDelivery,classifyOutcome,classifyReply,suggestReply});
for(const t of tests)console.log(t.pass?'PASS':'FAIL',t.name);
console.log(tests.filter(t=>t.pass).length+'/'+tests.length+' passed');
if(tests.some(t=>!t.pass))process.exitCode=1;
