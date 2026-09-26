/*
 * PlateWatch map view, official-status dots and PlateWatch verification badges.
 * Two signals, never mixed:
 *  - DOT colour = the latest OFFICIAL regulatory action only (red / amber / green / grey).
 *  - BADGE = PlateWatch's own verification level only (Not claimed yet / Claimed · self-reported / PlateWatch verified).
 * Restaurants come from the API: the map asks for what's inside the area on screen, again as it moves.
 */
/* Leaflet + markercluster load on first use of the map, so other pages stay light */
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";

/* ---------- dots: official status only ---------- */
const DOT_LABEL={red:"suspended or revoked",amber:"improvement notice open",green:"reinstated after an action",grey:"no official action on record"};
const RANK={red:3,amber:2,green:1,grey:0};
export const dotHTML=dot=>`<span class="sdot sdot-${dot||"grey"}" aria-hidden="true"></span><span class="sr-only">Status: ${DOT_LABEL[dot||"grey"]}. </span>`;
export const legendHTML=()=>`<p class="dlegend"><span class="dl"><span class="sdot sdot-red" aria-hidden="true"></span>Red: suspended or revoked</span><span class="dl-sep" aria-hidden="true">·</span><span class="dl"><span class="sdot sdot-amber" aria-hidden="true"></span>Amber: improvement notice</span><span class="dl-sep" aria-hidden="true">·</span><span class="dl"><span class="sdot sdot-green" aria-hidden="true"></span>Green: reinstated after an action</span><span class="dl-sep" aria-hidden="true">·</span><span class="dl"><span class="sdot sdot-grey" aria-hidden="true"></span>Grey: no official action on record (not a safety rating)</span></p>`;

/* ---------- badges: PlateWatch verification only, as the API computes it ---------- */
const BADGE={none:"Not claimed yet",claimed:"Claimed · self-reported",verified:"PlateWatch verified"};
const TIP={none:"The owner hasn't joined PlateWatch yet. This says nothing about hygiene.",verified:"Evidence reviewed by PlateWatch. Not a government certification."};
const level=b=>(b&&b.level)||"none";
export const badgeLabel=b=>BADGE[level(b)];
export const badgeHTML=b=>{const k=level(b);return `<span class="vb vb-${k}"${TIP[k]?` title="${TIP[k]}"`:""}>${k==="verified"?'<i class="vb-mark" aria-hidden="true"></i>':""}${BADGE[k]}${TIP[k]?`<span class="sr-only"> (${TIP[k]})</span>`:""}</span>`};
export const pausedNote=(b,esc)=>b&&b.paused&&b.paused.length?`<p class="vb-paused">PlateWatch verification paused: ${esc(b.paused.join("; "))}.</p>`:"";

export function createMap(ctx){
const {api,esc,fmt,st,go,filters,noResults,remember}=ctx;
const $=id=>document.getElementById(id);
let L=null,map=null,cluster=null,markers=new Map(),items=[],unlocated=0,hl=null,selId=null,loading=null,scope="area",failed=false,seq=0,timer=null,pendingOpen=null;
async function loadLeaflet(){
  if(!loading)loading=(async()=>{L=(await import("./leaflet-global.js")).default;await import("leaflet.markercluster")})();
  return loading;
}
const desktop=()=>matchMedia("(min-width: 1024px)").matches;
const ll=r=>[r.location.lat,r.location.lng];
/* keep pins clear of the results panel (left on desktop, bottom sheet on phones) */
const pad=()=>desktop()?{paddingTopLeft:[404,24],paddingBottomRight:[24,24]}:{paddingTopLeft:[24,24],paddingBottomRight:[24,140]};
function pinIcon(r){
  const v=level(r.badge)==="verified";
  return L.divIcon({className:"pw-pin-wrap",iconSize:[22,22],iconAnchor:[11,11],popupAnchor:[0,-12],
    html:`<span class="pw-pin pw-pin-${r.dot}">${v?'<i class="pw-pin-dia"></i>':""}<span class="sr-only">${esc(r.name)}. Status: ${DOT_LABEL[r.dot]}.${v?" PlateWatch verified.":""}</span></span>`});
}
function popupHTML(r){
  return `<div class="mpop"><div class="mpop-n">${dotHTML(r.dot)}<b>${esc(r.name)}</b></div><div class="mpop-b">${badgeHTML(r.badge)}${st(r.status||"none")}</div>
    <p class="mpop-s">${esc(r.summary||"")}</p><div class="mpop-a">${esc(r.area)}, ${esc(r.city)} · ${esc(r.category)}</div>
    <button type="button" class="pillbtn sm" data-map-open="${r.id}">Open profile →</button></div>`;
}
/* each card is a link to the profile: Enter opens it; a mouse click shows the place on the map instead */
function cardHTML(r){
  return `<li class="mcard${selId===r.id?" is-sel":""}" data-mid="${r.id}">
    <h3 class="mcard-h"><a class="mcard-a" href="#profile-${r.id}" data-card="${r.id}">${dotHTML(r.dot)}<span class="mcard-nm">${esc(r.name)}</span></a></h3>
    <div class="mcard-b">${badgeHTML(r.badge)}${st(r.status||"none")}</div>
    <div class="mcard-m"><span>${esc(r.area)}, ${esc(r.city)}</span><span>${r.statusOn?"Latest action "+fmt(r.statusOn):"No official action on record"}</span>${r.location?"":`<span class="mcard-pend">Location pending</span>`}</div>
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
  /* a new area on screen: ask the server what's there */
  map.on("moveend",()=>{if(scope==="area")refresh();else syncList()});
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
function setScope(s){scope=s;document.querySelectorAll("#mapSheet [data-scope]").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.scope===s)));refresh(true)}

/* the query the filters describe; "In this map area" adds the map's bounds */
function query(){
  const f=filters(),p=new URLSearchParams({sort:f.sort,limit:"500"});
  if(f.q.trim())p.set("q",f.q.trim());if(f.city)p.set("city",f.city);if(f.status)p.set("status",f.status);if(f.badge)p.set("badge",f.badge);
  if(scope==="area"&&map){const b=map.getBounds(),c=(v,lo,hi)=>Math.max(lo,Math.min(hi,v)).toFixed(5);
    p.set("bbox",[c(b.getWest(),-180,180),c(b.getSouth(),-90,90),c(b.getEast(),-180,180),c(b.getNorth(),-90,90)].join(","))}
  return p;
}
/* refetch after the filters or the map change; quick changes in a row send one request */
function refresh(now){
  if(!map&&!failed)return Promise.resolve();
  clearTimeout(timer);
  return new Promise(res=>{timer=setTimeout(async()=>{await load();res()},now?0:250)});
}
async function load(){
  const my=++seq;
  let d;
  try{d=await api("GET","/restaurants?"+query())}
  catch(e){if(my===seq){items=[];unlocated=0;$("mapCount").textContent="";$("mapList").innerHTML=`<li class="mcard-empty"><p>${esc(e.message)}</p><button type="button" class="x" data-retry-map>Try again</button></li>`;const b=document.querySelector("[data-retry-map]");if(b)b.onclick=()=>refresh(true)}return}
  if(my!==seq)return;               /* a newer request is on its way */
  items=d.items;unlocated=d.unlocated||0;remember(items);
  if(map)drawPins();
  syncList();
  if(pendingOpen!=null&&markers.has(pendingOpen))openPin(pendingOpen);
}
/* update pins in place: a pin that's still there keeps its open popup (opening one pans the map, which reloads the area) */
const sig=r=>r.dot+"|"+level(r.badge);
function drawPins(){
  const next=new Map(items.filter(r=>r.location).map(r=>[r.id,r]));
  const gone=[];markers.forEach((m,id)=>{if(!next.has(id)){gone.push(m);markers.delete(id)}});
  if(gone.length)cluster.removeLayers(gone);
  const added=[],changed=[];
  next.forEach((r,id)=>{
    const old=markers.get(id);
    if(old){old.options.r=r;if(old.options.sig!==sig(r)){old.setIcon(pinIcon(r));old.options.dot=r.dot;old.options.sig=sig(r);changed.push(old)}return}
    const m=L.marker(ll(r),{icon:pinIcon(r),dot:r.dot,sig:sig(r),r,title:`${r.name} · ${DOT_LABEL[r.dot]}`,keyboard:true,riseOnHover:true});
    m.bindPopup(()=>popupHTML(m.options.r),{maxWidth:280,minWidth:220,autoPanPaddingTopLeft:desktop()?L.point(404,20):L.point(10,10)});
    m.on("click",()=>selectCard(id));
    markers.set(id,m);added.push(m);
  });
  if(added.length)cluster.addLayers(added);
  /* a status change recolours the clusters around it */
  if(changed.length)cluster.refreshClusters(changed);
  if(hl)highlight(hl);
}
/* results = what the server returned; in "In this map area", only what isn't hidden behind the results panel */
function syncList(){
  const q=filters().q.trim();
  let rows=items;
  if(scope==="area"&&map){const b=visibleBounds();rows=items.filter(r=>r.location&&b.contains(ll(r)))}
  $("mapCount").textContent=`${rows.length} result${rows.length===1?"":"s"}${scope==="area"?" in this map area":""}`;
  $("mapPeek").textContent=`${rows.length} result${rows.length===1?"":"s"} · ${sheetState==="peek"?"drag up":"drag down"}`;
  let h=rows.map(cardHTML).join("");
  if(!rows.length){
    h=`<li class="mcard-empty">${scope==="area"&&!failed?`<p>Nothing here matches. Try zooming out or switching to All results.</p><button type="button" class="x" data-scope-all>Show all results</button>`:q?noResults(q):`<p>Nothing matches these filters.</p>`}</li>`;
  }
  if(scope==="area"&&unlocated)h+=`<li class="mcard-note">${unlocated} matching restaurant${unlocated===1?" has":"s have"} no location yet. <button type="button" class="x" data-scope-all>See All results</button></li>`;
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
  hl=id;if(id==null||!cluster)return;const el=markEl(id);if(el)el.classList.add("pw-hl");
}
function selectCard(id){
  selId=id;
  document.querySelectorAll(".mcard.is-sel").forEach(c=>c.classList.remove("is-sel"));
  const c=document.querySelector(`.mcard[data-mid="${id}"]`);if(!c)return;
  c.classList.add("is-sel");
  if(!desktop()&&sheetState==="peek")setSheet("mid");
  scrollCard(c);highlight(id);
}
function openPin(id){
  const m=markers.get(id);pendingOpen=null;if(!m)return;
  cluster.zoomToShowLayer(m,()=>{m.openPopup();selectCard(id)});
}
/* fly to a place and open its popup (card click, suggestion, Enter in search); its pin arrives with the new area */
async function focusPlace(id,known){
  selectCard(id);
  if(!map)return;
  let r=items.find(x=>x.id===id)||(known&&known.location!==undefined?known:null);
  if(!r){try{r=await api("GET","/restaurants/"+id);remember([r])}catch(_){return}}
  if(!r.location){if(scope==="area")setScope("all");selId=id;return}
  pendingOpen=id;
  const z=Math.max(map.getZoom(),16);
  const target=desktop()?map.unproject(map.project(ll(r),z).subtract([190,0]),z):ll(r);
  map.flyTo(target,z,{duration:.7});
  /* already on screen and nothing new to load: open it now */
  setTimeout(()=>{if(pendingOpen===id&&markers.has(id))openPin(id)},900);
}
/* Enter in search: an area name fits all matches there; otherwise fly to the best match */
async function searchGo(q){
  q=(q||"").trim();if(!q||!map)return;
  const f=filters(),p=new URLSearchParams({q,limit:"500",sort:f.sort});
  if(f.city)p.set("city",f.city);if(f.status)p.set("status",f.status);if(f.badge)p.set("badge",f.badge);
  let all;try{all=(await api("GET","/restaurants?"+p)).items}catch(_){return}
  remember(all);if(!all.length)return;
  const lq=q.toLowerCase(),pts=all.filter(r=>r.location);
  const inArea=pts.filter(r=>(r.area+" "+r.city).toLowerCase().includes(lq)),byName=all.filter(r=>r.name.toLowerCase().includes(lq));
  /* an area or city name with several places: show all of them, not just one name match */
  if(inArea.length>1||(inArea.length&&!byName.length)){
    if(pts.length===1){focusPlace(pts[0].id,pts[0]);return}
    map.flyToBounds(L.latLngBounds(pts.map(ll)),{...pad(),maxZoom:15,duration:.7});return;
  }
  const best=(byName.length?byName:all).sort((a,b)=>(b.name.toLowerCase().startsWith(lq)-a.name.toLowerCase().startsWith(lq)))[0];
  if(best)focusPlace(best.id,best);
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
  if(!map&&!failed){
    $("mapCount").textContent="Loading map…";
    try{await loadLeaflet()}
    /* the map itself couldn't load (offline, or files replaced by a new deploy): the list still works */
    catch(_){loading=null;failed=true;scope="all";$("mapSheet").dataset.state="full";await refresh(true);$("mapCount").textContent="The map couldn't load. Showing every match.";return}
    if(!map)init();
  }
  if(document.getElementById("p-tracker").hidden)return;
  await new Promise(r=>setTimeout(r,0));if(map)map.invalidateSize();
  await refresh(true);
}
return {show,refresh,focusPlace,searchGo,setScope,get map(){return map},setSheet};
}
