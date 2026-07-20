# LWH Driver Scan

Standalone PWA for drivers to scan documents (BOLs, PODs, etc.), auto-crop
them, and send them out — no toolkit navigation, just the scanner.

## What it does

1. **Camera capture** with a framing guide, or "Choose Photo" to pick an
   existing image.
2. **Auto edge detection** — OpenCV.js finds the document's four corners on
   its own (grayscale → blur → Canny edges → contour detection → largest
   4-point shape). The corners are shown as draggable handles so a driver can
   nudge them if lighting or glare threw off the auto-detect. This replaces
   the old fully-manual drag-from-scratch crop.
3. **Perspective warp** — straightens the document flat regardless of the
   camera angle.
4. **Filters** — Original / B&W / Sharpen, same as the toolkit's Doc Scanner.
5. **Multi-page** — add pages, remove pages, reorder isn't included yet (single
   BOL scans are usually in order as shot; can add if it comes up).
6. **Share** — `navigator.share()` hands the finished PDF straight to the
   Android share sheet (Gmail, Outlook, Messages, whatever's installed) with
   the file already attached. Falls back to a plain download on browsers
   that don't support file sharing (mainly iOS Safari).
7. **Drive backup** — optional, off by default until configured (see below).

## Hosting

Same pattern as the Warehouse Toolkit — push this folder to a GitHub Pages
repo. It's fully self-contained (no build step, no npm install needed to
deploy — the only third-party code is loaded from CDNs at runtime):

- `jsPDF` — PDF assembly
- `OpenCV.js` — edge detection & perspective warp
- Google Identity Services — Drive sign-in (only loads/matters if Drive
  backup is turned on)

The service worker caches the OpenCV.js WASM file (~8 MB) the first time it
loads, so after that first load it works offline in a truck with no signal.

## Turning on Google Drive backup

This is the one piece that needs your action — I can't create a Google Cloud
OAuth client for you. Takes about 10 minutes:

1. Go to [console.cloud.google.com](https://console.cloud.google.com) →
   create or select a project.
2. **APIs & Services → Library** → search "Google Drive API" → **Enable**.
3. **APIs & Services → Credentials** → **Create Credentials** → **OAuth
   client ID** → Application type: **Web application**.
4. Under **Authorized JavaScript origins**, add the exact URL this app is
   hosted at (e.g. `https://nbr1hawgfan.github.io` — origin only, no path).
5. Copy the generated Client ID.
6. Open `js/config.js`, paste it into `GOOGLE_CLIENT_ID`, and flip
   `DRIVE_BACKUP_ENABLED` to `true`.
7. First time each driver taps "Back Up to Drive," they'll see a Google
   sign-in popup and a consent screen. If the project is still in "Testing"
   publishing status in Google Cloud, you'll need to add each driver's
   Google account under **OAuth consent screen → Test users**, or publish
   the app (Drive-scope apps need Google's verification review to publish
   for external users — for a handful of named drivers, Testing mode with
   test users added is the simpler path and doesn't require review).

The Drive folder is already wired to the one you shared:
`DRIVE_FOLDER_ID: "1ofdsEsllKtiJ_y1N5nuXIb1Unw0ZjXYG"` in `js/config.js`.
The scope requested (`drive.file`) only lets the app see files it creates —
not a driver's whole Drive.

## Notes for real-world testing

- Test the auto-detect on an actual BOL in a truck cab before rolling out —
  dashboard glare and dim dome lights are the two conditions most likely to
  trip up detection. When it can't find a confident edge, it falls back to
  an inset box and tells the driver to drag corners manually, so it never
  silently produces a bad crop.
- "Re-scan Edges" button re-runs detection without retaking the photo, in
  case the first pass focused on the wrong contour (e.g. a clipboard edge
  instead of the paper).
- One non-Android driver: the scan/crop/PDF flow all works the same in iOS
  Safari; only the one-tap email share degrades to a manual download+attach.

## Version

v1.2.0 — auto-detect now uses brightness/contrast thresholding as the primary method (Canny as backup), which holds up much better against cluttered real-world backgrounds like a truck cab than edge detection alone. Added a magnifier loupe while dragging corners for precise placement, since the perspective warp is sensitive to corner accuracy in a way the old simple crop wasn't. July 2026.

v1.1.0 — camera reliability fixes (permission/error states, rear-camera fallback), layout fix for controls overlapping the frame guide, and multi-pass edge detection with a minimum-area-rect fallback for stronger auto-crop. July 2026.

v1.0.0 — initial standalone build, July 2026.
