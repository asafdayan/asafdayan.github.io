const TAU = Math.PI * 2;
const EPS = 1e-9;

const colors = {
  red: "#d83a34",
  blue: "#1769e0",
  orange: "#f07f1a",
  green: "#1f9250",
  purple: "#8b31b5",
  gray: "#8b9590",
  guide: "#65747b",
  grid: "#d3dde1",
  fine: "#e9eef0",
  ink: "#172126",
};

const canvas = document.querySelector("#smithCanvas");
const ctx = canvas.getContext("2d");
const statusEl = document.querySelector("#status");
const logEl = document.querySelector("#log");
const intersectionList = document.querySelector("#intersectionList");
let tipLabelsDrawn = new Set();

const state = {
  domain: "z",
  currentGamma: null,
  currentLabel: "current",
  swrRadius: null,
  marks: [],
  paths: [],
  intersections: [],
  history: [],
};

function c(re, im = 0) {
  return { re, im };
}

function add(a, b) {
  return c(a.re + b.re, a.im + b.im);
}

function sub(a, b) {
  return c(a.re - b.re, a.im - b.im);
}

function mul(a, b) {
  return c(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
}

function div(a, b) {
  const den = b.re * b.re + b.im * b.im;
  return c((a.re * b.re + a.im * b.im) / den, (a.im * b.re - a.re * b.im) / den);
}

function inv(a) {
  return div(c(1), a);
}

function expj(theta) {
  return c(Math.cos(theta), Math.sin(theta));
}

function abs(a) {
  return Math.hypot(a.re, a.im);
}

function angle(a) {
  return Math.atan2(a.im, a.re);
}

function gammaFromZ(z) {
  return div(sub(z, c(1)), add(z, c(1)));
}

function zFromGamma(gamma) {
  return div(add(c(1), gamma), sub(c(1), gamma));
}

function gammaFromY(y) {
  return div(sub(c(1), y), add(c(1), y));
}

function yFromGamma(gamma) {
  return div(sub(c(1), gamma), add(c(1), gamma));
}

function gammaFromQuantity(kind, value) {
  return kind === "z" ? gammaFromZ(value) : gammaFromY(value);
}

function quantityFromGamma(kind, gamma) {
  return kind === "z" ? zFromGamma(gamma) : yFromGamma(gamma);
}

function parseComplex(input) {
  let s = input.trim().toLowerCase().replaceAll(" ", "").replaceAll("i", "j");
  if (!s) throw new Error("empty complex value");
  if (s === "j" || s === "+j") s = "1j";
  if (s === "-j") s = "-1j";
  s = s.replace(/([+-])j/g, "$11j");
  if (!s.includes("j")) return c(Number(s), 0);
  if (s.endsWith("j")) s = s.slice(0, -1);

  let split = -1;
  for (let i = 1; i < s.length; i += 1) {
    if (s[i] === "+" || s[i] === "-") split = i;
  }

  if (split === -1) return c(0, Number(s));
  return c(Number(s.slice(0, split)), Number(s.slice(split)));
}

function fmt(value, digits = 4) {
  const re = nearZero(value.re) ? 0 : value.re;
  const im = nearZero(value.im) ? 0 : value.im;
  return `${formatNumber(re, digits)}${im >= 0 ? "+" : ""}${formatNumber(im, digits)}j`;
}

function formatNumber(value, digits) {
  if (!Number.isFinite(value)) return "inf";
  const rounded = Number(value.toPrecision(digits));
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

function nearZero(value) {
  return Math.abs(value) < 1e-10;
}

function displayGamma(gamma) {
  return state.domain === "z" ? gamma : c(-gamma.re, -gamma.im);
}

function screenFromGamma(gamma, geom) {
  const shown = displayGamma(gamma);
  return screenFromVisibleGamma(shown, geom);
}

function screenFromVisibleGamma(shown, geom) {
  return {
    x: geom.cx + shown.re * geom.r,
    y: geom.cy - shown.im * geom.r,
  };
}

function gammaFromDisplayPoint(px, py, geom) {
  const shown = c((px - geom.cx) / geom.r, -(py - geom.cy) / geom.r);
  return state.domain === "z" ? shown : c(-shown.re, -shown.im);
}

function snapshot() {
  return JSON.parse(JSON.stringify(state, (key, value) => (key === "history" ? undefined : value)));
}

function restore(snap) {
  state.domain = snap.domain;
  state.currentGamma = snap.currentGamma;
  state.currentLabel = snap.currentLabel;
  state.swrRadius = snap.swrRadius;
  state.marks = snap.marks;
  state.paths = snap.paths;
  state.intersections = snap.intersections;
  document.querySelector("#domain").value = state.domain;
  refreshIntersectionList();
  render();
}

function withHistory(action) {
  const snap = snapshot();
  try {
    action();
    state.history.push(snap);
    render();
  } catch (err) {
    restore(snap);
    say(`Error: ${err.message}`);
  }
}

function say(text) {
  statusEl.textContent = text;
  logEl.textContent += `\n${text}`;
  logEl.scrollTop = logEl.scrollHeight;
}

function vswr(radius) {
  return radius >= 1 ? Infinity : (1 + radius) / (1 - radius);
}

function printPoint(name, gamma) {
  const z = zFromGamma(gamma);
  const y = yFromGamma(gamma);
  const scale = scaleReadings(gamma);
  return `${name}: Gamma=${fmt(gamma)}, z=${fmt(z)}, y=${fmt(y)}, gen-scale=${scale.generator}, load-scale=${scale.load}`;
}

function lengthLambda(start, target, direction) {
  const a0 = angle(start);
  const a1 = angle(target);
  let delta = direction === "generator" ? mod(a0 - a1, TAU) : mod(a1 - a0, TAU);
  return delta / (4 * Math.PI);
}

function mod(value, base) {
  return ((value % base) + base) % base;
}

function arcBetween(start, target, direction, n = 240) {
  const radius = abs(start);
  if (radius < EPS) return [start, target];
  const a0 = angle(start);
  const delta = lengthLambda(start, target, direction) * 4 * Math.PI;
  const points = [];
  for (let i = 0; i < n; i += 1) {
    const t = i / (n - 1);
    const a = direction === "generator" ? a0 - delta * t : a0 + delta * t;
    points.push(mul(c(radius), expj(a)));
  }
  return points;
}

function targetResidual(gamma, kind, value) {
  if (kind === "r" || kind === "x") {
    const z = zFromGamma(gamma);
    return kind === "r" ? z.re - value : z.im - value;
  }
  const y = yFromGamma(gamma);
  return kind === "g" ? y.re - value : y.im - value;
}

function findIntersections(radius, kind, value) {
  const roots = [];
  const count = 6000;
  let prevAngle = -Math.PI;
  let prev = targetResidual(mul(c(radius), expj(prevAngle)), kind, value);

  for (let i = 1; i <= count; i += 1) {
    const nextAngle = -Math.PI + (TAU * i) / count;
    const next = targetResidual(mul(c(radius), expj(nextAngle)), kind, value);
    if (Number.isFinite(prev) && Number.isFinite(next)) {
      if (Math.abs(prev) < 1e-4) roots.push(mul(c(radius), expj(prevAngle)));
      if (prev * next <= 0) {
        let lo = prevAngle;
        let hi = nextAngle;
        for (let j = 0; j < 48; j += 1) {
          const mid = (lo + hi) / 2;
          const flo = targetResidual(mul(c(radius), expj(lo)), kind, value);
          const fmid = targetResidual(mul(c(radius), expj(mid)), kind, value);
          if (flo * fmid <= 0) hi = mid;
          else lo = mid;
        }
        roots.push(mul(c(radius), expj((lo + hi) / 2)));
      }
    }
    prevAngle = nextAngle;
    prev = next;
  }

  const unique = [];
  for (const root of roots) {
    if (!unique.some((old) => abs(sub(root, old)) < 1e-4)) unique.push(root);
  }
  unique.sort((a, b) => angle(a) - angle(b));
  return unique;
}

function curveForTarget(kind, value) {
  const points = [];
  if (kind === "r") {
    for (let i = 0; i < 2200; i += 1) {
      const x = -20 + (40 * i) / 2199;
      points.push(gammaFromZ(c(value, x)));
    }
  } else if (kind === "x") {
    for (let i = 0; i < 2200; i += 1) {
      const r = (20 * i) / 2199;
      points.push(gammaFromZ(c(r, value)));
    }
  } else if (kind === "g") {
    for (let i = 0; i < 2200; i += 1) {
      const b = -20 + (40 * i) / 2199;
      points.push(gammaFromY(c(value, b)));
    }
  } else {
    for (let i = 0; i < 2200; i += 1) {
      const g = (20 * i) / 2199;
      points.push(gammaFromY(c(g, value)));
    }
  }
  return points.filter((p) => abs(p) <= 1.001);
}

function stubImpedancePath(stubType, length) {
  const points = [];
  const n = 500;
  for (let i = 0; i < n; i += 1) {
    const l = 1e-5 + ((length - 1e-5) * i) / (n - 1);
    const betaL = TAU * l;
    const z = stubType === "short" ? c(0, Math.tan(betaL)) : c(0, -1 / Math.tan(betaL));
    points.push(gammaFromZ(z));
  }
  return points;
}

function scaleReadings(gamma) {
  const generator = generatorScaleValue(gamma);
  const load = mod(0.5 - generator, 0.5);
  return {
    generator: formatScale(generator),
    load: formatScale(load),
  };
}

function generatorScaleValue(gamma) {
  const shown = displayGamma(gamma);
  const a = angle(shown);
  return mod((Math.PI - a) / (4 * Math.PI), 0.5);
}

function formatScale(value) {
  const rounded = Math.round(value * 1000) / 1000;
  if (Math.abs(rounded) < 1e-9) return "0";
  return rounded.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function formatScaleExact(value) {
  const rounded = Math.round(value * 1000) / 1000;
  return rounded.toFixed(3);
}

function currentGeometry() {
  const rect = canvas.getBoundingClientRect();
  const scale = window.devicePixelRatio || 1;
  canvas.width = Math.round(rect.width * scale);
  canvas.height = Math.round(rect.height * scale);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  const side = Math.min(rect.width, rect.height);
  return {
    w: rect.width,
    h: rect.height,
    cx: rect.width / 2,
    cy: rect.height / 2 + 8,
    r: side * 0.36,
  };
}

function render() {
  const geom = currentGeometry();
  tipLabelsDrawn = new Set();
  ctx.clearRect(0, 0, geom.w, geom.h);
  const background = ctx.createLinearGradient(0, 0, geom.w, geom.h);
  background.addColorStop(0, "#ffffff");
  background.addColorStop(1, "#f8fbfc");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, geom.w, geom.h);
  drawGrid(geom);
  drawOuterScale(geom);

  for (const path of state.paths) {
    drawPath(path.points, geom, path.color, path.style, 2.6);
  }
  drawCurrentRadialGuide(geom);
  for (const mark of state.marks) {
    drawRadialGuide(mark, geom);
  }
  for (const mark of state.marks) {
    drawMark(mark, geom);
  }
}

function drawGrid(geom) {
  ctx.save();
  ctx.lineCap = "round";
  circlePath(geom.cx, geom.cy, geom.r);
  ctx.strokeStyle = colors.ink;
  ctx.lineWidth = 2;
  ctx.stroke();

  line(geom.cx - geom.r * 1.05, geom.cy, geom.cx + geom.r * 1.05, geom.cy, "#cbd2cd", 1);
  line(geom.cx, geom.cy - geom.r * 1.05, geom.cx, geom.cy + geom.r * 1.05, "#e1e6e2", 1);

  const realName = state.domain === "z" ? "r" : "g";
  const imagName = state.domain === "z" ? "x" : "b";

  for (const real of [0.2, 0.5, 1, 2, 5]) {
    const points = [];
    for (let i = 0; i < 1400; i += 1) {
      const imag = -15 + (30 * i) / 1399;
      points.push(gammaFromZ(c(real, imag)));
    }
    drawVisiblePath(points, geom, colors.grid, "solid", 1);
    const gamma0 = gammaFromZ(c(real, 0));
    const p = screenFromVisibleGamma(gamma0, geom);
    ctx.fillStyle = "#7a837e";
    ctx.font = "12px system-ui";
    ctx.textAlign = "center";
    ctx.fillText(`${realName}=${real}`, p.x, geom.cy + 22);
  }

  for (const imag of [-5, -2, -1, -0.5, 0.5, 1, 2, 5]) {
    const points = [];
    for (let i = 0; i < 1400; i += 1) {
      const real = (20 * i) / 1399;
      points.push(gammaFromZ(c(real, imag)));
    }
    drawVisiblePath(points, geom, colors.fine, "solid", 1);
    const labelPoint = screenFromVisibleGamma(gammaFromZ(c(0.08, imag)), geom);
    ctx.fillStyle = "#8b938f";
    ctx.font = "11px system-ui";
    ctx.fillText(`${imagName}=${imag}`, labelPoint.x + 18, labelPoint.y);
  }

  ctx.fillStyle = colors.ink;
  ctx.font = "600 13px system-ui";
  ctx.textAlign = "center";
  ctx.fillText(state.domain === "z" ? "short" : "open", geom.cx - geom.r + 34, geom.cy + 24);
  ctx.fillText(state.domain === "z" ? "open" : "short", geom.cx + geom.r - 34, geom.cy + 24);
  ctx.fillStyle = "#334249";
  ctx.fillText("match", geom.cx + 34, geom.cy - 16);
  ctx.restore();
}

function drawOuterScale(geom) {
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineCap = "butt";
  ctx.strokeStyle = "#b8c0bb";
  ctx.fillStyle = "#5e6863";
  ctx.font = "10px system-ui";

  const inner = geom.r * 1.045;
  const outer = geom.r * 1.13;
  const labelR = geom.r * 1.18;
  const majorLabelR = geom.r * 1.235;

  circlePath(geom.cx, geom.cy, inner);
  ctx.lineWidth = 1;
  ctx.stroke();
  circlePath(geom.cx, geom.cy, outer);
  ctx.stroke();

  for (let i = 0; i < 100; i += 1) {
    const value = i * 0.005;
    const angleGenerator = Math.PI - 4 * Math.PI * value;
    const tick = i % 10 === 0 ? 13 : i % 5 === 0 ? 9 : 5;
    drawScaleTick(geom, angleGenerator, outer - tick, outer, i % 10 === 0 ? 1.2 : 0.8);

    if (i % 10 === 0) {
      drawScaleText(geom, angleGenerator, majorLabelR, formatScale(value), "#3f4944", "11px system-ui");
    } else if (i % 5 === 0) {
      drawScaleText(geom, angleGenerator, labelR, formatScale(value), "#707a75", "9px system-ui");
    }
  }

  ctx.font = "12px system-ui";
  ctx.fillStyle = "#38423d";
  ctx.fillText("wavelengths toward generator", geom.cx, geom.cy - geom.r * 1.31);
  ctx.fillStyle = "#6c7671";
  ctx.fillText("clockwise; toward load is the opposite direction", geom.cx, geom.cy + geom.r * 1.31);
  ctx.restore();
}

function drawScaleTick(geom, theta, r1, r2, width) {
  const p1 = {
    x: geom.cx + Math.cos(theta) * r1,
    y: geom.cy - Math.sin(theta) * r1,
  };
  const p2 = {
    x: geom.cx + Math.cos(theta) * r2,
    y: geom.cy - Math.sin(theta) * r2,
  };
  ctx.save();
  ctx.strokeStyle = "#aeb7b1";
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.stroke();
  ctx.restore();
}

function drawScaleText(geom, theta, radius, text, color, font) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, geom.cx + Math.cos(theta) * radius, geom.cy - Math.sin(theta) * radius);
  ctx.restore();
}

function drawRadialGuide(mark, geom) {
  const shown = displayGamma(mark.gamma);
  if (abs(shown) < EPS) return;
  const theta = angle(shown);
  const endR = geom.r * 1.14;
  const end = {
    x: geom.cx + Math.cos(theta) * endR,
    y: geom.cy - Math.sin(theta) * endR,
  };
  const point = screenFromVisibleGamma(shown, geom);

  ctx.save();
  ctx.strokeStyle = mark.color || colors.guide;
  ctx.globalAlpha = 0.4;
  ctx.setLineDash([5, 5]);
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(geom.cx, geom.cy);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
  ctx.fillStyle = mark.color;
  ctx.beginPath();
  ctx.arc(point.x, point.y, 3, 0, TAU);
  ctx.fill();
  ctx.restore();
  drawRadialTipLabel(mark.gamma, geom, mark.color || colors.guide);
}

function drawCurrentRadialGuide(geom) {
  if (!state.currentGamma || abs(state.currentGamma) < EPS) return;
  const shown = displayGamma(state.currentGamma);
  const theta = angle(shown);
  const point = screenFromVisibleGamma(shown, geom);
  const outer = {
    x: geom.cx + Math.cos(theta) * geom.r * 1.18,
    y: geom.cy - Math.sin(theta) * geom.r * 1.18,
  };

  ctx.save();
  ctx.strokeStyle = "#111817";
  ctx.lineWidth = 2.1;
  ctx.setLineDash([7, 5]);
  ctx.beginPath();
  ctx.moveTo(geom.cx, geom.cy);
  ctx.lineTo(outer.x, outer.y);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = "#111817";
  ctx.beginPath();
  ctx.arc(geom.cx, geom.cy, 4, 0, TAU);
  ctx.fill();

  ctx.strokeStyle = "#111817";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(point.x, point.y, 11, 0, TAU);
  ctx.stroke();
  ctx.restore();
  drawRadialTipLabel(state.currentGamma, geom, "#111817");
}

function drawRadialTipLabel(gamma, geom, color, lane = 0) {
  const shown = displayGamma(gamma);
  if (abs(shown) < EPS) return;
  const theta = angle(shown);
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const baseR = geom.r * (1.22 + lane * 0.045);
  const x = geom.cx + cos * baseR;
  const y = geom.cy - sin * baseR;
  const text = `${formatScaleExact(generatorScaleValue(gamma))}λ`;
  if (tipLabelsDrawn.has(text)) return;
  tipLabelsDrawn.add(text);
  const padX = 5;

  ctx.save();
  ctx.font = "700 11px system-ui";
  const labelWidth = ctx.measureText(text).width + padX * 2;
  const labelHeight = 17;
  ctx.textBaseline = "middle";
  ctx.textAlign = cos > 0.28 ? "left" : cos < -0.28 ? "right" : "center";

  const boxX = ctx.textAlign === "left" ? x - padX : ctx.textAlign === "right" ? x - labelWidth + padX : x - labelWidth / 2;
  const boxY = y - labelHeight / 2;
  ctx.fillStyle = "rgba(255, 255, 255, 0.86)";
  ctx.strokeStyle = "rgba(185, 199, 207, 0.72)";
  ctx.lineWidth = 1;
  roundedRect(boxX, boxY, labelWidth, labelHeight, 5);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = color;
  ctx.fillText(text, x, y + 0.5);
  ctx.restore();
}

function roundedRect(x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
}

function drawPath(points, geom, color, style = "solid", width = 2) {
  if (!points || points.length < 2) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  if (style === "dash") ctx.setLineDash([9, 7]);
  ctx.beginPath();
  let started = false;
  for (const gamma of points) {
    if (abs(gamma) > 1.02 || !Number.isFinite(gamma.re) || !Number.isFinite(gamma.im)) {
      started = false;
      continue;
    }
    const p = screenFromGamma(gamma, geom);
    if (!started) {
      ctx.moveTo(p.x, p.y);
      started = true;
    } else {
      ctx.lineTo(p.x, p.y);
    }
  }
  ctx.stroke();
  ctx.restore();
}

function drawVisiblePath(points, geom, color, style = "solid", width = 2) {
  if (!points || points.length < 2) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  if (style === "dash") ctx.setLineDash([9, 7]);
  ctx.beginPath();
  let started = false;
  for (const gamma of points) {
    if (abs(gamma) > 1.02 || !Number.isFinite(gamma.re) || !Number.isFinite(gamma.im)) {
      started = false;
      continue;
    }
    const p = screenFromVisibleGamma(gamma, geom);
    if (!started) {
      ctx.moveTo(p.x, p.y);
      started = true;
    } else {
      ctx.lineTo(p.x, p.y);
    }
  }
  ctx.stroke();
  ctx.restore();
}

function drawMark(mark, geom) {
  const p = screenFromGamma(mark.gamma, geom);
  ctx.save();
  ctx.fillStyle = mark.color;
  ctx.beginPath();
  ctx.arc(p.x, p.y, 7, 0, TAU);
  ctx.fill();
  ctx.font = "bold 14px system-ui";
  ctx.textAlign = "left";
  ctx.fillText(mark.label, p.x + (mark.dx ?? 14), p.y + (mark.dy ?? -12));
  ctx.restore();
}

function line(x1, y1, x2, y2, color, width) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.restore();
}

function circlePath(x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
}

function refreshIntersectionList() {
  intersectionList.innerHTML = "";
  state.intersections.forEach((gamma, i) => {
    const opt = document.createElement("option");
    const z = zFromGamma(gamma);
    const y = yFromGamma(gamma);
    opt.textContent = `I${i + 1}: z=${fmt(z)}, y=${fmt(y)}`;
    opt.value = String(i + 1);
    intersectionList.append(opt);
  });
}

document.querySelector("#setDomain").addEventListener("click", () => withHistory(() => {
  state.domain = document.querySelector("#domain").value;
  say(`chart domain is now ${state.domain === "z" ? "impedance z" : "admittance y"}`);
}));

document.querySelector("#plotPoint").addEventListener("click", () => withHistory(() => {
  const kind = document.querySelector("#pointKind").value;
  const value = parseComplex(document.querySelector("#pointValue").value);
  const label = document.querySelector("#pointLabel").value.trim() || `${kind}=${fmt(value)}`;
  const gamma = gammaFromQuantity(kind, value);
  state.currentGamma = gamma;
  state.currentLabel = label;
  state.marks.push({ gamma, label, color: colors.red, dx: 14, dy: -12 });
  say(printPoint("current", gamma));
  say(`plotted ${label}`);
}));

document.querySelector("#drawVswr").addEventListener("click", () => withHistory(() => {
  if (!state.currentGamma) throw new Error("plot a point first");
  state.swrRadius = abs(state.currentGamma);
  const points = [];
  for (let i = 0; i < 900; i += 1) points.push(mul(c(state.swrRadius), expj((TAU * i) / 899)));
  state.paths.push({ points, label: `VSWR |Gamma|=${formatNumber(state.swrRadius, 4)}`, color: colors.orange, style: "dash" });
  say(`VSWR circle: |Gamma|=${formatNumber(state.swrRadius, 6)}, VSWR=${formatNumber(vswr(state.swrRadius), 6)}`);
}));

document.querySelector("#findIntersections").addEventListener("click", () => withHistory(() => {
  if (!state.currentGamma) throw new Error("plot a point first");
  const kind = document.querySelector("#targetKind").value;
  const value = Number(document.querySelector("#targetValue").value);
  const radius = state.swrRadius ?? abs(state.currentGamma);
  const roots = findIntersections(radius, kind, value);
  state.intersections = roots;
  state.paths.push({ points: curveForTarget(kind, value), label: `${kind}=${value}`, color: colors.blue, style: "solid" });
  roots.forEach((gamma, index) => {
    state.marks.push({ gamma, label: `I${index + 1}: ${kind}=${value}`, color: colors.blue, dx: 14, dy: index % 2 ? 24 : -12 });
  });
  refreshIntersectionList();
  say(`found ${roots.length} intersection(s)`);
  roots.forEach((gamma, index) => {
    const gen = lengthLambda(state.currentGamma, gamma, "generator");
    const load = lengthLambda(state.currentGamma, gamma, "load");
    say(`${printPoint(`I${index + 1}`, gamma)} | generator ${gen.toFixed(6)} lambda | load ${load.toFixed(6)} lambda`);
  });
}));

document.querySelector("#intersectionList").addEventListener("change", () => {
  const value = intersectionList.value;
  if (value) document.querySelector("#gotoIndex").value = value;
});

document.querySelector("#goToIntersection").addEventListener("click", () => withHistory(() => {
  if (!state.currentGamma) throw new Error("plot a point first");
  const index = Number(document.querySelector("#gotoIndex").value);
  const direction = document.querySelector("#gotoDirection").value;
  const target = state.intersections[index - 1];
  if (!target) throw new Error("choose a valid intersection");
  const length = lengthLambda(state.currentGamma, target, direction);
  const points = arcBetween(state.currentGamma, target, direction);
  state.paths.push({ points, label: `${direction}: ${length.toFixed(4)} lambda`, color: colors.purple, style: "solid" });
  state.currentGamma = target;
  state.currentLabel = `I${index}`;
  state.marks.push({ gamma: target, label: `current = I${index}`, color: colors.purple, dx: 14, dy: 24 });
  say(`moved to I${index}: ${length.toFixed(6)} lambda toward ${direction}`);
  say(printPoint("current", target));
}));

document.querySelector("#roll").addEventListener("click", () => withHistory(() => {
  if (!state.currentGamma) throw new Error("plot a point first");
  const direction = document.querySelector("#rollDirection").value;
  const length = Number(document.querySelector("#rollLength").value);
  const phase = direction === "generator" ? -4 * Math.PI * length : 4 * Math.PI * length;
  const target = mul(state.currentGamma, expj(phase));
  const points = arcBetween(state.currentGamma, target, direction);
  state.paths.push({ points, label: `${direction}: ${length.toFixed(4)} lambda`, color: colors.purple, style: "solid" });
  state.currentGamma = target;
  state.marks.push({ gamma: target, label: `rolled ${length.toFixed(4)} lambda`, color: colors.purple, dx: 14, dy: 24 });
  say(`rolled ${length.toFixed(6)} lambda toward ${direction}`);
  say(printPoint("current", target));
}));

document.querySelector("#drawStub").addEventListener("click", () => withHistory(() => {
  const stubType = document.querySelector("#stubType").value;
  const kind = document.querySelector("#stubKind").value;
  const value = parseComplex(document.querySelector("#stubValue").value);
  const zStub = kind === "z" ? value : inv(value);
  const yStub = kind === "y" ? value : inv(value);
  let length;
  if (stubType === "short") {
    let theta = Math.atan(zStub.im);
    if (theta < 0) theta += Math.PI;
    length = theta / TAU;
  } else {
    let theta = Math.atan2(-1, zStub.im);
    if (theta < 0) theta += Math.PI;
    length = theta / TAU;
  }
  const points = stubImpedancePath(stubType, length);
  state.paths.push({ points, label: `${stubType} stub: ${length.toFixed(4)} lambda`, color: colors.green, style: "solid" });
  state.marks.push({ gamma: points[points.length - 1], label: `z_stub=${fmt(zStub)}\nl=${length.toFixed(4)} lambda`, color: colors.green, dx: 14, dy: -24 });
  say(`${stubType} stub: z_stub=${fmt(zStub)}, y_stub=${fmt(yStub)}, length=${length.toFixed(6)} lambda`);
}));

document.querySelector("#undo").addEventListener("click", () => {
  const snap = state.history.pop();
  if (!snap) {
    say("nothing to undo");
    return;
  }
  restore(snap);
  say("undo");
});

document.querySelector("#clearCurves").addEventListener("click", () => withHistory(() => {
  state.paths = [];
  state.swrRadius = null;
  say("cleared curves");
}));

document.querySelector("#clearMarks").addEventListener("click", () => withHistory(() => {
  state.marks = [];
  say("cleared marks");
}));

document.querySelector("#clearIntersections").addEventListener("click", () => withHistory(() => {
  state.intersections = [];
  state.marks = state.marks.filter((m) => !(m.color === colors.blue && m.label.startsWith("I")));
  state.paths = state.paths.filter((p) => !(p.color === colors.blue));
  refreshIntersectionList();
  say("cleared intersections");
}));

document.querySelector("#clearAll").addEventListener("click", () => withHistory(() => {
  state.currentGamma = null;
  state.currentLabel = "current";
  state.swrRadius = null;
  state.marks = [];
  state.paths = [];
  state.intersections = [];
  refreshIntersectionList();
  say("cleared chart");
}));

window.addEventListener("resize", render);
render();
