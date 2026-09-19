/* Nyxdesk Docs */
(function(){
  const Font = Quill.import("formats/font");
  Font.whitelist = ["sans-serif","serif","monospace"];
  Quill.register(Font, true);

  const toolbarOptions = [
    [{ header: [1,2,3,false] }],
    [{ font: [] }, { size: ["small", false, "large", "huge"] }],
    ["bold","italic","underline","strike"],
    [{ color: [] }, { background: [] }],
    [{ list: "ordered" }, { list: "bullet" }, { list: "check" }],
    [{ indent: "-1" }, { indent: "+1" }],
    [{ align: [] }],
    ["blockquote","code-block","link","image"],
    [{ script: "sub" }, { script: "super" }],
    ["clean"]
  ];

  const quill = new Quill("#editor", {
    theme: "snow",
    placeholder: "Start writing…",
    modules: { toolbar: toolbarOptions }
  });

  const STORAGE_KEY = "nyxdesk-doc-v1";
  const TITLE_KEY = "nyxdesk-doc-title";

  // restore autosave
  try{
    const saved = localStorage.getItem(STORAGE_KEY);
    if(saved){ quill.setContents(JSON.parse(saved)); }
    const title = localStorage.getItem(TITLE_KEY);
    if(title) document.getElementById("docTitle").value = title;
  }catch(e){ /* ignore corrupt autosave */ }

  let saveTimer;
  quill.on("text-change", () => {
    updateCounts();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(quill.getContents()));
    }, 500);
  });
  document.getElementById("docTitle").addEventListener("input", (e)=>{
    localStorage.setItem(TITLE_KEY, e.target.value);
  });

  function updateCounts(){
    const text = quill.getText().trim();
    const words = text.length ? text.split(/\s+/).length : 0;
    document.getElementById("wordCount").textContent = words + (words===1 ? " word" : " words");
    document.getElementById("charCount").textContent = text.length + " characters";
  }
  updateCounts();

  // ---------- menu ----------
  window.toggleMenu = function(id){
    document.querySelectorAll(".menu.open").forEach(m => { if(m.id!==id) m.classList.remove("open"); });
    document.getElementById(id).classList.toggle("open");
  };
  document.addEventListener("click", (e)=>{
    document.querySelectorAll(".menu.open").forEach(m=>{
      if(!m.contains(e.target)) m.classList.remove("open");
    });
  });

  // ---------- new / open ----------
  window.newDoc = function(){
    if(!confirm("Start a new document? Unsaved changes will be lost.")) return;
    quill.setContents([{insert:"\n"}]);
    document.getElementById("docTitle").value = "Untitled document";
    localStorage.removeItem(STORAGE_KEY);
  };

  window.triggerOpen = function(){
    document.getElementById("openInput").click();
  };

  document.getElementById("openInput").addEventListener("change", async (e)=>{
    const file = e.target.files[0];
    if(!file) return;
    document.getElementById("docTitle").value = file.name.replace(/\.[^.]+$/, "");
    const ext = file.name.split(".").pop().toLowerCase();
    try{
      if(ext === "docx"){
        const arrayBuffer = await file.arrayBuffer();
        const result = await mammoth.convertToHtml({ arrayBuffer });
        quill.setContents([{insert:"\n"}]);
        quill.clipboard.dangerouslyPasteHTML(0, result.value);
        if(result.messages && result.messages.length){
          nyxToast("Imported — some formatting may not carry over exactly.");
        }else{
          nyxToast("Document imported.");
        }
      }else if(ext === "html" || ext === "htm"){
        const text = await file.text();
        quill.setContents([{insert:"\n"}]);
        quill.clipboard.dangerouslyPasteHTML(0, text);
        nyxToast("Document imported.");
      }else{
        const text = await file.text();
        quill.setText(text);
        nyxToast("Document imported.");
      }
    }catch(err){
      console.error(err);
      alert("Couldn't read that file. It may be corrupted or in an unsupported format.");
    }
    e.target.value = "";
  });

  // ---------- save / export ----------
  window.saveAs = function(kind){
    const title = (document.getElementById("docTitle").value || "document").trim();
    const html = quill.root.innerHTML;

    if(kind === "txt"){
      const blob = new Blob([quill.getText()], { type: "text/plain;charset=utf-8" });
      nyxDownloadBlob(blob, title + ".txt");
      return;
    }
    if(kind === "html"){
      const full = "<!doctype html><html><head><meta charset='utf-8'><title>"+escapeHtml(title)+"</title></head><body>"+html+"</body></html>";
      const blob = new Blob([full], { type: "text/html;charset=utf-8" });
      nyxDownloadBlob(blob, title + ".html");
      return;
    }
    if(kind === "docx"){
      try{
        const full = "<!doctype html><html><head><meta charset='utf-8'></head><body>"+html+"</body></html>";
        const converted = htmlDocx.asBlob(full);
        nyxDownloadBlob(converted, title + ".docx");
      }catch(err){
        console.error(err);
        alert("Couldn't generate a .docx file in this browser. Try 'Save as .html' instead — most word processors can open that too.");
      }
      return;
    }
  };

  function escapeHtml(s){
    return s.replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  }

  // ---------- find & replace ----------
  let lastFindIndex = 0;
  window.toggleFind = function(){
    const bar = document.getElementById("findBar");
    const show = bar.style.display === "none";
    bar.style.display = show ? "flex" : "none";
    if(show) document.getElementById("findInput").focus();
  };
  window.findNext = function(){
    const term = document.getElementById("findInput").value;
    const status = document.getElementById("findStatus");
    if(!term){ status.textContent = ""; return; }
    const text = quill.getText();
    let idx = text.indexOf(term, lastFindIndex);
    if(idx === -1) idx = text.indexOf(term, 0);
    if(idx === -1){ status.textContent = "Not found"; return; }
    quill.setSelection(idx, term.length, "user");
    lastFindIndex = idx + term.length;
    status.textContent = "";
  };
  window.replaceOne = function(){
    const term = document.getElementById("findInput").value;
    const replacement = document.getElementById("replaceInput").value;
    const sel = quill.getSelection();
    if(sel && sel.length && quill.getText(sel.index, sel.length) === term){
      quill.deleteText(sel.index, sel.length, "user");
      quill.insertText(sel.index, replacement, "user");
      quill.setSelection(sel.index + replacement.length, 0, "user");
    }
    findNext();
  };
  window.replaceAll = function(){
    const term = document.getElementById("findInput").value;
    const replacement = document.getElementById("replaceInput").value;
    if(!term) return;
    let text = quill.getText();
    let idx = text.indexOf(term);
    let count = 0;
    while(idx !== -1){
      quill.deleteText(idx, term.length, "user");
      quill.insertText(idx, replacement, "user");
      text = quill.getText();
      idx = text.indexOf(term, idx + replacement.length);
      count++;
    }
    document.getElementById("findStatus").textContent = count + " replaced";
  };

  // ---------- insert table (as an editable tab-separated grid, code-block based) ----------
  window.insertTable = function(){
    const rows = parseInt(prompt("Rows?", "3"), 10);
    const cols = parseInt(prompt("Columns?", "3"), 10);
    if(!rows || !cols || rows < 1 || cols < 1) return;
    const range = quill.getSelection(true);
    let text = "\n";
    for(let r=0;r<rows;r++){
      const cells = [];
      for(let c=0;c<cols;c++) cells.push("Cell " + (r+1) + "." + (c+1));
      text += cells.join("\t") + "\n";
    }
    quill.insertText(range.index, text, "user");
    quill.formatLine(range.index, text.length, "code-block", true, "user");
    quill.insertText(range.index + text.length, "\n", "user");
    quill.formatLine(range.index + text.length, 1, "code-block", false, "user");
    nyxToast("Table inserted as an editable text grid — edit cells directly.");
  };
})();
