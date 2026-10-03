// Kolam Maker -- South Indian dot-grid designs drawn with one unbroken line.
//
// A sikku kolam is a "mirror curve": put a dot in the middle of every cell
// of a grid, and imagine a ray of light leaving the middle of a cell side at
// 45 degrees. Every time it reaches the middle of the next side it either
// goes straight on (crossing the line already there) or it bounces off a
// two-sided mirror placed on that point, and the border of the grid is all
// mirrors. The ray always comes back to where it started, after looping
// around dots. The art is to place the mirrors so that a single line visits
// every part of the grid: one line, around every dot.
//
// Coordinates are doubled so everything is an integer: the dots are at
// (odd, odd), the cell corners at (even, even), and the points where the
// line can cross or turn ("crossings") at (odd, even) or (even, odd).

const S = 720; // drawing size
const CROSS = 0, H = 1, V = 2; // state of a crossing: line crosses, or mirror horizontal / vertical

const SHAPES = {
  square: { name: "Square" },
  diamond: { name: "Diamond" },
  rect: { name: "Rectangle" },
};
const SYMS = {
  rot4: { name: "Four-fold" },
  d4: { name: "Mirror" },
  rot2: { name: "Two-fold" },
  none: { name: "None" },
};
const LOOKS = {
  rice: { name: "Rice flour", bg: "#5b2f22", line: "#f7f1e3", dot: "#f7f1e3" },
  granite: { name: "Doorstep", bg: "#34332f", line: "#fbfaf5", dot: "#e9e4d6" },
  turmeric: { name: "Festival", bg: "#173a2e", line: "#ffcd4a", dot: "#ff7a6b" },
  slate: { name: "Chalk", bg: "#28303a", line: "#eaf2f8", dot: "#9fb4c7" },
  ink: { name: "Ink", bg: "#f3ecdc", line: "#2a211b", dot: "#b3261e" },
};
// when the design has more than one line, each gets its own color
const LOOP_COLORS = ["#ffd166", "#7ad3ff", "#ff8fab", "#a0e57a", "#c3a6ff", "#ffb36b", "#6ff0d2", "#ff6b6b"];

const opts = {
  shape: "square",
  n: 7, // square side, diamond "radius" (rows 1, 3, 5, ... 2n-1), rectangle columns
  rows: 5, // rectangle rows
  sym: "rot4",
  turns: 45, // how many crossings become mirrors when generating, in %
  look: "rice",
  width: 12, // line width, % of the dot spacing
  round: 55, // roundness of the loops
  dots: true,
  texture: true,
  speed: 5,
};
let grid = null; // { cw, ch, W, H, cells }
let st = null; // Uint8Array of crossing states, by index Y*(W+1)+X
let loops = []; // traced lines
let seed = 1;
let anim = null; // running "draw it" animation

const $e = (id) => document.getElementById(id);

// ---------------------------------------------------------------- random

function rng(s) {
  s = s % 2147483647 || 1;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}
function shuffle(a, rand) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------------------------------------------------------------- the grid of dots

function makeGrid() {
  let cw, ch;
  const sh = opts.shape;
  if (sh === "square") cw = ch = opts.n;
  else if (sh === "diamond") cw = ch = 2 * opts.n - 1;
  else (cw = opts.n), (ch = opts.rows);
  const cells = new Uint8Array(cw * ch);
  for (let j = 0; j < ch; j++)
    for (let i = 0; i < cw; i++) {
      const c = opts.n - 1;
      cells[j * cw + i] = sh === "diamond" ? (Math.abs(i - c) + Math.abs(j - c) <= c ? 1 : 0) : 1;
    }
  return { cw, ch, W: 2 * cw, H: 2 * ch, cells };
}
const hasCell = (g, i, j) => i >= 0 && j >= 0 && i < g.cw && j < g.ch && g.cells[j * g.cw + i] === 1;
const idx = (g, X, Y) => Y * (g.W + 1) + X;

// the two cells on either side of a crossing
function sides(g, X, Y) {
  return X % 2 === 0
    ? [hasCell(g, X / 2 - 1, (Y - 1) / 2), hasCell(g, X / 2, (Y - 1) / 2)] // on a vertical cell side
    : [hasCell(g, (X - 1) / 2, Y / 2 - 1), hasCell(g, (X - 1) / 2, Y / 2)]; // on a horizontal one
}
// crossings between two dots, where the user (or the generator) decides
function innerCrossings(g) {
  const out = [];
  for (let Y = 0; Y <= g.H; Y++)
    for (let X = (Y + 1) % 2; X <= g.W; X += 2) {
      const [a, b] = sides(g, X, Y);
      if (a && b) out.push([X, Y]);
    }
  return out;
}
// state of a crossing: on the edge of the grid the line always bounces back
function stateAt(g, s, X, Y) {
  const [a, b] = sides(g, X, Y);
  if (a && b) return s[idx(g, X, Y)];
  return X % 2 === 0 ? V : H;
}

// ---------------------------------------------------------------- tracing the line

// Follows the line from crossing to crossing until it comes back, for every
// piece of line not yet visited. Each loop is a list of [X, Y, state].
function trace(g, s) {
  const KW = 2 * g.H + 1;
  const seen = new Uint8Array((2 * g.W + 1) * KW);
  const out = [];
  for (let j = 0; j < g.ch; j++)
    for (let i = 0; i < g.cw; i++) {
      if (!hasCell(g, i, j)) continue;
      const cx = 2 * i + 1, cy = 2 * j + 1;
      // the four sides of the diamond around this dot: N->E, E->S, S->W, W->N
      const starts = [[cx, cy - 1, 1, 1], [cx + 1, cy, -1, 1], [cx, cy + 1, -1, -1], [cx - 1, cy, 1, -1]];
      for (const [x0, y0, dx0, dy0] of starts) {
        if (seen[(2 * x0 + dx0) * KW + (2 * y0 + dy0)]) continue;
        const pts = [];
        let x = x0, y = y0, dx = dx0, dy = dy0;
        do {
          const nx = x + dx, ny = y + dy;
          seen[(x + nx) * KW + (y + ny)] = out.length + 1;
          const t = stateAt(g, s, nx, ny);
          if (t === H) dy = -dy;
          else if (t === V) dx = -dx;
          pts.push([nx, ny, t]);
          x = nx;
          y = ny;
        } while (!(x === x0 && y === y0 && dx === dx0 && dy === dy0));
        out.push(pts);
      }
    }
  return out;
}
const countLoops = (g, s) => trace(g, s).length;

// ---------------------------------------------------------------- symmetry

// the transformations of the chosen symmetry, as (X, Y) -> [X', Y', swapsHV]
function symmetries(g, sym) {
  const { W, H: Hh } = g;
  const sq = W === Hh;
  const id = (X, Y) => [X, Y, false];
  const r180 = (X, Y) => [W - X, Hh - Y, false];
  const r90 = (X, Y) => [W - Y, X, true];
  const r270 = (X, Y) => [Y, Hh - X, true];
  const fx = (X, Y) => [W - X, Y, false];
  const fy = (X, Y) => [X, Hh - Y, false];
  const d1 = (X, Y) => [Y, X, true];
  const d2 = (X, Y) => [Hh - Y, W - X, true];
  if (sym === "none") return [id];
  if (sym === "rot2") return [id, r180];
  if (sym === "rot4") return sq ? [id, r90, r180, r270] : [id, r180];
  return sq ? [id, r90, r180, r270, fx, fy, d1, d2] : [id, fx, fy, r180];
}
// groups the inner crossings into orbits, which change together; an orbit
// is a list of [index, swapsHV]. A crossing mapped onto itself with H and V
// swapped can only stay a crossing, so its orbit is left out.
function orbits(g, sym) {
  const T = symmetries(g, sym);
  const done = new Set();
  const out = [];
  for (const [X, Y] of innerCrossings(g)) {
    const k = idx(g, X, Y);
    if (done.has(k)) continue;
    const orb = new Map();
    let ok = true;
    for (const t of T) {
      const [x2, y2, sw] = t(X, Y);
      const k2 = idx(g, x2, y2);
      if (orb.has(k2) && orb.get(k2) !== sw) ok = false;
      orb.set(k2, sw);
      done.add(k2);
    }
    if (ok) out.push([...orb.entries()]);
  }
  return out;
}
const flipHV = (o) => (o === H ? V : o === V ? H : o);
function setOrbit(s, orb, o) {
  for (const [k, sw] of orb) s[k] = sw ? flipHV(o) : o;
}

// ---------------------------------------------------------------- one single line

// Adding a mirror where two different lines cross always joins them into
// one. Where a line crosses itself, one of the two mirrors keeps it in one
// piece and the other splits it in two. So mirrors are tried in random
// order and kept when they don't make more lines, then more are added
// until only one line is left.
function joinLines(g, s, orbs, rand, cur) {
  for (let pass = 0; pass < 4 && cur > 1; pass++) {
    for (const orb of shuffle(orbs.slice(), rand)) {
      const k0 = orb[0][0];
      const was = s[k0] === CROSS ? CROSS : orb[0][1] ? flipHV(s[k0]) : s[k0];
      const tries = shuffle([H, V, CROSS].filter((o) => o !== was), rand);
      for (const o of tries) {
        setOrbit(s, orb, o);
        const n = countLoops(g, s);
        if (n < cur) {
          cur = n;
          break;
        }
        setOrbit(s, orb, was);
      }
      if (cur === 1) break;
    }
  }
  return cur;
}
function generate(g, sym, density, rand) {
  const s = new Uint8Array((g.W + 1) * (g.H + 1));
  const orbs = orbits(g, sym);
  let cur = countLoops(g, s);
  for (const orb of shuffle(orbs.slice(), rand)) {
    if (rand() * 100 >= density) continue;
    const first = rand() < 0.5 ? H : V;
    for (const o of [first, flipHV(first)]) {
      setOrbit(s, orb, o);
      const n = countLoops(g, s);
      if (n <= cur) {
        cur = n;
        break;
      }
      setOrbit(s, orb, CROSS);
    }
  }
  cur = joinLines(g, s, orbs, rand, cur);
  return { s, lines: cur };
}
function newKolam() {
  stopAnim();
  grid = makeGrid();
  seed = Math.floor(Math.random() * 1e9) + 1;
  const rand = rng(seed);
  let best = null;
  // a symmetric single line isn't always reachable: try a few times, then
  // relax the symmetry
  const fall = { d4: ["d4", "rot4", "rot2", "none"], rot4: ["rot4", "rot2", "none"], rot2: ["rot2", "none"], none: ["none"] }[opts.sym];
  for (const sym of fall) {
    for (let t = 0; t < 12; t++) {
      const r = generate(grid, sym, opts.turns, rand);
      if (!best || r.lines < best.lines) best = r;
      if (r.lines === 1) break;
    }
    if (best.lines === 1) break;
  }
  st = best.s;
  update();
}
function makeOneLine() {
  stopAnim();
  const rand = rng(Math.floor(Math.random() * 1e9) + 1);
  const n = countLoops(grid, st);
  const left = joinLines(grid, st, orbits(grid, opts.sym), rand, n);
  if (left > 1) joinLines(grid, st, orbits(grid, "none"), rand, left);
  update();
}

// ---------------------------------------------------------------- drawing

function geom(g) {
  const u = S / (Math.max(g.W, g.H) + 2.4); // pixels per half dot spacing
  return { u, ox: (S - g.W * u) / 2, oy: (S - g.H * u) / 2 };
}
const f1 = (v) => Math.round(v * 10) / 10;

// a loop as an SVG path: straight through the crossings, and a curve
// around the dot where the line bounces off a mirror
function loopPath(pts, G, k) {
  const n = pts.length;
  const P = (p) => [G.ox + p[0] * G.u, G.oy + p[1] * G.u];
  const mid = (i) => {
    const a = P(pts[(i - 1 + n) % n]), b = P(pts[i % n]);
    return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  };
  let m = mid(0);
  let d = `M${f1(m[0])} ${f1(m[1])}`;
  for (let i = 0; i < n; i++) {
    const q = P(pts[i]), b = mid(i + 1);
    if (pts[i][2] === CROSS) d += `L${f1(b[0])} ${f1(b[1])}`;
    else
      d += `C${f1(m[0] + k * (q[0] - m[0]))} ${f1(m[1] + k * (q[1] - m[1]))} ${f1(b[0] + k * (q[0] - b[0]))} ${f1(b[1] + k * (q[1] - b[1]))} ${f1(b[0])} ${f1(b[1])}`;
    m = b;
  }
  return d + "Z";
}

function svgMarkup(forExport) {
  const g = grid, G = geom(g), L = LOOKS[opts.look];
  const cell = 2 * G.u;
  const lw = (opts.width / 100) * cell;
  const k = 0.15 + (opts.round / 100) * 0.75; // 0.55 makes a circle around a single dot
  const multi = loops.length > 1;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}"${forExport ? "" : ' class="plain"'}>`;
  if (opts.texture)
    s += `<defs><filter id="powder" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency="1.1" numOctaves="2" seed="3" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="${f1(lw * 0.35)}" xChannelSelector="R" yChannelSelector="G" result="d"/><feComponentTransfer in="n" result="g"><feFuncA type="linear" slope="2.2" intercept="0.05"/></feComponentTransfer><feComposite in="d" in2="g" operator="in"/></filter></defs>`;
  s += `<rect width="${S}" height="${S}" fill="${L.bg}"/>`;
  const filt = opts.texture ? ' filter="url(#powder)"' : "";
  if (opts.dots) {
    s += `<g fill="${L.dot}"${filt}>`;
    for (let j = 0; j < g.ch; j++)
      for (let i = 0; i < g.cw; i++)
        if (hasCell(g, i, j)) s += `<circle cx="${f1(G.ox + (2 * i + 1) * G.u)}" cy="${f1(G.oy + (2 * j + 1) * G.u)}" r="${f1(Math.max(1.5, cell * 0.075))}"/>`;
    s += "</g>";
  }
  s += `<g id="lines" fill="none" stroke-width="${f1(lw)}" stroke-linecap="round" stroke-linejoin="round"${filt}>`;
  loops.forEach((pts, i) => {
    s += `<path d="${loopPath(pts, G, k)}" stroke="${multi ? LOOP_COLORS[i % LOOP_COLORS.length] : L.line}"/>`;
  });
  s += "</g>";
  if (!forExport) {
    // click targets on the crossings between dots
    s += `<g id="hits">`;
    for (const [X, Y] of innerCrossings(g))
      s += `<circle class="hit" data-x="${X}" data-y="${Y}" cx="${f1(G.ox + X * G.u)}" cy="${f1(G.oy + Y * G.u)}" r="${f1(G.u * 0.55)}"/>`;
    s += `</g><circle id="hand" r="${f1(Math.max(4, lw * 0.9))}" fill="none" stroke="${L.line}" stroke-width="2" opacity="0"/>`;
  }
  return s + "</svg>";
}

function render() {
  loops = trace(grid, st);
  $e("kolam").innerHTML = svgMarkup(false);
  renderStats();
}

function renderStats() {
  const g = grid;
  let dots = 0, cross = 0, turns = 0;
  for (let k = 0; k < g.cells.length; k++) dots += g.cells[k];
  for (const [X, Y] of innerCrossings(g)) st[idx(g, X, Y)] === CROSS ? cross++ : turns++;
  const segs = loops.reduce((a, p) => a + p.length, 0);
  const one = loops.length === 1;
  const tile = (k, v) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`;
  $e("stats").innerHTML =
    tile("Dots", dots) +
    tile("Lines", one ? "1 &#10003;" : loops.length) +
    tile("Crossings", cross) +
    tile("Turns", turns) +
    tile("Length", `${Math.round(segs * Math.SQRT1_2)} dots`);
  const note = $e("line-note");
  note.textContent = one
    ? "One unbroken line loops around every dot. Click between two dots to change how the line passes there."
    : `${loops.length} separate lines, in colors. Click between dots to join them, or let the page do it.`;
  $e("join").hidden = one;
}

// ---------------------------------------------------------------- draw it (animation)

function stopAnim() {
  if (anim) cancelAnimationFrame(anim.raf);
  anim = null;
  const b = $e("draw");
  if (b) b.textContent = "Draw it";
}
function drawIt() {
  if (anim) {
    stopAnim();
    render();
    return;
  }
  const paths = [...$e("kolam").querySelectorAll("#lines path")];
  const hand = $e("hand");
  const lens = paths.map((p) => p.getTotalLength());
  paths.forEach((p, i) => {
    p.style.strokeDasharray = `${lens[i]} ${lens[i] + 10}`;
    p.style.strokeDashoffset = lens[i];
  });
  $e("draw").textContent = "Stop";
  const pxPerSec = 40 + opts.speed * 45;
  let i = 0, done = 0, last = performance.now();
  anim = {};
  const step = (now) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    done += dt * pxPerSec;
    while (i < paths.length && done >= lens[i]) {
      paths[i].style.strokeDashoffset = 0;
      done -= lens[i];
      i++;
    }
    if (i >= paths.length) {
      hand.setAttribute("opacity", 0);
      paths.forEach((p) => (p.style.strokeDasharray = p.style.strokeDashoffset = ""));
      stopAnim();
      return;
    }
    paths[i].style.strokeDashoffset = lens[i] - done;
    const pt = paths[i].getPointAtLength(done);
    hand.setAttribute("cx", pt.x);
    hand.setAttribute("cy", pt.y);
    hand.setAttribute("opacity", 0.9);
    anim.raf = requestAnimationFrame(step);
  };
  anim.raf = requestAnimationFrame(step);
}

// ---------------------------------------------------------------- editing by hand

function clickCrossing(e) {
  const t = e.target.closest(".hit");
  if (!t) return;
  stopAnim();
  const X = +t.dataset.x, Y = +t.dataset.y;
  const k = idx(grid, X, Y);
  const next = (st[k] + 1) % 3; // crossing -> horizontal mirror -> vertical mirror
  if ($e("sym-edit").checked) {
    const orb = orbits(grid, opts.sym).find((o) => o.some(([kk]) => kk === k));
    if (orb) {
      // keep the clicked crossing as the reference of its orbit
      const sw = orb.find(([kk]) => kk === k)[1];
      setOrbit(st, orb, sw ? flipHV(next) : next);
    } else st[k] = next;
  } else st[k] = next;
  update();
}

// ---------------------------------------------------------------- the design in the address

const ABC = "abcdefghijklmnopqrstuvwxyz_"; // 3 crossings per letter
function encode() {
  const cs = innerCrossings(grid).map(([X, Y]) => st[idx(grid, X, Y)]);
  let out = "";
  for (let i = 0; i < cs.length; i += 3) out += ABC[(cs[i] || 0) * 9 + (cs[i + 1] || 0) * 3 + (cs[i + 2] || 0)];
  return out;
}
function decode(str) {
  const cs = innerCrossings(grid);
  const s = new Uint8Array((grid.W + 1) * (grid.H + 1));
  if (str.length !== Math.ceil(cs.length / 3)) return null;
  for (let i = 0; i < cs.length; i++) {
    const v = ABC.indexOf(str[Math.floor(i / 3)]);
    if (v < 0) return null;
    s[idx(grid, ...cs[i])] = Math.floor(v / [9, 3, 1][i % 3]) % 3;
  }
  return s;
}
function writeUrl() {
  const q = new URLSearchParams();
  q.set("shape", opts.shape);
  q.set("n", opts.n);
  if (opts.shape === "rect") q.set("rows", opts.rows);
  q.set("k", encode());
  history.replaceState(null, "", "#" + q.toString());
}
function readUrl() {
  const q = new URLSearchParams(location.hash.slice(1));
  if (!q.get("k")) return false;
  const int = (k, lo, hi, def) => {
    const v = parseInt(q.get(k), 10);
    return isNaN(v) ? def : Math.max(lo, Math.min(hi, v));
  };
  if (SHAPES[q.get("shape")]) opts.shape = q.get("shape");
  opts.n = int("n", 1, 15, opts.n);
  opts.rows = int("rows", 1, 15, opts.rows);
  grid = makeGrid();
  const s = decode(q.get("k"));
  if (!s) return false;
  st = s;
  return true;
}

// ---------------------------------------------------------------- controls

const LS = "kolam-maker";
function saveLook() {
  try {
    const { look, width, round, dots, texture, speed, sym, turns } = opts;
    localStorage.setItem(LS, JSON.stringify({ look, width, round, dots, texture, speed, sym, turns }));
  } catch (e) {}
}
function loadLook() {
  try {
    Object.assign(opts, JSON.parse(localStorage.getItem(LS)) || {});
  } catch (e) {}
  if (!LOOKS[opts.look]) opts.look = "rice";
  if (!SYMS[opts.sym]) opts.sym = "rot4";
}
function update() {
  render();
  writeUrl();
  saveLook();
}

function chips(id, items, key, onPick) {
  const el = $e(id);
  el.innerHTML = Object.entries(items)
    .map(([k, v]) => `<button type="button" data-k="${k}" aria-pressed="${opts[key] === k}">${v.name}</button>`)
    .join("");
  el.onclick = (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    opts[key] = b.dataset.k;
    el.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", x === b));
    onPick();
  };
}
function sizeControls() {
  const sh = opts.shape;
  const max = sh === "diamond" ? 7 : sh === "square" ? 13 : 15;
  const min = sh === "diamond" ? 2 : 2;
  opts.n = Math.max(min, Math.min(max, opts.n));
  const n = $e("size");
  n.min = min;
  n.max = max;
  n.value = opts.n;
  $e("size-label").textContent = sh === "rect" ? "Columns" : sh === "diamond" ? "Rows to the middle" : "Dots per side";
  const showN = () =>
    sh === "diamond"
      ? Array.from({ length: 2 * opts.n - 1 }, (_, i) => 2 * (opts.n - Math.abs(opts.n - 1 - i)) - 1).join("-")
      : sh === "rect"
        ? opts.n
        : `${opts.n} × ${opts.n}`;
  $e("size-val").textContent = showN();
  $e("rows-ctl").hidden = sh !== "rect";
  $e("rows").value = opts.rows;
  $e("rows-val").textContent = opts.rows;
}
function rangeCtl(id, key, fmt, onChange) {
  const el = $e(id);
  el.value = opts[key];
  const show = () => ($e(id + "-val").textContent = fmt(opts[key]));
  show();
  el.addEventListener("input", () => {
    opts[key] = +el.value;
    show();
    onChange();
  });
}

function download(name, href) {
  const a = document.createElement("a");
  a.download = name;
  a.href = href;
  a.click();
}
function saveSvg() {
  download("kolam.svg", URL.createObjectURL(new Blob([svgMarkup(true)], { type: "image/svg+xml" })));
}
function savePng() {
  const img = new Image();
  img.onload = () => {
    const c = document.createElement("canvas");
    c.width = c.height = 2000;
    c.getContext("2d").drawImage(img, 0, 0, 2000, 2000);
    download("kolam.png", c.toDataURL("image/png"));
  };
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgMarkup(true));
}

function initKolam() {
  loadLook();
  const fromUrl = readUrl();
  chips("shape-chips", SHAPES, "shape", () => {
    opts.n = { square: 7, diamond: 4, rect: 8 }[opts.shape];
    sizeControls();
    newKolam();
  });
  chips("sym-chips", SYMS, "sym", newKolam);
  chips("look-chips", LOOKS, "look", update);
  sizeControls();
  $e("size").addEventListener("input", () => {
    opts.n = +$e("size").value;
    sizeControls();
    newKolam();
  });
  $e("rows").addEventListener("input", () => {
    opts.rows = +$e("rows").value;
    sizeControls();
    newKolam();
  });
  rangeCtl("turns", "turns", (v) => `${v}%`, newKolam);
  rangeCtl("width", "width", (v) => `${v}%`, update);
  rangeCtl("round", "round", (v) => `${v}%`, update);
  rangeCtl("speed", "speed", (v) => v, () => {});
  $e("o-dots").checked = opts.dots;
  $e("o-texture").checked = opts.texture;
  $e("o-dots").addEventListener("change", (e) => ((opts.dots = e.target.checked), update()));
  $e("o-texture").addEventListener("change", (e) => ((opts.texture = e.target.checked), update()));
  $e("new").addEventListener("click", newKolam);
  $e("join").addEventListener("click", makeOneLine);
  $e("draw").addEventListener("click", drawIt);
  $e("clear").addEventListener("click", () => {
    stopAnim();
    st = new Uint8Array((grid.W + 1) * (grid.H + 1));
    update();
  });
  $e("export-png").addEventListener("click", savePng);
  $e("export-svg").addEventListener("click", saveSvg);
  $e("kolam").addEventListener("click", clickCrossing);
  if (fromUrl) update();
  else newKolam();
}
