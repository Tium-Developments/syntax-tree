(function () {
  "use strict";
  var P = window.PROBLEMS || [];
  var $ = function (id) { return document.getElementById(id); };
  var NS = "http://www.w3.org/2000/svg";
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------- constants ----------
  var LEVEL = 64, GAP = 22, PAD = 18, FONT = 21, SUBF = 13;
  var HEADS = ["D", "N", "V", "v", "T", "C", "P", "A", "Adv", "Deg", "Neg", "Q"];
  var FAMILIES = [
    ["TP", "T′", "T"], ["CP", "C′", "C"], ["DP", "D′", "D"], ["NP", "N′", "N"],
    ["VP", "V′", "V"], ["vP", "v′", "v"], ["PP", "P′", "P"], ["AP", "A′", "A"],
    ["NegP", "Neg′", "Neg"], ["AdvP", "Adv′", "Adv"], ["DegP", "Deg′", "Deg"]
  ];
  var COMPS = {
    "T′": ["VP", "NegP", "vP"], "C′": ["TP"], "D′": ["NP"], "N′": ["PP", "CP", "AP"],
    "V′": ["DP", "PP", "VP", "CP", "TP", "AP", "AdvP"], "v′": ["VP"], "P′": ["DP"],
    "A′": ["PP", "CP"], "Neg′": ["VP"]
  };
  var EXTRA_WORDS = ["[past]", "[pres]", "Ø", "t_1", "t_2", "t_3", "to", "'s"];

  // ---------- state ----------
  var uid = 0;
  var S = { mode: "book", idx: 0, own: "", tree: null, sel: null, undo: [], redo: [], wrong: null, manual: false, view: { k: 1, tx: 0, ty: 0 } };

  function node(l, w) { return { id: ++uid, l: l || "", c: [], w: !!w }; }
  function walk(n, f, parent) { f(n, parent); n.c.forEach(function (k) { walk(k, f, n); }); }
  function find(id) { var r = null; walk(S.tree, function (n) { if (n.id === id) r = n; }); return r; }
  function parentOf(id) { var r = null; walk(S.tree, function (n, p) { if (n.id === id) r = p; }); return r; }
  function stripIdx(l) { return l.replace(/_\w+$/, ""); }
  function isHead(l) { return HEADS.indexOf(stripIdx(l)) >= 0; }
  function plainWord(l) { return l.charAt(0) === "[" || l === "Ø"; }
  function hasWord(n) { return n.c.some(function (k) { return k.w; }); }
  function buzz() { try { if (navigator.vibrate) navigator.vibrate(8); } catch (e) {} }

  // ---------- storage ----------
  function key() { return S.mode === "book" ? "stp:b:" + S.idx : "stp:o:" + S.own; }
  function store(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function load(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function rehydrate(o) { var n = node(o.l, o.w); n.c = (o.c || []).map(rehydrate); return n; }
  function dehydrate(n) { return { l: n.l, w: n.w ? 1 : 0, c: n.c.map(dehydrate) }; }
  function save() { store(key(), JSON.stringify(dehydrate(S.tree))); }

  // ---------- history ----------
  function pathOf(id) {
    var path = null;
    (function rec(n, p) { if (n.id === id) path = p; n.c.forEach(function (k, i) { rec(k, p.concat(i)); }); })(S.tree, []);
    return path;
  }
  function byPath(path) { var n = S.tree; (path || []).forEach(function (i) { if (n && n.c[i]) n = n.c[i]; }); return n; }
  function snapshot() { return JSON.stringify({ t: dehydrate(S.tree), path: pathOf(S.sel) }); }
  function commit() { S.undo.push(snapshot()); if (S.undo.length > 200) S.undo.shift(); S.redo = []; }
  function restore(snap) {
    // keep ids of nodes at the same path so they animate instead of popping
    var oldIds = {}; (function rec(n, p) { oldIds[p] = n.id; n.c.forEach(function (k, i) { rec(k, p + "." + i); }); })(S.tree, "r");
    var o = JSON.parse(snap); S.tree = rehydrate(o.t);
    (function rec(n, p) { if (oldIds[p]) n.id = oldIds[p]; n.c.forEach(function (k, i) { rec(k, p + "." + i); }); })(S.tree, "r");
    S.sel = byPath(o.path).id;
  }
  function changed() { S.wrong = null; hideBanner(); save(); render(); }

  // ---------- text measure ----------
  var ctx = document.createElement("canvas").getContext("2d");
  function measure(txt, italic, size) { ctx.font = (italic ? "italic " : "") + "500 " + size + "px 'Crimson Pro', 'Times New Roman', serif"; return ctx.measureText(txt).width; }
  function split(l) { var m = l.match(/^(.*?)_(\w+)$/); return m ? [m[1], m[2]] : [l, ""]; }
  function labelW(n) {
    if (!n.l) return 28;
    var s = split(n.l);
    return measure(s[0], n.w && !plainWord(n.l), FONT) + (s[1] ? measure(s[1], false, SUBF) + 2 : 0);
  }

  // ---------- layout ----------
  function layout(n, d) {
    n._d = d; n._lw = labelW(n) + PAD;
    if (!n.c.length) { n._w = n._lw; return n._w; }
    var tot = 0; n.c.forEach(function (k, i) { tot += layout(k, d + 1) + (i ? GAP : 0); });
    n._kw = tot; n._w = Math.max(n._lw, tot); return n._w;
  }
  function place(n, x0) {
    if (!n.c.length) { n._x = x0 + n._w / 2; }
    else {
      var x = x0 + (n._w - n._kw) / 2;
      n.c.forEach(function (k) { place(k, x); x += k._w + GAP; });
      n._x = (n.c[0]._x + n.c[n.c.length - 1]._x) / 2;
    }
    n._y = n._d * LEVEL + 32;
  }
  function depthOf(n) { var m = n._d; n.c.forEach(function (k) { m = Math.max(m, depthOf(k)); }); return m; }

  function el(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    for (var a in attrs) e.setAttribute(a, attrs[a]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function drawLabel(g, n, x, y) {
    var s = split(n.l);
    var t = el("text", { x: x, y: y + 7, "text-anchor": "middle", "class": "lab" + (n.w && !plainWord(n.l) ? " word" : "") }, g);
    t.appendChild(document.createTextNode(s[0]));
    if (s[1]) { var ts = el("tspan", { "class": "sub", dy: 5 }, t); ts.appendChild(document.createTextNode(s[1])); }
  }
  function drawContent(g, n, interactive) {
    while (g.firstChild) g.removeChild(g.firstChild);
    var w = n._lw;
    if (interactive && S.wrong && S.wrong.has(n.id)) { el("rect", { "class": "wrongbg", x: -w / 2, y: -15, width: w, height: 31, rx: 9 }, g); g.setAttribute("class", "wrong"); }
    else g.removeAttribute("class");
    if (interactive && n.id === S.sel) el("rect", { "class": "ring", x: -w / 2 - 2, y: -17, width: w + 4, height: 35, rx: 10 }, g);
    if (n.l) drawLabel(g, n, 0, 0);
    else {
      if (interactive && n === S.tree && !n.c.length) el("circle", { "class": "pulse", cx: 0, cy: 0, r: 13 }, g);
      el("circle", { "class": "empty", cx: 0, cy: 0, r: 13 }, g);
      var q = el("text", { "class": "qm", x: 0, y: 5, "text-anchor": "middle" }, g); q.appendChild(document.createTextNode("?"));
    }
    if (interactive) { var hw = Math.max(w, 52) / 2; el("rect", { "class": "hit", x: -hw, y: -28, width: hw * 2, height: 54, "data-id": n.id }, g); }
  }

  // static tree (answer view)
  function drawStatic(root, g) {
    layout(root, 0); place(root, 10);
    var eg = el("g", {}, g), ng = el("g", {}, g);
    (function rec(n) {
      n.c.forEach(function (k) { el("line", { "class": "edge", x1: n._x, y1: n._y + 13, x2: k._x, y2: k._y - 16 }, eg); rec(k); });
      var gg = el("g", { transform: "translate(" + n._x + "," + n._y + ")" }, ng); drawContent(gg, n, false);
    })(root);
    return { w: root._w + 20, h: depthOf(root) * LEVEL + 64 };
  }

  // ---------- animated live renderer ----------
  var svg = $("svg"), view = $("view"), gEdges = $("edges"), gNodes = $("nodes");
  var live = new Map();   // id -> {g, line, x, y}
  var size = { w: 0, h: 0 };
  var anim = null;
  function ease(t) { return 1 - Math.pow(1 - t, 3); }

  function render() {
    var root = S.tree;
    layout(root, 0); place(root, 10);
    size = { w: root._w + 20, h: depthOf(root) * LEVEL + 64 };
    var seen = new Set(), items = [];
    (function rec(n, p) {
      seen.add(n.id);
      var rec0 = live.get(n.id), fresh = !rec0;
      if (fresh) {
        var from = p && live.get(p.id);
        rec0 = { g: el("g", { "class": "born" }, gNodes), line: null, x: from ? from.x : n._x, y: from ? from.y : n._y };
        rec0.g.addEventListener("animationend", function () { this.removeAttribute("class"); }, { once: true });
        live.set(n.id, rec0);
      }
      if (p && !rec0.line) rec0.line = el("line", { "class": "edge" }, gEdges);
      if (!p && rec0.line) { rec0.line.remove(); rec0.line = null; }
      drawContent(rec0.g, n, true);
      rec0.g.setAttribute("data-id", n.id);
      items.push({ n: n, p: p, r: rec0, fx: rec0.x, fy: rec0.y });
      n.c.forEach(function (k) { rec(k, n); });
    })(root, null);
    live.forEach(function (r, id) { if (!seen.has(id)) { r.g.remove(); if (r.line) r.line.remove(); live.delete(id); } });
    // selected node on top
    var selRec = live.get(S.sel); if (selRec) gNodes.appendChild(selRec.g);

    if (anim) cancelAnimationFrame(anim.raf);
    var t0 = performance.now(), dur = reduceMotion ? 0 : 220;
    function frame(now) {
      var t = dur ? Math.min(1, (now - t0) / dur) : 1, e = ease(t);
      items.forEach(function (it) {
        it.r.x = it.fx + (it.n._x - it.fx) * e; it.r.y = it.fy + (it.n._y - it.fy) * e;
        it.r.g.setAttribute("transform", "translate(" + it.r.x.toFixed(1) + "," + it.r.y.toFixed(1) + ")");
      });
      items.forEach(function (it) {
        if (!it.p) return; var pr = live.get(it.p.id);
        it.r.line.setAttribute("x1", pr.x.toFixed(1)); it.r.line.setAttribute("y1", (pr.y + 13).toFixed(1));
        it.r.line.setAttribute("x2", it.r.x.toFixed(1)); it.r.line.setAttribute("y2", (it.r.y - 16).toFixed(1));
      });
      if (t < 1) tok.raf = requestAnimationFrame(frame); else if (anim === tok) anim = null;
    }
    var tok = { raf: 0 }; anim = tok;
    frame(t0);
    updateTray();
  }
  function hardReset() { live.forEach(function (r) { r.g.remove(); if (r.line) r.line.remove(); }); live.clear(); }

  // ---------- view ----------
  var vAnim = null;
  function applyView() { view.setAttribute("transform", "translate(" + S.view.tx.toFixed(1) + "," + S.view.ty.toFixed(1) + ") scale(" + S.view.k.toFixed(4) + ")"); }
  function tweenView(to) {
    if (vAnim) cancelAnimationFrame(vAnim);
    var from = { k: S.view.k, tx: S.view.tx, ty: S.view.ty }, t0 = performance.now(), dur = reduceMotion ? 0 : 260;
    (function step(now) {
      var t = dur ? Math.min(1, (now - t0) / dur) : 1, e = ease(t);
      S.view.k = from.k + (to.k - from.k) * e; S.view.tx = from.tx + (to.tx - from.tx) * e; S.view.ty = from.ty + (to.ty - from.ty) * e;
      applyView(); if (t < 1) vAnim = requestAnimationFrame(step); else vAnim = null;
    })(t0);
  }
  function stopView() { if (vAnim) { cancelAnimationFrame(vAnim); vAnim = null; } }
  function sheetH() { var l = $("lsheet"); return l.hidden ? 0 : l.getBoundingClientRect().height; }
  function visibleBox() {
    var r = svg.getBoundingClientRect();
    var bn = $("banner"), top = bn.hidden ? 54 : bn.getBoundingClientRect().bottom - r.top + 12, bottom = sheetH() + 16;
    return { w: r.width, h: r.height, top: top, vh: Math.max(100, r.height - top - bottom), vw: r.width - 32 };
  }
  function fitTarget(all) {
    var b = visibleBox();
    var k = Math.min(b.vw / size.w, b.vh / size.h, 1.15);
    var n = find(S.sel), MINK = $("lsheet").hidden ? 0.5 : 0.62; // below this, labels are too small to read

    if (all || k >= MINK || !n || n._x === undefined) {
      k = Math.max(all ? 0.15 : MINK, k);
      return { k: k, tx: (b.w - size.w * k) / 2, ty: b.top + Math.max(0, (b.vh - size.h * k) / 2) };
    }
    // tree too big to read whole: follow the selected node at a readable size
    k = MINK;
    var tw = size.w * k, th = size.h * k, tx, ty;
    if (tw <= b.vw) tx = (b.w - tw) / 2;
    else tx = Math.min(16, Math.max(b.w - 16 - tw, b.w / 2 - n._x * k));
    if (th <= b.vh) ty = b.top + (b.vh - th) / 2;
    else ty = Math.min(b.top, Math.max(b.top + b.vh - th, b.top + b.vh * 0.4 - n._y * k));
    return { k: k, tx: tx, ty: ty };
  }
  function fit(instant, all) {
    if (!svg.getBoundingClientRect().width) return;
    S.manual = false; var t = fitTarget(all);
    if (instant) { stopView(); S.view = t; applyView(); } else tweenView(t);
  }
  function placeFloat() {}
  function ensureVisible() {
    var n = find(S.sel); if (!n || n._x === undefined) return;
    var r = svg.getBoundingClientRect(), v = { k: S.view.k, tx: S.view.tx, ty: S.view.ty };
    var sx = n._x * v.k + v.tx, sy = n._y * v.k + v.ty, bottom = r.height - Math.max(sheetH(), 0) - 50, m = 48;
    if (sx < m) v.tx += m - sx; else if (sx > r.width - m) v.tx -= sx - (r.width - m);
    if (sy < 70) v.ty += 70 - sy; else if (sy > bottom) v.ty -= sy - bottom;
    if (v.tx !== S.view.tx || v.ty !== S.view.ty) tweenView(v);
  }
  function autoView() { placeFloat(); if (S.manual) ensureVisible(); else fit(); }

  // ---------- tray ----------
  function updateTray() {
    var n = find(S.sel), p = n && parentOf(n.id);
    $("blabeltxt").textContent = n && n.l ? n.l.replace(/_(\w+)$/, "$1") : "?";
    $("blabel").disabled = !n;
    $("b1").disabled = !n || n.w || n.c.length >= 2 || hasWord(n);
    $("b2").disabled = !n || n.w || n.c.length > 0;
    $("bwrap").disabled = !n || n.w;
    var tgt = n && (n.c.length === 2 ? n : p);
    $("bswap").disabled = !(tgt && tgt.c.length === 2);
    $("bdel").disabled = !n || (!p && !n.l && !n.c.length);
    $("bundo").disabled = !S.undo.length; $("sundo").disabled = !S.undo.length;
    $("bredo").disabled = !S.redo.length;
    $("hint").hidden = !!(S.tree.l || S.tree.c.length);
  }

  // ---------- edits ----------
  function select(id, openSheet) {
    S.sel = id;
    render(); if (openSheet || !$("lsheet").hidden) showLabelSheet(); else ensureVisible();
  }
  function add(count) {
    var n = find(S.sel); if (!n) return;
    commit(); buzz();
    var made = [];
    for (var i = 0; i < count; i++) { var k = node(""); n.c.push(k); made.push(k.id); }
    S.sel = made[0];
    changed(); tab = "cat"; openSheet();
  }
  function wrap() {
    var n = find(S.sel); if (!n || n.w) return;
    commit(); buzz();
    var p = parentOf(n.id), np = node(n.l);
    np.c.push(n);
    if (p) p.c[p.c.indexOf(n)] = np; else S.tree = np;
    S.sel = np.id;
    changed(); autoView();
  }
  function swap() {
    var n = find(S.sel); if (!n) return;
    var t = n.c.length === 2 ? n : parentOf(n.id);
    if (!t || t.c.length !== 2) return;
    commit(); buzz(); t.c.reverse(); changed();
  }
  function del() {
    var n = find(S.sel); if (!n) return;
    var p = parentOf(n.id);
    if (!p) {
      askConfirm("수형도 전체를 지우고 처음부터 그릴까요?", function () { commit(); S.tree = node(""); S.sel = S.tree.id; hideLabelSheet(); changed(); fit(); });
      return;
    }
    commit(); buzz();
    p.c.splice(p.c.indexOf(n), 1);
    S.sel = p.id;
    changed(); autoView();
  }
  // what a node still needs: a label, branches, or a word under a head
  function need(n) {
    if (n.w) return null;
    if (!n.l) return "cat";
    if (n.c.length) return null;
    return isHead(n.l) ? "word" : "branch";
  }
  function nextPending(fromId) {
    // pre-order (left branch first), starting at fromId and wrapping around
    var order = []; walk(S.tree, function (n) { order.push(n); });
    var i0 = Math.max(0, order.findIndex(function (n) { return n.id === fromId; }));
    for (var i = 0; i < order.length; i++) { var n = order[(i0 + i) % order.length], t = need(n); if (t) return { id: n.id, tab: t }; }
    return null;
  }
  function advance(fromId) {
    var nx = nextPending(fromId);
    if (!nx) { changed(); hideLabelSheet(); return; }
    S.sel = nx.id; tab = nx.tab; changed(); openSheet();
  }
  function setLabel(text, asWord) {
    var n = find(S.sel); if (!n) return;
    text = text.trim(); if (!text) return;
    var wasPending = !!need(n);
    commit(); buzz();
    if (asWord && !n.w) {
      var wk = n.c.filter(function (k) { return k.w; })[0];
      if (wk) wk.l = text; else if (!n.c.length) n.c.push(node(text, true)); else { S.undo.pop(); return; }
    } else { n.l = text; if (!asWord) n.w = false; }
    if (wasPending || need(n)) advance(n.id);
    else { changed(); hideLabelSheet(); }
  }
  function undo() { if (!S.undo.length) return; S.redo.push(snapshot()); restore(S.undo.pop()); changed(); if (!$("lsheet").hidden) showLabelSheet(); else autoView(); }
  function redo() { if (!S.redo.length) return; S.undo.push(snapshot()); restore(S.redo.pop()); changed(); if (!$("lsheet").hidden) showLabelSheet(); else autoView(); }
  function nav(dir) {
    var n = find(S.sel); if (!n) return; var p = parentOf(n.id);
    if (dir === "up" && p) select(p.id);
    if (dir === "down" && n.c.length) select(n.c[0].id);
    if ((dir === "left" || dir === "right") && p) { var i = p.c.indexOf(n) + (dir === "left" ? -1 : 1); if (p.c[i]) select(p.c[i].id); }
  }

  // ---------- label sheet ----------
  var tab = "cat";
  function showLabelSheet() {
    var n = find(S.sel); if (!n) return;
    tab = need(n) === "branch" ? "branch" : (n.w || need(n) === "word") ? "word" : "cat";
    openSheet();
  }
  function openSheet() { $("lsheet").hidden = false; $("app").classList.add("editing"); fillSheet(); requestAnimationFrame(autoView); }
  function hideLabelSheet() { var was = !$("lsheet").hidden; $("lsheet").hidden = true; $("app").classList.remove("editing"); if (was) requestAnimationFrame(autoView); }
  function lb(txt, cls, onClick) {
    var b = document.createElement("button"); b.className = "lb " + (cls || "");
    var s = split(txt); b.appendChild(document.createTextNode(s[0]));
    if (s[1]) { var sub = document.createElement("sub"); sub.textContent = s[1]; b.appendChild(sub); }
    b.addEventListener("click", onClick); return b;
  }
  function section(title, parent) {
    var wrap = document.createElement("div"), t = document.createElement("div");
    t.className = "gl"; t.textContent = title; wrap.appendChild(t); parent.appendChild(wrap); return wrap;
  }
  function suggestions(n) {
    var p = parentOf(n.id); if (!p) return ["TP", "CP", "DP"];
    if (!p.l) return [];
    var pl = stripIdx(p.l), out = [], i = p.c.indexOf(n);
    if (/P$/.test(pl) && pl !== "P") { var x = pl.slice(0, -1); if (i === 0 && p.c.length === 2) out.push("DP", "DegP", "AdvP"); out.push(x + "′"); }
    else if (/′$/.test(pl)) {
      var h = pl.slice(0, -1);
      if (i === 0) out.push(h, pl, "AP", "AdvP"); else out.push.apply(out, (COMPS[pl] || []).concat([pl, "PP", "CP"]));
    }
    var seen = {}; return out.filter(function (x) { if (seen[x]) return false; seen[x] = 1; return true; }).slice(0, 7);
  }
  function tokens() {
    var out = [];
    curSentence().split(/\s+/).forEach(function (w) {
      w = w.replace(/[.,?!;:]+$/, ""); if (!w) return;
      var m = w.match(/^(.+?)['’]s$/);
      if (m) { out.push(m[1]); out.push("'s"); } else out.push(w);
    });
    return out;
  }
  function usedWords() { var u = {}; walk(S.tree, function (n) { if (n.w) u[n.l] = (u[n.l] || 0) + 1; }); return u; }
  function fillSheet() {
    var n = find(S.sel), body = $("lbody");
    if (!n) { hideLabelSheet(); return; }
    var p = parentOf(n.id), br = tab === "branch";
    $("lsheet").classList.toggle("branching", br);
    if (br) {
      $("ltitle").textContent = n.l + " 아래로 가지"; $("lsub").textContent = "";
      body.innerHTML = "";
      var row = document.createElement("div"); row.className = "brrow"; body.appendChild(row);
      [[1, "b1"], [2, "b2"]].forEach(function (b) {
        var btn = document.createElement("button"); btn.className = "brbtn";
        btn.innerHTML = $(b[1]).innerHTML;
        btn.addEventListener("click", function () { add(b[0]); });
        row.appendChild(btn);
      });
      var alt = document.createElement("div"); alt.className = "brlinks";
      var relabel = document.createElement("button"); relabel.textContent = "라벨 바꾸기";
      relabel.addEventListener("click", function () { tab = "cat"; fillSheet(); });
      var asw = document.createElement("button"); asw.textContent = "바로 단어 붙이기";
      asw.addEventListener("click", function () { tab = "word"; fillSheet(); });
      alt.appendChild(relabel); alt.appendChild(asw); body.appendChild(alt);
      return;
    }
    $("t-cat").setAttribute("aria-pressed", tab === "cat"); $("t-word").setAttribute("aria-pressed", tab === "word");
    $("ltitle").textContent = tab === "word" ? (n.w ? "단어 바꾸기" : "단어") : (n.l ? "라벨 바꾸기" : "라벨");
    var sub = "";
    if (tab === "word") sub = !n.w && n.l ? n.l + " 아래" : "";
    else sub = p ? (p.l ? p.l + " 아래" : "") : "맨 위 절점";
    $("lsub").textContent = sub;
    body.innerHTML = "";
    if (tab === "cat") {
      var sug = suggestions(n);
      if (sug.length) { var s1 = section("추천", body), c1 = document.createElement("div"); c1.className = "chips"; s1.appendChild(c1); sug.forEach(function (l) { c1.appendChild(lb(l, "sug", function () { setLabel(l, false); })); }); }
      var s2 = section("전체 범주", body), fam = document.createElement("div"); fam.className = "fam"; s2.appendChild(fam);
      FAMILIES.forEach(function (f) { f.forEach(function (l) { fam.appendChild(lb(l, "", function () { setLabel(l, false); })); }); });
      $("freein").placeholder = "직접 입력 (예: DP_1)";
    } else {
      var used = usedWords(), cnt = {};
      var s3 = section("문장의 단어", body), c3 = document.createElement("div"); c3.className = "chips"; s3.appendChild(c3);
      tokens().forEach(function (t) {
        cnt[t] = (cnt[t] || 0) + 1;
        c3.appendChild(lb(t, "w" + ((used[t] || 0) >= cnt[t] ? " used" : ""), function () { setLabel(t, true); }));
      });
      var s4 = section("시제·영형태·흔적", body), c4 = document.createElement("div"); c4.className = "chips"; s4.appendChild(c4);
      EXTRA_WORDS.forEach(function (t) { c4.appendChild(lb(t, plainWord(t) ? "w plain" : "w", function () { setLabel(t, true); })); });
      var tip = document.createElement("div"); tip.className = "tip";
      tip.textContent = "시제가 T에 있으면 V에는 원형을 씁니다. 원형(solve, be, give_2)은 아래 칸에 직접 입력하세요.";
      body.appendChild(tip);
      $("freein").placeholder = "단어 직접 입력";
    }
    body.scrollTop = 0;
    $("freein").value = "";
  }

  // ---------- grading ----------
  function norm(l, w) { var s = stripIdx(l).replace(/'/g, "′").replace(/\s+/g, ""); return w ? s.toLowerCase() : s; }
  function grade(u, a) {
    var wrong = new Set(), miss = 0;
    (function cmp(x, y) {
      if (norm(x.l, x.w) !== norm(y.l, !!y.w) || !!x.w !== !!y.w) wrong.add(x.id);
      var ac = y.c || [];
      if (x.c.length !== ac.length) { wrong.add(x.id); miss += Math.max(0, ac.length - x.c.length); }
      for (var i = 0; i < Math.min(x.c.length, ac.length); i++) cmp(x.c[i], ac[i]);
      for (var j = ac.length; j < x.c.length; j++) wrong.add(x.c[j].id);
    })(u, a);
    return { wrong: wrong, n: wrong.size + miss };
  }
  function check() {
    var p = P[S.idx]; if (!p || S.mode !== "book") return;
    hideLabelSheet();
    var best = null;
    p.trees.forEach(function (t) { var g = grade(S.tree, t); if (!best || g.n < best.n) best = g; });
    S.wrong = best.wrong; render();
    if (!best.n) { showBanner("good", "정답입니다. 교안 규칙대로 그렸습니다."); store("stp:ok:" + S.idx, "1"); }
    else showBanner("bad", "정답과 다른 곳 " + best.n + "군데. 빨간 절점의 라벨이나 그 아래 가지 수를 확인하세요.");
    autoView();
  }
  function showBanner(kind, text) { var b = $("banner"); b.className = "banner " + kind; $("bannertext").textContent = text; b.hidden = false; $("app").classList.add("bannered"); }
  function hideBanner() { $("banner").hidden = true; $("app").classList.remove("bannered"); }

  // ---------- modal ----------
  function openModal(title, build) { $("mtitle").textContent = title; var b = $("mbody"); b.innerHTML = ""; build(b); $("modal").hidden = false; b.scrollTop = 0; }
  function staticTree(t) {
    var s = document.createElementNS(NS, "svg"), g = el("g", {}, s);
    var copy = JSON.parse(JSON.stringify(t)); (function fix(n) { n.c = n.c || []; n.w = !!n.w; n.c.forEach(fix); })(copy);
    var sz = drawStatic(copy, g);
    s.setAttribute("viewBox", "0 0 " + sz.w + " " + sz.h);
    var maxw = Math.min(window.innerWidth - 56, 900), k = Math.min(0.85, maxw / sz.w);
    if (k < 0.55) k = 0.55;
    s.setAttribute("width", Math.round(sz.w * k)); s.setAttribute("height", Math.round(sz.h * k));
    var wrap = document.createElement("div"); wrap.className = "ans"; wrap.appendChild(s); return wrap;
  }
  function para(parent, text, cls) { var p = document.createElement("p"); if (cls) p.className = cls; p.textContent = text; parent.appendChild(p); return p; }
  function showAnswer() {
    var p = P[S.idx]; if (!p) return;
    openModal("정답 · " + (S.idx + 1) + "번", function (b) {
      para(b, p.s, "msent");
      if (p.q) para(b, p.q, "meta");
      p.trees.forEach(function (t) { b.appendChild(staticTree(t)); });
      para(b, p.note);
      para(b, p.ch + "장 · 교안 " + p.src, "meta");
    });
  }
  function showHelp() {
    openModal("표기 규칙과 사용법", function (b) {
      var secs = [
        ["표기 규칙", [
          "삼각형 없이 모든 구를 XP – X′ – X로 펼칩니다. 고유명사·무관사 명사는 D에 Ø, 대명사는 DP – D′ – D.",
          "문장은 항상 TP – T′ – T. 조동사가 없으면 T에 [past]/[pres], V는 원형(solve, give).",
          "양상 조동사·완료 have·do는 정형형 그대로 T에 둡니다(T has, will, did).",
          "be는 T [시제] + V be. not이 있거나 도치될 때만 T에 is_1, V에 t_1 (의문문은 C에 Is_1).",
          "앞 조동사가 요구한 분사형은 그대로 씁니다: has gone, is working, was approved.",
          "보어는 핵의 자매, 부가어는 X′의 자매, 지정어는 XP의 딸이자 X′의 자매.",
          "비대격·수동 주어는 V의 보어 자리에 t_1. 이중목적어·여격·사역 교체 동사·put은 vP-shell.",
          "관계절은 N′에 CP를 부가하고, 관계대명사는 Spec,CP, C는 Ø, 빈자리에 t."
        ]],
        ["사용법", [
          "절점을 탭하면 선택됩니다. 선택한 절점을 한 번 더 탭하거나 아래 라벨 버튼을 누르면 라벨을 고릅니다.",
          "한 가닥·두 가닥을 누르면 새 절점의 라벨을 바로 묻습니다. 라벨을 고르면 그 절점에서 바로 가지를 뻗고, 언제나 왼쪽 가지부터 내려갑니다. D·V·T 같은 말단 범주에는 단어를 묻고, 단어를 붙이면 남은 절점 중 가장 왼쪽 것으로 넘어갑니다.",
          "부가어: 위에 끼우기로 V′ 위에 V′를 하나 더 만든 뒤 한 가닥으로 부가어 자리를 만듭니다. 왼쪽 부가어면 좌우 바꾸기를 누릅니다.",
          "아래첨자는 밑줄로 씁니다: t_1, DP_1, give_2. 채점은 아래첨자 번호를 보지 않습니다.",
          "한 손가락으로 끌면 이동, 두 손가락으로 확대합니다. 오른쪽 아래 버튼은 화면 맞춤입니다.",
          "그린 수형도는 이 기기의 브라우저에 문제별로 저장됩니다.",
          "키보드: 1·2 가지 뻗기, 방향키 이동, Enter 라벨, Delete 지우기, Ctrl+Z 되돌리기."
        ]]
      ];
      secs.forEach(function (sec) {
        var h = document.createElement("h4"); h.textContent = sec[0]; b.appendChild(h);
        var ul = document.createElement("ul"); sec[1].forEach(function (r) { var li = document.createElement("li"); li.textContent = r; ul.appendChild(li); }); b.appendChild(ul);
      });
    });
  }
  var confirmCb = null;
  function askConfirm(text, cb) { $("confirmtext").textContent = text; confirmCb = cb; $("confirm").hidden = false; $("scrim").hidden = false; }
  function closeConfirm() { $("confirm").hidden = true; if ($("psheet").hidden) $("scrim").hidden = true; }

  // ---------- problem list ----------
  function curSentence() { return S.mode === "book" ? (P[S.idx] ? P[S.idx].s : "") : S.own; }
  function statusOf(i) { if (load("stp:ok:" + i)) return "done"; var t = load("stp:b:" + i); return t && t.length > 30 ? "wip" : ""; }
  function buildList() {
    var list = $("plist"), chaps = $("chaps"); list.innerHTML = ""; chaps.innerHTML = "";
    var heads = {}, done = 0;
    P.forEach(function (p, i) {
      if (!heads[p.ch]) {
        var h = document.createElement("div"); h.className = "ph"; h.textContent = p.ch + "장"; h.id = "ch" + p.ch; list.appendChild(h); heads[p.ch] = h;
        var cb = document.createElement("button"); cb.textContent = p.ch + "장";
        cb.addEventListener("click", function () { list.scrollTo({ top: h.offsetTop - 4, behavior: reduceMotion ? "auto" : "smooth" }); });
        chaps.appendChild(cb);
      }
      var st = statusOf(i); if (st === "done") done++;
      var b = document.createElement("button"); b.className = "pi" + (S.mode === "book" && i === S.idx ? " cur" : "");
      b.innerHTML = '<span class="n"></span><span class="t"><div class="s"></div><div class="r"></div></span><span class="st"></span>';
      b.querySelector(".n").textContent = i + 1;
      b.querySelector(".s").textContent = p.s;
      var r = b.querySelector(".r"); if (p.q) r.textContent = p.q; else r.remove();
      b.querySelector(".st").className = "st " + st;
      b.addEventListener("click", function () { closeList(); S.mode = "book"; go(i); });
      list.appendChild(b);
    });
    $("pstat").textContent = done + " / " + P.length + " 정답";
  }
  function openList() {
    hideLabelSheet(); buildList(); $("custom").value = S.mode === "own" ? S.own : "";
    $("scrim").hidden = false; $("psheet").hidden = false;
    var cur = $("plist").querySelector(".pi.cur"); if (cur) cur.scrollIntoView({ block: "center" });
  }
  function closeList() { $("psheet").hidden = true; $("scrim").hidden = true; }

  function loadCurrent() {
    var saved = load(key());
    hardReset();
    S.tree = null;
    if (saved) { try { S.tree = rehydrate(JSON.parse(saved)); } catch (e) {} }
    if (!S.tree) S.tree = node("");
    S.sel = S.tree.id; S.undo = []; S.redo = []; S.wrong = null;
    hideBanner(); $("lsheet").hidden = true;
    var p = P[S.idx], book = S.mode === "book";
    $("sent").textContent = curSentence();
    $("pnum").textContent = book ? (S.idx + 1) : "✎";
    $("pch").textContent = book && p ? p.ch + "장 · 교안 " + p.src : "직접 입력";
    $("reading").hidden = !(book && p && p.q); $("reading").textContent = book && p && p.q ? p.q : "";
    $("bcheck").hidden = !book; $("prev").hidden = !book; $("next").hidden = !book;
    $("prev").disabled = S.idx <= 0; $("next").disabled = S.idx >= P.length - 1;
    render(); requestAnimationFrame(function () { fit(true); });
    store("stp:last", JSON.stringify({ mode: S.mode, idx: S.idx, own: S.own }));
  }
  function go(i) { if (i < 0 || i >= P.length) return; S.idx = i; S.mode = "book"; loadCurrent(); }
  function startOwn() { var v = $("custom").value.trim(); if (!v) return; S.own = v; S.mode = "own"; $("custom").blur(); closeList(); loadCurrent(); }

  // ---------- pointer: tap, pan, pinch ----------
  var ptrs = new Map(), gest = null;
  function local(e) { var r = svg.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  svg.addEventListener("pointerdown", function (e) {
    try { svg.setPointerCapture(e.pointerId); } catch (er) {}
    stopView();
    ptrs.set(e.pointerId, local(e));
    if (ptrs.size === 1) {
      var t = e.target.closest ? e.target.closest("[data-id]") : null;
      gest = { type: "pan", start: local(e), tx: S.view.tx, ty: S.view.ty, moved: false, id: t ? +t.getAttribute("data-id") : null };
    } else if (ptrs.size === 2) {
      var a = Array.from(ptrs.values());
      gest = { type: "pinch", d0: Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) || 1, k0: S.view.k, mid0: { x: (a[0].x + a[1].x) / 2, y: (a[0].y + a[1].y) / 2 }, tx: S.view.tx, ty: S.view.ty };
    }
  });
  svg.addEventListener("pointermove", function (e) {
    if (!ptrs.has(e.pointerId) || !gest) return;
    ptrs.set(e.pointerId, local(e));
    if (gest.type === "pinch" && ptrs.size >= 2) {
      var a = Array.from(ptrs.values());
      var d = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y), mid = { x: (a[0].x + a[1].x) / 2, y: (a[0].y + a[1].y) / 2 };
      var k = Math.min(3, Math.max(0.2, gest.k0 * d / gest.d0));
      var wx = (gest.mid0.x - gest.tx) / gest.k0, wy = (gest.mid0.y - gest.ty) / gest.k0;
      S.manual = true; S.view.k = k; S.view.tx = mid.x - wx * k; S.view.ty = mid.y - wy * k; applyView();
    } else if (gest.type === "pan") {
      var p = local(e), dx = p.x - gest.start.x, dy = p.y - gest.start.y;
      if (!gest.moved && Math.hypot(dx, dy) > 8) gest.moved = true;
      if (gest.moved) { S.manual = true; S.view.tx = gest.tx + dx; S.view.ty = gest.ty + dy; applyView(); }
    }
  });
  function end(e) {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.delete(e.pointerId);
    if (gest && gest.type === "pan" && !gest.moved && ptrs.size === 0) {
      if (gest.id) select(gest.id, gest.id === S.sel);
      else if (!$("lsheet").hidden) hideLabelSheet();
    }
    if (ptrs.size === 0) gest = null;
    else if (ptrs.size === 1 && gest && gest.type === "pinch") { var r = Array.from(ptrs.values())[0]; gest = { type: "pan", start: r, tx: S.view.tx, ty: S.view.ty, moved: true, id: null }; }
  }
  svg.addEventListener("pointerup", end); svg.addEventListener("pointercancel", end);
  svg.addEventListener("wheel", function (e) {
    e.preventDefault(); stopView();
    var p = local(e), k0 = S.view.k, k = Math.min(3, Math.max(0.2, k0 * Math.exp(-e.deltaY * 0.0015)));
    S.view.tx = p.x - (p.x - S.view.tx) / k0 * k; S.view.ty = p.y - (p.y - S.view.ty) / k0 * k; S.view.k = k; S.manual = true; applyView();
  }, { passive: false });

  // ---------- wiring ----------
  function on(id, f) { $(id).addEventListener("click", f); }
  on("blabel", showLabelSheet);
  on("b1", function () { add(1); }); on("b2", function () { add(2); });
  on("bwrap", wrap); on("bswap", swap); on("bdel", del); on("bundo", undo); on("bredo", redo);
  on("bfit", function () { fit(false, true); }); on("sundo", undo); on("bcheck", check); on("bannerans", showAnswer); on("bannerx", hideBanner);
  on("lclose", hideLabelSheet);
  on("t-cat", function () { tab = "cat"; fillSheet(); }); on("t-word", function () { tab = "word"; fillSheet(); });
  function applyFree() { var v = $("freein").value; if (v.trim()) setLabel(v, tab === "word"); }
  on("freeok", applyFree);
  $("freein").addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); applyFree(); } });
  on("mx", function () { $("modal").hidden = true; });
  on("help", showHelp);
  on("cno", closeConfirm);
  on("cyes", function () { closeConfirm(); if (confirmCb) confirmCb(); });
  on("listbtn", openList); on("pclose", closeList); on("scrim", function () { closeList(); closeConfirm(); });
  on("prev", function () { go(S.idx - 1); }); on("next", function () { go(S.idx + 1); });
  on("start", startOwn);
  $("custom").addEventListener("keydown", function (e) { if (e.key === "Enter") startOwn(); });
  document.addEventListener("keydown", function (e) {
    var tag = (e.target.tagName || "").toLowerCase();
    if (tag === "input" || !$("modal").hidden || !$("psheet").hidden) { if (e.key === "Escape") { $("modal").hidden = true; closeList(); } return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    var m = { "1": function () { if (!$("b1").disabled) add(1); }, "2": function () { if (!$("b2").disabled) add(2); },
      ArrowUp: function () { nav("up"); }, ArrowDown: function () { nav("down"); }, ArrowLeft: function () { nav("left"); }, ArrowRight: function () { nav("right"); },
      Enter: showLabelSheet, Delete: del, Backspace: del, Escape: hideLabelSheet };
    if (m[e.key]) { e.preventDefault(); m[e.key](); }
  });
  var rT = null; window.addEventListener("resize", function () { clearTimeout(rT); rT = setTimeout(autoView, 120); });

  // ---------- boot ----------
  var last = null; try { last = JSON.parse(load("stp:last") || "null"); } catch (e) {}
  if (last) { S.idx = Math.max(0, Math.min(last.idx || 0, P.length - 1)); S.own = last.own || ""; S.mode = last.mode === "own" && S.own ? "own" : "book"; }
  loadCurrent();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { render(); fit(true); });
})();
