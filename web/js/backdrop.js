/* Nyxdesk backdrop — a slow, lamp-lit silk drawn live in a fragment shader.
   No images, no network. Falls back to a still gradient when WebGL is unavailable
   or the person has asked their device to reduce motion. */
(function(){
  "use strict";
  const canvas = document.getElementById("backdrop");
  if(!canvas) return;
  const reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const gl = canvas.getContext("webgl", { antialias: false, alpha: false, powerPreference: "low-power", preserveDrawingBuffer: false });
  if(!gl){ canvas.classList.add("still"); return; }

  const VS = "attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}";
  const FS = `
precision highp float;
uniform vec2 R; uniform float T; uniform vec2 M; uniform float L; uniform float G;
float hash(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
float vn(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y);
}
float fbm(vec2 p){
  float a = .5, s = 0.;
  mat2 m = mat2(1.6,1.2,-1.2,1.6);
  for(int i=0;i<4;i++){ s += a*vn(p); p = m*p; a *= .5; }
  return s;
}
float field(vec2 p){
  vec2 q = vec2(fbm(p + vec2(0., T*.040)), fbm(p + vec2(5.2,1.3) - vec2(T*.030, 0.)));
  float h = fbm(p + 2.6*q + vec2(T*.018));
  return 1. - abs(2.*h - 1.);          /* ridged: gives the folded-cloth look */
}
void main(){
  vec2 uv = gl_FragCoord.xy / R;
  float asp = R.x / R.y;
  vec2 p = (uv - .5) * vec2(asp, 1.) * 1.75;
  float e = 1.8 / R.y;
  float h  = field(p);
  float hx = field(p + vec2(e*3., 0.));
  float hy = field(p + vec2(0., e*3.));
  vec3 n = normalize(vec3((h-hx)*8., (h-hy)*8., 1.));
  vec2 lp = (M - .5) * vec2(asp, 1.) * 1.75;
  vec3 ld = normalize(vec3(lp - p, .55));
  float dif = clamp(dot(n, ld), 0., 1.);
  float spec = pow(clamp(dot(reflect(-ld, n), vec3(0.,0.,1.)), 0., 1.), 28.);
  float pool = smoothstep(1.6, 0., length(lp - p));     /* the lamp's pool of light */
  vec3 night = mix(vec3(.040,.032,.036), vec3(.150,.070,.085), h*h);
  vec3 gold  = vec3(.93,.66,.62);
  vec3 col = night + vec3(.22,.12,.13)*dif*pool*1.25 + gold*spec*(.25 + .75*pool)*.95;
  col += vec3(.35,.16,.17) * pow(h, 5.) * .18;
  vec3 paper = mix(vec3(.94,.90,.85), vec3(.995,.975,.945), h);
  paper -= vec3(.08,.13,.15) * (1.-dif) * .95;
  paper += gold * spec * .20 * (.4 + pool);
  col = mix(col, paper, L);
  float vig = smoothstep(1.25, .25, length(uv - .5) * 1.15);
  col *= mix(.55, 1., vig);
  col += (hash(gl_FragCoord.xy + fract(T)*91.7) - .5) * G;   /* film grain */
  gl_FragColor = vec4(col, 1.);
}`;
  function sh(type, src){ const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if(!gl.getShaderParameter(s, gl.COMPILE_STATUS)){ console.warn(gl.getShaderInfoLog(s)); return null; } return s; }
  const vs = sh(gl.VERTEX_SHADER, VS), fs = sh(gl.FRAGMENT_SHADER, FS);
  if(!vs || !fs){ canvas.classList.add("still"); return; }
  const pr = gl.createProgram(); gl.attachShader(pr, vs); gl.attachShader(pr, fs); gl.linkProgram(pr);
  if(!gl.getProgramParameter(pr, gl.LINK_STATUS)){ canvas.classList.add("still"); return; }
  gl.useProgram(pr);
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(pr, "p"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const U = n => gl.getUniformLocation(pr, n);
  const uR = U("R"), uT = U("T"), uM = U("M"), uL = U("L"), uG = U("G");

  /* Cost control: render below native resolution — the field is soft, so it costs nothing visually. */
  const coarse = window.matchMedia && matchMedia("(pointer:coarse)").matches;
  const scale = coarse ? .5 : .62;
  function size(){
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(2, Math.round(innerWidth * dpr * scale)), h = Math.max(2, Math.round(innerHeight * dpr * scale));
    if(canvas.width !== w || canvas.height !== h){ canvas.width = w; canvas.height = h; gl.viewport(0, 0, w, h); }
  }
  size(); addEventListener("resize", size);

  const mouse = { x: .72, y: .62, tx: .72, ty: .62 };
  function aim(x, y){ mouse.tx = x / innerWidth; mouse.ty = 1 - y / innerHeight; }
  addEventListener("pointermove", e => aim(e.clientX, e.clientY), { passive: true });
  addEventListener("pointerdown", e => aim(e.clientX, e.clientY), { passive: true });

  let light = document.documentElement.getAttribute("data-theme") === "light" ? 1 : 0, lightTo = light;
  document.addEventListener("nyx-theme", () => { lightTo = document.documentElement.getAttribute("data-theme") === "light" ? 1 : 0; if(reduce) draw(0); });

  let t0 = performance.now(), running = true, raf = 0, last = 0;
  function draw(now){
    const t = reduce ? 14 : (now - t0) / 1000 + 14;
    mouse.x += (mouse.tx - mouse.x) * .045; mouse.y += (mouse.ty - mouse.y) * .045;
    light += (lightTo - light) * .08;
    /* with no pointer, the lamp drifts on its own so phones still get movement */
    const idle = reduce ? 0 : 1;
    const ax = mouse.x + Math.sin(t * .21) * .06 * idle, ay = mouse.y + Math.cos(t * .17) * .05 * idle;
    gl.uniform2f(uR, canvas.width, canvas.height); gl.uniform1f(uT, t); gl.uniform2f(uM, ax, ay);
    gl.uniform1f(uL, light); gl.uniform1f(uG, .035);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  function loop(now){
    if(!running) return;
    raf = requestAnimationFrame(loop);
    if(now - last < (coarse ? 40 : 28)) return;      /* ~25–35 fps is plenty for slow cloth */
    last = now; draw(now);
  }
  if(reduce){ draw(0); }
  else{
    raf = requestAnimationFrame(loop);
    document.addEventListener("visibilitychange", () => {
      running = document.visibilityState === "visible";
      if(running){ t0 += 0; raf = requestAnimationFrame(loop); } else cancelAnimationFrame(raf);
    });
  }
  canvas.dataset.ready = "1";
})();
