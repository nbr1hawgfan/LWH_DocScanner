// LWH Driver Scan - Scanner Engine
// Auto-detects the four corners of a document in a photo using OpenCV.js,
// then lets the driver drag them if the auto-detect got it wrong, then
// warps/crops to a flat rectangle. All on-device, nothing leaves the phone
// until the driver chooses to share or back up.

const Scanner = (() => {
  let cvReady = false;
  const readyCallbacks = [];

  function markReady() {
    if (cvReady) return;
    cvReady = true;
    readyCallbacks.forEach((cb) => cb());
    readyCallbacks.length = 0;
  }

  // Primary signal: the "opencv-ready" event dispatched from
  // Module.onRuntimeInitialized in index.html (fires once WASM is actually
  // usable, not just once the script file has downloaded).
  window.addEventListener("opencv-ready", markReady);

  // Fallback in case the event fired before this listener attached (e.g. on
  // a very fast repeat load from cache) — poll briefly for cv.Mat.
  if (!cvReady) {
    let attempts = 0;
    const poll = setInterval(() => {
      attempts++;
      if (window.cv && cv.Mat) {
        clearInterval(poll);
        markReady();
      } else if (attempts > 200) {
        clearInterval(poll); // ~20s, give up polling; event listener still active
      }
    }, 100);
  }

  function whenReady(cb) {
    if (cvReady && window.cv && cv.Mat) cb();
    else readyCallbacks.push(cb);
  }

  /**
   * Finds the four corners of the most likely document in the image.
   * Returns points in image pixel coordinates, ordered
   * [top-left, top-right, bottom-right, bottom-left], or null if nothing
   * confident was found (caller should fall back to a default inset box).
   */
  function detectCorners(imgElement) {
    if (!window.cv || !cv.Mat) return null;

    const src = cv.imread(imgElement);
    const gray = new cv.Mat();
    const blurred = new cv.Mat();
    const edged = new cv.Mat();
    const contours = new cv.MatVector();
    const hierarchy = new cv.Mat();

    let best = null;

    try {
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
      cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);

      // Canny edge detection handles varying dock/truck-cab lighting better
      // than a flat threshold.
      cv.Canny(blurred, edged, 60, 160);

      const kernel = cv.Mat.ones(5, 5, cv.CV_8U);
      cv.dilate(edged, edged, kernel);
      kernel.delete();

      cv.findContours(edged, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

      const imgArea = src.rows * src.cols;
      let bestArea = 0;

      for (let i = 0; i < contours.size(); i++) {
        const contour = contours.get(i);
        const peri = cv.arcLength(contour, true);
        const approx = new cv.Mat();
        cv.approxPolyDP(contour, approx, 0.02 * peri, true);

        if (approx.rows === 4) {
          const area = Math.abs(cv.contourArea(approx));
          // Document should be a meaningful chunk of the frame but not the
          // entire frame (that's usually the photo border, not the paper).
          if (area > imgArea * 0.15 && area > bestArea) {
            bestArea = area;
            if (best) best.delete();
            best = approx.clone();
          }
        }
        approx.delete();
        contour.delete();
      }

      if (best) {
        const pts = [];
        for (let i = 0; i < 4; i++) {
          pts.push({ x: best.data32S[i * 2], y: best.data32S[i * 2 + 1] });
        }
        best.delete();
        return orderCorners(pts);
      }
      return null;
    } finally {
      src.delete();
      gray.delete();
      blurred.delete();
      edged.delete();
      contours.delete();
      hierarchy.delete();
    }
  }

  // Sorts 4 arbitrary points into [TL, TR, BR, BL] so warp math is consistent
  // regardless of what order OpenCV's contour returned them in.
  function orderCorners(pts) {
    const sum = pts.map((p) => p.x + p.y);
    const diff = pts.map((p) => p.x - p.y);
    const tl = pts[sum.indexOf(Math.min(...sum))];
    const br = pts[sum.indexOf(Math.max(...sum))];
    const tr = pts[diff.indexOf(Math.max(...diff))];
    const bl = pts[diff.indexOf(Math.min(...diff))];
    return [tl, tr, br, bl];
  }

  // Default corners when auto-detect can't find a confident quadrilateral —
  // a modest inset so the driver isn't starting from the raw photo edges.
  function defaultCorners(width, height) {
    const insetX = width * 0.08;
    const insetY = height * 0.08;
    return [
      { x: insetX, y: insetY },
      { x: width - insetX, y: insetY },
      { x: width - insetX, y: height - insetY },
      { x: insetX, y: height - insetY }
    ];
  }

  /**
   * Warps the quadrilateral defined by `corners` (image pixel coords, TL/TR/BR/BL)
   * into a flat rectangular canvas, sized proportionally to the longer detected
   * edge so portrait and landscape documents both come out undistorted.
   */
  function warpToCanvas(imgElement, corners) {
    const src = cv.imread(imgElement);

    const widthTop = dist(corners[0], corners[1]);
    const widthBottom = dist(corners[3], corners[2]);
    const heightLeft = dist(corners[0], corners[3]);
    const heightRight = dist(corners[1], corners[2]);

    const outWidth = Math.round(Math.max(widthTop, widthBottom));
    const outHeight = Math.round(Math.max(heightLeft, heightRight));

    const srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
      corners[0].x, corners[0].y,
      corners[1].x, corners[1].y,
      corners[2].x, corners[2].y,
      corners[3].x, corners[3].y
    ]);
    const dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
      0, 0,
      outWidth, 0,
      outWidth, outHeight,
      0, outHeight
    ]);

    const M = cv.getPerspectiveTransform(srcTri, dstTri);
    const dst = new cv.Mat();
    cv.warpPerspective(src, dst, M, new cv.Size(outWidth, outHeight), cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar());

    const canvas = document.createElement("canvas");
    canvas.width = outWidth;
    canvas.height = outHeight;
    cv.imshow(canvas, dst);

    src.delete(); dst.delete(); M.delete(); srcTri.delete(); dstTri.delete();
    return canvas;
  }

  function dist(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  // Filters applied after warp, on a plain canvas (no OpenCV needed here,
  // keeps this fast and independent of the WASM module).
  function applyFilter(canvas, mode) {
    if (mode === "original") return canvas;

    const ctx = canvas.getContext("2d");
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = imgData.data;

    if (mode === "bw") {
      for (let i = 0; i < d.length; i += 4) {
        // Luminance-weighted grayscale, then a gentle contrast push so
        // faded thermal-print BOLs stay legible.
        const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        const contrasted = Math.min(255, Math.max(0, (gray - 128) * 1.35 + 128));
        d[i] = d[i + 1] = d[i + 2] = contrasted;
      }
    } else if (mode === "sharpen") {
      // Simple contrast + saturation lift; keeps color but crisps up text.
      for (let i = 0; i < d.length; i += 4) {
        for (let c = 0; c < 3; c++) {
          d[i + c] = Math.min(255, Math.max(0, (d[i + c] - 128) * 1.2 + 128));
        }
      }
    }

    ctx.putImageData(imgData, 0, 0);
    return canvas;
  }

  return { whenReady, detectCorners, defaultCorners, warpToCanvas, applyFilter, orderCorners };
})();
