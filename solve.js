// Fast drop-in for makefun-diff 1.0.0: the same patch, less CPU.
// Lines are interned to small integer ids once per case, Myers's greedy
// search runs over integer arrays with its V history in one flat typed
// array, and the patch is built in one array joined once at the end.
// No regular expressions, no per-step allocation in the search.
const KEEP = 0;
const DEL = 1;
const INS = 2;
const CONTEXT = 3;

export function run(input) {
  if (input === null || typeof input !== 'object' || typeof input.old !== 'string' || typeof input.new !== 'string') {
    throw new TypeError('makefun-diff: the input is { old, new }, two strings');
  }
  const oldText = input.old;
  const newText = input.new;
  // ---- tokenise and intern ----
  const oldParts = oldText.split('\n');
  const newParts = newText.split('\n');
  const oldNL = oldText.length > 0 && oldText.charCodeAt(oldText.length - 1) === 10;
  const newNL = newText.length > 0 && newText.charCodeAt(newText.length - 1) === 10;
  const n = oldText.length === 0 ? 0 : (oldNL ? oldParts.length - 1 : oldParts.length);
  const m = newText.length === 0 ? 0 : (newNL ? newParts.length - 1 : newParts.length);
  const oldBare = n > 0 && !oldNL;
  const newBare = m > 0 && !newNL;
  const nInt = oldBare ? n - 1 : n;
  const mInt = newBare ? m - 1 : m;
  const ids = new Map();
  let nextId = 0;
  const A = new Int32Array(n);
  const B = new Int32Array(m);
  for (let i = 0; i < nInt; i++) {
    const s = oldParts[i];
    let id = ids.get(s);
    if (id === undefined) { id = nextId++; ids.set(s, id); }
    A[i] = id;
  }
  for (let j = 0; j < mInt; j++) {
    const s = newParts[j];
    let id = ids.get(s);
    if (id === undefined) { id = nextId++; ids.set(s, id); }
    B[j] = id;
  }
  if (oldBare || newBare) {
    const bare = new Map();
    if (oldBare) {
      const s = oldParts[n - 1];
      let id = bare.get(s);
      if (id === undefined) { id = nextId++; bare.set(s, id); }
      A[n - 1] = id;
    }
    if (newBare) {
      const s = newParts[m - 1];
      let id = bare.get(s);
      if (id === undefined) { id = nextId++; bare.set(s, id); }
      B[m - 1] = id;
    }
  }
  // ---- common prefix and suffix ----
  let prefix = 0;
  while (prefix < n && prefix < m && A[prefix] === B[prefix]) prefix++;
  let suffix = 0;
  while (suffix < n - prefix && suffix < m - prefix && A[n - 1 - suffix] === B[m - 1 - suffix]) suffix++;
  const a0 = prefix;
  const b0 = prefix;
  const nn = n - suffix - prefix;
  const mm = m - suffix - prefix;
  // ---- Myers search over the middle ----
  const runs = myersRuns(A, B, a0, b0, nn, mm);
  // ---- change runs ----
  const kinds = [];
  const counts = [];
  if (prefix > 0) { kinds.push(KEEP); counts.push(prefix); }
  for (let i = 0; i < runs.length; i++) { kinds.push(runs[i][0]); counts.push(runs[i][1]); }
  if (suffix > 0) { kinds.push(KEEP); counts.push(suffix); }
  const changes = [];
  let o = 0;
  let p = 0;
  let deleted = 0;
  let inserted = 0;
  for (let i = 0; i < kinds.length; i++) {
    const kind = kinds[i];
    const count = counts[i];
    if (kind === KEEP) { o += count; p += count; continue; }
    let c = changes.length > 0 ? changes[changes.length - 1] : undefined;
    if (c === undefined || c.o + c.dels !== o || c.p + c.ins !== p) {
      c = { o, p, dels: 0, ins: 0 };
      changes.push(c);
    }
    if (kind === DEL) { c.dels += count; o += count; deleted += count; }
    else { c.ins += count; p += count; inserted += count; }
  }
  // ---- hunks ----
  const hunks = [];
  for (const c of changes) {
    const h = hunks.length > 0 ? hunks[hunks.length - 1] : undefined;
    const prev = h !== undefined ? h[h.length - 1] : undefined;
    if (prev !== undefined && c.o - (prev.o + prev.dels) <= 2 * CONTEXT) h.push(c);
    else hunks.push([c]);
  }
  // ---- patch text, one join ----
  const out = [`makefun-diff/1 old=${n} new=${m} hunks=${hunks.length} deleted=${deleted} inserted=${inserted}\n`];
  for (const h of hunks) {
    const first = h[0];
    const last = h[h.length - 1];
    const oldStart = first.o - CONTEXT > 0 ? first.o - CONTEXT : 0;
    const newStart = first.p - (first.o - oldStart);
    const after = n - (last.o + last.dels) < CONTEXT ? n - (last.o + last.dels) : CONTEXT;
    const oldEnd = last.o + last.dels + after;
    const newEnd = last.p + last.ins + after;
    out.push(`@ ${oldStart + 1} ${oldEnd - oldStart} ${newStart + 1} ${newEnd - newStart}\n`);
    let at = oldStart;
    for (const c of h) {
      for (; at < c.o; at++) out.push(written('=', oldParts, at, oldBare, n));
      for (let i = 0; i < c.dels; i++) out.push(written('-', oldParts, c.o + i, oldBare, n));
      for (let i = 0; i < c.ins; i++) out.push(written('+', newParts, c.p + i, newBare, m));
      at = c.o + c.dels;
    }
    for (; at < oldEnd; at++) out.push(written('=', oldParts, at, oldBare, n));
  }
  return out.join('');
}

function written(op, parts, i, bare, total) {
  const s = parts[i];
  return (bare && i === total - 1) ? `${op}${s}\n%\n` : `${op}${s}\n`;
}

function myersRuns(A, B, a0, b0, nn, mm) {
  // One flat history: row d starts at d*d, diagonal k = -d + 2*ki sits at offset ki.
  // Uint16 when the texts are short enough (x < 65535); -1 wraps to 65535, which
  // still fails the x < nn test, so the sentinel logic is unchanged.
  let capD = 4096;
  let hist = (nn < 65535 && mm < 65535) ? new Uint16Array((capD + 1) * (capD + 1)) : new Int32Array((capD + 1) * (capD + 1));
  const growHist = () => {
    const nc = capD * 2;
    const nh = (hist instanceof Uint16Array) ? new Uint16Array((nc + 1) * (nc + 1)) : new Int32Array((nc + 1) * (nc + 1));
    nh.set(hist);
    hist = nh;
    capD = nc;
  };
  let x0 = 0;
  let y0 = 0;
  while (x0 < nn && y0 < mm && A[a0 + x0] === B[b0 + y0]) { x0++; y0++; }
  hist[0] = x0;
  let dFound = -1;
  let kFound = 0;
  if (x0 === nn && x0 === mm) { dFound = 0; }
  else {
    outer: for (let d = 1; d <= nn + mm; d++) {
      if (d > capD) growHist();
      const base = d * d;
      const prevBase = (d - 1) * (d - 1);
      let k = -d;
      for (let ki = 0; ki <= d; ki++, k += 2) {
        const prevIdx = prevBase + ki;
        let xRem = -1;
        let xAdd = -1;
        if (ki >= 1) xRem = hist[prevIdx - 1];
        if (ki <= d - 1) xAdd = hist[prevIdx];
        const canRemove = xRem >= 0 && xRem < nn;
        const yAdd = xAdd - (k + 1);
        const canAdd = xAdd >= 0 && yAdd < mm;
        if (!canRemove && !canAdd) { hist[base + ki] = -1; continue; }
        const byDel = canRemove ? xRem : -2;
        const byIns = canAdd ? xAdd - 1 : -2;
        let x;
        let y;
        if (byDel >= byIns) { x = xRem + 1; y = x - k; }
        else { x = xAdd; y = x - k; }
        while (x < nn && y < mm && A[a0 + x] === B[b0 + y]) { x++; y++; }
        hist[base + ki] = x;
        if (x === nn && x - k === mm) { dFound = d; kFound = k; break outer; }
      }
    }
  }
  if (dFound < 0) throw new Error('makefun-diff: the search ended without reaching both ends');
  // ---- backtrack: recompute each step's choice from the history ----
  const revKinds = [];
  const revCounts = [];
  let k = kFound;
  let curX = nn;
  for (let d = dFound; d >= 1; d--) {
    const ki = (k + d) / 2;
    const prevBase = (d - 1) * (d - 1);
    let xRem = -1;
    let xAdd = -1;
    if (ki >= 1) xRem = hist[prevBase + ki - 1];
    if (ki <= d - 1) xAdd = hist[prevBase + ki];
    const canRemove = xRem >= 0 && xRem < nn;
    const yAdd = xAdd - (k + 1);
    const canAdd = xAdd >= 0 && yAdd < mm;
    const byDel = canRemove ? xRem : -2;
    const byIns = canAdd ? xAdd - 1 : -2;
    let xMid;
    let kind;
    if (byDel >= byIns) { kind = DEL; xMid = xRem + 1; k = k - 1; }
    else { kind = INS; xMid = xAdd; k = k + 1; }
    const sn = curX - xMid;
    if (sn > 0) { revKinds.push(KEEP); revCounts.push(sn); }
    revKinds.push(kind); revCounts.push(1);
    curX = kind === DEL ? xRem : xAdd;
  }
  if (curX > 0) { revKinds.push(KEEP); revCounts.push(curX); }
  const runs = [];
  for (let i = revKinds.length - 1; i >= 0; i--) {
    const kind = revKinds[i];
    const count = revCounts[i];
    const last = runs.length > 0 ? runs[runs.length - 1] : undefined;
    if (last !== undefined && last[0] === kind) last[1] += count;
    else runs.push([kind, count]);
  }
  return runs;
}
