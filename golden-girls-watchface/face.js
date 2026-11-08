/*!
 * Cheesecake O'Clock
 * A Golden Girls tribute watch face for Apple Watch Ultra (49 mm).
 *
 * One canvas renderer drives both the live, animated concept face on the
 * showcase page and the still wallpapers exported for the watchOS Photos face.
 * The design space is the Ultra / Ultra 2 panel (410 x 502 px); any other size
 * (the Ultra 3 is 422 x 514) is scaled to fit, with the backdrop bleeding out.
 *
 * Fan-made tribute for personal use. Everything is drawn procedurally: no
 * photos, logos or artwork from the show.
 */
(function (root) {
  'use strict';

  /* ---------- design space & geometry ---------- */
  var BW = 410, BH = 502;
  var CX = 205, CY = 197, R = 171;          // arched lanai window: circle centre + radius
  var HORIZON = 326;
  var TABLE_BACK = 374, TABLE_FRONT = 404;  // glass-top wicker table
  var APRON_BOTTOM = 439;
  var ARCH_FOOT = TABLE_BACK + 8;           // arch sides run down behind the table
  var GOLD_IN = R + 2.2, GOLD_OUT = R + 10; // the two deco trim lines
  var PROP_X = 104;                         // each girl's keepsake sits left of the cake

  var FONT_DISPLAY = 'Fraunces, "Iowan Old Style", Georgia, serif';
  var FONT_SCRIPT = '"Pinyon Script", "Snell Roundhand", "Apple Chancery", cursive';
  var FONT_CAPS = 'Jost, Futura, "Avenir Next", "Century Gothic", sans-serif';

  var WALL = '#06100b';
  var FROND = { dark: '#0d2f1f', mid: '#2a6b43', light: '#5fa66a', rib: '#b9dc93' };
  var PATTERN = { dark: '#0a1e15', mid: '#123526', light: '#1c4b35', rib: '#2a5f43' };
  var RATTAN = { hi: '#f2d39e', mid: '#cf9d5f', lo: '#8b5e2e', gap: '#2b190b' };

  /* ---------- the four girls ---------- */
  var THEMES = {
    blanche: {
      key: 'blanche', name: 'Blanche', title: 'Magnolia Night', prop: 'magnolia', propName: 'a magnolia',
      line: 'Thank you for being a friend.', seed: 31,
      sky: [[0, '#1a0a2c'], [0.34, '#46134e'], [0.6, '#9a2d68'], [0.8, '#e8747c'], [1, '#ffc39b']],
      sea: ['#80325f', '#1c0a22'],
      cel: { type: 'moon', x: 298, y: 274, r: 21, color: '#fff2ea', glow: '#ffbac4' },
      stars: 46, silhouette: '#1b0820', plate: '#f7cbd5', plateDeep: '#d4899c',
      ink: '#ffe4da', accent: '#f3b7a3', metalName: 'rose gold',
      metal: ['#fff1ec', '#f9cfc0', '#e3a08d', '#b0675a', '#f3bba8']
    },
    dorothy: {
      key: 'dorothy', name: 'Dorothy', title: 'Shady Pines', prop: 'coffee', propName: 'late-night coffee',
      line: 'Shady Pines, Ma.', seed: 47,
      sky: [[0, '#0a1230'], [0.38, '#1f2c5a'], [0.64, '#55548a'], [0.84, '#a888a8'], [1, '#efc2b1']],
      sea: ['#4c4b7e', '#0a1030'],
      cel: { type: 'crescent', x: 300, y: 268, r: 19, color: '#f5f1ff', glow: '#c4bcff' },
      stars: 64, silhouette: '#0a0e24', plate: '#d8d1ee', plateDeep: '#9a90c2',
      ink: '#ebe7f8', accent: '#cdc6e6', metalName: 'platinum',
      metal: ['#ffffff', '#e6e3f0', '#bdb8cf', '#8a84a3', '#dedaeb']
    },
    rose: {
      key: 'rose', name: 'Rose', title: 'St. Olaf Morning', prop: 'daisies', propName: 'daisies from the farm',
      line: 'Back in St. Olaf…', seed: 59,
      sky: [[0, '#13274e'], [0.38, '#2d5895'], [0.64, '#76a0d4'], [0.84, '#f0b4c4'], [1, '#fff0b6']],
      sea: ['#6a8ec2', '#132850'],
      cel: { type: 'sun', x: 290, y: 318, r: 27, color: '#fff8dc', glow: '#ffe0a0' },
      stars: 14, silhouette: '#14264a', plate: '#c3e7d9', plateDeep: '#78b9a3',
      ink: '#fff6dc', accent: '#f7e3a1', metalName: 'pearl',
      metal: ['#ffffff', '#f7eef6', '#dfe6f6', '#aab6dc', '#f2ecf8']
    },
    sophia: {
      key: 'sophia', name: 'Sophia', title: 'Sicily, 1922', prop: 'purse', propName: 'her wicker purse',
      line: 'Picture it: Sicily, 1922.', liveLine: 'Sicily, 1922.', seed: 73,
      sky: [[0, '#1e0912'], [0.34, '#561327'], [0.6, '#ab3729'], [0.8, '#ec7b38'], [1, '#ffd07a']],
      sea: ['#8c2e26', '#1e0a0e'],
      cel: { type: 'sun', x: 290, y: 314, r: 32, color: '#ffe6a8', glow: '#ff8a3a' },
      stars: 26, silhouette: '#1c070c', plate: '#f6e4ad', plateDeep: '#c9a65a',
      ink: '#ffe9c4', accent: '#f2c86a', metalName: 'gold',
      metal: ['#fff5cc', '#f6d97f', '#d8a43f', '#a4701d', '#f2c96a']
    }
  };
  var ORDER = ['blanche', 'dorothy', 'rose', 'sophia'];

  /* ---------- small utilities ---------- */
  var SC = 1; // current device-pixel scale; canvas shadows ignore the transform

  function hexRgb(h) {
    h = h.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgba(h, a) {
    var c = hexRgb(h);
    return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
  }
  function mix(a, b, t, alpha) {
    var A = hexRgb(a), B = hexRgb(b);
    var r = Math.round(A[0] + (B[0] - A[0]) * t);
    var g = Math.round(A[1] + (B[1] - A[1]) * t);
    var bl = Math.round(A[2] + (B[2] - A[2]) * t);
    return alpha == null ? 'rgb(' + r + ',' + g + ',' + bl + ')' : 'rgba(' + r + ',' + g + ',' + bl + ',' + alpha + ')';
  }
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function shadow(c, color, blur, dy) {
    c.shadowColor = color; c.shadowBlur = blur * SC; c.shadowOffsetX = 0; c.shadowOffsetY = (dy || 0) * SC;
  }
  function noShadow(c) { c.shadowColor = 'rgba(0,0,0,0)'; c.shadowBlur = 0; c.shadowOffsetY = 0; }
  function rrect(c, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }
  function ellipse(c, x, y, rx, ry) { c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); }
  function metalGrad(c, th, y0, y1) {
    var g = c.createLinearGradient(0, y0, 0, y1), m = th.metal;
    g.addColorStop(0, m[0]); g.addColorStop(0.22, m[1]); g.addColorStop(0.5, m[2]);
    g.addColorStop(0.52, m[3]); g.addColorStop(0.78, m[4]); g.addColorStop(1, m[1]);
    return g;
  }
  function tracked(c, text, x, y, spacing) {
    var ws = [], w = 0, i;
    for (i = 0; i < text.length; i++) { ws.push(c.measureText(text[i]).width); w += ws[i]; }
    w += spacing * (text.length - 1);
    var px = x - w / 2, align = c.textAlign;
    c.textAlign = 'left';
    for (i = 0; i < text.length; i++) { c.fillText(text[i], px, y); px += ws[i] + spacing; }
    c.textAlign = align;
    return w;
  }
  function diamond(c, x, y, s) {
    c.beginPath(); c.moveTo(x, y - s); c.lineTo(x + s, y); c.lineTo(x, y + s); c.lineTo(x - s, y); c.closePath(); c.fill();
  }

  /* ---------- banana leaves ---------- */
  function leafProfile(s) {
    var u = (s - 0.04) / 0.96;
    if (u <= 0 || u >= 1) return 0;
    return Math.pow(Math.sin(Math.PI * u), 0.5) * (1 - 0.18 * u);
  }
  function leafGeom(o) {
    if (o._g) return o._g;
    var N = o.segs || 30, r = rng(o.seed || 1), tears = [[], []], jit = [[], []], shade = [[], []];
    for (var side = 0; side < 2; side++) {
      for (var i = 0; i <= N; i++) {
        var torn = i > 2 && i < N - 1 && r() < (o.tearRate || 0.26);
        tears[side].push(torn ? (0.8 + r() * 2.6) * (o.wid / 44) : 0);
        jit[side].push((r() - 0.5) * 0.1);
        shade[side].push((r() - 0.5) * 0.18);
      }
    }
    o._g = { N: N, tears: tears, jit: jit, shade: shade };
    return o._g;
  }
  // A torn banana leaf: midrib along +x, strips between lateral veins, tears open toward the edge.
  function bananaLeaf(c, o, pal, angOff, bendOff) {
    var g = leafGeom(o), N = g.N, L = o.len, Wd = o.wid, bend = (o.bend || 0) + (bendOff || 0);
    var M = [], T = [], Nn = [], HW = [], i, side;
    for (i = 0; i <= N; i++) {
      var s = i / N, tx = 1, ty = 2 * bend * s, tl = Math.sqrt(tx * tx + ty * ty);
      tx /= tl; ty /= tl;
      M.push([s * L, bend * L * s * s]); T.push([tx, ty]); Nn.push([-ty, tx]);
      HW.push(Wd * 0.5 * leafProfile(s));
    }
    c.save();
    c.translate(o.x, o.y);
    c.rotate(o.ang + (angOff || 0));
    if (o.alpha != null) c.globalAlpha = o.alpha;
    // stalk
    c.strokeStyle = pal.rib; c.lineCap = 'round'; c.lineWidth = Math.max(1, Wd * 0.07);
    c.beginPath(); c.moveTo(-L * 0.16, 0); c.lineTo(M[2][0], M[2][1]); c.stroke();
    for (side = 0; side < 2; side++) {
      var sg = side === 0 ? 1 : -1;
      var lit = side === 0 ? pal.light : pal.mid, deep = side === 0 ? pal.mid : pal.dark;
      var E = [];
      for (i = 0; i <= N; i++) {
        var hw = HW[i] * (1 + g.jit[side][i]);
        E.push([M[i][0] + Nn[i][0] * sg * hw + T[i][0] * hw * 0.36, M[i][1] + Nn[i][1] * sg * hw + T[i][1] * hw * 0.36]);
      }
      for (i = 0; i < N; i++) {
        var g0 = g.tears[side][i] * 0.5, g1 = g.tears[side][i + 1] * 0.5;
        var a0x = E[i][0] + T[i][0] * g0, a0y = E[i][1] + T[i][1] * g0;
        var a1x = E[i + 1][0] - T[i + 1][0] * g1, a1y = E[i + 1][1] - T[i + 1][1] * g1;
        var mx = (M[i][0] + M[i + 1][0]) / 2, my = (M[i][1] + M[i + 1][1]) / 2;
        var gr = c.createLinearGradient(mx, my, (a0x + a1x) / 2, (a0y + a1y) / 2);
        var j = g.shade[side][i];
        gr.addColorStop(0, mix(deep, '#000000', 0.3));
        gr.addColorStop(0.75, j >= 0 ? mix(lit, '#ffffff', j * 0.35) : mix(lit, '#000000', -j));
        gr.addColorStop(1, j >= 0 ? mix(lit, '#ffffff', j * 0.6 + 0.05) : mix(lit, '#000000', -j * 0.6));
        c.fillStyle = gr;
        c.beginPath();
        c.moveTo(M[i][0], M[i][1]); c.lineTo(a0x, a0y); c.lineTo(a1x, a1y); c.lineTo(M[i + 1][0], M[i + 1][1]);
        c.closePath(); c.fill();
      }
    }
    // midrib
    c.fillStyle = pal.rib;
    c.beginPath();
    for (i = 0; i <= N; i++) { var rw = (1 - i / N) * Wd * 0.045 + 0.35; c.lineTo(M[i][0] + Nn[i][0] * rw, M[i][1] + Nn[i][1] * rw); }
    for (i = N; i >= 0; i--) { var rw2 = (1 - i / N) * Wd * 0.045 + 0.35; c.lineTo(M[i][0] - Nn[i][0] * rw2, M[i][1] - Nn[i][1] * rw2); }
    c.closePath(); c.fill();
    c.restore();
  }

  // The banana-leaf wallpaper. Used for the wall around the arch and for page backdrops.
  function leafPattern(c, x0, y0, w, h, opts) {
    opts = opts || {};
    var cell = opts.cell || 92, scale = opts.scale || 1, r = rng(opts.seed || 1985);
    var cols = Math.ceil(w / cell) + 2, rows = Math.ceil(h / cell) + 2;
    for (var yy = 0; yy < rows; yy++) {
      for (var xx = 0; xx < cols; xx++) {
        bananaLeaf(c, {
          x: x0 - cell + (xx + 0.5 + (r() - 0.5) * 0.8) * cell,
          y: y0 - cell + (yy + 0.5 + (r() - 0.5) * 0.8) * cell,
          ang: r() * Math.PI * 2, len: (95 + r() * 70) * scale, wid: (28 + r() * 16) * scale,
          bend: (r() - 0.5) * 0.5, seed: 100 + yy * 97 + xx, segs: 20, alpha: opts.alpha || 0.9
        }, opts.pal || PATTERN);
      }
    }
  }

  /* ---------- the arch ---------- */
  function archPath(c, rr, bottom) {
    c.beginPath();
    c.moveTo(CX - rr, bottom);
    c.lineTo(CX - rr, CY);
    c.arc(CX, CY, rr, Math.PI, Math.PI * 2, false);
    c.lineTo(CX + rr, bottom);
  }
  function clipArch(c) { archPath(c, R, ARCH_FOOT); c.closePath(); c.clip(); }

  /* ---------- back layer: wall, sky, sea ---------- */
  function drawBack(c, th) {
    c.fillStyle = WALL; c.fillRect(-60, -60, BW + 120, BH + 120);
    leafPattern(c, -40, -40, BW + 80, BH + 80, { seed: 1985 });
    var v = c.createRadialGradient(CX, 250, 90, CX, 250, 380);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.45)');
    c.fillStyle = v; c.fillRect(-60, -60, BW + 120, BH + 120);

    c.save();
    clipArch(c);
    var top = CY - R, cel = th.cel;
    var g = c.createLinearGradient(0, top, 0, HORIZON);
    th.sky.forEach(function (s) { g.addColorStop(s[0], s[1]); });
    c.fillStyle = g; c.fillRect(0, top - 2, BW, HORIZON - top + 2);
    var hb = c.createRadialGradient(cel.x, HORIZON, 0, cel.x, HORIZON, 260);
    hb.addColorStop(0, rgba(cel.glow, 0.42)); hb.addColorStop(0.5, rgba(cel.glow, 0.12)); hb.addColorStop(1, rgba(cel.glow, 0));
    c.fillStyle = hb; c.fillRect(0, top, BW, HORIZON - top);
    drawCelestial(c, th);
    var sg = c.createLinearGradient(0, HORIZON, 0, ARCH_FOOT);
    sg.addColorStop(0, th.sea[0]); sg.addColorStop(1, th.sea[1]);
    c.fillStyle = sg; c.fillRect(0, HORIZON, BW, ARCH_FOOT - HORIZON + 2);
    c.save();
    c.translate(cel.x, HORIZON); c.scale(1, 1.9);
    var rc = c.createRadialGradient(0, 0, 0, 0, 0, 36);
    rc.addColorStop(0, rgba(cel.glow, 0.45)); rc.addColorStop(1, rgba(cel.glow, 0));
    c.fillStyle = rc; c.fillRect(-40, 0, 80, 40);
    c.restore();
    c.fillStyle = rgba(cel.glow, 0.55); c.fillRect(CX - R, HORIZON - 0.6, 2 * R, 1.2);
    c.strokeStyle = rgba(th.ink, 0.05); c.lineWidth = 0.8;
    for (var k = 1; k < 9; k++) {
      var wy = HORIZON + Math.pow(k, 1.45) * 2.6;
      c.beginPath(); c.moveTo(CX - R, wy); c.lineTo(CX + R, wy); c.stroke();
    }
    c.restore();
  }

  function drawCelestial(c, o) {
    var th = o; o = o.cel;
    c.save();
    c.beginPath(); c.rect(0, 0, BW, HORIZON); c.clip();
    var gl = c.createRadialGradient(o.x, o.y, o.r * 0.6, o.x, o.y, o.r * 4.2);
    gl.addColorStop(0, rgba(o.glow, 0.55)); gl.addColorStop(1, rgba(o.glow, 0));
    c.fillStyle = gl; c.fillRect(o.x - o.r * 4.5, o.y - o.r * 4.5, o.r * 9, o.r * 9);
    if (o.type === 'crescent') {
      c.beginPath(); c.rect(0, 0, BW, BH);
      c.arc(o.x + o.r * 0.44, o.y - o.r * 0.24, o.r * 0.86, 0, Math.PI * 2);
      c.clip('evenodd');
    }
    var d = c.createRadialGradient(o.x - o.r * 0.3, o.y - o.r * 0.35, o.r * 0.1, o.x, o.y, o.r);
    d.addColorStop(0, '#ffffff'); d.addColorStop(0.55, o.color); d.addColorStop(1, mix(o.color, o.glow, 0.5));
    c.fillStyle = d;
    c.beginPath(); c.arc(o.x, o.y, o.r, 0, Math.PI * 2); c.fill();
    if (o.type === 'moon') {
      c.fillStyle = 'rgba(150,90,110,0.07)';
      [[-0.38, -0.2, 0.24, 0.16, 0.4], [-0.08, -0.32, 0.16, 0.12, -0.3], [0.28, 0.06, 0.2, 0.26, 0.2],
       [-0.2, 0.34, 0.14, 0.1, 0.6], [0.12, 0.44, 0.1, 0.08, 0]].forEach(function (m) {
        c.beginPath(); c.ellipse(o.x + m[0] * o.r, o.y + m[1] * o.r, m[2] * o.r, m[3] * o.r, m[4], 0, Math.PI * 2); c.fill();
      });
    }
    if (o.type === 'sun') {
      c.fillStyle = rgba(th.sky[2][1], 0.38);
      [0.22, 0.46, 0.68].forEach(function (f, i) { c.fillRect(o.x - o.r * 1.4, o.y + o.r * f, o.r * 2.8, 1.4 + i * 0.5); });
    }
    c.restore();
  }

  function starField(th) {
    if (th._stars) return th._stars;
    var r = rng(th.seed), out = [], tries = 0;
    while (out.length < th.stars && tries++ < 3000) {
      var x = CX - R + r() * 2 * R, y = CY - R + 6 + r() * (HORIZON - 70 - (CY - R));
      var dx = x - CX, dy = y - CY;
      if (y < CY && dx * dx + dy * dy > (R - 10) * (R - 10)) continue;
      if (Math.abs(dx) > R - 10) continue;
      var cx = x - th.cel.x, cy = y - th.cel.y;
      if (cx * cx + cy * cy < Math.pow(th.cel.r * 2.6, 2)) continue;
      out.push({ x: x, y: y, r: 0.35 + Math.pow(r(), 3) * 1.15, a: 0.35 + r() * 0.6, ph: r() * 6.28, sp: 0.6 + r() * 1.8 });
    }
    th._stars = out;
    return out;
  }

  // Twinkling stars, an occasional shooting star, light shimmering on the water.
  function drawSkyLife(c, th, t, live) {
    c.save();
    clipArch(c);
    starField(th).forEach(function (s) {
      var tw = live ? 0.62 + 0.38 * Math.sin(t * s.sp + s.ph) : 0.85;
      var a = s.a * tw * clamp((HORIZON - 50 - s.y) / 110, 0, 1);
      if (a <= 0.01) return;
      c.fillStyle = 'rgba(255,250,240,' + a.toFixed(3) + ')';
      c.beginPath(); c.arc(s.x, s.y, s.r, 0, Math.PI * 2); c.fill();
      if (s.r > 1.05) {
        c.strokeStyle = 'rgba(255,250,240,' + (a * 0.55).toFixed(3) + ')'; c.lineWidth = 0.5;
        c.beginPath(); c.moveTo(s.x - s.r * 4, s.y); c.lineTo(s.x + s.r * 4, s.y);
        c.moveTo(s.x, s.y - s.r * 4); c.lineTo(s.x, s.y + s.r * 4); c.stroke();
      }
    });
    if (live) {
      var cyc = t % 41;
      if (cyc > 6 && cyc < 7.1) {
        var p = (cyc - 6) / 1.1, x1 = 110 + p * 150, y1 = 62 + p * 46;
        var sg = c.createLinearGradient(x1 - 46, y1 - 14, x1, y1);
        sg.addColorStop(0, 'rgba(255,255,255,0)'); sg.addColorStop(1, 'rgba(255,255,255,' + (0.85 * (1 - p)).toFixed(3) + ')');
        c.strokeStyle = sg; c.lineWidth = 1.2; c.lineCap = 'round';
        c.beginPath(); c.moveTo(x1 - 46, y1 - 14); c.lineTo(x1, y1); c.stroke();
      }
    }
    var cel = th.cel, rr = rng(th.seed + 7);
    c.lineCap = 'round';
    for (var k = 0; k < 26; k++) {
      var y = HORIZON + 2.5 + Math.pow(k, 1.28) * 1.25;
      if (y > ARCH_FOOT) break;
      var w = 4 + k * 1.9 + rr() * 7;
      var wob = live ? Math.sin(t * 1.4 + k * 0.9) * (1 + k * 0.12) : 0;
      var x = cel.x + (rr() - 0.5) * (6 + k * 2.2) + wob;
      var fl = live ? 0.55 + 0.45 * Math.sin(t * 2.3 + k * 1.7) : 0.8;
      c.strokeStyle = rgba(cel.glow, ((0.62 - k * 0.018) * fl).toFixed(3));
      c.lineWidth = 1 + k * 0.03;
      c.beginPath(); c.moveTo(x - w / 2, y); c.lineTo(x + w / 2, y); c.stroke();
    }
    c.restore();
  }

  /* ---------- palms ---------- */
  function palm(c, color, base, ctrl, crown, fronds, trunkW) {
    c.fillStyle = color; c.strokeStyle = color;
    var n = 18, left = [], right = [], i;
    for (i = 0; i <= n; i++) {
      var s = i / n, u = 1 - s;
      var x = u * u * base[0] + 2 * u * s * ctrl[0] + s * s * crown[0];
      var y = u * u * base[1] + 2 * u * s * ctrl[1] + s * s * crown[1];
      var dx = 2 * u * (ctrl[0] - base[0]) + 2 * s * (crown[0] - ctrl[0]);
      var dy = 2 * u * (ctrl[1] - base[1]) + 2 * s * (crown[1] - ctrl[1]);
      var l = Math.sqrt(dx * dx + dy * dy), w = trunkW * (1 - s * 0.5) / 2;
      left.push([x - dy / l * w, y + dx / l * w]); right.push([x + dy / l * w, y - dx / l * w]);
    }
    c.beginPath();
    left.forEach(function (p, k) { if (k) c.lineTo(p[0], p[1]); else c.moveTo(p[0], p[1]); });
    for (i = right.length - 1; i >= 0; i--) c.lineTo(right[i][0], right[i][1]);
    c.closePath(); c.fill();
    c.lineCap = 'round';
    fronds.forEach(function (f) {
      var a = f[0], len = f[1];
      var dx = Math.cos(a), dy = Math.sin(a);
      var ex = crown[0] + dx * len, ey = crown[1] + dy * len + len * 0.32 * (0.4 + Math.abs(dx));
      var qx = crown[0] + dx * len * 0.55, qy = crown[1] + dy * len * 0.55 - len * 0.16;
      c.lineWidth = 1.8;
      c.beginPath(); c.moveTo(crown[0], crown[1]); c.quadraticCurveTo(qx, qy, ex, ey); c.stroke();
      c.lineWidth = 1.25;
      for (var s = 0.12; s <= 1.0001; s += 0.065) {
        var u = 1 - s;
        var px = u * u * crown[0] + 2 * u * s * qx + s * s * ex, py = u * u * crown[1] + 2 * u * s * qy + s * s * ey;
        var tx = 2 * u * (qx - crown[0]) + 2 * s * (ex - qx), ty = 2 * u * (qy - crown[1]) + 2 * s * (ey - qy);
        var tl = Math.sqrt(tx * tx + ty * ty); tx /= tl; ty /= tl;
        var ll = len * 0.3 * (1 - s * 0.72);
        [-1, 1].forEach(function (sg) {
          var ang = Math.atan2(ty, tx) + sg * 1.1;
          var lx = Math.cos(ang), ly = Math.sin(ang) + 0.55, ln = Math.sqrt(lx * lx + ly * ly);
          c.beginPath(); c.moveTo(px, py); c.lineTo(px + lx / ln * ll, py + ly / ln * ll); c.stroke();
        });
      }
    });
    c.beginPath(); c.arc(crown[0], crown[1], trunkW * 0.55, 0, Math.PI * 2); c.fill();
  }

  /* ---------- the glass-top wicker table ---------- */
  function pole(c, x, y, w, h) {
    var g = c.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, RATTAN.hi); g.addColorStop(0.45, RATTAN.mid); g.addColorStop(1, RATTAN.lo);
    c.fillStyle = g; rrect(c, x, y, w, h, h / 2); c.fill();
    c.strokeStyle = 'rgba(80,46,16,0.6)'; c.lineWidth = 0.7;
    for (var bx = x + 16; bx < x + w - 12; bx += 34) {
      for (var q = 0; q < 4; q++) { c.beginPath(); c.moveTo(bx + q * 1.7, y + 0.6); c.lineTo(bx + q * 1.7 + 2.4, y + h - 0.6); c.stroke(); }
    }
  }
  function weave(c, x, y, w, h) {
    c.save();
    c.beginPath(); c.rect(x, y, w, h); c.clip();
    c.fillStyle = RATTAN.gap; c.fillRect(x, y, w, h);
    var cs = h / 3, cols = Math.ceil(w / cs), half = cs / 2, rows = [];
    for (var j = 0; j < 3; j++) {
      rows.push([0, 1].map(function (k) {
        var sy = y + j * cs + 0.5 + k * half, g = c.createLinearGradient(0, sy, 0, sy + half - 1);
        g.addColorStop(0, RATTAN.hi); g.addColorStop(0.55, RATTAN.mid); g.addColorStop(1, RATTAN.lo);
        return g;
      }));
    }
    for (j = 0; j < 3; j++) {
      for (var i = 0; i < cols; i++) {
        var x0 = x + i * cs, y0 = y + j * cs;
        for (var k = 0; k < 2; k++) {
          if ((i + j) % 2 === 0) {
            c.fillStyle = rows[j][k];
            rrect(c, x0 + 0.3, y0 + 0.5 + k * half, cs - 0.6, half - 1, 1.2); c.fill();
          } else {
            var sx = x0 + 0.5 + k * half, g = c.createLinearGradient(sx, 0, sx + half - 1, 0);
            g.addColorStop(0, RATTAN.hi); g.addColorStop(0.55, RATTAN.mid); g.addColorStop(1, RATTAN.lo);
            c.fillStyle = g; rrect(c, sx, y0 + 0.3, half - 1, cs - 0.6, 1.2); c.fill();
          }
        }
      }
    }
    c.restore();
  }
  function table(c, th) {
    var bl = 26, br = 384, fl = 12, fr = 398;
    c.save();
    c.beginPath(); c.moveTo(bl, TABLE_BACK); c.lineTo(br, TABLE_BACK); c.lineTo(fr, TABLE_FRONT); c.lineTo(fl, TABLE_FRONT); c.closePath();
    c.clip();
    var gg = c.createLinearGradient(0, TABLE_BACK, 0, TABLE_FRONT);
    gg.addColorStop(0, mix(th.sky[th.sky.length - 1][1], th.sea[1], 0.6));
    gg.addColorStop(0.35, mix(th.sea[1], '#000000', 0.2));
    gg.addColorStop(1, mix(th.sea[1], '#000000', 0.55));
    c.fillStyle = gg; c.fillRect(0, TABLE_BACK, BW, TABLE_FRONT - TABLE_BACK);
    c.save();
    c.translate(th.cel.x, TABLE_BACK + 13); c.scale(1, 0.32);
    var rg = c.createRadialGradient(0, 0, 0, 0, 0, 44);
    rg.addColorStop(0, rgba(th.cel.glow, 0.4)); rg.addColorStop(1, rgba(th.cel.glow, 0));
    c.fillStyle = rg; c.fillRect(-44, -44, 88, 88);
    c.restore();
    c.fillStyle = 'rgba(255,255,255,0.05)';
    c.beginPath(); c.moveTo(250, TABLE_BACK); c.lineTo(290, TABLE_BACK); c.lineTo(250, TABLE_FRONT); c.lineTo(205, TABLE_FRONT); c.closePath(); c.fill();
    c.beginPath(); c.moveTo(300, TABLE_BACK); c.lineTo(312, TABLE_BACK); c.lineTo(274, TABLE_FRONT); c.lineTo(260, TABLE_FRONT); c.closePath(); c.fill();
    c.restore();
    c.fillStyle = rgba(th.ink, 0.16); c.fillRect(bl, TABLE_BACK - 0.5, br - bl, 1);
    pole(c, fl, TABLE_FRONT, fr - fl, 7);
    c.fillStyle = 'rgba(160,222,198,0.65)'; c.fillRect(fl + 4, TABLE_FRONT - 1.4, fr - fl - 8, 1.4);
    weave(c, fl + 3, TABLE_FRONT + 7, fr - fl - 6, APRON_BOTTOM - 6 - TABLE_FRONT - 7);
    pole(c, fl + 3, APRON_BOTTOM - 6, fr - fl - 6, 6);
    var es = c.createLinearGradient(fl, 0, fr, 0);
    es.addColorStop(0, 'rgba(0,0,0,0.5)'); es.addColorStop(0.2, 'rgba(0,0,0,0)');
    es.addColorStop(0.8, 'rgba(0,0,0,0)'); es.addColorStop(1, 'rgba(0,0,0,0.5)');
    c.fillStyle = es; c.fillRect(fl, TABLE_FRONT, fr - fl, APRON_BOTTOM - TABLE_FRONT);
    var sh = c.createLinearGradient(0, APRON_BOTTOM, 0, APRON_BOTTOM + 16);
    sh.addColorStop(0, 'rgba(0,0,0,0.65)'); sh.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = sh; c.fillRect(fl, APRON_BOTTOM, fr - fl, 16);
  }

  /* ---------- the cheesecake ---------- */
  function strawberry(c, x, y, s, rot) {
    c.save();
    c.translate(x, y); c.rotate(rot || 0); c.scale(s, s);
    shadow(c, 'rgba(60,0,10,0.45)', 2, 1);
    var g = c.createRadialGradient(-1.6, -1.8, 0.4, 0, 0, 6.5);
    g.addColorStop(0, '#ff7a82'); g.addColorStop(0.45, '#e0293d'); g.addColorStop(1, '#8e0f20');
    c.fillStyle = g;
    c.beginPath(); c.moveTo(0, 6); c.bezierCurveTo(-6.5, 2.5, -6, -4.5, 0, -4); c.bezierCurveTo(6, -4.5, 6.5, 2.5, 0, 6); c.fill();
    noShadow(c);
    c.fillStyle = 'rgba(255,230,140,0.85)';
    [[-2, -1], [1.8, -1.2], [0, 1], [-2.4, 2], [2.2, 2.1], [0, 3.6], [-0.4, -2.4]].forEach(function (p) {
      c.beginPath(); c.ellipse(p[0], p[1], 0.35, 0.55, 0, 0, Math.PI * 2); c.fill();
    });
    c.fillStyle = '#3f8c3c';
    for (var i = 0; i < 4; i++) {
      c.save(); c.translate(0, -4); c.rotate(-1.2 + i * 0.8);
      c.beginPath(); c.moveTo(0, 0); c.quadraticCurveTo(1.2, -1.6, 0, -3.4); c.quadraticCurveTo(-1.2, -1.6, 0, 0); c.fill();
      c.restore();
    }
    c.restore();
  }
  function plate(c, th, x, y) {
    c.fillStyle = 'rgba(0,0,0,0.45)'; ellipse(c, x + 3, y + 5, 74, 15); c.fill();
    c.fillStyle = mix(th.plateDeep, '#000000', 0.25); ellipse(c, x, y + 2.6, 70, 14.5); c.fill();
    var g = c.createRadialGradient(x - 18, y - 6, 4, x, y, 74);
    g.addColorStop(0, mix(th.plate, '#ffffff', 0.55)); g.addColorStop(0.6, th.plate); g.addColorStop(1, th.plateDeep);
    c.fillStyle = g; ellipse(c, x, y, 70, 14.5); c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.55)'; c.lineWidth = 0.8; ellipse(c, x, y - 0.4, 55, 10.6); c.stroke();
    c.strokeStyle = rgba(th.plateDeep, 0.6); c.lineWidth = 0.6; ellipse(c, x, y + 0.3, 55, 10.6); c.stroke();
    // scalloped rim, very 1985
    c.fillStyle = 'rgba(255,255,255,0.35)';
    for (var a = 0; a < Math.PI * 2; a += Math.PI / 14) {
      ellipse(c, x + Math.cos(a) * 64, y + Math.sin(a) * 13.2, 1.3, 0.7); c.fill();
    }
  }
  function cheesecake(c, th) {
    var x = CX, ty = 350, rx = 52, ry = 14, h = 30, by = ty + h;
    var t1 = 28 * Math.PI / 180, t2 = 74 * Math.PI / 180;
    function P(a, yy) { return [x + rx * Math.cos(a), yy + ry * Math.sin(a)]; }
    plate(c, th, x, by + 3);
    c.fillStyle = 'rgba(0,0,0,0.3)'; ellipse(c, x + 2, by + 2, rx + 3, ry + 1); c.fill();

    // the cut face, where a slice has already gone missing
    var p1 = P(t1, ty), p1b = P(t1, by);
    var fg = c.createLinearGradient(x, ty, p1[0], p1[1] + h);
    fg.addColorStop(0, '#fff6dc'); fg.addColorStop(1, '#f1d9a6');
    c.fillStyle = fg;
    c.beginPath(); c.moveTo(x, ty); c.lineTo(p1[0], p1[1]); c.lineTo(p1b[0], p1b[1]); c.lineTo(x, by); c.closePath(); c.fill();
    c.fillStyle = '#b77d3e';
    c.beginPath(); c.moveTo(x, by - 6); c.lineTo(p1b[0], p1b[1] - 6); c.lineTo(p1b[0], p1b[1]); c.lineTo(x, by); c.closePath(); c.fill();
    c.fillStyle = 'rgba(90,50,18,0.55)';
    for (var q = 0; q < 14; q++) { var qs = (q * 0.37) % 1; c.fillRect(x + qs * (p1b[0] - x), by - 5 + ((q * 7) % 5) + qs * (p1b[1] - by), 0.9, 0.9); }
    c.fillStyle = '#c62138';
    c.beginPath(); c.moveTo(x, ty); c.lineTo(p1[0], p1[1]); c.lineTo(p1[0], p1[1] + 3); c.lineTo(x, ty + 3); c.closePath(); c.fill();

    function side(a0, a1) {
      c.beginPath();
      c.ellipse(x, ty, rx, ry, 0, a0, a1, false);
      var pb = P(a1, by); c.lineTo(pb[0], pb[1]);
      c.ellipse(x, by, rx, ry, 0, a1, a0, true);
      c.closePath();
    }
    var sg = c.createLinearGradient(x - rx, 0, x + rx, 0);
    sg.addColorStop(0, '#caa46a'); sg.addColorStop(0.35, '#ecd3a0'); sg.addColorStop(0.7, '#f8e7c0'); sg.addColorStop(1, '#dcbb82');
    var cg = c.createLinearGradient(x - rx, 0, x + rx, 0);
    cg.addColorStop(0, '#7f5124'); cg.addColorStop(0.6, '#b98243'); cg.addColorStop(1, '#94622d');
    [[0, t1], [t2, Math.PI]].forEach(function (seg) {
      c.fillStyle = sg; side(seg[0], seg[1]); c.fill();
      c.save(); side(seg[0], seg[1]); c.clip();
      c.beginPath(); c.ellipse(x, by - 6, rx, ry, 0, 0, Math.PI, false); c.lineTo(x - rx, by + ry + 2); c.lineTo(x + rx, by + ry + 2); c.closePath();
      c.fillStyle = cg; c.fill();
      c.restore();
    });

    // top, then the strawberry glaze
    var tg = c.createRadialGradient(x + 8, ty - 4, 2, x, ty, rx);
    tg.addColorStop(0, '#fff6e2'); tg.addColorStop(1, '#efd7a6');
    c.fillStyle = tg;
    c.beginPath(); c.moveTo(x, ty); c.ellipse(x, ty, rx, ry, 0, t2, t1 + Math.PI * 2, false); c.closePath(); c.fill();
    var gz = c.createRadialGradient(x + 12, ty - 5, 2, x, ty, rx * 0.95);
    gz.addColorStop(0, '#f2606f'); gz.addColorStop(0.55, '#c91f38'); gz.addColorStop(1, '#8c0d22');
    c.fillStyle = gz;
    c.beginPath(); c.moveTo(x, ty + 0.5); c.ellipse(x, ty - 0.4, rx * 0.92, ry * 0.86, 0, t2 + 0.04, t1 - 0.04 + Math.PI * 2, false); c.closePath(); c.fill();
    // drips over the front edge
    c.fillStyle = '#b8172f';
    [0.12, 0.3, 1.45, 1.75, 2.05, 2.4, 2.75].forEach(function (a, i) {
      var p = P(a, ty), len = 4 + ((i * 5) % 7);
      rrect(c, p[0] - 1.7, p[1] - 1.5, 3.4, len, 1.7); c.fill();
      c.beginPath(); c.arc(p[0], p[1] - 1.5 + len - 0.6, 2.1, 0, Math.PI * 2); c.fill();
    });
    c.fillStyle = 'rgba(255,255,255,0.4)';
    c.save(); c.translate(x - 16, ty - 5); c.rotate(-0.12); ellipse(c, 0, 0, 13, 2.2); c.fill(); c.restore();
    c.fillStyle = 'rgba(255,255,255,0.7)'; ellipse(c, x - 22, ty - 5.5, 3, 0.9); c.fill();
    [[200, 0.6, 0.1], [248, 0.62, -0.3], [290, 0.55, 0.4], [328, 0.45, -0.2], [158, 0.42, 0.25], [0, 0, 0.1]]
      .map(function (b) { var a = b[0] * Math.PI / 180; return [x + rx * b[1] * Math.cos(a), ty + ry * b[1] * Math.sin(a) - 3.5, b[2]]; })
      .sort(function (a, b) { return a[1] - b[1]; })
      .forEach(function (b) { strawberry(c, b[0], b[1], 0.92, b[2]); });
  }

  /* ---------- each girl's keepsake ---------- */
  function propShadow(c, w) { c.fillStyle = 'rgba(0,0,0,0.42)'; ellipse(c, PROP_X + 2, 393, w, 4.2); c.fill(); }

  function purse(c, th) {
    var x = PROP_X, base = 392;
    propShadow(c, 23);
    c.lineCap = 'round';
    c.lineWidth = 3.2; c.strokeStyle = RATTAN.lo;
    c.beginPath(); c.moveTo(x - 11, 371); c.bezierCurveTo(x - 12, 350, x + 12, 350, x + 11, 371); c.stroke();
    c.lineWidth = 1.4; c.strokeStyle = RATTAN.hi;
    c.beginPath(); c.moveTo(x - 11, 370); c.bezierCurveTo(x - 12, 351, x + 12, 351, x + 11, 370); c.stroke();
    c.save();
    c.beginPath();
    c.moveTo(x - 15, 370); c.lineTo(x + 15, 370); c.lineTo(x + 18, base - 4);
    c.quadraticCurveTo(x + 18, base, x + 14, base); c.lineTo(x - 14, base); c.quadraticCurveTo(x - 18, base, x - 18, base - 4);
    c.closePath();
    var g = c.createLinearGradient(x - 18, 0, x + 18, 0);
    g.addColorStop(0, RATTAN.lo); g.addColorStop(0.55, RATTAN.hi); g.addColorStop(1, RATTAN.mid);
    c.fillStyle = g; c.fill();
    c.clip();
    c.strokeStyle = 'rgba(96,58,22,0.6)'; c.lineWidth = 0.7;
    for (var d = -30; d < 30; d += 3) {
      c.beginPath(); c.moveTo(x + d, 368); c.lineTo(x + d + 24, base + 2); c.stroke();
      c.beginPath(); c.moveTo(x + d, 368); c.lineTo(x + d - 24, base + 2); c.stroke();
    }
    var sh = c.createLinearGradient(0, 370, 0, base);
    sh.addColorStop(0, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(0,0,0,0.35)');
    c.fillStyle = sh; c.fillRect(x - 20, 368, 40, 26);
    c.restore();
    c.fillStyle = RATTAN.lo; rrect(c, x - 16, 368, 32, 4.4, 2.2); c.fill();
    c.fillStyle = RATTAN.hi; c.fillRect(x - 14, 368.6, 28, 0.9);
    c.fillStyle = metalGrad(c, th, 371, 376); rrect(c, x - 3.2, 371, 6.4, 4.6, 1.2); c.fill();
  }

  function coffee(c, th) {
    var x = PROP_X;
    propShadow(c, 21);
    var sg = c.createLinearGradient(0, 386, 0, 394);
    sg.addColorStop(0, '#f6f3fb'); sg.addColorStop(1, '#a99fc8');
    c.fillStyle = sg; ellipse(c, x, 390, 20, 4.8); c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.7)'; c.lineWidth = 0.6; ellipse(c, x, 389.4, 13, 2.8); c.stroke();
    c.lineWidth = 2.6; c.strokeStyle = '#d9d2ec';
    c.beginPath(); c.ellipse(x + 13.5, 377, 5.2, 5.6, 0, -1.4, 1.5); c.stroke();
    var cg = c.createLinearGradient(x - 13, 0, x + 13, 0);
    cg.addColorStop(0, '#b3a9cf'); cg.addColorStop(0.5, '#fbf9ff'); cg.addColorStop(1, '#cfc7e4');
    c.fillStyle = cg;
    c.beginPath(); c.moveTo(x - 13, 368); c.lineTo(x + 13, 368);
    c.bezierCurveTo(x + 13, 380, x + 10, 388, x + 6, 389); c.lineTo(x - 6, 389);
    c.bezierCurveTo(x - 10, 388, x - 13, 380, x - 13, 368); c.closePath(); c.fill();
    c.fillStyle = mix(th.accent, '#5a4f86', 0.55);
    c.beginPath(); c.moveTo(x - 12.7, 373); c.lineTo(x + 12.7, 373); c.lineTo(x + 12.3, 376); c.lineTo(x - 12.3, 376); c.closePath(); c.fill();
    c.fillStyle = '#efeaf8'; ellipse(c, x, 368, 13, 3.4); c.fill();
    c.fillStyle = '#4a2b18'; ellipse(c, x, 368.4, 11.4, 2.5); c.fill();
    c.fillStyle = 'rgba(255,220,180,0.35)'; ellipse(c, x + 3, 368, 4, 0.8); c.fill();
  }
  function steam(c, t, live) {
    c.save(); c.lineCap = 'round';
    for (var i = 0; i < 3; i++) {
      var x0 = PROP_X - 6 + i * 6, ph = (live ? t * 1.3 : 0) + i * 2.1;
      c.strokeStyle = 'rgba(255,255,255,' + (0.16 + 0.07 * Math.sin(ph)).toFixed(3) + ')';
      c.lineWidth = 2.1 - i * 0.3;
      c.beginPath(); c.moveTo(x0, 365);
      for (var s = 1; s <= 10; s++) c.lineTo(x0 + Math.sin(ph + s * 0.55) * (1.1 + s * 0.38), 365 - s * 3.3);
      c.stroke();
    }
    c.restore();
  }

  function daisy(c, x, y, r, squash, tilt) {
    c.save();
    c.translate(x, y); c.rotate(tilt || 0); c.scale(1, squash);
    shadow(c, 'rgba(0,0,0,0.35)', 3, 1);
    for (var i = 0; i < 14; i++) {
      c.save(); c.rotate(i / 14 * Math.PI * 2);
      c.fillStyle = i % 2 ? '#ffffff' : '#eef0fa';
      ellipse(c, 0, -r * 0.56, r * 0.16, r * 0.48); c.fill();
      c.restore();
    }
    noShadow(c);
    var g = c.createRadialGradient(-r * 0.08, -r * 0.1, 0, 0, 0, r * 0.32);
    g.addColorStop(0, '#fff09a'); g.addColorStop(1, '#e49c22');
    c.fillStyle = g; c.beginPath(); c.arc(0, 0, r * 0.31, 0, Math.PI * 2); c.fill();
    c.restore();
  }
  function daisies(c) {
    var x = PROP_X, base = 392;
    propShadow(c, 15);
    c.strokeStyle = '#4f8f48'; c.lineWidth = 1.4; c.lineCap = 'round';
    c.beginPath(); c.moveTo(x - 1, 366); c.quadraticCurveTo(x - 2, 352, x - 9, 340); c.stroke();
    c.beginPath(); c.moveTo(x + 1, 366); c.quadraticCurveTo(x + 3, 356, x + 10, 348); c.stroke();
    c.fillStyle = '#5c9c4f';
    c.save(); c.translate(x - 3, 355); c.rotate(-0.9); ellipse(c, 0, -3.5, 1.8, 4.2); c.fill(); c.restore();
    c.save();
    c.beginPath();
    c.moveTo(x - 3.2, 362); c.lineTo(x - 3.2, 371);
    c.bezierCurveTo(x - 12.5, 374, x - 12.5, base, x - 6, base); c.lineTo(x + 6, base);
    c.bezierCurveTo(x + 12.5, base, x + 12.5, 374, x + 3.2, 371); c.lineTo(x + 3.2, 362); c.closePath();
    c.fillStyle = 'rgba(190,226,246,0.28)'; c.fill();
    c.strokeStyle = 'rgba(232,246,255,0.6)'; c.lineWidth = 0.8; c.stroke();
    c.clip();
    c.fillStyle = 'rgba(160,210,236,0.28)'; c.fillRect(x - 14, 378, 28, 16);
    c.restore();
    c.strokeStyle = 'rgba(255,255,255,0.65)'; c.lineWidth = 1.1;
    c.beginPath(); c.moveTo(x - 7.5, 377); c.quadraticCurveTo(x - 9.5, 383, x - 7, 389); c.stroke();
    daisy(c, x - 9, 340, 10, 0.78, -0.25);
    daisy(c, x + 10, 348, 8.4, 0.74, 0.3);
  }

  function petal(c, x, y, ang, len, wid, base, tip) {
    c.save(); c.translate(x, y); c.rotate(ang);
    var g = c.createLinearGradient(0, 0, 0, -len);
    g.addColorStop(0, base); g.addColorStop(0.6, tip); g.addColorStop(1, tip);
    c.fillStyle = g;
    c.beginPath(); c.moveTo(0, 0);
    c.bezierCurveTo(wid, -len * 0.25, wid * 0.95, -len * 0.92, 0, -len);
    c.bezierCurveTo(-wid * 0.95, -len * 0.92, -wid, -len * 0.25, 0, 0);
    c.fill();
    c.strokeStyle = 'rgba(190,110,130,0.35)'; c.lineWidth = 0.5; c.stroke();
    c.restore();
  }
  function glossyLeaf(c, x, y, ang, len, wid) {
    c.save(); c.translate(x, y); c.rotate(ang);
    var g = c.createLinearGradient(0, -wid, 0, wid);
    g.addColorStop(0, '#4f8c52'); g.addColorStop(1, '#173d24');
    c.fillStyle = g;
    c.beginPath(); c.moveTo(0, 0); c.quadraticCurveTo(len * 0.45, -wid * 1.25, len, 0); c.quadraticCurveTo(len * 0.45, wid * 1.25, 0, 0); c.fill();
    c.strokeStyle = 'rgba(200,230,160,0.5)'; c.lineWidth = 0.6;
    c.beginPath(); c.moveTo(1, 0); c.lineTo(len - 2, 0); c.stroke();
    c.restore();
  }
  function magnolia(c) {
    var x = PROP_X, y = 385;
    propShadow(c, 30);
    c.save();
    c.translate(x, 392); c.scale(1.28, 1.28); c.translate(-x, -392);
    glossyLeaf(c, x - 4, 389, Math.PI + 0.22, 25, 7);
    glossyLeaf(c, x + 4, 390, -0.16, 23, 6.6);
    shadow(c, 'rgba(60,10,30,0.4)', 4, 1);
    petal(c, x, y, -1.08, 17, 9, '#d98fa3', '#fbe9ec');
    petal(c, x, y, 1.08, 17, 9, '#d98fa3', '#fbe9ec');
    petal(c, x, y, 0, 20, 10, '#e3a0b2', '#fff5f4');
    noShadow(c);
    petal(c, x, y + 2, -0.52, 15, 8.6, '#eab1bf', '#fffaf8');
    petal(c, x, y + 2, 0.52, 15, 8.6, '#eab1bf', '#fffaf8');
    c.fillStyle = '#d6cf7c'; ellipse(c, x, y - 5.5, 2.6, 4.6); c.fill();
    c.fillStyle = 'rgba(140,100,40,0.6)';
    [[-0.8, -7], [0.9, -5.6], [-0.3, -4], [0.4, -8.4]].forEach(function (p) { c.beginPath(); c.arc(x + p[0], y + p[1], 0.45, 0, Math.PI * 2); c.fill(); });
    c.restore();
  }

  var PROPS = { purse: purse, coffee: coffee, daisies: daisies, magnolia: magnolia };

  /* ---------- middle layer: palms, frame, table, cake, words ---------- */
  function keystone(c, th, mg, alpha) {
    var ky = CY - GOLD_OUT;
    c.save();
    c.globalAlpha = alpha;
    c.strokeStyle = mg; c.fillStyle = mg; c.lineCap = 'round'; c.lineWidth = 1.1;
    for (var i = 0; i < 9; i++) {
      var a = Math.PI + 0.22 + i * (Math.PI - 0.44) / 8;
      var r1 = i % 2 ? 9 : 12;
      c.beginPath(); c.moveTo(CX + Math.cos(a) * 4.2, ky + Math.sin(a) * 4.2); c.lineTo(CX + Math.cos(a) * r1, ky + Math.sin(a) * r1); c.stroke();
    }
    c.beginPath(); c.arc(CX, ky, 3.2, Math.PI, Math.PI * 2); c.closePath(); c.fill();
    c.restore();
  }
  function imposts(c, mg) {
    c.fillStyle = mg;
    [-1, 1].forEach(function (s) {
      var x = CX + s * (R + 1);
      c.fillRect(s < 0 ? x - 15 : x, CY - 3, 15, 2.2);
      c.fillRect(s < 0 ? x - 11 : x, CY + 0.6, 11, 1.4);
      c.fillRect(s < 0 ? x - 7 : x, CY + 3.4, 7, 1);
    });
  }
  function drawMid(c, th, live) {
    c.save();
    clipArch(c);
    palm(c, th.silhouette, [54, 384], [64, 340], [94, 286],
      [[-2.65, 52], [-2.1, 56], [-1.62, 40], [-1.08, 52], [-0.55, 58], [0.02, 50], [0.6, 38], [2.95, 44]], 7.5);
    palm(c, th.silhouette, [366, 384], [362, 352], [340, 304],
      [[-2.7, 46], [-2.15, 50], [-1.6, 34], [-1.0, 44], [-0.4, 40], [0.25, 34], [2.75, 40]], 6.2);
    shadow(c, 'rgba(0,0,0,0.6)', 16);
    archPath(c, R + 7, ARCH_FOOT); c.lineWidth = 9; c.strokeStyle = '#000'; c.stroke();
    noShadow(c);
    c.restore();

    var mg = metalGrad(c, th, CY - R - 14, TABLE_BACK);
    archPath(c, R + 6, ARCH_FOOT); c.lineWidth = 12; c.strokeStyle = mix(th.sea[1], WALL, 0.55); c.stroke();
    archPath(c, GOLD_IN, ARCH_FOOT); c.lineWidth = 1.1; c.strokeStyle = mg; c.globalAlpha = 0.8; c.stroke();
    archPath(c, GOLD_OUT, ARCH_FOOT); c.lineWidth = 2.3; c.globalAlpha = live ? 0.2 : 1; c.stroke();
    c.globalAlpha = 1;
    imposts(c, mg);
    keystone(c, th, mg, live ? 0.55 : 1);

    table(c, th);
    cheesecake(c, th);
    PROPS[th.prop](c, th);

    var vg = c.createLinearGradient(0, APRON_BOTTOM + 4, 0, BH);
    vg.addColorStop(0, rgba(WALL, 0)); vg.addColorStop(0.45, rgba(WALL, 0.82)); vg.addColorStop(1, rgba(WALL, 0.92));
    c.fillStyle = vg; c.fillRect(-60, APRON_BOTTOM + 4, BW + 120, BH - APRON_BOTTOM + 60);

    c.textAlign = 'center'; c.textBaseline = 'alphabetic';
    shadow(c, 'rgba(0,0,0,0.85)', 6);
    c.fillStyle = th.ink;
    c.font = 'italic 400 18.5px ' + FONT_DISPLAY;
    c.fillText(live && th.liveLine ? th.liveLine : th.line, CX, 469);
    if (!live) {
      c.fillStyle = th.accent;
      c.font = '500 9px ' + FONT_CAPS;
      var w = tracked(c, th.name.toUpperCase(), CX, 490, 3.4);
      diamond(c, CX - w / 2 - 12, 486.8, 2.2); diamond(c, CX + w / 2 + 12, 486.8, 2.2);
    }
    noShadow(c);
  }

  /* ---------- live layer: seconds, time, fronds ---------- */
  var FRONDS = [
    { x: -34, y: 488, ang: -0.92, len: 205, wid: 52, bend: -0.12, seed: 11, ph: 0.0, segs: 32 },
    { x: 446, y: 494, ang: -2.22, len: 195, wid: 50, bend: 0.12, seed: 23, ph: 1.7, segs: 32 },
    { x: -30, y: 128, ang: -0.62, len: 150, wid: 40, bend: -0.1, seed: 37, ph: 3.1, segs: 28 },
    { x: 442, y: 110, ang: -2.6, len: 140, wid: 38, bend: 0.12, seed: 41, ph: 4.4, segs: 28 }
  ];
  function drawFronds(c, t, live) {
    FRONDS.forEach(function (f) {
      var a = live ? Math.sin(t * 0.85 + f.ph) * 0.022 : 0;
      var b = live ? Math.sin(t * 1.05 + f.ph * 1.3) * 0.025 : 0;
      c.save();
      shadow(c, 'rgba(0,0,0,0.55)', 10, 4);
      bananaLeaf(c, f, FROND, a, b);
      c.restore();
    });
  }

  function pointOnHalf(d, dir) {
    var side = TABLE_BACK - CY;
    if (d <= side) return [CX + dir * GOLD_OUT, TABLE_BACK - d];
    var a = (d - side) / GOLD_OUT, ang = dir < 0 ? Math.PI + a : -a;
    return [CX + GOLD_OUT * Math.cos(ang), CY + GOLD_OUT * Math.sin(ang)];
  }
  // The arch is the second hand: two lines climb from either side and meet at the keystone each minute.
  function drawTrace(c, th, sec) {
    var side = TABLE_BACK - CY, half = side + Math.PI * GOLD_OUT / 2, len = Math.max(0.01, sec / 60 * half);
    var mg = metalGrad(c, th, CY - R - 14, TABLE_BACK);
    c.save();
    c.lineCap = 'round'; c.lineWidth = 3; c.strokeStyle = mg;
    shadow(c, rgba(th.accent, 0.95), 9);
    c.setLineDash([len, half * 2]);
    c.beginPath(); c.moveTo(CX - GOLD_OUT, TABLE_BACK); c.lineTo(CX - GOLD_OUT, CY); c.arc(CX, CY, GOLD_OUT, Math.PI, Math.PI * 1.5, false); c.stroke();
    c.beginPath(); c.moveTo(CX + GOLD_OUT, TABLE_BACK); c.lineTo(CX + GOLD_OUT, CY); c.arc(CX, CY, GOLD_OUT, 0, -Math.PI * 0.5, true); c.stroke();
    c.setLineDash([]);
    [-1, 1].forEach(function (dir) {
      var p = pointOnHalf(len, dir);
      var bg = c.createRadialGradient(p[0], p[1], 0, p[0], p[1], 7);
      bg.addColorStop(0, 'rgba(255,255,255,0.95)'); bg.addColorStop(0.35, rgba(th.accent, 0.7)); bg.addColorStop(1, rgba(th.accent, 0));
      c.fillStyle = bg; c.beginPath(); c.arc(p[0], p[1], 7, 0, Math.PI * 2); c.fill();
    });
    noShadow(c);
    c.restore();
    if (sec < 1.6) {
      var f = 1 - sec / 1.6, ky = CY - GOLD_OUT;
      var kg = c.createRadialGradient(CX, ky, 0, CX, ky, 26);
      kg.addColorStop(0, 'rgba(255,255,255,' + (0.9 * f).toFixed(3) + ')'); kg.addColorStop(0.4, rgba(th.accent, 0.5 * f)); kg.addColorStop(1, rgba(th.accent, 0));
      c.fillStyle = kg; c.beginPath(); c.arc(CX, ky, 26, 0, Math.PI * 2); c.fill();
      keystone(c, th, '#ffffff', f);
    }
  }

  var DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  var MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

  function drawTime(c, th, now) {
    var hh = now.getHours() % 12 || 12, mm = now.getMinutes();
    var str = hh + ':' + (mm < 10 ? '0' : '') + mm;
    c.save();
    c.textAlign = 'center'; c.textBaseline = 'alphabetic';
    shadow(c, 'rgba(0,0,0,0.55)', 8, 1);
    c.fillStyle = rgba(th.ink, 0.96);
    c.font = '400 32px ' + FONT_SCRIPT;
    c.fillText('Picture it:', CX - 4, 97);
    var size = 106;
    c.font = '600 ' + size + 'px ' + FONT_DISPLAY;
    var w = c.measureText(str).width;
    if (w > 300) { size = Math.floor(size * 300 / w); c.font = '600 ' + size + 'px ' + FONT_DISPLAY; }
    shadow(c, 'rgba(0,0,0,0.5)', 14, 4);
    c.fillStyle = metalGrad(c, th, 202 - size * 0.74, 204);
    c.fillText(str, CX, 203);
    noShadow(c);
    c.globalAlpha = 0.35; c.strokeStyle = '#ffffff'; c.lineWidth = 0.6;
    c.strokeText(str, CX, 202.4);
    c.globalAlpha = 1;
    shadow(c, 'rgba(0,0,0,0.7)', 6);
    c.fillStyle = rgba(th.ink, 0.92);
    c.font = '500 12px ' + FONT_CAPS;
    tracked(c, 'MIAMI · ' + DAYS[now.getDay()] + ' ' + MONTHS[now.getMonth()] + ' ' + now.getDate(), CX, 233, 2.8);
    noShadow(c);
    c.restore();
  }

  function cheesecakeLine(now) {
    if (now.getHours() === 0) return 'IT’S CHEESECAKE O’CLOCK';
    var mins = 1440 - (now.getHours() * 60 + now.getMinutes()), h = Math.floor(mins / 60), m = mins % 60;
    return 'CHEESECAKE IN ' + (h ? h + ' HR ' : '') + m + ' MIN';
  }
  function drawCountdown(c, th, now, t, live) {
    var midnight = now.getHours() === 0;
    c.save();
    c.textAlign = 'center';
    shadow(c, midnight ? rgba(th.accent, 0.9) : 'rgba(0,0,0,0.8)', midnight ? 9 + (live ? Math.sin(t * 3) * 4 : 0) : 5);
    c.fillStyle = midnight ? '#ffffff' : th.accent;
    c.font = '500 9px ' + FONT_CAPS;
    var w = tracked(c, cheesecakeLine(now), CX, 490, 2.6);
    c.fillStyle = th.accent;
    diamond(c, CX - w / 2 - 10, 486.8, 2); diamond(c, CX + w / 2 + 10, 486.8, 2);
    noShadow(c);
    c.restore();
  }

  /* ---------- the face object ---------- */
  function Face(canvas, opts) {
    this.canvas = canvas;
    this.theme = THEMES[opts.theme] ? opts.theme : 'blanche';
    this.mode = opts.mode === 'wallpaper' ? 'wallpaper' : 'live';
    this.W = opts.width || BW;
    this.H = opts.height || BH;
    this.ratio = opts.pixelRatio || 1;
    this.motion = opts.motion !== false;
    this.offsetMs = 0;
    this._layers = null;
    this._raf = 0;
    this._t0 = 0;
    this.resize(this.W, this.H, this.ratio);
  }
  Face.prototype.resize = function (w, h, ratio) {
    this.W = w; this.H = h; this.ratio = ratio || this.ratio;
    var pw = Math.round(w * this.ratio), ph = Math.round(h * this.ratio);
    this.canvas.width = pw; this.canvas.height = ph;
    this.k = Math.min(pw / BW, ph / BH);
    this.ox = (pw - BW * this.k) / 2; this.oy = (ph - BH * this.k) / 2;
    this._layers = null;
  };
  Face.prototype._xf = function (c) { c.setTransform(this.k, 0, 0, this.k, this.ox, this.oy); SC = this.k; };
  Face.prototype._build = function () {
    var th = THEMES[this.theme], live = this.mode === 'live';
    var A = document.createElement('canvas'), B = document.createElement('canvas');
    A.width = B.width = this.canvas.width; A.height = B.height = this.canvas.height;
    var a = A.getContext('2d'); this._xf(a); drawBack(a, th);
    var b = B.getContext('2d'); this._xf(b); drawMid(b, th, live);
    this._layers = { A: A, B: B, key: this.theme + '|' + this.mode };
  };
  Face.prototype.set = function (opts) {
    if (opts.theme && THEMES[opts.theme]) this.theme = opts.theme;
    if (opts.mode) this.mode = opts.mode === 'wallpaper' ? 'wallpaper' : 'live';
    if (opts.motion != null) this.motion = !!opts.motion;
    if (opts.offsetMs != null) this.offsetMs = opts.offsetMs;
    this.render();
  };
  // Drop cached layers, e.g. after web fonts finish loading.
  Face.prototype.invalidate = function () { this._layers = null; this.render(); };
  Face.prototype.now = function () { return new Date(Date.now() + this.offsetMs); };
  Face.prototype.render = function (now, t) {
    now = now || this.now();
    t = t == null ? (this._t0 ? (performance.now() - this._t0) / 1000 : 0) : t;
    var th = THEMES[this.theme], live = this.mode === 'live', anim = live && this.motion;
    if (!this._layers || this._layers.key !== this.theme + '|' + this.mode) this._build();
    var c = this.canvas.getContext('2d');
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    c.drawImage(this._layers.A, 0, 0);
    this._xf(c);
    drawSkyLife(c, th, t, anim);
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.drawImage(this._layers.B, 0, 0);
    this._xf(c);
    if (live) {
      drawTrace(c, th, now.getSeconds() + now.getMilliseconds() / 1000);
      drawTime(c, th, now);
    }
    if (th.prop === 'coffee') steam(c, t, anim);
    drawFronds(c, t, anim);
    if (live) drawCountdown(c, th, now, t, anim);
  };
  Face.prototype.start = function () {
    var self = this, last = -1e9;
    if (this._raf) return;
    this._t0 = this._t0 || performance.now();
    function frame(ts) {
      self._raf = requestAnimationFrame(frame);
      var interval = self.mode === 'live' ? (self.motion ? 33 : 250) : 1000;
      if (ts - last < interval) return;
      last = ts;
      self.render();
    }
    this._raf = requestAnimationFrame(frame);
  };
  Face.prototype.stop = function () { cancelAnimationFrame(this._raf); this._raf = 0; };

  function ready() {
    if (typeof document === 'undefined' || !document.fonts || !document.fonts.load) return Promise.resolve();
    return Promise.all([
      document.fonts.load('600 100px Fraunces'),
      document.fonts.load('italic 400 20px Fraunces'),
      document.fonts.load('400 32px "Pinyon Script"'),
      document.fonts.load('500 12px Jost')
    ]).catch(function () {}).then(function () { return document.fonts.ready; });
  }

  // Paints the banana-leaf wallpaper into any canvas (used as a page backdrop).
  function paintPattern(canvas, w, h, ratio) {
    ratio = ratio || 1;
    canvas.width = Math.round(w * ratio); canvas.height = Math.round(h * ratio);
    var c = canvas.getContext('2d');
    c.setTransform(ratio, 0, 0, ratio, 0, 0); SC = ratio;
    c.fillStyle = WALL; c.fillRect(0, 0, w, h);
    leafPattern(c, 0, 0, w, h, { seed: 1922, cell: 150, scale: 1.7, alpha: 0.55 });
  }

  root.CheesecakeFace = {
    THEMES: THEMES,
    ORDER: ORDER,
    SIZE: { width: BW, height: BH },
    create: function (canvas, opts) { return new Face(canvas, opts || {}); },
    ready: ready,
    paintPattern: paintPattern,
    cheesecakeLine: cheesecakeLine
  };
})(typeof window !== 'undefined' ? window : this);
