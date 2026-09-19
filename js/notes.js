/* Nyxdesk Notes */
(function(){
  const STORAGE_KEY = "nyxdesk-notes-v1";
  let notes = [];      // { id, title, delta, text, updated }
  let activeId = null;

  const quill = new Quill("#editor", {
    theme: "snow",
    placeholder: "Write something…",
    modules: {
      toolbar: [
        [{ header: [2,3,false] }],
        ["bold","italic","underline","strike"],
        [{ list: "ordered" }, { list: "bullet" }, { list: "check" }],
        [{ color: [] }, { background: [] }],
        ["blockquote","code-block","link"],
        ["clean"]
      ]
    }
  });

  function uid(){ return "n" + Date.now().toString(36) + Math.random().toString(36).slice(2,6); }

  function load(){
    try{ notes = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); }
    catch(e){ notes = []; }
  }
  function persist(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(notes)); }

  function activeNote(){ return notes.find(n => n.id === activeId); }

  function renderList(filter){
    const list = document.getElementById("noteList");
    const term = (filter || "").toLowerCase().trim();
    const sorted = [...notes].sort((a,b)=> b.updated - a.updated);
    const visible = term ? sorted.filter(n => (n.title+" "+n.text).toLowerCase().includes(term)) : sorted;
    list.innerHTML = "";
    if(!visible.length){
      list.innerHTML = `<div class="empty-rail">${term ? "No matching notes." : "No notes yet — create one to get started."}</div>`;
      return;
    }
    visible.forEach(n=>{
      const el = document.createElement("div");
      el.className = "note-item" + (n.id === activeId ? " active" : "");
      const snippet = (n.text || "").trim().slice(0,80) || "Empty note";
      el.innerHTML = `<h4>${escapeHtml(n.title || "Untitled note")}</h4><p>${escapeHtml(snippet)}</p><time>${new Date(n.updated).toLocaleString()}</time>`;
      el.addEventListener("click", ()=> selectNote(n.id));
      list.appendChild(el);
    });
  }
  function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }

  function selectNote(id){
    activeId = id;
    const n = activeNote();
    document.getElementById("noteMain").style.display = n ? "flex" : "none";
    document.getElementById("noNote").style.display = n ? "none" : "flex";
    if(n){
      document.getElementById("noteTitleTop").value = n.title || "";
      document.getElementById("noteMeta").textContent = "Edited " + new Date(n.updated).toLocaleString();
      quill.setContents(n.delta || [{insert:"\n"}]);
    }
    renderList(document.getElementById("searchInput").value);
  }

  window.createNote = function(){
    const n = { id: uid(), title: "Untitled note", delta: [{insert:"\n"}], text: "", updated: Date.now() };
    notes.push(n);
    persist();
    selectNote(n.id);
  };

  function deleteActive(){
    if(!activeId) return;
    if(!confirm("Delete this note? This can't be undone.")) return;
    notes = notes.filter(n => n.id !== activeId);
    persist();
    activeId = notes.length ? notes.sort((a,b)=>b.updated-a.updated)[0].id : null;
    selectNote(activeId);
  }
  window.deleteActiveNote = deleteActive;

  document.getElementById("noteTitleTop").addEventListener("input", (e)=>{
    const n = activeNote(); if(!n) return;
    n.title = e.target.value;
    n.updated = Date.now();
    schedulePersist();
    renderList(document.getElementById("searchInput").value);
  });

  let saveTimer;
  function schedulePersist(){
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persist, 400);
  }
  quill.on("text-change", ()=>{
    const n = activeNote(); if(!n) return;
    n.delta = quill.getContents().ops;
    n.text = quill.getText();
    n.updated = Date.now();
    document.getElementById("noteMeta").textContent = "Edited " + new Date(n.updated).toLocaleString();
    schedulePersist();
  });

  document.getElementById("searchInput").addEventListener("input", (e)=> renderList(e.target.value));

  window.exportTxt = function(){
    const n = activeNote();
    if(!n){ nyxToast("Select a note first."); return; }
    const blob = new Blob([quill.getText()], { type: "text/plain;charset=utf-8" });
    nyxDownloadBlob(blob, (n.title || "note") + ".txt");
  };

  // ---------- init ----------
  load();
  if(notes.length){
    selectNote([...notes].sort((a,b)=>b.updated-a.updated)[0].id);
  }else{
    document.getElementById("noteMain").style.display = "none";
    document.getElementById("noNote").style.display = "flex";
    renderList("");
  }
  nyxSetupRailToggle("#rail", "#railToggle");
})();
