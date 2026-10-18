/* Nyxdesk core — small shared runtime used by every app page.
   Theme, icons, popovers/menus/dialogs, local file library (IndexedDB), lazy library loader. */
(function(){
  "use strict";
  /* Compatibility shim: the vendored PDF engine calls a very new Map/WeakMap
     method that most browsers don't ship yet. Polyfill it so PDF viewing
     works on today's browsers, not just bleeding-edge ones. */
  [Map, WeakMap].forEach(C => {
    if(C && !C.prototype.getOrInsertComputed){
      C.prototype.getOrInsertComputed = function(key, fn){
        if(this.has(key)) return this.get(key);
        const v = fn(key); this.set(key, v); return v;
      };
    }
  });

  const NS = window.Nyx = {};
  const script = document.currentScript;
  NS.base = new URL("../", script ? script.src : location.href).href;

  /* ---------- theme ---------- */
  const TK = "nyx-theme";
  function setTheme(t){ document.documentElement.setAttribute("data-theme", t); }
  (function(){
    let t = null;
    try{ t = localStorage.getItem(TK); }catch(e){}
    if(!t) t = (window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light";
    setTheme(t);
  })();
  NS.theme = () => document.documentElement.getAttribute("data-theme");
  NS.toggleTheme = function(){
    const t = NS.theme() === "dark" ? "light" : "dark";
    setTheme(t);
    try{ localStorage.setItem(TK, t); }catch(e){}
    document.dispatchEvent(new CustomEvent("nyx-theme", { detail: t }));
  };

  NS.isPhone = () => window.matchMedia("(max-width:720px)").matches;
  NS.isCoarse = () => window.matchMedia("(pointer:coarse)").matches;
  NS.isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

  /* ---------- small helpers ---------- */
  NS.esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  NS.uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  NS.clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  NS.debounce = (fn, ms) => { let t; return function(...a){ clearTimeout(t); t = setTimeout(() => fn.apply(this, a), ms); }; };
  NS.ic = (name, cls) => '<svg class="i ' + (cls || "") + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ((window.NYX_ICONS || {})[name] || "") + "</svg>";
  NS.hydrate = function(root){
    (root || document).querySelectorAll("i[data-i]").forEach(el => {
      const t = document.createElement("template");
      t.innerHTML = NS.ic(el.dataset.i, el.dataset.c || "");
      el.replaceWith(t.content.firstChild);
    });
  };
  NS.h = function(tag, props){
    const el = document.createElement(tag);
    for(const k in (props || {})){
      const v = props[k];
      if(v == null || v === false) continue;
      if(k === "class") el.className = v;
      else if(k === "style" && typeof v === "object") Object.assign(el.style, v);
      else if(k === "html") el.innerHTML = v;
      else if(k.slice(0, 2) === "on") el.addEventListener(k.slice(2), v);
      else if(k in el && k !== "list") { try{ el[k] = v; }catch(e){ el.setAttribute(k, v); } }
      else el.setAttribute(k, v === true ? "" : v);
    }
    for(let i = 2; i < arguments.length; i++){
      [].concat(arguments[i]).forEach(c => { if(c == null || c === false) return; el.append(c.nodeType ? c : document.createTextNode(c)); });
    }
    return el;
  };
  const h = NS.h;
  NS.icEl = (name, cls) => { const t = document.createElement("template"); t.innerHTML = NS.ic(name, cls); return t.content.firstChild; };

  NS.toast = function(msg, ms){
    let el = document.getElementById("nyx-toast");
    if(!el){ el = h("div", { id: "nyx-toast", class: "toast", role: "status" }); document.body.append(el); }
    el.textContent = msg; el.classList.add("show");
    clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove("show"), ms || 2600);
  };

  /* ---------- files ---------- */
  NS.download = function(data, name, type){
    const blob = data instanceof Blob ? data : new Blob([data], { type: type || "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = h("a", { href: url, download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 8000);
  };
  /* Extensions alone leave files greyed-out in some phone pickers; adding MIME types fixes that. */
  const MIME = {
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".pdf": "application/pdf", ".csv": "text/csv", ".tsv": "text/tab-separated-values",
    ".txt": "text/plain", ".md": "text/markdown", ".markdown": "text/markdown", ".html": "text/html", ".htm": "text/html"
  };
  NS.accept = function(exts){
    const out = [];
    String(exts).split(",").forEach(e => { e = e.trim(); if(!e) return; out.push(e); if(MIME[e] && !out.includes(MIME[e])) out.push(MIME[e]); });
    return out.join(",");
  };
  NS.pick = function(accept, multiple){
    return new Promise(res => {
      const a = /^[.\w]/.test(accept || "") && !/\//.test(accept.split(",")[0]) ? NS.accept(accept) : (accept || "");
      const inp = h("input", { type: "file", accept: a, multiple: !!multiple, style: { position: "fixed", left: "-9999px", top: "0", opacity: "0", width: "1px", height: "1px" } });
      let done = false, timer = 0;
      const finish = files => { if(done) return; done = true; clearTimeout(timer); removeEventListener("focus", onFocus); setTimeout(() => inp.remove(), 0); res(files); };
      /* iOS never fires "cancel": when the page regains focus with nothing chosen, give up after a beat. */
      const onFocus = () => { timer = setTimeout(() => { if(!inp.files || !inp.files.length) finish([]); }, 1200); };
      inp.addEventListener("change", () => finish([...inp.files]));
      inp.addEventListener("cancel", () => finish([]));
      document.body.append(inp);
      setTimeout(() => addEventListener("focus", onFocus), 300);
      inp.click();
    });
  };
  NS.readDataURL = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });
  NS.dataURLtoBytes = function(u){
    const b = atob(u.split(",")[1]); const a = new Uint8Array(b.length);
    for(let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i);
    return a;
  };
  NS.imgSize = src => new Promise(res => { const i = new Image(); i.onload = () => res({ w: i.naturalWidth, h: i.naturalHeight }); i.onerror = () => res({ w: 400, h: 300 }); i.src = src; });
  NS.dropFiles = function(el, cb){
    const mask = h("div", { class: "dropmask" }, "Drop a file to open it");
    el.append(mask);
    let n = 0;
    el.addEventListener("dragenter", e => { if(e.dataTransfer && [...e.dataTransfer.types].includes("Files")){ n++; mask.classList.add("on"); } });
    el.addEventListener("dragleave", () => { n = Math.max(0, n - 1); if(!n) mask.classList.remove("on"); });
    el.addEventListener("dragover", e => { if(e.dataTransfer && [...e.dataTransfer.types].includes("Files")) e.preventDefault(); });
    el.addEventListener("drop", e => {
      if(!(e.dataTransfer && e.dataTransfer.files.length)) return;
      e.preventDefault(); n = 0; mask.classList.remove("on"); cb([...e.dataTransfer.files]);
    });
  };

  /* ---------- lazy libraries (all vendored, nothing loads from a third party) ---------- */
  const LIBS = {
    pdflib: { js: "vendor/pdf-lib.min.js", g: "PDFLib" },
    jszip: { js: "vendor/jszip.min.js", g: "JSZip" },
    docx: { js: "vendor/docx.min.js", g: "docx" },
    pptx: { js: "vendor/pptxgen.min.js", g: "PptxGenJS" }
  };
  const loaded = {};
  NS.lib = function(name){
    if(loaded[name]) return loaded[name];
    if(name === "pdfjs"){
      return loaded[name] = import(NS.base + "vendor/pdfjs/pdf.min.mjs").then(m => {
        m.GlobalWorkerOptions.workerSrc = NS.base + "vendor/pdfjs/pdf.worker.min.mjs";
        return m;
      });
    }
    const L = LIBS[name];
    if(!L) return Promise.reject(new Error("Unknown library " + name));
    if(window[L.g]) return loaded[name] = Promise.resolve(window[L.g]);
    return loaded[name] = new Promise((res, rej) => {
      const s = h("script", { src: NS.base + L.js });
      s.onload = () => res(window[L.g]);
      s.onerror = () => { delete loaded[name]; rej(new Error("Could not load " + name)); };
      document.head.append(s);
    });
  };

  /* ---------- selection memory ----------
     Opening a <select>, a dialog or a menu moves focus away from a contenteditable, and on phones
     that drops the selection entirely. Remember the last range inside the editor and put it back. */
  NS.selMemo = function(root){
    let saved = null;
    document.addEventListener("selectionchange", () => {
      const sel = window.getSelection();
      if(sel.rangeCount && root.contains(sel.anchorNode) && root.contains(sel.focusNode)) saved = sel.getRangeAt(0).cloneRange();
    });
    return {
      restore(){
        const sel = window.getSelection();
        if(sel.rangeCount && root.contains(sel.anchorNode)) return true;
        if(!saved) return false;
        try{ sel.removeAllRanges(); sel.addRange(saved); return true; }catch(e){ return false; }
      },
      has: () => !!saved && !saved.collapsed
    };
  };

  /* ---------- pointer drag (mouse, touch and pen through one code path) ---------- */
  NS.drag = function(el, o){
    el.addEventListener("pointerdown", e => {
      if(e.button > 0 || (o.filter && !o.filter(e))) return;
      const st = o.start(e); if(st === false) return;
      const x0 = e.clientX, y0 = e.clientY, id = e.pointerId; let moved = false;
      if(o.capture !== false){ try{ el.setPointerCapture(id); }catch(_){} }
      const mv = ev => {
        if(ev.pointerId !== id) return;
        const dx = ev.clientX - x0, dy = ev.clientY - y0;
        if(!moved && Math.hypot(dx, dy) < (o.slop == null ? 3 : o.slop)) return;
        moved = true; o.move(dx, dy, ev, st);
      };
      const up = ev => {
        if(ev.pointerId !== id) return;
        el.removeEventListener("pointermove", mv); el.removeEventListener("pointerup", up); el.removeEventListener("pointercancel", up);
        try{ el.releasePointerCapture(id); }catch(_){}
        if(o.end) o.end(moved, ev, st);
      };
      el.addEventListener("pointermove", mv); el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up);
    });
  };

  /* ---------- popovers & menus ---------- */
  let openPop = null;
  NS.closePop = () => { if(openPop) openPop.close(); };
  NS.pop = function(anchor, node, opt){
    opt = opt || {};
    NS.closePop();
    const phone = NS.isPhone() && !opt.at;
    const el = h("div", { class: "pop" + (phone ? " sheet" : "") }, node);
    el.addEventListener("mousedown", e => { if(!/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) e.preventDefault(); });
    let back = null;
    if(phone){ back = h("div", { class: "sheet-back" }); document.body.append(back); }
    document.body.append(el);
    const place = () => {
      if(phone) return;
      const vw = innerWidth, vh = innerHeight;
      const r = opt.at ? { left: opt.at.x, right: opt.at.x, top: opt.at.y, bottom: opt.at.y } : anchor.getBoundingClientRect();
      const w = el.offsetWidth, hh = el.offsetHeight;
      let x = opt.align === "right" ? r.right - w : r.left;
      let y = r.bottom + 4;
      if(x + w > vw - 8) x = vw - w - 8;
      if(x < 8) x = 8;
      if(y + hh > vh - 8){ y = r.top - hh - 4; if(y < 8){ y = Math.max(8, vh - hh - 8); } }
      el.style.left = x + "px"; el.style.top = y + "px";
    };
    place();
    const onDown = e => { if(!el.contains(e.target) && !(anchor && anchor.contains && anchor.contains(e.target))) close(); };
    const onKey = e => { if(e.key === "Escape"){ e.stopPropagation(); close(); } };
    setTimeout(() => { document.addEventListener("pointerdown", onDown, true); document.addEventListener("keydown", onKey, true); }, 0);
    function close(){
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
      el.remove(); if(back) back.remove();
      if(openPop && openPop.el === el) openPop = null;
      if(opt.onClose) opt.onClose();
    }
    if(back) back.addEventListener("pointerdown", close);
    return openPop = { el, close, place };
  };
  NS.menu = function(anchor, items, opt){
    const box = h("div");
    let P;
    items.forEach(it => {
      if(!it) return;
      if(it === "-"){ box.append(h("div", { class: "menu-sep" })); return; }
      if(it.head){ box.append(h("div", { class: "menu-h" }, it.head)); return; }
      const b = h("button", { class: "menu-i" + (it.on ? " on" : ""), disabled: !!it.disabled, type: "button", onclick: () => { P.close(); if(it.run) it.run(); } },
        it.icon ? NS.icEl(it.icon) : h("span", { style: { width: "18px", flex: "none" } }),
        h("span", null, it.label), it.kbd ? h("span", { class: "kbd" }, it.kbd) : null);
      box.append(b);
    });
    P = NS.pop(anchor, box, opt);
    return P;
  };
  NS.context = (ev, items) => { ev.preventDefault(); return NS.menu(null, items, { at: { x: ev.clientX, y: ev.clientY } }); };

  const mix = (a, b, t) => { const p = s => [1, 3, 5].map(i => parseInt(s.slice(i, i + 2), 16)); const A = p(a), B = p(b); return "#" + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, "0")).join(""); };
  const hues = ["#980000", "#ff0000", "#ff9900", "#ffe000", "#2fb344", "#00b8b8", "#3b82f6", "#1f3fd1", "#8a2be2", "#e91e8c"];
  const PALETTE = ["#000000", "#3c3c3c", "#666666", "#8e8e8e", "#b5b5b5", "#d0d0d0", "#e2e2e2", "#f0f0f0", "#f7f7f7", "#ffffff"]
    .concat(hues)
    .concat([.85, .7, .5].flatMap(t => hues.map(c => mix(c, "#ffffff", t))))
    .concat([.3, .55].flatMap(t => hues.map(c => mix(c, "#000000", t))));
  NS.PALETTE = PALETTE;
  NS.colorPick = function(anchor, o){
    o = o || {};
    const box = h("div");
    const grid = h("div", { class: "swatches" });
    PALETTE.forEach(c => grid.append(h("button", { class: "sw", type: "button", style: { background: c }, title: c, onclick: () => { P.close(); o.onPick(c); } })));
    box.append(grid);
    const row = h("div", { class: "row" });
    if(o.none !== false) row.append(h("button", { class: "btn sm", type: "button", onclick: () => { P.close(); o.onPick(null); } }, o.noneLabel || "None"));
    const ci = h("input", { type: "color", value: /^#[0-9a-f]{6}$/i.test(o.value || "") ? o.value : "#000000", "aria-label": "Custom color" });
    ci.addEventListener("change", () => { P.close(); o.onPick(ci.value); });
    row.append(h("span", { style: { color: "var(--muted)", fontSize: "12.5px" } }, "Custom"), ci);
    box.append(row);
    const P = NS.pop(anchor, box);
    return P;
  };

  /* ---------- dialogs ---------- */
  NS.dialog = function(o){
    const body = h("div", { class: "dlg-b" });
    if(typeof o.body === "string") body.innerHTML = o.body; else if(o.body) body.append(o.body);
    const foot = h("div", { class: "dlg-f" });
    const box = h("div", { class: "dlg", role: "dialog", "aria-modal": "true", style: { "--w": (o.width || 440) + "px" } },
      h("div", { class: "dlg-h" }, h("span", null, o.title || ""), h("span", { class: "sp" }),
        h("button", { class: "ib", type: "button", "aria-label": "Close", onclick: () => api.close() }, NS.icEl("x"))),
      body, foot);
    const back = h("div", { class: "dlg-back" }, box);
    const api = { el: box, body, close(v){ document.removeEventListener("keydown", onKey, true); back.remove(); if(o.onClose) o.onClose(v); } };
    (o.buttons || []).forEach(b => {
      const btn = h("button", { class: "btn" + (b.pri ? " pri" : "") + (b.danger ? " danger" : ""), type: "button", onclick: () => { const r = b.run ? b.run(api) : undefined; if(r !== false) api.close(b.value); } }, b.label);
      foot.append(btn); if(b.pri) api.primary = btn;
    });
    if(!(o.buttons || []).length) foot.remove();
    const onKey = e => {
      if(e.key === "Escape"){ e.stopPropagation(); api.close(); }
      else if(e.key === "Enter" && api.primary && e.target.tagName !== "TEXTAREA" && e.target.tagName !== "BUTTON" && !e.isComposing){ e.preventDefault(); api.primary.click(); }
    };
    document.addEventListener("keydown", onKey, true);
    back.addEventListener("pointerdown", e => { if(e.target === back && o.dismiss !== false) api.close(); });
    document.body.append(back);
    NS.hydrate(box);
    const f = box.querySelector("[autofocus],input:not([type=hidden]):not([type=file]),textarea,select");
    if(f && !NS.isPhone()) setTimeout(() => { f.focus(); if(f.select) try{ f.select(); }catch(e){} }, 30);
    return api;
  };
  NS.prompt = function(title, value, o){
    o = o || {};
    return new Promise(res => {
      const inp = h("input", { class: "inp", type: o.type || "text", value: value == null ? "" : value, placeholder: o.placeholder || "" });
      let done = false;
      NS.dialog({ title, width: o.width || 400, body: h("div", { class: "field" }, o.label ? h("span", null, o.label) : null, inp),
        buttons: [{ label: "Cancel" }, { label: o.ok || "OK", pri: true, run: () => { done = true; res(inp.value); } }],
        onClose: () => { if(!done) res(null); } });
    });
  };
  NS.confirm = function(msg, o){
    o = o || {};
    return new Promise(res => {
      let done = false;
      NS.dialog({ title: o.title || "Are you sure?", width: 400, body: h("p", { style: { color: "var(--muted)" } }, msg),
        buttons: [{ label: "Cancel" }, { label: o.ok || "OK", pri: !o.danger, danger: !!o.danger, run: () => { done = true; res(true); } }],
        onClose: () => { if(!done) res(false); } });
    });
  };
  NS.alert = (msg, title) => NS.dialog({ title: title || "Notice", width: 400, body: h("p", { style: { color: "var(--muted)", whiteSpace: "pre-wrap" } }, msg), buttons: [{ label: "OK", pri: true }] });

  /* ---------- ribbon / commands ---------- */
  NS.ribbon = function(root){
    if(root._ribbon) return root._ribbon;
    const tabs = [...root.querySelectorAll(".rtab")];
    const panels = [...root.querySelectorAll(".rpanel")];
    let current = null;
    function show(name){
      current = name;
      tabs.forEach(t => { const on = t.dataset.p === name; t.classList.toggle("on", on); t.setAttribute("aria-selected", on); });
      panels.forEach(p => p.classList.toggle("on", p.dataset.p === name));
      const on = tabs.find(t => t.dataset.p === name);
      if(on && on.scrollIntoView && NS.isPhone()) try{ on.scrollIntoView({ block: "nearest", inline: "center" }); }catch(e){}
    }
    tabs.forEach(t => t.addEventListener("click", () => { if(!t.hidden) show(t.dataset.p); }));
    const first = tabs.find(t => !t.hidden);
    if(first) show(first.dataset.p);
    return root._ribbon = { show, tab: n => tabs.find(t => t.dataset.p === n), get current(){ return current; } };
  };
  NS.keepFocus = function(root){
    root.addEventListener("mousedown", e => {
      if(e.target.closest("input,select,textarea,label")) return;
      if(e.target.closest(".rb,.ib,.menu-i")) e.preventDefault();
    });
  };
  NS.wireCmds = function(root, handler){
    root.addEventListener("click", e => {
      const el = e.target.closest("[data-cmd]");
      if(!el || !root.contains(el) || el.disabled) return;
      handler(el.dataset.cmd, el.dataset.arg, el, e);
    });
    root.addEventListener("change", e => {
      const el = e.target.closest("select[data-cmd],input[data-cmd]");
      if(!el) return;
      if(el.type === "checkbox") handler(el.dataset.cmd, el.checked, el, e);
      else handler(el.dataset.cmd, el.value, el, e);
    });
  };
  NS.keys = function(map, target){
    (target || document).addEventListener("keydown", e => {
      let k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      let s = "";
      if(e.ctrlKey || e.metaKey) s += "ctrl+";
      if(e.altKey) s += "alt+";
      if(e.shiftKey) s += "shift+";
      s += k;
      const fn = map[s];
      if(fn && fn(e) !== false) { e.preventDefault(); }
    });
  };

  /* ---------- local library (IndexedDB) ---------- */
  let dbp = null;
  function db(){
    if(dbp) return dbp;
    return dbp = new Promise((res, rej) => {
      let r;
      try{ r = indexedDB.open("nyxdesk", 1); }catch(e){ return rej(e); }
      r.onupgradeneeded = () => { const d = r.result; d.createObjectStore("meta", { keyPath: "id" }); d.createObjectStore("data"); d.createObjectStore("handoff"); };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  function tx(stores, mode, fn){
    return db().then(d => new Promise((res, rej) => {
      const t = d.transaction(stores, mode);
      let out;
      try{ out = fn(t); }catch(e){ return rej(e); }
      t.oncomplete = () => res(out && out.result !== undefined ? out.result : out);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    }));
  }
  const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  NS.store = {
    put(id, app, title, data){
      if(!NS._persisted && navigator.storage && navigator.storage.persist){ NS._persisted = true; navigator.storage.persist().catch(() => {}); }
      const meta = { id, app, title: title || "Untitled", updated: Date.now() };
      return tx(["meta", "data"], "readwrite", t => { t.objectStore("meta").put(meta); t.objectStore("data").put(data, id); });
    },
    async get(id){
      const d = await db();
      const m = await req(d.transaction("meta").objectStore("meta").get(id));
      if(!m) return null;
      const data = await req(d.transaction("data").objectStore("data").get(id));
      return { meta: m, data };
    },
    async list(app){
      const d = await db();
      const all = await req(d.transaction("meta").objectStore("meta").getAll());
      return all.filter(m => !app || m.app === app).sort((a, b) => b.updated - a.updated);
    },
    del(id){ return tx(["meta", "data"], "readwrite", t => { t.objectStore("meta").delete(id); t.objectStore("data").delete(id); }); },
    clear(){ return tx(["meta", "data", "handoff"], "readwrite", t => { t.objectStore("meta").clear(); t.objectStore("data").clear(); t.objectStore("handoff").clear(); }); },
    putHandoff(file){ return file.arrayBuffer().then(buf => tx(["handoff"], "readwrite", t => { t.objectStore("handoff").put({ name: file.name, type: file.type, buf }, "f"); })); },
    async peekHandoff(){
      try{ const d = await db(); const v = await req(d.transaction("handoff").objectStore("handoff").get("f")); if(v) return { name: v.name }; }catch(e){}
      try{ const j = JSON.parse(sessionStorage.getItem("nyx-handoff") || "null"); if(j) return { name: j.name }; }catch(e){}
      return null;
    },
    async takeHandoff(){
      let v = null;
      try{ const d = await db(); v = await req(d.transaction("handoff").objectStore("handoff").get("f")); }catch(e){}
      if(!v){
        try{
          const j = JSON.parse(sessionStorage.getItem("nyx-handoff") || "null");
          if(j){ sessionStorage.removeItem("nyx-handoff"); const bin = atob(j.b64), u8 = new Uint8Array(bin.length); for(let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); return new File([u8], j.name, { type: j.type }); }
        }catch(e){}
        return null;
      }
      await tx(["handoff"], "readwrite", t => { t.objectStore("handoff").delete("f"); });
      return new File([v.buf], v.name, { type: v.type });
    }
  };

  NS.APPS = {
    inkwell: { name: "Inkwell", page: "inkwell.html", kind: "Document", ext: [".docx", ".html", ".htm", ".md", ".txt"] },
    abacus: { name: "Abacus", page: "abacus.html", kind: "Spreadsheet", ext: [".xlsx", ".csv", ".tsv"] },
    marquee: { name: "Marquee", page: "marquee.html", kind: "Presentation", ext: [".pptx"] },
    parchment: { name: "Parchment", page: "parchment.html", kind: "PDF", ext: [".pdf"] }
  };
  NS.appForFile = function(name){
    const ext = "." + String(name).split(".").pop().toLowerCase();
    for(const k in NS.APPS) if(NS.APPS[k].ext.includes(ext)) return k;
    return null;
  };
  /* A file from a share sheet can arrive without an extension; recover one from its MIME type. */
  NS.normalize = function(file){
    if(NS.appForFile(file.name)) return file;
    const ext = Object.keys(MIME).find(k => MIME[k] === file.type);
    return ext ? new File([file], file.name + ext, { type: file.type }) : file;
  };
  NS.openInApp = async function(file, from){
    const app = NS.appForFile(file.name);
    if(!app){ NS.toast("Nyxdesk can't open “" + file.name.split(".").pop() + "” files."); return false; }
    if(app === from) return "same";
    try{
      await NS.store.putHandoff(file);
    }catch(e){
      /* IndexedDB can be blocked (private tabs, low storage). Fall back to sessionStorage for modest files. */
      try{
        const buf = await file.arrayBuffer();
        if(buf.byteLength > 3.2e6) throw new Error("too big");
        let bin = ""; const u8 = new Uint8Array(buf); for(let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
        sessionStorage.setItem("nyx-handoff", JSON.stringify({ name: file.name, type: file.type, b64: btoa(bin) }));
      }catch(e2){
        NS.alert("This browser is blocking local storage, so Nyxdesk can't pass “" + file.name + "” between tools. Try a normal (non-private) tab, or open the file from inside the tool itself.", "Couldn't open the file");
        return false;
      }
    }
    location.href = NS.base + NS.APPS[app].page + "#open";
    return true;
  };
  NS.ago = function(ts){
    const s = (Date.now() - ts) / 1000;
    if(s < 60) return "just now";
    if(s < 3600) return Math.floor(s / 60) + " min ago";
    if(s < 86400) return Math.floor(s / 3600) + " h ago";
    if(s < 86400 * 7) return Math.floor(s / 86400) + " d ago";
    return new Date(ts).toLocaleDateString();
  };

  /* Autosaving document session shared by all apps. */
  NS.session = function(o){
    const S = { id: null, dirty: false, app: o.app };
    const stateEl = () => document.getElementById("savestate");
    const setState = t => { const e = stateEl(); if(e) e.textContent = t; };
    const hash = () => location.hash.replace(/^#/, "");
    const flush = async () => {
      if(!S.dirty) return;
      S.dirty = false;
      try{
        if(!S.id){ S.id = NS.uid(); history.replaceState(null, "", "#" + S.id); }
        await NS.store.put(S.id, o.app, o.getTitle(), await o.getData());
        setState("Saved on this device");
      }catch(e){ console.error(e); S.dirty = true; setState("Couldn't save — storage unavailable"); }
    };
    const later = NS.debounce(flush, 900);
    S.touch = function(){ S.dirty = true; setState("Saving…"); later(); };
    S.flush = flush;
    S.load = async function(){
      const hs = hash();
      if(!hs || hs === "open") return false;
      try{
        const rec = await NS.store.get(hs);
        if(!rec){ history.replaceState(null, "", location.pathname); return false; }
        S.id = hs;
        await o.setData(rec.data, rec.meta);
        setState("Saved on this device");
        return true;
      }catch(e){ console.error(e); return false; }
    };
    S.takeHandoff = async function(){
      if(hash() !== "open") return null;
      history.replaceState(null, "", location.pathname);
      try{ return await NS.store.takeHandoff(); }catch(e){ return null; }
    };
    S.fresh = () => { location.assign(location.pathname); };
    S.library = function(){
      NS.store.list(o.app).then(list => {
        const box = h("div", { class: "list" });
        if(!list.length) box.append(h("div", { class: "empty" }, "Nothing saved in this browser yet. Files are saved automatically as you work."));
        list.forEach(m => {
          const row = h("div", { class: "list-i" }, h("span", { class: "t" }, m.title), h("span", { class: "m" }, NS.ago(m.updated)),
            h("button", { class: "ib", title: "Delete", type: "button", onclick: async e => {
              e.stopPropagation();
              if(await NS.confirm("Delete “" + m.title + "” from this browser?", { ok: "Delete", danger: true })){ await NS.store.del(m.id); row.remove(); if(m.id === S.id){ S.id = null; } }
            } }, NS.icEl("trash")));
          row.style.cursor = "pointer";
          row.addEventListener("click", () => { location.hash = m.id; location.reload(); });
          box.append(row);
        });
        NS.dialog({ title: "Saved in this browser", width: 520, body: box, buttons: [{ label: "Close" }] });
      });
    };
    addEventListener("pagehide", () => { if(S.dirty) flush(); });
    document.addEventListener("visibilitychange", () => { if(document.visibilityState === "hidden" && S.dirty) flush(); });
    return S;
  };

  /* ---------- boot ---------- */
  function syncThemeColor(){
    let m = document.querySelector('meta[name="theme-color"]');
    if(!m){ m = document.createElement("meta"); m.name = "theme-color"; document.head.append(m); }
    m.content = getComputedStyle(document.documentElement).getPropertyValue("--chrome").trim() || (NS.theme() === "dark" ? "#171314" : "#f6f1ea");
  }
  function boot(){
    NS.hydrate(document);
    if(document.documentElement.classList.contains("is-app") && window.visualViewport){
      /* Keep the app glued to the *visible* viewport: when the on-screen keyboard opens, iOS slides the
         visual viewport inside the layout viewport; following offsetTop keeps bar + toolbar on screen. */
      const vv = window.visualViewport, root = document.documentElement;
      const set = () => {
        root.style.setProperty("--vvh", vv.height + "px");
        root.style.setProperty("--vvt", vv.offsetTop + "px");
        root.classList.toggle("kb-open", innerHeight - vv.height > 140);
      };
      vv.addEventListener("resize", set); vv.addEventListener("scroll", set); set();
    }
    document.querySelectorAll("[data-theme-toggle]").forEach(b => b.addEventListener("click", NS.toggleTheme));
    syncThemeColor(); document.addEventListener("nyx-theme", syncThemeColor);
    if("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register(NS.base + "sw.js").catch(() => {});
  }
  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
