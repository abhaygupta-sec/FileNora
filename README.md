# Dockora

**Every file, one place.**

Free PDF & file tools that run entirely in your browser. No sign-up, no upload, no watermark. Your files never leave your device.

## What it does (v1)

- **Upload** — drag-and-drop or file picker. PDF, JPG, PNG, WebP, DOCX, TXT. Multiple files at once, up to 50 MB per file.
- **Preview** — every PDF page (via PDF.js), images directly, TXT and DOCX as extracted text.
- **Merge PDF** — when 2+ files are added you are asked "Separate or merge?". Merge lets you reorder files (drag, or Up / Down buttons) before merging into one PDF.
- **Split PDF** — tick the pages to keep, or type a page range like "1-3, 5", extract them into a new PDF.
- **Compress to an exact size** — presets 50 KB, 100 KB, 150 KB, 200 KB, 250 KB, 300 KB, 500 KB, 1 MB, plus a custom KB value. Images are re-encoded at lower quality / size; PDFs are re-rendered at lower quality. The real final size is always shown, and if the target cannot be reached it says so plainly.
- **Convert** — images to PDF, PDF pages to JPG/PNG, TXT to PDF, DOCX to PDF, PDF to TXT, and image to image (JPG/PNG/WebP).
- **Edit PDF** — open a PDF page, drag a white rectangle over a word to cover it (whiteout), or click a spot and add new text with a size and colour you choose. Font matching is best-effort: the page's approximate text size is detected and pre-filled, but the original font is often embedded in the PDF and cannot be matched exactly — the editor says this in plain language.
- **Rotate PDF** — 90°, 180° or 270° from the Run job, or 90° per click from a file card.
- **10-second countdown** — after any file is generated, the Download button stays locked for 10 seconds with an ad slot shown beside it. There is no instant-download bypass.
- **Ads** — three labelled placeholders only (top banner, between tools and workspace, in the download panel). Real AdSense code goes in after a domain is live and AdSense approves the site.

## v1.1 fixes (27 Nov 2026)

- **Contact:** no support email is shown on the site. The owner's real support address is still needed — the Contact section now says "Support email will be added once the domain is live." and there is no mailto link anywhere.
- **Target size panel** now shows only for Compress / Resize jobs; it is hidden for Merge, Split, Convert, Edit, Rotate, JPG to PDF, PDF to JPG and PDF to TXT.
- **PDF to JPG / PNG** has a visible format picker (JPG / PNG, default JPG); Run uses the selected format.
- **Hero CTA** "Choose files to start" now scrolls to the workspace and opens the file picker.
- **Rotate** has an angle picker (90° / 180° / 270°) for the Run job; the per-file Rotate button still turns 90° per click and its status text now states the rotation applied.
- **Split** has a page-range box ("1-3, 5") with an Apply range button that ticks the matching pages; invalid ranges show a clear error.
- **Guides** for Merge PDF and PDF to JPG rewritten to match the real UI ("Merge files into one PDF", "Run selected job", "Merge in this order", and the new format picker).
- **Status line on fresh load** verified: it shows "Ready. Add a file to begin…" — "All files cleared." appears only after actually clicking "Clear all files".
- **"Do it" help text** left as is — it is accurate: file cards do have Edit / Split / Rotate / Convert / Compress / Remove buttons once a file is added.

## Tech

Static site, no build step, no Worker, no server code.

- `index.html` — page, tools grid, workspace, guides, FAQ, About / Privacy.
- `styles.css` — navy `#0F2A43` + teal `#0E9F8A`, white background, no gradients.
- `app.js` — all tool logic.
- `sitemap.xml`, `robots.txt` — SEO (uses `https://dockora.com/` as the placeholder domain — update when the real domain is chosen).

CDN libraries (no integrity hashes, as requested):

- PDF.js 3.11.174 (cdnjs) — PDF rendering and text extraction.
- pdf-lib 1.17.1 (jsdelivr) — building / merging / editing PDFs.
- Mammoth.js 1.6.0 (cdnjs) — DOCX text extraction.

## Run locally

Open `index.html` in a browser, or serve the folder with any static server, for example:

```bash
python3 -m http.server 8000
# then open http://localhost:8000/
```

## Deploy

This is a plain static site for Cloudflare Pages (Pages project, not a Worker). Push to the `Dockora` repo on GitHub, connect the repo in Cloudflare Pages, and deploy the root folder. No build command is needed.

## Honest limits (v1)

- **Font matching is best-effort.** PDF fonts are often embedded and cannot be reused by the browser. Dockora detects the approximate size on the page and uses the closest standard font (Helvetica).
- **Exact KB is not always reachable.** A scanned, photo-heavy PDF may not shrink to 50 KB without becoming unreadable. Dockora iterates down in quality and shows the real final size, saying plainly when the target was missed.
- **Compressed PDFs become image pages.** Re-rendering a PDF to shrink it means its text is no longer selectable. The download panel says this.
- **DOCX to PDF keeps text, not layout.** Tables, images and exact Word formatting are not preserved — the extracted text is laid out as plain pages.
- **PDF to Word is not in v1.** PDF to TXT is implemented; full editable DOCX output is not.
