// Ελαφρύ γράφημα γραμμής σε canvas (ένα μέγεθος ανά γράφημα — small multiples, όχι διπλός άξονας).
// Crosshair + tooltip στο hover, αυτόματη κλίμακα, θέμα από CSS μεταβλητές.
import { SERIES_META } from './session.js';

function niceStep(range, n = 3) {
  const raw = range / n;
  const mag = 10 ** Math.floor(Math.log10(raw || 1));
  const f = raw / mag;
  return (f >= 5 ? 10 : f >= 2 ? 5 : f >= 1 ? 2 : 1) * mag;
}

export class LineChart {
  constructor(key) {
    this.key = key;
    this.meta = SERIES_META(key);
    this.el = document.createElement('figure');
    this.el.className = 'chart';
    const cap = document.createElement('figcaption');
    this.title = document.createElement('span');
    this.title.textContent = `${this.meta.name}`;
    this.valEl = document.createElement('b');
    cap.append(this.title, this.valEl);
    this.canvas = document.createElement('canvas');
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', `Γράφημα ${this.meta.name}`);
    this.tip = document.createElement('div');
    this.tip.className = 'chart-tip';
    this.tip.hidden = true;
    this.el.append(cap, this.canvas, this.tip);
    this.hoverX = null;
    this.canvas.addEventListener('pointermove', (e) => { this.hoverX = e.offsetX; this.redraw(); });
    this.canvas.addEventListener('pointerleave', () => { this.hoverX = null; this.tip.hidden = true; this.redraw(); });
    this.last = null;
  }

  fmt(v) {
    return v == null ? '—' : v.toFixed(this.meta.dec ?? 1);
  }

  /** rows: [{t, v}], opts: {t0, t1, cursorT} */
  draw(rows, opts = {}) {
    this.last = { rows, opts };
    this.redraw();
  }

  redraw() {
    if (!this.last) return;
    const { rows, opts } = this.last;
    const cv = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const W = cv.clientWidth;
    const H = cv.clientHeight;
    if (!W || !H) return;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
    }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const css = getComputedStyle(this.el);
    const col = {
      line: css.getPropertyValue('--series-1').trim() || '#2a78d6',
      grid: css.getPropertyValue('--grid').trim() || '#ddd',
      muted: css.getPropertyValue('--muted').trim() || '#888',
      text: css.getPropertyValue('--text').trim() || '#000',
      surface: css.getPropertyValue('--surface').trim() || '#fff',
    };

    const k = this.key;
    const t1 = opts.t1 ?? (rows.length ? rows[rows.length - 1].t : 0);
    const t0 = opts.t0 ?? Math.max(0, t1 - 60);
    const pts = [];
    for (const r of rows) if (r.t >= t0 && r.t <= t1 && r.v[k] != null) pts.push([r.t, r.v[k]]);

    // κλίμακα Y
    let lo = Infinity; let hi = -Infinity;
    for (const [, v] of pts) { if (v < lo) lo = v; if (v > hi) hi = v; }
    if (!pts.length) { lo = this.meta.min ?? 0; hi = this.meta.max ?? 1; }
    if (hi - lo < 1e-9) { const p = Math.abs(hi) * 0.05 || 1; lo -= p; hi += p; }
    const step = niceStep(hi - lo);
    lo = Math.floor(lo / step) * step;
    hi = Math.ceil(hi / step) * step;

    const L = 44; const R = 8; const T = 8; const B = 18;
    const x = (t) => L + ((t - t0) / Math.max(1e-6, t1 - t0)) * (W - L - R);
    const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);

    // πλέγμα και άξονες (υποχωρητικά)
    ctx.font = '11px system-ui, sans-serif';
    ctx.lineWidth = 1;
    ctx.textBaseline = 'middle';
    for (let v = lo; v <= hi + step / 2; v += step) {
      ctx.strokeStyle = col.grid;
      ctx.beginPath(); ctx.moveTo(L, Math.round(y(v)) + 0.5); ctx.lineTo(W - R, Math.round(y(v)) + 0.5); ctx.stroke();
      ctx.fillStyle = col.muted; ctx.textAlign = 'right';
      ctx.fillText(+v.toFixed(3) + '', L - 6, y(v));
    }
    ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
    ctx.fillText(`${t0.toFixed(0)} s`, L, H - 4);
    ctx.textAlign = 'right';
    ctx.fillText(`${t1.toFixed(0)} s`, W - R, H - 4);

    // γραμμή 2px
    if (pts.length) {
      ctx.strokeStyle = col.line; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.beginPath();
      pts.forEach(([t, v], i) => (i ? ctx.lineTo(x(t), y(v)) : ctx.moveTo(x(t), y(v))));
      ctx.stroke();
    }

    // κέρσορας αναπαραγωγής
    if (opts.cursorT != null && opts.cursorT >= t0 && opts.cursorT <= t1) {
      ctx.strokeStyle = col.muted; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(x(opts.cursorT), T); ctx.lineTo(x(opts.cursorT), H - B); ctx.stroke();
      ctx.setLineDash([]);
    }

    // τρέχουσα τιμή στην επικεφαλίδα
    const cur = opts.cursorT != null
      ? pts.reduce((b, p) => (Math.abs(p[0] - opts.cursorT) < Math.abs((b?.[0] ?? Infinity) - opts.cursorT) ? p : b), null)
      : pts[pts.length - 1];
    this.valEl.textContent = cur ? `${this.fmt(cur[1])} ${this.meta.unit}` : '—';

    // hover: crosshair + δείκτης + tooltip
    if (this.hoverX != null && pts.length) {
      const th = t0 + ((this.hoverX - L) / (W - L - R)) * (t1 - t0);
      let best = pts[0];
      for (const p of pts) if (Math.abs(p[0] - th) < Math.abs(best[0] - th)) best = p;
      const px = x(best[0]); const py = y(best[1]);
      ctx.strokeStyle = col.muted; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(px, T); ctx.lineTo(px, H - B); ctx.stroke();
      ctx.fillStyle = col.line; ctx.strokeStyle = col.surface; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(px, py, 4.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      this.tip.hidden = false;
      this.tip.textContent = `${best[0].toFixed(1)} s · ${this.fmt(best[1])} ${this.meta.unit}`;
      const tw = this.tip.offsetWidth;
      this.tip.style.left = (this.canvas.offsetLeft + Math.min(Math.max(0, px - tw / 2), W - tw)) + 'px';
      this.tip.style.top = (this.canvas.offsetTop + Math.max(0, py - 32)) + 'px';
    }
  }
}
