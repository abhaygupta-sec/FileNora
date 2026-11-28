/* FileNora v2 — task-first: pick a task, add files, tap one button.
   All processing is client-side, in the browser.
   Libraries (CDN): PDF.js for rendering / text, pdf-lib for building
   PDFs, Mammoth for DOCX text. No file is ever uploaded. */
'use strict';

/* ---------- Setup ---------- */
if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}
const PDFLib = window.PDFLib || null;
const ACCEPTED_EXT = ['pdf', 'jpg', 'jpeg', 'png', 'webp', 'docx', 'txt'];
const MAX_BYTES = 50 * 1024 * 1024; // 50 MB per file

/* ---------- State ---------- */
let files = [];          // {id, file, name, ext, kind, size, pageCount, pdfDoc, text, dataUrl, rotation, edits}
let nextId = 1;
let currentTask = null;  // 'compress' | 'join' | 'jpg2pdf' | 'pdf2jpg' | 'split' | 'edit' | 'convert' | 'rotate'
let joinOrder = [];      // array of file ids, in join order (Join task)
let resultText = '';     // plain-language result line shown above the downloads
let targetKb = 100;
let compressResults = []; // per-file compress outcomes {kind, text}, for the plain result line
let sampleCount = 0;      // sample files are numbered so each click makes a distinct file
let pendingOutputs = []; // {blob, filename, note, sourceIds: [ids of the files that produced it]}
let countdownTimer = null;
let editorFile = null;   // file object being edited
let editorPage = 1;
let editMode = 'whiteout';
let pendingTextPos = null; // {fx, fy} fractions, set by a click in text mode
let dragStart = null;

/* ---------- DOM helpers ---------- */
const $ = (id) => document.getElementById(id);
function setStatus(msg, isError) {
  const el = $('statusMsg');
  el.textContent = msg || '';
  el.classList.toggle('error', !!isError);
}
/* The status line under Step 2 follows what the user has done so far.
   The "You picked: ..." line above it already names the task, so the
   status never repeats it — it used to, and the phrase showed twice. */
const INIT_STATUS = 'Ready. Pick what you want to do above, then add your files — no sign-in, and your files never leave your device.';
function updateStatusLine(extra) {
  let msg;
  if (!currentTask && !files.length) msg = INIT_STATUS;
  else if (!currentTask) msg = files.length + (files.length === 1 ? ' file' : ' files') + ' added. Pick what you want to do above.';
  else if (!files.length) msg = 'Now add your files below.';
  else msg = files.length + (files.length === 1 ? ' file' : ' files') + ' added. Tap “' + TASKS[currentTask].action + '” when you’re ready.';
  setStatus(msg + (extra || ''));
}
/* The hint beside the Step 3 button follows what the task actually
   needs — it only says "Ready" when the job can really run. One file
   is not enough to join, and a PDF is not a photo, so those states
   still ask for the right file instead of saying "Ready". */
function taskReady() {
  if (!currentTask || !files.length) return false;
  if (currentTask === 'join') return files.length >= 2;
  if (currentTask === 'jpg2pdf') return files.some((f) => f.kind === 'image');
  if (currentTask === 'pdf2jpg' || currentTask === 'rotate' || currentTask === 'edit') return files.some((f) => f.kind === 'pdf');
  return true;
}
function updateActionHint() {
  const el = $('actionHint');
  if (!el) return;
  if (!currentTask) { el.textContent = 'Pick a task above to continue.'; return; }
  if (!files.length) { el.textContent = 'Add your files above, then tap the button.'; return; }
  if (!taskReady()) {
    if (currentTask === 'join') el.textContent = 'Add one more file — joining needs 2 or more.';
    else if (currentTask === 'jpg2pdf') el.textContent = 'Add a photo first — JPG, PNG or WebP.';
    else el.textContent = 'Add a PDF first.';
    return;
  }
  el.textContent = 'Ready — tap the button.';
}
function fmtSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}
function fmtTarget(kb) {
  return kb >= 1024 ? (kb / 1024).toFixed(kb % 1024 ? 1 : 0) + ' MB' : kb + ' KB';
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
function extOf(name) { return (name.split('.').pop() || '').toLowerCase(); }
function kindOf(ext) {
  if (ext === 'pdf') return 'pdf';
  if (['jpg', 'jpeg', 'png', 'webp'].includes(ext)) return 'image';
  if (ext === 'docx') return 'docx';
  if (ext === 'txt') return 'text';
  return 'other';
}
function readAsArrayBuffer(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsArrayBuffer(file); });
}
function readAsText(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsText(file); });
}
function readAsDataURL(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
}
function canvasToBlob(canvas, type, quality) {
  return new Promise((res) => canvas.toBlob((b) => res(b), type, quality));
}
function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}

/* ---------- Target size ---------- */
function setTargetKb(kb) {
  targetKb = Math.max(10, Math.min(51200, Math.round(kb) || 100));
  $('customKb').value = targetKb;
  $('targetLabel').textContent = 'Target: ' + fmtTarget(targetKb);
  document.querySelectorAll('#sizePresets button').forEach((b) =>
    b.classList.toggle('active', Number(b.dataset.kb) === targetKb));
}
document.querySelectorAll('#sizePresets button').forEach((b) =>
  b.addEventListener('click', () => setTargetKb(Number(b.dataset.kb))));
$('customKb').addEventListener('change', () => setTargetKb(Number($('customKb').value)));

/* ---------- Tasks: one picker, plain words ---------- */
/* There is exactly one way to pick a task: the 8 cards in Step 1.
   Each task shows only its own options, and runs from one big button
   whose label names the task. */
const TASKS = {
  compress: { title: 'Make a file smaller', action: 'Make it smaller', hint: 'Add a PDF or a photo, then tap “Make it smaller”.' },
  join: { title: 'Join files into one PDF', action: 'Join into one PDF', hint: 'Add 2 or more files, put them in order, then tap “Join into one PDF”.' },
  jpg2pdf: { title: 'Turn photos into a PDF', action: 'Turn photos into a PDF', hint: 'Add photos from your phone or computer.' },
  pdf2jpg: { title: 'Save PDF pages as photos', action: 'Save as photos', hint: 'Add a PDF — each page becomes a photo.' },
  split: { title: 'Keep only some pages', action: 'Keep these pages', hint: 'Add a PDF, then tick the pages you want to keep.' },
  edit: { title: 'Remove a word from a PDF', action: 'Open the editor', hint: 'Add your PDF, tap Edit, then drag over the word to cover it — or add new text in its place.' },
  convert: { title: 'Change file type', action: 'Change file type', hint: 'Add a file, choose what to change it to, then tap “Change file type”.' },
  rotate: { title: 'Turn pages the right way up', action: 'Turn the pages', hint: 'Add a PDF, then tap “Turn the pages”.' }
};
const WORKING_TEXT = {
  compress: 'Working — making your file smaller…',
  join: 'Working — joining your files into one PDF…',
  jpg2pdf: 'Working — turning your photos into a PDF…',
  pdf2jpg: 'Working — saving PDF pages as photos…',
  convert: 'Working — changing your file type…',
  rotate: 'Working — turning the pages…'
};
function selectTask(task) {
  currentTask = task;
  updateTaskUI();
  $('taskHint').textContent = TASKS[task] ? TASKS[task].hint : '';
  syncTaskUrl();
  document.getElementById('workspace').scrollIntoView({ behavior: 'smooth' });
}
/* One URL per tool: picking a task writes ?task=<id> into the address
   bar (replaceState, so the Back button is not filled with task
   picks), and loading with ?task=<id> preselects that task. */
function syncTaskUrl() {
  try {
    const url = currentTask
      ? window.location.pathname + '?task=' + currentTask
      : window.location.pathname;
    window.history.replaceState(null, '', url);
  } catch (e) { /* file:// or old browsers: the URL just stays as it is */ }
}
/* Show only the options the selected task needs, and set the one
   action button's label. Split has no generic action button — its own
   "Keep these pages" button inside the split panel is the action. */
function updateTaskUI() {
  const t = currentTask;
  document.querySelectorAll('#tasksGrid .task-card').forEach((b) =>
    b.classList.toggle('selected', b.dataset.task === t));
  const picked = $('pickedTask');
  if (picked) {
    picked.hidden = !t;
    if (t) $('pickedTaskName').textContent = TASKS[t].title;
  }
  $('targetSizePanel').hidden = t !== 'compress';
  $('jpg2pdfPanel').hidden = t !== 'jpg2pdf';
  $('pdf2jpgPanel').hidden = t !== 'pdf2jpg';
  $('rotatePanel').hidden = t !== 'rotate';
  $('convertPanel').hidden = t !== 'convert';
  /* The Join panel (order + pages-per-sheet) shows as soon as the
     Join task is picked, even with 0 or 1 files — the order list
     itself waits until there are 2 files to order (see
     renderJoinOrder). */
  $('joinOrderPanel').hidden = t !== 'join';
  const sampleNote = $('sampleNote');
  if (sampleNote) {
    sampleNote.textContent = t === 'jpg2pdf'
      ? 'No photo handy? We make a sample photo for you to try with.'
      : 'No file handy? We make a sample PDF for you to try with — big enough to shrink, so you can see it work.';
  }
  const bar = $('actionBar');
  if (t === 'split') {
    bar.hidden = true;
  } else {
    bar.hidden = false;
    const btn = $('btnAction');
    if (t) { btn.disabled = false; btn.textContent = TASKS[t].action; }
    else { btn.disabled = true; btn.textContent = 'Pick a task above to continue'; }
  }
  renderConvertOptions();
  renderJoinOrder();
  renderSplitPanel();
  updateStatusLine();
  updateActionHint();
}
/* The "Change file type" task needs one choice: what to change to.
   Options follow the first file's kind, so only supported targets
   are offered (PDFs: photo or text; photos: PDF or photo type), and
   the default is never the file's own type: a PDF defaults to JPG,
   a photo to PDF, and TXT / DOCX to PDF. The "Tap Edit" hint only
   shows for photos; for PDFs it is reworded to cover / add text. */
function renderConvertOptions() {
  const sel = $('convertFormat');
  if (!sel) return;
  const first = files[0];
  sel.innerHTML = first ? convertOptionsFor(first)
    : '<option value="pdf">PDF</option><option value="jpg">JPG</option><option value="png">PNG</option><option value="webp">WebP</option><option value="txt">TXT</option>';
  if (first) {
    sel.value = first.kind === 'pdf' ? 'jpg' : 'pdf';
  }
  const hint = $('convertEditHint');
  if (hint) {
    if (!first) hint.hidden = true;
    else if (first.kind === 'image') { hint.hidden = false; hint.textContent = 'Want to crop or fix it first? Tap Edit on the file below.'; }
    else if (first.kind === 'pdf') { hint.hidden = false; hint.textContent = 'Want to cover or add text first? Tap Edit on the file below.'; }
    else hint.hidden = true;
  }
}
/* While a job runs, the action button says "Working…" with a spinner,
   so the user is never left wondering if the page is stuck. */
function setWorking(on, text) {
  const btn = $('btnAction');
  const spinner = $('workSpinner');
  if (on) {
    btn.disabled = true;
    btn.textContent = 'Working…';
    if (spinner) spinner.hidden = false;
    if (text) setStatus(text);
  } else {
    if (spinner) spinner.hidden = true;
    btn.disabled = !currentTask;
    if (currentTask && currentTask !== 'split') btn.textContent = TASKS[currentTask].action;
    else if (!currentTask) btn.textContent = 'Pick a task above to continue';
  }
}
document.querySelectorAll('#tasksGrid .task-card').forEach((b) =>
  b.addEventListener('click', () => selectTask(b.dataset.task)));
$('btnChangeTask').addEventListener('click', () => {
  document.getElementById('tasks').scrollIntoView({ behavior: 'smooth' });
});

/* ---------- Upload ---------- */
const dropzone = $('dropzone'), fileInput = $('fileInput');
/* Hero CTA: scroll to Step 1 so the user picks a task first. */
$('heroChooseBtn').addEventListener('click', () => {
  document.getElementById('tasks').scrollIntoView({ behavior: 'smooth' });
});
$('chooseBtn').addEventListener('click', (e) => { e.stopPropagation(); fileInput.click(); });
dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
['dragenter', 'dragover'].forEach((ev) => dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add('dragging'); }));
['dragleave', 'drop'].forEach((ev) => dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.remove('dragging'); }));
dropzone.addEventListener('drop', (e) => handleFiles(e.dataTransfer.files));
fileInput.addEventListener('change', () => { handleFiles(fileInput.files); fileInput.value = ''; });

/* ---------- Sample file ---------- */
/* "Try with a sample file": for "Turn photos into a PDF" it builds a
   sample PHOTO (JPEG), not a PDF — the task needs a photo. For every
   other task it builds a sample PDF that looks like a real document:
   a white page, a title line, paragraph bars and a small photo-like
   block, big enough to shrink. Every click makes a DISTINCT file
   (numbered name, new caption text, fresh timestamp) so the duplicate
   skip never blocks a second click, and two samples can demo Join. */
$('btnSample').addEventListener('click', async () => {
  try {
    sampleCount++;
    const n = sampleCount;
    if (currentTask === 'jpg2pdf') {
      const photoBlob = await makeSamplePhotoImage(n);
      const photo = new File([photoBlob], 'filenora-sample-photo-' + n + '.jpg', { type: 'image/jpeg', lastModified: Date.now() + n });
      await handleFiles([photo]);
      return;
    }
    if (!PDFLib) { setStatus('The PDF library did not load. Check your connection and reload.', true); return; }
    const photoBlob = await makeSamplePhoto(n);
    const photoBytes = await photoBlob.arrayBuffer();
    const doc = await PDFLib.PDFDocument.create();
    const img = await doc.embedJpg(photoBytes);
    const helv = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
    const helvBold = await doc.embedFont(PDFLib.StandardFonts.HelveticaBold);
    for (let p = 1; p <= 2; p++) {
      /* A document page: white, title at the top, paragraph bars
         below, and one photo-like block — so thumbnails look like a
         real document, not noise. */
      const page = doc.addPage([595, 842]);
      page.drawText('FileNora sample file #' + n + ' — page ' + p + ' of 2', { x: 48, y: 790, size: 20, font: helvBold, color: PDFLib.rgb(0.06, 0.16, 0.26) });
      page.drawText('Try "Make a file smaller" with this file — it is big enough to shrink.', { x: 48, y: 762, size: 12, font: helv, color: PDFLib.rgb(0.06, 0.16, 0.26) });
      let y = 720;
      for (let line = 0; line < 6; line++) {
        page.drawRectangle({ x: 48, y, width: 420 - (line % 3) * 70, height: 9, color: PDFLib.rgb(0.86, 0.89, 0.92) });
        y -= 20;
      }
      const imgW = 499, imgH = 310;
      page.drawImage(img, { x: 48, y: y - imgH - 12, width: imgW, height: imgH });
      page.drawText('A photo inside the document.', { x: 48, y: y - imgH - 32, size: 11, font: helv, color: PDFLib.rgb(0.36, 0.42, 0.48) });
      y = y - imgH - 60;
      for (let line = 0; line < 4; line++) {
        page.drawRectangle({ x: 48, y, width: 430 - (line % 2) * 90, height: 9, color: PDFLib.rgb(0.86, 0.89, 0.92) });
        y -= 20;
      }
    }
    const bytes = await doc.save();
    const sample = new File([bytes], 'filenora-sample-' + n + '.pdf', { type: 'application/pdf', lastModified: Date.now() + n });
    await handleFiles([sample]);
  } catch (err) {
    setStatus('Could not make the sample file: ' + (err && err.message ? err.message : 'unknown error'), true);
  }
});
/* A photo-like block for the sample document: a soft gradient with a
   few large shapes and light texture — enough entropy for a real
   JPEG size, but contained in one block on the page, not full-page
   noise. */
function makeSamplePhoto(n) {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    canvas.width = 900; canvas.height = 560;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 900, 560);
    grad.addColorStop(0, '#1c5d8f');
    grad.addColorStop(0.5, '#3a8f7a');
    grad.addColorStop(1, '#e8b64c');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 900, 560);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath(); ctx.arc(720, 110, 70, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(15,42,67,0.55)';
    ctx.beginPath(); ctx.arc(220, 430, 130, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath(); ctx.arc(430, 470, 90, 0, Math.PI * 2); ctx.fill();
    for (let i = 0; i < 6000; i++) {
      ctx.fillStyle = 'rgba(' + (Math.random() * 255 | 0) + ',' + (Math.random() * 255 | 0) + ',' + (Math.random() * 255 | 0) + ',' + (Math.random() * 0.25).toFixed(2) + ')';
      ctx.fillRect(Math.random() * 900, Math.random() * 560, 2 + Math.random() * 10, 2 + Math.random() * 10);
    }
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 48px Arial';
    ctx.fillText('FileNora sample #' + n, 48, 120);
    ctx.font = '28px Arial';
    ctx.fillText('A photo inside the document.', 48, 170);
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not make the sample photo.'))), 'image/jpeg', 0.92);
  });
}
/* A standalone sample photo for "Turn photos into a PDF": a simple
   bright scene (sky, sun, hills) with a caption — a real JPEG file,
   not a PDF. */
function makeSamplePhotoImage(n) {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    canvas.width = 1200; canvas.height = 900;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 0, 900);
    grad.addColorStop(0, '#7ec3e8');
    grad.addColorStop(0.6, '#cfeeda');
    grad.addColorStop(1, '#8fbf7f');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 1200, 900);
    ctx.fillStyle = '#f7d774';
    ctx.beginPath(); ctx.arc(980, 170, 90, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#5d8f5a';
    ctx.beginPath(); ctx.arc(300, 980, 420, Math.PI, 0); ctx.fill();
    ctx.beginPath(); ctx.arc(900, 1020, 480, Math.PI, 0); ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 64px Arial';
    ctx.fillText('FileNora sample photo #' + n, 80, 200);
    ctx.font = '36px Arial';
    ctx.fillText('Try "Turn photos into a PDF" with this photo.', 80, 280);
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not make the sample photo.'))), 'image/jpeg', 0.9);
  });
}

async function handleFiles(fileList) {
  const list = Array.from(fileList || []);
  if (!list.length) return;
  let added = 0;
  const skippedDupes = [];
  for (const file of list) {
    const ext = extOf(file.name);
    if (!ACCEPTED_EXT.includes(ext)) {
      setStatus('“' + file.name + '” was not added: .' + ext + ' is not supported in v1. Use PDF, JPG, PNG, WebP, DOCX or TXT.', true);
      continue;
    }
    if (file.size > MAX_BYTES) {
      setStatus('“' + file.name + '” is over 50 MB and was not added. Please use a smaller file.', true);
      continue;
    }
    /* Skip a file already in the list with the same name, size and
       last-modified time. A different file that happens to share a name
       (different size or timestamp) is still added. This also catches
       the same file picked twice in one batch, since files.push runs
       inside this loop. */
    if (files.some((x) => x.name === file.name && x.size === file.size && x.file.lastModified === file.lastModified)) {
      skippedDupes.push(file.name);
      continue;
    }
    const item = {
      id: nextId++, file, name: file.name, ext, kind: kindOf(ext),
      size: file.size, pageCount: 0, pdfDoc: null, text: '', dataUrl: '',
      rotation: 0, edits: {} // page number -> {whiteouts:[], texts:[]}
    };
    try {
      if (item.kind === 'pdf') {
        const buf = await readAsArrayBuffer(file);
        item.arrayBuffer = buf;
        item.pdfDoc = await pdfjsLib.getDocument({ data: buf.slice(0) }).promise;
        item.pageCount = item.pdfDoc.numPages;
      } else if (item.kind === 'image') {
        item.dataUrl = await readAsDataURL(file);
      } else if (item.kind === 'text') {
        item.text = await readAsText(file);
      } else if (item.kind === 'docx') {
        const buf = await readAsArrayBuffer(file);
        const result = await mammoth.extractRawText({ arrayBuffer: buf });
        item.text = result.value || '';
        if (!item.text.trim()) setStatus('“' + file.name + '”: no readable text was found in this DOCX file.', true);
      }
    } catch (err) {
      setStatus('Could not read “' + file.name + '”: ' + (err && err.message ? err.message : 'unknown error') + '. The file may be damaged or password-protected.', true);
      continue;
    }
    files.push(item);
    added++;
  }
  /* Status always reports the TOTAL in the list, not just this batch,
     and follows state (task picked / files added). A duplicate-skip
     note is appended, never shown on its own. */
  const dupeNote = skippedDupes.length
    ? ' ' + skippedDupes.map((n) => '“' + n + '” is already added — skipped.').join(' ')
    : '';
  if (added) {
    joinOrder = files.map((f) => f.id);
    renderAll();
    updateStatusLine(dupeNote);
  } else if (skippedDupes.length) {
    /* Nothing new was added, but the status must still show the total
       count — not just the skip note. */
    updateStatusLine(dupeNote);
  }
}

/* ---------- Render: file list, previews, task panels ---------- */
function renderAll() {
  renderFileList();
  renderPreviews();
  updateTaskUI();
}
function renderFileList() {
  const wrap = $('fileList');
  wrap.innerHTML = '';
  files.forEach((f) => {
    const card = document.createElement('div');
    card.className = 'file-card';
    const meta = f.kind === 'pdf' ? f.pageCount + (f.pageCount === 1 ? ' page' : ' pages')
      : f.kind === 'docx' || f.kind === 'text' ? 'Text document'
      : 'Image';
    /* A file card shows what the file is — name, kind, size — plus
       Edit and Remove. Every job still runs from the one big button
       in Step 3; Edit is the step before a job, not a job itself.
       Every file kind has an Edit: images get the image editor, PDFs
       the PDF editor, DOCX and TXT the text editor. */
    card.innerHTML =
      '<h4>' + esc(f.name) + '</h4>' +
      '<p class="file-meta">' + esc(meta) + ' &middot; ' + esc(f.ext.toUpperCase()) + ' &middot; ' + fmtSize(f.size) + '</p>' +
      '<div class="file-actions">' +
        '<button type="button" class="btn btn-secondary btn-small" data-act="edit">Edit</button>' +
        '<button type="button" class="btn btn-secondary btn-small" data-act="remove">Remove</button>' +
      '</div>';
    card.querySelectorAll('[data-act="remove"]').forEach((btn) => {
      btn.addEventListener('click', () => removeFile(f));
    });
    card.querySelectorAll('[data-act="edit"]').forEach((btn) => {
      btn.addEventListener('click', () => openFileEditor(f));
    });
    wrap.appendChild(card);
  });
}
function convertOptionsFor(f) {
  if (f.kind === 'pdf') return '<option value="jpg">JPG</option><option value="png">PNG</option><option value="txt">TXT</option>';
  if (f.kind === 'image') return '<option value="pdf">PDF</option><option value="jpg">JPG</option><option value="png">PNG</option><option value="webp">WebP</option>';
  if (f.kind === 'text' || f.kind === 'docx') return '<option value="pdf">PDF</option><option value="txt">TXT</option>';
  return '<option value="pdf">PDF</option>';
}
async function renderPreviews() {
  const area = $('previewArea');
  area.innerHTML = '';
  for (const f of files) {
    const card = document.createElement('div');
    card.className = 'preview-card';
    card.innerHTML = '<h4>Preview — ' + esc(f.name) + '</h4>';
    if (f.kind === 'pdf' && f.pdfDoc) {
      const thumbs = document.createElement('div');
      thumbs.className = 'page-thumbs';
      card.appendChild(thumbs);
      area.appendChild(card);
      for (let p = 1; p <= f.pageCount; p++) {
        try {
          const page = await f.pdfDoc.getPage(p);
          const viewport = page.getViewport({ scale: 0.55 });
          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(viewport.width); canvas.height = Math.floor(viewport.height);
          await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
          const fig = document.createElement('figure');
          fig.appendChild(canvas);
          const cap = document.createElement('figcaption');
          cap.textContent = 'Page ' + p;
          fig.appendChild(cap);
          thumbs.appendChild(fig);
        } catch (e) { /* skip a page that fails to render */ }
      }
    } else if (f.kind === 'image') {
      const img = document.createElement('img');
      img.className = 'preview-img'; img.src = f.dataUrl; img.alt = 'Preview of ' + f.name;
      card.appendChild(img); area.appendChild(card);
    } else {
      const pre = document.createElement('div');
      pre.className = 'text-preview';
      pre.textContent = f.text ? f.text.slice(0, 4000) : '(No text to preview.)';
      card.appendChild(pre); area.appendChild(card);
    }
  }
}

/* ---------- Join order (Join task only) ---------- */
/* No separate-or-merge question ever appears: if the user picked the
   Join task, joining IS the job. This list only sets the order. */
function renderJoinOrder() {
  const list = $('joinOrderList');
  if (!list) return;
  /* With fewer than 2 files there is nothing to order yet — show the
     "add 2 or more" note instead of an empty list. The panel itself
     (and its pages-per-sheet selector) is already visible. */
  const showOrder = files.length >= 2;
  const intro = $('joinOrderIntro');
  const needMore = $('joinNeedMore');
  if (intro) intro.hidden = !showOrder;
  if (needMore) needMore.hidden = showOrder;
  list.hidden = !showOrder;
  list.innerHTML = '';
  joinOrder.forEach((id, idx) => {
    const f = files.find((x) => x.id === id);
    if (!f) return;
    const li = document.createElement('li');
    li.draggable = true;
    li.dataset.id = String(id);
    li.innerHTML = '<span class="fname">' + (idx + 1) + '. ' + esc(f.name) + '</span>' +
      '<button type="button" class="btn btn-secondary btn-small" data-move="-1" ' + (idx === 0 ? 'disabled' : '') + '>&uarr; Up</button>' +
      '<button type="button" class="btn btn-secondary btn-small" data-move="1" ' + (idx === joinOrder.length - 1 ? 'disabled' : '') + '>Down &darr;</button>';
    li.querySelectorAll('[data-move]').forEach((b) => b.addEventListener('click', () => {
      const d = Number(b.dataset.move);
      const j = joinOrder.indexOf(id);
      const k = j + d;
      if (k < 0 || k >= joinOrder.length) return;
      joinOrder.splice(j, 1); joinOrder.splice(k, 0, id);
      renderJoinOrder();
    }));
    li.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/plain', String(id)));
    li.addEventListener('dragover', (e) => e.preventDefault());
    li.addEventListener('drop', (e) => {
      e.preventDefault();
      const dragged = Number(e.dataTransfer.getData('text/plain'));
      const from = joinOrder.indexOf(dragged), to = joinOrder.indexOf(id);
      if (from < 0 || to < 0 || from === to) return;
      joinOrder.splice(from, 1); joinOrder.splice(to, 0, dragged);
      renderJoinOrder();
    });
    list.appendChild(li);
  });
}

/* ---------- Remove a file ---------- */
function removeFile(f) {
  files = files.filter((x) => x.id !== f.id);
  joinOrder = joinOrder.filter((id) => id !== f.id);
  /* Drop every download that was produced from this file, so its
     outputs do not linger after the file is gone. Outputs made
     from other files are kept. */
  pendingOutputs = pendingOutputs.filter((o) => !(o.sourceIds || []).includes(f.id));
  renderOutputs();
  renderAll();
  setStatus('Removed ' + f.name + '.');
}

/* ---------- The one big button (Step 3) ---------- */
/* There is exactly one run button. It is named for the selected task,
   shows "Working…" while a job runs, and does nothing until a task
   is picked and a file is added. Split is the exception: its own
   "Keep these pages" button inside the split panel is its action. */
$('btnAction').addEventListener('click', async () => {
  const task = currentTask;
  if (!task) { setStatus('Pick what you want to do first — choose one of the tasks above.', true); return; }
  if (task === 'split') return; // Split runs from its own button.
  if (!files.length) { setStatus('Add a file first — drop it on the box above or tap Choose files.', true); return; }
  if (task === 'edit') {
    const pdf = files.find((x) => x.kind === 'pdf');
    if (!pdf) { setStatus('Add a PDF first.', true); return; }
    openEditor(pdf);
    return;
  }
  /* Task-specific checks BEFORE the spinner, so an error never
     flashes "Working…" first. */
  if (task === 'join' && files.length < 2) { setStatus('Joining needs 2 or more files. Add another file.', true); return; }
  if (task === 'jpg2pdf' && !files.some((f) => f.kind === 'image')) { setStatus('Add a photo first — JPG, PNG or WebP.', true); return; }
  if (task === 'pdf2jpg' && !files.some((x) => x.kind === 'pdf')) { setStatus('Add a PDF first.', true); return; }
  if (task === 'rotate' && !files.some((x) => x.kind === 'pdf')) { setStatus('Add a PDF first.', true); return; }
  setWorking(true, WORKING_TEXT[task] || 'Working…');
  /* Let the browser paint the spinner before the heavy work starts —
     otherwise the user sees nothing happen on a big file. */
  await new Promise((r) => setTimeout(r, 0));
  try {
    if (task === 'join') {
      /* Fresh run: drop the previous run's outputs first. */
      clearOutputs();
      await doMerge();
      return;
    }
    if (task === 'jpg2pdf') {
      const imgs = files.filter((f) => f.kind === 'image');
      clearOutputs();
      await imagesToPdf(imgs);
      return;
    }
    if (task === 'pdf2jpg') {
      const fmt = $('pdf2jpgFormat').value || 'jpg';
      const pdfs = files.filter((x) => x.kind === 'pdf');
      clearOutputs();
      for (const f of pdfs) await pdfToImages(f, fmt);
      setResult('Done — ' + pdfs.reduce((n, f) => n + f.pageCount, 0) + ' photo(s) saved from your PDF.');
      return;
    }
    if (task === 'compress') {
      clearOutputs();
      for (const f of files) await compressFile(f, targetKb);
      summarizeCompress();
      return;
    }
    if (task === 'convert') {
      const fmt = $('convertFormat').value || 'pdf';
      clearOutputs();
      for (const f of files) await convertFile(f, fmt);
      if (pendingOutputs.length) setResult('Done — ' + pendingOutputs.length + ' file(s) changed.');
      return;
    }
    if (task === 'rotate') {
      const angle = Number($('rotateAngle').value) || 90;
      const pdfs = files.filter((x) => x.kind === 'pdf');
      clearOutputs();
      for (const f of pdfs) await rotatePdf(f, angle);
      setResult('Done — ' + pdfs.length + ' PDF(s) turned by ' + angle + '°.');
      return;
    }
  } catch (err) {
    setStatus('Sorry — that did not work: ' + (err && err.message ? err.message : 'unknown error'), true);
  } finally {
    setWorking(false);
  }
});
/* Plain-language summary after "Make a file smaller". The result line
   always shows both sizes, and never claims "Target reached" when the
   file grew or was already small — those cases get their own honest
   line, recorded per file in compressResults. */
function summarizeCompress() {
  if (!pendingOutputs.length) return;
  if (pendingOutputs.length === 1 && compressResults.length === 1) {
    setResult(compressResults[0].text);
    return;
  }
  const kinds = compressResults.map((r) => r.kind);
  const already = kinds.filter((k) => k === 'already').length;
  const grew = kinds.filter((k) => k === 'grew').length;
  const shrunk = kinds.filter((k) => k === 'reached' || k === 'notreached').length;
  if (already === kinds.length && kinds.length) {
    setResult('Done — all ' + kinds.length + ' files were already under your ' + fmtTarget(targetKb) + ' target, so nothing needed shrinking.');
    return;
  }
  let line = 'Done — ' + pendingOutputs.length + ' files ready.';
  if (shrunk) line += ' ' + shrunk + (shrunk === 1 ? ' was' : ' were') + ' made smaller.';
  if (already) line += ' ' + already + (already === 1 ? ' was' : ' were') + ' already small enough.';
  if (grew) line += ' ' + grew + ' came out bigger, so we kept your original' + (grew === 1 ? '' : 's') + ' for ' + (grew === 1 ? 'it' : 'them') + '.';
  setResult(line);
}
/* Start over: clear files and outputs and go back to Step 1. */
function startOver() {
  files = []; joinOrder = []; splitFile = null; currentTask = null;
  resultText = '';
  clearOutputs();
  renderAll();
  $('taskHint').textContent = 'Pick a task above first, then add your files here.';
  syncTaskUrl();
  document.getElementById('tasks').scrollIntoView({ behavior: 'smooth' });
}
$('btnStartOver').addEventListener('click', startOver);
$('btnAgain').addEventListener('click', startOver);

/* ---------- PDF helpers (pdf-lib) ---------- */
function baseName(name) { return name.replace(/\.[^.]+$/, ''); }
async function loadPdfLibDoc(f) {
  return await PDFLib.PDFDocument.load(f.arrayBuffer.slice(0), { ignoreEncryption: true });
}
async function addTextPages(pdfDoc, text, font) {
  const lines = String(text || '').split(/\r?\n/);
  const helv = font || await pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica);
  let page = pdfDoc.addPage([595, 842]);
  let y = 800;
  for (const rawLine of lines) {
    // Wrap long lines at ~95 characters.
    const chunks = [];
    let rest = rawLine;
    while (rest.length > 95) { chunks.push(rest.slice(0, 95)); rest = rest.slice(95); }
    chunks.push(rest);
    for (const chunk of chunks) {
      if (y < 50) { page = pdfDoc.addPage([595, 842]); y = 800; }
      page.drawText(chunk, { x: 48, y, size: 11, font: helv, color: PDFLib.rgb(0, 0, 0) });
      y -= 15;
    }
  }
}
async function embedImage(pdfDoc, f) {
  const bytes = await readAsArrayBuffer(f.file);
  if (f.ext === 'png') return await pdfDoc.embedPng(bytes);
  // JPG / WebP: draw via canvas to JPEG bytes (WebP is not natively embeddable).
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = f.dataUrl; });
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
  canvas.getContext('2d').drawImage(img, 0, 0);
  const blob = await canvasToBlob(canvas, 'image/jpeg', 0.92);
  return await pdfDoc.embedJpg(await blob.arrayBuffer());
}

/* ---------- N-up: several pages on one sheet ---------- */
/* Lay several source pages onto each output sheet (2 or 4 per sheet;
   1 = normal and never reaches this helper). Each item is an
   already-embedded page ({embeddedPage, width, height}) or an embedded
   image ({img, width, height}). Sheets are A4 portrait with a margin;
   each source keeps its proportions and is centred in its cell. */
function addNupPages(out, items, perSheet) {
  const SHEET_W = 595, SHEET_H = 842, MARGIN = 24;
  const cols = perSheet === 4 ? 2 : 1;
  const rows = 2;
  const cellW = (SHEET_W - MARGIN * (cols + 1)) / cols;
  const cellH = (SHEET_H - MARGIN * (rows + 1)) / rows;
  for (let i = 0; i < items.length; i += perSheet) {
    const page = out.addPage([SHEET_W, SHEET_H]);
    const group = items.slice(i, i + perSheet);
    group.forEach((item, k) => {
      const col = k % cols, row = Math.floor(k / cols);
      const cellX = MARGIN + col * (cellW + MARGIN);
      const cellTop = SHEET_H - MARGIN - row * (cellH + MARGIN);
      const scale = Math.min(cellW / item.width, cellH / item.height);
      const w = item.width * scale, h = item.height * scale;
      const x = cellX + (cellW - w) / 2;
      const y = cellTop - cellH + (cellH - h) / 2;
      if (item.embeddedPage) page.drawPage(item.embeddedPage, { x, y, width: w, height: h });
      else page.drawImage(item.img, { x, y, width: w, height: h });
    });
  }
}

/* ---------- Merge ---------- */
async function doMerge() {
  if (!PDFLib) throw new Error('PDF library did not load. Check your connection and reload.');
  const ordered = joinOrder.map((id) => files.find((x) => x.id === id)).filter(Boolean);
  if (ordered.length < 2) { setStatus('Joining needs 2 or more files.', true); return; }
  setStatus('Joining ' + ordered.length + ' files…');
  const perSheet = Number($('joinNup').value) || 1;
  if (perSheet !== 1) { await doMergeNup(ordered, perSheet); return; }
  const out = await PDFLib.PDFDocument.create();
  for (const f of ordered) {
    if (f.kind === 'pdf') {
      const src = await loadPdfLibDoc(f);
      const pages = await out.copyPages(src, src.getPageIndices());
      pages.forEach((p) => out.addPage(p));
    } else if (f.kind === 'image') {
      const img = await embedImage(out, f);
      const page = out.addPage([img.width, img.height]);
      page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
    } else {
      await addTextPages(out, f.text || '');
    }
  }
  const bytes = await out.save();
  prepareDownload(new Blob([bytes], { type: 'application/pdf' }), 'filenora-merged.pdf',
    'Joined ' + ordered.length + ' files into one PDF (' + fmtSize(bytes.length) + ').', ordered.map((f) => f.id));
  setResult('Done — 1 PDF made from ' + ordered.length + ' files (' + fmtSize(bytes.length) + ').');
  setStatus('Done. Your download unlocks after the 10-second countdown below.');
}

/* Join with 2 or 4 pages on each sheet: every source page (PDF pages,
   photos, and text pages) is embedded, then laid out in a grid — the
   same N-up layout as the PDF editor's save. */
async function doMergeNup(ordered, perSheet) {
  const out = await PDFLib.PDFDocument.create();
  const items = [];
  for (const f of ordered) {
    if (f.kind === 'pdf') {
      const src = await loadPdfLibDoc(f);
      for (let i = 0; i < src.getPageCount(); i++) {
        const page = src.getPage(i);
        const embedded = await out.embedPage(page);
        items.push({ embeddedPage: embedded, width: page.getWidth(), height: page.getHeight() });
      }
    } else if (f.kind === 'image') {
      const img = await embedImage(out, f);
      items.push({ img, width: img.width, height: img.height });
    } else {
      /* Text files: lay the text out on plain pages first, then embed
         those pages like any other. */
      const tmp = await PDFLib.PDFDocument.create();
      await addTextPages(tmp, f.text || '');
      for (let i = 0; i < tmp.getPageCount(); i++) {
        const page = tmp.getPage(i);
        const embedded = await out.embedPage(page);
        items.push({ embeddedPage: embedded, width: page.getWidth(), height: page.getHeight() });
      }
    }
  }
  addNupPages(out, items, perSheet);
  const bytes = await out.save();
  prepareDownload(new Blob([bytes], { type: 'application/pdf' }), 'filenora-merged.pdf',
    'Joined ' + ordered.length + ' files into one PDF with ' + perSheet + ' pages on each sheet (' + fmtSize(bytes.length) + ').', ordered.map((f) => f.id));
  setResult('Done — 1 PDF made from ' + ordered.length + ' files, ' + perSheet + ' pages on each sheet (' + fmtSize(bytes.length) + ').');
  setStatus('Done. Your download unlocks after the 10-second countdown below.');
}

/* ---------- Images to PDF ---------- */
/* "Fit to photo" makes each page the size of its photo (the old
   behaviour). "A4" puts each photo centred on an A4 page, keeping
   its proportions, with a margin around it. */
async function imagesToPdf(images) {
  if (!images.length) { setStatus('Add a JPG, PNG or WebP photo first.', true); return; }
  const pageSize = ($('jpg2pdfPageSize') && $('jpg2pdfPageSize').value) || 'fit';
  const out = await PDFLib.PDFDocument.create();
  for (const f of images) {
    const img = await embedImage(out, f);
    if (pageSize === 'a4') {
      const page = out.addPage([595, 842]);
      const margin = 48;
      const scale = Math.min((595 - margin * 2) / img.width, (842 - margin * 2) / img.height);
      const w = img.width * scale, h = img.height * scale;
      page.drawImage(img, { x: (595 - w) / 2, y: (842 - h) / 2, width: w, height: h });
    } else {
      const page = out.addPage([img.width, img.height]);
      page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
    }
  }
  const bytes = await out.save();
  prepareDownload(new Blob([bytes], { type: 'application/pdf' }), 'filenora-images.pdf',
    'Created a PDF from ' + images.length + ' image(s) (' + fmtSize(bytes.length) + ').', images.map((f) => f.id));
  setResult('Done — 1 PDF made from ' + images.length + ' photo(s) (' + fmtSize(bytes.length) + ').');
}

/* ---------- Convert one file ---------- */
async function convertFile(f, fmt) {
  if (f.kind === 'pdf' && fmt === 'txt') return pdfToText(f);
  if (f.kind === 'pdf' && (fmt === 'jpg' || fmt === 'png')) return pdfToImages(f, fmt);
  if ((f.kind === 'text' || f.kind === 'docx') && fmt === 'pdf') {
    const out = await PDFLib.PDFDocument.create();
    await addTextPages(out, f.text || '');
    const bytes = await out.save();
    return prepareDownload(new Blob([bytes], { type: 'application/pdf' }), baseName(f.name) + '.pdf',
      'Converted ' + f.name + ' to PDF (' + fmtSize(bytes.length) + ').', [f.id]);
  }
  if ((f.kind === 'text' || f.kind === 'docx') && fmt === 'txt') {
    return prepareDownload(new Blob([f.text || ''], { type: 'text/plain' }), baseName(f.name) + '.txt',
      'Saved the text of ' + f.name + ' as a TXT file.', [f.id]);
  }
  if (f.kind === 'image' && fmt === 'pdf') return imagesToPdf([f]);
  if (f.kind === 'image' && ['jpg', 'png', 'webp'].includes(fmt)) {
    const blob = await imageToFormat(f, fmt, 0.92);
    if (!blob) throw new Error('Could not convert that image.');
    return prepareDownload(blob, baseName(f.name) + '.' + fmt,
      'Converted ' + f.name + ' to ' + fmt.toUpperCase() + ' (' + fmtSize(blob.size) + ').', [f.id]);
  }
  setStatus('That conversion is not supported in v1.', true);
}
async function imageToFormat(f, fmt, quality) {
  const mime = fmt === 'jpg' ? 'image/jpeg' : fmt === 'png' ? 'image/png' : 'image/webp';
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = f.dataUrl; });
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (fmt === 'jpg') { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
  ctx.drawImage(img, 0, 0);
  return await canvasToBlob(canvas, mime, quality);
}
async function pdfToImages(f, fmt) {
  const mime = fmt === 'png' ? 'image/png' : 'image/jpeg';
  const typeLabel = fmt.toUpperCase();
  for (let p = 1; p <= f.pageCount; p++) {
    const page = await f.pdfDoc.getPage(p);
    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width); canvas.height = Math.floor(viewport.height);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    const blob = await canvasToBlob(canvas, mime, 0.92);
    prepareDownload(blob, baseName(f.name) + '-page-' + p + '.' + fmt,
      'Page ' + p + ' of ' + f.name + ' as ' + typeLabel + ' (' + fmtSize(blob.size) + ').', [f.id]);
  }
  setStatus('Converted ' + f.pageCount + ' page(s) to ' + typeLabel + '. Downloads unlock after the countdown.');
}
async function pdfToText(f) {
  let all = '';
  for (let p = 1; p <= f.pageCount; p++) {
    const page = await f.pdfDoc.getPage(p);
    const content = await page.getTextContent();
    const line = content.items.map((it) => it.str).join(' ');
    all += line + '\n\n';
  }
  if (!all.trim()) { setStatus('This PDF has no extractable text (it may be a scanned image). Try a PDF with real text.', true); return; }
  prepareDownload(new Blob([all], { type: 'text/plain' }), baseName(f.name) + '.txt',
    'Extracted text from ' + f.name + ' (' + fmtSize(all.length) + ').', [f.id]);
}

/* ---------- Compress ---------- */
/* Two honest guards, because re-rendering a PDF as images can make a
   tiny file BIGGER (a 1.1 KB text PDF re-rendered as JPEG pages came
   out at 11.8 KB):
   1. If the file is already at or under the target, do NOT re-encode
      it — offer the original file back and say so plainly.
   2. If the compressed version ends up LARGER than the original, do
      NOT present it as a success — offer the original instead.
   Each file records its outcome in compressResults so the result line
   can say what actually happened, with both sizes. */
async function compressFile(f, kb) {
  const targetBytes = kb * 1024;
  const alreadyText = 'Already smaller than ' + fmtTarget(kb) + ' — your file is ' + fmtSize(f.size) + ', so there is nothing to shrink.';
  const offerOriginal = (note, kind, text) => {
    compressResults.push({ kind, text });
    const blob = f.kind === 'pdf' && f.arrayBuffer ? new Blob([f.arrayBuffer]) : f.file;
    prepareDownload(blob, f.name, note, [f.id]);
  };
  if (f.size <= targetBytes) {
    offerOriginal('Already under ' + fmtTarget(kb) + ' — this is your original file, unchanged.', 'already', alreadyText);
    return;
  }
  if (f.kind === 'image') {
    // Try lower JPEG/WebP quality, then smaller dimensions, until under target.
    let quality = 0.92, scale = 1, best = null;
    for (let attempt = 0; attempt < 8; attempt++) {
      const blob = await imageToFormatScaled(f, quality, scale);
      if (!blob) break;
      best = blob;
      if (blob.size <= targetBytes) break;
      if (quality > 0.35) quality -= 0.15;
      else scale *= 0.75;
    }
    if (!best) throw new Error('Could not compress that image.');
    const ext = f.ext === 'png' ? 'png' : 'jpg';
    if (best.size > f.size) {
      offerOriginal('Original file — the compressed version was bigger (' + fmtSize(best.size) + ').', 'grew',
        'We couldn’t make it smaller — the smallest readable version is ' + fmtSize(best.size) + ', bigger than your original ' + fmtSize(f.size) + '. Download your original file instead.');
      return;
    }
    const reached = best.size <= targetBytes;
    compressResults.push({ kind: reached ? 'reached' : 'notreached',
      text: reached
        ? 'Done — your file is ' + fmtSize(best.size) + ' (was ' + fmtSize(f.size) + '), under your ' + fmtTarget(kb) + ' limit.'
        : 'Done — your file is ' + fmtSize(best.size) + ' (was ' + fmtSize(f.size) + '). It can’t go below that and stay readable — try a bigger target like ' + fmtTarget(nextPreset(kb)) + '.' });
    prepareDownload(best, baseName(f.name) + '-compressed.' + ext,
      'Compressed ' + f.name + ' to ' + fmtSize(best.size) + ' (target ' + kb + ' KB). ' +
      (reached ? 'Target reached.' : 'Target not reached — this is the smallest we could make it without losing too much quality.'), [f.id]);
    return;
  }
  if (f.kind === 'pdf') {
    // Re-render pages as JPEG images at decreasing quality/scale.
    let quality = 0.85, scale = 1.0, bestBytes = null, bestSize = Infinity;
    for (let attempt = 0; attempt < 6; attempt++) {
      const out = await PDFLib.PDFDocument.create();
      for (let p = 1; p <= f.pageCount; p++) {
        const page = await f.pdfDoc.getPage(p);
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(viewport.width); canvas.height = Math.floor(viewport.height);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport }).promise;
        const blob = await canvasToBlob(canvas, 'image/jpeg', quality);
        const img = await out.embedJpg(await blob.arrayBuffer());
        const pg = out.addPage([img.width, img.height]);
        pg.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
      }
      const bytes = await out.save();
      bestBytes = bytes; bestSize = bytes.length;
      if (bytes.length <= targetBytes) break;
      if (quality > 0.35) quality -= 0.15; else scale *= 0.7;
    }
    if (bestSize > f.size) {
      offerOriginal('Original file — the compressed version was bigger (' + fmtSize(bestSize) + ').', 'grew',
        'We couldn’t make it smaller — the smallest readable version is ' + fmtSize(bestSize) + ', bigger than your original ' + fmtSize(f.size) + '. Download your original file instead.');
      return;
    }
    const reached = bestSize <= targetBytes;
    compressResults.push({ kind: reached ? 'reached' : 'notreached',
      text: reached
        ? 'Done — your file is ' + fmtSize(bestSize) + ' (was ' + fmtSize(f.size) + '), under your ' + fmtTarget(kb) + ' limit.'
        : 'Done — your file is ' + fmtSize(bestSize) + ' (was ' + fmtSize(f.size) + '). It can’t go below that and stay readable — try a bigger target like ' + fmtTarget(nextPreset(kb)) + '.' });
    prepareDownload(new Blob([bestBytes], { type: 'application/pdf' }), baseName(f.name) + '-compressed.pdf',
      'Compressed ' + f.name + ' to ' + fmtSize(bestSize) + ' (target ' + kb + ' KB). ' +
      (reached ? 'Target reached.' : 'Target not reached — this is the smallest we could make it while keeping the pages readable. Note: re-rendered PDFs become images, so their text is no longer selectable.'), [f.id]);
    return;
  }
  if (f.kind === 'text' || f.kind === 'docx') {
    const out = await PDFLib.PDFDocument.create();
    await addTextPages(out, f.text || '');
    const bytes = await out.save();
    if (bytes.length > f.size) {
      offerOriginal('Original file — the PDF version was bigger (' + fmtSize(bytes.length) + ').', 'grew',
        'We couldn’t make it smaller — the smallest readable version is ' + fmtSize(bytes.length) + ', bigger than your original ' + fmtSize(f.size) + '. Download your original file instead.');
      return;
    }
    compressResults.push({ kind: 'reached',
      text: 'Done — your file is ' + fmtSize(bytes.length) + ' (was ' + fmtSize(f.size) + '), under your ' + fmtTarget(kb) + ' limit.' });
    prepareDownload(new Blob([bytes], { type: 'application/pdf' }), baseName(f.name) + '.pdf',
      'Converted ' + f.name + ' to PDF (' + fmtSize(bytes.length) + '). Text files are already small, so there is little to compress.', [f.id]);
    return;
  }
  setStatus('Compress is not supported for that file type in v1.', true);
}
/* Next size preset above the current target, for the "try a bigger
   target" suggestion. */
function nextPreset(kb) {
  const presets = [50, 100, 150, 200, 250, 300, 500, 1024];
  return presets.find((p) => p > kb) || kb * 2;
}
async function imageToFormatScaled(f, quality, scale) {
  const fmt = f.ext === 'png' ? 'png' : 'jpg';
  const mime = fmt === 'png' ? 'image/png' : 'image/jpeg';
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = f.dataUrl; });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.floor(img.naturalHeight * scale));
  const ctx = canvas.getContext('2d');
  if (fmt === 'jpg') { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return await canvasToBlob(canvas, mime, quality);
}

/* ---------- Rotate ---------- */
async function rotatePdf(f, angle) {
  const deg = [90, 180, 270].includes(Number(angle)) ? Number(angle) : 90;
  const src = await loadPdfLibDoc(f);
  src.getPages().forEach((page) => {
    const cur = page.getRotation().angle;
    page.setRotation(PDFLib.degrees((cur + deg) % 360));
  });
  const bytes = await src.save();
  // Keep the rotated version as the file's new source, so further edits use it.
  f.arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  f.pdfDoc = await pdfjsLib.getDocument({ data: f.arrayBuffer.slice(0) }).promise;
  f.rotation = 0;
  prepareDownload(new Blob([bytes], { type: 'application/pdf' }), baseName(f.name) + '-rotated.pdf',
    'Rotated ' + f.name + ' by ' + deg + '° (' + fmtSize(bytes.length) + ').', [f.id]);
}

/* ---------- Split ---------- */
/* The split panel IS the task's options panel: it is shown whenever
   the "Keep only some pages" task is selected, and its own
   "Keep these pages" button is the task's action — there is no
   generic Step 3 button for this task. */
let splitFile = null;
function renderSplitPanel() {
  const panel = $('splitPanel');
  if (currentTask !== 'split') { panel.hidden = true; return; }
  panel.hidden = false;
  const pdf = files.find((x) => x.kind === 'pdf');
  const empty = $('splitEmpty');
  const controls = $('splitControls');
  if (!pdf) {
    splitFile = null;
    empty.hidden = false;
    controls.hidden = true;
    return;
  }
  empty.hidden = true;
  controls.hidden = false;
  /* Rebuild the checkboxes only when the PDF changes, so ticking
     choices are not wiped when another file is added. */
  if (splitFile !== pdf) {
    splitFile = pdf;
    const box = $('splitPages');
    box.innerHTML = '';
    for (let p = 1; p <= pdf.pageCount; p++) {
      const label = document.createElement('label');
      label.innerHTML = '<input type="checkbox" value="' + p + '" checked> Page ' + p;
      box.appendChild(label);
    }
    $('splitRange').value = '';
  }
}
/* Split page range: "1-3, 5" ticks pages 1, 2, 3 and 5, unticks the rest. */
function parseSplitRange(text, pageCount) {
  const pages = new Set();
  const parts = String(text || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return { error: 'Enter a page range, for example "1-3, 5".' };
  for (const part of parts) {
    const range = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      const a = Number(range[1]), b = Number(range[2]);
      if (a < 1 || b > pageCount || a > b) return { error: 'Page range "' + part + '" is out of range. This PDF has ' + pageCount + ' page(s).' };
      for (let p = a; p <= b; p++) pages.add(p);
    } else if (/^\d+$/.test(part)) {
      const p = Number(part);
      if (p < 1 || p > pageCount) return { error: 'Page ' + p + ' does not exist. This PDF has ' + pageCount + ' page(s).' };
      pages.add(p);
    } else {
      return { error: '"' + part + '" is not a valid page or range. Use numbers like "1-3, 5".' };
    }
  }
  return { pages: Array.from(pages).sort((a, b) => a - b) };
}
$('btnApplySplitRange').addEventListener('click', () => {
  if (!splitFile) return;
  const result = parseSplitRange($('splitRange').value, splitFile.pageCount);
  if (result.error) { setStatus(result.error, true); return; }
  document.querySelectorAll('#splitPages input[type="checkbox"]').forEach((c) => {
    c.checked = result.pages.includes(Number(c.value));
  });
  setStatus('Selected page(s): ' + result.pages.join(', ') + '. Tap “Keep these pages” when ready.');
});
$('btnDoSplit').addEventListener('click', async () => {
  if (!splitFile) return;
  const chosen = Array.from(document.querySelectorAll('#splitPages input:checked')).map((c) => Number(c.value) - 1);
  if (!chosen.length) { setStatus('Tick at least one page to keep.', true); return; }
  /* Show the working state first (and let it paint) — same as the
     Step 3 button — so a big PDF does not look stuck. */
  const btn = $('btnDoSplit');
  btn.disabled = true; btn.textContent = 'Working…';
  await new Promise((r) => setTimeout(r, 0));
  try {
    const src = await loadPdfLibDoc(splitFile);
    const out = await PDFLib.PDFDocument.create();
    const pages = await out.copyPages(src, chosen);
    pages.forEach((p) => out.addPage(p));
    const bytes = await out.save();
    prepareDownload(new Blob([bytes], { type: 'application/pdf' }), baseName(splitFile.name) + '-split.pdf',
      'Kept ' + chosen.length + ' page(s) from ' + splitFile.name + ' (' + fmtSize(bytes.length) + ').', [splitFile.id]);
    setResult('Done — new PDF with ' + chosen.length + ' page(s) (' + fmtSize(bytes.length) + ').');
  } finally {
    btn.disabled = false; btn.textContent = 'Keep these pages';
  }
});

/* ---------- Download: 10-second countdown, no bypass ---------- */
/* A fresh run replaces the previous run's outputs instead of letting
   duplicates pile up: prepareDownload() replaces an output that has
   the same filename, and clearOutputs() wipes the list at the start
   of a job run (see the Run handler). Outputs remember which file(s)
   produced them (sourceIds), so removing a file can drop its outputs. */
/* One clear result line, in plain words, above the downloads.
   Each job sets it when it finishes (e.g. "Done — your file is
   87 KB, under your 100 KB limit."). A fresh run clears it. */
function setResult(text) {
  resultText = text || '';
  const line = $('resultLine');
  if (line) { line.textContent = resultText; line.hidden = !resultText; }
}
function clearOutputs() {
  pendingOutputs = [];
  compressResults = [];
  resultText = '';
  if ($('resultLine')) $('resultLine').hidden = true;
  if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
  renderOutputs();
}
function prepareDownload(blob, filename, note, sourceIds) {
  const sources = Array.isArray(sourceIds) ? sourceIds : (sourceIds == null ? [] : [sourceIds]);
  const entry = { blob, filename, note, sourceIds: sources };
  /* Replace, don't append: re-running a job must not list the same
     output twice. */
  const existing = pendingOutputs.findIndex((o) => o.filename === filename);
  if (existing >= 0) pendingOutputs[existing] = entry;
  else pendingOutputs.push(entry);
  renderOutputs();
  startCountdown();
}
function renderOutputs() {
  const panel = $('downloadPanel');
  if (!pendingOutputs.length) { panel.hidden = true; $('outputList').innerHTML = ''; if ($('resultLine')) $('resultLine').hidden = true; return; }
  panel.hidden = false;
  const line = $('resultLine');
  if (line) { line.textContent = resultText || ''; line.hidden = !resultText; }
  const list = $('outputList');
  list.innerHTML = '';
  $('outputInfo').textContent = pendingOutputs.length === 1
    ? (pendingOutputs[0].note || '')
    : pendingOutputs.length + ' files ready.';
  pendingOutputs.forEach((o, idx) => {
    const item = document.createElement('div');
    item.className = 'output-item';
    item.innerHTML = '<span><strong>' + esc(o.filename) + '</strong> — ' + fmtSize(o.blob.size) + (o.note ? '<br><span class="muted small">' + esc(o.note) + '</span>' : '') + '</span>';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-primary btn-small download-btn';
    btn.textContent = 'Download';
    btn.disabled = true; // unlocked only by the countdown
    btn.addEventListener('click', () => downloadBlob(o.blob, o.filename));
    item.appendChild(btn);
    list.appendChild(item);
  });
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function startCountdown() {
  if (countdownTimer) clearInterval(countdownTimer);
  let remaining = 10;
  const update = () => {
    $('countdownText').textContent = remaining > 0
      ? 'Your download starts in ' + remaining + ' second' + (remaining === 1 ? '' : 's') + ' — this short wait keeps FileNora free.'
      : 'Download is unlocked.';
    /* Visible progress bar: the wait is something the user can see
       moving, not just a disabled button. */
    const fill = $('countdownFill');
    if (fill) fill.style.width = ((10 - remaining) / 10 * 100) + '%';
    /* The helper line must not keep saying "please wait" after the
       countdown has finished. It is restored on the next countdown. */
    const note = $('countdownNote');
    if (note) {
      note.textContent = remaining > 0
        ? 'Please wait — the download button unlocks after the countdown. This keeps FileNora free.'
        : 'Download is unlocked — this wait keeps FileNora free.';
    }
    document.querySelectorAll('.download-btn').forEach((b) => { b.disabled = remaining > 0; });
  };
  update();
  countdownTimer = setInterval(() => {
    remaining--;
    update();
    if (remaining <= 0) clearInterval(countdownTimer);
  }, 1000);
}

/* ---------- Edit PDF: whiteout + add text (best-effort font match) ---------- */
function openEditor(f) {
  editorFile = f;
  editorPage = 1;
  pendingTextPos = null;
  $('editorTitle').textContent = 'Remove a word — ' + f.name;
  const sel = $('editorPageSelect');
  sel.innerHTML = '';
  for (let p = 1; p <= f.pageCount; p++) {
    const opt = document.createElement('option');
    opt.value = String(p); opt.textContent = 'Page ' + p;
    sel.appendChild(opt);
  }
  $('editorModal').hidden = false;
  renderEditorPage();
  updateEditorPageNav();
}
$('editorPageSelect').addEventListener('change', () => { editorPage = Number($('editorPageSelect').value); pendingTextPos = null; renderEditorPage(); updateEditorPageNav(); });
/* Page navigation inside the PDF editor: Prev / Next move through the
   pages without closing the modal. Edits are stored per page, so moving
   away and back never loses what was done on another page. */
function updateEditorPageNav() {
  if (!editorFile) return;
  $('editorPageLabel').textContent = 'Page ' + editorPage + ' of ' + editorFile.pageCount;
  $('btnEditorPrev').disabled = editorPage <= 1;
  $('btnEditorNext').disabled = editorPage >= editorFile.pageCount;
}
function editorGoToPage(p) {
  if (!editorFile) return;
  editorPage = Math.max(1, Math.min(editorFile.pageCount, p));
  pendingTextPos = null; // a click position belongs to the old page
  $('editorPageSelect').value = String(editorPage);
  renderEditorPage();
  updateEditorPageNav();
}
$('btnEditorPrev').addEventListener('click', () => editorGoToPage(editorPage - 1));
$('btnEditorNext').addEventListener('click', () => editorGoToPage(editorPage + 1));
$('btnCloseEditor').addEventListener('click', () => { $('editorModal').hidden = true; renderPreviews(); });
$('modeWhiteout').addEventListener('click', () => { editMode = 'whiteout'; $('modeWhiteout').className = 'btn btn-primary btn-small'; $('modeText').className = 'btn btn-secondary btn-small'; });
$('modeText').addEventListener('click', () => { editMode = 'text'; $('modeText').className = 'btn btn-primary btn-small'; $('modeWhiteout').className = 'btn btn-secondary btn-small'; });
$('btnClearEdits').addEventListener('click', () => {
  if (editorFile) editorFile.edits[editorPage] = { whiteouts: [], texts: [] };
  drawEditorOverlay();
});
$('btnPlaceText').addEventListener('click', () => {
  if (!editorFile) return;
  const text = $('editTextInput').value.trim();
  if (!text) { setStatus('Type the text first, then click a spot on the page and click “Place text”.', true); return; }
  if (!pendingTextPos) { setStatus('Click a spot on the page first, then click “Place text”.', true); return; }
  const edits = editorFile.edits[editorPage] || (editorFile.edits[editorPage] = { whiteouts: [], texts: [] });
  edits.texts.push({
    fx: pendingTextPos.fx, fy: pendingTextPos.fy,
    text, size: Number($('editSize').value) || 12,
    color: $('editColor').value || '#000000'
  });
  pendingTextPos = null;
  $('editTextInput').value = '';
  drawEditorOverlay();
});

async function renderEditorPage() {
  if (!editorFile) return;
  const page = await editorFile.pdfDoc.getPage(editorPage);
  const viewport = page.getViewport({ scale: 1.4 });
  const canvas = $('editorCanvas');
  canvas.width = Math.floor(viewport.width); canvas.height = Math.floor(viewport.height);
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  const overlay = $('editorOverlay');
  overlay.width = canvas.width; overlay.height = canvas.height;
  overlay.style.width = canvas.width + 'px'; overlay.style.height = canvas.height + 'px';
  // Best-effort font detection: most common text size on this page.
  try {
    const content = await page.getTextContent();
    const sizes = content.items.map((it) => Math.round(Math.abs(it.transform[3]) || Math.abs(it.transform[0]) || 0)).filter((s) => s >= 6 && s <= 72);
    if (sizes.length) {
      const counts = {};
      sizes.forEach((s) => { counts[s] = (counts[s] || 0) + 1; });
      const common = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
      $('editSize').value = common;
      $('detectedInfo').textContent = 'Detected text on this page is about ' + common + ' pt — that size is pre-filled above. Font match is best-effort: the original font is often embedded and cannot be matched exactly, so the closest standard font is used.';
    } else {
      $('detectedInfo').textContent = 'No selectable text was detected on this page (it may be a scanned image). Font match is best-effort.';
    }
  } catch (e) {
    $('detectedInfo').textContent = 'Font match is best-effort.';
  }
  drawEditorOverlay();
}
function drawEditorOverlay() {
  const overlay = $('editorOverlay');
  const ctx = overlay.getContext('2d');
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  if (!editorFile) return;
  const edits = editorFile.edits[editorPage];
  if (!edits) return;
  edits.whiteouts.forEach((r) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(r.fx * overlay.width, r.fy * overlay.height, r.fw * overlay.width, r.fh * overlay.height);
    ctx.strokeStyle = '#0E9F8A'; ctx.strokeRect(r.fx * overlay.width, r.fy * overlay.height, r.fw * overlay.width, r.fh * overlay.height);
  });
  edits.texts.forEach((t) => {
    ctx.font = t.size * 1.4 + 'px Helvetica, Arial, sans-serif';
    ctx.fillStyle = t.color;
    ctx.fillText(t.text, t.fx * overlay.width, t.fy * overlay.height);
  });
  if (pendingTextPos) {
    ctx.strokeStyle = '#0E9F8A'; ctx.setLineDash([4, 4]);
    ctx.strokeRect(pendingTextPos.fx * overlay.width - 4, pendingTextPos.fy * overlay.height - 4, 8, 8);
    ctx.setLineDash([]);
  }
}
function overlayPos(e) {
  const rect = $('editorOverlay').getBoundingClientRect();
  return {
    fx: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
    fy: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))
  };
}
$('editorOverlay').addEventListener('mousedown', (e) => {
  if (editMode === 'whiteout') dragStart = overlayPos(e);
  else { pendingTextPos = overlayPos(e); drawEditorOverlay(); $('editTextInput').focus(); }
});
$('editorOverlay').addEventListener('mousemove', (e) => {
  if (!dragStart || editMode !== 'whiteout') return;
  const cur = overlayPos(e);
  drawEditorOverlay();
  const ctx = $('editorOverlay').getContext('2d');
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.fillRect(dragStart.fx * ctx.canvas.width, dragStart.fy * ctx.canvas.height,
    (cur.fx - dragStart.fx) * ctx.canvas.width, (cur.fy - dragStart.fy) * ctx.canvas.height);
});
$('editorOverlay').addEventListener('mouseup', (e) => {
  if (!dragStart || editMode !== 'whiteout') { dragStart = null; return; }
  const start = dragStart;
  const cur = overlayPos(e);
  dragStart = null;
  const w = cur.fx - start.fx, h = cur.fy - start.fy;
  if (Math.abs(w) < 0.01 || Math.abs(h) < 0.01) { drawEditorOverlay(); return; }
  if (!editorFile) return;
  const edits = editorFile.edits[editorPage] || (editorFile.edits[editorPage] = { whiteouts: [], texts: [] });
  edits.whiteouts.push({
    fx: Math.min(start.fx, cur.fx), fy: Math.min(start.fy, cur.fy),
    fw: Math.abs(w), fh: Math.abs(h)
  });
  drawEditorOverlay();
});
$('btnSaveEdit').addEventListener('click', async () => {
  if (!editorFile) return;
  try {
    const src = await loadPdfLibDoc(editorFile);
    const helv = await src.embedFont(PDFLib.StandardFonts.Helvetica);
    const pages = src.getPages();
    Object.entries(editorFile.edits).forEach(([pageNum, edits]) => {
      const page = pages[Number(pageNum) - 1];
      if (!page) return;
      const { width, height } = page.getSize();
      (edits.whiteouts || []).forEach((r) => {
        page.drawRectangle({
          x: r.fx * width, y: height - (r.fy + r.fh) * height,
          width: r.fw * width, height: r.fh * height,
          color: PDFLib.rgb(1, 1, 1)
        });
      });
      (edits.texts || []).forEach((t) => {
        const c = t.color || '#000000';
        const r = parseInt(c.slice(1, 3), 16) / 255, g = parseInt(c.slice(3, 5), 16) / 255, b = parseInt(c.slice(5, 7), 16) / 255;
        page.drawText(t.text, {
          x: t.fx * width, y: height - t.fy * height - t.size,
          size: t.size, font: helv, color: PDFLib.rgb(r, g, b)
        });
      });
    });
    const bytes = await (async () => {
      const perSheet = Number($('editorNup').value) || 1;
      if (perSheet === 1) return await src.save();
      /* N-up: lay 2 or 4 edited pages onto each new sheet. */
      const out = await PDFLib.PDFDocument.create();
      const items = [];
      for (const p of src.getPages()) {
        const embedded = await out.embedPage(p);
        items.push({ embeddedPage: embedded, width: p.getWidth(), height: p.getHeight() });
      }
      addNupPages(out, items, perSheet);
      return await out.save();
    })();
    editorFile.arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    editorFile.pdfDoc = await pdfjsLib.getDocument({ data: editorFile.arrayBuffer.slice(0) }).promise;
    editorFile.pageCount = editorFile.pdfDoc.numPages;
    /* The edits are now baked into the saved file — clear them so they
       are not applied a second time if the file is edited again. With
       N-up the page count also changed, so old per-page edits would
       point at the wrong pages. */
    editorFile.edits = {};
    editorPage = 1;
    const perSheet = Number($('editorNup').value) || 1;
    $('editorModal').hidden = true;
    prepareDownload(new Blob([bytes], { type: 'application/pdf' }), baseName(editorFile.name) + '-edited.pdf',
      'Saved your edited PDF (' + fmtSize(bytes.length) + '). Font match is best-effort, as shown in the editor.' + (perSheet > 1 ? ' ' + perSheet + ' pages on each sheet.' : ''), [editorFile.id]);
    setResult('Done — your edited PDF is ready' + (perSheet > 1 ? ' with ' + perSheet + ' pages on each sheet' : '') + ' (' + fmtSize(bytes.length) + ').');
    renderAll();
    setStatus('Edited PDF ready. Download unlocks after the countdown.');
  } catch (err) {
    setStatus('Could not save the edited PDF: ' + (err && err.message ? err.message : 'unknown error'), true);
  }
});

/* ---------- Edit image: crop, rotate/flip, resize, adjust, filters, text ---------- */
/* The image editor works on one file at a time, in a modal. Its working
   state (imgEd) holds a base canvas with the current pixels — rotate,
   flip, crop and resize are baked into that canvas as they happen —
   plus live settings (adjust sliders, filter, placed text) drawn on top
   at render time. Text positions are fractions of the canvas, so they
   survive rotate, flip, crop and resize. "Done" exports the canvas back
   into the same file slot (same id, name and list position); "Cancel"
   throws the edits away. DOCX / TXT use the text editor instead. */
let imgEd = null;        // working state for the image being edited
let imgEdCropDrag = null; // {fx, fy} while dragging a crop box

/* One Edit button, three editors: PDFs open the existing PDF editor
   (whiteout + add text), images open the image editor below, and
   DOCX / TXT open the text editor. */
function openFileEditor(f) {
  if (f.kind === 'pdf') { openEditor(f); return; }
  if (f.kind === 'image') { openImageEditor(f); return; }
  if (f.kind === 'docx' || f.kind === 'text') { openTextEditor(f); return; }
}

/* ---------- Edit text: DOCX and TXT ---------- */
/* The text editor shows the document's text in a plain textarea.
   For a Word file only the text is kept — bold, tables, pictures and
   other formatting are not saved, and the note above the editor says
   so. "Done" builds a new .docx from the edited text (one paragraph
   per blank-line gap) or replaces the .txt content. The file is
   replaced in place: same id, name and position — the same pattern as
   the image editor's Done. */
let textEdFile = null;
function openTextEditor(f) {
  textEdFile = f;
  $('textEditorTitle').textContent = 'Edit text — ' + f.name;
  $('textEditorArea').value = f.text || '';
  $('textEditorError').hidden = true;
  $('textEditorError').textContent = '';
  /* The Word warning is its own prominent line at the top of the
     modal, not buried in the note: only the text is kept, and a
     rebuilt Word file can grow. It shows for DOCX only. */
  const warn = $('textEditorWarning');
  if (warn) warn.hidden = f.kind !== 'docx';
  $('textEditorNote').textContent = f.kind === 'docx'
    ? 'Edit the text below, then tap Done to keep your changes. A new Word file is made from this text, with one paragraph per blank-line gap.'
    : 'Edit the text below, then tap Done to keep your changes.';
  $('textEditorModal').hidden = false;
  $('textEditorArea').focus();
}
function textEdClose() { $('textEditorModal').hidden = true; textEdFile = null; }
function textEdShowError(msg) {
  const el = $('textEditorError');
  el.textContent = msg;
  el.hidden = false;
}
async function textEdDone() {
  if (!textEdFile) return;
  const f = textEdFile;
  const newText = $('textEditorArea').value;
  try {
    if (f.kind === 'docx') {
      if (!window.docx || !window.docx.Document || !window.docx.Packer) {
        textEdShowError('The Word library did not load. Check your connection and reload the page, then try again.');
        return;
      }
      const paras = String(newText).split(/\r?\n\s*\r?\n/).map((p) => p.replace(/\s*\r?\n\s*/g, ' ').trim()).filter((p) => p.length);
      if (!paras.length) paras.push('');
      const doc = new window.docx.Document({
        sections: [{ children: paras.map((p) => new window.docx.Paragraph({ children: [new window.docx.TextRun(p)] })) }]
      });
      const blob = await window.docx.Packer.toBlob(doc);
      if (!blob) throw new Error('Could not build the Word file.');
      const newFile = new File([blob], f.name, { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', lastModified: Date.now() });
      f.file = newFile; f.size = blob.size; f.text = newText;
    } else {
      const blob = new Blob([newText], { type: 'text/plain' });
      const newFile = new File([blob], f.name, { type: 'text/plain', lastModified: Date.now() });
      f.file = newFile; f.size = blob.size; f.text = newText;
    }
    /* Drop any downloads made from the old version of this file, so
       stale outputs never linger after an edit. */
    pendingOutputs = pendingOutputs.filter((o) => !(o.sourceIds || []).includes(f.id));
    renderOutputs();
    textEdClose();
    renderAll();
    setStatus('Saved your edits to ' + f.name + ' — it is now ' + fmtSize(f.size) + '.');
  } catch (err) {
    textEdShowError('Could not save the edited file: ' + (err && err.message ? err.message : 'unknown error'));
  }
}
$('btnTextDone').addEventListener('click', textEdDone);
$('btnTextCancel').addEventListener('click', textEdClose);
$('btnCloseTextEditor').addEventListener('click', textEdClose);

async function openImageEditor(f) {
  const img = new Image();
  try {
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('Could not load that image.')); img.src = f.dataUrl; });
  } catch (err) {
    setStatus('Could not open the editor: ' + (err && err.message ? err.message : 'unknown error'), true);
    return;
  }
  const base = document.createElement('canvas');
  base.width = img.naturalWidth || img.width || 1;
  base.height = img.naturalHeight || img.height || 1;
  base.getContext('2d').drawImage(img, 0, 0);
  imgEd = {
    file: f, img, base, w: base.width, h: base.height,
    filter: 'none', bright: 1, contrast: 1, sat: 1,
    texts: [], history: [], crop: null, cropMode: false, textMode: false,
    pendingText: null, adjusting: false
  };
  $('imgEditorTitle').textContent = 'Edit image — ' + f.name;
  $('imgWidth').value = imgEd.w;
  $('imgHeight').value = imgEd.h;
  imgEdSyncAdjustInputs();
  $('imgTextInput').value = '';
  $('imgEditorInfo').textContent = imgEd.w + ' × ' + imgEd.h + ' px — ' + fmtSize(f.size) + '. Edits stay on your device until you tap Done.';
  $('imgEditorModal').hidden = false;
  imgEdSetCropMode(false);
  imgEdSetTextMode(false);
  drawImgEditor();
}
function imgEdFilterString() {
  if (!imgEd) return 'none';
  const parts = [];
  if (imgEd.bright !== 1) parts.push('brightness(' + imgEd.bright + ')');
  if (imgEd.contrast !== 1) parts.push('contrast(' + imgEd.contrast + ')');
  if (imgEd.sat !== 1) parts.push('saturate(' + imgEd.sat + ')');
  if (imgEd.filter === 'grayscale') parts.push('grayscale(1)');
  if (imgEd.filter === 'sepia') parts.push('sepia(1)');
  if (imgEd.filter === 'invert') parts.push('invert(1)');
  return parts.join(' ') || 'none';
}
function drawImgEditor() {
  if (!imgEd) return;
  const canvas = $('imgEditorCanvas');
  canvas.width = imgEd.w; canvas.height = imgEd.h;
  const ctx = canvas.getContext('2d');
  ctx.filter = imgEdFilterString();
  ctx.drawImage(imgEd.base, 0, 0, imgEd.w, imgEd.h);
  ctx.filter = 'none';
  imgEd.texts.forEach((t) => {
    ctx.font = 'bold ' + t.size + 'px Helvetica, Arial, sans-serif';
    ctx.fillStyle = t.color;
    ctx.fillText(t.text, t.fx * imgEd.w, t.fy * imgEd.h);
  });
  if (imgEd.pendingText) {
    ctx.strokeStyle = '#0E9F8A'; ctx.setLineDash([4, 4]);
    ctx.strokeRect(imgEd.pendingText.fx * imgEd.w - 5, imgEd.pendingText.fy * imgEd.h - 5, 10, 10);
    ctx.setLineDash([]);
  }
  if (imgEd.crop) {
    const c = imgEd.crop;
    /* Dim everything outside the crop box so the kept part is clear. */
    ctx.fillStyle = 'rgba(15,42,67,0.25)';
    ctx.fillRect(0, 0, imgEd.w, c.fy * imgEd.h);
    ctx.fillRect(0, (c.fy + c.fh) * imgEd.h, imgEd.w, imgEd.h - (c.fy + c.fh) * imgEd.h);
    ctx.fillRect(0, c.fy * imgEd.h, c.fx * imgEd.w, c.fh * imgEd.h);
    ctx.fillRect((c.fx + c.fw) * imgEd.w, c.fy * imgEd.h, imgEd.w - (c.fx + c.fw) * imgEd.w, c.fh * imgEd.h);
    ctx.strokeStyle = '#0E9F8A'; ctx.lineWidth = 2;
    ctx.strokeRect(c.fx * imgEd.w, c.fy * imgEd.h, c.fw * imgEd.w, c.fh * imgEd.h);
    ctx.lineWidth = 1;
  }
}
/* Undo: each mutating action pushes a snapshot first (base canvas copy
   + live settings + placed text). 20 steps max. */
function imgEdSnapshot() {
  const copy = document.createElement('canvas');
  copy.width = imgEd.w; copy.height = imgEd.h;
  copy.getContext('2d').drawImage(imgEd.base, 0, 0);
  return {
    base: copy, w: imgEd.w, h: imgEd.h,
    filter: imgEd.filter, bright: imgEd.bright, contrast: imgEd.contrast, sat: imgEd.sat,
    texts: imgEd.texts.map((t) => ({ ...t }))
  };
}
function imgEdPushHistory() {
  if (!imgEd) return;
  imgEd.history.push(imgEdSnapshot());
  if (imgEd.history.length > 20) imgEd.history.shift();
}
function imgEdUndo() {
  if (!imgEd || !imgEd.history.length) return;
  const s = imgEd.history.pop();
  imgEd.base = s.base; imgEd.w = s.w; imgEd.h = s.h;
  imgEd.filter = s.filter; imgEd.bright = s.bright; imgEd.contrast = s.contrast; imgEd.sat = s.sat;
  imgEd.texts = s.texts;
  imgEd.crop = null; imgEd.adjusting = false;
  $('imgWidth').value = imgEd.w; $('imgHeight').value = imgEd.h;
  imgEdSyncAdjustInputs();
  drawImgEditor();
}
function imgEdSyncAdjustInputs() {
  if (!imgEd) return;
  $('imgBright').value = String(imgEd.bright);
  $('imgContrast').value = String(imgEd.contrast);
  $('imgSat').value = String(imgEd.sat);
  document.querySelectorAll('.img-filter').forEach((b) => b.classList.toggle('active', b.dataset.filter === imgEd.filter));
}
async function imgEdReset() {
  if (!imgEd) return;
  const f = imgEd.file;
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = f.dataUrl; });
  const base = document.createElement('canvas');
  base.width = img.naturalWidth || img.width || 1;
  base.height = img.naturalHeight || img.height || 1;
  base.getContext('2d').drawImage(img, 0, 0);
  imgEd.base = base; imgEd.w = base.width; imgEd.h = base.height;
  imgEd.filter = 'none'; imgEd.bright = 1; imgEd.contrast = 1; imgEd.sat = 1;
  imgEd.texts = []; imgEd.history = []; imgEd.crop = null; imgEd.adjusting = false;
  $('imgWidth').value = imgEd.w; $('imgHeight').value = imgEd.h;
  imgEdSyncAdjustInputs();
  drawImgEditor();
}
/* Rotate: baked into the base canvas (dimensions swap), and placed
   text moves with the image — a point at fraction (fx, fy) goes to
   (1-fy, fx) for a clockwise turn, (fy, 1-fx) for anti-clockwise. */
function imgEdRotate(dir) { // dir: +1 right (clockwise), -1 left
  if (!imgEd) return;
  imgEdPushHistory();
  const oldW = imgEd.w, oldH = imgEd.h;
  imgEd.w = oldH; imgEd.h = oldW;
  const src = imgEd.base;
  const next = document.createElement('canvas');
  next.width = imgEd.w; next.height = imgEd.h;
  const ctx = next.getContext('2d');
  ctx.translate(imgEd.w / 2, imgEd.h / 2);
  ctx.rotate(dir * Math.PI / 2);
  ctx.drawImage(src, -oldW / 2, -oldH / 2, oldW, oldH);
  imgEd.base = next;
  imgEd.texts = imgEd.texts.map((t) => dir === 1
    ? { ...t, fx: 1 - t.fy, fy: t.fx }
    : { ...t, fx: t.fy, fy: 1 - t.fx });
  $('imgWidth').value = imgEd.w; $('imgHeight').value = imgEd.h;
  drawImgEditor();
}
function imgEdFlip(horizontal) {
  if (!imgEd) return;
  imgEdPushHistory();
  const src = imgEd.base;
  const next = document.createElement('canvas');
  next.width = imgEd.w; next.height = imgEd.h;
  const ctx = next.getContext('2d');
  if (horizontal) { ctx.translate(imgEd.w, 0); ctx.scale(-1, 1); }
  else { ctx.translate(0, imgEd.h); ctx.scale(1, -1); }
  ctx.drawImage(src, 0, 0);
  imgEd.base = next;
  imgEd.texts = imgEd.texts.map((t) => horizontal ? { ...t, fx: 1 - t.fx } : { ...t, fy: 1 - t.fy });
  drawImgEditor();
}
function imgEdSetFilter(name) {
  if (!imgEd || imgEd.filter === name) return;
  imgEdPushHistory();
  imgEd.filter = name;
  imgEdSyncAdjustInputs();
  drawImgEditor();
}
/* Sliders preview live while dragging; one undo step is pushed at the
   start of each drag, and cleared when the drag ends. */
function imgEdSetAdjust(key, value) {
  if (!imgEd) return;
  if (!imgEd.adjusting) { imgEdPushHistory(); imgEd.adjusting = true; }
  imgEd[key] = value;
  drawImgEditor();
}
function imgEdEndAdjust() { if (imgEd) imgEd.adjusting = false; }
function imgEdApplyResize() {
  if (!imgEd) return;
  let w = Math.round(Number($('imgWidth').value) || imgEd.w);
  let h = Math.round(Number($('imgHeight').value) || imgEd.h);
  if (w < 1 || h < 1) { setStatus('Width and height must be at least 1 pixel.', true); return; }
  if ($('imgLockRatio').checked) {
    /* With the lock on, the width wins and the height follows it. */
    h = Math.max(1, Math.round(w * imgEd.h / imgEd.w));
    $('imgHeight').value = h;
  }
  if (w === imgEd.w && h === imgEd.h) return;
  imgEdPushHistory();
  const next = document.createElement('canvas');
  next.width = w; next.height = h;
  next.getContext('2d').drawImage(imgEd.base, 0, 0, w, h);
  imgEd.base = next; imgEd.w = w; imgEd.h = h;
  drawImgEditor();
}
function imgEdSetCropMode(on) {
  if (!imgEd) return;
  imgEd.cropMode = on;
  imgEd.crop = null;
  $('btnImgCrop').classList.toggle('active', on);
  $('btnImgCropApply').hidden = !on;
  $('btnImgCropCancel').hidden = !on;
  $('imgCropHint').hidden = !on;
  $('imgEditorCanvas').classList.toggle('cropping', on);
  if (on) imgEdSetTextMode(false);
  drawImgEditor();
}
function imgEdSetTextMode(on) {
  if (!imgEd) return;
  imgEd.textMode = on;
  imgEd.pendingText = null;
  $('btnImgTextMode').classList.toggle('active', on);
  $('imgEditorCanvas').classList.toggle('texting', on);
  if (on) imgEdSetCropMode(false);
  drawImgEditor();
}
function imgEdCanvasPos(e) {
  const rect = $('imgEditorCanvas').getBoundingClientRect();
  return {
    fx: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
    fy: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))
  };
}
function imgEdApplyCrop() {
  if (!imgEd || !imgEd.crop) return;
  const c = imgEd.crop;
  if (c.fw < 0.01 || c.fh < 0.01) { setStatus('Drag a bigger box to crop.', true); return; }
  imgEdPushHistory();
  const cw = Math.max(1, Math.round(c.fw * imgEd.w));
  const ch = Math.max(1, Math.round(c.fh * imgEd.h));
  const next = document.createElement('canvas');
  next.width = cw; next.height = ch;
  next.getContext('2d').drawImage(imgEd.base, c.fx * imgEd.w, c.fy * imgEd.h, c.fw * imgEd.w, c.fh * imgEd.h, 0, 0, cw, ch);
  imgEd.base = next;
  /* Keep placed text that still falls inside the crop, re-based to the
     new canvas; text outside the crop is dropped with the pixels. */
  imgEd.texts = imgEd.texts
    .map((t) => ({ ...t, fx: (t.fx - c.fx) / c.fw, fy: (t.fy - c.fy) / c.fh }))
    .filter((t) => t.fx >= 0 && t.fx <= 1 && t.fy >= 0 && t.fy <= 1);
  imgEd.w = cw; imgEd.h = ch;
  $('imgWidth').value = cw; $('imgHeight').value = ch;
  imgEdSetCropMode(false);
  drawImgEditor();
}
$('imgEditorCanvas').addEventListener('pointerdown', (e) => {
  if (!imgEd) return;
  if (imgEd.cropMode) { imgEdCropDrag = imgEdCanvasPos(e); imgEd.crop = { fx: imgEdCropDrag.fx, fy: imgEdCropDrag.fy, fw: 0, fh: 0 }; drawImgEditor(); }
  else if (imgEd.textMode) { imgEd.pendingText = imgEdCanvasPos(e); drawImgEditor(); $('imgTextInput').focus(); }
});
$('imgEditorCanvas').addEventListener('pointermove', (e) => {
  if (!imgEd || !imgEd.cropMode || !imgEdCropDrag) return;
  const cur = imgEdCanvasPos(e);
  imgEd.crop = {
    fx: Math.min(imgEdCropDrag.fx, cur.fx), fy: Math.min(imgEdCropDrag.fy, cur.fy),
    fw: Math.abs(cur.fx - imgEdCropDrag.fx), fh: Math.abs(cur.fy - imgEdCropDrag.fy)
  };
  drawImgEditor();
});
$('imgEditorCanvas').addEventListener('pointerup', () => { imgEdCropDrag = null; });
$('btnImgPlaceText').addEventListener('click', () => {
  if (!imgEd) return;
  const text = $('imgTextInput').value.trim();
  if (!text) { setStatus('Type the text first, then click a spot on the image and tap “Place text”.', true); return; }
  if (!imgEd.pendingText) { setStatus('Click a spot on the image first, then tap “Place text”.', true); return; }
  imgEdPushHistory();
  imgEd.texts.push({
    fx: imgEd.pendingText.fx, fy: imgEd.pendingText.fy,
    text, size: Number($('imgTextSize').value) || 32,
    color: $('imgTextColor').value || '#000000'
  });
  imgEd.pendingText = null;
  $('imgTextInput').value = '';
  drawImgEditor();
});
async function imgEdDone() {
  if (!imgEd) return;
  const f = imgEd.file;
  try {
    /* Export the final image: base pixels + live filter/adjust + text,
       baked onto one canvas at the working size. */
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = imgEd.w; exportCanvas.height = imgEd.h;
    const ctx = exportCanvas.getContext('2d');
    ctx.filter = imgEdFilterString();
    ctx.drawImage(imgEd.base, 0, 0, imgEd.w, imgEd.h);
    ctx.filter = 'none';
    imgEd.texts.forEach((t) => {
      ctx.font = 'bold ' + t.size + 'px Helvetica, Arial, sans-serif';
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.fx * imgEd.w, t.fy * imgEd.h);
    });
    const mime = f.ext === 'png' ? 'image/png' : f.ext === 'webp' ? 'image/webp' : 'image/jpeg';
    const blob = await canvasToBlob(exportCanvas, mime, 0.92);
    if (!blob) throw new Error('Could not save the edited image.');
    const newFile = new File([blob], f.name, { type: mime, lastModified: Date.now() });
    const dataUrl = await readAsDataURL(newFile);
    /* Replace the file in place: same id, same name, same position in
       the list — only the pixels, size and preview change. The Join
       order and every other file are untouched. */
    f.file = newFile; f.size = blob.size; f.dataUrl = dataUrl;
    /* Drop any downloads made from the old version of this file, so
       stale outputs never linger after an edit. */
    pendingOutputs = pendingOutputs.filter((o) => !(o.sourceIds || []).includes(f.id));
    renderOutputs();
    $('imgEditorModal').hidden = true;
    imgEd = null;
    renderAll();
    setStatus('Saved your edits to ' + f.name + ' — it is now ' + fmtSize(f.size) + '.');
  } catch (err) {
    setStatus('Could not save the edited image: ' + (err && err.message ? err.message : 'unknown error'), true);
  }
}
function imgEdClose() { $('imgEditorModal').hidden = true; imgEd = null; }
$('btnImgDone').addEventListener('click', imgEdDone);
$('btnImgCancel').addEventListener('click', imgEdClose);
$('btnCloseImgEditor').addEventListener('click', imgEdClose);
$('btnImgUndo').addEventListener('click', imgEdUndo);
$('btnImgReset').addEventListener('click', () => { imgEdReset(); });
$('btnImgCrop').addEventListener('click', () => { if (imgEd) imgEdSetCropMode(!imgEd.cropMode); });
$('btnImgCropApply').addEventListener('click', imgEdApplyCrop);
$('btnImgCropCancel').addEventListener('click', () => imgEdSetCropMode(false));
$('btnImgRotL').addEventListener('click', () => imgEdRotate(-1));
$('btnImgRotR').addEventListener('click', () => imgEdRotate(1));
$('btnImgFlipH').addEventListener('click', () => imgEdFlip(true));
$('btnImgFlipV').addEventListener('click', () => imgEdFlip(false));
document.querySelectorAll('.img-filter').forEach((b) => b.addEventListener('click', () => imgEdSetFilter(b.dataset.filter)));
$('btnImgTextMode').addEventListener('click', () => { if (imgEd) imgEdSetTextMode(!imgEd.textMode); });
$('btnImgResize').addEventListener('click', imgEdApplyResize);
$('imgWidth').addEventListener('change', () => { if (imgEd && $('imgLockRatio').checked) $('imgHeight').value = Math.max(1, Math.round(Number($('imgWidth').value) * imgEd.h / imgEd.w)); });
$('imgHeight').addEventListener('change', () => { if (imgEd && $('imgLockRatio').checked) $('imgWidth').value = Math.max(1, Math.round(Number($('imgHeight').value) * imgEd.w / imgEd.h)); });
[['imgBright', 'bright'], ['imgContrast', 'contrast'], ['imgSat', 'sat']].forEach(([id, key]) => {
  $(id).addEventListener('input', () => imgEdSetAdjust(key, Number($(id).value)));
  $(id).addEventListener('change', imgEdEndAdjust);
});

/* ---------- Init ---------- */
setTargetKb(100);
updateTaskUI(); /* no task picked yet: action button waits for Step 1; status line set by updateTaskUI */
/* Deep link: ?task=<id> preselects that task on load (see syncTaskUrl).
   An unknown value is ignored — the page just loads with no task. */
(function preselectTaskFromUrl() {
  let task = null;
  try { task = new URLSearchParams(window.location.search).get('task'); } catch (e) { task = null; }
  if (task && TASKS[task]) selectTask(task);
})();
