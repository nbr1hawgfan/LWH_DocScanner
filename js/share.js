// LWH Driver Scan - Share & Download
// On Android, navigator.share() with a File hands the PDF straight to the
// native share sheet (Gmail, Outlook, Messages, etc.) with the file already
// attached. On browsers that don't support file sharing (notably iOS Safari
// in most versions), we fall back to a plain download the driver can attach
// manually.

const ShareModule = (() => {
  async function sharePdf(pages, filename) {
    if (pages.length === 0) return;
    const name = PdfExport.sanitizeFilename(filename);
    const blob = PdfExport.buildBlob(pages);
    const file = new File([blob], name, { type: "application/pdf" });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({
          files: [file],
          title: name,
          text: `Scanned document: ${name}`
        });
        return;
      } catch (err) {
        // User cancelled the share sheet — not an error worth surfacing.
        if (err.name === "AbortError") return;
        console.error("Share failed, falling back to download", err);
      }
    }

    alert("Your browser can't hand this straight to Mail, so it'll download instead \u2014 attach it from your Downloads or Files app.");
    downloadPdf(pages, filename);
  }

  function downloadPdf(pages, filename) {
    if (pages.length === 0) return;
    const name = PdfExport.sanitizeFilename(filename);
    const doc = PdfExport.buildPdf(pages);
    doc.save(name);
  }

  return { sharePdf, downloadPdf };
})();
