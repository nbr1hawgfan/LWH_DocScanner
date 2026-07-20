/**
 * LWH Driver Scan — Drive Backup Relay
 *
 * Deploy this as a standalone Apps Script Web App (script.google.com/create).
 * It receives a base64-encoded PDF from the PWA and saves it into a fixed
 * Drive folder, running under YOUR Google account — drivers never sign into
 * anything. Same pattern as your other GAS projects (PTO portal, HR reports,
 * etc.), just with a single doPost endpoint instead of a UI.
 *
 * DEPLOY STEPS:
 * 1. script.google.com/create -> paste this in, replace Code.gs entirely.
 * 2. Update FOLDER_ID below if it ever changes (already set to the folder
 *    you shared).
 * 3. Deploy -> New deployment -> type: Web app.
 *      - Execute as: Me
 *      - Who has access: Anyone
 *    (NOT "Anyone with Google account" — that would bring back the sign-in
 *    requirement this whole rewrite is meant to avoid.)
 * 4. Copy the Web app URL it gives you (ends in /exec).
 * 5. Paste that URL into js/config.js as APPS_SCRIPT_URL, and set
 *    DRIVE_BACKUP_ENABLED to true.
 * 6. Optional but recommended: set SHARED_PIN below to a short PIN and give
 *    it to drivers, so a stranger who finds this URL can't spam your Drive
 *    folder. The app will prompt for it once and remember it on that phone.
 */

const FOLDER_ID = "1ofdsEsllKtiJ_y1N5nuXIb1Unw0ZjXYG";

// Optional shared PIN — leave blank ("") to disable this check entirely.
const SHARED_PIN = "";

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    if (SHARED_PIN && data.pin !== SHARED_PIN) {
      return jsonOutput({ success: false, error: "Incorrect PIN." });
    }

    if (!data.pdfBase64 || !data.filename) {
      return jsonOutput({ success: false, error: "Missing PDF data or filename." });
    }

    const folder = DriveApp.getFolderById(FOLDER_ID);
    const bytes = Utilities.base64Decode(data.pdfBase64);
    const blob = Utilities.newBlob(bytes, "application/pdf", data.filename);
    const file = folder.createFile(blob);

    return jsonOutput({ success: true, fileId: file.getId(), url: file.getUrl() });
  } catch (err) {
    return jsonOutput({ success: false, error: err.message });
  }
}

function jsonOutput(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// Lets you sanity-check the deployment is live by opening the /exec URL
// directly in a browser (GET), separate from the driver-facing POST flow.
function doGet() {
  return ContentService.createTextOutput("LWH Driver Scan relay is running.");
}
