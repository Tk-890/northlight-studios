// NorthLight Messenger — M2 matching module. Synthetic fixtures only.
// Run: node matcher.mjs --test
function normalPhone(value, partial=false) {
  const raw=String(value??"").trim();
  if(!raw||(!partial&&/[a-z.…]/i.test(raw))) return "";
  let d=raw.replace(/\D/g,"");
  if(d.startsWith("0064")) d=d.slice(2);
  else if(d.startsWith("0")) d="64"+d.slice(1);
  else if(partial&&d.startsWith("2")) d="64"+d;
  if(!d.startsWith("64")||!/^642\d+$/.test(d)) return "";
  if(partial) return d.length>=7&&d.length<=11?d:"";
  return d.length>=10&&d.length<=11?d:"";
}

function normName(value) {
  return String(value??"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/^duplicate\s*[-—:]\s*/,"").replace(/\(do not use\)/g,"").replace(/&/g," and ").replace(/\b(limited|ltd)\b/g,"").replace(/[^a-z0-9]/g,"");
}

function normEmail(value) {
  const s=String(value??"").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)?s:"";
}

function normDomain(value) {
  let s=String(value??"").trim().toLowerCase().replace(/^https?:\/\//,"").split(/[/?#]/)[0].replace(/^www\./,"").replace(/\.$/,"");
  if(!/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(s)||["gmail.com","outlook.com","hotmail.com","facebook.com","instagram.com","fresha.com","google.com","yellow.co.nz","linkedin.com","wixsite.com","github.io","netlify.app"].some(x=>s===x||s.endsWith("."+x)))return "";
  return s;
}

function normNZBN(value) {
  const s=String(value??"").replace(/\s/g,"");
  return /^\d{13}$/.test(s)?s:"";
}

function identifiers(x) {
  return {phone:normalPhone(x.phone??x["Messaging Contact"]),prefix:normalPhone(x.prefix??x["Phone Prefix Evidence"],true),name:normName(x.name??x.Business),email:normEmail(x.email??x["Public Email"]),domain:normDomain(x.ownedDomain),nzbn:normNZBN(x.nzbn)};
}

function isHistoricalCandidate(candidate){
  return ["Historical — exclude","Duplicate — exclude","Contact attempted — exclude","Existing conversation — exclude"].includes(candidate["New Lead Eligibility"])||candidate["Sending Status"]==="Sent"||["Sent","Replied","No iMessage","Skipped","Do not contact"].includes(candidate["Messenger Status"])||Boolean(candidate["date:Messenger Last Contact:start"]);
}

function checkCandidate(candidate,history,options={}) {
  if(!candidate||!Array.isArray(history)||history.some(x=>!x||typeof x!=="object"))return {decision:"BLOCK",reason:"INVALID_INPUT",matches:[]};
  if(candidate["Do Not Contact"]===true||candidate["Do Not Contact"]==="__YES__"||candidate["Messaging Consent"]==="Withdrawn"||candidate["Messaging Consent"]==="No consent")return {decision:"BLOCK",reason:"CANDIDATE_SUPPRESSED",matches:[]};
  if(isHistoricalCandidate(candidate))return {decision:"BLOCK",reason:"CANDIDATE_HISTORICAL",matches:[]};
  const a=identifiers(candidate), matches=[];
  for(const row of history){
    if(candidate.id&&row.id&&candidate.id===row.id) continue;
    const b=identifiers(row), keys=[];
    for(const k of ["phone","email","nzbn","domain","name"])if(a[k]&&a[k]===b[k])keys.push(k);
    if(a.phone&&b.prefix&&a.phone.startsWith(b.prefix))keys.push("prefix");
    if(!keys.length)continue;
    const suppressed=row["Do Not Contact"]===true||row["Do Not Contact"]==="__YES__"||["Withdrawn","No consent"].includes(row["Messaging Consent"])||row["Messenger Status"]==="Do not contact";
    const strong=keys.some(k=>["phone","email","nzbn","domain"].includes(k));
    matches.push({id:row.id??null,keys,suppressed,strong});
  }
  if(matches.some(m=>m.suppressed&&m.strong))return {decision:"BLOCK",reason:"OPT_OUT_MATCH",matches};
  if(matches.some(m=>m.strong))return {decision:"BLOCK",reason:"HISTORICAL_MATCH",matches};
  if(matches.length)return {decision:"BLOCK",reason:"POSSIBLE_HISTORY_MATCH",matches};
  if(!a.name||(!a.phone&&!a.email))return {decision:"BLOCK",reason:"MISSING_IDENTITY",matches};
  if(options.historyComplete!==true)return {decision:"BLOCK",reason:"HISTORY_INCOMPLETE",matches};
  return {decision:"REVIEW",reason:"NO_MATCH_FOUND_NOT_SEND_APPROVAL",matches};
}

function runTests(){
  const tests=[];
  function t(name,got,expected){tests.push({name,pass:got===expected,got,expected})}
  const candidate={name:"Example Business Limited",phone:"021 000 0001",email:"owner@example.invalid"};
  const check=(rows,opts={historyComplete:true})=>checkCandidate(candidate,rows,opts).reason;
  t("NZ local number",normalPhone("021 000 0001"),"64210000001");
  t("NZ international number",normalPhone("+64 21 000 0001"),"64210000001");
  t("NZ 0064 number",normalPhone("0064 21 000 0001"),"64210000001");
  t("Truncated number is never sendable",normalPhone("+64 21 000…"),"");
  t("Truncated prefix normalizes",normalPhone("+64 21 000…",true),"6421000");
  t("Wrong country blocked",normalPhone("+1 202 555 0100"),"");
  t("Exact historical phone",check([{phone:"+64 21 000 0001"}]),"HISTORICAL_MATCH");
  t("STOP exact phone",check([{phone:"+64 21 000 0001","Do Not Contact":true}]),"OPT_OUT_MATCH");
  t("STOP partial phone",check([{prefix:"+64 21 000…","Do Not Contact":true}]),"POSSIBLE_HISTORY_MATCH");
  t("Email normalization",check([{email:" OWNER@EXAMPLE.INVALID "}]),"HISTORICAL_MATCH");
  t("Name alias",check([{name:"Example Business Ltd."}]),"POSSIBLE_HISTORY_MATCH");
  t("No match but incomplete",check([],{}),"HISTORY_INCOMPLETE");
  t("No match only allows review",check([]),"NO_MATCH_FOUND_NOT_SEND_APPROVAL");
  t("Candidate own opt-out",checkCandidate({...candidate,"Messaging Consent":"Withdrawn"},[],{historyComplete:true}).reason,"CANDIDATE_SUPPRESSED");
  t("Missing contact",checkCandidate({name:"Example Business"},[],{historyComplete:true}).reason,"MISSING_IDENTITY");
  t("Invalid history",checkCandidate(candidate,null).reason,"INVALID_INPUT");
  t("Owned domain match",checkCandidate({...candidate,ownedDomain:"https://www.example.invalid"},[{ownedDomain:"example.invalid"}],{historyComplete:true}).reason,"HISTORICAL_MATCH");
  t("Shared domain ignored",normDomain("facebook.com"),"");
  t("NZBN match",checkCandidate({...candidate,nzbn:"0000000000000"},[{nzbn:"0000000000000"}],{historyComplete:true}).reason,"HISTORICAL_MATCH");
  t("Self row excluded",checkCandidate({...candidate,id:"new"},[{...candidate,id:"new"}],{historyComplete:true}).reason,"NO_MATCH_FOUND_NOT_SEND_APPROVAL");
  t("Opt-out wins over other matches",check([{name:"Example Business"},{phone:"+64210000001","Messaging Consent":"Withdrawn"}]),"OPT_OUT_MATCH");
  t("Own sent record cannot bypass self check",checkCandidate({...candidate,id:"new","Sending Status":"Sent"},[{...candidate,id:"new"}],{historyComplete:true}).reason,"CANDIDATE_HISTORICAL");
  t("Skipped candidate stays blocked",checkCandidate({...candidate,"Messenger Status":"Skipped"},[],{historyComplete:true}).reason,"CANDIDATE_HISTORICAL");
  t("Historical classification stays blocked",checkCandidate({...candidate,"New Lead Eligibility":"Historical — exclude"},[],{historyComplete:true}).reason,"CANDIDATE_HISTORICAL");
  t("Prior contact date blocks",checkCandidate({...candidate,"date:Messenger Last Contact:start":"2026-11-25"},[],{historyComplete:true}).reason,"CANDIDATE_HISTORICAL");
  return tests;
}

export { normalPhone, normName, normEmail, normDomain, normNZBN, checkCandidate, runTests };
if (typeof process !== 'undefined' && process.argv.includes('--test')) { const tests=runTests(); for (const t of tests) console.log(`${t.pass?'PASS':'FAIL'} ${t.name}`); console.log(`${tests.filter(t=>t.pass).length}/${tests.length} passed`); if(tests.some(t=>!t.pass)) process.exitCode=1; }
