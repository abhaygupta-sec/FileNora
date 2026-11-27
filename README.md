# FileNora

**Every file, one place.**

Free PDF & file tools that run entirely in your browser. No sign-up, no upload, no watermark. Your files never leave your device.

## Rebrand (27 Nov 2026)

Originally built as **Dockora**. Renamed to **FileNora** on 27 Nov 2026 — the Dockora name was already taken, and the domain **filenora.in** was bought the same day. Every reference (branding, output filenames, sitemap, robots.txt) now uses FileNora / filenora.in. Nothing else changed in this rename.

## What it does (v2)

- **Pick a task first** — 8 plain-language tasks in Step 1. Step 2 adds the files, Step 3 is one big button named for the task.
- **Upload** — drag-and-drop or file picker. PDF, JPG, PNG, WebP, DOCX, TXT. Multiple files at once, up to 50 MB per file. A "Try with a sample file" button builds a sample PDF big enough to shrink, for testing.
- **Preview** — every PDF page (via PDF.js), images directly, TXT and DOCX as extracted text.
- **Join files into one PDF** — pick the task, add 2 or more files, put them in order with Up / Down buttons, tap "Join into one PDF".
- **Keep only some pages** — tick the pages to keep, or type a page range like "1-3, 5", then tap "Keep these pages".
- **Compress to an exact size** — presets 50 KB, 100 KB, 150 KB, 200 KB, 250 KB, 300 KB, 500 KB, 1 MB, plus a custom KB value. Images are re-encoded at lower quality / size; PDFs are re-rendered at lower quality. The real final size is always shown, and if the target cannot be reached it says so plainly.
- **Convert** — pick "Change file type", choose what to change to, tap the button. Images to PDF, PDF pages to JPG/PNG, TXT to PDF, DOCX to PDF, PDF to TXT, and image to image (JPG/PNG/WebP).
- **Edit PDF** — open a PDF page, drag a white rectangle over a word to cover it (whiteout), or click a spot and add new text with a size and colour you choose. Font matching is best-effort: the page's approximate text size is detected and pre-filled, but the original font is often embedded in the PDF and cannot be matched exactly — the editor says this in plain language.
- **Rotate PDF** — pick the angle (90°, 180° or 270°), tap "Turn the pages".
- **10-second countdown** — after any file is generated, a visible progress bar counts down 10 seconds and the Download button unlocks. There is no instant-download bypass.
- **Ads** — three labelled placeholders only (top banner, between tasks and workspace, in the download panel). AdSense verification code placed in `<head>` on 27 Nov 2026 (pub-2188368806087422, `ads.txt` added); site under review. No ad units yet — those come after approval.

## v2.1 fixes (27 Nov 2026)

From a live first-time-user test on filenora.in:

- **Compress no longer makes a file bigger.** If the file is already at or under the target, it is not re-encoded — the original file is offered back with "Already smaller than 100 KB — your file is 1.1 KB, so there is nothing to shrink." If the compressed version ends up larger than the original, the original is offered instead with "We couldn't make it smaller…". The result line always shows both sizes ("Done — your file is 87 KB (was 312 KB), under your 100 KB limit.") and never claims "Target reached" when the file grew.
- **Status line and button hint follow state.** After picking a task: "You picked: Make a file smaller. Now add your files below." After files are added: "2 files added. Tap 'Make it smaller' when you're ready." The button hint moves from "Pick a task above to continue." to "Add your files above, then tap the button." to "Ready — tap the button."
- **Working state paints before the job starts.** The action button shows the spinner + "Working…" synchronously on click, then the job runs after a `setTimeout(0)` yield so the browser can paint it. The Split button got the same treatment.
- **The 10-second wait is warned about before the run.** A static line under the Step 3 button (and under the Split button) says the download unlocks in 10 seconds and why.
- **Bigger sample file.** The sample is now a photo-like JPEG (gradient + noise, ~300 KB) embedded on 2 pages of a PDF, so "Make a file smaller" can actually show shrinking. Each click makes a distinct file (`filenora-sample-1.pdf`, `-2.pdf`, …) with its own caption and timestamp, so the duplicate skip never blocks a second click and two samples can demo Join.
- **Ad placeholders look intentional.** The scaffolding text is gone — each slot is now just a clearly-labelled empty "Advertisement" box with a dashed border. The AdSense verification script was added to `<head>` on 27 Nov 2026 (separate step); the slots stay empty until ad units are created after approval.
- **Preset guidance.** Under the size presets: "Most forms ask for 100 KB. Photo / passport forms usually ask for 20–50 KB." Custom-size label is now "Or type your own size (KB)".
- **Privacy Policy section** added (linked from the footer), covering files staying on-device, no data collected, cookies/AdSense disclosure, and contact. Written for AdSense approval; AdSense is not running yet.

## v2.2 typography (27 Nov 2026)

The user reported text sizes looked uneven up and down the page ("upper down small big") — the stylesheet had 15+ scattered one-off sizes (0.7rem, 0.8rem, 0.82rem, 0.85rem, 0.88rem, 0.9rem, 0.92rem, 0.95rem, 1.05rem, 1.15rem, 1.2rem, 1.35rem, 1.7rem, 2.4rem) and mobile only shrank the h1, so on a phone the h2 (27px) was nearly as big as the h1 (30px).

- **One type scale, 7 steps, as CSS variables in `:root`:** display 2.375rem (38px, hero title) / h2 1.5rem (24px, section headings) / h3 1.125rem (18px, panel & guide sub-headings) / lead 1.125rem (18px, hero sub, result line, countdown, drop title) / base 1rem (16px, body, buttons, nav, task titles) / sm 0.875rem (14px, all small & muted text) / xs 0.75rem (12px, ad label only). Every `font-size` in the stylesheet now uses one of these — no one-off values remain (except the deliberate 16px form-input rule on mobile, which stops iOS auto-zoom).
- **Mobile (≤640px) steps down evenly too:** h1 1.875rem (30px), h2 1.375rem (22px); everything else keeps its scale step, so headings stay clearly bigger than body text at ~360px.
- **Type-scale pass only:** no wording, layout, colour, or behaviour changed. `app.js` was not touched; the AdSense script in `<head>` is untouched.
- **Logo (27 Nov 2026, same push):** Logo B picked by Abhay — folder + document + teal down arrow. Header now uses `assets/filenora-logo.png` (40px desktop, 32px mobile); favicon is the cropped folder mark `assets/filenora-icon.png` (512×512). The old "F" text mark and inline-SVG favicon are gone.

## v2 UX rebuild (27 Nov 2026)

The workspace was rebuilt task-first, because v1 made the user think too hard: three ways to pick a job, files asked for before the task, and technical wording throughout.

- **One task picker, plain words.** Step 1 is 8 big task cards ("Make a file smaller", "Join files into one PDF", "Turn photos into a PDF", "Save PDF pages as photos", "Keep only some pages", "Remove a word from a PDF", "Change file type", "Turn pages the right way up"), each with a real-life "when" line and the technical term as small secondary text. The job dropdown and the per-file action buttons are gone.
- **Three steps, one path.** Step 1 pick a task, Step 2 add files, Step 3 one big button named for the task ("Make it smaller", "Join into one PDF"). The button shows "Working…" with a spinner while a job runs. On phones it sticks to the bottom of the screen.
- **No merge question.** Picking "Join files into one PDF" IS the merge — files are ordered with Up / Down buttons, no separate-or-merge prompt ever appears.
- **Only the options that task needs.** Target size (default 100 KB) for "Make a file smaller", JPG/PNG picker for photos, angle picker for turning pages, a "Change to" picker for changing file type. "Keep only some pages" uses its own panel (checkboxes + page range + "Keep these pages" button) as its action.
- **Plain results.** After a run, one clear line first ("Done — your file is 87 KB, under your 100 KB limit."), then a visible countdown progress bar, then Download. "Do another file" / "Start over" clears everything and returns to Step 1.
- **Try with a sample file.** Step 2 has a button that builds a small 1-page sample PDF in the browser, so anyone can try a task without having a file ready.
- **All v1.3 behaviour kept:** 10-second countdown with no bypass, duplicate-file skip, total file count, removing a file drops its outputs, re-running a job replaces (never duplicates) outputs, countdown note swaps to "Download is unlocked" at 0, same 3 ad placeholders, same navy/teal design.

## v1.3 fixes (27 Nov 2026)

- **Re-running a job no longer duplicates outputs.** Run selected job clears the previous run's outputs first (for output-producing jobs; Split / Edit only open a panel, so their outputs are cleared when the panel's action produces one), and a per-file action replaces — never appends — an output with the same filename. Running Compress twice now leaves one entry per file, not two.
- **Removing a file also removes its outputs.** Every output now records which file(s) produced it, and removing a file drops every download that came from that file (including a merged PDF it was part of). Outputs from other files are kept.
- **Skip-only re-add still shows the file count.** When the same file is re-added and skipped as a duplicate, the status line now reads e.g. "1 file added. Pick a job and click Run. “name.pdf” is already added — skipped." instead of showing only the skip note.
- **Heading spacing fixed:** "Target size (for Compress / Resize)" — the space now sits inside the muted span text, so it always renders. The same fix was applied to the "Image format" and "Rotate angle" panel headings, which used the same pattern.

## v1.2 fixes (27 Nov 2026)

- **File-count status** now always reports the TOTAL in the list (`files.length`), not just the last picker batch — e.g. adding a second file in a second session says "2 files added."
- **Duplicate files** are skipped: a file with the same name, size and last-modified time as one already in the list is not added again, and the status line says plainly "“name.pdf” is already added — skipped." A different file that happens to share a name is still added.
- **Per-file Compress label** now follows the target size: changing the target (e.g. to 50 KB) re-renders the file cards, so the button reads "Compress to 50 KB". Previews and the merge prompt are not touched by that re-render.
- **Countdown helper text** now changes when the countdown hits 0: the download panel line reads "Download is unlocked — this wait keeps FileNora free." instead of still saying "Please wait…".
- **Merge order panel** closes after a successful merge: the merge prompt and order panel are hidden and the merge state is reset, while the download panel and its countdown stay visible.
- **Merge prompt check confirmed:** `renderMergePrompt()` shows the "more than one file" prompt only when `files.length >= 2` and no merge choice has been made yet — with the new dedupe, a re-added duplicate can no longer inflate that count.

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
- `sitemap.xml`, `robots.txt` — SEO (uses `https://filenora.in/` — the live domain, bought 27 Nov 2026).

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

This is a plain static site for Cloudflare Pages (Pages project, not a Worker). Push to the `FileNora` repo on GitHub, connect the repo in Cloudflare Pages, and deploy the root folder. No build command is needed.

## Honest limits (v1)

- **Font matching is best-effort.** PDF fonts are often embedded and cannot be reused by the browser. FileNora detects the approximate size on the page and uses the closest standard font (Helvetica).
- **Exact KB is not always reachable.** A scanned, photo-heavy PDF may not shrink to 50 KB without becoming unreadable. FileNora iterates down in quality and shows the real final size, saying plainly when the target was missed.
- **Compressed PDFs become image pages.** Re-rendering a PDF to shrink it means its text is no longer selectable. The download panel says this.
- **DOCX to PDF keeps text, not layout.** Tables, images and exact Word formatting are not preserved — the extracted text is laid out as plain pages.
- **PDF to Word is not in v1.** PDF to TXT is implemented; full editable DOCX output is not.
