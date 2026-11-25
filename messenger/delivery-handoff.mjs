// M6 manual delivery handoff policy. No network calls, no actual sending.
// A durable adapter must atomically recheck eligibility and reserve attemptKey before handoff.
// Provider events must be authenticated by that adapter; user reports are not delivery proof.
function planDelivery({approval,current,checks,policy}={}){
 const fail=reason=>({status:"BLOCKED",reason,sendAllowed:false});
 const s=approval?.approvedSnapshot;
 if(approval?.decision!=="APPROVE"||!s||approval.sendAllowed!==false)return fail("APPROVAL_REQUIRED");
 if(!current||current.state!=="APPROVED"||current.revision!==s.revision+1||approval.id!==s.id)return fail("STALE_APPROVAL");
 if(!["id","name","channel","recipient","subject","draft","evidenceRef","consentRef"].every(k=>(current[k]??null)===(s[k]??null)))return fail("SNAPSHOT_CHANGED");
 if(!["email","sms","imessage"].includes(s.channel))return fail("INVALID_CHANNEL");
 if(typeof s.recipient!=="string"||(s.channel==="email"?!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.recipient):!/^\+642\d{7,8}$/.test(s.recipient)))return fail("INVALID_RECIPIENT");
 if(typeof s.draft!=="string"||!s.draft.includes("NorthLight Studios")||!/reply STOP/i.test(s.draft))return fail("INVALID_MESSAGE");
 if(current.suppressed!==false||checks?.suppressionClear!==true||checks?.historyClear!==true||checks?.consentCurrent!==true||current.consentChannel!==s.channel)return fail("LIVE_VERIFICATION_REQUIRED");
 if(checks?.senderContactVerified!==true||checks?.sameChannelUnsubscribeFree!==true||checks?.unsubscribeOperational30Days!==true)return fail("UNSUBSCRIBE_OR_IDENTITY_UNVERIFIED");
 if(policy?.enabled!==true||policy?.channels?.[s.channel]!==true)return fail("CHANNEL_DISABLED");
 if(s.channel!=="email"&&checks?.transportConfirmed!==s.channel)return fail("TRANSPORT_UNCONFIRMED");
 if(s.channel==="sms"&&(!Number.isFinite(policy.smsRemainingNZD)||!Number.isFinite(checks.smsEstimatedNZD)||checks.smsEstimatedNZD<0||checks.smsEstimatedNZD>policy.smsRemainingNZD))return fail("SMS_BUDGET");
 if(typeof approval.requestId!=="string"||!approval.requestId.trim())return fail("APPROVAL_ID_REQUIRED");
 return {status:"HANDOFF_READY",sendAllowed:false,manualConfirmationRequired:true,attemptKey:JSON.stringify([s.id,s.revision,approval.requestId]),channel:s.channel,recipient:s.recipient,subject:s.subject??null,body:s.draft,target:s.channel==="email"?"gmail-draft":"device-message-composer"};
}

function classifyOutcome(state,event){
 if(state!=="HANDOFF_STARTED")return {status:"BLOCKED",reason:"INVALID_TRANSITION",retryAllowed:false};
 if(event==="USER_CANCELLED")return {status:"CANCELLED",retryAllowed:false};
 if(event==="USER_REPORTED_SENT")return {status:"SENT_REPORTED",deliveryVerified:false,retryAllowed:false};
 if(event==="PROVIDER_SEND_CONFIRMED")return {status:"SEND_CONFIRMED",deliveryVerified:false,retryAllowed:false};
 if(event==="PROVIDER_DELIVERY_CONFIRMED")return {status:"DELIVERY_CONFIRMED",deliveryVerified:true,retryAllowed:false};
 if(event==="FAILURE"||event==="UNKNOWN")return {status:event==="FAILURE"?"FAILED":"OUTCOME_UNKNOWN",deliveryVerified:false,retryAllowed:false};
 return {status:"BLOCKED",reason:"UNKNOWN_EVENT",retryAllowed:false};
}

function runDeliveryTests(){
 const s={id:"fixture",revision:0,name:"Synthetic Example",channel:"sms",recipient:"+64210000001",subject:null,draft:"NorthLight Studios. Reply STOP to opt out.",evidenceRef:"fixture-opportunity",consentRef:"fixture-consent"};
 const a={id:s.id,decision:"APPROVE",requestId:"fixture-request",approvedSnapshot:s,sendAllowed:false};
 const c={...s,state:"APPROVED",revision:1,suppressed:false,consentChannel:"sms"};
 const checks={suppressionClear:true,historyClear:true,consentCurrent:true,senderContactVerified:true,sameChannelUnsubscribeFree:true,unsubscribeOperational30Days:true,transportConfirmed:"sms",smsEstimatedNZD:.2};
 const policy={enabled:true,channels:{sms:true,imessage:true,email:true},smsRemainingNZD:1};
 const tests=[];function t(name,value){tests.push({name,pass:value===true})}
 const run=(patch={})=>planDelivery({approval:a,current:c,checks,policy,...patch});
 t("Valid fixture prepares only",run().status==="HANDOFF_READY"&&run().sendAllowed===false);
 t("Missing approval blocked",run({approval:null}).reason==="APPROVAL_REQUIRED");
 t("Changed message blocked",run({current:{...c,draft:"Changed"}}).reason==="SNAPSHOT_CHANGED");
 t("Changed recipient blocked",run({current:{...c,recipient:"+64210000002"}}).reason==="SNAPSHOT_CHANGED");
 t("Stale revision blocked",run({current:{...c,revision:2}}).reason==="STALE_APPROVAL");
 t("New opt-out blocked",run({current:{...c,suppressed:true}}).reason==="LIVE_VERIFICATION_REQUIRED");
 t("Missing history blocked",run({checks:{...checks,historyClear:false}}).reason==="LIVE_VERIFICATION_REQUIRED");
 t("Paid unsubscribe blocked",run({checks:{...checks,sameChannelUnsubscribeFree:false}}).reason==="UNSUBSCRIBE_OR_IDENTITY_UNVERIFIED");
 t("Sender contact missing blocked",run({checks:{...checks,senderContactVerified:false}}).reason==="UNSUBSCRIBE_OR_IDENTITY_UNVERIFIED");
 t("Unsubscribe duration blocked",run({checks:{...checks,unsubscribeOperational30Days:false}}).reason==="UNSUBSCRIBE_OR_IDENTITY_UNVERIFIED");
 t("Channel disabled blocked",run({policy:{...policy,channels:{sms:false}}}).reason==="CHANNEL_DISABLED");
 t("SMS fallback blocked",run({checks:{...checks,transportConfirmed:"imessage"}}).reason==="TRANSPORT_UNCONFIRMED");
 t("SMS spend limit blocked",run({checks:{...checks,smsEstimatedNZD:2}}).reason==="SMS_BUDGET");
 t("Unknown spend blocked",run({checks:{...checks,smsEstimatedNZD:undefined}}).reason==="SMS_BUDGET");
 t("Stable attempt key",run().attemptKey===run().attemptKey);
 t("User report not delivery proof",classifyOutcome("HANDOFF_STARTED","USER_REPORTED_SENT").deliveryVerified===false);
 t("Provider send not delivery proof",classifyOutcome("HANDOFF_STARTED","PROVIDER_SEND_CONFIRMED").deliveryVerified===false);
 t("Provider delivery proof",classifyOutcome("HANDOFF_STARTED","PROVIDER_DELIVERY_CONFIRMED").deliveryVerified===true);
 t("Failure no auto retry",classifyOutcome("HANDOFF_STARTED","FAILURE").retryAllowed===false);
 t("Unknown no auto retry",classifyOutcome("HANDOFF_STARTED","UNKNOWN").retryAllowed===false);
 t("Invalid transition blocked",classifyOutcome("APPROVED","PROVIDER_DELIVERY_CONFIRMED").status==="BLOCKED");
 return tests;
}

export {planDelivery,classifyOutcome,runDeliveryTests};
if(typeof process!=='undefined'&&process.argv.includes('--test')){const t=runDeliveryTests();for(const x of t)console.log(`${x.pass?'PASS':'FAIL'} ${x.name}`);console.log(`${t.filter(x=>x.pass).length}/${t.length} passed`);if(t.some(x=>!x.pass))process.exitCode=1;}
