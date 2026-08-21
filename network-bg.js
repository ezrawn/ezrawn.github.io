/* Generates a scale-free / small-world node graph as a fixed, full-viewport
   SVG behind the page. Only the margins outside .layout are ever visible,
   so it's skipped entirely below the layout's max width. Seeded, so every
   page shows the same graph instead of reshuffling on each navigation. */
(function () {
  "use strict";

  var rootStyle = getComputedStyle(document.documentElement);
  var maxLayoutW = parseInt(rootStyle.getPropertyValue("--layout-max-w"), 10) || 1120;
  if (window.innerWidth <= maxLayoutW) return;

  var accent = rootStyle.getPropertyValue("--accent").trim() || "#4a6d7c";

  // seeded PRNG so the graph is identical across pages and reloads
  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  var rand = mulberry32(20260821);

  var W = window.innerWidth;
  var H = window.innerHeight;
  var N = 110;
  var MINDIST = 42;

  var nodes = [];
  var attempts = 0;
  while (nodes.length < N && attempts < N * 60) {
    attempts++;
    var x = rand() * W;
    var y = rand() * H;
    var ok = true;
    for (var k = 0; k < nodes.length; k++) {
      var dx = nodes[k].x - x;
      var dy = nodes[k].y - y;
      if (dx * dx + dy * dy < MINDIST * MINDIST) {
        ok = false;
        break;
      }
    }
    if (ok) nodes.push({ x: x, y: y, deg: 0 });
  }

  var edgeSet = {};
  var edges = [];
  function addEdge(i, j) {
    if (i === j) return;
    var key = i < j ? i + "_" + j : j + "_" + i;
    if (edgeSet[key]) return;
    edgeSet[key] = true;
    edges.push([i, j]);
    nodes[i].deg++;
    nodes[j].deg++;
  }

  // seed clique
  var m0 = 3;
  for (var i = 0; i < m0; i++) {
    for (var j = i + 1; j < m0; j++) addEdge(i, j);
  }

  // Barabasi-Albert preferential attachment -> scale-free hubs
  var m = 2;
  for (var i2 = m0; i2 < nodes.length; i2++) {
    var targets = {};
    var got = 0;
    var guard = 0;
    while (got < m && guard < 300) {
      guard++;
      var totalDeg = 0;
      for (var k2 = 0; k2 < i2; k2++) totalDeg += nodes[k2].deg + 1;
      var r = rand() * totalDeg;
      var pick = 0;
      for (var k3 = 0; k3 < i2; k3++) {
        r -= nodes[k3].deg + 1;
        if (r <= 0) {
          pick = k3;
          break;
        }
      }
      if (pick !== i2 && !targets[pick]) {
        targets[pick] = true;
        got++;
      }
    }
    for (var t in targets) addEdge(i2, +t);
  }

  // nearest-neighbor local edges -> small-world clustering
  function dist2(a, b) {
    var dx = a.x - b.x;
    var dy = a.y - b.y;
    return dx * dx + dy * dy;
  }
  for (var i3 = 0; i3 < nodes.length; i3++) {
    var best = -1;
    var bestD = Infinity;
    for (var j3 = 0; j3 < nodes.length; j3++) {
      if (i3 === j3) continue;
      var d = dist2(nodes[i3], nodes[j3]);
      if (d < bestD) {
        bestD = d;
        best = j3;
      }
    }
    if (best >= 0) addEdge(i3, best);
  }

  // a few long-range shortcuts -> small-world short path length
  for (var s = 0; s < 7; s++) {
    addEdge(Math.floor(rand() * nodes.length), Math.floor(rand() * nodes.length));
  }

  var maxDeg = 1;
  for (var d0 = 0; d0 < nodes.length; d0++) maxDeg = Math.max(maxDeg, nodes[d0].deg);

  var svgns = "http://www.w3.org/2000/svg";
  var svg = document.createElementNS(svgns, "svg");
  svg.setAttribute("width", W);
  svg.setAttribute("height", H);
  svg.setAttribute("viewBox", "0 0 " + W + " " + H);
  svg.setAttribute("aria-hidden", "true");
  svg.style.position = "fixed";
  svg.style.inset = "0";
  svg.style.width = "100%";
  svg.style.height = "100%";
  svg.style.zIndex = "-1";
  svg.style.pointerEvents = "none";

  var edgeG = document.createElementNS(svgns, "g");
  edgeG.setAttribute("stroke", accent);
  edgeG.setAttribute("stroke-linecap", "round");
  var haloG = document.createElementNS(svgns, "g");
  haloG.setAttribute("fill", accent);
  var nodeG = document.createElementNS(svgns, "g");
  nodeG.setAttribute("fill", accent);

  edges.forEach(function (e) {
    var a = nodes[e[0]];
    var b = nodes[e[1]];
    var line = document.createElementNS(svgns, "line");
    line.setAttribute("x1", a.x);
    line.setAttribute("y1", a.y);
    line.setAttribute("x2", b.x);
    line.setAttribute("y2", b.y);
    line.setAttribute("stroke-width", "0.8");
    line.setAttribute("opacity", (0.05 + 0.09 * Math.min(a.deg, b.deg) / maxDeg).toFixed(3));
    edgeG.appendChild(line);
  });

  nodes.forEach(function (n) {
    var r = 1.6 + Math.sqrt(n.deg) * 2.1;
    if (n.deg >= 6) {
      var halo = document.createElementNS(svgns, "circle");
      halo.setAttribute("cx", n.x);
      halo.setAttribute("cy", n.y);
      halo.setAttribute("r", r + 9);
      halo.setAttribute("opacity", "0.05");
      haloG.appendChild(halo);
    }
    var c = document.createElementNS(svgns, "circle");
    c.setAttribute("cx", n.x);
    c.setAttribute("cy", n.y);
    c.setAttribute("r", r.toFixed(2));
    c.setAttribute("opacity", (0.12 + 0.14 * n.deg / maxDeg).toFixed(3));
    nodeG.appendChild(c);
  });

  svg.appendChild(edgeG);
  svg.appendChild(haloG);
  svg.appendChild(nodeG);
  document.body.insertBefore(svg, document.body.firstChild);
})();
