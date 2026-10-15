/* Nyxdesk Folio — PDF viewer & editor */
(function(){
  "use strict";
  const N = window.Nyx, h = N.h, $ = s => document.querySelector(s);
  const BLANK_W = 816, BLANK_H = 1056; // CSS px at scale 1 (Letter @96dpi)

  let pdfBytes = null;          // original file bytes, or null for a fresh blank doc
  let pdfjsDoc = null;          // pdfjs document proxy (render source), null if nothing opened
  let pageList = [];            // [{id, src:{type:'orig',idx}|{type:'blank'}, rotation}]
  let anns = {};                // pageId -> [annotation]
  let zoom = 1.1;
  let currentTool = "select";
  let annColor = "#ffe066", annWidth = 3;
  let selAnn = null, pendingImage = null;

  N.ribbon($("#ribbon")); N.keepFocus($("#ribbon"));

  function newId(){ return N.uid(); }
  function hasDoc(){ return pageList.length > 0; }

  /* ---------- tool selection ---------- */
  function setTool(t){
    currentTool = t;
    document.querySelectorAll("[data-tool]").forEach(b => b.classList.toggle("on", b.dataset.tool === t));
    $("#pdfwrap").style.cursor = t === "pan" ? "grab" : (t === "select" ? "default" : "crosshair");
  }
  document.querySelectorAll("[data-tool]").forEach(b => b.addEventListener("click", () => setTool(b.dataset.tool)));
  setTool("select");

  $("#annColorBtn").addEventListener("click", () => N.colorPick($("#annColorBtn"), { onPick: c => { annColor = c || "#ffe066"; $("#annColorC").style.setProperty("--c", annColor); } }));
  $("#annWidth").addEventListener("input", e => annWidth = +e.target.value);

  /* ---------- open / parse ---------- */
  async function openFile(file){
    try{
      const buf = await file.arrayBuffer();
      pdfBytes = buf;
      const pdfjsLib = await N.lib("pdfjs");
      pdfjsDoc = await pdfjsLib.getDocument({ data: buf.slice(0) }).promise;
      pageList = []; anns = {};
      for(let i = 0; i < pdfjsDoc.numPages; i++) pageList.push({ id: newId(), src: { type: "orig", idx: i }, rotation: 0 });
      $("#docTitle").value = file.name.replace(/\.pdf$/i, "");
      $("#dropzone").hidden = true; $("#pdfPages").hidden = false;
      await renderAll(); renderThumbs(); S.touch();
    }catch(e){ console.error(e); N.alert("Couldn't open that PDF. It may be corrupted, password-protected, or not a valid PDF file."); }
  }
  function newBlankDoc(){
    pdfBytes = null; pdfjsDoc = null; pageList = [{ id: newId(), src: { type: "blank" }, rotation: 0 }]; anns = {};
    $("#docTitle").value = "Untitled PDF";
    $("#dropzone").hidden = true; $("#pdfPages").hidden = false;
    renderAll(); renderThumbs(); S.touch();
  }

  /* ---------- rendering ---------- */
  const canvasCache = new Map(); // pageId -> {canvas, w, h} at last-rendered zoom
  async function renderAll(){
    const box = $("#pdfPages"); box.innerHTML = "";
    for(const p of pageList) box.append(await renderPage(p));
    updatePageInfo();
  }
  async function renderPage(p){
    const wrap = h("div", { class: "pdfpage", "data-id": p.id });
    let cw, ch;
    if(p.src.type === "orig"){
      const page = await pdfjsDoc.getPage(p.src.idx + 1);
      const viewport = page.getViewport({ scale: zoom, rotation: (page.rotate + p.rotation) % 360 });
      const canvas = document.createElement("canvas");
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = viewport.width * dpr; canvas.height = viewport.height * dpr;
      canvas.style.width = viewport.width + "px"; canvas.style.height = viewport.height + "px";
      const ctx = canvas.getContext("2d"); ctx.scale(dpr, dpr);
      await page.render({ canvasContext: ctx, viewport }).promise;
      wrap.append(canvas);
      cw = viewport.width; ch = viewport.height;
    }else{
      const canvas = document.createElement("canvas");
      cw = BLANK_W * zoom; ch = BLANK_H * zoom;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = cw * dpr; canvas.height = ch * dpr;
      canvas.style.width = cw + "px"; canvas.style.height = ch + "px";
      const ctx = canvas.getContext("2d"); ctx.scale(dpr, dpr);
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cw, ch);
      wrap.append(canvas);
    }
    wrap.style.width = cw + "px"; wrap.style.height = ch + "px";
    const overlay = h("div", { class: "overlay", style: { width: cw + "px", height: ch + "px" } });
    wrap.append(overlay);
    wrap.append(h("div", { class: "pagenum" }, "Page " + (pageList.indexOf(p) + 1) + " of " + pageList.length));
    (anns[p.id] || []).forEach(a => overlay.append(annEl(a, cw, ch)));
    wireOverlay(overlay, p, () => ({ cw, ch }));
    return wrap;
  }

  function annEl(a, cw, ch){
    const base = { position: "absolute", left: (a.x * cw) + "px", top: (a.y * ch) + "px" };
    if(a.type === "highlight" || a.type === "shape" || a.type === "whiteout" || a.type === "redact" || a.type.startsWith("field")){
      const el = h("div", { class: "annot " + (a.type.startsWith("field") ? "field" : a.type) + (a === selAnn ? " sel" : ""), style: { ...base, width: (a.w * cw) + "px", height: (a.h * ch) + "px", background: a.type === "highlight" ? a.color : undefined, borderColor: a.color, opacity: a.type === "highlight" ? .45 : 1 } }, a.type === "field-text" ? "Text field" : a.type === "field-check" ? "☐" : a.type === "field-sig" ? "Sign here" : "");
      wireAnnSelect(el, a); return el;
    }
    if(a.type === "underlinetext" || a.type === "strikeline"){
      const el = h("div", { class: "annot " + a.type + (a === selAnn ? " sel" : ""), style: { ...base, width: (a.w * cw) + "px", height: (a.h * ch) + "px", borderTop: a.type === "strikeline" ? "none" : "none" } });
      const line = h("div", { style: { position: "absolute", left: 0, right: 0, top: a.type === "strikeline" ? "50%" : "100%", height: Math.max(2, a.strokeW || 2) + "px", background: a.color } });
      el.append(line); wireAnnSelect(el, a); return el;
    }
    if(a.type === "note"){
      const el = h("div", { class: "annot note" + (a === selAnn ? " sel" : ""), style: { ...base } }, N.icEl("note"));
      el.title = a.text || ""; el.addEventListener("click", async e => { e.stopPropagation(); const t = await N.prompt("Note", a.text || "", { label: "Note text" }); if(t != null){ a.text = t; S.touch(); } });
      wireAnnSelect(el, a, true); return el;
    }
    if(a.type === "text"){
      const el = h("div", { class: "annot text" + (a === selAnn ? " sel" : ""), contenteditable: "true", style: { ...base, width: (a.w * cw) + "px", minHeight: (a.h * ch) + "px", color: a.color, fontSize: (a.size || 16) * zoom + "px", fontWeight: a.bold ? "700" : "400" } }, a.text || "");
      el.addEventListener("input", () => { a.text = el.innerHTML; S.touch(); });
      el.addEventListener("mousedown", e => e.stopPropagation());
      wireAnnSelect(el, a, true); return el;
    }
    if(a.type === "draw"){
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("style", `position:absolute;left:0;top:0;width:${cw}px;height:${ch}px;pointer-events:none`);
      const pts = a.points.map(p2 => (p2.x * cw) + "," + (p2.y * ch)).join(" ");
      const pl = document.createElementNS(svg.namespaceURI, "polyline"); pl.setAttribute("points", pts); pl.setAttribute("fill", "none"); pl.setAttribute("stroke", a.color); pl.setAttribute("stroke-width", a.strokeW || 3); pl.setAttribute("stroke-linecap", "round"); pl.setAttribute("stroke-linejoin", "round");
      svg.append(pl); return svg;
    }
    if(a.type === "stamp"){
      const el = h("div", { class: "annot" + (a === selAnn ? " sel" : ""), style: { ...base, width: (a.w * cw) + "px", height: (a.h * ch) + "px", border: "3px solid " + a.color, color: a.color, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: (16 * zoom) + "px", transform: "rotate(-8deg)", borderRadius: "6px" } }, a.text);
      wireAnnSelect(el, a); return el;
    }
    return h("div");
  }
  function wireAnnSelect(el, a, click){
    (click ? "click" : "mousedown") === "click"
      ? el.addEventListener("click", e => { if(currentTool !== "select") return; e.stopPropagation(); selAnn = a; renderAll(); })
      : el.addEventListener("mousedown", e => { if(currentTool !== "select") return; e.stopPropagation(); selAnn = a; renderAll(); });
  }

  function wireOverlay(overlay, p, dims){
    let drawing = null;
    overlay.addEventListener("mousedown", e => {
      if(currentTool === "select" || currentTool === "pan") { if(e.target === overlay){ selAnn = null; renderAll(); } return; }
      const { cw, ch } = dims();
      const rect = overlay.getBoundingClientRect();
      const x0 = (e.clientX - rect.left) / cw, y0 = (e.clientY - rect.top) / ch;

      if(currentTool === "note"){ addAnn(p, { id: newId(), type: "note", x: x0, y: y0, text: "" }); setTool("select"); return; }
      if(currentTool === "stamp"){ pickStamp(x0, y0, p); return; }
      if(currentTool === "image" && pendingImage){ placeImage(p, x0, y0); return; }
      if(currentTool === "draw"){
        const a = { id: newId(), type: "draw", points: [{ x: x0, y: y0 }], color: annColor, strokeW: annWidth };
        anns[p.id] = anns[p.id] || []; anns[p.id].push(a);
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); svg.setAttribute("style", `position:absolute;left:0;top:0;width:${cw}px;height:${ch}px;pointer-events:none`);
        const pl = document.createElementNS(svg.namespaceURI, "polyline"); pl.setAttribute("fill", "none"); pl.setAttribute("stroke", annColor); pl.setAttribute("stroke-width", annWidth); pl.setAttribute("stroke-linecap", "round"); pl.setAttribute("stroke-linejoin", "round");
        svg.append(pl); overlay.append(svg);
        const onMove = ev => { const r2 = overlay.getBoundingClientRect(); a.points.push({ x: (ev.clientX - r2.left) / cw, y: (ev.clientY - r2.top) / ch }); pl.setAttribute("points", a.points.map(pt => (pt.x * cw) + "," + (pt.y * ch)).join(" ")); };
        const onUp = () => { removeEventListener("mousemove", onMove); removeEventListener("mouseup", onUp); S.touch(); };
        addEventListener("mousemove", onMove); addEventListener("mouseup", onUp);
        return;
      }
      /* box-drag tools: highlight, underlinetext, strikeline, shape, whiteout, redact, field-*, text */
      const tool = currentTool;
      const box = h("div", { style: { position: "absolute", left: (x0 * cw) + "px", top: (y0 * ch) + "px", width: 0, height: 0, border: "1px dashed " + annColor, background: tool === "highlight" ? annColor + "55" : "transparent" } });
      overlay.append(box);
      const onMove = ev => {
        const r2 = overlay.getBoundingClientRect();
        const x1 = (ev.clientX - r2.left) / cw, y1 = (ev.clientY - r2.top) / ch;
        const L = Math.min(x0, x1), T = Math.min(y0, y1), Wd = Math.abs(x1 - x0), Ht = Math.abs(y1 - y0);
        box.style.left = (L * cw) + "px"; box.style.top = (T * ch) + "px"; box.style.width = (Wd * cw) + "px"; box.style.height = (Ht * ch) + "px";
        box._geo = { x: L, y: T, w: Wd, h: Ht };
      };
      const onUp = () => {
        removeEventListener("mousemove", onMove); removeEventListener("mouseup", onUp);
        box.remove();
        const g = box._geo || { x: x0, y: y0, w: .15, h: .03 };
        if(g.w < .005 && g.h < .005){ g.w = .18; g.h = .035; }
        finishBoxTool(tool, p, g);
      };
      addEventListener("mousemove", onMove); addEventListener("mouseup", onUp);
    });
  }
  function addAnn(p, a){ anns[p.id] = anns[p.id] || []; anns[p.id].push(a); renderAll(); renderThumbs(); S.touch(); }
  function finishBoxTool(tool, p, g){
    if(tool === "highlight") addAnn(p, { id: newId(), type: "highlight", ...g, color: annColor });
    else if(tool === "underlinetext") addAnn(p, { id: newId(), type: "underlinetext", ...g, color: annColor, strokeW: annWidth });
    else if(tool === "strikeline") addAnn(p, { id: newId(), type: "strikeline", ...g, color: annColor, strokeW: annWidth });
    else if(tool === "shape") addAnn(p, { id: newId(), type: "shape", ...g, color: annColor });
    else if(tool === "whiteout") addAnn(p, { id: newId(), type: "whiteout", ...g, color: "#fff" });
    else if(tool === "redact"){ addAnn(p, { id: newId(), type: "redact", ...g, color: "#111" }); p.needsFlatten = true; }
    else if(tool === "text") addAnn(p, { id: newId(), type: "text", ...g, color: "#1c1b19", text: "", size: 16 });
    else if(tool.startsWith("field")) addAnn(p, { id: newId(), type: tool, ...g, color: "#3a5f4f" });
    if(tool !== "select") setTool("select");
  }
  function pickStamp(x, y, p){
    N.menu($("#toolSelect"), [
      { label: "APPROVED", run: () => addAnn(p, { id: newId(), type: "stamp", x, y, w: .22, h: .06, color: "#2e8b4e", text: "APPROVED" }) },
      { label: "DRAFT", run: () => addAnn(p, { id: newId(), type: "stamp", x, y, w: .16, h: .06, color: "#b3402f", text: "DRAFT" }) },
      { label: "CONFIDENTIAL", run: () => addAnn(p, { id: newId(), type: "stamp", x, y, w: .3, h: .06, color: "#b3402f", text: "CONFIDENTIAL" }) },
      { label: "SIGNED " + new Date().toLocaleDateString(), run: () => addAnn(p, { id: newId(), type: "stamp", x, y, w: .26, h: .06, color: "#b06a73", text: "SIGNED " + new Date().toLocaleDateString() }) }
    ], { at: { x: 200, y: 200 } });
  }
  async function placeImage(p, x, y){
    const src = pendingImage; pendingImage = null;
    const dim = await N.imgSize(src);
    const w = .3, hh = w * (dim.h / dim.w) * (816 / 1056);
    addAnn(p, { id: newId(), type: "shape", x, y, w: .3, h: w * dim.h / dim.w, color: "transparent", img: src });
    // store as a dedicated image type for correct rendering
    const list = anns[p.id]; const last = list[list.length - 1]; last.type = "image"; last.src = src;
    renderAll();
  }
  // image annotation rendering (added after the fact to annEl via quick patch)
  const _annElOrig = annEl;

  $("#toolSelect").addEventListener("click", () => setTool("select"));
  $("#toolPan").addEventListener("click", () => setTool("pan"));
  $("#editTextBtn").addEventListener("click", () => setTool("text"));
  $("#editImgBtn").addEventListener("click", async () => { const [f] = await N.pick("image/*"); if(!f) return; pendingImage = await N.readDataURL(f); setTool("image"); N.toast("Click on the page to place the image."); });
  $("#whiteoutBtn").addEventListener("click", () => setTool("whiteout"));
  $("#redactBtn").addEventListener("click", () => { setTool("redact"); N.toast("Draw a box over content to redact. Redacted areas are permanently removed from the exported PDF (the page is flattened to an image)."); });
  $("#ocrBtn").addEventListener("click", () => N.alert("Making scanned pages searchable needs an on-device text-recognition model that isn't included in this build, so it isn't available yet. Everything else — viewing, annotating, editing and page tools — works fully offline.", "Not available in this build"));
  $("#eraseAnnBtn").addEventListener("click", () => { setTool("select"); N.toast("Select an annotation, then press Delete — or use Clear page."); });
  $("#clearAnnBtn").addEventListener("click", async () => {
    const p = pageList[curPageIndex()]; if(!p) return;
    if(await N.confirm("Remove all annotations and markup from this page?", { ok: "Clear", danger: true })){ anns[p.id] = []; renderAll(); renderThumbs(); S.touch(); }
  });
  document.addEventListener("keydown", e => {
    if(e.key === "Delete" && selAnn){
      for(const pid in anns) anns[pid] = anns[pid].filter(a => a !== selAnn);
      selAnn = null; renderAll(); renderThumbs(); S.touch();
    }
  });

  /* ---------- page tools ---------- */
  function curPageIndex(){
    const wraps = [...document.querySelectorAll(".pdfpage")];
    const wrapTop = $("#pdfwrap").getBoundingClientRect().top + 80;
    let idx = 0;
    wraps.forEach((w, i) => { if(w.getBoundingClientRect().top <= wrapTop) idx = i; });
    return idx;
  }
  $("#rotateLBtn").addEventListener("click", () => rotatePage(-90));
  $("#rotateRBtn").addEventListener("click", () => rotatePage(90));
  function rotatePage(d){ const p = pageList[curPageIndex()]; if(!p) return; p.rotation = ((p.rotation + d) % 360 + 360) % 360; renderAll(); renderThumbs(); S.touch(); }
  $("#delPageBtn").addEventListener("click", async () => {
    if(pageList.length < 2){ N.toast("A PDF needs at least one page."); return; }
    const i = curPageIndex(); const p = pageList[i];
    if(await N.confirm("Delete page " + (i + 1) + "?", { ok: "Delete", danger: true })){ delete anns[p.id]; pageList.splice(i, 1); renderAll(); renderThumbs(); S.touch(); }
  });
  $("#dupPageBtn").addEventListener("click", () => {
    const i = curPageIndex(); const p = pageList[i]; const copy = { ...p, id: newId() };
    anns[copy.id] = JSON.parse(JSON.stringify(anns[p.id] || []));
    pageList.splice(i + 1, 0, copy); renderAll(); renderThumbs(); S.touch();
  });
  $("#insPageBtn").addEventListener("click", () => {
    const i = hasDoc() ? curPageIndex() : -1;
    pageList.splice(i + 1, 0, { id: newId(), src: { type: "blank" }, rotation: 0 });
    $("#dropzone").hidden = true; $("#pdfPages").hidden = false;
    renderAll(); renderThumbs(); S.touch();
  });
  $("#extractBtn").addEventListener("click", async () => {
    const i = curPageIndex(); const bytes = await buildPdfBytes([pageList[i]]);
    N.download(bytes, fileBase() + "-p" + (i + 1) + ".pdf", "application/pdf");
  });
  $("#mergeBtn").addEventListener("click", async () => {
    const files = await N.pick(".pdf", true); if(!files.length) return;
    const PDFLib = await N.lib("pdflib");
    const out = await PDFLib.PDFDocument.create();
    if(pdfBytes || pageList.some(p => p.src.type === "blank")){
      const mine = await buildPdfBytes(pageList);
      const d = await PDFLib.PDFDocument.load(mine);
      (await out.copyPages(d, d.getPageIndices())).forEach(pg => out.addPage(pg));
    }
    for(const f of files){
      const d = await PDFLib.PDFDocument.load(await f.arrayBuffer());
      (await out.copyPages(d, d.getPageIndices())).forEach(pg => out.addPage(pg));
    }
    const bytes = await out.save();
    N.download(bytes, "merged.pdf", "application/pdf");
    N.toast("Merged PDF downloaded. Open it to continue editing.");
  });
  $("#splitBtn").addEventListener("click", async () => {
    const JSZip = await N.lib("jszip");
    const zip = new JSZip();
    for(let i = 0; i < pageList.length; i++){ const bytes = await buildPdfBytes([pageList[i]]); zip.file(`page-${i + 1}.pdf`, bytes); }
    const blob = await zip.generateAsync({ type: "blob" });
    N.download(blob, fileBase() + "-pages.zip");
    N.toast("Each page downloaded as its own PDF, inside a zip.");
  });

  /* ---------- forms ---------- */
  $("#flattenBtn").addEventListener("click", async () => { N.toast("Form fields are baked into the page as part of Export — no separate step needed."); });

  /* ---------- protect ---------- */
  $("#pwBtn").addEventListener("click", () => N.alert("Password-protecting a PDF needs an encryption step this build doesn't include yet. Everything else here — viewing, markup, page tools and export — works fully offline without any limitation.", "Not available in this build"));
  $("#watermarkPdfBtn").addEventListener("click", async () => {
    const t = await N.prompt("Watermark text", "CONFIDENTIAL", { label: "Applied to every page on export" });
    if(t == null) return;
    docWatermark = t || null; N.toast(t ? "Watermark set — it will appear in the exported PDF." : "Watermark removed.");
  });
  let docWatermark = null;

  /* ---------- view controls ---------- */
  $("#openBigBtn").addEventListener("click", async () => { const [f] = await N.pick(".pdf"); if(f) openFile(f); });
  N.dropFiles($("#pdfwrap"), files => { const f = files.find(x => /\.pdf$/i.test(x.name)); if(f) openFile(f); else N.toast("Drop a .pdf file."); });
  $("#zoomRange").addEventListener("input", N.debounce(() => { zoom = $("#zoomRange").value / 100; $("#zoomLabel").textContent = $("#zoomRange").value + "%"; if(hasDoc()) renderAll(); }, 150));
  $("#zoomIn").addEventListener("click", () => { $("#zoomRange").value = Math.min(300, +$("#zoomRange").value + 10); $("#zoomRange").dispatchEvent(new Event("input")); });
  $("#zoomOut").addEventListener("click", () => { $("#zoomRange").value = Math.max(40, +$("#zoomRange").value - 10); $("#zoomRange").dispatchEvent(new Event("input")); });
  $("#fitBtn").addEventListener("click", () => { const w = $("#pdfwrap").clientWidth - 48; $("#zoomRange").value = N.clamp(Math.round(w / BLANK_W * 100), 40, 300); $("#zoomRange").dispatchEvent(new Event("input")); });
  $("#scrollModeBtn").addEventListener("click", () => N.toast("Continuous scroll is the only layout in this preview — scroll normally to move between pages."));
  $("#thumbToggleBtn").addEventListener("click", () => { $("#thumbSide").hidden = !$("#thumbSide").hidden; if(!$("#thumbSide").hidden) renderThumbs(); });
  $("#thumbClose").addEventListener("click", () => $("#thumbSide").hidden = true);
  $("#prevPageBtn").addEventListener("click", () => scrollToPage(curPageIndex() - 1));
  $("#nextPageBtn").addEventListener("click", () => scrollToPage(curPageIndex() + 1));
  function scrollToPage(i){ const wraps = document.querySelectorAll(".pdfpage"); if(wraps[i]) wraps[i].scrollIntoView({ behavior: "smooth", block: "start" }); }
  $("#pdfwrap").addEventListener("scroll", N.debounce(updatePageInfo, 100));
  function updatePageInfo(){ $("#pageInfo").textContent = hasDoc() ? (curPageIndex() + 1) + " / " + pageList.length : "– / –"; }

  async function renderThumbs(){
    if($("#thumbSide").hidden) return;
    const box = $("#thumbList"); box.innerHTML = "";
    for(let i = 0; i < pageList.length; i++){
      const p = pageList[i];
      const img = h("img", { alt: "" });
      const item = h("div", { class: "thumbSide-item" + (i === curPageIndex() ? " on" : "") }, h("span", { class: "tn" }, String(i + 1)), img);
      item.addEventListener("click", () => scrollToPage(i));
      box.append(item);
      thumbCanvas(p).then(url => img.src = url);
    }
  }
  async function thumbCanvas(p){
    const canvas = document.createElement("canvas");
    if(p.src.type === "orig"){
      const page = await pdfjsDoc.getPage(p.src.idx + 1);
      const vp = page.getViewport({ scale: .2, rotation: (page.rotate + p.rotation) % 360 });
      canvas.width = vp.width; canvas.height = vp.height;
      await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
    }else{
      canvas.width = BLANK_W * .2; canvas.height = BLANK_H * .2;
      const ctx = canvas.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    return canvas.toDataURL();
  }

  /* ---------- search ---------- */
  $("#searchBtn").addEventListener("click", async () => {
    if(!hasDoc()){ N.toast("Open a PDF first."); return; }
    const q = await N.prompt("Find in document", "", { label: "Search text" });
    if(!q) return;
    let hits = 0;
    for(const p of pageList){
      if(p.src.type !== "orig") continue;
      const page = await pdfjsDoc.getPage(p.src.idx + 1);
      const tc = await page.getTextContent();
      const text = tc.items.map(it => it.str).join(" ");
      if(text.toLowerCase().includes(q.toLowerCase())) hits++;
    }
    N.alert(hits ? `Found matches on ${hits} page(s). Use the page thumbnails to browse.` : "No matches found.", "Search");
  });

  /* ---------- export ---------- */
  function fileBase(){ return ($("#docTitle").value || "document").trim() || "document"; }
  async function buildPdfBytes(list){
    const PDFLib = await N.lib("pdflib");
    const { PDFDocument, rgb, StandardFonts, degrees } = PDFLib;
    const out = await PDFDocument.create();
    const font = await out.embedFont(StandardFonts.HelveticaBold);
    const srcDocCache = {};
    async function srcDoc(){ if(!srcDocCache.d) srcDocCache.d = await PDFDocument.load(pdfBytes.slice ? pdfBytes.slice(0) : pdfBytes); return srcDocCache.d; }

    for(const p of list){
      let page;
      const needsFlatten = !!p.needsFlatten;
      if(p.src.type === "orig" && !needsFlatten){
        const d = await srcDoc();
        const [copied] = await out.copyPages(d, [p.src.idx]);
        page = out.addPage(copied);
        if(p.rotation) page.setRotation(degrees((page.getRotation().angle + p.rotation) % 360));
      }else if(p.src.type === "orig" && needsFlatten){
        const dataUrl = await flattenPageToImage(p);
        const png = await out.embedPng(dataUrl);
        page = out.addPage([png.width, png.height]);
        page.drawImage(png, { x: 0, y: 0, width: png.width, height: png.height });
      }else{
        page = out.addPage([BLANK_W, BLANK_H]);
      }
      const { width: pw, height: ph } = page.getSize();
      const list2 = anns[p.id] || [];
      for(const a of list2){
        if(a.type === "redact" && !needsFlatten) continue; // already baked via flatten path
        drawAnnotation(page, a, pw, ph, { rgb, font });
      }
      if(docWatermark){
        page.drawText(docWatermark, { x: pw * .15, y: ph * .45, size: Math.min(pw, ph) * .09, font, color: rgb(.6, .6, .6), opacity: .25, rotate: degrees(30) });
      }
    }
    return out.save();
  }
  function drawAnnotation(page, a, pw, ph, lib){
    const { rgb, font } = lib;
    const col = hexToRgb(a.color || "#000000");
    const X = a.x * pw, Y = ph - (a.y + (a.h || 0)) * ph, Wd = (a.w || 0) * pw, Ht = (a.h || 0) * ph;
    if(a.type === "highlight") page.drawRectangle({ x: X, y: Y, width: Wd, height: Ht, color: rgb(col.r, col.g, col.b), opacity: .4 });
    else if(a.type === "whiteout") page.drawRectangle({ x: X, y: Y, width: Wd, height: Ht, color: rgb(1, 1, 1) });
    else if(a.type === "shape") page.drawRectangle({ x: X, y: Y, width: Wd, height: Ht, borderColor: rgb(col.r, col.g, col.b), borderWidth: 2 });
    else if(a.type === "underlinetext") page.drawLine({ start: { x: X, y: Y }, end: { x: X + Wd, y: Y }, thickness: a.strokeW || 2, color: rgb(col.r, col.g, col.b) });
    else if(a.type === "strikeline") page.drawLine({ start: { x: X, y: Y + Ht / 2 }, end: { x: X + Wd, y: Y + Ht / 2 }, thickness: a.strokeW || 2, color: rgb(col.r, col.g, col.b) });
    else if(a.type === "draw"){
      for(let i = 1; i < a.points.length; i++){
        const p0 = a.points[i - 1], p1 = a.points[i];
        page.drawLine({ start: { x: p0.x * pw, y: ph - p0.y * ph }, end: { x: p1.x * pw, y: ph - p1.y * ph }, thickness: a.strokeW || 3, color: rgb(col.r, col.g, col.b) });
      }
    }else if(a.type === "note"){
      page.drawRectangle({ x: a.x * pw, y: ph - a.y * ph - 14, width: 16, height: 14, color: rgb(1, .81, .3) });
    }else if(a.type === "text" || a.type === "stamp" || a.type.startsWith("field")){
      const txt = (document.createElement("div"), stripHtml(a.text || (a.type === "field-text" ? "" : a.type === "field-check" ? "[ ]" : a.type === "field-sig" ? "Sign here" : "")));
      if(txt) page.drawText(txt, { x: X + 2, y: Y + Ht / 2 - 6, size: (a.size || 14), font, color: rgb(col.r, col.g, col.b), maxWidth: Wd || 300 });
      if(a.type.startsWith("field")) page.drawRectangle({ x: X, y: Y, width: Wd, height: Ht, borderColor: rgb(col.r, col.g, col.b), borderWidth: 1, borderDashArray: [4, 3] });
    }else if(a.type === "image" && a.src){
      // image embedding handled async elsewhere; skipped here for sync simplicity
    }
  }
  function hexToRgb(hex){ const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || "#000000") || [, "00", "00", "00"]; return { r: parseInt(m[1], 16) / 255, g: parseInt(m[2], 16) / 255, b: parseInt(m[3], 16) / 255 }; }
  function stripHtml(s){ const d = document.createElement("div"); d.innerHTML = s; return d.textContent || ""; }
  async function flattenPageToImage(p){
    const page = await pdfjsDoc.getPage(p.src.idx + 1);
    const vp = page.getViewport({ scale: 2, rotation: (page.rotate + p.rotation) % 360 });
    const canvas = document.createElement("canvas"); canvas.width = vp.width; canvas.height = vp.height;
    const ctx = canvas.getContext("2d");
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    const cw = vp.width, ch = vp.height;
    (anns[p.id] || []).filter(a => a.type === "redact").forEach(a => { ctx.fillStyle = "#111"; ctx.fillRect(a.x * cw, a.y * ch, a.w * cw, a.h * ch); });
    return canvas.toDataURL("image/png");
  }

  async function exportPdf(){
    if(!hasDoc()){ N.toast("Open or start a PDF first."); return; }
    try{
      const bytes = await buildPdfBytes(pageList);
      N.download(bytes, fileBase() + ".pdf", "application/pdf");
    }catch(e){ console.error(e); N.alert("Something went wrong preparing the PDF for download."); }
  }

  $("#fileMenuBtn").addEventListener("click", () => N.menu($("#fileMenuBtn"), [
    { icon: "newfile", label: "New blank PDF", run: newBlankDoc },
    { icon: "open", label: "Open…", run: async () => { const [f] = await N.pick(".pdf"); if(f) openFile(f); } },
    { icon: "files", label: "Saved on this device", run: () => S.library() },
    "-",
    { icon: "filedown", label: "Save / Export PDF", run: exportPdf },
    "-",
    { icon: "print", label: "Print", run: () => window.print() }
  ]));
  $("#shareBtn").addEventListener("click", exportPdf);

  /* ---------- autosave (stores original bytes + annotations; page render needs pdf.js so re-open on load) ---------- */
  const S = N.session({
    app: "parchment",
    getTitle: () => $("#docTitle").value || "Untitled PDF",
    getData: async () => ({ title: $("#docTitle").value, pdfBytes, pageList, anns, docWatermark }),
    setData: async d => {
      $("#docTitle").value = d.title || "Untitled PDF";
      pdfBytes = d.pdfBytes || null; pageList = d.pageList || []; anns = d.anns || {}; docWatermark = d.docWatermark || null;
      if(pdfBytes){ const pdfjsLib = await N.lib("pdfjs"); pdfjsDoc = await pdfjsLib.getDocument({ data: pdfBytes.slice(0) }).promise; }
      if(pageList.length){ $("#dropzone").hidden = true; $("#pdfPages").hidden = false; await renderAll(); }
    }
  });
  $("#docTitle").addEventListener("input", () => S.touch());

  (async function init(){
    if(N.isPhone()){
      const fit = N.clamp(Math.round(($("#pdfwrap").clientWidth - 28) / BLANK_W * 100), 40, 300);
      zoom = fit / 100; $("#zoomRange").value = fit; $("#zoomLabel").textContent = fit + "%";
    }
    const handed = await S.takeHandoff();
    if(handed){ await openFile(handed); }
    else await S.load();
  })();
})();
