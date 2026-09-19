/* Nyxdesk Slides */
(function(){
  const CANVAS_W = 960, CANVAS_H = 540; // 16:9 at 72px/inch => 13.333in x 7.5in
  const STORAGE_KEY = "nyxdesk-slides-v1";
  const TITLE_KEY = "nyxdesk-slides-title";

  let slides = [ emptySlide() ];
  let current = 0;
  let selectedId = null;
  let idSeq = 1;

  function emptySlide(){ return { bg: "#ffffff", elements: [] }; }
  function newId(){ return "el" + (idSeq++); }

  // ---------- persistence ----------
  function save(){
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ slides }));
  }
  function restore(){
    try{
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if(saved && saved.slides && saved.slides.length){
        slides = saved.slides;
        idSeq = 1 + slides.reduce((m,s)=> Math.max(m, ...s.elements.map(e=> parseInt((e.id||"el0").slice(2))||0), 0), 0);
      }
      const title = localStorage.getItem(TITLE_KEY);
      if(title) document.getElementById("deckTitle").value = title;
    }catch(e){ /* ignore */ }
  }
  document.getElementById("deckTitle").addEventListener("input", e => localStorage.setItem(TITLE_KEY, e.target.value));

  // ---------- rendering ----------
  const canvas = document.getElementById("canvas");
  const rail = document.getElementById("rail");

  function fitCanvas(){
    const outer = document.querySelector(".canvas-outer");
    const scale = outer.getBoundingClientRect().width / CANVAS_W;
    canvas.style.transform = `scale(${scale})`;
    canvas.style.width = CANVAS_W + "px";
    canvas.style.height = CANVAS_H + "px";
    outer.style.height = (CANVAS_W && scale) ? (CANVAS_H*scale)+"px" : "";
  }
  window.addEventListener("resize", fitCanvas);

  function renderSlide(){
    const slide = slides[current];
    canvas.style.background = slide.bg;
    canvas.innerHTML = "";
    slide.elements.forEach(el => canvas.appendChild(renderElement(el)));
    document.getElementById("bgColor").value = slide.bg;
    selectElement(null);
  }

  function renderElement(el){
    const div = document.createElement("div");
    div.className = "el";
    div.dataset.id = el.id;
    div.dataset.type = el.type;
    div.style.left = el.x + "px";
    div.style.top = el.y + "px";
    div.style.width = el.w + "px";
    div.style.height = el.h + "px";

    if(el.type === "text"){
      div.contentEditable = "false";
      div.style.fontSize = (el.fontSize||28) + "px";
      div.style.color = el.color || "#1a1a1a";
      div.style.fontWeight = el.bold ? "700" : "400";
      div.style.textAlign = el.align || "left";
      div.style.fontFamily = "Inter, sans-serif";
      div.textContent = el.text || "";
      div.addEventListener("dblclick", (e)=>{
        e.stopPropagation();
        div.contentEditable = "true";
        div.focus();
      });
      div.addEventListener("blur", ()=>{
        div.contentEditable = "false";
        el.text = div.textContent;
        save();
      });
    }else if(el.type === "image"){
      const img = document.createElement("img");
      img.src = el.src;
      div.appendChild(img);
    }else if(el.type === "shape"){
      div.style.background = el.fill || "#e0a458";
    }

    const handle = document.createElement("div");
    handle.className = "handle";
    div.appendChild(handle);

    div.addEventListener("pointerdown", (e)=> startDrag(e, el, div, handle));
    return div;
  }

  function selectElement(id){
    selectedId = id;
    canvas.querySelectorAll(".el").forEach(d => d.classList.toggle("selected", d.dataset.id === id));
    document.getElementById("deleteBtn").disabled = !id;
  }

  canvas.addEventListener("pointerdown", (e)=>{
    if(e.target === canvas) selectElement(null);
  });

  // ---------- drag / resize ----------
  function startDrag(e, el, div, handle){
    e.stopPropagation();
    if(div.isContentEditable) return;
    selectElement(el.id);
    const isResize = e.target === handle;
    const scale = canvas.getBoundingClientRect().width / CANVAS_W;
    const startX = e.clientX, startY = e.clientY;
    const orig = { x: el.x, y: el.y, w: el.w, h: el.h };
    div.setPointerCapture(e.pointerId);

    function onMove(ev){
      const dx = (ev.clientX - startX) / scale;
      const dy = (ev.clientY - startY) / scale;
      if(isResize){
        el.w = Math.max(30, orig.w + dx);
        el.h = Math.max(20, orig.h + dy);
        div.style.width = el.w + "px";
        div.style.height = el.h + "px";
      }else{
        el.x = Math.max(-el.w+20, Math.min(CANVAS_W-20, orig.x + dx));
        el.y = Math.max(-el.h+20, Math.min(CANVAS_H-20, orig.y + dy));
        div.style.left = el.x + "px";
        div.style.top = el.y + "px";
      }
    }
    function onUp(ev){
      div.releasePointerCapture(ev.pointerId);
      div.removeEventListener("pointermove", onMove);
      div.removeEventListener("pointerup", onUp);
      save();
    }
    div.addEventListener("pointermove", onMove);
    div.addEventListener("pointerup", onUp);
  }

  // ---------- thumbnails ----------
  function renderRail(){
    rail.innerHTML = "";
    slides.forEach((s, i)=>{
      const t = document.createElement("div");
      t.className = "thumb" + (i===current ? " active" : "");
      t.style.background = s.bg;
      const firstText = s.elements.find(e=>e.type==="text");
      t.innerHTML = `<span class="num">${i+1}</span>` + (firstText ? escapeHtml(firstText.text).slice(0,60) : "") + `<span class="del" title="Delete slide">✕</span>`;
      t.addEventListener("click", (e)=>{
        if(e.target.classList.contains("del")){
          e.stopPropagation();
          if(slides.length===1){ nyxToast("A deck needs at least one slide."); return; }
          slides.splice(i,1);
          if(current>=slides.length) current = slides.length-1;
          save(); renderRail(); renderSlide(); fitCanvas();
          return;
        }
        current = i; renderRail(); renderSlide(); fitCanvas();
      });
      rail.appendChild(t);
    });
    const addBtn = document.createElement("button");
    addBtn.className = "addSlideBtn";
    addBtn.textContent = "+ New slide";
    addBtn.onclick = ()=>{
      slides.splice(current+1, 0, emptySlide());
      current += 1;
      save(); renderRail(); renderSlide(); fitCanvas();
    };
    rail.appendChild(addBtn);
  }
  function escapeHtml(s){ return (s||"").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }

  // ---------- toolbar actions ----------
  window.addText = function(){
    const el = { id:newId(), type:"text", x:120, y:220, w:720, h:90, text:"Click to edit text", fontSize:32, color:"#1a1a1a", align:"left", bold:false };
    slides[current].elements.push(el);
    renderSlide(); selectElement(el.id); save();
  };
  window.addShape = function(){
    const el = { id:newId(), type:"shape", x:340, y:200, w:280, h:160, fill:"#e0a458" };
    slides[current].elements.push(el);
    renderSlide(); selectElement(el.id); save();
  };
  window.triggerImage = function(){ document.getElementById("imageInput").click(); };
  document.getElementById("imageInput").addEventListener("change", (e)=>{
    const file = e.target.files[0];
    if(!file) return;
    const reader = new FileReader();
    reader.onload = ()=>{
      const el = { id:newId(), type:"image", x:260, y:140, w:440, h:280, src: reader.result };
      slides[current].elements.push(el);
      renderSlide(); selectElement(el.id); save();
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  });
  window.setBg = function(color){
    slides[current].bg = color;
    canvas.style.background = color;
    save();
    renderRail();
  };
  window.deleteSelected = function(){
    if(!selectedId) return;
    slides[current].elements = slides[current].elements.filter(e => e.id !== selectedId);
    renderSlide(); save(); renderRail();
  };
  document.addEventListener("keydown", (e)=>{
    if((e.key === "Delete" || e.key === "Backspace") && selectedId && document.activeElement.tagName !== "INPUT" && !document.activeElement.isContentEditable){
      window.deleteSelected();
    }
  });

  // ---------- menu ----------
  window.toggleMenu = function(id){
    document.querySelectorAll(".menu.open").forEach(m => { if(m.id!==id) m.classList.remove("open"); });
    document.getElementById(id).classList.toggle("open");
  };
  document.addEventListener("click", (e)=>{
    document.querySelectorAll(".menu.open").forEach(m=>{ if(!m.contains(e.target)) m.classList.remove("open"); });
  });

  window.newDeck = function(){
    if(!confirm("Start a new presentation? Unsaved changes will be lost.")) return;
    slides = [ emptySlide() ]; current = 0;
    document.getElementById("deckTitle").value = "Untitled presentation";
    localStorage.removeItem(STORAGE_KEY);
    renderRail(); renderSlide(); fitCanvas();
  };

  // ---------- present mode ----------
  const presentEl = document.getElementById("present");
  const presentSlide = document.getElementById("presentSlide");
  let presentIndex = 0;
  window.startPresent = function(){
    presentIndex = current;
    renderPresent();
    presentEl.classList.add("on");
  };
  function renderPresent(){
    const s = slides[presentIndex];
    presentSlide.style.background = s.bg;
    presentSlide.innerHTML = "";
    const scaleX = presentSlide.clientWidth ? presentSlide.clientWidth / CANVAS_W : 1;
    s.elements.forEach(el=>{
      const div = document.createElement("div");
      div.style.position="absolute";
      div.style.left = (el.x/CANVAS_W*100)+"%";
      div.style.top = (el.y/CANVAS_H*100)+"%";
      div.style.width = (el.w/CANVAS_W*100)+"%";
      div.style.height = (el.h/CANVAS_H*100)+"%";
      if(el.type==="text"){
        div.textContent = el.text||"";
        div.style.fontSize = (el.fontSize*(presentSlide.clientWidth/CANVAS_W)||28)+"px";
        div.style.color = el.color||"#1a1a1a";
        div.style.fontWeight = el.bold ? "700":"400";
        div.style.textAlign = el.align||"left";
        div.style.fontFamily = "Inter, sans-serif";
        div.style.padding = "4px 6px";
        div.style.overflow = "hidden";
      }else if(el.type==="image"){
        const img = document.createElement("img");
        img.src = el.src; img.style.width="100%"; img.style.height="100%"; img.style.objectFit="contain";
        div.appendChild(img);
      }else if(el.type==="shape"){
        div.style.background = el.fill||"#e0a458";
      }
      presentSlide.appendChild(div);
    });
  }
  function exitPresent(){ presentEl.classList.remove("on"); }
  document.addEventListener("keydown", (e)=>{
    if(!presentEl.classList.contains("on")) return;
    if(e.key === "Escape") exitPresent();
    else if(e.key === "ArrowRight" || e.key === " "){ e.preventDefault(); if(presentIndex<slides.length-1){presentIndex++; renderPresent();} }
    else if(e.key === "ArrowLeft"){ if(presentIndex>0){presentIndex--; renderPresent();} }
  });
  presentEl.addEventListener("click", (e)=>{
    if(e.target===presentEl) exitPresent();
    else if(presentIndex<slides.length-1){ presentIndex++; renderPresent(); }
  });

  // ---------- export to .pptx ----------
  window.exportPptx = async function(){
    try{
      const pptx = new PptxGenJS();
      pptx.defineLayout({ name: "NYX_16x9", width: 13.333, height: 7.5 });
      pptx.layout = "NYX_16x9";
      const PX_TO_IN = 13.333 / CANVAS_W;

      slides.forEach(s => {
        const slide = pptx.addSlide();
        slide.background = { color: (s.bg||"#ffffff").replace("#","") };
        s.elements.forEach(el => {
          const x = el.x*PX_TO_IN, y = el.y*PX_TO_IN, w = el.w*PX_TO_IN, h = el.h*PX_TO_IN;
          if(el.type === "text"){
            slide.addText(el.text || "", {
              x, y, w, h,
              fontSize: Math.max(8, Math.round((el.fontSize||28) * 0.75)),
              color: (el.color||"#1a1a1a").replace("#",""),
              bold: !!el.bold,
              align: el.align || "left",
              fontFace: "Arial",
            });
          }else if(el.type === "shape"){
            slide.addShape(pptx.ShapeType.rect, { x, y, w, h, fill: { color: (el.fill||"#e0a458").replace("#","") } });
          }else if(el.type === "image"){
            try{ slide.addImage({ data: el.src, x, y, w, h }); }catch(err){ /* skip broken image */ }
          }
        });
      });

      const title = (document.getElementById("deckTitle").value || "presentation").trim();
      await pptx.writeFile({ fileName: title + ".pptx" });
    }catch(err){
      console.error(err);
      alert("Couldn't export this presentation to .pptx in this browser.");
    }
  };

  // ---------- import (best-effort: text content only) ----------
  window.triggerOpen = function(){ document.getElementById("openInput").click(); };
  document.getElementById("openInput").addEventListener("change", async (e)=>{
    const file = e.target.files[0];
    if(!file) return;
    document.getElementById("deckTitle").value = file.name.replace(/\.[^.]+$/, "");
    try{
      const zip = await JSZip.loadAsync(await file.arrayBuffer());
      const slidePaths = Object.keys(zip.files)
        .filter(p => /^ppt\/slides\/slide\d+\.xml$/.test(p))
        .sort((a,b)=>{
          const na = parseInt(a.match(/slide(\d+)\.xml/)[1],10);
          const nb = parseInt(b.match(/slide(\d+)\.xml/)[1],10);
          return na-nb;
        });
      if(!slidePaths.length) throw new Error("No slides found");
      const imported = [];
      for(const p of slidePaths){
        const xml = await zip.files[p].async("text");
        const texts = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map(m => decodeXml(m[1]));
        const s = emptySlide();
        if(texts.length){
          s.elements.push({ id:newId(), type:"text", x:80, y:60, w:800, h:420,
            text: texts.join("\n"), fontSize:28, color:"#1a1a1a", align:"left", bold:false });
        }
        imported.push(s);
      }
      slides = imported;
      current = 0;
      save(); renderRail(); renderSlide(); fitCanvas();
      nyxToast("Imported text content from " + slidePaths.length + " slide(s). Layout and images aren't preserved on import yet.");
    }catch(err){
      console.error(err);
      alert("Couldn't read that .pptx file, or it has no readable slide text.");
    }
    e.target.value = "";
  });
  function decodeXml(s){
    return s.replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&apos;/g,"'");
  }

  // ---------- init ----------
  restore();
  renderRail();
  renderSlide();
  fitCanvas();
})();
