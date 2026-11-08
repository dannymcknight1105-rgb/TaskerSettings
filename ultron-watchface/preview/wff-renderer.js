/*
 * wff-renderer.js - a small Watch Face Format (WFF) renderer for the browser.
 *
 * It draws the real res/raw/watchface.xml onto a <canvas> so the face can be
 * previewed and screenshotted without a watch. It implements the subset of WFF
 * that the J.A.R.V.I.S. HUD face uses: Group / PartDraw / PartText / PartImage,
 * Arc / Line / Ellipse / Rectangle / RoundRectangle, gradients, Text and
 * TextCircular, Template / Upper / OutGlow, Transform / Variant / Gyro / Launch,
 * Condition, List / Boolean / Color configurations, DigitalClock, AnalogClock and
 * ComplicationSlot. It is a preview tool, not a reference implementation.
 */
(function (global) {
  'use strict';

  // ------------------------------------------------------------- helpers --
  const rad = (d) => (d * Math.PI) / 180;
  const num = (v, d) => (v === undefined || v === null || v === '' ? d : Number(v));

  function parseColor(c) {
    if (!c) return { r: 255, g: 255, b: 255, a: 1 };
    const h = c.replace('#', '');
    if (h.length === 8) {
      return { a: parseInt(h.slice(0, 2), 16) / 255, r: parseInt(h.slice(2, 4), 16),
        g: parseInt(h.slice(4, 6), 16), b: parseInt(h.slice(6, 8), 16) };
    }
    return { a: 1, r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
  }
  const cssColor = (o) => `rgba(${o.r},${o.g},${o.b},${o.a.toFixed(3)})`;

  // --------------------------------------------------------- expressions --
  const TOKEN = /\s*(?:(\d+(?:\.\d+)?)|("[^"]*")|(\[[A-Za-z0-9_.]+\])|([a-zA-Z][a-zA-Z0-9_.]*)|(<=|>=|==|!=|&&|\|\||[-+*/%~!&|<>?:,()]))/y;

  function tokenize(src) {
    const out = [];
    TOKEN.lastIndex = 0;
    let m;
    while (TOKEN.lastIndex < src.length) {
      const at = TOKEN.lastIndex;
      m = TOKEN.exec(src);
      if (!m) {
        if (/^\s*$/.test(src.slice(at))) break;
        throw new Error('Bad expression near "' + src.slice(at, at + 12) + '" in ' + src);
      }
      if (m[1] !== undefined) out.push({ t: 'num', v: Number(m[1]) });
      else if (m[2] !== undefined) out.push({ t: 'str', v: m[2].slice(1, -1) });
      else if (m[3] !== undefined) out.push({ t: 'src', v: m[3].slice(1, -1) });
      else if (m[4] !== undefined) out.push({ t: 'word', v: m[4] });
      else out.push({ t: 'op', v: m[5] });
    }
    return out;
  }

  const FUNCS = {
    round: Math.round, floor: Math.floor, ceil: Math.ceil, fract: (x) => x - Math.floor(x),
    sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan,
    abs: Math.abs, clamp: (v, a, b) => Math.min(Math.max(v, a), b), rand: (a, b) => a + Math.random() * (b - a),
    log: Math.log, log2: Math.log2, log10: Math.log10, sqrt: Math.sqrt, cbrt: Math.cbrt, exp: Math.exp,
    expm1: Math.expm1, deg: (r) => (r * 180) / Math.PI, rad: (d) => (d * Math.PI) / 180, pow: Math.pow,
    numberFormat: (fmt, v) => numberFormat(String(fmt), Number(v)),
    textLength: (s) => String(s).length,
    subText: (s, a, b) => String(s).substring(a, b),
    icuText: (f) => String(f), icuBestText: (f) => String(f),
  };

  function numberFormat(fmt, v) {
    const decimals = fmt.includes('.') ? fmt.split('.')[1].replace(/[^#0]/g, '').length : 0;
    const grouping = fmt.split('.')[0].includes(',');
    return v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: decimals, useGrouping: grouping });
  }

  const toNum = (v) => (typeof v === 'boolean' ? (v ? 1 : 0) : typeof v === 'string' && v.trim() !== '' && !isNaN(v) ? Number(v) : v);

  function compile(src) {
    const toks = tokenize(String(src));
    let i = 0;
    const peek = () => toks[i];
    const isOp = (v) => toks[i] && toks[i].t === 'op' && toks[i].v === v;
    const eat = (v) => { if (!isOp(v)) throw new Error('Expected ' + v + ' in ' + src); i++; };

    function ternary() {
      const c = or();
      if (isOp('?')) { i++; const a = ternary(); eat(':'); const b = ternary(); return (e) => (truthy(c(e)) ? a(e) : b(e)); }
      return c;
    }
    const bin = (next, ops, f) => () => {
      let l = next();
      while (toks[i] && toks[i].t === 'op' && ops.includes(toks[i].v)) {
        const op = toks[i++].v; const r = next(); const ll = l;
        l = (e) => f(op, ll(e), r(e));
      }
      return l;
    };
    const mul = bin(unary, ['*', '/', '%'], (op, a, b) => {
      a = toNum(a); b = toNum(b);
      if (op === '*') return a * b;
      if (op === '/') return b === 0 ? 0 : a / b;
      return b === 0 ? 0 : a % b;
    });
    const add = bin(mul, ['+', '-'], (op, a, b) => {
      if (op === '+') return typeof a === 'string' || typeof b === 'string' ? String(a) + String(b) : toNum(a) + toNum(b);
      return toNum(a) - toNum(b);
    });
    const rel = bin(add, ['<', '<=', '>', '>='], (op, a, b) => {
      a = toNum(a); b = toNum(b);
      return op === '<' ? a < b : op === '<=' ? a <= b : op === '>' ? a > b : a >= b;
    });
    // eslint-disable-next-line eqeqeq
    const eq = bin(rel, ['==', '!='], (op, a, b) => (op === '==' ? toNum(a) == toNum(b) : toNum(a) != toNum(b)));
    const band = bin(eq, ['&'], (op, a, b) => toNum(a) & toNum(b));
    const bor = bin(band, ['|'], (op, a, b) => toNum(a) | toNum(b));
    const and = bin(bor, ['&&'], (op, a, b) => truthy(a) && truthy(b));
    const or = bin(and, ['||'], (op, a, b) => truthy(a) || truthy(b));

    function unary() {
      if (isOp('-')) { i++; const u = unary(); return (e) => -toNum(u(e)); }
      if (isOp('+')) { i++; return unary(); }
      if (isOp('!')) { i++; const u = unary(); return (e) => !truthy(u(e)); }
      if (isOp('~')) { i++; const u = unary(); return (e) => ~toNum(u(e)); }
      return primary();
    }
    function primary() {
      const t = peek();
      if (!t) throw new Error('Unexpected end of ' + src);
      if (isOp('(')) { i++; const x = ternary(); eat(')'); return x; }
      i++;
      if (t.t === 'num') return () => t.v;
      if (t.t === 'str') return () => t.v;
      if (t.t === 'src') return (e) => e.source(t.v);
      if (t.t === 'word') {
        if (/^(true|TRUE|True)$/.test(t.v)) return () => true;
        if (/^(false|FALSE|False)$/.test(t.v)) return () => false;
        if (isOp('(')) {
          i++;
          const args = [];
          if (!isOp(')')) { args.push(ternary()); while (isOp(',')) { i++; args.push(ternary()); } }
          eat(')');
          const fn = FUNCS[t.v];
          if (!fn) throw new Error('Unknown function ' + t.v);
          return (e) => fn(...args.map((a) => (t.v === 'numberFormat' || t.v === 'subText' || t.v === 'textLength' ? a(e) : toNum(a(e)))));
        }
        return (e) => e.string(t.v);
      }
      throw new Error('Unexpected token ' + t.v + ' in ' + src);
    }
    const fn = ternary();
    if (i < toks.length) throw new Error('Trailing tokens in ' + src);
    return fn;
  }

  function truthy(v) {
    if (typeof v === 'string') return v !== '' && v !== '0' && v.toLowerCase() !== 'false';
    return !!v;
  }

  const exprCache = new Map();
  function evaluate(src, env) {
    let f = exprCache.get(src);
    if (!f) { f = compile(src); exprCache.set(src, f); }
    return f(env);
  }

  function sprintf(fmt, args) {
    let k = 0;
    return fmt.replace(/%(%|-?\d*(?:\.(\d+))?[sdfx])/g, (all, spec, prec) => {
      if (spec === '%') return '%';
      const v = args[k++];
      const type = spec[spec.length - 1];
      const width = /^0\d+/.test(spec) ? parseInt(spec, 10) : 0;
      if (type === 'd') {
        const n = Math.trunc(Number(toNum(v)) || 0);
        return (n < 0 ? '-' : '') + String(Math.abs(n)).padStart(width, '0');
      }
      if (type === 'f') return Number(toNum(v)).toFixed(prec !== undefined ? Number(prec) : 6);
      if (type === 'x') return Math.trunc(Number(v)).toString(16);
      if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 1000) / 1000);
      return String(v);
    });
  }

  // ------------------------------------------------------------ time data --
  const DOW_S = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const DOW_F = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MON_S = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MON_F = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const pad = (n) => String(n).padStart(2, '0');

  function timeParts(date, tz) {
    if (!tz) {
      return { y: date.getFullYear(), mo: date.getMonth() + 1, d: date.getDate(), h: date.getHours(),
        mi: date.getMinutes(), s: date.getSeconds(), ms: date.getMilliseconds(), dow: date.getDay() };
    }
    const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23', weekday: 'short' });
    const o = {};
    for (const p of f.formatToParts(date)) o[p.type] = p.value;
    return { y: +o.year, mo: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute, s: +o.second,
      ms: date.getMilliseconds(), dow: DOW_S.indexOf(o.weekday) };
  }

  function moon(date) {
    const synodic = 29.530588853;
    const ref = Date.UTC(2000, 0, 6, 18, 14);
    let age = ((date.getTime() - ref) / 86400000) % synodic;
    if (age < 0) age += synodic;
    const names = [[0.5, 0, 'New Moon'], [6.5, 1, 'Evening Crescent'], [7.5, 2, 'First Quarter'], [13.5, 3, 'Waxing Gibbous'],
      [14.5, 4, 'Full Moon'], [20.5, 5, 'Waning Gibbous'], [21.5, 6, 'Last Quarter'], [27.5, 7, 'Morning Crescent'], [99, 0, 'New Moon']];
    const hit = names.find((n) => age < n[0]);
    return { position: Math.min(28, Math.floor(age)), type: hit[1], name: hit[2] };
  }

  function isoWeek(y, m, d) {
    const t = new Date(Date.UTC(y, m - 1, d));
    const day = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - day);
    const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    return Math.ceil(((t - y0) / 86400000 + 1) / 7);
  }

  function makeSources(state, tz) {
    const p = timeParts(state.time, tz);
    const d = state.data;
    const h12 = p.h % 12 === 0 ? 12 : p.h % 12;
    const start = new Date(p.y, 0, 1);
    const doy = Math.round((new Date(p.y, p.mo - 1, p.d) - start) / 86400000) + 1;
    const mn = moon(state.time);
    const stepPct = Math.max(0, Math.min(100, Math.round((d.steps / Math.max(1, d.stepGoal)) * 100)));
    return {
      UTC_TIMESTAMP: state.time.getTime(), MILLISECOND: p.ms, SECOND: p.s, SECOND_Z: pad(p.s),
      SECOND_MILLISECOND: p.s + p.ms / 1000, SECONDS_IN_DAY: p.h * 3600 + p.mi * 60 + p.s,
      SECOND_TENS_DIGIT: Math.floor(p.s / 10), SECOND_UNITS_DIGIT: p.s % 10,
      MINUTE: p.mi, MINUTE_Z: pad(p.mi), MINUTE_SECOND: p.mi + p.s / 60,
      MINUTE_TENS_DIGIT: Math.floor(p.mi / 10), MINUTE_UNITS_DIGIT: p.mi % 10,
      HOUR_0_11: p.h % 12, HOUR_0_11_Z: pad(p.h % 12), HOUR_1_12: h12, HOUR_1_12_Z: pad(h12),
      HOUR_0_23: p.h, HOUR_0_23_Z: pad(p.h), HOUR_1_24: p.h === 0 ? 24 : p.h, HOUR_1_24_Z: pad(p.h === 0 ? 24 : p.h),
      HOUR_0_11_MINUTE: (p.h % 12) + p.mi / 60, HOUR_1_12_MINUTE: h12 + p.mi / 60, HOUR_0_23_MINUTE: p.h + p.mi / 60,
      HOUR_TENS_DIGIT: Math.floor(p.h / 10), HOUR_UNITS_DIGIT: p.h % 10,
      DAY: p.d, DAY_Z: pad(p.d), DAY_OF_YEAR: doy, DAY_OF_WEEK: p.dow + 1, DAY_OF_WEEK_S: DOW_S[p.dow],
      DAY_OF_WEEK_F: DOW_F[p.dow], MONTH: p.mo, MONTH_Z: pad(p.mo), MONTH_S: MON_S[p.mo - 1], MONTH_F: MON_F[p.mo - 1],
      YEAR: p.y, YEAR_S: String(p.y).slice(2), WEEK_IN_YEAR: isoWeek(p.y, p.mo, p.d),
      DAYS_IN_MONTH: new Date(p.y, p.mo, 0).getDate(), IS_24_HOUR_MODE: !!state.is24h,
      AMPM_STATE: p.h < 12 ? 0 : 1, AMPM_STRING: p.h < 12 ? 'AM' : 'PM', AMPM_STRING_ENG: p.h < 12 ? 'AM' : 'PM',
      MOON_PHASE_POSITION: mn.position, MOON_PHASE_TYPE: mn.type, MOON_PHASE_TYPE_STRING: mn.name,
      BATTERY_PERCENT: d.battery, BATTERY_CHARGING_STATUS: !!d.charging, BATTERY_IS_LOW: !d.charging && d.battery <= 15,
      BATTERY_TEMPERATURE_CELSIUS: d.coreTemp, BATTERY_TEMPERATURE_FAHRENHEIT: d.coreTemp * 1.8 + 32,
      STEP_COUNT: d.steps, STEP_GOAL: d.stepGoal, STEP_PERCENT: stepPct,
      HEART_RATE: d.heartRate, HEART_RATE_Z: pad(d.heartRate), UNREAD_NOTIFICATION_COUNT: d.notifications,
      ACCELEROMETER_IS_SUPPORTED: true, ACCELEROMETER_ANGLE_X: state.tilt ? state.tilt.x : 0,
      ACCELEROMETER_ANGLE_Y: state.tilt ? state.tilt.y : 0,
      'WEATHER.IS_AVAILABLE': !!d.weather, 'WEATHER.IS_ERROR': false, 'WEATHER.TEMPERATURE': d.temp,
      'WEATHER.TEMPERATURE_UNIT': d.unit, 'WEATHER.CONDITION_NAME': d.condition, 'WEATHER.CONDITION': 0,
      'WEATHER.DAY_TEMPERATURE_HIGH': d.hi, 'WEATHER.DAY_TEMPERATURE_LOW': d.lo,
      'WEATHER.CHANCE_OF_PRECIPITATION': d.precip, 'WEATHER.UV_INDEX': d.uv, 'WEATHER.IS_DAY': p.h >= 7 && p.h < 18,
    };
  }

  // ------------------------------------------------------------ renderer --
  const FONT_MAP = {
    orbitron_bold: (s) => `700 ${s}px Orbitron, "Arial Black", sans-serif`,
    orbitron_medium: (s) => `500 ${s}px Orbitron, Arial, sans-serif`,
    share_tech_mono: (s) => `400 ${s}px "Share Tech Mono", "Courier New", monospace`,
    oxanium_extrabold: (s) => `800 ${s}px Oxanium, "Arial Black", sans-serif`,
    oxanium_semibold: (s) => `600 ${s}px Oxanium, Arial, sans-serif`,
    black_ops_one: (s) => `400 ${s}px "Black Ops One", Impact, sans-serif`,
    SYNC_TO_DEVICE: (s) => `400 ${s}px Roboto, "Segoe UI", sans-serif`,
  };

  class WatchFace {
    constructor(xmlText, images) {
      const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
      const err = doc.querySelector('parsererror');
      if (err) throw new Error('watchface.xml failed to parse: ' + err.textContent);
      this.root = doc.documentElement;
      this.width = num(this.root.getAttribute('width'), 450);
      this.height = num(this.root.getAttribute('height'), 450);
      this.scene = this.root.querySelector(':scope > Scene');
      this.images = images || {};
      this.tintCache = new Map();
      this.configs = this.readConfigs();
    }

    readConfigs() {
      const out = {};
      const uc = this.root.querySelector(':scope > UserConfigurations');
      if (!uc) return out;
      for (const c of uc.children) {
        const id = c.getAttribute('id');
        const entry = { kind: c.tagName, id, defaultValue: c.getAttribute('defaultValue'), options: [] };
        for (const o of c.children) {
          entry.options.push({ id: o.getAttribute('id'), displayName: o.getAttribute('displayName'),
            colors: o.getAttribute('colors') ? o.getAttribute('colors').split(/\s+/) : null });
        }
        out[id] = entry;
      }
      return out;
    }

    // resolve "[CONFIGURATION.x.N]" / "#AARRGGBB"
    color(value, env) {
      if (!value) return { r: 255, g: 255, b: 255, a: 1 };
      if (value[0] === '[') {
        const v = env.source(value.slice(1, -1));
        return parseColor(String(v));
      }
      return parseColor(value);
    }

    render(ctx, state) {
      const self = this;
      const taps = [];
      const env = {
        state,
        tz: null,
        complication: null,
        source(name) {
          if (name.startsWith('CONFIGURATION.')) {
            const [, id, idx] = name.split('.');
            const cfg = self.configs[id];
            const val = state.config[id] !== undefined ? state.config[id] : cfg && cfg.defaultValue;
            if (cfg && cfg.kind === 'ColorConfiguration') {
              const opt = cfg.options.find((o) => o.id === String(val)) || cfg.options[0];
              return opt.colors[idx !== undefined ? Number(idx) : 0];
            }
            return val;
          }
          if (name.startsWith('COMPLICATION.')) {
            const c = this.complication || {};
            return c[name.slice(13)] !== undefined ? c[name.slice(13)] : '';
          }
          if (!this._src || this._srcTz !== this.tz) { this._src = makeSources(state, this.tz); this._srcTz = this.tz; }
          const v = this._src[name];
          return v === undefined ? 0 : v;
        },
        string(name) { return name; },
      };
      this.env = env;
      env.taps = taps;
      ctx.save();
      const bg = this.scene.getAttribute('backgroundColor');
      ctx.fillStyle = cssColor(parseColor(bg || '#FF000000'));
      ctx.fillRect(0, 0, this.width, this.height);
      if ((this.root.getAttribute('clipShape') || 'CIRCLE') === 'CIRCLE') {
        ctx.beginPath();
        ctx.ellipse(this.width / 2, this.height / 2, this.width / 2, this.height / 2, 0, 0, Math.PI * 2);
        ctx.clip();
      }
      this.children(ctx, this.scene, env, taps);
      ctx.restore();
      return { taps };
    }

    children(ctx, el, env, taps) {
      for (const c of el.children) this.node(ctx, c, env, taps);
    }

    node(ctx, el, env, taps) {
      switch (el.tagName) {
        case 'Group': return this.group(ctx, el, env, taps);
        case 'PartDraw': return this.part(ctx, el, env, taps, () => this.drawShapes(ctx, el, env));
        case 'PartText': return this.part(ctx, el, env, taps, (g) => this.drawText(ctx, el, env, g));
        case 'PartImage': return this.part(ctx, el, env, taps, (g) => this.drawImage(ctx, el, env, g));
        case 'PartAnimatedImage': return this.part(ctx, el, env, taps, (g) => this.drawAnimated(ctx, el, env, g));
        case 'Condition': return this.condition(ctx, el, env, taps);
        case 'ListConfiguration': return this.listConfig(ctx, el, env, taps);
        case 'BooleanConfiguration': return this.boolConfig(ctx, el, env, taps);
        case 'DigitalClock': return this.digitalClock(ctx, el, env, taps);
        case 'AnalogClock': return this.analogClock(ctx, el, env, taps);
        case 'ComplicationSlot': return this.complicationSlot(ctx, el, env, taps);
        default: return undefined;
      }
    }

    // geometry of a Group / Part with Transform, Variant and Gyro applied
    geometry(el, env) {
      const a = (n, d) => num(el.getAttribute(n), d);
      const g = { x: a('x', 0), y: a('y', 0), width: a('width', 0), height: a('height', 0), angle: a('angle', 0),
        alpha: a('alpha', 255), scaleX: a('scaleX', 1), scaleY: a('scaleY', 1), pivotX: a('pivotX', 0.5), pivotY: a('pivotY', 0.5) };
      for (const c of el.children) {
        if (c.tagName === 'Transform') g[c.getAttribute('target')] = Number(toNum(evaluate(c.getAttribute('value'), env)));
        else if (c.tagName === 'Variant' && env.state.ambient && c.getAttribute('mode') === 'AMBIENT') {
          g[c.getAttribute('target')] = Number(evaluate(c.getAttribute('value'), env));
        } else if (c.tagName === 'Gyro') {
          if (c.getAttribute('x')) g.x += Number(evaluate(c.getAttribute('x'), env));
          if (c.getAttribute('y')) g.y += Number(evaluate(c.getAttribute('y'), env));
        }
      }
      return g;
    }

    applyGeometry(ctx, g) {
      ctx.translate(g.x, g.y);
      if (g.angle || g.scaleX !== 1 || g.scaleY !== 1) {
        const px = g.pivotX * g.width;
        const py = g.pivotY * g.height;
        ctx.translate(px, py);
        ctx.rotate(rad(g.angle));
        ctx.scale(g.scaleX, g.scaleY);
        ctx.translate(-px, -py);
      }
      ctx.globalAlpha *= Math.max(0, Math.min(1, g.alpha / 255));
    }

    recordTap(ctx, el, g, taps) {
      const l = Array.from(el.children).find((c) => c.tagName === 'Launch');
      if (!l) return;
      const m = ctx.getTransform();
      const pts = [[0, 0], [g.width, 0], [g.width, g.height], [0, g.height]].map(([x, y]) => new DOMPoint(x, y).matrixTransform(m));
      taps.push({ target: l.getAttribute('target'), name: el.getAttribute('name'), points: pts });
    }

    group(ctx, el, env, taps) {
      const g = this.geometry(el, env);
      if (g.alpha <= 0) return;
      ctx.save();
      this.applyGeometry(ctx, g);
      this.recordTap(ctx, el, g, taps);
      this.children(ctx, el, env, taps);
      ctx.restore();
    }

    part(ctx, el, env, taps, draw) {
      const g = this.geometry(el, env);
      if (g.alpha <= 0) return;
      ctx.save();
      this.applyGeometry(ctx, g);
      this.recordTap(ctx, el, g, taps);
      draw(g);
      ctx.restore();
    }

    condition(ctx, el, env, taps) {
      const exprs = {};
      const ex = Array.from(el.children).find((c) => c.tagName === 'Expressions');
      if (ex) for (const e of ex.children) exprs[e.getAttribute('name')] = e.textContent;
      for (const c of el.children) {
        if (c.tagName === 'Compare') {
          const src = exprs[c.getAttribute('expression')];
          if (src !== undefined && truthy(evaluate(src, env))) { this.children(ctx, c, env, taps); return; }
        }
      }
      const d = Array.from(el.children).find((c) => c.tagName === 'Default');
      if (d) this.children(ctx, d, env, taps);
    }

    configValue(id, env) {
      const v = env.state.config[id];
      if (v !== undefined) return String(v);
      return this.configs[id] ? String(this.configs[id].defaultValue) : undefined;
    }

    listConfig(ctx, el, env, taps) {
      const val = this.configValue(el.getAttribute('id'), env);
      for (const o of el.children) if (o.getAttribute('id') === val) this.children(ctx, o, env, taps);
    }

    boolConfig(ctx, el, env, taps) {
      let val = this.configValue(el.getAttribute('id'), env);
      val = val === 'true' || val === 'TRUE' ? 'TRUE' : 'FALSE';
      for (const o of el.children) if (o.getAttribute('id') === val) this.children(ctx, o, env, taps);
    }

    // ---------------------------------------------------------- shapes --
    shapeProps(el, env) {
      const p = {};
      for (const at of el.attributes) p[at.name] = at.value;
      for (const c of el.children) {
        if (c.tagName === 'Transform') p[c.getAttribute('target')] = String(toNum(evaluate(c.getAttribute('value'), env)));
      }
      return p;
    }

    paint(ctx, styleEl, env) {
      const color = this.color(styleEl.getAttribute('color'), env);
      let paint = cssColor(color);
      for (const c of styleEl.children) {
        const cols = (c.getAttribute('colors') || '').split(/\s+/).filter(Boolean).map((v) => cssColor(this.color(v, env)));
        const pos = (c.getAttribute('positions') || '').split(/\s+/).filter(Boolean).map(Number);
        const a = (n) => num(c.getAttribute(n), 0);
        let grad = null;
        if (c.tagName === 'LinearGradient') grad = ctx.createLinearGradient(a('startX'), a('startY'), a('endX'), a('endY'));
        else if (c.tagName === 'RadialGradient') grad = ctx.createRadialGradient(a('centerX'), a('centerY'), 0, a('centerX'), a('centerY'), a('radius'));
        else if (c.tagName === 'SweepGradient') {
          const s = a('startAngle');
          let e = a('endAngle');
          if (e <= s) e += 360;
          grad = ctx.createConicGradient(rad(s - 90), a('centerX'), a('centerY'));
          const span = (e - s) / 360;
          cols.forEach((col, k) => grad.addColorStop(Math.min(1, (pos[k] !== undefined ? pos[k] : k / (cols.length - 1)) * span), col));
          if (span < 1) grad.addColorStop(1, cols[cols.length - 1]);
          paint = grad;
          continue;
        }
        if (grad) {
          cols.forEach((col, k) => grad.addColorStop(pos[k] !== undefined ? pos[k] : k / (cols.length - 1), col));
          paint = grad;
        }
      }
      return paint;
    }

    stroke(ctx, el, env) {
      const s = Array.from(el.children).find((c) => c.tagName === 'Stroke');
      if (!s) return;
      ctx.strokeStyle = this.paint(ctx, s, env);
      ctx.lineWidth = num(s.getAttribute('thickness'), 1);
      ctx.lineCap = (s.getAttribute('cap') || 'BUTT').toLowerCase();
      const dash = s.getAttribute('dashIntervals');
      ctx.setLineDash(dash ? dash.trim().split(/\s+/).map(Number) : []);
      ctx.lineDashOffset = num(s.getAttribute('dashPhase'), 0);
      ctx.stroke();
    }

    fill(ctx, el, env) {
      const f = Array.from(el.children).find((c) => c.tagName === 'Fill');
      if (!f) return;
      ctx.fillStyle = this.paint(ctx, f, env);
      ctx.fill();
    }

    drawShapes(ctx, partEl, env) {
      for (const el of partEl.children) {
        const p = this.shapeProps(el, env);
        const n = (k) => Number(p[k]);
        ctx.beginPath();
        if (el.tagName === 'Arc') {
          const s = n('startAngle');
          const e = n('endAngle');
          const ccw = p.direction === 'COUNTER_CLOCKWISE';
          let sweep = ccw ? s - e : e - s;
          if (Math.abs(sweep) >= 360) sweep = 360;
          else sweep = ((sweep % 360) + 360) % 360;
          if (sweep <= 0.001) continue;
          const a0 = rad(s - 90);
          const a1 = rad((ccw ? s - sweep : s + sweep) - 90);
          ctx.ellipse(n('centerX'), n('centerY'), n('width') / 2, n('height') / 2, 0, a0, a1, ccw);
          this.stroke(ctx, el, env);
        } else if (el.tagName === 'Line') {
          ctx.moveTo(n('startX'), n('startY'));
          ctx.lineTo(n('endX'), n('endY'));
          this.stroke(ctx, el, env);
        } else if (el.tagName === 'Ellipse') {
          ctx.ellipse(n('x') + n('width') / 2, n('y') + n('height') / 2, n('width') / 2, n('height') / 2, 0, 0, Math.PI * 2);
          this.fill(ctx, el, env);
          this.stroke(ctx, el, env);
        } else if (el.tagName === 'Rectangle') {
          ctx.rect(n('x'), n('y'), n('width'), n('height'));
          this.fill(ctx, el, env);
          this.stroke(ctx, el, env);
        } else if (el.tagName === 'RoundRectangle') {
          ctx.roundRect(n('x'), n('y'), n('width'), n('height'), [n('cornerRadiusX')]);
          this.fill(ctx, el, env);
          this.stroke(ctx, el, env);
        }
      }
    }

    // ------------------------------------------------------------ text --
    textContent(node, env, out) {
      for (const c of node.childNodes) {
        if (c.nodeType === 3) out.text += c.nodeValue;
        else if (c.nodeType === 1) {
          if (c.tagName === 'Template') {
            let fmt = '';
            const params = [];
            for (const t of c.childNodes) {
              if (t.nodeType === 3) fmt += t.nodeValue;
              else if (t.tagName === 'Parameter') params.push(evaluate(t.getAttribute('expression'), env));
            }
            out.text += sprintf(fmt.trim(), params);
          } else if (c.tagName === 'Upper' || c.tagName === 'Lower') {
            const inner = { text: '' };
            this.textContent(c, env, inner);
            out.text += c.tagName === 'Upper' ? inner.text.toUpperCase() : inner.text.toLowerCase();
          } else if (c.tagName === 'OutGlow') {
            out.glow = { color: c.getAttribute('color'), radius: num(c.getAttribute('radius'), 8) };
            this.textContent(c, env, out);
          } else this.textContent(c, env, out);
        }
      }
      return out;
    }

    fontSpec(f, env) {
      const fam = f.getAttribute('family');
      const size = num(f.getAttribute('size'), 16);
      return { css: (FONT_MAP[fam] || FONT_MAP.SYNC_TO_DEVICE)(size), size,
        color: this.color(f.getAttribute('color') || '#FFFFFFFF', env),
        spacing: num(f.getAttribute('letterSpacing'), 0) * size };
    }

    drawText(ctx, el, env, g) {
      const t = Array.from(el.children).find((c) => c.tagName === 'Text' || c.tagName === 'TextCircular');
      if (!t) return;
      const f = Array.from(t.children).find((c) => c.tagName === 'Font');
      if (!f) return;
      const spec = this.fontSpec(f, env);
      const content = this.textContent(f, env, { text: '', glow: null });
      const str = content.text.replace(/\s+/g, ' ').trim();
      if (!str) return;
      ctx.font = spec.css;
      ctx.fillStyle = cssColor(spec.color);
      ctx.textBaseline = 'middle';
      const glow = content.glow;
      const withGlow = (paint) => {
        if (glow) {
          ctx.save();
          ctx.shadowColor = cssColor(this.color(glow.color, env));
          ctx.shadowBlur = glow.radius;
          paint(); paint();
          ctx.restore();
        }
        paint();
      };
      if (t.tagName === 'Text') {
        ctx.letterSpacing = spec.spacing + 'px';
        const align = t.getAttribute('align') || 'CENTER';
        const w = ctx.measureText(str).width - spec.spacing;
        let x = (g.width - w) / 2;
        if (align === 'START') x = 0;
        if (align === 'END') x = g.width - w;
        ctx.textAlign = 'left';
        withGlow(() => ctx.fillText(str, x, g.height / 2 + spec.size * 0.04));
        ctx.letterSpacing = '0px';
      } else {
        this.drawCircular(ctx, t, str, spec, withGlow);
      }
    }

    drawCircular(ctx, t, str, spec, withGlow) {
      const p = {};
      for (const at of t.attributes) p[at.name] = at.value;
      const cx = Number(p.centerX), cy = Number(p.centerY);
      const r = Number(p.width) / 2;
      const s = Number(p.startAngle);
      const e = Number(p.endAngle);
      const ccw = p.direction === 'COUNTER_CLOCKWISE';
      let sweep = ccw ? s - e : e - s;
      sweep = ((sweep % 360) + 360) % 360 || 360;
      ctx.letterSpacing = '0px';
      ctx.textAlign = 'center';
      const widths = Array.from(str).map((ch) => ctx.measureText(ch).width);
      const total = widths.reduce((a, b) => a + b, 0) + spec.spacing * (widths.length - 1);
      const avail = (rad(sweep) * r);
      const align = p.align || 'CENTER';
      let offset = align === 'START' ? 0 : align === 'END' ? avail - total : (avail - total) / 2;
      Array.from(str).forEach((ch, k) => {
        const mid = offset + widths[k] / 2;
        const deg = ccw ? s - (mid / r) * (180 / Math.PI) : s + (mid / r) * (180 / Math.PI);
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(rad(deg));
        ctx.translate(0, -r);
        if (ccw) ctx.rotate(Math.PI);
        withGlow(() => ctx.fillText(ch, 0, 0));
        ctx.restore();
        offset += widths[k] + spec.spacing;
      });
    }

    // ----------------------------------------------------------- images --
    tinted(img, color) {
      const key = img.src.length + ':' + img.src.slice(-32) + cssColor(color);
      let c = this.tintCache.get(key);
      if (c) return c;
      c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      const x = c.getContext('2d');
      x.drawImage(img, 0, 0);
      x.globalCompositeOperation = 'source-in';
      x.fillStyle = cssColor({ ...color, a: 1 });
      x.fillRect(0, 0, c.width, c.height);
      this.tintCache.set(key, c);
      return c;
    }

    resolveImage(res, env) {
      if (!res) return null;
      if (res[0] === '[') {
        const v = env.source(res.slice(1, -1));
        return v && typeof v === 'object' ? v : null;
      }
      return this.images[res] || null;
    }

    drawImage(ctx, el, env, g) {
      const im = Array.from(el.children).find((c) => c.tagName === 'Image');
      const img = im && this.resolveImage(im.getAttribute('resource'), env);
      if (!img || !img.complete) return;
      const tint = el.getAttribute('tintColor');
      ctx.drawImage(tint ? this.tinted(img, this.color(tint, env)) : img, 0, 0, g.width, g.height);
    }

    // ON_VISIBLE sequences start at state.bootStart; TAP-only ones at state.animStart[name]
    drawAnimated(ctx, el, env, g) {
      const seq = Array.from(el.children).find((c) => c.tagName === 'SequenceImages');
      const st = env.state;
      const ctl = Array.from(el.children).find((c) => c.tagName === 'AnimationController');
      const play = ctl ? ctl.getAttribute('play') || '' : '';
      const name = el.getAttribute('name');
      if (play.includes('TAP') && !play.includes('ON_VISIBLE')) {
        const m = ctx.getTransform();
        (env.taps || []).push({ target: 'PLAY ' + name, name,
          points: [[0, 0], [g.width, 0], [g.width, g.height], [0, g.height]].map(([x, y]) => new DOMPoint(x, y).matrixTransform(m)) });
      }
      const start = st.animStart && st.animStart[name] !== undefined ? st.animStart[name]
        : play.includes('ON_VISIBLE') ? st.bootStart : null;
      if (!seq || start === undefined || start === null) return;
      const frames = Array.from(seq.children).filter((c) => c.tagName === 'Image');
      const fps = num(seq.getAttribute('frameRate'), 15);
      const now = st.animNow !== undefined ? st.animNow : performance.now();
      const k = Math.floor(((now - start) / 1000) * fps);
      if (k < 0 || k >= frames.length) return;
      const img = this.images[frames[k].getAttribute('resource')];
      if (!img || !img.complete) return;
      const tint = el.getAttribute('tintColor');
      ctx.drawImage(tint ? this.tinted(img, this.color(tint, env)) : img, 0, 0, g.width, g.height);
    }

    // ----------------------------------------------------------- clocks --
    digitalClock(ctx, el, env, taps) {
      const g = this.geometry(el, env);
      if (g.alpha <= 0) return;
      ctx.save();
      this.applyGeometry(ctx, g);
      const loc = Array.from(el.children).find((c) => c.tagName === 'Localization');
      const tz = loc ? loc.getAttribute('timeZone') : null;
      const p = timeParts(env.state.time, tz);
      for (const tt of el.children) {
        if (tt.tagName !== 'TimeText') continue;
        const tg = this.geometry(tt, env);
        const f = Array.from(tt.children).find((c) => c.tagName === 'Font');
        const spec = this.fontSpec(f, env);
        const hf = tt.getAttribute('hourFormat') || 'SYNC_TO_DEVICE';
        const use24 = hf === '24' || (hf === 'SYNC_TO_DEVICE' && env.state.is24h);
        const hh = use24 ? pad(p.h) : pad(p.h % 12 === 0 ? 12 : p.h % 12);
        const str = tt.getAttribute('format').replace('hh', hh).replace('mm', pad(p.mi)).replace('ss', pad(p.s));
        ctx.save();
        this.applyGeometry(ctx, tg);
        ctx.font = spec.css;
        ctx.fillStyle = cssColor(spec.color);
        ctx.textBaseline = 'middle';
        const w = ctx.measureText(str).width;
        const align = tt.getAttribute('align') || 'CENTER';
        const x = align === 'START' ? 0 : align === 'END' ? tg.width - w : (tg.width - w) / 2;
        ctx.fillText(str, x, tg.height / 2 + spec.size * 0.04);
        ctx.restore();
      }
      ctx.restore();
    }

    analogClock(ctx, el, env) {
      const g = this.geometry(el, env);
      if (g.alpha <= 0) return;
      ctx.save();
      this.applyGeometry(ctx, g);
      const p = timeParts(env.state.time, null);
      const angles = {
        HourHand: ((p.h % 12) + p.mi / 60 + p.s / 3600) * 30,
        MinuteHand: (p.mi + p.s / 60) * 6,
        SecondHand: (p.s + p.ms / 1000) * 6,
      };
      for (const h of el.children) {
        if (!(h.tagName in angles)) continue;
        const hg = this.geometry(h, env);
        const img = this.images[h.getAttribute('resource')];
        if (!img || !img.complete || hg.alpha <= 0) continue;
        ctx.save();
        ctx.globalAlpha *= hg.alpha / 255;
        const px = hg.x + hg.pivotX * hg.width;
        const py = hg.y + hg.pivotY * hg.height;
        ctx.translate(px, py);
        ctx.rotate(rad(angles[h.tagName]));
        ctx.translate(-px, -py);
        const tint = h.getAttribute('tintColor');
        ctx.drawImage(tint ? this.tinted(img, this.color(tint, env)) : img, hg.x, hg.y, hg.width, hg.height);
        ctx.restore();
      }
      ctx.restore();
    }

    complicationSlot(ctx, el, env, taps) {
      const g = this.geometry(el, env);
      if (g.alpha <= 0) return;
      const data = (env.state.complications || {})[el.getAttribute('slotId')];
      ctx.save();
      this.applyGeometry(ctx, g);
      const m = ctx.getTransform();
      taps.push({ target: 'COMPLICATION ' + el.getAttribute('slotId'), name: el.getAttribute('displayName'),
        points: [[0, 0], [g.width, 0], [g.width, g.height], [0, g.height]].map(([x, y]) => new DOMPoint(x, y).matrixTransform(m)) });
      if (data) {
        const c = Array.from(el.children).find((k) => k.tagName === 'Complication' && k.getAttribute('type') === data.type);
        if (c) {
          const prev = env.complication;
          env.complication = data;
          this.children(ctx, c, env, taps);
          env.complication = prev;
        }
      }
      ctx.restore();
    }
  }

  global.WFF = { WatchFace, evaluate, sprintf, makeSources };
})(typeof window !== 'undefined' ? window : globalThis);
