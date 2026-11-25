import {createMemoryStore,createReviewQueue} from './review-queue.mjs';
import {classifyReply,suggestReply} from './response-management.mjs';
const $=id=>document.getElementById(id);
const fixtures=[
 {id:'demo-1',name:'Fictional Auto Studio',channel:'sms',recipient:'+64210000001',draft:'Hi Fictional Auto Studio team, we are NorthLight Studios. Would you be open to seeing a simpler way to manage bookings? Reply STOP to opt out.'},
 {id:'demo-2',name:'Fictional Electrical',channel:'imessage',recipient:'+64210000002',draft:'Hi Fictional Electrical team, we are NorthLight Studios. Would you be open to seeing a simpler way to manage quotes? Reply STOP to opt out.'},
 {id:'demo-3',name:'Fictional Salon',channel:'email',recipient:'salon@example.invalid',subject:'An idea for Fictional Salon',draft:'Hi Fictional Salon team, we are NorthLight Studios. Would you be open to seeing a simpler way to manage appointments? Reply STOP to opt out.'}
].map(r=>({...r,revision:0,state:'PENDING',subject:r.subject??null,historyCleared:true,suppressed:false,consentVerified:true,consentChannel:r.channel,evidenceRef:'synthetic-opportunity',consentRef:'synthetic-consent'}));
let store,queue,shown=null,busy=false,seq=0;
const actor='demo-reviewer';
function el(tag,value,cls){const n=document.createElement(tag);if(value!==undefined)n.textContent=value;if(cls)n.className=cls;return n}
function line(label,value){const n=el('div',undefined,'line');n.append(el('span',label),el('strong',value));return n}
function setBusy(v){busy=v;$('approve').disabled=v;$('reject').disabled=v;$('reset').disabled=v}
async function metrics(){
 const rows=await store.list(),audit=await store.auditForTest();
 const count=s=>rows.filter(r=>r.state===s).length;
 $('pending').textContent=count('PENDING');$('approved').textContent=count('APPROVED');$('rejected').textContent=count('DISAPPROVED');
 const done=rows.length-count('PENDING');$('progress').style.width=(done/rows.length*100)+'%';$('progress').parentNode.setAttribute('aria-valuenow',String(done));
 $('research-list').replaceChildren(...rows.map(r=>line(r.name,r.state)));
 $('audit').replaceChildren(...(audit.length?audit.map(a=>line(a.id+' · '+a.decision,a.at)): [el('p','No decisions yet.')]));
}
function render(next){
 const area=$('review-content');shown=next?.status==='READY'?next.item:null;area.replaceChildren();$('actions').hidden=!shown;
 if(!shown){area.append(el('h2',next?.status==='EMPTY'?'Queue complete':'Queue unavailable'),el('p',next?.status==='EMPTY'?'Every fictional prospect has been reviewed. Nothing has been sent.':'No next item could be loaded. Review state before retrying.','muted'));return}
 area.append(el('h2',shown.name));const meta=el('div',undefined,'meta');
 for(const [key,val] of [['Channel',shown.channel],['Fictional recipient',shown.recipient]]){const n=el('div');n.append(el('div',key,'label'),el('p',val));meta.append(n)}
 area.append(meta);if(shown.subject)area.append(el('p','Subject: '+shown.subject));area.append(el('div','Exact draft','label'),el('div',shown.draft,'draft'),el('p','Synthetic history, consent and opportunity checks. Approval is not sending.','muted'));
}
async function reset(){if(busy)return;setBusy(true);try{store=createMemoryStore(fixtures);queue=createReviewQueue({store,authorize:a=>a===actor});shown=null;seq=0;render(await queue.next(actor));await metrics();$('review-status').textContent='Demo ready.'}catch{$('review-status').textContent='Unable to initialise demo.'}finally{setBusy(false)}}
async function decide(action){if(busy||!shown)return;setBusy(true);const item=shown;const requestId='demo-'+(++seq);try{const result=await queue.decide(actor,item,action,requestId);if(result.status==='SAVED'){render(result.next);await metrics();$('review-status').textContent=action==='APPROVE'?'Approval saved in demo memory.':'Disapproval saved in demo memory.'}else{$('review-status').textContent='Decision not saved: '+result.status+'. Queue has not advanced.'}}catch{$('review-status').textContent='Decision outcome uncertain. Do not repeat without checking activity.'}finally{setBusy(false)}}
$('approve').addEventListener('click',()=>decide('APPROVE'));$('reject').addEventListener('click',()=>decide('DISAPPROVE'));$('reset').addEventListener('click',reset);
for(const b of document.querySelectorAll('[data-tab]'))b.addEventListener('click',()=>{for(const tab of document.querySelectorAll('[data-tab]')){const active=tab===b;tab.setAttribute('aria-selected',String(active));$(tab.dataset.tab).hidden=!active}});
$('classify').addEventListener('click',()=>{const context={suppressed:false,identityVerified:true,existingThread:true,replyPermitted:true};const classification=classifyReply({id:'fictional-reply',channel:'sms',kind:'reply',authenticated:true,currentTextVerified:true,body:$('reply').value},context);const suggested=suggestReply(classification,context);const out=$('response-result');out.replaceChildren(el('h3',classification.category),el('p',classification.action));if(suggested.status==='DRAFT_READY')out.append(el('div',suggested.draft,'draft'));out.append(el('p','Simulation only. No prospect record or message is changed.','muted'))});
reset();