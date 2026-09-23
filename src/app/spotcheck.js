/*
 * PlateWatch spot checks and the public kitchen gallery.
 * - One random spot check per claimed restaurant per week (10:00–21:00), delivered through the WhatsApp bot chat.
 *   It asks for 2–3 checkup items (critical items twice as likely, never repeating the previous check) with a code in every photo.
 * - Approved spot-check photos become fresh evidence and appear in the public kitchen gallery.
 * - Two misses in a row pause the "PlateWatch verified" badge until a spot check is answered on time and approved.
 * All photos in the seed are generated placeholders ("Sample photo"). Times run on the shared demo clock in bot.js.
 */
export function createSpotChecks(ctx){
const {D,PROF,REQS,REQ,CAT,CATS,RP,esc,fmt,toast,aiFor,addEvidence,onChange}=ctx;
const HOUR=36e5,DAY=864e5,WINDOW=2*HOUR;
const iso=ts=>new Date(ts).toISOString().slice(0,10);
/* the demo clock stores the viewer's local time of day as UTC, so format in UTC */
const fmtT=ts=>new Date(ts).toLocaleString("en-IN",{day:"numeric",month:"short",hour:"numeric",minute:"2-digit",timeZone:"UTC"});
const ownerPhone=rid=>PROF[rid].owner.replace(/\D/g,"");
const place=rid=>D.find(r=>r.id===rid);

/* what the owner is asked to show, per checkup item */
const SHOW={k1:"food preparation area",k2:"food-contact surfaces",k3:"floors, walls and ceilings",k4:"covered waste bins",
  s1:"raw and cooked food storage",s2:"covered food containers",s3:"fridge thermometer reading",s4:"date labels on prepared food",
  p1:"storage corners and floor edges",p2:"pest-control contract",p3:"pest-control treatment records",p4:"drain covers and screens",
  h1:"handwash station with soap",h2:"staff caps and aprons",h3:"food handlers' medical certificates",h4:"FoSTaC supervisor certificate",
  c1:"cleaning schedule",c2:"cleaning chemical storage",c3:"sanitised equipment",c4:"toilets and wash area",
  d1:"displayed FSSAI licence",d2:"water test report",d3:"cleaning log",
  o1:"cold-holding temperature log",o2:"stock expiry check",o3:"separate veg and non-veg prep areas",o4:"supplier bills"};
const show=id=>SHOW[id]||REQ[id].text.toLowerCase();
const joinItems=ids=>{const n=ids.map(show);return n.length>1?n.slice(0,-1).join(", ")+" and "+n[n.length-1]:n[0]};

/* ---------- spot checks ---------- */
const SC=[];let SCID=1;const NEXT={};
const listFor=rid=>SC.filter(c=>c.rid===rid).sort((a,b)=>a.sent-b.sent);
const openFor=rid=>SC.find(c=>c.rid===rid&&c.status==="due");
/* only the latest check is answerable: while due, or up to a day after a miss (the answer then counts as late) */
const answerableFor=rid=>{const c=listFor(rid).pop();return c&&(c.status==="due"||(c.status==="missed"&&!c.answeredAt&&RP.now()-c.due<DAY))?c:null};
function newCode(){let c;do{c="PW-"+(1000+Math.floor(Math.random()*9000))}while(SC.some(x=>x.code===c));return c}
/* 2–3 applicable items, critical ones weighted ×2, none from the previous check */
function pickItems(rid){
  const p=PROF[rid],prev=listFor(rid).pop(),last=new Set(prev?prev.items:[]);
  const pool=REQS.filter(r=>p.resp[r.id]!=="na"&&!last.has(r.id)).map(r=>({id:r.id,w:r.crit?2:1}));
  const n=2+Math.floor(Math.random()*2),out=[];
  while(out.length<n&&pool.length){let t=pool.reduce((s,x)=>s+x.w,0)*Math.random();let i=pool.findIndex(x=>(t-=x.w)<0);if(i<0)i=pool.length-1;out.push(pool.splice(i,1)[0].id)}
  return out;
}
/* next weekly check: a random day in the coming week, between 10:00 and 21:00 */
function scheduleNext(rid){const base=Math.floor(RP.now()/DAY)*DAY;NEXT[rid]=base+(1+Math.floor(Math.random()*7))*DAY+(10+Math.random()*11)*HOUR}
function send(rid){
  const open=openFor(rid);if(open)return open;
  const t=RP.now();
  const c={id:SCID++,rid,code:newCode(),items:pickItems(rid),sent:t,due:t+WINDOW,status:"due",review:null,photos:[],answeredAt:null,reason:null,flagCode:false};
  SC.push(c);
  RP.notify(ownerPhone(rid),`Spot check: show us your ${joinItems(c.items)}. Write this code on paper and keep it visible in every photo: ${c.code}. You have 2 hours.`);
  scheduleNext(rid);onChange();
  return c;
}
function addPhoto(id,req,file,url){
  const c=SC.find(x=>x.id===id);if(!c||c.answeredAt||!c.items.includes(req))return null;
  if(!url){try{url=URL.createObjectURL(file)}catch(_){}}
  const photo={req,name:file.name,url,ts:RP.now(),ai:[...aiFor(req),`⚠ Code ${c.code} visible: needs reviewer confirmation`]};
  c.photos=c.photos.filter(p=>p.req!==req).concat(photo);
  const complete=c.items.every(i=>c.photos.some(p=>p.req===i));
  if(complete){
    c.answeredAt=RP.now();c.status=c.status==="due"&&c.answeredAt<=c.due?"answered":"late";
    RP.notify(ownerPhone(c.rid),c.status==="answered"?`Spot check ${c.code} answered on time. A reviewer will check your photos.`:`Spot check ${c.code} answered after the 2-hour deadline. It still counts as missed for your badge, but the photos will be reviewed.`);
  }
  onChange();
  return {photo,complete,check:c};
}
function review(id,action,reason){
  const c=SC.find(x=>x.id===id),ph=ownerPhone(c.rid);
  if(action==="approve"){
    c.review="approved";c.flagCode=false;
    c.photos.forEach(p=>addEvidence(c.rid,p.req,{name:p.name,url:p.url,ai:p.ai,date:iso(RP.now()),src:"spot"}));
    RP.notify(ph,`Spot check ${c.code} approved. The photos now count as fresh evidence and appear in your public kitchen gallery.`);
  }
  if(action==="reject"){c.review="rejected";c.reason=reason;RP.notify(ph,`Spot check ${c.code} was rejected: ${reason}.`)}
  if(action==="flag"){c.flagCode=true;RP.notify(ph,`A reviewer couldn't see code ${c.code} in your spot-check photos.`)}
  onChange();
}
/* missed deadlines and scheduled weekly checks */
function tick(){
  let changed=false;const t=RP.now();
  SC.forEach(c=>{if(c.status==="due"&&t>c.due){c.status="missed";changed=true;RP.notify(ownerPhone(c.rid),`Spot check ${c.code} was missed. It now shows on your public profile.`)}});
  Object.keys(PROF).forEach(k=>{const rid=+k;if(NEXT[rid]==null)scheduleNext(rid);else if(t>=NEXT[rid]&&!openFor(rid)){send(rid);changed=true}});
  if(changed)onChange();
}
const statusLabel=c=>c.status==="due"?"Due":c.status==="missed"&&!c.answeredAt?"Missed":c.review==="approved"?(c.status==="late"?"Late · approved":"Approved"):c.review==="rejected"?"Rejected":c.status==="late"?"Late":"Answered";
/* two misses in a row pause the badge; an on-time, approved answer restores it */
function badge(rid){
  let streak=0,paused=false;
  listFor(rid).forEach(c=>{
    if(c.status==="due")return;
    if(c.status==="missed"||c.status==="late"){streak++;if(streak>=2)paused=true;return}
    streak=0;if(c.review==="approved")paused=false;
  });
  return {paused,streak};
}
const pausedBadge=rid=>!!PROF[rid]&&PROF[rid].level==="platform"&&badge(rid).paused;
const lastMissed=rid=>listFor(rid).filter(c=>c.status==="missed"||c.status==="late").pop()||null;
function missedHTML(rid){
  const m=lastMissed(rid);if(!m||RP.now()-m.due>60*DAY)return "";
  return `<p class="sc-missed">${m.status==="late"?"Spot check answered late on":"Missed spot check on"} ${fmt(iso(m.due))}</p>`;
}
const left=ts=>{const s=Math.max(0,Math.round((ts-RP.now())/1000));return `${Math.floor(s/3600)}:${String(Math.floor(s%3600/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`};

/* ---------- dashboard pieces ---------- */
function bannerHTML(rid){
  const c=answerableFor(rid);if(!c)return "";
  const late=c.status==="missed";
  return `<section class="sc-banner${late?" is-late":""}" aria-label="Spot check">
    <div class="sc-b-top"><div><div class="eyebrow">${late?"Spot check missed · you can still answer (counts as late)":"Spot check due"}</div>
      <h2 class="sc-b-h">Show us your ${esc(joinItems(c.items))}.</h2>
      <p class="muted">Write <b class="sc-code">${c.code}</b> on paper and keep it visible in every photo.</p></div>
      ${late?"":`<div class="sc-timer"><span class="sc-timer-l">Time left</span><b data-countdown="${c.due}" aria-live="off">${left(c.due)}</b></div>`}</div>
    <ul class="sc-items">${c.items.map(i=>{const p=c.photos.find(x=>x.req===i);return `<li><span>${esc(show(i).charAt(0).toUpperCase()+show(i).slice(1))}${REQ[i].crit?' <span class="sc-crit">Critical</span>':""}</span>${p?`<span class="sc-done">Photo sent</span>`:`<label class="upl">Take photo<input type="file" accept="image/*" capture="environment" data-sc="${c.id}" data-sc-item="${i}" aria-label="Photo of ${esc(show(i))}"></label>`}</li>`}).join("")}</ul>
    <div class="row-actions" style="margin-top:14px"><button class="pillbtn out sm" type="button" data-sc-chat="${rid}">Answer in WhatsApp chat</button></div>
  </section>`;
}
function historyHTML(rid){
  const l=listFor(rid).reverse();
  if(!l.length)return `<p class="muted">No spot checks yet. Your first one arrives within a week.</p>`;
  return `<ul class="sc-hist">${l.map(c=>`<li><span class="sc-h-d">${fmt(iso(c.sent))}</span><span class="sc-h-i">${esc(joinItems(c.items))}</span><span class="sc-st sc-st-${statusLabel(c).split(" ")[0].toLowerCase()}">${statusLabel(c)}</span></li>`).join("")}</ul>
    <p class="muted" style="font-size:13px;margin-top:10px">Next spot check: sometime in the coming week, between 10:00 and 21:00.</p>`;
}
/* the owner's thread in the bot chat, answering item by item */
function openChat(rid){
  RP.openAs(ownerPhone(rid),"PlateWatch for restaurants",({say,ask,end,photoBubble})=>{
    const c=answerableFor(rid);
    if(!c){say("No spot check is open right now. We'll message you here when the next one arrives.");end();return}
    const step=()=>{
      const todo=c.items.filter(i=>!c.photos.some(p=>p.req===i));
      say(`Send a photo of your ${esc(show(todo[0]))} with <b>${c.code}</b> visible.`);
      ask(todo.map(i=>({label:`Photo: ${show(i)}`,file:{accept:"image/*",capture:true,kind:i}})),{onFile:(f,k)=>{
        const item=k&&todo.includes(k)?k:todo[0],url=photoBubble(f),r=addPhoto(c.id,item,f,url);
        if(!r){end();return}
        say(`<span class="bm-hint">AI-assisted observation · not a certification</span>${r.photo.ai.map(esc).join("<br>")}`);
        if(r.complete)end();else step();
      }});
    };
    step();
  });
}

/* ---------- kitchen gallery ---------- */
const SHOWN=2;
function items(rid){
  const p=PROF[rid];if(!p)return [];
  const out=[];
  Object.entries(p.ev).forEach(([q,l])=>l.forEach(e=>{if(e.status==="verified"&&e.type==="photo"&&e.url)out.push({e,q,cat:REQ[q].cat})}));
  return out;
}
function grouped(rid){
  const all=items(rid);
  return CATS.map(c=>({c,list:all.filter(x=>x.cat===c.k).sort((a,b)=>b.e.date.localeCompare(a.e.date)||b.e.id-a.e.id)})).filter(g=>g.list.length);
}
const flat=rid=>grouped(rid).flatMap(g=>g.list);
const tagHTML=e=>`<span class="gtag${e.src==="spot"?" gtag-spot":""}">${e.src==="spot"?"Spot check":"Checkup"}</span>`;
function thumb(rid,x,i){
  const e=x.e;
  return `<figure class="gal-item"><button type="button" class="gal-btn" data-gal="${rid}" data-gal-i="${i}" aria-label="Open photo ${i+1}: ${esc(CAT[x.cat].name)}, ${fmt(e.date)}${e.src==="spot"?", spot check":""}">
      <img src="${e.url}" alt="" loading="lazy">${e.people?`<span class="gal-blur" aria-hidden="true"></span>`:""}</button>
    <figcaption><span class="gal-area">${esc(CAT[x.cat].name)}</span><span class="gal-meta">${tagHTML(e)}<span>${fmt(e.date)}</span></span>${e.people||e.sample?`<span class="gal-notes">${e.people?"Faces blurred":""}${e.people&&e.sample?" · ":""}${e.sample?"Sample photo":""}</span>`:""}</figcaption></figure>`;
}
function galleryHTML(rid){
  const g=grouped(rid);
  if(!g.length)return `<p class="muted gal-empty">No kitchen photos yet.</p>`;
  let i=0;
  return `<div class="gal">${g.map(({c,list})=>{
    const recent=list.slice(0,SHOWN).map(x=>thumb(rid,x,i++)).join(""),older=list.slice(SHOWN).map(x=>thumb(rid,x,i++)).join(""),hid=`gh-${rid}-${c.k}`;
    return `<section class="gal-sec" aria-label="${esc(c.name)} photos"><div class="gal-h"><h3>${esc(c.name)}</h3><span class="muted">${list.length} photo${list.length===1?"":"s"}</span></div>
      <div class="gal-grid">${recent}</div>
      ${older?`<button type="button" class="x gal-hist" data-gal-hist aria-expanded="false" aria-controls="${hid}">History · ${list.length-SHOWN} older</button><div class="gal-grid gal-older" id="${hid}" hidden>${older}</div>`:""}</section>`;
  }).join("")}</div>`;
}

/* lightbox */
const $=id=>document.getElementById(id);
const lb=$("glb");let lbList=[],lbI=0,lbFocus=null;
function lbShow(){
  const x=lbList[lbI],e=x.e;
  $("glbImg").src=e.url;$("glbImg").alt=`${CAT[x.cat].name}, ${fmt(e.date)}`;
  $("glbBlur").hidden=!e.people;
  $("glbCap").innerHTML=`<b>${esc(CAT[x.cat].name)}</b>${tagHTML(e)}<span>${fmt(e.date)}</span>${e.people?"<span>Faces blurred</span>":""}${e.sample?"<span>Sample photo</span>":""}`;
  $("glbCount").textContent=`${lbI+1} / ${lbList.length}`;
  $("glbPrev").disabled=$("glbNext").disabled=lbList.length<2;
}
function lbOpen(rid,i){lbFocus=document.activeElement;lbList=flat(rid);lbI=i;lbShow();lb.hidden=false;document.documentElement.classList.add("glb-lock");$("glbClose").focus()}
function lbClose(){lb.hidden=true;document.documentElement.classList.remove("glb-lock");if(lbFocus&&document.contains(lbFocus))lbFocus.focus()}
const lbStep=d=>{lbI=(lbI+d+lbList.length)%lbList.length;lbShow()};
document.addEventListener("click",e=>{
  const b=e.target.closest("[data-gal]");if(b){lbOpen(+b.dataset.gal,+b.dataset.galI);return}
  const h=e.target.closest("[data-gal-hist]");if(h){const el=$(h.getAttribute("aria-controls"));el.hidden=!el.hidden;h.setAttribute("aria-expanded",String(!el.hidden));return}
});
$("glbPrev").onclick=()=>lbStep(-1);$("glbNext").onclick=()=>lbStep(1);
lb.addEventListener("click",e=>{if(e.target.closest("[data-glb-close]"))lbClose()});
document.addEventListener("keydown",e=>{
  if(lb.hidden)return;
  if(e.key==="Escape"){e.preventDefault();lbClose()}
  else if(e.key==="ArrowLeft"){e.preventDefault();lbStep(-1)}
  else if(e.key==="ArrowRight"){e.preventDefault();lbStep(1)}
  else if(e.key==="Tab"){const f=[$("glbPrev"),$("glbNext"),$("glbClose")].filter(x=>!x.disabled),i=f.indexOf(document.activeElement);if(e.shiftKey&&i<=0){e.preventDefault();f[f.length-1].focus()}else if(!e.shiftKey&&i===f.length-1){e.preventDefault();f[0].focus()}}
});

/* ---------- seed: Green Leaf Dhaba ---------- */
/* neutral placeholder "photos" drawn as SVG; people=true adds a figure whose face region is blurred on screen */
function samplePhoto(area,variant,people,code){
  const shapes={
    kitchen:`<rect x="0" y="380" width="800" height="220" fill="#CFCDC7"/><rect x="60" y="300" width="680" height="90" rx="6" fill="#B9B6AE"/><circle cx="220" cy="280" r="46" fill="#8E8B84"/><circle cx="360" cy="286" r="36" fill="#A5A29B"/><rect x="480" y="120" width="220" height="150" rx="6" fill="#DAD8D2"/>`,
    storage:`<rect x="90" y="80" width="620" height="440" rx="8" fill="#D6D4CE"/>${[160,280,400].map(y=>`<rect x="110" y="${y}" width="580" height="10" fill="#9C998F"/>`).join("")}${[150,270,390,510].map((x,i)=>`<rect x="${x}" y="${i%2?100:220}" width="80" height="${i%2?60:60}" rx="6" fill="#ACA9A1"/>`).join("")}`,
    personal:`<rect x="0" y="360" width="800" height="240" fill="#CFCDC7"/><rect x="120" y="220" width="220" height="160" rx="10" fill="#E3E1DC"/><ellipse cx="230" cy="300" rx="80" ry="40" fill="#B7B4AC"/><rect x="380" y="170" width="40" height="110" rx="8" fill="#9C998F"/>`,
    clean:`<rect x="0" y="0" width="800" height="600" fill="#DEDCD6"/>${[0,1,2,3,4].map(i=>`<rect x="${80+i*130}" y="200" width="100" height="260" rx="6" fill="${i%2?"#B9B6AE":"#A9A69E"}"/>`).join("")}`};
  const person=people?`<g fill="#77746D"><circle cx="560" cy="150" r="54"/><path d="M470 360c0-70 40-130 90-130s90 60 90 130z"/></g>`:"";
  const paper=code?`<g transform="rotate(-4 150 470)"><rect x="70" y="430" width="200" height="80" fill="#FFFFFF" stroke="#8E8B84"/><text x="170" y="482" text-anchor="middle" font-family="monospace" font-size="30" fill="#0A0A0A">${code}</text></g>`:"";
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600"><rect width="800" height="600" fill="#E9E8E4"/>${shapes[area]||shapes.kitchen}${variant?`<rect x="0" y="0" width="800" height="600" fill="#000" opacity="${0.03*variant}"/>`:""}${person}${paper}<rect x="560" y="548" width="224" height="36" rx="6" fill="#0A0A0A" opacity=".75"/><text x="672" y="572" text-anchor="middle" font-family="sans-serif" font-size="18" fill="#FFFFFF">Sample photo</text></svg>`;
  return "data:image/svg+xml;charset=utf-8,"+encodeURIComponent(svg);
}
(function seed(){
  const rid=3;if(!PROF[rid])return;
  const t=RP.now(),ago=d=>t-d*DAY,dateAgo=d=>iso(ago(d)),dayAt=(d,h)=>Math.floor(ago(d)/DAY)*DAY+h*HOUR;
  const photo=(req,days,src,people,code,variant)=>addEvidence(rid,req,{name:`${req}-sample.jpg`,url:samplePhoto(REQ[req].cat,variant||0,people,code),ai:aiFor(req),date:dateAgo(days),src,people,sample:true});
  /* 3 weeks ago: missed */
  const m={id:SCID++,rid,code:newCode(),items:["p1","h1"],sent:dayAt(21,14),due:dayAt(21,16),status:"missed",review:null,photos:[],answeredAt:null,reason:null,flagCode:false};
  /* 10 days ago: answered on time and approved */
  const a={id:SCID++,rid,code:newCode(),items:["k2","s1"],sent:dayAt(10,11.5),due:dayAt(10,13.5),status:"answered",review:"approved",photos:[],answeredAt:dayAt(10,12.25),reason:null,flagCode:false};
  SC.push(m,a);
  photo("k2",10,"spot",false,a.code,1);photo("s1",10,"spot",false,a.code,0);
  photo("k1",2,"checkup",false,null,0);photo("k3",40,"checkup",false,null,2);
  photo("s2",25,"checkup",false,null,2);
  photo("h1",5,"checkup",true,null,0);photo("h2",30,"checkup",true,null,1);
  photo("c3",12,"checkup",false,null,0);
  Object.keys(PROF).forEach(k=>scheduleNext(+k));
})();

return {send,addPhoto,review,tick,badge,pausedBadge,missedHTML,bannerHTML,historyHTML,galleryHTML,openChat,statusLabel,listFor,answerableFor,openFor,show,joinItems,fmtT,left,NEXT,SC,
  schedule:scheduleNext};
}
