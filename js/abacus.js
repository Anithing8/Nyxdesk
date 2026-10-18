/* Nyxdesk Grid — spreadsheet */
(function(){
  "use strict";
  const N = window.Nyx, h = N.h, $ = s => document.querySelector(s);
  const DEFAULT_FONT = "-apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
  const COARSE = N.isCoarse();
  const HW0 = 46, HH0 = 28; let HW = HW0, HH = HH0;
  const MAXR = 5000, MAXC = 104;
  const colLetter = c => { let s = ""; c++; while(c){ c--; s = String.fromCharCode(65 + c % 26) + s; c = Math.floor(c / 26); } return s; };
  const ref = (r, c) => colLetter(c) + (r + 1);
  const parseRef = s => { const m = /^\$?([A-Z]+)\$?(\d+)$/i.exec(s); if(!m) return null; let c = 0; for(const ch of m[1].toUpperCase()) c = c * 26 + (ch.charCodeAt(0) - 64); return { r: +m[2] - 1, c: c - 1 }; };

  /* ---------- workbook state ---------- */
  let wb = { sheets: [newSheet("Sheet1")], active: 0 };
  function newSheet(name){ return { name, cells: {}, colW: {}, rowH: {}, merges: [], freeze: { r: 0, c: 0 }, filterOn: false, filters: {}, charts: [], notes: {}, nr: 100, nc: 26 }; }
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
    IFERROR: a => (a[0] === undefined || (typeof a[0] === "string" && /^#(ERR|DIV\/0!|N\/A|NAME\?|REF!|CYCLE)/.test(a[0]))) ? a[1] : a[0],
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
    if((out === "#ERR" || out === "#NAME?") && cl.cache != null && cl.cache !== ""){ const n = parseFloat(cl.cache); out = !isNaN(n) && String(n) === String(cl.cache).trim() ? n : cl.cache; }
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

  /* ====================================================================
     Grid UI. Cells are absolutely positioned and rows are virtualised, so a
     5,000-row sheet costs the same as a 50-row one. Selection only toggles CSS
     classes (no re-render). Mouse, pen and touch share one pointer-event path.
     ==================================================================== */
  const sheetEl = $("#sheet"), wrap = $("#gridwrap"), fi = $("#formulaInput");
  let sel = { r: 0, c: 0, r2: 0, c2: 0 };
  let colX = [0], rowTop = [0], rendered = { a: 0, b: 0 }, frozenRow = false, frozenCol = false, frH = 0, totalW = 0, bodyH = 0;
  let rangeMode = false, editing = null;
  const defRowH = COARSE ? 34 : 26;
  const bounds = () => ({ r0: Math.min(sel.r, sel.r2), r1: Math.max(sel.r, sel.r2), c0: Math.min(sel.c, sel.c2), c1: Math.max(sel.c, sel.c2) });
  const colW = c => sheet().colW[c] || (COARSE ? 104 : 96);
  const dispOf = (r, c) => { const v = evalCellValue(r, c); return v == null ? "" : String(v); };
  function rowHidden(r){
    const s = sheet(); if(!s.filterOn || r === 0) return false;
    for(const c in s.filters){ const hid = s.filters[c]; if(hid && hid.length && hid.includes(dispOf(r, +c))) return true; }
    return false;
  }
  const rowH = r => rowHidden(r) ? 0 : (sheet().rowH[r] || defRowH);
  function usedExtent(s){ let mr = 0, mc = 0; for(const k in s.cells){ const i = k.indexOf(":"); const r = +k.slice(0, i), c = +k.slice(i + 1); if(r > mr) mr = r; if(c > mc) mc = c; } return { r: mr, c: mc }; }
  function fitDims(){ const s = sheet(), u = usedExtent(s); s.nr = Math.min(MAXR, Math.max(s.nr || 100, u.r + 30, 100)); s.nc = Math.min(MAXC, Math.max(s.nc || 26, u.c + 4, 26)); }
  const raw = cl => cl ? (cl.f ? "=" + cl.f : (cl.v ?? "")) : "";
  const hasFmt = cl => cl && (cl.bold || cl.italic || cl.underline || cl.bg || cl.color || cl.align || cl.wrap || cl.fontFamily || cl.fontSize || cl.fmt || cl.border || cl.valid);

  /* ---------- undo / redo ---------- */
  const undoStack = [], redoStack = [];
  function snap(){ undoStack.push(JSON.stringify(wb)); if(undoStack.length > 60) undoStack.shift(); redoStack.length = 0; }
  function restore(json){ wb = JSON.parse(json); if(!wb.sheets[wb.active]) wb.active = 0; recalc(); renderTabs(); render(); updateFormulaBar(); updateStatus(); S.touch(); }
  function undo(){ if(!undoStack.length){ N.toast("Nothing to undo."); return; } redoStack.push(JSON.stringify(wb)); restore(undoStack.pop()); }
  function redo(){ if(!redoStack.length){ N.toast("Nothing to redo."); return; } undoStack.push(JSON.stringify(wb)); restore(redoStack.pop()); }
  function mutate(fn){ if(editing) cancelEditSilently(); snap(); fn(); recalc(); render(); updateFormulaBar(); updateStatus(); S.touch(); }

  /* ---------- formatting a value for display ---------- */
  function formatNum(v, fmt){
    if(fmt === "currency") return "$" + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if(fmt === "percent") return (v * 100).toFixed(1) + "%";
    if(fmt === "number") return v.toLocaleString(undefined, { maximumFractionDigits: 4 });
    if(fmt === "date"){ const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 864e5); return isNaN(d) ? String(v) : d.toLocaleDateString(undefined, { timeZone: "UTC" }); }
    return String(Math.round(v * 1e10) / 1e10);
  }

  /* ---------- merges ---------- */
  function mergeMap(){
    const m = {};
    sheet().merges.forEach(g => { for(let r = g.r0; r <= g.r1; r++) for(let c = g.c0; c <= g.c1; c++) m[r + ":" + c] = { g, origin: r === g.r0 && c === g.c0 }; });
    return m;
  }

  /* ---------- rendering ---------- */
  function render(){
    fitDims();
    const s = sheet(), nr = s.nr, nc = s.nc, showH = $("#headersChk").checked;
    HW = showH ? HW0 : 0; HH = showH ? HH0 : 0;
    colX = [0]; for(let c = 0; c < nc; c++) colX[c + 1] = colX[c] + colW(c);
    rowTop = [0]; for(let r = 0; r < nr; r++) rowTop[r + 1] = rowTop[r] + rowH(r);
    frozenRow = !!(s.freeze && s.freeze.r > 0); frozenCol = !!(s.freeze && s.freeze.c > 0);
    frH = frozenRow ? rowH(0) : 0;
    totalW = HW + colX[nc];
    const skip = frozenRow ? rowTop[1] : 0;
    bodyH = rowTop[nr] - skip;
    const by = r => rowTop[r] - skip;

    const vy0 = wrap.scrollTop - HH - frH, vy1 = vy0 + wrap.clientHeight + HH + frH;
    let a = frozenRow ? 1 : 0; while(a < nr - 1 && rowTop[a + 1] - skip < vy0) a++;
    let b = a; while(b < nr - 1 && rowTop[b] - skip < vy1) b++;
    a = Math.max(frozenRow ? 1 : 0, a - 8); b = Math.min(nr - 1, b + 8);
    rendered = { a, b };

    const mm = mergeMap();
    const keepEditor = editing && editing.inp;
    sheetEl.querySelectorAll(":scope>.layer,:scope>.chart-obj").forEach(e => e.remove());
    sheetEl.style.width = totalW + "px"; sheetEl.style.height = (HH + frH + bodyH) + "px";

    const top = h("div", { class: "layer toplayer", style: { height: (HH + frH) + "px", width: totalW + "px" } });
    if(showH){
      top.append(h("div", { class: "gh-corner", style: { width: HW + "px", height: HH + "px" } }));
      for(let c = 0; c < nc; c++) top.append(h("div", { class: "gh-col", "data-c": c, style: { left: (HW + colX[c]) + "px", width: colW(c) + "px", height: HH + "px" } },
        colLetter(c), h("div", { class: "colresize", "data-rc": c })));
    }
    if(frozenRow) top.append(buildRow(0, HH, mm, true));
    const body = h("div", { class: "layer bodylayer", style: { top: (HH + frH) + "px", height: bodyH + "px", width: totalW + "px" } });
    for(let r = a; r <= b; r++){ if(rowH(r) === 0) continue; body.append(buildRow(r, by(r), mm, false)); }
    sheetEl.prepend(body); sheetEl.prepend(top);
    renderCharts();
    sheetEl.style.setProperty("--sl", wrap.scrollLeft + "px");
    if(keepEditor) sheetEl.append(editing.inp);
    paintHeaders();
  }
  function buildRow(r, y, mm, inTop){
    const row = h("div", { class: "gridrow", "data-r": r, style: { top: y + "px", height: rowH(r) + "px", width: totalW + "px" } });
    if(HW) row.append(h("div", { class: "gh-row", "data-r": r, style: { width: HW + "px", height: rowH(r) + "px" } }, String(r + 1), h("div", { class: "rowresize", "data-rr": r })));
    const nc = sheet().nc;
    for(let c = 0; c < nc; c++){ const el = mkCell(r, c, mm); if(el) row.append(el); }
    return row;
  }
  function mkCell(r, c, mm){
    const mk = mm[r + ":" + c]; if(mk && !mk.origin) return null;
    const s = sheet(), cl = cell(r, c);
    let w = colW(c), hh = rowH(r);
    if(mk){ w = colX[mk.g.c1 + 1] - colX[mk.g.c0]; hh = rowTop[mk.g.r1 + 1] - rowTop[mk.g.r0]; }
    const ev = cl ? evalCellValue(r, c) : "";
    let txt = ev;
    if(cl && cl.f && $("#showFormulasChk").checked) txt = "=" + cl.f;
    else if(typeof ev === "number") txt = formatNum(ev, cl && cl.fmt);
    else if(typeof ev === "boolean") txt = ev ? "TRUE" : "FALSE";
    const isNum = typeof ev === "number" && !($("#showFormulasChk").checked && cl && cl.f);
    const st = { left: (HW + colX[c]) + "px", width: w + "px", height: hh + "px" };
    if(frozenCol && c === 0) st.left = "calc(" + HW + "px + var(--sl,0px))";
    if(cl){
      if(cl.bold) st.fontWeight = "700"; if(cl.italic) st.fontStyle = "italic"; if(cl.underline) st.textDecoration = "underline";
      if(cl.bg) st.background = cl.bg; if(cl.color) st.color = cl.color; if(cl.align) st.textAlign = cl.align;
      if(cl.wrap){ st.whiteSpace = "normal"; st.wordBreak = "break-word"; st.lineHeight = "1.25"; }
      if(cl.fontFamily) st.fontFamily = cl.fontFamily; if(cl.fontSize) st.fontSize = cl.fontSize + "px";
      if(cl.border) Object.assign(st, cl.border);
    }
    let cls = "cell" + (isNum && !(cl && cl.align) ? " num" : "") + (mk ? " merged" : "") + (frozenCol && c === 0 ? " frz" : "");
    if(typeof ev === "string" && /^#(ERR|DIV|N\/A|NAME|REF|CYCLE)/.test(ev)) cls += " err";
    const div = h("div", { class: cls, style: st, "data-r": r, "data-c": c }, String(txt ?? ""));
    if(s.notes[key(r, c)]) div.append(h("div", { class: "note-dot" }));
    if(cl && cl.valid) div.append(h("span", { class: "dd", "aria-hidden": "true" }, "▾"));
    if(s.filterOn && r === 0) div.append(h("button", { class: "fbtn" + ((s.filters[c] || []).length ? " on" : ""), type: "button", "data-fc": c, "aria-label": "Filter column " + colLetter(c) }, N.icEl("filter")));
    paintCell(div, r, c);
    return div;
  }
  function paintCell(el, r, c){
    const b = bounds(), inR = r >= b.r0 && r <= b.r1 && c >= b.c0 && c <= b.c1;
    el.classList.toggle("sel", r === sel.r && c === sel.c);
    el.classList.toggle("inrange", inR && !(r === sel.r && c === sel.c));
  }
  function paintHeaders(){
    const b = bounds();
    sheetEl.querySelectorAll(".gh-col").forEach(e => e.classList.toggle("sel", +e.dataset.c >= b.c0 && +e.dataset.c <= b.c1));
    sheetEl.querySelectorAll(".gh-row").forEach(e => e.classList.toggle("sel", +e.dataset.r >= b.r0 && +e.dataset.r <= b.r1));
  }
  function paintSel(){ sheetEl.querySelectorAll(".cell").forEach(el => paintCell(el, +el.dataset.r, +el.dataset.c)); paintHeaders(); }

  /* re-window the rows when scrolling */
  let scrollRaf = 0;
  wrap.addEventListener("scroll", () => {
    sheetEl.style.setProperty("--sl", wrap.scrollLeft + "px");
    if(scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = 0;
      const skip = frozenRow ? rowTop[1] : 0, vy0 = wrap.scrollTop - HH - frH, vy1 = vy0 + wrap.clientHeight;
      const first = rowTop.findIndex(t => t - skip >= vy0), last = rowTop.findIndex(t => t - skip > vy1);
      const f = Math.max(0, (first < 0 ? sheet().nr : first) - 1), l = last < 0 ? sheet().nr - 1 : last;
      if(f < rendered.a + 2 && rendered.a > (frozenRow ? 1 : 0) || l > rendered.b - 2 && rendered.b < sheet().nr - 1) render();
    });
  }, { passive: true });

  function ensureVisible(r, c){
    const x0 = HW + colX[c], x1 = HW + colX[c + 1], skip = frozenRow ? rowTop[1] : 0;
    const frozenHere = frozenRow && r === 0;
    if(!frozenHere){
      const y0 = HH + frH + rowTop[r] - skip, y1 = HH + frH + rowTop[r + 1] - skip;
      if(y0 - frH - HH < wrap.scrollTop) wrap.scrollTop = Math.max(0, y0 - frH - HH);
      else if(y1 > wrap.scrollTop + wrap.clientHeight) wrap.scrollTop = y1 - wrap.clientHeight;
    }
    if(!(frozenCol && c === 0)){
      if(x0 - (frozenCol ? colW(0) : 0) - HW < wrap.scrollLeft) wrap.scrollLeft = Math.max(0, x0 - HW - (frozenCol ? colW(0) : 0));
      else if(x1 > wrap.scrollLeft + wrap.clientWidth) wrap.scrollLeft = x1 - wrap.clientWidth;
    }
  }

  /* ---------- selection ---------- */
  function setSel(r, c, r2, c2, scroll){
    const s = sheet();
    r = N.clamp(r, 0, s.nr - 1); c = N.clamp(c, 0, s.nc - 1);
    sel = { r, c, r2: r2 == null ? r : N.clamp(r2, 0, s.nr - 1), c2: c2 == null ? c : N.clamp(c2, 0, s.nc - 1) };
    paintSel(); updateFormulaBar(); updateStatus();
    if(scroll !== false) ensureVisible(sel.r2 !== sel.r || sel.c2 !== sel.c ? sel.r2 : sel.r, sel.r2 !== sel.r || sel.c2 !== sel.c ? sel.c2 : sel.c);
  }
  const rangeText = () => (sel.r === sel.r2 && sel.c === sel.c2) ? ref(sel.r, sel.c) : ref(Math.min(sel.r, sel.r2), Math.min(sel.c, sel.c2)) + ":" + ref(Math.max(sel.r, sel.r2), Math.max(sel.c, sel.c2));
  function updateFormulaBar(){
    $("#cellRef").textContent = rangeText();
    if(document.activeElement !== fi) fi.value = raw(cell(sel.r, sel.c));
    syncFormatButtons();
  }
  function syncFormatButtons(){
    const cl = cell(sel.r, sel.c) || {};
    $("#boldBtn").classList.toggle("on", !!cl.bold); $("#italicBtn").classList.toggle("on", !!cl.italic); $("#underlineBtn").classList.toggle("on", !!cl.underline);
    $("#wrapBtn").classList.toggle("on", !!cl.wrap);
    $("#fontFamily").value = cl.fontFamily || DEFAULT_FONT; $("#fontSize").value = cl.fontSize || 11; $("#numFmt").value = cl.fmt || "general";
  }
  function updateStatus(){
    $("#selInfo").textContent = rangeText();
    const b = bounds(); let sum = 0, n = 0;
    for(let r = b.r0; r <= Math.min(b.r1, b.r0 + 2000); r++) for(let c = b.c0; c <= b.c1; c++){ const v = evalCellValue(r, c); if(typeof v === "number"){ sum += v; n++; } }
    $("#aggInfo").textContent = n ? `Sum ${sum.toLocaleString()}  ·  Avg ${(sum / n).toLocaleString(undefined, { maximumFractionDigits: 2 })}  ·  Count ${n}` : "";
  }

  /* ---------- editing ---------- */
  function setCellRaw(r, c, text){
    const s = sheet();
    if(text === ""){ const cl = cell(r, c); if(cl){ cl.v = ""; cl.f = null; delete cl.cache; if(!hasFmt(cl)) delete s.cells[key(r, c)]; } return; }
    const cl = cell(r, c, true); delete cl.cache;
    if(text[0] === "="){ cl.f = text.slice(1); cl.v = ""; } else { cl.f = null; cl.v = text; }
  }
  function commitValue(r, c, text, move){
    const cl = cell(r, c);
    if(cl && cl.valid && text !== "" && !cl.valid.includes(text)){ N.toast("Not allowed here. Choose one of: " + cl.valid.join(", ")); updateFormulaBar(); return false; }
    if(text !== raw(cl)) mutate(() => setCellRaw(r, c, text));
    if(move === "down") setSel(Math.min(sheet().nr - 1, r + 1), c); else if(move === "right") setSel(r, c + 1); else if(move === "up") setSel(Math.max(0, r - 1), c); else if(move === "left") setSel(r, Math.max(0, c - 1)); else setSel(r, c, null, null, false);
    return true;
  }
  function startEdit(r, c, initial){
    if(editing) commitEdit();
    const cl = cell(r, c);
    if(initial == null && cl && cl.valid){ openValidMenu(r, c); return; }
    const skip = frozenRow ? rowTop[1] : 0;
    const y = (frozenRow && r === 0) ? HH : HH + frH + rowTop[r] - skip;
    const x = HW + colX[c];
    const inp = h("input", { class: "celleditor", type: "text", enterkeyhint: "done", autocomplete: "off", autocapitalize: "off", autocorrect: "off", spellcheck: false, "aria-label": "Edit cell " + ref(r, c),
      style: { left: (frozenCol && c === 0 ? "calc(" + x + "px + var(--sl,0px))" : x + "px"), top: y + "px", width: Math.max(colW(c), 150) + "px", height: Math.max(rowH(r), 30) + "px" } });
    inp.value = initial != null ? initial : raw(cl);
    sheetEl.append(inp);
    editing = { r, c, inp };
    inp.focus({ preventScroll: true });
    const L = inp.value.length; try{ inp.setSelectionRange(L, L); }catch(e){}
    ensureVisible(r, c);
    inp.addEventListener("input", () => { fi.value = inp.value; });
    inp.addEventListener("keydown", e => {
      /* stopPropagation: once the editor is gone the same keypress would otherwise reach the grid handler and move again */
      if(e.key === "Enter"){ e.preventDefault(); e.stopPropagation(); commitEdit(e.shiftKey ? "up" : "down"); }
      else if(e.key === "Tab"){ e.preventDefault(); e.stopPropagation(); commitEdit(e.shiftKey ? "left" : "right"); }
      else if(e.key === "Escape"){ e.preventDefault(); e.stopPropagation(); cancelEdit(); }
    });
    inp.addEventListener("blur", () => setTimeout(() => { if(editing && editing.inp === inp && document.activeElement !== fi) commitEdit(); }, 0));
  }
  function commitEdit(move){
    if(!editing) return;
    const { r, c, inp } = editing; const text = inp.value;
    editing = null; inp.remove();
    commitValue(r, c, text, move);
    if(!move) wrap.focus({ preventScroll: true });
  }
  function cancelEdit(){ if(!editing) return; const { inp } = editing; editing = null; inp.remove(); updateFormulaBar(); wrap.focus({ preventScroll: true }); }
  function cancelEditSilently(){ if(!editing) return; const { inp } = editing; editing = null; inp.remove(); }

  /* the formula bar is the other place to edit — and the easiest one on a phone */
  let barBefore = "";
  fi.addEventListener("focus", () => { if(editing) commitEdit(); barBefore = fi.value; });
  fi.addEventListener("keydown", e => {
    if(e.key === "Enter"){ e.preventDefault(); e.stopPropagation(); const v = fi.value; barBefore = v; commitValue(sel.r, sel.c, v, "down"); fi.blur(); }
    else if(e.key === "Escape"){ e.preventDefault(); e.stopPropagation(); fi.value = barBefore; fi.blur(); }
  });
  fi.addEventListener("blur", () => { if(fi.value !== barBefore){ const v = fi.value; barBefore = v; commitValue(sel.r, sel.c, v); } });
  $("#editBtn").addEventListener("click", () => startEdit(sel.r, sel.c));
  $("#rangeBtn").addEventListener("click", () => {
    rangeMode = !rangeMode; $("#rangeBtn").classList.toggle("on", rangeMode); $("#rangeBtn").setAttribute("aria-pressed", rangeMode); wrap.classList.toggle("rangemode", rangeMode);
    N.toast(rangeMode ? "Range select on: drag across cells. Tap the button again to scroll." : "Range select off.", 2400);
  });

  /* ---------- pointer input: mouse, pen and touch ---------- */
  let drag = null;
  function selectCol(c, extend){ const nr = sheet().nr; if(extend) setSel(0, sel.c, nr - 1, c, false); else setSel(0, c, nr - 1, c, false); }
  function selectRow(r, extend){ const nc = sheet().nc; if(extend) setSel(sel.r, 0, r, nc - 1, false); else setSel(r, 0, r, nc - 1, false); }
  wrap.addEventListener("pointerdown", e => {
    const t = e.target;
    if(t.closest(".celleditor")) return;
    const rc = t.closest(".colresize"), rr = t.closest(".rowresize");
    if(rc) return startResize(e, rc, "c", +rc.dataset.rc);
    if(rr) return startResize(e, rr, "r", +rr.dataset.rr);
    if(t.closest(".fbtn")) return;
    if(editing) commitEdit();
    const gc = t.closest(".gh-col"), gr = t.closest(".gh-row"), ce = t.closest(".cell");
    if(gc){ selectCol(+gc.dataset.c, e.shiftKey); return; }
    if(gr){ selectRow(+gr.dataset.r, e.shiftKey); return; }
    if(!ce) return;
    const r = +ce.dataset.r, c = +ce.dataset.c, touch = e.pointerType === "touch";
    if(!touch || rangeMode){
      if(e.shiftKey && !touch) setSel(sel.r, sel.c, r, c); else setSel(r, c);
      drag = { id: e.pointerId, anchor: e.shiftKey && !touch ? { r: sel.r, c: sel.c } : { r, c }, x: e.clientX, y: e.clientY, captured: false };
    }else{
      const single = sel.r === r && sel.c === c && sel.r2 === r && sel.c2 === c;
      drag = { id: e.pointerId, tap: true, x: e.clientX, y: e.clientY, t: performance.now(), r, c, was: single };
    }
  });
  wrap.addEventListener("pointermove", e => {
    if(!drag || e.pointerId !== drag.id) return;
    if(drag.tap){ if(Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 9) drag = null; return; }
    /* capture only once a real drag begins — capturing on press would retarget click/dblclick to the container */
    if(!drag.captured){ if(Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 5) return; drag.captured = true; try{ wrap.setPointerCapture(e.pointerId); }catch(_){} }
    const el = document.elementFromPoint(e.clientX, e.clientY), ce = el && el.closest && el.closest(".cell");
    if(ce) setSel(drag.anchor.r, drag.anchor.c, +ce.dataset.r, +ce.dataset.c, false);
    const br = wrap.getBoundingClientRect(), m = 36;
    if(e.clientY > br.bottom - m) wrap.scrollTop += 16; else if(e.clientY < br.top + HH + m) wrap.scrollTop -= 16;
    if(e.clientX > br.right - m) wrap.scrollLeft += 16; else if(e.clientX < br.left + HW + m) wrap.scrollLeft -= 16;
  });
  wrap.addEventListener("pointerup", e => {
    if(!drag || e.pointerId !== drag.id) return;
    const d = drag; drag = null;
    if(d.tap && performance.now() - d.t < 700){ if(d.was) startEdit(d.r, d.c); else setSel(d.r, d.c); }
  });
  wrap.addEventListener("pointercancel", () => { drag = null; });
  wrap.addEventListener("dblclick", e => { const ce = e.target.closest(".cell"); if(ce && !editing && !e.target.closest(".fbtn")) startEdit(+ce.dataset.r, +ce.dataset.c); });
  wrap.addEventListener("click", e => {
    const fb = e.target.closest(".fbtn"); if(fb){ e.stopPropagation(); openFilter(+fb.dataset.fc, fb); }
  });

  function startResize(e, handle, kind, idx){
    e.preventDefault(); e.stopPropagation();
    const s = sheet(), x0 = e.clientX, y0 = e.clientY, w0 = colW(idx), h0 = s.rowH[idx] || defRowH;
    try{ handle.setPointerCapture(e.pointerId); }catch(_){}
    snap(); let raf = 0;
    const mv = ev => {
      if(kind === "c") s.colW[idx] = Math.max(28, w0 + ev.clientX - x0); else s.rowH[idx] = Math.max(16, h0 + ev.clientY - y0);
      if(!raf) raf = requestAnimationFrame(() => { raf = 0; render(); });
    };
    const up = () => { handle.removeEventListener("pointermove", mv); handle.removeEventListener("pointerup", up); handle.removeEventListener("pointercancel", up); render(); S.touch(); };
    handle.addEventListener("pointermove", mv); handle.addEventListener("pointerup", up); handle.addEventListener("pointercancel", up);
  }

  /* ---------- keyboard (hardware keyboards; phones use the cell editor and formula bar) ---------- */
  document.addEventListener("keydown", e => {
    const ae = document.activeElement;
    if(ae && (/^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName) || ae.isContentEditable)) return;
    if(document.querySelector(".dlg-back,.pop")) return;
    const mod = e.ctrlKey || e.metaKey, k = e.key;
    if(mod){
      const kk = k.toLowerCase();
      if(kk === "z"){ e.preventDefault(); e.shiftKey ? redo() : undo(); }
      else if(kk === "y"){ e.preventDefault(); redo(); }
      else if(kk === "c"){ e.preventDefault(); copySel(false); }
      else if(kk === "x"){ e.preventDefault(); copySel(true); }
      else if(kk === "v"){ e.preventDefault(); pasteSel(); }
      else if(kk === "a"){ e.preventDefault(); setSel(0, 0, sheet().nr - 1, sheet().nc - 1, false); }
      else if(kk === "b"){ e.preventDefault(); toggleFmt("bold"); }
      else if(kk === "i"){ e.preventDefault(); toggleFmt("italic"); }
      else if(kk === "u"){ e.preventDefault(); toggleFmt("underline"); }
      return;
    }
    if(k.length === 1 && !e.altKey){ e.preventDefault(); startEdit(sel.r, sel.c, k); return; }
    if(k === "F2"){ e.preventDefault(); startEdit(sel.r, sel.c); return; }
    if(k === "Delete" || k === "Backspace"){ e.preventDefault(); clearSel(); return; }
    const mv = { ArrowDown: [1, 0], ArrowUp: [-1, 0], ArrowRight: [0, 1], ArrowLeft: [0, -1], Enter: [e.shiftKey ? -1 : 1, 0], Tab: [0, e.shiftKey ? -1 : 1] }[k];
    if(mv){
      e.preventDefault();
      const s = sheet(), shift = e.shiftKey && k.startsWith("Arrow");
      const fr = shift ? sel.r2 : sel.r, fc = shift ? sel.c2 : sel.c;
      let nr_ = fr + mv[0], nc_ = fc + mv[1];
      if(nr_ >= s.nr && s.nr < MAXR){ s.nr = Math.min(MAXR, s.nr + 30); render(); }
      if(nc_ >= s.nc && s.nc < MAXC){ s.nc = Math.min(MAXC, s.nc + 4); render(); }
      if(shift) setSel(sel.r, sel.c, nr_, nc_); else setSel(nr_, nc_);
    }
  });
  function clearSel(){
    const b = bounds();
    mutate(() => { for(let r = b.r0; r <= b.r1; r++) for(let c = b.c0; c <= b.c1; c++) setCellRaw(r, c, ""); });
  }

  /* ---------- copy / paste ---------- */
  let clip = null, clipText = "", clipOrigin = null;
  const shiftFormula = (f, dr, dc) => mapRefs(f, (col, cabs, row, rabs) => {
    const c2 = cabs ? col : colLetter(Math.max(0, parseRef(col + "1").c + dc)), r2 = rabs ? row : Math.max(1, row + dr);
    return (cabs ? "$" : "") + c2 + (rabs ? "$" : "") + r2;
  });
  /* rewrite every A1-style reference in a formula, leaving text inside quotes and function names alone */
  function mapRefs(f, fn){
    return f.split('"').map((seg, i) => i % 2 ? seg : seg.replace(/(^|[^A-Za-z0-9_.])(\$?)([A-Z]{1,3})(\$?)(\d+)(?![\d(A-Za-z_])/g, (m, pre, ca, col, ra, row) => pre + fn(col, !!ca, +row, !!ra))).join('"');
  }
  async function copySel(cut){
    const b = bounds(); clip = []; const lines = [];
    for(let r = b.r0; r <= b.r1; r++){ const row = [], t = []; for(let c = b.c0; c <= b.c1; c++){ const cl = cell(r, c); row.push(cl ? JSON.parse(JSON.stringify(cl)) : null); t.push(dispOf(r, c).replace(/[\t\n]/g, " ")); } clip.push(row); lines.push(t.join("\t")); }
    clipText = lines.join("\n"); clipOrigin = { r: b.r0, c: b.c0 };
    try{ await navigator.clipboard.writeText(clipText); }catch(e){}
    if(cut) clearSel();
    N.toast(cut ? "Cut." : "Copied.", 1400);
  }
  async function pasteSel(){
    let text = null; try{ text = await navigator.clipboard.readText(); }catch(e){}
    const useInternal = clip && (text == null || text === clipText);
    if(!useInternal && (text == null || text === "")){ N.toast("Nothing to paste."); return; }
    mutate(() => {
      const s = sheet();
      if(useInternal){
        clip.forEach((row, i) => row.forEach((cl, j) => {
          const r = sel.r + i, c = sel.c + j; if(r >= MAXR || c >= MAXC) return;
          if(!cl){ delete s.cells[key(r, c)]; return; }
          const n = JSON.parse(JSON.stringify(cl)); if(n.f) n.f = shiftFormula(n.f, r - (clipOrigin.r + i), c - (clipOrigin.c + j));
          s.cells[key(r, c)] = n;
        }));
      }else{
        text.replace(/\r\n/g, "\n").split("\n").forEach((line, i, arr) => { if(i === arr.length - 1 && line === "") return; line.split("\t").forEach((v, j) => { if(sel.r + i < MAXR && sel.c + j < MAXC) setCellRaw(sel.r + i, sel.c + j, v); }); });
      }
    });
  }
  $("#copyBtn").addEventListener("click", () => copySel(false)); $("#pasteBtn").addEventListener("click", pasteSel);
  N.wireCmds($("#ribbon"), cmd => { if(cmd === "undo") undo(); else if(cmd === "redo") redo(); });

  /* ---------- formatting ---------- */
  function applyToSel(fn){
    const b = bounds();
    mutate(() => { for(let r = b.r0; r <= b.r1; r++) for(let c = b.c0; c <= b.c1; c++) fn(cell(r, c, true)); });
  }
  function toggleFmt(p){ const on = !(cell(sel.r, sel.c) || {})[p]; applyToSel(cl => { cl[p] = on; }); }
  $("#boldBtn").addEventListener("click", () => toggleFmt("bold"));
  $("#italicBtn").addEventListener("click", () => toggleFmt("italic"));
  $("#underlineBtn").addEventListener("click", () => toggleFmt("underline"));
  $("#wrapBtn").addEventListener("click", () => toggleFmt("wrap"));
  $("#alignLBtn").addEventListener("click", () => applyToSel(cl => cl.align = "left"));
  $("#alignCBtn").addEventListener("click", () => applyToSel(cl => cl.align = "center"));
  $("#alignRBtn").addEventListener("click", () => applyToSel(cl => cl.align = "right"));
  $("#fontFamily").addEventListener("change", e => applyToSel(cl => cl.fontFamily = e.target.value));
  $("#fontSize").addEventListener("change", e => applyToSel(cl => cl.fontSize = +e.target.value));
  $("#numFmt").addEventListener("change", e => applyToSel(cl => cl.fmt = e.target.value));
  $("#fillBtn").addEventListener("click", () => N.colorPick($("#fillBtn"), { onPick: c => { applyToSel(cl => cl.bg = c); $("#fillC").style.setProperty("--c", c || "transparent"); } }));
  $("#txColorBtn").addEventListener("click", () => N.colorPick($("#txColorBtn"), { onPick: c => { applyToSel(cl => cl.color = c); $("#txColorC").style.setProperty("--c", c || "#24221e"); } }));
  $("#borderBtn").addEventListener("click", () => N.menu($("#borderBtn"), [
    { label: "All borders", run: () => applyToSel(cl => cl.border = { border: "1px solid #8a7f78" }) },
    { label: "Bottom border", run: () => applyToSel(cl => cl.border = { borderBottom: "2px solid #8a7f78" }) },
    { label: "No borders", run: () => applyToSel(cl => cl.border = null) }
  ]));
  $("#mergeBtn").addEventListener("click", () => {
    const b = bounds(), s = sheet();
    const same = s.merges.findIndex(g => g.r0 === b.r0 && g.c0 === b.c0 && g.r1 === b.r1 && g.c1 === b.c1);
    if(same >= 0){ mutate(() => s.merges.splice(same, 1)); N.toast("Unmerged."); return; }
    if(b.r0 === b.r1 && b.c0 === b.c1){ N.toast("Select two or more cells to merge."); return; }
    mutate(() => {
      s.merges = s.merges.filter(g => g.r1 < b.r0 || g.r0 > b.r1 || g.c1 < b.c0 || g.c0 > b.c1);
      for(let r = b.r0; r <= b.r1; r++) for(let c = b.c0; c <= b.c1; c++) if(r !== b.r0 || c !== b.c0) setCellRaw(r, c, "");
      s.merges.push({ r0: b.r0, c0: b.c0, r1: b.r1, c1: b.c1 });
    });
  });

  /* ---------- insert / delete rows and columns (formulas follow) ---------- */
  function shiftAxis(axis, at, delta){
    const s = sheet(), isR = axis === "r";
    const mapIdx = i => { if(i < at) return i; if(delta < 0 && i === at) return -1; return i + delta; };
    const cells = {};
    for(const k in s.cells){
      const [r, c] = k.split(":").map(Number); const idx = isR ? r : c, n = mapIdx(idx);
      if(n < 0) continue;
      const cl = s.cells[k];
      cells[isR ? key(n, c) : key(r, n)] = cl;
    }
    for(const k in cells){
      const cl = cells[k]; if(!cl.f) continue;
      cl.f = mapRefs(cl.f, (col, ca, row, ra) => {
        let ci = parseRef(col + "1").c, ri = row - 1;
        const idx = isR ? ri : ci, n = mapIdx(idx);
        if(n < 0) return "#REF!";
        if(isR) ri = n; else ci = n;
        return (ca ? "$" : "") + colLetter(ci) + (ra ? "$" : "") + (ri + 1);
      });
    }
    s.cells = cells;
    const remap = obj => { const o = {}; for(const k in obj){ const n = mapIdx(+k); if(n >= 0) o[n] = obj[k]; } return o; };
    if(isR){ s.rowH = remap(s.rowH); } else { s.colW = remap(s.colW); }
    const nn = {}; for(const k in s.notes){ const [r, c] = k.split(":").map(Number); const idx = isR ? r : c, n = mapIdx(idx); if(n >= 0) nn[isR ? key(n, c) : key(r, n)] = s.notes[k]; } s.notes = nn;
    s.merges = s.merges.map(g => { const a0 = mapIdx(isR ? g.r0 : g.c0), a1 = mapIdx(isR ? g.r1 : g.c1); if(delta < 0 && (a0 < 0 || a1 < 0)) return null; return isR ? { ...g, r0: a0, r1: a1 } : { ...g, c0: a0, c1: a1 }; }).filter(Boolean);
    if(isR) s.nr = Math.min(MAXR, s.nr + delta); else s.nc = Math.min(MAXC, s.nc + delta);
  }
  $("#insRowBtn").addEventListener("click", () => { const b = bounds(); N.menu($("#insRowBtn"), [
    { label: "Insert row above", icon: "rowins", run: () => mutate(() => shiftAxis("r", b.r0, 1)) },
    { label: "Insert row below", icon: "rowins", run: () => mutate(() => shiftAxis("r", b.r1 + 1, 1)) },
    { label: "Delete row" + (b.r1 > b.r0 ? "s" : ""), icon: "trash", run: () => mutate(() => { for(let i = b.r1; i >= b.r0; i--) shiftAxis("r", i, -1); setSel(Math.min(b.r0, sheet().nr - 1), sel.c); }) }
  ]); });
  $("#insColBtn").addEventListener("click", () => { const b = bounds(); N.menu($("#insColBtn"), [
    { label: "Insert column left", icon: "colins", run: () => mutate(() => shiftAxis("c", b.c0, 1)) },
    { label: "Insert column right", icon: "colins", run: () => mutate(() => shiftAxis("c", b.c1 + 1, 1)) },
    { label: "Delete column" + (b.c1 > b.c0 ? "s" : ""), icon: "trash", run: () => mutate(() => { for(let i = b.c1; i >= b.c0; i--) shiftAxis("c", i, -1); setSel(sel.r, Math.min(b.c0, sheet().nc - 1)); }) }
  ]); });

  /* ---------- data tools ---------- */
  function regionFor(){
    const b = bounds(), u = usedExtent(sheet());
    if(b.r0 === b.r1 && b.c0 === b.c1) return { r0: 0, r1: u.r, c0: 0, c1: u.c, key: b.c0 };
    return { r0: b.r0, r1: b.r1, c0: b.c0, c1: b.c1, key: b.c0 };
  }
  function sortSel(dir){
    const g = regionFor(), s = sheet();
    const hdr = (s.filterOn || (s.freeze && s.freeze.r > 0)) && g.r0 === 0 ? 1 : 0;
    const rows = []; for(let r = g.r0 + hdr; r <= g.r1; r++){ const row = []; for(let c = g.c0; c <= g.c1; c++) row.push(cell(r, c) ? JSON.parse(JSON.stringify(cell(r, c))) : null); rows.push({ row, v: evalCellValue(r, g.key) }); }
    const cmp = (a, b) => { const x = a.v, y = b.v; if(x === "" && y !== "") return 1; if(y === "" && x !== "") return -1; if(typeof x === "number" && typeof y === "number") return x - y; return String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: "base" }); };
    rows.sort((a, b) => dir * cmp(a, b));
    mutate(() => rows.forEach((o, i) => o.row.forEach((cl, j) => { const k = key(g.r0 + hdr + i, g.c0 + j); if(cl) s.cells[k] = cl; else delete s.cells[k]; })));
    N.toast("Sorted " + (dir > 0 ? "A → Z" : "Z → A") + " by column " + colLetter(g.key) + ".");
  }
  $("#sortAzBtn").addEventListener("click", () => sortSel(1));
  $("#sortZaBtn").addEventListener("click", () => sortSel(-1));
  $("#filterChk").addEventListener("change", e => { snap(); sheet().filterOn = e.target.checked; if(!e.target.checked) sheet().filters = {}; recalc(); render(); S.touch(); if(e.target.checked) N.toast("Filter on: use the arrow in each row-1 cell."); });
  $("#freezeChk").addEventListener("change", e => { snap(); sheet().freeze = e.target.checked ? { r: 1, c: 1 } : { r: 0, c: 0 }; render(); S.touch(); });
  function openFilter(c, anchor){
    const s = sheet(), u = usedExtent(s), vals = new Set();
    for(let r = 1; r <= u.r; r++) vals.add(dispOf(r, c));
    const list = [...vals].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const hidden = new Set(s.filters[c] || []), boxes = [];
    const box = h("div", { style: { minWidth: "220px" } });
    const listEl = h("div", { style: { maxHeight: "40vh", overflow: "auto", padding: "4px 6px" } });
    list.forEach(v => { const cb = h("input", { type: "checkbox", checked: !hidden.has(v) }); boxes.push([v, cb]); listEl.append(h("label", { class: "chk", style: { display: "flex", gap: "10px", padding: "8px 4px", minHeight: "40px", alignItems: "center" } }, cb, v === "" ? "(blank)" : v)); });
    const P = N.pop(anchor, box);
    box.append(listEl, h("div", { class: "row", style: { justifyContent: "flex-end", gap: "6px", padding: "6px" } },
      h("button", { class: "btn sm", type: "button", onclick: () => { boxes.forEach(([, cb]) => cb.checked = true); } }, "All"),
      h("button", { class: "btn sm pri", type: "button", onclick: () => { s.filters[c] = boxes.filter(([, cb]) => !cb.checked).map(([v]) => v); P.close(); render(); S.touch(); } }, "Apply")));
  }
  $("#dedupBtn").addEventListener("click", () => {
    const g = regionFor(), seen = new Set(), s = sheet(); let removed = 0;
    mutate(() => { for(let r = g.r0; r <= g.r1; r++){ const k = Array.from({ length: g.c1 - g.c0 + 1 }, (_, i) => dispOf(r, g.c0 + i)).join("\u0001"); if(k.replace(/\u0001/g, "") === "") continue; if(seen.has(k)){ for(let c = g.c0; c <= g.c1; c++) setCellRaw(r, c, ""); removed++; } else seen.add(k); } });
    N.toast(removed ? "Cleared " + removed + " duplicate row" + (removed > 1 ? "s" : "") + "." : "No duplicates found.");
  });
  $("#validBtn").addEventListener("click", async () => {
    const cur = (cell(sel.r, sel.c) || {}).valid;
    const list = await N.prompt("Data validation", cur ? cur.join(", ") : "", { label: "Allowed values, separated by commas (leave empty to remove)" });
    if(list == null) return;
    const vals = list.split(",").map(x => x.trim()).filter(Boolean);
    applyToSel(cl => { if(vals.length) cl.valid = vals; else delete cl.valid; });
    N.toast(vals.length ? "Cells now accept only: " + vals.join(", ") : "Validation removed.");
  });
  function openValidMenu(r, c){
    const cl = cell(r, c), el = sheetEl.querySelector('.cell[data-r="' + r + '"][data-c="' + c + '"]');
    N.menu(el, cl.valid.map(v => ({ label: v, on: dispOf(r, c) === v, run: () => commitValue(r, c, v) })).concat(["-", { label: "Clear", run: () => commitValue(r, c, "") }]));
  }
  $("#gridlinesChk").addEventListener("change", e => document.body.classList.toggle("show-grid", e.target.checked));
  document.body.classList.add("show-grid");
  $("#headersChk").addEventListener("change", () => { render(); });
  $("#showFormulasChk").addEventListener("change", render);

  /* ---------- notes / links / images ---------- */
  $("#insNoteBtn").addEventListener("click", async () => {
    const cur = sheet().notes[key(sel.r, sel.c)] || "";
    const t = await N.prompt("Note", cur, { label: "Note for " + ref(sel.r, sel.c) + " (empty removes it)" }); if(t == null) return;
    mutate(() => { if(t) sheet().notes[key(sel.r, sel.c)] = t; else delete sheet().notes[key(sel.r, sel.c)]; });
  });
  $("#insLinkBtn").addEventListener("click", async () => { const t = await N.prompt("Insert link", "https://", { label: "URL" }); if(t) commitValue(sel.r, sel.c, t); });
  $("#insImgBtn").addEventListener("click", () => N.toast("Images aren't supported in sheets — use Inkwell or Marquee for pictures."));
  $("#fnBtn").addEventListener("click", () => {
    const box = h("div", { class: "list" });
    Object.keys(FUNCS).sort().forEach(f => box.append(h("button", { class: "list-i", type: "button", onclick: () => { D.close(); startEdit(sel.r, sel.c, "=" + f + "("); } }, h("span", { class: "t" }, f))));
    const D = N.dialog({ title: "Insert function", width: 320, body: box, buttons: [{ label: "Close" }] });
  });

  /* ---------- charts ---------- */
  function renderCharts(){ sheet().charts.forEach(ch => sheetEl.append(buildChart(ch))); }
  function buildChart(ch){
    const [cells, dim] = rangeOf(ch.range);
    const rows = []; for(let i = 0; i < dim.rows; i++) rows.push(cells.slice(i * dim.cols, i * dim.cols + dim.cols));
    const labels = rows.map((r, i) => dim.cols > 1 ? String(r[0].val) : String(i + 1));
    const values = rows.map(r => num(r[r.length - 1].val));
    const w = ch.w || 360, hh = ch.h || 240, vh = hh - 34;
    const NS_ = "http://www.w3.org/2000/svg", mk = (t, a) => { const e = document.createElementNS(NS_, t); for(const k in a) e.setAttribute(k, a[k]); return e; };
    const svg = mk("svg", { viewBox: `0 0 ${w} ${vh}`, width: "100%", height: vh + "px" });
    const max = Math.max(...values, 1), colors = ["#b06a73", "#a9824f", "#8c4a55", "#a3796d", "#6d8a6a", "#7c7aa8"];
    if(ch.type === "pie"){
      const total = values.reduce((a, b) => a + Math.max(0, b), 0) || 1; let ang = -Math.PI / 2; const cx = w / 2, cy = vh / 2, R = Math.min(cx, cy) - 14;
      values.forEach((v, i) => { const a2 = ang + (Math.max(0, v) / total) * Math.PI * 2; const x1 = cx + R * Math.cos(ang), y1 = cy + R * Math.sin(ang), x2 = cx + R * Math.cos(a2), y2 = cy + R * Math.sin(a2); svg.append(mk("path", { d: `M${cx},${cy} L${x1},${y1} A${R},${R} 0 ${(a2 - ang) > Math.PI ? 1 : 0} 1 ${x2},${y2} Z`, fill: colors[i % colors.length] })); ang = a2; });
    }else{
      const padL = 8, padB = 18, plotW = w - padL - 8, plotH = vh - padB - 8, bw = plotW / Math.max(1, values.length);
      if(ch.type === "line"){
        let d = ""; values.forEach((v, i) => { const x = padL + bw * i + bw / 2, y = 8 + plotH - (Math.max(0, v) / max) * plotH; d += (i ? "L" : "M") + x + "," + y + " "; });
        svg.append(mk("path", { d, fill: "none", stroke: colors[0], "stroke-width": 2.5 }));
        values.forEach((v, i) => svg.append(mk("circle", { cx: padL + bw * i + bw / 2, cy: 8 + plotH - (Math.max(0, v) / max) * plotH, r: 3.5, fill: colors[0] })));
      }else values.forEach((v, i) => { const bh = (Math.max(0, v) / max) * plotH; svg.append(mk("rect", { x: padL + bw * i + bw * .15, y: 8 + plotH - bh, width: bw * .7, height: bh, fill: colors[i % colors.length], rx: 2 })); });
      if(values.length <= 14) labels.forEach((l, i) => { const t = mk("text", { x: padL + bw * i + bw / 2, y: vh - 4, "text-anchor": "middle", "font-size": 10, fill: "currentColor" }); t.textContent = l.slice(0, 8); svg.append(t); });
    }
    const box = h("div", { class: "chart-obj", style: { left: (ch.x || 260) + "px", top: (ch.y || 60) + "px", width: w + "px" } },
      h("div", { class: "chh" }, h("span", null, ch.title || "Chart"), h("span", { class: "sp" }),
        h("button", { class: "ib", type: "button", "aria-label": "Remove chart", onclick: () => mutate(() => { sheet().charts = sheet().charts.filter(x => x !== ch); }) }, N.icEl("x"))), svg);
    N.drag(box.querySelector(".chh"), { filter: e => !e.target.closest("button"), start: () => ({ ox: ch.x || 260, oy: ch.y || 60 }),
      move: (dx, dy, e, st) => { ch.x = st.ox + dx; ch.y = st.oy + dy; box.style.left = ch.x + "px"; box.style.top = ch.y + "px"; }, end: moved => { if(moved) S.touch(); } });
    box.querySelector(".chh").style.touchAction = "none";
    return box;
  }
  $("#insChartBtn").addEventListener("click", () => {
    const b = bounds(), u = usedExtent(sheet());
    const single = b.r0 === b.r1 && b.c0 === b.c1;
    const range = single ? ref(0, 0) + ":" + ref(u.r, Math.min(u.c, 1)) : ref(b.r0, b.c0) + ":" + ref(b.r1, b.c1);
    if(single && !Object.keys(sheet().cells).length){ N.toast("Type some data first, then select it and insert a chart."); return; }
    const add = type => mutate(() => sheet().charts.push({ range, type, x: Math.min(280, wrap.clientWidth * .3) + wrap.scrollLeft, y: 40 + wrap.scrollTop, w: Math.min(360, wrap.clientWidth - 24), h: 260, title: ({ bar: "Column", line: "Line", pie: "Pie" })[type] + " chart · " + range }));
    N.menu($("#insChartBtn"), [{ head: "Chart of " + range }, { label: "Column chart", run: () => add("bar") }, { label: "Line chart", run: () => add("line") }, { label: "Pie chart", run: () => add("pie") }]);
  });

  /* ---------- sheet tabs ---------- */
  function sheetMenu(anchor, i){
    const s = wb.sheets[i];
    N.menu(anchor, [
      { label: "Rename", icon: "pen", run: async () => { const n = await N.prompt("Rename sheet", s.name); if(n && n.trim()){ snap(); s.name = n.trim().slice(0, 31); renderTabs(); S.touch(); } } },
      { label: "Duplicate", icon: "copy", run: () => { snap(); const c = JSON.parse(JSON.stringify(s)); c.name += " copy"; wb.sheets.splice(i + 1, 0, c); wb.active = i + 1; recalc(); renderTabs(); render(); S.touch(); } },
      { label: "Delete", icon: "trash", disabled: wb.sheets.length < 2, run: async () => { if(await N.confirm("Delete “" + s.name + "”?", { ok: "Delete", danger: true })){ snap(); wb.sheets.splice(i, 1); wb.active = Math.min(wb.active, wb.sheets.length - 1); recalc(); renderTabs(); render(); S.touch(); } } }
    ]);
  }
  function addSheet(){ snap(); wb.sheets.push(newSheet("Sheet" + (wb.sheets.length + 1))); wb.active = wb.sheets.length - 1; recalc(); renderTabs(); render(); setSel(0, 0); S.touch(); }
  function renderTabs(){
    const box = $("#sheetTabs"); box.innerHTML = "";
    wb.sheets.forEach((s, i) => {
      const t = h("button", { class: "stab" + (i === wb.active ? " on" : ""), type: "button" }, s.name);
      t.addEventListener("click", () => { if(i === wb.active){ sheetMenu(t, i); return; } if(editing) commitEdit(); wb.active = i; recalc(); render(); setSel(0, 0); renderTabs(); S.touch(); });
      t.addEventListener("contextmenu", e => { e.preventDefault(); sheetMenu(t, i); });
      box.append(t);
    });
    box.append(h("button", { class: "stabadd", type: "button", title: "Add sheet", "aria-label": "Add sheet", onclick: addSheet }, N.icEl("plus")));
    const on = box.querySelector(".stab.on"); if(on && on.scrollIntoView) try{ on.scrollIntoView({ block: "nearest", inline: "nearest" }); }catch(e){}
  }
  $("#insSheetBtn").addEventListener("click", addSheet);

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

  const hex6 = c => /^#[0-9a-f]{6}$/i.test(c || "") ? c.slice(1).toUpperCase() : null;
  async function exportXlsx(){
    try{
      const JSZip = await N.lib("jszip"), zip = new JSZip();
      const fonts = ['<font><sz val="11"/><name val="Calibri"/></font>'], fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
      const xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'], xfIdx = {};
      const NF = { percent: 10, number: 4, date: 14, currency: 164 };
      function styleOf(cl){
        if(!cl || !(cl.bold || cl.italic || cl.underline || hex6(cl.color) || hex6(cl.bg) || (cl.fmt && cl.fmt !== "general") || cl.align || cl.wrap || cl.fontSize)) return 0;
        const k = JSON.stringify([cl.bold, cl.italic, cl.underline, cl.color, cl.bg, cl.fmt, cl.align, cl.wrap, cl.fontSize]);
        if(xfIdx[k] != null) return xfIdx[k];
        fonts.push(`<font>${cl.bold ? "<b/>" : ""}${cl.italic ? "<i/>" : ""}${cl.underline ? "<u/>" : ""}<sz val="${cl.fontSize || 11}"/>${hex6(cl.color) ? `<color rgb="FF${hex6(cl.color)}"/>` : ""}<name val="Calibri"/></font>`);
        let fillId = 0; if(hex6(cl.bg)){ fills.push(`<fill><patternFill patternType="solid"><fgColor rgb="FF${hex6(cl.bg)}"/><bgColor indexed="64"/></patternFill></fill>`); fillId = fills.length - 1; }
        const nf = NF[cl.fmt] || 0, al = (cl.align || cl.wrap) ? `<alignment${cl.align ? ` horizontal="${cl.align}"` : ""}${cl.wrap ? ' wrapText="1"' : ""}/>` : "";
        xfs.push(`<xf numFmtId="${nf}" fontId="${fonts.length - 1}" fillId="${fillId}" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyAlignment="1">${al}</xf>`);
        return xfIdx[k] = xfs.length - 1;
      }
      const prevActive = wb.active, sheetXmls = [];
      wb.sheets.forEach((s, i) => { wb.active = i; recalc(); sheetXmls.push(sheetXml(s, styleOf)); });
      wb.active = prevActive; recalc();
      zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${wb.sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`);
      zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
      const used = new Set(); const names = wb.sheets.map((s, i) => { let n = String(s.name).replace(/[\\\/?*\[\]:]/g, "_").slice(0, 31) || "Sheet" + (i + 1), k = n, j = 2; while(used.has(k.toLowerCase())) k = n.slice(0, 28) + " " + j++; used.add(k.toLowerCase()); return k; });
      zip.file("xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${N.esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`);
      zip.file("xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${wb.sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
      zip.file("xl/styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0.00"/></numFmts><fonts count="${fonts.length}">${fonts.join("")}</fonts><fills count="${fills.length}">${fills.join("")}</fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${xfs.length}">${xfs.join("")}</cellXfs></styleSheet>`);
      sheetXmls.forEach((x, i) => zip.file(`xl/worksheets/sheet${i + 1}.xml`, x));
      N.download(await zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), fileBase() + ".xlsx");
    }catch(e){ console.error(e); N.alert("Couldn't build the Excel file: " + e.message); }
  }
  function sheetXml(s, styleOf){
    const u = usedExtent(s); let rowsXml = "";
    for(let r = 0; r <= u.r; r++){
      let rowXml = "";
      for(let c = 0; c <= u.c; c++){
        const cl = s.cells[key(r, c)]; if(!cl) continue;
        const cref = ref(r, c), si = styleOf(cl), sAttr = si ? ` s="${si}"` : "";
        if(cl.f){
          const v = evalCellValue(r, c);
          if(typeof v === "number") rowXml += `<c r="${cref}"${sAttr}><f>${N.esc(cl.f)}</f><v>${v}</v></c>`;
          else if(typeof v === "boolean") rowXml += `<c r="${cref}"${sAttr} t="b"><f>${N.esc(cl.f)}</f><v>${v ? 1 : 0}</v></c>`;
          else rowXml += `<c r="${cref}"${sAttr} t="str"><f>${N.esc(cl.f)}</f><v>${N.esc(String(v ?? ""))}</v></c>`;
        }else if(cl.v === "" || cl.v == null){ if(si) rowXml += `<c r="${cref}"${sAttr}/>`; }
        else{
          const n = parseFloat(cl.v);
          if(!isNaN(n) && String(n) === String(cl.v).trim()) rowXml += `<c r="${cref}"${sAttr}><v>${n}</v></c>`;
          else rowXml += `<c r="${cref}"${sAttr} t="inlineStr"><is><t xml:space="preserve">${N.esc(cl.v)}</t></is></c>`;
        }
      }
      if(rowXml) rowsXml += `<row r="${r + 1}">${rowXml}</row>`;
    }
    const cols = Object.keys(s.colW).map(Number).sort((a, b) => a - b).map(c => `<col min="${c + 1}" max="${c + 1}" width="${Math.max(2, (s.colW[c] - 5) / 7).toFixed(2)}" customWidth="1"/>`).join("");
    const fz = s.freeze && (s.freeze.r || s.freeze.c) ? `<sheetViews><sheetView workbookViewId="0"><pane xSplit="${s.freeze.c}" ySplit="${s.freeze.r}" topLeftCell="${ref(s.freeze.r, s.freeze.c)}" state="frozen"/></sheetView></sheetViews>` : "";
    const mg = s.merges.length ? `<mergeCells count="${s.merges.length}">${s.merges.map(g => `<mergeCell ref="${ref(g.r0, g.c0)}:${ref(g.r1, g.c1)}"/>`).join("")}</mergeCells>` : "";
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${fz}${cols ? `<cols>${cols}</cols>` : ""}<sheetData>${rowsXml}</sheetData>${mg}</worksheet>`;
  }
  async function importXlsx(file){
    const JSZip = await N.lib("jszip");
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const P = t => new DOMParser().parseFromString(t, "application/xml");
    const text = async p => { const f = zip.file(p); return f ? await f.async("text") : null; };
    let shared = [];
    const ssx = await text("xl/sharedStrings.xml");
    if(ssx) shared = [...P(ssx).getElementsByTagName("si")].map(si => [...si.getElementsByTagName("t")].filter(t => !t.parentNode || t.parentNode.localName !== "rPh").map(t => t.textContent).join(""));
    /* cell styles: bold / italic / colours / fills / number formats */
    const styles = [];
    const stx = await text("xl/styles.xml");
    if(stx){
      const sd = P(stx), kids = n => { const e = sd.getElementsByTagName(n)[0]; return e ? [...e.children] : []; };
      const fnt = kids("fonts").map(f => ({ bold: !!f.getElementsByTagName("b").length, italic: !!f.getElementsByTagName("i").length, underline: !!f.getElementsByTagName("u").length, color: ((f.getElementsByTagName("color")[0] || {}).getAttribute || (() => null)).call(f.getElementsByTagName("color")[0] || {}, "rgb") }));
      const fil = kids("fills").map(f => { const pf = f.getElementsByTagName("patternFill")[0], fg = pf && pf.getElementsByTagName("fgColor")[0]; return pf && pf.getAttribute("patternType") === "solid" && fg && fg.getAttribute("rgb") ? fg.getAttribute("rgb") : null; });
      const custom = {}; kids("numFmts").forEach(n => { custom[n.getAttribute("numFmtId")] = n.getAttribute("formatCode") || ""; });
      const fmtOf = id => { id = +id; if(id === 9 || id === 10) return "percent"; if(id === 3 || id === 4) return "number"; if(id >= 14 && id <= 22) return "date"; const code = custom[id]; if(!code) return null; if(/[$€£¥]/.test(code)) return "currency"; if(/%/.test(code)) return "percent"; if(/[dmy]/i.test(code.replace(/"[^"]*"/g, "")) && !/[#0]/.test(code)) return "date"; if(/0/.test(code)) return "number"; return null; };
      kids("cellXfs").forEach(x => {
        const f = fnt[+x.getAttribute("fontId")] || {}, bg = fil[+x.getAttribute("fillId")], st = {};
        if(f.bold) st.bold = true; if(f.italic) st.italic = true; if(f.underline) st.underline = true;
        if(f.color && f.color.length === 8 && f.color.slice(2) !== "000000") st.color = "#" + f.color.slice(2);
        if(bg && bg.length === 8 && bg !== "FFFFFFFF") st.bg = "#" + bg.slice(2);
        const fm = fmtOf(x.getAttribute("numFmtId")); if(fm) st.fmt = fm;
        const al = x.getElementsByTagName("alignment")[0]; if(al){ const hz = al.getAttribute("horizontal"); if(hz === "left" || hz === "center" || hz === "right") st.align = hz; if(al.getAttribute("wrapText") === "1") st.wrap = true; }
        styles.push(st);
      });
    }
    /* sheets, in workbook order, resolved through the relationships part */
    const wbx = P(await text("xl/workbook.xml")), relx = await text("xl/_rels/workbook.xml.rels");
    const rels = {}; if(relx) [...P(relx).getElementsByTagName("Relationship")].forEach(r => { rels[r.getAttribute("Id")] = r.getAttribute("Target"); });
    let list = [...wbx.getElementsByTagName("sheet")].map(sn => { const rid = sn.getAttribute("r:id") || sn.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id"); let t = rels[rid]; if(t) t = t.startsWith("/") ? t.slice(1) : "xl/" + t.replace(/^\.\//, ""); return { name: sn.getAttribute("name"), path: t }; });
    if(!list.length || list.some(x => !x.path || !zip.file(x.path))){
      const files = Object.keys(zip.files).filter(f => /^xl\/worksheets\/sheet\d+\.xml$/.test(f)).sort((a, b) => parseInt(a.match(/\d+/)[0]) - parseInt(b.match(/\d+/)[0]));
      list = files.map((f, i) => ({ name: (list[i] && list[i].name) || "Sheet" + (i + 1), path: f }));
    }
    const out = [];
    for(const it of list){
      const xml = P(await zip.file(it.path).async("text"));
      const s = newSheet((it.name || "Sheet").slice(0, 31)); let styled = 0;
      for(const cNode of xml.getElementsByTagName("c")){
        const p = parseRef(cNode.getAttribute("r")); if(!p || p.r >= MAXR || p.c >= MAXC) continue;
        const t = cNode.getAttribute("t"), sIdx = cNode.getAttribute("s");
        const fNode = cNode.getElementsByTagName("f")[0], vNode = cNode.getElementsByTagName("v")[0];
        let cl = null;
        if(fNode && fNode.textContent){ cl = { f: fNode.textContent, v: "", cache: vNode ? vNode.textContent : "" }; }
        else if(t === "s"){ const v = shared[+(vNode ? vNode.textContent : 0)]; if(v !== undefined && v !== "") cl = { v }; }
        else if(t === "inlineStr"){ const isn = cNode.getElementsByTagName("is")[0]; const v = isn ? isn.textContent : ""; if(v !== "") cl = { v }; }
        else if(t === "b"){ cl = { f: vNode && vNode.textContent === "1" ? "TRUE" : "FALSE", v: "" }; }
        else if(vNode && vNode.textContent !== "") cl = { v: vNode.textContent };
        const st = sIdx != null ? styles[+sIdx] : null;
        if(st && Object.keys(st).length){ if(cl) Object.assign(cl, st); else if(st.bg && styled < 4000){ cl = Object.assign({ v: "" }, st); styled++; } }
        if(cl) s.cells[key(p.r, p.c)] = cl;
      }
      for(const m of xml.getElementsByTagName("mergeCell")){ const [a, b] = (m.getAttribute("ref") || "").split(":").map(parseRef); if(a && b) s.merges.push({ r0: a.r, c0: a.c, r1: b.r, c1: b.c }); }
      for(const col of xml.getElementsByTagName("col")){ const mn = +col.getAttribute("min") - 1, mx = Math.min(+col.getAttribute("max") - 1, MAXC - 1), w = parseFloat(col.getAttribute("width")); if(w) for(let c = mn; c <= mx && c - mn < 200; c++) s.colW[c] = Math.round(w * 7 + 5); }
      const pane = xml.getElementsByTagName("pane")[0]; if(pane && pane.getAttribute("state") === "frozen") s.freeze = { r: +pane.getAttribute("ySplit") || 0, c: +pane.getAttribute("xSplit") || 0 };
      out.push(s);
    }
    wb = { sheets: out.length ? out : [newSheet("Sheet1")], active: 0 };
  }
  function fileBase(){ return ($("#docTitle").value || "spreadsheet").trim().replace(/[\\\/:*?"<>|]/g, "_") || "spreadsheet"; }

  const saveCsv = () => N.download("\ufeff" + toCSV(), fileBase() + ".csv", "text/csv;charset=utf-8");
  $("#fileMenuBtn").addEventListener("click", () => N.menu($("#fileMenuBtn"), [
    { icon: "newfile", label: "New spreadsheet", run: () => { wb = { sheets: [newSheet("Sheet1")], active: 0 }; $("#docTitle").value = "Untitled spreadsheet"; S.fresh(); } },
    { icon: "open", label: "Open…", run: async () => { const [f] = await N.pick(".xlsx,.csv,.tsv"); if(f) importFile(f); } },
    { icon: "files", label: "Saved on this device", run: () => S.library() },
    "-",
    { icon: "filedown", label: "Save as Excel (.xlsx)", run: exportXlsx },
    { icon: "filedown", label: "Save as CSV", run: saveCsv },
    "-",
    { icon: "print", label: "Print", run: () => window.print() }
  ]));
  $("#shareBtn").addEventListener("click", () => N.menu($("#shareBtn"), [
    { icon: "filedown", label: "Excel (.xlsx)", run: exportXlsx },
    { icon: "filedown", label: "CSV", run: saveCsv }
  ], { align: "right" }));
  async function importFile(file){
    const ext = file.name.split(".").pop().toLowerCase();
    try{
      if(ext === "xlsx") await importXlsx(file);
      else wb = { sheets: [fromCSV((await file.text()).replace(/^\ufeff/, ""), ext === "tsv" ? "\t" : ",")], active: 0 };
      undoStack.length = 0; redoStack.length = 0;
      $("#docTitle").value = file.name.replace(/\.[^.]+$/, "");
      recalc(); render(); renderTabs(); setSel(0, 0, null, null, false); S.touch(); N.toast("Opened " + file.name);
    }catch(e){ console.error(e); N.alert("Couldn't open that file. It may be damaged or use a feature Abacus can't read yet.\n\n" + e.message); }
  }
  N.dropFiles($("#gridwrap"), files => { const f = files[0]; if(f && /\.(xlsx|csv|tsv)$/i.test(f.name)) importFile(f); });

  /* ---------- autosave ---------- */
  const S = N.session({
    app: "abacus",
    getTitle: () => $("#docTitle").value || "Untitled spreadsheet",
    getData: async () => ({ title: $("#docTitle").value, wb }),
    setData: d => {
      wb = d.wb || wb;
      wb.sheets.forEach(s => { s.filters = s.filters || {}; s.merges = s.merges || []; s.notes = s.notes || {}; s.charts = s.charts || []; s.colW = s.colW || {}; s.rowH = s.rowH || {}; s.freeze = s.freeze || { r: 0, c: 0 }; s.nr = s.nr || 100; s.nc = s.nc || 26; });
      $("#docTitle").value = d.title || "Untitled spreadsheet"; recalc(); render(); renderTabs();
    }
  });
  $("#docTitle").addEventListener("input", () => S.touch());
  N.keys({ "ctrl+s": () => { S.flush(); N.toast("Saved."); return true; }, "ctrl+p": () => { window.print(); return true; } });

  (async function init(){
    N.ribbon($("#ribbon")); N.keepFocus($("#ribbon"));
    wrap.tabIndex = 0;
    const handed = await S.takeHandoff();
    if(handed) await importFile(handed);
    else{ const had = await S.load(); if(!had){ recalc(); render(); renderTabs(); } }
    setSel(0, 0, null, null, false);
  })();
})();
