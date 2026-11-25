// M7: conservative incoming response triage. No network, automated replies, bookings or database writes.
// Trusted adapter must authenticate events, extract current reply text and persist opt-outs atomically.
function classifyReply(event,context={}){
 const result=(category,action,extra={})=>({category,action,sendAllowed:false,approvalRequired:true,...extra});
 if(!event||typeof event!=="object"||!event.id||!["email","sms","imessage"].includes(event.channel)||event.authenticated!==true)return result("UNVERIFIED","REVIEW_SOURCE");
 if(event.kind==="bounce"||event.kind==="delivery_failure")return result("DELIVERY_FAILURE","HOLD_NO_RETRY");
 if(event.kind!=="reply"||typeof event.body!=="string"||!event.body.trim())return result("UNKNOWN","MANUAL_REVIEW");
 // Only the trusted adapter may supply current reply text, never a quoted outbound message.
 if(event.currentTextVerified!==true)return result("UNKNOWN","REVIEW_UNQUOTED_TEXT");
 const text=event.body.trim().normalize("NFKC").toLowerCase().replace(/[’‘]/g,"'");
 const optout=/\b(?:stop|unsubscribe|opt[\s-]*out|remove me|remove us|do not contact|don't contact|never contact|no more messages|stop messaging|stop texting|stop emailing|take me off|leave me alone)\b/i;
 const decline=/\b(?:no thanks|no thank you|not interested|not for us|not keen|no need|we're all good|we are all good|already sorted|don't need|do not need|please don't)\b/i;
 if(optout.test(text))return result("OPT_OUT","SUPPRESS_ALL_MARKETING",{suppress:true,close:true});
 if(context.suppressed===true)return result("SUPPRESSED","NO_OUTREACH",{suppress:true});
 if(decline.test(text)||/^(?:no|nah)[.! ]*$/.test(text))return result("DECLINED","CLOSE_NO_FOLLOWUP",{close:true});
 if(context.identityVerified!==true||context.existingThread!==true)return result("UNKNOWN","VERIFY_IDENTITY");
 if(/\b(?:wrong number|wrong person|not this business|not the owner)\b/.test(text))return result("WRONG_RECIPIENT","HOLD_NO_RETRY");
 if(/\b(?:not now|maybe later|next month|too busy|not at the moment|another time)\b/.test(text))return result("DEFERRED","MANUAL_REVIEW_NO_SCHEDULE");
 if(/\b(?:how much|what does it cost|pricing|price|costs?|how does it work|more info|more information|tell me more)\b/.test(text))return result("QUESTION","PREPARE_REPLY");
 if(/\b(?:book a call|schedule a call|happy to chat|give me a call|can we talk|can we meet|let's chat|let's talk)\b/.test(text))return result("MEETING_INTEREST","PREPARE_MEETING_REPLY");
 if(/\b(?:i'm interested|i am interested|we're interested|we are interested|sounds good|show me|send me a demo|keen to see|yes please)\b/.test(text))return result("POSSIBLE_INTEREST","PREPARE_REPLY");
 return result("UNKNOWN","MANUAL_REVIEW");
}

function suggestReply(classification,context={}){
 const none=reason=>({status:"NO_DRAFT",reason,sendAllowed:false});
 if(!classification||classification.sendAllowed!==false||context.suppressed!==false||context.identityVerified!==true||context.existingThread!==true||context.replyPermitted!==true)return none("REPLY_GATE");
 const drafts={
 QUESTION:"Thanks for getting back to us. Happy to explain — which part of your current process would you most like to improve?",
 MEETING_INTEREST:"Thanks, happy to have a quick chat. What day and time would suit you?",
 POSSIBLE_INTEREST:"Thanks for getting back to us. What part of your bookings or enquiries would you most like to make easier?"
 };
 if(!Object.prototype.hasOwnProperty.call(drafts,classification.category))return none("NO_AUTOMATED_REPLY");
 return {status:"DRAFT_READY",draft:drafts[classification.category],approvalRequired:true,sendAllowed:false};
}

function runResponseTests(){
 const ctx={suppressed:false,identityVerified:true,existingThread:true,replyPermitted:true};
 const e=(body,patch={})=>({id:"synthetic-event",channel:"sms",kind:"reply",authenticated:true,currentTextVerified:true,body,...patch});
 const tests=[];function t(name,pass){tests.push({name,pass:pass===true})}
 const c=(body,patch={},context=ctx)=>classifyReply(e(body,patch),context);
 t("STOP suppresses globally",c("STOP").suppress===true);
 t("Case and punctuation ignored",c("Stop!").category==="OPT_OUT");
 t("Opt-out takes precedence over positive wording",c("Sounds good but please unsubscribe").category==="OPT_OUT");
 t("Opt-out independent of identity resolution",c("Remove me",{},{}).category==="OPT_OUT");
 t("Unverified source held",c("STOP",{authenticated:false}).category==="UNVERIFIED");
 t("Quoted text not used for classification",c("Reply STOP",{currentTextVerified:false}).category==="UNKNOWN");
 t("Polite decline closed",c("No thanks mate").category==="DECLINED");
 t("Already sorted closed",c("We are already sorted").category==="DECLINED");
 t("Short no closed",c("No.").category==="DECLINED");
 t("Suppressed contact never revived",c("Yes please",{},{...ctx,suppressed:true}).category==="SUPPRESSED");
 t("Failure not retried",c("",{kind:"delivery_failure"}).action==="HOLD_NO_RETRY");
 t("Bounce not retried",c("",{kind:"bounce"}).action==="HOLD_NO_RETRY");
 t("Wrong recipient held",c("Wrong number").category==="WRONG_RECIPIENT");
 t("Deferred not automatically scheduled",c("Maybe later").action==="MANUAL_REVIEW_NO_SCHEDULE");
 t("Question identified",c("How much does it cost?").category==="QUESTION");
 t("Meeting interest identified",c("Can we talk?").category==="MEETING_INTEREST");
 t("Possible interest not commitment",c("Sounds good").category==="POSSIBLE_INTEREST");
 t("Ambiguous yes held",c("Yes").category==="UNKNOWN");
 t("Negated interest is decline",c("Not interested").category==="DECLINED");
 t("Unlinked reply held",c("Sounds good",{},{...ctx,existingThread:false}).category==="UNKNOWN");
 t("Opt-out never generates reply",suggestReply(c("STOP"),ctx).status==="NO_DRAFT");
 t("Decline never generates reply",suggestReply(c("No thanks"),ctx).status==="NO_DRAFT");
 t("Unknown never generates reply",suggestReply(c("Yes"),ctx).status==="NO_DRAFT");
 t("Permitted question draft requires approval",suggestReply(c("How much?"),ctx).approvalRequired===true&&suggestReply(c("How much?"),ctx).sendAllowed===false);
 t("Missing permission blocks reply",suggestReply(c("How much?"),{...ctx,replyPermitted:false}).status==="NO_DRAFT");
 t("Meeting draft makes no booking commitment",suggestReply(c("Can we talk?"),ctx).draft.includes("What day and time"));
 return tests;
}

export {classifyReply,suggestReply,runResponseTests};
if(typeof process!=='undefined'&&process.argv.includes('--test')){const t=runResponseTests();for(const x of t)console.log(`${x.pass?'PASS':'FAIL'} ${x.name}`);console.log(`${t.filter(x=>x.pass).length}/${t.length} passed`);if(t.some(x=>!x.pass))process.exitCode=1;}
