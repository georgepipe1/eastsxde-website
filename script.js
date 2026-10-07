/* EASTSXDE site scripts: page behaviour, the 3D scene, the grain texture */
(function(){
  "use strict";
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  var root = document.documentElement, stage = document.getElementById('stage');

  /* fit the tonal wordmark to the content width */
  var wm = document.getElementById('wordmark'), stageIn = document.getElementById('stageIn');
  function fit(){
    wm.style.fontSize = '100px';
    var r = document.createRange(); r.selectNodeContents(wm);
    var w = r.getBoundingClientRect().width || 1, g = parseFloat(getComputedStyle(wm.parentNode.querySelector('.hud-tl')).left) || 16;
    wm.style.fontSize = Math.floor(100 * (stageIn.clientWidth - 2*g) / w * 0.995) + 'px';
  }
  fit(); window.addEventListener('resize', fit);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);

  /* scene colours come from the active theme and are re-read when the system or the viewer switches it */
  var tone = {grid:[0.19,0.2,0.24], axis:[0.12,0.13,0.16], gridA:0.24, shA:0.22, sky:0.04};
  function readTone(){
    var cs = getComputedStyle(root);
    function v(n){ return cs.getPropertyValue(n).trim(); }
    function rgb(n){ var a = v(n).split(/[\s,]+/).map(function(x){ return (+x)/255; }); return a.length === 3 && a.every(isFinite) ? a : null; }
    tone.grid = rgb('--gl-grid') || tone.grid; tone.axis = rgb('--gl-axis') || tone.axis;
    tone.gridA = +v('--gl-grid-a') || tone.gridA; tone.shA = +v('--gl-shadow-a') || tone.shA; tone.sky = +v('--gl-sky') || 0;
  }
  readTone();

  /* dates: mark what has passed, point the hero card at the next one */
  var today = new Date(); today.setHours(0,0,0,0);
  var next = null;
  document.querySelectorAll('#dateList .date').forEach(function(li){
    var p = li.dataset.date.split('-'), d = new Date(+p[0], p[1]-1, +p[2]), s = li.querySelector('.state');
    if (d < today){ li.classList.add('is-past'); s.textContent = 'Played'; }
    else if (!next){ next = li; li.classList.add('is-next'); s.textContent = (+d === +today) ? 'Tonight' : 'Next up'; }
  });
  var nLink = document.getElementById('nextLink');
  if (next){
    document.getElementById('nextTitle').textContent = next.dataset.title;
    document.getElementById('nextMeta').textContent = next.dataset.meta;
    if (next.dataset.url){ nLink.href = next.dataset.url; nLink.hidden = false; } else nLink.hidden = true;
  } else {
    document.getElementById('nextLabel').textContent = 'Dates';
    document.getElementById('nextLabel').classList.remove('live');
    document.getElementById('nextTitle').textContent = 'New dates soon';
    document.getElementById('nextMeta').textContent = 'Want us on your night? Get in touch.';
    nLink.hidden = true;
    var all = document.getElementById('nextAll'); all.textContent = 'Book us'; all.setAttribute('href', '#bookings');
  }

  /* copy buttons */
  document.querySelectorAll('[data-copy]').forEach(function(b){
    b.addEventListener('click', function(){
      var txt = b.dataset.copy, done = function(){ b.textContent = 'Copied'; setTimeout(function(){ b.textContent = 'Copy'; }, 1600); };
      var fallback = function(){
        var a = b.parentNode.querySelector('a'), sel = window.getSelection(), r = document.createRange();
        r.selectNodeContents(a); sel.removeAllRanges(); sel.addRange(r); b.textContent = 'Selected';
        setTimeout(function(){ b.textContent = 'Copy'; }, 1600);
      };
      try { navigator.clipboard.writeText(txt).then(done, fallback); } catch(e){ fallback(); }
    });
  });

  /* stage loop plays only while on screen */
  var morph = document.getElementById('morph');
  if ('IntersectionObserver' in window){
    new IntersectionObserver(function(en){
      en.forEach(function(x){
        if (x.isIntersecting && !reduce.matches){ var p = morph.play(); if (p && p.catch) p.catch(function(){}); }
        else morph.pause();
      });
    }, {threshold:.25}).observe(morph);
  }

  /* ---------- the scene ----------
     Stage canvas (scrolls with the page): floor grid, shadows and the USB sticks that drop onto it.
     Fixed canvas (above everything): the chrome mark, so it can fly to the header and dock. */
  var cv = document.getElementById('logo3d'), fl = document.getElementById('floor'), still = document.getElementById('logoStill');
  var brand = document.getElementById('brandMark'), slot = document.getElementById('brandSlot'), topbar = document.getElementById('topbar'), hudRot = document.getElementById('hudRot');
  var gl = null, U = {}, count = 0, CW = 0, CH = 0;
  var fgl = null, FU = {}, SU = {}, FW = 0, FH = 0, fProg = null, sProg = null, fVao = null, sVao = null, sCount = 0;
  var raf = 0, last = 0, fadeA = 1, yaw = -0.5, tx = 0, ty = 0, cx = 0, cy = 0, pS = 0, tick = 0, dropAt = null;
  var FOV = 30, T = Math.tan(FOV * Math.PI / 360), E0 = 0.16, FLOOR = -0.80, TAU = Math.PI * 2;

  var VS = '#version 300 es\nin vec3 aPos; in vec3 aNrm; uniform mat4 uProj,uView; uniform mat3 uRot; uniform vec3 uPos; uniform float uScale; out vec3 vN; out vec3 vP;\n' +
    'void main(){ vec3 p=uRot*(aPos*uScale)+uPos; vP=p; vN=uRot*aNrm; gl_Position=uProj*uView*vec4(p,1.0); }';
  var FS = '#version 300 es\nprecision highp float;\n' +
    'in vec3 vN; in vec3 vP; uniform vec3 uCam; uniform float uRough; uniform float uSky; uniform vec3 uTint; uniform vec3 uEnv; out vec4 o;\n' +
    'float box(float x,float c,float hw,float s){ return smoothstep(c-hw-s,c-hw+s,x)*(1.0-smoothstep(c+hw-s,c+hw+s,x)); }\n' +
    'vec3 env(vec3 d,float r){\n' +
    ' float el=asin(clamp(d.y,-1.,1.)); float az=atan(d.x,d.z); float azb=atan(d.x,-d.z); float s=0.02+r*0.55; float eh=el+0.24;\n' +
    ' float up=smoothstep(-0.03-s,0.03+s,eh); float front=0.5+0.5*cos(az);\n' +
    ' float hb=exp(-pow(max(eh,0.)/0.46,1.6));\n' +
    ' vec3 sky=vec3(0.045,0.047,0.055)+vec3(uSky)+vec3(1.05,1.07,1.12)*hb*mix(0.30,1.0,front);\n' +
    ' float g=-eh; float fb=smoothstep(0.0,0.85,g)*(1.0-smoothstep(0.9,1.5,g));\n' +
    ' vec3 flo=vec3(0.010)+vec3(uSky*0.5)+vec3(0.24,0.24,0.245)*fb*mix(0.45,1.0,front);\n' +
    ' vec3 c=mix(flo,sky,up);\n' +
    ' c+=vec3(6.5,6.5,6.7)*box(el,1.08,0.20,s)*box(az,0.2,1.3,s*1.6);\n' +
    ' c+=vec3(5.2,5.3,5.6)*box(az,-1.10,0.085,s)*box(el,0.18,0.85,s);\n' +
    ' c+=vec3(3.6,3.55,3.5)*box(az,1.36,0.06,s)*box(el,0.10,0.78,s);\n' +
    ' c+=vec3(0.9)*box(el,-0.95,0.07,s)*box(az,-0.3,1.0,s*1.5);\n' +
    ' c+=vec3(2.4,2.45,2.55)*box(el,0.03,0.24,s*1.5)*box(azb,0.0,0.75,0.25+s);\n' +
    ' c+=vec3(4.4,4.45,4.6)*box(azb,0.95,0.085,s)*box(el,0.18,0.8,s);\n' +
    ' c+=vec3(3.8)*box(azb,-1.15,0.065,s)*box(el,0.10,0.75,s);\n' +
    ' return c; }\n' +
    'vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14),0.0,1.0); }\n' +
    'void main(){ vec3 N=normalize(vN); vec3 V=normalize(uCam-vP); if(dot(N,V)<0.0) N=-N;\n' +
    ' vec3 R=reflect(-V,N); float nv=clamp(dot(N,V),0.0,1.0); vec3 F=uTint+(1.0-uTint)*pow(1.0-nv,5.0);\n' +
    ' vec3 col=env(R,uRough)*uEnv*F; col+=env(N,0.9)*uEnv*uTint*0.04; col=pow(aces(col),vec3(1.0/2.2)); o=vec4(col,1.0); }';
  var FVS = '#version 300 es\nin vec2 p; out vec2 v; void main(){ v=p; gl_Position=vec4(p,0.0,1.0); }';
  var FFS = '#version 300 es\nprecision highp float;\nin vec2 v; out vec4 o;\n' +
    'uniform float uA,uT,uE,uD,uFloor,uYaw,uGridA,uShA,uStA,uStL,uStW; uniform vec3 uGrid,uAxis; uniform vec4 uSt[8];\n' +
    'float grid(vec2 p,float c){ vec2 q=p/c; vec2 w=max(fwidth(q),vec2(1e-5)); vec2 g=abs(fract(q-0.5)-0.5)/w; return (1.0-min(min(g.x,g.y),1.0))*clamp(1.15-max(w.x,w.y)*2.2,0.0,1.0); }\n' +
    'void main(){ float s=sin(uE), c=cos(uE); vec3 cam=vec3(0.0,uD*s,uD*c);\n' +
    ' vec3 dir=normalize(vec3(0.0,-s,-c)+vec3(1.0,0.0,0.0)*v.x*uA*uT+vec3(0.0,c,-s)*v.y*uT);\n' +
    ' if(dir.y>-1e-4){ o=vec4(0.0); return; }\n' +
    ' vec3 h=cam+dir*((uFloor-cam.y)/dir.y); float r=length(h.xz);\n' +
    ' float fade=exp(-r*r/34.0)*smoothstep(-1.0,-0.74,v.y);\n' +
    ' float ga=(grid(h.xz,0.5)*0.42+grid(h.xz,2.0)*0.58)*uGridA*fade;\n' +
    ' float ax=max(1.0-min(abs(h.z)/max(fwidth(h.z),1e-5)/1.4,1.0),1.0-min(abs(h.x)/max(fwidth(h.x),1e-5)/1.4,1.0))*min(uGridA*1.25,0.4)*fade;\n' +
    ' vec2 e=vec2(cos(uYaw),-sin(uYaw)); float d=length(h.xz-e*clamp(dot(h.xz,e),-1.0,1.0)); float sh=1.0-smoothstep(0.02,0.74,d); sh=sh*sh*uShA;\n' +
    ' float keep=1.0-sh;\n' +
    ' for(int i=0;i<8;i++){ vec4 q=uSt[i]; vec2 e2=vec2(cos(q.z),-sin(q.z)); vec2 rel=h.xz-q.xy; float dd=length(rel-e2*clamp(dot(rel,e2),-uStL,uStL));\n' +
    '  float si=(1.0-smoothstep(uStW*0.55,uStW+0.03+q.w*0.32,dd))*uStA/(1.0+q.w*3.2); keep*=1.0-si; }\n' +
    ' float sa=(1.0-keep)*smoothstep(-1.0,-0.8,v.y);\n' +
    ' vec3 col=uGrid*ga; float a=ga; col=col*(1.0-ax)+uAxis*ax; a=a*(1.0-ax)+ax; col*=1.0-sa; a=a*(1.0-sa)+sa; o=vec4(col,a); }';

  function b64(s, Ty){ var b = atob(s), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return new Ty(u.buffer); }
  function program(g, vs, fs){
    function sh(t, s){ var x = g.createShader(t); g.shaderSource(x, s); g.compileShader(x); if (!g.getShaderParameter(x, g.COMPILE_STATUS)) throw new Error(g.getShaderInfoLog(x)); return x; }
    var p = g.createProgram(); g.attachShader(p, sh(g.VERTEX_SHADER, vs)); g.attachShader(p, sh(g.FRAGMENT_SHADER, fs)); g.linkProgram(p);
    if (!g.getProgramParameter(p, g.LINK_STATUS)) throw new Error(g.getProgramInfoLog(p));
    g.useProgram(p); return p;
  }
  function sstep(a, b, x){ var t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
  /* camera distance: the mark takes two fifths of the hero's height on wide screens, four fifths of its width on tall ones */
  function baseDist(w, h){ var a = w / h; return Math.max(1.17 / 0.40 / (2 * T), 2 / (a < 1 ? 0.80 : 0.62) / (2 * T * a)); }

  /* 3x3 helpers, row-major; toGL flips to the column-major order WebGL wants */
  function mul3(A, B){ var o = new Array(9); for (var r = 0; r < 3; r++) for (var c = 0; c < 3; c++) o[r*3+c] = A[r*3]*B[c] + A[r*3+1]*B[3+c] + A[r*3+2]*B[6+c]; return o; }
  function rotY(a){ var c = Math.cos(a), s = Math.sin(a); return [c,0,s, 0,1,0, -s,0,c]; }
  function rotZ(a){ var c = Math.cos(a), s = Math.sin(a); return [c,-s,0, s,c,0, 0,0,1]; }
  function rotAxis(x, y, z, a){ var c = Math.cos(a), s = Math.sin(a), k = 1 - c; return [c+x*x*k, x*y*k-z*s, x*z*k+y*s,  y*x*k+z*s, c+y*y*k, y*z*k-x*s,  z*x*k-y*s, z*y*k+x*s, c+z*z*k]; }
  function toGL(A){ return new Float32Array([A[0],A[3],A[6], A[1],A[4],A[7], A[2],A[5],A[8]]); }

  /* ---------- the USB sticks ----------
     One small mesh (body, plug, lanyard loop) drawn eight times in the mark's own chrome. Each has a fixed
     script: a delay, a drop height, a tumble, the angle it hits at, then it tips flat and slides to a stop.
     No bounce. The script is the same on every load. */
  var SS = 0.28, SHY = 0.07 * SS, SLH = 0.66 * SS, G = 30;
  /* u, v (where on screen it comes to rest), yaw, delay, drop height, impact tilt, tumble axis xyz, tumble speed, slide direction, slide length, twist, tip-over time */
  var STK = [
    [-0.80,-0.30, 0.60, 0.00, 5.2,  0.26, 0.30,0.20,0.93, 5.5, 0.4, 0.16,  0.25, 0.13],
    [-0.57,-0.63, 2.30, 0.22, 4.6, -0.20, 0.90,0.10,0.40, 4.2, 2.0, 0.12, -0.18, 0.11],
    [-0.26,-0.78, 1.20, 0.48, 5.6,  0.32, 0.20,0.60,0.77, 6.4, 3.4, 0.10,  0.30, 0.14],
    [ 0.33,-0.74, 2.90, 0.12, 4.9, -0.28, 0.70,0.30,0.65, 5.0, 5.2, 0.14, -0.22, 0.12],
    [ 0.72,-0.54, 0.20, 0.36, 5.9,  0.22, 0.10,0.10,0.99, 7.1, 1.1, 0.18,  0.20, 0.12],
    [ 0.86,-0.20, 1.80, 0.58, 4.4, -0.34, 0.60,0.50,0.62, 3.8, 4.1, 0.10, -0.28, 0.15],
    [ 0.50,-0.27, 2.50, 0.30, 5.4,  0.24, 0.40,0.10,0.90, 5.8, 0.9, 0.12,  0.16, 0.12],
    [-0.48,-0.19, 0.90, 0.66, 4.8, -0.24, 0.80,0.20,0.56, 4.6, 2.7, 0.14, -0.20, 0.13]
  ];
  /* on tall screens the mark fills the width, so every stick rests in the floor below it */
  var PUV = [[-0.74,-0.40],[-0.52,-0.60],[-0.36,-0.80],[0.30,-0.84],[0.50,-0.62],[0.76,-0.36],[0.80,-0.78],[-0.08,-0.66]];
  var SREST = [], sKey = '';
  STK.forEach(function(q){ var l = Math.sqrt(q[6]*q[6] + q[7]*q[7] + q[8]*q[8]); q[6] /= l; q[7] /= l; q[8] /= l; });

  function stickMesh(){
    var P = [], N = [], I = [], i, j;
    function rbox(hx, hy, hz, r, ox){
      var H = [hx, hy, hz];
      function coords(h){ return [-h, -h+r/3, -h+2*r/3, -h+r, 0, h-r, h-2*r/3, h-r/3, h]; }
      for (var k = 0; k < 3; k++) for (var sg = -1; sg <= 1; sg += 2){
        var u = (k+1)%3, w = (k+2)%3, cu = coords(H[u]), cw = coords(H[w]), base = P.length/3, n = cu.length, m = cw.length;
        for (i = 0; i < n; i++) for (j = 0; j < m; j++){
          var p = [0,0,0], c = [0,0,0], d = [0,0,0], l = 0; p[k] = sg*H[k]; p[u] = cu[i]; p[w] = cw[j];
          for (var a = 0; a < 3; a++){ var inn = H[a] - r; c[a] = Math.max(-inn, Math.min(inn, p[a])); d[a] = p[a] - c[a]; l += d[a]*d[a]; }
          l = Math.sqrt(l) || 1;
          P.push(c[0] + d[0]/l*r + ox, c[1] + d[1]/l*r, c[2] + d[2]/l*r); N.push(d[0]/l, d[1]/l, d[2]/l);
        }
        for (i = 0; i < n-1; i++) for (j = 0; j < m-1; j++){ var q = base + i*m + j; I.push(q, q+m, q+1, q+1, q+m, q+m+1); }
      }
    }
    function torus(ox, R, r, nu, nv){
      var base = P.length/3;
      for (i = 0; i <= nu; i++){ var th = i/nu*TAU; for (j = 0; j <= nv; j++){ var ph = j/nv*TAU, cr = R + r*Math.cos(ph);
        P.push(ox + cr*Math.cos(th), r*Math.sin(ph), cr*Math.sin(th)); N.push(Math.cos(ph)*Math.cos(th), Math.sin(ph), Math.cos(ph)*Math.sin(th)); } }
      for (i = 0; i < nu; i++) for (j = 0; j < nv; j++){ var q = base + i*(nv+1) + j; I.push(q, q+nv+1, q+1, q+1, q+nv+1, q+nv+2); }
    }
    rbox(0.50, 0.070, 0.165, 0.055, 0);        /* body */
    rbox(0.13, 0.042, 0.115, 0.012, 0.615);    /* plug */
    torus(-0.585, 0.105, 0.030, 28, 10);       /* lanyard loop */
    return {p:new Float32Array(P), n:new Float32Array(N), i:new Uint16Array(I)};
  }

  /* where each stick comes to rest: its screen spot projected onto the floor, kept clear of the circle the mark sweeps */
  function placeSticks(w, h, d0){
    var key = w + 'x' + h; if (key === sKey) return; sKey = key;
    var a = w / h, s = Math.sin(E0), c = Math.cos(E0), cy0 = d0 * s, cz0 = d0 * c, R = 1.38;
    SREST = STK.map(function(q, k){
      var uu = a < 0.9 ? PUV[k][0] : q[0], vv = a < 0.9 ? PUV[k][1] : q[1];
      var dx = uu * a * T, dy = -s + c * vv * T, dz = -c - s * vv * T;
      if (dy > -0.02) dy = -0.02;
      var t = (FLOOR - cy0) / dy, x = dx * t, z = cz0 + dz * t, r = Math.sqrt(x*x + z*z);
      if (r > 7.5){ x *= 7.5 / r; z *= 7.5 / r; }
      for (var it = 0; it < 2; it++){
        var depth = (cz0 - z) * c + (cy0 - FLOOR) * s, lim = 0.86 * depth * T * a;
        if (Math.abs(x) > lim) x = lim * (x < 0 ? -1 : 1);
        if (x*x + z*z < R*R) z = (z >= -0.25 ? 1 : -1) * Math.sqrt(R*R - x*x);
      }
      return [x, z];
    });
  }
  /* position, rotation and height of stick k at t seconds after its own release */
  function stickAt(k, t){
    var q = STK[k], rest = SREST[k], tL = Math.sqrt(2 * q[4] / G), al, yw, rem, y, tum = 0, v0 = 2 * q[11] / 0.32;
    if (t < tL){ var dl = tL - t; al = q[5]; y = FLOOR + SLH * Math.abs(Math.sin(al)) + SHY * Math.cos(al) + 0.5 * G * dl * dl; rem = q[11] + v0 * dl; yw = q[2] - q[12]; tum = -q[9] * dl; }
    else { var u = Math.min(1, (t - tL) / q[13]), us = 1 - Math.min(1, (t - tL) / 0.32); al = q[5] * (1 - Math.pow(u, 1.6)); y = FLOOR + SLH * Math.abs(Math.sin(al)) + SHY * Math.cos(al); rem = q[11] * us * us; yw = q[2] - q[12] * us * us; }
    var Rm = mul3(rotY(yw), rotZ(al)); if (tum) Rm = mul3(Rm, rotAxis(q[6], q[7], q[8], tum));
    return {x:rest[0] - Math.cos(q[10]) * rem, y:y, z:rest[1] - Math.sin(q[10]) * rem, R:Rm, yaw:yw, h:y - (FLOOR + SHY)};
  }

  function startFloor(){
    try {
      fgl = fl.getContext('webgl2', {antialias:true, alpha:true, premultipliedAlpha:true});
      if (!fgl) return;
      fProg = program(fgl, FVS, FFS);
      ['uA','uT','uE','uD','uFloor','uYaw','uGridA','uShA','uStA','uStL','uStW','uGrid','uAxis','uSt'].forEach(function(k){ FU[k] = fgl.getUniformLocation(fProg, k); });
      fVao = fgl.createVertexArray(); fgl.bindVertexArray(fVao);
      var b = fgl.createBuffer(); fgl.bindBuffer(fgl.ARRAY_BUFFER, b); fgl.bufferData(fgl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), fgl.STATIC_DRAW);
      var l = fgl.getAttribLocation(fProg, 'p'); fgl.enableVertexAttribArray(l); fgl.vertexAttribPointer(l, 2, fgl.FLOAT, false, 0, 0);
      sProg = program(fgl, VS, FS);
      ['uProj','uView','uRot','uPos','uScale','uCam','uRough','uSky','uTint','uEnv'].forEach(function(k){ SU[k] = fgl.getUniformLocation(sProg, k); });
      var M = stickMesh(); sVao = fgl.createVertexArray(); fgl.bindVertexArray(sVao);
      [['aPos', M.p], ['aNrm', M.n]].forEach(function(x){
        var buf = fgl.createBuffer(); fgl.bindBuffer(fgl.ARRAY_BUFFER, buf); fgl.bufferData(fgl.ARRAY_BUFFER, x[1], fgl.STATIC_DRAW);
        var loc = fgl.getAttribLocation(sProg, x[0]); fgl.enableVertexAttribArray(loc); fgl.vertexAttribPointer(loc, 3, fgl.FLOAT, false, 0, 0);
      });
      var ib = fgl.createBuffer(); fgl.bindBuffer(fgl.ELEMENT_ARRAY_BUFFER, ib); fgl.bufferData(fgl.ELEMENT_ARRAY_BUFFER, M.i, fgl.STATIC_DRAW);
      sCount = M.i.length;
      fgl.uniform1f(SU.uRough, 0.10); fgl.uniform3f(SU.uTint, 0.64, 0.79, 1.0); fgl.uniform3f(SU.uEnv, 0.74, 0.80, 0.90); fgl.uniform1f(SU.uScale, SS);   /* a touch dimmer than the mark, so they sit back */
      fl.addEventListener('webglcontextlost', function(e){ e.preventDefault(); fgl = null; });
    } catch (e) { fgl = null; }
  }
  function drawFloor(now, w, h, d, yawNow, shadow){
    var dpr = Math.min(window.devicePixelRatio || 1, 1.5), pw = Math.max(2, Math.round(w * dpr)), ph = Math.max(2, Math.round(h * dpr)), a = w / h, k;
    if (pw !== FW || ph !== FH){ FW = fl.width = pw; FH = fl.height = ph; }
    placeSticks(Math.round(w), Math.round(h), d);
    if (dropAt === null) dropAt = now + 420;
    var states = [], st = new Float32Array(32), tt = (now - dropAt) / 1000;
    for (k = 0; k < STK.length; k++){
      var t = reduce.matches ? 99 : tt - STK[k][3];
      if (t < 0){ states.push(null); st[k*4+3] = 99; continue; }
      var o = stickAt(k, t); states.push(o); st[k*4] = o.x; st[k*4+1] = o.z; st[k*4+2] = o.yaw; st[k*4+3] = o.h;
    }
    fgl.viewport(0, 0, pw, ph); fgl.clearColor(0, 0, 0, 0); fgl.clear(fgl.COLOR_BUFFER_BIT | fgl.DEPTH_BUFFER_BIT);
    fgl.useProgram(fProg); fgl.bindVertexArray(fVao); fgl.disable(fgl.DEPTH_TEST);
    fgl.uniform1f(FU.uA, a); fgl.uniform1f(FU.uT, T); fgl.uniform1f(FU.uE, E0); fgl.uniform1f(FU.uD, d); fgl.uniform1f(FU.uFloor, FLOOR);
    fgl.uniform1f(FU.uYaw, yawNow); fgl.uniform1f(FU.uGridA, tone.gridA); fgl.uniform1f(FU.uShA, tone.shA * shadow);
    fgl.uniform1f(FU.uStA, Math.min(0.8, tone.shA * 1.7)); fgl.uniform1f(FU.uStL, SLH); fgl.uniform1f(FU.uStW, 0.165 * SS);
    fgl.uniform3f(FU.uGrid, tone.grid[0], tone.grid[1], tone.grid[2]); fgl.uniform3f(FU.uAxis, tone.axis[0], tone.axis[1], tone.axis[2]);
    fgl.uniform4fv(FU.uSt, st);
    fgl.drawArrays(fgl.TRIANGLE_STRIP, 0, 4);
    fgl.useProgram(sProg); fgl.bindVertexArray(sVao); fgl.enable(fgl.DEPTH_TEST);
    var f = 1 / T, n = 0.5, fa = 60, se = Math.sin(E0), ce = Math.cos(E0);
    fgl.uniformMatrix4fv(SU.uProj, false, new Float32Array([f/a,0,0,0, 0,f,0,0, 0,0,(fa+n)/(n-fa),-1, 0,0,2*fa*n/(n-fa),0]));
    fgl.uniformMatrix4fv(SU.uView, false, new Float32Array([1,0,0,0, 0,ce,se,0, 0,-se,ce,0, 0,0,-d,1]));
    fgl.uniform3f(SU.uCam, 0, d * se, d * ce); fgl.uniform1f(SU.uSky, tone.sky);
    for (k = 0; k < states.length; k++){
      if (!states[k]) continue;
      fgl.uniformMatrix3fv(SU.uRot, false, toGL(states[k].R)); fgl.uniform3f(SU.uPos, states[k].x, states[k].y, states[k].z);
      fgl.drawElements(fgl.TRIANGLES, sCount, fgl.UNSIGNED_SHORT, 0);
    }
  }

  function frame(now){
    raf = 0;
    var dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000)); last = now;
    var vw = window.innerWidth, vh = window.innerHeight, sr = stage.getBoundingClientRect();
    var d0 = baseDist(sr.width, sr.height), c = sr.top + sr.height / 2, pe = 0, yawNow = yaw;
    if (gl){
      /* how far the mark has travelled from the stage (0) to the header (1): starts as its top reaches the bar */
      var pxU0 = (sr.height / 2) / (d0 * T), hb = topbar.getBoundingClientRect().bottom, half = 0.59 * pxU0;
      var cStart = hb + half + 12, cEnd = hb - 6, pt = Math.min(1, Math.max(0, (cStart - c) / (cStart - cEnd)));
      pS += (pt - pS) * Math.min(1, dt * 10); if (Math.abs(pt - pS) < 0.0005) pS = pt;
      pe = pS * pS * pS * (pS * (pS * 6 - 15) + 10);
      cx += (tx - cx) * 0.06; cy += (ty - cy) * 0.06;
      if (reduce.matches) yaw += (-0.62 * (1 - pe) - yaw) * Math.min(1, dt * 6);
      else { yaw += TAU / 8 * (1 - pe) * dt; yaw += (Math.round(yaw / TAU) * TAU - yaw) * Math.min(1, dt * 5) * pe; }   /* docked: stops, face on */
      yawNow = yaw + cx * 0.32 * (1 - pe);
      var pitch = ((reduce.matches ? 0.08 : 0.03) + cy * 0.14) * (1 - pe);
      var dpr = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(4.2e6 / (vw * vh))), w = Math.round(vw * dpr), h = Math.round(vh * dpr);
      if (w !== CW || h !== CH){ CW = cv.width = w; CH = cv.height = h; }
      var br = brand.getBoundingClientRect();
      var e = E0 * (1 - pe), d = d0 + (9 - d0) * pe;
      var pxU = Math.exp(Math.log(pxU0) * (1 - pe) + Math.log(br.width * 1.04 / 2) * pe);
      var px = (sr.left + sr.width / 2) * (1 - pe) + (br.left + br.width / 2) * pe, py = c * (1 - pe) + (br.top + br.height / 2) * pe;
      var S = 2 * pxU * d * T, VW = 1.5 * S, f = 1 / T, n = 0.5, fa = 60, se = Math.sin(e), ce = Math.cos(e);
      gl.viewport(0, 0, CW, CH); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.viewport(Math.round((px - VW / 2) * dpr), Math.round((vh - py - S / 2) * dpr), Math.round(VW * dpr), Math.round(S * dpr));
      gl.uniformMatrix4fv(U.uProj, false, new Float32Array([f/1.5,0,0,0, 0,f,0,0, 0,0,(fa+n)/(n-fa),-1, 0,0,2*fa*n/(n-fa),0]));
      gl.uniformMatrix4fv(U.uView, false, new Float32Array([1,0,0,0, 0,ce,se,0, 0,-se,ce,0, 0,0,-d,1]));
      var cyw = Math.cos(yawNow), syw = Math.sin(yawNow), cp = Math.cos(pitch), sp = Math.sin(pitch);
      gl.uniformMatrix3fv(U.uRot, false, new Float32Array([cyw, sp*syw, -cp*syw,  0, cp, sp,  syw, -sp*cyw, cp*cyw]));
      gl.uniform3f(U.uCam, 0, d * se, d * ce); gl.uniform1f(U.uSky, tone.sky);
      /* once it has landed on the flat mark the chrome fades away; it comes back as soon as you scroll up */
      fadeA += ((pS > 0.985 ? 0 : 1) - fadeA) * Math.min(1, dt * (pS > 0.985 ? 3.2 : 12)); if (fadeA < 0.004) fadeA = 0;
      if (fadeA > 0) gl.drawElements(gl.TRIANGLES, count, gl.UNSIGNED_SHORT, 0);
      cv.style.opacity = String(fadeA);
      slot.style.setProperty('--dock', sstep(0.15, 0.9, pe).toFixed(3)); slot.style.setProperty('--mark', (1 - fadeA).toFixed(3));
      if (cv.hidden){ cv.hidden = false; still.hidden = true; }
      if ((tick++ & 3) === 0){ var deg = Math.round(((yawNow % TAU) + TAU) % TAU * 180 / Math.PI) % 360; hudRot.textContent = 'Rot Y ' + ('00' + deg).slice(-3) + '°'; }
    }
    if (fgl && sr.bottom > 0 && sr.top < vh) drawFloor(now, sr.width, sr.height, d0, yawNow, gl ? 1 - pe : 0);
    if (!document.hidden && (gl || fgl)) raf = requestAnimationFrame(frame);
  }
  function kick(){ if (!raf) raf = requestAnimationFrame(frame); }
  /* without the 3D mark (no WebGL, or it failed) the flat corner mark is simply always there */
  function showFlat(){ slot.style.setProperty('--dock', '1'); slot.style.setProperty('--mark', '1'); }

  function start(){
    var M = window.ESX_MESH; if (!M){ showFlat(); return; }
    try {
      gl = cv.getContext('webgl2', {antialias:true, alpha:true, premultipliedAlpha:true, powerPreference:'high-performance'});
      if (!gl){ showFlat(); return; }
      var prog = program(gl, VS, FS);
      ['uProj','uView','uRot','uPos','uScale','uCam','uRough','uSky','uTint','uEnv'].forEach(function(k){ U[k] = gl.getUniformLocation(prog, k); });
      var vao = gl.createVertexArray(); gl.bindVertexArray(vao);
      [['aPos', M.p], ['aNrm', M.n]].forEach(function(x){
        var buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, b64(x[1], Int16Array), gl.STATIC_DRAW);
        var l = gl.getAttribLocation(prog, x[0]); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, 3, gl.SHORT, true, 0, 0);
      });
      var ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, b64(M.f, Uint16Array), gl.STATIC_DRAW);
      count = M.ni;
      gl.enable(gl.DEPTH_TEST);
      gl.uniform1f(U.uRough, 0.10); gl.uniform3f(U.uTint, 0.64, 0.79, 1.0); gl.uniform3f(U.uEnv, 0.91, 0.98, 1.10);
      gl.uniform3f(U.uPos, 0, 0, 0); gl.uniform1f(U.uScale, 1);
      window.ESX_MESH = null;
    } catch (e) { gl = null; showFlat(); return; }
    cv.addEventListener('webglcontextlost', function(e){ e.preventDefault(); gl = null; cv.hidden = true; still.hidden = false; showFlat(); });
    window.addEventListener('pointermove', function(e){ tx = e.clientX / window.innerWidth * 2 - 1; ty = e.clientY / window.innerHeight * 2 - 1; }, {passive:true});
    kick();
  }
  startFloor();
  /* at the top of the page the corner is empty until the 3D mark lands there */
  if (fgl && (window.pageYOffset || 0) < 120){ slot.style.setProperty('--dock', '0'); slot.style.setProperty('--mark', '0'); }
  window.addEventListener('resize', kick);
  document.addEventListener('visibilitychange', kick);
  last = performance.now(); kick();
  var s = document.createElement('script'); s.src = 'mesh.js'; s.async = true; s.onload = start; s.onerror = showFlat; document.head.appendChild(s);
})();

(function(){
  "use strict";
  var g = document.getElementById('grain');
  /* a 200px tile of light and dark specks: each speck is white or black with a random strength, so the
     page gets texture without its overall brightness shifting much */
  try {
    var c = document.createElement('canvas'); c.width = c.height = 200;
    var x = c.getContext('2d'), im = x.createImageData(200, 200), d = im.data;
    for (var i = 0; i < d.length; i += 4){
      var n = (Math.random() + Math.random() + Math.random()) / 1.5 - 1;     /* roughly bell-shaped, -1..1 */
      var v = n > 0 ? 255 : 0; d[i] = d[i+1] = d[i+2] = v; d[i+3] = Math.min(255, Math.abs(n) * 72);
    }
    x.putImageData(im, 0, 0);
    g.style.backgroundImage = 'url(' + c.toDataURL('image/png') + ')';
  } catch (e) { g.hidden = true; }
})();
