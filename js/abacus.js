/* Nyxdesk Grid — spreadsheet */
(function(){
  "use strict";
  const N = window.Nyx, h = N.h, $ = s => document.querySelector(s);
  const ROWS = 100, COLS = 26;
  const colLetter = c => { let s = ""; c++; while(c){ c--; s = String.fromCharCode(65 + c % 26) + s; c = Math.floor(c / 26); } return s; };
  const ref = (r, c) => colLetter(c) + (r + 1);
  const parseRef = s => { const m = /^\$?([A-Z]+)\$?(\d+)$/i.exec(s); if(!m) return null; let c = 0; for(const ch of m[1].toUpperCase()) c = c * 26 + (ch.charCodeAt(0) - 64); return { r: +m[2] - 1, c: c - 1 }; };

  /* ---------- workbook state ---------- */
  let wb = { sheets: [newSheet("Sheet1")], active: 0 };
  function newSheet(name){ return { name, cells: {}, colW: {}, rowH: {}, merges: [], freeze: { r: 0, c: 0 }, filterOn: false, charts: [], notes: {} }; }
  const sheet = () => wb.sheets[wb.active];
  const key = (r, c) => r + ":" + c;
  function cell(r, c, create){ const s = sheet(); let v = s.cells[key(r, c)]; if(!v && create){ v = {}; s.cells[key(r, c)] = v; } return v; }
  function cellDisp(r, c){ const cl = cell(r, c); return cl ? (cl.v == null ? "" : cl.v) : ""; }

  /* ---------- formula engine ---------- */
  const FUNCS = {
    SUM: a => flat(a).reduce((s, v) => s + (num(v) || 0), 0),
    AVERAGE: a => { const n = flat(a).filter(v => v !== "" && v != null).map(num).filter(v => !isNaN(v)); return n.length ? n.reduce((s, v) => s + v, 0) / n.length : 0; },
    COUNT: a => flat(a).filter(v => typeof v === "number" || (!isNaN(parseFloat(v)) && v !== "" && v != null)).length,
    COUNTA: a => flat(a).filter(v => v !== "" && v != null).length,
    MIN: a => Math.min(...flat(a).map(num).filter(v => !isNaN(v)), 0),
    MAX: a => Math.max(...flat(a).map(num).filter(v => !isNaN(v)), 0),
    MEDIAN: a => { const n = flat(a).map(num).filter(v => !isNaN(v)).sort((x, y) => x - y); if(!n.length) return 0; const m = Math.floor(n.length / 2); return n.length % 2 ? n[m] : (n[m - 1] + n[m]) / 2; },
    IF: a => truthy(a[0]) ? (a[1] === undefined ? true : a[1]) : (a[2] === undefined ? false : a[2]),
    IFS: a => { for(let i = 0; i < a.length; i += 2) if(truthy(a[i])) return a[i + 1]; return "#N/A"; },
    AND: a => flat(a).every(truthy), OR: a => flat(a).some(truthy), NOT: a => !truthy(a[0]),
    CONCATENATE: a => flat(a).join(""), CONCAT: a => flat(a).join(""),
    ROUND: a => { const d = a[1] || 0; return Math.round(num(a[0]) * 10 ** d) / 10 ** d; },
    ROUNDUP: a => { const d = a[1] || 0; return Math.ceil(num(a[0]) * 10 ** d) / 10 ** d; },
    ROUNDDOWN: a => { const d = a[1] || 0; return Math.floor(num(a[0]) * 10 ** d) / 10 ** d; },
    ABS: a => Math.abs(num(a[0])), SQRT: a => Math.sqrt(num(a[0])), POWER: a => Math.pow(num(a[0]), num(a[1])),
    MOD: a => num(a[0]) % num(a[1]), INT: a => Math.floor(num(a[0])), SIGN: a => Math.sign(num(a[0])),
    PI: () => Math.PI, EXP: a => Math.exp(num(a[0])), LN: a => Math.log(num(a[0])), LOG: a => Math.log10(num(a[0])),
    TODAY: () => new Date().toLocaleDateString(), NOW: () => new Date().toLocaleString(),
    LEN: a => String(a[0] ?? "").length, UPPER: a => String(a[0] ?? "").toUpperCase(), LOWER: a => String(a[0] ?? "").toLowerCase(),
    PROPER: a => String(a[0] ?? "").replace(/\w\S*/g, w => w[0].toUpperCase() + w.slice(1).toLowerCase()),
    TRIM: a => String(a[0] ?? "").trim().replace(/\s+/g, " "),
    LEFT: a => String(a[0] ?? "").slice(0, a[1] == null ? 1 : num(a[1])),
    RIGHT: a => { const s = String(a[0] ?? ""); const n = a[1] == null ? 1 : num(a[1]); return s.slice(s.length - n); },
    MID: a => String(a[0] ?? "").substr(num(a[1]) - 1, num(a[2])),
    TEXT: a => String(a[0] ?? ""), VALUE: a => num(a[0]),
    ISBLANK: a => a[0] === "" || a[0] == null, ISNUMBER: a => typeof a[0] === "number" || !isNaN(parseFloat(a[0])) && a[0] !== "",
    ISTEXT: a => typeof a[0] === "string" && a[0] !== "" && isNaN(parseFloat(a[0])),
    IFERROR: a => { try{ return (a[0] === "#ERR" || a[0] === undefined) ? a[1] : a[0]; }catch(e){ return a[1]; } },
    VLOOKUP: (a, raw) => lookup(a, raw, true), HLOOKUP: (a, raw) => lookup(a, raw, false),
    SUMIF: (a, raw) => { const [rangeCells] = rangeOf(raw[0]); const crit = a[1]; const sumCells = raw[2] ? rangeOf(raw[2])[0] : rangeCells; let s = 0; rangeCells.forEach((c, i) => { if(matchCrit(c.val, crit)) s += num(sumCells[i] ? sumCells[i].val : 0) || 0; }); return s; },
    COUNTIF: (a, raw) => { const [rangeCells] = rangeOf(raw[0]); const crit = a[1]; return rangeCells.filter(c => matchCrit(c.val, crit)).length; },
    AVERAGEIF: (a, raw) => { const [rangeCells] = rangeOf(raw[0]); const crit = a[1]; const sumCells = raw[2] ? rangeOf(raw[2])[0] : rangeCells; let s = 0, n = 0; rangeCells.forEach((c, i) => { if(matchCrit(c.val, crit)){ s += num(sumCells[i] ? sumCells[i].val : 0) || 0; n++; } }); return n ? s / n : 0; },
    COLUMNS: (a, raw) => rangeOf(raw[0])[1].cols, ROWS: (a, raw) => rangeOf(raw[0])[1].rows
  };
  function flat(a){ return a.flat ? a.flat(3) : [].concat(...a); }
  function num(v){ if(typeof v === "number") return v; const n = parseFloat(String(v).replace(/[,$%]/g, "")); return isNaN(n) ? 0 : n; }
  function truthy(v){ if(typeof v === "boolean") return v; if(v === "TRUE") return true; if(v === "FALSE") return false; return !!num(v) || v === true; }
  function matchCrit(val, crit){
    if(crit == null) return false;
    const c = String(crit);
    const m = /^(<=|>=|<>|<|>|=)?(.*)$/.exec(c); const op = m[1] || "=", rhs = m[2];
    const a = num(val), b = num(rhs);
    const bothNum = !isNaN(a) && rhs !== "" && !isNaN(b);
    if(op === "=") return bothNum ? a === b : String(val ?? "").toLowerCase() === rhs.toLowerCase();
    if(op === "<>") return bothNum ? a !== b : String(val ?? "") !== rhs;
    if(!bothNum) return false;
    return op === "<" ? a < b : op === ">" ? a > b : op === "<=" ? a <= b : a >= b;
  }
  function rangeOf(rangeStr){
    const [a, b] = rangeStr.split(":").map(parseRef);
    const r0 = Math.min(a.r, (b || a).r), r1 = Math.max(a.r, (b || a).r);
    const c0 = Math.min(a.c, (b || a).c), c1 = Math.max(a.c, (b || a).c);
    const cells = [];
    for(let r = r0; r <= r1; r++) for(let c = c0; c <= c1; c++) cells.push({ r, c, val: evalCellValue(r, c) });
    return [cells, { rows: r1 - r0 + 1, cols: c1 - c0 + 1 }];
  }
  function lookup(a, raw, vertical){
    const target = a[0], [cells, dim] = rangeOf(raw[1]), idx = num(a[2]) - 1, approx = a[3] !== false && a[3] !== 0 && a[3] !== "FALSE";
    const groups = {};
    cells.forEach(c => { const g = vertical ? c.r : c.c; (groups[g] = groups[g] || [])[vertical ? c.c : c.r] = c.val; });
    const keys = Object.keys(groups).map(Number).sort((x, y) => x - y);
    let hit = null;
    for(const g of keys){ const first = groups[g][Object.keys(groups[g]).map(Number).sort((x, y) => x - y)[0]]; if(String(first) === String(target)){ hit = groups[g]; break; } if(approx && num(first) <= num(target)) hit = groups[g]; }
    if(!hit) return "#N/A";
    const ks = Object.keys(hit).map(Number).sort((x, y) => x - y);
    return hit[ks[idx]] ?? "#N/A";
  }

  function tokenize(src){
    const toks = []; let i = 0;
    while(i < src.length){
      const c = src[i];
      if(/\s/.test(c)){ i++; continue; }
      if(c === '"'){ let j = i + 1, s = ""; while(j < src.length && src[j] !== '"'){ s += src[j]; j++; } toks.push({ t: "str", v: s }); i = j + 1; continue; }
      if(/[A-Za-z$]/.test(c)){ let j = i; while(j < src.length && /[A-Za-z0-9_$]/.test(src[j])) j++; toks.push({ t: "ident", v: src.slice(i, j) }); i = j; continue; }
      if(/[0-9.]/.test(c)){ let j = i; while(j < src.length && /[0-9.]/.test(src[j])) j++; toks.push({ t: "num", v: parseFloat(src.slice(i, j)) }); i = j; continue; }
      if("+-*/^%(),:&".includes(c)){ toks.push({ t: c }); i++; continue; }
      if("<>=".includes(c)){ let j = i + 1; if("=>".includes(src[j]) && c !== "=" || (c === "<" && src[j] === ">")) j++; else if(c !== "=" && src[j] === "=") j++; toks.push({ t: "cmp", v: src.slice(i, j) }); i = j; continue; }
      i++;
    }
    toks.push({ t: "eof" });
    return toks;
  }
  function parseFormula(src){
    const toks = tokenize(src); let p = 0;
    const peek = () => toks[p], next = () => toks[p++];
    function expect(t){ if(peek().t !== t) throw new Error("Parse error near " + JSON.stringify(peek())); return next(); }
    function parseExpr(){ return parseCmp(); }
    function parseCmp(){ let l = parseConcat(); while(peek().t === "cmp" || peek().t === "="){ const op = next(); const r = parseConcat(); l = { k: "cmp", op: op.v || "=", l, r }; } return l; }
    function parseConcat(){ let l = parseAdd(); while(peek().t === "&"){ next(); const r = parseAdd(); l = { k: "concat", l, r }; } return l; }
    function parseAdd(){ let l = parseMul(); while(peek().t === "+" || peek().t === "-"){ const op = next().t; const r = parseMul(); l = { k: "bin", op, l, r }; } return l; }
    function parseMul(){ let l = parsePow(); while(peek().t === "*" || peek().t === "/"){ const op = next().t; const r = parsePow(); l = { k: "bin", op, l, r }; } return l; }
    function parsePow(){ let l = parseUnary(); while(peek().t === "^"){ next(); const r = parseUnary(); l = { k: "bin", op: "^", l, r }; } return l; }
    function parseUnary(){ if(peek().t === "-"){ next(); return { k: "neg", v: parseUnary() }; } return parsePostfix(); }
    function parsePostfix(){ let v = parseAtom(); if(peek().t === "%"){ next(); v = { k: "pct", v }; } return v; }
    function parseAtom(){
      const t = peek();
      if(t.t === "num"){ next(); return { k: "num", v: t.v }; }
      if(t.t === "str"){ next(); return { k: "str", v: t.v }; }
      if(t.t === "("){ next(); const e = parseExpr(); expect(")"); return e; }
      if(t.t === "ident"){
        next();
        if(peek().t === "("){
          next(); const args = [];
          if(peek().t !== ")"){ args.push(parseExpr()); while(peek().t === ","){ next(); args.push(parseExpr()); } }
          expect(")");
          return { k: "call", name: t.v.toUpperCase(), args };
        }
        if(peek().t === ":"){ next(); const t2 = expect("ident"); return { k: "range", a: t.v, b: t2.v }; }
        if(/^(TRUE|FALSE)$/i.test(t.v)) return { k: "bool", v: /true/i.test(t.v) };
        return { k: "ref", v: t.v };
      }
      throw new Error("Unexpected token " + JSON.stringify(t));
    }
    const ast = parseExpr();
    return ast;
  }
  const evalCache = new Map(); let evalStack = new Set();
  function evalCellValue(r, c){
    const ck = key(r, c);
    if(evalCache.has(ck)) return evalCache.get(ck);
    const cl = sheet().cells[ck];
    if(!cl || (cl.f == null && (cl.v == null || cl.v === ""))) return "";
    if(cl.f == null){ const n = parseFloat(cl.v); return !isNaN(n) && String(n) === String(cl.v).trim() ? n : cl.v; }
    if(evalStack.has(ck)) return "#CYCLE";
    evalStack.add(ck);
    let out;
    try{ out = evalAst(parseFormula(cl.f)); }catch(e){ out = "#ERR"; }
    evalStack.delete(ck);
    evalCache.set(ck, out);
    return out;
  }
  function evalAst(n){
    switch(n.k){
      case "num": return n.v; case "str": return n.v; case "bool": return n.v;
      case "neg": return -num(evalAst(n.v));
      case "pct": return num(evalAst(n.v)) / 100;
      case "concat": return String(evalAst(n.l) ?? "") + String(evalAst(n.r) ?? "");
      case "cmp": { const l = evalAst(n.l), r = evalAst(n.r); const a = num(l), b = num(r); const bothNum = !isNaN(a) && !isNaN(b) && l !== "" && r !== ""; const cmp = bothNum ? a - b : String(l).localeCompare(String(r)); if(n.op === "=") return cmp === 0; if(n.op === "<>") return cmp !== 0; if(n.op === "<") return cmp < 0; if(n.op === ">") return cmp > 0; if(n.op === "<=") return cmp <= 0; if(n.op === ">=") return cmp >= 0; return false; }
      case "bin": { const a = num(evalAst(n.l)), b = num(evalAst(n.r)); return n.op === "+" ? a + b : n.op === "-" ? a - b : n.op === "*" ? a * b : n.op === "/" ? (b === 0 ? "#DIV/0!" : a / b) : n.op === "^" ? Math.pow(a, b) : 0; }
      case "ref": { const p = parseRef(n.v); if(!p) return "#REF!"; return evalCellValue(p.r, p.c); }
      case "range": { const [cells] = rangeOf(n.a + ":" + n.b); return cells.map(c => c.val); }
      case "call": {
        const fn = FUNCS[n.name]; if(!fn) return "#NAME?";
        const rawArgs = n.args.map(a => a.k === "range" ? a.a + ":" + a.b : null);
        const vals = n.args.map(a => a.k === "range" ? rangeOf(a.a + ":" + a.b)[0].map(c => c.val) : evalAst(a));
        return fn(vals, rawArgs);
      }
    }
    return "";
  }
  function recalc(){ evalCache.clear(); }

  /* ---------- rendering ---------- */
  const sheetEl = $("#sheet");
  let sel = { r: 0, c: 0, r2: 0, c2: 0 };
  let colW = c => sheet().colW[c] || 90, rowH = r => sheet().rowH[r] || 24;

  function render(){
    sheetEl.innerHTML = "";
    const head = h("div", { class: "headrow" }, h("div", { class: "gh-corner" }));
    for(let c = 0; c < COLS; c++) head.append(h("div", { class: "gh-col" + (inSel(null, c) ? " sel" : ""), style: { width: colW(c) + "px" }, "data-c": c },
      colLetter(c), h("div", { class: "colresize", "data-rc": c })));
    sheetEl.append(head);
    for(let r = 0; r < ROWS; r++){
      const row = h("div", { class: "gridrow" });
      row.append(h("div", { class: "gh-row" + (inSel(r, null) ? " sel" : ""), style: { height: rowH(r) + "px" }, "data-r": r }, String(r + 1), h("div", { class: "rowresize", "data-rr": r })));
      for(let c = 0; c < COLS; c++) row.append(renderCell(r, c));
      sheetEl.append(row);
    }
    renderCharts();
    syncHeaderSticky();
  }
  function syncHeaderSticky(){ sheetEl.querySelectorAll(".headrow").forEach(e => e.style.left = "0"); }
  function inSel(r, c){
    const r0 = Math.min(sel.r, sel.r2), r1 = Math.max(sel.r, sel.r2), c0 = Math.min(sel.c, sel.c2), c1 = Math.max(sel.c, sel.c2);
    if(r == null) return c >= c0 && c <= c1; if(c == null) return r >= r0 && r <= r1; return false;
  }
  function renderCell(r, c){
    const cl = cell(r, c);
    const showFormulas = $("#showFormulasChk").checked;
    let val = cl ? (cl.f && !showFormulas ? evalCellValue(r, c) : (cl.f ? "=" + cl.f : cl.v)) : "";
    if(typeof val === "number") val = formatNum(val, cl && cl.fmt);
    const isNum = cl && typeof evalCellValue(r, c) === "number";
    const style = { width: colW(c) + "px", height: rowH(r) + "px" };
    if(cl){
      if(cl.bold) style.fontWeight = "700"; if(cl.italic) style.fontStyle = "italic";
      if(cl.underline) style.textDecoration = "underline"; if(cl.bg) style.background = cl.bg; if(cl.color) style.color = cl.color;
      if(cl.align) style.textAlign = cl.align; if(cl.wrap){ style.whiteSpace = "normal"; style.wordBreak = "break-word"; }
      if(cl.fontFamily) style.fontFamily = cl.fontFamily; if(cl.fontSize) style.fontSize = cl.fontSize + "px";
      if(cl.border) Object.assign(style, cl.border);
    }
    const div = h("div", { class: "cell" + (isNum && !cl.align ? " num" : "") + (r === sel.r && c === sel.c ? " sel" : inRange(r, c) ? " inrange" : ""), style, "data-r": r, "data-c": c }, String(val ?? ""));
    if(sheet().notes[key(r, c)]) div.append(h("div", { class: "note-dot" }));
    return div;
  }
  function inRange(r, c){ const r0 = Math.min(sel.r, sel.r2), r1 = Math.max(sel.r, sel.r2), c0 = Math.min(sel.c, sel.c2), c1 = Math.max(sel.c, sel.c2); return r >= r0 && r <= r1 && c >= c0 && c <= c1 && !(r === sel.r && c === sel.c); }
  function formatNum(v, fmt){
    if(fmt === "currency") return "$" + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if(fmt === "percent") return (v * 100).toFixed(1) + "%";
    if(fmt === "number") return v.toLocaleString(undefined, { maximumFractionDigits: 4 });
    return String(v);
  }

  /* ---------- selection & editing ---------- */
  function setSel(r, c, r2, c2, scroll){
    sel = { r, c, r2: r2 == null ? r : r2, c2: c2 == null ? c : c2 };
    renderSelOnly(); updateFormulaBar(); updateStatus();
  }
  function renderSelOnly(){ render(); }
  function updateFormulaBar(){
    $("#cellRef").textContent = (sel.r === sel.r2 && sel.c === sel.c2) ? ref(sel.r, sel.c) : ref(sel.r, sel.c) + ":" + ref(sel.r2, sel.c2);
    const cl = cell(sel.r, sel.c);
    $("#formulaInput").value = cl ? (cl.f ? "=" + cl.f : (cl.v ?? "")) : "";
    syncFormatButtons();
  }
  function syncFormatButtons(){
    const cl = cell(sel.r, sel.c) || {};
    $("#boldBtn").classList.toggle("on", !!cl.bold);
    $("#italicBtn").classList.toggle("on", !!cl.italic);
    $("#underlineBtn").classList.toggle("on", !!cl.underline);
    $("#fontFamily").value = cl.fontFamily || "Inter";
    $("#fontSize").value = cl.fontSize || 11;
    $("#numFmt").value = cl.fmt || "general";
  }
  function updateStatus(){
    $("#selInfo").textContent = (sel.r === sel.r2 && sel.c === sel.c2) ? ref(sel.r, sel.c) : ref(sel.r, sel.c) + ":" + ref(sel.r2, sel.c2);
    const r0 = Math.min(sel.r, sel.r2), r1 = Math.max(sel.r, sel.r2), c0 = Math.min(sel.c, sel.c2), c1 = Math.max(sel.c, sel.c2);
    let sum = 0, n = 0;
    for(let r = r0; r <= r1; r++) for(let c = c0; c <= c1; c++){ const v = evalCellValue(r, c); if(typeof v === "number"){ sum += v; n++; } }
    $("#aggInfo").textContent = n ? `Sum: ${sum.toLocaleString()}   Avg: ${(sum / n).toFixed(2)}   Count: ${n}` : "Sum: 0";
  }

  let editing = null;
  function startEdit(r, c, initial){
    if(editing) commitEdit();
    const target = sheetEl.querySelector(`.cell[data-r="${r}"][data-c="${c}"]`);
    if(!target) return;
    const cl = cell(r, c);
    const box = h("div", { class: "celleditor", contenteditable: "true", style: { width: colW(c) + "px", minHeight: rowH(r) + "px" } });
    box.textContent = initial != null ? initial : (cl ? (cl.f ? "=" + cl.f : (cl.v ?? "")) : "");
    target.style.visibility = "hidden";
    target.after(box);
    box.style.position = "absolute";
    const tr = target.getBoundingClientRect(), pr = sheetEl.getBoundingClientRect();
    box.style.left = (tr.left - pr.left) + "px"; box.style.top = (tr.top - pr.top) + "px";
    sheetEl.append(box);
    box.focus();
    placeCaretEnd(box);
    editing = { r, c, box };
  }
  function placeCaretEnd(el){ const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); }
  function commitEdit(move){
    if(!editing) return;
    const { r, c, box } = editing;
    const text = box.textContent;
    setCellRaw(r, c, text);
    box.remove(); editing = null;
    recalc(); render(); S.touch();
    if(move === "down") setSel(Math.min(ROWS - 1, r + 1), c);
    else if(move === "right") setSel(r, Math.min(COLS - 1, c + 1));
    else setSel(r, c);
  }
  function cancelEdit(){ if(!editing) return; editing.box.remove(); editing = null; render(); }
  function setCellRaw(r, c, text){
    const s = sheet();
    if(text === ""){ delete s.cells[key(r, c)]; return; }
    const cl = cell(r, c, true);
    if(text[0] === "="){ cl.f = text.slice(1); cl.v = ""; }
    else{ cl.f = null; cl.v = text; }
  }

  sheetEl.addEventListener("mousedown", e => {
    const cellEl = e.target.closest(".cell"); if(!cellEl) return;
    if(editing) commitEdit();
    const r = +cellEl.dataset.r, c = +cellEl.dataset.c;
    setSel(r, c);
    let dragging = true;
    const onMove = ev => { const t = document.elementFromPoint(ev.clientX, ev.clientY); const ce = t && t.closest(".cell"); if(ce && dragging) setSel(r, c, +ce.dataset.r, +ce.dataset.c); };
    const onUp = () => { dragging = false; removeEventListener("mousemove", onMove); removeEventListener("mouseup", onUp); };
    addEventListener("mousemove", onMove); addEventListener("mouseup", onUp);
  });
  sheetEl.addEventListener("dblclick", e => { const cellEl = e.target.closest(".cell"); if(cellEl) startEdit(+cellEl.dataset.r, +cellEl.dataset.c); });
  sheetEl.addEventListener("click", e => {
    const colH = e.target.closest(".gh-col"); if(colH && !e.target.closest(".colresize")){ setSel(0, +colH.dataset.c, ROWS - 1, +colH.dataset.c); }
    const rowH_ = e.target.closest(".gh-row"); if(rowH_ && !e.target.closest(".rowresize")){ setSel(+rowH_.dataset.r, 0, +rowH_.dataset.r, COLS - 1); }
  });

  document.addEventListener("keydown", e => {
    if(editing){
      if(e.key === "Enter"){ e.preventDefault(); commitEdit("down"); }
      else if(e.key === "Tab"){ e.preventDefault(); commitEdit("right"); }
      else if(e.key === "Escape"){ e.preventDefault(); cancelEdit(); }
      return;
    }
    if(document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName) && document.activeElement.id !== "formulaInput") return;
    const r = sel.r, c = sel.c;
    if(e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey){ e.preventDefault(); startEdit(r, c, e.key); return; }
    if(e.key === "F2"){ e.preventDefault(); startEdit(r, c); return; }
    if(e.key === "Delete" || e.key === "Backspace"){
      const r0 = Math.min(sel.r, sel.r2), r1 = Math.max(sel.r, sel.r2), c0 = Math.min(sel.c, sel.c2), c1 = Math.max(sel.c, sel.c2);
      for(let rr = r0; rr <= r1; rr++) for(let cc = c0; cc <= c1; cc++) delete sheet().cells[key(rr, cc)];
      recalc(); render(); S.touch(); return;
    }
    const map = { ArrowDown: [1, 0], ArrowUp: [-1, 0], ArrowRight: [0, 1], ArrowLeft: [0, -1], Enter: [1, 0], Tab: [0, 1] };
    if(map[e.key]){ e.preventDefault(); const [dr, dc] = map[e.key]; const nr = N.clamp(r + dr, 0, ROWS - 1), nc = N.clamp(c + dc, 0, COLS - 1); if(e.shiftKey && e.key.startsWith("Arrow")) setSel(sel.r, sel.c, nr, nc); else setSel(nr, nc); }
  });

  $("#formulaInput").addEventListener("focus", () => { if(!editing) startEdit(sel.r, sel.c); });
  $("#formulaInput").addEventListener("input", e => { if(editing) editing.box.textContent = e.target.value; });
  $("#formulaInput").addEventListener("keydown", e => { if(e.key === "Enter"){ e.preventDefault(); commitEdit("down"); $("#formulaInput").blur(); } });

  /* copy / paste */
  let clip = null;
  function copySel(){ const r0 = Math.min(sel.r, sel.r2), r1 = Math.max(sel.r, sel.r2), c0 = Math.min(sel.c, sel.c2), c1 = Math.max(sel.c, sel.c2); clip = []; for(let r = r0; r <= r1; r++){ const row = []; for(let c = c0; c <= c1; c++) row.push(cell(r, c) ? { ...cell(r, c) } : null); clip.push(row); } N.toast("Copied."); }
  function pasteSel(){ if(!clip) return; clip.forEach((row, i) => row.forEach((cl, j) => { const r = sel.r + i, c = sel.c + j; if(r >= ROWS || c >= COLS) return; if(!cl){ delete sheet().cells[key(r, c)]; return; } sheet().cells[key(r, c)] = { ...cl }; })); recalc(); render(); S.touch(); }
  $("#copyBtn").addEventListener("click", copySel); $("#pasteBtn").addEventListener("click", pasteSel);
  N.keys({ "ctrl+c": () => { copySel(); return false; }, "ctrl+v": () => { pasteSel(); return false; }, "ctrl+z": () => false, "ctrl+s": () => { S.flush(); N.toast("Saved."); return false; } });

  /* ---------- formatting commands ---------- */
  function applyToSel(fn){
    const r0 = Math.min(sel.r, sel.r2), r1 = Math.max(sel.r, sel.r2), c0 = Math.min(sel.c, sel.c2), c1 = Math.max(sel.c, sel.c2);
    for(let r = r0; r <= r1; r++) for(let c = c0; c <= c1; c++) fn(cell(r, c, true));
    render(); S.touch();
  }
  $("#boldBtn").addEventListener("click", () => applyToSel(cl => cl.bold = !cl.bold));
  $("#italicBtn").addEventListener("click", () => applyToSel(cl => cl.italic = !cl.italic));
  $("#underlineBtn").addEventListener("click", () => applyToSel(cl => cl.underline = !cl.underline));
  $("#alignLBtn").addEventListener("click", () => applyToSel(cl => cl.align = "left"));
  $("#alignCBtn").addEventListener("click", () => applyToSel(cl => cl.align = "center"));
  $("#alignRBtn").addEventListener("click", () => applyToSel(cl => cl.align = "right"));
  $("#wrapBtn").addEventListener("click", () => applyToSel(cl => cl.wrap = !cl.wrap));
  $("#fontFamily").addEventListener("change", e => applyToSel(cl => cl.fontFamily = e.target.value));
  $("#fontSize").addEventListener("change", e => applyToSel(cl => cl.fontSize = +e.target.value));
  $("#numFmt").addEventListener("change", e => applyToSel(cl => cl.fmt = e.target.value));
  $("#fillBtn").addEventListener("click", () => N.colorPick($("#fillBtn"), { onPick: c => { applyToSel(cl => cl.bg = c); $("#fillC").style.setProperty("--c", c || "transparent"); } }));
  $("#txColorBtn").addEventListener("click", () => N.colorPick($("#txColorBtn"), { onPick: c => { applyToSel(cl => cl.color = c); $("#txColorC").style.setProperty("--c", c || "#24221e"); } }));
  $("#borderBtn").addEventListener("click", () => N.menu($("#borderBtn"), [
    { label: "All borders", run: () => applyToSel(cl => cl.border = { border: "1px solid #999" }) },
    { label: "No borders", run: () => applyToSel(cl => cl.border = null) }
  ]));
  $("#mergeBtn").addEventListener("click", () => { sheet().merges.push({ r0: Math.min(sel.r, sel.r2), c0: Math.min(sel.c, sel.c2), r1: Math.max(sel.r, sel.r2), c1: Math.max(sel.c, sel.c2) }); N.toast("Merged (visual support is basic)."); S.touch(); });
  $("#insRowBtn").addEventListener("click", () => N.toast("Rows auto-expand — just scroll down and keep typing."));
  $("#insColBtn").addEventListener("click", () => N.toast("Columns auto-expand up to Z. For more, export to CSV and reopen in a tool that supports additional columns."));

  /* data tools */
  $("#sortAzBtn").addEventListener("click", () => sortSel(1));
  $("#sortZaBtn").addEventListener("click", () => sortSel(-1));
  function sortSel(dir){
    const r0 = Math.min(sel.r, sel.r2), r1 = Math.max(sel.r, sel.r2), c0 = Math.min(sel.c, sel.c2), c1 = Math.max(sel.c, sel.c2);
    const rowsData = []; for(let r = r0; r <= r1; r++){ const row = []; for(let c = c0; c <= c1; c++) row.push(cell(r, c) ? { ...cell(r, c) } : null); rowsData.push(row); }
    rowsData.sort((a, b) => { const av = a[0] ? (a[0].f ? evalCellValue(r0, c0) : a[0].v) : "", bv = b[0] ? b[0].v : ""; return dir * String(av ?? "").localeCompare(String(bv ?? ""), undefined, { numeric: true }); });
    rowsData.forEach((row, i) => row.forEach((cl, j) => { const key_ = key(r0 + i, c0 + j); if(cl) sheet().cells[key_] = cl; else delete sheet().cells[key_]; }));
    recalc(); render(); S.touch();
  }
  $("#filterChk").addEventListener("change", e => { sheet().filterOn = e.target.checked; N.toast(e.target.checked ? "Filter on — click a header cell and use Data > Sort to narrow rows." : "Filter off"); });
  $("#freezeChk").addEventListener("change", e => { sheet().freeze = e.target.checked ? { r: 1, c: 1 } : { r: 0, c: 0 }; N.toast("Freeze is visual-only in this preview."); });
  $("#dedupBtn").addEventListener("click", async () => {
    const r0 = Math.min(sel.r, sel.r2), r1 = Math.max(sel.r, sel.r2), c0 = Math.min(sel.c, sel.c2), c1 = Math.max(sel.c, sel.c2);
    const seen = new Set(); let removed = 0;
    for(let r = r0; r <= r1; r++){
      const rowKey = Array.from({ length: c1 - c0 + 1 }, (_, i) => cellDisp(r, c0 + i)).join("\u0001");
      if(seen.has(rowKey)){ for(let c = c0; c <= c1; c++) delete sheet().cells[key(r, c)]; removed++; } else seen.add(rowKey);
    }
    recalc(); render(); S.touch(); N.toast(removed ? `Removed ${removed} duplicate row(s).` : "No duplicates found.");
  });
  $("#validBtn").addEventListener("click", async () => {
    const list = await N.prompt("Data validation", "", { label: "Comma-separated allowed values for the selected cells" });
    if(list == null) return;
    applyToSel(cl => cl.valid = list.split(",").map(s => s.trim()));
    N.toast("Validation saved — a warning icon appears if a typed value isn't on the list.");
  });
  $("#gridlinesChk").addEventListener("change", e => document.body.classList.toggle("show-grid", e.target.checked));
  document.body.classList.add("show-grid");
  $("#showFormulasChk").addEventListener("change", render);

  /* ---------- notes / links / images ---------- */
  $("#insNoteBtn").addEventListener("click", async () => { const t = await N.prompt("Insert note", "", { label: "Note for " + ref(sel.r, sel.c) }); if(t) sheet().notes[key(sel.r, sel.c)] = t; render(); S.touch(); });
  $("#insLinkBtn").addEventListener("click", async () => { const t = await N.prompt("Insert link", "https://", { label: "URL" }); if(t) setCellRaw(sel.r, sel.c, t); render(); S.touch(); });
  $("#insImgBtn").addEventListener("click", () => N.toast("Images can be added to Draft and Deck; Grid keeps data lightweight."));

  /* ---------- functions picker ---------- */
  $("#fnBtn").addEventListener("click", () => {
    const list = Object.keys(FUNCS).sort();
    const box = h("div", { class: "list" });
    list.forEach(f => box.append(h("button", { class: "list-i", type: "button", onclick: () => { startEdit(sel.r, sel.c, "=" + f + "("); P.close(); } }, h("span", { class: "t" }, f))));
    var P = N.dialog({ title: "Insert function", width: 320, body: box, buttons: [{ label: "Close" }] });
  });

  /* ---------- charts (simple inline SVG bar/line/pie) ---------- */
  function renderCharts(){ sheet().charts.forEach(ch => sheetEl.append(buildChart(ch))); }
  function buildChart(ch){
    const [cells, dim] = rangeOf(ch.range);
    const rows = []; for(let i = 0; i < dim.rows; i++) rows.push(cells.slice(i * dim.cols, i * dim.cols + dim.cols));
    const labels = rows.map(r => String(r[0].val));
    const values = rows.map(r => num(r[1] ? r[1].val : 0));
    const w = ch.w || 360, hh = ch.h || 240;
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg"); svg.setAttribute("viewBox", `0 0 ${w} ${hh - 30}`); svg.setAttribute("width", "100%"); svg.setAttribute("height", (hh - 30) + "px");
    const max = Math.max(...values, 1);
    const colors = ["#3b82f6", "#2fb344", "#ff9900", "#8a2be2", "#e91e8c", "#00b8b8"];
    if(ch.type === "pie"){
      const total = values.reduce((a, b) => a + b, 0) || 1; let ang = -Math.PI / 2;
      const cx = w / 2, cy = (hh - 30) / 2, R = Math.min(cx, cy) - 14;
      values.forEach((v, i) => {
        const a2 = ang + (v / total) * Math.PI * 2;
        const x1 = cx + R * Math.cos(ang), y1 = cy + R * Math.sin(ang), x2 = cx + R * Math.cos(a2), y2 = cy + R * Math.sin(a2);
        const large = (a2 - ang) > Math.PI ? 1 : 0;
        const p = document.createElementNS(svgNS, "path"); p.setAttribute("d", `M${cx},${cy} L${x1},${y1} A${R},${R} 0 ${large} 1 ${x2},${y2} Z`); p.setAttribute("fill", colors[i % colors.length]);
        svg.append(p); ang = a2;
      });
    }else{
      const padL = 28, padB = 18, plotW = w - padL - 8, plotH = (hh - 30) - padB - 8, bw = plotW / values.length;
      if(ch.type === "line"){
        let d = "";
        values.forEach((v, i) => { const x = padL + bw * i + bw / 2, y = 8 + plotH - (v / max) * plotH; d += (i ? "L" : "M") + x + "," + y + " "; });
        const path = document.createElementNS(svgNS, "path"); path.setAttribute("d", d); path.setAttribute("fill", "none"); path.setAttribute("stroke", colors[0]); path.setAttribute("stroke-width", "2");
        svg.append(path);
      }else{
        values.forEach((v, i) => {
          const bh = (v / max) * plotH, x = padL + bw * i + bw * .15, y = 8 + plotH - bh;
          const rc = document.createElementNS(svgNS, "rect"); rc.setAttribute("x", x); rc.setAttribute("y", y); rc.setAttribute("width", bw * .7); rc.setAttribute("height", Math.max(0, bh)); rc.setAttribute("fill", colors[i % colors.length]);
          svg.append(rc);
        });
      }
    }
    const box = h("div", { class: "chart-obj", style: { left: (ch.x || 240) + "px", top: (ch.y || 40) + "px", width: w + "px" } },
      h("div", { class: "chh" }, h("span", null, ch.title || "Chart"), h("span", { class: "sp" }),
        h("button", { class: "ib", type: "button", onclick: () => { sheet().charts = sheet().charts.filter(x => x !== ch); render(); S.touch(); } }, N.icEl("x"))),
      svg);
    makeDraggable(box, ch);
    return box;
  }
  function makeDraggable(box, ch){
    const hdl = box.querySelector(".chh");
    hdl.addEventListener("mousedown", e => {
      e.preventDefault(); const sx = e.clientX, sy = e.clientY, ox = ch.x || 240, oy = ch.y || 40;
      const onMove = ev => { ch.x = ox + (ev.clientX - sx); ch.y = oy + (ev.clientY - sy); box.style.left = ch.x + "px"; box.style.top = ch.y + "px"; };
      const onUp = () => { removeEventListener("mousemove", onMove); removeEventListener("mouseup", onUp); S.touch(); };
      addEventListener("mousemove", onMove); addEventListener("mouseup", onUp);
    });
  }
  $("#insChartBtn").addEventListener("click", async () => {
    const range = await N.prompt("Insert chart", ref(sel.r, sel.c) + ":" + ref(sel.r2, sel.c2), { label: "Data range (label column, value column)" });
    if(!range) return;
    N.menu($("#insChartBtn"), [
      { label: "Column chart", run: () => addChart(range, "bar") },
      { label: "Line chart", run: () => addChart(range, "line") },
      { label: "Pie chart", run: () => addChart(range, "pie") }
    ]);
  });
  function addChart(range, type){ sheet().charts.push({ range, type, x: 260, y: 40, w: 360, h: 260, title: type[0].toUpperCase() + type.slice(1) + " chart" }); render(); S.touch(); }

  /* ---------- sheet tabs ---------- */
  function renderTabs(){
    const box = $("#sheetTabs"); box.innerHTML = "";
    wb.sheets.forEach((s, i) => {
      const t = h("button", { class: "stab" + (i === wb.active ? " on" : ""), type: "button" }, s.name);
      t.addEventListener("click", () => { wb.active = i; recalc(); render(); updateFormulaBar(); S.touch(); });
      t.addEventListener("dblclick", async () => { const n = await N.prompt("Rename sheet", s.name); if(n){ s.name = n; renderTabs(); S.touch(); } });
      t.addEventListener("contextmenu", e => N.context(e, [
        { label: "Rename", run: async () => { const n = await N.prompt("Rename sheet", s.name); if(n){ s.name = n; renderTabs(); S.touch(); } } },
        { label: "Duplicate", run: () => { wb.sheets.splice(i + 1, 0, JSON.parse(JSON.stringify(s))); wb.sheets[i + 1].name += " copy"; renderTabs(); S.touch(); } },
        { label: "Delete", disabled: wb.sheets.length < 2, run: () => { wb.sheets.splice(i, 1); wb.active = 0; renderTabs(); render(); S.touch(); } }
      ]));
      box.append(t);
    });
    box.append(h("button", { class: "stabadd", type: "button", title: "Add sheet", onclick: () => { wb.sheets.push(newSheet("Sheet" + (wb.sheets.length + 1))); wb.active = wb.sheets.length - 1; renderTabs(); render(); S.touch(); } }, N.icEl("plus")));
  }
  $("#insSheetBtn").addEventListener("click", () => { wb.sheets.push(newSheet("Sheet" + (wb.sheets.length + 1))); wb.active = wb.sheets.length - 1; renderTabs(); render(); S.touch(); });

  /* ---------- import / export ---------- */
  function toCSV(){
    const s = sheet(); let maxR = 0, maxC = 0;
    Object.keys(s.cells).forEach(k => { const [r, c] = k.split(":").map(Number); maxR = Math.max(maxR, r); maxC = Math.max(maxC, c); });
    const lines = [];
    for(let r = 0; r <= maxR; r++){
      const row = [];
      for(let c = 0; c <= maxC; c++){ const v = evalCellValue(r, c); const s2 = v == null ? "" : String(v); row.push(/[",\n]/.test(s2) ? '"' + s2.replace(/"/g, '""') + '"' : s2); }
      lines.push(row.join(","));
    }
    return lines.join("\r\n");
  }
  function fromCSV(text, delim){
    const s = newSheet("Sheet1"); const rows = text.replace(/\r\n/g, "\n").split("\n").filter((l, i, a) => !(i === a.length - 1 && l === ""));
    rows.forEach((line, r) => {
      const cells = splitCSV(line, delim || ",");
      cells.forEach((v, c) => { if(v !== "") s.cells[key(r, c)] = { v }; });
    });
    return s;
  }
  function splitCSV(line, delim){
    const out = []; let cur = "", inQ = false;
    for(let i = 0; i < line.length; i++){
      const c = line[i];
      if(inQ){ if(c === '"'){ if(line[i + 1] === '"'){ cur += '"'; i++; } else inQ = false; } else cur += c; }
      else{ if(c === '"') inQ = true; else if(c === delim){ out.push(cur); cur = ""; } else cur += c; }
    }
    out.push(cur); return out;
  }

  async function exportXlsx(){
    const JSZip = await N.lib("jszip");
    const zip = new JSZip();
    zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${wb.sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`);
    zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
    zip.file("xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${wb.sheets.map((s, i) => `<sheet name="${N.esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`);
    zip.file("xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${wb.sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
    zip.file("xl/styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>`);
    const prevActive = wb.active;
    wb.sheets.forEach((s, i) => { wb.active = i; zip.file(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)); });
    wb.active = prevActive;
    const blob = await zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    N.download(blob, fileBase() + ".xlsx");
  }
  function sheetXml(s){
    let maxR = 0, maxC = 0;
    Object.keys(s.cells).forEach(k => { const [r, c] = k.split(":").map(Number); maxR = Math.max(maxR, r); maxC = Math.max(maxC, c); });
    let rowsXml = "";
    for(let r = 0; r <= maxR; r++){
      let rowXml = "";
      for(let c = 0; c <= maxC; c++){
        const cl = s.cells[key(r, c)]; if(!cl) continue;
        const cref = ref(r, c); const sIdx = cl.bold ? 1 : 0;
        if(cl.f){ const val = evalCellValue(r, c); const num_ = typeof val === "number"; rowXml += `<c r="${cref}" s="${sIdx}"${num_ ? "" : ' t="str"'}><f>${N.esc(cl.f)}</f><v>${N.esc(String(num_ ? val : val))}</v></c>`; }
        else{ const n = parseFloat(cl.v); if(!isNaN(n) && String(n) === String(cl.v).trim()) rowXml += `<c r="${cref}" s="${sIdx}"><v>${n}</v></c>`; else rowXml += `<c r="${cref}" s="${sIdx}" t="inlineStr"><is><t xml:space="preserve">${N.esc(cl.v)}</t></is></c>`; }
      }
      if(rowXml) rowsXml += `<row r="${r + 1}">${rowXml}</row>`;
    }
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowsXml}</sheetData></worksheet>`;
  }
  async function importXlsx(file){
    const JSZip = await N.lib("jszip");
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    let shared = [];
    const ss = zip.file("xl/sharedStrings.xml");
    if(ss){ const xml = new DOMParser().parseFromString(await ss.async("text"), "application/xml"); shared = [...xml.getElementsByTagName("si")].map(si => [...si.getElementsByTagName("t")].map(t => t.textContent).join("")); }
    const wbXml = new DOMParser().parseFromString(await zip.file("xl/workbook.xml").async("text"), "application/xml");
    const names = [...wbXml.getElementsByTagName("sheet")].map(s => s.getAttribute("name"));
    const sheetFiles = Object.keys(zip.files).filter(f => /xl\/worksheets\/sheet\d+\.xml$/.test(f)).sort((a, b) => (+a.match(/\d+/)[0]) - (+b.match(/\d+/)[0]));
    const newSheets = [];
    for(let i = 0; i < sheetFiles.length; i++){
      const xml = new DOMParser().parseFromString(await zip.file(sheetFiles[i]).async("text"), "application/xml");
      const s = newSheet(names[i] || ("Sheet" + (i + 1)));
      for(const cNode of [...xml.getElementsByTagName("c")]){
        const p = parseRef(cNode.getAttribute("r")); if(!p) continue;
        const t = cNode.getAttribute("t");
        const fNode = cNode.getElementsByTagName("f")[0], vNode = cNode.getElementsByTagName("v")[0];
        if(fNode){ s.cells[key(p.r, p.c)] = { f: fNode.textContent, v: "" }; continue; }
        if(t === "s"){ const idx = +(vNode ? vNode.textContent : 0); s.cells[key(p.r, p.c)] = { v: shared[idx] ?? "" }; }
        else if(t === "inlineStr"){ const isn = cNode.getElementsByTagName("is")[0]; s.cells[key(p.r, p.c)] = { v: isn ? isn.textContent : "" }; }
        else if(vNode) s.cells[key(p.r, p.c)] = { v: vNode.textContent };
      }
      newSheets.push(s);
    }
    wb = { sheets: newSheets.length ? newSheets : [newSheet("Sheet1")], active: 0 };
  }
  function fileBase(){ return ($("#docTitle").value || "spreadsheet").trim() || "spreadsheet"; }

  $("#fileMenuBtn").addEventListener("click", () => N.menu($("#fileMenuBtn"), [
    { icon: "newfile", label: "New spreadsheet", run: () => { wb = { sheets: [newSheet("Sheet1")], active: 0 }; $("#docTitle").value = "Untitled spreadsheet"; S.fresh(); } },
    { icon: "open", label: "Open…", run: async () => { const [f] = await N.pick(".xlsx,.csv,.tsv"); if(f) importFile(f); } },
    { icon: "files", label: "Saved on this device", run: () => S.library() },
    "-",
    { icon: "filedown", label: "Save as Excel (.xlsx)", run: exportXlsx },
    { icon: "filedown", label: "Save as CSV", run: () => N.download(toCSV(), fileBase() + ".csv", "text/csv;charset=utf-8") },
    "-",
    { icon: "print", label: "Print", run: () => print() }
  ]));
  $("#shareBtn").addEventListener("click", () => N.menu($("#shareBtn"), [
    { icon: "filedown", label: "Excel (.xlsx)", run: exportXlsx },
    { icon: "filedown", label: "CSV", run: () => N.download(toCSV(), fileBase() + ".csv", "text/csv;charset=utf-8") }
  ], { align: "right" }));
  async function importFile(file){
    const ext = file.name.split(".").pop().toLowerCase();
    try{
      if(ext === "xlsx") await importXlsx(file);
      else wb = { sheets: [fromCSV(await file.text(), ext === "tsv" ? "\t" : ",")], active: 0 };
      $("#docTitle").value = file.name.replace(/\.[^.]+$/, "");
      recalc(); render(); renderTabs(); S.touch(); N.toast("Opened " + file.name);
    }catch(e){ console.error(e); N.alert("Couldn't open that file."); }
  }
  N.dropFiles($("#gridwrap"), files => { const f = files[0]; if(f && /xlsx|csv|tsv$/i.test(f.name)) importFile(f); });

  /* ---------- autosave ---------- */
  const S = N.session({
    app: "abacus",
    getTitle: () => $("#docTitle").value || "Untitled spreadsheet",
    getData: async () => ({ title: $("#docTitle").value, wb }),
    setData: d => { wb = d.wb || wb; $("#docTitle").value = d.title || "Untitled spreadsheet"; recalc(); render(); renderTabs(); }
  });
  $("#docTitle").addEventListener("input", () => S.touch());
  N.keys({ "ctrl+p": () => { print(); return false; } });

  (async function init(){
    const handed = await S.takeHandoff();
    if(handed){ await importFile(handed); }
    else{ const had = await S.load(); if(!had){ recalc(); render(); renderTabs(); } }
    setSel(0, 0);
    N.ribbon($("#ribbon")); N.keepFocus($("#ribbon"));
  })();
})();
