type Point = { x: number; y: number; z: number };
type Face = { points: Point[]; normal: Point; front: boolean };
type Outline = { x: number; y: number }[];

// The same ribbon outline as the SVG wordmark, split along its central seam.
const outline: Outline = [[0, 0], [140, 0], [140, 42], [46, 198], [140, 198], [140, 240], [0, 240], [0, 198], [94, 42], [0, 42]].map(([x, y]) => ({ x, y }));
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function cut(points: Outline, boundary: number, upper: boolean): Outline {
  const result: Outline = [];
  points.forEach((point, index) => {
    const previous = points[(index + points.length - 1) % points.length];
    const inside = upper ? point.y <= boundary : point.y >= boundary;
    const previousInside = upper ? previous.y <= boundary : previous.y >= boundary;
    if (inside !== previousInside) {
      const t = (boundary - previous.y) / (point.y - previous.y);
      result.push({ x: previous.x + (point.x - previous.x) * t, y: boundary });
    }
    if (inside) result.push(point);
  });
  return result;
}

function extrude(points: Outline): Face[] {
  const front = points.map(({ x, y }) => ({ x: x - 70, y: y - 120, z: 18 }));
  const back = front.map((point) => ({ ...point, z: -18 }));
  const faces: Face[] = [
    { points: front, normal: { x: 0, y: 0, z: 1 }, front: true },
    { points: back, normal: { x: 0, y: 0, z: -1 }, front: false },
  ];
  front.forEach((point, index) => {
    const next = (index + 1) % front.length;
    const dx = front[next].x - point.x;
    const dy = front[next].y - point.y;
    const length = Math.hypot(dx, dy);
    faces.push({ points: [point, back[index], back[next], front[next]], normal: { x: dy / length, y: -dx / length, z: 0 }, front: false });
  });
  return faces;
}
const faces = [...extrude(cut(outline, 116, true)), ...extrude(cut(outline, 124, false))];

export function setupHero(signal: AbortSignal) {
  const canvas = document.querySelector<HTMLCanvasElement>('#hero-sculpture');
  const scene = canvas?.closest<HTMLElement>('.hero-object');
  const hero = document.querySelector<HTMLElement>('.masthead');
  const context = canvas?.getContext('2d');
  if (!canvas || !scene || !hero || !context) return;

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  let width = 0, height = 0, frame = 0;
  let pointerX = 0, pointerY = 0, scroll = 0;
  let x = -.2, y = -.45;
  let targetX = x, targetY = y;
  let material = [206, 150, 125];
  let line = 'rgba(220,218,201,.18)';

  const rotate = (point: Point): Point => {
    const cx = Math.cos(x), sx = Math.sin(x), cy = Math.cos(y), sy = Math.sin(y);
    const z = .1, cz = Math.cos(z), sz = Math.sin(z);
    const yy = point.y * cx - point.z * sx;
    const zz = point.y * sx + point.z * cx;
    const xx = point.x * cy + zz * sy;
    const depth = -point.x * sy + zz * cy;
    return { x: xx * cz - yy * sz, y: xx * sz + yy * cz, z: depth };
  };

  const draw = () => {
    context.clearRect(0, 0, width, height);
    if (!width || !height) return;
    const scale = Math.min(width / 230, height / 315);
    context.fillStyle = 'rgba(0,0,0,.16)';
    context.beginPath();
    context.ellipse(width * .5, height * .89, width * .22, height * .022, 0, 0, Math.PI * 2);
    context.fill();
    const rendered = faces.map((face) => {
      const points = face.points.map(rotate);
      return { ...face, points, normal: rotate(face.normal), depth: points.reduce((sum, p) => sum + p.z, 0) / points.length };
    }).filter((face) => face.normal.z > -.01).sort((a, b) => a.depth - b.depth);
    rendered.forEach((face) => {
      const n = face.normal;
      const light = Math.max(0, -.34 * n.x - .46 * n.y + .82 * n.z);
      const brightness = .56 + light * .5;
      const base = face.front ? material : [123, 139, 113];
      context.fillStyle = `rgb(${base.map((channel) => Math.round(clamp(channel * brightness, 0, 255))).join(',')})`;
      context.strokeStyle = line;
      context.lineWidth = .6;
      context.beginPath();
      face.points.forEach((point, index) => {
        const perspective = 650 / (650 - point.z);
        const px = width * .5 + point.x * scale * perspective;
        const py = height * .44 + point.y * scale * perspective;
        if (index) context.lineTo(px, py); else context.moveTo(px, py);
      });
      context.closePath();
      context.fill();
      context.stroke();
    });
  };

  // Ease toward input, then stop rendering when the object has settled.
  const tick = () => {
    frame = 0;
    if (signal.aborted) return;
    x += (targetX - x) * .085;
    y += (targetY - y) * .085;
    draw();
    if (Math.abs(targetX - x) + Math.abs(targetY - y) > .0005) frame = requestAnimationFrame(tick);
  };
  const update = () => {
    targetX = reduced.matches ? -.2 : -.2 + pointerY * .15 + scroll * .12;
    targetY = reduced.matches ? -.45 : -.45 + pointerX * .38 + scroll * .52;
    if (reduced.matches) { x = targetX; y = targetY; draw(); }
    else if (!frame && Math.abs(targetX - x) + Math.abs(targetY - y) > .0005) frame = requestAnimationFrame(tick);
  };
  const readScroll = () => {
    scroll = clamp(-hero.getBoundingClientRect().top / Math.max(1, hero.offsetHeight), 0, 1);
    update();
  };
  const resize = () => {
    const bounds = scene.getBoundingClientRect();
    width = bounds.width; height = bounds.height;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * pixelRatio);
    canvas.height = Math.round(height * pixelRatio);
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    draw();
    readScroll();
  };
  const palette = () => {
    const style = getComputedStyle(document.documentElement);
    const color = style.getPropertyValue('--accent').trim().replace('#', '');
    material = [0, 2, 4].map((start) => parseInt(color.slice(start, start + 2), 16));
    line = document.documentElement.dataset.theme === 'light' ? 'rgba(41,53,44,.16)' : 'rgba(220,218,201,.18)';
    draw();
  };
  hero.addEventListener('pointermove', (event) => {
    if (event.pointerType === 'touch' || reduced.matches) return;
    const bounds = hero.getBoundingClientRect();
    pointerX = clamp((event.clientX - bounds.left) / bounds.width * 2 - 1, -1, 1);
    pointerY = clamp((event.clientY - bounds.top) / bounds.height * 2 - 1, -1, 1);
    update();
  }, { passive: true, signal });
  hero.addEventListener('pointerleave', () => { pointerX = pointerY = 0; update(); }, { signal });
  window.addEventListener('scroll', readScroll, { passive: true, signal });
  reduced.addEventListener('change', update, { signal });
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(scene);
  const themeObserver = new MutationObserver(palette);
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  signal.addEventListener('abort', () => {
    cancelAnimationFrame(frame);
    resizeObserver.disconnect();
    themeObserver.disconnect();
  }, { once: true });
  palette(); resize();
  scene.classList.add('render-ready');
}
