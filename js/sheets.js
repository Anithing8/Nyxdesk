/* Nyxdesk Sheets — a small spreadsheet engine.
   Supports literal numbers/text and formulas: =A1+B2, =SUM(A1:A9),
   =AVERAGE(...), =MIN(...), =MAX(...), =COUNT(...), plus + - * / ( ). */
(function(){
  const ROWS = 60;
  const COLS = 20; // A..T
  const STORAGE_KEY = "nyxdesk-sheet-v1";
  const TITLE_KEY = "nyxdesk-sheet-title";

  /** raw[row][col] = string the user typed (may start with '=') */
  let raw = Array.from({length: ROWS}, () => Array(COLS).fill(""));
  let selected = { r: 0, c: 0 };

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

  // ---------- formula evaluation ----------
  function getRaw(r,c){ return (raw[r] && raw[r][c] !== undefined) ? raw[r][c] : ""; }

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

  const FN = {
    SUM: (nums) => nums.reduce((a,b)=>a+b, 0),
    AVERAGE: (nums) => nums.length ? nums.reduce((a,b)=>a+b,0)/nums.length : 0,
    MIN: (nums) => nums.length ? Math.min(...nums) : 0,
    MAX: (nums) => nums.length ? Math.max(...nums) : 0,
    COUNT: (nums) => nums.length,
  };

  function evalFormula(expr, visiting){
    try{
      // 1) function calls with a range or comma-separated args: SUM(A1:A4), AVERAGE(A1,B2,C3)
      expr = expr.replace(/([A-Za-z]+)\(([^()]*)\)/g, (m, fn, args) => {
        fn = fn.toUpperCase();
        if(!FN[fn]) return "#NAME?";
        const nums = [];
        args.split(",").map(s=>s.trim()).filter(Boolean).forEach(part => {
          if(part.includes(":")){
            const [a,b] = part.split(":");
            expandRange(a,b).forEach(([r,c])=>{
              const v = computeValue(r,c,visiting);
              if(typeof v === "number") nums.push(v);
            });
          }else{
            const ref = parseRef(part);
            if(ref){
              const v = computeValue(ref.r, ref.c, visiting);
              if(typeof v === "number") nums.push(v);
            }else if(!isNaN(Number(part))){
              nums.push(Number(part));
            }
          }
        });
        return String(FN[fn](nums));
      });

      // 2) remaining single cell references -> numeric/string values
      expr = expr.replace(/[A-Za-z]+\d+/g, (ref) => {
        const p = parseRef(ref);
        if(!p) return "0";
        const v = computeValue(p.r, p.c, visiting);
        return typeof v === "number" ? String(v) : (v === "" ? "0" : JSON.stringify(String(v)));
      });

      // 3) safety check: only digits, operators, parens, decimal points, quotes, letters left (#NAME?) allowed
      if(/[^0-9+\-*/(). "A-Za-z?!#,]/.test(expr)) return "#ERROR!";
      if(/#NAME\?|#CIRC!/.test(expr)) return "#ERROR!";
      // eslint-disable-next-line no-new-func
      const result = Function('"use strict"; return (' + expr + ")")();
      if(typeof result === "number" && isFinite(result)) return round(result);
      return String(result);
    }catch(e){
      return "#ERROR!";
    }
  }
  function round(n){ return Math.round(n * 1e10) / 1e10; }

  // ---------- render ----------
  function renderAll(){
    const visiting = new Set();
    for(let r=0;r<ROWS;r++){
      for(let c=0;c<COLS;c++){
        const el = cellEl(r,c);
        const v = computeValue(r,c, new Set());
        el.textContent = (v === "" || v === undefined) ? "" : String(v);
        el.classList.toggle("num", typeof v === "number");
      }
    }
  }

  function selectCell(r,c, focusFormula){
    document.querySelectorAll("td.selected").forEach(el=>el.classList.remove("selected"));
    selected = {r,c};
    const el = cellEl(r,c);
    if(el) el.classList.add("selected");
    document.getElementById("cellRef").textContent = cellId(r,c);
    const input = document.getElementById("formulaInput");
    input.value = getRaw(r,c);
    if(focusFormula) input.focus();
  }

  table.addEventListener("click", (e)=>{
    const td = e.target.closest("td[data-r]");
    if(!td) return;
    selectCell(+td.dataset.r, +td.dataset.c, false);
  });

  table.addEventListener("focusin", (e)=>{
    const td = e.target.closest("td[data-r]");
    if(!td) return;
    selectCell(+td.dataset.r, +td.dataset.c, false);
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
    else if(["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].includes(e.key) && !isEditingText(td)){
      e.preventDefault();
      const d = {ArrowUp:[-1,0],ArrowDown:[1,0],ArrowLeft:[0,-1],ArrowRight:[0,1]}[e.key];
      commitCell(r,c, td.textContent);
      moveSelection(r+d[0], c+d[1]);
    }
  });
  function isEditingText(td){
    const sel = window.getSelection();
    return sel && sel.toString().length === 0 && td.textContent.length > 0 && document.activeElement === td && false;
  }
  function moveSelection(r,c){
    r = Math.max(0, Math.min(ROWS-1, r));
    c = Math.max(0, Math.min(COLS-1, c));
    const el = cellEl(r,c);
    if(el){ el.focus(); placeCaretEnd(el); selectCell(r,c,false); }
  }
  function placeCaretEnd(el){
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges(); sel.addRange(range);
  }

  function commitCell(r,c,value){
    raw[r][c] = value;
    renderAll();
    scheduleSave();
    const el = cellEl(r,c);
    if(document.activeElement !== el){ /* keep display value */ }
  }

  // formula bar drives the selected cell too
  const formulaInput = document.getElementById("formulaInput");
  formulaInput.addEventListener("keydown", (e)=>{
    if(e.key === "Enter"){
      e.preventDefault();
      raw[selected.r][selected.c] = formulaInput.value;
      renderAll();
      scheduleSave();
      moveSelection(selected.r+1, selected.c);
    }
  });
  formulaInput.addEventListener("input", ()=>{
    raw[selected.r][selected.c] = formulaInput.value;
    const el = cellEl(selected.r, selected.c);
    if(el) el.textContent = formulaInput.value;
  });
  formulaInput.addEventListener("blur", ()=>{
    renderAll();
    scheduleSave();
  });

  // ---------- autosave ----------
  let saveTimer;
  function scheduleSave(){
    clearTimeout(saveTimer);
    saveTimer = setTimeout(()=>{
      localStorage.setItem(STORAGE_KEY, JSON.stringify(raw));
    }, 500);
  }
  (function restore(){
    try{
      const saved = localStorage.getItem(STORAGE_KEY);
      if(saved){
        const parsed = JSON.parse(saved);
        for(let r=0;r<ROWS;r++) for(let c=0;c<COLS;c++){
          if(parsed[r] && parsed[r][c] !== undefined) raw[r][c] = parsed[r][c];
        }
      }
      const title = localStorage.getItem(TITLE_KEY);
      if(title) document.getElementById("sheetTitle").value = title;
    }catch(e){ /* ignore */ }
    renderAll();
    selectCell(0,0,false);
  })();
  document.getElementById("sheetTitle").addEventListener("input", (e)=>{
    localStorage.setItem(TITLE_KEY, e.target.value);
  });

  // ---------- menu ----------
  window.toggleMenu = function(id){
    document.querySelectorAll(".menu.open").forEach(m => { if(m.id!==id) m.classList.remove("open"); });
    document.getElementById(id).classList.toggle("open");
  };
  document.addEventListener("click", (e)=>{
    document.querySelectorAll(".menu.open").forEach(m=>{ if(!m.contains(e.target)) m.classList.remove("open"); });
  });

  // ---------- new / open ----------
  window.newSheet = function(){
    if(!confirm("Start a new spreadsheet? Unsaved changes will be lost.")) return;
    raw = Array.from({length: ROWS}, () => Array(COLS).fill(""));
    document.getElementById("sheetTitle").value = "Untitled spreadsheet";
    localStorage.removeItem(STORAGE_KEY);
    renderAll();
    selectCell(0,0,false);
  };

  window.triggerOpen = function(){ document.getElementById("openInput").click(); };

  document.getElementById("openInput").addEventListener("change", async (e)=>{
    const file = e.target.files[0];
    if(!file) return;
    document.getElementById("sheetTitle").value = file.name.replace(/\.[^.]+$/, "");
    try{
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" });
      raw = Array.from({length: ROWS}, () => Array(COLS).fill(""));
      for(let r=0;r<Math.min(ROWS, aoa.length);r++){
        for(let c=0;c<Math.min(COLS, aoa[r].length);c++){
          const v = aoa[r][c];
          raw[r][c] = (v === undefined || v === null) ? "" : String(v);
        }
      }
      renderAll();
      selectCell(0,0,false);
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
    // build a trimmed array of computed values (drop fully-empty trailing rows/cols)
    let maxR = 0, maxC = 0;
    const aoa = [];
    for(let r=0;r<ROWS;r++){
      const row = [];
      for(let c=0;c<COLS;c++){
        const v = computeValue(r,c, new Set());
        row.push(v === "" ? "" : v);
        if(v !== "") { maxR = Math.max(maxR, r); maxC = Math.max(maxC, c); }
      }
      aoa.push(row);
    }
    const trimmed = aoa.slice(0, maxR+1).map(row => row.slice(0, maxC+1));

    if(kind === "csv"){
      const csv = trimmed.map(row => row.map(csvEscape).join(",")).join("\r\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      nyxDownloadBlob(blob, title + ".csv");
      return;
    }
    if(kind === "xlsx"){
      const ws = XLSX.utils.aoa_to_sheet(trimmed);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
      const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
      const blob = new Blob([out], { type: "application/octet-stream" });
      nyxDownloadBlob(blob, title + ".xlsx");
      return;
    }
  };
  function csvEscape(v){
    const s = String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g,'""') + '"' : s;
  }
})();
