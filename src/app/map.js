/*
 * PlateWatch map view, official-status dots and PlateWatch verification badges.
 * Two signals, never mixed:
 *  - DOT colour = the latest OFFICIAL regulatory action only (red / amber / green / grey).
 *  - BADGE = PlateWatch's own verification level only (Not claimed yet / Claimed · self-reported / PlateWatch verified).
 * A compliance score or badge never changes a dot. All places and coordinates are fictional sample data.
 */
/* Leaflet + markercluster load on first use of the map, so other pages stay light */
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";

/* plausible sample coordinates for the original sample restaurants (by id) */
export const COORDS={1:[18.9339,72.8353],2:[19.1868,72.8479],3:[18.5916,73.7385],4:[19.1141,72.8702],5:[19.2179,72.9771],6:[19.1604,73.0402],7:[19.0209,72.8418],8:[21.1463,79.0876],9:[18.5072,73.8071],10:[18.9331,72.8259],11:[19.1172,73.0288],13:[19.0601,72.8291],14:[19.1361,72.8302]};
/* 20 extra fictional Mumbai places with no official action on record (grey dots) */
export const EXTRA_PLACES=[
  [101,"Sunrise Idli Corner","Colaba","Restaurant",18.9072,72.8149],
  [102,"Tidewater Tiffins","Lower Parel","Cloud kitchen",18.9957,72.8302],
  [103,"Lotus Leaf Veg Kitchen","Worli","Restaurant",19.0170,72.8170],
  [104,"Neelkamal Bhojanalay","Matunga","Restaurant",19.0275,72.8566],
  [105,"Monsoon Momo House","Sion","Café",19.0394,72.8611],
  [106,"Saffron Street Kitchen","Kurla","Restaurant",19.0721,72.8839],
  [107,"Kesar Snacks & Sweets","Chembur","Sweet shop",19.0527,72.8998],
  [108,"Station Road Misal House","Ghatkopar","Restaurant",19.0866,72.9087],
  [109,"Lakeview Poha Point","Powai","Café",19.1181,72.9053],
  [110,"Marigold Thali House","Vile Parle","Restaurant",19.0996,72.8487],
  [111,"Sandbar Juice Junction","Juhu","Café",19.1071,72.8268],
  [112,"Little Lane Bakehouse","Santacruz","Bakery",19.0815,72.8405],
  [113,"Green Chilli Canteen","Khar","Restaurant",19.0706,72.8374],
  [114,"Mango Leaf Café","Goregaon","Café",19.1650,72.8488],
  [115,"Rustic Roti Co.","Borivali","Restaurant",19.2311,72.8561],
  [116,"Hilltop Vada Pav Stall","Mulund","Restaurant",19.1721,72.9431],
  [117,"Copperpot Home Kitchen","Versova","Cloud kitchen",19.1335,72.8136],
  [118,"Clocktower Chai Stop","Byculla","Café",18.9786,72.8336],
  [119,"Old Mill Biryani Kitchen","Grant Road","Restaurant",18.9635,72.8156],
  [120,"Seaface Bun Maska Café","Mahim","Café",19.0405,72.8396]
].map(([id,name,area,cat,lat,lng])=>({id,name,area,city:"Mumbai",cat,lic:"115269"+String(40000000+id*37).slice(0,8),verified:"2026-09-22",hist:[],ll:[lat,lng],extra:true}));
/* among the extras: 3 claimed (self-reported), 2 fully PlateWatch verified */
export const EXTRA_CLAIMED=[103,108,114],EXTRA_VERIFIED=[106,117];

export function createMap(ctx){
const {D,PROF,REQS,CAT,daysAgo,SCM,cur,st,esc,fmt,summaryLine,filtered,go}=ctx;

/* ---------- dots: official status only ---------- */
const DOT={sus:"red",rev:"red",imp:"amber",ok:"green",none:"grey"};
const DOT_LABEL={red:"suspended or revoked",amber:"improvement notice open",green:"reinstated after an action",grey:"no official action on record"};
const RANK={red:3,amber:2,green:1,grey:0};
const dotOf=r=>DOT[cur(r)[1]]||"grey";
const dotHTML=r=>{const d=dotOf(r);return `<span class="sdot sdot-${d}" aria-hidden="true"></span><span class="sr-only">Status: ${DOT_LABEL[d]}. </span>`};
const LEGEND="Red: suspended or revoked · Amber: improvement notice · Green: reinstated after an action · Grey: no official action on record (not a safety rating)";
const legendHTML=()=>`<p class="dlegend"><span class="dl"><span class="sdot sdot-red" aria-hidden="true"></span>Red: suspended or revoked</span><span class="dl-sep" aria-hidden="true">·</span><span class="dl"><span class="sdot sdot-amber" aria-hidden="true"></span>Amber: improvement notice</span><span class="dl-sep" aria-hidden="true">·</span><span class="dl"><span class="sdot sdot-green" aria-hidden="true"></span>Green: reinstated after an action</span><span class="dl-sep" aria-hidden="true">·</span><span class="dl"><span class="sdot sdot-grey" aria-hidden="true"></span>Grey: no official action on record (not a safety rating)</span></p>`;

/* ---------- badges: PlateWatch verification only ---------- */
const BADGE={none:"Not claimed yet",claimed:"Claimed · self-reported",verified:"PlateWatch verified"};
const TIP={none:"The owner hasn't joined PlateWatch yet. This says nothing about hygiene.",verified:"Evidence reviewed by PlateWatch. Not a government certification."};
/* verified = PlateWatch-reviewed level, every applicable requirement backed by current approved evidence,
   no unreviewed evidence and no run of missed spot checks. Official actions never affect this. */
function verif(rid){
  const p=PROF[rid];if(!p)return {k:"none"};
  if(p.level!=="platform")return {k:"claimed"};
  const why=[];
  if(SCM.badge(rid).paused)why.push("two missed spot checks in a row");
  if(Object.values(p.ev).flat().some(e=>e.status==="submitted"||e.status==="more"))why.push("new evidence waiting for review");
  const unmet=REQS.filter(q=>p.resp[q.id]!=="na"&&!(p.resp[q.id]==="yes"&&(p.ev[q.id]||[]).some(e=>e.status==="verified"&&daysAgo(e.date)<=CAT[q.cat].expiry))).length;
  if(unmet)why.push(`${unmet} requirement${unmet===1?"":"s"} without current approved evidence`);
  return why.length?{k:"claimed",paused:why.join("; ")}:{k:"verified"};
}
const badgeOf=rid=>verif(rid).k;
const badgeLabel=rid=>BADGE[badgeOf(rid)];
const badgeHTML=rid=>{const k=badgeOf(rid);return `<span class="vb vb-${k}"${TIP[k]?` title="${TIP[k]}"`:""}>${k==="verified"?'<i class="vb-mark" aria-hidden="true"></i>':""}${BADGE[k]}${TIP[k]?`<span class="sr-only"> (${TIP[k]})</span>`:""}</span>`};
const pausedNote=rid=>{const v=verif(rid);return v.paused?`<p class="vb-paused">PlateWatch verification paused: ${esc(v.paused)}.</p>`:""};

/* ---------- map (the Tracker is map-first; the results panel is the accessible list) ---------- */
const $=id=>document.getElementById(id);
let L=null,map=null,cluster=null,markers=new Map(),hl=null,selId=null,loading=null,scope="area";
async function loadLeaflet(){
  if(!loading)loading=(async()=>{L=(await import("./leaflet-global.js")).default;await import("leaflet.markercluster")})();
  return loading;
}
const place=id=>D.find(r=>r.id===id);
const desktop=()=>matchMedia("(min-width: 1024px)").matches;
/* keep pins clear of the results panel (left on desktop, bottom sheet on phones) */
const pad=()=>desktop()?{paddingTopLeft:[404,24],paddingBottomRight:[24,24]}:{paddingTopLeft:[24,24],paddingBottomRight:[24,140]};
function pinIcon(r){
  const d=dotOf(r),v=badgeOf(r.id)==="verified";
  return L.divIcon({className:"pw-pin-wrap",iconSize:[22,22],iconAnchor:[11,11],popupAnchor:[0,-12],
    html:`<span class="pw-pin pw-pin-${d}">${v?'<i class="pw-pin-dia"></i>':""}<span class="sr-only">${esc(r.name)}. Status: ${DOT_LABEL[d]}.${v?" PlateWatch verified.":""}</span></span>`});
}
function popupHTML(r){
  return `<div class="mpop"><div class="mpop-n">${dotHTML(r)}<b>${esc(r.name)}</b></div><div class="mpop-b">${badgeHTML(r.id)}${st(cur(r)[1])}</div>
    <p class="mpop-s">${esc(summaryLine(r))}</p><div class="mpop-a">${esc(r.area)}, ${esc(r.city)} · ${esc(r.cat)}</div>
    <button type="button" class="pillbtn sm" data-map-open="${r.id}">Open profile →</button></div>`;
}
/* each card is a link to the profile: Enter opens it; a mouse click shows the place on the map instead */
function cardHTML(r){
  const c=cur(r);
  return `<li class="mcard${selId===r.id?" is-sel":""}" data-mid="${r.id}">
    <h3 class="mcard-h"><a class="mcard-a" href="#profile-${r.id}" data-card="${r.id}">${dotHTML(r)}<span class="mcard-nm">${esc(r.name)}</span></a></h3>
    <div class="mcard-b">${badgeHTML(r.id)}${st(c[1])}</div>
    <div class="mcard-m"><span>${esc(r.area)}, ${esc(r.city)}</span><span>${c[0]?"Latest action "+fmt(c[0]):"No official action on record"}</span>${r.ll?"":`<span class="mcard-pend">Location pending</span>`}</div>
    <a class="mcard-open" href="#profile-${r.id}" tabindex="-1" aria-hidden="true">Open profile →</a></li>`;
}
function init(){
  map=L.map("map",{zoomControl:false,scrollWheelZoom:true,minZoom:5,maxZoom:18}).setView([19.0760,72.8777],11);
  L.control.zoom({position:"topright"}).addTo(map);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,subdomains:"abc",
    attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors'}).addTo(map);
  /* cluster colour = the most serious official status inside it */
  cluster=L.markerClusterGroup({showCoverageOnHover:false,maxClusterRadius:48,disableClusteringAtZoom:16,spiderfyOnMaxZoom:true,
    iconCreateFunction:c=>{const top=c.getAllChildMarkers().reduce((a,m)=>RANK[m.options.dot]>RANK[a]?m.options.dot:a,"grey"),n=c.getChildCount();
      return L.divIcon({className:"pw-cl-wrap",iconSize:[38,38],html:`<span class="pw-cl pw-cl-${top}"><b>${n}</b><span class="sr-only"> restaurants; most serious status: ${DOT_LABEL[top]}</span></span>`})}});
  map.addLayer(cluster);
  map.on("moveend",()=>{if(scope==="area")syncList()});
  const list=$("mapList");
  list.addEventListener("mouseover",e=>{const c=e.target.closest(".mcard");if(c)highlight(+c.dataset.mid)});
  list.addEventListener("focusin",e=>{const c=e.target.closest(".mcard");if(c)highlight(+c.dataset.mid)});
  list.addEventListener("mouseleave",()=>highlight(null));
  list.addEventListener("click",e=>{
    if(e.target.closest(".mcard-open,[data-nr],.nr-form,[data-scope-all]"))return;
    const c=e.target.closest(".mcard");if(!c)return;
    const a=e.target.closest(".mcard-a");
    if(a&&e.detail===0)return;               /* keyboard / assistive tech: follow the link to the profile */
    e.preventDefault();focusPlace(+c.dataset.mid);
  });
  list.addEventListener("click",e=>{if(e.target.closest("[data-scope-all]")){setScope("all")}});
  document.querySelectorAll("#mapSheet [data-scope]").forEach(b=>b.onclick=()=>setScope(b.dataset.scope));
  $("nearMe").onclick=nearMe;
  initSheet();
}
function setScope(s){scope=s;document.querySelectorAll("#mapSheet [data-scope]").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.scope===s)));syncList()}
function refresh(){
  if(!map)return;
  cluster.clearLayers();markers.clear();
  const list=filtered().filter(r=>r.ll).map(r=>{
    const m=L.marker(r.ll,{icon:pinIcon(r),dot:dotOf(r),rid:r.id,title:`${r.name} · ${DOT_LABEL[dotOf(r)]}`,keyboard:true,riseOnHover:true});
    m.bindPopup(()=>popupHTML(r),{maxWidth:280,minWidth:220,autoPanPaddingTopLeft:desktop()?L.point(404,20):L.point(10,10)});
    m.on("click",()=>selectCard(r.id));
    markers.set(r.id,m);return m;
  });
  cluster.addLayers(list);
  syncList();
}
/* results = search + filters, and (by default) only what the map currently shows */
function syncList(){
  if(!map)return;
  const all=filtered(),b=visibleBounds();
  const rows=scope==="all"?all:all.filter(r=>r.ll&&markers.has(r.id)&&b.contains(r.ll));
  const pending=scope==="area"?all.filter(r=>!r.ll).length:0;
  const q=(ctx.query()||"").trim();
  $("mapCount").textContent=`${rows.length} result${rows.length===1?"":"s"}${scope==="area"?" in this map area":""}`;
  $("mapPeek").textContent=`${rows.length} result${rows.length===1?"":"s"} · ${sheetState==="peek"?"drag up":"drag down"}`;
  let h=rows.map(cardHTML).join("");
  if(!rows.length){
    h=`<li class="mcard-empty">${q&&!all.length?ctx.noResults(q):scope==="area"?`<p>Nothing here matches. Try zooming out or switching to All results.</p><button type="button" class="x" data-scope-all>Show all results</button>`:`<p>Nothing matches these filters.</p>`}</li>`;
  }
  if(pending)h+=`<li class="mcard-note">${pending} matching restaurant${pending===1?" has":"s have"} no location yet. <button type="button" class="x" data-scope-all>See All results</button></li>`;
  $("mapList").innerHTML=h;
  if(hl)highlight(hl);
  /* keep the selected card in view when the map pans (e.g. to fit its popup) */
  const sel=selId!=null&&document.querySelector(`.mcard[data-mid="${selId}"]`);
  if(sel)scrollCard(sel);
}
/* the part of the map not covered by the results panel (left on desktop, collapsed sheet on phones) */
function visibleBounds(){
  const z=map.getSize();
  const tl=desktop()?[Math.min(404,z.x-40),0]:[0,0],br=desktop()?[z.x,z.y]:[z.x,Math.max(40,z.y-118)];
  return L.latLngBounds(map.containerPointToLatLng(L.point(tl[0],br[1])),map.containerPointToLatLng(L.point(br[0],tl[1])));
}
function scrollCard(c){const l=$("mapList"),r=c.getBoundingClientRect(),lr=l.getBoundingClientRect();if(r.top<lr.top||r.bottom>lr.bottom)l.scrollTop+=r.top-lr.top-8}
function markEl(id){const m=markers.get(id);if(!m)return null;const v=cluster.getVisibleParent(m);return v&&v.getElement?v.getElement():null}
function highlight(id){
  document.querySelectorAll(".pw-hl").forEach(e=>e.classList.remove("pw-hl"));
  hl=id;if(id==null)return;const el=markEl(id);if(el)el.classList.add("pw-hl");
}
function selectCard(id){
  selId=id;
  document.querySelectorAll(".mcard.is-sel").forEach(c=>c.classList.remove("is-sel"));
  const c=document.querySelector(`.mcard[data-mid="${id}"]`);if(!c)return;
  c.classList.add("is-sel");
  if(!desktop()&&sheetState==="peek")setSheet("mid");
  scrollCard(c);highlight(id);
}
/* fly to a place and open its popup (card click, suggestion, Enter in search) */
function focusPlace(id){
  const r=place(id),m=markers.get(id);
  selectCard(id);
  if(!r||!r.ll||!m)return;
  const open=()=>cluster.zoomToShowLayer(m,()=>{m.openPopup();selectCard(id)});
  const z=Math.max(map.getZoom(),16);
  const target=desktop()?map.unproject(map.project(r.ll,z).subtract([190,0]),z):r.ll;
  map.once("moveend",open);map.flyTo(target,z,{duration:.7});
}
/* Enter in search: an area name fits all matches there; otherwise fly to the best match */
function searchGo(q){
  q=(q||"").trim().toLowerCase();if(!q||!map)return;
  const all=filtered();
  const inArea=all.filter(r=>r.ll&&(r.area+" "+r.city).toLowerCase().includes(q));
  const byName=all.filter(r=>r.name.toLowerCase().includes(q));
  /* an area or city name with several places: show all of them, not just one name match */
  if(inArea.length>1||(inArea.length&&!byName.length)){
    const pts=all.filter(r=>r.ll);
    if(pts.length===1){focusPlace(pts[0].id);return}
    map.flyToBounds(L.latLngBounds(pts.map(r=>r.ll)),{...pad(),maxZoom:15,duration:.7});return;
  }
  const best=(byName.length?byName:all).sort((a,b)=>(b.name.toLowerCase().startsWith(q)-a.name.toLowerCase().startsWith(q)))[0];
  if(best)focusPlace(best.id);
}
function nearMe(){
  const msg=$("nearMsg");msg.textContent="Finding your location…";
  const fail=()=>{msg.textContent="Location unavailable — search an area instead."};
  if(!navigator.geolocation){fail();return}
  try{navigator.geolocation.getCurrentPosition(p=>{msg.textContent="";map.setView([p.coords.latitude,p.coords.longitude],14)},fail,{timeout:8000,maximumAge:60000})}catch(_){fail()}
}
/* mobile bottom sheet: drag the handle between collapsed / half / full, or tap it */
let sheetState="peek";
function setSheet(s){sheetState=s;const sh=$("mapSheet");sh.dataset.state=s;sh.style.height="";$("mapHandle").setAttribute("aria-expanded",String(s!=="peek"));const pk=$("mapPeek");pk.textContent=pk.textContent.replace(/drag (up|down)$/,s==="peek"?"drag up":"drag down")}
function initSheet(){
  const h=$("mapHandle"),sh=$("mapSheet");let y0=null,hgt0=0,moved=false,dragged=false;
  h.addEventListener("pointerdown",e=>{if(desktop())return;y0=e.clientY;hgt0=sh.getBoundingClientRect().height;moved=false;h.setPointerCapture(e.pointerId);sh.classList.add("is-drag")});
  h.addEventListener("pointermove",e=>{if(y0==null)return;const dy=e.clientY-y0;if(Math.abs(dy)>4)moved=true;const max=sh.parentElement.getBoundingClientRect().height;sh.style.height=Math.max(88,Math.min(max*.88,hgt0-dy))+"px"});
  const end=()=>{if(y0==null)return;y0=null;sh.classList.remove("is-drag");
    if(!moved){sh.style.height="";return}
    dragged=true;const r=sh.getBoundingClientRect().height/sh.parentElement.getBoundingClientRect().height;setSheet(r<.3?"peek":r<.66?"mid":"full")};
  h.addEventListener("pointerup",end);h.addEventListener("pointercancel",end);
  h.addEventListener("click",()=>{if(desktop())return;if(dragged){dragged=false;return}setSheet(sheetState==="peek"?"mid":sheetState==="mid"?"full":"peek")});
  setSheet("peek");
}
document.addEventListener("click",e=>{const b=e.target.closest("[data-map-open]");if(b){e.preventDefault();go("detail",+b.dataset.mapOpen)}});
/* skip link: jump past the map (and its many pins) to the results */
$("skipMap").addEventListener("click",e=>{e.preventDefault();if(!desktop()&&sheetState==="peek")setSheet("mid");const first=document.querySelector("#mapList .mcard-a");(first||$("mapList")).focus()});
async function show(){
  if(!map){$("mapCount").textContent="Loading map…";try{await loadLeaflet()}catch(_){$("mapCount").textContent="The map couldn't load. Switch to All results to see every restaurant.";return}if(!map)init()}
  if(document.getElementById("p-tracker").hidden)return;
  refresh();
  await new Promise(r=>setTimeout(r,0));map.invalidateSize();syncList();
}
return {dotOf,dotHTML,legendHTML,LEGEND,badgeOf,badgeLabel,badgeHTML,pausedNote,verif,show,refresh,focusPlace,searchGo,setScope,DOT_LABEL,get map(){return map},markers,highlight,setSheet};
}
