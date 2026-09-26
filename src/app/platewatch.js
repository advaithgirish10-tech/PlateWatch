/*
 * PlateWatch app logic: router, tracker, profiles, OTP login, restaurant dashboard, homepage, About and How it works.
 * It drives the DOM rendered by App.jsx. Restaurants, accounts, claims, the dashboard, reports and admin all come
 * from the API (api.js). Only the homepage illustrations and the How-it-works demo use the fixed sample records below.
 * QRCode is a global loaded in index.html (qrcodejs 1.0.0).
 */
/* global QRCode */
import { api, localPhone, uploadFile, MODE, openTab } from "./api.js";
import { createAdmin } from "./admin.js";
import { createCamera } from "./camera.js";
import { createRemark } from "./remark.js";
import { createReporting } from "./bot.js";
import { createSpotChecks } from "./spotcheck.js";
import { createMap, dotHTML, badgeHTML, badgeLabel, pausedNote, legendHTML } from "./map.js";
export function initApp() {
const TYPES={sus:["Suspended","st-sus",""],rev:["Revoked","st-rev",""],imp:["Improvement notice","st-imp",""],ok:["Reinstated","st-ok",""],none:["No official action","st-none",""]};
/* fictional records for the homepage illustrations only (hero cards, previews, How it works); never shown as real data */
const SAMPLE=[
 {id:1,name:"Harbour Lane Café",area:"Fort",city:"Mumbai",cat:"Café",hist:[["2026-09-16","sus","Raw and cooked food stored together; blocked drainage near kitchen"]]},
 {id:3,name:"Green Leaf Dhaba",area:"Hinjewadi",city:"Pune",cat:"Dhaba",hist:[["2026-08-02","imp","Food handlers without medical certificates; no pest control records"],["2026-09-21","ok","Compliance confirmed on re-inspection"]]}
];
const SAMPLE_GREEN=SAMPLE[1];
/* today in India; evidence ages and expiry count from here */
const TODAY=new Date(new Date().toLocaleDateString("en-CA",{timeZone:"Asia/Kolkata"}));
const cur=r=>r.hist[r.hist.length-1];
const fmt=s=>new Date(s).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"});
const st=t=>`<span class="st ${TYPES[t][1]}"><i>${TYPES[t][2]}</i>${TYPES[t][0]}</span>`;
const esc=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

/* restaurants the site has fetched from the API, by id: names for Back buttons, the chat and claims.
   cat and lic are the short names the older code (chat, claims) uses. */
const PLACES=new Map();
const remember=list=>list.forEach(r=>PLACES.set(r.id,{...PLACES.get(r.id),...r,cat:r.category,lic:r.licenceNumber}));
const place=id=>PLACES.get(id);

/* app state (in memory) */
const S={q:"",city:"",type:"",sort:"new",user:null,follows:new Set(),areas:[],after:null};

/* toast */
let tt;function toast(m){const t=document.getElementById("toast");t.textContent=m;t.hidden=false;clearTimeout(tt);tt=setTimeout(()=>t.hidden=true,2800)}

/* routing */
const pages=["home","tracker","detail","report","verify","login","account","biz","dash","admin","about"];
/* each page has a #hash (letters, digits, hyphens) so browser back/forward and deep links work */
const PAGE_HASH={home:"home",tracker:"tracker",report:"report",verify:"how-it-works",login:"login",account:"account",biz:"restaurants",dash:"dashboard",admin:"admin",about:"about"};
const PAGE_NAME={home:"Home",tracker:"Tracker",report:"Report",verify:"How it works",login:"Log in",account:"Your alerts",biz:"For restaurants",dash:"Dashboard",admin:"Admin",about:"About"};
const hashFor=(p,arg)=>p==="detail"?"profile-"+arg:p==="login"&&arg==="owner"?"owner-login":PAGE_HASH[p];
function parseHash(h){
  h=(h||"").replace(/^#/,"");
  /* any profile number is accepted here; the profile page says so if it doesn't exist */
  const m=h.match(/^profile-(\d+)$/);if(m)return {p:"detail",arg:+m[1]};
  if(h==="tracker-map")return {p:"tracker"};   /* old link: the tracker is the map now */
  if(h==="owner-login")return {p:"login",arg:"owner"};
  const p=Object.keys(PAGE_HASH).find(k=>PAGE_HASH[k]===h);return p?{p}:null;
}
S.page={p:"home"};S.stack=[];
/* where a profile's Back button should go: the last page visited that isn't login or this same profile */
function backTarget(id){for(let i=S.stack.length-1;i>=0;i--){const e=S.stack[i];if(e.p==="login"||(e.p==="detail"&&e.arg===id))continue;return e}return {p:"tracker"}}
const pageName=e=>e.p==="detail"?(place(e.arg)?place(e.arg).name:"restaurant"):PAGE_NAME[e.p];
function go(p,arg,opt){
  /* the restaurant dashboard has its own tab and its own login: from the user site it opens a new tab */
  if(MODE==="user"&&(p==="biz"||p==="dash"||(p==="login"&&arg==="owner"))){
    if(opt&&opt.fromHash){toast("Restaurant owners: use “For restaurants”. The dashboard opens in its own tab.");p="home";arg=undefined}
    else{openTab("owner",p==="login"?"owner-login":hashFor(p,arg));toast("The restaurant dashboard opened in a new tab.");return}
  }
  if(MODE==="owner"){
    /* the owner tab has no user pages: logins are owner logins, reports and admin open the user site in a new tab */
    if(p==="login")arg="owner";
    if(p==="account"){if(S.user){p=S.owner!=null?"dash":"biz";arg=S.owner!=null?"overview":undefined}else{p="login";arg="owner"}}
    if(p==="admin"){openTab("user","admin");toast("Admin opened in a new tab, with your user login.");return}
  }
  /* the owner login, already signed in: straight to the dashboard, or to claiming a restaurant */
  if(p==="login"&&arg==="owner"&&S.user){p=S.owner!=null?"dash":"biz";arg=S.owner!=null?"overview":undefined}
  if(p==="account"&&!S.user){S.after="account";p="login"}
  /* staff only: signed-out visitors log in first, everyone else goes home */
  if(p==="admin"&&!isAdmin()){if(!S.user){S.after="admin";p="login"}else{toast("That page is for PlateWatch staff only.");p="home";arg=undefined}}
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
  if(p==="tracker")renderTracker();
  if(p==="biz")renderBiz(arg);
  if(p==="dash")openDash(arg||"overview");
  if(p==="admin")ADM.show(arg||"verify");
  window.scrollTo(0,0);
}
addEventListener("hashchange",()=>{
  const h=location.hash.slice(1);if(h===hashFor(S.page.p,S.page.arg))return;
  const t=parseHash(h);go(t?t.p:"home",t&&t.arg,{fromHash:true});
});
document.addEventListener("click",e=>{const b=e.target.closest("[data-go]");if(!b)return;e.preventDefault();go(b.dataset.go);
  /* a link to a section of a page, e.g. the FAQ on About */
  const a=b.dataset.anchor&&document.getElementById(b.dataset.anchor);if(a)a.scrollIntoView()});
document.getElementById("menuBtn").onclick=e=>{const d=document.getElementById("drawer");d.hidden=!d.hidden;e.currentTarget.setAttribute("aria-expanded",String(!d.hidden))};
document.getElementById("authBtn").onclick=()=>{
  if(MODE==="owner"){if(S.user)go(S.owner!=null?"dash":"biz",S.owner!=null?"overview":undefined);else go("login","owner");return}
  if(S.user){go("account");return}S.after="account";go("login")};
/* the diner login from the owner tab opens the user site in its own tab */
document.addEventListener("click",e=>{if(e.target.closest("[data-user-tab]")){e.preventDefault();openTab("user","login");toast("PlateWatch opened in a new tab for your user login.")}});
/* the owner tab says what it is */
if(MODE==="owner"){const b=document.getElementById("modeBar");if(b)b.hidden=false;document.title="PlateWatch for restaurants";document.documentElement.classList.add("owner-tab")}
document.addEventListener("click",e=>{if(e.target.closest("[data-owner-login]")){e.preventDefault();go("login","owner")}});
/* the role comes from the API session; admin links only show for staff, and a signed-out admin leaves the page */
const isAdmin=()=>!!S.user&&S.user.role==="admin";
function syncAuthBtn(){
  document.getElementById("authBtn").textContent=MODE==="owner"?(S.user?"Dashboard":"Owner login"):(S.user?"My alerts":"Log in");
  document.querySelectorAll("[data-staff]").forEach(el=>el.hidden=!isAdmin());
  if(!isAdmin()&&S.page&&S.page.p==="admin")go("home");
}


/* ---------- FLOW FIXES: shared helpers ---------- */
/* the PlateWatch score is never shown publicly while an official action is open (the API says so per restaurant) */
const paused=rid=>!!(PROF[rid]&&PROF[rid].pausedPublicly);
const pausedHTML=()=>`<div class="pz"><p class="pz-t">Compliance score paused while an official action is open.</p><details class="pz-why"><summary>Why?</summary><p>Our compliance score measures submitted evidence. It never overrides an official finding.</p></details></div>`;
function pubScore(rid,n){return paused(rid)?pausedHTML():`<div class="score">${n}<small>/100</small></div>`}
const progHTML=(done,tot)=>`<div class="prog"><div class="prog-l"><b>${done} of ${tot}</b> requirements met</div><span class="prog-t" aria-hidden="true"><i style="width:${tot?Math.round(done/tot*100):0}%"></i></span></div>`;

/* instant search: combobox + listbox, shared by home and tracker; suggestions come from the API's search */
const searchAPI=q=>api("GET","/search?q="+encodeURIComponent(q)).then(d=>{remember(d.items);return d.items});
function attachSuggest(input,panel,{onPick,noResults}){
  const wrap=panel.parentNode,lb=panel.id+"-lb";let items=[],act=-1,open=false,seq=0,timer=null;
  input.setAttribute("role","combobox");input.setAttribute("aria-autocomplete","list");input.setAttribute("aria-expanded","false");input.setAttribute("aria-controls",lb);
  const close=()=>{open=false;panel.hidden=true;items=[];act=-1;input.setAttribute("aria-expanded","false");input.removeAttribute("aria-activedescendant")};
  const show=(q,list)=>{
    items=list.slice(0,6);act=-1;input.removeAttribute("aria-activedescendant");
    if(!items.length){input.setAttribute("aria-expanded","false");if(!noResults){close();return}panel.innerHTML=noResults(q);panel.hidden=false;open=true;return}
    panel.innerHTML=`<ul role="listbox" id="${lb}" aria-label="Matching restaurants">${items.map((r,i)=>`<li role="option" id="${lb}-${i}" data-sid="${r.id}" aria-selected="false"><span class="sg-main"><span class="sg-n">${dotHTML(r.dot)}<span>${esc(r.name)}</span>${badgeHTML(r.badge)}</span><span class="sg-a">${esc(r.area)}, ${esc(r.city)} · ${esc(r.category)}</span></span>${st(r.status||"none")}</li>`).join("")}</ul>`;
    panel.hidden=false;open=true;input.setAttribute("aria-expanded","true");
  };
  /* two characters or more; typing quickly sends one request, and a slow old answer never replaces a newer one */
  const draw=()=>{
    clearTimeout(timer);const q=input.value.trim();if(q.length<2){close();return}
    timer=setTimeout(async()=>{
      const my=++seq;let list;
      try{list=await searchAPI(q)}catch(err){if(my===seq){items=[];panel.innerHTML=`<div class="nores"><p>${esc(err.message)}</p></div>`;panel.hidden=false;open=true}return}
      if(my===seq&&input.value.trim()===q)show(q,list);
    },150);
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
  panel.addEventListener("click",e=>{const o=e.target.closest("[data-sid]");if(o)pick(items.find(x=>x.id===+o.dataset.sid))});
  document.addEventListener("pointerdown",e=>{if(open&&!wrap.contains(e.target))close()});
  wrap.addEventListener("focusout",e=>{if(open&&e.relatedTarget&&!wrap.contains(e.relatedTarget))close()});
  return {close};
}
/* shown wherever a search finds nothing */
const noResHTML=q=>`<div class="nores"><p><b>Nothing on record for “${esc(q)}”.</b> This is not a guarantee of hygiene.</p>
  <div class="nores-acts"><button type="button" class="pillbtn sm" data-nr="report" data-q="${esc(q)}">Report a problem</button><button type="button" class="pillbtn out sm" data-nr="exists" aria-expanded="false">Tell us this place exists</button></div>
  <form class="nr-form" hidden><div><label>Name<input class="input" name="nm" required minlength="2" maxlength="120" value="${esc(q)}"></label></div><div><label>Area<input class="input" name="ar" required minlength="2" maxlength="120" placeholder="e.g. Dadar West"></label></div><div><button class="pillbtn sm" type="submit">Send</button></div></form></div>`;
document.addEventListener("click",e=>{
  const b=e.target.closest("[data-nr]");if(!b)return;
  if(b.dataset.nr==="report"){openReport(null,"",b.dataset.q);return}
  const f=b.closest(".nores").querySelector(".nr-form");f.hidden=!f.hidden;b.setAttribute("aria-expanded",String(!f.hidden));if(!f.hidden)f.querySelector("[name=ar]").focus();
});
/* "Tell us this place exists" goes to staff as a place suggestion */
document.addEventListener("submit",async e=>{const f=e.target.closest(".nr-form");if(!f)return;e.preventDefault();
  try{await api("POST","/place-suggestions",{name:f.nm.value.trim(),area:f.ar.value.trim()});toast("Thanks, we'll check it")}catch(err){toast(err.message);return}
  f.hidden=true;f.reset();const b=f.closest(".nores").querySelector('[data-nr="exists"]');if(b)b.setAttribute("aria-expanded","false")});
/* clipboard with a select-the-text fallback */
function copyText(text,okMsg,fallback){
  const fail=()=>{fallback();toast("Press copy to finish")};
  try{if(!navigator.clipboard||!navigator.clipboard.writeText)return fail();navigator.clipboard.writeText(text).then(()=>toast(okMsg),fail)}catch(_){fail()}
}
function selectNode(el){const s=getSelection(),g=document.createRange();g.selectNodeContents(el);s.removeAllRanges();s.addRange(g)}

/* home: the numbers and the ticker of latest official actions come from the API */
async function loadHome(){
  const numbers=document.getElementById("numbers"),ticker=document.getElementById("ticker");
  const render=s=>[[s&&s.tracked,"Food establishments tracked"],[s&&s.improvementNotices,"Improvement notices logged"],[s&&s.suspended,"Licences suspended"],[s&&s.cities,"Cities and counting"]].map(([n,l])=>`<div><b>${n==null?"—":n}</b><span>${l}</span></div>`).join("");
  numbers.innerHTML=render(null);
  try{
    const [s,latest]=await Promise.all([api("GET","/stats"),api("GET","/actions/latest?limit=10")]);
    numbers.innerHTML=render(s);
    const tick=latest.items.map(a=>`<span class="it"><span class="dot d-${a.type}"></span><b>${esc(a.name)}</b><span>${a.type==="ok"?"Cleared":TYPES[a.type][0]}</span><span class="m">${esc(a.area)} · ${fmt(a.actionOn)}</span></span>`).join("");
    ticker.innerHTML=tick+tick;
  }catch(_){/* the numbers stay as dashes; browsing still works */}
}
document.getElementById("homeSearch").onsubmit=e=>{e.preventDefault();S.q=document.getElementById("homeQ").value;document.getElementById("q").value=S.q;S.pendingSearch=S.q;go("tracker")};
attachSuggest(document.getElementById("homeQ"),document.getElementById("homeSug"),{onPick:r=>go("detail",r.id),noResults:noResHTML});
attachSuggest(document.getElementById("finalQ"),document.getElementById("finalSug"),{onPick:r=>go("detail",r.id),noResults:noResHTML});
document.querySelectorAll("[data-try]").forEach(b=>b.onclick=()=>{S.q=b.dataset.try;document.getElementById("q").value=S.q;go("tracker")});

/* tracker */
api("GET","/cities").then(d=>d.items.forEach(c=>{const o=document.createElement("option");o.value=c;o.textContent=c;document.getElementById("city").append(o)}),()=>{});
const segDefs=[["","All"],["red","Suspended or revoked"],["amber","Improvement notice"],["green","Reinstated"],["grey","No official action"]];
const verDefs=[["","All"],["verified","PlateWatch verified"],["claimed","Claimed"],["none","Not claimed yet"]];
const licDefs=[["","All"],["active","Active on FSSAI"],["inactive","Inactive or not found"],["unchecked","Not checked yet"]];
S.ver="";S.lic="";
function renderSeg(){
  document.getElementById("seg").innerHTML=segDefs.map(([v,l])=>`<button type="button" data-v="${v}" aria-pressed="${S.type===v}">${v?`<span class="sdot sdot-${v}" aria-hidden="true"></span>`:""}${l}</button>`).join("");
  document.getElementById("segVer").innerHTML=verDefs.map(([v,l])=>`<button type="button" data-ver="${v}" aria-pressed="${S.ver===v}">${l}</button>`).join("");
  document.getElementById("segLic").innerHTML=licDefs.map(([v,l])=>`<button type="button" data-lic="${v}" aria-pressed="${S.lic===v}">${l}</button>`).join("");
}
document.getElementById("seg").onclick=e=>{const b=e.target.closest("button");if(!b)return;S.type=b.dataset.v;renderSeg();applyFilters()};
document.getElementById("segVer").onclick=e=>{const b=e.target.closest("button");if(!b)return;S.ver=b.dataset.ver;renderSeg();applyFilters()};
document.getElementById("segLic").onclick=e=>{const b=e.target.closest("button");if(!b)return;S.lic=b.dataset.lic;renderSeg();applyFilters()};
function applyFilters(){if(S.page.p==="tracker")MAP.refresh()}
/* the Tracker is the map: filters, legend, then the map with its results panel */
function renderTracker(){
  document.getElementById("dotLegend").innerHTML=legendHTML();
  MAP.show().then(()=>{if(S.pendingSearch){const q=S.pendingSearch;S.pendingSearch=null;MAP.searchGo(q)}});
}
document.getElementById("q").oninput=e=>{S.q=e.target.value;applyFilters()};
attachSuggest(document.getElementById("q"),document.getElementById("qSug"),{onPick:r=>MAP.focusPlace(r.id,r)});
/* Enter with no suggestion selected: fly to the best match, or fit an area */
document.getElementById("q").addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.defaultPrevented){e.preventDefault();MAP.searchGo(S.q)}});
document.getElementById("city").onchange=e=>{S.city=e.target.value;applyFilters()};
document.getElementById("sort").onchange=e=>{S.sort=e.target.value;applyFilters()};

/* report: every [data-bot] button opens the "Write your Remark" form (the profile's buttons pass the restaurant) */
const $=id=>document.getElementById(id);
document.addEventListener("click",e=>{const b=e.target.closest("[data-bot]");if(!b)return;e.preventDefault();openReport(b.dataset.botRid?+b.dataset.botRid:null)});
$("rfCopy").onclick=()=>{
  const mine=S.user?REPORTS.filter(x=>x.user===S.user.phone).sort((a,b)=>b.ts-a.ts)[0]:null;
  const t=RP.complaintText(mine||null);
  const ta=$("rfComplaint");ta.value=t;
  copyText(t,"Complaint copied",()=>{ta.hidden=false;ta.focus();ta.select()});
};
document.getElementById("copyg").onclick=()=>{const t=document.getElementById("gmail").textContent;navigator.clipboard?.writeText(t).then(()=>toast("Copied")).catch(()=>{const s=getSelection(),g=document.createRange();g.selectNodeContents(document.getElementById("gmail"));s.removeAllRanges();s.addRange(g);toast("Selected. Press copy.")})};

/* ---------- sign-in, through the API (login page, restaurant claim and the WhatsApp chat share it) ---------- */
const VIA={whatsapp:"on WhatsApp ",sms:"by SMS ",console:""};
const sentTo=(ph,ch)=>`Sent ${VIA[ch]||""}to +91 ${ph.slice(0,5)} ${ph.slice(5)}`;
/* the development API has no SMS or WhatsApp account, so it prints codes in its own terminal */
const devHint=ch=>ch==="console"?`<p class="muted" style="font-size:13px;margin-top:6px">Development server: the code is printed in the API terminal.</p>`:"";
const errHTML=m=>`<div class="err">${esc(m)}</div>`;
const fmtPhone=ph=>ph.slice(0,5)+" "+ph.slice(5);
const SIGNIN={
  request:ph=>api("POST","/auth/otp/request",{phone:ph}),
  verify:async(ph,code,consent)=>{const {user}=await api("POST","/auth/otp/verify",{phone:ph,code,consent});await signedIn(user);return user}
};
/* the API signed someone in: keep their details, then load their follows and watched areas */
async function signedIn(user){
  S.user={id:user.id,phone:localPhone(user.phone),name:user.name||"",wa:user.whatsappAlerts,role:user.role,owned:user.ownedRestaurantIds||[]};
  if(S.owner==null&&user.ownedRestaurantIds&&user.ownedRestaurantIds.length)S.owner=user.ownedRestaurantIds[0];
  RP.registerNumber(S.user.phone);syncAuthBtn();
  try{
    const [f,a]=await Promise.all([api("GET","/me/follows"),api("GET","/me/areas")]);
    S.follows=new Set(f.items.map(x=>x.id));S.areas=a.items;
  }catch(e){toast(e.message)}
}
function signedOut(){S.user=null;S.follows=new Set();S.areas=[];S.owner=null;S.ownerReports=null;consent=false;syncAuthBtn()}
/* follow or unfollow right away, and undo it if the API says no */
async function setFollow(id,on){
  on?S.follows.add(id):S.follows.delete(id);
  try{await api(on?"PUT":"DELETE","/me/follows/"+id);return true}
  catch(e){on?S.follows.delete(id):S.follows.add(id);toast(e.message);return false}
}
async function addArea(area){
  await api("POST","/me/areas",{area});
  S.areas=(await api("GET","/me/areas")).items;
}

/* login page: number and consent, then the code */
let phone="",timer=null,consent=false,otpInfo=null,busy=false;
const DINER_ART=document.getElementById("authArt").innerHTML;
const OWNER_ART=`<div class="eyebrow" style="color:#9A9A9A">For restaurant owners</div>
  <div><h2 class="h-big">Show diners your kitchen.</h2>
  <ul style="margin-top:30px">
    <li><b>→</b><span><b>Answer the checkup:</b> questions on food and kitchen hygiene.</span></li>
    <li><b>→</b><span><b>Prove it with photos</b> of your kitchen. Approved photos appear in your Kitchen gallery.</span></li>
    <li><b>→</b><span><b>Reply to reports</b> about your restaurant, next to the report.</span></li>
  </ul></div>`;
const isOwnerLogin=()=>S.page.p==="login"&&S.page.arg==="owner";
function renderAuth(step){
  const P=document.getElementById("authPanel");clearInterval(timer);
  const owner=isOwnerLogin();
  document.getElementById("authArt").innerHTML=owner?OWNER_ART:DINER_ART;
  if(step==="phone"){
    const ok=v=>/^[6-9]\d{9}$/.test(v);
    const head=owner?`<div class="eyebrow">Restaurant owner login · step 1 of 2</div><h2 class="h-big" style="margin-top:12px">Owner's mobile number</h2>
    <p class="muted" style="margin-top:12px">The number you manage your restaurant with. We'll send a 6-digit code on WhatsApp or by SMS.</p>`
    :`<div class="eyebrow">Step 1 of 2</div><h2 class="h-big" style="margin-top:12px">Your mobile number</h2>
    <p class="muted" style="margin-top:12px">We'll send a 6-digit code on WhatsApp or by SMS. Used only for alerts you choose.</p>`;
    P.innerHTML=`${head}
    <form id="pf"><div class="phonefield"><span>+91</span><input id="ph" inputmode="numeric" autocomplete="tel-national" maxlength="10" placeholder="98765 43210" aria-label="10-digit mobile number" value="${phone}"></div>
    <div id="perr"></div>
    <label class="check" style="margin-top:22px"><input type="checkbox" id="lconsent" ${consent?"checked":""}><span>${owner?"PlateWatch stores this number to manage my restaurant's profile. I can delete it anytime.":"PlateWatch stores my number only to send alerts I choose. I can delete it anytime."}</span></label>
    <div class="row-actions"><button class="pillbtn" id="sendBtn" type="submit" ${ok(phone)&&consent?"":"disabled"}>Send code</button><span class="muted">${owner?`Not an owner? <button class="x" type="button" data-user-tab>Log in as a user</button> (opens in a new tab)`:`Own a restaurant? <button class="x" type="button" data-owner-login>Restaurant owner login</button> (opens in a new tab)`}</span></div></form>`;
    const ph=document.getElementById("ph"),cb=document.getElementById("lconsent"),btn=document.getElementById("sendBtn");ph.focus();
    const sync=()=>{btn.disabled=busy||!(ok(ph.value)&&cb.checked)};
    ph.oninput=()=>{ph.value=ph.value.replace(/\D/g,"").slice(0,10);sync();document.getElementById("perr").innerHTML=""};
    cb.onchange=()=>{consent=cb.checked;sync()};
    document.getElementById("pf").onsubmit=async e=>{e.preventDefault();
      if(!ok(ph.value)){document.getElementById("perr").innerHTML=errHTML("Enter a 10-digit Indian mobile number starting with 6, 7, 8 or 9.");return}
      if(!cb.checked||busy)return;
      phone=ph.value;busy=true;btn.textContent="Sending…";sync();
      try{otpInfo=await SIGNIN.request(phone);busy=false;renderAuth("otp")}
      catch(err){busy=false;btn.textContent="Send code";sync();document.getElementById("perr").innerHTML=errHTML(err.message)}
    };
  }
  if(step==="otp"){
    P.innerHTML=`<div class="eyebrow">Step 2 of 2</div><h2 class="h-big" style="margin-top:12px">Enter the code</h2>
    <p class="muted" style="margin-top:12px">${sentTo(phone,otpInfo.channel)} · <button class="x" id="chg">Change number</button></p>${devHint(otpInfo.channel)}
    <div class="otp" id="otp">${Array.from({length:6},(_,i)=>`<input inputmode="numeric" maxlength="1" aria-label="Digit ${i+1}" id="o${i}"${i===0?' autocomplete="one-time-code"':""}>`).join("")}</div>
    <div id="oerr"></div>
    <div class="row-actions"><button class="pillbtn" id="verBtn" disabled>Verify</button><button class="x" id="resend" disabled></button></div>`;
    const boxes=[...document.querySelectorAll("#otp input")],oerr=document.getElementById("oerr"),verBtn=document.getElementById("verBtn");boxes[0].focus();
    const val=()=>boxes.map(b=>b.value).join("");
    const verify=async v=>{
      if(busy)return;busy=true;verBtn.disabled=true;oerr.innerHTML="";
      try{const user=await SIGNIN.verify(phone,v,consent);busy=false;finishLogin(user)}
      catch(err){
        busy=false;oerr.innerHTML=errHTML(err.message);
        boxes.forEach(b=>b.value="");
        /* a used-up or expired code can't be retried: only "Resend code" helps */
        if(err.code==="TOO_MANY_ATTEMPTS"||err.details.code==="CODE_EXPIRED")boxes.forEach(b=>b.disabled=true);else boxes[0].focus();
      }
    };
    const upd=()=>{verBtn.disabled=busy||val().length!==6;if(val().length===6)verify(val())};
    boxes.forEach((b,i)=>{
      b.oninput=()=>{b.value=b.value.replace(/\D/g,"").slice(-1);if(b.value&&i<5)boxes[i+1].focus();oerr.innerHTML="";upd()};
      b.onkeydown=e=>{if(e.key==="Backspace"&&!b.value&&i>0)boxes[i-1].focus()};
      b.onpaste=e=>{e.preventDefault();const d=(e.clipboardData.getData("text")||"").replace(/\D/g,"").slice(0,6);d.split("").forEach((c,k)=>boxes[k].value=c);boxes[Math.min(d.length,5)].focus();upd()};
    });
    verBtn.onclick=()=>verify(val());
    document.getElementById("chg").onclick=()=>renderAuth("phone");
    const rs=document.getElementById("resend");
    let left=(otpInfo.resendInSeconds||30)+1;
    const tickR=()=>{left--;rs.textContent=left>0?`Resend in 0:${String(left).padStart(2,"0")}`:"Resend code";rs.disabled=left>0;if(left<=0)clearInterval(timer)};
    tickR();timer=setInterval(tickR,1000);
    rs.onclick=async()=>{rs.disabled=true;
      try{otpInfo=await SIGNIN.request(phone);renderAuth("otp");toast("New code sent")}
      catch(err){oerr.innerHTML=errHTML(err.message);rs.disabled=false}
    };
  }
}
/* no profile step: pre-fill the watched area from the place being followed, then return to where the user started */
async function finishLogin(){
  const nx=S.after;S.after=null;
  /* owners land on their dashboard, or on finding their restaurant to claim */
  if(isOwnerLogin()){
    if(S.owner!=null){toast("Welcome back");go("dash","overview")}
    else{toast("You're in. Find your restaurant to claim it.");go("biz")}
    return;
  }
  if(nx&&nx.follow){
    await setFollow(nx.follow,true);
    const r=place(nx.follow);
    if(r&&!S.areas.some(a=>a.area.toLowerCase()===r.area.toLowerCase()))await addArea(r.area).catch(()=>{});
    toast("You're in. Following this place now.");go("detail",nx.follow);
  }
  else if(nx&&nx.report){toast("You're in.");go(nx.back.p,nx.back.arg);openReport(nx.rid,nx.name,nx.q)}
  else if(nx==="admin"){toast("You're in.");go("admin")}
  else{toast("You're in. Alerts are on.");go("account")}
}

/* report from a profile: sign in first, then the "Write your Remark" form */
/* one live camera for checkup evidence and report photos */
const CAM=createCamera({esc,toast});
const REMARK=createRemark({esc,toast,api,uploadFile,camera:CAM,limits:{day:1,week:5},owns:id=>!!S.user&&(S.user.owned||[]).includes(id)});
/* id: a restaurant, or null to choose one in the form; q pre-fills that search */
function openReport(id,name,q){
  if(MODE==="owner"){openTab("user",id?"profile-"+id:"report");toast("Reports are sent from your user login, so PlateWatch opened in a new tab.");return}
  if(!S.user){S.after={report:true,rid:id||null,name,q,back:{...S.page}};toast("Log in with your number to send a report");go("login");return}
  if(id&&(S.user.owned||[]).includes(id)){toast("You manage this restaurant, so you can't report it.");return}
  REMARK.open(id?{rid:id,name:name||(place(id)||{}).name||"This restaurant"}:{q:q||""});
}

/* a moderator asked for more: one more camera photo goes onto the report */
document.addEventListener("click",e=>{
  const b=e.target.closest("[data-addmore]");if(!b)return;
  CAM.open(`More evidence for ${b.dataset.ref}`,async file=>{
    toast("Uploading…");
    try{const uploadId=await uploadFile(file,"report");await api("POST",`/reports/${b.dataset.addmore}/evidence`,{evidence:[{uploadId}]});toast("Added. A moderator will look again within 24 hours.");renderMyReports()}
    catch(err){toast(err.message)}
  });
});

/* account */
function renderAccount(){
  document.getElementById("accPhone").textContent="Signed in · +91 "+fmtPhone(S.user.phone);
  document.getElementById("accHello").textContent=S.user.name?`${S.user.name}'s alerts`:"Your alerts";
  renderFollows();
  document.getElementById("accName").value=S.user.name||"";
  document.getElementById("waToggle").checked=S.user.wa!==false;
  document.getElementById("waLabel").textContent=`Send alerts on WhatsApp to +91 ${fmtPhone(S.user.phone)}`;
  renderMyReports();
  document.getElementById("areaList").innerHTML=S.areas.map(a=>{const n=a.actions||0;return `<div class="follow"><div><b>${esc(a.area)}</b><div class="muted">${n} logged ${n===1?"action":"actions"}</div></div><button class="x" data-rma="${a.id}">Remove</button></div>`}).join("")||`<p class="muted" style="padding-top:14px">No areas yet.</p>`;
}
document.getElementById("p-account").addEventListener("click",async e=>{
  const o=e.target.closest("[data-open]"),u=e.target.closest("[data-unf]"),a=e.target.closest("[data-rma]");
  if(o)go("detail",+o.dataset.open);
  if(u){const ok=await setFollow(+u.dataset.unf,false);renderAccount();if(ok)toast("Unfollowed")}
  if(a){const id=+a.dataset.rma;
    try{await api("DELETE","/me/areas/"+id);S.areas=S.areas.filter(x=>x.id!==id);renderAccount()}catch(err){toast(err.message)}}
});
/* followed places, fresh from the API (their status may have changed since login) */
async function renderFollows(){
  const el=document.getElementById("followList");
  if(!el.innerHTML)el.innerHTML=`<p class="muted" style="padding-top:14px">Loading…</p>`;
  let fl;
  try{fl=(await api("GET","/me/follows")).items}catch(e){el.innerHTML=`<p class="muted" style="padding-top:14px">${esc(e.message)}</p>`;return}
  remember(fl);S.follows=new Set(fl.map(r=>r.id));
  el.innerHTML=fl.length?fl.map(r=>`<div class="follow"><div><b>${esc(r.name)}</b><div class="muted">${esc(r.area)} · ${st(r.status||"none")}</div></div><div style="display:flex;gap:14px"><button class="x" data-open="${r.id}">View</button><button class="x" data-unf="${r.id}">Unfollow</button></div></div>`).join(""):`<p class="muted" style="padding-top:14px">Not following anyone yet. Open any entry and tap "Follow for alerts".</p>`;
}
/* what the reporter sees, from the API: Awaiting moderation → Accepted → Restaurant notified → Sent to FDA Maharashtra → Official action taken */
const EVK={photo:"photo",video:"video",bill:"bill",note:"doctor's note"};
function myReportHTML(x){
  const i=x.stage,ev=x.evidence.length?`${x.evidence.length} (${x.evidence.map(k=>EVK[k]).join(", ")})`:"None";
  const steps=i<0?`<p class="myrep-dis">Couldn't be used: ${esc(x.rejectReason||"not substantiated after review")}.</p>`
    :`<ol class="rstep${x.share?"":" rstep-2"}" aria-label="Report status">${x.stages.map((st,k)=>`<li class="${k<i?"done":k===i?"now":""}"${k===i?' aria-current="step"':""}><span>${esc(st)}</span></li>`).join("")}</ol>
    ${!x.share?`<p class="myrep-dis">Kept private: used only to spot patterns, never shared with the restaurant or the regulator.</p>`:!x.evidence.some(k=>k!=="note")?`<p class="myrep-dis">No photo, video or bill, so this report can't be sent to the regulator.</p>`:""}
    ${x.askMore?`<p class="myrep-dis">A moderator asked for more. <button class="x" type="button" data-addmore="${x.id}" data-ref="${esc(x.ref)}">Add a photo with the camera</button></p>`:""}`;
  return `<div class="myrep"><div class="myrep-top"><b>${esc(x.place)}</b><span class="myrep-ref">${esc(x.ref)}</span></div>
    <div class="muted">${esc(x.category)} · ${fmt(x.date)} · Evidence: ${esc(ev)}</div>${steps}</div>`;
}
async function renderMyReports(){
  const el=document.getElementById("myReports");
  const chat=()=>`<p style="padding-top:14px"><button class="pillbtn out sm" type="button" data-bot>Write a report</button></p>`;
  if(!el.innerHTML)el.innerHTML=`<p class="muted" style="padding-top:14px">Loading…</p>`;
  let items;
  try{items=(await api("GET","/me/reports")).items}catch(e){el.innerHTML=`<p class="muted" style="padding-top:14px">${esc(e.message)}</p>`+chat(0);return}
  el.innerHTML=(items.map(myReportHTML).join("")||`<p class="muted" style="padding-top:14px">No reports yet.</p>`)+chat(items.length);
}
document.getElementById("nameForm").onsubmit=async e=>{e.preventDefault();
  try{const {user}=await api("PATCH","/me",{name:document.getElementById("accName").value.trim()});S.user.name=user.name||"";renderAccount();toast("Saved")}
  catch(err){toast(err.message)}
};
document.getElementById("waToggle").onchange=async e=>{const on=e.target.checked;
  try{await api("PATCH","/me",{whatsappAlerts:on});S.user.wa=on;toast(on?"WhatsApp alerts on":"WhatsApp alerts off")}
  catch(err){e.target.checked=!on;toast(err.message)}
};
document.getElementById("areaForm").onsubmit=async e=>{e.preventDefault();const v=document.getElementById("newArea").value.trim();if(!v)return;
  try{await addArea(v);e.target.reset();renderAccount();toast("Watching "+v)}catch(err){toast(err.message)}
};
document.getElementById("signout").onclick=async()=>{
  try{await api("POST","/auth/logout")}catch(err){toast(err.message);return}
  signedOut();toast("Signed out");go("home");
};
document.getElementById("deldata").onclick=()=>document.getElementById("delconfirm").hidden=false;
document.getElementById("delno").onclick=()=>document.getElementById("delconfirm").hidden=true;
document.getElementById("delyes").onclick=async()=>{
  try{await api("DELETE","/me")}catch(err){toast(err.message);return}
  phone="";document.getElementById("delconfirm").hidden=true;signedOut();toast("Your data has been deleted");go("home");
};

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
/* these categories take documents (PDF); every other requirement takes a live camera photo */
const PDF_ONLY=new Set(["pest","docs"]);
const daysAgo=d=>Math.round((TODAY-new Date(d))/864e5);
const dISO=n=>{const t=new Date(TODAY);t.setDate(t.getDate()-n);return t.toISOString().slice(0,10)};
const ago=d=>{const n=daysAgo(d);return n<=0?"today":n===1?"yesterday":n+" days ago"};
/* how often a part of the checkup needs new evidence, in words */
const every=d=>({7:"every week",14:"every 2 weeks",30:"every month",90:"every 3 months",180:"every 6 months",365:"every year"})[d]||`every ${d} days`;
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

/* the fictional sample profile behind the homepage illustrations and How it works (Green Leaf Dhaba).
   Kept under its own key, so it can never mix with a real restaurant's dashboard. */
const DEMO="demo";
const PROF={};
(function(){
  const g={owner:"98200 11223",level:"platform",verifiedOn:"2026-09-12",adminNote:"",resp:{},ev:{},pausedPublicly:false,
    journey:[{m:"Jul 2026",score:61,kind:"Issues found",notes:["Pest-control records missing","Raw and cooked food shared a shelf","Staff training documents missing"]},
             {m:"Aug 2026",score:84,kind:"Issues resolved",notes:["Pest-control contract and records uploaded","New separate storage shelving photographed"]}]};
  const ages={kitchen:3,storage:25,pest:43,personal:10,clean:5,docs:20,ops:6};
  REQS.forEach(r=>{g.resp[r.id]="yes";g.ev[r.id]=[mkEv(r.id,ages[r.cat])]});
  g.ev.h3=[mkEv("h3",12)];
  g.ev.d2=[mkEv("d2",40)];
  PROF[DEMO]=g;
})();
/* chat reports sent in this visit: the chat's own thread and "Copy for FSSAI" read these; the real ones are in the API */
let REPORTS=[];
/* the sample community report in the homepage illustration */
const SAMPLE_REPORT={id:1,rid:3,text:"Saw a cockroach near the tandoor area during dinner.",date:"2026-07-14",status:"resolved",photo:true,flag:false,response:{text:"Full pest-control treatment done on 18 July and a monthly contract signed. Certificate uploaded to our profile.",date:"2026-07-19",ev:"pest-control-certificate.pdf"}};
let RID=1;
const RS={pending:"Awaiting moderation",accepted:"Moderated",rejected:"Not used",review:"Under review",verified:"Confirmed · unresolved",resolved:"Resolved",dismissed:"Not substantiated"};
const rsPill=s=>`<span class="rs rs-${s}">${RS[s]}</span>`;
const LV={self:"Claimed · self-reported",pending:"Verification requested",platform:"PlateWatch verified"};
const lvl=l=>`<span class="lvl lvl-${l}">${LV[l]}</span>`;
S.owner=null;S.openCats=new Set(["kitchen"]);S.claim=null;
/* refresh whichever page shows report state after the chat or a moderator changes it */
function refreshReports(){if(!document.getElementById("p-account").hidden&&S.user)renderAccount();if(!document.getElementById("p-dash").hidden&&S.owner!=null)renderDash(S.dashTab||"overview")}
const RP=createReporting({REPORTS,S,esc,fmt,st,cur,toast,place,search:searchAPI,remember,copyText,selectNode,TODAY,newId:()=>RID++,auth:SIGNIN,onChange:refreshReports});
/* reviewer-approved photo evidence from spot checks; it counts as fresh evidence for that item */
function addApprovedPhoto(rid,req,o){
  const p=PROF[rid],e={id:EVID++,name:o.name,type:"photo",date:o.date,status:"verified",note:"",url:o.url,ai:o.ai,flag:false,src:o.src||"checkup",people:!!o.people,sample:!!o.sample};
  (p.ev[req]=p.ev[req]||[]).push(e);if(p.resp[req]!=="yes")p.resp[req]="yes";return e;
}
const SCM=createSpotChecks({PROF,REQS,REQ,CAT,CATS,RP,esc,fmt,toast,aiFor,addEvidence:addApprovedPhoto,onChange:refreshReports});
/* the tracker map; restaurants come from the API */
const MAP=createMap({api,esc,fmt,st,go,filters:()=>({q:S.q,city:S.city,status:S.type,badge:S.ver,licence:S.lic,sort:S.sort}),noResults:noResHTML,remember});
/* PlateWatch's badge for a profile held here (the owner's dashboard, the illustrations), by the same rules as the API:
   verified needs every applicable requirement backed by current approved evidence, and nothing waiting for review */
function verif(rid){
  const p=PROF[rid];if(!p)return {k:"none"};
  if(p.level!=="platform")return {k:"claimed"};
  const why=[];
  if(Object.values(p.ev).flat().some(e=>e.status==="submitted"||e.status==="more"))why.push("new evidence waiting for review");
  const unmet=REQS.filter(q=>p.resp[q.id]!=="na"&&!(p.resp[q.id]==="yes"&&(p.ev[q.id]||[]).some(e=>e.status==="verified"&&daysAgo(e.date)<=CAT[q.cat].expiry))).length;
  if(unmet)why.push(`${unmet} requirement${unmet===1?"":"s"} without current approved evidence`);
  return why.length?{k:"claimed",paused:why.join("; ")}:{k:"verified"};
}
/* the PlateWatch level as a pill: PlateWatch verified, or Claimed · self-reported (including while paused) */
const lvlFor=rid=>verif(rid).k==="verified"?lvl("platform"):`<span class="lvl lvl-self">${LV.self}</span>`;
const levelText=rid=>({none:"Not claimed yet",claimed:"Claimed · self-reported",verified:"PlateWatch verified"})[verif(rid).k];

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
  const dots=pts.map((q,i)=>`<circle cx="${x(i)}" cy="${y(q.s)}" r="${i===pts.length-1?6:4.5}" fill="${i===pts.length-1?"#FFFFFF":"#0A0A0A"}" stroke="#0A0A0A" stroke-width="2"/><text x="${x(i)}" y="${y(q.s)-12}" text-anchor="middle" font-family="Geist, sans-serif" font-weight="800" font-size="15" fill="#0A0A0A">${q.s}</text><text x="${x(i)}" y="${H-10}" text-anchor="middle" font-family="Geist Mono, monospace" font-size="11" fill="#6B6B6B">${q.m.toUpperCase()}</text>`).join("");
  return `<svg class="jchart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Compliance score over time: ${pts.map(q=>q.m+" "+q.s).join(", ")}">${grid}<path d="${path}" fill="none" stroke="#0A0A0A" stroke-width="2"/>${dots}</svg>`;
}
function journeyList(rid,hideNow){const p=PROF[rid];const sc=scoreOf(rid);
  return `<div class="jlist">${p.journey.map(j=>`<div><span class="eyebrow">${j.m}</span><b>${j.score}</b><div><span style="font-size:13px;font-weight:500">${j.kind}</span><ul>${j.notes.map(n=>`<li>${esc(n)}</li>`).join("")}</ul></div></div>`).join("")}
  ${hideNow?`<div><span class="eyebrow">Now</span><b>—</b><div><span style="font-size:13px;font-weight:500">Compliance score paused while an official action is open</span></div></div></div>`:`<div><span class="eyebrow">Now</span><b>${sc.overall}</b><div><span style="font-size:13px;font-weight:500">${sc.missing.length?sc.missing.length+" requirement"+(sc.missing.length>1?"s":"")+" open":"All requirements met"}</span></div></div></div>`}`}

/* ---------- PUBLIC PROFILE (from the API) ---------- */
/* approved kitchen photos by checkup area; the API only sends them once PUBLIC_GALLERY is on */
function galleryHTML(list){
  const groups=CATS.map(c=>({c,items:list.filter(p=>REQ[p.requirementId]&&REQ[p.requirementId].cat===c.k)})).filter(g=>g.items.length);
  return `<div class="gal">${groups.map(({c,items})=>`<section class="gal-sec" aria-label="${esc(c.name)} photos"><div class="gal-h"><h3>${esc(c.name)}</h3><span class="muted">${items.length} photo${items.length===1?"":"s"}</span></div>
    <div class="gal-grid">${items.map(p=>`<figure class="gal-item"><a class="gal-btn" href="${esc(p.url)}" target="_blank" rel="noopener" aria-label="Open photo: ${esc(c.name)}, ${fmt(p.capturedOn)}"><img src="${esc(p.url)}" alt="" loading="lazy"></a>
      <figcaption><span class="gal-area">${esc(c.name)}</span><span class="gal-meta"><span class="gtag${p.source==="spot"?" gtag-spot":""}">${p.source==="spot"?"Spot check":"Checkup"}</span><span>${fmt(p.capturedOn)}</span></span></figcaption></figure>`).join("")}</div></section>`).join("")}</div>`;
}
let detailSeq=0;
/* late evidence, said plainly: it no longer counts, so the score is lower */
const fmtShort=s=>new Date(s).toLocaleDateString("en-IN",{day:"numeric",month:"short"});
function overdueHTML(fr){
  const late=fr.filter(x=>x.state==="expired");
  if(!late.length)return "";
  return `<div class="crit overdue"><b class="m">!</b><div><b>Evidence overdue</b><br>${late.map(x=>`${esc(x.name)}: new ${x.key==="pest"||x.key==="docs"?"PDF":"photos"} due ${every(x.everyDays)}, was due by ${fmt(x.dueOn)}`).map(t=>`<span>${t}</span>`).join("<br>")}<br><span class="muted">Late items don't count, so the score above is lower until the restaurant uploads new evidence.</span></div></div>`;
}
/* a photo whose file is gone (deleted after 4 months, or lost in development): say so instead of a broken image */
document.addEventListener("error",e=>{
  const i=e.target;if(i.tagName!=="IMG"||!i.closest(".rep-photos"))return;
  const g=document.createElement("span");g.className="rep-gone";g.textContent="Photo unavailable";(i.closest("a")||i).replaceWith(g);
},true);
/* "3 days ago", "1 week ago" */
function since(iso){const d=Math.floor((Date.now()-Date.parse(iso))/864e5);return d<=0?"today":d===1?"yesterday":d<7?d+" days ago":d<14?"1 week ago":Math.floor(d/7)+" weeks ago"}
const photosHTML=(list,alt)=>list.length?`<div class="rep-photos">${list.map(u=>`<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="${alt}" loading="lazy"></a>`).join("")}</div>`:"";
function proofHTML(p){
  if(!p)return "";
  return p.kind==="document"?`<a class="x rep-pdf" href="${esc(p.url)}" target="_blank" rel="noopener">View proof (PDF)</a>`:photosHTML([p.url],"Photo the restaurant took as proof");
}
/* a published report as diners see it: the remark, the food photo, the restaurant's checked action, and how old it is */
function pubReportHTML(x){
  return `<article class="rep rep-pub"><div class="top"><span class="tag tag-com">${esc(x.category)}</span><span>${esc(x.ref)}</span></div>
    <p class="rep-text">${esc(x.text)}</p>
    ${photosHTML(x.photos,"Food photo from the diner")}${!x.photos.length&&x.hasPhoto?`<p class="rep-note">Food photo checked by PlateWatch</p>`:""}
    ${x.hasBill?`<p class="rep-note">✓ Bill checked by PlateWatch. It isn't shown, because bills can carry personal details.</p>`:""}
    ${x.response?`<div class="resp resp-done"><span class="tag tag-self">Restaurant took action · ${fmt(x.response.date)} · proof checked by PlateWatch</span><div>${esc(x.response.text)}</div>${proofHTML(x.response.proof)}</div>`:""}
    <div class="rep-foot">Reported ${since(x.createdAt)} · shown here until ${fmtShort(x.publicUntil)}</div></article>`;
}
async function renderDetail(id){
  const el=document.getElementById("detail"),my=++detailSeq,bt=backTarget(id);
  const back=()=>`<button class="back" id="back">← Back to ${esc(pageName(bt))}</button>`;
  const bindBack=()=>{document.getElementById("back").onclick=()=>go(bt.p,bt.arg)};
  el.innerHTML=`${back()}<p class="muted" style="padding-block:40px">Loading…</p>`;bindBack();
  let r;
  try{r=await api("GET","/restaurants/"+id)}
  catch(e){
    if(my!==detailSeq)return;
    const missing=e.status===404;
    el.innerHTML=`${back()}<div style="padding-block:40px"><h1 class="h-mid">${missing?"No restaurant at this link":"Couldn't load this profile"}</h1>
      <p class="muted" style="margin-top:10px">${missing?"It may have been removed, or the link is wrong. Search for the place instead.":esc(e.message)}</p>
      <div class="row-actions"><button class="pillbtn" data-go="tracker">Search restaurants</button>${missing?"":`<button class="pillbtn out" id="detailRetry">Try again</button>`}</div></div>`;
    bindBack();const rt=document.getElementById("detailRetry");if(rt)rt.onclick=()=>renderDetail(id);return;
  }
  /* the visitor moved on while this loaded */
  if(my!==detailSeq||S.page.p!=="detail"||S.page.arg!==id)return;
  remember([r]);
  const status=r.status||"none",f=S.follows.has(id),c=r.compliance;
  /* the licence: an FDA suspension or revocation first, otherwise what FSSAI's FoSCoS showed when staff last checked */
  const FOSCOS={active:"Active on FSSAI's records",inactive:"Inactive or expired on FSSAI's records",not_found:"Not found on FSSAI's records"};
  const lic=status==="sus"?"Suspended by FDA":status==="rev"?"Revoked by FDA":!r.licenceNumber?"Licence number not on record yet":r.licenceStatus?FOSCOS[r.licenceStatus]:"Not checked yet";
  const licSub=[r.licenceNumber,r.licenceStatus&&r.licenceCheckedOn?"checked on FoSCoS "+fmt(r.licenceCheckedOn):""].filter(Boolean).join(" · ");
  const enf=["sus","rev","imp"].includes(status)?TYPES[status][0]+" since "+fmt(r.statusOn):"No current action listed";
  const stale=(TODAY-new Date(r.lastVerifiedOn))/864e5>30;
  let comp;
  if(c){
    const verified=r.badge.level==="verified";
    comp=`<div class="lane">
      <span class="tag ${verified?"tag-plat":"tag-self"}">${verified?"PlateWatch verified"+(c.verifiedOn?" · reviewed "+fmt(c.verifiedOn):""):"Restaurant-submitted · not yet PlateWatch verified"}</span>
      ${pausedNote(r.badge,esc)}
      <h2 class="h-mid">Food Safety Compliance</h2>
      <div class="scorewrap">${c.paused?pausedHTML():`<div class="score">${c.score}<small>/100</small></div>`}
        <dl class="scoremeta">${c.paused?"":`<dt>Rating</dt><dd>${esc(c.rating)}</dd>`}<dt>Requirements met</dt><dd>${c.requirementsMet} / ${c.requirementsTotal}</dd><dt>Last updated</dt><dd>${c.lastUpdated?fmt(c.lastUpdated):"—"}</dd><dt>Level</dt><dd>${badgeLabel(r.badge)}</dd></dl></div>
      ${c.criticalOpen.length?`<div class="crit"><b class="m">!</b><div><b>Critical requirement${c.criticalOpen.length>1?"s":""} need${c.criticalOpen.length>1?"":"s"} attention</b><br>${c.criticalOpen.map(esc).join("; ")}</div></div>`:""}
      <div class="bars">${c.categories.map(x=>x.percent==null?"":`<div class="bar"><span>${esc(x.name)}</span><span class="t"><i style="width:${x.percent}%"></i></span><span class="p">${x.percent}%</span></div>`).join("")}</div>
      <h3 style="font-size:17px;margin-top:30px">Evidence freshness</h3>
      ${overdueHTML(c.freshness)}
      <div class="fr">${c.freshness.map(x=>`<div><span class="fd fd-${x.state}"></span><span class="fr-n">${esc(x.name)}<small>${every(x.everyDays)}</small></span><span class="s">${x.state==="none"?"No evidence":x.state==="expired"?`Overdue · was due ${fmtShort(x.dueOn)}`:"Updated "+ago(x.lastUpdated)+(x.dueOn?` · next due by ${fmtShort(x.dueOn)}`:"")}</span></div>`).join("")}</div>
      <div class="evc"><span><b>${c.evidenceCounts.total}</b> pieces of evidence</span><span><b>${c.evidenceCounts.photos}</b> photos</span><span><b>${c.evidenceCounts.videos}</b> videos</span><span><b>${c.evidenceCounts.documents}</b> documents</span><span>Last upload ${c.lastUpdated?ago(c.lastUpdated):"—"}</span></div>
      <p class="disc">PlateWatch's own compliance score, calculated from the restaurant's evidence against ${REQS.length} food-safety requirements. It is not an FSSAI hygiene rating or a government certificate.</p>
    </div>
    <div class="lane"><span class="tag tag-self">Restaurant-submitted · reviewed by PlateWatch</span><h2 class="h-mid">Kitchen gallery</h2><p class="gal-sub">Photos from the last 30 days that the restaurant uploaded to prove its checkup answers, approved by PlateWatch reviewers.</p>${r.gallery.length?galleryHTML(r.gallery):`<p class="muted gal-empty">No approved kitchen photos from the last 30 days.</p>`}</div>`;
  } else {
    comp=`<div class="lane"><span class="tag tag-self">Restaurant-submitted</span><div class="claimbox"><div><h2 class="h-mid">No compliance profile yet</h2><p class="muted" style="margin:6px 0 0">This restaurant hasn't claimed its page or submitted evidence.</p></div><button class="pillbtn out" id="claimThis">Own this place? Claim it</button></div></div>`;
  }
  const sources=r.history.filter(h=>h.sourceUrl);
  const url=location.origin+location.pathname+"#profile-"+id;
  /* owners can't report their own restaurant */
  const mine=!!S.user&&(S.user.owned||[]).includes(id);
  el.innerHTML=`
  ${back()}
  <div class="sumline">${st(status)}<p class="sumline-t">${esc(r.summary)}</p></div>
  <div class="dhead">
    <div><h1 class="h-big pnm">${dotHTML(r.dot)}<span>${esc(r.name)}</span></h1><div class="pnm-b">${badgeHTML(r.badge)}</div><div class="w">${esc(r.area)}, ${esc(r.city)} · ${esc(r.category)}</div>${r.source==="osm"?`<div class="muted" style="font-size:12px;margin-top:6px">Name and location from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> (© OpenStreetMap contributors)</div>`:""}</div>
    <div class="sharebar">
      <div class="sharebar-btns"><button class="pillbtn ${f?"out":""}" id="followBtn">${f?"✓ Following":"Follow for alerts"}</button>${mine?"":`<button class="pillbtn out" type="button" data-report>Report</button>`}<button class="pillbtn out" id="copyLink" type="button">Copy link</button></div>
      <span class="shareurl" id="profUrl">${esc(url)}</span>
    </div>
  </div>
  <div class="legend"><span class="tag tag-off">Official record</span><span class="tag tag-self">Restaurant-submitted</span><span class="tag tag-plat">PlateWatch verified</span><span class="tag tag-com">Community report</span></div>
  <div class="dgrid" style="padding-top:0">
    <div>
      <div class="lane">
        <span class="tag tag-off">Official record · from FDA / FSSAI sources</span>
        <h2 class="h-mid">Official status</h2>
        <div class="facts" style="margin-top:18px">
          <div><div class="k">FSSAI licence</div><div class="v">${lic}</div><div class="muted" style="font-family:var(--mono);font-size:12px;margin-top:2px">${esc(licSub)}</div></div>
          <div><div class="k">Government enforcement</div><div class="v">${enf}</div></div>
          <div><div class="k">FSSAI hygiene rating</div><div class="v">No official rating on record</div></div>
        </div>
        <div class="muted" style="margin:-20px 0 22px;font-size:13px">Last verified ${fmt(r.lastVerifiedOn)}${stale?" · <span class='st st-imp'>Status unverified</span>":""}</div>
        <h3 style="font-size:17px">Regulatory history</h3>
        ${r.history.length?`<ol class="tl">${r.history.map(h=>`<li><span class="dot"></span><div><div class="dt">${fmt(h.actionOn)}</div>${st(h.type)}<p>${esc(h.summary)}</p>${h.sourceUrl?`<a class="x" href="${esc(h.sourceUrl)}" target="_blank" rel="noopener">Official source</a>`:""}</div></li>`).join("")}</ol>`:`<p class="muted">No official action on record as of ${fmt(r.lastVerifiedOn)}. This is not a guarantee of hygiene.</p>`}
        ${legendHTML()}
      </div>
      ${comp}
      <div class="lane">
        <span class="tag tag-com">Community reports · moderated, not independently verified</span>
        <h2 class="h-mid">Community reports</h2>
        <div class="evc" style="margin-bottom:10px"><span><b>${r.reports.length}</b> in the last 2 weeks</span>${r.reportsAwaitingModeration?`<span><b>${r.reportsAwaitingModeration}</b> being checked by PlateWatch (not shown yet)</span>`:""}</div>
        ${r.reports.map(pubReportHTML).join("")||`<p class="muted">No reports in the last 2 weeks.</p>`}
        <p class="muted" style="font-size:13px;margin-top:12px">PlateWatch checks every report before it appears here, and each one stays for 2 weeks.</p>
        ${mine?`<p class="muted" style="margin-top:20px">You manage this restaurant, so you can't report it. Reply to reports from your dashboard.</p>`:`<div style="margin-top:20px"><button class="pillbtn out" type="button" data-report>Report a food-safety problem here</button></div>`}
      </div>
    </div>
    <div class="side" style="padding-top:34px">
      <div><h3>Sources</h3>${sources.length?`<div class="srcl">${sources.map(h=>`<span><a href="${esc(h.sourceUrl)}" target="_blank" rel="noopener">${esc(h.authority)} · ${TYPES[h.type][0]}</a><em>OFFICIAL · ${fmt(h.actionOn)}</em></span>`).join("")}</div>`:`<p class="muted">No official source linked yet.</p>`}<p class="muted" style="margin-top:10px">Each official entry links to the release or order it came from.</p></div>
    </div>
  </div>`;
  bindBack();
  document.getElementById("copyLink").onclick=()=>copyText(url,"Link copied",()=>selectNode(document.getElementById("profUrl")));
  el.querySelectorAll("[data-report]").forEach(b=>b.onclick=()=>openReport(id,r.name));
  document.getElementById("followBtn").onclick=async()=>{
    if(!S.user){S.after={follow:id};toast("Log in with your number to get alerts");go("login");return}
    const on=!S.follows.has(id);
    if(await setFollow(id,on))toast(on?"Following. We'll WhatsApp you on any change.":"Unfollowed");
    renderDetail(id);
  };
  const ct=document.getElementById("claimThis");if(ct)ct.onclick=()=>{go("biz",id)};
}

/* ---------- BUSINESS: find + claim ---------- */
function renderBiz(preId){
  const bq=document.getElementById("bq"),res=document.getElementById("claimres");let seq=0,timer=null;
  const claimed=r=>r.badge&&r.badge.level!=="none";
  const rows=list=>list.map(r=>`<div class="cr"><div><b>${esc(r.name)}</b><div class="muted">${esc(r.area)}, ${esc(r.city)}${claimed(r)?" · "+badgeLabel(r.badge):""}</div></div><button class="pillbtn ${claimed(r)?"out":""} sm" data-claim="${r.id}">${claimed(r)?"Owner log in":"Claim"}</button></div>`).join("");
  /* restaurants to claim come from the API's search */
  const draw=()=>{
    clearTimeout(timer);const q=bq.value.trim();
    if(q.length<2){res.innerHTML=`<p class="muted" style="padding-top:14px">Type your restaurant's name, area or FSSAI licence number.</p>`;return}
    timer=setTimeout(async()=>{const my=++seq;let list;
      try{list=await searchAPI(q)}catch(e){res.innerHTML=`<p class="muted" style="padding-top:14px">${esc(e.message)}</p>`;return}
      if(my!==seq)return;
      res.innerHTML=rows(list)||`<p class="muted" style="padding-top:14px">Not listed yet? Search for it from the homepage and tap “Tell us this place exists”. Our team adds it with its FSSAI licence.</p>`;
    },200);
  };
  bq.oninput=draw;
  if(preId){const r=place(preId);if(r)bq.value=r.name}
  draw();
  document.getElementById("claimpanel").hidden=true;
  if(preId)startClaim(preId);
}
document.getElementById("claimres").onclick=e=>{const b=e.target.closest("[data-claim]");if(b)startClaim(+b.dataset.claim)};
/* claim with the licence number and a code to the owner's mobile; the API records who owns the restaurant */
async function startClaim(rid){
  let r=place(rid);
  if(!r||!r.lic){try{remember([await api("GET","/restaurants/"+rid)]);r=place(rid)}catch(e){toast(e.message);return}}
  const P=document.getElementById("claimpanel");P.hidden=false;const existing=!!(r.badge&&r.badge.level!=="none");
  let lic="",ph="",busy=false;
  P.innerHTML=`<div class="eyebrow">${existing?"Owner log in":"Claim"} · step 1 of 2</div><h2 class="h-mid" style="margin-top:10px">${esc(r.name)}</h2>
   <p class="muted" style="margin-top:8px">Enter the FSSAI licence number on your licence and the owner's mobile. We'll send a code to confirm.</p>
   <form class="form" id="clf" style="margin-top:14px">
     <label for="cl-lic">FSSAI licence number</label><input class="input" id="cl-lic" inputmode="numeric" maxlength="14" required placeholder="14 digits" style="font-family:var(--mono)" aria-describedby="cl-lic-h">
     <p class="muted" id="cl-lic-h" style="font-size:13px;margin:-4px 0 4px">${r.lic?"The 14-digit number printed on your FSSAI licence or registration certificate.":"We don't have this restaurant's licence yet. Enter the 14-digit number on your FSSAI certificate; our team checks it on FSSAI's FoSCoS."}</p>
     <label for="cl-ph">Owner's mobile</label><input class="input" id="cl-ph" inputmode="numeric" maxlength="10" required placeholder="10 digits" style="font-family:var(--mono)" value="${S.user?S.user.phone:""}">
     <p class="muted" style="font-size:13px;margin:-4px 0 4px">PlateWatch stores this number to manage your restaurant's profile. You can delete it anytime.</p>
     <div id="clerr"></div>
     <div><button class="pillbtn" type="submit" id="clSend">Send code</button></div></form>`;
  P.scrollIntoView({behavior:"smooth",block:"start"});
  /* signed in as the owner's number: record the claim, then open the dashboard */
  const claim=async errEl=>{
    try{
      const res=await api("POST","/owner/claims",{restaurantId:rid,licenceNumber:lic});
      S.user.owned=[...new Set([...(S.user.owned||[]),rid])];
      if(PROF[rid])PROF[rid].owner=fmtPhone(S.user.phone);
      else PROF[rid]={owner:fmtPhone(S.user.phone),level:"self",verifiedOn:null,adminNote:"",resp:{},ev:{},journey:[]};
      const back=res.existing||existing;
      S.owner=rid;S.openCats=new Set([CATS[0].k]);toast(back?"Welcome back":"Restaurant claimed. Start your checkup.");go("dash",back?"overview":"checkup");
    }catch(err){errEl.innerHTML=errHTML(err.message)}
  };
  document.getElementById("clf").onsubmit=async e=>{e.preventDefault();if(busy)return;
    lic=document.getElementById("cl-lic").value.replace(/\D/g,"");ph=document.getElementById("cl-ph").value.replace(/\D/g,"");
    const err=document.getElementById("clerr"),btn=document.getElementById("clSend");
    if(!/^\d{14}$/.test(lic)){err.innerHTML=errHTML("Enter the 14-digit licence number.");return}
    /* checked here too, so a typo doesn't cost a code; the API checks it again */
    /* no licence on record (added from OpenStreetMap): the owner's is saved and our team checks it on FoSCoS */
    if(r.lic&&lic!==r.lic){err.innerHTML=errHTML("That licence number doesn't match our records for this restaurant.");return}
    if(!/^[6-9]\d{9}$/.test(ph)){err.innerHTML=errHTML("Enter a 10-digit mobile number starting with 6–9.");return}
    busy=true;btn.disabled=true;err.innerHTML="";
    if(S.user&&S.user.phone===ph){await claim(err);busy=false;btn.disabled=false;return}
    let info;
    try{info=await SIGNIN.request(ph)}catch(x){err.innerHTML=errHTML(x.message);busy=false;btn.disabled=false;return}
    busy=false;
    P.innerHTML=`<div class="eyebrow">Step 2 of 2</div><h2 class="h-mid" style="margin-top:10px">Enter the code</h2><p class="muted" style="margin-top:8px">${sentTo(ph,info.channel)}</p>${devHint(info.channel)}
     <form id="clo" style="margin-top:6px"><div class="phonefield"><input id="cl-otp" inputmode="numeric" maxlength="6" placeholder="••••••" aria-label="6-digit code" autocomplete="one-time-code"></div><div id="cloerr"></div><div class="row-actions"><button class="pillbtn" type="submit" id="clVer">Verify and continue</button><button class="x" type="button" id="clBack">Start again</button></div></form>`;
    document.getElementById("cl-otp").focus();
    document.getElementById("clBack").onclick=()=>startClaim(rid);
    document.getElementById("clo").onsubmit=async ev=>{ev.preventDefault();if(busy)return;
      const cerr=document.getElementById("cloerr"),code=document.getElementById("cl-otp").value.replace(/\D/g,"");
      if(code.length!==6){cerr.innerHTML=errHTML("Enter the 6-digit code.");return}
      busy=true;document.getElementById("clVer").disabled=true;cerr.innerHTML="";
      try{await SIGNIN.verify(ph,code,true)}
      catch(x){cerr.innerHTML=errHTML(x.message);busy=false;document.getElementById("clVer").disabled=false;return}
      await claim(cerr);busy=false;const v=document.getElementById("clVer");if(v)v.disabled=false;
    };
  };
}

/* ---------- DASHBOARD ---------- */
/* the owner's checkup and reports come from the API, into PROF[rid]: the shape the dashboard already renders */
async function loadDash(rid){
  const [ck,reps]=await Promise.all([api("GET",`/owner/restaurants/${rid}/checkup`),api("GET",`/owner/restaurants/${rid}/reports`)]);
  /* staff can change weights and expiry in admin: score with the server's values */
  ck.categories.forEach(c=>{if(CAT[c.key])CAT[c.key].expiry=c.expiryDays});
  ck.requirements.forEach(q=>{if(REQ[q.id]){REQ[q.id].w=q.weight;REQ[q.id].crit=q.critical}});
  const p=PROF[rid]||(PROF[rid]={journey:[]});
  Object.assign(p,{r:ck.restaurant,owner:S.user?fmtPhone(S.user.phone):"",level:ck.level,verifiedOn:ck.verifiedOn,adminNote:ck.adminNote||"",resp:{},ev:{},pausedPublicly:ck.score.pausedPublicly,publicGallery:ck.publicGallery});
  ck.requirements.forEach(q=>{if(q.answer)p.resp[q.id]=q.answer});
  [...ck.evidence].reverse().forEach(e=>(p.ev[e.requirementId]=p.ev[e.requirementId]||[]).push({id:e.id,name:e.name,type:e.kind,date:e.capturedOn,status:e.status,note:e.note||"",url:e.kind==="photo"?e.url:null,ai:null,flag:e.flagged}));
  S.ownerReports=reps.items;
}
async function openDash(tab){
  const rid=S.owner,el=document.getElementById("dash");
  el.innerHTML=`<p class="muted" style="padding-block:60px">Loading your dashboard…</p>`;
  try{await loadDash(rid)}
  catch(e){
    if([401,403,404].includes(e.status)){S.owner=null;toast(e.status===401?"Log in again to open your dashboard.":e.message);go("biz");return}
    el.innerHTML=`<div style="padding-block:60px"><div class="err">${esc(e.message)}</div><button class="pillbtn out sm" id="dashRetry" style="margin-top:14px">Try again</button></div>`;
    document.getElementById("dashRetry").onclick=()=>openDash(tab);return;
  }
  if(S.owner===rid&&!document.getElementById("p-dash").hidden)renderDash(tab);
}
/* after a change: re-read from the API and redraw the same tab */
async function reloadDash(tab){try{await loadDash(S.owner)}catch(e){toast(e.message)}if(S.owner!=null&&!document.getElementById("p-dash").hidden)renderDash(tab)}
function notifs(rid){const p=PROF[rid],out=[];
  (S.ownerReports||[]).filter(x=>!x.response).forEach(x=>out.push(`New food-safety report received (${fmt(x.date)}). <button class="x" data-tab="reports">Respond</button>`));
  Object.values(p.ev).flat().filter(e=>e.status==="more").forEach(e=>out.push(`Reviewer asked for more evidence: ${esc(e.name)}. <button class="x" data-tab="checkup">Open checkup</button>`));
  Object.values(p.ev).flat().filter(e=>e.status==="rejected").forEach(e=>out.push(`Evidence rejected: ${esc(e.name)}. Upload a clearer file.`));
  if(p.adminNote)out.push(esc(p.adminNote));
  const vf=verif(rid);if(vf.paused)out.push(`PlateWatch verification paused: ${esc(vf.paused)}.`);
  return out;
}
/* the 3 highest-impact open items: critical first, then highest weight, then expired evidence */
function nextBest(sc){
  return [...sc.missing].sort((a,b)=>(b.r.crit-a.r.crit)||(b.r.w-a.r.w)||((b.why==="Evidence expired")-(a.why==="Evidence expired"))).slice(0,3);
}
/* items whose newest current evidence expires within 7 days */
function expiringSoon(rid){
  const p=PROF[rid];
  return REQS.filter(q=>p.resp[q.id]==="yes").map(q=>{const cur=currentEv(rid,q.id);if(!cur.length)return null;const newest=Math.min(...cur.map(e=>daysAgo(e.date)));return {r:q,left:CAT[q.cat].expiry-newest}})
    .filter(x=>x&&x.left>=0&&x.left<=7).sort((a,b)=>a.left-b.left||(b.r.crit-a.r.crit)||(b.r.w-a.r.w)).slice(0,3);
}
function nextBestHTML(sc,rid){
  const top=nextBest(sc),exp=rid!=null?expiringSoon(rid):[];if(!top.length&&!exp.length)return "";
  return `<div class="nba"><div class="nba-h"><h3>Do these next</h3><span class="muted">Highest impact on your score</span></div>
    <ol>${top.map(m=>`<li><div class="nba-t"><span>${esc(m.r.text)}</span><span class="nba-m">${m.r.crit?"<b>Critical</b> · ":""}Weight ${m.r.w} · ${CAT[m.r.cat].name} · ${m.why}</span></div><button class="pillbtn out sm" data-jump="${m.r.id}">Fix this</button></li>`).join("")}${exp.map(x=>`<li><div class="nba-t"><span>${esc(x.r.text)}</span><span class="nba-m"><b>${x.left===0?"Expires today":`Expires in ${x.left} day${x.left===1?"":"s"}`}</b> · ${CAT[x.r.cat].name} · new ${PDF_ONLY.has(x.r.cat)?"PDF":"photo"} needed ${every(CAT[x.r.cat].expiry)}</span></div><button class="pillbtn out sm" data-jump="${x.r.id}">Refresh</button></li>`).join("")}</ol></div>`;
}
function renderDash(tab){
  const rid=S.owner,p=PROF[rid],r=p.r,sc=scoreOf(rid),ec=evCounts(rid);
  const nrep=(S.ownerReports||[]).filter(x=>!x.response||x.response.status==="rejected").length;
  const tabs=[["overview","Overview"],["checkup","Food Safety Checkup"],["reports","Reports"+(nrep?`<span class="n">${nrep}</span>`:"")],["journey","Journey"],["qr","QR code"]];
  let body="";
  if(tab==="overview"){
    const ns=notifs(rid);
    const canReq=p.level==="self"&&sc.unanswered===0;
    body=`<div style="padding-top:30px">${nextBestHTML(sc,rid)}</div><div class="ov" style="padding-top:26px"><div>
      <span class="tag tag-self">Your Food Safety Compliance</span>
      <div class="scorewrap"><div><div class="score">${sc.overall}<small>/100</small></div>${paused(rid)?`<p class="pz-own">Paused publicly until the official action is closed.</p>`:""}</div><dl class="scoremeta"><dt>Rating</dt><dd>${grade(sc.overall)}</dd><dt>Last updated</dt><dd>${lastUpdated(rid)}</dd><dt>Verification</dt><dd>${levelText(rid)}</dd></dl></div>
      ${progHTML(sc.done,sc.tot)}
      ${sc.crit.length?`<div class="crit"><b class="m">!</b><div><b>Critical requirement${sc.crit.length>1?"s":""} need attention</b><br>${sc.crit.map(q=>esc(q.text)).join("; ")}<br><button data-tab="checkup">Fix in checkup</button></div></div>`:""}
      <div class="kpis"><div><b>${sc.done}/${sc.tot}</b><span>Requirements met</span></div><div><b>${ec.total}</b><span>Evidence submitted</span></div><div><b>${sc.missing.length}</b><span>Need attention</span></div></div>
      ${barsHTML(sc)}
      <p class="disc">Score = weighted share of applicable requirements answered "yes" with current, non-rejected evidence. Critical items are flagged separately, however high the score.</p>
      <h3 style="font-size:17px;margin-top:30px">Evidence freshness</h3>${freshHTML(rid)}
    </div><div>
      <h3 style="font-size:20px;font-weight:700;font-stretch:108%;margin-bottom:12px">Verification</h3>
      <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center">${lvlFor(rid)}
        ${p.level==="self"?`<button class="pillbtn sm" id="reqVer" ${canReq?"":"disabled"}>Request verification</button>`:""}
        ${p.level==="platform"?`<span class="muted">Reviewed ${fmt(p.verifiedOn)}</span>`:""}</div>
      ${p.level==="self"&&!canReq?`<p class="muted" style="margin-top:8px">Answer all requirements first (${sc.unanswered} left).</p>`:""}
      ${p.level==="pending"?`<p class="muted" style="margin-top:8px">Our team is reviewing your evidence. Usually 2–3 working days.</p>`:""}
      <h3 style="font-size:20px;font-weight:700;font-stretch:108%;margin:34px 0 12px">Notifications</h3>
      <div class="notif">${ns.map(n=>`<div><span>${n}</span></div>`).join("")||`<p class="muted" style="padding-top:12px">Nothing new.</p>`}</div>
      <h3 style="font-size:20px;font-weight:700;font-stretch:108%;margin:34px 0 12px">Needs attention</h3>
      <div class="miss">${sc.missing.slice(0,8).map(m=>`<button data-jump="${m.r.id}"><span>${m.r.crit?"<b>Critical · </b>":""}${esc(m.r.text)}</span><em>${m.why.toUpperCase()}</em></button>`).join("")||`<p class="muted" style="padding-top:12px">All requirements met.</p>`}</div>
      <h3 style="font-size:20px;font-weight:700;font-stretch:108%;margin:34px 0 12px">Spot checks</h3>
      ${SCM.historyHTML(rid)}
    </div></div>
    <section class="sc-preview"><span class="tag tag-self">What diners see</span><h2 class="h-mid">Your kitchen gallery</h2><p class="gal-sub">${p.publicGallery?"Photos our reviewers approved in the last 30 days. Older ones drop out, so keep uploading. Spot-check photos are tagged.":"Photos our reviewers approve collect here. Diners will see them once photo publishing is switched on, after faces can be blurred automatically."}</p>${SCM.galleryHTML(rid)}</section>`;
  }
  if(tab==="checkup"){
    body=`<div class="stick"><span>Compliance score now <b>${sc.overall}/100</b>${paused(rid)?" (paused publicly)":""} · ${sc.done}/${sc.tot} met${sc.unanswered?` · ${sc.unanswered} unanswered`:""}</span><span class="muted" style="font-size:13px">Based on public FSSAI hygiene parameters. Not an official FSSAI audit.</span></div>
    <div style="padding-top:24px"><p class="muted" style="margin:0 0 18px;max-width:70ch">Answer each question about your food and kitchen hygiene, and prove every <b>Yes</b>. Kitchen, storage, personal hygiene, cleaning and operations need a <b>photo taken with your camera</b> right then. Pest control and documentation need a <b>PDF</b> (contract, certificate or record). Our reviewers check every upload within 24 hours. Once they approve a photo, it appears in your public <b>Kitchen gallery</b> for 30 days. Photos showing people's faces are never shown to diners.</p>
    <div class="sched"><b>Upload new evidence on time.</b> Kitchen hygiene, food storage and cleaning: photos every 2 weeks. Personal hygiene: every week. Operational safety: every month. Pest control: a PDF every 6 months. When something is late it stops counting, your score goes down, and your public profile shows it as overdue.<span>Uploaded the wrong file? Use <b>Remove</b> on it. Photos are deleted after 4 months and PDFs after 2 years.</span></div>${nextBestHTML(sc,rid)}${progHTML(sc.done,sc.tot)}</div>
    ${CATS.map(c=>{const reqs=REQS.filter(q=>q.cat===c.k);const x=sc.cats[c.k];return `<details class="cat" data-cat="${c.k}" ${S.openCats.has(c.k)?"open":""}><summary><h3>${c.name}</h3><span class="catprog"><span class="prog-t" aria-hidden="true"><i style="width:${x.tot?Math.round(x.done/x.tot*100):0}%"></i></span><span>${x.done} of ${x.tot}</span></span><span class="p">${x.pct==null?"N/A":x.pct+"%"} · ${PDF_ONLY.has(c.k)?"PDF":"photos"} ${every(c.expiry)}</span><span class="ch" aria-hidden="true">+</span></summary>
      ${reqs.map(q=>{const a=p.resp[q.id];const evs=p.ev[q.id]||[];return `<div class="req" id="req-${q.id}">
        <div><div class="q">${esc(q.text)}</div><div class="qm">${q.crit?'<span class="c">■ Critical</span>':""}<span>Weight ${q.w}</span>${a==="yes"&&!currentEv(rid,q.id).length?"<span class='c'>Evidence needed</span>":""}</div></div>
        <div class="ans" role="group" aria-label="Answer">${["yes","no","na"].map(v=>`<button data-ans="${v}" data-q="${q.id}" aria-pressed="${a===v}">${v==="na"?"N/A":v[0].toUpperCase()+v.slice(1)}</button>`).join("")}</div>
        ${evs.map(e=>{const exp=daysAgo(e.date)>c.expiry&&e.status!=="rejected";const stt=exp?"expired":e.status;const lab={verified:"Approved",submitted:"Submitted",rejected:"Rejected",more:"More needed",expired:"Expired"}[stt];return `<div class="ev"><div class="th">${e.url?`<img src="${e.url}" alt="">`:e.type.toUpperCase()}</div><div><div class="nm">${esc(e.name)}<span class="evs evs-${stt}">${lab}</span></div><div class="mt">${e.type} · uploaded ${ago(e.date)}${e.status==="submitted"?" · a reviewer checks it within 24 hours":""}${e.flag?" · flagged by reviewer":""}</div>${e.note?`<div class="mt">Note: ${esc(e.note)}</div>`:""}
          ${e.ai?`<div class="ai"><span class="tag tag-plat">AI-assisted observation · not a certification</span>${e.ai.map(o=>`<div>${esc(o)}</div>`).join("")}<div class="muted">Status: ${e.status==="verified"?"Confirmed by reviewer":"Needs human review"}</div></div>`:""}</div>${e.id?`<button type="button" class="evrm" data-rm="${e.id}" data-q="${q.id}" aria-label="Remove ${esc(e.name)}">Remove</button>`:""}</div>`}).join("")}
        <div class="evrow">${PDF_ONLY.has(q.cat)
          ?`<label class="upl">+ Add PDF<input type="file" accept="application/pdf,.pdf" data-up="${q.id}"></label><span class="muted" style="font-size:13px">PDF only: the contract, certificate or record.</span>`
          :`<button type="button" class="upl" data-cam="${q.id}">Take photo with camera</button><span class="muted" style="font-size:13px">Live camera only, so the photo shows your kitchen today. Keep people's faces out of the frame.</span>`}</div>
        <input class="noteinput" placeholder="Add a note for the reviewer (optional)" data-note="${q.id}" aria-label="Note for ${esc(q.text)}">
      </div>`}).join("")}</details>`}).join("")}
    <div style="padding-block:34px 70px;display:flex;flex-wrap:wrap;gap:14px;align-items:center">${p.level==="self"?`<button class="pillbtn" id="reqVer2" ${sc.unanswered?"disabled":""}>Request verification</button>`:lvlFor(rid)}<span class="muted">${sc.unanswered?sc.unanswered+" requirement(s) still unanswered":"All requirements answered"}</span></div>`;
  }
  if(tab==="reports"){
    const reps=S.ownerReports||[];
    body=`<div style="padding-block:30px 70px;max-width:760px"><p class="muted" style="margin-top:0">A diner's report appears here after PlateWatch checks and accepts it (within 24 hours), if the diner agreed to share it. It's on your public profile for 2 weeks. Fixed the problem? Use <b>Mark as resolved</b> with proof: a photo taken now, or a PDF such as a pest-control certificate. We check the proof within 24 hours, then it shows next to the report.</p>
    ${reps.map(ownerReportHTML).join("")||`<p class="muted">No reports yet.</p>`}</div>`;
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
      <div class="poster"><span class="eyebrow" style="color:#9A9A9A">PlateWatch</span><div class="ptitle">SCAN TO VIEW OUR FOOD SAFETY PROFILE</div><div class="qrbox" id="qr"></div><div style="font-size:14px">${esc(r.name)}</div><div style="font-family:var(--mono);font-size:11px;color:#9A9A9A">${levelText(rid).toUpperCase()} · ${paused(rid)?"SCORE PAUSED":sc.overall+"/100"}</div></div></div>`;
  }
  document.getElementById("dash").innerHTML=`
    <div class="dashtop"><div><div class="eyebrow">Restaurant dashboard · owner +91 ${esc(p.owner)}</div><h1 class="h-big" style="margin-top:10px">${esc(r.name)}</h1><div class="muted" style="margin-top:6px">${esc(r.area)}, ${esc(r.city)} · ${lvlFor(rid)}</div></div>
    <div style="display:flex;gap:10px;flex-wrap:wrap"><button class="pillbtn out sm" id="viewPub">View public profile</button><button class="x" id="ownOut">Sign out</button></div></div>
    ${SCM.bannerHTML(rid)}
    <div class="dtabs" role="tablist">${tabs.map(([k,l])=>`<button role="tab" data-tab="${k}" aria-selected="${k===tab}">${l}</button>`).join("")}</div>${body}`;
  S.dashTab=tab;
  if(tab==="qr"){try{new QRCode(document.getElementById("qr"),{text:"https://platewatch.in/restaurant/"+rid+"/safety",width:170,height:170,colorDark:"#0A0A0A",colorLight:"#FFFFFF"})}catch(e){document.getElementById("qr").innerHTML='<span style="font:12px var(--mono);color:#0A0A0A;line-height:1.4">QR preview unavailable</span>'}
    document.getElementById("copyqr").onclick=()=>copyText(document.getElementById("qrurl").textContent,"Link copied",()=>selectNode(document.getElementById("qrurl")))}
  const rv=document.getElementById("reqVer")||document.getElementById("reqVer2");
  if(rv)rv.onclick=async()=>{rv.disabled=true;
    try{await api("POST",`/owner/restaurants/${rid}/verification-request`);toast("Verification requested. We'll review your evidence.")}catch(err){toast(err.message)}
    await reloadDash(tab)};
  /* one snapshot per month: saving again replaces this month's */
  const sn=document.getElementById("snap");if(sn)sn.onclick=()=>{const m=TODAY.toLocaleDateString("en-GB",{month:"short",year:"numeric"});p.journey=p.journey.filter(j=>j.m!==m).concat({m,score:sc.overall,kind:"Snapshot",notes:[sc.missing.length+" requirement(s) open"]});toast("Snapshot saved");renderDash("journey")};
}
document.getElementById("dash").addEventListener("click",e=>{
  const rid=S.owner,p=PROF[rid];
  const t=e.target.closest("[data-tab]");if(t){renderDash(t.dataset.tab);window.scrollTo(0,0);return}
  if(e.target.id==="viewPub"){go("detail",rid);return}
  if(e.target.id==="ownOut"){
    api("POST","/auth/logout").catch(()=>{}).then(()=>{signedOut();toast("Signed out of the dashboard");go("login","owner")});return}
  /* answers show at once and are saved in the background; a failure puts the old answer back */
  const a=e.target.closest("[data-ans]");if(a){const q=a.dataset.q,ans=a.dataset.ans,prev=p.resp[q];p.resp[q]=ans;keepOpen();renderDash("checkup");
    api("PUT",`/owner/restaurants/${rid}/answers/${q}`,{answer:ans}).catch(err=>{if(prev)p.resp[q]=prev;else delete p.resp[q];toast(err.message);keepOpen();renderDash("checkup")});return}
  const j=e.target.closest("[data-jump]");if(j){const q=REQ[j.dataset.jump];S.openCats.add(q.cat);renderDash("checkup");const el=document.getElementById("req-"+q.id);if(el)el.scrollIntoView({block:"center"});return}
  const fl=e.target.closest("[data-flag]");if(fl){fl.disabled=true;
    api("POST",`/owner/restaurants/${rid}/reports/${fl.dataset.flag}/flag`).then(()=>{toast("Flagged for our team to re-check");return reloadDash("reports")},err=>{fl.disabled=false;toast(err.message)});return}
  const sch=e.target.closest("[data-sc-chat]");if(sch){SCM.openChat(+sch.dataset.scChat);return}
});
/* a report in the owner's Reports tab, with "Mark as resolved" */
function ownerReportHTML(x){
  const r=x.response,open=S.rsv&&S.rsv.id===x.id;
  let res="";
  if(r&&r.status==="pending")res=`<div class="resp"><span class="tag tag-self">Sent to PlateWatch · ${fmt(r.date)}</span><div>${esc(r.text)}</div>${proofHTML(r.proof)}<div class="muted" style="font-size:12px;margin-top:6px">We check your proof within 24 hours. Then it shows next to the report on your public profile.</div></div>`;
  if(r&&r.status==="approved")res=`<div class="resp resp-done"><span class="tag tag-self">Action taken · ${fmt(r.date)} · checked by PlateWatch</span><div>${esc(r.text)}</div>${proofHTML(r.proof)}</div>`;
  if(r&&r.status==="rejected")res=`<div class="resp resp-no"><b>PlateWatch couldn't accept your proof:</b> ${esc(r.reviewNote||"")}<div class="muted" style="font-size:12px;margin-top:4px">Send new proof below.</div></div>`;
  const canResolve=!r||r.status==="rejected";
  const form=open?`<div class="resolve">
      <label for="rsvText">What did you do about it?</label>
      <textarea class="input" id="rsvText" rows="3" maxlength="1000" placeholder="e.g. Pest-control treatment done on 18 Sep; certificate attached.">${esc(S.rsv.text)}</textarea>
      <div class="resolve-proof"><b>Proof</b>${S.rsv.file?`<span class="resolve-file">${S.rsv.kind==="photo"?`<img src="${S.rsv.url}" alt="Your proof photo">`:`<span class="th">PDF</span>`}${esc(S.rsv.file.name)}</span>`:`<span class="muted">A photo taken now with your camera, or a PDF.</span>`}
        <span class="resolve-btns"><button type="button" class="upl" data-rsv-cam>${S.rsv.kind==="photo"?"Retake photo":"Take photo with camera"}</button><label class="upl">${S.rsv.kind==="document"?"Choose another PDF":"Add PDF"}<input type="file" accept="application/pdf,.pdf" data-rsv-pdf></label></span></div>
      <div id="rsvErr" role="alert"></div>
      <div class="resolve-acts"><button type="button" class="pillbtn sm" data-rsv-send>Send to PlateWatch</button><button type="button" class="x" data-rsv-cancel>Cancel</button></div></div>`
    :canResolve?`<div class="resolve-acts"><button type="button" class="pillbtn sm" data-resolve="${x.id}">Mark as resolved</button>${x.flagged?"":`<button class="x" type="button" data-flag="${x.id}">Report incorrect information</button>`}</div>`:"";
  return `<article class="rep" id="orep-${x.id}"><div class="top">${rsPill("accepted")}<span>${esc(x.category)}</span><span>${esc(x.ref)}</span>${x.flagged?"<span>You flagged this as incorrect</span>":""}</div>
    <p class="rep-text">${esc(x.text)}</p>${photosHTML(x.photos,"Food photo from the diner")}
    <div class="rep-foot">Reported ${since(x.createdAt)} · ${x.public?`on your public profile until ${fmtShort(x.publicUntil)}`:"no longer on your public profile"}</div>
    ${res}${form}</article>`;
}
/* "Mark as resolved": a comment and proof, sent to PlateWatch */
document.getElementById("dash").addEventListener("click",async e=>{
  const t=e.target;
  const open=t.closest("[data-resolve]");
  if(open){S.rsv={id:+open.dataset.resolve,text:"",file:null,kind:null,url:null};renderDash("reports");document.getElementById("rsvText").focus();return}
  if(!S.rsv)return;
  if(t.closest("[data-rsv-cancel]")){if(S.rsv.url)URL.revokeObjectURL(S.rsv.url);S.rsv=null;renderDash("reports");return}
  if(t.closest("[data-rsv-cam]")){
    const x=(S.ownerReports||[]).find(r=>r.id===S.rsv.id);
    CAM.open(`Proof for ${x?x.ref:"the report"}: photograph what you fixed`,file=>{if(!S.rsv)return;if(S.rsv.url)URL.revokeObjectURL(S.rsv.url);Object.assign(S.rsv,{file,kind:"photo",url:URL.createObjectURL(file)});renderDash("reports")});
    return}
  const send=t.closest("[data-rsv-send]");
  if(send){
    const err=document.getElementById("rsvErr"),text=S.rsv.text.trim();
    const why=text.length<5?"Say what you did, in a few words.":!S.rsv.file?"Add proof: take a photo or add a PDF.":"";
    if(why){err.innerHTML=errHTML(why);return}
    send.disabled=true;send.textContent="Sending…";
    try{
      const uploadId=await uploadFile(S.rsv.file,"response");
      await api("POST",`/owner/restaurants/${S.owner}/reports/${S.rsv.id}/response`,{text,uploadId});
      if(S.rsv.url)URL.revokeObjectURL(S.rsv.url);S.rsv=null;
      toast("Sent. PlateWatch checks your proof within 24 hours.");await reloadDash("reports");
    }catch(x){err.innerHTML=errHTML(x.message);send.disabled=false;send.textContent="Send to PlateWatch"}
  }
});
document.getElementById("dash").addEventListener("input",e=>{if(e.target.id==="rsvText"&&S.rsv)S.rsv.text=e.target.value});
document.getElementById("dash").addEventListener("change",e=>{
  const f=e.target.closest("[data-rsv-pdf]");if(!f||!S.rsv||!f.files[0])return;
  const file=f.files[0];
  if(file.type!=="application/pdf"&&!/\.pdf$/i.test(file.name)){toast("Choose a PDF file.");f.value="";return}
  if(S.rsv.url)URL.revokeObjectURL(S.rsv.url);Object.assign(S.rsv,{file,kind:"document",url:null});renderDash("reports");
});
function keepOpen(){S.openCats=new Set([...document.querySelectorAll("details.cat[open]")].map(d=>d.dataset.cat))}
document.getElementById("dash").addEventListener("toggle",e=>{if(e.target.matches&&e.target.matches("details.cat"))keepOpen()},true);
document.getElementById("dash").addEventListener("change",e=>{
  const rid=S.owner,p=PROF[rid];
  const sci=e.target.closest("[data-sc]");
  if(sci&&sci.files[0]){const r=SCM.addPhoto(+sci.dataset.sc,sci.dataset.scItem,sci.files[0]);toast(r&&r.complete?(r.check.status==="answered"?"Spot check answered on time":"Spot check answered late"):"Photo added");renderDash(S.dashTab||"overview");return}
  const up=e.target.closest("[data-up]");
  if(up&&up.files[0]){
    const f=up.files[0];
    if(!/\.pdf$/i.test(f.name)&&f.type!=="application/pdf"){toast("Choose a PDF file.");up.value="";return}
    up.disabled=true;submitEvidence(up.dataset.up,f);
  }
});
/* upload to storage, attach it to the requirement, then re-read the checkup; a reviewer sees it in Admin → Evidence */
async function submitEvidence(q,f){
  const rid=S.owner,noteEl=document.querySelector(`[data-note="${q}"]`),note=noteEl?noteEl.value.trim():"";
  toast("Uploading…");
  try{const uploadId=await uploadFile(f,"evidence");await api("POST",`/owner/restaurants/${rid}/evidence`,{requirementId:q,uploadId,...(note?{note}:{})});toast("Evidence submitted. A reviewer will check it.")}
  catch(err){toast(err.message)}
  keepOpen();await reloadDash("checkup");const el=document.getElementById("req-"+q);if(el)el.scrollIntoView({block:"center"});
}
/* the live camera: kitchen photos are taken on the spot, never picked from the gallery */
/* uploaded the wrong file: remove it from the checkup, the review queue and the gallery */
document.getElementById("dash").addEventListener("click",async e=>{
  const b=e.target.closest("[data-rm]");if(!b)return;
  if(!confirm("Remove this file? It stops counting towards your score and is deleted. This can't be undone."))return;
  b.disabled=true;
  try{await api("DELETE",`/owner/restaurants/${S.owner}/evidence/${b.dataset.rm}`);toast("Removed")}
  catch(err){toast(err.message);b.disabled=false;return}
  keepOpen();await reloadDash("checkup");const el=document.getElementById("req-"+b.dataset.q);if(el)el.scrollIntoView({block:"center"});
});
document.getElementById("dash").addEventListener("click",e=>{
  const b=e.target.closest("[data-cam]");if(!b)return;
  const q=b.dataset.cam;
  CAM.open(REQ[q].text,file=>submitEvidence(q,file));
});

/* ---------- ADMIN (staff only; everything comes from the API) ---------- */
const ADM=createAdmin({api,esc,fmt,toast,go});

/* ================= V5 HOME ================= */
/* illustrations show fictional samples: open the real profile if the restaurant exists, otherwise the tracker */
function openSample(id){api("GET","/restaurants/"+id).then(()=>go("detail",id),()=>go("tracker"))}
function heroCards(){
  const pick=[[1,"Food safety violations","c1"],[3,"Compliance confirmed","c2"]];
  const lab={sus:"Licence suspended",ok:"Cleared · reinstated",imp:"Improvement notice",rev:"Licence revoked"};
  const w=document.getElementById("hcWrap");
  w.innerHTML=pick.map(([id,line,cls])=>{const r=SAMPLE.find(x=>x.id===id),c=cur(r);const ini=r.name.split(/\s+/).map(x=>x[0]).join("").slice(0,2);
    return `<button class="hc5 ${cls}" data-id="${r.id}" aria-label="${esc(r.name)}, ${lab[c[1]]}, ${fmt(c[0])}. Sample record. Open profile"><span class="mn" aria-hidden="true">${ini}</span><span><span class="nm">${esc(r.name)}</span><span class="ar">${esc(r.area)}, ${esc(r.city)}</span><span class="st ${TYPES[c[1]][1]}">${lab[c[1]]}</span></span><span class="ft"><span>${line}</span><b>${fmt(c[0])}</b></span></button>`}).join("");
  w.onclick=e=>{const b=e.target.closest(".hc5");if(b)openSample(+b.dataset.id)};
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
  const id=DEMO,r=SAMPLE_GREEN,c=cur(r),p=PROF[id],sc=scoreOf(id),ec=evCounts(id);
  /* restaurant dashboard preview */
  document.getElementById("ckPrev").innerHTML=`<div class="p5-top"><div><div class="p5-k">Restaurant dashboard · sample</div><div class="p5-n">${esc(r.name)}</div></div>${lvlFor(id)}</div>
   <div class="p5-sec"><div class="p5-k">Food Safety Compliance</div><div class="p5-score">${pubScore(id,sc.overall)}</div>
   <div class="p5-kpis"><div><b>${sc.done}/${sc.tot}</b><span>Requirements met</span></div><div><b>${ec.total}</b><span>Evidence items</span></div><div><b>${sc.missing.length}</b><span>Need attention</span></div></div></div>
   <div class="p5-sec"><div class="p5-k">Needs attention</div><ul class="p5-list">${sc.missing.slice(0,2).map(m=>`<li><span>${esc(m.r.text)}</span><em>${m.why.toUpperCase()}</em></li>`).join("")}</ul></div>
   <div class="p5-sec"><div class="p5-k">Evidence freshness</div><ul class="p5-list">${["kitchen","pest","personal"].map(k=>{const f=fresh(id,k);return `<li><span style="display:flex;gap:10px;align-items:center"><span class="fd fd-${f.st}"></span>${CAT[k].name}</span><em>${f.txt.toUpperCase()}</em></li>`}).join("")}</ul></div>`;
  /* public profile */
  document.getElementById("pmCard").innerHTML=`<div class="p5-top"><div><div class="p5-k">Food Safety Profile · sample</div><div class="p5-n">${esc(r.name)}</div><div class="muted" style="font-size:13px">${esc(r.area)}, ${esc(r.city)}</div></div>${lvlFor(id)}</div>
   <div class="p5-sec"><div class="p5-k">Food Safety Compliance</div><div class="p5-score">${pubScore(id,sc.overall)}<dl class="scoremeta"><dt>Evidence</dt><dd>${ec.total} pieces</dd><dt>Last updated</dt><dd>${ec.last?ago(ec.last):"—"}</dd></dl></div>${barsHTML(sc)}</div>
   <div class="p5-sec" style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:center"><span class="tag tag-off">Official status</span>${st(c[1])}</div>`;
  document.getElementById("pmOpen").onclick=()=>openSample(SAMPLE_GREEN.id);
  /* journey */
  const pts=[...p.journey.map(j=>({m:j.m,s:j.score,k:j.kind,n:j.notes})),{m:"Sep 2026 · now",s:paused(id)?null:sc.overall,k:paused(id)?"Compliance score paused while an official action is open":"Current",n:sc.missing.length?[sc.missing.length+" requirement"+(sc.missing.length>1?"s":"")+" open"]:["All requirements met"],now:true}];
  document.getElementById("jrChart").innerHTML=`<div class="tl5">${pts.map(q=>`<div class="tl5-i ${q.now?"now":""}"><span class="tl5-m">${esc(q.m)}</span><span class="tl5-dot"></span><b>${q.s==null?"—":q.s+"<small>/100</small>"}</b><span class="k2">${esc(q.k)}</span><ul>${q.n.map(x=>`<li>${esc(x)}</li>`).join("")}</ul></div>`).join("")}</div><p class="tl5-note">Sample: ${esc(r.name)}'s evidence over three months. Scores are recalculated as evidence is added or expires.</p>`;
  /* community */
  const x=SAMPLE_REPORT;
  document.getElementById("cmExample").innerHTML=`<div class="p5-top"><div><div class="p5-k">Community report · sample</div><div class="p5-n">${esc(r.name)}</div></div>${rsPill(x.status)}</div>
   <div class="rep"><div class="top"><span class="tag tag-com">Reported ${fmt(x.date)}</span>${x.photo?"<span>Photo attached</span>":""}</div><p style="font-size:17px">${esc(x.text)}</p>
   <div class="resp"><span class="tag tag-self">Restaurant response · ${fmt(x.response.date)}</span><div>${esc(x.response.text)}</div><div class="muted" style="font-size:12px;margin-top:4px">Evidence: ${esc(x.response.ev)}</div></div></div>`;
  document.getElementById("finalSearch").onsubmit=e=>{e.preventDefault();S.q=document.getElementById("finalQ").value;document.getElementById("q").value=S.q;S.pendingSearch=S.q;go("tracker")};
  document.getElementById("navSearch").onclick=()=>{go("tracker");setTimeout(()=>document.getElementById("q").focus(),50)};
}
heroCards();initHero();renderHomeExtras();loadHome();
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
            {m:"SEP 2026",s:null,n:"Corrective evidence uploaded after the suspension. Compliance score paused while an official action is open: our compliance score measures submitted evidence and never overrides an official finding."}];
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
      <div class="note"><b>${j.m.charAt(0)+j.m.slice(1,3).toLowerCase()} · ${j.s==null?"compliance score paused":j.s+"/100"}.</b> ${j.n}</div></div>`)}
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
  function syncJr(){const x=JR[DM.jr];body.querySelectorAll("[data-jr]").forEach(b=>b.setAttribute("aria-pressed",String(+b.dataset.jr===DM.jr)));const r=document.getElementById("jrRange");if(r)r.value=DM.jr;const n=body.querySelector(".dm-jr .note");if(n)n.innerHTML=`<b>${x.m.charAt(0)+x.m.slice(1,3).toLowerCase()} · ${x.s==null?"compliance score paused":x.s+"/100"}.</b> ${x.n}`}
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
  const NOTES=["Owners confirm ownership with their FSSAI licence number and a one-time code to the owner's phone.","27 requirements across 7 categories, based on public FSSAI hygiene parameters.","Photos, videos and PDFs, each dated. Evidence expires, so the profile stays live.","Owners are notified of every report and can reply publicly with evidence.","Our team reviews the evidence. Approved profiles show PlateWatch verified."];
  function rsDash(active){
    const id=DEMO,r=SAMPLE_GREEN,p=PROF[id],sc=scoreOf(id),ec=evCounts(id),nrep=1;
    document.getElementById("rsDash").innerHTML=`
      <div class="p5-top" data-hl="0"><div><div class="p5-k">Restaurant dashboard · sample</div><div class="p5-n">${esc(r.name)}</div><div class="muted" style="font-size:13px">Claimed by owner · ${esc(r.area)}, ${esc(r.city)}</div></div><span data-hl="4">${lvlFor(id)}</span></div>
      <div class="p5-sec"><div class="p5-k">Food Safety Compliance</div><div class="p5-score">${pubScore(id,sc.overall)}</div>
      <div class="p5-kpis"><div data-hl="1"><b>${sc.done}/${sc.tot}</b><span>Requirements complete</span></div><div data-hl="2"><b>${ec.total}</b><span>Evidence submissions</span></div><div data-hl="3"><b>${nrep}</b><span>Community reports</span></div></div></div>`;
    document.querySelectorAll("#rsDash [data-hl]").forEach(el=>el.classList.toggle("hl",+el.dataset.hl===active));
    document.getElementById("rsNote").textContent=NOTES[active];
    document.querySelectorAll("#rsteps [data-rs]").forEach(b=>b.setAttribute("aria-pressed",String(+b.dataset.rs===active)));
  }
  document.getElementById("rsteps").addEventListener("click",e=>{const b=e.target.closest("[data-rs]");if(b)rsDash(+b.dataset.rs)});
  rsDash(0);
})();



renderSeg();syncAuthBtn();
{const t=parseHash(location.hash);if(t)go(t.p,t.arg,{fromHash:true});else history.replaceState(null,"","#home")}
/* still signed in from an earlier visit? then finish what the first render couldn't (#account waits on this) */
api("GET","/me",undefined,{timeout:5000}).then(async({user})=>{
  if(!user||S.user)return;
  await signedIn(user);
  const p=S.page.p;
  if(p==="login"&&(S.after==="account"||S.after==="admin")){const nx=S.after;S.after=null;go(nx)}
  else if(p==="biz"&&S.owner!=null&&location.hash==="#restaurants")go("dash","overview");
  else if(p==="account")renderAccount();
  else if(p==="detail")renderDetail(S.page.arg);
}).catch(()=>{/* API unreachable: browsing works signed out */});
/* spot-check deadlines and countdowns run on the shared demo clock */
setInterval(()=>{SCM.tick();document.querySelectorAll("[data-countdown]").forEach(el=>{el.textContent=SCM.left(+el.dataset.countdown)})},1000);
}
