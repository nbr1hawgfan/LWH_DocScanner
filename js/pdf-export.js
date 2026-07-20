// LWH Driver Scan - PDF Assembly
// Turns the array of scanned page canvases into a single multi-page PDF,
// one page per document, each scaled to fit an 8.5x11 sheet with a small margin.

const PdfExport = (() => {
  function buildPdf(pages) {
    const { jsPDF } = window.jspdf;
    const pageW = CONFIG.PDF_PAGE_WIDTH_IN;
    const pageH = CONFIG.PDF_PAGE_HEIGHT_IN;
    const margin = 0.25;

    const doc = new jsPDF({ unit: "in", format: [pageW, pageH] });

    pages.forEach((page, i) => {
      if (i > 0) doc.addPage([pageW, pageH]);

      const usableW = pageW - margin * 2;
      const usableH = pageH - margin * 2;
      const imgRatio = page.canvas.width / page.canvas.height;
      const boxRatio = usableW / usableH;

      let drawW, drawH;
      if (imgRatio > boxRatio) {
        drawW = usableW;
        drawH = usableW / imgRatio;
      } else {
        drawH = usableH;
        drawW = usableH * imgRatio;
      }
      const x = (pageW - drawW) / 2;
      const y = (pageH - drawH) / 2;

      const dataUrl = page.canvas.toDataURL("image/jpeg", 0.92);
      doc.addImage(dataUrl, "JPEG", x, y, drawW, drawH);
    });

    return doc;
  }

  function buildBlob(pages) {
    return buildPdf(pages).output("blob");
  }

  function sanitizeFilename(name) {
    const trimmed = (name || "Scan").trim().replace(/[^a-z0-9\-_ ]/gi, "").replace(/\s+/g, "_");
    return (trimmed || "Scan") + ".pdf";
  }

  return { buildPdf, buildBlob, sanitizeFilename };
})();
