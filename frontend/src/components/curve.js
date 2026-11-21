import {phases} from '../presentation.js';

export function chart(canvas, points) {
  const colors = {paper: 'oklch(99% .006 240)', grid: 'oklch(89% .018 237)', ink: 'oklch(45% .055 250)',
    temp: 'oklch(38% .093 245)', pressure: 'oklch(53% .102 182)', vacuum: 'oklch(94% .024 218)'};
  const draw = () => {
    const box = canvas.getBoundingClientRect();
    if (!box.width) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = box.width * dpr;
    canvas.height = box.height * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    const w = box.width, height = box.height;
    const left = 54, right = w - 57, top = 43, bottom = height - 42;
    const duration = points.at(-1).minute || 1;
    const x = minute => left + (right - left) * minute / duration;
    const ymin = Math.min(-45, ...points.map(point => point.shelf_c));
    const ymax = Math.max(30, ...points.map(point => point.shelf_c));
    const logmin = Math.floor(Math.min(0, ...points.map(point => Math.log10(point.pressure_pa))));
    const logmax = Math.ceil(Math.max(5, ...points.map(point => Math.log10(point.pressure_pa))));
    const y = (value, min, max) => bottom - (bottom - top) * (value - min) / (max - min);
    ctx.fillStyle = colors.paper;
    ctx.fillRect(0, 0, w, height);
    const vacuum = points.filter(point => point.phase === 'vacuum');
    if (vacuum.length) {
      const start = x(vacuum[0].minute), end = x(vacuum.at(-1).minute);
      ctx.fillStyle = colors.vacuum;
      ctx.fillRect(start, top, end - start, bottom - top);
      ctx.fillStyle = colors.ink;
      ctx.font = '12px "Barlow Semi Condensed", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(phases.vacuum, (start + end) / 2, 25);
    }
    ctx.font = '11px "IBM Plex Mono", monospace';
    for (let tick = 0; tick <= 5; tick++) {
      const yy = top + (bottom - top) * tick / 5;
      ctx.strokeStyle = colors.grid; ctx.beginPath(); ctx.moveTo(left, yy); ctx.lineTo(right, yy); ctx.stroke();
      ctx.fillStyle = colors.ink;
      ctx.textAlign = 'right'; ctx.fillText(`${Math.round(ymax - (ymax - ymin) * tick / 5)}°`, left - 10, yy + 4);
      ctx.textAlign = 'center'; ctx.fillText(`${Math.round(duration * tick / 5)}`, x(duration * tick / 5), bottom + 23);
    }
    ctx.fillText('min', right + 23, bottom + 23);
    ctx.textAlign = 'left';
    for (let exponent = logmin; exponent <= logmax; exponent++) {
      const label = exponent >= 6 ? `${10 ** (exponent - 6)}M` : exponent >= 3 ? `${10 ** (exponent - 3)}k` : `${10 ** exponent}`;
      ctx.fillText(label, right + 10, y(exponent, logmin, logmax) + 4);
    }
    ctx.textAlign = 'left'; ctx.fillText('°C', left - 29, 24);
    ctx.textAlign = 'right'; ctx.fillText('Pa (log)', w - 11, 24);
    for (const [color, units, dashed] of [[colors.temp, p => y(p.shelf_c,ymin,ymax), false],
      [colors.pressure, p => y(Math.log10(p.pressure_pa),logmin,logmax), true]]) {
      ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 2;
      ctx.setLineDash(dashed ? [6, 4] : []);
      ctx.beginPath(); points.forEach((point, i) => i ? ctx.lineTo(x(point.minute), units(point)) : ctx.moveTo(x(point.minute), units(point))); ctx.stroke();
      ctx.setLineDash([]);
      for (const point of points) {
        ctx.beginPath(); ctx.arc(x(point.minute), units(point), 3.2, 0, Math.PI * 2); ctx.fill();
      }
    }
  };
  draw();
  const observer = new ResizeObserver(draw);
  observer.observe(canvas);
  return () => observer.disconnect();
}
