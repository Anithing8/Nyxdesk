/* Nyxdesk Draft — word processor */
(function(){
  "use strict";
  const N = window.Nyx, h = N.h, $ = s => document.querySelector(s);
  const editor = $("#editor"), pgHeader = $("#pgHeader"), pgFooter = $("#pgFooter");
  const titleIn = $("#docTitle");
  let comments = []; // {id, text, author, note, resolved}
  let footnotes = []; // {id, text}
  let trackOn = false, pageMeta = { margin: "normal", orient: "portrait", size: "letter", cols: 1, watermark: null, pageColor: null };

  N.ribbon($("#ribbon"));
  N.keepFocus($("#ribbon"));
  const SM = N.selMemo(editor);
  if(!N.isCoarse()) editor.focus();
  /* put focus + the remembered selection back before any command runs (selects, menus and dialogs steal both) */
  function prep(){ if(document.activeElement !== editor) editor.focus({ preventScroll: true }); SM.restore(); }

  /* ---------- selection-preserving exec ---------- */
  function exec(cmd, val){ prep(); document.execCommand(cmd, false, val); syncToolbar(); touch(); }
  /* Wraps the current selection in `tag` with the given inline `style`. If nothing is
     selected (just a blinking caret), it instead inserts an empty styled marker and
     drops the caret inside it, so whatever gets typed next picks up the style — the
     same behavior Word/Docs give you for "change the font, then keep typing". */
  function wrapSel(tag, style){
    prep();
    const sel = window.getSelection(); if(!sel.rangeCount) return;
    const r = sel.getRangeAt(0);
    const el = document.createElement(tag); if(style) el.setAttribute("style", style);
    if(r.collapsed){
      el.appendChild(document.createTextNode("\u200b"));
      r.insertNode(el);
      const nr = document.createRange(); nr.setStart(el.firstChild, 1); nr.collapse(true);
      sel.removeAllRanges(); sel.addRange(nr);
      editor.focus(); touch();
      return;
    }
    try{ r.surroundContents(el); }catch(e){ el.appendChild(r.extractContents()); r.insertNode(el); }
    sel.removeAllRanges(); const nr = document.createRange(); nr.selectNodeContents(el); sel.addRange(nr);
    editor.focus(); touch();
  }

  const CMDS = {
    bold: () => exec("bold"), italic: () => exec("italic"), underline: () => exec("underline"),
    strike: () => exec("strikeThrough"), sub: () => exec("subscript"), sup: () => exec("superscript"),
    growfont: () => stepFont(1), shrinkfont: () => stepFont(-1),
    fontname: v => applyFontFamily(v), fontsize: v => applySize(v),
    ol: () => exec("insertOrderedList"), ul: () => exec("insertUnorderedList"),
    checklist: () => insertChecklist(),
    outdent: () => exec("outdent"), indent: () => exec("indent"),
    align: v => exec({ left: "justifyLeft", center: "justifyCenter", right: "justifyRight", justify: "justifyFull" }[v]),
    quote: () => toggleBlock("blockquote"), codeblock: () => toggleBlock("pre"),
    clearfmt: () => exec("removeFormat"),
    style: v => applyStyle(v),
    undo: () => exec("undo"), redo: () => exec("redo"),
    paintfmt: () => startPaint(),
    setview: v => setView(v)
  };
  N.wireCmds($("#ribbon"), (cmd, arg) => { if(CMDS[cmd]) CMDS[cmd](arg); });

  function stepFont(dir){
    const sel = window.getSelection(); let size = 16;
    if(sel.anchorNode){ const el = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement; size = parseFloat(getComputedStyle(el).fontSize) || 16; }
    const next = Math.max(6, Math.round(size + dir * (size > 24 ? 4 : 2)));
    wrapSel("span", "font-size:" + next + "px");
  }
  function applySize(pt){ wrapSel("span", "font-size:" + Math.round(pt * 1.333) + "px"); }
  /* Font family is applied by hand rather than via document.execCommand("fontName", ...):
     that command silently no-ops in current browsers when given a comma-separated
     fallback stack (it only tolerates a single bare name), which made the font picker
     look broken for anything but single-word fonts. */
  function applyFontFamily(stack){ wrapSel("span", "font-family:" + stack); }

  function toggleBlock(tag){
    const blk = currentBlock();
    if(blk && blk.tagName.toLowerCase() === tag){ exec("formatBlock", "<p>"); }
    else exec("formatBlock", "<" + tag + ">");
    if(tag === "blockquote"){ const b = currentBlock(); if(b && b.tagName === "BLOCKQUOTE") b.classList.add("intense"); }
  }
  function currentBlock(){
    const sel = window.getSelection(); if(!sel.rangeCount) return null;
    let n = sel.getRangeAt(0).startContainer; if(n.nodeType === 3) n = n.parentElement;
    while(n && n !== editor && !/^(P|H1|H2|H3|H4|BLOCKQUOTE|PRE|LI|DIV)$/.test(n.tagName)) n = n.parentElement;
    return n === editor ? null : n;
  }
  function applyStyle(v){
    const map = { p: "p", h1: "h1", h2: "h2", h3: "h3", h4: "h4" };
    if(map[v]){ exec("formatBlock", "<" + map[v] + ">"); return; }
    exec("formatBlock", "<p>");
    const b = currentBlock();
    if(!b) return;
    if(v === "title") b.className = "ds-title";
    else if(v === "subtitle") b.className = "ds-subtitle";
    else if(v === "quote"){ exec("formatBlock", "<blockquote>"); const q = currentBlock(); if(q) q.classList.add("intense"); }
  }
  function insertChecklist(){
    exec("insertUnorderedList");
    const li = currentBlock();
    const list = li && li.closest ? li.closest("ul") : null;
    if(list){ list.classList.add("tasklist"); list.querySelectorAll("li").forEach(l => { if(!l.querySelector("input")) l.prepend(h("input", { type: "checkbox" })); }); }
  }

  /* underline variants */
  $("#ulMore").addEventListener("click", () => {
    N.menu($("#ulMore"), [
      { label: "Single", run: () => wrapSel("u") },
      { label: "Double", run: () => wrapSelClass("ul-double") },
      { label: "Thick", icon: null, run: () => wrapSelClass("ul-thick") },
      { label: "Dotted", run: () => wrapSelClass("ul-dot") },
      { label: "Dashed", run: () => wrapSelClass("ul-dash") },
      { label: "Wave", run: () => wrapSelClass("ul-wave") },
      "-", { label: "Underline color…", run: () => N.colorPick($("#ulMore"), { onPick: c => wrapSel("u", c ? "text-decoration-color:" + c : "") }) }
    ]);
  });
  function wrapSelClass(cls){ prep(); const sel = window.getSelection(); if(!sel.rangeCount || sel.isCollapsed) return; const r = sel.getRangeAt(0); const el = document.createElement("u"); el.className = cls; try{ r.surroundContents(el); }catch(e){ el.appendChild(r.extractContents()); r.insertNode(el); } touch(); }

  /* highlight & font color */
  function paintSwatch(id, color){ $("#" + id).style.setProperty("--c", color || "transparent"); }
  $("#hiliteBtn").addEventListener("click", () => N.colorPick($("#hiliteBtn"), { value: "#fde16b", noneLabel: "No color", onPick: c => { wrapSel("span", c ? "background:" + c : "background:transparent"); paintSwatch("hiliteC", c); } }));
  $("#colorBtn").addEventListener("click", () => N.colorPick($("#colorBtn"), { value: "#24221e", none: false, onPick: c => { wrapSel("span", "color:" + c); paintSwatch("colorC", c); } }));

  $("#caseBtn").addEventListener("click", () => N.menu($("#caseBtn"), [
    { label: "Sentence case.", run: () => caseTransform(s => s.replace(/(^\s*\w|[.!?]\s+\w)/g, m => m.toUpperCase())) },
    { label: "lowercase", run: () => caseTransform(s => s.toLowerCase()) },
    { label: "UPPERCASE", run: () => caseTransform(s => s.toUpperCase()) },
    { label: "Capitalize Each Word", run: () => caseTransform(s => s.replace(/\w\S*/g, w => w[0].toUpperCase() + w.slice(1).toLowerCase())) },
    { label: "tOGGLE cASE", run: () => caseTransform(s => [...s].map(c => c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase()).join("")) }
  ]));
  function caseTransform(fn){
    prep();
    const sel = window.getSelection(); if(!sel.rangeCount || sel.isCollapsed) return;
    const r = sel.getRangeAt(0), text = r.toString();
    r.deleteContents(); r.insertNode(document.createTextNode(fn(text)));
    sel.removeAllRanges(); touch();
  }

  $("#lineSpBtn").addEventListener("click", () => N.menu($("#lineSpBtn"), [
    { label: "Single", run: () => setLH(1.3) }, { label: "1.15", run: () => setLH(1.5) },
    { label: "1.5", run: () => setLH(1.9) }, { label: "Double", run: () => setLH(2.3) },
    "-",
    { label: "Add space before paragraph", run: () => setPSp("before", "12px") },
    { label: "Add space after paragraph", run: () => setPSp("after", "12px") },
    { label: "Remove paragraph spacing", run: () => setPSp("both", "0") }
  ]));
  function setLH(v){ prep(); const b = currentBlock(); if(b) b.style.lineHeight = v; touch(); }
  function setPSp(where, v){ prep(); const b = currentBlock(); if(!b) return; if(where !== "after") b.style.marginTop = v; if(where !== "before") b.style.marginBottom = v; touch(); }

  function syncToolbar(){
    try{
      $("#fontSize").value = Math.round((parseFloat(getComputedStyle(document.queryCommandValue ? currentBlock() || editor : editor).fontSize) || 16) / 1.333);
    }catch(e){}
    ["bold", "italic", "underline", "strikeThrough"].forEach((c, i) => {
      const ids = ["", "", "ulBtn", ""]; // bold/italic marked via rb.on using queryCommandState
    });
    [["bold", 0], ["italic", 0]].length; // noop placeholder
    try{
      document.querySelectorAll('[data-cmd="bold"]').forEach(b => b.classList.toggle("on", document.queryCommandState("bold")));
      document.querySelectorAll('[data-cmd="italic"]').forEach(b => b.classList.toggle("on", document.queryCommandState("italic")));
      document.querySelectorAll('[data-cmd="underline"]').forEach(b => b.classList.toggle("on", document.queryCommandState("underline")));
      document.querySelectorAll('[data-cmd="strike"]').forEach(b => b.classList.toggle("on", document.queryCommandState("strikeThrough")));
    }catch(e){}
    const tbl = currentBlock() && currentBlock().closest ? currentBlock().closest("table") : null;
    $("#tableTab").hidden = !tbl;
    if(!tbl && N.ribbon($("#ribbon")).current && document.querySelector('.rtab[data-p="table"]').classList.contains("on")){
      document.querySelector('.rtab[data-p="home"]').click();
    }
  }
  editor.addEventListener("keyup", syncToolbar);
  editor.addEventListener("mouseup", syncToolbar);
  document.querySelector('.rtab[data-p="table"]').addEventListener("click", function(){ if(this.hidden) return; });

  /* ---------- format painter ---------- */
  let painting = false, paintSticky = false, paintStyle = null;
  $("#paintBtn").addEventListener("dblclick", () => { paintSticky = true; grabPaint(); });
  function startPaint(){ if(painting){ painting = false; paintSticky = false; $("#paintBtn").classList.remove("on"); return; } grabPaint(); }
  function grabPaint(){
    const sel = window.getSelection(); if(!sel.rangeCount) return;
    let n = sel.anchorNode; n = n.nodeType === 3 ? n.parentElement : n;
    paintStyle = n ? getComputedStyle(n) : null;
    painting = true; $("#paintBtn").classList.add("on");
  }
  editor.addEventListener("mouseup", () => {
    if(!painting || !paintStyle) return;
    const sel = window.getSelection();
    if(sel.rangeCount && !sel.isCollapsed){
      wrapSel("span", `font-weight:${paintStyle.fontWeight};font-style:${paintStyle.fontStyle};text-decoration:${paintStyle.textDecorationLine};color:${paintStyle.color};font-family:${paintStyle.fontFamily};font-size:${paintStyle.fontSize}`);
    }
    if(!paintSticky){ painting = false; $("#paintBtn").classList.remove("on"); }
  });

  /* ---------- find & replace ---------- */
  function openFind(withReplace){
    const findI = h("input", { class: "inp", placeholder: "Find", autofocus: true });
    const repI = h("input", { class: "inp", placeholder: "Replace with" });
    const status = h("span", { style: { fontSize: "12.5px", color: "var(--muted)" } }, "");
    let marks = [], idx = -1;
    function clearMarks(){ marks.forEach(m => { const t = document.createTextNode(m.textContent); m.replaceWith(t); t.parentNode && t.parentNode.normalize && t.parentNode.normalize(); }); marks = []; }
    function run(){
      clearMarks();
      const q = findI.value; if(!q){ status.textContent = ""; return; }
      const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
      const nodes = []; let n; while((n = walker.nextNode())) nodes.push(n);
      nodes.forEach(node => {
        const text = node.nodeValue, lower = text.toLowerCase(), ql = q.toLowerCase();
        if(!lower.includes(ql)) return;
        const frag = document.createDocumentFragment(); let i = 0, p;
        while((p = lower.indexOf(ql, i)) !== -1){
          frag.append(text.slice(i, p));
          const m = h("mark", { style: { background: "#ffe08a" } }, text.slice(p, p + q.length));
          marks.push(m); frag.append(m);
          i = p + q.length;
        }
        frag.append(text.slice(i));
        node.replaceWith(frag);
      });
      status.textContent = marks.length ? marks.length + " found" : "No results";
      idx = -1;
    }
    function goTo(d){
      if(!marks.length) return;
      if(idx >= 0) marks[idx].style.background = "#ffe08a";
      idx = (idx + d + marks.length) % marks.length;
      marks[idx].style.background = "#ffb347";
      marks[idx].scrollIntoView({ block: "center", behavior: "smooth" });
    }
    findI.addEventListener("input", run);
    const body = h("div", null,
      h("div", { class: "field" }, h("span", null, "Find"), h("div", { style: { display: "flex", gap: "6px" } }, findI,
        h("button", { class: "ib", type: "button", onclick: () => goTo(-1) }, N.icEl("chevU")),
        h("button", { class: "ib", type: "button", onclick: () => goTo(1) }, N.icEl("chevD")))),
      withReplace ? h("div", { class: "field" }, h("span", null, "Replace with"), repI) : null,
      status);
    const buttons = [{ label: "Close" }];
    if(withReplace) buttons.unshift({ label: "Replace all", run: () => { if(!marks.length) run(); marks.slice().forEach(m => { m.replaceWith(document.createTextNode(repI.value)); }); marks = []; editor.normalize(); touch(); status.textContent = "Replaced."; return false; } });
    N.dialog({ title: withReplace ? "Replace" : "Find", width: 380, body, buttons, onClose: clearMarks });
  }
  $("#findBtn").addEventListener("click", () => openFind(false));
  $("#replaceBtn").addEventListener("click", () => openFind(true));
  N.keys({ "ctrl+f": () => { openFind(false); return false; }, "ctrl+h": () => { openFind(true); return false; }, "ctrl+b": () => { exec("bold"); return false; }, "ctrl+i": () => { exec("italic"); return false; }, "ctrl+u": () => { exec("underline"); return false; } }, editor);

  /* ---------- Insert tab ---------- */
  $("#insImgBtn").addEventListener("click", async () => {
    const [f] = await N.pick("image/*"); if(!f) return;
    const url = await N.readDataURL(f);
    exec("insertImage", url);
    const imgs = editor.querySelectorAll("img"); const img = imgs[imgs.length - 1];
    if(img) img.style.maxWidth = "100%";
  });
  $("#insLinkBtn").addEventListener("click", async () => {
    const sel = window.getSelection();
    const hasSel = sel.rangeCount && !sel.isCollapsed;
    const url = await N.prompt("Insert link", "https://", { label: "URL" });
    if(!url) return;
    if(hasSel) exec("createLink", url);
    else { exec("insertHTML", `<a href="${N.esc(url)}" target="_blank" rel="noopener">${N.esc(url)}</a>`); }
  });
  $("#insHrBtn").addEventListener("click", () => exec("insertHorizontalRule"));
  $("#insDateBtn").addEventListener("click", () => exec("insertText", new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })));
  $("#insShapeBtn").addEventListener("click", () => N.menu($("#insShapeBtn"), [
    { label: "Rectangle", run: () => insertShapeSvg("rect") },
    { label: "Oval", run: () => insertShapeSvg("ellipse") },
    { label: "Line", run: () => insertShapeSvg("line") },
    { label: "Arrow", run: () => insertShapeSvg("arrow") }
  ]));
  function insertShapeSvg(kind){
    const svgs = {
      rect: '<svg width="160" height="90" xmlns="http://www.w3.org/2000/svg"><rect x="3" y="3" width="154" height="84" fill="#eef2f6" stroke="#b06a73" stroke-width="2"/></svg>',
      ellipse: '<svg width="160" height="90" xmlns="http://www.w3.org/2000/svg"><ellipse cx="80" cy="45" rx="76" ry="42" fill="#eef2f6" stroke="#b06a73" stroke-width="2"/></svg>',
      line: '<svg width="160" height="40" xmlns="http://www.w3.org/2000/svg"><line x1="4" y1="20" x2="156" y2="20" stroke="#b06a73" stroke-width="2"/></svg>',
      arrow: '<svg width="160" height="40" xmlns="http://www.w3.org/2000/svg"><defs><marker id="a" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="#b06a73"/></marker></defs><line x1="4" y1="20" x2="148" y2="20" stroke="#b06a73" stroke-width="2" marker-end="url(#a)"/></svg>'
    };
    exec("insertHTML", `<img src="data:image/svg+xml;utf8,${encodeURIComponent(svgs[kind])}" style="max-width:100%">`);
  }
  $("#insTextboxBtn").addEventListener("click", () => exec("insertHTML", '<div class="textbox" contenteditable="true">Text box</div><p></p>'));
  $("#insSymbolBtn").addEventListener("click", () => {
    const syms = "© ® ™ § ¶ † ‡ • … ‰ € £ ¥ ¢ ° ± × ÷ ≈ ≠ ≤ ≥ √ ∞ Σ Ω π α β γ δ ★ ☆ ♦ ♣ ♠ ♥ ← → ↑ ↓ ⇒ ⇔ ½ ¼ ¾".split(" ");
    const grid = h("div", { style: { display: "grid", gridTemplateColumns: "repeat(10,1fr)", gap: "4px" } });
    syms.forEach(s => grid.append(h("button", { class: "btn sm", type: "button", onclick: () => { exec("insertText", s); P.close(); } }, s)));
    var P = N.dialog({ title: "Symbol", width: 420, body: grid, buttons: [{ label: "Close" }] });
  });
  $("#insEqBtn").addEventListener("click", async () => {
    const eq = await N.prompt("Insert equation", "", { label: "Enter the equation (e.g. a^2 + b^2 = c^2)" });
    if(eq) exec("insertHTML", `<span style="font-family:'Source Serif 4',serif;font-style:italic;padding:0 2px">${N.esc(eq)}</span>`);
  });
  $("#insBreakBtn").addEventListener("click", () => addPage());
  $("#insHeaderBtn").addEventListener("click", () => { pgHeader.hidden = false; pgHeader.focus(); });
  $("#insFooterBtn").addEventListener("click", () => { pgFooter.hidden = false; pgFooter.focus(); });
  $("#insPageNumBtn").addEventListener("click", () => {
    pgFooter.hidden = false;
    pgFooter.append(h("span", { class: "pgnum", contenteditable: "false", style: { color: "#888" } }, "1"));
    touch();
  });
  function addPage(html, quiet){
    const body = h("div", { class: "editor-extra editor", contenteditable: "true", spellcheck: "true" });
    body.innerHTML = typeof html === "string" && html ? html : "<p><br></p>";
    body.addEventListener("input", touch);
    const art = h("article", { class: "page" },
      h("div", { class: "pg-header", contenteditable: "true", hidden: pgHeader.hidden }),
      body,
      h("div", { class: "pg-footer", contenteditable: "true", hidden: pgFooter.hidden }));
    $("#pages").append(art);
    if(!quiet){ body.focus(); touch(); }
    applyPageMeta(); updatePageCount();
  }

  /* comments */
  function refreshComments(){
    const list = $("#cmList"); list.innerHTML = "";
    if(!comments.length){ list.append(h("div", { class: "empty" }, "No comments yet. Select text and use Insert → Comment.")); return; }
    comments.forEach(c => {
      const row = h("div", { style: { padding: "10px 12px", borderBottom: "1px solid var(--line-soft)", opacity: c.resolved ? .55 : 1 } },
        h("div", { style: { fontWeight: 600, fontSize: "13px" } }, c.author),
        h("div", { style: { fontSize: "13px", margin: "4px 0", color: "var(--muted)" } }, '"' + c.quote + '"'),
        h("div", { style: { fontSize: "13.5px" } }, c.text),
        h("div", { style: { display: "flex", gap: "6px", marginTop: "6px" } },
          h("button", { class: "btn sm", type: "button", onclick: () => { c.resolved = !c.resolved; markNode(c); refreshComments(); touch(); } }, c.resolved ? "Reopen" : "Resolve"),
          h("button", { class: "btn sm", type: "button", onclick: () => { comments = comments.filter(x => x !== c); const m = editor.querySelector('[data-cid="' + c.id + '"]'); if(m) m.replaceWith(...m.childNodes); refreshComments(); touch(); } }, "Delete")));
      list.append(row);
    });
  }
  function markNode(c){ const m = editor.querySelector('[data-cid="' + c.id + '"]'); if(m) m.classList.toggle("resolved", !!c.resolved); }
  $("#insCommentBtn").addEventListener("click", addComment);
  $("#newCommentBtn").addEventListener("click", addComment);
  async function addComment(){
    const sel = window.getSelection();
    if(!sel.rangeCount || sel.isCollapsed){ N.toast("Select some text first."); return; }
    const quote = sel.toString().slice(0, 80);
    const text = await N.prompt("Add comment", "", { label: "Comment" });
    if(text == null) return;
    const id = N.uid();
    wrapSel("span", "");
    const span = editor.querySelector("span:not([data-cid])") || null;
    // find the just-wrapped span via selection fallback
    const r2 = window.getSelection();
    let target = r2.anchorNode && r2.anchorNode.nodeType === 1 ? r2.anchorNode : (r2.anchorNode && r2.anchorNode.parentElement);
    if(target && target.tagName === "SPAN"){ target.dataset.cid = id; target.classList.add("comment-mark"); }
    comments.push({ id, text, quote, author: "You", resolved: false });
    refreshComments(); $("#cmSide").hidden = false; touch();
  }
  editor.addEventListener("click", e => { const m = e.target.closest(".comment-mark"); if(m){ $("#cmSide").hidden = false; } });
  $("#commentsBtn").addEventListener("click", () => { $("#cmSide").hidden = !$("#cmSide").hidden; });
  $("#cmClose").addEventListener("click", () => $("#cmSide").hidden = true);

  /* footnotes */
  $("#footnoteBtn").addEventListener("click", async () => {
    const text = await N.prompt("Insert footnote", "", { label: "Footnote text" });
    if(!text) return;
    const n = footnotes.length + 1;
    footnotes.push({ n, text });
    exec("insertHTML", `<sup class="fn-ref" data-fn="${n}">${n}</sup>`);
    renderFootnotes();
  });
  function renderFootnotes(){
    let list = editor.querySelector(".fn-list");
    if(!list){ list = h("div", { class: "fn-list", contenteditable: "false" }); editor.append(list); }
    list.innerHTML = "";
    footnotes.forEach(f => list.append(h("div", null, f.n + ". " + f.text)));
  }

  /* citations (lightweight) */
  const sources = [];
  $("#citeBtn").addEventListener("click", async () => {
    const opts = sources.length ? sources.map((s, i) => `${i}: ${s}`).join("\n") : "";
    const which = await N.prompt("Insert citation", "", { label: "Author, Year (type a new source, or pick one already used: " + (sources.join(" · ") || "none yet") + ")" });
    if(!which) return;
    if(!sources.includes(which)) sources.push(which);
    exec("insertHTML", ` <span style="color:#b06a73">(${N.esc(which)})</span>`);
  });
  $("#captionBtn").addEventListener("click", async () => {
    const t = await N.prompt("Insert caption", "Figure " + (editor.querySelectorAll(".caption").length + 1), { label: "Caption text" });
    if(t) exec("insertHTML", `<div class="caption">${N.esc(t)}</div>`);
  });

  /* TOC */
  $("#tocBtn").addEventListener("click", () => { insertToc(); touch(); });
  $("#tocUpdateBtn").addEventListener("click", () => { updateToc(); touch(); });
  function headings(){ return [...editor.querySelectorAll("h1,h2,h3,h4")].filter(e => !e.closest(".toc-block")); }
  function insertToc(){
    headings().forEach((hd, i) => { if(!hd.id) hd.id = "h-" + i + "-" + N.uid(); });
    const block = h("div", { class: "toc-block", contenteditable: "false" }, h("div", { class: "toc-h" }, "Contents"));
    headings().forEach(hd => block.append(h("a", { href: "#" + hd.id, style: { paddingLeft: ({ H1: "0", H2: "14px", H3: "28px", H4: "42px" })[hd.tagName] } }, hd.textContent || "Untitled heading")));
    editor.prepend(block);
  }
  function updateToc(){ const old = editor.querySelector(".toc-block"); if(old) old.remove(); insertToc(); }

  /* ---------- table ---------- */
  $("#insTableBtn").addEventListener("click", () => {
    const grid = h("div", { style: { display: "grid", gridTemplateColumns: "repeat(10,20px)", gap: "3px" } });
    const cells = [];
    for(let r = 0; r < 8; r++) for(let c = 0; c < 10; c++){
      const cell = h("button", { type: "button", style: { width: "20px", height: "20px", border: "1px solid var(--line)", background: "var(--surface)" } });
      cell.dataset.r = r; cell.dataset.c = c; cells.push(cell); grid.append(cell);
    }
    const label = h("div", { style: { fontSize: "12.5px", color: "var(--muted)", marginTop: "6px" } }, "Table");
    grid.addEventListener("mouseover", e => { const b = e.target.closest("button"); if(!b) return; const R = +b.dataset.r, C = +b.dataset.c; cells.forEach(c => c.style.background = (+c.dataset.r <= R && +c.dataset.c <= C) ? "var(--app)" : "var(--surface)"); label.textContent = (C + 1) + " × " + (R + 1) + " Table"; });
    grid.addEventListener("click", e => { const b = e.target.closest("button"); if(!b) return; insertTable(+b.dataset.r + 1, +b.dataset.c + 1); P.close(); });
    var P = N.pop($("#insTableBtn"), h("div", null, grid, label));
  });
  function insertTable(rows, cols){
    let html = "<table>";
    for(let r = 0; r < rows; r++){ html += "<tr>"; for(let c = 0; c < cols; c++) html += "<td>&nbsp;</td>"; html += "</tr>"; }
    html += "</table><p></p>";
    exec("insertHTML", html);
  }
  function activeTable(){ const b = currentBlock(); return b && b.closest ? b.closest("table") : null; }
  function activeCell(){ const sel = window.getSelection(); if(!sel.rangeCount) return null; let n = sel.anchorNode; n = n.nodeType === 3 ? n.parentElement : n; return n && n.closest ? n.closest("td,th") : null; }
  const TABLE_CMDS = {
    "tbl-rowabove": () => tblRow(0), "tbl-rowbelow": () => tblRow(1),
    "tbl-colleft": () => tblCol(0), "tbl-colright": () => tblCol(1),
    "tbl-delrow": () => { const c = activeCell(); if(c) c.closest("tr").remove(); touch(); },
    "tbl-delcol": () => { const c = activeCell(); const t = activeTable(); if(!c || !t) return; const i = [...c.parentElement.children].indexOf(c); t.querySelectorAll("tr").forEach(tr => { if(tr.children[i]) tr.children[i].remove(); }); touch(); },
    "tbl-del": () => { const t = activeTable(); if(t) t.remove(); touch(); },
    "tbl-merge": () => N.toast("Select adjacent cells, then use Merge — drag-select merge isn't available yet; try deleting a cell's border instead.")
  };
  function tblRow(after){
    const c = activeCell(), tr = c && c.closest("tr"); if(!tr) return;
    const n = tr.children.length, nt = h("tr"); for(let i = 0; i < n; i++) nt.append(h("td", null, "\u00a0"));
    tr.insertAdjacentElement(after ? "afterend" : "beforebegin", nt); touch();
  }
  function tblCol(after){
    const c = activeCell(), t = activeTable(); if(!c || !t) return;
    const i = [...c.parentElement.children].indexOf(c);
    t.querySelectorAll("tr").forEach(tr => { const cell = h("td", null, "\u00a0"); const ref = tr.children[i]; if(ref) ref.insertAdjacentElement(after ? "afterend" : "beforebegin", cell); });
    touch();
  }
  Object.assign(CMDS, TABLE_CMDS);
  $("#tblShadeBtn").addEventListener("click", () => N.colorPick($("#tblShadeBtn"), { onPick: c => { const cell = activeCell(); if(cell) cell.style.background = c || ""; touch(); } }));
  $("#tblBorderBtn").addEventListener("click", () => N.menu($("#tblBorderBtn"), [
    { label: "All borders", run: () => setTblBorder("1px solid #999") },
    { label: "No borders", run: () => setTblBorder("none") }
  ]));
  function setTblBorder(v){ const t = activeTable(); if(!t) return; t.querySelectorAll("td,th").forEach(c => c.style.border = v); touch(); }

  /* ---------- layout ---------- */
  const PAGE_SIZES = { letter: { w: 816, h: 1056 }, legal: { w: 816, h: 1344 }, a4: { w: 794, h: 1123 }, a3: { w: 1123, h: 1587 } };
  function applyPageMeta(){
    const sz = PAGE_SIZES[pageMeta.size] || PAGE_SIZES.letter;
    const w = pageMeta.orient === "landscape" ? sz.h : sz.w;
    const hgt = pageMeta.orient === "landscape" ? sz.w : sz.h;
    document.querySelectorAll(".page").forEach(p => { p.style.width = w + "px"; p.style.minHeight = hgt + "px"; });
    $("#pages").style.width = w + "px"; $("#hRuler").style.width = w + "px";
    const pad = { normal: "60px 76px", narrow: "36px 36px", moderate: "60px 48px", wide: "60px 108px" }[pageMeta.margin] || "60px 76px";
    editor.style.padding = pad;
    document.querySelectorAll(".editor-extra").forEach(e => e.style.padding = pad);
    editor.style.columnCount = pageMeta.cols > 1 ? pageMeta.cols : "";
    editor.style.columnGap = "32px";
    document.querySelectorAll(".page").forEach(p => { p.style.background = pageMeta.watermark || pageMeta.pageColor ? p.style.background : "" ; if(pageMeta.pageColor) p.style.background = pageMeta.pageColor; });
    buildRuler(w);
  }
  function buildRuler(w){
    const r = $("#hRuler"); r.innerHTML = "";
    const inch = w / (pageMeta.orient === "landscape" ? (PAGE_SIZES[pageMeta.size].h / 8.5) : 8.5) * (816 / 816);
    const perIn = w / ((pageMeta.orient === "landscape" ? PAGE_SIZES[pageMeta.size].h : PAGE_SIZES[pageMeta.size].w) / 96);
    for(let i = 0; i * perIn < w; i++) r.append(h("span", { class: "mk", style: { left: (i * perIn) + "px" } }, String(i)));
  }
  $("#marginsBtn").addEventListener("click", () => N.menu($("#marginsBtn"), [
    { label: "Normal", run: () => { pageMeta.margin = "normal"; applyPageMeta(); touch(); } },
    { label: "Narrow", run: () => { pageMeta.margin = "narrow"; applyPageMeta(); touch(); } },
    { label: "Moderate", run: () => { pageMeta.margin = "moderate"; applyPageMeta(); touch(); } },
    { label: "Wide", run: () => { pageMeta.margin = "wide"; applyPageMeta(); touch(); } }
  ]));
  $("#orientBtn").addEventListener("click", () => N.menu($("#orientBtn"), [
    { label: "Portrait", run: () => { pageMeta.orient = "portrait"; applyPageMeta(); touch(); } },
    { label: "Landscape", run: () => { pageMeta.orient = "landscape"; applyPageMeta(); touch(); } }
  ]));
  $("#sizeBtn").addEventListener("click", () => N.menu($("#sizeBtn"), [
    { label: "Letter", run: () => { pageMeta.size = "letter"; applyPageMeta(); touch(); } },
    { label: "Legal", run: () => { pageMeta.size = "legal"; applyPageMeta(); touch(); } },
    { label: "A4", run: () => { pageMeta.size = "a4"; applyPageMeta(); touch(); } },
    { label: "A3", run: () => { pageMeta.size = "a3"; applyPageMeta(); touch(); } }
  ]));
  $("#colsBtn").addEventListener("click", () => N.menu($("#colsBtn"), [
    { label: "One", run: () => { pageMeta.cols = 1; applyPageMeta(); touch(); } },
    { label: "Two", run: () => { pageMeta.cols = 2; applyPageMeta(); touch(); } },
    { label: "Three", run: () => { pageMeta.cols = 3; applyPageMeta(); touch(); } }
  ]));
  $("#watermarkBtn").addEventListener("click", async () => {
    const t = await N.prompt("Watermark text", pageMeta.watermark ? "" : "DRAFT", { label: "Leave blank to remove" });
    if(t == null) return;
    document.querySelectorAll(".page").forEach(p => {
      let wm = p.querySelector(".wm-overlay");
      if(!t){ if(wm) wm.remove(); return; }
      if(!wm){ wm = h("div", { class: "wm-overlay", style: { position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none", fontSize: "72px", color: "rgba(0,0,0,.08)", fontWeight: 800, transform: "rotate(-30deg)", zIndex: 0 } }); p.prepend(wm); }
      wm.textContent = t;
    });
    pageMeta.watermark = t || null; touch();
  });
  $("#pageColorBtn").addEventListener("click", () => N.colorPick($("#pageColorBtn"), { onPick: c => { pageMeta.pageColor = c; applyPageMeta(); touch(); } }));

  /* ---------- view ---------- */
  function setView(v){
    document.body.classList.remove("view-read", "view-outline");
    if(v === "read") document.body.classList.add("view-read");
    if(v === "outline"){ buildOutline(); $("#navSide").hidden = false; }
  }
  function buildOutline(){
    const list = $("#navList"); list.innerHTML = "";
    headings().forEach(hd => {
      if(!hd.id) hd.id = "h-" + N.uid();
      const lv = +hd.tagName[1];
      list.append(h("a", { href: "#" + hd.id, style: { display: "block", padding: "6px 8px", paddingLeft: (10 + (lv - 1) * 14) + "px", fontSize: lv <= 2 ? "13.5px" : "13px", fontWeight: lv === 1 ? 650 : 500, color: "var(--ink)", textDecoration: "none", borderRadius: "5px" } }, hd.textContent || "Untitled"));
    });
  }
  $("#navClose").addEventListener("click", () => $("#navSide").hidden = true);
  $("#rulerChk").addEventListener("change", e => document.body.classList.toggle("show-ruler", e.target.checked));
  if(!N.isPhone()){ document.body.classList.add("show-ruler"); $("#rulerChk").checked = true; }
  else { $("#rulerChk").checked = false; }
  $("#marksChk").addEventListener("change", e => editor.classList.toggle("marks", e.target.checked));

  /* zoom — #pages stays native size and is visually scaled; #pagesOuter is given the
     resulting scaled box size so it participates correctly in centering and scrolling. */
  const zr = $("#zoomRange"), pagesEl = $("#pages"), pagesOuter = $("#pagesOuter");
  function applyZoom(){
    if(N.isPhone()){ pagesEl.style.transform = ""; pagesOuter.style.width = ""; pagesOuter.style.height = ""; return; }
    const z = zr.value / 100;
    pagesEl.style.transform = "scale(" + z + ")";
    pagesOuter.style.width = (pagesEl.scrollWidth * z) + "px";
    pagesOuter.style.height = (pagesEl.scrollHeight * z) + "px";
    $("#zoomLabel").textContent = zr.value + "%";
  }
  zr.addEventListener("input", applyZoom);
  $("#zoomIn").addEventListener("click", () => { zr.value = Math.min(200, +zr.value + 10); applyZoom(); });
  $("#zoomOut").addEventListener("click", () => { zr.value = Math.max(30, +zr.value - 10); applyZoom(); });
  new ResizeObserver(applyZoom).observe(pagesEl);

  /* track changes (lightweight: marks insertions, strikes deletions) */
  $("#trackChk").addEventListener("change", e => { trackOn = e.target.checked; });
  $("#acceptBtn").addEventListener("click", () => { editor.querySelectorAll(".ins-mark").forEach(m => m.replaceWith(...m.childNodes)); editor.querySelectorAll(".del-mark").forEach(m => m.remove()); touch(); });
  $("#rejectBtn").addEventListener("click", () => { editor.querySelectorAll(".del-mark").forEach(m => m.replaceWith(...m.childNodes)); editor.querySelectorAll(".ins-mark").forEach(m => m.remove()); touch(); });

  /* word count / spelling */
  function updateCounts(){
    const text = editor.innerText.trim();
    const words = text ? text.split(/\s+/).length : 0;
    $("#wordCount").textContent = words + (words === 1 ? " word" : " words");
    updatePageCount();
  }
  function updatePageCount(){ const n = document.querySelectorAll(".page").length; $("#pageCount").textContent = "Page 1 of " + n; }
  $("#wcBtn").addEventListener("click", () => {
    const text = editor.innerText;
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    const chars = text.replace(/\s/g, "").length;
    const charsSp = text.length;
    const paras = editor.querySelectorAll("p,h1,h2,h3,h4,li").length;
    N.alert(`Words: ${words}\nCharacters (no spaces): ${chars}\nCharacters (with spaces): ${charsSp}\nParagraphs: ${paras}\nPages: ${document.querySelectorAll(".page").length}`, "Word count");
  });
  $("#spellBtn").addEventListener("click", () => { editor.spellcheck = true; N.toast("Spell-check uses your browser's built-in checker — red underlines mark possible issues; right-click a word for suggestions."); });

  /* ---------- open / import ---------- */
  function newDoc(){
    editor.innerHTML = "<p><br></p>"; pgHeader.innerHTML = ""; pgFooter.innerHTML = ""; pgHeader.hidden = true; pgFooter.hidden = true;
    titleIn.value = "Untitled document"; comments = []; footnotes = []; refreshComments();
    document.querySelectorAll(".page ~ .page").forEach(p => p.remove());
    S.fresh();
  }
  async function importFile(file){
    const ext = file.name.split(".").pop().toLowerCase();
    try{
      if(ext === "docx"){
        editor.innerHTML = await docxToHtml(file) || "<p><br></p>";
      }else if(ext === "md" || ext === "markdown"){
        editor.innerHTML = mdToHtml(await file.text());
      }else if(ext === "html" || ext === "htm"){
        const txt = await file.text();
        const doc = new DOMParser().parseFromString(txt, "text/html");
        editor.innerHTML = doc.body ? doc.body.innerHTML : txt;
      }else{
        editor.innerHTML = "<p>" + N.esc(await file.text()).replace(/\n/g, "</p><p>") + "</p>";
      }
      titleIn.value = file.name.replace(/\.[^.]+$/, "");
      touch(); N.toast("Opened " + file.name);
    }catch(err){ console.error(err); N.alert("Couldn't open that file. It may be corrupted or in an unsupported format."); }
  }
  /* Minimal .docx reader: unzips word/document.xml and converts paragraphs/runs/
     basic formatting + numbering to HTML. Covers the common case; complex layouts
     (floating objects, nested tables-in-tables) may simplify on import. */
  async function docxToHtml(file){
    const JSZip = await N.lib("jszip");
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const xmlText = await zip.file("word/document.xml").async("text");
    const doc = new DOMParser().parseFromString(xmlText, "application/xml");
    const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    const g = (el, tag) => [...el.getElementsByTagNameNS(W, tag)];
    const body = doc.getElementsByTagNameNS(W, "body")[0];
    if(!body) return "";
    let mediaCache = {};
    try{
      const relsXml = await zip.file("word/_rels/document.xml.rels").async("text");
      const rdoc = new DOMParser().parseFromString(relsXml, "application/xml");
      for(const r of [...rdoc.getElementsByTagName("Relationship")]){
        const id = r.getAttribute("Id"), target = r.getAttribute("Target");
        if(target && /media\//.test(target)){
          const f = zip.file("word/" + target.replace(/^\//, ""));
          if(f){ const b64 = await f.async("base64"); const ex = (target.split(".").pop() || "png").toLowerCase(); mediaCache[id] = "data:image/" + (ex === "jpg" ? "jpeg" : ex) + ";base64," + b64; }
        }
      }
    }catch(e){}
    let html = "";
    for(const p of [...body.childNodes]){
      if(p.nodeType !== 1) continue;
      if(p.localName === "tbl"){ html += tableXml(p); continue; }
      if(p.localName !== "p") continue;
      const pStyle = (p.getElementsByTagNameNS(W, "pStyle")[0] || {}).getAttribute ? p.getElementsByTagNameNS(W, "pStyle")[0].getAttribute("w:val") : null;
      const numPr = p.getElementsByTagNameNS(W, "numPr")[0];
      let inner = "";
      for(const r of g(p, "r")){
        const t = g(r, "t").map(n => n.textContent).join("");
        const drawing = r.getElementsByTagNameNS(W, "drawing")[0];
        if(drawing){
          const blip = drawing.getElementsByTagName("a:blip")[0];
          const rid = blip && blip.getAttribute("r:embed");
          if(rid && mediaCache[rid]) inner += `<img src="${mediaCache[rid]}" style="max-width:100%">`;
          continue;
        }
        if(!t) continue;
        let seg = N.esc(t);
        const rpr = r.getElementsByTagNameNS(W, "rPr")[0];
        if(rpr){
          if(rpr.getElementsByTagNameNS(W, "b").length) seg = "<b>" + seg + "</b>";
          if(rpr.getElementsByTagNameNS(W, "i").length) seg = "<i>" + seg + "</i>";
          if(rpr.getElementsByTagNameNS(W, "u").length) seg = "<u>" + seg + "</u>";
          if(rpr.getElementsByTagNameNS(W, "strike").length) seg = "<s>" + seg + "</s>";
        }
        inner += seg;
      }
      if(!inner.trim()){ html += "<p><br></p>"; continue; }
      if(/Heading1|Title/.test(pStyle || "")) html += "<h1>" + inner + "</h1>";
      else if(/Heading2/.test(pStyle || "")) html += "<h2>" + inner + "</h2>";
      else if(/Heading3/.test(pStyle || "")) html += "<h3>" + inner + "</h3>";
      else if(/Heading/.test(pStyle || "")) html += "<h4>" + inner + "</h4>";
      else if(numPr) html += "<li>" + inner + "</li>";
      else html += "<p>" + inner + "</p>";
    }
    html = html.replace(/(<li>.*?<\/li>\s*)+/gs, m => "<ul>" + m + "</ul>");
    function tableXml(tbl){
      let t = "<table>";
      for(const tr of g(tbl, "tr")){
        t += "<tr>";
        for(const tc of g(tr, "tc")){
          const txt = g(tc, "t").map(n => n.textContent).join(" ");
          t += "<td>" + (N.esc(txt) || "&nbsp;") + "</td>";
        }
        t += "</tr>";
      }
      return t + "</table>";
    }
    return html;
  }
  function mdToHtml(src){
    let s = N.esc(src);
    s = s.replace(/^###### (.*)$/gm, "<h4>$1</h4>").replace(/^##### (.*)$/gm, "<h4>$1</h4>")
      .replace(/^#### (.*)$/gm, "<h4>$1</h4>").replace(/^### (.*)$/gm, "<h3>$1</h3>")
      .replace(/^## (.*)$/gm, "<h2>$1</h2>").replace(/^# (.*)$/gm, "<h1>$1</h1>")
      .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\*(.+?)\*/g, "<i>$1</i>")
      .replace(/`(.+?)`/g, "<code>$1</code>")
      .replace(/^> (.*)$/gm, "<blockquote>$1</blockquote>")
      .replace(/^- (.*)$/gm, "<li>$1</li>");
    s = s.replace(/(<li>.*<\/li>\n?)+/g, m => "<ul>" + m + "</ul>");
    return s.split(/\n{2,}/).map(p => /^<(h\d|ul|blockquote)/.test(p.trim()) ? p : "<p>" + p.replace(/\n/g, "<br>") + "</p>").join("\n");
  }
  function htmlToMd(root){
    let out = "";
    root.childNodes.forEach(n => {
      if(n.nodeType === 3){ out += n.textContent; return; }
      const t = n.tagName;
      if(/^H[1-4]$/.test(t)) out += "#".repeat(+t[1]) + " " + inlineMd(n) + "\n\n";
      else if(t === "P") out += inlineMd(n) + "\n\n";
      else if(t === "UL") n.querySelectorAll(":scope>li").forEach(li => out += "- " + inlineMd(li) + "\n");
      else if(t === "OL") [...n.querySelectorAll(":scope>li")].forEach((li, i) => out += (i + 1) + ". " + inlineMd(li) + "\n");
      else if(t === "BLOCKQUOTE") out += "> " + n.textContent + "\n\n";
      else if(t === "PRE") out += "```\n" + n.textContent + "\n```\n\n";
      else out += n.textContent + "\n";
    });
    return out.trim() + "\n";
  }
  function inlineMd(n){
    let s = "";
    n.childNodes.forEach(c => {
      if(c.nodeType === 3) s += c.textContent;
      else if(c.tagName === "B" || c.tagName === "STRONG") s += "**" + c.textContent + "**";
      else if(c.tagName === "I" || c.tagName === "EM") s += "*" + c.textContent + "*";
      else if(c.tagName === "A") s += "[" + c.textContent + "](" + (c.getAttribute("href") || "") + ")";
      else if(c.tagName === "CODE") s += "`" + c.textContent + "`";
      else if(c.tagName === "BR") s += "  \n";
      else s += c.textContent;
    });
    return s;
  }

  /* ---------- export ---------- */
  async function exportDocx(){
    try{
      const docx = await N.lib("docx");
      const children = [];
      for(const root of document.querySelectorAll(".page .editor")){
        for(const el of root.children){
          if(el.classList && (el.classList.contains("toc-block") || el.classList.contains("fn-list"))) continue;
          children.push(...await blockToDocx(docx, el));
        }
      }
      if(footnotes.length){
        children.push(new docx.Paragraph({ text: "Notes", heading: docx.HeadingLevel.HEADING_3 }));
        footnotes.forEach(f => children.push(new docx.Paragraph(f.n + ". " + f.text)));
      }
      const doc = new docx.Document({
        numbering: { config: [{ reference: "num", levels: [{ level: 0, format: docx.LevelFormat.DECIMAL, text: "%1.", alignment: docx.AlignmentType.START }] }] },
        sections: [{ children: children.length ? children : [new docx.Paragraph("")] }]
      });
      N.download(await docx.Packer.toBlob(doc), fileBase() + ".docx");
    }catch(e){ console.error(e); N.alert("Couldn't build the Word file: " + e.message); }
  }
  function dataUrlInfo(src){
    const m = /^data:image\/(png|jpe?g|gif|bmp);base64,/i.exec(src); if(!m) return null;
    return { type: m[1].toLowerCase().replace("jpeg", "jpg"), bytes: N.dataURLtoBytes(src) };
  }
  async function runsOf(docx, node, fmt, out){
    out = out || [];
    for(const c of node.childNodes){
      if(c.nodeType === 3){ if(c.textContent) out.push(new docx.TextRun({ text: c.textContent.replace(/\u200b/g, ""), bold: fmt.b, italics: fmt.i, underline: fmt.u ? {} : undefined, strike: fmt.s, subScript: fmt.sub, superScript: fmt.sup })); continue; }
      if(c.nodeType !== 1) continue;
      const t = c.tagName;
      if(t === "BR"){ out.push(new docx.TextRun({ break: 1 })); continue; }
      if(t === "IMG"){
        const info = dataUrlInfo(c.getAttribute("src") || "");
        if(info){ const w = Math.min(c.naturalWidth || c.width || 300, 560), r = (c.naturalHeight || c.height || 200) / (c.naturalWidth || c.width || 300); out.push(new docx.ImageRun({ type: info.type, data: info.bytes, transformation: { width: Math.round(w), height: Math.round(w * r) } })); }
        continue;
      }
      if(t === "INPUT"){ out.push(new docx.TextRun(c.checked ? "☑ " : "☐ ")); continue; }
      const f = Object.assign({}, fmt);
      if(t === "B" || t === "STRONG") f.b = true;
      if(t === "I" || t === "EM") f.i = true;
      if(t === "U") f.u = true;
      if(t === "S" || t === "STRIKE" || t === "DEL") f.s = true;
      if(t === "SUB") f.sub = true; if(t === "SUP") f.sup = true;
      const st = c.style;
      if(st && +st.fontWeight >= 600) f.b = true;
      if(st && st.fontStyle === "italic") f.i = true;
      if(t === "A" && /^https?:/i.test(c.getAttribute("href") || "")){
        out.push(new docx.ExternalHyperlink({ link: c.getAttribute("href"), children: [new docx.TextRun({ text: c.textContent, style: "Hyperlink", underline: {}, color: "1155CC" })] }));
        continue;
      }
      await runsOf(docx, c, f, out);
    }
    return out;
  }
  async function blockToDocx(docx, el){
    const t = el.tagName, H = docx.HeadingLevel;
    const para = async (opts) => new docx.Paragraph(Object.assign({ children: await runsOf(docx, el, {}) }, opts || {}));
    /* browsers can leave a list/table nested inside a <p>; flatten those so they export as real lists/tables */
    if((t === "P" || t === "DIV") && el.querySelector(":scope>ul,:scope>ol,:scope>table")){
      const out = []; let buf = document.createElement("div");
      const flush = async () => { if(buf.textContent.trim() || buf.querySelector("img")){ out.push(new docx.Paragraph({ children: await runsOf(docx, buf, {}) })); } buf = document.createElement("div"); };
      for(const c of [...el.childNodes]){
        if(c.nodeType === 1 && /^(UL|OL|TABLE)$/.test(c.tagName)){ await flush(); out.push(...await blockToDocx(docx, c)); }
        else buf.append(c.cloneNode(true));
      }
      await flush(); return out;
    }
    const align = { center: docx.AlignmentType.CENTER, right: docx.AlignmentType.RIGHT, justify: docx.AlignmentType.JUSTIFIED }[el.style && el.style.textAlign];
    if(t === "H1") return [await para({ heading: H.HEADING_1 })];
    if(t === "H2") return [await para({ heading: H.HEADING_2 })];
    if(t === "H3") return [await para({ heading: H.HEADING_3 })];
    if(t === "H4") return [await para({ heading: H.HEADING_4 })];
    if(t === "UL" || t === "OL"){
      const out = [];
      for(const li of el.querySelectorAll(":scope>li")){
        const lvl = li.parentElement === el ? 0 : 1;
        const p = new docx.Paragraph({ children: await runsOf(docx, li, {}), ...(t === "OL" ? { numbering: { reference: "num", level: lvl } } : { bullet: { level: lvl } }) });
        out.push(p);
      }
      return out;
    }
    if(t === "BLOCKQUOTE") return [await para({ indent: { left: 500 }, alignment: align })];
    if(t === "PRE") return [new docx.Paragraph({ children: [new docx.TextRun({ text: el.textContent, font: "Courier New" })] })];
    if(t === "HR") return [new docx.Paragraph({ border: { bottom: { style: docx.BorderStyle.SINGLE, size: 6, color: "999999", space: 1 } } })];
    if(t === "TABLE") return [await docxTable(docx, el)];
    return [await para({ alignment: align })];
  }
  async function docxTable(docx, table){
    const rows = [];
    for(const tr of table.querySelectorAll("tr")){
      const cells = [];
      for(const td of tr.children) cells.push(new docx.TableCell({ children: [new docx.Paragraph({ children: await runsOf(docx, td, {}) })] }));
      rows.push(new docx.TableRow({ children: cells }));
    }
    return new docx.Table({ rows });
  }
  function fileBase(){ return (titleIn.value || "document").trim() || "document"; }

  function saveAs(kind){
    if(kind === "docx") return exportDocx();
    if(kind === "html"){
      const full = `<!doctype html><html><head><meta charset="utf-8"><title>${N.esc(titleIn.value)}</title></head><body>${editor.innerHTML}</body></html>`;
      N.download(full, fileBase() + ".html", "text/html;charset=utf-8"); return;
    }
    if(kind === "md"){ N.download(htmlToMd(editor), fileBase() + ".md", "text/markdown;charset=utf-8"); return; }
    if(kind === "txt"){ N.download(editor.innerText, fileBase() + ".txt", "text/plain;charset=utf-8"); return; }
  }

  /* ---------- file menu ---------- */
  $("#fileMenuBtn").addEventListener("click", () => N.menu($("#fileMenuBtn"), [
    { icon: "newfile", label: "New document", run: () => newDoc() },
    { icon: "open", label: "Open…", kbd: "", run: async () => { const [f] = await N.pick(".docx,.html,.htm,.md,.markdown,.txt"); if(f) importFile(f); } },
    { icon: "files", label: "Saved on this device", run: () => S.library() },
    "-",
    { icon: "filedown", label: "Save as Word (.docx)", run: () => saveAs("docx") },
    { icon: "filedown", label: "Save as Markdown (.md)", run: () => saveAs("md") },
    { icon: "filedown", label: "Save as Web page (.html)", run: () => saveAs("html") },
    { icon: "filedown", label: "Save as plain text (.txt)", run: () => saveAs("txt") },
    "-",
    { icon: "print", label: "Print / Save as PDF", kbd: "Ctrl+P", run: () => print() },
    "-",
    { icon: "info", label: "Document properties", run: showProps }
  ]));
  $("#shareBtn").addEventListener("click", () => N.menu($("#shareBtn"), [
    { icon: "filedown", label: "Word (.docx)", run: () => saveAs("docx") },
    { icon: "filedown", label: "PDF (via print dialog)", run: () => print() },
    { icon: "filedown", label: "Markdown (.md)", run: () => saveAs("md") },
    { icon: "filedown", label: "Web page (.html)", run: () => saveAs("html") },
    { icon: "filedown", label: "Plain text (.txt)", run: () => saveAs("txt") }
  ], { align: "right" }));
  async function showProps(){
    const author = await N.prompt("Document properties", localStorage.getItem("nyx-author") || "", { label: "Author name" });
    if(author != null) localStorage.setItem("nyx-author", author);
  }
  N.keys({ "ctrl+p": () => { print(); return false; }, "ctrl+s": () => { S.flush(); N.toast("Saved."); return false; } });
  function print(){ window.print(); }

  /* ---------- open input fallback (unused but kept for direct file input) ---------- */
  $("#openInput").addEventListener("change", e => { const f = e.target.files[0]; if(f) importFile(f); e.target.value = ""; });

  /* ---------- drag/drop ---------- */
  N.dropFiles($("#workspace"), files => { const f = files[0]; if(f && /docx|html?|md|markdown|txt$/i.test(f.name)) importFile(f); });

  /* ---------- autosave session ---------- */
  const S = N.session({
    app: "inkwell",
    getTitle: () => titleIn.value || "Untitled document",
    getData: async () => ({
      title: titleIn.value, header: pgHeader.innerHTML, headerOn: !pgHeader.hidden,
      footer: pgFooter.innerHTML, footerOn: !pgFooter.hidden, body: editor.innerHTML,
      comments, footnotes, pageMeta,
      extra: [...document.querySelectorAll(".editor-extra")].map(e => e.innerHTML)
    }),
    setData: (d) => {
      titleIn.value = d.title || "Untitled document";
      editor.innerHTML = d.body || "<p><br></p>";
      pgHeader.innerHTML = d.header || ""; pgHeader.hidden = !d.headerOn;
      pgFooter.innerHTML = d.footer || ""; pgFooter.hidden = !d.footerOn;
      comments = d.comments || []; footnotes = d.footnotes || [];
      pageMeta = Object.assign(pageMeta, d.pageMeta || {});
      document.querySelectorAll(".page ~ .page").forEach(p => p.remove());
      (d.extra || []).forEach(html => addPage(html, true));
      refreshComments(); applyPageMeta();
    }
  });
  function touch(){ S.touch(); updateCounts(); }
  editor.addEventListener("input", touch);
  pgHeader.addEventListener("input", touch);
  pgFooter.addEventListener("input", touch);
  titleIn.addEventListener("input", () => S.touch());

  (async function init(){
    const handed = await S.takeHandoff();
    if(handed){ await importFile(handed); S.touch(); }
    else { const had = await S.load(); if(!had) editor.innerHTML = "<p><br></p>"; }
    applyPageMeta(); updateCounts(); refreshComments();
    applyZoom();
  })();
})();
