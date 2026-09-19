/* Nyxdesk PDF — view, mark up, and export PDFs entirely client-side. */
(function(){
  pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

  const BASE_PX_PER_PT = 1.4; // rendering crispness baseline
  let zoom = 1;
  let idSeq = 1;

  /** doc = null until a file is opened or a blank PDF is created */
  let doc = null; // { pdfjsDoc, originalBytes, srcPages:[{w,h,deleted,rotationDelta,annotations:[]}], blankPages:[{w,h,annotations:[]}] }
  let activeKey = null;   // e.g. "src-0" / "blank-1" — the page most recently interacted with
  let selected = null;    // { key, id }
  let currentTool = "select";

  const stage = document.getElementById("stage");
  const rail = document.getElementById("rail");

  // ---------- toolbar wiring ----------
  document.querySelectorAll(".tool").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      document.querySelectorAll(".tool").forEach(b=>b.classList.remove("active"));
      btn.classList.add("active");
      currentTool = btn.dataset.tool;
    });
  });

  window.toggleMenu = function(id){
    document.querySelectorAll(".menu.open").forEach(m => { if(m.id!==id) m.classList.remove("open"); });
    document.getElementById(id).classList.toggle("open");
  };
  document.addEventListener("click", (e)=>{
    document.querySelectorAll(".menu.open").forEach(m=>{ if(!m.contains(e.target)) m.classList.remove("open"); });
  });

  window.zoomIn = function(){ zoom = Math.min(2.4, zoom + 0.2); document.getElementById("zoomLabel").textContent = Math.round(zoom*100)+"%"; renderAll(); };
  window.zoomOut = function(){ zoom = Math.max(0.4, zoom - 0.2); document.getElementById("zoomLabel").textContent = Math.round(zoom*100)+"%"; renderAll(); };

  // ---------- open / new ----------
  window.triggerOpen = function(){ document.getElementById("openInput").click(); };
  document.getElementById("openInput").addEventListener("change", async (e)=>{
    const file = e.target.files[0];
    if(!file) return;
    document.getElementById("pdfTitle").value = file.name.replace(/\.[^.]+$/, "");
    try{
      const bytes = await file.arrayBuffer();
      const pdfjsDoc = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
      const srcPages = [];
      for(let i=1;i<=pdfjsDoc.numPages;i++){
        const page = await pdfjsDoc.getPage(i);
        const vp = page.getViewport({ scale: 1 });
        srcPages.push({ w: vp.width, h: vp.height, deleted:false, rotationDelta:0, annotations: [] });
      }
      doc = { pdfjsDoc, originalBytes: bytes, srcPages, blankPages: [] };
      activeKey = "src-0";
      document.getElementById("editToolbar").style.display = "flex";
      renderAll();
    }catch(err){
      console.error(err);
      alert("Couldn't open that PDF. It may be encrypted or corrupted.");
    }
    e.target.value = "";
  });

  window.newBlankPdf = function(){
    doc = { pdfjsDoc: null, originalBytes: null, srcPages: [], blankPages: [ { w: 595, h: 842, annotations: [] } ] };
    activeKey = "blank-0";
    document.getElementById("pdfTitle").value = "document";
    document.getElementById("editToolbar").style.display = "flex";
    renderAll();
  };

  // ---------- page ops ----------
  window.addBlankPage = function(){
    if(!doc){ newBlankPdf(); return; }
    doc.blankPages.push({ w: 595, h: 842, annotations: [] });
    activeKey = "blank-" + (doc.blankPages.length-1);
    renderAll();
  };
  window.rotateActivePage = function(){
    const p = pageByKey(activeKey);
    if(!p){ nyxToast("Click a page first."); return; }
    p.rotationDelta = ((p.rotationDelta || 0) + 90) % 360;
    nyxToast("Rotation will be applied on export (preview stays unrotated for accurate editing).");
  };
  window.deleteActivePage = function(){
    if(!activeKey){ nyxToast("Click a page first."); return; }
    const [kind, idxStr] = activeKey.split("-");
    const idx = parseInt(idxStr,10);
    if(kind === "src"){
      const remaining = doc.srcPages.filter(p=>!p.deleted).length;
      if(remaining <= 1 && doc.blankPages.length === 0){ nyxToast("A document needs at least one page."); return; }
      doc.srcPages[idx].deleted = true;
    }else{
      if(doc.blankPages.length <= 1 && doc.srcPages.filter(p=>!p.deleted).length === 0){ nyxToast("A document needs at least one page."); return; }
      doc.blankPages.splice(idx,1);
    }
    activeKey = null;
    renderAll();
  };

  function pageByKey(key){
    if(!doc || !key) return null;
    const [kind, idxStr] = key.split("-");
    const idx = parseInt(idxStr,10);
    return kind === "src" ? doc.srcPages[idx] : doc.blankPages[idx];
  }

  // ---------- rendering ----------
  async function renderAll(){
    stage.innerHTML = "";
    rail.innerHTML = "";
    document.getElementById("dropZone").remove ? null : null;
    if(!doc){
      stage.innerHTML = document.getElementById("dropZone") ? "" : "";
      buildDropZone();
      return;
    }
    let anyVisible = false;
    for(let i=0;i<doc.srcPages.length;i++){
      if(doc.srcPages[i].deleted) continue;
      anyVisible = true;
      await renderSrcPage(i);
      addRailCard("src", i, i+1);
    }
    for(let i=0;i<doc.blankPages.length;i++){
      anyVisible = true;
      renderBlankPage(i);
      addRailCard("blank", i, "B"+(i+1));
    }
    if(!anyVisible) buildDropZone();
  }

  function buildDropZone(){
    stage.innerHTML = `<div class="drop" id="dropZone">
      <div class="z">
        <p style="margin-bottom:10px">Open a PDF to view and mark it up, or start a new blank one.</p>
        <div style="display:flex; gap:10px; justify-content:center">
          <button class="btn btn--primary" onclick="triggerOpen()">Open PDF…</button>
          <button class="btn" onclick="newBlankPdf()">New blank PDF</button>
        </div>
      </div>
    </div>`;
    document.getElementById("editToolbar").style.display = "none";
  }

  function addRailCard(kind, idx, label){
    const key = kind+"-"+idx;
    const card = document.createElement("div");
    card.className = "pagecard" + (key === activeKey ? " active" : "");
    card.innerHTML = `<span class="pn">${label}</span><span class="pdel">✕ delete</span>`;
    card.querySelector(".pn").addEventListener("click", ()=>{
      activeKey = key;
      const target = document.getElementById("pw-"+key);
      if(target) target.scrollIntoView({ behavior:"smooth", block:"center" });
      renderRailActive();
    });
    card.querySelector(".pdel").addEventListener("click", (e)=>{
      e.stopPropagation();
      activeKey = key;
      deleteActivePage();
    });
    rail.appendChild(card);
  }
  function renderRailActive(){
    rail.querySelectorAll(".pagecard").forEach(c=>c.classList.remove("active"));
    // relies on re-render for correctness; cheap enough to just re-render all
    renderAll();
  }

  async function renderSrcPage(idx){
    const meta = doc.srcPages[idx];
    const page = await doc.pdfjsDoc.getPage(idx+1);
    const pxPerPt = BASE_PX_PER_PT * zoom;
    const viewport = page.getViewport({ scale: pxPerPt });

    const wrap = document.createElement("div");
    wrap.className = "pageWrap";
    wrap.id = "pw-src-"+idx;
    wrap.style.width = viewport.width + "px";
    wrap.style.height = viewport.height + "px";

    const label = document.createElement("div");
    label.className = "pageLabel";
    label.textContent = "Page " + (idx+1) + (meta.rotationDelta ? " · rotated " + meta.rotationDelta + "° on export" : "");
    wrap.appendChild(label);

    const canvas = document.createElement("canvas");
    canvas.width = viewport.width; canvas.height = viewport.height;
    wrap.appendChild(canvas);
    stage.appendChild(wrap);

    await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;

    buildOverlay(wrap, "src-"+idx, meta, meta.w, meta.h);
  }

  function renderBlankPage(idx){
    const meta = doc.blankPages[idx];
    const pxPerPt = BASE_PX_PER_PT * zoom;
    const w = meta.w * pxPerPt, h = meta.h * pxPerPt;

    const wrap = document.createElement("div");
    wrap.className = "pageWrap blank";
    wrap.id = "pw-blank-"+idx;
    wrap.style.width = w + "px";
    wrap.style.height = h + "px";

    const label = document.createElement("div");
    label.className = "pageLabel";
    label.textContent = "Blank page " + (idx+1);
    wrap.appendChild(label);

    stage.appendChild(wrap);
    buildOverlay(wrap, "blank-"+idx, meta, meta.w, meta.h);
  }

  function buildOverlay(wrap, key, meta, pageW, pageH){
    const overlay = document.createElement("div");
    overlay.className = "overlay";
    overlay.dataset.key = key;

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", `0 0 ${pageW} ${pageH}`);
    overlay.appendChild(svg);

    (meta.annotations || []).forEach(ann => renderAnn(overlay, svg, key, ann, pageW, pageH));

    wrap.appendChild(overlay);

    overlay.addEventListener("pointerdown", (e)=>{
      if(e.target !== overlay && e.target !== svg) return; // clicks on existing ann are handled separately
      activeKey = key;
      selectAnn(null);
      const rectBox = overlay.getBoundingClientRect();
      const toPt = (clientX, clientY) => ({
        x: (clientX - rectBox.left) * (pageW / rectBox.width),
        y: (clientY - rectBox.top) * (pageH / rectBox.height)
      });
      const start = toPt(e.clientX, e.clientY);

      if(currentTool === "text"){
        const ann = { id: "a"+(idSeq++), type:"text", x:start.x, y:start.y, w:180, h:28, text:"Text", fontSize:14, color:"#1a1a1a" };
        meta.annotations.push(ann);
        renderAnn(overlay, svg, key, ann, pageW, pageH);
        const el = overlay.querySelector(`[data-id="${ann.id}"]`);
        selectAnn({key, id:ann.id});
        el.contentEditable = "true"; el.focus();
        placeCaretEnd(el);
        return;
      }
      if(currentTool === "highlight" || currentTool === "rect"){
        const ann = { id:"a"+(idSeq++), type: currentTool, x:start.x, y:start.y, w:1, h:1 };
        meta.annotations.push(ann);
        const el = renderAnn(overlay, svg, key, ann, pageW, pageH);
        function onMove(ev){
          const p2 = toPt(ev.clientX, ev.clientY);
          ann.x = Math.min(start.x,p2.x); ann.y = Math.min(start.y,p2.y);
          ann.w = Math.abs(p2.x-start.x); ann.h = Math.abs(p2.y-start.y);
          applyAnnStyle(el, ann, pageW, pageH);
        }
        function onUp(){
          overlay.removeEventListener("pointermove", onMove);
          overlay.removeEventListener("pointerup", onUp);
        }
        overlay.addEventListener("pointermove", onMove);
        overlay.addEventListener("pointerup", onUp, { once:true });
        return;
      }
      if(currentTool === "draw"){
        const points = [start];
        const path = document.createElementNS("http://www.w3.org/2000/svg","path");
        path.setAttribute("stroke", "#d94f4f");
        path.setAttribute("stroke-width", Math.max(1.4, pageW/400));
        path.setAttribute("fill", "none");
        path.setAttribute("stroke-linecap","round");
        path.setAttribute("stroke-linejoin","round");
        svg.appendChild(path);
        function draw(){ path.setAttribute("d", "M " + points.map(p=>p.x+" "+p.y).join(" L ")); }
        draw();
        function onMove(ev){ points.push(toPt(ev.clientX, ev.clientY)); draw(); }
        function onUp(){
          overlay.removeEventListener("pointermove", onMove);
          overlay.removeEventListener("pointerup", onUp);
          if(points.length > 1){
            meta.annotations.push({ id:"a"+(idSeq++), type:"path", points, color:"#d94f4f", width: Math.max(1.4, pageW/400) });
          }else{
            path.remove();
          }
        }
        overlay.addEventListener("pointermove", onMove);
        overlay.addEventListener("pointerup", onUp, { once:true });
        return;
      }
    });

    return overlay;
  }

  function renderAnn(overlay, svg, key, ann, pageW, pageH){
    if(ann.type === "path"){
      const path = document.createElementNS("http://www.w3.org/2000/svg","path");
      path.setAttribute("stroke", ann.color || "#d94f4f");
      path.setAttribute("stroke-width", ann.width || 2);
      path.setAttribute("fill", "none");
      path.setAttribute("stroke-linecap","round");
      path.setAttribute("stroke-linejoin","round");
      path.setAttribute("d", "M " + ann.points.map(p=>p.x+" "+p.y).join(" L "));
      path.dataset.id = ann.id;
      path.style.pointerEvents = "stroke";
      path.style.cursor = "pointer";
      path.addEventListener("pointerdown", (e)=>{ e.stopPropagation(); activeKey = key; selectAnn({key, id:ann.id}); });
      svg.appendChild(path);
      return path;
    }
    const el = document.createElement("div");
    el.className = "ann";
    el.dataset.type = ann.type;
    el.dataset.id = ann.id;
    if(ann.type === "text"){
      el.textContent = ann.text;
      el.addEventListener("dblclick", (e)=>{ e.stopPropagation(); el.contentEditable="true"; el.focus(); });
      el.addEventListener("blur", ()=>{ el.contentEditable="false"; ann.text = el.textContent; });
    }
    applyAnnStyle(el, ann, pageW, pageH);
    el.addEventListener("pointerdown", (e)=> startAnnDrag(e, overlay, key, ann, el, pageW, pageH));
    overlay.appendChild(el);
    return el;
  }

  function applyAnnStyle(el, ann, pageW, pageH){
    el.style.left = (ann.x/pageW*100) + "%";
    el.style.top = (ann.y/pageH*100) + "%";
    el.style.width = (ann.w/pageW*100) + "%";
    el.style.height = (ann.h/pageH*100) + "%";
    if(ann.type === "text"){
      const wrap = el.closest(".pageWrap");
      const pxPerPt = wrap ? wrap.offsetWidth / pageW : 1.4;
      el.style.fontSize = (ann.fontSize * pxPerPt) + "px";
      el.style.color = ann.color || "#1a1a1a";
    }
  }

  function startAnnDrag(e, overlay, key, ann, el, pageW, pageH){
    e.stopPropagation();
    if(el.isContentEditable) return;
    activeKey = key;
    selectAnn({key, id:ann.id});
    const rectBox = overlay.getBoundingClientRect();
    const startX = e.clientX, startY = e.clientY;
    const orig = { x: ann.x, y: ann.y };
    el.setPointerCapture(e.pointerId);
    function onMove(ev){
      const dx = (ev.clientX-startX) * (pageW/rectBox.width);
      const dy = (ev.clientY-startY) * (pageH/rectBox.height);
      ann.x = orig.x + dx; ann.y = orig.y + dy;
      applyAnnStyle(el, ann, pageW, pageH);
    }
    function onUp(ev){
      el.releasePointerCapture(ev.pointerId);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
    }
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
  }

  function selectAnn(sel){
    selected = sel;
    document.querySelectorAll(".ann.selected, path.selected").forEach(n=>n.classList.remove("selected"));
    if(sel){
      const wrap = document.getElementById("pw-"+sel.key);
      if(wrap){
        const el = wrap.querySelector(`[data-id="${sel.id}"]`);
        if(el) el.classList.add("selected");
      }
    }
  }
  window.deleteSelectedAnn = function(){
    if(!selected) return;
    const meta = pageByKey(selected.key);
    if(!meta) return;
    meta.annotations = meta.annotations.filter(a => a.id !== selected.id);
    selected = null;
    renderAll();
  };
  document.addEventListener("keydown", (e)=>{
    if((e.key==="Delete"||e.key==="Backspace") && selected && !document.activeElement.isContentEditable){
      window.deleteSelectedAnn();
    }
  });
  function placeCaretEnd(el){
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges(); sel.addRange(range);
  }

  // ---------- export ----------
  window.exportPdf = async function(){
    if(!doc){ nyxToast("Open or create a PDF first."); return; }
    try{
      const { PDFDocument, rgb, degrees, StandardFonts } = PDFLib;
      const outDoc = await PDFDocument.create();
      const font = await outDoc.embedFont(StandardFonts.Helvetica);

      const keepIdx = doc.srcPages.map((p,i)=>({p,i})).filter(x=>!x.p.deleted).map(x=>x.i);
      if(doc.originalBytes && keepIdx.length){
        const srcDoc = await PDFDocument.load(doc.originalBytes);
        const copied = await outDoc.copyPages(srcDoc, keepIdx);
        copied.forEach((page, n) => {
          outDoc.addPage(page);
          const meta = doc.srcPages[keepIdx[n]];
          drawAnnotations(page, meta.annotations, meta.h, font, rgb);
          if(meta.rotationDelta){
            const current = page.getRotation().angle || 0;
            page.setRotation(degrees((current + meta.rotationDelta) % 360));
          }
        });
      }
      doc.blankPages.forEach(meta => {
        const page = outDoc.addPage([meta.w, meta.h]);
        drawAnnotations(page, meta.annotations, meta.h, font, rgb);
      });

      const bytes = await outDoc.save();
      const blob = new Blob([bytes], { type: "application/pdf" });
      const title = (document.getElementById("pdfTitle").value || "document").trim();
      nyxDownloadBlob(blob, title + ".pdf");
    }catch(err){
      console.error(err);
      alert("Couldn't export this PDF in this browser. See the console for details.");
    }
  };

  function drawAnnotations(page, annotations, pageH, font, rgb){
    (annotations || []).forEach(ann => {
      try{
        if(ann.type === "text"){
          page.drawText(ann.text || "", {
            x: ann.x, y: pageH - ann.y - ann.fontSize,
            size: ann.fontSize, font, color: hexToRgb(ann.color, rgb)
          });
        }else if(ann.type === "highlight"){
          page.drawRectangle({ x: ann.x, y: pageH-ann.y-ann.h, width: ann.w, height: ann.h, color: rgb(1,0.88,0.35), opacity: 0.4 });
        }else if(ann.type === "rect"){
          page.drawRectangle({ x: ann.x, y: pageH-ann.y-ann.h, width: ann.w, height: ann.h, borderColor: rgb(0.88,0.28,0.35), borderWidth: 1.6, color: rgb(0.88,0.28,0.35), opacity: 0.06 });
        }else if(ann.type === "path" && ann.points && ann.points.length > 1){
          const d = "M " + ann.points.map(p=>p.x+" "+p.y).join(" L ");
          page.drawSvgPath(d, { x: 0, y: pageH, borderColor: hexToRgb(ann.color, rgb), borderWidth: ann.width || 2 });
        }
      }catch(err){ console.warn("Skipped an annotation on export:", err); }
    });
  }
  function hexToRgb(hex, rgb){
    if(!hex) return rgb(0.1,0.1,0.1);
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if(!m) return rgb(0.1,0.1,0.1);
    return rgb(parseInt(m[1],16)/255, parseInt(m[2],16)/255, parseInt(m[3],16)/255);
  }

  // ---------- init ----------
  buildDropZone();
  nyxSetupRailToggle("#rail", "#railToggle");
})();
