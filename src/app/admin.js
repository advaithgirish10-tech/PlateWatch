/*
 * PlateWatch admin: every queue and rule comes from the API (/api/admin/*, admin accounts only).
 * Tabs: verification requests, evidence, community reports, official record, scoring rules,
 * evidence expiry, activity log. Escalations, escalation rules and spot checks show as "not built yet".
 */
export function createAdmin({ api, esc, fmt, toast, go }) {
const $=id=>document.getElementById(id);
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
const ago=d=>{const n=Math.round((Date.parse(new Date().toISOString().slice(0,10))-Date.parse(d))/864e5);return n<=0?"today":n===1?"yesterday":n+" days ago"};
const empty=(h,p,extra)=>`<div class="ad-empty"><span class="ad-empty-mark" aria-hidden="true">${ICO.ok}</span><h3>${h}</h3><p>${p}</p>${extra||""}</div>`;
const EVST={submitted:["Pending review","pend"],more:["More requested","more"],verified:["Approved","ok"],rejected:["Rejected","no"]};
const LV={self:"Claimed · self-reported",pending:"Verification requested",platform:"PlateWatch verified"};
const TYPES={sus:"Suspended",rev:"Revoked",imp:"Improvement notice",ok:"Reinstated"};
const RES_REASONS=["The proof doesn't show the problem was fixed","The photo is unclear","The PDF isn't about this problem","The proof shows people's faces"];
const REJECT_REASONS=["No food-safety issue described","Evidence doesn't match the outlet","Duplicate of another report","Personal or abusive content","Not enough detail to act on"];
const ACTIONS={"evidence.verified":"Approved evidence","evidence.rejected":"Rejected evidence","evidence.more":"Asked for more evidence","evidence.update":"Changed evidence flags","evidence.submit":"Owner submitted evidence","evidence.remove":"Owner removed an upload","evidence.purge":"Deleted old files (photos after 4 months, PDFs after 2 years)",
 "verification.approve":"Approved verification","verification.more":"Asked for more before verifying","verification.reject":"Rejected verification","verification.request":"Owner requested verification",
 "report.accept":"Accepted a report","report.reject":"Rejected a report","report.more":"Asked a reporter for more","report.coordinated":"Marked a report as coordinated","report.keep":"Kept a flagged report published","report.false":"Marked a report as false","report.respond":"Owner marked a report resolved","resolution.approve":"Approved a restaurant's proof","resolution.reject":"Turned down a restaurant's proof","report.flag":"Owner flagged a report",
 "enforcement.add":"Recorded an official action","licence.active":"Licence checked: active","licence.inactive":"Licence checked: inactive","licence.not_found":"Licence checked: not found","restaurant.licence":"Added a licence number","restaurant.import_osm":"Imported from OpenStreetMap","restaurant.create":"Added a restaurant","requirement.update":"Changed a requirement","category.update":"Changed evidence expiry","owner.claim":"Restaurant claimed","user.delete":"Account deleted","user.grant_admin":"Made an admin","user.revoke_admin":"Removed an admin","user.ban":"Banned a reporter","user.unban":"Lifted a ban"};

/* view state; the data itself is always re-read from the API */
const A={tab:"verify",summary:null,data:{},err:null,q:"",filter:"all",sort:"new",view:"list",offset:0,sel:null,detail:null,box:null,rejecting:null,rec:{q:"",hits:[],pick:null}};
const PAGE=50;

const TABS=[["verify","Verification requests",s=>s.verificationRequests],["evidence","Evidence",s=>s.pendingEvidence],["reports","Community reports",s=>s.reportsToModerate],
 ["licence","Licence checks",s=>s.licenceChecks],["record","Official record"],["scoring","Scoring rules"],["expiry","Evidence expiry"],["activity","Activity log"],["banned","Banned accounts"],
 ["escalations","Escalations",null,true],["rules","Escalation rules",null,true],["spot","Spot checks",null,true]];

/* ---------- loading ---------- */
async function load(tab){
  if(tab==="verify")A.data.verify=(await api("GET","/admin/verification-requests")).items;
  if(tab==="evidence"){const q=new URLSearchParams({filter:A.filter,sort:A.sort,limit:PAGE,offset:0});if(A.q.trim())q.set("q",A.q.trim());A.offset=0;A.data.evidence=await api("GET","/admin/evidence?"+q)}
  if(tab==="reports")A.data.reports=(await api("GET","/admin/reports")).items;
  if(tab==="licence")A.data.licence=(await api("GET","/admin/licence-checks")).items;
  if(tab==="scoring"||tab==="expiry")A.data.catalog=await api("GET","/admin/catalog");
  if(tab==="activity")A.data.activity=(await api("GET","/admin/audit?limit=100")).items;
  if(tab==="banned")A.data.banned=(await api("GET","/admin/banned")).items;
}
async function show(tab){
  if(tab!==A.tab){A.sel=null;A.detail=null;A.box=null;A.rejecting=null}
  A.tab=tab;A.err=null;render(true);
  await refresh();
}
/* re-read the summary and the open tab, then draw */
async function refresh(){
  const tab=A.tab;
  try{
    const [s]=await Promise.all([api("GET","/admin/summary"),load(tab)]);
    A.summary=s;A.err=null;
  }catch(e){A.err=e}
  if(A.tab===tab&&!$("p-admin").hidden)render();
}

/* ---------- page ---------- */
function render(loading){
  const s=A.summary;
  $("admSummary").innerHTML=[["Pending",s&&s.pendingEvidence+s.verificationRequests],["Reports",s&&s.reportsToModerate],["Expiring soon",s&&s.expiringSoon]].map(([l,n])=>`<div><dt>${l}</dt><dd>${n==null?"—":n}</dd></div>`).join("");
  $("atabs").innerHTML=TABS.map(([k,l,n,soon])=>{const c=s&&n?n(s):0;return `<button role="tab" data-atab="${k}" aria-selected="${k===A.tab}">${l}${c?`<span class="ad-count">${c}</span>`:""}${soon?`<span class="ad-count ad-soon">Soon</span>`:""}</button>`}).join("");
  let h;
  if(A.err)h=errorHTML(A.err);
  else if(loading&&!hasData(A.tab))h=`<div class="ad-surface">${empty("Loading…","Fetching the latest from PlateWatch.")}</div>`;
  else h=({verify:verifyHTML,evidence:evidenceHTML,reports:reportsHTML,licence:licenceHTML,record:recordHTML,scoring:scoringHTML,expiry:expiryHTML,activity:activityHTML,banned:bannedHTML}[A.tab]||soonHTML)();
  $("adm").innerHTML=`<div class="ad-pane" role="tabpanel">${h}</div><div id="admOverlay"></div>`;
  overlays();
}
const hasData=t=>({verify:A.data.verify,evidence:A.data.evidence,reports:A.data.reports,licence:A.data.licence,scoring:A.data.catalog,expiry:A.data.catalog,activity:A.data.activity,banned:A.data.banned,record:true}[t]!==undefined)||!["verify","evidence","reports","licence","scoring","expiry","activity","banned","record"].includes(t);
function errorHTML(e){
  if(e.status===401)return `<div class="ad-surface">${empty("Your session ended","Log in again to keep reviewing.",`<button class="ad-btn ad-btn-pri" data-relogin>Log in</button>`)}</div>`;
  if(e.status===403)return `<div class="ad-surface">${empty("Staff only","This account isn't a PlateWatch admin.")}</div>`;
  return `<div class="ad-surface">${empty("Couldn't load this",esc(e.message),`<button class="ad-btn ad-btn-out" data-retry>Try again</button>`)}</div>`;
}

/* ---------- verification requests ---------- */
function verifyHTML(){
  const list=A.data.verify||[];
  return `<div class="ad-surface">${list.map(v=>`<article class="ad-row ad-row-plain"><div class="ad-row-body">
    <div class="ad-row-top"><div class="ad-row-id"><h3 class="ad-fn">${esc(v.name)}</h3><div class="ad-meta"><span>${esc(v.area)}, ${esc(v.city)}</span><span>${esc(v.category)}</span><span>Owner · ${esc(v.owner)}</span>${v.requestedOn?`<span>Requested ${ago(v.requestedOn)}</span>`:""}</div></div>
      <div class="ad-badges"><span class="ad-badge ad-b-pend">Verification requested</span></div></div>
    <dl class="ad-stats"><div><dt>Score</dt><dd>${v.score}<small>/100</small></dd></div><div><dt>Requirements met</dt><dd>${v.requirementsMet}<small>/${v.requirementsTotal}</small></dd></div><div><dt>Evidence items</dt><dd>${v.evidenceItems}</dd></div><div><dt>Critical open</dt><dd class="${v.criticalOpen.length?"is-bad":""}">${v.criticalOpen.length}</dd></div></dl>
    ${v.criticalOpen.length?`<ul class="ad-obs-list">${v.criticalOpen.map(t=>`<li class="ad-obs ad-obs-warn">${ICO.warn}<span>${esc(t)}</span></li>`).join("")}</ul>`:""}
    ${v.pendingEvidence?`<p class="ad-muted">${v.pendingEvidence} evidence item${v.pendingEvidence===1?"":"s"} still waiting for review. Approve or reject ${v.pendingEvidence===1?"it":"them"} in the Evidence tab first.</p>`
      :v.requirementsMet<v.requirementsTotal?`<p class="ad-muted">${v.requirementsTotal-v.requirementsMet} requirement${v.requirementsTotal-v.requirementsMet===1?" has":"s have"} no current evidence, so this can't be approved yet. Request more evidence or reject.</p>`:""}
    <div class="ad-acts"><span></span><span class="ad-acts-main"><button class="ad-btn ad-btn-out" data-v="more" data-rid="${v.restaurantId}">Request more evidence</button><button class="ad-btn ad-btn-danger" data-v="reject" data-rid="${v.restaurantId}">Reject</button><button class="ad-btn ad-btn-pri" data-v="approve" data-rid="${v.restaurantId}" ${v.pendingEvidence||v.requirementsMet<v.requirementsTotal?"disabled":""}>Approve</button></span></div>
  </div></article>`).join("")||empty("No pending verification requests","Restaurants appear here when their owner taps “Request verification” in the dashboard.")}</div>`;
}

/* ---------- evidence ---------- */
const badge=e=>`<span class="ad-badge ad-b-${EVST[e.status][1]}">${EVST[e.status][0]}</span>${e.flagged?`<span class="ad-badge ad-b-flag">${ICO.flag}Flagged</span>`:""}`;
function preview(e,big){
  const cls="ad-pv"+(big?" ad-pv-lg":"");
  if(e.kind==="photo")return `<button class="${cls}" data-box="${e.id}" aria-label="Open larger preview of ${esc(e.name)}"><img src="${esc(e.url)}" alt="" onload="this.parentNode.classList.add('ld')" onerror="this.parentNode.classList.add('ld')"><span class="ad-pv-zoom">${ICO.expand}</span></button>`;
  if(big&&e.kind==="video")return `<div class="${cls}"><video src="${esc(e.url)}" controls preload="metadata" style="width:100%;max-height:360px"></video></div>`;
  return `<a class="${cls} ad-pv-none" href="${esc(e.url)}" target="_blank" rel="noopener" aria-label="Open ${esc(e.name)} in a new tab">${e.kind==="video"?ICO.img:ICO.doc}<span>Open ${e.kind==="video"?"video":"PDF"}</span><em>${e.kind}</em></a>`;
}
const acts=e=>`<button class="ad-link${e.flagged?" is-on":""}" data-e="flag" data-eid="${e.id}" aria-pressed="${!!e.flagged}">${ICO.flag}${e.flagged?"Flagged":"Flag"}</button>
  <span class="ad-acts-main"><button class="ad-btn ad-btn-out" data-e="more" data-eid="${e.id}">Request more evidence</button><button class="ad-btn ad-btn-danger" data-e="rejected" data-eid="${e.id}">Reject</button><button class="ad-btn ad-btn-pri" data-e="verified" data-eid="${e.id}">Approve</button></span>`;
function evRow(e){
  return `<article class="ad-row${A.sel===e.id?" is-sel":""}" data-row="${e.id}">
    <div class="ad-row-media">${preview(e)}</div>
    <div class="ad-row-body">
      <div class="ad-row-top"><div class="ad-row-id"><h3 class="ad-fn"><button data-open="${e.id}">${esc(e.name)}</button></h3>
        <div class="ad-meta"><span class="ad-meta-strong">${esc(e.restaurant.name)}</span><span>${esc(e.restaurant.area)}, ${esc(e.restaurant.city)}</span><span>${esc(e.requirement.category)}</span><span>Submitted ${ago(e.capturedOn)}</span></div></div>
        <div class="ad-badges">${e.status==="submitted"?dueBadge(e):""}${badge(e)}</div></div>
      <div class="ad-row-grid">
        <section class="ad-sec" aria-label="Evidence details"><h4 class="ad-lbl">Evidence details</h4>
          <dl class="ad-dl">
            <div class="ad-dl-wide"><dt>Requirement</dt><dd>${esc(e.requirement.text)}${e.requirement.critical?` <span class="ad-crit">Critical</span>`:""}</dd></div>
            <div><dt>Evidence type</dt><dd>${cap(e.kind)}</dd></div>
            <div><dt>Submitted by</dt><dd>${e.submittedBy?"Owner · "+esc(e.submittedBy):"Account deleted"}</dd></div>
            <div><dt>Submitted date</dt><dd>${fmt(e.capturedOn)}</dd></div>
            <div><dt>Verification status</dt><dd>${LV[e.ownerLevel]||"—"}</dd></div>
          </dl>
          ${e.note?`<p class="ad-note"><span class="ad-lbl">Owner's note</span>${esc(e.note)}</p>`:""}</section>
        <section class="ad-sec" aria-label="Checks"><h4 class="ad-lbl">Checks</h4>
          <ul class="ad-obs-list"><li class="ad-obs ad-obs-ok">${ICO.ok}<span>File type confirmed and photo location data removed on upload</span></li>
          <li class="ad-obs ad-obs-info">${ICO.info}<span>${e.validUntilDays>=0?`Counts for ${e.validUntilDays} more day${e.validUntilDays===1?"":"s"} once approved`:"Already past its validity window"}</span></li>
          ${e.containsPeople?`<li class="ad-obs ad-obs-warn">${ICO.warn}<span>Marked as showing people: never published until faces are blurred</span></li>`:""}</ul>
          <p class="ad-muted">No automated image checks yet. Review the file yourself.</p></section>
      </div>
      <div class="ad-acts">${acts(e)}</div>
    </div></article>`;
}
function evidenceHTML(){
  const d=A.data.evidence||{items:[],total:0};
  const list=d.items.length?d.items.map(evRow).join("")+(d.items.length<d.total?`<div class="ad-empty" style="padding:18px"><button class="ad-btn ad-btn-out" data-more>Show ${Math.min(PAGE,d.total-d.items.length)} more</button></div>`:"")
    :(A.q||A.filter!=="all"?empty("No evidence matches these filters","Try a different search or filter.",`<button class="ad-btn ad-btn-out" data-clear>Clear filters</button>`):empty("No evidence waiting for review","Everything restaurants submitted has been reviewed."));
  return `<div class="ad-toolbar">
      <label class="ad-search">${ICO.search}<input id="admQ" type="search" placeholder="Search file, restaurant or requirement…" value="${esc(A.q)}" aria-label="Search evidence" autocomplete="off"></label>
      <div class="ad-seg" role="group" aria-label="Filter">${[["all","All"],["pending","Pending"],["flagged","Flagged"],["recent","Recently submitted"]].map(([k,l])=>`<button data-af="${k}" aria-pressed="${A.filter===k}">${l}</button>`).join("")}</div>
      <label class="ad-select"><span>Sort</span><select id="admSort">${[["new","Newest"],["old","Oldest"],["priority","Highest priority"]].map(([k,l])=>`<option value="${k}" ${A.sort===k?"selected":""}>${l}</option>`).join("")}</select></label>
      <div class="ad-seg ad-seg-view" role="group" aria-label="View">${[["list","List"],["compact","Compact"]].map(([k,l])=>`<button data-av="${k}" aria-pressed="${A.view===k}">${l}</button>`).join("")}</div>
    </div>
    <div class="ad-listhead"><span>${d.items.length} of ${d.total} ${d.total===1?"item":"items"}</span><span>Select an item to open the review panel</span></div>
    <div class="ad-surface ad-list${A.view==="compact"?" is-compact":""}" id="adList">${list}</div>`;
}
/* the review panel for one item, and the photo lightbox */
function panelHTML(){
  const e=A.detail;if(!e||e.id!==A.sel)return A.sel?`<div class="ad-scrim in" data-close="panel"></div><aside class="ad-panel in" role="dialog" aria-modal="true" aria-label="Loading evidence"><div class="ad-panel-body">${empty("Loading…","")}</div></aside>`:"";
  const waiting=e.status==="submitted"||e.status==="more";
  return `<div class="ad-scrim in" data-close="panel"></div>
  <aside class="ad-panel in" role="dialog" aria-modal="true" aria-labelledby="adPanelTitle">
    <div class="ad-panel-head"><div><div class="ad-lbl">Evidence · ${esc(e.restaurant.name)}</div><h2 id="adPanelTitle" class="ad-panel-title">${esc(e.name)}</h2><div class="ad-badges">${badge(e)}</div></div>
      <button class="ad-iconbtn" data-close="panel" aria-label="Close panel" id="adPanelClose">${ICO.x}</button></div>
    <div class="ad-panel-body">
      ${preview(e,true)}
      <section class="ad-psec"><h4 class="ad-lbl">Details</h4><dl class="ad-kv">
        <dt>Restaurant</dt><dd>${esc(e.restaurant.name)} · ${esc(e.restaurant.area)}, ${esc(e.restaurant.city)}</dd>
        <dt>Requirement</dt><dd>${esc(e.requirement.text)}${e.requirement.critical?` <span class="ad-crit">Critical</span>`:""}</dd>
        <dt>Category</dt><dd>${esc(e.requirement.category)} · weight ${e.requirement.weight} of 5</dd>
        <dt>Submitted by</dt><dd>${e.submittedBy?"Owner · "+esc(e.submittedBy):"Account deleted"}</dd>
        <dt>Submitted</dt><dd>${fmt(e.capturedOn)} · ${ago(e.capturedOn)}</dd>
        <dt>Valid until</dt><dd>${fmt(e.validUntil)} · ${e.expiryDays}-day window</dd>
        <dt>Verification</dt><dd>${LV[e.ownerLevel]||"—"}</dd>
        <dt>Current score</dt><dd>${e.restaurantScore.overall}/100 · ${e.restaurantScore.done}/${e.restaurantScore.total} met</dd></dl></section>
      <section class="ad-psec"><h4 class="ad-lbl">Earlier submissions <span class="ad-lbl-sub">Same requirement</span></h4>
        ${e.history.length?`<ul class="ad-hist">${e.history.map(x=>`<li><span class="ad-hist-n">${esc(x.name)}</span><span class="ad-hist-d">${fmt(x.capturedOn)}</span>${badge(x)}</li>`).join("")}</ul>`:`<p class="ad-muted">First submission for this requirement.</p>`}</section>
      <section class="ad-psec"><h4 class="ad-lbl">Reviewer notes</h4>
        ${e.note?`<p class="ad-note"><span class="ad-lbl">Owner's note</span>${esc(e.note)}</p>`:""}
        <textarea class="ad-textarea" rows="3" data-rnote="${e.id}" placeholder="Internal note for other reviewers" aria-label="Reviewer note">${esc(e.reviewNote||"")}</textarea>
        <p class="ad-hint">Internal only. Saved when you leave the box. Not shown to the restaurant.</p>
        ${e.kind==="photo"?`<label class="check" style="margin-top:12px"><input type="checkbox" data-people="${e.id}" ${e.containsPeople?"checked":""}><span>Shows people. Never published until faces are blurred.</span></label>`:""}</section>
    </div>
    ${waiting?`<div class="ad-panel-foot ad-acts">${acts(e)}</div>`:""}
  </aside>`;
}
function boxHTML(){
  const items=(A.data.evidence&&A.data.evidence.items)||[];
  const e=A.box==null?null:(A.detail&&A.detail.id===A.box?A.detail:items.find(x=>x.id===A.box));
  if(!e||e.kind!=="photo")return "";
  return `<div class="ad-lb" role="dialog" aria-modal="true" aria-label="Evidence preview" data-close="box">
    <figure><img src="${esc(e.url)}" alt="${esc(e.name)}"><figcaption><span>${esc(e.name)}</span><span>${esc(e.restaurant.name)} · ${fmt(e.capturedOn)}</span></figcaption></figure>
    <button class="ad-iconbtn ad-lb-x" data-close="box" aria-label="Close preview" id="adBoxClose">${ICO.x}</button></div>`;
}
function overlays(){
  const el=$("admOverlay");if(!el)return;
  el.innerHTML=(A.tab==="evidence"?panelHTML():"")+boxHTML();
  document.documentElement.classList.toggle("ad-lock",!!el.innerHTML);
}
async function openPanel(id){
  A.sel=id;A.detail=null;overlays();
  try{A.detail=await api("GET","/admin/evidence/"+id)}catch(e){toast(e.message);A.sel=null}
  overlays();const b=$("adPanelClose");if(b)b.focus();
}
function closeOverlay(which){if(which==="box")A.box=null;else{A.sel=null;A.detail=null}overlays()}

/* ---------- community reports ---------- */
const KIND={photo:"photo",video:"video",bill:"bill",note:"doctor's note"};
/* every report and every upload is checked within 24 hours of arriving */
function dueBadge(x){
  const left=Date.parse(x.verifyBy)-Date.now(),h=Math.ceil(Math.abs(left)/36e5);
  if(left<0)return `<span class="ad-badge ad-b-no">Overdue by ${h} h</span>`;
  return `<span class="ad-badge ${left<4*36e5?"ad-b-more":""}" title="Verify by ${esc(new Date(x.verifyBy).toLocaleString("en-IN",{day:"numeric",month:"short",hour:"numeric",minute:"2-digit",timeZone:"Asia/Kolkata"}))}">Verify within ${h} h</span>`;
}
/* 2 reports marked false in 7 days: an admin may ban the number */
function reporterHTML(x){
  const n=x.reporterFalseThisWeek||0;
  if(x.reporterBanned)return `<span class="ad-badge ad-b-no">Banned</span>`;
  const t=n?`${n} false report${n>1?"s":""} this week`:"No false reports this week";
  return n>=2&&x.reporterId?`${t} <button class="ad-btn ad-btn-danger ad-btn-sm" data-ban="${esc(x.reporterId)}">Ban reporter</button>`:t;
}
/* the restaurant's "action taken": check the proof within 24 hours, then it's public next to the report */
function resolutionHTML(x){
  const r=x.resolution;if(!r||r.status!=="pending")return "";
  const p=r.proof,rej=A.rejectingRes===x.id;
  const proof=!p?"":p.kind==="document"?`<a class="ad-btn ad-btn-out" href="${esc(p.url)}" target="_blank" rel="noopener">${ICO.doc}Open PDF proof</a>`
    :`<figure class="ad-scph"><a href="${esc(p.url)}" target="_blank" rel="noopener"><img src="${esc(p.url)}" alt="Proof photo for ${esc(x.ref)}"></a><figcaption><b>Proof photo</b></figcaption></figure>`;
  return `<div class="ad-note ad-res"><span class="ad-lbl">Restaurant says it's resolved · ${dueBadge(r)}</span>${esc(r.text)}<div class="ad-scphotos" style="margin-top:10px">${proof}</div>
    ${rej?`<div class="ad-reason"><label class="ad-select"><span>Reason</span><select id="admResReason">${RES_REASONS.map(o=>`<option>${esc(o)}</option>`).join("")}</select></label><button class="ad-btn ad-btn-out" data-res="cancel" data-rep="${x.id}">Cancel</button><button class="ad-btn ad-btn-danger ad-btn-danger-solid" data-res="reject-go" data-rep="${x.id}">Turn down proof</button></div>`
      :`<div class="ad-acts"><span class="ad-td-muted">Approving shows the comment and proof next to the report on the public profile.</span><span class="ad-acts-main"><button class="ad-btn ad-btn-danger" data-res="reject" data-rep="${x.id}">Proof not enough</button><button class="ad-btn ad-btn-pri" data-res="approve" data-rep="${x.id}">Approve proof</button></span></div>`}</div>`;
}
function reportRow(x){
  const pend=x.status==="pending",rej=A.rejecting===x.id;
  /* in the queue only because the restaurant sent proof */
  const onlyProof=!pend&&!x.flaggedByOwner;
  const age=x.numberAgeDays==null?"No verified number":x.numberAgeDays===0?"Number verified today":x.numberAgeDays===1?"Number verified yesterday":`Number verified ${x.numberAgeDays} days ago`;
  return `<article class="ad-row ad-row-plain"><div class="ad-row-body">
    <div class="ad-row-top"><div class="ad-row-id"><h3 class="ad-fn">${esc(x.place.name||"Unknown place")}${x.place.id?"":` <span class="ad-td-muted">(not listed)</span>`}</h3>
      <div class="ad-meta"><span>${esc([x.place.area,x.place.city].filter(Boolean).join(", "))}</span><span>${esc(x.category)}</span><span>${esc(x.ref)}</span><span>Received ${ago(x.receivedOn)}</span><span>via ${x.channel==="whatsapp"?"WhatsApp":"the website"}</span></div></div>
      <div class="ad-badges">${x.resolution&&x.resolution.status==="pending"?`<span class="ad-badge ad-b-more">Proof to check</span>`:""}${pend?dueBadge(x):""}${pend?`<span class="ad-badge ad-b-pend">${x.askMore?"More requested":"Pending"}</span>`:`<span class="ad-badge ad-b-ok">Published</span>`}${x.share?"":`<span class="ad-badge">Kept private</span>`}${x.flaggedByOwner?`<span class="ad-badge ad-b-flag">${ICO.flag}Restaurant flagged as incorrect</span>`:""}</div></div>
    <blockquote class="ad-quote">${esc(x.text)}</blockquote>
    ${x.files.length?`<div class="ad-scphotos">${x.files.map(f=>f.kind==="photo"||(f.kind==="bill"&&/\.(jpe?g|png|webp)$/i.test(f.name))?`<figure class="ad-scph"><a href="${esc(f.url)}" target="_blank" rel="noopener"><img src="${esc(f.url)}" alt="${esc(KIND[f.kind])} attached to ${esc(x.ref)}"></a><figcaption><b>${esc(cap(KIND[f.kind]))}</b></figcaption></figure>`:`<figure class="ad-scph"><a class="ad-pv ad-pv-none" href="${esc(f.url)}" target="_blank" rel="noopener">${ICO.doc}<span>Open ${esc(KIND[f.kind])}</span></a></figure>`).join("")}</div>`:""}
    ${x.resolution&&x.resolution.status!=="pending"?`<div class="ad-note"><span class="ad-lbl">Restaurant's action · proof ${x.resolution.status}</span>${esc(x.resolution.text)}</div>`:""}${resolutionHTML(x)}
    <dl class="ad-facts"><div><dt>Evidence</dt><dd>${x.evidence.length?esc(x.evidence.map(k=>KIND[k]).join(", ")):"None"}</dd></div><div><dt>Reporter</dt><dd>${age}<div class="ad-td-muted" style="margin-top:2px">${reporterHTML(x)}</div></dd></div><div><dt>Counts toward escalation</dt><dd>${esc(x.countsTowardEscalation)}</dd></div></dl>
    ${rej?`<div class="ad-reason"><label class="ad-select"><span>Reason</span><select id="admReason">${REJECT_REASONS.map(o=>`<option>${o}</option>`).join("")}</select></label><button class="ad-btn ad-btn-out" data-m="cancel" data-rep="${x.id}">Cancel</button><button class="ad-btn ad-btn-danger ad-btn-danger-solid" data-m="reject-go" data-rep="${x.id}">Reject report</button></div>`:""}
    ${onlyProof?"":`<div class="ad-acts">${pend?`<button class="ad-link" data-m="coordinated" data-rep="${x.id}">Mark as coordinated</button><span class="ad-acts-main"><button class="ad-btn ad-btn-out" data-m="more" data-rep="${x.id}" ${x.askMore||x.numberAgeDays==null?"disabled":""}>Ask reporter for more</button><button class="ad-btn ad-btn-danger" data-m="false" data-rep="${x.id}" title="The complaint isn't true. Counts against the reporter.">False report</button><button class="ad-btn ad-btn-danger" data-m="reject" data-rep="${x.id}">Reject with reason</button><button class="ad-btn ad-btn-pri" data-m="accept" data-rep="${x.id}">Accept</button></span>`
      :`<span></span><span class="ad-acts-main"><button class="ad-btn ad-btn-danger" data-m="false" data-rep="${x.id}">False report</button><button class="ad-btn ad-btn-danger" data-m="reject" data-rep="${x.id}">Reject with reason</button><button class="ad-btn ad-btn-pri" data-m="keep" data-rep="${x.id}">Keep published</button></span>`}</div>`}
  </div></article>`;
}
const reportsHTML=()=>`<div class="ad-surface">${(A.data.reports||[]).map(reportRow).join("")||empty("No reports waiting","Every community report has been moderated.")}</div>`;

/* ---------- FSSAI licence checks: done by hand on FoSCoS (its search has a captcha) ---------- */
const LIC={active:"Active",inactive:"Inactive or expired",not_found:"Not found"};
function licenceHTML(){
  const list=A.data.licence||[];
  return `<div class="ad-sechead"><p>FSSAI's licence search (FoSCoS) has a captcha, so these checks are done by hand: open FoSCoS, choose <b>FBO Search</b>, paste the licence number, then record what it shows. Checks repeat every 90 days. Claimed restaurants come first.</p><a class="ad-btn ad-btn-out" href="https://foscos.fssai.gov.in/" target="_blank" rel="noopener">Open FoSCoS</a></div>
    <div class="ad-surface ad-tbl">${list.length?`<table><thead><tr><th>Restaurant</th><th>Licence number</th><th>Last check</th><th><span class="sr-only">Record the result</span></th></tr></thead><tbody>${list.map(r=>`<tr>
      <td><b>${esc(r.name)}</b><div class="ad-td-muted">${esc(r.area)}, ${esc(r.city)}${r.claimed?" · claimed":""}${r.source==="osm"?" · from OpenStreetMap":""}</div></td>
      <td><span class="sc-code">${esc(r.licenceNumber)}</span> <button class="ad-link" data-copy-lic="${esc(r.licenceNumber)}">Copy</button></td>
      <td class="ad-td-muted">${r.licenceStatus?`${LIC[r.licenceStatus]} · ${fmt(r.licenceCheckedOn)}`:"Never checked"}</td>
      <td><span class="ad-acts-main"><button class="ad-btn ad-btn-pri" data-lc="active" data-rid="${r.id}">Active</button><button class="ad-btn ad-btn-out" data-lc="inactive" data-rid="${r.id}">Inactive or expired</button><button class="ad-btn ad-btn-danger" data-lc="not_found" data-rid="${r.id}">Not found</button></span></td></tr>`).join("")}</tbody></table>`
      :empty("No licence checks due","Every licence on PlateWatch was checked in the last 90 days.")}</div>`;
}

/* ---------- official record: add actions and restaurants ---------- */
function recordHTML(){
  const R=A.rec,p=R.pick;
  const today=new Date().toLocaleDateString("en-CA",{timeZone:"Asia/Kolkata"});
  return `<div class="ad-sechead"><p>Record FDA and FSSAI actions against a restaurant, or add a restaurant to the tracker. Every entry is logged with your account. Link the official source for each action.</p></div>
  <div class="ad-surface" style="padding:18px">
    <label class="ad-search">${ICO.search}<input id="recQ" type="search" placeholder="Find a restaurant by name, area or licence number…" value="${esc(R.q)}" aria-label="Find a restaurant" autocomplete="off"></label>
    ${R.hits.length&&!p?`<ul class="ad-hist" style="margin-top:12px">${R.hits.map(h=>`<li><button class="ad-link" data-pick="${h.id}">${esc(h.name)}</button><span class="ad-hist-d">${esc(h.area)}, ${esc(h.city)} · ${h.status?TYPES[h.status]:"No official action"}</span></li>`).join("")}</ul>`:""}
    ${p?`<div style="margin-top:18px">
      <div class="ad-row-top"><div class="ad-row-id"><h3 class="ad-fn">${esc(p.name)}</h3><div class="ad-meta"><span>${esc(p.area)}, ${esc(p.city)}</span><span>${p.licenceNumber?`FSSAI ${esc(p.licenceNumber)}${p.licenceStatus?" · "+LIC[p.licenceStatus]+" "+fmt(p.licenceCheckedOn):" · not checked"}`:"No licence number yet"}</span><span>${p.status?TYPES[p.status]+" since "+fmt(p.statusOn):"No official action on record"}</span></div></div><button class="ad-btn ad-btn-out" data-unpick>Choose another</button></div>
      ${p.licenceNumber?"":`<form class="form" id="licForm" style="margin-top:14px;max-width:560px"><label for="licNum">FSSAI licence number</label><input class="input" id="licNum" required inputmode="numeric" pattern="\\d{14}" maxlength="14" placeholder="14 digits" style="font-family:var(--mono)"><div><button class="ad-btn ad-btn-out" type="submit">Save licence number</button></div></form>`}
      ${p.history.length?`<ul class="ad-hist" style="margin-top:10px">${p.history.map(h=>`<li><span class="ad-hist-n">${TYPES[h.type]} · ${esc(h.summary)}</span><span class="ad-hist-d">${fmt(h.actionOn)}${h.sourceUrl?` · <a href="${esc(h.sourceUrl)}" target="_blank" rel="noopener">source</a>`:""}</span></li>`).join("")}</ul>`:""}
      <form class="form" id="recForm" style="margin-top:16px;max-width:560px">
        <label for="recType">Action</label><select class="input" id="recType" required>${Object.entries(TYPES).map(([k,l])=>`<option value="${k}">${l}</option>`).join("")}</select>
        <label for="recDate">Date of the action</label><input class="input" id="recDate" type="date" required max="${today}" value="${today}">
        <label for="recSum">What the order says</label><textarea class="input" id="recSum" rows="2" required minlength="5" maxlength="500" placeholder="e.g. Pest activity in storage room; expired raw material on premises"></textarea>
        <label for="recSrc">Official source (https link)</label><input class="input" id="recSrc" type="url" pattern="https://.*" placeholder="https://fda.maharashtra.gov.in/…">
        <div><button class="ad-btn ad-btn-pri" type="submit">Record action</button></div>
      </form></div>`:""}
  </div>
  <h3 class="ad-h3">Add a restaurant</h3>
  <div class="ad-surface" style="padding:18px">
    <form class="form" id="newRest" style="max-width:560px">
      <label for="nrName">Name</label><input class="input" id="nrName" required minlength="2" maxlength="120">
      <label for="nrArea">Area</label><input class="input" id="nrArea" required minlength="2" maxlength="120" placeholder="e.g. Dadar West">
      <label for="nrCity">City</label><input class="input" id="nrCity" required minlength="2" maxlength="80" placeholder="e.g. Mumbai">
      <label for="nrCat">Type</label><input class="input" id="nrCat" required minlength="2" maxlength="60" placeholder="e.g. Restaurant, Café, Sweet shop">
      <label for="nrLic">FSSAI licence number <span class="muted">(optional)</span></label><input class="input" id="nrLic" inputmode="numeric" pattern="\\d{14}" maxlength="14" placeholder="14 digits" style="font-family:var(--mono)">
      <label for="nrLat">Latitude and longitude <span class="muted">(optional, for the map)</span></label><div style="display:flex;gap:10px"><input class="input" id="nrLat" type="number" step="any" min="-90" max="90" placeholder="19.0760"><input class="input" id="nrLng" type="number" step="any" min="-180" max="180" placeholder="72.8777"></div>
      <label for="nrVer">Record checked on</label><input class="input" id="nrVer" type="date" required max="${today}" value="${today}">
      <div><button class="ad-btn ad-btn-pri" type="submit">Add restaurant</button></div>
    </form>
  </div>`;
}

/* ---------- rules ---------- */
function scoringHTML(){
  const c=A.data.catalog;if(!c)return "";
  const cat=Object.fromEntries(c.categories.map(x=>[x.key,x.name]));
  return `<div class="ad-sechead"><p>Weights and critical flags apply to every restaurant as soon as you change them. Score = weighted requirements met ÷ weighted applicable.</p></div>
    <div class="ad-surface ad-tbl"><table><thead><tr><th>Requirement</th><th>Category</th><th>Weight</th><th>Critical</th></tr></thead><tbody>${c.requirements.map(q=>`<tr><td>${esc(q.text)}</td><td class="ad-td-muted">${esc(cat[q.categoryKey])}</td><td><input type="number" min="1" max="5" value="${q.weight}" data-w="${q.id}" aria-label="Weight for ${esc(q.text)}"></td><td><input type="checkbox" ${q.critical?"checked":""} data-c="${q.id}" aria-label="Critical: ${esc(q.text)}"></td></tr>`).join("")}</tbody></table></div>`;
}
function expiryHTML(){
  const c=A.data.catalog;if(!c)return "";
  return `<div class="ad-sechead"><p>How long evidence stays valid before it stops counting towards the score.</p></div>
    <div class="ad-surface ad-tbl"><table><thead><tr><th>Category</th><th>Valid for (days)</th></tr></thead><tbody>${c.categories.map(x=>`<tr><td>${esc(x.name)}</td><td><input type="number" min="1" max="730" value="${x.expiryDays}" data-x="${x.key}" aria-label="Days valid for ${esc(x.name)}"></td></tr>`).join("")}</tbody></table></div>`;
}

/* ---------- activity log ---------- */
function activityHTML(){
  const list=A.data.activity||[];
  if(!list.length)return `<div class="ad-surface">${empty("Nothing logged yet","Claims, reviews, moderation and rule changes appear here.")}</div>`;
  const when=t=>new Date(t).toLocaleString("en-IN",{day:"numeric",month:"short",hour:"numeric",minute:"2-digit",timeZone:"Asia/Kolkata"});
  return `<div class="ad-sechead"><p>The latest 100 actions. This log can't be edited or deleted, even by staff.</p></div>
    <div class="ad-surface ad-tbl"><table><thead><tr><th>When</th><th>What</th><th>On</th><th>By</th></tr></thead><tbody>${list.map(a=>`<tr><td class="ad-td-muted">${when(a.createdAt)}</td><td>${esc(ACTIONS[a.action]||a.action)}${a.data&&a.data.reason?` <span class="ad-td-muted">· ${esc(a.data.reason)}</span>`:""}</td><td class="ad-td-muted">${esc(a.entityType)} ${esc(String(a.entityId).slice(0,8))}</td><td class="ad-td-muted">${a.actorId?esc(a.actorId.slice(0,8)):"System"}</td></tr>`).join("")}</tbody></table></div>`;
}

/* ---------- banned accounts ---------- */
function bannedHTML(){
  const list=A.data.banned||[];
  if(!list.length)return `<div class="ad-surface">${empty("No banned accounts","A reporter can be banned from Community reports after 2 of their reports are marked false in 7 days.")}</div>`;
  const when=t=>new Date(t).toLocaleString("en-IN",{day:"numeric",month:"short",year:"numeric",timeZone:"Asia/Kolkata"});
  return `<div class="ad-sechead"><p>Banned numbers can't log in or report. Numbers are partly hidden.</p></div>
    <div class="ad-surface ad-tbl"><table><thead><tr><th>Number</th><th>Banned on</th><th>Why</th><th></th></tr></thead><tbody>${list.map(u=>`<tr><td style="font-family:var(--mono)">${esc(u.phone)}</td><td class="ad-td-muted">${when(u.bannedAt)}</td><td class="ad-td-muted">${esc(u.reason||"")}</td><td style="text-align:right"><button class="ad-btn ad-btn-out" data-unban="${esc(u.id)}">Lift ban</button></td></tr>`).join("")}</tbody></table></div>`;
}

/* ---------- not built yet ---------- */
function soonHTML(){
  const t={escalations:["Escalations aren't connected yet","Sending qualifying reports to FDA Maharashtra is the next backend module. Until it's built, nothing is escalated."],
    rules:["Escalation rules aren't connected yet","The thresholds for sending reports to FDA arrive with the escalation module."],
    spot:["Spot checks aren't connected yet","Weekly random photo checks for restaurants arrive with the spot-check module."]}[A.tab];
  return `<div class="ad-surface">${empty(t[0],t[1])}</div>`;
}

/* ---------- actions ---------- */
async function act(fn,okMsg){
  try{await fn();if(okMsg)toast(okMsg)}catch(e){toast(e.message)}
  await refresh();
}
let qTimer=null,recTimer=null;
const root=$("adm");
$("atabs").onclick=e=>{const b=e.target.closest("[data-atab]");if(b)go("admin",b.dataset.atab)};
root.addEventListener("click",async e=>{
  const t=e.target;
  if(t.closest("[data-retry]")){refresh();return}
  if(t.closest("[data-relogin]")){go("login");return}
  const cl=t.closest("[data-close]");
  if(cl){if(cl.dataset.close==="box"&&t.closest("figure"))return;closeOverlay(cl.dataset.close);return}
  const bx=t.closest("[data-box]");if(bx){A.box=bx.dataset.box;overlays();const b=$("adBoxClose");if(b)b.focus();return}
  const af=t.closest("[data-af]");if(af){A.filter=af.dataset.af;refresh();return}
  const av=t.closest("[data-av]");if(av){A.view=av.dataset.av;render();return}
  if(t.closest("[data-clear]")){A.q="";A.filter="all";refresh();return}
  if(t.closest("[data-more]")){
    const q=new URLSearchParams({filter:A.filter,sort:A.sort,limit:PAGE,offset:A.data.evidence.items.length});if(A.q.trim())q.set("q",A.q.trim());
    try{const d=await api("GET","/admin/evidence?"+q);A.data.evidence={total:d.total,items:A.data.evidence.items.concat(d.items)};render()}catch(err){toast(err.message)}
    return}
  const v=t.closest("[data-v]");
  if(v){const msg={approve:"Approved. Now PlateWatch verified.",more:"Sent back for more evidence",reject:"Request rejected"}[v.dataset.v];
    act(()=>api("POST",`/admin/restaurants/${v.dataset.rid}/verification`,{decision:v.dataset.v}),msg);return}
  const ev=t.closest("[data-e]");
  if(ev){const id=ev.dataset.eid,d=ev.dataset.e;
    if(d==="flag"){const cur=(A.detail&&A.detail.id===id?A.detail:A.data.evidence.items.find(x=>x.id===id));
      await act(()=>api("PATCH","/admin/evidence/"+id,{flagged:!cur.flagged}),cur.flagged?"Flag removed":"Flagged for a second look");
      if(A.sel===id)openPanel(id);return}
    /* with the panel open, a decision moves on to the next item in the list */
    const ids=A.data.evidence.items.map(x=>x.id),i=ids.indexOf(id),next=A.sel===id?ids[i+1]||ids[i-1]||null:A.sel;
    await act(()=>api("POST",`/admin/evidence/${id}/decision`,{decision:d}),{verified:"Approved",rejected:"Rejected",more:"Asked the owner for more"}[d]);
    if(A.sel===id){if(next)openPanel(next);else closeOverlay("panel")}
    return}
  const m=t.closest("[data-m]");
  if(m){const id=+m.dataset.rep,d=m.dataset.m;
    if(d==="reject"){A.rejecting=id;render();const s=$("admReason");if(s)s.focus();return}
    if(d==="cancel"){A.rejecting=null;render();return}
    if(d==="false"){
      const x=(A.data.reports||[]).find(r=>r.id===id),n=((x&&x.reporterFalseThisWeek)||0)+1;
      if(!confirm("Mark this report as false? It's removed, and it counts against the reporter. 2 false reports in a week lets you ban the number."))return;
      A.rejecting=null;
      await act(()=>api("POST",`/admin/reports/${id}/decision`,{decision:"false"}),"Marked as false. It counts against the reporter.");
      /* the second false report in a week: offer the ban now, while the reporter is in front of the admin */
      if(x&&x.reporterId&&!x.reporterBanned&&n>=2&&confirm(`This reporter now has ${n} false reports this week. Ban the number now? They're signed out and can't log in or report until an admin lifts the ban.`))
        act(()=>api("POST",`/admin/users/${x.reporterId}/ban`),"Reporter banned");
      return}
    const body=d==="reject-go"?{decision:"reject",reason:$("admReason").value}:{decision:d};
    A.rejecting=null;
    act(()=>api("POST",`/admin/reports/${id}/decision`,body),{accept:"Report accepted and published",["reject-go"]:"Report rejected",more:"Asked the reporter for more",coordinated:"Marked as coordinated",keep:"Kept published"}[d]);return}
  const rs=t.closest("[data-res]");
  if(rs){const id=+rs.dataset.rep,d=rs.dataset.res;
    if(d==="reject"){A.rejectingRes=id;render();const s=$("admResReason");if(s)s.focus();return}
    if(d==="cancel"){A.rejectingRes=null;render();return}
    const body=d==="approve"?{decision:"approve"}:{decision:"reject",reason:$("admResReason").value};
    A.rejectingRes=null;
    act(()=>api("POST",`/admin/reports/${id}/resolution`,body),d==="approve"?"Proof approved. It's on the public profile now.":"Proof turned down. The restaurant can send new proof.");return}
  const bn=t.closest("[data-ban]");
  if(bn){if(!confirm("Ban this reporter? They're signed out everywhere and can't log in or report again until an admin lifts the ban."))return;
    act(()=>api("POST",`/admin/users/${bn.dataset.ban}/ban`),"Reporter banned");return}
  const ub=t.closest("[data-unban]");
  if(ub){if(!confirm("Lift this ban? The number can log in and report again."))return;
    act(()=>api("POST",`/admin/users/${ub.dataset.unban}/unban`),"Ban lifted");return}
  const lc=t.closest("[data-lc]");
  if(lc){act(()=>api("POST",`/admin/restaurants/${lc.dataset.rid}/licence-check`,{status:lc.dataset.lc}),"Licence check recorded");return}
  const cp=t.closest("[data-copy-lic]");
  if(cp){navigator.clipboard?.writeText(cp.dataset.copyLic).then(()=>toast("Licence number copied"),()=>toast(cp.dataset.copyLic));return}
  const pk=t.closest("[data-pick]");
  if(pk){try{A.rec.pick=await api("GET","/restaurants/"+pk.dataset.pick);render()}catch(err){toast(err.message)}return}
  if(t.closest("[data-unpick]")){A.rec.pick=null;render();return}
  const op=t.closest("[data-open]");if(op){openPanel(op.dataset.open);return}
  const row=t.closest(".ad-row[data-row]");
  if(row&&!t.closest("button,a,input,select,textarea,label")&&!getSelection().toString())openPanel(row.dataset.row);
});
root.addEventListener("input",e=>{
  if(e.target.id==="admQ"){A.q=e.target.value;clearTimeout(qTimer);qTimer=setTimeout(async()=>{await refresh();const i=$("admQ");if(i){i.focus();i.setSelectionRange(i.value.length,i.value.length)}},300);return}
  if(e.target.id==="recQ"){A.rec.q=e.target.value;A.rec.pick=null;clearTimeout(recTimer);
    recTimer=setTimeout(async()=>{const q=A.rec.q.trim();
      try{A.rec.hits=q.length>=2?(await api("GET","/search?q="+encodeURIComponent(q))).items:[]}catch(err){toast(err.message)}
      render();const i=$("recQ");if(i){i.focus();i.setSelectionRange(i.value.length,i.value.length)}},300)}
});
root.addEventListener("change",e=>{
  const t=e.target;
  if(t.id==="admSort"){A.sort=t.value;refresh();return}
  if(t.dataset.rnote){api("PATCH","/admin/evidence/"+t.dataset.rnote,{reviewNote:t.value}).then(()=>toast("Note saved"),err=>toast(err.message));return}
  if(t.dataset.people){act(()=>api("PATCH","/admin/evidence/"+t.dataset.people,{containsPeople:t.checked}),"Saved").then(()=>openPanel(t.dataset.people));return}
  if(t.dataset.w){act(()=>api("PUT","/admin/requirements/"+t.dataset.w,{weight:Math.max(1,Math.min(5,+t.value||1))}),"Weight saved");return}
  if(t.dataset.c){act(()=>api("PUT","/admin/requirements/"+t.dataset.c,{critical:t.checked}),t.checked?"Marked critical":"No longer critical");return}
  if(t.dataset.x){act(()=>api("PUT","/admin/categories/"+t.dataset.x,{expiryDays:Math.max(1,Math.min(730,+t.value||1))}),"Expiry saved");return}
});
root.addEventListener("submit",async e=>{
  e.preventDefault();
  if(e.target.id==="licForm"){const p=A.rec.pick;
    try{await api("PATCH",`/admin/restaurants/${p.id}`,{licenceNumber:$("licNum").value.trim()});A.rec.pick=await api("GET","/restaurants/"+p.id);toast("Licence number saved. Check it in Licence checks.");render()}catch(err){toast(err.message)}
    return}
  if(e.target.id==="recForm"){const p=A.rec.pick,src=$("recSrc").value.trim();
    try{await api("POST",`/admin/restaurants/${p.id}/actions`,{type:$("recType").value,actionOn:$("recDate").value,summary:$("recSum").value.trim(),...(src?{sourceUrl:src}:{})});
      A.rec.pick=await api("GET","/restaurants/"+p.id);toast("Official action recorded");render()}catch(err){toast(err.message)}
    return}
  if(e.target.id==="newRest"){const lat=$("nrLat").value,lng=$("nrLng").value;
    if(!!lat!==!!lng){toast("Give both latitude and longitude, or neither.");return}
    try{const r=await api("POST","/admin/restaurants",{name:$("nrName").value.trim(),area:$("nrArea").value.trim(),city:$("nrCity").value.trim(),category:$("nrCat").value.trim(),...($("nrLic").value.trim()?{licenceNumber:$("nrLic").value.trim()}:{}),lastVerifiedOn:$("nrVer").value,...(lat?{location:{lat:+lat,lng:+lng}}:{})});
      e.target.reset();A.rec.pick=await api("GET","/restaurants/"+r.id);A.rec.q="";A.rec.hits=[];toast("Restaurant added");render()}catch(err){toast(err.message)}
  }
});
document.addEventListener("keydown",e=>{
  if(e.key!=="Escape"||$("p-admin").hidden)return;
  if(A.box!=null)closeOverlay("box");else if(A.sel!=null)closeOverlay("panel");
});

return {show,refresh};
}
