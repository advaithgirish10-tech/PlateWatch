/*
 * PlateWatch WhatsApp reporting, simulated in the page.
 * - The chat runs the same script a WhatsApp Business bot would (verify → place → category → evidence → detail → confirm → receipt).
 * - Reports go to moderation, then to the restaurant, then to the regulator when an escalation rule is met.
 * - Each verified number keeps its own thread, so status updates arrive as new bot messages.
 * All numbers, reports and outlets are fictional sample data held in memory.
 */
export function createReporting(ctx){
const {D,REPORTS,S,esc,fmt,st,cur,toast,findPlaces,copyText,selectNode,TODAY,newId,loginAs,onChange}=ctx;
const AUTH="FDA Maharashtra";
const DAY=864e5,HOUR=36e5;
const todayISO=TODAY.toISOString().slice(0,10);
/* the demo clock: today's sample date at the viewer's current time of day */
const NOW0=(()=>{const d=new Date(TODAY),r=new Date();d.setUTCHours(r.getHours(),r.getMinutes(),0,0);return d.getTime()})();
const T0=Date.now();
const now=()=>NOW0+(Date.now()-T0);
const place=rid=>D.find(r=>r.id===rid);

/* ---------- rules (editable in Admin → Escalation rules) ---------- */
const ESC={stdCount:4,stdDays:7,fastCount:5,fastHours:48,newDays:7,newWeight:0.5,illNoteHours:72,illSecondDays:14,cooldownDays:60,perOutletDays:7,dailyLimit:5};
const RULE_FIELDS=[
  ["Standard rule",[["stdCount","Weighted reports needed",1,50,0.5],["stdDays","Within (days)",1,60,1]]],
  ["Fast lane",[["fastCount","Reports needed",2,50,1],["fastHours","Within (hours)",1,168,1]]],
  ["Number age",[["newDays","A number is new for (days)",0,90,1],["newWeight","Weight of a new number",0,1,0.1]]],
  ["Illness rule",[["illNoteHours","Doctor's note from the last (hours)",1,240,1],["illSecondDays","Second illness report within (days)",1,60,1]]],
  ["Cooldown",[["cooldownDays","Days before the same outlet can escalate again",0,365,1]]],
  ["Guardrails",[["perOutletDays","One report per number per outlet every (days)",1,60,1],["dailyLimit","Reports per number per day",1,50,1]]]];

/* ---------- verified numbers ---------- */
const USERS={"9876543210":{since:"2026-06-10"}};
const registerNumber=p=>{if(p&&!USERS[p])USERS[p]={since:todayISO}};
const numberAge=p=>USERS[p]?Math.max(0,Math.round((TODAY-new Date(USERS[p].since))/DAY)):null;
const isNewNumber=p=>numberAge(p)!=null&&numberAge(p)<ESC.newDays;
const ageText=p=>{const n=numberAge(p);return n==null?"no verified number":n===0?"number verified today":n===1?"number verified yesterday":`number verified ${n} days ago`};

/* ---------- report model ---------- */
const ACCEPTED=new Set(["accepted","review","verified","resolved"]);
const isAccepted=x=>ACCEPTED.has(x.status);
const visibleToRestaurant=x=>isAccepted(x)&&x.share!==false&&!!x.rid;
const EVIDENCE_KINDS=new Set(["photo","video","bill"]);
const hasEvidence=x=>(x.evidence||[]).some(e=>EVIDENCE_KINDS.has(e.kind));
const KIND={photo:"photo",video:"video",bill:"bill",note:"doctor's note"};
const evidenceText=x=>{const l=x.evidence||[];if(!l.length)return "None";const c={};l.forEach(e=>c[e.kind]=(c[e.kind]||0)+1);return `${l.length} (${Object.entries(c).map(([k,n])=>n>1?`${n} ${KIND[k]}s`:KIND[k]).join(", ")})`};
const outletName=x=>x.rid?place(x.rid).name:x.place?x.place.name:"Unknown place";
/* bring the older sample reports into the new shape */
REPORTS.forEach(x=>{
  if(x.ts==null)x.ts=Date.parse(x.date+"T12:00:00Z");
  if(!x.evidence)x.evidence=x.photo?[{kind:"photo",name:"photo.jpg"}]:[];
  if(x.share==null)x.share=true;
  if(!x.ref)x.ref="PW-"+(4100+x.id);
  if(x.status==="verified"||x.status==="resolved"||x.status==="review")x.notified=true;
});
/* demo seeds: Coastal Tiffin Centre is one report short of the standard rule; Spice Route Kitchen one short of the fast lane */
(function seed(){
  const add=(rid,user,since,hoursAgo,cat,text,kinds)=>{USERS[user]={since};const id=newId(),ts=NOW0-hoursAgo*HOUR;
    REPORTS.push({id,rid,text,cat,date:new Date(ts).toISOString().slice(0,10),ts,status:"accepted",photo:kinds.includes("photo"),evidence:kinds.map((k,i)=>({kind:k,name:`${k}-${id}-${i+1}.${k==="bill"?"pdf":"jpg"}`})),share:true,notified:true,flag:false,response:null,user,ref:"PW-"+(4100+id),channel:"whatsapp"})};
  add(7,"9820011001","2026-03-02",26,"Pests","Cockroaches on the wall behind the serving counter.",["photo"]);
  add(7,"9819922002","2026-01-15",70,"Hygiene","Staff handling food and cash without washing hands.",["photo","bill"]);
  add(7,"9833033003","2025-11-20",118,"Stale or spoiled food","Chutney smelled sour and was served anyway.",["photo"]);
  add(5,"9004400401","2026-09-21",2,"Pests","Rat seen near the delivery pickup shelf.",["photo"]);
  add(5,"9004400402","2026-09-22",9,"Pests","Droppings next to the packed orders.",["photo"]);
  add(5,"9004400403","2026-09-20",20,"Hygiene","Open drain beside the kitchen entrance.",["video"]);
  add(5,"9867700404","2026-04-02",30,"Stale or spoiled food","Biryani delivered with a sour smell.",["photo","bill"]);
})();

/* ---------- reporter threads ---------- */
const THREADS={};let anon=[];
const thread=()=>S.user?(THREADS[S.user.phone]=THREADS[S.user.phone]||[]):anon;
function notify(phone,text){
  if(!phone)return;
  (THREADS[phone]=THREADS[phone]||[]).push({who:"bot",html:esc(text),upd:true});
  if(isOpen()&&S.user&&S.user.phone===phone)renderLog();
}

/* ---------- reporter-facing status ---------- */
const STAGES=["Awaiting moderation","Accepted","Restaurant notified",`Sent to ${AUTH}`,"Official action taken"];
function stage(x){
  if(x.status==="rejected"||x.status==="dismissed")return -1;
  if(!isAccepted(x))return 0;
  return x.actionOn?4:x.sentOn?3:x.notified?2:1;
}
function stageLabel(x,i){
  if(i===3&&x.sentOn)return `${STAGES[3]} (${fmt(x.sentOn)})`;
  if(i===4&&x.actionOn)return `${STAGES[4]} (${fmt(x.actionOn)})`;
  return STAGES[i];
}
function stagesHTML(x){
  const i=stage(x);
  if(i<0)return `<p class="myrep-dis">Couldn't be used: ${esc(x.reason||"not substantiated after review")}.</p>`;
  const steps=x.share===false?STAGES.slice(0,2):STAGES;
  return `<ol class="rstep${x.share===false?" rstep-2":""}" aria-label="Report status">${steps.map((_,k)=>`<li class="${k<i?"done":k===i?"now":""}"${k===i?' aria-current="step"':""}><span>${esc(stageLabel(x,k))}</span></li>`).join("")}</ol>
    ${x.share===false?`<p class="myrep-dis">Kept private: used only to spot patterns, never shared with the restaurant or the regulator.</p>`:!hasEvidence(x)?`<p class="myrep-dis">No photo, video or bill, so this report can't be sent to the regulator.</p>`:""}`;
}

/* ---------- escalation engine ---------- */
const ESCALATIONS=[];
/* 0 for private or evidence-free reports, reduced for numbers verified recently */
function weight(x){if(x.share===false||!hasEvidence(x)||!x.user)return 0;return isNewNumber(x.user)?ESC.newWeight:1}
const qualifies=x=>!!x.rid&&weight(x)>0&&!x.escId&&x.status!=="rejected"&&x.status!=="dismissed";
/* one report per number: keep the heaviest */
function perNumber(list){const m=new Map();list.forEach(x=>{const p=m.get(x.user);if(!p||weight(x)>weight(p))m.set(x.user,x)});return [...m.values()]}
function standard(rid){const from=now()-ESC.stdDays*DAY;const list=perNumber(REPORTS.filter(x=>x.rid===rid&&qualifies(x)&&isAccepted(x)&&x.ts>=from));return {list,count:Math.round(list.reduce((s,x)=>s+weight(x),0)*100)/100}}
function fastLane(rid){const from=now()-ESC.fastHours*HOUR;const list=perNumber(REPORTS.filter(x=>x.rid===rid&&qualifies(x)&&x.ts>=from));const fresh=list.filter(x=>isNewNumber(x.user)).length;return {list,count:list.length,urgent:list.length>=ESC.fastCount,warn:list.length>0&&fresh>list.length/2,fresh}}
function illness(rid){
  const ill=REPORTS.filter(x=>x.rid===rid&&qualifies(x)&&isAccepted(x)&&x.cat==="Fell ill");
  const solo=ill.find(x=>x.evidence.some(e=>e.kind==="bill")&&x.evidence.some(e=>e.kind==="note"&&(e.ts||x.ts)>=x.ts-ESC.illNoteHours*HOUR));
  if(solo)return [solo];
  const pair=perNumber(ill.filter(x=>x.ts>=now()-ESC.illSecondDays*DAY));
  return pair.length>=2?pair:null;
}
function lastEscalation(rid){return ESCALATIONS.filter(e=>e.rid===rid).pop()||null}
/* within the cooldown, only reports that arrived after the last escalation can trigger another */
function allowed(rid,list){const l=lastEscalation(rid);return !l||now()-l.ts>=ESC.cooldownDays*DAY||list.some(x=>x.ts>l.ts)}
function escalate(rid,rule,list){
  const r=place(rid);
  const e={id:ESCALATIONS.length+1,ref:"ESC-"+(201+ESCALATIONS.length),rid,rule,reportIds:list.map(x=>x.id),date:todayISO,ts:now(),authority:AUTH,histLen:r.hist.length,actionOn:null};
  ESCALATIONS.push(e);
  list.forEach(x=>{if(!isAccepted(x))acceptQuiet(x);x.escId=e.id;x.sentOn=todayISO});
  const n=list.length-1;
  list.forEach(x=>notify(x.user,`Update on ${x.ref}: Your report${n?` and ${n} other${n===1?"":"s"}`:""} ${n?"were":"was"} sent to ${AUTH} on ${fmt(todayISO)}.`));
  return e;
}
function evaluate(){
  const made=[];
  D.forEach(r=>{
    const s=standard(r.id);
    if(s.list.length&&s.count>=ESC.stdCount&&allowed(r.id,s.list)){made.push(escalate(r.id,"Standard",s.list));return}
    const il=illness(r.id);
    if(il&&allowed(r.id,il))made.push(escalate(r.id,"Illness",il));
  });
  return made;
}
const urgentOutlets=()=>D.map(r=>({r,f:fastLane(r.id)})).filter(o=>o.f.urgent&&allowed(o.r.id,o.f.list));
function confirmFast(rid){const f=fastLane(rid);if(!f.urgent)return null;return escalate(rid,"Fast lane",f.list)}
function coordinatedFast(rid){const f=fastLane(rid);f.list.forEach(x=>markCoordinated(x));return f.list.length}
/* when the tracker shows a new official action after an escalation, tell every reporter */
function checkActions(){
  ESCALATIONS.forEach(e=>{
    const r=place(e.rid);if(e.actionOn||r.hist.length<=e.histLen)return;
    const h=r.hist[r.hist.length-1];e.actionOn=h[0];
    e.reportIds.forEach(id=>{const x=REPORTS.find(y=>y.id===id);x.actionOn=h[0];notify(x.user,`${AUTH} took action on ${r.name} on ${fmt(h[0])}. Thanks for reporting.`)});
  });
}
/* demo only: record a sample official action so the follow-up message can be seen */
function simulateAction(escId){
  const e=ESCALATIONS.find(y=>y.id===escId),r=place(e.rid),t=cur(r)[1];
  r.hist.push([todayISO,t==="sus"||t==="rev"?t:"imp","Inspection following consumer reports (sample)"]);r.verified=todayISO;
  checkActions();
}
function packetText(e){
  const r=place(e.rid),list=e.reportIds.map(id=>REPORTS.find(x=>x.id===id)).sort((a,b)=>a.ts-b.ts);
  const cats={};list.forEach(x=>cats[x.cat||"Other"]=(cats[x.cat||"Other"]||0)+1);
  const rule={Standard:`Standard rule: ${ESC.stdCount}+ weighted, evidence-backed reports from different people within ${ESC.stdDays} days`,"Fast lane":`Fast lane: ${ESC.fastCount}+ reports within ${ESC.fastHours} hours, confirmed not coordinated by a moderator`,Illness:"Illness rule: illness report with a bill and a recent doctor's note, or two independent illness reports"}[e.rule];
  return [`To: ${e.authority} — Designated Officer, Food Safety (demo)`,`Subject: Consumer reports about ${r.name} (FSSAI ${r.lic})`,"",
    `Outlet: ${r.name}`,`Address: ${r.area}, ${r.city}`,`Type: ${r.cat}`,`FSSAI licence: ${r.lic}`,`Trigger: ${rule}`,
    `Reports: ${list.length}, from ${fmt(list[0].date)} to ${fmt(list[list.length-1].date)}`,`Categories: ${Object.entries(cats).map(([k,n])=>`${k} (${n})`).join(", ")}`,"",
    ...list.map((x,i)=>`${i+1}. ${x.ref} · ${fmt(x.date)} · ${x.cat||"Other"} · "${x.text}" · Evidence: ${(x.evidence||[]).map(v=>v.name).join(", ")||"none"}`),"",
    "Reporter identities withheld.","These are unverified consumer observations, not findings."].join("\n");
}

/* ---------- moderation ---------- */
function acceptQuiet(x){x.status="accepted";x.askMore=false;if(x.share!==false&&x.rid)x.notified=true}
function accept(x){
  acceptQuiet(x);
  notify(x.user,`Update on ${x.ref}: Accepted by our moderators.`);
  if(x.notified)notify(x.user,`Update on ${x.ref}: The restaurant has been notified.`);
  return evaluate();
}
function reject(x,reason){x.status="rejected";x.reason=reason;x.askMore=false;notify(x.user,`Update on ${x.ref}: Couldn't be used: ${reason}.`)}
function markCoordinated(x){x.coordinated=true;reject(x,"part of a coordinated set of reports")}
function askMore(x){x.askMore=true;notify(x.user,`Update on ${x.ref}: A moderator asked for more. A clearer photo or the bill would help. Open this chat and tap “Add to ${x.ref}”.`)}
function ownerResponded(x){notify(x.user,`${outletName(x)} responded to your report ${x.ref}: “${x.response.text}”`)}
function countsInfo(x){
  if(x.share===false)return "No · kept private";
  if(!hasEvidence(x))return "No · no photo, video or bill";
  if(!x.user)return "No · no verified number";
  if(!x.rid)return "No · outlet not listed yet";
  if(x.status==="rejected")return "No · rejected";
  if(x.escId)return "Already escalated";
  return `Yes · weight ${weight(x).toFixed(1)}${isNewNumber(x.user)?" (new number)":""}${isAccepted(x)?"":" once accepted"}`;
}

/* ---------- complaint text for FSSAI Food Safety Connect ---------- */
function complaintText(x){
  const r=x&&x.rid?place(x.rid):null;
  return ["Complaint for FSSAI Food Safety Connect",
    `Restaurant: ${x?outletName(x):"[restaurant name]"}`,
    `Area: ${r?r.area+", "+r.city:x&&x.place?x.place.area:"[area]"}`,
    `FSSAI licence number: ${r?r.lic:"Not known"}`,
    `Date: ${fmt(x?x.date:todayISO)}`,
    `Category: ${x?x.cat||"Other":"[what happened]"}`,
    `What happened: ${x?x.text:"[one line]"}`].join("\n");
}

/* ---------- chat UI ---------- */
const $=id=>document.getElementById(id);
const root=$("bot"),panel=root.querySelector(".bot-panel"),log=$("botLog"),quick=$("botQuick"),form=$("botForm"),input=$("botInput"),attach=$("botAttach"),fileIn=$("botFile");
let C={active:false,buttons:[],onText:null,onFile:null};
let pendingKind=null,lastFocus=null;
const isOpen=()=>!root.hidden;
const bubble=m=>`<div class="bm bm-${m.who}${m.upd?" bm-upd":""}">${m.upd?`<span class="bm-tag">Update</span>`:""}${m.html}</div>`;
function renderLog(){const t=thread();log.innerHTML=t.length?t.map(bubble).join(""):"";log.scrollTop=log.scrollHeight}
function renderQuick(){
  quick.innerHTML=C.buttons.map((b,i)=>`<button type="button" class="bq" data-bq="${i}">${esc(b.label)}</button>`).join("");
  quick.hidden=!C.buttons.length;
  attach.disabled=!C.onFile;
  input.placeholder=C.placeholder||"Type a message";
  input.inputMode=C.numeric?"numeric":"text";
  log.scrollTop=log.scrollHeight;
}
function say(html){thread().push({who:"bot",html});renderLog()}
function me(html){thread().push({who:"me",html});renderLog()}
function ask(buttons,opt){opt=opt||{};C.buttons=buttons;C.onText=opt.onText||null;C.onFile=opt.onFile||null;C.placeholder=opt.placeholder;C.numeric=!!opt.numeric;renderQuick()}
function end(){C.active=false;ask([{label:"Done",fn:close}])}
const phoneNow=()=>S.user&&S.user.phone;

function start(opt){
  C={active:true,rid:opt.rid||null,place:opt.name!=null?{name:opt.name,area:""}:null,cat:"",evidence:[],line:"",buttons:[]};
  say("Hi, this is PlateWatch. Reporting a food-safety problem takes 30 seconds.");
  if(S.user){registerNumber(S.user.phone);afterVerify()}else verifyStep();
}
function verifyStep(){
  say("First, confirm your number.");
  say(`<span class="bm-hint">Demo tip: 98765 43210 is a sample number verified in June, so its reports count in full. Any valid number works.</span>`);
  ask([],{placeholder:"10-digit mobile number",numeric:true,onText:v=>{
    const p=v.replace(/\D/g,"").replace(/^91(?=\d{10}$)/,"");
    if(!/^[6-9]\d{9}$/.test(p)){say("That doesn't look right. Send a 10-digit mobile number starting with 6, 7, 8 or 9.");return}
    const code=String(Math.floor(100000+Math.random()*900000));
    say(`We've sent a code to +91 ${p.slice(0,5)} ${p.slice(5)}. <span class="bm-hint">Demo — no SMS is sent. Your code is <b>${code}</b>.</span>`);
    ask([{label:"Change number",fn:verifyStep}],{placeholder:"6-digit code",numeric:true,onText:c=>{
      if(c.replace(/\D/g,"")!==code){say("That code doesn't match. Try again.");return}
      const before=anon;anon=[];registerNumber(p);THREADS[p]=[...(THREADS[p]||[]),...before];loginAs(p);
      say("Number confirmed. You're signed in on the PlateWatch site too.");afterVerify();
    }});
  }});
}
function afterVerify(){
  const p=phoneNow();
  if(REPORTS.filter(x=>x.user===p&&x.date===todayISO).length>=ESC.dailyLimit){say("You've reached today's limit. Try again tomorrow.");end();return}
  const more=REPORTS.filter(x=>x.user===p&&x.askMore&&x.status==="pending");
  if(more.length&&!C.rid&&!C.place){
    say("A moderator asked for more on one of your reports.");
    ask([...more.map(x=>({label:`Add to ${x.ref}`,fn:()=>addMore(x)})),{label:"New report",fn:placeStep}]);return;
  }
  if(C.rid){const r=place(C.rid);if(!guardOutlet())return;say(`You're reporting <b>${esc(r.name)}</b>, ${esc(r.area)}.`);catStep();return}
  if(C.place&&C.place.name){say(`You're reporting “${esc(C.place.name)}”, which isn't listed yet.`);areaStep();return}
  placeStep();
}
/* 1 report per number per outlet per week */
function guardOutlet(){
  const p=phoneNow(),from=now()-ESC.perOutletDays*DAY;
  const same=x=>C.rid?x.rid===C.rid:!x.rid&&x.place&&C.place&&x.place.name.toLowerCase()===C.place.name.toLowerCase();
  const prev=REPORTS.find(x=>x.user===p&&same(x)&&x.ts>=from);
  if(prev){say(`You've already reported this place this week. We'll update you on that report (${prev.ref}).`);end();return false}
  return true;
}
function placeStep(){
  say("Which place? Share your location, send a photo of the bill, or type the name.");
  ask([{label:"Share location",echo:"📍 Location shared",fn:nearby},{label:"Send bill photo",file:{accept:"image/*,.pdf",kind:"bill"}},{label:"Type name",fn:()=>{say("Type the name of the place.");ask([],{placeholder:"Restaurant name",onText:nameSearch})}}],
    {placeholder:"Or type the name",onText:nameSearch,onFile:billFile});
}
function nearby(){
  const near=D.filter(r=>r.city==="Mumbai").slice(0,3),dist=["120 m","350 m","600 m"];
  say("These are the nearest places I know:");
  ask([...near.map((r,i)=>({label:`${r.name} · ${dist[i]}`,fn:()=>choose(r)})),{label:"None of these",fn:()=>{say("Type the name of the place.");ask([],{placeholder:"Restaurant name",onText:nameSearch})}}]);
}
function billFile(f){
  addEvidence(f,"bill");
  /* demo: read the "licence number" from the bill by matching a sample outlet */
  const hit=D.find(r=>f.name.toLowerCase().includes(r.name.split(" ")[0].toLowerCase()))||D[f.name.length%D.length];
  say(`Found licence ${hit.lic.slice(0,6)}…, that's <b>${esc(hit.name)}</b>, ${esc(hit.area)}. Correct?`);
  ask([{label:"Yes",fn:()=>choose(hit)},{label:"No, choose another",fn:()=>{say("Type the name of the place.");ask([],{placeholder:"Restaurant name",onText:nameSearch})}}]);
}
/* fuzzy match: substring hits first, then letter-pair similarity for typos */
const grams=s=>{s=s.toLowerCase().replace(/[^a-z0-9]/g,"");const g=new Set();for(let i=0;i<s.length-1;i++)g.add(s.slice(i,i+2));return g};
const sim=(a,b)=>{const A=grams(a),B=grams(b);if(!A.size||!B.size)return 0;let n=0;A.forEach(x=>{if(B.has(x))n++});return 2*n/(A.size+B.size)};
function fuzzy(q){
  const exact=findPlaces(q);
  const near=D.filter(r=>!exact.includes(r)).map(r=>({r,s:Math.max(sim(q,r.name),...r.name.split(/\s+/).map(w=>sim(q,w)))})).filter(o=>o.s>=0.4).sort((a,b)=>b.s-a.s).map(o=>o.r);
  return [...exact,...near].slice(0,3);
}
function nameSearch(q){
  const m=fuzzy(q);
  if(!m.length){say(`I couldn't find “${esc(q)}” on PlateWatch.`);ask([{label:"Not listed",fn:()=>{C.place={name:q,area:""};areaStep()}},{label:"Try again",fn:()=>{say("Type the name of the place.");ask([],{placeholder:"Restaurant name",onText:nameSearch})}}]);return}
  say("Is it one of these?");
  ask([...m.map(r=>({label:`${r.name} · ${r.area}`,fn:()=>choose(r)})),{label:"Not listed",fn:()=>{say("What's the place called?");ask([],{placeholder:"Restaurant name",onText:n=>{C.place={name:n,area:""};areaStep()}})}}]);
}
function areaStep(){say("Which area is it in?");ask([],{placeholder:"e.g. Dadar West",onText:a=>{C.place.area=a;if(!guardOutlet())return;say("Thanks. We'll add it as a new place for our team to check.");catStep()}})}
function choose(r){C.rid=r.id;C.place=null;if(!guardOutlet())return;catStep()}
function catStep(){
  say("What did you see?");
  ask(["Pests","Stale or spoiled food","Hygiene","Fell ill","Other"].map(c=>({label:c,fn:()=>{C.cat=c;evidenceStep()}})));
}
const evButtons=last=>[{label:"Photo or video",file:{accept:"image/*,video/*",kind:null}},{label:"Bill",file:{accept:"image/*,.pdf",kind:"bill"}},last];
function evidenceStep(){
  say(C.evidence.length?"Thanks for the bill. Add a photo or video too if you have one. This makes your report count.":"Send a photo, video or the bill. This makes your report count.");
  ask(evButtons({label:C.evidence.length?"Continue":"Skip",fn:afterEvidence}),{onFile:gotEvidence});
}
function gotEvidence(f,kind){addEvidence(f,kind);say("Got it. Add another, or continue.");ask(evButtons({label:"Continue",fn:afterEvidence}),{onFile:gotEvidence})}
function afterEvidence(){
  if(C.cat!=="Fell ill"){detailStep();return}
  say(`Do you have a doctor's note or prescription from the last ${ESC.illNoteHours} hours?`);
  ask([{label:"Attach",file:{accept:"image/*,.pdf",kind:"note"}},{label:"No",fn:detailStep}],{onFile:f=>{addEvidence(f,"note");detailStep()}});
}
function detailStep(){
  say("Anything to add? One line is enough.");
  ask([{label:"Skip",fn:confirmStep}],{placeholder:"One line (optional, 500 characters max)",onText:v=>{C.line=v.slice(0,500);confirmStep()}});
}
function confirmStep(){
  const r=C.rid?place(C.rid):null,t=new Date(now());
  const tm=t.toLocaleTimeString("en-IN",{hour:"numeric",minute:"2-digit",timeZone:"UTC"});
  const draft={evidence:C.evidence};
  say(`<div class="bm-card"><div class="bm-card-h">Your report</div><dl>
    <dt>Outlet</dt><dd>${esc(r?r.name:C.place.name+" (not listed)")}</dd>
    <dt>Licence</dt><dd>${r?esc(r.lic):"Not known yet"}</dd>
    <dt>Address</dt><dd>${esc(r?r.area+", "+r.city:C.place.area)}</dd>
    <dt>Category</dt><dd>${esc(C.cat)}</dd>
    <dt>Date and time</dt><dd>${fmt(todayISO)}, ${tm}</dd>
    <dt>Evidence</dt><dd>${esc(evidenceText(draft))}</dd>
    ${C.line?`<dt>Your line</dt><dd>${esc(C.line)}</dd>`:""}</dl></div>`);
  say("Can we share this with the restaurant and the food safety regulator? Your number stays private.");
  ask([{label:"Yes, send",fn:()=>save(true)},{label:"Keep private",fn:()=>save(false)}]);
}
function save(share){
  const id=newId(),ts=now();
  const x={id,rid:C.rid,place:C.rid?null:{...C.place},text:C.line||`${C.cat} reported.`,cat:C.cat,date:todayISO,ts,status:"pending",
    photo:C.evidence.some(e=>e.kind==="photo"),evidence:C.evidence.map(e=>({kind:e.kind,name:e.name,ts})),share,flag:false,response:null,user:phoneNow(),ref:"PW-"+(4100+id),channel:"whatsapp"};
  REPORTS.push(x);
  if(!hasEvidence(x))say("Thanks. Reports without a photo or bill can't be sent to the regulator, but they help us spot patterns.");
  if(!share)say("Kept private. It's used only to spot patterns and is never shared with the restaurant or the regulator.");
  say(`Got it. Report <b>${x.ref}</b>. We'll message you here when it's reviewed.`);
  C.active=false;C.last=x;
  ask([{label:"Copy for FSSAI",keep:true,fn:()=>copyComplaint(x)},{label:"Done",fn:close}]);
  onChange();
}
function copyComplaint(x){
  const t=complaintText(x);
  copyText(t,"Complaint copied",()=>{say(`<pre class="bm-pre" id="botPre">${esc(t)}</pre>`);selectNode(document.getElementById("botPre"))});
}
function addMore(x){
  say(`Send the photo, video or bill for ${x.ref}.`);
  ask(evButtons({label:"Cancel",fn:end}),{onFile:(f,k)=>{const e=addEvidence(f,k);x.evidence.push({kind:e.kind,name:e.name,ts:now()});x.photo=x.photo||e.kind==="photo";x.askMore=false;say(`Added to ${x.ref}. Our moderators will take another look.`);onChange();end()}});
}
function addEvidence(f,kind){
  kind=kind||(f.type.startsWith("video/")?"video":f.type==="application/pdf"?"bill":"photo");
  let url=null;if(f.type.startsWith("image/")){try{url=URL.createObjectURL(f)}catch(_){}}
  const e={kind,name:f.name,url};C.evidence=C.evidence||[];C.evidence.push(e);
  me(url?`<img class="bm-img" src="${url}" alt="Attached ${KIND[kind]}"><span class="bm-file">${esc(KIND[kind])} · ${esc(f.name)}</span>`:`<span class="bm-file">📄 ${esc(KIND[kind])} · ${esc(f.name)}</span>`);
  return e;
}

/* ---------- open / close, keyboard ---------- */
function open(opt){
  opt=opt||{};
  lastFocus=document.activeElement;
  root.hidden=false;document.documentElement.classList.add("bot-lock");
  if(opt.rid||opt.name!=null||!C.active)start(opt);else{renderLog();renderQuick()}
  setTimeout(()=>{const b=quick.querySelector("button");(C.onText||!b?input:b).focus()},0);
}
function close(){
  root.hidden=true;document.documentElement.classList.remove("bot-lock");
  if(lastFocus&&document.contains(lastFocus))lastFocus.focus();
  onChange();
}
quick.addEventListener("click",e=>{
  const b=e.target.closest("[data-bq]");if(!b)return;
  const q=C.buttons[+b.dataset.bq];
  if(q.file){pendingKind=q.file.kind;fileIn.accept=q.file.accept;fileIn.click();return}
  if(!q.keep){me(esc(q.echo||q.label));C.buttons=[];renderQuick()}
  q.fn();
  setTimeout(()=>{const f=quick.querySelector("button");if(!C.onText&&f)f.focus();else input.focus()},0);
});
form.addEventListener("submit",e=>{
  e.preventDefault();const v=input.value.trim();if(!v)return;input.value="";
  me(esc(v));
  if(C.onText){const fn=C.onText;fn(v)}else say(C.buttons.length?"Tap one of the options above.":"Tap Report on the site to start a new report.");
});
attach.addEventListener("click",()=>{if(!C.onFile)return;pendingKind=null;fileIn.accept="image/*,video/*,.pdf";fileIn.click()});
fileIn.addEventListener("change",()=>{const f=fileIn.files[0];fileIn.value="";if(!f||!C.onFile)return;const k=pendingKind;pendingKind=null;C.onFile(f,k)});
root.addEventListener("click",e=>{if(e.target.closest("[data-bot-close]"))close()});
document.addEventListener("keydown",e=>{
  if(!isOpen())return;
  if(e.key==="Escape"){e.preventDefault();close();return}
  if(e.key!=="Tab")return;
  const f=[...panel.querySelectorAll("button:not([disabled]),input:not([type=file]):not([disabled]),a[href]")].filter(x=>x.offsetParent);
  if(!f.length)return;
  const i=f.indexOf(document.activeElement);
  if(e.shiftKey&&(i<=0)){e.preventDefault();f[f.length-1].focus()}
  else if(!e.shiftKey&&i===f.length-1){e.preventDefault();f[0].focus()}
});

evaluate();
return {open,close,isOpen,notify,registerNumber,numberAge,ageText,isNewNumber,ESC,RULE_FIELDS,USERS,ESCALATIONS,AUTH,
  isAccepted,visibleToRestaurant,hasEvidence,evidenceText,weight,countsInfo,stage,stagesHTML,STAGES,outletName,
  standard,fastLane,urgentOutlets,evaluate,confirmFast,coordinatedFast,checkActions,simulateAction,packetText,lastEscalation,
  accept,reject,askMore,markCoordinated,ownerResponded,complaintText};
}
