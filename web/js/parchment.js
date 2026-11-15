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
  let docPassword = null;       // open-password to apply on export (never stored on the device)
  let sourceWasLocked = false;  // the opened file was encrypted; pages are exported as images
  const annLog = [];            // newest-first list of added marks, for Undo
  let hits = [], hitIdx = -1;   // Find-in-document results

  N.ribbon($("#ribbon")); N.keepFocus($("#ribbon"));

  function newId(){ return N.uid(); }
  function hasDoc(){ return pageList.length > 0; }

  /* ---------- tool selection ---------- */
  function setTool(t){
    currentTool = t;
    document.querySelectorAll("[data-tool]").forEach(b => b.classList.toggle("on", b.dataset.tool === t));
    $("#pdfwrap").style.cursor = t === "pan" ? "grab" : (t === "select" ? "default" : "crosshair");
    $("#pdfwrap").classList.toggle("marking", t !== "select" && t !== "pan");   /* marking tools own touch drags; select/pan leave them for scrolling */
  }
  document.querySelectorAll("[data-tool]").forEach(b => b.addEventListener("click", () => setTool(b.dataset.tool)));
  setTool("select");

  $("#annColorBtn").addEventListener("click", () => N.colorPick($("#annColorBtn"), { onPick: c => { annColor = c || "#ffe066"; $("#annColorC").style.setProperty("--c", annColor); } }));
  $("#annWidth").addEventListener("input", e => annWidth = +e.target.value);

  /* ---------- open / parse ---------- */
  /* Opens a PDF with pdf.js, asking for the password if the file has one. */
  async function loadPdfjs(buf){
    const lib = await N.lib("pdfjs");
    const task = lib.getDocument({ data: buf.slice(0) });
    let locked = false, cancelled = false;
    task.onPassword = async (update, reason) => {
      locked = true;
      const pw = await N.prompt(reason === 2 ? "Wrong password" : "Password needed", "", { type: "password", label: reason === 2 ? "That password didn't work. Try again." : "This PDF is protected. Enter its password to open it.", ok: "Open" });
      if(pw == null){ cancelled = true; task.destroy(); return; }
      update(pw);
    };
    try{ return { doc: await task.promise, locked }; }
    catch(e){ if(cancelled){ const c = new Error("cancelled"); c.cancelled = true; throw c; } throw e; }
  }
  async function openFile(file){
    try{
      const buf = await file.arrayBuffer();
      const r = await loadPdfjs(buf);
      pdfBytes = buf; pdfjsDoc = r.doc; sourceWasLocked = r.locked; docPassword = null; hits = []; hitIdx = -1;
      pageList = []; anns = {};
      for(let i = 0; i < pdfjsDoc.numPages; i++) pageList.push({ id: newId(), src: { type: "orig", idx: i }, rotation: 0, needsFlatten: r.locked });
      if(r.locked) N.toast("Unlocked. Edits to a protected PDF are saved as page images, and the saved copy has no password unless you set one.", 5200);
      $("#docTitle").value = file.name.replace(/\.pdf$/i, "");
      $("#dropzone").hidden = true; $("#pdfPages").hidden = false;
      if(N.isPhone()){ const pg1 = await pdfjsDoc.getPage(1); const w1 = pg1.getViewport({ scale: 1 }).width; zoom = N.clamp(($("#pdfwrap").clientWidth - 16) / w1, .4, 3); $("#zoomRange").value = Math.round(zoom * 100); $("#zoomLabel").textContent = Math.round(zoom * 100) + "%"; }
      await renderAll(); renderThumbs(); S.touch(); N.toast("Opened " + file.name + " · " + pdfjsDoc.numPages + " page" + (pdfjsDoc.numPages > 1 ? "s" : ""));
    }catch(e){ if(e && e.cancelled) return; console.error(e); N.alert("Couldn't open that PDF. It may be corrupted or not a valid PDF file."); }
  }
  function newBlankDoc(){
    pdfBytes = null; pdfjsDoc = null; sourceWasLocked = false; docPassword = null; hits = []; hitIdx = -1; pageList = [{ id: newId(), src: { type: "blank" }, rotation: 0 }]; anns = {};
    $("#docTitle").value = "Untitled PDF";
    $("#dropzone").hidden = true; $("#pdfPages").hidden = false;
    renderAll(); renderThumbs(); S.touch();
  }

  /* ---------- rendering ---------- */
  const canvasCache = new Map(); // pageId -> {canvas, w, h} at last-rendered zoom
  const pageBitmaps = new Map();               // rendered page bitmaps, so annotating never re-runs pdf.js
  let pageW1 = BLANK_W;                          // width of page 1 at 100% — what "fit width" fits to
  const io = new IntersectionObserver(es => es.forEach(en => { if(en.isIntersecting && en.target._draw) en.target._draw(); }), { root: $("#pdfwrap"), rootMargin: "1200px 0px" });
  async function renderAll(){
    const box = $("#pdfPages"), sc = $("#pdfwrap"), st = sc.scrollTop;
    io.disconnect();
    const frag = document.createDocumentFragment();
    for(const p of pageList) frag.append(await renderPage(p));
    box.replaceChildren(frag); sc.scrollTop = st;
    updatePageInfo();
  }
  function makeCanvas(cw, ch){
    let dpr = Math.min(2, window.devicePixelRatio || 1);
    dpr = Math.max(.5, Math.min(dpr, Math.sqrt(12e6 / Math.max(1, cw * ch))));   /* stay under phone canvas-size limits */
    const c = document.createElement("canvas"); c.width = Math.round(cw * dpr); c.height = Math.round(ch * dpr);
    c.style.width = cw + "px"; c.style.height = ch + "px"; return { c, dpr };
  }
  async function renderPage(p){
    const wrap = h("div", { class: "pdfpage", "data-id": p.id });
    let cw, ch;
    if(p.src.type === "orig"){
      const page = await pdfjsDoc.getPage(p.src.idx + 1);
      const rot = (page.rotate + p.rotation) % 360;
      const viewport = page.getViewport({ scale: zoom, rotation: rot });
      cw = viewport.width; ch = viewport.height;
      if(pageList[0] === p) pageW1 = page.getViewport({ scale: 1, rotation: rot }).width;
      const { c: canvas, dpr } = makeCanvas(cw, ch);
      wrap.append(canvas);
      const key = [p.id, zoom, p.rotation, dpr].join("|");
      wrap._draw = async () => {
        wrap._draw = null;
        const ctx = canvas.getContext("2d"), hit = pageBitmaps.get(key);
        if(hit){ ctx.drawImage(hit, 0, 0); return; }
        ctx.save(); ctx.scale(dpr, dpr);
        try{ await page.render({ canvasContext: ctx, viewport }).promise; }catch(e){ return; }
        ctx.restore();
        const copy = document.createElement("canvas"); copy.width = canvas.width; copy.height = canvas.height; copy.getContext("2d").drawImage(canvas, 0, 0);
        pageBitmaps.set(key, copy); if(pageBitmaps.size > 24) pageBitmaps.delete(pageBitmaps.keys().next().value);
      };
      io.observe(wrap);
    }else{
      cw = BLANK_W * zoom; ch = BLANK_H * zoom;
      const { c: canvas } = makeCanvas(cw, ch);
      const ctx = canvas.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
      wrap.append(canvas);
    }
    wrap.style.width = cw + "px"; wrap.style.height = ch + "px";
    const overlay = h("div", { class: "overlay", style: { width: cw + "px", height: ch + "px" } });
    wrap.append(overlay);
    wrap.append(h("div", { class: "pagenum" }, "Page " + (pageList.indexOf(p) + 1) + " of " + pageList.length));
    (anns[p.id] || []).forEach(a => overlay.append(annEl(a, cw, ch)));
    hits.forEach((ht, i) => { if(ht.pid !== p.id) return; ht.rects.forEach(r => overlay.append(h("div", { class: "searchhit" + (i === hitIdx ? " cur" : ""), "data-hit": i, style: { left: (r.x * cw) + "px", top: (r.y * ch) + "px", width: Math.max(4, r.w * cw) + "px", height: Math.max(4, r.h * ch) + "px" } }))); });
    wireOverlay(overlay, p, () => ({ cw, ch }));
    return wrap;
  }

  function annEl(a, cw, ch){
    const base = { position: "absolute", left: (a.x * cw) + "px", top: (a.y * ch) + "px" };
    const isSel = a === selAnn ? " sel" : "";
    let el;
    if(a.type === "highlight" || a.type === "shape" || a.type === "whiteout" || a.type === "redact" || a.type.startsWith("field")){
      el = h("div", { class: "annot " + (a.type.startsWith("field") ? "field" : a.type) + isSel, style: { ...base, width: (a.w * cw) + "px", height: (a.h * ch) + "px", background: a.type === "highlight" ? a.color : undefined, borderColor: a.color, opacity: a.type === "highlight" ? .45 : 1 } }, a.type === "field-text" ? "Text field" : a.type === "field-check" ? "☐" : a.type === "field-sig" ? "Sign here" : "");
    }else if(a.type === "underlinetext" || a.type === "strikeline"){
      el = h("div", { class: "annot " + a.type + isSel, style: { ...base, width: (a.w * cw) + "px", height: (a.h * ch) + "px" } });
      el.append(h("div", { style: { position: "absolute", left: 0, right: 0, top: a.type === "strikeline" ? "50%" : "100%", height: Math.max(2, a.strokeW || 2) + "px", background: a.color } }));
    }else if(a.type === "note"){
      el = h("div", { class: "annot note" + isSel, style: { ...base } }, N.icEl("note"));
      el.title = a.text || "";
      el.addEventListener("click", async e => { if(currentTool !== "select" || e.target.closest(".ahandle")) return; e.stopPropagation(); const t = await N.prompt("Note", a.text || "", { label: "Note text" }); if(t != null){ a.text = t; el.title = t; S.touch(); } });
    }else if(a.type === "text"){
      el = h("div", { class: "annot text" + isSel, style: { ...base, width: (a.w * cw) + "px", minHeight: (a.h * ch) + "px" } });
      const inner = h("div", { class: "tin", contenteditable: "true", spellcheck: "false", style: { color: a.color, fontSize: (a.size || 16) * zoom + "px", fontWeight: a.bold ? "700" : "400" } });
      inner.innerHTML = a.text || "";
      inner.addEventListener("input", () => { a.text = inner.innerHTML; S.touch(); });
      inner.addEventListener("focus", () => { if(selAnn !== a) selectAnn(a, el); });
      inner.addEventListener("pointerdown", e => e.stopPropagation());
      el.append(inner);
      el._inner = inner; el._ann = a;
    }else if(a.type === "draw"){
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("style", `position:absolute;left:0;top:0;width:${cw}px;height:${ch}px;pointer-events:none`);
      const pts = a.points.map(p2 => (p2.x * cw) + "," + (p2.y * ch)).join(" ");
      const pl = document.createElementNS(svg.namespaceURI, "polyline"); pl.setAttribute("points", pts); pl.setAttribute("fill", "none"); pl.setAttribute("stroke", a.color); pl.setAttribute("stroke-width", a.strokeW || 3); pl.setAttribute("stroke-linecap", "round"); pl.setAttribute("stroke-linejoin", "round");
      svg.append(pl); return svg;
    }else if(a.type === "stamp"){
      el = h("div", { class: "annot" + isSel, style: { ...base, width: (a.w * cw) + "px", height: (a.h * ch) + "px", border: "3px solid " + a.color, color: a.color, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: (16 * zoom) + "px", transform: "rotate(-8deg)", borderRadius: "6px" } }, a.text);
    }else if(a.type === "image"){
      el = h("div", { class: "annot image" + isSel, style: { ...base, width: (a.w * cw) + "px", height: (a.h * ch) + "px" } }, h("img", { src: a.src, alt: "", draggable: false, style: { width: "100%", height: "100%", objectFit: "fill", pointerEvents: "none" } }));
    }else return h("div");
    wireAnnSelect(el, a);
    if(a === selAnn) addAnnHandles(el, a);
    return el;
  }

  /* ---- selecting, moving, resizing and deleting marks (mouse, pen and touch) ---- */
  function selectAnn(a, el){
    selAnn = a;
    document.querySelectorAll(".pdfpage .annot.sel").forEach(x => { x.classList.remove("sel"); x.querySelectorAll(":scope>.ahandle").forEach(y => y.remove()); });
    if(a && el){ el.classList.add("sel"); addAnnHandles(el, a); }
  }
  function removeAnn(a){
    for(const pid in anns) anns[pid] = anns[pid].filter(x => x !== a);
    selAnn = null; renderAll(); renderThumbs(); S.touch();
  }
  function addAnnHandles(el, a){
    if(el.querySelector(":scope>.ahandle")) return;
    const bar = h("div", { class: "ahandle bar" });
    bar.append(h("button", { class: "ahandle mv", type: "button", "aria-label": "Move" }, N.icEl("move")));
    if(a.type === "text"){
      const sz = d => h("button", { class: "ahandle txt", type: "button", "aria-label": d > 0 ? "Larger text" : "Smaller text", onclick: e => { e.stopPropagation(); a.size = N.clamp((a.size || 16) + d * 2, 8, 72); if(el._inner) el._inner.style.fontSize = a.size * zoom + "px"; S.touch(); } }, d > 0 ? "A+" : "A−");
      bar.append(sz(-1), sz(1));
    }
    bar.append(h("button", { class: "ahandle del", type: "button", "aria-label": "Delete", onclick: e => { e.stopPropagation(); removeAnn(a); } }, N.icEl("trash")));
    el.append(bar);
    if(a.w != null && a.type !== "note") el.append(h("div", { class: "ahandle se", "aria-label": "Resize" }));
  }
  function wireAnnSelect(el, a){
    const dims = () => { const ov = el.closest(".overlay"); return { cw: ov ? ov.offsetWidth : 1, ch: ov ? ov.offsetHeight : 1 }; };
    const isText = a.type === "text";
    N.drag(el, {
      filter: e => {
        if(currentTool !== "select") return false;
        if(e.target.closest(".ahandle.se") || e.target.closest(".ahandle.del") || e.target.closest(".ahandle.txt")) return false;
        if(isText && !e.target.closest(".ahandle.mv")) return false;      /* the middle of a text box belongs to the caret */
        return true;
      },
      start: e => { e.stopPropagation(); if(selAnn !== a) selectAnn(a, el); const d = dims(); return { x: a.x, y: a.y, cw: d.cw, ch: d.ch }; },
      move: (dx, dy, e, st) => { a.x = N.clamp(st.x + dx / st.cw, -.05, 1.0); a.y = N.clamp(st.y + dy / st.ch, -.05, 1.0); el.style.left = (a.x * st.cw) + "px"; el.style.top = (a.y * st.ch) + "px"; },
      end: moved => { if(moved){ renderThumbs(); S.touch(); } }
    });
    N.drag(el, {
      filter: e => currentTool === "select" && !!e.target.closest(".ahandle.se"),
      start: e => { e.stopPropagation(); const d = dims(); return { w: a.w, h: a.h, cw: d.cw, ch: d.ch }; },
      move: (dx, dy, e, st) => {
        a.w = Math.max(.02, st.w + dx / st.cw); a.h = Math.max(.01, st.h + dy / st.ch);
        el.style.width = (a.w * st.cw) + "px"; if(isText) el.style.minHeight = (a.h * st.ch) + "px"; else el.style.height = (a.h * st.ch) + "px";
      },
      end: moved => { if(moved){ renderThumbs(); S.touch(); } }
    });
    el.addEventListener("click", e => { if(currentTool === "select" && selAnn !== a && !e.target.closest(".ahandle")){ e.stopPropagation(); selectAnn(a, el); } });
  }
  function deselectAnn(){ if(selAnn){ if(document.activeElement && document.activeElement.blur) document.activeElement.blur(); selectAnn(null, null); } }

  function wireOverlay(overlay, p, dims){
    let drawing = null;
    overlay.addEventListener("pointerdown", e => {
      if(currentTool === "select" || currentTool === "pan") { if(e.target === overlay && selAnn) deselectAnn(); return; }
      e.preventDefault();
      const { cw, ch } = dims();
      const rect = overlay.getBoundingClientRect();
      const x0 = (e.clientX - rect.left) / cw, y0 = (e.clientY - rect.top) / ch;

      if(currentTool === "note"){ addAnn(p, { id: newId(), type: "note", x: x0, y: y0, text: "" }); setTool("select"); return; }
      if(currentTool === "stamp"){ pickStamp(x0, y0, p); return; }
      if(currentTool === "image" && pendingImage){ placeImage(p, x0, y0, cw, ch); return; }
      if(currentTool === "draw"){
        const a = { id: newId(), type: "draw", points: [{ x: x0, y: y0 }], color: annColor, strokeW: annWidth };
        anns[p.id] = anns[p.id] || []; anns[p.id].push(a); annLog.unshift({ pid: p.id, a });
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); svg.setAttribute("style", `position:absolute;left:0;top:0;width:${cw}px;height:${ch}px;pointer-events:none`);
        const pl = document.createElementNS(svg.namespaceURI, "polyline"); pl.setAttribute("fill", "none"); pl.setAttribute("stroke", annColor); pl.setAttribute("stroke-width", annWidth); pl.setAttribute("stroke-linecap", "round"); pl.setAttribute("stroke-linejoin", "round");
        svg.append(pl); overlay.append(svg);
        const onMove = ev => { const r2 = overlay.getBoundingClientRect(); a.points.push({ x: (ev.clientX - r2.left) / cw, y: (ev.clientY - r2.top) / ch }); pl.setAttribute("points", a.points.map(pt => (pt.x * cw) + "," + (pt.y * ch)).join(" ")); };
        const onUp = () => { removeEventListener("pointermove", onMove); removeEventListener("pointerup", onUp); removeEventListener("pointercancel", onUp); S.touch(); };
        addEventListener("pointermove", onMove); addEventListener("pointerup", onUp); addEventListener("pointercancel", onUp);
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
        removeEventListener("pointermove", onMove); removeEventListener("pointerup", onUp); removeEventListener("pointercancel", onUp);
        box.remove();
        const g = box._geo || { x: x0, y: y0, w: .15, h: .03 };
        if(g.w < .005 && g.h < .005){ g.w = .18; g.h = .035; }
        finishBoxTool(tool, p, g);
      };
      addEventListener("pointermove", onMove); addEventListener("pointerup", onUp); addEventListener("pointercancel", onUp);
    });
  }
  function addAnn(p, a){ anns[p.id] = anns[p.id] || []; anns[p.id].push(a); annLog.unshift({ pid: p.id, a }); if(a.type !== "draw"){ selAnn = a; } renderAll(); renderThumbs(); S.touch();
    if(a.type === "text") setTimeout(() => { const el = [...document.querySelectorAll(".pdfpage .annot.text")].find(x => x._ann === a); if(el && el._inner) el._inner.focus(); }, 30);   /* open the keyboard straight away */
  }
  function undoAnn(){
    while(annLog.length){
      const { pid, a } = annLog.shift();
      if((anns[pid] || []).includes(a)){ anns[pid] = anns[pid].filter(x => x !== a); if(selAnn === a) selAnn = null; renderAll(); renderThumbs(); S.touch(); return; }
    }
    N.toast("Nothing to undo.");
  }
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
  async function placeImage(p, x, y, cw, ch){
    const src = pendingImage; pendingImage = null;
    const dim = await N.imgSize(src);
    const w = .3, hh = w * (cw / ch) * (dim.h / dim.w);
    addAnn(p, { id: newId(), type: "image", x: N.clamp(x, 0, 1 - w), y: N.clamp(y, 0, Math.max(0, 1 - hh)), w, h: hh, src });
    setTool("select");
  }
  /* big phone photos would bloat the PDF, so shrink them (keeping transparency for PNG signatures) */
  async function prepImage(file){
    const url = await N.readDataURL(file);
    const im = await new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = url; });
    if(!im) return url;
    const max = 1800, k = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight));
    const jpeg = /jpe?g/i.test(file.type);
    if(k === 1 && (file.type === "image/png" || (jpeg && file.size < 700000))) return url;
    const c = document.createElement("canvas"); c.width = Math.round(im.naturalWidth * k); c.height = Math.round(im.naturalHeight * k);
    c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
    return jpeg ? c.toDataURL("image/jpeg", .86) : c.toDataURL("image/png");
  }

  /* ---------- signature ---------- */
  function signatureDialog(){
    const cv = h("canvas", { width: 720, height: 280, style: { width: "100%", border: "1px dashed var(--line)", borderRadius: "8px", background: "#fff", touchAction: "none", display: "block" } });
    const ctx = cv.getContext("2d"); ctx.lineWidth = 5; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = ctx.fillStyle = "#14181f";
    let down = false, last = null, box = null;
    const pos = e => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * cv.width / r.width, y: (e.clientY - r.top) * cv.height / r.height }; };
    const grow = q => { box = box ? { x0: Math.min(box.x0, q.x), y0: Math.min(box.y0, q.y), x1: Math.max(box.x1, q.x), y1: Math.max(box.y1, q.y) } : { x0: q.x, y0: q.y, x1: q.x, y1: q.y }; };
    cv.addEventListener("pointerdown", e => { e.preventDefault(); down = true; last = pos(e); grow(last); try{ cv.setPointerCapture(e.pointerId); }catch(_){} ctx.beginPath(); ctx.arc(last.x, last.y, 2.5, 0, 7); ctx.fill(); });
    cv.addEventListener("pointermove", e => { if(!down) return; const q = pos(e); ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(q.x, q.y); ctx.stroke(); last = q; grow(q); });
    const up = () => { down = false; };
    cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", up);
    N.dialog({ title: "Draw your signature", width: 520, body: h("div", { class: "field" }, h("span", null, "Sign with your finger, a stylus or the mouse."), cv),
      buttons: [
        { label: "Clear", run: () => { ctx.clearRect(0, 0, cv.width, cv.height); box = null; return false; } },
        { label: "Cancel" },
        { label: "Use signature", pri: true, run: () => {
          if(!box){ N.toast("Draw your signature first."); return false; }
          const pad = 8, x = Math.max(0, box.x0 - pad), y = Math.max(0, box.y0 - pad), w = Math.min(cv.width - x, box.x1 - box.x0 + pad * 2), hgt = Math.min(cv.height - y, box.y1 - box.y0 + pad * 2);
          const out = document.createElement("canvas"); out.width = Math.max(4, Math.round(w)); out.height = Math.max(4, Math.round(hgt));
          out.getContext("2d").drawImage(cv, x, y, w, hgt, 0, 0, out.width, out.height);
          pendingImage = out.toDataURL("image/png"); setTool("image"); N.toast("Tap the page where the signature should go.");
        } }
      ] });
  }

  $("#toolSelect").addEventListener("click", () => setTool("select"));
  $("#toolPan").addEventListener("click", () => setTool("pan"));
  $("#editTextBtn").addEventListener("click", () => setTool("text"));
  $("#editImgBtn").addEventListener("click", async () => { const [f] = await N.pick("image/*"); if(!f) return; pendingImage = await prepImage(f); setTool("image"); N.toast("Tap the page where the picture should go."); });
  $("#signBtn").addEventListener("click", signatureDialog);
  $("#undoAnnBtn").addEventListener("click", undoAnn);
  $("#whiteoutBtn").addEventListener("click", () => setTool("whiteout"));
  $("#redactBtn").addEventListener("click", () => { setTool("redact"); N.toast("Draw a box over content to redact. Redacted areas are permanently removed from the exported PDF (the page is flattened to an image)."); });
  $("#eraseAnnBtn").addEventListener("click", () => { setTool("select"); N.toast("Tap a mark, then tap the bin on it. Use Undo to take back the last one, or Clear page to remove them all.", 4200); });
  $("#clearAnnBtn").addEventListener("click", async () => {
    const p = pageList[curPageIndex()]; if(!p) return;
    if(await N.confirm("Remove all annotations and markup from this page?", { ok: "Clear", danger: true })){ anns[p.id] = []; renderAll(); renderThumbs(); S.touch(); }
  });
  document.addEventListener("keydown", e => {
    if((e.key === "Delete" || e.key === "Backspace") && selAnn && !(document.activeElement && (document.activeElement.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)))){
      e.preventDefault(); removeAnn(selAnn);
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
    if(!hasDoc()){ N.toast("Open a PDF first."); return; }
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
    if(!hasDoc()){ N.toast("Open a PDF first."); return; }
    const i = curPageIndex(); const bytes = await buildPdfBytes([pageList[i]]);
    N.download(bytes, fileBase() + "-p" + (i + 1) + ".pdf", "application/pdf");
  });
  $("#mergeBtn").addEventListener("click", async () => {
    const files = await N.pick(".pdf", true); if(!files.length) return;
    const PDFLib = await N.lib("pdflib");
    const out = await PDFLib.PDFDocument.create();
    if(pdfBytes || pageList.some(p => p.src.type === "blank")){
      const mine = await buildPdfBytes(pageList, { plain: true });
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
    if(!hasDoc()){ N.toast("Open a PDF first."); return; }
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
  $("#pwBtn").addEventListener("click", () => {
    const a = h("input", { class: "inp", type: "password", autocomplete: "new-password", placeholder: "Password" });
    const b = h("input", { class: "inp", type: "password", autocomplete: "new-password", placeholder: "Type it again" });
    N.dialog({
      title: docPassword ? "Change or remove the password" : "Protect with a password", width: 420,
      body: h("div", { class: "field" }, h("span", null, "Anyone opening the exported PDF will need this password. It uses AES-256 encryption and is applied when you export or extract pages. It is not kept on this device, and a lost password can't be recovered."), a, b),
      buttons: [
        { label: "Cancel" },
        docPassword ? { label: "Remove", danger: true, run: () => { docPassword = null; N.toast("Password removed. Exports will open without one."); } } : null,
        { label: "Set password", pri: true, run: () => {
          if(!a.value){ N.toast("Type a password first."); return false; }
          if(a.value !== b.value){ N.toast("The two passwords don't match."); return false; }
          docPassword = a.value; N.toast("Password set. Export to save a protected copy.");
        } }
      ].filter(Boolean)
    });
  });
  $("#watermarkPdfBtn").addEventListener("click", async () => {
    const t = await N.prompt("Watermark text", "CONFIDENTIAL", { label: "Applied to every page on export" });
    if(t == null) return;
    docWatermark = t || null; N.toast(t ? "Watermark set — it will appear in the exported PDF." : "Watermark removed.");
  });
  let docWatermark = null;

  /* ---------- pan tool & pinch zoom ---------- */
  $("#pdfwrap").addEventListener("pointerdown", e => {
    if(currentTool !== "pan" || e.pointerType === "touch") return;
    const w = $("#pdfwrap"), sx = e.clientX, sy = e.clientY, l = w.scrollLeft, t = w.scrollTop;
    try{ w.setPointerCapture(e.pointerId); }catch(_){}
    w.style.cursor = "grabbing";
    const mv = ev => { w.scrollLeft = l - (ev.clientX - sx); w.scrollTop = t - (ev.clientY - sy); };
    const up = () => { w.removeEventListener("pointermove", mv); w.removeEventListener("pointerup", up); w.style.cursor = "grab"; };
    w.addEventListener("pointermove", mv); w.addEventListener("pointerup", up);
  });
  (function pinch(){
    const w = $("#pdfwrap"), pages = $("#pdfPages"), dist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    let d0 = 0, z0 = 100, zNew = 0, focus = null;
    w.addEventListener("touchstart", e => {
      if(e.touches.length !== 2) return;
      d0 = dist(e.touches); z0 = +$("#zoomRange").value; zNew = 0;
      const wr = w.getBoundingClientRect(), pr = pages.getBoundingClientRect();
      const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2, cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      focus = { cx: cx - wr.left, cy: cy - wr.top, sx: w.scrollLeft + cx - wr.left, sy: w.scrollTop + cy - wr.top };
      pages.style.transformOrigin = (cx - pr.left) + "px " + (cy - pr.top) + "px";     /* zoom around the fingers, not the page top */
    }, { passive: true });
    w.addEventListener("touchmove", e => { if(e.touches.length === 2 && d0){ e.preventDefault(); zNew = N.clamp(Math.round(z0 * dist(e.touches) / d0), 40, 300); pages.style.transform = "scale(" + (zNew / z0) + ")"; } }, { passive: false });
    const end = e => {
      if(d0 && e.touches.length < 2){
        d0 = 0; pages.style.transform = ""; pages.style.transformOrigin = "";
        if(zNew && zNew !== z0){ window.__pinchFocus = { ...focus, k: zNew / z0 }; $("#zoomRange").value = zNew; $("#zoomRange").dispatchEvent(new Event("input")); }
        zNew = 0;
      }
    };
    w.addEventListener("touchend", end); w.addEventListener("touchcancel", end);
  })();

  /* ---------- view controls ---------- */
  $("#openBigBtn").addEventListener("click", async () => { const [f] = await N.pick(".pdf"); if(f) openFile(f); });
  N.dropFiles($("#pdfwrap"), files => { const f = files.find(x => /\.pdf$/i.test(x.name)); if(f) openFile(f); else N.toast("Drop a .pdf file."); });
  $("#zoomRange").addEventListener("input", N.debounce(async () => {
    const sc = $("#pdfwrap"), rt = sc.scrollTop / Math.max(1, sc.scrollHeight), rl = sc.scrollLeft / Math.max(1, sc.scrollWidth);
    zoom = $("#zoomRange").value / 100; $("#zoomLabel").textContent = $("#zoomRange").value + "%";
    const pf = window.__pinchFocus; window.__pinchFocus = null;
    if(hasDoc()){
      await renderAll();
      if(pf){ sc.scrollTop = pf.sy * pf.k - pf.cy; sc.scrollLeft = pf.sx * pf.k - pf.cx; }    /* keep the pinched spot under your fingers */
      else{ sc.scrollTop = rt * sc.scrollHeight; sc.scrollLeft = rl * sc.scrollWidth; }       /* stay on the same spot after zooming */
    }
  }, 150));
  $("#zoomIn").addEventListener("click", () => { $("#zoomRange").value = Math.min(300, +$("#zoomRange").value + 10); $("#zoomRange").dispatchEvent(new Event("input")); });
  $("#zoomOut").addEventListener("click", () => { $("#zoomRange").value = Math.max(40, +$("#zoomRange").value - 10); $("#zoomRange").dispatchEvent(new Event("input")); });
  $("#fitBtn").addEventListener("click", () => { const w = $("#pdfwrap").clientWidth - (N.isPhone() ? 20 : 48); $("#zoomRange").value = N.clamp(Math.round(w / (pageW1 / zoom) * 100), 40, 300); $("#zoomRange").dispatchEvent(new Event("input")); });
  let paged = false;
  $("#scrollModeBtn").addEventListener("click", () => {
    paged = !paged; $("#pdfwrap").classList.toggle("paged", paged);
    const b = $("#scrollModeBtn"), t = b.lastChild; if(t && t.nodeType === 3) t.textContent = paged ? "Page by page" : "Continuous";
    N.toast(paged ? "Pages now snap into place as you scroll." : "Continuous scrolling.");
  });
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
  const findInp = h("input", { class: "inp", type: "search", placeholder: "Find in document", enterkeyhint: "search", autocomplete: "off", spellcheck: false, "aria-label": "Find in document" });
  const findCount = h("span", { class: "findcount" }, "");
  const findBar = h("div", { class: "findbar", hidden: true }, findInp, findCount,
    h("button", { class: "ib", type: "button", "aria-label": "Previous match", onclick: () => stepHit(-1) }, N.icEl("chevU")),
    h("button", { class: "ib", type: "button", "aria-label": "Next match", onclick: () => stepHit(1) }, N.icEl("chevD")),
    h("button", { class: "ib", type: "button", "aria-label": "Close search", onclick: () => closeFind() }, N.icEl("x")));
  document.querySelector(".body").append(findBar);
  async function runSearch(q){
    hits = []; hitIdx = -1;
    q = (q || "").trim();
    if(!q){ findCount.textContent = ""; renderAll(); return; }
    const lib = await N.lib("pdfjs"), needle = q.toLowerCase();
    for(const p of pageList){
      if(hits.length > 500) break;
      if(p.src.type === "orig" && pdfjsDoc){
        const page = await pdfjsDoc.getPage(p.src.idx + 1);
        const vp = page.getViewport({ scale: 1, rotation: (page.rotate + p.rotation) % 360 });
        const tc = await page.getTextContent();
        for(const it of tc.items){
          if(!it.str) continue;
          const low = it.str.toLowerCase(); let from = 0, i;
          while((i = low.indexOf(needle, from)) !== -1){
            from = i + Math.max(1, needle.length);
            const tr = lib.Util.transform(vp.transform, it.transform), n = it.str.length;
            const len = Math.hypot(tr[0], tr[1]) || 1, dx = tr[0] / len, dy = tr[1] / len;
            const off = (i / n) * it.width, w = (needle.length / n) * it.width;
            const x0 = tr[4] + dx * off, y0 = tr[5] + dy * off, x1 = x0 + dx * w, y1 = y0 + dy * w;
            const xs = [x0, x1, x1 + tr[2], x0 + tr[2]], ys = [y0, y1, y1 + tr[3], y0 + tr[3]];
            const x = Math.min(...xs), y = Math.min(...ys);
            hits.push({ pid: p.id, rects: [{ x: x / vp.width, y: y / vp.height, w: (Math.max(...xs) - x) / vp.width, h: (Math.max(...ys) - y) / vp.height }] });
          }
        }
      }
      (p.ocr || []).forEach(ln => { if((ln.t || "").toLowerCase().includes(needle)) hits.push({ pid: p.id, rects: [{ x: ln.x, y: ln.y, w: ln.w, h: ln.h }] }); });
    }
    findCount.textContent = hits.length ? "1 of " + hits.length : "No matches";
    hitIdx = hits.length ? 0 : -1;
    await renderAll();
    if(hits.length) showHit(0); else if(pageList.some(p => p.src.type === "orig")) N.toast("Nothing found. If this is a scan, use Edit → Make searchable first.", 3600);
  }
  function showHit(i){
    hitIdx = i; findCount.textContent = (i + 1) + " of " + hits.length;
    document.querySelectorAll(".searchhit.cur").forEach(x => x.classList.remove("cur"));
    const el = document.querySelector('.searchhit[data-hit="' + i + '"]');
    if(el){ el.classList.add("cur"); el.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" }); }
  }
  function stepHit(d){ if(!hits.length) return; showHit((hitIdx + d + hits.length) % hits.length); }
  function closeFind(){ findBar.hidden = true; if(hits.length){ hits = []; hitIdx = -1; renderAll(); } findInp.value = ""; findCount.textContent = ""; }
  findInp.addEventListener("keydown", e => { if(e.key === "Enter"){ e.preventDefault(); e.stopPropagation(); if(hits.length && findInp.dataset.q === findInp.value) stepHit(e.shiftKey ? -1 : 1); else{ findInp.dataset.q = findInp.value; runSearch(findInp.value); } } else if(e.key === "Escape") closeFind(); });
  findInp.addEventListener("input", N.debounce(() => { findInp.dataset.q = findInp.value; runSearch(findInp.value); }, 450));
  $("#searchBtn").addEventListener("click", () => {
    if(!hasDoc()){ N.toast("Open a PDF first."); return; }
    findBar.hidden = false; findInp.focus(); findInp.select();
  });
  document.addEventListener("keydown", e => { if((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f" && hasDoc()){ e.preventDefault(); findBar.hidden = false; findInp.focus(); findInp.select(); } });

  /* ---------- make scanned pages searchable (text recognition) ---------- */
  const ocrJobs = {}; let ocrSeq = 0;
  window.__nyxOcrDone = (id, json) => { const j = ocrJobs[id]; if(!j) return; delete ocrJobs[id]; try{ const r = JSON.parse(json); if(r.error) j.rej(new Error(r.error)); else j.res(r); }catch(e){ j.rej(e); } };
  const ocrCall = (b64, script) => new Promise((res, rej) => {
    const id = ++ocrSeq; ocrJobs[id] = { res, rej };
    try{ N.native.ocr(id, b64, script); }catch(e){ delete ocrJobs[id]; rej(e); return; }
    setTimeout(() => { if(ocrJobs[id]){ delete ocrJobs[id]; rej(new Error("Text recognition took too long on that page.")); } }, 90000);
  });
  async function recognise(script){
    const targets = pageList.filter(p => p.src.type === "orig");
    if(!targets.length){ N.toast("There are no scanned pages to read."); return; }
    let done = 0, found = 0;
    try{
      for(const p of targets){
        N.toast("Reading page " + (done + 1) + " of " + targets.length + "…", 60000);
        const page = await pdfjsDoc.getPage(p.src.idx + 1);
        const rot = (page.rotate + p.rotation) % 360, v1 = page.getViewport({ scale: 1, rotation: rot });
        const k = Math.min(3, 2000 / Math.max(v1.width, v1.height)), vp = page.getViewport({ scale: k, rotation: rot });
        const c = document.createElement("canvas"); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
        const ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        const r = await ocrCall(c.toDataURL("image/jpeg", .9).split(",")[1], script);
        p.ocr = (r.lines || []).filter(l => l.t && l.t.trim()).map(l => ({ t: l.t, x: l.x0 / r.w, y: l.y0 / r.h, w: (l.x1 - l.x0) / r.w, h: (l.y1 - l.y0) / r.h }));
        found += p.ocr.length; done++;
      }
      S.touch();
      N.toast(found ? "Done — read " + found + " lines of text. Use Find to search them; Export saves a searchable PDF." : "Finished, but no text was found.", 5200);
    }catch(e){ console.error(e); N.alert("Text recognition stopped: " + (e && e.message ? e.message : e) + (done ? "\n\n" + done + " page(s) were read before that." : ""), "Make searchable"); if(done) S.touch(); }
  }
  $("#ocrBtn").addEventListener("click", () => {
    if(!(N.native && N.native.ocr)){ N.alert("Reading the text on scanned pages uses the recognition engine built into the Nyxdesk Android app, so it works there. In a browser tab it isn't available yet.\n\nEverything else in Parchment works the same on every device.", "Make searchable"); return; }
    if(!hasDoc() || !pdfjsDoc){ N.toast("Open a scanned PDF first."); return; }
    N.menu($("#ocrBtn"), [
      { head: "Language of the text" },
      { label: "English and other Latin scripts", run: () => recognise("latin") },
      { label: "Hindi (Devanagari)", run: () => recognise("devanagari") }
    ]);
  });

  /* ---------- export ---------- */
  function fileBase(){ return ($("#docTitle").value || "document").trim() || "document"; }
  async function buildPdfBytes(list, opts){
    opts = opts || {};
    const PDFLib = await N.lib("pdflib");
    const { PDFDocument, rgb, StandardFonts, degrees } = PDFLib;
    const out = await PDFDocument.create();
    const font = await out.embedFont(StandardFonts.HelveticaBold);
    const fontR = await out.embedFont(StandardFonts.Helvetica);
    const srcDocCache = {};
    async function srcDoc(){ if(!srcDocCache.d) srcDocCache.d = await PDFDocument.load(pdfBytes.slice ? pdfBytes.slice(0) : pdfBytes); return srcDocCache.d; }

    for(const p of list){
      let page;
      /* a rotated page with marks on it is baked to an image so the marks land where they were drawn */
      let needsFlatten = !!p.needsFlatten;
      if(!needsFlatten && p.src.type === "orig" && (anns[p.id] || []).length && pdfjsDoc){
        const pg = await pdfjsDoc.getPage(p.src.idx + 1);
        if(((pg.rotate + p.rotation) % 360) !== 0) needsFlatten = true;
      }
      if(p.src.type === "orig" && !needsFlatten){
        const d = await srcDoc();
        const [copied] = await out.copyPages(d, [p.src.idx]);
        page = out.addPage(copied);
        if(p.rotation) page.setRotation(degrees((page.getRotation().angle + p.rotation) % 360));
      }else if(p.src.type === "orig" && needsFlatten){
        const dataUrl = await flattenPageToImage(p);
        const png = await out.embedPng(dataUrl);
        page = out.addPage([png.width / 2, png.height / 2]);          /* rendered at 2x, so halve to get back to page points */
        page.drawImage(png, { x: 0, y: 0, width: png.width / 2, height: png.height / 2 });
      }else{
        page = out.addPage([BLANK_W, BLANK_H]);
      }
      const { width: pw, height: ph } = page.getSize();
      const list2 = anns[p.id] || [];
      for(const a of list2){
        if(a.type === "redact" && !needsFlatten) continue; // already baked via flatten path
        await drawAnnotation(page, a, pw, ph, { rgb, font, fontR, out });
      }
      if(p.ocr && p.ocr.length && !p.rotation && !needsFlatten) drawOcrLayer(page, p.ocr, pw, ph, fontR);
      if(docWatermark){
        page.drawText(docWatermark, { x: pw * .15, y: ph * .45, size: Math.min(pw, ph) * .09, font, color: rgb(.6, .6, .6), opacity: .25, rotate: degrees(30) });
      }
    }
    if(docPassword && !opts.plain){
      if(!window.Nyx.pdfEncrypt) throw new Error("Password protection didn't load.");
      return window.Nyx.pdfEncrypt(PDFLib, out, docPassword);
    }
    return out.save();
  }
  /* invisible text under a scanned page, so the exported PDF can be searched and selected */
  function drawOcrLayer(page, lines, pw, ph, font){
    const ok = t => Array.from(t).filter(ch => { try{ font.encodeText(ch); return true; }catch(e){ return false; } }).join("").trim();
    for(const ln of lines){
      const t = ok(ln.t || ""); if(!t) continue;
      let size = Math.max(4, ln.h * ph * .8);
      const wTarget = ln.w * pw, wNow = font.widthOfTextAtSize(t, size);
      if(wNow > wTarget * 1.05 && wNow > 0) size = Math.max(3, size * wTarget / wNow);
      try{ page.drawText(t, { x: ln.x * pw, y: ph - (ln.y + ln.h) * ph + ln.h * ph * .2, size, font, opacity: 0 }); }catch(e){}
    }
  }
  /* text the standard PDF fonts can't draw (Hindi, emoji…) is drawn as a picture so export never fails on it */
  async function textAsImage(out, page, txt, x, topY, wPts, size, hex){
    const sc = 3, c = document.createElement("canvas"), ctx = c.getContext("2d");
    const font = (size * sc) + "px " + (getComputedStyle(document.body).fontFamily || "sans-serif");
    ctx.font = font;
    const maxW = Math.max(60, (wPts || 300)) * sc, lines = [];
    txt.split("\n").forEach(par => { let cur = ""; par.split(" ").forEach(wd => { const t = cur ? cur + " " + wd : wd; if(ctx.measureText(t).width > maxW && cur){ lines.push(cur); cur = wd; } else cur = t; }); lines.push(cur); });
    const lh = size * sc * 1.3;
    c.width = Math.ceil(maxW) + 6; c.height = Math.ceil(lines.length * lh) + 6;
    ctx.font = font; ctx.fillStyle = hex || "#000"; ctx.textBaseline = "top";
    lines.forEach((l, i) => ctx.fillText(l, 3, 3 + i * lh));
    const png = await out.embedPng(N.dataURLtoBytes(c.toDataURL("image/png")));
    page.drawImage(png, { x, y: topY - c.height / sc, width: c.width / sc, height: c.height / sc });
  }
  async function drawImageAnn(out, page, a, pw, ph){
    let bytes, kind = /^data:image\/jpe?g/i.test(a.src) ? "jpg" : /^data:image\/png/i.test(a.src) ? "png" : "";
    if(kind) bytes = N.dataURLtoBytes(a.src);
    else{
      const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = a.src; });
      const c = document.createElement("canvas"); c.width = im.naturalWidth; c.height = im.naturalHeight; c.getContext("2d").drawImage(im, 0, 0);
      bytes = N.dataURLtoBytes(c.toDataURL("image/png")); kind = "png";
    }
    const img = kind === "jpg" ? await out.embedJpg(bytes) : await out.embedPng(bytes);
    page.drawImage(img, { x: a.x * pw, y: ph - (a.y + a.h) * ph, width: a.w * pw, height: a.h * ph });
  }
  async function drawAnnotation(page, a, pw, ph, lib){
    const { rgb, font, fontR, out } = lib;
    if(a.type === "image" && a.src){ try{ await drawImageAnn(out, page, a, pw, ph); }catch(e){ console.error(e); } return; }
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
    }else if(a.type === "text"){
      const txt = stripHtml(a.text || "").trim(), size = a.size || 16;
      if(txt){
        const topY = ph - a.y * ph;
        try{ page.drawText(txt, { x: X + 2, y: topY - size, size, font: a.bold ? font : fontR, color: rgb(col.r, col.g, col.b), maxWidth: Wd || 300, lineHeight: size * 1.2 }); }
        catch(e){ await textAsImage(out, page, txt, X + 2, topY, Wd - 4, size, a.color); }
      }
    }else if(a.type === "stamp" || a.type.startsWith("field")){
      const txt = stripHtml(a.text || (a.type === "field-text" ? "" : a.type === "field-check" ? "[ ]" : a.type === "field-sig" ? "Sign here" : ""));
      if(txt) page.drawText(txt, { x: X + 2, y: Y + Ht / 2 - 6, size: (a.size || 14), font, color: rgb(col.r, col.g, col.b), maxWidth: Wd || 300 });
      if(a.type.startsWith("field")) page.drawRectangle({ x: X, y: Y, width: Wd, height: Ht, borderColor: rgb(col.r, col.g, col.b), borderWidth: 1, borderDashArray: [4, 3] });
    }else if(a.type === "image" && a.src){
      // image embedding handled async elsewhere; skipped here for sync simplicity
    }
  }
  function hexToRgb(hex){ const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || "#000000") || [, "00", "00", "00"]; return { r: parseInt(m[1], 16) / 255, g: parseInt(m[2], 16) / 255, b: parseInt(m[3], 16) / 255 }; }
  function stripHtml(s){ const d = document.createElement("div"); d.innerHTML = String(s || "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(div|p)>/gi, "\n"); return (d.textContent || "").replace(/\n+$/, ""); }
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
      if(docPassword) N.toast("Saved with password protection.");
    }catch(e){ console.error(e); N.alert("Something went wrong preparing the PDF for download.\n\n" + (e && e.message ? e.message : "")); }
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
      if(pdfBytes){ const r = await loadPdfjs(pdfBytes); pdfjsDoc = r.doc; sourceWasLocked = r.locked; }
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
