/* Nyxdesk Deck — presentation editor */
(function(){
  "use strict";
  const N = window.Nyx, h = N.h, $ = s => document.querySelector(s);
  const W = 960, H = 540;

  const THEMES = [
    { name: "Ink", bg: "#ffffff", ink: "#1c1b19", accent: "#b06a73", font: "Inter" },
    { name: "Clay", bg: "#fbf4ea", ink: "#3a2f22", accent: "#b4552d", font: "Georgia" },
    { name: "Slate", bg: "#20242b", ink: "#eef1f6", accent: "#7fb0e0", font: "Inter" },
    { name: "Sage", bg: "#f3f6ee", ink: "#273321", accent: "#5c7a2e", font: "Verdana" },
    { name: "Plum", bg: "#241a26", ink: "#f3e9f4", accent: "#c279b0", font: "Georgia" }
  ];
  let theme = THEMES[0];

  function blankSlide(layout){
    const id = N.uid();
    const objs = [];
    if(layout === "title"){
      objs.push(textObj(80, 190, 800, 110, "Presentation title", 44, true, "center"));
      objs.push(textObj(140, 310, 680, 60, "Subtitle or your name", 20, false, "center"));
    }else if(layout === "titlebody"){
      objs.push(textObj(60, 36, 840, 70, "Slide title", 32, true, "left"));
      objs.push(textObj(60, 130, 840, 370, "Click to add text", 18, false, "left"));
    }else if(layout === "twocol"){
      objs.push(textObj(60, 36, 840, 60, "Slide title", 32, true, "left"));
      objs.push(textObj(60, 120, 400, 380, "First column", 17, false, "left"));
      objs.push(textObj(500, 120, 400, 380, "Second column", 17, false, "left"));
    }else if(layout === "quote"){
      objs.push(textObj(120, 190, 720, 140, "“A quote goes here.”", 28, true, "center"));
      objs.push(textObj(160, 340, 640, 50, "— Attribution", 16, false, "center"));
    }else if(layout === "section"){
      objs.push(textObj(80, 230, 800, 90, "Section title", 38, true, "left"));
    }
    return { id, layout: layout || "blank", bg: null, objects: objs, notes: "", transition: "none" };
  }
  function textObj(x, y, w, hh, text, size, bold, align){ return { id: N.uid(), type: "text", x, y, w, h: hh, text, size, bold, align: align || "left", color: null, italic: false, underline: false, font: null }; }

  let deck = { slides: [blankSlide("title")], active: 0 };
  let selId = null;

  N.ribbon($("#ribbon")); N.keepFocus($("#ribbon"));

  const slideEl = $("#slide");
  function curSlide(){ return deck.slides[deck.active]; }
  function curObj(){ return curSlide().objects.find(o => o.id === selId); }

  function renderThemes(){
    const row = $("#themeRow"); row.innerHTML = "";
    THEMES.forEach(t => {
      const sw = h("button", { class: "rb", type: "button", title: t.name, style: { width: "38px", height: "38px", background: t.bg, border: "2px solid " + (t === theme ? "var(--app)" : "var(--line)"), borderRadius: "6px" }, onclick: () => { theme = t; renderThemes(); render(); S.touch(); } });
      row.append(sw);
    });
  }
  renderThemes();

  function render(){
    const s = curSlide();
    slideEl.style.background = s.bg || theme.bg;
    slideEl.style.color = theme.ink;
    slideEl.style.fontFamily = theme.font;
    slideEl.innerHTML = "";
    s.objects.forEach(o => slideEl.append(renderObj(o)));
    renderThumbs();
    $("#slideInfo").textContent = `Slide ${deck.active + 1} of ${deck.slides.length}`;
    $("#notesArea").value = s.notes || "";
    $("#transSel").value = s.transition || "none";
    syncFontButtons();
  }
  function renderObj(o){
    const sel = o.id === selId;
    const box = h("div", { class: "sld-obj" + (sel ? " sel" : ""), style: { left: o.x + "px", top: o.y + "px", width: o.w + "px", height: o.h + "px", zIndex: (curSlide().objects.indexOf(o) + 1) }, "data-id": o.id });
    if(o.type === "text"){
      const t = h("div", { class: "sld-text", contenteditable: "true", spellcheck: "false", style: { fontSize: o.size + "px", fontWeight: o.bold ? "700" : "400", fontStyle: o.italic ? "italic" : "normal", textDecoration: o.underline ? "underline" : "none", textAlign: o.align || "left", color: o.color || "inherit", fontFamily: o.font || "inherit" } }, o.text);
      t.addEventListener("input", () => { o.text = t.innerHTML; S.touch(); });
      t.addEventListener("mousedown", e => e.stopPropagation());
      t.addEventListener("dblclick", e => e.stopPropagation());
      box.append(t);
    }else if(o.type === "image"){
      box.append(h("img", { src: o.src, style: { width: "100%", height: "100%", objectFit: o.fit || "contain", pointerEvents: "none" } }));
    }else if(o.type === "shape"){
      box.append(shapeSvg(o));
    }else if(o.type === "line"){
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); svg.setAttribute("viewBox", `0 0 ${o.w} ${o.h}`); svg.setAttribute("width", "100%"); svg.setAttribute("height", "100%");
      const ln = document.createElementNS("http://www.w3.org/2000/svg", "line"); ln.setAttribute("x1", 0); ln.setAttribute("y1", o.h / 2); ln.setAttribute("x2", o.w); ln.setAttribute("y2", o.h / 2); ln.setAttribute("stroke", o.color || theme.ink); ln.setAttribute("stroke-width", o.weight || 3);
      svg.append(ln); box.append(svg);
    }else if(o.type === "table"){
      box.append(tableEl(o));
    }else if(o.type === "chart"){
      box.append(chartSvg(o));
    }else if(o.type === "icon"){
      const svg = N.icEl(o.icon); svg.style.width = "100%"; svg.style.height = "100%"; svg.style.color = o.color || theme.accent; box.append(svg);
    }
    if(sel){ box.append(h("div", { class: "handle se" })); }
    wireObjDrag(box, o);
    return box;
  }
  function shapeSvg(o){
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); svg.setAttribute("viewBox", `0 0 ${o.w} ${o.h}`); svg.setAttribute("width", "100%"); svg.setAttribute("height", "100%"); svg.setAttribute("preserveAspectRatio", "none");
    let el;
    if(o.shape === "oval"){ el = document.createElementNS(svg.namespaceURI, "ellipse"); el.setAttribute("cx", o.w / 2); el.setAttribute("cy", o.h / 2); el.setAttribute("rx", o.w / 2 - 2); el.setAttribute("ry", o.h / 2 - 2); }
    else if(o.shape === "triangle"){ el = document.createElementNS(svg.namespaceURI, "polygon"); el.setAttribute("points", `${o.w / 2},2 ${o.w - 2},${o.h - 2} 2,${o.h - 2}`); }
    else if(o.shape === "arrow"){ el = document.createElementNS(svg.namespaceURI, "polygon"); el.setAttribute("points", `0,${o.h * .3} ${o.w * .6},${o.h * .3} ${o.w * .6},0 ${o.w},${o.h / 2} ${o.w * .6},${o.h} ${o.w * .6},${o.h * .7} 0,${o.h * .7}`); }
    else { el = document.createElementNS(svg.namespaceURI, "rect"); el.setAttribute("x", 2); el.setAttribute("y", 2); el.setAttribute("width", o.w - 4); el.setAttribute("height", o.h - 4); el.setAttribute("rx", o.shape === "round" ? 14 : 0); }
    el.setAttribute("fill", o.fill || theme.accent); el.setAttribute("stroke", o.stroke || "none"); el.setAttribute("stroke-width", "2");
    svg.append(el); return svg;
  }
  function tableEl(o){
    const t = h("table", { style: { width: "100%", height: "100%", borderCollapse: "collapse", fontSize: "13px" } });
    o.rows.forEach(row => {
      const tr = h("tr");
      row.forEach(c => tr.append(h("td", { contenteditable: "true", style: { border: "1px solid #999", padding: "4px 7px" }, oninput: e => { c.v = e.target.textContent; S.touch(); } }, c.v)));
      t.append(tr);
    });
    t.addEventListener("mousedown", e => e.stopPropagation());
    return t;
  }
  function chartSvg(o){
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg"); svg.setAttribute("viewBox", `0 0 ${o.w} ${o.h}`); svg.setAttribute("width", "100%"); svg.setAttribute("height", "100%");
    const values = o.data.map(d => d.v), max = Math.max(...values, 1);
    const colors = ["#3b82f6", "#2fb344", "#ff9900", "#8a2be2", "#e91e8c", "#00b8b8"];
    if(o.chartType === "pie"){
      const total = values.reduce((a, b) => a + b, 0) || 1; let ang = -Math.PI / 2;
      const cx = o.w / 2, cy = o.h / 2, R = Math.min(cx, cy) - 8;
      values.forEach((v, i) => { const a2 = ang + (v / total) * Math.PI * 2; const x1 = cx + R * Math.cos(ang), y1 = cy + R * Math.sin(ang), x2 = cx + R * Math.cos(a2), y2 = cy + R * Math.sin(a2); const large = (a2 - ang) > Math.PI ? 1 : 0; const p = document.createElementNS(svgNS, "path"); p.setAttribute("d", `M${cx},${cy} L${x1},${y1} A${R},${R} 0 ${large} 1 ${x2},${y2} Z`); p.setAttribute("fill", colors[i % colors.length]); svg.append(p); ang = a2; });
    }else{
      const padB = 20, plotH = o.h - padB - 8, bw = o.w / values.length;
      values.forEach((v, i) => { const bh = (v / max) * plotH, x = bw * i + bw * .15, y = 8 + plotH - bh; const rc = document.createElementNS(svgNS, "rect"); rc.setAttribute("x", x); rc.setAttribute("y", y); rc.setAttribute("width", bw * .7); rc.setAttribute("height", Math.max(0, bh)); rc.setAttribute("fill", colors[i % colors.length]); svg.append(rc); });
    }
    return svg;
  }

  function wireObjDrag(box, o){
    box.addEventListener("mousedown", e => {
      if(e.target.closest(".handle")) return;
      selId = o.id; render(); syncFontButtons();
      const sx = e.clientX, sy = e.clientY, ox = o.x, oy = o.y;
      let moved = false;
      const onMove = ev => { moved = true; const scale = (slideEl.getBoundingClientRect().width / W); o.x = ox + (ev.clientX - sx) / scale; o.y = oy + (ev.clientY - sy) / scale; box.style.left = o.x + "px"; box.style.top = o.y + "px"; };
      const onUp = () => { removeEventListener("mousemove", onMove); removeEventListener("mouseup", onUp); if(moved) S.touch(); };
      addEventListener("mousemove", onMove); addEventListener("mouseup", onUp);
    });
    const handle = () => box.querySelector(".handle.se");
    box.addEventListener("mousedown", e => {
      if(!e.target.closest(".handle")) return;
      e.stopPropagation();
      const sx = e.clientX, sy = e.clientY, ow = o.w, oh = o.h;
      const onMove = ev => { const scale = (slideEl.getBoundingClientRect().width / W); o.w = Math.max(20, ow + (ev.clientX - sx) / scale); o.h = Math.max(20, oh + (ev.clientY - sy) / scale); box.style.width = o.w + "px"; box.style.height = o.h + "px"; };
      const onUp = () => { removeEventListener("mousemove", onMove); removeEventListener("mouseup", onUp); S.touch(); };
      addEventListener("mousemove", onMove); addEventListener("mouseup", onUp);
    });
  }
  slideEl.addEventListener("mousedown", e => { if(e.target === slideEl){ selId = null; render(); } });

  function renderThumbs(){
    const box = $("#thumbs"); box.innerHTML = "";
    deck.slides.forEach((s, i) => {
      const th = h("div", { class: "thumb" + (i === deck.active ? " on" : "") });
      const mini = h("div", { class: "thumb-canvas", style: { width: W + "px", height: H + "px", transform: "scale(" + (176 / W) + ")", background: s.bg || theme.bg } });
      s.objects.forEach(o => { const c = miniObj(o); if(c) mini.append(c); });
      th.append(h("span", { class: "tnum" }, String(i + 1)), mini,
        h("button", { class: "thumbdel ib", type: "button", onclick: e => { e.stopPropagation(); delSlide(i); } }, N.icEl("x")));
      th.addEventListener("click", () => { deck.active = i; selId = null; render(); });
      box.append(th);
    });
  }
  function miniObj(o){
    const d = h("div", { style: { position: "absolute", left: o.x + "px", top: o.y + "px", width: o.w + "px", height: o.h + "px", overflow: "hidden" } });
    if(o.type === "text") d.innerHTML = `<div style="font-size:${o.size}px;font-weight:${o.bold ? 700 : 400};text-align:${o.align}">${o.text}</div>`;
    else if(o.type === "image") d.innerHTML = `<img src="${o.src}" style="width:100%;height:100%;object-fit:contain">`;
    else if(o.type === "shape") d.style.background = o.fill || theme.accent;
    else return null;
    return d;
  }
  function delSlide(i){ if(deck.slides.length < 2) return; deck.slides.splice(i, 1); deck.active = Math.min(deck.active, deck.slides.length - 1); render(); S.touch(); }

  /* ---------- toolbar actions ---------- */
  $("#newSlideBtn").addEventListener("click", () => N.menu($("#newSlideBtn"), [
    { label: "Title slide", run: () => addSlide("title") }, { label: "Title & content", run: () => addSlide("titlebody") },
    { label: "Two content", run: () => addSlide("twocol") }, { label: "Section header", run: () => addSlide("section") },
    { label: "Quote", run: () => addSlide("quote") }, { label: "Blank", run: () => addSlide("blank") }
  ]));
  function addSlide(layout){ deck.slides.splice(deck.active + 1, 0, blankSlide(layout)); deck.active++; selId = null; render(); S.touch(); }
  $("#dupSlideBtn").addEventListener("click", () => { const copy = JSON.parse(JSON.stringify(curSlide())); copy.id = N.uid(); copy.objects.forEach(o => o.id = N.uid()); deck.slides.splice(deck.active + 1, 0, copy); deck.active++; render(); S.touch(); });
  $("#layoutSel").addEventListener("change", e => { const s = blankSlide(e.target.value); s.bg = curSlide().bg; deck.slides[deck.active] = s; selId = null; render(); S.touch(); });

  function withText(fn){ const o = curObj(); if(!o || o.type !== "text") return; fn(o); render(); S.touch(); }
  $("#boldBtn").addEventListener("click", () => withText(o => o.bold = !o.bold));
  $("#italicBtn").addEventListener("click", () => withText(o => o.italic = !o.italic));
  $("#underlineBtn").addEventListener("click", () => withText(o => o.underline = !o.underline));
  $("#alignLBtn").addEventListener("click", () => withText(o => o.align = "left"));
  $("#alignCBtn").addEventListener("click", () => withText(o => o.align = "center"));
  $("#alignRBtn").addEventListener("click", () => withText(o => o.align = "right"));
  $("#fontFamily").addEventListener("change", e => withText(o => o.font = e.target.value));
  $("#fontSize").addEventListener("change", e => withText(o => o.size = +e.target.value));
  $("#txColorBtn").addEventListener("click", () => N.colorPick($("#txColorBtn"), { onPick: c => withText(o => o.color = c) }));
  function syncFontButtons(){ const o = curObj(); if(!o || o.type !== "text") return; $("#boldBtn").classList.toggle("on", !!o.bold); $("#italicBtn").classList.toggle("on", !!o.italic); $("#underlineBtn").classList.toggle("on", !!o.underline); }

  $("#frontBtn").addEventListener("click", () => { const o = curObj(); if(!o) return; const s = curSlide(); s.objects = s.objects.filter(x => x !== o).concat([o]); render(); S.touch(); });
  $("#backBtn").addEventListener("click", () => { const o = curObj(); if(!o) return; const s = curSlide(); s.objects = [o].concat(s.objects.filter(x => x !== o)); render(); S.touch(); });
  $("#delObjBtn").addEventListener("click", () => { if(!selId) return; const s = curSlide(); s.objects = s.objects.filter(o => o.id !== selId); selId = null; render(); S.touch(); });
  N.keys({ "Delete": () => { if(selId && document.activeElement.tagName !== "DIV" || (selId && !document.activeElement.isContentEditable)){ const s = curSlide(); s.objects = s.objects.filter(o => o.id !== selId); selId = null; render(); S.touch(); } return false; } });

  /* ---------- insert ---------- */
  $("#insTextBtn").addEventListener("click", () => { const o = textObj(300, 220, 360, 90, "Text", 20, false, "left"); curSlide().objects.push(o); selId = o.id; render(); S.touch(); });
  $("#insImgBtn").addEventListener("click", async () => {
    const [f] = await N.pick("image/*"); if(!f) return;
    const src = await N.readDataURL(f); const dim = await N.imgSize(src);
    const w = Math.min(400, dim.w), hh = w * dim.h / dim.w;
    const o = { id: N.uid(), type: "image", x: (W - w) / 2, y: (H - hh) / 2, w, h: hh, src, fit: "contain" };
    curSlide().objects.push(o); selId = o.id; render(); S.touch();
  });
  $("#insShapeBtn").addEventListener("click", () => N.menu($("#insShapeBtn"), [
    { label: "Rectangle", run: () => addShape("rect") }, { label: "Rounded rectangle", run: () => addShape("round") },
    { label: "Oval", run: () => addShape("oval") }, { label: "Triangle", run: () => addShape("triangle") }, { label: "Arrow", run: () => addShape("arrow") }
  ]));
  function addShape(shape){ const o = { id: N.uid(), type: "shape", shape, x: 340, y: 200, w: 220, h: 140, fill: theme.accent }; curSlide().objects.push(o); selId = o.id; render(); S.touch(); }
  $("#insLineBtn").addEventListener("click", () => { const o = { id: N.uid(), type: "line", x: 260, y: 270, w: 400, h: 20, weight: 3, color: theme.ink }; curSlide().objects.push(o); selId = o.id; render(); S.touch(); });
  $("#insTableBtn").addEventListener("click", () => { const rows = Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => ({ v: "" }))); const o = { id: N.uid(), type: "table", x: 220, y: 160, w: 520, h: 180, rows }; curSlide().objects.push(o); selId = o.id; render(); S.touch(); });
  $("#insChartBtn").addEventListener("click", () => N.menu($("#insChartBtn"), [
    { label: "Column chart", run: () => addChart("bar") }, { label: "Pie chart", run: () => addChart("pie") }
  ]));
  function addChart(chartType){ const o = { id: N.uid(), type: "chart", chartType, x: 240, y: 150, w: 480, h: 280, data: [{ l: "A", v: 4 }, { l: "B", v: 7 }, { l: "C", v: 3 }, { l: "D", v: 6 }] }; curSlide().objects.push(o); selId = o.id; render(); S.touch(); }
  $("#insIconBtn").addEventListener("click", () => {
    const icons = ["star", "check", "x", "heart".replace("heart", "star"), "bookmark", "home", "info", "shield", "clock", "globe"];
    const box = h("div", { style: { display: "flex", flexWrap: "wrap", gap: "6px", maxWidth: "260px" } });
    [...new Set(icons)].forEach(ic => box.append(h("button", { class: "ib", style: { border: "1px solid var(--line)" }, type: "button", onclick: () => { addIcon(ic); P.close(); } }, N.icEl(ic))));
    var P = N.dialog({ title: "Insert icon", width: 320, body: box, buttons: [{ label: "Close" }] });
  });
  function addIcon(ic){ const o = { id: N.uid(), type: "icon", icon: ic, x: 420, y: 220, w: 100, h: 100, color: theme.accent }; curSlide().objects.push(o); selId = o.id; render(); S.touch(); }
  $("#insLinkBtn").addEventListener("click", async () => { const url = await N.prompt("Insert link", "https://"); if(!url) return; const o = textObj(300, 240, 360, 50, `<a href="${N.esc(url)}" target="_blank" rel="noopener">${N.esc(url)}</a>`, 18, false, "left"); curSlide().objects.push(o); render(); S.touch(); });

  /* design */
  $("#bgColorBtn").addEventListener("click", () => N.colorPick($("#bgColorBtn"), { onPick: c => { curSlide().bg = c; render(); S.touch(); } }));
  $("#transSel").addEventListener("change", e => { curSlide().transition = e.target.value; S.touch(); });

  /* view */
  $("#viewGridBtn").addEventListener("click", () => { $("#thumbSide").hidden = !$("#thumbSide").hidden; });
  $("#thumbClose") && $("#thumbClose").addEventListener("click", () => $("#thumbSide").hidden = true);
  $("#viewNotesBtn").addEventListener("click", () => { $("#notesPanel").hidden = !$("#notesPanel").hidden; });
  $("#notesArea").addEventListener("input", e => { curSlide().notes = e.target.value; S.touch(); });

  /* zoom */
  function applyZoom(){
    const z = $("#zoomRange").value / 100;
    slideEl.style.setProperty("--zoom", z);
    $("#slideFrame").style.width = (W * z) + "px";
    $("#slideFrame").style.height = (H * z) + "px";
    $("#zoomLabel").textContent = $("#zoomRange").value + "%";
  }
  $("#zoomRange").addEventListener("input", applyZoom);
  $("#zoomIn").addEventListener("click", () => { $("#zoomRange").value = Math.min(150, +$("#zoomRange").value + 10); applyZoom(); });
  $("#zoomOut").addEventListener("click", () => { $("#zoomRange").value = Math.max(25, +$("#zoomRange").value - 10); applyZoom(); });

  /* ---------- present mode ---------- */
  let pIndex = 0;
  function openPresent(){
    pIndex = deck.active; $("#presentUi").hidden = false; renderPresent();
    if(document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
  }
  function closePresent(){ $("#presentUi").hidden = true; if(document.fullscreenElement) document.exitFullscreen().catch(() => {}); }
  function renderPresent(){
    const s = deck.slides[pIndex];
    const el = $("#presentSlide");
    const scale = Math.min((innerWidth - 40) / W, (innerHeight - 110) / H);
    el.style.width = W + "px"; el.style.height = H + "px"; el.style.transform = "scale(" + scale + ")";
    el.style.background = s.bg || theme.bg; el.style.color = theme.ink; el.style.fontFamily = theme.font;
    el.innerHTML = "";
    s.objects.forEach(o => { const box = renderObj(o); box.querySelectorAll(".handle").forEach(x => x.remove()); box.classList.remove("sel"); box.style.cursor = "default"; box.querySelectorAll("[contenteditable]").forEach(ed => ed.contentEditable = "false"); el.append(box); });
    $("#presentCounter").textContent = (pIndex + 1) + " / " + deck.slides.length;
  }
  $("#presentBtn").addEventListener("click", openPresent);
  $("#exitPresentBtn").addEventListener("click", closePresent);
  $("#prevBtn").addEventListener("click", () => { if(pIndex > 0){ pIndex--; renderPresent(); } });
  $("#nextBtn").addEventListener("click", () => { if(pIndex < deck.slides.length - 1){ pIndex++; renderPresent(); } });
  $("#presentSlide").addEventListener("click", () => { if(pIndex < deck.slides.length - 1){ pIndex++; renderPresent(); } });
  document.addEventListener("keydown", e => {
    if($("#presentUi").hidden) return;
    if(e.key === "ArrowRight" || e.key === " ") { e.preventDefault(); if(pIndex < deck.slides.length - 1){ pIndex++; renderPresent(); } }
    else if(e.key === "ArrowLeft"){ e.preventDefault(); if(pIndex > 0){ pIndex--; renderPresent(); } }
    else if(e.key === "Escape") closePresent();
  });

  /* ---------- export ---------- */
  async function exportPptx(){
    const PptxGenJS = await N.lib("pptx");
    const pptx = new PptxGenJS();
    pptx.defineLayout({ name: "NYX", width: 10, height: 5.625 }); pptx.layout = "NYX";
    const px2in = v => v / W * 10;
    for(const s of deck.slides){
      const slide = pptx.addSlide();
      if(s.bg) slide.background = { color: hexOnly(s.bg) };
      else slide.background = { color: hexOnly(theme.bg) };
      for(const o of s.objects){
        const x = px2in(o.x), y = px2in(o.y), w = px2in(o.w), hh = px2in(o.h);
        if(o.type === "text"){
          slide.addText(stripHtml(o.text), { x, y, w, h: hh, fontSize: Math.round(o.size * .72), bold: !!o.bold, italic: !!o.italic, underline: !!o.underline, align: o.align, color: hexOnly(o.color || theme.ink), fontFace: o.font || theme.font });
        }else if(o.type === "image"){
          slide.addImage({ data: o.src, x, y, w, h: hh });
        }else if(o.type === "shape"){
          const map = { rect: "rect", round: "roundRect", oval: "ellipse", triangle: "triangle", arrow: "rightArrow" };
          slide.addShape(map[o.shape] || "rect", { x, y, w, h: hh, fill: { color: hexOnly(o.fill || theme.accent) } });
        }else if(o.type === "line"){
          slide.addShape("line", { x, y, w, h: 0, line: { color: hexOnly(o.color || theme.ink), width: o.weight || 2 } });
        }else if(o.type === "table"){
          slide.addTable(o.rows.map(r => r.map(c => ({ text: c.v }))), { x, y, w, h: hh });
        }else if(o.type === "chart"){
          const type = o.chartType === "pie" ? pptx.ChartType.pie : pptx.ChartType.bar;
          slide.addChart(type, [{ name: "Series", labels: o.data.map(d => d.l), values: o.data.map(d => d.v) }], { x, y, w, h: hh });
        }
      }
      if(s.notes) slide.addNotes(s.notes);
    }
    const blob = await pptx.write({ outputType: "blob" });
    N.download(blob, fileBase() + ".pptx");
  }
  function hexOnly(c){ return (c || "#000000").replace("#", ""); }
  function stripHtml(s){ const d = document.createElement("div"); d.innerHTML = s; return d.textContent || ""; }
  function fileBase(){ return ($("#docTitle").value || "presentation").trim() || "presentation"; }

  $("#fileMenuBtn").addEventListener("click", () => N.menu($("#fileMenuBtn"), [
    { icon: "newfile", label: "New presentation", run: () => { deck = { slides: [blankSlide("title")], active: 0 }; $("#docTitle").value = "Untitled presentation"; S.fresh(); } },
    { icon: "open", label: "Open .pptx…", run: async () => { const [f] = await N.pick(".pptx"); if(f) N.toast("Opening .pptx isn't supported yet in this preview — only creating and exporting."); } },
    { icon: "files", label: "Saved on this device", run: () => S.library() },
    "-",
    { icon: "filedown", label: "Save as PowerPoint (.pptx)", run: exportPptx },
    "-",
    { icon: "play", label: "Present", run: openPresent }
  ]));
  $("#shareBtn").addEventListener("click", () => N.menu($("#shareBtn"), [{ icon: "filedown", label: "PowerPoint (.pptx)", run: exportPptx }], { align: "right" }));

  /* ---------- autosave ---------- */
  const S = N.session({
    app: "marquee",
    getTitle: () => $("#docTitle").value || "Untitled presentation",
    getData: async () => ({ title: $("#docTitle").value, deck, theme: THEMES.indexOf(theme) }),
    setData: d => { deck = d.deck || deck; $("#docTitle").value = d.title || "Untitled presentation"; theme = THEMES[d.theme] || THEMES[0]; renderThemes(); render(); }
  });
  $("#docTitle").addEventListener("input", () => S.touch());

  (async function init(){
    if(N.isPhone()){
      $("#thumbSide").hidden = true;
      const avail = $("#canvasWrap").clientWidth - 32 - 8;
      $("#zoomRange").value = N.clamp(Math.round(avail / W * 100), 25, 100);
    }
    const had = await S.load();
    if(!had) render();
    applyZoom();
  })();
})();
