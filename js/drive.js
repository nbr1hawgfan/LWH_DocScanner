// LWH Driver Scan - Google Drive Backup (via Apps Script relay)
// No driver ever signs into Google. The PDF is POSTed to a Web App you
// deploy under your own account (see apps-script/Code.gs); it saves the
// file into the shared folder server-side. This is the same relay pattern
// used elsewhere (e.g. the Samsara token relay) — a PIN gate stands in for
// per-user auth on an "Anyone" access Web App.

const DriveModule = (() => {
  const PIN_STORAGE_KEY = "lwh-driver-scan-drive-pin";

  function getStoredPin() {
    try { return localStorage.getItem(PIN_STORAGE_KEY) || ""; }
    catch (e) { return ""; }
  }

  function storePin(pin) {
    try { localStorage.setItem(PIN_STORAGE_KEY, pin); }
    catch (e) { /* private browsing etc. — just won't persist between scans */ }
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result.split(",")[1]);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  async function backup(pages, filename, buttonEl) {
    if (pages.length === 0) return;

    if (!CONFIG.APPS_SCRIPT_URL || CONFIG.APPS_SCRIPT_URL.includes("PASTE_")) {
      alert("Drive backup isn't set up yet — the Apps Script relay URL still needs to be added in config.js.");
      return;
    }

    let pin = getStoredPin();
    if (CONFIG.REQUIRE_PIN && !pin) {
      pin = prompt("Enter your Drive backup PIN:") || "";
      if (!pin) return;
    }

    const originalLabel = buttonEl.textContent;
    buttonEl.disabled = true;
    buttonEl.textContent = "Uploading…";

    try {
      const name = PdfExport.sanitizeFilename(filename);
      const blob = PdfExport.buildBlob(pages);
      const pdfBase64 = await blobToBase64(blob);

      const res = await fetch(CONFIG.APPS_SCRIPT_URL, {
        method: "POST",
        // text/plain avoids a CORS preflight (Apps Script Web Apps don't
        // handle OPTIONS preflight requests) — doPost() still parses the
        // body as JSON fine regardless of the declared content type.
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ pdfBase64, filename: name, pin })
      });

      const result = await res.json();

      if (!result.success) {
        throw new Error(result.error || "Unknown error from Drive relay.");
      }

      if (CONFIG.REQUIRE_PIN) storePin(pin);

      buttonEl.textContent = "Saved to Drive ✓";
      console.log("Uploaded to Drive:", result.url);
      setTimeout(() => { buttonEl.textContent = originalLabel; buttonEl.disabled = false; }, 2500);
    } catch (err) {
      console.error(err);
      // Note: if this is a CORS/network read error rather than a real
      // failure, the file may have still been created server-side (Apps
      // Script processes the request before the browser tries to read the
      // response). Worth checking the Drive folder before assuming data loss.
      alert("Couldn't back this up to Drive. It's still on your phone — you can share or download it, and try Drive again once you have signal.");
      buttonEl.textContent = originalLabel;
      buttonEl.disabled = false;
    }
  }

  return { backup };
})();
