(() => {
  "use strict";

  const root = document.documentElement;
  const reduceQuery = matchMedia("(prefers-reduced-motion: reduce)");
  const sections = [...document.querySelectorAll("[data-shape]")];

  /* ---------- Sound ---------- */

  // Every sound is synthesised with Web Audio, so nothing is downloaded. Sound is
  // off until the visitor turns it on (browsers block audio before a gesture);
  // the choice is remembered. The particle loop writes `fx`; the audio loop reads it.
  const fx = { cur: null, k: 0, f: 0, s: 0, yaw: 0, dist: 4, push: 0, cursorSpeed: 0, fly: 0, mx: 0.5 };
  const sfx = (() => {
    const AC = window.AudioContext || window.webkitAudioContext;
    const toggle = document.querySelector(".sound-toggle");
    if (!AC || !toggle) {
      toggle?.remove();
      return { tick() {}, thump() {}, chirp() {} };
    }
    let ctx = null, on = false, nodes = null, loopId = 0;
    let lastY = scrollY, lastT = performance.now(), formed = null;
    const NOTES = [220, 246.94, 293.66, 329.63, 392];   // A minor pentatonic, one per section
    const store = (v) => { try { localStorage.setItem("sound", v ? "on" : "off"); } catch {} };

    function noiseBuffer(seconds) {
      const b = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      return b;
    }
    function noise() {
      const s = ctx.createBufferSource();
      s.buffer = nodes.noise;
      s.loop = true;
      s.start(0, Math.random() * 2);
      return s;
    }
    function chain(...list) { for (let i = 0; i < list.length - 1; i++) list[i].connect(list[i + 1]); return list[list.length - 1]; }
    function filter(type, freq, q = 0.7) { const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q; return f; }
    function gain(v = 0) { const g = ctx.createGain(); g.gain.value = v; return g; }
    const set = (param, v, tc = 0.12) => param.setTargetAtTime(v, ctx.currentTime, tc);
    // Continuous layers are retargeted only when a value moves, so the audio thread
    // is not handed a new automation event for every parameter on every frame.
    const last = new Map();
    const setIf = (param, v, tc) => {
      const prev = last.get(param);
      if (prev !== undefined && Math.abs(prev - v) <= Math.max(1e-4, Math.abs(prev) * 0.01)) return;
      last.set(param, v);
      set(param, v, tc);
    };

    function build() {
      ctx = new AC();
      nodes = { noise: noiseBuffer(2) };
      const master = gain(0), comp = ctx.createDynamicsCompressor();
      master.connect(comp).connect(ctx.destination);
      // A generated room: decaying noise as the reverb impulse.
      const verb = ctx.createConvolver(), ir = ctx.createBuffer(2, ctx.sampleRate * 3, ctx.sampleRate);
      for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2.6); }
      verb.buffer = ir;
      const verbOut = gain(0.45);
      verb.connect(verbOut).connect(master);

      // Drone: three detuned low tones through a slowly breathing low-pass.
      const padFilter = filter("lowpass", 360), padGain = gain(0.05);
      [[55, 0, "sine"], [82.41, 6, "triangle"], [110, -5, "sine"]].forEach(([f, det, type]) => {
        const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.detune.value = det; o.connect(padFilter); o.start();
      });
      const lfo = ctx.createOscillator(), lfoAmt = gain(110);
      lfo.frequency.value = 0.07; lfo.connect(lfoAmt).connect(padFilter.frequency); lfo.start();
      padFilter.connect(padGain); padGain.connect(master); padGain.connect(verb);
      const air = chain(noise(), filter("lowpass", 800), gain(0.01)); air.connect(master);

      // Scroll wind, cursor shimmer and plane airflow are noise shaped by filters.
      const windBand = filter("bandpass", 400, 0.9), windGain = gain(0);
      chain(noise(), windBand, windGain); windGain.connect(master); windGain.connect(verb);
      const sparkBand = filter("bandpass", 3800, 1.2), sparkGain = gain(0), sparkPan = ctx.createStereoPanner ? ctx.createStereoPanner() : gain(1);
      chain(noise(), filter("highpass", 2400), filter("lowpass", 6000), sparkBand, sparkGain, sparkPan); sparkPan.connect(master); sparkPan.connect(verb);
      const flightGain = gain(0), flightWobble = ctx.createOscillator(), wobbleAmt = gain(0.25);
      chain(noise(), filter("lowpass", 650), flightGain).connect(master);
      flightWobble.frequency.value = 0.3; flightWobble.connect(wobbleAmt);
      const flightLevel = gain(0); wobbleAmt.connect(flightLevel.gain); flightWobble.start();

      // Scroll-scrubbed layers. The morph swarm swells while a mascot dissolves and
      // re-forms, panned with the camera; the tone glides between each section's note.
      const morphBand = filter("lowpass", 600, 0.5), morphGain = gain(0), morphPan = ctx.createStereoPanner ? ctx.createStereoPanner() : gain(1);
      chain(noise(), morphBand, morphGain, morphPan); morphPan.connect(master); morphPan.connect(verb);
      const toneFilter = filter("lowpass", 900), toneGain = gain(0.018), tones = [];
      [["sine", 0], ["triangle", 7]].forEach(([type, det]) => {
        const o = ctx.createOscillator(); o.type = type; o.frequency.value = NOTES[0] / 2; o.detune.value = det; o.connect(toneFilter); o.start(); tones.push(o);
      });
      toneFilter.connect(toneGain); toneGain.connect(verb); toneGain.connect(master);

      Object.assign(nodes, { master, verb, padFilter, windBand, windGain, sparkBand, sparkGain, sparkPan, flightGain, morphBand, morphGain, morphPan, toneFilter, tones });
    }

    // A mascot forming: a falling sub-bass boom, a low noise thud and a soft chord.
    function boom(index) {
      const t = ctx.currentTime, { master, verb } = nodes;
      const sub = ctx.createOscillator(), subGain = gain(0);
      sub.frequency.setValueAtTime(72, t); sub.frequency.exponentialRampToValueAtTime(36, t + 1.3);
      subGain.gain.setValueAtTime(0, t); subGain.gain.linearRampToValueAtTime(0.22, t + 0.03); subGain.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
      sub.connect(subGain); subGain.connect(master); subGain.connect(verb); sub.start(t); sub.stop(t + 1.9);
      const thud = noise(), thudGain = gain(0);
      thudGain.gain.setValueAtTime(0.12, t); thudGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      chain(thud, filter("lowpass", 220), thudGain); thudGain.connect(master); thud.stop(t + 0.6);
      const root = NOTES[index % NOTES.length];
      [1, 1.5, 2].forEach((m, i) => {
        const o = ctx.createOscillator(), g = gain(0);
        o.type = "sine"; o.frequency.value = root * m;
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.03 / (i + 1), t + 0.25); g.gain.exponentialRampToValueAtTime(0.0001, t + 3.2);
        o.connect(g); g.connect(verb); g.connect(master); o.start(t); o.stop(t + 3.3);
      });
    }

    function loop(now) {
      loopId = requestAnimationFrame(loop);
      if (now - lastT < 32) return;          // 30 Hz is plenty: every change is smoothed anyway
      const dt = Math.max(0.001, (now - lastT) / 1000);
      lastT = now;
      const v = Math.abs(scrollY - lastY) / dt / innerHeight;   // screens per second
      lastY = scrollY;
      const { windBand, windGain, sparkBand, sparkGain, sparkPan, flightGain, padFilter } = nodes;
      setIf(windGain.gain, Math.min(0.17, v * 0.07), 0.08);
      setIf(windBand.frequency, 320 + Math.min(v, 4) * 520, 0.1);
      const stir = fx.push * Math.min(1, fx.cursorSpeed / 700);
      setIf(sparkGain.gain, Math.min(0.012, stir * 0.012), 0.12);
      setIf(sparkBand.frequency, 3800 + Math.min(fx.cursorSpeed, 1500) * 0.4, 0.15);
      if (sparkPan.pan) set(sparkPan.pan, (fx.mx - 0.5) * 1.4, 0.1);
      setIf(flightGain.gain, fx.fly * 0.06, 0.4);
      // Everything below follows scroll position, so it plays backwards when scrolling up.
      const { morphBand, morphGain, morphPan, toneFilter, tones } = nodes;
      const near = 4 / fx.dist;                                   // >1 when the camera pushes in
      // A soft, dark breath of air rather than grit: low-passed and kept well under the music.
      setIf(morphGain.gain, Math.min(0.07, fx.s * 0.045 * near), 0.12);
      setIf(morphBand.frequency, Math.min(1400, 380 + fx.f * 700 * near), 0.12);
      if (morphPan.pan) set(morphPan.pan, Math.max(-0.9, Math.min(0.9, Math.sin(fx.yaw) * 0.9)), 0.08);
      const e = fx.f * fx.f * (3 - 2 * fx.f);
      const pitch = (NOTES[fx.k % NOTES.length] + (NOTES[(fx.k + 1) % NOTES.length] - NOTES[fx.k % NOTES.length]) * e) / 2;
      tones.forEach((o) => setIf(o.frequency, pitch, 0.06));
      setIf(toneFilter.frequency, 500 + 900 * Math.min(1.8, near) + fx.s * 600, 0.08);
      // The drone opens up as the visitor goes deeper into the site.
      const cur = fx.cur ?? Math.round(scrollY / innerHeight);
      setIf(padFilter.frequency, 320 + cur * 70, 0.6);
      const nearest = Math.round(cur);
      if (formed === null) formed = nearest;
      if (Math.abs(cur - nearest) < 0.06 && nearest !== formed) { formed = nearest; boom(nearest); }
    }

    async function enable() {
      if (!ctx) build();
      await ctx.resume();
      on = true;
      formed = null;
      lastY = scrollY; lastT = performance.now(); last.clear();
      nodes.master.gain.cancelScheduledValues(ctx.currentTime);
      set(nodes.master.gain, 0.8, 0.5);
      cancelAnimationFrame(loopId);
      loopId = requestAnimationFrame(loop);
      paint();
    }
    function disable() {
      on = false;
      paint();
      if (!ctx) return;
      set(nodes.master.gain, 0, 0.15);
      setTimeout(() => { if (!on) { cancelAnimationFrame(loopId); ctx.suspend(); } }, 700);
    }
    function paint() {
      toggle.setAttribute("aria-pressed", String(on));
      toggle.setAttribute("aria-label", on ? "Turn sound off" : "Turn sound on");
      toggle.classList.toggle("is-on", on);
    }
    toggle.addEventListener("click", () => { const next = !on; store(next); next ? enable() : disable(); });
    // Sound comes on with the visitor's first interaction anywhere, unless they
    // turned it off before. Browsers only let audio start from a real gesture
    // (click, tap, key); a scroll counts once the page has had one.
    const offByChoice = () => { try { return localStorage.getItem("sound") === "off"; } catch { return false; } };
    const WAKE = ["pointerup", "click", "keydown", "touchend", "wheel", "scroll"];
    function wake(e) {
      if (on || offByChoice() || toggle.contains(e.target)) return stopWaking();
      const gesture = e.type !== "wheel" && e.type !== "scroll";
      if (!gesture && !(navigator.userActivation && navigator.userActivation.hasBeenActive)) return;
      enable().then(() => { if (ctx.state === "running") stopWaking(); });
    }
    function stopWaking() { WAKE.forEach((t) => removeEventListener(t, wake, true)); }
    if (!offByChoice()) WAKE.forEach((t) => addEventListener(t, wake, { capture: true, passive: true }));
    document.addEventListener("visibilitychange", () => {
      if (!ctx || !on) return;
      document.hidden ? ctx.suspend() : ctx.resume();
    });

    return {
      chirp(from, to) {
        if (!on) return;
        const t = ctx.currentTime, o = ctx.createOscillator(), g = gain(0);
        o.type = "sine";
        o.frequency.setValueAtTime(from, t); o.frequency.exponentialRampToValueAtTime(to, t + 0.12);
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.03, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
        o.connect(g); g.connect(nodes.master); g.connect(nodes.verb); o.start(t); o.stop(t + 0.25);
      },
      tick() {
        if (!on) return;
        const t = ctx.currentTime, o = ctx.createOscillator(), g = gain(0);
        o.frequency.value = 1900;
        g.gain.setValueAtTime(0.025, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
        o.connect(g).connect(nodes.master); o.start(t); o.stop(t + 0.05);
      },
      thump() {
        if (!on) return;
        const t = ctx.currentTime, o = ctx.createOscillator(), g = gain(0);
        o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(55, t + 0.25);
        g.gain.setValueAtTime(0.07, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
        o.connect(g); g.connect(nodes.master); g.connect(nodes.verb); o.start(t); o.stop(t + 0.32);
      },
    };
  })();
  document.querySelectorAll(".header-cta, .button, .main-nav a, .org, .org-title").forEach((el) =>
    el.addEventListener("pointerenter", () => sfx.tick())
  );

  /* ---------- Page chrome: reveal, rail ---------- */

  // Scroll-linked text: each section's copy slides in from its own screen edge,
  // fading from transparent to opaque, and leaves the same way. It follows the
  // scroll position exactly, in both directions. Left-hand copy uses the left edge.
  const blocks = sections.map((section) => ({
    section,
    dir: section.dataset.side === "right" ? -1 : 1,
    items: [...section.querySelectorAll(".reveal")],
    captions: [...section.querySelectorAll(".fig, .scroll-cue")],
  }));
  const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  let textQueued = false, sidesDirty = true, introAway = false;
  const written = new WeakMap();
  // Assign styles only when they change: at rest this touches nothing.
  function paintText(el, opacity, transform) {
    const prev = written.get(el);
    if (prev && prev[0] === opacity && prev[1] === transform) return;
    written.set(el, [opacity, transform]);
    el.style.opacity = opacity;
    el.style.transform = transform;
  }
  function placeText() {
    textQueued = false;
    const vh = innerHeight, vw = innerWidth, still = reduceQuery.matches;
    const travel = Math.min(vw * 0.42, 640);
    // All layout reads happen before any style writes.
    const reads = blocks.map((b) => b.section.getBoundingClientRect());
    if (sidesDirty) {
      blocks.forEach((b) => (b.captionSides = b.captions.map((el) => (el.offsetLeft + el.offsetWidth / 2 < vw / 2 ? -1 : 1))));
      sidesDirty = false;
    }
    blocks.forEach((b, s) => {
      const r = reads[s];
      // 0 while the section fills the screen; positive as it sits below (entering),
      // negative as it leaves upward, in viewport heights.
      const c = r.top > 0 ? r.top / vh : r.bottom < vh ? (r.bottom - vh) / vh : 0;
      if (s === 0 && introAway !== Math.abs(c) > 0.6) {
        introAway = !introAway;
        root.classList.toggle("intro-away", introAway);   // pauses the intro's CSS loops
      }
      const n = b.items.length;
      b.items.forEach((el, i) => {
        // The stagger grows with distance, so a section a pixel off its rest spot stays fully shown.
        const lag = 0.035 * Math.min(1, Math.abs(c) / 0.12);
        // Stagger: on the way in the first item leads; on the way out the top item leaves first.
        const ci = c > 0 ? c + i * lag : c < 0 ? c - (n - 1 - i) * lag : 0;
        const shown = 1 - smooth(0.06, 0.46, Math.abs(ci));
        paintText(el, shown.toFixed(3), still || shown > 0.999 ? "" : `translate3d(${(b.dir * travel * (1 - shown) * (1 - shown)).toFixed(1)}px, 0, 0)`);
      });
      // Captions (SCROLL, FIG.) leave through their own nearest edge, a beat after the copy.
      b.captions.forEach((el, i) => {
        const shown = 1 - smooth(0.04, 0.34, Math.abs(c));
        paintText(el, shown.toFixed(3), still || shown > 0.999 ? "" : `translate3d(${(b.captionSides[i] * travel * 0.6 * (1 - shown) * (1 - shown)).toFixed(1)}px, 0, 0)`);
      });
    });
  }
  const queueText = () => { if (!textQueued) { textQueued = true; requestAnimationFrame(placeText); } };
  addEventListener("scroll", queueText, { passive: true });
  addEventListener("resize", () => { sidesDirty = true; queueText(); });
  placeText();

  const rail = document.querySelector(".rail");
  const railButtons = sections.map((section) => {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.label = section.dataset.label;
    b.setAttribute("aria-label", `Go to ${section.dataset.label}`);
    b.addEventListener("click", () =>
      section.scrollIntoView({ behavior: reduceQuery.matches ? "auto" : "smooth" })
    );
    b.addEventListener("pointerenter", () => sfx.tick());
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

  /* ---------- Cushioned snap ---------- */

  // Once a scroll (including trackpad or touch momentum) has fully come to rest
  // near a section edge, glide onto it on a critically damped spring: it leaves
  // from standstill, eases in and lands softly, with no overshoot.
  const SNAP_RANGE = 0.35;   // fraction of the viewport within which we snap
  const REST_MS = 180;       // quiet time that means the scroll has stopped
  const OMEGA = 6.5;         // spring speed; about a second to settle
  let restTimer = 0, gliding = false, glideFrame = 0;

  function stopGlide() {
    if (!gliding) return;
    gliding = false;
    cancelAnimationFrame(glideFrame);
  }
  // Real input cancels a glide. The faint tail of trackpad momentum does not.
  addEventListener("wheel", (e) => { if (Math.abs(e.deltaY) >= 6) stopGlide(); }, { passive: true });
  ["touchstart", "pointerdown", "keydown"].forEach((type) => addEventListener(type, stopGlide, { passive: true }));

  function snapPoint() {
    const y = scrollY, max = document.documentElement.scrollHeight - innerHeight;
    const points = [];
    for (const s of sections) {
      points.push(s.offsetTop);
      // A section taller than the screen can also settle on its bottom edge.
      if (s.offsetHeight > innerHeight + 1) points.push(s.offsetTop + s.offsetHeight - innerHeight);
    }
    let best = null;
    for (const p of points) {
      const q = Math.min(Math.max(0, p), max);
      if (best === null || Math.abs(q - y) < Math.abs(best - y)) best = q;
    }
    return best !== null && Math.abs(best - y) <= innerHeight * SNAP_RANGE ? best : null;
  }

  function glideTo(target) {
    const from = scrollY, dist = target - from, t0 = performance.now();
    let expected = from;
    gliding = true;
    const step = (now) => {
      if (!gliding) return;
      // Something else moved the page (a link, the rail, a script): let it win.
      if (Math.abs(scrollY - expected) > 2) { gliding = false; return; }
      const t = (now - t0) / 1000;
      // Critically damped spring from rest: x(t) = 1 - (1 + wt) e^(-wt).
      const k = 1 - (1 + OMEGA * t) * Math.exp(-OMEGA * t);
      if (Math.abs(dist) * (1 - k) < 0.4) {
        sfx.thump();
        scrollTo({ top: target, behavior: "instant" });
        gliding = false;
        return;
      }
      scrollTo({ top: from + dist * k, behavior: "instant" });
      expected = scrollY;
      glideFrame = requestAnimationFrame(step);
    };
    glideFrame = requestAnimationFrame(step);
  }

  addEventListener("scroll", () => {
    if (gliding) return;
    clearTimeout(restTimer);
    restTimer = setTimeout(() => {
      if (reduceQuery.matches) return;
      const target = snapPoint();
      if (target !== null && Math.abs(target - scrollY) > 1) glideTo(target);
    }, REST_MS);
  }, { passive: true });

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

  const hex = (h) => new Float32Array([1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255));
  for (const l of Object.values(LOOK)) l.rgb = l.c.map(hex);

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
    uniform float uF, uScatter, uTime, uMotion, uScale, uPx, uSize, uDist, uFlyA, uFlyB, uPush, uHiA, uHiB;
    uniform vec4 uPet;    // body: stretch, lean, hop, jitter
    uniform vec3 uPet2;   // eye (the i's dot): lift, openness; arm (h's stem): wave angle
    const int TRAIL = 16;
    uniform vec3 uTrail[TRAIL];
    uniform float uTrailN;   // how many uTrail entries are active; 0 skips the push entirely
    uniform vec2 uCenter, uRes, uMouse, uMouseVel;
    uniform vec3 uA1, uA2, uB1, uB2;
    varying vec3 vColor;
    varying float vAlpha;
    float hash(float n) { return fract(sin(n) * 43758.5453); }
    // The "hi" as a character, in its own object space (baseline y = -1.25).
    vec3 pet(vec3 p, float w) {
      const float base = -1.25;
      // Arm: the h's tall stem bends from its middle to wave.
      if (p.x < -0.58) {
        float a = uPet2.z * smoothstep(-0.2, 1.25, p.y);
        vec2 pv = vec2(-0.78, -0.2), d = p.xy - pv;
        p.xy = pv + vec2(d.x * cos(a) - d.y * sin(a), d.x * sin(a) + d.y * cos(a));
      }
      vec2 eye = vec2(0.77, 0.83);
      if (length(p.xy - eye) < 0.32) {
        // Eye: floats and blinks (squashes vertically).
        p.y = eye.y + (p.y - eye.y) * uPet2.y + uPet2.x;
      } else if (p.x > 0.55) {
        // The i's stem overshoots the body's stretch a little: follow-through.
        p.y = base + (p.y - base) * (1.0 + (uPet.x - 1.0) * 1.6);
      }
      // Squash and stretch from the baseline, keeping its volume.
      float wide = inversesqrt(max(uPet.x, 0.2));
      p = vec3(p.x * wide, base + (p.y - base) * uPet.x, p.z * wide);
      p.x += uPet.y * (p.y - base) * 0.3;   // lean
      p.y += uPet.z;                          // hop
      p.xy += uPet.w * vec2(sin(uTime * 47.0 + w * 91.0), cos(uTime * 53.0 + w * 67.0));   // nervous shake
      return p;
    }
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
      vec3 pa = uRotA * (uHiA > 0.5 && mascot ? pet(aA, w) : aA);
      vec3 pb = uRotB * (uHiB > 0.5 && mascot ? pet(aB, w) : aB);
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
      // Natural push: soft falloff, uneven strength and a bent direction per particle.
      // The cursor's recent path (uTrail: x, y, weight) keeps pushing with a fading
      // weight, so particles are thrown aside instantly but drift back slowly.
      float r = 70.0 * uPx;
      float strength = 0.35 + 1.3 * fract(w * 7.31);
      float bend = (fract(w * 13.7) - 0.5) * 1.4;
      float cb = cos(bend), sb = sin(bend);
      // Each point on the cursor's path pushes on its own; the strongest one wins.
      // (Summing them would let a slow or resting cursor pile faded pushes back up.)
      vec2 push = vec2(0.0);
      float best = 0.0;
      // A fixed-length loop the compiler can unroll; the whole block is skipped
      // when the cursor has been still long enough that nothing is pushing.
      if (uTrailN > 0.5) for (int i = 0; i < TRAIL; i++) {
        vec3 t = uTrail[i];
        if (t.z <= 0.001) continue;
        vec2 d = sp - t.xy;
        float dist = length(d);
        float amt = exp(-(dist * dist) / (r * r)) * t.z;
        if (amt > best) {
          best = amt;
          vec2 dir = d / (dist + 0.001);
          push = vec2(dir.x * cb - dir.y * sb, dir.x * sb + dir.y * cb) * amt;
        }
      }
      vec2 dm = sp - uMouse;
      float wake = uPush > 0.001 ? exp(-dot(dm, dm) / (r * r)) * uPush : 0.0;
      sp += (push * 60.0 * uPx + uMouseVel * 0.45 * wake) * strength * uMotion;
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
  ["uRotA", "uRotB", "uCam", "uDist", "uFlyA", "uFlyB", "uF", "uScatter", "uTime", "uMotion", "uScale", "uPx", "uSize", "uCenter", "uRes", "uMouse", "uMouseVel", "uPush", "uTrail", "uTrailN", "uHiA", "uHiB", "uPet", "uPet2", "uA1", "uA2", "uB1", "uB2"]
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

  // Column-major rotation: Rx(pitch) · Ry(yaw) · Rz(roll), written into `out`
  // (preallocated, so the frame loop makes no garbage).
  function rotation(yaw, pitch, roll, out = new Float32Array(9)) {
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cx = Math.cos(pitch), sx = Math.sin(pitch), cz = Math.cos(roll), sz = Math.sin(roll);
    out[0] = cy * cz;                out[3] = -cy * sz;               out[6] = sy;
    out[1] = cx * sz + sx * sy * cz; out[4] = cx * cz - sx * sy * sz; out[7] = -sx * cy;
    out[2] = sx * sz - cx * sy * cz; out[5] = sx * cz + cx * sy * sz; out[8] = cx * cy;
    return out;
  }
  const rotA = new Float32Array(9), rotB = new Float32Array(9), camM = new Float32Array(9);

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
    return { x: frame + cw * at, y: H * 0.5 + 8, s: Math.min(cw * (W <= 1100 ? 0.15 : 0.16), H * 0.29) };
  }

  // Push is instant; the return is slower (RETURN_RATE per second, over TRAIL_LIFE).
  const TRAIL_N = 16, TRAIL_LIFE = 1.2, RETURN_RATE = 1.3;
  const trail = Array.from({ length: TRAIL_N - 1 }, () => ({ x: 0, y: 0, e: 0, age: 1e9 }));
  const trailData = new Float32Array(TRAIL_N * 3);
  let trailHead = 0, trailCount = 0;
  let trailClock = 0;
  const mouse = { x: -1e4, y: -1e4, nx: 0, ny: 0, sx: 0, sy: 0, px: -1e4, py: -1e4, vx: 0, vy: 0, push: 0 };
  addEventListener("pointermove", (e) => {
    if (e.pointerType === "touch") return;
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    mouse.nx = e.clientX / W - 0.5;
    mouse.ny = e.clientY / H - 0.5;
  }, { passive: true });
  document.addEventListener("pointerleave", () => { mouse.x = mouse.y = -1e4; });

  const ease = (x) => x * x * (3 - 2 * x);

  /* ---------- The "hi" character ---------- */

  // A tiny state machine plus springs: it breathes, blinks, looks at the cursor,
  // waves, hops, startles and dozes off. petStep only runs while it is on screen.
  const pet = {
    sy: 1, sv: 0, lean: 0, lv: 0, hop: 0, hv: 0, dotY: 0, dv: 0, eye: 1, wave: 0, jitter: 0,
    act: null, t: 0, nextBlink: 3.2, blinkT: -1, waveT: -1, introWaved: false, nextHop: 6, pendingHop: 0, hopAt: -1,
    idle: 0, sleepy: 0, startleAt: -9, wasNear: false, awayFor: 0, lastCur: 0, greeted: false,
  };
  // A hop is set by how high it should rise (in letter units), capped so it stays grounded.
  const petHop = (height) => {
    const h = Math.min(height, 0.16);
    pet.sv -= 2.2 * h; pet.pendingHop = Math.sqrt(2 * 9.8 * h); pet.hopAt = pet.t + 0.12;
  };

  // The repertoire. Clicks and idle moments pick one at random, never repeating
  // either of the last two, so it never does the same thing twice in a row.
  const ACTS = {
    hop:     () => { petHop(0.13); sfx.chirp(520, 760); },
    wave:    () => petWave(),
    wiggle:  () => { pet.act = { name: "wiggle", t: 0, len: 0.8 }; sfx.chirp(600, 520); },
    nod:     () => { pet.dv -= 1.6; pet.sv -= 0.25; sfx.chirp(480, 400); },
    stretch: () => { pet.act = { name: "stretch", t: 0, len: 1.2 }; sfx.chirp(380, 560); },
    wink:    () => { pet.blinkT = 0; pet.nextBlink = pet.t + 0.26; sfx.chirp(900, 1100); },
    dance:   () => { pet.act = { name: "dance", t: 0, len: 1.6, hops: 0 }; sfx.chirp(520, 780); },
    peek:    () => { pet.act = { name: "peek", t: 0, len: 1.6 }; },
  };
  const recent = [];
  function petReact() {
    const pool = Object.keys(ACTS).filter((n) => !recent.includes(n));
    const name = pool[Math.floor(Math.random() * pool.length)];
    recent.push(name);
    if (recent.length > 2) recent.shift();
    ACTS[name]();
  }
  const petWave = () => { if (pet.waveT < 0 || pet.waveT > 1.6) { pet.waveT = 0; sfx.chirp(440, 660); } };
  ["pointermove", "keydown", "wheel", "touchstart"].forEach((type) =>
    addEventListener(type, () => {
      if (pet.sleepy > 0.6) { pet.sv += 1.4; petWave(); }   // wakes with a stretch and a wave
      pet.idle = 0;
    }, { passive: true })
  );
  addEventListener("click", (e) => {
    if (e.target.closest("a, button") || fx.cur === null || fx.cur > 0.4) return;
    petReact();
  });

  function petStep(dt, cur, at) {
    const p = pet;
    p.t += dt;
    p.idle += dt;
    p.sleepy += ((p.idle > 12 ? 1 : 0) - p.sleepy) * (1 - Math.exp(-dt * (p.idle > 12 ? 0.5 : 4)));

    // Wave hello once it has gathered, goodbye as it leaves, hello again on return.
    if (!p.introWaved && p.t > 2.3) { p.introWaved = true; petWave(); }
    if (cur >= 0.12 && p.lastCur < 0.12) petWave();
    if (cur < 0.05 && p.lastCur >= 0.05 && p.greeted) petWave();
    if (cur < 0.05) p.greeted = true;
    p.lastCur = cur;

    // Blink: the i's dot is its eye. Sometimes a double blink; half-shut when sleepy.
    if (p.t > p.nextBlink) {
      p.blinkT = 0;
      p.nextBlink = p.t + (Math.random() < 0.2 ? 0.28 : 2.4 + Math.random() * 3.6 + p.sleepy * 3);
    }
    let lid = 1;
    if (p.blinkT >= 0) {
      lid = p.blinkT < 0.08 ? 1 - (p.blinkT / 0.08) * 0.85 : p.blinkT < 0.2 ? 0.15 + ((p.blinkT - 0.08) / 0.12) * 0.85 : 1;
      p.blinkT = p.blinkT >= 0.2 ? -1 : p.blinkT + dt;
    }
    p.eye = lid * (1 - 0.55 * p.sleepy);

    // Where is the cursor, relative to the character?
    const onScreen = mouse.x > -1e3;
    const dx = onScreen ? (mouse.x - at.x) / Math.max(at.s, 1) : 0;
    const dy = onScreen ? (mouse.y - at.y) / Math.max(at.s, 1) : 0;
    const near = onScreen && Math.hypot(dx, dy) < 1.8;
    const speed = Math.hypot(mouse.vx, mouse.vy);
    if (near && !p.wasNear && p.awayFor > 3) petWave();
    p.awayFor = near ? 0 : p.awayFor + dt;
    p.wasNear = near;

    // Startled by a fast swipe close by: jump, eye pops, shake, lean away.
    if (near && speed > 1400 && p.t - p.startleAt > 2) {
      p.startleAt = p.t;
      p.jitter = 0.035; p.dv += 2.2; p.lv -= Math.sign(dx || 1) * 1.6;
      petHop(0.12);
      sfx.chirp(880, 1320);
    }
    p.jitter *= Math.exp(-dt * 4);

    // Random happy hops while awake.
    // Something different every 5-12 s while awake.
    if (p.t > p.nextHop) { if (p.sleepy < 0.3) petReact(); p.nextHop = p.t + 5 + Math.random() * 7; }
    if (p.hopAt >= 0 && p.t >= p.hopAt) { p.hv = p.pendingHop; p.hopAt = -1; }
    p.hv -= 9.8 * dt;
    p.hop += p.hv * dt;
    if (p.hop < 0) { if (p.hv < -0.6) p.sv -= Math.abs(p.hv) * 0.22; p.hop = 0; p.hv = 0; }   // landing squash

    // The current act adds its own motion on top of the springs.
    let actLean = 0, actStretch = 0, actEye = 0;
    if (p.act) {
      const a = p.act, env = Math.sin(Math.PI * Math.min(1, a.t / a.len));
      if (a.name === "wiggle") actLean = 0.16 * Math.sin(a.t * 22) * env;
      if (a.name === "stretch") { actStretch = 0.1 * env; actEye = 0.06 * env; }
      if (a.name === "peek") actLean = 0.22 * Math.sin((a.t / a.len) * Math.PI * 2) * env;
      if (a.name === "dance") {
        actLean = 0.14 * Math.sin(a.t * 7.5) * env;
        if (a.hops < 2 && a.t > 0.35 + a.hops * 0.6) { petHop(0.06); a.hops++; }
      }
      a.t += dt;
      if (a.t >= a.len) p.act = null;
    }
    // Springs: body stretch (breathing), lean (looking), eye lift (follow-through).
    const breathe = 1 + (0.022 + 0.022 * p.sleepy) * Math.sin(p.t * (2.2 - 1.1 * p.sleepy));
    const spring = (x, v, target, k, d) => { v += (-(x - target) * k - v * d) * dt; return [x + v * dt, v]; };
    [p.sy, p.sv] = spring(p.sy, p.sv, breathe + actStretch, 120, 9);
    const curious = near && speed < 300 ? 1.5 : 1;
    const look = Math.max(-0.3, Math.min(0.3, dx * 0.12 * curious)) + 0.12 * p.sleepy + actLean;
    [p.lean, p.lv] = spring(p.lean, p.lv, look, 40, 7);
    const eyeLift = (onScreen ? Math.max(-0.05, Math.min(0.07, -dy * 0.05)) : 0) + (near && speed < 300 ? 0.04 : 0) - 0.14 * p.sleepy - p.hv * 0.02 + actEye;
    [p.dotY, p.dv] = spring(p.dotY, p.dv, eyeLift, 60, 5);

    // Wave: the arm swings out and back for about 1.6 s.
    if (p.waveT >= 0 && p.waveT <= 1.6) {
      const env = Math.sin(Math.PI * p.waveT / 1.6);
      p.wave = (0.22 + 0.42 * Math.sin(p.waveT * 10)) * env;
      p.waveT += dt;
    } else p.wave *= Math.exp(-dt * 6);
  }

  // Camera choreography: each scroll transition flies its own path, then settles
  // back to a readable front view once the next mascot has formed.
  // Every path returns to the front by itself, so a flight can be scaled down
  // (fast scrolling) without leaving the camera off-axis. Each flight also has its
  // own zoom: dolly (camera distance) and lens (screen scale) move separately.
  const FLIGHTS = [
    // swoop over the top, pulling back wide to reveal the space, then gliding in
    { yaw: 0.7, pitch: 1.25, dolly: (s) => 2.4 * s, lens: (s) => 1 - 0.18 * s },
    // swing round to the back, pushing in close enough to fly through the particles
    { yaw: 2.6, pitch: 0.25, dolly: (s) => -1.7 * s, lens: () => 1 },
    // dive underneath with a dolly zoom: the camera backs off while the lens zooms in,
    // so the subject holds its size and the perspective stretches
    { yaw: -0.8, pitch: -1.15, dolly: (s) => 3.2 * s, lens: (s) => 1 + 0.62 * s },
    // circle from above: punch in, then pull out wide as the plane arrives
    { yaw: -2.4, pitch: 0.6, dolly: (s, f, amp) => -1.4 * Math.sin(TAU * f) * amp, lens: () => 1 },
  ];
  function camera(k, f, amp) {
    const fl = FLIGHTS[k % FLIGHTS.length], s = Math.sin(Math.PI * f) * amp;
    const dist = Math.max(2.1, 4 + fl.dolly(s, f, amp));
    return { m: rotation(fl.yaw * s, fl.pitch * s, 0, camM), dist, zoom: fl.lens(s) };
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
    // Cursor speed in px per second, so the push feels the same at 60 Hz and 120 Hz.
    const jump = Math.abs(mouse.x - mouse.px) > 400 || Math.abs(mouse.y - mouse.py) > 400;
    const ivx = jump ? 0 : (mouse.x - mouse.px) / Math.max(dt, 1e-3);
    const ivy = jump ? 0 : (mouse.y - mouse.py) / Math.max(dt, 1e-3);
    const k2 = 1 - Math.exp(-dt * 14);
    mouse.vx += (Math.max(-3000, Math.min(3000, ivx)) - mouse.vx) * k2;
    mouse.vy += (Math.max(-3000, Math.min(3000, ivy)) - mouse.vy) * k2;
    mouse.px = mouse.x;
    mouse.py = mouse.y;
    // The push is driven by movement, not position. It rises at once as the cursor
    // enters or moves (full strength from a gentle 180 px/s), then fades slowly at rest.
    const cursorSpeed = Math.hypot(ivx, ivy);
    const stir = jump && mouse.x > -1e3 ? 1 : Math.min(1, cursorSpeed / 180);
    mouse.push = Math.max(stir, mouse.push * Math.exp(-dt * RETURN_RATE));
    // Record the cursor's path; each point's push fades out over TRAIL_LIFE seconds.
    trailClock += dt;
    if (trailClock >= TRAIL_LIFE / TRAIL_N && mouse.x > -1e3) {
      trailClock = 0;
      trailHead = (trailHead + 1) % trail.length;
      const t = trail[trailHead];
      t.x = mouse.x; t.y = mouse.y; t.e = mouse.push; t.age = 0;
    }
    // Pack the points that still push at the front; the rest are zeroed.
    trailCount = 0;
    if (mouse.x > -1e3 && mouse.push > 0.001) {
      trailData[0] = mouse.x * dpr; trailData[1] = mouse.y * dpr; trailData[2] = mouse.push;
      trailCount = 1;
    }
    for (const t of trail) {
      t.age += dt;
      const w = t.e * Math.exp(-t.age * RETURN_RATE) * Math.max(0, Math.min(1, (TRAIL_LIFE - t.age) / 0.35));
      if (w <= 0.001) continue;
      const o = trailCount * 3;
      trailData[o] = t.x * dpr; trailData[o + 1] = t.y * dpr; trailData[o + 2] = w;
      trailCount++;
    }
    trailData.fill(0, trailCount * 3);
    mouse.sy += (mouse.ny - mouse.sy) * (1 - Math.exp(-dt * 3));

    const a = shapeNames[k], b = shapeNames[k + 1];
    const la = LOOK[a], lb = LOOK[b];
    // Scroll turns each mascot relative to its own resting pose, so poses never drift.
    const look = (l, offset, out) => rotation(
      l.yaw + l.spin * time + l.wobble * Math.sin(time * 0.5) + mouse.sx * 0.6 + offset * 0.4,
      l.pitch + mouse.sy * 0.3,
      l.roll + (l.bank || 0) * Math.sin(time * 0.9),
      out
    );

    const pa = placement(k), pb = placement(k + 1), e = ease(f);

    gl.uniformMatrix3fv(loc.uRotA, false, look(la, cur - k, rotA));
    gl.uniformMatrix3fv(loc.uRotB, false, look(lb, cur - k - 1, rotB));
    const cam = camera(k, f, reduce ? 0 : amp);
    gl.uniformMatrix3fv(loc.uCam, false, cam.m);
    gl.uniform1f(loc.uDist, cam.dist);
    gl.uniform1f(loc.uFlyA, a === "plane" ? 1 : 0);
    gl.uniform1f(loc.uFlyB, b === "plane" ? 1 : 0);
    gl.uniform1f(loc.uF, f);
    gl.uniform1f(loc.uScatter, (reduce ? 0 : speed) + intro);
    gl.uniform1f(loc.uTime, time);
    gl.uniform1f(loc.uMotion, reduce ? 0 : 1);
    // A nearer camera makes the scene bigger (dolly); the lens zoom applies on top.
    gl.uniform1f(loc.uScale, lerp(pa.s * (la.size || 1), pb.s * (lb.size || 1), e) * dpr * cam.zoom * (4 / cam.dist));
    gl.uniform1f(loc.uPx, dpr);
    gl.uniform1f(loc.uSize, STACKED.matches ? 1.15 : 1.3);
    // A chase camera never sits perfectly still on its subject.
    const chase = reduce ? 0 : (a === "plane" ? 1 - e : 0) + (b === "plane" ? e : 0);
    fx.cur = cur;
    fx.k = k;
    fx.f = f;
    fx.s = Math.sin(Math.PI * f) * (reduce ? 0 : amp);
    fx.yaw = FLIGHTS[k % FLIGHTS.length].yaw * fx.s;
    fx.dist = cam.dist;
    fx.fly = chase;
    fx.push = mouse.push;
    fx.cursorSpeed = Math.hypot(mouse.vx, mouse.vy);
    fx.mx = mouse.x > -1e3 ? mouse.x / W : 0.5;
    const driftX = chase * (Math.sin(time * 0.6) * 10 + Math.sin(time * 1.7) * 3);
    const driftY = chase * (Math.sin(time * 0.9) * 8 + Math.cos(time * 2.1) * 2);
    gl.uniform2f(loc.uCenter, (lerp(pa.x, pb.x, e) + driftX) * dpr, (lerp(pa.y, pb.y, e) + driftY) * dpr);
    gl.uniform2f(loc.uRes, canvas.width, canvas.height);
    gl.uniform2f(loc.uMouse, mouse.x * dpr, mouse.y * dpr);
    gl.uniform2f(loc.uMouseVel, (mouse.vx / 60) * dpr, (mouse.vy / 60) * dpr);
    gl.uniform1f(loc.uPush, mouse.push);
    gl.uniform3fv(loc.uTrail, trailData);
    gl.uniform1f(loc.uTrailN, trailCount);
    // The "hi" is only alive while it is on screen; off screen it costs nothing.
    const hiShown = (a === "hi" ? 1 - f : 0) + (b === "hi" ? f : 0);
    const alive = !reduce && hiShown > 0.01;
    if (alive) petStep(dt, cur, placement(shapeNames.indexOf("hi")));
    gl.uniform1f(loc.uHiA, alive && a === "hi" ? 1 : 0);
    gl.uniform1f(loc.uHiB, alive && b === "hi" ? 1 : 0);
    gl.uniform4f(loc.uPet, pet.sy, pet.lean, pet.hop, pet.jitter);
    gl.uniform3f(loc.uPet2, pet.dotY, pet.eye, pet.wave);
    gl.uniform3fv(loc.uA1, la.rgb[0]);
    gl.uniform3fv(loc.uA2, la.rgb[1]);
    gl.uniform3fv(loc.uB1, lb.rgb[0]);
    gl.uniform3fv(loc.uB2, lb.rgb[1]);

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
