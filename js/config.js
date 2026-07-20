// LWH Driver Scan - Configuration
// Everything a driver-facing setting lives here so it's easy to find and change.

const CONFIG = {
  // --- Google Drive backup ---
  // Set to true once GOOGLE_CLIENT_ID below is filled in. Until then, the
  // "Back up to Drive" button stays hidden and drivers just get email share.
  DRIVE_BACKUP_ENABLED: false,

  // OAuth 2.0 Client ID (Web application type) from Google Cloud Console.
  // Steps: console.cloud.google.com -> APIs & Services -> Credentials ->
  // Create Credentials -> OAuth client ID -> Web application ->
  // Authorized JavaScript origins: add https://nbr1hawgfan.github.io (or
  // wherever this ends up hosted). Also enable the "Google Drive API" under
  // Library first, or the token request will fail.
  GOOGLE_CLIENT_ID: "YOUR_CLIENT_ID.apps.googleusercontent.com",

  // Narrow scope on purpose: this only lets the app see/create files IT
  // creates, not a driver's whole Drive. No admin review headaches.
  GOOGLE_DRIVE_SCOPE: "https://www.googleapis.com/auth/drive.file",

  // Folder ID pulled from:
  // https://drive.google.com/drive/folders/1ofdsEsllKtiJ_y1N5nuXIb1Unw0ZjXYG
  DRIVE_FOLDER_ID: "1ofdsEsllKtiJ_y1N5nuXIb1Unw0ZjXYG",

  // --- PDF output ---
  PDF_PAGE_WIDTH_IN: 8.5,
  PDF_PAGE_HEIGHT_IN: 11,

  // --- Branding ---
  BRAND_NAME: "LWH Driver Scan",
  BRAND_MAROON: "#7d1935",
  BRAND_MAROON_DARK: "#5c1226",
  BRAND_MAROON_LIGHT: "#a8214a"
};
