// LWH Driver Scan - App Controller

const App = (() => {
  let stream = null;
  let pages = []; // { canvas, thumbDataUrl }
  let currentPhotoImg = null;
  let corners = [];
  let dragIndex = -1;
  let currentFilter = "original";
  let rawWarpCanvas = null; // pre-filter, so switching filters doesn't compound

  const els = {};

  function cacheEls() {
    [
      "screen-home", "screen-camera", "screen-edit", "screen-pages", "screen-result",
      "video", "captureBtn", "choosePhotoInput", "cameraCancelBtn",
      "editCanvas", "editRedetectBtn", "editConfirmBtn", "editCancelBtn", "editHint",
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
  async function openCamera() {
    showScreen("camera");
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false
      });
      els.video.srcObject = stream;
    } catch (err) {
      alert("Couldn't access the camera. You can still use \u201cChoose Photo\u201d below to pick one from your gallery.");
      console.error(err);
    }
  }

  function stopCamera() {
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
  }

  function capturePhoto() {
    const video = els.video;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);
    stopCamera();
    loadPhotoIntoEditor(canvas);
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
      corners = detected || Scanner.defaultCorners(w, h);
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
    corners = detected || Scanner.defaultCorners(w, h);
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
  }

  function handleDragEnd() { dragIndex = -1; }

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
