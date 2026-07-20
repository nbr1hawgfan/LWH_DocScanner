# LWH Driver Scan

Standalone PWA for drivers to scan documents (BOLs, PODs, etc.), auto-crop
them, and send them out — no toolkit navigation, just the scanner.

## What it does

1. **Camera capture** with a live-detection overlay, or "Choose Photo" to
   pick an existing image.
2. **Live auto-detect + auto-capture** — while the camera preview is running,
   it checks for a document a couple times a second and outlines it live. If
   that outline holds steady (same position and size) for several
   consecutive checks, it captures on its own — no tap needed. Tapping the
   shutter always works too, any time.
3. **Corner refinement** — after capture, a fuller detection pass runs on
   the full-resolution photo and shows draggable corner handles (with a
   zoomed loupe while dragging, for precision) in case the live pass wasn't
   exact.
4. **Perspective warp** — straightens the document flat regardless of the
   camera angle.
5. **Filters** — Original / B&W / Sharpen, same as the toolkit's Doc Scanner.
6. **Multi-page** — add pages, remove pages, reorder isn't included yet (single
   BOL scans are usually in order as shot; can add if it comes up).
7. **Share** — `navigator.share()` hands the finished PDF straight to the
   Android share sheet (Gmail, Outlook, Messages, whatever's installed) with
   the file already attached. Falls back to a plain download on browsers
   that don't support file sharing (mainly iOS Safari).
8. **Drive backup** — optional, off by default until configured (see below).
   No driver sign-in required.

## Hosting

Same pattern as the Warehouse Toolkit — push this folder to a GitHub Pages
repo. It's fully self-contained (no build step, no npm install needed to
deploy — the only third-party code is loaded from CDNs at runtime):

- `jsPDF` — PDF assembly
- `OpenCV.js` — edge detection & perspective warp

The service worker caches the OpenCV.js WASM file (~8 MB) the first time it
loads, so after that first load it works offline in a truck with no signal.
(Drive backup itself still needs a connection — it's a plain POST to your
Apps Script relay, not something the service worker caches or queues.)

## Turning on Google Drive backup

Rebuilt in v1.3.0 to match your GAS projects' pattern — drivers never sign
into Google. The PWA POSTs the finished PDF to an Apps Script Web App
deployed under your own account, which saves it into the shared folder
server-side. No Gmail account needed on the driver's phone, no per-driver
OAuth consent, no folder-sharing per person.

1. Go to [script.google.com/create](https://script.google.com/create) to
   start a new standalone script.
2. Paste in the contents of `apps-script/Code.gs` from this repo, replacing
   whatever's there by default.
3. The folder ID is already set to the one you shared
   (`1ofdsEsllKtiJ_y1N5nuXIb1Unw0ZjXYG`). Change `FOLDER_ID` in the script if
   that ever changes.
4. **Deploy → New deployment → type: Web app.**
   - Execute as: **Me**
   - Who has access: **Anyone** (not "Anyone with Google account" — that
     would bring the sign-in requirement right back)
5. Copy the Web app URL (ends in `/exec`).
6. Paste that URL into `js/config.js` as `APPS_SCRIPT_URL`, and set
   `DRIVE_BACKUP_ENABLED` to `true`.
7. Optional: since "Anyone" access means anyone with the URL could technically
   POST to it, set `SHARED_PIN` in `Code.gs` to a short PIN and set
   `REQUIRE_PIN: true` in `config.js`. Drivers get prompted once per phone,
   then it's remembered locally — same shape as the Samsara relay's PIN gate.

That's it — no Google Cloud project, no OAuth client, no test users, no
per-driver folder sharing.

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

v1.4.0 — larger, consistently-sized page previews after capture (previously shrank as more pages were added), tap-to-zoom full-screen viewer on any page, and a "Preview Full PDF" step on the final screen so drivers (especially those wanting a closer look) can verify legibility before sending to dispatch or Drive. July 2026.

v1.3.0 — Drive backup rebuilt as an Apps Script relay (no driver Google sign-in required, matching the existing GAS project pattern) since not all drivers have Gmail accounts. Added live edge detection with auto-capture in the camera preview itself, not just after the shutter. Fixed corner-selection logic that could pick a large-but-wrong shape (shadow, tabletop) over the actual document, which was the likely cause of skewed results even in good lighting. July 2026.

v1.2.0 — auto-detect now uses brightness/contrast thresholding as the primary method (Canny as backup), which holds up much better against cluttered real-world backgrounds like a truck cab than edge detection alone. Added a magnifier loupe while dragging corners for precise placement, since the perspective warp is sensitive to corner accuracy in a way the old simple crop wasn't. July 2026.

v1.1.0 — camera reliability fixes (permission/error states, rear-camera fallback), layout fix for controls overlapping the frame guide, and multi-pass edge detection with a minimum-area-rect fallback for stronger auto-crop. July 2026.

v1.0.0 — initial standalone build, July 2026.
