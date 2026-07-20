// LWH Driver Scan - Google Drive Backup
// Uses Google Identity Services (GIS) token client for a lightweight OAuth
// popup — no server, no stored credentials on the device. Scope is limited
// to drive.file, so this app can only see/manage files it creates itself.
//
// Requires CONFIG.GOOGLE_CLIENT_ID to be set (see js/config.js) and
// CONFIG.DRIVE_BACKUP_ENABLED = true before the button appears.

const DriveModule = (() => {
  let tokenClient = null;
  let accessToken = null;

  function ensureTokenClient() {
    if (tokenClient || !window.google || !google.accounts) return;
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CONFIG.GOOGLE_CLIENT_ID,
      scope: CONFIG.GOOGLE_DRIVE_SCOPE,
      callback: () => {} // overridden per-request below
    });
  }

  function getAccessToken() {
    return new Promise((resolve, reject) => {
      ensureTokenClient();
      if (!tokenClient) {
        reject(new Error("Google Identity Services hasn't loaded yet. Check your connection and try again."));
        return;
      }
      tokenClient.callback = (resp) => {
        if (resp.error) { reject(resp); return; }
        accessToken = resp.access_token;
        resolve(accessToken);
      };
      tokenClient.requestAccessToken({ prompt: accessToken ? "" : "consent" });
    });
  }

  async function backup(pages, filename, buttonEl) {
    if (pages.length === 0) return;
    const originalLabel = buttonEl.textContent;
    buttonEl.disabled = true;
    buttonEl.textContent = "Signing in\u2026";

    try {
      const token = await getAccessToken();
      buttonEl.textContent = "Uploading\u2026";

      const name = PdfExport.sanitizeFilename(filename);
      const blob = PdfExport.buildBlob(pages);

      const metadata = {
        name,
        parents: [CONFIG.DRIVE_FOLDER_ID],
        mimeType: "application/pdf"
      };

      const form = new FormData();
      form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
      form.append("file", blob);

      const res = await fetch(
        "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink",
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: form
        }
      );

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Drive upload failed: ${res.status} ${errText}`);
      }

      const result = await res.json();
      buttonEl.textContent = "Saved to Drive \u2713";
      console.log("Uploaded to Drive:", result.webViewLink);
      setTimeout(() => { buttonEl.textContent = originalLabel; buttonEl.disabled = false; }, 2500);
    } catch (err) {
      console.error(err);
      alert("Couldn't back this up to Drive. It's still on your phone \u2014 you can share or download it, and try Drive again once you have signal.");
      buttonEl.textContent = originalLabel;
      buttonEl.disabled = false;
    }
  }

  return { backup };
})();
