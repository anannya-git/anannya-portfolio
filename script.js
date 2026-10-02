(() => {
  "use strict";

  const root = document.documentElement;
  const reduceQuery = matchMedia("(prefers-reduced-motion: reduce)");
  const sections = [...document.querySelectorAll("[data-shape]")];

  /* ---------- Page chrome: reveal, rail ---------- */

  sections.forEach((section) => {
    section.querySelectorAll(".reveal").forEach((el, i) => el.style.setProperty("--i", i));
  });

  const revealer = new IntersectionObserver(
    (entries) => entries.forEach((e) => e.isIntersecting && e.target.classList.add("in")),
    { threshold: 0.15 }
  );
  sections.forEach((s) => revealer.observe(s));

  const rail = document.querySelector(".rail");
  const railButtons = sections.map((section) => {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.label = section.dataset.label;
    b.setAttribute("aria-label", `Go to ${section.dataset.label}`);
    b.addEventListener("click", () =>
      section.scrollIntoView({ behavior: reduceQuery.matches ? "auto" : "smooth" })
    );
    rail?.appendChild(b);
    return b;
  });

  let activeIndex = -1;
  function setActive(i) {
    if (i === activeIndex) return;
    activeIndex = i;
    railButtons.forEach((b, j) => b.setAttribute("aria-current", String(j === i)));
  }

  /* ---------- Scroll → continuous section position ---------- */

  // t is a float: 2.0 means the third section's mascot is fully formed,
  // 2.5 means halfway through the morph into the fourth.
  let boundaries = [];
  let vh = innerHeight;
  function measure() {
    vh = innerHeight;
    boundaries = sections.slice(0, -1).map((s) => s.offsetTop + s.offsetHeight);
  }
  function scrollT() {
    const center = scrollY + vh / 2;
    let t = 0;
    for (const b of boundaries) t += Math.min(1, Math.max(0, (center - b + vh * 0.45) / (vh * 0.9)));
    return t;
  }
  measure();
  addEventListener("resize", measure);
  new ResizeObserver(measure).observe(document.body);

  function updateChrome() {
    setActive(Math.round(scrollT()));
  }
  addEventListener("scroll", updateChrome, { passive: true });
  updateChrome();

  /* ---------- Shapes: every mascot is N points in roughly [-1.2, 1.2]^3 ---------- */

  // Stacked layout (phones, upright tablets). Keep in sync with the stacked media query in styles.css.
  const STACKED = matchMedia("(orientation: portrait) and (max-width: 1100px), (max-width: 640px)");
  const small = matchMedia("(max-width: 900px), (pointer: coarse)").matches;
  const N = small ? 5000 : 10000;
  const DUST = 0.1;

  let seed = 20251002;
  const rnd = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  const TAU = Math.PI * 2;
  const lerp = (a, b, t) => a + (b - a) * t;

  const sphere = (r, cx = 0, cy = 0, cz = 0) => () => {
    const u = rnd() * 2 - 1, th = rnd() * TAU, s = Math.sqrt(1 - u * u);
    return [cx + r * s * Math.cos(th), cy + r * u, cz + r * s * Math.sin(th)];
  };
  const tri = (a, b, c) => () => {
    let u = rnd(), v = rnd();
    if (u + v > 1) { u = 1 - u; v = 1 - v; }
    return [0, 1, 2].map((k) => a[k] + u * (b[k] - a[k]) + v * (c[k] - a[k]));
  };
  const quad = (a, b, c, d) => (rnd() < 0.5 ? tri(a, b, c) : tri(a, c, d))();
  const box = (w, h, d, cx = 0, cy = 0, cz = 0) => () => {
    const areas = [w * h, w * h, w * d, w * d, h * d, h * d];
    let pick = rnd() * areas.reduce((x, y) => x + y), f = 0;
    while (pick > areas[f]) pick -= areas[f++];
    const a = rnd() - 0.5, b = rnd() - 0.5, side = f % 2 ? 0.5 : -0.5;
    const p = f < 2 ? [a * w, b * h, side * d] : f < 4 ? [a * w, side * h, b * d] : [side * w, a * h, b * d];
    return [cx + p[0], cy + p[1], cz + p[2]];
  };
  // Lateral surface of a (possibly tapered) tube along y.
  const tube = (r0, r1, y0, y1, cx = 0, cz = 0) => () => {
    const t = rnd(), th = rnd() * TAU, r = lerp(r0, r1, t);
    return [cx + r * Math.cos(th), lerp(y0, y1, t), cz + r * Math.sin(th)];
  };
  const segment = (a, b, jitter = 0.012) => () => {
    const t = rnd();
    return [0, 1, 2].map((k) => lerp(a[k], b[k], t) + (rnd() - 0.5) * jitter);
  };
  const polyline = (pts, jitter) => {
    const segs = pts.slice(1).map((p, i) => segment(pts[i], p, jitter));
    return () => segs[Math.floor(rnd() * segs.length)]();
  };
  const torus = (R, r, transform) => () => {
    const u = rnd() * TAU, v = rnd() * TAU;
    const p = [(R + r * Math.cos(v)) * Math.cos(u), r * Math.sin(v), (R + r * Math.cos(v)) * Math.sin(u)];
    return transform ? transform(p) : p;
  };
  const rotX = (a) => ([x, y, z]) => [x, y * Math.cos(a) - z * Math.sin(a), y * Math.sin(a) + z * Math.cos(a)];
  const rotZ = (a) => ([x, y, z]) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a), z];

  function build(parts) {
    const out = new Float32Array(N * 3);
    const core = Math.floor(N * (1 - DUST));
    const total = parts.reduce((s, [w]) => s + w, 0);
    let i = 0;
    parts.forEach(([w, fn], pi) => {
      const count = pi === parts.length - 1 ? core - i : Math.round((core * w) / total);
      for (let c = 0; c < count && i < core; c++, i++) out.set(fn(), i * 3);
    });
    // Ambient dust drifts in a wide shell around the mascot.
    for (; i < N; i++) {
      const p = sphere(1)();
      const r = 1.8 + rnd() * 2.6;
      out.set([p[0] * r * 1.6, p[1] * r, p[2] * r * 0.4], i * 3);
    }
    // Shuffle the mascot particles so each travels between unrelated parts of
    // consecutive mascots. Dust keeps the last indices, so the shader can tell it apart.
    for (let a = core - 1; a > 0; a--) {
      const b = Math.floor(rnd() * (a + 1));
      for (let k = 0; k < 3; k++) [out[a * 3 + k], out[b * 3 + k]] = [out[b * 3 + k], out[a * 3 + k]];
    }
    return out;
  }

  const SHAPES = {
    // Rising bar chart with a trend arrow.
    bars: () => {
      const base = -0.95, heights = [0.75, 1.2, 1.85], xs = [-0.72, 0, 0.72];
      const tops = xs.map((x, i) => [x, base + heights[i] + 0.22, 0.32]);
      return build([
        [1.4, box(2.3, 0.05, 1, 0, base - 0.03, 0)],
        ...xs.map((x, i) => [heights[i] * 1.7, box(0.46, heights[i], 0.46, x, base + heights[i] / 2, 0)]),
        [0.7, polyline([[-1.05, base + 0.55, 0.32], ...tops], 0.02)],
        [0.25, polyline([[0.5, tops[2][1] - 0.02, 0.32], tops[2], [0.66, tops[2][1] - 0.22, 0.32]], 0.02)],
      ]);
    },
    // A trefoil-style torus knot: untangling a problem.
    knot: () => {
      const curve = (t) => {
        const r = 2 + Math.cos(3 * t);
        return [r * Math.cos(2 * t) * 0.36, r * Math.sin(2 * t) * 0.36, -Math.sin(3 * t) * 0.5];
      };
      return build([
        [1, () => {
          const t = rnd() * TAU, p = curve(t), q = curve(t + 0.001);
          const tg = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
          const tl = Math.hypot(...tg);
          tg.forEach((v, k) => (tg[k] = v / tl));
          let n = [tg[1], -tg[0], 0];
          const nl = Math.hypot(...n) || 1;
          n = n.map((v) => v / nl);
          const b = [tg[1] * n[2] - tg[2] * n[1], tg[2] * n[0] - tg[0] * n[2], tg[0] * n[1] - tg[1] * n[0]];
          const a = rnd() * TAU, r = 0.13;
          return [0, 1, 2].map((k) => p[k] + r * (Math.cos(a) * n[k] + Math.sin(a) * b[k]));
        }],
      ]);
    },
    // A rocket with fins, a porthole and an exhaust plume.
    rocket: () => {
      const r = 0.3, low = -0.55, top = 0.45;
      const fin = (a) => tri(
        [r * Math.cos(a), low + 0.4, r * Math.sin(a)],
        [r * Math.cos(a), low, r * Math.sin(a)],
        [(r + 0.34) * Math.cos(a), low - 0.25, (r + 0.34) * Math.sin(a)]
      );
      return build([
        [3.2, tube(r, r, low, top)],
        [1.8, () => { const t = Math.sqrt(rnd()), th = rnd() * TAU; return [r * t * Math.cos(th), top + 0.62 * (1 - t), r * t * Math.sin(th)]; }],
        [0.6, fin(0)], [0.6, fin(TAU / 3)], [0.6, fin((2 * TAU) / 3)],
        [0.5, torus(0.12, 0.018, (p) => [p[0], p[2] + 0.12, r + 0.02 + p[1]])],
        [2.2, () => { const t = rnd(), a = rnd() * TAU, rr = 0.22 * (1 - t) * Math.sqrt(rnd()); return [rr * Math.cos(a), low - 0.05 - t * 0.75, rr * Math.sin(a)]; }],
      ]);
    },
    // A folded paper plane trailing a long, drifting contrail.
    plane: () => {
      const nose = [1.15, 0.15, 0], tail = [-0.85, 0, 0];
      const left = [-0.95, 0.22, 0.78], right = [-0.95, 0.22, -0.78], keel = [-0.8, -0.38, 0];
      return build([
        [2, tri(nose, tail, left)],
        [2, tri(nose, tail, right)],
        [1.4, tri(nose, tail, keel)],
        [1.6, () => {
          // s runs from the tail (0) to the far end (1); most particles stay near the plane.
          const s = Math.pow(rnd(), 1.3);
          const spread = 0.045 + 0.2 * s;
          const gauss = () => (rnd() + rnd() + rnd() - 1.5) * 0.8;
          return [
            -0.88 - s * 2.6,
            -0.02 - 0.32 * Math.sin(s * Math.PI * 0.9) + gauss() * spread,
            -0.12 * s + gauss() * spread,
          ];
        }],
      ]);
    },
  };

  // Greeting: a solid, lowercase "hi" with a rounded arch and a round dot.
  SHAPES.hi = () => {
    // x-height sits at the top of the arch; the h's ascender rises well above it.
    const t = 0.32, d = 0.4, x0 = 0.12, y0 = -0.25;
    const base = -1 + y0, spring = 0.05 + y0, R0 = 0.29, xh = spring + R0 + t, asc = 1.5 + y0;
    const stem = (cx, top) => box(t, top - base, d, cx + x0, (base + top) / 2, 0);
    const arch = () => {
      const cx = -0.45 + x0, R1 = R0 + t;
      const a = rnd() * Math.PI;
      const face = rnd();
      if (face < 0.5) {
        const r = Math.sqrt(lerp(R0 * R0, R1 * R1, rnd()));
        return [cx + r * Math.cos(a), spring + r * Math.sin(a), (rnd() < 0.5 ? -0.5 : 0.5) * d];
      }
      const r = face < 0.8 ? R1 : R0;
      return [cx + r * Math.cos(a), spring + r * Math.sin(a), (rnd() - 0.5) * d];
    };
    return build([
      [4, stem(-0.9, asc)],
      [1.6, stem(0, spring)],
      [1.9, arch],
      [2.4, stem(0.65, xh)],
      [0.7, sphere(0.2, 0.65 + x0, xh + 0.42, 0)],
    ]);
  };

  // Per-mascot look: two colors (bottom → top) and how it sits and moves.
  const LOOK = {
    hi:     { c: ["#8e8e93", "#ffffff"], pitch: 0.12, roll: 0, yaw: 0, spin: 0, wobble: 0.45, size: 0.72 },
    bars:   { c: ["#5a5a5f", "#ffffff"], pitch: 0.3, roll: 0, yaw: 0.05, spin: 0, wobble: 0.3 },
    knot:   { c: ["#48484d", "#f5f5f7"], pitch: 0.5, roll: 0, yaw: 0, spin: 0.22, wobble: 0 },
    rocket: { c: ["#ffffff", "#8e8e93"], pitch: 0.2, roll: -0.35, yaw: 0, spin: 0.5, wobble: 0 },
    plane:  { c: ["#6e6e73", "#ffffff"], pitch: 0.85, roll: 0.15, yaw: -0.25, spin: 0, wobble: 0.2, bank: 0.14 },
  };

  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);

  /* ---------- WebGL ---------- */

  const canvas = document.getElementById("field");
  const gl = canvas?.getContext("webgl", { antialias: false, alpha: false, powerPreference: "high-performance" });
  if (!gl) {
    root.classList.add("no-webgl");
    return;
  }

  const VERT = `
    attribute vec3 aA;
    attribute vec3 aB;
    attribute vec4 aR;
    attribute float aD;
    uniform mat3 uRotA, uRotB, uCam;
    uniform float uF, uScatter, uTime, uMotion, uScale, uPx, uSize, uDist, uFlyA, uFlyB;
    uniform vec2 uCenter, uRes, uMouse, uMouseVel;
    uniform vec3 uA1, uA2, uB1, uB2;
    varying vec3 vColor;
    varying float vAlpha;
    float hash(float n) { return fract(sin(n) * 43758.5453); }
    // The plane flies along world +x at FLY_SPEED; the air (dust) streams past at that speed.
    const float FLY_SPEED = 2.4;
    float bob(float t) { return 0.07 * sin(1.3 * t); }
    // The contrail lives in the world, not on the plane: each particle sits where the
    // plane's tail was when it passed, so it streams back with the air and records the
    // plane's recent bobbing. R is the plane's current rotation (it places the tail).
    vec3 contrail(float w, mat3 R) {
      float s = pow(fract(hash(w * 91.7) + uTime * 0.6), 1.3);
      float behind = s * 2.6;
      float spread = 0.04 + 0.2 * s;
      vec2 g = vec2(hash(w * 53.1) + hash(w * 27.7) + hash(w * 11.3) - 1.5,
                    hash(w * 71.9) + hash(w * 37.1) + hash(w * 19.7) - 1.5) * 0.8;
      vec3 tail = R * vec3(-0.88, -0.02, 0.0);
      float then = bob(uTime - behind / FLY_SPEED) - bob(uTime);
      return tail + vec3(-behind, then - 0.04 * s + g.x * spread, g.y * spread);
    }
    void main() {
      float w = aR.w;
      float m = clamp((uF - w * 0.35) / 0.65, 0.0, 1.0);
      m = m * m * (3.0 - 2.0 * m);
      bool mascot = aD < 0.5;
      vec3 pa = uRotA * aA, pb = uRotB * aB;
      if (uFlyA > 0.5 && mascot && aA.x < -0.96) pa = contrail(w, uRotA);
      if (uFlyB > 0.5 && mascot && aB.x < -0.96) pb = contrail(w, uRotB);
      vec3 p = mix(pa, pb, m);
      float fly = mix(uFlyA, uFlyB, m) * uMotion;
      if (mascot) p.y += fly * bob(uTime);
      // While the plane flies, the air streams past it in world space, so camera
      // moves show the stream (and the contrail) from new angles.
      if (!mascot && fly > 0.0) {
        float streamed = mod(p.x - uTime * FLY_SPEED * (0.7 + 0.6 * w) + 8.0, 16.0) - 8.0;
        p.x = mix(p.x, streamed, fly);
      }
      float burst = sin(3.14159 * m) * 0.28 + uScatter;
      p += aR.xyz * burst * (0.5 + w * 1.2);
      p += uMotion * 0.018 * vec3(sin(uTime * 1.3 + w * 40.0), cos(uTime * 1.1 + w * 31.0), sin(uTime * 0.9 + w * 17.0));
      p = uCam * p;
      float gap = uDist - p.z;
      float persp = min(uDist / max(gap, 0.35), 3.0);
      vec2 sp = uCenter + vec2(p.x, -p.y) * uScale * persp;
      vec2 d = sp - uMouse;
      float dist = length(d);
      // Natural push: soft falloff, uneven strength and a bent direction per particle,
      // plus a wake that drags particles along with the cursor's motion.
      float r = 70.0 * uPx;
      float fall = exp(-(dist * dist) / (r * r));
      float strength = 0.35 + 1.3 * fract(w * 7.31);
      float bend = (fract(w * 13.7) - 0.5) * 1.4;
      vec2 dir = d / (dist + 0.001);
      dir = vec2(dir.x * cos(bend) - dir.y * sin(bend), dir.x * sin(bend) + dir.y * cos(bend));
      sp += (dir * 110.0 * uPx + uMouseVel * 0.8) * fall * strength * uMotion;
      vec2 clip = sp / uRes * 2.0 - 1.0;
      gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
      // Particles that pass the camera during a fly-through are hidden, not smeared.
      gl_PointSize = gap < 0.35 ? 0.0 : (1.1 + w * 1.9) * persp * uPx * uSize;
      float h = clamp(p.y * 0.42 + 0.5, 0.0, 1.0);
      vColor = mix(mix(uA1, uA2, h), mix(uB1, uB2, h), m);
      float depth = clamp((p.z + 1.6) / 3.2, 0.0, 1.0);
      vAlpha = (0.22 + 0.78 * depth) / (1.0 + burst * 0.8);
    }`;
  const FRAG = `
    precision mediump float;
    varying vec3 vColor;
    varying float vAlpha;
    void main() {
      vec2 c = gl_PointCoord - 0.5;
      float a = exp(-dot(c, c) * 14.0) - 0.03;
      if (a <= 0.0) discard;
      a *= vAlpha * 0.85;
      gl_FragColor = vec4(vColor * a, a);
    }`;

  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  let prog;
  try {
    prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  } catch (err) {
    console.error(err);
    root.classList.add("no-webgl");
    return;
  }
  gl.useProgram(prog);

  const loc = {};
  ["aA", "aB", "aR", "aD"].forEach((n) => (loc[n] = gl.getAttribLocation(prog, n)));
  ["uRotA", "uRotB", "uCam", "uDist", "uFlyA", "uFlyB", "uF", "uScatter", "uTime", "uMotion", "uScale", "uPx", "uSize", "uCenter", "uRes", "uMouse", "uMouseVel", "uA1", "uA2", "uB1", "uB2"]
    .forEach((n) => (loc[n] = gl.getUniformLocation(prog, n)));

  const shapeNames = sections.map((s) => s.dataset.shape);
  const buffers = {};
  for (const name of new Set(shapeNames)) {
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, SHAPES[name](), gl.STATIC_DRAW);
    buffers[name] = buf;
  }

  const rand = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) {
    const p = sphere(1)();
    rand.set([p[0], p[1], p[2], rnd()], i * 4);
  }
  const randBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, randBuf);
  gl.bufferData(gl.ARRAY_BUFFER, rand, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(loc.aR);
  gl.vertexAttribPointer(loc.aR, 4, gl.FLOAT, false, 0, 0);
  const dustFlag = new Float32Array(N);
  dustFlag.fill(1, Math.floor(N * (1 - DUST)));
  const dustBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, dustBuf);
  gl.bufferData(gl.ARRAY_BUFFER, dustFlag, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(loc.aD);
  gl.vertexAttribPointer(loc.aD, 1, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(loc.aA);
  gl.enableVertexAttribArray(loc.aB);

  gl.disable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE);
  gl.clearColor(0, 0, 0, 1);

  // Column-major rotation: Rx(pitch) · Ry(yaw) · Rz(roll).
  function rotation(yaw, pitch, roll) {
    const [cy, sy, cx, sx, cz, sz] = [Math.cos(yaw), Math.sin(yaw), Math.cos(pitch), Math.sin(pitch), Math.cos(roll), Math.sin(roll)];
    const ry = [cy, 0, sy, 0, 1, 0, -sy, 0, cy];
    const rx = [1, 0, 0, 0, cx, -sx, 0, sx, cx];
    const rz = [cz, -sz, 0, sz, cz, 0, 0, 0, 1];
    const mul = (a, b) => {
      const o = new Array(9);
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
      return o;
    };
    const m = mul(mul(rx, ry), rz);
    return new Float32Array([m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]);
  }

  let W = 0, H = 0, dpr = 1;
  function resize() {
    dpr = Math.min(devicePixelRatio || 1, 2);
    W = canvas.clientWidth;
    H = canvas.clientHeight;
    const w = Math.round(W * dpr), h = Math.round(H * dpr);
    if (w === canvas.width && h === canvas.height) return;
    canvas.width = w;
    canvas.height = h;
    gl.viewport(0, 0, w, h);
  }

  // If the GPU drops the context (memory pressure, driver reset), fall back to the
  // static backdrop rather than freezing on a black canvas.
  let lost = false;
  canvas.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    lost = true;
    root.classList.add("no-webgl");
  });
  resize();
  addEventListener("resize", resize);

  // Where a mascot sits on screen, in CSS pixels.
  function placement(i) {
    const right = sections[i].dataset.side === "right";
    if (STACKED.matches) return { x: W * 0.5, y: H * 0.27, s: Math.min(W * 0.27, H * 0.17) };
    // Wide screens keep the mascot inside the same centred frame as the copy.
    const frame = Math.max(0, (W - 1680) / 2), cw = W - 2 * frame;
    const at = W <= 1100 ? (right ? 0.74 : 0.26) : (right ? 0.72 : 0.28);
    return { x: frame + cw * at, y: H * 0.52, s: Math.min(cw * (W <= 1100 ? 0.15 : 0.16), H * 0.29) };
  }

  const mouse = { x: -1e4, y: -1e4, nx: 0, ny: 0, sx: 0, sy: 0, px: -1e4, py: -1e4, vx: 0, vy: 0 };
  addEventListener("pointermove", (e) => {
    if (e.pointerType === "touch") return;
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    mouse.nx = e.clientX / W - 0.5;
    mouse.ny = e.clientY / H - 0.5;
  }, { passive: true });
  document.addEventListener("pointerleave", () => { mouse.x = mouse.y = -1e4; });

  const ease = (x) => x * x * (3 - 2 * x);

  // Camera choreography: each scroll transition flies its own path, then settles
  // back to a readable front view once the next mascot has formed.
  // Every path returns to the front by itself, so a flight can be scaled down
  // (fast scrolling) without leaving the camera off-axis.
  const FLIGHTS = [
    { yaw: 0.7, pitch: 1.25 },   // swoop over the top
    { yaw: 2.6, pitch: 0.25 },   // swing round to the back
    { yaw: -0.8, pitch: -1.15 }, // dive underneath
    { yaw: -2.4, pitch: 0.6 },   // swing round the other way, from above
  ];
  function camera(k, f, amp) {
    const fl = FLIGHTS[k % FLIGHTS.length], s = Math.sin(Math.PI * f) * amp;
    return { m: rotation(fl.yaw * s, fl.pitch * s, 0), dist: 4 - 1.2 * s };
  }
  let cur = scrollT();
  let lastScroll = scrollY, speed = 0, time = 0, last = performance.now(), prevCur = cur, rate = 0;
  const start = last;

  function frame(now) {
    if (lost) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const reduce = reduceQuery.matches;
    if (!reduce) time += dt;

    const target = scrollT();
    cur = reduce ? target : cur + (target - cur) * (1 - Math.exp(-dt * 6));
    const k = Math.min(Math.max(0, Math.floor(cur)), sections.length - 2);
    let f = Math.min(1, Math.max(0, cur - k));
    if (reduce) f = f < 0.5 ? 0 : 1;

    // Fast scrolling loosens the swarm a little.
    const raw = Math.abs(scrollY - lastScroll) / Math.max(dt, 1e-3) / vh;
    lastScroll = scrollY;
    speed += (Math.min(raw * 0.08, 0.22) - speed) * (1 - Math.exp(-dt * 5));
    // Sections per second. Fast sweeps calm the camera so it never whips or blinks.
    rate += (Math.abs(cur - prevCur) / Math.max(dt, 1e-3) - rate) * (1 - Math.exp(-dt * 4));
    prevCur = cur;
    const amp = Math.min(1, Math.max(0.12, 1 - (rate - 1.2) / 2.2));
    const intro = reduce ? 0 : 2.6 * Math.pow(1 - Math.min(1, (now - start) / 2200), 3);

    mouse.sx += (mouse.nx - mouse.sx) * (1 - Math.exp(-dt * 3));
    // Cursor velocity (px per frame-ish), smoothed and capped, for the wake.
    const jump = Math.abs(mouse.x - mouse.px) > 400 || Math.abs(mouse.y - mouse.py) > 400;
    const k2 = 1 - Math.exp(-dt * 8);
    mouse.vx += ((jump ? 0 : Math.max(-60, Math.min(60, mouse.x - mouse.px))) - mouse.vx) * k2;
    mouse.vy += ((jump ? 0 : Math.max(-60, Math.min(60, mouse.y - mouse.py))) - mouse.vy) * k2;
    mouse.px = mouse.x;
    mouse.py = mouse.y;
    mouse.sy += (mouse.ny - mouse.sy) * (1 - Math.exp(-dt * 3));

    const a = shapeNames[k], b = shapeNames[k + 1];
    const la = LOOK[a], lb = LOOK[b];
    // Scroll turns each mascot relative to its own resting pose, so poses never drift.
    const look = (l, offset) => rotation(
      l.yaw + l.spin * time + l.wobble * Math.sin(time * 0.5) + mouse.sx * 0.6 + offset * 0.4,
      l.pitch + mouse.sy * 0.3,
      l.roll + (l.bank || 0) * Math.sin(time * 0.9)
    );

    const pa = placement(k), pb = placement(k + 1), e = ease(f);

    gl.uniformMatrix3fv(loc.uRotA, false, look(la, cur - k));
    gl.uniformMatrix3fv(loc.uRotB, false, look(lb, cur - k - 1));
    const cam = camera(k, f, reduce ? 0 : amp);
    gl.uniformMatrix3fv(loc.uCam, false, cam.m);
    gl.uniform1f(loc.uDist, cam.dist);
    gl.uniform1f(loc.uFlyA, a === "plane" ? 1 : 0);
    gl.uniform1f(loc.uFlyB, b === "plane" ? 1 : 0);
    gl.uniform1f(loc.uF, f);
    gl.uniform1f(loc.uScatter, (reduce ? 0 : speed) + intro);
    gl.uniform1f(loc.uTime, time);
    gl.uniform1f(loc.uMotion, reduce ? 0 : 1);
    gl.uniform1f(loc.uScale, lerp(pa.s * (la.size || 1), pb.s * (lb.size || 1), e) * dpr);
    gl.uniform1f(loc.uPx, dpr);
    gl.uniform1f(loc.uSize, STACKED.matches ? 1.15 : 1.3);
    // A chase camera never sits perfectly still on its subject.
    const chase = reduce ? 0 : (a === "plane" ? 1 - e : 0) + (b === "plane" ? e : 0);
    const driftX = chase * (Math.sin(time * 0.6) * 10 + Math.sin(time * 1.7) * 3);
    const driftY = chase * (Math.sin(time * 0.9) * 8 + Math.cos(time * 2.1) * 2);
    gl.uniform2f(loc.uCenter, (lerp(pa.x, pb.x, e) + driftX) * dpr, (lerp(pa.y, pb.y, e) + driftY) * dpr);
    gl.uniform2f(loc.uRes, canvas.width, canvas.height);
    gl.uniform2f(loc.uMouse, mouse.x * dpr, mouse.y * dpr);
    gl.uniform2f(loc.uMouseVel, mouse.vx * dpr, mouse.vy * dpr);
    gl.uniform3fv(loc.uA1, hex(la.c[0]));
    gl.uniform3fv(loc.uA2, hex(la.c[1]));
    gl.uniform3fv(loc.uB1, hex(lb.c[0]));
    gl.uniform3fv(loc.uB2, hex(lb.c[1]));

    gl.bindBuffer(gl.ARRAY_BUFFER, buffers[a]);
    gl.vertexAttribPointer(loc.aA, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers[b]);
    gl.vertexAttribPointer(loc.aB, 3, gl.FLOAT, false, 0, 0);

    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.POINTS, 0, N);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
