/* Dockora v1 — all processing is client-side, in the browser.
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
let mergeMode = null;    // null | 'separate' | 'merge'
let mergeOrder = [];     // array of file ids, in merge order
let targetKb = 100;
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
function fmtSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
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
  $('targetLabel').textContent = 'Target: ' + (targetKb >= 1024 ? (targetKb / 1024).toFixed(targetKb % 1024 ? 1 : 0) + ' MB' : targetKb + ' KB');
  document.querySelectorAll('#sizePresets button').forEach((b) =>
    b.classList.toggle('active', Number(b.dataset.kb) === targetKb));
  /* Keep the per-file "Compress to X KB" buttons honest: re-render the
     file cards so their labels follow the new target. This only rebuilds
     the file list — previews and the merge prompt are left alone. */
  if (files.length) renderFileList();
}
document.querySelectorAll('#sizePresets button').forEach((b) =>
  b.addEventListener('click', () => setTargetKb(Number(b.dataset.kb))));
$('customKb').addEventListener('change', () => setTargetKb(Number($('customKb').value)));

/* ---------- Tools grid / job ---------- */
const JOB_HINTS = {
  merge: 'Add 2 or more files, then choose Merge or Separate.',
  compress: 'Add a PDF or image, pick a target size above, then Run.',
  convert: 'Add a file, then use the Convert control on its card, or Run.',
  split: 'Add a PDF, then tick the pages to keep, or type a page range.',
  edit: 'Add a PDF, then click Edit on its card.',
  rotate: 'Add a PDF, pick an angle, then Run — or click Rotate on its card for 90°.',
  jpg2pdf: 'Add JPG, PNG or WebP photos, then Run.',
  pdf2jpg: 'Add a PDF, choose JPG or PNG below, then Run.',
  resize: 'Add an image, pick a target size above, then Run.',
  pdf2txt: 'Add a PDF, then Run to extract its text.'
};
/* Show only the option panels that apply to the selected job.
   Target size is only for Compress / Resize; the format picker only
   for PDF to JPG / PNG; the angle picker only for Rotate. */
function updateJobPanels() {
  const job = $('jobSelect').value;
  $('targetSizePanel').hidden = !(job === 'compress' || job === 'resize');
  $('pdf2jpgPanel').hidden = job !== 'pdf2jpg';
  $('rotatePanel').hidden = job !== 'rotate';
}
function setJob(job) {
  $('jobSelect').value = job;
  $('jobHint').textContent = JOB_HINTS[job] || '';
  updateJobPanels();
  document.getElementById('workspace').scrollIntoView({ behavior: 'smooth' });
}
$('jobSelect').addEventListener('change', () => { $('jobHint').textContent = JOB_HINTS[$('jobSelect').value] || ''; updateJobPanels(); });
document.querySelectorAll('#toolsGrid .tool-card').forEach((b) =>
  b.addEventListener('click', () => setJob(b.dataset.job)));

/* ---------- Upload ---------- */
const dropzone = $('dropzone'), fileInput = $('fileInput');
/* Hero CTA: scroll to the workspace AND open the file picker. */
$('heroChooseBtn').addEventListener('click', () => {
  document.getElementById('workspace').scrollIntoView({ behavior: 'smooth' });
  fileInput.click();
});
$('chooseBtn').addEventListener('click', (e) => { e.stopPropagation(); fileInput.click(); });
dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
['dragenter', 'dragover'].forEach((ev) => dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add('dragging'); }));
['dragleave', 'drop'].forEach((ev) => dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.remove('dragging'); }));
dropzone.addEventListener('drop', (e) => handleFiles(e.dataTransfer.files));
fileInput.addEventListener('change', () => { handleFiles(fileInput.files); fileInput.value = ''; });

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
  /* Status always reports the TOTAL in the list, not just this batch. */
  const dupeNote = skippedDupes.length
    ? ' ' + skippedDupes.map((n) => '“' + n + '” is already added — skipped.').join(' ')
    : '';
  if (added) {
    setStatus(files.length + (files.length === 1 ? ' file' : ' files') + ' added. ' + (files.length >= 2 ? 'Choose Merge or Separate below.' : 'Pick a job and click Run.') + dupeNote);
    mergeMode = null; mergeOrder = files.map((f) => f.id);
    renderAll();
  } else if (skippedDupes.length) {
    /* Nothing new was added, but the status must still show the total
       count — not just the skip note. */
    setStatus(files.length + (files.length === 1 ? ' file' : ' files') + ' added. ' + (files.length >= 2 ? 'Choose Merge or Separate below.' : 'Pick a job and click Run.') + dupeNote);
  }
}

/* ---------- Render: file list, previews, merge prompt ---------- */
function renderAll() {
  renderFileList();
  renderPreviews();
  renderMergePrompt();
  $('splitPanel').hidden = true;
}
function renderMergePrompt() {
  const show = files.length >= 2 && mergeMode === null;
  $('mergePrompt').hidden = !show;
  $('mergeOrder').hidden = true;
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
    card.innerHTML =
      '<h4>' + esc(f.name) + '</h4>' +
      '<p class="file-meta">' + esc(meta) + ' &middot; ' + esc(f.ext.toUpperCase()) + ' &middot; ' + fmtSize(f.size) + '</p>' +
      '<div class="file-actions">' +
        (f.kind === 'pdf' ? '<button type="button" class="btn btn-secondary btn-small" data-act="edit">Edit PDF</button>' : '') +
        (f.kind === 'pdf' ? '<button type="button" class="btn btn-secondary btn-small" data-act="split">Split</button>' : '') +
        (f.kind === 'pdf' ? '<button type="button" class="btn btn-secondary btn-small" data-act="rotate">Rotate 90&deg;</button>' : '') +
        '<label>Convert to <select data-act="fmt">' +
          convertOptionsFor(f) +
        '</select></label>' +
        '<button type="button" class="btn btn-secondary btn-small" data-act="convert">Convert</button>' +
        '<button type="button" class="btn btn-secondary btn-small" data-act="compress">Compress to ' + targetKb + ' KB</button>' +
        '<button type="button" class="btn btn-secondary btn-small" data-act="remove">Remove</button>' +
      '</div>';
    card.querySelectorAll('[data-act]').forEach((btn) => {
      btn.addEventListener('click', () => fileAction(f, btn.dataset.act, card));
    });
    card.querySelectorAll('select[data-act="fmt"]').forEach((sel) => {
      sel.addEventListener('change', () => { /* selection is read at Convert time */ });
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

/* ---------- Merge prompt ---------- */
$('btnSeparate').addEventListener('click', () => {
  mergeMode = 'separate';
  $('mergePrompt').hidden = true;
  setStatus('Keeping files separate. Pick a job and click Run.');
});
$('btnMerge').addEventListener('click', () => {
  mergeMode = 'merge';
  mergeOrder = files.map((f) => f.id);
  renderMergeOrder();
  $('mergeOrder').hidden = false;
});
$('btnCancelMerge').addEventListener('click', () => { mergeMode = null; renderMergePrompt(); });
$('btnDoMerge').addEventListener('click', async () => { await doMerge(); });
function renderMergeOrder() {
  const list = $('mergeOrderList');
  list.innerHTML = '';
  mergeOrder.forEach((id, idx) => {
    const f = files.find((x) => x.id === id);
    if (!f) return;
    const li = document.createElement('li');
    li.draggable = true;
    li.dataset.id = String(id);
    li.innerHTML = '<span class="fname">' + (idx + 1) + '. ' + esc(f.name) + '</span>' +
      '<button type="button" class="btn btn-secondary btn-small" data-move="-1" ' + (idx === 0 ? 'disabled' : '') + '>&uarr; Up</button>' +
      '<button type="button" class="btn btn-secondary btn-small" data-move="1" ' + (idx === mergeOrder.length - 1 ? 'disabled' : '') + '>Down &darr;</button>';
    li.querySelectorAll('[data-move]').forEach((b) => b.addEventListener('click', () => {
      const d = Number(b.dataset.move);
      const j = mergeOrder.indexOf(id);
      const k = j + d;
      if (k < 0 || k >= mergeOrder.length) return;
      mergeOrder.splice(j, 1); mergeOrder.splice(k, 0, id);
      renderMergeOrder();
    }));
    li.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/plain', String(id)));
    li.addEventListener('dragover', (e) => e.preventDefault());
    li.addEventListener('drop', (e) => {
      e.preventDefault();
      const dragged = Number(e.dataTransfer.getData('text/plain'));
      const from = mergeOrder.indexOf(dragged), to = mergeOrder.indexOf(id);
      if (from < 0 || to < 0 || from === to) return;
      mergeOrder.splice(from, 1); mergeOrder.splice(to, 0, dragged);
      renderMergeOrder();
    });
    list.appendChild(li);
  });
}

/* ---------- Per-file actions ---------- */
async function fileAction(f, act, card) {
  try {
    if (act === 'remove') {
      files = files.filter((x) => x.id !== f.id);
      mergeOrder = mergeOrder.filter((id) => id !== f.id);
      /* Drop every download that was produced from this file, so its
         outputs do not linger after the file is gone. Outputs made
         from other files are kept. */
      pendingOutputs = pendingOutputs.filter((o) => !(o.sourceIds || []).includes(f.id));
      renderOutputs();
      if (files.length < 2) mergeMode = null;
      renderAll();
      setStatus('Removed ' + f.name + '.');
      return;
    }
    if (act === 'edit') { openEditor(f); return; }
    if (act === 'split') { openSplit(f); return; }
    if (act === 'rotate') {
      await rotatePdf(f, 90);
      setStatus('Rotated ' + f.name + ' by 90°. Click Rotate again to turn it another 90°. Download unlocks after the countdown.');
      return;
    }
    if (act === 'convert') {
      const fmt = card.querySelector('select[data-act="fmt"]').value;
      await convertFile(f, fmt);
      return;
    }
    if (act === 'compress') {
      await compressFile(f, targetKb);
      return;
    }
  } catch (err) {
    setStatus('Sorry — that did not work for ' + f.name + ': ' + (err && err.message ? err.message : 'unknown error'), true);
  }
}

/* ---------- Run selected job ---------- */
$('btnRunJob').addEventListener('click', async () => {
  const job = $('jobSelect').value;
  try {
    if (!files.length) { setStatus('Add a file first — drop it on the box above or click Choose files.', true); return; }
    if (job === 'merge') {
      if (files.length < 2) { setStatus('Merge needs 2 or more files. Add another file.', true); return; }
      if (mergeMode !== 'merge') { $('mergePrompt').hidden = false; setStatus('Choose “Merge into one PDF” below, set the order, then click Merge.', false); document.getElementById('mergePrompt').scrollIntoView({ behavior: 'smooth' }); return; }
      /* Fresh run: drop the previous run's outputs first. */
      clearOutputs();
      await doMerge(); return;
    }
    if (job === 'jpg2pdf') { const imgs = files.filter((f) => f.kind === 'image'); if (imgs.length) clearOutputs(); await imagesToPdf(imgs); return; }
    if (job === 'pdf2jpg') { const fmt = $('pdf2jpgFormat').value || 'jpg'; const pdfs = files.filter((x) => x.kind === 'pdf'); if (pdfs.length) clearOutputs(); for (const f of pdfs) await pdfToImages(f, fmt); return; }
    if (job === 'pdf2txt') { const pdfs = files.filter((x) => x.kind === 'pdf'); if (pdfs.length) clearOutputs(); for (const f of pdfs) await pdfToText(f); return; }
    if (job === 'compress' || job === 'resize') {
      clearOutputs();
      for (const f of files) await compressFile(f, targetKb);
      return;
    }
    if (job === 'convert') {
      clearOutputs();
      for (const f of files) {
        const def = f.kind === 'pdf' ? 'jpg' : f.kind === 'image' ? 'pdf' : 'pdf';
        await convertFile(f, def);
      }
      return;
    }
    if (job === 'split') {
      const pdf = files.find((x) => x.kind === 'pdf');
      if (!pdf) { setStatus('Split needs a PDF file.', true); return; }
      openSplit(pdf); return;
    }
    if (job === 'edit') {
      const pdf = files.find((x) => x.kind === 'pdf');
      if (!pdf) { setStatus('Edit needs a PDF file.', true); return; }
      openEditor(pdf); return;
    }
    if (job === 'rotate') {
      const angle = Number($('rotateAngle').value) || 90;
      const pdfs = files.filter((x) => x.kind === 'pdf');
      if (pdfs.length) clearOutputs();
      for (const f of pdfs) await rotatePdf(f, angle);
      setStatus('Rotated ' + pdfs.length + ' PDF(s) by ' + angle + '°. Download unlocks after the countdown.');
      return;
    }
  } catch (err) {
    setStatus('Sorry — that job did not work: ' + (err && err.message ? err.message : 'unknown error'), true);
  }
});
$('btnClearAll').addEventListener('click', () => {
  files = []; mergeMode = null; mergeOrder = [];
  renderAll(); setStatus('All files cleared.');
});

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

/* ---------- Merge ---------- */
async function doMerge() {
  if (!PDFLib) throw new Error('PDF library did not load. Check your connection and reload.');
  const ordered = mergeOrder.map((id) => files.find((x) => x.id === id)).filter(Boolean);
  if (ordered.length < 2) { setStatus('Merge needs 2 or more files.', true); return; }
  setStatus('Merging ' + ordered.length + ' files…');
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
  prepareDownload(new Blob([bytes], { type: 'application/pdf' }), 'dockora-merged.pdf',
    'Merged ' + ordered.length + ' files into one PDF (' + fmtSize(bytes.length) + ').', ordered.map((f) => f.id));
  /* Close the merge prompt/order panel now the merge is done — it
     should not linger under the download panel. The download panel
     and its countdown stay visible. */
  mergeMode = null;
  $('mergePrompt').hidden = true;
  $('mergeOrder').hidden = true;
  setStatus('Merged. Your download unlocks after the 10-second countdown below.');
}

/* ---------- Images to PDF ---------- */
async function imagesToPdf(images) {
  if (!images.length) { setStatus('Add a JPG, PNG or WebP photo first.', true); return; }
  const out = await PDFLib.PDFDocument.create();
  for (const f of images) {
    const img = await embedImage(out, f);
    const page = out.addPage([img.width, img.height]);
    page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
  }
  const bytes = await out.save();
  prepareDownload(new Blob([bytes], { type: 'application/pdf' }), 'dockora-images.pdf',
    'Created a PDF from ' + images.length + ' image(s) (' + fmtSize(bytes.length) + ').', images.map((f) => f.id));
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
async function compressFile(f, kb) {
  const targetBytes = kb * 1024;
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
    const reached = best.size <= targetBytes;
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
    const reached = bestSize <= targetBytes;
    prepareDownload(new Blob([bestBytes], { type: 'application/pdf' }), baseName(f.name) + '-compressed.pdf',
      'Compressed ' + f.name + ' to ' + fmtSize(bestSize) + ' (target ' + kb + ' KB). ' +
      (reached ? 'Target reached.' : 'Target not reached — this is the smallest we could make it while keeping the pages readable. Note: re-rendered PDFs become images, so their text is no longer selectable.'), [f.id]);
    return;
  }
  if (f.kind === 'text' || f.kind === 'docx') {
    const out = await PDFLib.PDFDocument.create();
    await addTextPages(out, f.text || '');
    const bytes = await out.save();
    prepareDownload(new Blob([bytes], { type: 'application/pdf' }), baseName(f.name) + '.pdf',
      'Converted ' + f.name + ' to PDF (' + fmtSize(bytes.length) + '). Text files are already small, so there is little to compress.', [f.id]);
    return;
  }
  setStatus('Compress is not supported for that file type in v1.', true);
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
let splitFile = null;
function openSplit(f) {
  splitFile = f;
  const box = $('splitPages');
  box.innerHTML = '';
  for (let p = 1; p <= f.pageCount; p++) {
    const label = document.createElement('label');
    label.innerHTML = '<input type="checkbox" value="' + p + '" checked> Page ' + p;
    box.appendChild(label);
  }
  $('splitPanel').hidden = false;
  $('splitPanel').scrollIntoView({ behavior: 'smooth' });
}
$('btnCloseSplit').addEventListener('click', () => { $('splitPanel').hidden = true; });
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
  setStatus('Selected page(s): ' + result.pages.join(', ') + '. Click “Extract selected pages” when ready.');
});
$('btnDoSplit').addEventListener('click', async () => {
  if (!splitFile) return;
  const chosen = Array.from(document.querySelectorAll('#splitPages input:checked')).map((c) => Number(c.value) - 1);
  if (!chosen.length) { setStatus('Tick at least one page to extract.', true); return; }
  const src = await loadPdfLibDoc(splitFile);
  const out = await PDFLib.PDFDocument.create();
  const pages = await out.copyPages(src, chosen);
  pages.forEach((p) => out.addPage(p));
  const bytes = await out.save();
  prepareDownload(new Blob([bytes], { type: 'application/pdf' }), baseName(splitFile.name) + '-split.pdf',
    'Extracted ' + chosen.length + ' page(s) from ' + splitFile.name + ' (' + fmtSize(bytes.length) + ').', [splitFile.id]);
  $('splitPanel').hidden = true;
});

/* ---------- Download: 10-second countdown, no bypass ---------- */
/* A fresh run replaces the previous run's outputs instead of letting
   duplicates pile up: prepareDownload() replaces an output that has
   the same filename, and clearOutputs() wipes the list at the start
   of a job run (see the Run handler). Outputs remember which file(s)
   produced them (sourceIds), so removing a file can drop its outputs. */
function clearOutputs() {
  pendingOutputs = [];
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
  if (!pendingOutputs.length) { panel.hidden = true; $('outputList').innerHTML = ''; return; }
  panel.hidden = false;
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
      ? 'Download unlocks in ' + remaining + ' second' + (remaining === 1 ? '' : 's') + '…'
      : 'Download is unlocked.';
    /* The helper line must not keep saying "please wait" after the
       countdown has finished. It is restored on the next countdown. */
    const note = $('countdownNote');
    if (note) {
      note.textContent = remaining > 0
        ? 'Please wait — the download button unlocks after the countdown. This keeps Dockora free.'
        : 'Download is unlocked — this wait keeps Dockora free.';
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
  $('editorTitle').textContent = 'Edit PDF — ' + f.name;
  const sel = $('editorPageSelect');
  sel.innerHTML = '';
  for (let p = 1; p <= f.pageCount; p++) {
    const opt = document.createElement('option');
    opt.value = String(p); opt.textContent = 'Page ' + p;
    sel.appendChild(opt);
  }
  $('editorModal').hidden = false;
  renderEditorPage();
}
$('editorPageSelect').addEventListener('change', () => { editorPage = Number($('editorPageSelect').value); renderEditorPage(); });
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
    const bytes = await src.save();
    editorFile.arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    editorFile.pdfDoc = await pdfjsLib.getDocument({ data: editorFile.arrayBuffer.slice(0) }).promise;
    $('editorModal').hidden = true;
    prepareDownload(new Blob([bytes], { type: 'application/pdf' }), baseName(editorFile.name) + '-edited.pdf',
      'Saved your edited PDF (' + fmtSize(bytes.length) + '). Font match is best-effort, as shown in the editor.', [editorFile.id]);
    renderAll();
    setStatus('Edited PDF ready. Download unlocks after the countdown.');
  } catch (err) {
    setStatus('Could not save the edited PDF: ' + (err && err.message ? err.message : 'unknown error'), true);
  }
});

/* ---------- Init ---------- */
setTargetKb(100);
updateJobPanels(); /* default job is Merge, so the Target size panel starts hidden */
setStatus('Ready. Add a file to begin — no sign-in, and your files never leave your device.');
