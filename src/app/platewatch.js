/*
 * PlateWatch app logic: router, tracker, profiles, OTP login, restaurant
 * dashboard, admin queue, homepage, About and the How-it-works demo.
 * Ported unchanged from the prototype. It drives the DOM rendered by App.jsx.
 * All data is fictional sample data held in memory (resets on reload).
 * QRCode is a global loaded in index.html (qrcodejs 1.0.0).
 */
/* global QRCode */
import { createReporting } from "./bot.js";
export function initApp() {
const TYPES={sus:["Suspended","st-sus",""],rev:["Revoked","st-rev",""],imp:["Improvement notice","st-imp",""],ok:["Reinstated","st-ok",""]};
const D=[
 {id:1,name:"Harbour Lane Café",area:"Fort",city:"Mumbai",cat:"Café",lic:"11526998000101",verified:"2026-09-22",hist:[["2026-09-16","sus","Raw and cooked food stored together; blocked drainage near kitchen"]]},
 {id:2,name:"Shree Mithai Bhandar",area:"Malad West",city:"Mumbai",cat:"Sweet shop",lic:"11524011000233",verified:"2026-09-22",hist:[["2026-09-21","sus","Pest activity in storage room; expired raw material on premises"]]},
 {id:3,name:"Green Leaf Dhaba",area:"Hinjewadi",city:"Pune",cat:"Dhaba",lic:"11525017000418",verified:"2026-09-20",hist:[["2026-08-02","imp","Food handlers without medical certificates; no pest control records"],["2026-09-21","ok","Compliance confirmed on re-inspection"]]},
 {id:4,name:"QuickCart Dark Store 14",area:"Andheri East",city:"Mumbai",cat:"Dark store",lic:"10025022000561",verified:"2026-09-19",hist:[["2026-08-14","sus","Rodent droppings in dry storage"],["2026-09-10","ok","Licence restored after corrective action"]]},
 {id:5,name:"Spice Route Kitchen",area:"Thane West",city:"Thane",cat:"Cloud kitchen",lic:"11524033000702",verified:"2026-09-21",hist:[["2026-09-18","imp","No separation of veg and non-veg prep areas"]]},
 {id:6,name:"Royal Farsan Works",area:"Shil-Diva",city:"Thane",cat:"Manufacturer",lic:"11524099000815",verified:"2026-09-18",hist:[["2026-07-20","imp","Reused cooking oil beyond permitted limit"],["2026-09-09","rev","Repeat violations; licence revoked"]]},
 {id:7,name:"Coastal Tiffin Centre",area:"Dadar West",city:"Mumbai",cat:"Restaurant",lic:"11526012000944",verified:"2026-09-22",hist:[["2026-09-20","sus","Stagnant water near cold storage; insect infestation"]]},
 {id:8,name:"Orange City Bakers",area:"Sitabuldi",city:"Nagpur",cat:"Bakery",lic:"11524055001027",verified:"2026-08-15",hist:[["2026-08-10","imp","Unlabelled ingredients; missing batch records"]]},
 {id:9,name:"Deccan Dosa House",area:"Kothrud",city:"Pune",cat:"Restaurant",lic:"11525019001133",verified:"2026-09-21",hist:[["2026-09-17","sus","Cockroach infestation in kitchen and prep area"]]},
 {id:10,name:"Marine Drive Grill",area:"Churchgate",city:"Mumbai",cat:"Restaurant",lic:"11526003001248",verified:"2026-09-12",hist:[["2026-06-11","sus","Improper refrigeration; spoiled stock found"],["2026-07-02","ok","Licence restored after re-inspection"]]},
 {id:11,name:"Annapurna Dairy Products",area:"Mahape MIDC",city:"Navi Mumbai",cat:"Manufacturer",lic:"10024045001356",verified:"2026-09-22",hist:[["2026-09-19","sus","Suspected adulterants seized; samples sent for testing"]]},
 {id:12,name:"Temple Road Prasad Stall",area:"Shirdi",city:"Ahilyanagar",cat:"Sweet shop",lic:"21524088001471",verified:"2026-08-30",hist:[["2026-06-18","rev","Adulterated peda seized and destroyed"]]},
 {id:13,name:"Bandra Bao Co.",area:"Bandra West",city:"Mumbai",cat:"Café",lic:"11526027001589",verified:"2026-09-22",hist:[["2026-09-22","imp","Pest-control certificate expired; water test report missing"]]},
 {id:14,name:"Andheri Chaat Corner",area:"Andheri West",city:"Mumbai",cat:"Restaurant",lic:"11526031001694",verified:"2026-09-21",hist:[["2026-09-12","imp","Uncovered food on display; no handwash station"]]}
];
const TODAY=new Date("2026-09-23");
const cur=r=>r.hist[r.hist.length-1];
const fmt=s=>new Date(s).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"});
const st=t=>`<span class="st ${TYPES[t][1]}"><i>${TYPES[t][2]}</i>${TYPES[t][0]}</span>`;
const esc=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const byNew=(a,b)=>cur(b)[0].localeCompare(cur(a)[0]);

/* app state (in memory) */
const S={q:"",city:"",type:"",sort:"new",user:null,follows:new Set([7,13]),areas:["Dadar West"],after:null};

/* toast */
let tt;function toast(m){const t=document.getElementById("toast");t.textContent=m;t.hidden=false;clearTimeout(tt);tt=setTimeout(()=>t.hidden=true,2800)}

/* routing */
const pages=["home","tracker","detail","report","verify","login","account","biz","dash","admin","about"];
/* each page has a #hash (letters, digits, hyphens) so browser back/forward and deep links work */
const PAGE_HASH={home:"home",tracker:"tracker",report:"report",verify:"how-it-works",login:"login",account:"account",biz:"restaurants",dash:"dashboard",admin:"admin",about:"about"};
const PAGE_NAME={home:"Home",tracker:"Tracker",report:"Report",verify:"How it works",login:"Log in",account:"Your alerts",biz:"For restaurants",dash:"Dashboard",admin:"Admin",about:"About"};
const hashFor=(p,arg)=>p==="detail"?"profile-"+arg:PAGE_HASH[p];
function parseHash(h){
  h=(h||"").replace(/^#/,"");
  const m=h.match(/^profile-(\d+)$/);if(m)return D.some(r=>r.id===+m[1])?{p:"detail",arg:+m[1]}:null;
  const p=Object.keys(PAGE_HASH).find(k=>PAGE_HASH[k]===h);return p?{p}:null;
}
S.page={p:"home"};S.stack=[];
/* where a profile's Back button should go: the last page visited that isn't login or this same profile */
function backTarget(id){for(let i=S.stack.length-1;i>=0;i--){const e=S.stack[i];if(e.p==="login"||(e.p==="detail"&&e.arg===id))continue;return e}return {p:"tracker"}}
const pageName=e=>e.p==="detail"?D.find(r=>r.id===e.arg).name:PAGE_NAME[e.p];
function go(p,arg,opt){
  if(p==="account"&&!S.user){S.after="account";p="login"}
  if(p==="dash"&&S.owner==null)p="biz";
  if(p==="biz"&&S.owner!=null&&arg==null){p="dash";arg="overview"}
  const prev=S.page;if(!(prev.p===p&&prev.arg===arg)){S.stack.push(prev);if(S.stack.length>40)S.stack.shift()}
  S.page={p,arg};
  const h=hashFor(p,arg);
  if(location.hash.slice(1)!==h){if(opt&&opt.fromHash)history.replaceState(null,"","#"+h);else location.hash=h}
  if(p!=="admin")document.documentElement.classList.remove("ad-lock");
  pages.forEach(x=>document.getElementById("p-"+x).hidden=x!==p);
  document.querySelectorAll(".links .l").forEach(b=>b.setAttribute("aria-current",b.dataset.go===p||(p==="dash"&&b.dataset.go==="biz")?"page":"false"));
  document.getElementById("drawer").hidden=true;document.getElementById("menuBtn").setAttribute("aria-expanded","false");
  if(p==="detail")renderDetail(arg);
  if(p==="login")renderAuth("phone");
  if(p==="account")renderAccount();
  if(p==="tracker")renderList();
  if(p==="biz")renderBiz(arg);
  if(p==="dash")renderDash(arg||"overview");
  if(p==="admin")renderAdmin(arg||"verify");
  window.scrollTo(0,0);
}
addEventListener("hashchange",()=>{
  const h=location.hash.slice(1);if(h===hashFor(S.page.p,S.page.arg))return;
  const t=parseHash(h);if(t)go(t.p,t.arg,{fromHash:true});
});
document.addEventListener("click",e=>{const b=e.target.closest("[data-go]");if(b){e.preventDefault();go(b.dataset.go)}});
document.getElementById("menuBtn").onclick=e=>{const d=document.getElementById("drawer");d.hidden=!d.hidden;e.currentTarget.setAttribute("aria-expanded",String(!d.hidden))};
document.getElementById("authBtn").onclick=()=>{if(S.user){go("account");return}S.after="account";go("login")};
function syncAuthBtn(){const b=document.getElementById("authBtn");b.textContent=S.user?"My alerts":"Log in"}

/* rows */
function rowHTML(r){const c=cur(r);return `<div class="r" tabindex="0" role="link" data-id="${r.id}">
  <span class="d">${fmt(c[0])}</span>
  <div><div class="n">${esc(r.name)}</div><div class="w">${esc(r.area)}, ${esc(r.city)} · ${esc(r.cat)}</div></div>
  <div class="why">${esc(c[2])}</div>${st(c[1])}<span class="arr" aria-hidden="true">→</span></div>`}
function bindRows(el){el.addEventListener("click",e=>{const r=e.target.closest(".r");if(r)go("detail",+r.dataset.id)});el.addEventListener("keydown",e=>{if(e.key==="Enter"){const r=e.target.closest(".r");if(r)go("detail",+r.dataset.id)}})}

/* ---------- FLOW FIXES: shared helpers ---------- */
const AUTH="FDA Maharashtra";
const PRIOR={sus:"a suspension",rev:"a revocation",imp:"an improvement notice"};
/* one plain-language sentence from the latest official action, no verdicts */
function summaryLine(r){
  const c=r.hist.length?cur(r):null;
  if(!c)return `No official action on record as of ${fmt(r.verified)}. This is not a guarantee of hygiene.`;
  if(c[1]==="sus")return `Licence suspended by ${AUTH} on ${fmt(c[0])}. Not reinstated as of ${fmt(r.verified)}.`;
  if(c[1]==="rev")return `Licence revoked by ${AUTH} on ${fmt(c[0])}.`;
  if(c[1]==="imp")return `Improvement notice issued on ${fmt(c[0])}. Follow-up pending.`;
  const pv=r.hist[r.hist.length-2];
  return pv?`Licence reinstated on ${fmt(c[0])} after ${PRIOR[pv[1]]||"an earlier action"} on ${fmt(pv[0])}.`:`Licence reinstated on ${fmt(c[0])}.`;
}
/* the PlateWatch score is never shown publicly while an official action is open */
const paused=rid=>{const r=D.find(x=>x.id===rid);return !!r&&r.hist.length>0&&["sus","rev","imp"].includes(cur(r)[1])};
const pausedHTML=()=>`<div class="pz"><p class="pz-t">Score paused while an official action is open.</p><details class="pz-why"><summary>Why?</summary><p>Our score measures submitted evidence. It never overrides an official finding.</p></details></div>`;
function pubScore(rid,n){return paused(rid)?pausedHTML():`<div class="score">${n}<small>/100</small></div>`}
const progHTML=(done,tot)=>`<div class="prog"><div class="prog-l"><b>${done} of ${tot}</b> requirements met</div><span class="prog-t" aria-hidden="true"><i style="width:${tot?Math.round(done/tot*100):0}%"></i></span></div>`;

/* instant search: combobox + listbox, shared by home, tracker and the report form */
function findPlaces(q){q=q.trim().toLowerCase();if(!q)return [];
  return D.filter(r=>(r.name+" "+r.area+" "+r.city+" "+r.cat+" "+r.lic).toLowerCase().includes(q))
    .sort((a,b)=>(b.name.toLowerCase().startsWith(q)-a.name.toLowerCase().startsWith(q))||a.name.localeCompare(b.name));}
function attachSuggest(input,panel,{onPick,noResults}){
  const wrap=panel.parentNode,lb=panel.id+"-lb";let items=[],act=-1,open=false;
  input.setAttribute("role","combobox");input.setAttribute("aria-autocomplete","list");input.setAttribute("aria-expanded","false");input.setAttribute("aria-controls",lb);
  const close=()=>{open=false;panel.hidden=true;items=[];act=-1;input.setAttribute("aria-expanded","false");input.removeAttribute("aria-activedescendant")};
  const draw=()=>{
    const q=input.value.trim();if(!q){close();return}
    items=findPlaces(q).slice(0,6);act=-1;input.removeAttribute("aria-activedescendant");
    if(!items.length){input.setAttribute("aria-expanded","false");if(!noResults){close();return}panel.innerHTML=noResults(q);panel.hidden=false;open=true;return}
    panel.innerHTML=`<ul role="listbox" id="${lb}" aria-label="Matching restaurants">${items.map((r,i)=>`<li role="option" id="${lb}-${i}" data-sid="${r.id}" aria-selected="false"><span class="sg-main"><span class="sg-n">${esc(r.name)}</span><span class="sg-a">${esc(r.area)}, ${esc(r.city)} · ${esc(r.cat)}</span></span>${st(cur(r)[1])}</li>`).join("")}</ul>`;
    panel.hidden=false;open=true;input.setAttribute("aria-expanded","true");
  };
  const mark=()=>{panel.querySelectorAll("[role=option]").forEach((o,i)=>o.setAttribute("aria-selected",String(i===act)));
    if(act<0){input.removeAttribute("aria-activedescendant");return}
    const o=document.getElementById(lb+"-"+act);input.setAttribute("aria-activedescendant",o.id);o.scrollIntoView({block:"nearest"})};
  const pick=r=>{close();onPick(r)};
  input.addEventListener("input",draw);
  input.addEventListener("focus",()=>{if(input.value.trim()&&!open)draw()});
  input.addEventListener("keydown",e=>{
    if(e.key==="ArrowDown"){if(!open)draw();if(items.length){e.preventDefault();act=(act+1)%items.length;mark()}}
    else if(e.key==="ArrowUp"){if(items.length){e.preventDefault();act=act<=0?items.length-1:act-1;mark()}}
    else if(e.key==="Enter"){if(open&&act>=0){e.preventDefault();pick(items[act])}else close()}
    else if(e.key==="Escape"){if(open){e.preventDefault();close()}}
  });
  panel.addEventListener("mousedown",e=>{if(e.target.closest("[role=option]"))e.preventDefault()});
  panel.addEventListener("click",e=>{const o=e.target.closest("[data-sid]");if(o)pick(D.find(x=>x.id===+o.dataset.sid))});
  document.addEventListener("pointerdown",e=>{if(open&&!wrap.contains(e.target))close()});
  wrap.addEventListener("focusout",e=>{if(open&&e.relatedTarget&&!wrap.contains(e.relatedTarget))close()});
  return {close};
}
/* shown wherever a search finds nothing */
const noResHTML=q=>`<div class="nores"><p><b>Nothing on record for “${esc(q)}”.</b> This is not a guarantee of hygiene.</p>
  <div class="nores-acts"><button type="button" class="pillbtn sm" data-nr="report" data-q="${esc(q)}">Report a problem</button><button type="button" class="pillbtn out sm" data-nr="exists" aria-expanded="false">Tell us this place exists</button></div>
  <form class="nr-form" hidden><div><label>Name<input class="input" name="nm" required value="${esc(q)}"></label></div><div><label>Area<input class="input" name="ar" required placeholder="e.g. Dadar West"></label></div><div><button class="pillbtn sm" type="submit">Send</button></div></form></div>`;
document.addEventListener("click",e=>{
  const b=e.target.closest("[data-nr]");if(!b)return;
  if(b.dataset.nr==="report"){RP.open({name:b.dataset.q});return}
  const f=b.closest(".nores").querySelector(".nr-form");f.hidden=!f.hidden;b.setAttribute("aria-expanded",String(!f.hidden));if(!f.hidden)f.querySelector("[name=ar]").focus();
});
document.addEventListener("submit",e=>{const f=e.target.closest(".nr-form");if(!f)return;e.preventDefault();toast("Thanks, we'll check it");f.hidden=true;f.reset();const b=f.closest(".nores").querySelector('[data-nr="exists"]');if(b)b.setAttribute("aria-expanded","false")});
/* clipboard with a select-the-text fallback */
function copyText(text,okMsg,fallback){
  const fail=()=>{fallback();toast("Press copy to finish")};
  try{if(!navigator.clipboard||!navigator.clipboard.writeText)return fail();navigator.clipboard.writeText(text).then(()=>toast(okMsg),fail)}catch(_){fail()}
}
function selectNode(el){const s=getSelection(),g=document.createRange();g.selectNodeContents(el);s.removeAllRanges();s.addRange(g)}

/* home */
const cnt=t=>D.filter(r=>cur(r)[1]===t).length;
const everImp=D.filter(r=>r.hist.some(h=>h[1]==="imp")).length;
document.getElementById("numbers").innerHTML=[[D.length,"Food establishments tracked"],[everImp,"Improvement notices logged"],[cnt("sus"),"Licences suspended"],[new Set(D.map(r=>r.city)).size,"Cities and counting"]].map(([n,l])=>`<div><b>${n}</b><span>${l}</span></div>`).join("")+`<div class="smp">Prototype · counts from fictional sample records</div>`;
const latest=[...D].sort(byNew);
const tick=latest.slice(0,10).map(r=>{const c=cur(r);return `<span class="it"><span class="dot d-${c[1]}"></span><b>${esc(r.name)}</b><span>${c[1]==="ok"?"Cleared":TYPES[c[1]][0]}</span><span class="m">${esc(r.area)} · ${fmt(c[0])}</span></span>`}).join("");
document.getElementById("ticker").innerHTML=tick+tick;
document.getElementById("homeSearch").onsubmit=e=>{e.preventDefault();S.q=document.getElementById("homeQ").value;document.getElementById("q").value=S.q;go("tracker")};
attachSuggest(document.getElementById("homeQ"),document.getElementById("homeSug"),{onPick:r=>go("detail",r.id),noResults:noResHTML});
attachSuggest(document.getElementById("finalQ"),document.getElementById("finalSug"),{onPick:r=>go("detail",r.id),noResults:noResHTML});
document.querySelectorAll("[data-try]").forEach(b=>b.onclick=()=>{S.q=b.dataset.try;document.getElementById("q").value=S.q;go("tracker")});

/* tracker */
[...new Set(D.map(r=>r.city))].sort().forEach(c=>{const o=document.createElement("option");o.value=c;o.textContent=c;document.getElementById("city").append(o)});
const segDefs=[["","All"],["sus","Suspended"],["imp","Improvement notice"],["rev","Revoked"],["ok","Reinstated"]];
function renderSeg(){document.getElementById("seg").innerHTML=segDefs.map(([v,l])=>`<button data-v="${v}" aria-pressed="${S.type===v}">${l}</button>`).join("")}
document.getElementById("seg").onclick=e=>{const b=e.target.closest("button");if(!b)return;S.type=b.dataset.v;renderSeg();renderList()};
function renderList(){
  const q=S.q.trim().toLowerCase();
  let rows=D.filter(r=>(!q||(r.name+" "+r.area+" "+r.city+" "+r.cat+" "+r.lic).toLowerCase().includes(q))&&(!S.city||r.city===S.city)&&(!S.type||cur(r)[1]===S.type));
  rows.sort(S.sort==="new"?byNew:(a,b)=>-byNew(a,b));
  document.getElementById("count").textContent=`${rows.length} ${rows.length===1?"ENTRY":"ENTRIES"}`;
  document.getElementById("rows").innerHTML=rows.length?rows.map(rowHTML).join("")
    :q&&!findPlaces(q).length?`<div class="empty empty-nr">${noResHTML(S.q.trim())}</div>`
    :`<div class="empty"><h3 class="h-mid">Nothing found for “${esc(S.q||"this filter")}”.</h3><p>No reported FDA action. That's not a guarantee of hygiene. It just means nothing has been logged.</p></div>`;
}
bindRows(document.getElementById("rows"));
document.getElementById("q").oninput=e=>{S.q=e.target.value;renderList()};
attachSuggest(document.getElementById("q"),document.getElementById("qSug"),{onPick:r=>go("detail",r.id)});
document.getElementById("city").onchange=e=>{S.city=e.target.value;renderList()};
document.getElementById("sort").onchange=e=>{S.sort=e.target.value;renderList()};

/* detail (v2, superseded by renderDetail below) */
function renderDetailV2(id){
  const r=D.find(x=>x.id===id),c=cur(r);
  const stale=(TODAY-new Date(r.verified))/864e5>30;
  const f=S.follows.has(id);
  document.getElementById("detail").innerHTML=`
  <button class="back" id="back">← Back to tracker</button>
  <div class="dhead">
    <div>${st(c[1])}<h1 class="h-big" style="margin-top:16px">${esc(r.name)}</h1><div class="w">${esc(r.area)}, ${esc(r.city)} · ${esc(r.cat)}</div></div>
    <button class="pillbtn ${f?"out":""}" id="followBtn">${f?"✓ Following":"Follow for alerts"}</button>
  </div>
  <div class="dgrid">
    <div>
      <div class="facts">
        <div><div class="k">Status</div><div class="v">${TYPES[c[1]][0]} since ${fmt(c[0])}</div></div>
        <div><div class="k">FSSAI licence</div><div class="v" style="font-family:var(--mono)">${r.lic}</div></div>
        <div><div class="k">Last verified</div><div class="v">${fmt(r.verified)}${stale?"<br><span class='st st-imp' style='margin-top:6px'>Status unverified</span>":""}</div></div>
      </div>
      <h2 class="h-mid">History</h2>
      <ol class="tl">${[...r.hist].reverse().map(h=>`<li><span class="dot"></span><div><div class="dt">${fmt(h[0])}</div>${st(h[1])}<p>${esc(h[2])}</p></div></li>`).join("")}</ol>
    </div>
    <div class="side">
      <div><h3>Sources</h3><div class="srcl"><span>FDA Maharashtra press release <em>OFFICIAL · SAMPLE</em></span><span>Regional daily report <em>NEWS · SAMPLE</em></span></div><p class="muted" style="margin-top:10px">Live entries link to the original release and articles.</p></div>
      <div><h3>Something wrong here?</h3><p class="muted" style="margin:0 0 14px">Owners and readers can request a correction. We reply within 48 hours.</p>
        <form class="form" id="cform">
          <label for="c-role">You are</label><select class="input" id="c-role"><option>The business owner</option><option>A customer</option><option>Other</option></select>
          <label for="c-msg">What needs fixing</label><textarea class="input" id="c-msg" rows="3" required placeholder="e.g. Licence restored on 20 Sep, re-inspection order attached"></textarea>
          <div style="margin-top:8px"><button class="pillbtn" type="submit">Send correction request</button></div>
          <div id="cmsg" class="note" hidden></div>
        </form></div>
    </div>
  </div>`;
  document.getElementById("back").onclick=()=>go("tracker");
  document.getElementById("followBtn").onclick=()=>{
    if(!S.user){S.after={follow:id};toast("Log in with your number to get alerts");go("login");return}
    S.follows.has(id)?S.follows.delete(id):S.follows.add(id);
    toast(S.follows.has(id)?"Following. We'll WhatsApp you on any change.":"Unfollowed");renderDetail(id);
  };
  document.getElementById("cform").onsubmit=e=>{e.preventDefault();const m=document.getElementById("cmsg");m.textContent=`Received. Reference PW-${1000+id}. We'll review it within 48 hours.`;m.hidden=false;e.target.reset()};
}

/* report: every [data-bot] button opens the simulated WhatsApp chat */
const $=id=>document.getElementById(id);
document.addEventListener("click",e=>{const b=e.target.closest("[data-bot]");if(!b)return;e.preventDefault();RP.open(b.dataset.botRid?{rid:+b.dataset.botRid}:{})});
$("rfCopy").onclick=()=>{
  const mine=S.user?REPORTS.filter(x=>x.user===S.user.phone).sort((a,b)=>b.ts-a.ts)[0]:null;
  const t=RP.complaintText(mine||null);
  const ta=$("rfComplaint");ta.value=t;
  copyText(t,"Complaint copied",()=>{ta.hidden=false;ta.focus();ta.select()});
};
document.getElementById("copyg").onclick=()=>{const t=document.getElementById("gmail").textContent;navigator.clipboard?.writeText(t).then(()=>toast("Copied")).catch(()=>{const s=getSelection(),g=document.createRange();g.selectNodeContents(document.getElementById("gmail"));s.removeAllRanges();s.addRange(g);toast("Selected. Press copy.")})};

/* AUTH (simulated OTP) */
let phone="",code="",timer=null,left=0,attempts=0,consent=false;
function renderAuth(step){
  const P=document.getElementById("authPanel");clearInterval(timer);
  if(step==="phone"){
    const ok=v=>/^[6-9]\d{9}$/.test(v);
    P.innerHTML=`<div class="eyebrow">Step 1 of 2</div><h2 class="h-big" style="margin-top:12px">Your mobile number</h2>
    <p class="muted" style="margin-top:12px">We'll send a 6-digit code by SMS. Used only for alerts you choose.</p>
    <form id="pf"><div class="phonefield"><span>+91</span><input id="ph" inputmode="numeric" autocomplete="tel-national" maxlength="10" placeholder="98765 43210" aria-label="10-digit mobile number" value="${phone}"></div>
    <div id="perr"></div>
    <label class="check" style="margin-top:22px"><input type="checkbox" id="lconsent" ${consent?"checked":""}><span>PlateWatch stores my number only to send alerts I choose. I can delete it anytime.</span></label>
    <div class="row-actions"><button class="pillbtn" id="sendBtn" type="submit" ${ok(phone)&&consent?"":"disabled"}>Send code</button><span class="muted">Searching is free without an account.</span></div></form>`;
    const ph=document.getElementById("ph"),cb=document.getElementById("lconsent");ph.focus();
    const sync=()=>{document.getElementById("sendBtn").disabled=!(ok(ph.value)&&cb.checked)};
    ph.oninput=()=>{ph.value=ph.value.replace(/\D/g,"").slice(0,10);sync();document.getElementById("perr").innerHTML=""};
    cb.onchange=()=>{consent=cb.checked;sync()};
    document.getElementById("pf").onsubmit=e=>{e.preventDefault();if(!ok(ph.value)){document.getElementById("perr").innerHTML=`<div class="err">Enter a 10-digit Indian mobile number starting with 6, 7, 8 or 9.</div>`;return}if(!cb.checked)return;phone=ph.value;sendCode();renderAuth("otp")};
  }
  if(step==="otp"){
    P.innerHTML=`<div class="eyebrow">Step 2 of 2</div><h2 class="h-big" style="margin-top:12px">Enter the code</h2>
    <p class="muted" style="margin-top:12px">Sent to +91 ${phone.slice(0,5)} ${phone.slice(5)} · <button class="x" id="chg">Change number</button></p>
    <div class="demo">Demo: no SMS is sent. Your code is ${code}</div>
    <div class="otp" id="otp">${Array.from({length:6},(_,i)=>`<input inputmode="numeric" maxlength="1" aria-label="Digit ${i+1}" id="o${i}">`).join("")}</div>
    <div id="oerr"></div>
    <div class="row-actions"><button class="pillbtn" id="verBtn" disabled>Verify</button><button class="x" id="resend" disabled></button></div>`;
    const boxes=[...document.querySelectorAll("#otp input")];boxes[0].focus();
    const val=()=>boxes.map(b=>b.value).join("");
    const upd=()=>{document.getElementById("verBtn").disabled=val().length!==6;if(val().length===6)verify(val())};
    boxes.forEach((b,i)=>{
      b.oninput=()=>{b.value=b.value.replace(/\D/g,"").slice(-1);if(b.value&&i<5)boxes[i+1].focus();document.getElementById("oerr").innerHTML="";upd()};
      b.onkeydown=e=>{if(e.key==="Backspace"&&!b.value&&i>0)boxes[i-1].focus()};
      b.onpaste=e=>{e.preventDefault();const d=(e.clipboardData.getData("text")||"").replace(/\D/g,"").slice(0,6);d.split("").forEach((c,k)=>boxes[k].value=c);boxes[Math.min(d.length,5)].focus();upd()};
    });
    document.getElementById("verBtn").onclick=()=>verify(val());
    document.getElementById("chg").onclick=()=>renderAuth("phone");
    const rs=document.getElementById("resend");
    const tickR=()=>{left--;rs.textContent=left>0?`Resend in 0:${String(left).padStart(2,"0")}`:"Resend code";rs.disabled=left>0;if(left<=0)clearInterval(timer)};
    left=31;tickR();timer=setInterval(tickR,1000);
    rs.onclick=()=>{sendCode();attempts=0;renderAuth("otp");toast("New code sent")};
  }
}
/* no profile step: sign in, pre-fill the watched area from the place being followed, then return to where the user started */
function finishLogin(){
  const nx=S.after;S.after=null;
  S.user={phone,name:"",wa:true};RP.registerNumber(phone);
  if(nx&&nx.follow){const r=D.find(x=>x.id===nx.follow);if(r&&!S.areas.includes(r.area))S.areas.unshift(r.area)}
  syncAuthBtn();
  if(nx&&nx.follow){S.follows.add(nx.follow);toast("You're in. Following this place now.");go("detail",nx.follow)}
  else{toast("You're in. Alerts are on.");go("account")}
}
function sendCode(){code=String(Math.floor(100000+Math.random()*900000))}
function verify(v){
  if(v===code){finishLogin();return}
  attempts++;
  const e=document.getElementById("oerr");
  e.innerHTML=attempts>=3?`<div class="err">Too many wrong tries. Request a new code.</div>`:`<div class="err">That code doesn't match. ${3-attempts} ${3-attempts===1?"try":"tries"} left.</div>`;
  document.querySelectorAll("#otp input").forEach(b=>b.value="");document.getElementById("o0").focus();document.getElementById("verBtn").disabled=true;
  if(attempts>=3)document.querySelectorAll("#otp input").forEach(b=>b.disabled=true);
}

/* account */
function renderAccount(){
  document.getElementById("accPhone").textContent="Signed in · +91 "+S.user.phone.slice(0,5)+" "+S.user.phone.slice(5);
  document.getElementById("accHello").textContent=S.user.name?`${S.user.name}'s alerts`:"Your alerts";
  const fl=[...S.follows].map(id=>D.find(r=>r.id===id)).filter(Boolean);
  document.getElementById("followList").innerHTML=fl.length?fl.map(r=>`<div class="follow"><div><b>${esc(r.name)}</b><div class="muted">${esc(r.area)} · ${st(cur(r)[1])}</div></div><div style="display:flex;gap:14px"><button class="x" data-open="${r.id}">View</button><button class="x" data-unf="${r.id}">Unfollow</button></div></div>`).join(""):`<p class="muted" style="padding-top:14px">Not following anyone yet. Open any entry and tap "Follow for alerts".</p>`;
  document.getElementById("accName").value=S.user.name||"";
  document.getElementById("waToggle").checked=S.user.wa!==false;
  document.getElementById("waLabel").textContent=`Send alerts on WhatsApp to +91 ${S.user.phone.slice(0,5)} ${S.user.phone.slice(5)}`;
  const mine=REPORTS.filter(x=>x.user===S.user.phone).sort((a,b)=>b.id-a.id);
  document.getElementById("myReports").innerHTML=(mine.map(myReportHTML).join("")||`<p class="muted" style="padding-top:14px">No reports yet.</p>`)+`<p style="padding-top:14px"><button class="x" data-bot>${mine.length?"Open my WhatsApp chat":"Report a problem on WhatsApp"}</button></p>`;
  document.getElementById("areaList").innerHTML=S.areas.map((a,i)=>{const n=D.filter(r=>r.area.toLowerCase()===a.toLowerCase()).length;return `<div class="follow"><div><b>${esc(a)}</b><div class="muted">${n} logged ${n===1?"action":"actions"}</div></div><button class="x" data-rma="${i}">Remove</button></div>`}).join("")||`<p class="muted" style="padding-top:14px">No areas yet.</p>`;
}
document.getElementById("p-account").addEventListener("click",e=>{
  const o=e.target.closest("[data-open]"),u=e.target.closest("[data-unf]"),a=e.target.closest("[data-rma]");
  if(o)go("detail",+o.dataset.open);
  if(u){S.follows.delete(+u.dataset.unf);renderAccount();toast("Unfollowed")}
  if(a){S.areas.splice(+a.dataset.rma,1);renderAccount()}
});
/* what the reporter sees: Awaiting moderation → Accepted → Restaurant notified → Sent to FDA Maharashtra → Official action taken */
function myReportHTML(x){
  return `<div class="myrep"><div class="myrep-top"><b>${esc(RP.outletName(x))}</b><span class="myrep-ref">${esc(x.ref)}</span></div>
    <div class="muted">${esc(x.cat||"Report")} · ${fmt(x.date)} · Evidence: ${esc(RP.evidenceText(x))}</div>${RP.stagesHTML(x)}</div>`;
}
document.getElementById("nameForm").onsubmit=e=>{e.preventDefault();S.user.name=document.getElementById("accName").value.trim();renderAccount();toast("Saved")};
document.getElementById("waToggle").onchange=e=>{S.user.wa=e.target.checked;toast(e.target.checked?"WhatsApp alerts on":"WhatsApp alerts off")};
document.getElementById("areaForm").onsubmit=e=>{e.preventDefault();const v=document.getElementById("newArea").value.trim();if(v&&!S.areas.includes(v))S.areas.push(v);e.target.reset();renderAccount();toast("Watching "+v)};
document.getElementById("signout").onclick=()=>{S.user=null;consent=false;syncAuthBtn();toast("Signed out");go("home")};
document.getElementById("deldata").onclick=()=>document.getElementById("delconfirm").hidden=false;
document.getElementById("delno").onclick=()=>document.getElementById("delconfirm").hidden=true;
document.getElementById("delyes").onclick=()=>{S.user=null;consent=false;S.follows=new Set();S.areas=[];phone="";document.getElementById("delconfirm").hidden=true;syncAuthBtn();toast("Your data has been deleted");go("home")};

/* ================= V3: TWO-SIDED ================= */
const CATS=[
 {k:"kitchen",name:"Kitchen hygiene",expiry:30},
 {k:"storage",name:"Food storage",expiry:30},
 {k:"pest",name:"Pest control",expiry:90},
 {k:"personal",name:"Personal hygiene",expiry:60},
 {k:"clean",name:"Cleaning & sanitation",expiry:30},
 {k:"docs",name:"Documentation",expiry:365},
 {k:"ops",name:"Operational safety",expiry:30}];
const CAT=Object.fromEntries(CATS.map(c=>[c.k,c]));
const REQS=[
 ["k1","kitchen","Food preparation areas are clean",2,0],
 ["k2","kitchen","Food-contact surfaces are cleaned and sanitised",3,1],
 ["k3","kitchen","Floors, walls and ceilings are maintained",1,0],
 ["k4","kitchen","Waste goes into covered bins, removed daily",2,0],
 ["s1","storage","Raw and cooked food are stored separately",3,1],
 ["s2","storage","Food containers are covered",2,0],
 ["s3","storage","Chilled food is kept at 5°C or below",3,1],
 ["s4","storage","Prepared food is labelled with date",1,0],
 ["p1","pest","No visible pest activity in food areas",3,1],
 ["p2","pest","Pest-control contract is in place",2,0],
 ["p3","pest","Pest-control treatment records are available",2,0],
 ["p4","pest","Drains and entry points are screened",1,0],
 ["h1","personal","Handwash station with soap at the prep area",3,1],
 ["h2","personal","Staff wear caps and aprons while cooking",1,0],
 ["h3","personal","Food handlers have medical fitness certificates",2,0],
 ["h4","personal","A FoSTaC-trained food safety supervisor is on staff",2,0],
 ["c1","clean","A written cleaning schedule is followed",1,0],
 ["c2","clean","Cleaning chemicals are stored away from food",2,0],
 ["c3","clean","Equipment is sanitised daily",2,0],
 ["c4","clean","Toilets and wash areas are maintained",1,0],
 ["d1","docs","Valid FSSAI licence is displayed",3,1],
 ["d2","docs","Water potability test report (under 6 months old)",2,0],
 ["d3","docs","Cleaning logs are kept",1,0],
 ["o1","ops","Cold-holding temperatures are logged",2,0],
 ["o2","ops","Stock is checked for expiry dates",2,0],
 ["o3","ops","Veg and non-veg prep are kept apart",2,0],
 ["o4","ops","Supplier bills and records are kept",1,0]
].map(([id,cat,text,w,crit])=>({id,cat,text,w,crit:!!crit}));
const REQ=Object.fromEntries(REQS.map(r=>[r.id,r]));
const daysAgo=d=>Math.round((TODAY-new Date(d))/864e5);
const dISO=n=>{const t=new Date(TODAY);t.setDate(t.getDate()-n);return t.toISOString().slice(0,10)};
const ago=d=>{const n=daysAgo(d);return n<=0?"today":n===1?"yesterday":n+" days ago"};
let EVID=1;
const AI={
 s1:["✓ Separate shelves visible for raw and cooked items","✓ Containers appear labelled","⚠ One container on the top shelf may be uncovered"],
 s2:["✓ Lidded containers detected","⚠ Tray at left edge appears uncovered"],
 p1:["✓ No droppings or insects visible in frame","⚠ Floor corner is dark, reviewer should confirm"],
 h1:["✓ Handwash basin and soap dispenser visible","✓ Paper towels present"],
 k2:["✓ Steel surfaces appear clean","⚠ Cutting board surface shows wear marks"],
 d1:["✓ Document resembles an FSSAI licence","⚠ Licence number and expiry must be checked by a reviewer"]};
function aiFor(reqId){return AI[reqId]||["✓ Area in frame appears clean","⚠ Image partly out of focus, reviewer should confirm"]}
function mkEv(req,ago,status,type){const t=type||(req[0]==="d"||req==="p3"||req==="h3"?"document":"photo");return {id:EVID++,name:(t==="document"?REQ[req].text.split(" ").slice(0,3).join("-").toLowerCase()+".pdf":"kitchen-"+req+".jpg"),type:t,date:dISO(ago),status:status||"verified",note:"",url:null,ai:t==="photo"?aiFor(req):null}}

/* seed profiles (fictional) */
const PROF={};
(function(){
  const g={owner:"98200 11223",level:"platform",verifiedOn:"2026-09-12",adminNote:"",resp:{},ev:{},
    journey:[{m:"Jul 2026",score:61,kind:"Issues found",notes:["Pest-control records missing","Raw and cooked food shared a shelf","Staff training documents missing"]},
             {m:"Aug 2026",score:84,kind:"Issues resolved",notes:["Pest-control contract and records uploaded","New separate storage shelving photographed"]}]};
  const ages={kitchen:3,storage:8,pest:43,personal:10,clean:5,docs:20,ops:6};
  REQS.forEach(r=>{g.resp[r.id]="yes";g.ev[r.id]=[mkEv(r.id,ages[r.cat])]});
  g.resp.o4="no";g.ev.o4=[];
  g.ev.h3=[mkEv("h3",70)];
  g.ev.d2=[mkEv("d2",40)];
  PROF[3]=g;
  const b={owner:"98191 44556",level:"self",verifiedOn:null,adminNote:"",resp:{},ev:{},
    journey:[{m:"Aug 2026",score:72,kind:"First checkup",notes:["Pest-control records missing","Water test report missing"]}]};
  REQS.forEach((r,i)=>{b.resp[r.id]="yes";b.ev[r.id]=[mkEv(r.id,2+(i%12),"submitted")]});
  b.resp.p3="no";b.ev.p3=[];b.resp.d2="no";b.ev.d2=[];b.resp.o4="na";b.ev.o4=[];
  PROF[13]=b;
})();
let REPORTS=[
 {id:1,rid:3,text:"Saw a cockroach near the tandoor area during dinner.",date:"2026-07-14",status:"resolved",photo:true,flag:false,response:{text:"Full pest-control treatment done on 18 July and a monthly contract signed. Certificate uploaded to our profile.",date:"2026-07-19",ev:"pest-control-certificate.pdf"}},
 {id:2,rid:3,text:"Drinking water served at the table tasted odd.",date:"2026-09-21",status:"pending",photo:false,flag:false,response:null},
 {id:3,rid:13,text:"Bao was cold in the middle and seemed reheated.",date:"2026-09-15",status:"review",photo:true,flag:false,response:null},
 {id:4,rid:7,text:"Water logging near the kitchen's back entrance.",date:"2026-09-18",status:"verified",photo:true,flag:false,response:null}
];
let RID=5;
const RS={pending:"Awaiting moderation",accepted:"Moderated",rejected:"Not used",review:"Under review",verified:"Verified · unresolved",resolved:"Resolved",dismissed:"Not substantiated"};
const rsPill=s=>`<span class="rs rs-${s}">${RS[s]}</span>`;
const LV={self:"Self-reported",pending:"Verification requested",platform:"Platform verified"};
const lvl=l=>`<span class="lvl lvl-${l}">${LV[l]}</span>`;
S.owner=null;S.openCats=new Set(["kitchen"]);S.claim=null;
function loginAs(ph){if(S.user&&S.user.phone===ph)return;S.user={phone:ph,name:"",wa:true};syncAuthBtn()}
/* refresh whichever page shows report state after the chat or a moderator changes it */
function refreshReports(){if(!document.getElementById("p-account").hidden&&S.user)renderAccount();if(!document.getElementById("p-admin").hidden)renderAdmin(S.admTab||"reports");if(!document.getElementById("p-detail").hidden&&S.page.p==="detail")renderDetail(S.page.arg);if(!document.getElementById("p-dash").hidden&&S.owner!=null)renderDash(S.dashTab||"overview")}
const RP=createReporting({D,REPORTS,S,esc,fmt,st,cur,toast,findPlaces,copyText,selectNode,TODAY,newId:()=>RID++,loginAs,onChange:refreshReports});

function currentEv(rid,reqId){const p=PROF[rid];const c=CAT[REQ[reqId].cat];return (p.ev[reqId]||[]).filter(e=>e.status!=="rejected"&&daysAgo(e.date)<=c.expiry)}
function scoreOf(rid){
  const p=PROF[rid];let W=0,E=0,done=0,tot=0,unanswered=0;const cats={},crit=[],missing=[];
  CATS.forEach(c=>cats[c.k]={W:0,E:0,done:0,tot:0});
  REQS.forEach(r=>{const a=p.resp[r.id];if(a==="na")return;
    tot++;W+=r.w;cats[r.cat].W+=r.w;cats[r.cat].tot++;
    if(!a)unanswered++;
    const ok=a==="yes"&&currentEv(rid,r.id).length>0;
    if(ok){done++;E+=r.w;cats[r.cat].E+=r.w;cats[r.cat].done++}
    else{missing.push({r,why:!a?"Not answered":a==="no"?"Answered no":(p.ev[r.id]||[]).some(e=>e.status!=="rejected")?"Evidence expired":"Evidence needed"});if(r.crit)crit.push(r)}
  });
  CATS.forEach(c=>{const x=cats[c.k];x.pct=x.W?Math.round(x.E/x.W*100):null});
  return {overall:W?Math.round(E/W*100):0,done,tot,cats,crit,missing,unanswered};
}
function grade(s){return s>=90?"Strong":s>=75?"Good":s>=60?"Needs work":"Incomplete"}
function fresh(rid,catK){
  const p=PROF[rid];const all=REQS.filter(r=>r.cat===catK).flatMap(r=>(p.ev[r.id]||[]).filter(e=>e.status!=="rejected"));
  if(!all.length)return {st:"none",txt:"No evidence"};
  const latest=all.map(e=>e.date).sort().pop();const n=daysAgo(latest),x=CAT[catK].expiry;
  const stale=REQS.filter(r=>r.cat===catK&&p.resp[r.id]==="yes"&&(p.ev[r.id]||[]).length&&!currentEv(rid,r.id).length).length;
  if(stale)return {st:"expired",txt:stale+" item"+(stale>1?"s":"")+" expired"};
  return {st:n<=x/2?"fresh":"aging",txt:"Updated "+ago(latest)};
}
function evCounts(rid){const p=PROF[rid];const c={photo:0,video:0,document:0};let last=null;Object.values(p.ev).flat().forEach(e=>{if(e.status==="rejected")return;c[e.type]=(c[e.type]||0)+1;if(!last||e.date>last)last=e.date});return {...c,total:c.photo+c.video+c.document,last}}
function lastUpdated(rid){const e=evCounts(rid).last;return e?fmt(e):"—"}
function barsHTML(sc){return `<div class="bars">${CATS.map(c=>{const x=sc.cats[c.k];return x.pct==null?"":`<div class="bar"><span>${c.name}</span><span class="t"><i style="width:${x.pct}%"></i></span><span class="p">${x.pct}%</span></div>`}).join("")}</div>`}
function freshHTML(rid){return `<div class="fr">${CATS.map(c=>{const f=fresh(rid,c.k);return `<div><span class="fd fd-${f.st}"></span>${c.name}<span class="s">${f.txt}</span></div>`}).join("")}</div>`}
function journeySVG(rid,hideNow){
  const p=PROF[rid];const pts=[...p.journey.map(j=>({m:j.m.split(" ")[0],s:j.score})),...(hideNow?[]:[{m:"Now",s:scoreOf(rid).overall}])];
  if(!pts.length)return "";
  const W=620,H=220,L=40,R=24,T=26,B=34,iw=W-L-R,ih=H-T-B;
  const x=i=>L+(pts.length===1?iw/2:i*iw/(pts.length-1)),y=s=>T+(1-s/100)*ih;
  const grid=[25,50,75,100].map(v=>`<line x1="${L}" x2="${W-R}" y1="${y(v)}" y2="${y(v)}" stroke="#E4E4E4"/><text x="${L-10}" y="${y(v)+4}" text-anchor="end" font-family="Geist Mono, monospace" font-size="11" fill="#6B6B6B">${v}</text>`).join("");
  const path=pts.map((q,i)=>(i?"L":"M")+x(i)+" "+y(q.s)).join(" ");
  const dots=pts.map((q,i)=>`<circle cx="${x(i)}" cy="${y(q.s)}" r="${i===pts.length-1?6:4.5}" fill="${i===pts.length-1?"#FFFFFF":"#0A0A0A"}" stroke="#0A0A0A" stroke-width="2"/><text x="${x(i)}" y="${y(q.s)-12}" text-anchor="middle" font-family="Archivo, sans-serif" font-weight="800" font-size="15" fill="#0A0A0A">${q.s}</text><text x="${x(i)}" y="${H-10}" text-anchor="middle" font-family="Geist Mono, monospace" font-size="11" fill="#6B6B6B">${q.m.toUpperCase()}</text>`).join("");
  return `<svg class="jchart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Compliance score over time: ${pts.map(q=>q.m+" "+q.s).join(", ")}">${grid}<path d="${path}" fill="none" stroke="#0A0A0A" stroke-width="2"/>${dots}</svg>`;
}
function journeyList(rid,hideNow){const p=PROF[rid];const sc=scoreOf(rid);
  return `<div class="jlist">${p.journey.map(j=>`<div><span class="eyebrow">${j.m}</span><b>${j.score}</b><div><span style="font-size:13px;font-weight:500">${j.kind}</span><ul>${j.notes.map(n=>`<li>${esc(n)}</li>`).join("")}</ul></div></div>`).join("")}
  ${hideNow?`<div><span class="eyebrow">Now</span><b>—</b><div><span style="font-size:13px;font-weight:500">Score paused while an official action is open</span></div></div></div>`:`<div><span class="eyebrow">Now</span><b>${sc.overall}</b><div><span style="font-size:13px;font-weight:500">${sc.missing.length?sc.missing.length+" requirement"+(sc.missing.length>1?"s":"")+" open":"All requirements met"}</span></div></div></div>`}`}

/* ---------- PUBLIC PROFILE ---------- */
function renderDetail(id){
  const r=D.find(x=>x.id===id),c=cur(r),p=PROF[id];
  const stale=(TODAY-new Date(r.verified))/864e5>30;
  const f=S.follows.has(id);
  const lic=c[1]==="sus"?"Suspended":c[1]==="rev"?"Revoked":"Active (as of last check)";
  const enf=c[1]==="sus"||c[1]==="rev"||c[1]==="imp"?TYPES[c[1]][0]+" since "+fmt(c[0]):"No current action listed";
  const reps=REPORTS.filter(x=>x.rid===id);
  const shown=reps.filter(RP.visibleToRestaurant);
  const waiting=reps.filter(x=>x.status==="pending"&&x.share!==false).length;
  const openIssues=reps.filter(x=>x.status==="verified").length;
  let comp="";
  if(p){const sc=scoreOf(id),ec=evCounts(id),pz=paused(id);
    comp=`<div class="lane">
      <span class="tag ${p.level==="platform"?"tag-plat":"tag-self"}">${p.level==="platform"?"Platform verified · reviewed "+fmt(p.verifiedOn):"Restaurant-submitted · not yet verified"}</span>
      <h2 class="h-mid">Food Safety Compliance</h2>
      <div class="scorewrap">${pubScore(id,sc.overall)}
        <dl class="scoremeta">${pz?"":`<dt>Rating</dt><dd>${grade(sc.overall)}</dd>`}<dt>Requirements met</dt><dd>${sc.done} / ${sc.tot}</dd><dt>Last updated</dt><dd>${lastUpdated(id)}</dd><dt>Level</dt><dd>${LV[p.level]}</dd></dl></div>
      ${sc.crit.length?`<div class="crit"><b class="m">!</b><div><b>Critical requirement${sc.crit.length>1?"s":""} need${sc.crit.length>1?"":"s"} attention</b><br>${sc.crit.map(q=>esc(q.text)).join("; ")}</div></div>`:""}
      ${barsHTML(sc)}
      <h3 style="font-size:17px;margin-top:30px">Evidence freshness</h3>${freshHTML(id)}
      <div class="evc"><span><b>${ec.total}</b> pieces of evidence</span><span><b>${ec.photo}</b> photos</span><span><b>${ec.video}</b> videos</span><span><b>${ec.document}</b> documents</span><span>Last upload ${ec.last?ago(ec.last):"—"}</span></div>
      <p class="disc">PlateWatch's own score, calculated from the restaurant's evidence against ${REQS.length} food-safety requirements. It is not an FSSAI hygiene rating or a government certificate.</p>
    </div>
    <div class="lane"><span class="tag tag-self">Restaurant-submitted · scored by PlateWatch</span><h2 class="h-mid">Compliance journey</h2>${journeySVG(id,pz)}${journeyList(id,pz)}</div>`;
  } else {
    comp=`<div class="lane"><span class="tag tag-self">Restaurant-submitted</span><div class="claimbox"><div><h2 class="h-mid">No compliance profile yet</h2><p class="muted" style="margin:6px 0 0">This restaurant hasn't claimed its page or submitted evidence.</p></div><button class="pillbtn out" id="claimThis">Own this place? Claim it</button></div></div>`;
  }
  const bt=backTarget(id),sum=summaryLine(r);
  const url=location.origin+location.pathname+"#profile-"+id;
  const wa="https://wa.me/?text="+encodeURIComponent(sum+" Check before you go: "+url);
  document.getElementById("detail").innerHTML=`
  <button class="back" id="back">← Back to ${esc(pageName(bt))}</button>
  <div class="sumline">${st(c[1])}<p class="sumline-t">${esc(sum)}</p></div>
  <div class="dhead">
    <div>${p?lvl(p.level):""}<h1 class="h-big"${p?' style="margin-top:16px"':""}>${esc(r.name)}</h1><div class="w">${esc(r.area)}, ${esc(r.city)} · ${esc(r.cat)}</div></div>
    <div class="sharebar">
      <div class="sharebar-btns"><button class="pillbtn ${f?"out":""}" id="followBtn">${f?"✓ Following":"Follow for alerts"}</button><a class="pillbtn out" id="shareWa" href="${esc(wa)}" target="_blank" rel="noopener">Share on WhatsApp</a><button class="pillbtn out" id="copyLink" type="button">Copy link</button></div>
      <span class="shareurl" id="profUrl">${esc(url)}</span>
    </div>
  </div>
  <div class="legend"><span class="tag tag-off">Official record</span><span class="tag tag-self">Restaurant-submitted</span><span class="tag tag-plat">Platform verified</span><span class="tag tag-com">Community report</span></div>
  <div class="dgrid" style="padding-top:0">
    <div>
      <div class="lane">
        <span class="tag tag-off">Official record · from FDA / FSSAI sources</span>
        <h2 class="h-mid">Official status</h2>
        <div class="facts" style="margin-top:18px">
          <div><div class="k">FSSAI licence</div><div class="v">${lic}</div><div class="muted" style="font-family:var(--mono);font-size:12px;margin-top:2px">${r.lic}</div></div>
          <div><div class="k">Government enforcement</div><div class="v">${enf}</div></div>
          <div><div class="k">FSSAI hygiene rating</div><div class="v">No official rating on record</div></div>
        </div>
        <div class="muted" style="margin:-20px 0 22px;font-size:13px">Last verified ${fmt(r.verified)}${stale?" · <span class='st st-imp'>Status unverified</span>":""}</div>
        <h3 style="font-size:17px">Regulatory history</h3>
        <ol class="tl">${[...r.hist].reverse().map(h=>`<li><span class="dot"></span><div><div class="dt">${fmt(h[0])}</div>${st(h[1])}<p>${esc(h[2])}</p></div></li>`).join("")}</ol>
      </div>
      ${comp}
      <div class="lane">
        <span class="tag tag-com">Community reports · moderated, not independently verified unless marked</span>
        <h2 class="h-mid">Community reports</h2>
        <div class="evc" style="margin-bottom:10px"><span><b>${shown.length}</b> published</span><span><b>${openIssues}</b> verified unresolved safety issue${openIssues===1?"":"s"}</span>${waiting?`<span><b>${waiting}</b> awaiting moderation (not shown)</span>`:""}</div>
        ${shown.map(x=>`<div class="rep"><div class="top">${rsPill(x.status)}<span>${fmt(x.date)}</span>${x.photo?"<span>Photo attached</span>":""}</div><p>${esc(x.text)}</p>
          ${x.response?`<div class="resp"><span class="tag tag-self">Restaurant response · ${fmt(x.response.date)}</span><div>${esc(x.response.text)}</div>${x.response.ev?`<div class="muted" style="font-size:12px;margin-top:4px">Evidence: ${esc(x.response.ev)}</div>`:""}</div>`:""}</div>`).join("")||`<p class="muted">No published reports.</p>`}
        <div style="margin-top:20px"><button class="pillbtn out" type="button" data-bot data-bot-rid="${id}">Report a food-safety problem here</button></div>
      </div>
    </div>
    <div class="side" style="padding-top:34px">
      <div><h3>Sources</h3><div class="srcl"><span>FDA Maharashtra press release <em>OFFICIAL · SAMPLE</em></span><span>Regional daily report <em>NEWS · SAMPLE</em></span></div><p class="muted" style="margin-top:10px">Live entries link to the original release and articles.</p></div>
      <div><h3>Something wrong here?</h3><p class="muted" style="margin:0 0 14px">Owners and readers can request a correction. We reply within 48 hours.</p>
        <form class="form" id="cform">
          <label for="c-role">You are</label><select class="input" id="c-role"><option>The business owner</option><option>A customer</option><option>Other</option></select>
          <label for="c-msg">What needs fixing</label><textarea class="input" id="c-msg" rows="3" required placeholder="e.g. Licence restored on 20 Sep, re-inspection order attached"></textarea>
          <div style="margin-top:8px"><button class="pillbtn" type="submit">Send correction request</button></div>
          <div id="cmsg" class="note" hidden></div>
        </form></div>
    </div>
  </div>`;
  document.getElementById("back").onclick=()=>go(bt.p,bt.arg);
  document.getElementById("copyLink").onclick=()=>copyText(url,"Link copied",()=>selectNode(document.getElementById("profUrl")));
  document.getElementById("followBtn").onclick=()=>{
    if(!S.user){S.after={follow:id};toast("Log in with your number to get alerts");go("login");return}
    S.follows.has(id)?S.follows.delete(id):S.follows.add(id);
    toast(S.follows.has(id)?"Following. We'll WhatsApp you on any change.":"Unfollowed");renderDetail(id);
  };
  const ct=document.getElementById("claimThis");if(ct)ct.onclick=()=>{go("biz",id)};
  document.getElementById("cform").onsubmit=e=>{e.preventDefault();const m=document.getElementById("cmsg");m.textContent=`Received. Reference PW-${1000+id}. We'll review it within 48 hours.`;m.hidden=false;e.target.reset()};
}

/* ---------- BUSINESS: find + claim ---------- */
function renderBiz(preId){
  const bq=document.getElementById("bq");
  const draw=()=>{const q=bq.value.trim().toLowerCase();
    const list=D.filter(r=>!q||(r.name+" "+r.area+" "+r.city).toLowerCase().includes(q)).slice(0,8);
    document.getElementById("claimres").innerHTML=list.map(r=>`<div class="cr"><div><b>${esc(r.name)}</b><div class="muted">${esc(r.area)}, ${esc(r.city)} ${PROF[r.id]?" · "+LV[PROF[r.id].level]:""}</div></div><button class="pillbtn ${PROF[r.id]?"out":""} sm" data-claim="${r.id}">${PROF[r.id]?"Owner log in":"Claim"}</button></div>`).join("")||`<p class="muted" style="padding-top:14px">Not listed? In the live product you can add your restaurant with its FSSAI licence.</p>`};
  bq.oninput=draw;
  if(preId){const r=D.find(x=>x.id===preId);bq.value=r.name}
  draw();
  document.getElementById("claimpanel").hidden=true;
  if(S.owner!=null){document.getElementById("claimres").insertAdjacentHTML("beforebegin","")}
  if(preId)startClaim(preId);
}
document.getElementById("claimres").onclick=e=>{const b=e.target.closest("[data-claim]");if(b)startClaim(+b.dataset.claim)};
function startClaim(rid){
  const r=D.find(x=>x.id===rid);const P=document.getElementById("claimpanel");P.hidden=false;const existing=!!PROF[rid];
  let ocode="";
  P.innerHTML=`<div class="eyebrow">${existing?"Owner log in":"Claim"} · step 1 of 2</div><h2 class="h-mid" style="margin-top:10px">${esc(r.name)}</h2>
   <p class="muted" style="margin-top:8px">Enter the FSSAI licence number on your licence and the owner's mobile. We'll send a code to confirm.</p>
   <form class="form" id="clf" style="margin-top:14px">
     <label for="cl-lic">FSSAI licence number</label><input class="input" id="cl-lic" inputmode="numeric" maxlength="14" required placeholder="14 digits" style="font-family:var(--mono)">
     <label for="cl-ph">Owner's mobile</label><input class="input" id="cl-ph" inputmode="numeric" maxlength="10" required placeholder="10 digits" style="font-family:var(--mono)" value="${existing?PROF[rid].owner.replace(/\s/g,""):""}">
     <div class="demo">Demo: licence number is ${r.lic}</div>
     <div id="clerr"></div>
     <div><button class="pillbtn" type="submit">Send code</button></div></form>`;
  P.scrollIntoView({behavior:"smooth",block:"start"});
  document.getElementById("clf").onsubmit=e=>{e.preventDefault();
    const lic=document.getElementById("cl-lic").value.replace(/\D/g,""),ph=document.getElementById("cl-ph").value.replace(/\D/g,"");
    const err=document.getElementById("clerr");
    if(lic!==r.lic){err.innerHTML=`<div class="err">That licence number doesn't match our records for this restaurant.</div>`;return}
    if(!/^[6-9]\d{9}$/.test(ph)){err.innerHTML=`<div class="err">Enter a 10-digit mobile number starting with 6–9.</div>`;return}
    ocode=String(Math.floor(100000+Math.random()*900000));
    P.innerHTML=`<div class="eyebrow">Step 2 of 2</div><h2 class="h-mid" style="margin-top:10px">Enter the code</h2><p class="muted" style="margin-top:8px">Sent to +91 ${ph.slice(0,5)} ${ph.slice(5)}</p>
     <div class="demo">Demo: your code is ${ocode}</div>
     <form id="clo" style="margin-top:6px"><div class="phonefield"><input id="cl-otp" inputmode="numeric" maxlength="6" placeholder="••••••" aria-label="6-digit code" autocomplete="one-time-code"></div><div id="cloerr"></div><div class="row-actions"><button class="pillbtn" type="submit">Verify and continue</button></div></form>`;
    document.getElementById("cl-otp").focus();
    document.getElementById("clo").onsubmit=ev=>{ev.preventDefault();
      if(document.getElementById("cl-otp").value.trim()!==ocode){document.getElementById("cloerr").innerHTML=`<div class="err">That code doesn't match. Check the demo code above.</div>`;return}
      if(!PROF[rid])PROF[rid]={owner:ph.slice(0,5)+" "+ph.slice(5),level:"self",verifiedOn:null,adminNote:"",resp:{},ev:{},journey:[]};
      S.owner=rid;S.openCats=new Set([CATS[0].k]);toast(existing?"Welcome back":"Restaurant claimed. Start your checkup.");go("dash",existing?"overview":"checkup");
    };
  };
}

/* ---------- DASHBOARD ---------- */
function notifs(rid){const p=PROF[rid],out=[];
  REPORTS.filter(x=>x.rid===rid&&RP.visibleToRestaurant(x)&&!x.response&&x.status!=="resolved").forEach(x=>out.push(`New food-safety report received (${fmt(x.date)}). <button class="x" data-tab="reports">Respond</button>`));
  Object.values(p.ev).flat().filter(e=>e.status==="more").forEach(e=>out.push(`Reviewer asked for more evidence: ${esc(e.name)}. <button class="x" data-tab="checkup">Open checkup</button>`));
  Object.values(p.ev).flat().filter(e=>e.status==="rejected").forEach(e=>out.push(`Evidence rejected: ${esc(e.name)}. Upload a clearer file.`));
  if(p.adminNote)out.push(esc(p.adminNote));
  return out;
}
/* the 3 highest-impact open items: critical first, then highest weight, then expired evidence */
function nextBest(sc){
  return [...sc.missing].sort((a,b)=>(b.r.crit-a.r.crit)||(b.r.w-a.r.w)||((b.why==="Evidence expired")-(a.why==="Evidence expired"))).slice(0,3);
}
function nextBestHTML(sc){
  const top=nextBest(sc);if(!top.length)return "";
  return `<div class="nba"><div class="nba-h"><h3>Do these next</h3><span class="muted">Highest impact on your score</span></div>
    <ol>${top.map(m=>`<li><div class="nba-t"><span>${esc(m.r.text)}</span><span class="nba-m">${m.r.crit?"<b>Critical</b> · ":""}Weight ${m.r.w} · ${CAT[m.r.cat].name} · ${m.why}</span></div><button class="pillbtn out sm" data-jump="${m.r.id}">Fix this</button></li>`).join("")}</ol></div>`;
}
function renderDash(tab){
  const rid=S.owner,r=D.find(x=>x.id===rid),p=PROF[rid],sc=scoreOf(rid),ec=evCounts(rid);
  const nrep=REPORTS.filter(x=>x.rid===rid&&RP.visibleToRestaurant(x)&&!x.response&&x.status!=="resolved").length;
  const tabs=[["overview","Overview"],["checkup","Food Safety Checkup"],["reports","Reports"+(nrep?`<span class="n">${nrep}</span>`:"")],["journey","Journey"],["qr","QR code"]];
  let body="";
  if(tab==="overview"){
    const ns=notifs(rid);
    const canReq=p.level==="self"&&sc.unanswered===0;
    body=`<div style="padding-top:30px">${nextBestHTML(sc)}</div><div class="ov" style="padding-top:26px"><div>
      <span class="tag tag-self">Your Food Safety Compliance</span>
      <div class="scorewrap"><div><div class="score">${sc.overall}<small>/100</small></div>${paused(rid)?`<p class="pz-own">Paused publicly until the official action is closed.</p>`:""}</div><dl class="scoremeta"><dt>Rating</dt><dd>${grade(sc.overall)}</dd><dt>Last updated</dt><dd>${lastUpdated(rid)}</dd><dt>Verification</dt><dd>${LV[p.level]}</dd></dl></div>
      ${progHTML(sc.done,sc.tot)}
      ${sc.crit.length?`<div class="crit"><b class="m">!</b><div><b>Critical requirement${sc.crit.length>1?"s":""} need attention</b><br>${sc.crit.map(q=>esc(q.text)).join("; ")}<br><button data-tab="checkup">Fix in checkup</button></div></div>`:""}
      <div class="kpis"><div><b>${sc.done}/${sc.tot}</b><span>Requirements met</span></div><div><b>${ec.total}</b><span>Evidence submitted</span></div><div><b>${sc.missing.length}</b><span>Need attention</span></div></div>
      ${barsHTML(sc)}
      <p class="disc">Score = weighted share of applicable requirements answered "yes" with current, non-rejected evidence. Critical items are flagged separately, however high the score.</p>
      <h3 style="font-size:17px;margin-top:30px">Evidence freshness</h3>${freshHTML(rid)}
    </div><div>
      <h3 style="font-size:20px;font-weight:700;font-stretch:108%;margin-bottom:12px">Verification</h3>
      <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center">${lvl(p.level)}
        ${p.level==="self"?`<button class="pillbtn sm" id="reqVer" ${canReq?"":"disabled"}>Request verification</button>`:""}
        ${p.level==="platform"?`<span class="muted">Reviewed ${fmt(p.verifiedOn)}</span>`:""}</div>
      ${p.level==="self"&&!canReq?`<p class="muted" style="margin-top:8px">Answer all requirements first (${sc.unanswered} left).</p>`:""}
      ${p.level==="pending"?`<p class="muted" style="margin-top:8px">Our team is reviewing your evidence. Usually 2–3 working days.</p>`:""}
      <h3 style="font-size:20px;font-weight:700;font-stretch:108%;margin:34px 0 12px">Notifications</h3>
      <div class="notif">${ns.map(n=>`<div><span>${n}</span></div>`).join("")||`<p class="muted" style="padding-top:12px">Nothing new.</p>`}</div>
      <h3 style="font-size:20px;font-weight:700;font-stretch:108%;margin:34px 0 12px">Needs attention</h3>
      <div class="miss">${sc.missing.slice(0,8).map(m=>`<button data-jump="${m.r.id}"><span>${m.r.crit?"<b>Critical · </b>":""}${esc(m.r.text)}</span><em>${m.why.toUpperCase()}</em></button>`).join("")||`<p class="muted" style="padding-top:12px">All requirements met.</p>`}</div>
    </div></div>`;
  }
  if(tab==="checkup"){
    body=`<div class="stick"><span>Score now <b>${sc.overall}/100</b>${paused(rid)?" (paused publicly)":""} · ${sc.done}/${sc.tot} met${sc.unanswered?` · ${sc.unanswered} unanswered`:""}</span><span class="muted" style="font-size:13px">Based on public FSSAI hygiene parameters. Not an official FSSAI audit.</span></div>
    <div style="padding-top:24px">${nextBestHTML(sc)}${progHTML(sc.done,sc.tot)}</div>
    ${CATS.map(c=>{const reqs=REQS.filter(q=>q.cat===c.k);const x=sc.cats[c.k];return `<details class="cat" data-cat="${c.k}" ${S.openCats.has(c.k)?"open":""}><summary><h3>${c.name}</h3><span class="catprog"><span class="prog-t" aria-hidden="true"><i style="width:${x.tot?Math.round(x.done/x.tot*100):0}%"></i></span><span>${x.done} of ${x.tot}</span></span><span class="p">${x.pct==null?"N/A":x.pct+"%"} · evidence valid ${c.expiry} days</span><span class="ch" aria-hidden="true">+</span></summary>
      ${reqs.map(q=>{const a=p.resp[q.id];const evs=p.ev[q.id]||[];return `<div class="req" id="req-${q.id}">
        <div><div class="q">${esc(q.text)}</div><div class="qm">${q.crit?'<span class="c">■ Critical</span>':""}<span>Weight ${q.w}</span>${a==="yes"&&!currentEv(rid,q.id).length?"<span class='c'>Evidence needed</span>":""}</div></div>
        <div class="ans" role="group" aria-label="Answer">${["yes","no","na"].map(v=>`<button data-ans="${v}" data-q="${q.id}" aria-pressed="${a===v}">${v==="na"?"N/A":v[0].toUpperCase()+v.slice(1)}</button>`).join("")}</div>
        ${evs.map(e=>{const exp=daysAgo(e.date)>c.expiry&&e.status!=="rejected";const stt=exp?"expired":e.status;const lab={verified:"Verified",submitted:"Submitted",rejected:"Rejected",more:"More needed",expired:"Expired"}[stt];return `<div class="ev"><div class="th">${e.url?`<img src="${e.url}" alt="">`:e.type.toUpperCase()}</div><div><div class="nm">${esc(e.name)}<span class="evs evs-${stt}">${lab}</span></div><div class="mt">${e.type} · uploaded ${ago(e.date)}${e.flag?" · flagged by reviewer":""}</div>${e.note?`<div class="mt">Note: ${esc(e.note)}</div>`:""}
          ${e.ai?`<div class="ai"><span class="tag tag-plat">AI-assisted observation · not a certification</span>${e.ai.map(o=>`<div>${esc(o)}</div>`).join("")}<div class="muted">Status: ${e.status==="verified"?"Confirmed by reviewer":"Needs human review"}</div></div>`:""}</div></div>`}).join("")}
        <div class="evrow"><label class="upl">+ Add photo, video or PDF<input type="file" accept="image/*,video/*,.pdf" data-up="${q.id}"></label></div>
        <input class="noteinput" placeholder="Add a note for the reviewer (optional)" data-note="${q.id}" aria-label="Note for ${esc(q.text)}">
      </div>`}).join("")}</details>`}).join("")}
    <div style="padding-block:34px 70px;display:flex;flex-wrap:wrap;gap:14px;align-items:center">${p.level==="self"?`<button class="pillbtn" id="reqVer2" ${sc.unanswered?"disabled":""}>Request verification</button>`:lvl(p.level)}<span class="muted">${sc.unanswered?sc.unanswered+" requirement(s) still unanswered":"All requirements answered"}</span></div>`;
  }
  if(tab==="reports"){
    const reps=REPORTS.filter(x=>x.rid===rid&&RP.visibleToRestaurant(x));
    body=`<div style="padding-block:30px 70px;max-width:760px"><p class="muted" style="margin-top:0">Reports stay private until our team moderates them. Your response is shown next to the report once it's published.</p>
    ${reps.map(x=>`<div class="rep"><div class="top">${rsPill(x.status)}<span>${fmt(x.date)}</span>${x.photo?"<span>Photo attached</span>":""}${x.flag?"<span>You flagged this as incorrect</span>":""}</div><p>${esc(x.text)}</p>
      ${x.response?`<div class="resp"><span class="tag tag-self">Your response · ${fmt(x.response.date)}</span><div>${esc(x.response.text)}</div>${x.response.ev?`<div class="muted" style="font-size:12px;margin-top:4px">Evidence: ${esc(x.response.ev)}</div>`:""}</div>`:
      `<form class="form" data-resp="${x.id}" style="margin-top:14px"><label for="rsp-${x.id}">Your response</label><textarea class="input" id="rsp-${x.id}" rows="2" required placeholder="e.g. Pest-control treatment done on 18 Sep, certificate attached."></textarea>
        <label class="upl" style="width:fit-content">+ Attach evidence<input type="file" id="rspf-${x.id}" accept="image/*,video/*,.pdf"></label>
        <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center"><button class="pillbtn sm" type="submit">Post response</button>${x.flag?"":`<button class="x" type="button" data-flag="${x.id}">Report incorrect information</button>`}</div></form>`}</div>`).join("")||`<p class="muted">No reports yet.</p>`}</div>`;
  }
  if(tab==="journey"){
    body=`<div style="padding-block:30px 70px;max-width:760px"><span class="tag tag-self">Your score over time</span>${journeySVG(rid)}${journeyList(rid)}
    <div style="margin-top:22px"><button class="pillbtn out sm" id="snap">Save this month's snapshot</button> <span class="muted" style="font-size:13px">The live product saves one automatically at month end.</span></div></div>`;
  }
  if(tab==="qr"){
    const url="https://platewatch.in/restaurant/"+rid+"/safety";
    body=`<div class="split" style="padding-top:36px"><div><h2 class="h-mid">Put your profile on the table</h2><p class="muted" style="max-width:44ch">Diners scan and see your score, verification level, official status, evidence freshness, reports and your responses.</p>
      <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-top:18px"><span style="font-family:var(--mono);font-size:14px;word-break:break-all" id="qrurl">${url}</span><button class="pillbtn out sm" id="copyqr">Copy link</button></div>
      <p class="muted" style="font-size:13px;margin-top:14px">In the live product this downloads as a print-ready A5 PDF. The link here is a placeholder domain.</p></div>
      <div class="poster"><span class="eyebrow" style="color:#9A9A9A">PlateWatch</span><div class="ptitle">SCAN TO VIEW OUR FOOD SAFETY PROFILE</div><div class="qrbox" id="qr"></div><div style="font-size:14px">${esc(r.name)}</div><div style="font-family:var(--mono);font-size:11px;color:#9A9A9A">${LV[p.level].toUpperCase()} · ${paused(rid)?"SCORE PAUSED":sc.overall+"/100"}</div></div></div>`;
  }
  document.getElementById("dash").innerHTML=`
    <div class="dashtop"><div><div class="eyebrow">Restaurant dashboard · owner +91 ${esc(p.owner)}</div><h1 class="h-big" style="margin-top:10px">${esc(r.name)}</h1><div class="muted" style="margin-top:6px">${esc(r.area)}, ${esc(r.city)} · ${lvl(p.level)}</div></div>
    <div style="display:flex;gap:10px;flex-wrap:wrap"><button class="pillbtn out sm" id="viewPub">View public profile</button><button class="x" id="ownOut">Sign out</button></div></div>
    <div class="dtabs" role="tablist">${tabs.map(([k,l])=>`<button role="tab" data-tab="${k}" aria-selected="${k===tab}">${l}</button>`).join("")}</div>${body}`;
  S.dashTab=tab;
  if(tab==="qr"){try{new QRCode(document.getElementById("qr"),{text:"https://platewatch.in/restaurant/"+rid+"/safety",width:170,height:170,colorDark:"#0A0A0A",colorLight:"#FFFFFF"})}catch(e){document.getElementById("qr").innerHTML='<span style="font:12px var(--mono);color:#0A0A0A;line-height:1.4">QR preview unavailable</span>'}
    document.getElementById("copyqr").onclick=()=>{navigator.clipboard?.writeText(document.getElementById("qrurl").textContent).then(()=>toast("Link copied")).catch(()=>toast("Select the link to copy it"))}}
  const rv=document.getElementById("reqVer")||document.getElementById("reqVer2");
  if(rv)rv.onclick=()=>{p.level="pending";p.adminNote="";p.reqOn=TODAY.toISOString().slice(0,10);toast("Verification requested. We'll review your evidence.");renderDash(tab)};
  const sn=document.getElementById("snap");if(sn)sn.onclick=()=>{p.journey.push({m:"Sep 2026",score:sc.overall,kind:"Snapshot",notes:[sc.missing.length+" requirement(s) open"]});toast("Snapshot saved");renderDash("journey")};
}
document.getElementById("dash").addEventListener("click",e=>{
  const rid=S.owner,p=PROF[rid];
  const t=e.target.closest("[data-tab]");if(t){renderDash(t.dataset.tab);window.scrollTo(0,0);return}
  if(e.target.id==="viewPub"){go("detail",rid);return}
  if(e.target.id==="ownOut"){S.owner=null;toast("Signed out of dashboard");go("biz");return}
  const a=e.target.closest("[data-ans]");if(a){p.resp[a.dataset.q]=a.dataset.ans;keepOpen();renderDash("checkup");return}
  const j=e.target.closest("[data-jump]");if(j){const q=REQ[j.dataset.jump];S.openCats.add(q.cat);renderDash("checkup");const el=document.getElementById("req-"+q.id);if(el)el.scrollIntoView({block:"center"});return}
  const fl=e.target.closest("[data-flag]");if(fl){const x=REPORTS.find(r=>r.id===+fl.dataset.flag);x.flag=true;toast("Flagged for our team to re-check");renderDash("reports");return}
});
function keepOpen(){S.openCats=new Set([...document.querySelectorAll("details.cat[open]")].map(d=>d.dataset.cat))}
document.getElementById("dash").addEventListener("toggle",e=>{if(e.target.matches&&e.target.matches("details.cat"))keepOpen()},true);
document.getElementById("dash").addEventListener("change",e=>{
  const rid=S.owner,p=PROF[rid];
  const up=e.target.closest("[data-up]");
  if(up&&up.files[0]){const f=up.files[0],q=up.dataset.up;
    const type=f.type.startsWith("image/")?"photo":f.type.startsWith("video/")?"video":"document";
    const noteEl=document.querySelector(`[data-note="${q}"]`);
    let url=null;if(type==="photo"){try{url=URL.createObjectURL(f)}catch(_){}}
    (p.ev[q]=p.ev[q]||[]).push({id:EVID++,name:f.name,type,date:TODAY.toISOString().slice(0,10),status:"submitted",note:noteEl?noteEl.value.trim():"",url,flag:false,ai:type==="photo"?aiFor(q):type==="video"?["Video received. Frame-by-frame review runs on the live platform."]:null});
    if(!p.resp[q])p.resp[q]="yes";
    if(p.level==="platform"){p.level="self";p.adminNote="New evidence added. Request verification again to keep your Platform verified badge."}
    keepOpen();renderDash("checkup");const el=document.getElementById("req-"+q);if(el)el.scrollIntoView({block:"center"});toast("Evidence submitted");
  }
});
document.getElementById("dash").addEventListener("submit",e=>{
  const f=e.target.closest("[data-resp]");if(!f)return;e.preventDefault();
  const id=+f.dataset.resp,x=REPORTS.find(r=>r.id===id);const file=document.getElementById("rspf-"+id).files[0];
  x.response={text:document.getElementById("rsp-"+id).value.trim(),date:TODAY.toISOString().slice(0,10),ev:file?file.name:null};
  RP.ownerResponded(x);
  toast("Response posted. It appears with the report once published.");renderDash("reports");
});

/* ---------- ADMIN ---------- */
S.adm={q:"",filter:"all",sort:"new",view:"list",sel:null,box:null,anim:false,rejecting:null};
const svg=(d,extra)=>`<svg class="ad-ico" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra||""}>${d}</svg>`;
const ICO={
 ok:svg('<circle cx="8" cy="8" r="6.25"/><path d="m5.4 8.2 1.8 1.8 3.4-3.6"/>'),
 warn:svg('<path d="M8 2.2 14.3 13H1.7Z"/><path d="M8 6.4v3"/><path d="M8 11.4v.1"/>'),
 info:svg('<circle cx="8" cy="8" r="6.25"/><path d="M8 7.2v3.6"/><path d="M8 5.2v.1"/>'),
 flag:svg('<path d="M3.5 14V2.5"/><path d="M3.5 3h8.2l-1.6 3 1.6 3H3.5"/>'),
 img:svg('<rect x="2" y="2.5" width="12" height="11" rx="1.5"/><circle cx="5.8" cy="6.2" r="1.2"/><path d="m2.5 12 3.6-3.4 2.4 2.2 2.2-1.9 2.8 2.6"/>'),
 doc:svg('<path d="M4 1.8h5.2L12.5 5v9.2H4Z"/><path d="M9 1.8V5h3.5"/><path d="M6 8.4h4.5M6 10.8h4.5"/>'),
 x:svg('<path d="m4 4 8 8M12 4l-8 8"/>'),
 search:svg('<circle cx="7" cy="7" r="4.5"/><path d="m10.4 10.4 3.3 3.3"/>'),
 expand:svg('<path d="M9.5 2.5h4v4M6.5 13.5h-4v-4M13.5 2.5 9 7M2.5 13.5 7 9"/>')};
const cap=s=>s.charAt(0).toUpperCase()+s.slice(1);
const EVST={submitted:["Pending review","pend"],more:["More requested","more"],verified:["Approved","ok"],rejected:["Rejected","no"]};
const adBadge=e=>`<span class="ad-badge ad-b-${EVST[e.status][1]}">${EVST[e.status][0]}</span>${e.flag?`<span class="ad-badge ad-b-flag">${ICO.flag}Flagged</span>`:""}`;
const adObs=o=>{const k=o[0]==="✓"?"ok":o[0]==="⚠"?"warn":"info";return `<li class="ad-obs ad-obs-${k}">${ICO[k]}<span>${esc(k==="info"?o:o.slice(1).trim())}</span></li>`};
const adEmpty=(h,p,extra)=>`<div class="ad-empty"><span class="ad-empty-mark" aria-hidden="true">${ICO.ok}</span><h3>${h}</h3><p>${p}</p>${extra||""}</div>`;
const place=rid=>D.find(x=>x.id===rid);
/* every evidence item still waiting on a reviewer */
function adQueue(){const out=[];Object.entries(PROF).forEach(([rid,p])=>Object.entries(p.ev).forEach(([q,list])=>list.forEach(e=>{if(e.status==="submitted"||e.status==="more")out.push({rid:+rid,q,e})})));return out}
function adFind(id){for(const [rid,p] of Object.entries(PROF))for(const [q,list] of Object.entries(p.ev)){const e=list.find(y=>y.id===id);if(e)return {rid:+rid,q,e}}return null}
function adExpiring(){let n=0;Object.values(PROF).forEach(p=>Object.entries(p.ev).forEach(([q,list])=>list.forEach(e=>{if(e.status==="rejected")return;const left=CAT[REQ[q].cat].expiry-daysAgo(e.date);if(left>=0&&left<=7)n++})));return n}
function adItems(){
  const A=S.adm,s=A.q.trim().toLowerCase();
  const pri=x=>(REQ[x.q].crit?100:0)+REQ[x.q].w*10+(x.e.flag?5:0)+(x.e.status==="more"?3:0);
  return adQueue().filter(({rid,q,e})=>{const r=place(rid);
    if(s&&!(e.name+" "+r.name+" "+r.area+" "+r.city+" "+REQ[q].text+" "+CAT[REQ[q].cat].name).toLowerCase().includes(s))return false;
    if(A.filter==="pending")return e.status==="submitted";
    if(A.filter==="flagged")return !!e.flag;
    if(A.filter==="recent")return daysAgo(e.date)<=3;
    return true;
  }).sort(A.sort==="old"?(a,b)=>a.e.date.localeCompare(b.e.date)||a.e.id-b.e.id
    :A.sort==="pri"?(a,b)=>pri(b)-pri(a)||a.e.date.localeCompare(b.e.date)
    :(a,b)=>b.e.date.localeCompare(a.e.date)||b.e.id-a.e.id);
}
function adPreview(e,big){
  const cls="ad-pv"+(big?" ad-pv-lg":"");
  if(e.url)return `<button class="${cls}" data-box="${e.id}" aria-label="Open larger preview of ${esc(e.name)}"><img src="${e.url}" alt="" onload="this.parentNode.classList.add('ld')" onerror="this.parentNode.classList.add('ld')"><span class="ad-pv-zoom">${ICO.expand}</span></button>`;
  return `<${big?"div":`button data-open="${e.id}" aria-label="Open details for ${esc(e.name)}"`} class="${cls} ad-pv-none">${e.type==="photo"?ICO.img:ICO.doc}<span>No preview</span><em>${e.type}</em></${big?"div":"button"}>`;
}
function adEvActs(e){return `<button class="ad-link${e.flag?" is-on":""}" data-e="flag" data-eid="${e.id}" aria-pressed="${!!e.flag}">${ICO.flag}${e.flag?"Flagged":"Flag"}</button>
  <span class="ad-acts-main"><button class="ad-btn ad-btn-out" data-e="more" data-eid="${e.id}">Request more evidence</button><button class="ad-btn ad-btn-danger" data-e="rejected" data-eid="${e.id}">Reject</button><button class="ad-btn ad-btn-pri" data-e="verified" data-eid="${e.id}">Approve</button></span>`}
function adEvRow({rid,q,e}){const r=place(rid),p=PROF[rid],req=REQ[q];
  return `<article class="ad-row${S.adm.sel===e.id?" is-sel":""}" data-row="${e.id}">
    <div class="ad-row-media">${adPreview(e)}</div>
    <div class="ad-row-body">
      <div class="ad-row-top">
        <div class="ad-row-id">
          <h3 class="ad-fn"><button data-open="${e.id}">${esc(e.name)}</button></h3>
          <div class="ad-meta"><span class="ad-meta-strong">${esc(r.name)}</span><span>${esc(r.area)}, ${esc(r.city)}</span><span>${CAT[req.cat].name}</span><span>Submitted ${ago(e.date)}</span></div>
        </div>
        <div class="ad-badges">${adBadge(e)}</div>
      </div>
      <div class="ad-row-grid">
        <section class="ad-sec" aria-label="Evidence details">
          <h4 class="ad-lbl">Evidence details</h4>
          <dl class="ad-dl">
            <div class="ad-dl-wide"><dt>Description</dt><dd>${esc(req.text)}${req.crit?` <span class="ad-crit">Critical</span>`:""}</dd></div>
            <div><dt>Evidence type</dt><dd>${cap(e.type)}</dd></div>
            <div><dt>Submitted by</dt><dd>Owner · +91 ${esc(p.owner)}</dd></div>
            <div><dt>Submitted date</dt><dd>${fmt(e.date)}</dd></div>
            <div><dt>Verification status</dt><dd>${LV[p.level]}</dd></div>
          </dl>
          ${e.note?`<p class="ad-note"><span class="ad-lbl">Owner's note</span>${esc(e.note)}</p>`:""}
        </section>
        <section class="ad-sec" aria-label="AI observations">
          <h4 class="ad-lbl">AI observations <span class="ad-lbl-sub">Assistive · not a certification</span></h4>
          ${e.ai?`<ul class="ad-obs-list">${e.ai.map(adObs).join("")}</ul>`:`<p class="ad-muted">No automated checks for ${e.type}s. Review the file manually.</p>`}
        </section>
      </div>
      <div class="ad-acts">${adEvActs(e)}</div>
    </div>
  </article>`}
function adListHTML(){
  const all=adQueue().length,list=adItems();
  if(!all)return adEmpty("No evidence waiting for review","Everything is currently up to date.");
  if(!list.length)return adEmpty("No evidence matches these filters","Try a different search or filter.",`<button class="ad-btn ad-btn-out" data-clear>Clear filters</button>`);
  return list.map(adEvRow).join("");
}
function adDrawList(){
  const n=adItems().length;
  document.getElementById("adList").innerHTML=adListHTML();
  document.getElementById("admCount").textContent=`${n} ${n===1?"item":"items"}`;
}
function adPanelHTML(){
  const it=S.adm.sel==null?null:adFind(S.adm.sel);if(!it)return "";
  const {rid,q,e}=it,r=place(rid),p=PROF[rid],req=REQ[q],c=CAT[req.cat],sc=scoreOf(rid);
  const until=new Date(e.date);until.setDate(until.getDate()+c.expiry);
  const prev=(p.ev[q]||[]).filter(x=>x.id!==e.id).sort((a,b)=>b.date.localeCompare(a.date));
  const waiting=e.status==="submitted"||e.status==="more";
  return `<div class="ad-scrim${S.adm.anim?" in":""}" data-close="panel"></div>
  <aside class="ad-panel${S.adm.anim?" in":""}" role="dialog" aria-modal="true" aria-labelledby="adPanelTitle">
    <div class="ad-panel-head">
      <div><div class="ad-lbl">Evidence · ${esc(r.name)}</div><h2 id="adPanelTitle" class="ad-panel-title">${esc(e.name)}</h2><div class="ad-badges">${adBadge(e)}</div></div>
      <button class="ad-iconbtn" data-close="panel" aria-label="Close panel" id="adPanelClose">${ICO.x}</button>
    </div>
    <div class="ad-panel-body">
      ${adPreview(e,true)}
      <section class="ad-psec"><h4 class="ad-lbl">Metadata</h4>
        <dl class="ad-kv">
          <dt>Restaurant</dt><dd>${esc(r.name)}</dd>
          <dt>Location</dt><dd>${esc(r.area)}, ${esc(r.city)}</dd>
          <dt>Category</dt><dd>${c.name}</dd>
          <dt>Requirement</dt><dd>${esc(req.text)}${req.crit?` <span class="ad-crit">Critical</span>`:""}</dd>
          <dt>Weight</dt><dd>${req.w} of 5</dd>
          <dt>Evidence type</dt><dd>${cap(e.type)}</dd>
          <dt>Submitted by</dt><dd>Owner · +91 ${esc(p.owner)}</dd>
          <dt>Submitted</dt><dd>${fmt(e.date)} · ${ago(e.date)}</dd>
          <dt>Valid until</dt><dd>${fmt(until.toISOString().slice(0,10))} · ${c.expiry}-day window</dd>
          <dt>Verification</dt><dd>${LV[p.level]}</dd>
          <dt>Current score</dt><dd>${sc.overall}/100 · ${sc.done}/${sc.tot} met</dd>
        </dl>
      </section>
      <section class="ad-psec"><h4 class="ad-lbl">AI observations <span class="ad-lbl-sub">Assistive · not a certification</span></h4>
        ${e.ai?`<ul class="ad-obs-list">${e.ai.map(adObs).join("")}</ul>`:`<p class="ad-muted">No automated checks for ${e.type}s.</p>`}
      </section>
      <section class="ad-psec"><h4 class="ad-lbl">Previous submissions <span class="ad-lbl-sub">Same requirement</span></h4>
        ${prev.length?`<ul class="ad-hist">${prev.map(x=>`<li><span class="ad-hist-n">${esc(x.name)}</span><span class="ad-hist-d">${fmt(x.date)}</span>${adBadge(x)}</li>`).join("")}</ul>`:`<p class="ad-muted">First submission for this requirement.</p>`}
      </section>
      <section class="ad-psec"><h4 class="ad-lbl">Reviewer notes</h4>
        ${e.note?`<p class="ad-note"><span class="ad-lbl">Owner's note</span>${esc(e.note)}</p>`:""}
        <textarea class="ad-textarea" rows="3" data-rnote="${e.id}" placeholder="Internal note for other reviewers" aria-label="Reviewer note">${esc(e.reviewNote||"")}</textarea>
        <p class="ad-hint">Internal only. Not shown to the restaurant.</p>
      </section>
    </div>
    ${waiting?`<div class="ad-panel-foot ad-acts">${adEvActs(e)}</div>`:""}
  </aside>`;
}
function adBoxHTML(){
  const it=S.adm.box==null?null:adFind(S.adm.box);if(!it||!it.e.url)return "";
  const r=place(it.rid);
  return `<div class="ad-lb" role="dialog" aria-modal="true" aria-label="Evidence preview" data-close="box">
    <figure><img src="${it.e.url}" alt="${esc(it.e.name)}"><figcaption><span>${esc(it.e.name)}</span><span>${esc(r.name)} · ${fmt(it.e.date)}</span></figcaption></figure>
    <button class="ad-iconbtn ad-lb-x" data-close="box" aria-label="Close preview" id="adBoxClose">${ICO.x}</button>
  </div>`;
}
function adOverlays(){
  const el=document.getElementById("admOverlay");if(!el)return;
  el.innerHTML=adPanelHTML()+adBoxHTML();
  document.documentElement.classList.toggle("ad-lock",!!el.innerHTML);
  S.adm.anim=false;
}
/* community reports: moderation queue */
const REJECT_REASONS=["No food-safety issue described","Evidence doesn't match the outlet","Duplicate of another report","Personal or abusive content","Not enough detail to act on"];
function adReportRow(x){
  const r=x.rid?place(x.rid):null,rej=S.adm.rejecting===x.id,pend=x.status==="pending";
  return `<article class="ad-row ad-row-plain">
    <div class="ad-row-body">
      <div class="ad-row-top">
        <div class="ad-row-id"><h3 class="ad-fn">${esc(RP.outletName(x))}${r?"":` <span class="ad-td-muted">(not listed)</span>`}</h3><div class="ad-meta"><span>${r?esc(r.area)+", "+esc(r.city):esc(x.place.area)}</span>${x.cat?`<span>${esc(x.cat)}</span>`:""}<span>${esc(x.ref)}</span><span>Received ${ago(x.date)}</span>${x.channel==="whatsapp"?"<span>via WhatsApp</span>":""}</div></div>
        <div class="ad-badges">${pend?`<span class="ad-badge ad-b-pend">${x.askMore?"More requested":"Pending"}</span>`:rsPill(x.status)}${x.share===false?`<span class="ad-badge">Kept private</span>`:""}${x.flag?`<span class="ad-badge ad-b-flag">${ICO.flag}Restaurant flagged as incorrect</span>`:""}</div>
      </div>
      <blockquote class="ad-quote">${esc(x.text)}</blockquote>
      ${x.response?`<div class="ad-note"><span class="ad-lbl">Restaurant response</span>${esc(x.response.text)}</div>`:""}
      <dl class="ad-facts"><div><dt>Evidence</dt><dd>${esc(RP.evidenceText(x))}</dd></div><div><dt>Reporter</dt><dd>${x.user?cap(RP.ageText(x.user)):"No verified number"}</dd></div><div><dt>Counts toward escalation</dt><dd>${esc(RP.countsInfo(x))}</dd></div></dl>
      ${rej?`<div class="ad-reason"><label class="ad-select"><span>Reason</span><select id="admReason">${REJECT_REASONS.map(o=>`<option>${o}</option>`).join("")}</select></label><button class="ad-btn ad-btn-out" data-m="cancel" data-rep="${x.id}">Cancel</button><button class="ad-btn ad-btn-danger ad-btn-danger-solid" data-m="reject-go" data-rep="${x.id}">Reject report</button></div>`:""}
      <div class="ad-acts">${pend?`<button class="ad-link" data-m="coord" data-rep="${x.id}">Mark as coordinated</button><span class="ad-acts-main"><button class="ad-btn ad-btn-out" data-m="more" data-rep="${x.id}" ${!x.user||x.askMore?"disabled":""}>Ask reporter for more</button><button class="ad-btn ad-btn-danger" data-m="reject" data-rep="${x.id}">Reject with reason</button><button class="ad-btn ad-btn-pri" data-m="accept" data-rep="${x.id}">Accept</button></span>`
        :`<span></span><span class="ad-acts-main"><button class="ad-btn ad-btn-danger" data-m="reject" data-rep="${x.id}">Reject with reason</button><button class="ad-btn ad-btn-pri" data-m="keep" data-rep="${x.id}">Keep published</button></span>`}</div>
    </div></article>`;
}
/* escalations: fast-lane outlets waiting for a moderator, escalations sent, and outlets being watched */
function adWatchHTML(urg){
  const rows=D.map(r=>{const s=RP.standard(r.id),f=RP.fastLane(r.id),l=RP.lastEscalation(r.id);return {r,s,f,l,u:urg.some(o=>o.r.id===r.id)}}).filter(o=>o.s.count||o.f.count||o.l);
  if(!rows.length)return adEmpty("Nothing to watch","No outlet has qualifying reports right now.");
  return `<div class="ad-surface ad-tbl"><table><thead><tr><th>Outlet</th><th>Standard (${RP.ESC.stdDays} days)</th><th>Fast lane (${RP.ESC.fastHours} h)</th><th>Status</th></tr></thead><tbody>${rows.map(o=>`<tr><td>${esc(o.r.name)}</td><td>${o.s.count} / ${RP.ESC.stdCount}</td><td>${o.f.count} / ${RP.ESC.fastCount}</td><td>${o.u?`<span class="ad-badge ad-b-more">Urgent</span>`:o.l?`<span class="ad-badge ad-b-ok">Escalated ${fmt(o.l.date)}</span>`:`<span class="ad-badge ad-b-pend">Watching</span>`}</td></tr>`).join("")}</tbody></table></div>`;
}
function adEscalationsHTML(urg){
  const urgent=urg.map(({r,f})=>`<article class="ad-row ad-row-plain">
    <div class="ad-row-body">
      <div class="ad-row-top"><div class="ad-row-id"><h3 class="ad-fn">${esc(r.name)}</h3><div class="ad-meta"><span>FSSAI ${r.lic}</span><span>${f.count} reports in ${RP.ESC.fastHours} hours</span><span>${f.fresh} from numbers under ${RP.ESC.newDays} days old</span></div></div>
        <div class="ad-badges"><span class="ad-badge ad-b-more">Urgent</span></div></div>
      <p class="ad-refs">${f.list.map(x=>`${esc(x.ref)} · ${esc(x.cat)} · ${RP.isAccepted(x)?"accepted":"pending"}`).join("<br>")}</p>
      <div class="ad-acts"><button class="ad-link" data-fast="coord" data-rid="${r.id}">Mark as coordinated</button><span class="ad-acts-main">${f.warn?`<span class="ad-badge ad-b-flag ad-warn">${ICO.warn}Possible coordinated reports</span>`:""}<button class="ad-btn ad-btn-pri" data-fast="confirm" data-rid="${r.id}">Confirm not coordinated</button></span></div>
    </div></article>`).join("");
  const sent=[...RP.ESCALATIONS].reverse().map(e=>{const r=place(e.rid);return `<article class="ad-row ad-row-plain">
    <div class="ad-row-body">
      <div class="ad-row-top"><div class="ad-row-id"><h3 class="ad-fn">${esc(r.name)}</h3><div class="ad-meta"><span>FSSAI ${r.lic}</span><span>To ${esc(e.authority)}</span><span>${fmt(e.date)}</span><span>${esc(e.ref)}</span></div></div>
        <div class="ad-badges"><span class="ad-badge">${esc(e.rule)}</span><span class="ad-badge ad-b-ok">Sent</span></div></div>
      <dl class="ad-facts"><div><dt>Reports</dt><dd>${e.reportIds.length}: ${e.reportIds.map(id=>esc(REPORTS.find(x=>x.id===id).ref)).join(", ")}</dd></div><div><dt>Rule</dt><dd>${esc(e.rule)}</dd></div><div><dt>Authority</dt><dd>${esc(e.authority)}</dd></div></dl>
      <details class="ad-packet"><summary>Preview email packet <span class="ad-lbl-sub">Demo — not emailed.</span></summary><pre>${esc(RP.packetText(e))}</pre></details>
      <div class="ad-acts"><span class="ad-td-muted">${e.actionOn?`Official action recorded ${fmt(e.actionOn)}. Reporters were told.`:"Waiting for an official action on the tracker."}</span>${e.actionOn?"":`<span class="ad-acts-main"><button class="ad-btn ad-btn-out" data-sim="${e.id}">Demo: record an official action</button></span>`}</div>
    </div></article>`}).join("");
  return `<h3 class="ad-h3">Urgent · fast lane</h3><div class="ad-surface">${urgent||adEmpty("Nothing urgent",`No outlet has ${RP.ESC.fastCount} reports within ${RP.ESC.fastHours} hours.`)}</div>
    <h3 class="ad-h3">Sent to the regulator</h3><div class="ad-surface">${sent||adEmpty("No escalations yet","Outlets are escalated automatically when a rule is met.")}</div>
    <h3 class="ad-h3">Watching</h3>${adWatchHTML(urg)}`;
}
function renderAdmin(tab){
  if(tab!==S.admTab){S.adm.sel=null;S.adm.box=null}
  const allEv=adQueue();
  const vr=Object.entries(PROF).filter(([,p])=>p.level==="pending");
  RP.checkActions();
  const pr=REPORTS.filter(x=>x.status==="pending"||(x.flag&&x.status!=="rejected"));
  const urg=RP.urgentOutlets();
  const tabs=[["verify","Verification requests",vr.length],["evidence","Evidence",allEv.length],["reports","Community reports",pr.length],["escalations","Escalations",urg.length],["scoring","Scoring rules",0],["expiry","Evidence expiry",0],["rules","Escalation rules",0]];
  document.getElementById("admSummary").innerHTML=[["Pending",allEv.length+vr.length],["Reports",pr.length],["Expiring soon",adExpiring()]].map(([l,n])=>`<div><dt>${l}</dt><dd>${n}</dd></div>`).join("");
  document.getElementById("atabs").innerHTML=tabs.map(([k,l,n])=>`<button role="tab" data-atab="${k}" aria-selected="${k===tab}">${l}${n?`<span class="ad-count">${n}</span>`:""}</button>`).join("");
  const nm=rid=>esc(place(rid).name);
  const lc=rid=>`${nm(rid)} <b>${scoreOf(rid).overall}/100</b>${paused(rid)?` <span class="ad-td-muted">(paused publicly)</span>`:""}`;
  const liveCheck=`<p class="ad-live"><span class="ad-lbl">Live check</span>${lc(3)}<span aria-hidden="true">·</span>${lc(13)}</p>`;
  let h="";
  if(tab==="verify")h=`<div class="ad-surface">${vr.map(([rid,p])=>{const sc=scoreOf(+rid),r=place(+rid);return `<article class="ad-row ad-row-plain">
    <div class="ad-row-body">
      <div class="ad-row-top">
        <div class="ad-row-id"><h3 class="ad-fn">${nm(+rid)}</h3><div class="ad-meta"><span>${esc(r.area)}, ${esc(r.city)}</span><span>${esc(r.cat)}</span><span>Owner · +91 ${esc(p.owner)}</span>${p.reqOn?`<span>Requested ${ago(p.reqOn)}</span>`:""}</div></div>
        <div class="ad-badges"><span class="ad-badge ad-b-pend">Verification requested</span></div>
      </div>
      <dl class="ad-stats"><div><dt>Score</dt><dd>${sc.overall}<small>/100</small></dd></div><div><dt>Requirements met</dt><dd>${sc.done}<small>/${sc.tot}</small></dd></div><div><dt>Evidence items</dt><dd>${evCounts(+rid).total}</dd></div><div><dt>Critical open</dt><dd class="${sc.crit.length?"is-bad":""}">${sc.crit.length}</dd></div></dl>
      ${sc.crit.length?`<ul class="ad-obs-list">${sc.crit.map(q=>`<li class="ad-obs ad-obs-warn">${ICO.warn}<span>${esc(q.text)}</span></li>`).join("")}</ul>`:""}
      <div class="ad-acts"><span></span><span class="ad-acts-main"><button class="ad-btn ad-btn-out" data-v="more" data-rid="${rid}">Request more evidence</button><button class="ad-btn ad-btn-danger" data-v="reject" data-rid="${rid}">Reject</button><button class="ad-btn ad-btn-pri" data-v="approve" data-rid="${rid}">Approve</button></span></div>
    </div></article>`}).join("")||adEmpty("No pending verification requests","Claim Bandra Bao Co. as an owner and tap “Request verification” to see one here.")}</div>`;
  if(tab==="evidence"){const A=S.adm,n=adItems().length;
    h=`<div class="ad-toolbar">
      <label class="ad-search">${ICO.search}<input id="admQ" type="search" placeholder="Search evidence…" value="${esc(A.q)}" aria-label="Search evidence" autocomplete="off"></label>
      <div class="ad-seg" role="group" aria-label="Filter">${[["all","All"],["pending","Pending"],["flagged","Flagged"],["recent","Recently submitted"]].map(([k,l])=>`<button data-af="${k}" aria-pressed="${A.filter===k}">${l}</button>`).join("")}</div>
      <label class="ad-select"><span>Sort</span><select id="admSort">${[["new","Newest"],["old","Oldest"],["pri","Highest priority"]].map(([k,l])=>`<option value="${k}" ${A.sort===k?"selected":""}>${l}</option>`).join("")}</select></label>
      <div class="ad-seg ad-seg-view" role="group" aria-label="View">${[["list","List"],["compact","Compact"]].map(([k,l])=>`<button data-av="${k}" aria-pressed="${A.view===k}">${l}</button>`).join("")}</div>
    </div>
    <div class="ad-listhead"><span id="admCount">${n} ${n===1?"item":"items"}</span><span>Select an item to open the review panel</span></div>
    <div class="ad-surface ad-list${A.view==="compact"?" is-compact":""}" id="adList">${adListHTML()}</div>`}
  if(tab==="reports")h=`<div class="ad-surface">${pr.map(adReportRow).join("")||adEmpty("No reports waiting","Every community report has been moderated.")}</div>`;
  if(tab==="escalations")h=adEscalationsHTML(urg);
  if(tab==="rules")h=`<div class="ad-sechead"><p>Per outlet, only accepted reports with a photo, video or bill, shared with consent, from different numbers count. Changes apply immediately.</p></div>
    <div class="ad-surface ad-tbl"><table><thead><tr><th>Rule</th><th>Setting</th><th>Value</th></tr></thead><tbody>${RP.RULE_FIELDS.map(([g,fs])=>fs.map(([k,l,mn,mx,step],i)=>`<tr><td>${i?"":`<b>${g}</b>`}</td><td class="ad-td-muted">${l}</td><td><input type="number" min="${mn}" max="${mx}" step="${step}" value="${RP.ESC[k]}" data-esc="${k}" aria-label="${esc(g+": "+l)}"></td></tr>`).join("")).join("")}
      <tr><td><b>Weights</b></td><td class="ad-td-muted" colspan="2">Established number 1.0 · New number as set above · Kept private or no photo, video or bill 0</td></tr></tbody></table></div>
    <h3 class="ad-h3">Live status</h3>${adWatchHTML(urg)}`;
  if(tab==="scoring")h=`<div class="ad-sechead"><p>Weights and critical flags apply to every restaurant instantly. Score = weighted met ÷ weighted applicable.</p>${liveCheck}</div>
    <div class="ad-surface ad-tbl"><table><thead><tr><th>Requirement</th><th>Category</th><th>Weight</th><th>Critical</th></tr></thead><tbody>${REQS.map(q=>`<tr><td>${esc(q.text)}</td><td class="ad-td-muted">${CAT[q.cat].name}</td><td><input type="number" min="1" max="5" value="${q.w}" data-w="${q.id}" aria-label="Weight"></td><td><input type="checkbox" ${q.crit?"checked":""} data-c="${q.id}" aria-label="Critical"></td></tr>`).join("")}</tbody></table></div>`;
  if(tab==="expiry")h=`<div class="ad-sechead"><p>How long evidence stays valid before it stops counting towards the score.</p>${liveCheck}</div>
    <div class="ad-surface ad-tbl"><table><thead><tr><th>Category</th><th>Valid for (days)</th></tr></thead><tbody>${CATS.map(c=>`<tr><td>${c.name}</td><td><input type="number" min="1" max="730" value="${c.expiry}" data-x="${c.k}" aria-label="Days"></td></tr>`).join("")}</tbody></table></div>`;
  document.getElementById("adm").innerHTML=`<div class="ad-pane" role="tabpanel">${h}</div><div id="admOverlay"></div>`;S.admTab=tab;
  adOverlays();
}
function adOpen(id){S.adm.sel=id;S.adm.anim=true;renderAdmin("evidence");const b=document.getElementById("adPanelClose");if(b)b.focus()}
function adClose(which){if(which==="box")S.adm.box=null;else S.adm.sel=null;adOverlays();if(which==="panel")document.querySelectorAll("#adList .ad-row.is-sel").forEach(x=>x.classList.remove("is-sel"))}
document.getElementById("atabs").onclick=e=>{const b=e.target.closest("[data-atab]");if(b)renderAdmin(b.dataset.atab)};
document.getElementById("adm").addEventListener("click",e=>{
  const cl=e.target.closest("[data-close]");
  if(cl){if(cl.dataset.close==="box"&&e.target.closest("figure"))return;adClose(cl.dataset.close);return}
  const bx=e.target.closest("[data-box]");if(bx){S.adm.box=+bx.dataset.box;adOverlays();const b=document.getElementById("adBoxClose");if(b)b.focus();return}
  const af=e.target.closest("[data-af]");if(af){S.adm.filter=af.dataset.af;renderAdmin("evidence");return}
  const av=e.target.closest("[data-av]");if(av){S.adm.view=av.dataset.av;renderAdmin("evidence");return}
  if(e.target.closest("[data-clear]")){S.adm.q="";S.adm.filter="all";renderAdmin("evidence");return}
  const v=e.target.closest("[data-v]");
  if(v){const p=PROF[+v.dataset.rid];const a=v.dataset.v;
    if(a==="approve"){p.level="platform";p.verifiedOn=TODAY.toISOString().slice(0,10);p.adminNote="";Object.values(p.ev).flat().forEach(x=>{if(x.status==="submitted")x.status="verified"});toast("Approved. Now Platform verified.")}
    if(a==="more"){p.level="self";p.adminNote="Reviewer requested more evidence before verification. Check items marked 'More needed'.";toast("Sent back for more evidence")}
    if(a==="reject"){p.level="self";p.adminNote="Verification request was not approved. Review your evidence and try again.";toast("Request rejected")}
    renderAdmin("verify");return}
  const ev=e.target.closest("[data-e]");
  if(ev){const id=+ev.dataset.eid;const x=Object.values(PROF).flatMap(p=>Object.values(p.ev).flat()).find(y=>y.id===id);
    /* with the panel open, a decision moves it on to the next item in the current list */
    const before=S.adm.sel===id?adItems().map(y=>y.e.id):null;
    if(ev.dataset.e==="flag")x.flag=!x.flag;else x.status=ev.dataset.e;toast("Evidence updated");
    if(before&&ev.dataset.e!=="flag"){const after=new Set(adItems().map(y=>y.e.id));const i=before.indexOf(id);S.adm.sel=before.slice(i+1).concat(before.slice(0,i).reverse()).find(y=>after.has(y))??null}
    renderAdmin("evidence");return}
  const m=e.target.closest("[data-m]");
  if(m){const x=REPORTS.find(y=>y.id===+m.dataset.rep),a=m.dataset.m;
    if(a==="accept"){const made=RP.accept(x);toast(made.length?`Accepted · ${made.map(y=>place(y.rid).name).join(", ")} escalated to ${RP.AUTH}`:"Report accepted")}
    if(a==="reject"){S.adm.rejecting=x.id;renderAdmin("reports");const sel=document.getElementById("admReason");if(sel)sel.focus();return}
    if(a==="reject-go"){RP.reject(x,document.getElementById("admReason").value.toLowerCase());x.flag=false;toast("Report rejected")}
    if(a==="more"){RP.askMore(x);toast("Asked the reporter for more")}
    if(a==="coord"){RP.markCoordinated(x);toast("Marked as coordinated")}
    if(a==="keep"){x.flag=false;toast("Kept published")}
    S.adm.rejecting=null;renderAdmin("reports");return}
  const fa=e.target.closest("[data-fast]");
  if(fa){const rid=+fa.dataset.rid;if(fa.dataset.fast==="confirm"){RP.confirmFast(rid);toast(`Escalated to ${RP.AUTH}`)}else{const n=RP.coordinatedFast(rid);toast(`${n} reports marked as coordinated`)}renderAdmin("escalations");return}
  const sm=e.target.closest("[data-sim]");if(sm){RP.simulateAction(+sm.dataset.sim);toast("Official action recorded (demo)");renderAdmin("escalations");return}
  const op=e.target.closest("[data-open]");if(op){adOpen(+op.dataset.open);return}
  const row=e.target.closest(".ad-row[data-row]");
  if(row&&!e.target.closest("button,a,input,select,textarea,label")&&!getSelection().toString())adOpen(+row.dataset.row);
});
document.getElementById("adm").addEventListener("input",e=>{
  if(e.target.id==="admQ"){S.adm.q=e.target.value;adDrawList();return}
  const n=e.target.dataset.rnote;if(n){const it=adFind(+n);if(it)it.e.reviewNote=e.target.value}
});
document.getElementById("adm").addEventListener("change",e=>{
  if(e.target.id==="admSort"){S.adm.sort=e.target.value;adDrawList();return}
  const ek=e.target.dataset.esc;
  if(ek){const i=e.target;RP.ESC[ek]=Math.max(+i.min,Math.min(+i.max,+i.value||+i.min));const made=RP.evaluate();if(made.length)toast(`${made.map(y=>place(y.rid).name).join(", ")} escalated to ${RP.AUTH}`);renderAdmin("rules");return}
  const w=e.target.dataset.w,c=e.target.dataset.c,x=e.target.dataset.x;
  if(w){REQ[w].w=Math.max(1,Math.min(5,+e.target.value||1));renderAdmin("scoring")}
  if(c){REQ[c].crit=e.target.checked;renderAdmin("scoring")}
  if(x){CAT[x].expiry=Math.max(1,+e.target.value||1);renderAdmin("expiry")}
});
document.addEventListener("keydown",e=>{
  if(e.key!=="Escape"||document.getElementById("p-admin").hidden)return;
  if(S.adm.box!=null)adClose("box");else if(S.adm.sel!=null)adClose("panel");
});

/* ================= V5 HOME ================= */
function heroCards(){
  const pick=[[1,"Food safety violations","c1"],[3,"Compliance confirmed","c2"]];
  const lab={sus:"Licence suspended",ok:"Cleared · reinstated",imp:"Improvement notice",rev:"Licence revoked"};
  const w=document.getElementById("hcWrap");
  w.innerHTML=pick.map(([id,line,cls])=>{const r=D.find(x=>x.id===id),c=cur(r);const ini=r.name.split(/\s+/).map(x=>x[0]).join("").slice(0,2);
    return `<button class="hc5 ${cls}" data-id="${r.id}" aria-label="${esc(r.name)}, ${lab[c[1]]}, ${fmt(c[0])}. Sample record. Open profile"><span class="mn" aria-hidden="true">${ini}</span><span><span class="nm">${esc(r.name)}</span><span class="ar">${esc(r.area)}, ${esc(r.city)}</span><span class="st ${TYPES[c[1]][1]}">${lab[c[1]]}</span></span><span class="ft"><span>${line}</span><b>${fmt(c[0])}</b></span></button>`}).join("");
  w.onclick=e=>{const b=e.target.closest(".hc5");if(b)go("detail",+b.dataset.id)};
}
function initHero(){
  const nav=document.querySelector(".nav"),photo=document.getElementById("plate"),g=document.getElementById("plG"),line=document.getElementById("plLine");
  const layers=[...photo.querySelectorAll(".ph")];
  const reduce=matchMedia("(prefers-reduced-motion: reduce)").matches;
  const set=v=>{g.style.clipPath=`inset(0 0 0 ${v}%)`;line.style.left=v+"%"};
  const END=62;
  if(reduce){set(END);line.style.opacity=".75"}
  else{set(100);setTimeout(()=>{line.style.opacity=".75";let t0=null;const step=ts=>{if(t0==null)t0=ts;const p=Math.min(1,(ts-t0)/1800),e=1-Math.pow(1-p,3);set(100-(100-END)*e);if(p<1)requestAnimationFrame(step)};requestAnimationFrame(step)},600)}
  let ticking=false;
  const apply=()=>{ticking=false;nav.classList.toggle("scrolled",scrollY>8);
    if(reduce||document.getElementById("p-home").hidden)return;
    const r=photo.getBoundingClientRect();if(r.bottom<0||r.top>innerHeight)return;
    const y=Math.max(-24,Math.min(24,(r.top+r.height/2-innerHeight/2)*-0.05));
    photo.style.transform=`translate3d(0,${y.toFixed(1)}px,0)`;
  };
  const req=()=>{if(!ticking){ticking=true;requestAnimationFrame(apply)}};
  addEventListener("scroll",req,{passive:true});addEventListener("resize",req);apply();
}
function renderHomeExtras(){
  const id=3,r=D.find(x=>x.id===id),c=cur(r),p=PROF[id],sc=scoreOf(id),ec=evCounts(id);
  /* restaurant dashboard preview */
  document.getElementById("ckPrev").innerHTML=`<div class="p5-top"><div><div class="p5-k">Restaurant dashboard · sample</div><div class="p5-n">${esc(r.name)}</div></div>${lvl(p.level)}</div>
   <div class="p5-sec"><div class="p5-k">Food Safety Compliance</div><div class="p5-score">${pubScore(id,sc.overall)}</div>
   <div class="p5-kpis"><div><b>${sc.done}/${sc.tot}</b><span>Requirements met</span></div><div><b>${ec.total}</b><span>Evidence items</span></div><div><b>${sc.missing.length}</b><span>Need attention</span></div></div></div>
   <div class="p5-sec"><div class="p5-k">Needs attention</div><ul class="p5-list">${sc.missing.slice(0,2).map(m=>`<li><span>${esc(m.r.text)}</span><em>${m.why.toUpperCase()}</em></li>`).join("")}</ul></div>
   <div class="p5-sec"><div class="p5-k">Evidence freshness</div><ul class="p5-list">${["kitchen","pest","personal"].map(k=>{const f=fresh(id,k);return `<li><span style="display:flex;gap:10px;align-items:center"><span class="fd fd-${f.st}"></span>${CAT[k].name}</span><em>${f.txt.toUpperCase()}</em></li>`}).join("")}</ul></div>`;
  /* public profile */
  document.getElementById("pmCard").innerHTML=`<div class="p5-top"><div><div class="p5-k">Food Safety Profile · sample</div><div class="p5-n">${esc(r.name)}</div><div class="muted" style="font-size:13px">${esc(r.area)}, ${esc(r.city)}</div></div>${lvl(p.level)}</div>
   <div class="p5-sec"><div class="p5-k">Food Safety Compliance</div><div class="p5-score">${pubScore(id,sc.overall)}<dl class="scoremeta"><dt>Evidence</dt><dd>${ec.total} pieces</dd><dt>Last updated</dt><dd>${ec.last?ago(ec.last):"—"}</dd></dl></div>${barsHTML(sc)}</div>
   <div class="p5-sec" style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:center"><span class="tag tag-off">Official status</span>${st(c[1])}</div>`;
  document.getElementById("pmOpen").onclick=()=>go("detail",id);
  /* journey */
  const pts=[...p.journey.map(j=>({m:j.m,s:j.score,k:j.kind,n:j.notes})),{m:"Sep 2026 · now",s:paused(id)?null:sc.overall,k:paused(id)?"Score paused while an official action is open":"Current",n:sc.missing.length?[sc.missing.length+" requirement"+(sc.missing.length>1?"s":"")+" open"]:["All requirements met"],now:true}];
  document.getElementById("jrChart").innerHTML=`<div class="tl5">${pts.map(q=>`<div class="tl5-i ${q.now?"now":""}"><span class="tl5-m">${esc(q.m)}</span><span class="tl5-dot"></span><b>${q.s==null?"—":q.s+"<small>/100</small>"}</b><span class="k2">${esc(q.k)}</span><ul>${q.n.map(x=>`<li>${esc(x)}</li>`).join("")}</ul></div>`).join("")}</div><p class="tl5-note">Sample: ${esc(r.name)}'s evidence over three months. Scores are recalculated as evidence is added or expires.</p>`;
  /* community */
  const x=REPORTS.find(y=>y.id===1);
  document.getElementById("cmExample").innerHTML=`<div class="p5-top"><div><div class="p5-k">Community report · sample</div><div class="p5-n">${esc(r.name)}</div></div>${rsPill(x.status)}</div>
   <div class="rep"><div class="top"><span class="tag tag-com">Reported ${fmt(x.date)}</span>${x.photo?"<span>Photo attached</span>":""}</div><p style="font-size:17px">${esc(x.text)}</p>
   <div class="resp"><span class="tag tag-self">Restaurant response · ${fmt(x.response.date)}</span><div>${esc(x.response.text)}</div><div class="muted" style="font-size:12px;margin-top:4px">Evidence: ${esc(x.response.ev)}</div></div></div>`;
  document.getElementById("finalSearch").onsubmit=e=>{e.preventDefault();S.q=document.getElementById("finalQ").value;document.getElementById("q").value=S.q;go("tracker")};
  document.getElementById("navSearch").onclick=()=>{go("tracker");setTimeout(()=>document.getElementById("q").focus(),50)};
}
heroCards();initHero();renderHomeExtras();
/* ================= V6: About + How it works ================= */
(function(){
  /* smooth scroll to demo */
  document.getElementById("toDemo").onclick=()=>{document.getElementById("demo").scrollIntoView({behavior:matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth",block:"start"})};

  /* ecosystem draw-in */
  const eco=document.getElementById("eco");
  if("IntersectionObserver" in window){const io=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){eco.classList.add("in");io.disconnect()}}),{threshold:.35});io.observe(eco)}else eco.classList.add("in");

  /* ---------- DEMO ---------- */
  const STEPS=[["Search","platewatch.in"],["Profile","platewatch.in/restaurant/harbour-lane-cafe"],["Record","platewatch.in/restaurant/harbour-lane-cafe/record"],["Evidence","platewatch.in/restaurant/harbour-lane-cafe/evidence"],["Journey","platewatch.in/restaurant/harbour-lane-cafe/journey"],["Report","platewatch.in/report"],["Response","platewatch.in/dashboard/reports"],["Summary","platewatch.in"]];
  const TL=[{d:"16 Sep 2026",a:"Licence suspended",src:"Maharashtra FDA press release (sample)",desc:"Raw and cooked food stored together; blocked drainage near the kitchen."},
            {d:"10 Sep 2026",a:"Inspection recorded",src:"FDA inspection note (sample)",desc:"Routine inspection during the festive-season drive. Deficiencies noted for follow-up."},
            {d:"Mar 2024",a:"Licence active",src:"FSSAI licence search (sample)",desc:"Licence renewed. No regulatory action on record at the time."}];
  const JR=[{m:"JUL 2026",s:78,n:"Self-reported evidence, submitted before any inspection."},
            {m:"AUG 2026",s:61,n:"Score fell: storage and pest-control evidence expired, and one photo was rejected."},
            {m:"SEP 2026",s:null,n:"Corrective evidence uploaded after the suspension. Score paused while an official action is open: our score measures submitted evidence and never overrides an official finding."}];
  const DM={step:0,q:"",typed:false,tl:0,jr:2,cat:"Pest activity",ups:new Set(),sent:false,resp:false,ev:false,rev:false,seen:new Set([0])};
  const body=document.getElementById("brBody"),rail=document.getElementById("rail");
  const card=(k,t)=>`<div class="dm"><div class="dm-k">${k}</div>${t}</div>`;
  function view(){
    const s=DM.step;
    if(s===0)return card("Step 01 · Search",`<h3 class="dm-h">Search restaurant, area or FSSAI number</h3><p class="dm-p">Start with whatever you know: a name, a neighbourhood, or the 14-digit licence number on your bill.</p>
      <form class="dm-search" id="dmForm" role="search"><input id="dmQ" value="${esc(DM.q)}" placeholder="Search restaurant, area or FSSAI number" aria-label="Demo search" autocomplete="off"><button type="submit" id="dmGo">Search</button></form>
      <p class="dm-hint">The demo always opens the sample restaurant, Harbour Lane Café.</p>`);
    if(s===1)return card("Step 02 · Restaurant profile",`<div class="dm-prof" style="margin-top:16px"><div style="display:flex;gap:16px;align-items:center"><span class="mn">HL</span><div><h3 class="dm-h" style="margin:0">Harbour Lane Café</h3><div class="dm-p" style="margin:4px 0 0">Fort, Mumbai · Café</div></div></div><span class="st st-sus">Licence suspended</span></div>
      <div class="dm-k" style="margin-top:24px">Food safety status</div>
      <div class="dm-status"><div><div class="dm-k">Status</div><div class="v">Licence suspended</div></div><div><div class="dm-k">Source</div><div class="v">Maharashtra FDA</div></div><div><div class="dm-k">Date</div><div class="v">16 Sep 2026</div></div></div>
      <p class="dm-p" style="margin-top:24px">The latest official action always sits at the top, above anything the restaurant or diners have said.</p>`);
    if(s===2){const t=TL[DM.tl];return card("Step 03 · See the record",`<h3 class="dm-h">Regulatory history</h3><p class="dm-p">Tap an entry to see where it came from.</p>
      <div class="dm-tl"><ol>${TL.map((x,i)=>`<li><button data-tl="${i}" aria-pressed="${i===DM.tl}"><span>${x.d}</span><b>${x.a}</b></button></li>`).join("")}</ol>
      <div class="dm-detail"><span class="tag tag-off">Official record</span><dl><dt>Action</dt><dd>${t.a}</dd><dt>Date</dt><dd>${t.d}</dd><dt>Source</dt><dd>${t.src}</dd><dt>Details</dt><dd>${t.desc}</dd></dl></div></div>`)}
    if(s===3)return card("Step 04 · See the evidence",`<h3 class="dm-h">What the record shows</h3><p class="dm-p">Three sources, three looks. You can always tell who said what.</p>
      <div class="dm-ev">
        <div class="ev-off"><span class="tag tag-off">Official record</span><div class="row"><b>Licence action</b><span>Suspended</span></div><div class="sub">Source: regulatory authority · 16 Sep 2026</div></div>
        <div class="ev-self"><span class="tag tag-self">Restaurant response</span><div class="row"><b>“Corrective action completed.”</b><span>3 documents · 5 photos</span></div><div class="sub">Evidence uploaded · awaiting platform review</div></div>
        <div class="ev-com"><span class="tag tag-com">Community report</span><div class="row"><b>“Customer reported pest activity.”</b><span class="rs rs-review">Under review</span></div><div class="sub">Moderated before publishing · not a regulatory finding</div></div>
      </div>`);
    if(s===4){const j=JR[DM.jr];return card("Step 05 · See the journey",`<h3 class="dm-h">Compliance journey</h3><p class="dm-p">PlateWatch shows change over time rather than permanently labelling a restaurant. Drag or tap through the months.</p>
      <div class="dm-jr"><div class="pts">${JR.map((x,i)=>`<button class="pt" data-jr="${i}" aria-pressed="${i===DM.jr}"><span class="m">${x.m}</span><b${x.s==null?' class="pz-b"':""}>${x.s==null?"Paused":x.s}</b><i></i></button>`).join("")}</div>
      <input type="range" min="0" max="2" step="1" value="${DM.jr}" id="jrRange" aria-label="Month">
      <div class="note"><b>${j.m.charAt(0)+j.m.slice(1,3).toLowerCase()} · ${j.s==null?"score paused":j.s+"/100"}.</b> ${j.n}</div></div>`)}
    if(s===5)return card("Step 06 · Report something",`<h3 class="dm-h">Saw something concerning?</h3><p class="dm-p"><b style="color:var(--ink)">Demo — nothing will be submitted.</b></p>
      <form class="dm-form" id="dmRep">
        <div><label for="dr-area">Area</label><input id="dr-area" value="Fort, Mumbai"></div>
        <div><label for="dr-cat">Category</label><select id="dr-cat">${["Hygiene","Pest activity","Food storage","Food contamination","Other"].map(c=>`<option ${c===DM.cat?"selected":""}>${c}</option>`).join("")}</select></div>
        <div class="full"><label for="dr-what">What happened</label><textarea id="dr-what" rows="3">Saw a cockroach near the counter at lunch on 20 Sep.</textarea></div>
        <div class="full"><label>Add evidence</label><div class="dm-ups">${["Photo","Video","Receipt"].map(u=>`<button type="button" data-up="${u}" aria-pressed="${DM.ups.has(u)}">+ ${u}</button>`).join("")}</div></div>
        <div class="full"><button class="pillbtn" type="submit">Submit report</button></div>
      </form>${DM.sent?`<div class="dm-ok">Demo: nothing was submitted. In the live product, your report enters moderation as <b>Under review</b> and the restaurant is notified.</div>`:""}`);
    if(s===6)return card("Step 07 · Restaurant response",`<h3 class="dm-h">The restaurant's side.</h3><p class="dm-p">This is what the owner sees in their dashboard.</p>
      <div class="dm-notif"><span><b>New food-safety report.</b> Harbour Lane Café · pest activity · 20 Sep</span></div>
      <div class="dm-acts"><button class="pillbtn ${DM.resp?"out":""} sm" data-act="resp">${DM.resp?"✓ Responded":"Respond"}</button><button class="pillbtn ${DM.ev?"out":""} sm" data-act="ev">${DM.ev?"✓ Evidence uploaded":"Upload evidence"}</button><button class="pillbtn ${DM.rev?"out":""} sm" data-act="rev" ${DM.resp||DM.ev?"":"disabled"}>${DM.rev?"✓ Review requested":"Request review"}</button></div>
      ${DM.resp||DM.ev?`<div class="dm-resp"><span class="tag tag-self">Restaurant response</span>${DM.resp?`<p style="margin:10px 0 0">“Pest-control treatment was completed on 18 September.”</p>`:""}${DM.ev?`<p style="margin:8px 0 0;font-size:14px;color:var(--grey)">Evidence: pest-control-certificate.pdf</p>`:""}<p style="margin:12px 0 0;font-size:14px">Status: <span class="rs ${DM.rev?"rs-verified":"rs-review"}">${DM.rev?"Evidence submitted":"Draft"}</span></p></div>`:""}`);
    return `<div class="dm dm-sum"><div class="dm-k">Summary</div><h3 class="dm-h" style="font-size:clamp(40px,4.4vw,60px)">That's PlateWatch.</h3>
      <div class="eq"><span class="tag tag-off">Official records</span><span class="plus">+</span><span class="tag tag-self">Restaurant evidence</span><span class="plus">+</span><span class="tag tag-com">Community reports</span></div>
      <span class="arrow" aria-hidden="true">↓</span><span class="res">One transparent food-safety profile</span>
      <div style="margin-top:32px"><button class="pillbtn" data-go="tracker">Search a restaurant →</button></div></div>`;
  }
  function render(focus){
    DM.seen.add(DM.step);
    rail.innerHTML=STEPS.map(([l],i)=>`<li><button role="tab" data-st="${i}" aria-selected="${i===DM.step}" class="${DM.seen.has(i)&&i!==DM.step?"done":""}"><span class="n">${String(i+1).padStart(2,"0")}</span><span>${l}</span></button></li>`).join("");
    document.getElementById("brUrl").textContent=STEPS[DM.step][1];
    document.getElementById("brStep").textContent=(DM.step+1)+" / "+STEPS.length;
    document.getElementById("brProg").style.width=((DM.step+1)/STEPS.length*100)+"%";
    body.innerHTML=view();
    const prev=document.getElementById("dmPrev"),next=document.getElementById("dmNext");
    prev.disabled=DM.step===0;
    next.textContent=DM.step===0?"Search →":DM.step===6?"Finish →":DM.step===7?"Restart demo":"Next →";
    bind();
    if(focus){const sel=rail.querySelector('[aria-selected="true"]');if(sel&&sel.scrollIntoView&&innerWidth<=900)sel.scrollIntoView({block:"nearest",inline:"center"})}
  }
  function syncJr(){const x=JR[DM.jr];body.querySelectorAll("[data-jr]").forEach(b=>b.setAttribute("aria-pressed",String(+b.dataset.jr===DM.jr)));const r=document.getElementById("jrRange");if(r)r.value=DM.jr;const n=body.querySelector(".dm-jr .note");if(n)n.innerHTML=`<b>${x.m.charAt(0)+x.m.slice(1,3).toLowerCase()} · ${x.s==null?"score paused":x.s+"/100"}.</b> ${x.n}`}
  function goStep(n){DM.step=Math.max(0,Math.min(7,n));render(true)}
  function bind(){
    const f=document.getElementById("dmForm");
    if(f){f.onsubmit=e=>{e.preventDefault();DM.q=document.getElementById("dmQ").value;goStep(1)};document.getElementById("dmQ").oninput=e=>DM.q=e.target.value}
    const r=document.getElementById("jrRange");if(r)r.oninput=e=>{DM.jr=+e.target.value;syncJr()};
    const rep=document.getElementById("dmRep");if(rep){rep.onsubmit=e=>{e.preventDefault();DM.cat=document.getElementById("dr-cat").value;DM.sent=true;render()};}
  }
  body.addEventListener("click",e=>{
    const t=e.target.closest("[data-tl]");if(t){DM.tl=+t.dataset.tl;render();return}
    const j=e.target.closest("[data-jr]");if(j){DM.jr=+j.dataset.jr;syncJr();return}
    const u=e.target.closest("[data-up]");if(u){DM.ups.has(u.dataset.up)?DM.ups.delete(u.dataset.up):DM.ups.add(u.dataset.up);render();return}
    const a=e.target.closest("[data-act]");if(a){DM[a.dataset.act]=true;render();return}
  });
  body.addEventListener("mouseover",e=>{const j=e.target.closest("[data-jr]");if(j&&+j.dataset.jr!==DM.jr){DM.jr=+j.dataset.jr;syncJr()}});
  rail.addEventListener("click",e=>{const b=e.target.closest("[data-st]");if(b)goStep(+b.dataset.st)});
  document.getElementById("dmPrev").onclick=()=>goStep(DM.step-1);
  document.getElementById("dmNext").onclick=()=>{
    if(DM.step===0){DM.q=document.getElementById("dmQ").value;goStep(1);return}
    if(DM.step===7){Object.assign(DM,{step:0,q:"",typed:false,tl:0,jr:2,ups:new Set(),sent:false,resp:false,ev:false,rev:false,seen:new Set([0])});render(true);typeDemo();return}
    goStep(DM.step+1);
  };
  function typeDemo(){
    if(DM.typed)return;DM.typed=true;
    const txt="Harbour Lane Café",reduce=matchMedia("(prefers-reduced-motion: reduce)").matches;
    const inp=()=>document.getElementById("dmQ");
    if(reduce){DM.q=txt;if(inp())inp().value=txt;return}
    let i=0;const tick=()=>{if(DM.step!==0||!inp())return;if(inp().value!==txt.slice(0,i)&&i>0)return; i++;DM.q=txt.slice(0,i);inp().value=DM.q;if(i<txt.length)setTimeout(tick,70);else{const b=document.getElementById("dmGo");if(b)b.classList.add("pulse")}};
    setTimeout(tick,400);
  }
  render();
  const demo=document.getElementById("demo");
  if("IntersectionObserver" in window){const io=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){typeDemo();io.disconnect()}}),{threshold:.4});io.observe(demo)}

  /* ---------- restaurant mini dashboard ---------- */
  const NOTES=["Owners verify with their FSSAI licence number and a one-time code to the owner's phone.","27 requirements across 7 categories, based on public FSSAI hygiene parameters.","Photos, videos and PDFs, each dated. Evidence expires, so the profile stays live.","Owners are notified of every report and can reply publicly with evidence.","Our team reviews the evidence. Approved profiles show Platform verified."];
  function rsDash(active){
    const id=3,r=D.find(x=>x.id===id),p=PROF[id],sc=scoreOf(id),ec=evCounts(id),nrep=REPORTS.filter(x=>x.rid===id&&RP.visibleToRestaurant(x)).length;
    document.getElementById("rsDash").innerHTML=`
      <div class="p5-top" data-hl="0"><div><div class="p5-k">Restaurant dashboard · sample</div><div class="p5-n">${esc(r.name)}</div><div class="muted" style="font-size:13px">Claimed by owner · ${esc(r.area)}, ${esc(r.city)}</div></div><span data-hl="4">${lvl(p.level)}</span></div>
      <div class="p5-sec"><div class="p5-k">Food Safety Compliance</div><div class="p5-score">${pubScore(id,sc.overall)}</div>
      <div class="p5-kpis"><div data-hl="1"><b>${sc.done}/${sc.tot}</b><span>Requirements complete</span></div><div data-hl="2"><b>${ec.total}</b><span>Evidence submissions</span></div><div data-hl="3"><b>${nrep}</b><span>Community reports</span></div></div></div>`;
    document.querySelectorAll("#rsDash [data-hl]").forEach(el=>el.classList.toggle("hl",+el.dataset.hl===active));
    document.getElementById("rsNote").textContent=NOTES[active];
    document.querySelectorAll("#rsteps [data-rs]").forEach(b=>b.setAttribute("aria-pressed",String(+b.dataset.rs===active)));
  }
  document.getElementById("rsteps").addEventListener("click",e=>{const b=e.target.closest("[data-rs]");if(b)rsDash(+b.dataset.rs)});
  rsDash(0);
})();



renderSeg();renderList();syncAuthBtn();
{const t=parseHash(location.hash);if(t)go(t.p,t.arg,{fromHash:true});else history.replaceState(null,"","#home")}
}
