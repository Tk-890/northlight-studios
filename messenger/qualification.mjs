// NorthLight Messenger M3. Research-only qualification. No delivery capability.
// Run: node qualification.mjs --test
function qualify(candidate,match,options={}){
  const result=(status,reason,score=null,missing=[])=>({status,reason,score,missing,sendAllowed:false});
  if(!candidate||typeof candidate!=="object"||Array.isArray(candidate))return result("BLOCK","INVALID_CANDIDATE");
  if(match?.decision!=="REVIEW"||match?.reason!=="NO_MATCH_FOUND_NOT_SEND_APPROVAL")return result("BLOCK","HISTORY_GATE");
  if(candidate.optOut===true||candidate.consent==="Withdrawn"||candidate.consent==="No consent")return result("BLOCK","CONTACT_SUPPRESSED");
  if(candidate.operating===false)return result("EXCLUDE","NOT_OPERATING");
  if(candidate.opportunity==="none")return result("EXCLUDE","NO_IDENTIFIED_OPPORTUNITY");
  const date=options.today;
  if(typeof date!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date)))return result("BLOCK","INVALID_REVIEW_DATE");
  const required=["identity","operations","opportunity","contact","commercialFit"];
  const evidence=Array.isArray(candidate.evidence)?candidate.evidence:[];
  const valid=evidence.filter(e=>e&&typeof e.url==="string"&&/^https?:\/\/[^/\s]+\S*$/i.test(e.url)&&typeof e.observation==="string"&&e.observation.trim().length>=10&&typeof e.checkedAt==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(e.checkedAt)&&Number.isFinite(Date.parse(e.checkedAt))&&Date.parse(e.checkedAt)<=Date.parse(date)&&Date.parse(date)-Date.parse(e.checkedAt)<=30*86400000&&typeof e.publisher==="string"&&e.publisher.trim().length>0);
  const missing=required.filter(k=>!valid.some(e=>e.kind===k));
  if(new Set(valid.map(e=>e.publisher.trim().toLowerCase())).size<2)missing.push("independent_sources");
  if(typeof candidate.name!=="string"||!candidate.name.trim())missing.push("business_name");
  if(candidate.operating!==true)missing.push("operating_status");
  if(!["website_gap","website_improvement","workflow_improvement","combined"].includes(candidate.opportunity))missing.push("verified_opportunity");
  if(typeof candidate.location!=="string"||!candidate.location.trim())missing.push("location");
  if(!["public_business_email","public_business_phone"].includes(candidate.contactType))missing.push("public_business_contact");
  const factors={opportunityFit:35,workflowValue:25,commercialFit:20,operatingEvidence:10,teamFit:10};
  for(const k of Object.keys(factors))if(!Number.isFinite(candidate.factors?.[k])||candidate.factors[k]<0||candidate.factors[k]>1)missing.push(k);
  if(missing.length)return result("BLOCK","EVIDENCE_INCOMPLETE",null,missing);
  const score=Math.round(Object.entries(factors).reduce((sum,[k,w])=>sum+w*candidate.factors[k],0));
  if(score<70)return result("EXCLUDE","FIT_BELOW_THRESHOLD",score);
  if(!["Documented express","Documented inferred","Reviewed deemed"].includes(candidate.consent)||!valid.some(e=>e.kind==="consent"))return result("RESEARCH_ONLY","CONSENT_REVIEW_REQUIRED",score);
  return result("REVIEW","QUALIFIED_FOR_HUMAN_REVIEW",score);
}

function runQualificationTests(){
  const today="2026-11-26";
  const evidence=["identity","operations","opportunity","contact","commercialFit","consent"].map((kind,i)=>({kind,url:`https://example${i%2}.invalid/evidence/${kind}`,publisher:`synthetic-${i%2}`,checkedAt:today,observation:"Synthetic observation for regression test only."}));
  const c={name:"Fictional Trade Services",location:"Auckland",operating:true,opportunity:"workflow_improvement",contactType:"public_business_phone",consent:"Documented express",evidence,factors:{opportunityFit:1,workflowValue:1,commercialFit:.8,operatingEvidence:1,teamFit:.8}};
  const m={decision:"REVIEW",reason:"NO_MATCH_FOUND_NOT_SEND_APPROVAL"};
  const tests=[];
  function t(name,candidate,match,expected,opt={today}){const r=qualify(candidate,match,opt);tests.push({name,pass:r.reason===expected&&r.sendAllowed===false,actual:r.reason});}
  t("Complete evidence remains review-only",c,m,"QUALIFIED_FOR_HUMAN_REVIEW");
  t("History gate cannot be bypassed",c,{decision:"BLOCK"},"HISTORY_GATE");
  t("Opt-out blocks", {...c,optOut:true},m,"CONTACT_SUPPRESSED");
  t("Withdrawn consent blocks",{...c,consent:"Withdrawn"},m,"CONTACT_SUPPRESSED");
  t("Closed business excluded",{...c,operating:false},m,"NOT_OPERATING");
  t("No opportunity excluded",{...c,opportunity:"none"},m,"NO_IDENTIFIED_OPPORTUNITY");
  t("Unknown operations blocked",{...c,operating:undefined},m,"EVIDENCE_INCOMPLETE");
  t("Private contact blocked",{...c,contactType:"private"},m,"EVIDENCE_INCOMPLETE");
  t("No source data blocked",{...c,evidence:[]},m,"EVIDENCE_INCOMPLETE");
  t("Single publisher blocked",{...c,evidence:evidence.map(e=>({...e,publisher:"same"}))},m,"EVIDENCE_INCOMPLETE");
  t("Stale evidence blocked",{...c,evidence:evidence.map(e=>({...e,checkedAt:"2026-09-01"}))},m,"EVIDENCE_INCOMPLETE");
  t("Future evidence blocked",{...c,evidence:evidence.map(e=>({...e,checkedAt:"2026-12-01"}))},m,"EVIDENCE_INCOMPLETE");
  t("Unknown factors blocked",{...c,factors:{}},m,"EVIDENCE_INCOMPLETE");
  t("Low commercial fit excluded",{...c,factors:{opportunityFit:.5,workflowValue:.5,commercialFit:.5,operatingEvidence:.5,teamFit:.5}},m,"FIT_BELOW_THRESHOLD");
  t("Public contact is not consent",{...c,consent:"Unverified"},m,"CONSENT_REVIEW_REQUIRED");
  t("Consent label alone insufficient",{...c,evidence:evidence.filter(e=>e.kind!=="consent")},m,"CONSENT_REVIEW_REQUIRED");
  t("Invalid review date blocked",c,m,"INVALID_REVIEW_DATE",{});
  t("Malformed input blocked",null,m,"INVALID_CANDIDATE");
  return tests;
}

export {qualify,runQualificationTests};
if(typeof process!=='undefined'&&process.argv.includes('--test')){const t=runQualificationTests();for(const x of t)console.log(`${x.pass?'PASS':'FAIL'} ${x.name}`);console.log(`${t.filter(x=>x.pass).length}/${t.length} passed`);if(t.some(x=>!x.pass))process.exitCode=1;}
