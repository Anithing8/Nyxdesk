/* Nyxdesk shared utilities: theme toggle + toast */
(function(){
  const KEY = "nyxdesk-theme";
  function apply(theme){
    if(theme === "light"){ document.documentElement.setAttribute("data-theme","light"); }
    else{ document.documentElement.removeAttribute("data-theme"); }
  }
  const saved = localStorage.getItem(KEY);
  if(saved) apply(saved);
  else if(window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches){
    apply("light");
  }

  window.nyxToggleTheme = function(){
    const isLight = document.documentElement.getAttribute("data-theme") === "light";
    const next = isLight ? "dark" : "light";
    apply(next);
    localStorage.setItem(KEY, next);
  };

  window.nyxToast = function(message, ms){
    let el = document.getElementById("nyx-toast");
    if(!el){
      el = document.createElement("div");
      el.id = "nyx-toast";
      el.className = "toast";
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(el._t);
    el._t = setTimeout(()=> el.classList.remove("show"), ms || 2200);
  };

  window.nyxDownloadBlob = function(blob, filename){
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=> URL.revokeObjectURL(url), 4000);
  };
})();
