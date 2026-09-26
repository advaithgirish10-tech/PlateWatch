/*
 * Live camera for checkup evidence: a preview from the device camera, one tap to take the photo, then retake or use it.
 * There's no "choose from gallery", so owners photograph the kitchen as it is now. (A determined person could still
 * point the camera at an old photo; reviewers and weekly spot checks are the backstop.)
 * Needs a secure page (https, or localhost in development) and camera permission.
 */
export function createCamera({ esc, toast }) {
  const el = document.createElement("div");
  el.className = "cam";
  el.hidden = true;
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");
  el.setAttribute("aria-labelledby", "camTitle");
  el.innerHTML = `<div class="cam-panel">
    <div class="cam-head"><h2 id="camTitle" class="cam-title">Take a photo</h2><button type="button" class="x" data-cam-close aria-label="Close camera">Close</button></div>
    <p class="cam-q" id="camQ"></p>
    <div class="cam-view"><video id="camVideo" playsinline muted></video><img id="camShot" alt="The photo you just took" hidden><p class="cam-msg" id="camMsg" hidden></p></div>
    <div class="cam-acts">
      <button type="button" class="pillbtn" id="camTake">Take photo</button>
      <button type="button" class="pillbtn out" id="camRetake" hidden>Retake</button>
      <button type="button" class="pillbtn" id="camUse" hidden>Use photo</button>
    </div></div>`;
  document.body.append(el);
  const $ = (id) => document.getElementById(id);
  const video = $("camVideo"), shot = $("camShot"), msg = $("camMsg"), take = $("camTake"), retake = $("camRetake"), use = $("camUse");
  let stream = null, blob = null, done = null, lastFocus = null;

  const stop = () => { if (stream) stream.getTracks().forEach((t) => t.stop()); stream = null; video.srcObject = null; };
  const setMode = (m) => {
    video.hidden = m !== "live"; shot.hidden = m !== "shot"; msg.hidden = m !== "error";
    take.hidden = m !== "live"; retake.hidden = use.hidden = m !== "shot";
  };
  async function start() {
    setMode("live"); take.disabled = true;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return fail("This browser can't use the camera. Open this page on your phone in Chrome or Safari.");
    try {
      /* the back camera on phones; any camera on laptops */
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
      video.srcObject = stream; await video.play(); take.disabled = false; take.focus();
    } catch (e) {
      fail(e && e.name === "NotAllowedError" ? "Camera access was blocked. Allow the camera for this site in your browser's settings, then try again." : "No camera was found. Open this page on your phone to take the photo.");
    }
  }
  function fail(text) { stop(); msg.textContent = text; setMode("error"); }
  function close() { stop(); el.hidden = true; document.documentElement.classList.remove("cam-lock"); if (shot.src) URL.revokeObjectURL(shot.src); blob = null; if (lastFocus && document.contains(lastFocus)) lastFocus.focus(); }

  take.onclick = () => {
    /* capture at up to 1600 px wide: sharp enough to review, small enough to upload quickly */
    const w = Math.min(video.videoWidth, 1600), h = Math.round(video.videoHeight * (w / video.videoWidth));
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    c.getContext("2d").drawImage(video, 0, 0, w, h);
    c.toBlob((b) => {
      if (!b) { toast("Couldn't take the photo. Try again."); return; }
      blob = b; stop(); shot.src = URL.createObjectURL(b); setMode("shot"); use.focus();
    }, "image/jpeg", 0.85);
  };
  retake.onclick = () => { if (shot.src) URL.revokeObjectURL(shot.src); blob = null; start(); };
  use.onclick = () => {
    const file = new File([blob], `camera-${new Date().toISOString().replace(/[:.]/g, "-")}.jpg`, { type: "image/jpeg" });
    const cb = done; close(); cb(file);
  };
  el.addEventListener("click", (e) => { if (e.target.closest("[data-cam-close]") || e.target === el) close(); });
  document.addEventListener("keydown", (e) => { if (!el.hidden && e.key === "Escape") { e.preventDefault(); close(); } });

  return {
    open(question, onPhoto) {
      lastFocus = document.activeElement; done = onPhoto;
      $("camQ").textContent = question;
      el.hidden = false; document.documentElement.classList.add("cam-lock");
      start();
    },
  };
}
