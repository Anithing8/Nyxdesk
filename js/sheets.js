/* Nyxdesk Sheets — a small spreadsheet engine with multiple sheets,
   per-cell formatting, and a formula library (see FN below). */
(function(){
  const ROWS = 60;
  const COLS = 20; // A..T
  const STORAGE_KEY = "nyxdesk-sheet-v2";
  const TITLE_KEY = "nyxdesk-sheet-title";

  function emptySheet(name){ return { name: name || "Sheet1", raw: Array.from({length:ROWS},()=>Array(COLS).fill("")), fmt: {} }; }

  let workbook = { sheets: [ emptySheet("Sheet1") ], current: 0 };
  let selected = { r: 0, c: 0 };
  let sheetSeq = 2;

  function sheet(){ return workbook.sheets[workbook.current]; }
  function fmtOf(r,c){ return sheet().fmt[r+","+c] || {}; }

  function colName(c){
    let s = "";
    c += 1;
    while(c > 0){
      const rem = (c - 1) % 26;
      s = String.fromCharCode(65 + rem) + s;
      c = Math.floor((c - 1) / 26);
    }
    return s;
  }
  function cellId(r, c){ return colName(c) + (r + 1); }
  function parseRef(ref){
    const m = /^([A-Za-z]+)(\d+)$/.exec(ref.trim());
    if(!m) return null;
    let col = 0;
    const letters = m[1].toUpperCase();
    for(let i=0;i<letters.length;i++){ col = col*26 + (letters.charCodeAt(i) - 64); }
    col -= 1;
    const row = parseInt(m[2], 10) - 1;
    if(row < 0 || row >= ROWS || col < 0 || col >= COLS) return null;
    return { r: row, c: col };
  }

  // ---------- grid DOM ----------
  const table = document.getElementById("grid");
  function buildGrid(){
    let html = "<thead><tr><th></th>";
    for(let c=0;c<COLS;c++) html += `<th>${colName(c)}</th>`;
    html += "</tr></thead><tbody>";
    for(let r=0;r<ROWS;r++){
      html += `<tr><th>${r+1}</th>`;
      for(let c=0;c<COLS;c++){
        html += `<td data-r="${r}" data-c="${c}" contenteditable="true" spellcheck="false"></td>`;
      }
      html += "</tr>";
    }
    html += "</tbody>";
    table.innerHTML = html;
  }
  buildGrid();

  function cellEl(r,c){ return table.querySelector(`td[data-r="${r}"][data-c="${c}"]`); }

  // ---------- values ----------
  function getRaw(r,c){ const s = sheet(); return (s.raw[r] && s.raw[r][c] !== undefined) ? s.raw[r][c] : ""; }

  function computeValue(r, c, visiting){
    const key = r+","+c;
    if(visiting.has(key)) return "#CIRC!";
    const val = getRaw(r,c);
    if(val === "" || val === undefined) return "";
    if(typeof val === "number") return val;
    if(val[0] === "="){
      visiting.add(key);
      const result = evalFormula(val.slice(1), visiting);
      visiting.delete(key);
      return result;
    }
    const n = Number(val);
    return (val.trim() !== "" && !isNaN(n)) ? n : val;
  }

  function expandRange(a, b){
    const ra = parseRef(a), rb = parseRef(b);
    if(!ra || !rb) return [];
    const r0 = Math.min(ra.r, rb.r), r1 = Math.max(ra.r, rb.r);
    const c0 = Math.min(ra.c, rb.c), c1 = Math.max(ra.c, rb.c);
    const out = [];
    for(let r=r0;r<=r1;r++) for(let c=c0;c<=c1;c++) out.push([r,c]);
    return out;
  }

  function splitArgs(s){
    const out = []; let cur = ""; let q = false;
    for(let i=0;i<s.length;i++){
      const ch = s[i];
      if(ch === '"') q = !q;
      if(ch === "," && !q){ out.push(cur); cur = ""; }
      else cur += ch;
    }
    out.push(cur);
    return out.map(x=>x.trim()).filter(x=>x!=="");
  }

  function resolveExprToLiteral(expr, visiting){
    let e = expr.trim();
    e = e.replace(/[A-Za-z]+\d+/g, (ref) => {
      const p = parseRef(ref);
      if(!p) return "0";
      const v = computeValue(p.r, p.c, visiting);
      return typeof v === "number" ? String(v) : JSON.stringify(v === "" ? "" : String(v));
    });
    e = e.replace(/<>/g, "!==");
    e = e.replace(/([^<>=!])=(?!=)/g, "$1===");
    return e;
  }

  function scalarOf(argStr, visiting){
    const e = resolveExprToLiteral(argStr, visiting);
    try{
      if(/[;`{}\[\]]/.test(e)) return "#ERROR!";
      // eslint-disable-next-line no-new-func
      return Function('"use strict"; return (' + e + ")")();
    }catch(err){ return "#ERROR!"; }
  }

  function numbersFromArgs(args, visiting){
    const nums = [];
    args.forEach(part => {
      if(part.includes(":")){
        const [a,b] = part.split(":");
        expandRange(a,b).forEach(([r,c])=>{
          const v = computeValue(r,c,visiting);
          if(typeof v === "number") nums.push(v);
        });
      }else{
        const v = scalarOf(part, visiting);
        if(typeof v === "number") nums.push(v);
      }
    });
    return nums;
  }
  function valuesFromArgs(args, visiting){
    const vals = [];
    args.forEach(part => {
      if(part.includes(":")){
        const [a,b] = part.split(":");
        expandRange(a,b).forEach(([r,c])=> vals.push(computeValue(r,c,visiting)));
      }else{
        vals.push(scalarOf(part, visiting));
      }
    });
    return vals;
  }

  function parseCriteria(raw){
    const m = /^(<=|>=|<>|<|>|=)?(.*)$/.exec(String(raw).trim());
    return { op: m[1] || "=", rest: m[2] };
  }
  function matchesCriteria(val, crit){
    const num = parseFloat(crit.rest);
    const numeric = !isNaN(num) && typeof val === "number";
    switch(crit.op){
      case ">": return numeric ? val > num : String(val) > crit.rest;
      case "<": return numeric ? val < num : String(val) < crit.rest;
      case ">=": return numeric ? val >= num : String(val) >= crit.rest;
      case "<=": return numeric ? val <= num : String(val) <= crit.rest;
      case "<>": return numeric ? val !== num : String(val) !== crit.rest;
      default: return numeric ? val === num : String(val) === crit.rest;
    }
  }

  const FN = {
    SUM: (a,v) => numbersFromArgs(a,v).reduce((x,y)=>x+y,0),
    AVERAGE: (a,v) => { const n = numbersFromArgs(a,v); return n.length ? n.reduce((x,y)=>x+y,0)/n.length : 0; },
    MIN: (a,v) => { const n = numbersFromArgs(a,v); return n.length ? Math.min(...n) : 0; },
    MAX: (a,v) => { const n = numbersFromArgs(a,v); return n.length ? Math.max(...n) : 0; },
    COUNT: (a,v) => numbersFromArgs(a,v).length,
    COUNTA: (a,v) => valuesFromArgs(a,v).filter(x=>x!==""&&x!==undefined).length,
    IF: (a,v) => {
      const cond = scalarOf(a[0], v);
      const truthy = typeof cond === "number" ? cond !== 0 : (cond === true || String(cond).toLowerCase()==="true");
      const branch = truthy ? a[1] : (a[2] !== undefined ? a[2] : '""');
      return scalarOf(branch, v);
    },
    IFERROR: (a,v) => {
      let val = scalarOf(a[0], v);
      if(typeof val === "string" && val[0] === "#") return scalarOf(a[1], v);
      return val;
    },
    ROUND: (a,v) => { const n = Number(scalarOf(a[0],v)); const d = a[1]!==undefined ? Number(scalarOf(a[1],v)) : 0; const f = Math.pow(10,d); return Math.round(n*f)/f; },
    ABS: (a,v) => Math.abs(Number(scalarOf(a[0],v))),
    SQRT: (a,v) => Math.sqrt(Number(scalarOf(a[0],v))),
    POWER: (a,v) => Math.pow(Number(scalarOf(a[0],v)), Number(scalarOf(a[1],v))),
    CONCAT: (a,v) => a.map(x => String(scalarOf(x,v))).join(""),
    CONCATENATE: (a,v) => a.map(x => String(scalarOf(x,v))).join(""),
    AND: (a,v) => a.every(x => !!scalarOf(x,v)),
    OR: (a,v) => a.some(x => !!scalarOf(x,v)),
    NOT: (a,v) => !scalarOf(a[0],v),
    TRIM: (a,v) => String(scalarOf(a[0],v)).trim(),
    UPPER: (a,v) => String(scalarOf(a[0],v)).toUpperCase(),
    LOWER: (a,v) => String(scalarOf(a[0],v)).toLowerCase(),
    LEN: (a,v) => String(scalarOf(a[0],v)).length,
    TODAY: () => new Date().toLocaleDateString(),
    NOW: () => new Date().toLocaleString(),
    SUMIF: (a,v) => {
      const [rangeStr, critStr, sumStr] = a;
      const [ra,rb] = rangeStr.split(":");
      const cells = expandRange(ra, rb || ra);
      const sumCells = sumStr ? expandRange(...(sumStr.split(":").length>1?sumStr.split(":"):[sumStr,sumStr])) : cells;
      const crit = parseCriteria(scalarOf(critStr, v));
      let total = 0;
      cells.forEach(([r,c], i) => {
        const val = computeValue(r,c,v);
        if(matchesCriteria(val, crit)){
          const [sr,sc] = sumCells[i] || [r,c];
          const sv = computeValue(sr,sc,v);
          if(typeof sv === "number") total += sv;
        }
      });
      return total;
    },
    COUNTIF: (a,v) => {
      const [rangeStr, critStr] = a;
      const [ra,rb] = rangeStr.split(":");
      const cells = expandRange(ra, rb || ra);
      const crit = parseCriteria(scalarOf(critStr, v));
      return cells.filter(([r,c]) => matchesCriteria(computeValue(r,c,v), crit)).length;
    },
  };

  function replaceFunctionCalls(expr, visiting){
    let changed = true, i = 0;
    while(changed && i < 25){
      changed = false; i++;
      expr = expr.replace(/([A-Za-z_][A-Za-z0-9_]*)\(([^()]*)\)/g, (m, fn, argsStr) => {
        changed = true;
        const key = fn.toUpperCase();
        if(!FN[key]) return '"#NAME?"';
        const args = splitArgs(argsStr);
        let result;
        try{ result = FN[key](args, visiting); }catch(e){ result = "#ERROR!"; }
        return typeof result === "number" ? String(result) : JSON.stringify(String(result));
      });
    }
    return expr;
  }

  function evalFormula(expr, visiting){
    try{
      let e = replaceFunctionCalls(expr, visiting);
      e = resolveExprToLiteral(e, visiting);
      if(/[;`{}\[\]]/.test(e)) return "#ERROR!";
      // eslint-disable-next-line no-new-func
      const result = Function('"use strict"; return (' + e + ")")();
      if(typeof result === "number" && isFinite(result)) return round(result);
      return String(result);
    }catch(e){
      return "#ERROR!";
    }
  }
  function round(n){ return Math.round(n * 1e10) / 1e10; }

  // ---------- render ----------
  function renderAll(){
    for(let r=0;r<ROWS;r++){
      for(let c=0;c<COLS;c++){
        const el = cellEl(r,c);
        const v = computeValue(r,c, new Set());
        el.textContent = (v === "" || v === undefined) ? "" : String(v);
        el.classList.toggle("num", typeof v === "number");
        const f = fmtOf(r,c);
        el.style.fontWeight = f.bold ? "700" : "";
        el.style.fontStyle = f.italic ? "italic" : "";
        el.style.color = f.color || "";
        el.style.background = f.bg || "";
      }
    }
  }

  function selectCell(r,c){
    document.querySelectorAll("td.selected").forEach(el=>el.classList.remove("selected"));
    selected = {r,c};
    const el = cellEl(r,c);
    if(el) el.classList.add("selected");
    document.getElementById("cellRef").textContent = cellId(r,c);
    const input = document.getElementById("formulaInput");
    input.value = getRaw(r,c);
    const f = fmtOf(r,c);
    document.getElementById("boldBtn").classList.toggle("active", !!f.bold);
    document.getElementById("italicBtn").classList.toggle("active", !!f.italic);
  }

  table.addEventListener("click", (e)=>{
    const td = e.target.closest("td[data-r]");
    if(!td) return;
    selectCell(+td.dataset.r, +td.dataset.c);
  });
  table.addEventListener("focusin", (e)=>{
    const td = e.target.closest("td[data-r]");
    if(!td) return;
    selectCell(+td.dataset.r, +td.dataset.c);
  });
  table.addEventListener("blur", (e)=>{
    const td = e.target.closest("td[data-r]");
    if(!td) return;
    commitCell(+td.dataset.r, +td.dataset.c, td.textContent);
  }, true);

  table.addEventListener("keydown", (e)=>{
    const td = e.target.closest("td[data-r]");
    if(!td) return;
    const r = +td.dataset.r, c = +td.dataset.c;
    if(e.key === "Enter"){ e.preventDefault(); commitCell(r,c, td.textContent); moveSelection(r+1,c); }
    else if(e.key === "Tab"){ e.preventDefault(); commitCell(r,c, td.textContent); moveSelection(r, c + (e.shiftKey?-1:1)); }
    else if(e.key === "Escape"){ td.textContent = getRaw(r,c); td.blur(); }
    else if(["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].includes(e.key)){
      e.preventDefault();
      const d = {ArrowUp:[-1,0],ArrowDown:[1,0],ArrowLeft:[0,-1],ArrowRight:[0,1]}[e.key];
      commitCell(r,c, td.textContent);
      moveSelection(r+d[0], c+d[1]);
    }
  });
  function moveSelection(r,c){
    r = Math.max(0, Math.min(ROWS-1, r));
    c = Math.max(0, Math.min(COLS-1, c));
    const el = cellEl(r,c);
    if(el){ el.focus(); placeCaretEnd(el); selectCell(r,c); }
  }
  function placeCaretEnd(el){
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges(); sel.addRange(range);
  }
  function commitCell(r,c,value){
    sheet().raw[r][c] = value;
    renderAll();
    scheduleSave();
  }

  const formulaInput = document.getElementById("formulaInput");
  formulaInput.addEventListener("keydown", (e)=>{
    if(e.key === "Enter"){
      e.preventDefault();
      sheet().raw[selected.r][selected.c] = formulaInput.value;
      renderAll(); scheduleSave();
      moveSelection(selected.r+1, selected.c);
    }
  });
  formulaInput.addEventListener("input", ()=>{
    sheet().raw[selected.r][selected.c] = formulaInput.value;
    const el = cellEl(selected.r, selected.c);
    if(el) el.textContent = formulaInput.value;
  });
  formulaInput.addEventListener("blur", ()=>{ renderAll(); scheduleSave(); });

  // ---------- formatting ----------
  window.toggleFormat = function(kind){
    const key = selected.r + "," + selected.c;
    const s = sheet();
    const f = Object.assign({}, s.fmt[key]);
    f[kind] = !f[kind];
    s.fmt[key] = f;
    renderAll(); scheduleSave(); selectCell(selected.r, selected.c);
  };
  window.applyColor = function(kind, value){
    const key = selected.r + "," + selected.c;
    const s = sheet();
    const f = Object.assign({}, s.fmt[key]);
    f[kind] = value;
    s.fmt[key] = f;
    renderAll(); scheduleSave();
  };
  window.clearFormat = function(){
    const key = selected.r + "," + selected.c;
    delete sheet().fmt[key];
    renderAll(); scheduleSave(); selectCell(selected.r, selected.c);
  };

  // ---------- sort ----------
  window.sortColumn = function(ascending){
    const s = sheet();
    const col = selected.c;
    const indices = [...Array(ROWS).keys()];
    indices.sort((ra,rb)=>{
      const va = computeValue(ra,col,new Set());
      const vb = computeValue(rb,col,new Set());
      const na = typeof va === "number", nb = typeof vb === "number";
      if(va === "" && vb === "") return 0;
      if(va === "") return 1;
      if(vb === "") return -1;
      if(na && nb) return ascending ? va-vb : vb-va;
      return ascending ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
    });
    const newRaw = indices.map(i => s.raw[i]);
    const newFmt = {};
    indices.forEach((oldR,newR)=>{
      for(let c=0;c<COLS;c++){
        const k = oldR+","+c;
        if(s.fmt[k]) newFmt[newR+","+c] = s.fmt[k];
      }
    });
    s.raw = newRaw; s.fmt = newFmt;
    renderAll(); scheduleSave();
    nyxToast("Sorted by column " + colName(col) + ".");
  };

  // ---------- sheet tabs ----------
  function renderTabs(){
    const wrap = document.getElementById("sheetTabs");
    wrap.innerHTML = "";
    workbook.sheets.forEach((s,i)=>{
      const tab = document.createElement("div");
      tab.className = "tab" + (i===workbook.current ? " active" : "");
      tab.innerHTML = `<span>${escapeHtml(s.name)}</span>` + (workbook.sheets.length>1 ? `<span class="tabx" title="Delete sheet">✕</span>` : "");
      tab.addEventListener("click",(e)=>{
        if(e.target.classList.contains("tabx")){
          if(!confirm(`Delete "${s.name}"?`)) return;
          workbook.sheets.splice(i,1);
          if(workbook.current>=workbook.sheets.length) workbook.current = workbook.sheets.length-1;
          renderTabs(); renderAll(); scheduleSave(); selectCell(0,0);
          return;
        }
        workbook.current = i;
        renderTabs(); renderAll(); selectCell(0,0);
      });
      tab.addEventListener("dblclick", ()=>{
        const name = prompt("Rename sheet", s.name);
        if(name && name.trim()){ s.name = name.trim(); renderTabs(); scheduleSave(); }
      });
      wrap.appendChild(tab);
    });
    const add = document.createElement("button");
    add.className = "tab-add"; add.textContent = "+";
    add.title = "Add sheet";
    add.onclick = ()=>{
      workbook.sheets.push(emptySheet("Sheet"+(sheetSeq++)));
      workbook.current = workbook.sheets.length-1;
      renderTabs(); renderAll(); scheduleSave(); selectCell(0,0);
    };
    wrap.appendChild(add);
  }
  function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }

  // ---------- autosave ----------
  let saveTimer;
  function scheduleSave(){
    clearTimeout(saveTimer);
    saveTimer = setTimeout(()=> localStorage.setItem(STORAGE_KEY, JSON.stringify(workbook)), 400);
  }
  (function restore(){
    try{
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if(saved && saved.sheets && saved.sheets.length) workbook = saved;
      const title = localStorage.getItem(TITLE_KEY);
      if(title) document.getElementById("sheetTitle").value = title;
    }catch(e){ /* ignore */ }
    renderTabs(); renderAll(); selectCell(0,0);
  })();
  document.getElementById("sheetTitle").addEventListener("input", e => localStorage.setItem(TITLE_KEY, e.target.value));

  // ---------- menu ----------
  window.toggleMenu = function(id){
    document.querySelectorAll(".menu.open").forEach(m => { if(m.id!==id) m.classList.remove("open"); });
    document.getElementById(id).classList.toggle("open");
  };
  document.addEventListener("click", (e)=>{
    document.querySelectorAll(".menu.open").forEach(m=>{ if(!m.contains(e.target)) m.classList.remove("open"); });
  });

  window.newSheet = function(){
    if(!confirm("Start a new spreadsheet? Unsaved changes will be lost.")) return;
    workbook = { sheets: [ emptySheet("Sheet1") ], current: 0 };
    sheetSeq = 2;
    document.getElementById("sheetTitle").value = "Untitled spreadsheet";
    localStorage.removeItem(STORAGE_KEY);
    renderTabs(); renderAll(); selectCell(0,0);
  };

  window.triggerOpen = function(){ document.getElementById("openInput").click(); };
  document.getElementById("openInput").addEventListener("change", async (e)=>{
    const file = e.target.files[0];
    if(!file) return;
    document.getElementById("sheetTitle").value = file.name.replace(/\.[^.]+$/, "");
    try{
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const newSheets = wb.SheetNames.map(name => {
        const ws = wb.Sheets[name];
        const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" });
        const s = emptySheet(name);
        for(let r=0;r<Math.min(ROWS, aoa.length);r++){
          for(let c=0;c<Math.min(COLS, aoa[r].length);c++){
            const v = aoa[r][c];
            s.raw[r][c] = (v === undefined || v === null) ? "" : String(v);
          }
        }
        return s;
      });
      workbook = { sheets: newSheets.length ? newSheets : [emptySheet("Sheet1")], current: 0 };
      renderTabs(); renderAll(); selectCell(0,0); scheduleSave();
      nyxToast("Spreadsheet imported.");
    }catch(err){
      console.error(err);
      alert("Couldn't read that file. It may be corrupted or in an unsupported format.");
    }
    e.target.value = "";
  });

  // ---------- save / export ----------
  window.saveAs = function(kind){
    const title = (document.getElementById("sheetTitle").value || "spreadsheet").trim();
    if(kind === "csv"){
      const trimmed = trimmedAoa(sheet());
      const csv = trimmed.map(row => row.map(csvEscape).join(",")).join("\r\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      nyxDownloadBlob(blob, title + ".csv");
      return;
    }
    if(kind === "xlsx"){
      const wb = XLSX.utils.book_new();
      workbook.sheets.forEach(s => {
        const ws = XLSX.utils.aoa_to_sheet(trimmedAoa(s));
        XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0,31));
      });
      const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
      const blob = new Blob([out], { type: "application/octet-stream" });
      nyxDownloadBlob(blob, title + ".xlsx");
      return;
    }
  };
  function trimmedAoa(s){
    let maxR=0, maxC=0;
    const aoa = [];
    for(let r=0;r<ROWS;r++){
      const row = [];
      for(let c=0;c<COLS;c++){
        const val = s.raw[r][c];
        const v = val && val[0]==="=" ? computeAt(s,r,c) : (isNaN(Number(val)) || val==="" ? val : Number(val));
        row.push(v === undefined ? "" : v);
        if(v !== "" && v !== undefined){ maxR = Math.max(maxR,r); maxC = Math.max(maxC,c); }
      }
      aoa.push(row);
    }
    return aoa.slice(0,maxR+1).map(row=>row.slice(0,maxC+1));
  }
  function computeAt(s,r,c){
    const prevCurrent = workbook.current;
    workbook.current = workbook.sheets.indexOf(s);
    const v = computeValue(r,c,new Set());
    workbook.current = prevCurrent;
    return v;
  }
  function csvEscape(v){
    const s = String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g,'""') + '"' : s;
  }

  // ---------- formula reference ----------
  window.showFnHelp = function(){
    alert(
      "Nyxdesk Sheets — supported functions\n\n" +
      "SUM, AVERAGE, MIN, MAX, COUNT, COUNTA\n" +
      "IF, IFERROR, AND, OR, NOT\n" +
      "ROUND, ABS, SQRT, POWER\n" +
      "CONCAT / CONCATENATE, TRIM, UPPER, LOWER, LEN\n" +
      "SUMIF, COUNTIF (criteria like \">10\" or \"Yes\")\n" +
      "TODAY, NOW\n\n" +
      "Reference a cell as A1, a range as A1:A9. Formulas work within the active sheet only."
    );
  };
})();
