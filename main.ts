// Push-optimal Sokoban solver for make.fun's sokoban-solver-01.
// A level is a hallway with 1-4 rooms off it, each room its own boxes and goals behind one door; a box pushed
// into the hallway never comes back, so every box stays in its room and the level's push optimum is the sum of
// its rooms'. Each room is one breadth-first search over pushes: a state is the boxes' squares plus the player's
// reachable region, so the first solved state met is push-optimal; dead squares and a frozen 2 x 2 block with a
// box off its goal are pruned, and the player's walks between pushes are shortest paths.
// Pure: no clock, no randomness, ties by square order; a search's budget is states, never time.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const D = [[0, -1, 'u', 'U'], [0, 1, 'd', 'D'], [-1, 0, 'l', 'L'], [1, 0, 'r', 'R']];
const CAP = 200000;

// The level: width, walls, goals, boxes and the player's square.
function parse(t) {
  const r = t.split('\n').filter((x) => x.length), h = r.length, w = Math.max(...r.map((x) => x.length));
  const W = new Uint8Array(w * h).fill(1), G = [], B = [];
  let p = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < r[y].length; x++) {
    const c = r[y][x], i = y * w + x;
    if (c === '#') continue;
    W[i] = 0;
    if ('.*+'.includes(c)) G.push(i);
    if ('$*'.includes(c)) B.push(i);
    if ('@+'.includes(c)) p = i;
  }
  for (let i = 0; i < w * h; i++) if (i < w || i >= w * h - w || i % w < 1 || i % w === w - 1) W[i] = 1;
  return { w, W, G, B: B.sort((a, b) => a - b), p };
}

// The squares a box alone can reach a goal from: pulls played backwards from the goals over open floor.
function live(L) {
  const w = L.w, W = L.W, v = new Uint8Array(W.length), q = [...L.G];
  for (const g of L.G) v[g] = 1;
  for (let i = 0; i < q.length; i++) for (const [dx, dy] of D) {
    const d = dy * w + dx, s = q[i] - d;
    if (!W[s] && !W[s - d] && !v[s]) { v[s] = 1; q.push(s); }
  }
  return v;
}

// The rooms: the player row's dead squares (the hallway) cut out, each part left holding a box.
function rooms(L) {
  const w = L.w, W = L.W, v = live(L), row = Math.floor(L.p / w);
  const c = new Uint8Array(W.length), id = new Int32Array(W.length).fill(-1), rs = [];
  for (let i = row * w; i < row * w + w; i++) if (!W[i] && !v[i]) c[i] = 1;
  for (const b of L.B) if (c[b]) return 0;
  for (let s = 0; s < W.length; s++) {
    if (W[s] || c[s] || id[s] >= 0) continue;
    const r = { q: [s], B: [], G: [] };
    id[s] = rs.length;
    for (let i = 0; i < r.q.length; i++) for (const [dx, dy] of D) {
      const t = r.q[i] + dy * w + dx;
      if (!W[t] && !c[t] && id[t] < 0) { id[t] = rs.length; r.q.push(t); }
    }
    rs.push(r);
  }
  for (const b of L.B) rs[id[b]].B.push(b);
  for (const g of L.G) { if (id[g] < 0) return 0; rs[id[g]].G.push(g); }
  if (rs.some((r) => r.B.length !== r.G.length)) return 0;
  return rs.filter((r) => r.B.length);
}

// A box just pushed onto t in a frozen 2 x 2 block of walls and boxes, a box among them off its goal.
function frozen(w, W, o, g, t) {
  for (const a of [t, t - 1, t - w, t - w - 1]) {
    const b = a + 1, c = a + w, d = c + 1;
    if (!(W[a] || o[a]) || !(W[b] || o[b]) || !(W[c] || o[c]) || !(W[d] || o[d])) continue;
    if ((o[a] && !g[a]) || (o[b] && !g[b]) || (o[c] && !g[c]) || (o[d] && !g[d])) return 1;
  }
  return 0;
}

// The shortest walk from one square to another around walls and boxes, in LURD (null when there is none).
function walk(w, W, o, f, t) {
  if (f === t) return '';
  const p = new Int32Array(W.length).fill(-1), hw = new Array(W.length), q = [f];
  p[f] = f;
  for (let i = 0; i < q.length; i++) {
    const a = q[i];
    if (a === t) break;
    for (const [dx, dy, ch] of D) {
      const b = a + dy * w + dx;
      if (W[b] || o[b] || p[b] >= 0) continue;
      p[b] = a; hw[b] = ch; q.push(b);
    }
  }
  if (p[t] < 0) return null;
  let s = '';
  for (let a = t; a !== f; a = p[a]) s = hw[a] + s;
  return s;
}

// The push-optimal answer for a level: {pushes, moves}, or null when unsolvable or over the state budget.
function solve(L) {
  const w = L.w, W = L.W, v = live(L);
  for (const b of L.B) if (!v[b]) return null;
  const gv = new Uint8Array(W.length), o = new Uint8Array(W.length);
  for (const g of L.G) gv[g] = 1;
  for (const b of L.B) o[b] = 1;
  const mk = new Int32Array(W.length), bk = new Int32Array(W.length), st = new Int32Array(W.length);
  let stamp = 0;
  // The player's region from `f` around the boxes standing, marked in array `m` with `s`; its lowest square.
  const flood = (f, s, m) => {
    let n = 0, low = f;
    m[f] = s;
    st[n++] = f;
    while (n) {
      const a = st[--n];
      if (a < low) low = a;
      for (let k = 0; k < 4; k++) {
        const b = k < 2 ? a + (k ? w : -w) : a + (k > 2 ? 1 : -1);
        if (!W[b] && !o[b] && m[b] !== s) { m[b] = s; st[n++] = b; }
      }
    }
    return low;
  };
  const b0 = L.B.slice();
  const key = new Map([[flood(L.p, 1, mk) + ':' + b0, 0]]);
  const bs = [b0], pl = [L.p], par = [-1], mv = [null];
  let goal = -1;
  for (let h = 0; h < bs.length && goal < 0; h++) {
    const boxes = bs[h];
    for (const b of boxes) o[b] = 1;
    const here = ++stamp;
    flood(pl[h], here, mk);
    for (let k = 0; k < boxes.length && goal < 0; k++) {
      const b = boxes[k];
      for (const [dx, dy, , up] of D) {
        const d = dy * w + dx, t = b + d;
        if (mk[b - d] !== here || W[t] || o[t] || !v[t]) continue;
        o[b] = 0; o[t] = 1;
        const bad = frozen(w, W, o, gv, t), nb = bad ? null : boxes.slice();
        let kk = null;
        if (!bad) {
          nb[k] = t;
          nb.sort((x, y) => x - y);
          kk = flood(b, ++stamp, bk) + ':' + nb;
        }
        o[t] = 0; o[b] = 1;
        if (bad || key.has(kk)) continue;
        if (bs.length >= CAP) { for (const x of boxes) o[x] = 0; return null; }
        key.set(kk, bs.length);
        bs.push(nb); pl.push(b); par.push(h); mv.push([b, t, up]);
        if (nb.every((x) => gv[x])) { goal = bs.length - 1; break; }
      }
    }
    for (const b of boxes) o[b] = 0;
  }
  if (goal < 0) return null;
  const path = [];
  for (let s = goal; s > 0; s = par[s]) path.push(s);
  path.reverse();
  let p = L.p, boxes = b0, moves = '';
  for (const s of path) {
    const [f, t, up] = mv[s];
    for (const b of boxes) o[b] = 1;
    const m = walk(w, W, o, p, 2 * f - t);
    for (const b of boxes) o[b] = 0;
    if (m === null) return null;
    moves += m + up;
    p = f;
    boxes = bs[s];
  }
  return { pushes: path.length, moves };
}

// The square the player stands on after `moves`, on a board `w` wide.
function end(w, p, moves) {
  for (const c of moves.toLowerCase()) p += c === 'u' ? -w : c === 'd' ? w : c === 'l' ? -1 : 1;
  return p;
}

// The level's moves: room by room, the other rooms standing as walls (their boxes now, their goals once done).
function level(text) {
  const L = parse(text), rs = rooms(L);
  if (!rs) { const s = solve(L); return s ? s.moves : ''; }
  let p = L.p, moves = '', done = new Set();
  for (const r of rs) {
    const W = L.W.slice();
    for (const o of rs) if (o !== r) for (const b of done.has(o) ? o.G : o.B) W[b] = 1;
    const s = solve({ w: L.w, W, G: r.G.slice().sort((a, b) => a - b), B: r.B.slice().sort((a, b) => a - b), p });
    if (!s) return '';
    moves += s.moves;
    p = end(L.w, p, s.moves);
    done.add(r);
  }
  return moves;
}

let ids = [];
try { ids = readdirSync(I).sort(); } catch { ids = []; }
for (const id of ids) {
  let text = null;
  try { text = readFileSync(I + '/' + id + '/level.txt', 'utf8'); } catch { continue; }
  let moves = '';
  try { moves = level(text); } catch { moves = ''; }
  mkdirSync(O + '/' + id, { recursive: true });
  writeFileSync(O + '/' + id + '/solution.txt', moves + '\n');
}
