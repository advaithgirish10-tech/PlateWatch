/*
 * "Write your Remark": the report form, from a profile or from any "Report" button.
 * Without a restaurant it starts by asking which one (search, or name an unlisted place).
 * A category, up to 1000 characters, and two photos taken with the camera: the bill (proof of the visit) and the food.
 * Every report goes to a PlateWatch moderator first and is checked within 24 hours. Reports marked false count
 * against the reporter: after 2 in a week an admin can ban the number.
 */
const MAX = 1000;
const CATS = ["Pests", "Stale or spoiled food", "Hygiene", "Fell ill", "Other"];
const SLOTS = [
  { key: "bill", label: "Bill photo", hint: "Photograph the bill so we know you ate here." },
  { key: "food", label: "Food photo", hint: "Photograph the food or the problem you saw." },
];
const DAY = 864e5;

export function createRemark({ esc, toast, api, uploadFile, camera, limits, owns = () => false, onSent }) {
  const el = document.createElement("div");
  el.className = "rmk";
  el.hidden = true;
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");
  el.setAttribute("aria-labelledby", "rmkTitle");
  document.body.append(el);
  let st = null, lastFocus = null;

  const close = () => {
    if (st) SLOTS.forEach((s) => st.shots[s.key] && URL.revokeObjectURL(st.shots[s.key].url));
    st = null; el.hidden = true; el.innerHTML = "";
    document.documentElement.classList.remove("rmk-lock");
    if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
  };
  el.addEventListener("click", (e) => { if (e.target === el || e.target.closest("[data-rmk-close]")) close(); });
  document.addEventListener("keydown", (e) => {
    /* Escape closes the camera first when it's open on top */
    if (!el.hidden && e.key === "Escape" && !document.querySelector(".cam:not([hidden])")) { e.preventDefault(); close(); }
  });

  const shell = (body) => `<div class="rmk-panel">
    <div class="rmk-head"><h2 id="rmkTitle" class="rmk-title">Write your Remark</h2><button type="button" class="x" data-rmk-close aria-label="Close">Close</button></div>
    ${st.name ? `<p class="rmk-place">${esc(st.name)}${st.picked ? ` · <button type="button" class="x" data-rmk-change>Change</button>` : ""}</p>` : ""}${body}</div>`;
  el.addEventListener("click", (e) => { if (st && e.target.closest("[data-rmk-change]")) { st.rid = null; st.unlisted = null; st.name = ""; renderPick(); } });

  /* step 1 when no restaurant was given: which place? */
  let searchT = null;
  function renderPick() {
    el.innerHTML = shell(`<div class="rmk-form">
      <label for="rmkQ">Which restaurant?</label>
      <input class="input" id="rmkQ" autocomplete="off" placeholder="Search by name or area" value="${esc(st.q || "")}" aria-controls="rmkHits">
      <div class="rmk-hits" id="rmkHits" role="listbox" aria-label="Matching restaurants"></div>
      <p class="rmk-note">Not on PlateWatch? <button type="button" class="x" id="rmkUnl" aria-expanded="false">Name the place instead</button></p>
      <div id="rmkUnlF" hidden>
        <label for="rmkUn">Restaurant name</label><input class="input" id="rmkUn" maxlength="120" value="${esc(st.q || "")}">
        <label for="rmkUa">Area</label><input class="input" id="rmkUa" maxlength="120" placeholder="e.g. Dadar West">
        <div id="rmkErr" role="alert"></div>
        <div class="rmk-acts"><button type="button" class="pillbtn" id="rmkUnGo">Continue</button></div>
      </div></div>`);
    const q = el.querySelector("#rmkQ"), hits = el.querySelector("#rmkHits");
    const search = async () => {
      const v = q.value.trim(); st.q = v;
      if (v.length < 2) { hits.innerHTML = ""; return; }
      try {
        const { items } = await api("GET", "/search?q=" + encodeURIComponent(v));
        if (!st || q.value.trim() !== v) return;
        hits.innerHTML = items.length
          ? items.map((r) => `<button type="button" role="option" class="rmk-hit" data-pick="${r.id}" data-name="${esc(r.name)}"><b>${esc(r.name)}</b><span>${esc(r.area)}, ${esc(r.city)}</span></button>`).join("")
          : `<p class="muted rmk-none">No match. Check the spelling, or name the place below.</p>`;
      } catch (e) { hits.innerHTML = `<p class="muted rmk-none">${esc(e.message)}</p>`; }
    };
    q.oninput = () => { clearTimeout(searchT); searchT = setTimeout(search, 200); };
    hits.onclick = (e) => {
      const b = e.target.closest("[data-pick]"); if (!b) return;
      st.rid = +b.dataset.pick; st.name = b.dataset.name; st.picked = true;
      if (owns(st.rid)) { el.innerHTML = shell(`<p class="rmk-block">You manage this restaurant, so you can't report it.</p><div class="rmk-acts"><button type="button" class="pillbtn out" data-rmk-change>Choose another</button></div>`); return; }
      afterPick();
    };
    const unl = el.querySelector("#rmkUnl"), form = el.querySelector("#rmkUnlF");
    unl.onclick = () => { form.hidden = !form.hidden; unl.setAttribute("aria-expanded", String(!form.hidden)); if (!form.hidden) el.querySelector("#rmkUn").focus(); };
    el.querySelector("#rmkUnGo").onclick = () => {
      const name = el.querySelector("#rmkUn").value.trim(), area = el.querySelector("#rmkUa").value.trim();
      if (name.length < 2 || area.length < 2) { el.querySelector("#rmkErr").innerHTML = `<div class="err">Enter the restaurant's name and area.</div>`; return; }
      st.unlisted = { name, area }; st.name = `${name}, ${area} (not listed)`; st.picked = true;
      afterPick();
    };
    q.focus();
    if (st.q) search();
  }

  /* the limits for this place, then the form */
  function afterPick() {
    const why = st.mine ? blocked(st.mine) : "";
    if (why) { el.innerHTML = shell(`<p class="rmk-block">${why}</p><div class="rmk-acts">${st.picked ? `<button type="button" class="pillbtn out" data-rmk-change>Choose another</button>` : ""}<button type="button" class="pillbtn" data-rmk-close>OK</button></div>`); return; }
    renderForm();
    el.querySelector("#rmkCat").focus();
  }

  /* the same rules the server checks, so nobody fills the form and takes photos only to be refused */
  function blocked(items) {
    const now = Date.now(), week = items.filter((x) => now - new Date(x.createdAt) < 7 * DAY);
    const today = new Date().toDateString();
    const same = st.rid ? week.find((x) => x.restaurantId === st.rid) : st.unlisted ? week.find((x) => !x.restaurantId && x.place.toLowerCase() === `${st.unlisted.name} (not listed)`.toLowerCase()) : null;
    if (same) return `You've already reported this place this week (${esc(same.ref)}). You can report it again 7 days after that report.`;
    if (items.some((x) => new Date(x.createdAt).toDateString() === today)) return `You can send ${limits.day === 1 ? "one report a day" : limits.day + " reports a day"}. Try again tomorrow.`;
    if (week.length >= limits.week) {
      const next = new Date(Math.min(...week.map((x) => +new Date(x.createdAt))) + 7 * DAY);
      return `You've sent ${limits.week} reports this week. You can send another from ${next.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}.`;
    }
    return "";
  }

  function renderForm() {
    el.innerHTML = shell(`<form class="rmk-form" id="rmkForm" novalidate>
      <label for="rmkCat">What went wrong</label>
      <select class="input" id="rmkCat" required><option value="">Choose one</option>${CATS.map((c) => `<option${st.cat === c ? " selected" : ""}>${esc(c)}</option>`).join("")}</select>
      <label for="rmkText">Your remark</label>
      <textarea class="input" id="rmkText" rows="6" maxlength="${MAX}" required placeholder="What did you see, eat or smell? When did you visit?">${esc(st.text)}</textarea>
      <div class="rmk-count" id="rmkCount" aria-live="polite"></div>
      <div class="rmk-shots">${SLOTS.map((s) => {
        const shot = st.shots[s.key];
        return `<div class="rmk-shot${shot ? " has" : ""}">
          <div class="rmk-thumb">${shot ? `<img src="${shot.url}" alt="${esc(s.label)} you took">` : `<span aria-hidden="true">📷</span>`}</div>
          <div><b>${esc(s.label)}</b><p>${esc(s.hint)}</p>
          <button type="button" class="pillbtn ${shot ? "out" : ""}" data-shot="${s.key}">${shot ? "Retake" : "Open camera"}</button></div></div>`;
      }).join("")}</div>
      <p class="rmk-note">Camera only: take both photos now, at the restaurant or with the bill in hand. We check every report within 24 hours before anything is published. False reports are removed, and a number with 2 false reports in a week can be banned.</p>
      <label class="rmk-share"><input type="checkbox" id="rmkShare" ${st.share ? "checked" : ""}> Share with the restaurant and the food safety regulator. Your number stays private.</label>
      <div id="rmkErr" role="alert"></div>
      <div class="rmk-acts"><button type="button" class="pillbtn out" data-rmk-close>Cancel</button><button type="submit" class="pillbtn" id="rmkSend">Send report</button></div>
    </form>`);
    const ta = el.querySelector("#rmkText"), cnt = el.querySelector("#rmkCount");
    const count = () => { const n = ta.value.length; cnt.textContent = `${n} / ${MAX} characters`; cnt.classList.toggle("near", n > MAX - 100); };
    ta.oninput = () => { st.text = ta.value; count(); }; count();
    el.querySelector("#rmkCat").onchange = (e) => (st.cat = e.target.value);
    el.querySelector("#rmkShare").onchange = (e) => (st.share = e.target.checked);
    el.querySelectorAll("[data-shot]").forEach((b) => (b.onclick = () => {
      const s = SLOTS.find((x) => x.key === b.dataset.shot);
      camera.open(`${s.label}: ${s.hint}`, (file) => {
        if (!st) return;
        if (st.shots[s.key]) URL.revokeObjectURL(st.shots[s.key].url);
        st.shots[s.key] = { file, url: URL.createObjectURL(file) };
        renderForm();
        el.querySelector(`[data-shot="${s.key}"]`)?.focus();
      });
    }));
    el.querySelector("#rmkForm").onsubmit = (e) => { e.preventDefault(); send(); };
  }

  async function send() {
    const err = el.querySelector("#rmkErr"), btn = el.querySelector("#rmkSend");
    const text = st.text.trim(), missing = SLOTS.filter((s) => !st.shots[s.key]).map((s) => s.label.toLowerCase());
    const problem = !st.cat ? "Choose what went wrong." : text.length < 10 ? "Write a few words about what happened (at least 10 characters)." : missing.length ? `Take the ${missing.join(" and the ")}.` : "";
    if (problem) { err.innerHTML = `<div class="err">${esc(problem)}</div>`; return; }
    err.innerHTML = ""; btn.disabled = true; btn.textContent = "Sending…";
    try {
      const bill = await uploadFile(st.shots.bill.file, "report");
      const food = await uploadFile(st.shots.food.file, "report");
      const res = await api("POST", "/reports", { ...(st.rid ? { restaurantId: st.rid } : { unlisted: st.unlisted }), category: st.cat, text, share: st.share, evidence: [{ uploadId: bill, kind: "bill" }, { uploadId: food }] });
      el.innerHTML = shell(`<div class="rmk-done">
        <p class="rmk-ref">Report <b>${esc(res.ref)}</b> received.</p>
        <p>A PlateWatch moderator will check it within 24 hours. It isn't shown on the profile until then. You can follow it under My account → My reports.</p>
        <div class="rmk-acts"><button type="button" class="pillbtn" data-rmk-close>Done</button></div></div>`);
      el.querySelector(".rmk-done .pillbtn").focus();
      onSent && onSent(res);
    } catch (e) {
      err.innerHTML = `<div class="err">${esc(e.message)}</div>`;
      btn.disabled = false; btn.textContent = "Send report";
    }
  }

  return {
    /* { rid, name } for a known restaurant, or { q } to start by choosing one */
    async open({ rid = null, name = "", q = "" } = {}) {
      lastFocus = document.activeElement;
      st = { rid, name: rid ? name : "", q, unlisted: null, picked: false, mine: null, cat: "", text: "", share: true, shots: {} };
      el.hidden = false; document.documentElement.classList.add("rmk-lock");
      el.innerHTML = shell(`<p class="muted" style="padding:24px 0">Loading…</p>`);
      try { st.mine = (await api("GET", "/me/reports")).items; } catch { /* the server checks the same rules when the report is sent */ }
      if (!st) return;
      /* a day or week limit applies whatever the place, so say so before anything is chosen */
      const general = st.mine && !rid ? blocked(st.mine) : "";
      if (general) { el.innerHTML = shell(`<p class="rmk-block">${general}</p><div class="rmk-acts"><button type="button" class="pillbtn" data-rmk-close>OK</button></div>`); return; }
      if (rid) afterPick(); else renderPick();
    },
    close,
  };
}
