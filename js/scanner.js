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

  function isReady() {
    return cvReady && !!window.cv && !!cv.Mat;
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

    let bestContour = null; // owning Mat we're responsible for deleting
    let bestArea = 0;

    try {
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
      cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);

      const imgArea = src.rows * src.cols;

      // Primary method: brightness-contrast thresholding. A document is
      // almost always noticeably lighter (or occasionally darker) than what
      // it's sitting on — a dashboard, a seat, a clipboard — which holds up
      // far better in a cluttered truck cab than edge-based detection does.
      // We try both polarities since we don't know if the page is the light
      // or dark region until we look.
      for (const invert of [false, true]) {
        const found = findLargestThresholdCandidate(gray, imgArea, invert);
        if (found && found.area > bestArea) {
          if (bestContour) bestContour.delete();
          bestContour = found.contour;
          bestArea = found.area;
        } else if (found) {
          found.contour.delete();
        }
      }

      // Secondary method: Canny edge detection, which catches cases the
      // threshold method misses — mainly uneven/harsh lighting where there
      // isn't one clean brightness boundary.
      const thresholdPairs = [
        [60, 160],
        [30, 90],
        [90, 200]
      ];

      for (const [low, high] of thresholdPairs) {
        const found = findLargestQuadCandidate(gray, blurred, low, high, imgArea);
        if (found && found.area > bestArea) {
          if (bestContour) bestContour.delete();
          bestContour = found.contour;
          bestArea = found.area;
        } else if (found) {
          found.contour.delete();
        }
      }

      if (!bestContour) return null;

      // First choice: a clean 4-point polygon approximation of the winning
      // contour, tried at a couple of tolerance levels.
      for (const epsilonFactor of [0.02, 0.035, 0.05]) {
        const peri = cv.arcLength(bestContour, true);
        const approx = new cv.Mat();
        cv.approxPolyDP(bestContour, approx, epsilonFactor * peri, true);
        if (approx.rows === 4) {
          const pts = [];
          for (let i = 0; i < 4; i++) {
            pts.push({ x: approx.data32S[i * 2], y: approx.data32S[i * 2 + 1] });
          }
          approx.delete();
          bestContour.delete();
          return orderCorners(pts);
        }
        approx.delete();
      }

      // Fallback: the contour didn't simplify cleanly to 4 points (rounded
      // corners, a bit of noise on the edge) — take its minimum-area
      // bounding rectangle instead. Still gives a real, angled quad rather
      // than forcing a manual crop.
      const rotatedRect = cv.minAreaRect(bestContour);
      bestContour.delete();
      const pts = rotatedRectToPoints(rotatedRect);
      return orderCorners(pts);
    } finally {
      src.delete();
      gray.delete();
      blurred.delete();
    }
  }

  // Rejects candidates that are merely large without being roughly
  // rectangular — a shadow, a reflection, or the tabletop itself can easily
  // out-size the actual document, and previously "largest area wins" would
  // pick those and warp to their (wrong) shape. Comparing the contour's area
  // to its own bounding box's area catches this cheaply: a real document
  // fills most of its bounding box; an irregular blob doesn't.
  function isRectangleLike(contour, area) {
    const rect = cv.boundingRect(contour);
    const boxArea = rect.width * rect.height;
    if (boxArea === 0) return false;
    const extent = area / boxArea;
    return extent > 0.55;
  }

  // Runs Otsu auto-thresholding + contour finding, looking for one dominant
  // light (or dark, if invert=true) rectangular region — the document.
  function findLargestThresholdCandidate(gray, imgArea, invert) {
    const thresh = new cv.Mat();
    const contours = new cv.MatVector();
    const hierarchy = new cv.Mat();
    let winner = null;
    let winnerArea = 0;

    try {
      const flags = cv.THRESH_OTSU | (invert ? cv.THRESH_BINARY_INV : cv.THRESH_BINARY);
      cv.threshold(gray, thresh, 0, 255, flags);

      // Close small gaps (text, staples, stains) so the document reads as
      // one solid connected region rather than a speckled mess. Kept fairly
      // small so the closed shape doesn't bulge noticeably past the real
      // paper edge, which was quietly introducing skew even in good light.
      const kernel = cv.Mat.ones(5, 5, cv.CV_8U);
      cv.morphologyEx(thresh, thresh, cv.MORPH_CLOSE, kernel);
      kernel.delete();

      cv.findContours(thresh, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

      for (let i = 0; i < contours.size(); i++) {
        const contour = contours.get(i);
        const area = Math.abs(cv.contourArea(contour));
        if (area > imgArea * 0.1 && area < imgArea * 0.98 && area > winnerArea && isRectangleLike(contour, area)) {
          if (winner) winner.delete();
          winner = contour.clone();
          winnerArea = area;
        }
        contour.delete();
      }
    } finally {
      thresh.delete();
      contours.delete();
      hierarchy.delete();
    }

    return winner ? { contour: winner, area: winnerArea } : null;
  }

  // Runs edge detection + contour finding for one threshold pair and returns
  // the largest contour that clears the minimum-area bar (not necessarily a
  // clean quad yet — that's resolved by the caller).
  function findLargestQuadCandidate(gray, blurred, low, high, imgArea) {
    const edged = new cv.Mat();
    const contours = new cv.MatVector();
    const hierarchy = new cv.Mat();
    let winner = null;
    let winnerArea = 0;

    try {
      cv.Canny(blurred, edged, low, high);
      const kernel = cv.Mat.ones(5, 5, cv.CV_8U);
      cv.dilate(edged, edged, kernel);
      kernel.delete();

      cv.findContours(edged, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

      for (let i = 0; i < contours.size(); i++) {
        const contour = contours.get(i);
        const area = Math.abs(cv.contourArea(contour));
        // Meaningful chunk of the frame, but not the whole frame (that's
        // usually the photo border/background, not the paper).
        if (area > imgArea * 0.1 && area < imgArea * 0.98 && area > winnerArea && isRectangleLike(contour, area)) {
          if (winner) winner.delete();
          winner = contour.clone();
          winnerArea = area;
        }
        contour.delete();
      }
    } finally {
      edged.delete();
      contours.delete();
      hierarchy.delete();
    }

    return winner ? { contour: winner, area: winnerArea } : null;
  }

  // Converts an OpenCV RotatedRect (center/size/angle) into its four corner
  // points — the same math as cv2.boxPoints(), which isn't exposed directly
  // in opencv.js.
  function rotatedRectToPoints(rect) {
    const angleRad = (rect.angle * Math.PI) / 180;
    const b = Math.cos(angleRad) * 0.5;
    const a = Math.sin(angleRad) * 0.5;
    const cx = rect.center.x, cy = rect.center.y;
    const w = rect.size.width, h = rect.size.height;

    const p0 = { x: cx - a * h - b * w, y: cy + b * h - a * w };
    const p1 = { x: cx + a * h - b * w, y: cy - b * h - a * w };
    const p2 = { x: 2 * cx - p0.x, y: 2 * cy - p0.y };
    const p3 = { x: 2 * cx - p1.x, y: 2 * cy - p1.y };
    return [p0, p1, p2, p3];
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

  // The minAreaRect fallback can extend a few pixels past the actual image
  // (it's a bounding rect, not a clipped one) — pull points back on-frame so
  // drag handles never start off-canvas.
  function clampCorners(pts, width, height) {
    return pts.map((p) => ({
      x: Math.min(Math.max(p.x, 0), width),
      y: Math.min(Math.max(p.y, 0), height)
    }));
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

  return { whenReady, isReady, detectCorners, defaultCorners, warpToCanvas, applyFilter, orderCorners, clampCorners };
})();
