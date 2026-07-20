// LWH Driver Scan - Configuration
// Everything a driver-facing setting lives here so it's easy to find and change.

const CONFIG = {
  // --- Google Drive backup ---
  // Set to true once APPS_SCRIPT_URL below is filled in. Until then, the
  // "Back up to Drive" button stays hidden and drivers just get email share.
  DRIVE_BACKUP_ENABLED: false,

  // Web App URL from deploying apps-script/Code.gs (ends in /exec).
  // No driver ever signs into Google — this relay runs under your account
  // and saves into the shared folder server-side. See apps-script/Code.gs
  // for full deploy steps.
  APPS_SCRIPT_URL: "PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE",

  // If true, drivers are prompted once for a PIN (set server-side in
  // Code.gs's SHARED_PIN) before their first backup, then it's remembered
  // on that phone. Since the Apps Script deployment has to be set to
  // "Anyone" access to avoid requiring a Google sign-in, this is what keeps
  // a stranger who stumbles on the URL from spamming the Drive folder.
  // Leave both this and Code.gs's SHARED_PIN blank/false to skip entirely.
  REQUIRE_PIN: false,

  // Folder ID pulled from:
  // https://drive.google.com/drive/folders/1ofdsEsllKtiJ_y1N5nuXIb1Unw0ZjXYG
  // (Reference only — the actual folder ID used at upload time lives in
  // apps-script/Code.gs's FOLDER_ID, since the relay decides where files go.)
  DRIVE_FOLDER_ID: "1ofdsEsllKtiJ_y1N5nuXIb1Unw0ZjXYG",

  // --- PDF output ---
  PDF_PAGE_WIDTH_IN: 8.5,
  PDF_PAGE_HEIGHT_IN: 11,

  // --- Branding ---
  BRAND_NAME: "LWH Document Scan",
  BRAND_TEAL: "#0e6e8c",
  BRAND_TEAL_DARK: "#0a4f66",
  BRAND_TEAL_LIGHT: "#17a2bf"
};
