// LWH Driver Scan - App Controller

const App = (() => {
  let stream = null;
  let pages = []; // { canvas, thumbDataUrl }
  let currentPhotoImg = null;
  let corners = [];
  let dragIndex = -1;
  let currentFilter = "original";
  let rawWarpCanvas = null; // pre-filter, so switching filters doesn't compound
  let liveDetectTimer = null;
  let liveDetectBusy = false;
  let stabilityHistory = [];
  let autoCaptureArmed = false;

  const els = {};

  function cacheEls() {
    [
      "screen-home", "screen-camera", "screen-edit", "screen-pages", "screen-result",
      "video", "liveOverlay", "captureBtn", "choosePhotoInput", "cameraCancelBtn", "cameraStatus",
      "editCanvas", "editLoupe", "editRedetectBtn", "editConfirmBtn", "editCancelBtn", "editHint",
      "filterOriginal", "filterBw", "filterSharpen",
      "pageList", "pageCount", "addPageBtn", "finishBtn", "backHomeBtn",
      "resultPdfName", "shareBtn", "driveBtn", "downloadBtn", "startOverBtn",
      "homeNewScanBtn", "homeContinueBtn", "installBanner", "installBtn", "installDismissBtn"
    ].forEach((id) => (els[id] = document.getElementById(id)));
  }

  function showScreen(name) {
    ["home", "camera", "edit", "pages", "result"].forEach((s) => {
      els[`screen-${s}`].classList.toggle("active", s === name);
    });
  }

  // ---------- Camera ----------
  function setCameraStatus(text) {
    if (!text) {
      els.cameraStatus.classList.add("hidden");
      els.cameraStatus.textContent = "";
    } else {
      els.cameraStatus.classList.remove("hidden");
      els.cameraStatus.textContent = text;
    }
  }

  async function openCamera() {
    showScreen("camera");
    els.captureBtn.disabled = true;
    setCameraStatus("Requesting camera permission\u2026");

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraStatus("This browser can't access the camera here. Use \u201cChoose Photo\u201d below instead.");
      return;
    }

    try {
      stream = await requestCameraStream();
      els.video.srcObject = stream;
      await waitForVideoReady(els.video);
      setCameraStatus(null);
      els.captureBtn.disabled = false;
      startLiveDetection();
    } catch (err) {
      console.error("Camera error:", err.name, err.message);
      let msg = "Couldn't start the camera. Use \u201cChoose Photo\u201d below to pick one from your gallery instead.";
      if (err.name === "NotAllowedError") {
        msg = "Camera permission was denied. Check your browser/app settings, or use \u201cChoose Photo\u201d below.";
      } else if (err.name === "NotFoundError") {
        msg = "No camera found on this device. Use \u201cChoose Photo\u201d below.";
      } else if (err.name === "NotReadableError") {
        msg = "Camera is busy or blocked by another app. Close other camera apps, or use \u201cChoose Photo\u201d below.";
      }
      setCameraStatus(msg);
    }
  }

  // Tries the rear camera first; some desktop/laptop setups reject the
  // "environment" constraint outright, so we fall back to any camera rather
  // than leaving the driver stuck.
  async function requestCameraStream() {
    try {
      return await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false
      });
    } catch (err) {
      if (err.name === "OverconstrainedError" || err.name === "NotFoundError") {
        return await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }
      throw err;
    }
  }

  // Resolves once the video element actually has real frames flowing
  // (videoWidth/Height > 0), not just once srcObject is assigned — assigning
  // the stream doesn't guarantee a frame has decoded yet.
  function waitForVideoReady(video) {
    return new Promise((resolve, reject) => {
      if (video.videoWidth > 0 && video.videoHeight > 0) { resolve(); return; }

      const onLoaded = () => { cleanup(); resolve(); };
      const onError = () => { cleanup(); reject(new Error("Video failed to start")); };
      const timeout = setTimeout(() => { cleanup(); reject(new Error("Camera timed out starting")); }, 8000);

      function cleanup() {
        clearTimeout(timeout);
        video.removeEventListener("loadedmetadata", onLoaded);
        video.removeEventListener("error", onError);
      }

      video.addEventListener("loadedmetadata", onLoaded);
      video.addEventListener("error", onError);
      video.play().catch(() => {}); // autoplay may already be handling this; ignore duplicate-play rejections
    });
  }

  function stopCamera() {
    stopLiveDetection();
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
  }

  function capturePhoto() {
    const video = els.video;
    if (!video.videoWidth || !video.videoHeight) {
      alert("Camera isn't showing a live picture yet \u2014 give it a second and try again, or use \u201cChoose Photo.\u201d");
      return;
    }
    stopLiveDetection();
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);
    stopCamera();
    loadPhotoIntoEditor(canvas);
  }

  // ---------- Live edge detection (camera preview) ----------
  // Runs a lightweight detection pass on the live feed every ~450ms and
  // draws the result as an overlay. When the detected quad holds steady
  // across a few consecutive frames, it auto-captures — no tap needed, same
  // as the well-known scanner apps. Manual tap still always works too.

  function startLiveDetection() {
    stopLiveDetection();
    stabilityHistory = [];
    autoCaptureArmed = false;
    els.captureBtn.classList.remove("armed");
    liveDetectTimer = setInterval(liveDetectTick, 450);
  }

  function stopLiveDetection() {
    if (liveDetectTimer) {
      clearInterval(liveDetectTimer);
      liveDetectTimer = null;
    }
    stabilityHistory = [];
    autoCaptureArmed = false;
    els.captureBtn.classList.remove("armed");
    clearLiveOverlay();
  }

  function liveDetectTick() {
    if (liveDetectBusy || !stream) return;
    const video = els.video;
    if (!video.videoWidth || !video.videoHeight) return;
    if (!Scanner.isReady()) { drawDefaultGuideOverlay(); return; }

    liveDetectBusy = true;
    try {
      // Detect on a small downscaled frame — full-res isn't needed for a
      // live guide and keeps this fast enough to run several times a second
      // even on a mid-range phone.
      const targetW = 420;
      const scale = targetW / video.videoWidth;
      const ds = document.createElement("canvas");
      ds.width = Math.round(video.videoWidth * scale);
      ds.height = Math.round(video.videoHeight * scale);
      ds.getContext("2d").drawImage(video, 0, 0, ds.width, ds.height);

      const detected = Scanner.detectCorners(ds);

      if (detected) {
        const norm = detected.map((p) => ({ x: p.x / ds.width, y: p.y / ds.height }));
        const stable = trackStability(norm);
        drawLiveOverlay(norm, stable);
        if (stable && !autoCaptureArmed) {
          autoCaptureArmed = true;
          els.captureBtn.classList.add("armed");
          setTimeout(() => { if (liveDetectTimer) capturePhoto(); }, 350);
        }
      } else {
        stabilityHistory = [];
        if (autoCaptureArmed) { autoCaptureArmed = false; els.captureBtn.classList.remove("armed"); }
        drawDefaultGuideOverlay();
      }
    } catch (err) {
      console.error("Live detection error:", err);
    } finally {
      liveDetectBusy = false;
    }
  }

  // Returns true once the last few detections agree closely enough on
  // position and size to trust — a single lucky frame isn't enough, since a
  // hand passing through frame can produce a one-off false positive.
  function trackStability(norm) {
    const cx = (norm[0].x + norm[1].x + norm[2].x + norm[3].x) / 4;
    const cy = (norm[0].y + norm[1].y + norm[2].y + norm[3].y) / 4;
    const area = Math.abs(shoelaceArea(norm));

    stabilityHistory.push({ cx, cy, area });
    if (stabilityHistory.length > 4) stabilityHistory.shift();
    if (stabilityHistory.length < 4) return false;
    if (area < 0.12) return false; // too small to trust as "the document"

    const cxs = stabilityHistory.map((h) => h.cx);
    const cys = stabilityHistory.map((h) => h.cy);
    const areas = stabilityHistory.map((h) => h.area);
    const spread = (arr) => Math.max(...arr) - Math.min(...arr);

    return spread(cxs) < 0.025 && spread(cys) < 0.025 && spread(areas) < 0.06;
  }

  function shoelaceArea(pts) {
    let sum = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      sum += a.x * b.y - b.x * a.y;
    }
    return sum / 2;
  }

  // Maps the video's raw frame coordinates onto its displayed box, since
  // object-fit:contain letterboxes rather than crops — needed so the
  // overlay lines up with what the driver actually sees.
  function videoDisplayRect() {
    const video = els.video;
    const containerW = video.clientWidth;
    const containerH = video.clientHeight;
    const videoRatio = video.videoWidth / video.videoHeight;
    const containerRatio = containerW / containerH;

    let dispW, dispH, offX, offY;
    if (videoRatio > containerRatio) {
      dispW = containerW;
      dispH = containerW / videoRatio;
      offX = 0;
      offY = (containerH - dispH) / 2;
    } else {
      dispH = containerH;
      dispW = containerH * videoRatio;
      offY = 0;
      offX = (containerW - dispW) / 2;
    }
    return { dispW, dispH, offX, offY, containerW, containerH };
  }

  function syncOverlayCanvasSize() {
    const canvas = els.liveOverlay;
    const rect = videoDisplayRect();
    if (canvas.width !== rect.containerW) canvas.width = rect.containerW;
    if (canvas.height !== rect.containerH) canvas.height = rect.containerH;
    return rect;
  }

  function clearLiveOverlay() {
    const canvas = els.liveOverlay;
    canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
  }

  function drawDefaultGuideOverlay() {
    const canvas = els.liveOverlay;
    const rect = syncOverlayCanvasSize();
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setLineDash([8, 8]);
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 3;
    const pad = 24;
    ctx.strokeRect(rect.offX + pad, rect.offY + pad, rect.dispW - pad * 2, rect.dispH - pad * 2 - 100);
    ctx.setLineDash([]);
  }

  function drawLiveOverlay(normPoints, stable) {
    const canvas = els.liveOverlay;
    const rect = syncOverlayCanvasSize();
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const pts = normPoints.map((p) => ({
      x: rect.offX + p.x * rect.dispW,
      y: rect.offY + p.y * rect.dispH
    }));

    ctx.strokeStyle = stable ? "#3fa668" : "#a8214a";
    ctx.fillStyle = stable ? "rgba(63,166,104,0.18)" : "rgba(168,33,74,0.15)";
    ctx.lineWidth = stable ? 4 : 3;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    pts.slice(1).forEach((p) => ctx.lineTo(p.x, p.y));
    ctx.closePath();
    ctx.stroke();
    ctx.fill();
  }

  function handleChoosePhoto(e) {
    const file = e.target.files[0];
    if (!file) return;
    const img = new Image();
    img.onload = () => loadPhotoIntoEditor(img);
    img.src = URL.createObjectURL(file);
    e.target.value = "";
  }

  // ---------- Edit (auto-detect + drag corners) ----------
  function loadPhotoIntoEditor(imgOrCanvas) {
    currentPhotoImg = imgOrCanvas;
    showScreen("edit");
    els.editHint.textContent = "Finding the document edges\u2026";
    els.editConfirmBtn.disabled = true;

    // Draw the source photo to the edit canvas first so something's visible
    // immediately, then run detection (OpenCV can take a beat to warm up).
    drawEditCanvas();

    Scanner.whenReady(() => {
      const w = getImgWidth(currentPhotoImg);
      const h = getImgHeight(currentPhotoImg);
      let detected = null;
      try {
        detected = Scanner.detectCorners(currentPhotoImg);
      } catch (err) {
        console.error("Detection failed", err);
      }
      corners = detected ? Scanner.clampCorners(detected, w, h) : Scanner.defaultCorners(w, h);
      els.editHint.textContent = detected
        ? "Edges found \u2014 drag any corner if it needs adjusting."
        : "Couldn't find clean edges automatically \u2014 drag the corners to match the document.";
      els.editConfirmBtn.disabled = false;
      drawEditCanvas();
    });
  }

  function getImgWidth(el) { return el.videoWidth || el.naturalWidth || el.width; }
  function getImgHeight(el) { return el.videoHeight || el.naturalHeight || el.height; }

  function reDetect() {
    if (!currentPhotoImg) return;
    els.editHint.textContent = "Re-scanning\u2026";
    const detected = Scanner.detectCorners(currentPhotoImg);
    const w = getImgWidth(currentPhotoImg);
    const h = getImgHeight(currentPhotoImg);
    corners = detected ? Scanner.clampCorners(detected, w, h) : Scanner.defaultCorners(w, h);
    els.editHint.textContent = detected
      ? "Edges found \u2014 drag any corner if it needs adjusting."
      : "Still couldn't find clean edges \u2014 drag the corners to match the document.";
    drawEditCanvas();
  }

  // Canvas is drawn at a fixed display size; we keep a scale factor to map
  // between display coords (touch/drag) and real image pixel coords.
  let editScale = 1;

  function drawEditCanvas() {
    const canvas = els.editCanvas;
    const ctx = canvas.getContext("2d");
    const imgW = getImgWidth(currentPhotoImg);
    const imgH = getImgHeight(currentPhotoImg);

    const maxW = canvas.parentElement.clientWidth;
    const maxH = window.innerHeight * 0.55;
    editScale = Math.min(maxW / imgW, maxH / imgH, 1);

    canvas.width = imgW * editScale;
    canvas.height = imgH * editScale;

    ctx.drawImage(currentPhotoImg, 0, 0, canvas.width, canvas.height);

    if (corners.length === 4) {
      const disp = corners.map((p) => ({ x: p.x * editScale, y: p.y * editScale }));

      ctx.strokeStyle = "#a8214a";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(disp[0].x, disp[0].y);
      disp.slice(1).forEach((p) => ctx.lineTo(p.x, p.y));
      ctx.closePath();
      ctx.stroke();
      ctx.fillStyle = "rgba(168,33,74,0.15)";
      ctx.fill();

      disp.forEach((p) => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 14, 0, Math.PI * 2);
        ctx.fillStyle = "#ffffff";
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = "#7d1935";
        ctx.stroke();
      });
    }
  }

  function canvasPointFromEvent(e) {
    const rect = els.editCanvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  function handleDragStart(e) {
    if (corners.length !== 4) return;
    const p = canvasPointFromEvent(e);
    let closest = -1, closestDist = Infinity;
    corners.forEach((c, i) => {
      const d = Math.hypot(c.x * editScale - p.x, c.y * editScale - p.y);
      if (d < closestDist) { closestDist = d; closest = i; }
    });
    if (closestDist < 40) {
      dragIndex = closest;
      e.preventDefault();
      updateLoupe(p);
    }
  }

  function handleDragMove(e) {
    if (dragIndex === -1) return;
    e.preventDefault();
    const p = canvasPointFromEvent(e);
    corners[dragIndex] = {
      x: Math.min(Math.max(p.x / editScale, 0), getImgWidth(currentPhotoImg)),
      y: Math.min(Math.max(p.y / editScale, 0), getImgHeight(currentPhotoImg))
    };
    drawEditCanvas();
    updateLoupe(p);
  }

  function handleDragEnd() {
    dragIndex = -1;
    els.editLoupe.classList.add("hidden");
  }

  // Shows a zoomed-in circular preview of the area right around the corner
  // being dragged, positioned above the fingertip so it isn't covered by the
  // hand — same trick Notes/Adobe Scan use, since a fingertip is much bigger
  // than the pixel precision a perspective warp actually needs.
  function updateLoupe(displayPoint) {
    const loupe = els.editLoupe;
    const wrap = els.editCanvas.parentElement;
    const canvas = els.editCanvas;

    const ZOOM = 3;
    const SRC_SIZE = loupe.width / ZOOM; // region of the display canvas to sample

    const ctx = loupe.getContext("2d");
    ctx.clearRect(0, 0, loupe.width, loupe.height);
    ctx.save();
    ctx.beginPath();
    ctx.arc(loupe.width / 2, loupe.height / 2, loupe.width / 2, 0, Math.PI * 2);
    ctx.clip();

    const sx = Math.max(0, Math.min(canvas.width - SRC_SIZE, displayPoint.x - SRC_SIZE / 2));
    const sy = Math.max(0, Math.min(canvas.height - SRC_SIZE, displayPoint.y - SRC_SIZE / 2));
    ctx.drawImage(canvas, sx, sy, SRC_SIZE, SRC_SIZE, 0, 0, loupe.width, loupe.height);

    // Crosshair marking exactly where the corner will land.
    ctx.strokeStyle = "#a8214a";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(loupe.width / 2 - 12, loupe.height / 2);
    ctx.lineTo(loupe.width / 2 + 12, loupe.height / 2);
    ctx.moveTo(loupe.width / 2, loupe.height / 2 - 12);
    ctx.lineTo(loupe.width / 2, loupe.height / 2 + 12);
    ctx.stroke();
    ctx.restore();

    // Position above the fingertip, offset within the wrap element's bounds.
    const wrapRect = wrap.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    const canvasOffsetX = canvasRect.left - wrapRect.left;
    const canvasOffsetY = canvasRect.top - wrapRect.top;

    let left = canvasOffsetX + displayPoint.x - loupe.width / 2;
    let top = canvasOffsetY + displayPoint.y - loupe.height - 30;
    if (top < 0) top = canvasOffsetY + displayPoint.y + 30; // flip below if too close to top

    loupe.style.left = `${left}px`;
    loupe.style.top = `${top}px`;
    loupe.classList.remove("hidden");
  }

  function confirmEdit() {
    rawWarpCanvas = Scanner.warpToCanvas(currentPhotoImg, corners);
    currentFilter = "original";
    setActiveFilterButton("original");
    pushPageFromWarp();
    showScreen("pages");
    renderPageList();
  }

  function cancelEdit() {
    currentPhotoImg = null;
    if (pages.length > 0) {
      showScreen("pages");
      renderPageList();
    } else {
      showScreen("home");
    }
  }

  // ---------- Filters (applied on the page-review screen thumbnails) ----------
  function setActiveFilterButton(mode) {
    [els.filterOriginal, els.filterBw, els.filterSharpen].forEach((b) => b.classList.remove("active"));
    ({ original: els.filterOriginal, bw: els.filterBw, sharpen: els.filterSharpen })[mode].classList.add("active");
  }

  function pushPageFromWarp() {
    const filtered = document.createElement("canvas");
    filtered.width = rawWarpCanvas.width;
    filtered.height = rawWarpCanvas.height;
    filtered.getContext("2d").drawImage(rawWarpCanvas, 0, 0);
    Scanner.applyFilter(filtered, currentFilter);
    pages.push({ raw: rawWarpCanvas, canvas: filtered, filter: currentFilter });
  }

  function applyFilterToLastPage(mode) {
    if (pages.length === 0) return;
    const page = pages[pages.length - 1];
    const filtered = document.createElement("canvas");
    filtered.width = page.raw.width;
    filtered.height = page.raw.height;
    filtered.getContext("2d").drawImage(page.raw, 0, 0);
    Scanner.applyFilter(filtered, mode);
    page.canvas = filtered;
    page.filter = mode;
    renderPageList();
  }

  // ---------- Multi-page review ----------
  function renderPageList() {
    els.pageList.innerHTML = "";
    els.pageCount.textContent = pages.length === 1 ? "1 page" : `${pages.length} pages`;

    pages.forEach((page, i) => {
      const item = document.createElement("div");
      item.className = "page-thumb";

      const img = document.createElement("img");
      img.src = page.canvas.toDataURL("image/jpeg", 0.85);
      item.appendChild(img);

      const label = document.createElement("span");
      label.className = "page-thumb-label";
      label.textContent = `Page ${i + 1}`;
      item.appendChild(label);

      const removeBtn = document.createElement("button");
      removeBtn.className = "page-thumb-remove";
      removeBtn.setAttribute("aria-label", `Remove page ${i + 1}`);
      removeBtn.textContent = "\u00d7";
      removeBtn.onclick = () => {
        pages.splice(i, 1);
        renderPageList();
      };
      item.appendChild(removeBtn);

      els.pageList.appendChild(item);
    });

    if (pages.length > 0) {
      setActiveFilterButton(pages[pages.length - 1].filter);
    }
    els.finishBtn.disabled = pages.length === 0;
  }

  async function finishAndBuildPdf() {
    const defaultName = `Scan_${new Date().toISOString().slice(0, 10)}`;
    els.resultPdfName.value = defaultName;
    showScreen("result");
  }

  function startOver() {
    pages = [];
    currentPhotoImg = null;
    showScreen("home");
  }

  // ---------- Wire up ----------
  function init() {
    cacheEls();

    els.homeNewScanBtn.onclick = openCamera;
    els.homeContinueBtn.onclick = () => { showScreen("pages"); renderPageList(); };

    els.captureBtn.onclick = capturePhoto;
    els.choosePhotoInput.onchange = handleChoosePhoto;
    els.cameraCancelBtn.onclick = () => { stopCamera(); showScreen(pages.length ? "pages" : "home"); };

    els.editRedetectBtn.onclick = reDetect;
    els.editConfirmBtn.onclick = confirmEdit;
    els.editCancelBtn.onclick = cancelEdit;

    els.editCanvas.addEventListener("mousedown", handleDragStart);
    els.editCanvas.addEventListener("mousemove", handleDragMove);
    window.addEventListener("mouseup", handleDragEnd);
    els.editCanvas.addEventListener("touchstart", handleDragStart, { passive: false });
    els.editCanvas.addEventListener("touchmove", handleDragMove, { passive: false });
    els.editCanvas.addEventListener("touchend", handleDragEnd);

    els.filterOriginal.onclick = () => applyFilterToLastPage("original");
    els.filterBw.onclick = () => applyFilterToLastPage("bw");
    els.filterSharpen.onclick = () => applyFilterToLastPage("sharpen");

    els.addPageBtn.onclick = openCamera;
    els.finishBtn.onclick = finishAndBuildPdf;
    els.backHomeBtn.onclick = () => { if (confirm("Discard this scan and go back?")) startOver(); };
    els.startOverBtn.onclick = startOver;

    els.shareBtn.onclick = () => ShareModule.sharePdf(pages, els.resultPdfName.value);
    els.downloadBtn.onclick = () => ShareModule.downloadPdf(pages, els.resultPdfName.value);
    if (CONFIG.DRIVE_BACKUP_ENABLED) {
      els.driveBtn.classList.remove("hidden");
      els.driveBtn.onclick = () => DriveModule.backup(pages, els.resultPdfName.value, els.driveBtn);
    }

    setupInstallPrompt();
    registerServiceWorker();
  }

  // ---------- Install prompt ----------
  function setupInstallPrompt() {
    let deferredPrompt = null;
    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      deferredPrompt = e;
      els.installBanner.classList.remove("hidden");
    });
    els.installBtn.onclick = async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
      els.installBanner.classList.add("hidden");
    };
    els.installDismissBtn.onclick = () => els.installBanner.classList.add("hidden");
  }

  function registerServiceWorker() {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("./service-worker.js").catch((err) => console.error("SW registration failed", err));
    }
  }

  return { init };
})();

document.addEventListener("DOMContentLoaded", App.init);
