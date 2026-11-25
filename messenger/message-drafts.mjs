// NorthLight Messenger M4: deterministic draft generator, no sending or live AI API.
// Synthetic tests only. Run node message-drafts.mjs --test.
const ANGLES={
  "booking": {
    "label": "bookings and appointment requests",
    "question": "Would you be open to seeing a simpler way to manage bookings?"
  },
  "quotes": {
    "label": "quote requests and enquiries",
    "question": "Would you be open to seeing a simpler way to manage quote requests?"
  },
  "followups": {
    "label": "customer follow-ups",
    "question": "Would you be open to seeing how customer follow-ups could be simplified?"
  },
  "website": {
    "label": "website enquiries",
    "question": "Would you be open to seeing an idea for your website?"
  },
  "workflow": {
    "label": "day-to-day customer administration",
    "question": "Would you be open to seeing a simpler way to manage customer enquiries?"
  }
};

function prepareDraft(candidate,qualification,channel,config={}){
  const fail=(reason)=>({status:"BLOCKED",reason,sendAllowed:false,draft:null});
  if(!candidate||typeof candidate!=="object")return fail("INVALID_CANDIDATE");
  if(candidate.optOut===true||candidate["Do Not Contact"]===true||candidate["Do Not Contact"]==="__YES__"||["Withdrawn","No consent"].includes(candidate.consent))return fail("SUPPRESSED");
  if(qualification?.status!=="REVIEW"||qualification?.reason!=="QUALIFIED_FOR_HUMAN_REVIEW"||qualification?.sendAllowed!==false)return fail("QUALIFICATION_GATE");
  if(!["sms","imessage","email"].includes(channel))return fail("INVALID_CHANNEL");
  if(!["Documented express","Documented inferred","Reviewed deemed"].includes(candidate.consent)||candidate.consentChannel!==channel)return fail("CHANNEL_CONSENT_REQUIRED");
  if(candidate.contactType!==(channel==="email"?"public_business_email":"public_business_phone"))return fail("CONTACT_CHANNEL_MISMATCH");
  const name=String(candidate.name??"").trim();
  if(!name||name.length>80||/[\r\n<>]/.test(name))return fail("INVALID_NAME");
  if(!Object.prototype.hasOwnProperty.call(ANGLES,candidate.angle))return fail("UNKNOWN_ANGLE");
  const sources=Array.isArray(candidate.evidence)?candidate.evidence:[];
  const source=sources.find(e=>e?.kind==="opportunity"&&e.angle===candidate.angle&&/^https?:\/\/[^/\s]+/i.test(e.url??"")&&String(e.observation??"").trim().length>=10);
  const consentSource=sources.find(e=>e?.kind==="consent"&&e.channel===channel&&/^https?:\/\/[^/\s]+/i.test(e.url??"")&&String(e.observation??"").trim().length>=10);
  if(!source||!consentSource)return fail("EVIDENCE_REQUIRED");
  if(config.replyUnsubscribeVerified!==true)return fail("UNSUBSCRIBE_NOT_VERIFIED");
  const angle=ANGLES[candidate.angle];
  const sender="NorthLight Studios";
  const introduction=`Hi ${name} team, we're ${sender}.`;
  const body=channel==="email"
    ?`${introduction}\n\nWe help local businesses simplify ${angle.label} through websites and practical automation. ${angle.question}\n\nThanks,\n${sender}\n\nIf you'd prefer no further messages, reply STOP.`
    :`${introduction} We help businesses simplify ${angle.label}. ${angle.question} Reply STOP to opt out.`;
  const limit=channel==="sms"?320:channel==="imessage"?500:1200;
  if(body.length>limit)return fail("MESSAGE_TOO_LONG");
  return {status:"DRAFT_READY",channel,subject:channel==="email"?`An idea for ${name}`:null,draft:body,source:source.url,consentEvidence:consentSource.url,approvalRequired:true,sendAllowed:false};
}

function runDraftTests(){
 const c={name:"Example Business",angle:"booking",consent:"Documented express",consentChannel:"sms",contactType:"public_business_phone",evidence:[{kind:"opportunity",angle:"booking",url:"https://example.invalid/opportunity",observation:"Synthetic booking opportunity for fixture."},{kind:"consent",channel:"sms",url:"https://example.invalid/consent",observation:"Synthetic channel-specific permission fixture."}]};
 const q={status:"REVIEW",reason:"QUALIFIED_FOR_HUMAN_REVIEW",sendAllowed:false};
 const cfg={replyUnsubscribeVerified:true}, tests=[];
 function t(name,candidate,qualification,channel,options,expected){const r=prepareDraft(candidate,qualification,channel,options);tests.push({name,pass:(r.reason??r.status)===expected&&r.sendAllowed===false,actual:r.reason??r.status});}
 t("Eligible SMS remains draft-only",c,q,"sms",cfg,"DRAFT_READY");
 t("Qualification block",c,{status:"BLOCK"}, "sms",cfg,"QUALIFICATION_GATE");
 t("Missing qualification",c,null,"sms",cfg,"QUALIFICATION_GATE");
 t("Opt-out blocked",{...c,optOut:true},q,"sms",cfg,"SUPPRESSED");
 t("Withdrawn consent blocked",{...c,consent:"Withdrawn"},q,"sms",cfg,"SUPPRESSED");
 t("No cross-channel fallback",c,q,"imessage",cfg,"CHANNEL_CONSENT_REQUIRED");
 t("Unverified consent blocked",{...c,consent:"Unverified"},q,"sms",cfg,"CHANNEL_CONSENT_REQUIRED");
 t("Private contact blocked",{...c,contactType:"private"},q,"sms",cfg,"CONTACT_CHANNEL_MISMATCH");
 t("No evidence blocked",{...c,evidence:[]},q,"sms",cfg,"EVIDENCE_REQUIRED");
 t("Unmatched opportunity blocked",{...c,angle:"quotes"},q,"sms",cfg,"EVIDENCE_REQUIRED");
 t("Unknown angle blocked",{...c,angle:"__proto__"},q,"sms",cfg,"UNKNOWN_ANGLE");
 t("Invalid name blocked",{...c,name:"Example\nInjected content"},q,"sms",cfg,"INVALID_NAME");
 t("Invalid channel blocked",c,q,"whatsapp",cfg,"INVALID_CHANNEL");
 t("Unsubscribe route must be verified",c,q,"sms",{},"UNSUBSCRIBE_NOT_VERIFIED");
 t("Missing input blocked",null,q,"sms",cfg,"INVALID_CANDIDATE");
 const email={...c,consentChannel:"email",contactType:"public_business_email",evidence:c.evidence.map(e=>e.kind==="consent"?{...e,channel:"email"}:e)};
 t("Email draft supported",email,q,"email",cfg,"DRAFT_READY");
 const imessage={...c,consentChannel:"imessage",evidence:c.evidence.map(e=>e.kind==="consent"?{...e,channel:"imessage"}:e)};
 t("iMessage draft supported",imessage,q,"imessage",cfg,"DRAFT_READY");
 const r=prepareDraft(c,q,"sms",cfg);tests.push({name:"Sender, opt-out and approval present",pass:r.draft?.includes("NorthLight Studios")&&r.draft?.includes("Reply STOP")&&r.approvalRequired===true});
 tests.push({name:"No price or guaranteed result",pass:!/\$|guarantee|double your/i.test(r.draft??"")});
 return tests;
}

export {prepareDraft,runDraftTests};
if(typeof process!=='undefined'&&process.argv.includes('--test')){const tests=runDraftTests();for(const t of tests) console.log(`${t.pass?'PASS':'FAIL'} ${t.name}`);console.log(`${tests.filter(t=>t.pass).length}/${tests.length} passed`);if(tests.some(t=>!t.pass))process.exitCode=1;}
