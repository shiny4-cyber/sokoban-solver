// sokoban-solver: push-optimal Sokoban solver for make.fun's sokoban-solver-01.
//
// The levels come from a generator with a fixed shape: a one-square-wide hallway where the player starts,
// and rooms off it, each with its own boxes and goals and its own door. A box pushed into the hallway can
// never come back, so every box stays in its room and the level's push optimum is the sum of its rooms'.
// The solver cuts the hallway's dead squares out of the floor, takes each part that holds boxes as a room,
// and answers room by room with A* over pushes (a state is the boxes plus the player's reachable region),
// then walks the player between pushes. Where a level is not that shape it searches the whole level instead.
//
// Pruning is exact: dead squares (a box alone can never push it to a goal) and a frozen 2 x 2 block of
// walls and boxes with a box off its goal. The estimate is a minimum-cost assignment of boxes to goals on
// pushes-ignoring-boxes distances, so the first solved state is push-optimal.
//
// Pure and deterministic: no randomness, no clock, stable tie-breaks. A run's budget is states, never time.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** States one room's search may expand before it gives up. */
const ROOM_STATES = 400_000;
/** States a whole-level search may expand before it gives up. */
const LEVEL_STATES = 200_000;

const DIRS = [
  [0, -1, 'u', 'U'],
  [0, 1, 'd', 'D'],
  [-1, 0, 'l', 'L'],
  [1, 0, 'r', 'R'],
];

function parseLevel(text) {
  const rows = text.split('\n').filter((r) => r.length > 0);
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const wall = new Uint8Array(w * h).fill(1);
  const goals = [];
  const boxes = [];
  let player = -1;
  for (let y = 0; y < h; y++) {
    const row = rows[y];
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      const i = y * w + x;
      if (ch === '#') continue;
      wall[i] = 0;
      if (ch === '.' || ch === '*' || ch === '+') goals.push(i);
      if (ch === '$' || ch === '*') boxes.push(i);
      if (ch === '@' || ch === '+') player = i;
    }
  }
  // Nothing leaves the board: the outermost frame is wall whatever it shows.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) wall[y * w + x] = 1;
    }
  }
  boxes.sort((a, b) => a - b);
  return { w, h, wall, goals, boxes, player };
}

/** Squares a box alone can be pushed to some goal from, pulled back from the goals over open floor. */
function liveSquares(level) {
  const { w, wall, goals } = level;
  const live = new Uint8Array(wall.length);
  const queue = [];
  for (const g of goals) {
    if (!live[g]) {
      live[g] = 1;
      queue.push(g);
    }
  }
  for (let qi = 0; qi < queue.length; qi++) {
    const x = queue[qi];
    for (const [dx, dy] of DIRS) {
      const d = dy * w + dx;
      const y = x - d;
      if (wall[y] === 0 && wall[y - d] === 0 && live[y] === 0) {
        live[y] = 1;
        queue.push(y);
      }
    }
  }
  return live;
}

/**
 * The level's rooms: cut the dead squares of the player's row (the hallway, where a box reaches no goal)
 * out of the floor, and each part left that holds a box is a room. Null when a part's boxes and goals do
 * not pair up, or a box starts in the hallway: then the level is no set of rooms.
 */
function roomsOf(level) {
  const { w, wall, goals, boxes, player } = level;
  const live = liveSquares(level);
  const row = Math.floor(player / w);
  const cut = new Uint8Array(wall.length);
  for (let i = row * w; i < (row + 1) * w; i++) if (wall[i] === 0 && live[i] === 0) cut[i] = 1;
  for (const b of boxes) if (cut[b]) return null;
  const part = new Int32Array(wall.length).fill(-1);
  const rooms = [];
  for (let s = 0; s < wall.length; s++) {
    if (wall[s] || cut[s] || part[s] >= 0) continue;
    const squares = [s];
    part[s] = rooms.length;
    for (let i = 0; i < squares.length; i++) {
      for (const [dx, dy] of DIRS) {
        const q = squares[i] + dy * w + dx;
        if (!wall[q] && !cut[q] && part[q] < 0) {
          part[q] = rooms.length;
          squares.push(q);
        }
      }
    }
    rooms.push({ squares, boxes: [], goals: [] });
  }
  for (const b of boxes) rooms[part[b]].boxes.push(b);
  for (const g of goals) if (part[g] >= 0) rooms[part[g]].goals.push(g);
  if (goals.some((g) => part[g] < 0)) return null;
  if (rooms.some((r) => r.boxes.length !== r.goals.length)) return null;
  return rooms.filter((r) => r.boxes.length > 0);
}

/** A binary heap on (f, then larger g, then earlier insertion): a stable order, so runs agree. */
function heapPush(heap, node) {
  heap.push(node);
  let i = heap.length - 1;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (less(heap[i], heap[p]) < 0) {
      const t = heap[i];
      heap[i] = heap[p];
      heap[p] = t;
      i = p;
    } else break;
  }
}

function less(a, b) {
  if (a.f !== b.f) return a.f - b.f;
  if (a.g !== b.g) return b.g - a.g;
  return a.seq - b.seq;
}

function heapPop(heap) {
  const top = heap[0];
  const last = heap.pop();
  if (heap.length > 0) {
    heap[0] = last;
    for (let i = 0; ; ) {
      let c = 2 * i + 1;
      if (c >= heap.length) break;
      if (c + 1 < heap.length && less(heap[c + 1], heap[c]) < 0) c++;
      if (less(heap[c], heap[i]) < 0) {
        const t = heap[i];
        heap[i] = heap[c];
        heap[c] = t;
        i = c;
      } else break;
    }
  }
  return top;
}

/**
 * The push-optimal solution of `level` as {pushes, moves} (moves in LURD, a push in upper case), or null
 * when the search gives up or no solution exists.
 */
function solvePushOptimal(level, maxStates) {
  const { w, wall, goals } = level;
  const size = wall.length;
  const goal = new Uint8Array(size);
  for (const g of goals) goal[g] = 1;
  const live = liveSquares(level);
  for (const b of level.boxes) if (!live[b]) return null;
  if (level.boxes.every((b) => goal[b])) return { pushes: 0, moves: '' };

  const occupied = new Uint8Array(size);
  for (const b of level.boxes) occupied[b] = 1;
  // Two mark arrays: one for the expanded state's region (`seen`), one for a child's (`child`). One array
  // cannot serve both: marking a child would wipe the state's own region between two of its pushes.
  const seen = new Int32Array(size);
  const child = new Int32Array(size);
  const stack = new Int32Array(size);
  let stamp = 0;
  let childStamp = 0;

  const flood = (from, marks, stampValue) => {
    let n = 0;
    stack[n++] = from;
    marks[from] = stampValue;
    let low = from;
    while (n > 0) {
      const p = stack[--n];
      if (p < low) low = p;
      for (let k = 0; k < 4; k++) {
        const q = k === 0 ? p - w : k === 1 ? p + w : k === 2 ? p - 1 : p + 1;
        if (wall[q] === 0 && occupied[q] === 0 && marks[q] !== stampValue) {
          marks[q] = stampValue;
          stack[n++] = q;
        }
      }
    }
    return low;
  };
  const reach = (from) => {
    const mark = ++stamp;
    return { mark, low: flood(from, seen, mark) };
  };
  const reachChild = (from) => flood(from, child, ++childStamp);

  // Pushes-ignoring-boxes distance from a square to a goal (memoized): an admissible per-box estimate.
  const distMemo = new Map();
  const boxDist = (from) => {
    let best = distMemo.get(from);
    if (best !== undefined) return best;
    best = Infinity;
    const dist = new Int32Array(size).fill(-1);
    const q = [from];
    dist[from] = 0;
    for (let qi = 0; qi < q.length; qi++) {
      const a = q[qi];
      const da = dist[a];
      if (goal[a] === 1) {
        best = da;
        break;
      }
      for (const [dx, dy] of DIRS) {
        const d = dy * w + dx;
        const t = a + d;
        // A push lands the box on t with the player standing on a - d.
        if (wall[t] || wall[a - d] || dist[t] !== -1) continue;
        dist[t] = da + 1;
        q.push(t);
      }
    }
    distMemo.set(from, best);
    return best;
  };

  // The estimate: the cheapest assignment of boxes to distinct goals on those distances (rooms hold 3 or
  // 4 boxes, so a short enumeration is exact; a larger set falls back to the sum of individual minima).
  const estimate = (boxes) => {
    const k = boxes.length;
    if (goals.length === k && k <= 6) {
      const c = [];
      for (const b of boxes) {
        const row = [];
        for (const g of goals) row.push(boxDist(b) === Infinity ? Infinity : distBetween(b, g));
        c.push(row);
      }
      let best = Infinity;
      const used = new Array(k).fill(false);
      const walk = (i, sum) => {
        if (sum >= best) return;
        if (i === k) {
          best = sum;
          return;
        }
        for (let j = 0; j < k; j++) {
          if (used[j]) continue;
          const v = c[i][j];
          if (v === Infinity) continue;
          used[j] = true;
          walk(i + 1, sum + v);
          used[j] = false;
        }
      };
      walk(0, 0);
      return best;
    }
    let sum = 0;
    for (const b of boxes) {
      const d = boxDist(b);
      if (d === Infinity) return Infinity;
      sum += d;
    }
    return sum;
  };

  // Per-pair distance, memoized: pushes from one square to another, boxes ignored.
  const pairMemo = new Map();
  const distBetween = (a, g) => {
    const key = a * size + g;
    const hit = pairMemo.get(key);
    if (hit !== undefined) return hit;
    const dist = new Int32Array(size).fill(-1);
    const q = [a];
    dist[a] = 0;
    let out = Infinity;
    for (let qi = 0; qi < q.length; qi++) {
      const s = q[qi];
      if (s === g) {
        out = dist[s];
        break;
      }
      for (const [dx, dy] of DIRS) {
        const d = dy * w + dx;
        const t = s + d;
        if (wall[t] || wall[s - d] || dist[t] !== -1) continue;
        dist[t] = dist[s] + 1;
        q.push(t);
      }
    }
    pairMemo.set(key, out);
    return out;
  };

  // The states: boxes, the player's square after the move that made them, the push that made them.
  const stBoxes = [level.boxes];
  const stPlayer = [level.player];
  const stParent = [-1];
  const stMove = [null];
  const bestG = new Map();

  {
    const r = reach(level.player);
    bestG.set(r.low + ':' + level.boxes.join(','), 0);
  }
  const heap = [];
  let seq = 0;
  const h0 = estimate(level.boxes);
  if (h0 === Infinity) return null;
  heapPush(heap, { f: h0, g: 0, seq: seq++, idx: 0 });

  let found = -1;
  let expanded = 0;
  while (heap.length > 0 && expanded < maxStates) {
    const node = heapPop(heap);
    const idx = node.idx;
    const boxes = stBoxes[idx];
    const g = node.g;
    if (found >= 0) break;
    // A stale entry (a cheaper path to the same state was found): skip.
    for (const b of boxes) occupied[b] = 1;
    const r = reach(stPlayer[idx]);
    const here = r.mark;
    const key = r.low + ':' + boxes.join(',');
    if (bestG.get(key) !== g) {
      for (const b of boxes) occupied[b] = 0;
      continue;
    }
    expanded++;

    for (let bi = 0; bi < boxes.length && found < 0; bi++) {
      const b = boxes[bi];
      for (const [dx, dy, , up] of DIRS) {
        const d = dy * w + dx;
        if (seen[b - d] !== here) continue;
        const t = b + d;
        if (wall[t] || occupied[t] || !live[t]) continue;
        occupied[b] = 0;
        occupied[t] = 1;
        const frozen = frozenBlock(w, wall, occupied, goal, t);
        let key2 = null;
        let nb = null;
        let low = -1;
        if (!frozen) {
          nb = boxes.slice();
          nb[bi] = t;
          nb.sort((x, y) => x - y);
          low = reachChild(b);
          key2 = low + ':' + nb.join(',');
        }
        occupied[t] = 0;
        occupied[b] = 1;
        if (frozen) continue;
        const ng = g + 1;
        const old = bestG.get(key2);
        if (old !== undefined && old <= ng) continue;
        bestG.set(key2, ng);
        const hval = estimate(nb);
        if (hval === Infinity) continue;
        const ni = stBoxes.length;
        stBoxes.push(nb);
        stPlayer.push(b);
        stParent.push(idx);
        stMove.push({ from: b, to: t, letter: up });
        heapPush(heap, { f: ng + hval, g: ng, seq: seq++, idx: ni });
        if (nb.every((x) => goal[x])) {
          found = ni;
          break;
        }
      }
    }
    for (const b of boxes) occupied[b] = 0;
  }
  if (found < 0) return null;

  // The push path, back to front, then the moves: walk to each push's square, then push.
  const path = [];
  for (let s = found; s > 0; s = stParent[s]) path.push(s);
  path.reverse();
  let player = level.player;
  let boxes = level.boxes;
  let moves = '';
  for (const s of path) {
    const mv = stMove[s];
    for (const b of boxes) occupied[b] = 1;
    const walk = walkTo(w, wall, occupied, player, standSquare(mv.from, mv.to));
    for (const b of boxes) occupied[b] = 0;
    if (walk === null) return null;
    moves += walk;
    moves += mv.letter;
    player = mv.from;
    boxes = stBoxes[s];
  }
  return { pushes: path.length, moves };
}

/** The square the player stands on to push a box from `from` to `to`. */
function standSquare(from, to) {
  return 2 * from - to;
}

/** The shortest walk from `from` to `to` around walls and boxes, in lower LURD letters (ties by DIRS order). */
function walkTo(w, wall, occupied, from, to) {
  if (from === to) return '';
  const prev = new Int32Array(wall.length).fill(-1);
  const how = new Array(wall.length);
  const queue = [from];
  prev[from] = from;
  for (let qi = 0; qi < queue.length; qi++) {
    const p = queue[qi];
    if (p === to) break;
    for (const [dx, dy, letter] of DIRS) {
      const q = p + dy * w + dx;
      if (wall[q] || occupied[q] || prev[q] !== -1) continue;
      prev[q] = p;
      how[q] = letter;
      queue.push(q);
    }
  }
  if (prev[to] === -1) return null;
  let s = '';
  for (let p = to; p !== from; p = prev[p]) s = how[p] + s;
  return s;
}

/** Whether the box just pushed to `t` sits in a frozen 2 x 2 block of walls and boxes, a box off its goal. */
function frozenBlock(w, wall, occupied, goal, t) {
  for (const a of [t, t - 1, t - w, t - w - 1]) {
    const b = a + 1;
    const c = a + w;
    const d = c + 1;
    if (!(wall[a] || occupied[a]) || !(wall[b] || occupied[b])) continue;
    if (!(wall[c] || occupied[c]) || !(wall[d] || occupied[d])) continue;
    if ((occupied[a] && !goal[a]) || (occupied[b] && !goal[b])) return true;
    if ((occupied[c] && !goal[c]) || (occupied[d] && !goal[d])) return true;
  }
  return false;
}

function main() {
  let ids = [];
  try {
    ids = readdirSync(INPUT).sort();
  } catch {
    ids = [];
  }
  for (const id of ids) {
    let text;
    try {
      text = readFileSync(join(INPUT, id, 'level.txt'), 'utf8');
    } catch {
      continue;
    }
    let moves = '';
    try {
      moves = solveLevel(text);
    } catch {
      moves = '';
    }
    mkdirSync(join(OUTPUT, id), { recursive: true });
    writeFileSync(join(OUTPUT, id, 'solution.txt'), moves + '\n');
  }
}

function solveLevel(text) {
  const level = parseLevel(text);
  const rooms = roomsOf(level);
  if (rooms !== null) {
    let player = level.player;
    let moves = '';
    let ok = true;
    const done = new Set();
    for (const room of rooms) {
      const wall = level.wall.slice();
      for (const other of rooms) {
        if (other === room) continue;
        for (const b of done.has(other) ? other.goals : other.boxes) wall[b] = 1;
      }
      const sub = {
        w: level.w,
        h: level.h,
        wall,
        goals: room.goals.slice().sort((a, b) => a - b),
        boxes: room.boxes.slice().sort((a, b) => a - b),
        player,
      };
      const sol = solvePushOptimal(sub, ROOM_STATES);
      if (sol === null || sol.moves === null) {
        ok = false;
        break;
      }
      moves += sol.moves;
      player = endOf(level.w, player, sol.moves);
      done.add(room);
    }
    if (ok) return moves;
  }
  const whole = solvePushOptimal(level, LEVEL_STATES);
  return whole === null || whole.moves === null ? '' : whole.moves;
}

/** The square the player stands on after `moves` (LURD, the case aside) from `from` on a board `w` wide. */
function endOf(w, from, moves) {
  let p = from;
  for (const ch of moves.toLowerCase()) p += ch === 'u' ? -w : ch === 'd' ? w : ch === 'l' ? -1 : 1;
  return p;
}

main();

export { solveLevel, parseLevel, roomsOf, solvePushOptimal, liveSquares };
