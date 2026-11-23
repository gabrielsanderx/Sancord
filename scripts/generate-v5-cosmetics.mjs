/**
 * Sanvo V5 Cosmetic Art Studio — Renderiza assets pintados HiDPI RGBA em Chromium (Edge headless)
 * e gera sprites WebP otimizados + folha de inspeção visual para validação pixel a pixel.
 */
import http from 'http';
import fs from 'fs';
import path from 'path';
import { spawn, execFileSync } from 'child_process';

const ROOT = 'd:\\Sancord';
const OUT_DIR = path.join(ROOT, 'static', 'cosmetics', 'assets');
const RAW_DIR = 'C:\\Users\\gabri\\.gemini\\antigravity\\brain\\639e93b4-dc25-4b1f-b1eb-a0819523d71b\\scratch\\v5_raw';
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(RAW_DIR, { recursive: true });

const STUDIO_HTML = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Sanvo V5 Art Studio</title></head>
<body style="margin:0;background:transparent;">
<canvas id="c" width="1024" height="1024"></canvas>
<script>
// ============================================================================
// Utilitários de Pintura Digital (PBR-like shading, bevels, facets, petals, fur)
// ============================================================================
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function newCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

// Estrela de 4 pontas esculpida com brilho interno e halo macio
function drawSculptedStar(ctx, x, y, r, colorCore = '#ffffff', colorGlow = '#fde68a', rot = 0, alpha = 1) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.globalAlpha = alpha;
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 2.2);
  g.addColorStop(0, colorCore);
  g.addColorStop(0.25, colorGlow);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, r * 2.2, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = colorCore;
  ctx.beginPath();
  const ir = r * 0.16;
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    const rad = i % 2 === 0 ? r : ir;
    const px = Math.cos(a) * rad, py = Math.sin(a) * rad;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// Gema lapidada multi-facetada (safira, ametista, rubi, gelo, ciano)
function drawFacetedGem(ctx, x, y, rx, ry, rot, palette) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  // Bezel metálico ao redor
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.65)';
  ctx.shadowBlur = rx * 0.45;
  ctx.shadowOffsetY = rx * 0.15;
  const bezelG = ctx.createLinearGradient(-rx, -ry, rx, ry);
  bezelG.addColorStop(0, palette.bezelLight || '#fff2c2');
  bezelG.addColorStop(0.45, palette.bezelMid || '#d4a13c');
  bezelG.addColorStop(1, palette.bezelDark || '#5c3c0e');
  ctx.fillStyle = bezelG;
  ctx.beginPath();
  ctx.ellipse(0, 0, rx * 1.22, ry * 1.22, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Base escura da gema
  const baseG = ctx.createRadialGradient(-rx * 0.25, -ry * 0.3, rx * 0.05, 0, 0, Math.max(rx, ry));
  baseG.addColorStop(0, palette.bright);
  baseG.addColorStop(0.55, palette.mid);
  baseG.addColorStop(1, palette.deep);
  ctx.fillStyle = baseG;
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();

  // Facetas internas lapidadas
  const pts = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    pts.push([Math.cos(a) * rx, Math.sin(a) * ry]);
  }
  const inner = pts.map(([px, py]) => [px * 0.54, py * 0.54]);
  for (let i = 0; i < 8; i++) {
    const n = (i + 1) % 8;
    ctx.beginPath();
    ctx.moveTo(pts[i][0], pts[i][1]);
    ctx.lineTo(pts[n][0], pts[n][1]);
    ctx.lineTo(inner[n][0], inner[n][1]);
    ctx.lineTo(inner[i][0], inner[i][1]);
    ctx.closePath();
    const shade = i < 3 ? 'rgba(255,255,255,0.32)' : i < 5 ? 'rgba(255,255,255,0.08)' : 'rgba(8,12,32,0.38)';
    ctx.fillStyle = shade;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = Math.max(1, rx * 0.04);
    ctx.stroke();
  }
  // Mesa central refrativa
  const tableG = ctx.createLinearGradient(-rx * 0.5, -ry * 0.5, rx * 0.5, ry * 0.5);
  tableG.addColorStop(0, 'rgba(255,255,255,0.45)');
  tableG.addColorStop(0.5, palette.glow || 'rgba(120,200,255,0.18)');
  tableG.addColorStop(1, 'rgba(0,0,0,0.15)');
  ctx.fillStyle = tableG;
  ctx.beginPath();
  inner.forEach(([px, py], idx) => idx === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py));
  ctx.closePath();
  ctx.fill();

  // Catchlight especular nítido
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.ellipse(-rx * 0.28, -ry * 0.32, rx * 0.2, ry * 0.12, -0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(rx * 0.26, ry * 0.28, rx * 0.08, 0, Math.PI * 2);
  ctx.fillStyle = palette.bounce || 'rgba(186,230,253,0.85)';
  ctx.fill();
  ctx.restore();
}

// Cristal glacial multi-facetado com fraturas internas e luz refrativa
function drawIceCrystal(ctx, x, y, len, width, angle, flip = false) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  if (flip) ctx.scale(-1, 1);

  ctx.save();
  ctx.shadowColor = 'rgba(14, 165, 233, 0.45)';
  ctx.shadowBlur = width * 0.7;
  // Corpo completo (base -> ombros -> ponta afiada)
  const tipY = -len;
  const shY = -len * 0.72;
  const hw = width * 0.5;
  const baseW = width * 0.38;

  // Faceta esquerda (iluminada)
  const leftG = ctx.createLinearGradient(-hw, tipY, hw * 0.2, 0);
  leftG.addColorStop(0, '#f0f9ff');
  leftG.addColorStop(0.28, '#bae6fd');
  leftG.addColorStop(0.68, '#38bdf8');
  leftG.addColorStop(1, '#0284c7');
  ctx.fillStyle = leftG;
  ctx.beginPath();
  ctx.moveTo(0, tipY);
  ctx.lineTo(-hw, shY);
  ctx.lineTo(-baseW, 0);
  ctx.lineTo(0, width * 0.14);
  ctx.lineTo(0, tipY);
  ctx.closePath();
  ctx.fill();

  // Faceta direita (sombra cobalto profunda com translucidez)
  const rightG = ctx.createLinearGradient(0, tipY, hw, 0);
  rightG.addColorStop(0, '#7dd3fc');
  rightG.addColorStop(0.35, '#0284c7');
  rightG.addColorStop(0.75, '#1e3a8a');
  rightG.addColorStop(1, '#0f172a');
  ctx.fillStyle = rightG;
  ctx.beginPath();
  ctx.moveTo(0, tipY);
  ctx.lineTo(hw, shY * 0.96);
  ctx.lineTo(baseW, 0);
  ctx.lineTo(0, width * 0.14);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // Faceta interna frontal refrativa
  const midG = ctx.createLinearGradient(-hw * 0.35, shY, hw * 0.35, 0);
  midG.addColorStop(0, 'rgba(255,255,255,0.62)');
  midG.addColorStop(0.45, 'rgba(186,230,253,0.18)');
  midG.addColorStop(1, 'rgba(56,189,248,0.42)');
  ctx.fillStyle = midG;
  ctx.beginPath();
  ctx.moveTo(0, tipY * 0.92);
  ctx.lineTo(-hw * 0.42, shY * 0.92);
  ctx.lineTo(-baseW * 0.28, -len * 0.08);
  ctx.lineTo(hw * 0.22, -len * 0.12);
  ctx.lineTo(hw * 0.36, shY * 0.88);
  ctx.closePath();
  ctx.fill();

  // Fraturas internas delicadas
  ctx.strokeStyle = 'rgba(224,242,254,0.5)';
  ctx.lineWidth = Math.max(1, width * 0.032);
  ctx.beginPath();
  ctx.moveTo(-hw * 0.55, shY * 0.72);
  ctx.lineTo(hw * 0.18, shY * 0.48);
  ctx.moveTo(-hw * 0.25, shY * 0.38);
  ctx.lineTo(hw * 0.45, shY * 0.22);
  ctx.stroke();

  // Aresta central especular + borda de luz nítida
  ctx.strokeStyle = 'rgba(255,255,255,0.88)';
  ctx.lineWidth = Math.max(1.2, width * 0.045);
  ctx.beginPath();
  ctx.moveTo(0, tipY);
  ctx.lineTo(0, -len * 0.04);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(240,249,255,0.92)';
  ctx.lineWidth = Math.max(1.2, width * 0.038);
  ctx.beginPath();
  ctx.moveTo(0, tipY);
  ctx.lineTo(-hw, shY);
  ctx.lineTo(-baseW, 0);
  ctx.stroke();

  // Ponta brilhante
  drawSculptedStar(ctx, 0, tipY, width * 0.26, '#ffffff', '#7dd3fc', 0.2, 0.9);
  ctx.restore();
}

// Flor de Sakura pintada em múltiplas camadas (5 pétalas com chanfro, nervuras e estames dourados)
function drawSakuraBlossom(ctx, x, y, radius, rot = 0, shadeShift = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);

  // Sombra suave sob a flor para profundidade 3D
  ctx.save();
  ctx.shadowColor = 'rgba(42, 10, 28, 0.55)';
  ctx.shadowBlur = radius * 0.42;
  ctx.shadowOffsetY = radius * 0.14;
  ctx.fillStyle = 'rgba(42, 10, 28, 0.01)';
  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.78, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  for (let i = 0; i < 5; i++) {
    ctx.save();
    ctx.rotate((i * Math.PI * 2) / 5);
    const pg = ctx.createRadialGradient(0, -radius * 0.1, radius * 0.05, 0, -radius * 0.52, radius * 0.95);
    pg.addColorStop(0, shadeShift > 0 ? '#be185d' : '#db2777');
    pg.addColorStop(0.28, shadeShift > 0 ? '#f472b6' : '#f9a8d4');
    pg.addColorStop(0.72, '#fce7f3');
    pg.addColorStop(1, '#fff8fb');
    ctx.fillStyle = pg;

    // Pétala orgânica com chanfro característico de cerejeira
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(-radius * 0.44, -radius * 0.22, -radius * 0.54, -radius * 0.84, -radius * 0.13, -radius * 0.98);
    ctx.quadraticCurveTo(0, -radius * 0.80, 0, -radius * 0.84);
    ctx.quadraticCurveTo(0, -radius * 0.80, radius * 0.13, -radius * 0.98);
    ctx.bezierCurveTo(radius * 0.54, -radius * 0.84, radius * 0.44, -radius * 0.22, 0, 0);
    ctx.closePath();
    ctx.fill();

    // Borda iluminada pelo sol + sombra de sobreposição lateral
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.78)';
    ctx.lineWidth = Math.max(1, radius * 0.025);
    ctx.stroke();

    // Nervuras delicadas
    ctx.strokeStyle = 'rgba(219, 39, 119, 0.22)';
    ctx.lineWidth = Math.max(0.8, radius * 0.018);
    for (const v of [-0.18, 0, 0.18]) {
      ctx.beginPath();
      ctx.moveTo(0, -radius * 0.1);
      ctx.quadraticCurveTo(radius * v * 0.9, -radius * 0.45, radius * v * 1.4, -radius * 0.76);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Coração rubi profundo
  const coreG = ctx.createRadialGradient(0, 0, 0, 0, 0, radius * 0.26);
  coreG.addColorStop(0, '#831843');
  coreG.addColorStop(0.55, '#be185d');
  coreG.addColorStop(1, 'rgba(219, 39, 119, 0)');
  ctx.fillStyle = coreG;
  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.26, 0, Math.PI * 2);
  ctx.fill();

  // 14 estames curvados com anteras douradas luminosas
  for (let s = 0; s < 14; s++) {
    const a = (s / 14) * Math.PI * 2 + 0.12;
    const sl = radius * (0.26 + (s % 3) * 0.075);
    const cx = Math.cos(a + 0.14) * sl * 0.58;
    const cy = Math.sin(a + 0.14) * sl * 0.58;
    const ex = Math.cos(a) * sl;
    const ey = Math.sin(a) * sl;
    ctx.strokeStyle = 'rgba(255, 232, 240, 0.88)';
    ctx.lineWidth = Math.max(0.9, radius * 0.02);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(cx, cy, ex, ey);
    ctx.stroke();

    const ag = ctx.createRadialGradient(ex - 0.8, ey - 0.8, 0, ex, ey, radius * 0.055);
    ag.addColorStop(0, '#fffbeb');
    ag.addColorStop(0.55, '#fbbf24');
    ag.addColorStop(1, '#b45309');
    ctx.fillStyle = ag;
    ctx.beginPath();
    ctx.arc(ex, ey, Math.max(1.6, radius * 0.048), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// Pétala individual pintada para sprites e partículas
function drawSingleSakuraPetal(ctx, x, y, size, rot = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.shadowColor = 'rgba(80, 14, 48, 0.35)';
  ctx.shadowBlur = size * 0.25;
  const g = ctx.createLinearGradient(-size * 0.6, -size, size * 0.6, size);
  g.addColorStop(0, '#fff8fb');
  g.addColorStop(0.45, '#fbcfe8');
  g.addColorStop(0.85, '#f472b6');
  g.addColorStop(1, '#db2777');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(0, size * 0.82);
  ctx.bezierCurveTo(-size * 0.68, size * 0.35, -size * 0.72, -size * 0.62, -size * 0.16, -size * 0.92);
  ctx.quadraticCurveTo(0, -size * 0.64, size * 0.16, -size * 0.92);
  ctx.bezierCurveTo(size * 0.72, -size * 0.62, size * 0.68, size * 0.35, 0, size * 0.82);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.72)';
  ctx.lineWidth = Math.max(1, size * 0.035);
  ctx.stroke();
  ctx.restore();
}

// Galho de cerejeira texturizado com casca, nós e luz de borda
function drawCherryBranch(ctx, points, startW, endW) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // Desenha segmentos interpolados com afinamento real
  const steps = 60;
  function sample(t) {
    const seg = t * (points.length - 1);
    const i = Math.min(points.length - 2, Math.floor(seg));
    const f = seg - i;
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    // Catmull-Rom suave
    const f2 = f * f, f3 = f2 * f;
    const x = 0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * f + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * f2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * f3);
    const y = 0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * f + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * f2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * f3);
    return [x, y];
  }
  const curve = [];
  for (let s = 0; s <= steps; s++) curve.push(sample(s / steps));

  // Sombra base
  ctx.save();
  ctx.shadowColor = 'rgba(20, 6, 18, 0.65)';
  ctx.shadowBlur = startW * 0.9;
  ctx.shadowOffsetY = startW * 0.25;
  for (let s = 0; s < steps; s++) {
    const t = s / steps;
    const w = startW * (1 - t) + endW * t;
    ctx.strokeStyle = '#3b1c26';
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(curve[s][0], curve[s][1]);
    ctx.lineTo(curve[s + 1][0], curve[s + 1][1]);
    ctx.stroke();
  }
  ctx.restore();

  // Miolo amadeirado quente + borda superior iluminada rosa-cobre
  for (let s = 0; s < steps; s++) {
    const t = s / steps;
    const w = startW * (1 - t) + endW * t;
    const [x1, y1] = curve[s], [x2, y2] = curve[s + 1];
    ctx.strokeStyle = '#5d2b36';
    ctx.lineWidth = w * 0.72;
    ctx.beginPath();
    ctx.moveTo(x1, y1 - w * 0.08);
    ctx.lineTo(x2, y2 - w * 0.08);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(244, 162, 188, 0.36)';
    ctx.lineWidth = Math.max(1.5, w * 0.22);
    ctx.beginPath();
    ctx.moveTo(x1, y1 - w * 0.26);
    ctx.lineTo(x2, y2 - w * 0.26);
    ctx.stroke();
  }
  ctx.restore();
}

// ============================================================================
// COLEÇÃO 1: ASTRALIUM (Astrolábio Celestial — BACK, FRONT, FX)
// Avatar ocupa círculo central r = 345px (diâmetro 690px em 1024px)
// ============================================================================
function renderAstralBack() {
  const c = newCanvas(1024, 1024), ctx = c.getContext('2d');
  const cx = 512, cy = 512, R = 352;
  const rng = mulberry32(4201);

  // 1. Nebulosa volumétrica profunda orbitando atrás do avatar
  for (let i = 0; i < 42; i++) {
    const ang = (i / 42) * Math.PI * 2 + rng() * 0.25;
    const dist = R * (0.94 + rng() * 0.22);
    const px = cx + Math.cos(ang) * dist;
    const py = cy + Math.sin(ang) * dist;
    const rad = 55 + rng() * 95;
    const g = ctx.createRadialGradient(px, py, 0, px, py, rad);
    const colors = [
      ['rgba(99,102,241,0.34)', 'rgba(67,56,202,0.12)'],
      ['rgba(168,85,247,0.28)', 'rgba(107,33,168,0.08)'],
      ['rgba(56,189,248,0.24)', 'rgba(14,116,144,0.06)'],
      ['rgba(244,114,182,0.18)', 'rgba(131,24,67,0.04)'],
    ][i % 4];
    g.addColorStop(0, colors[0]);
    g.addColorStop(0.55, colors[1]);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(px, py, rad, 0, Math.PI * 2);
    ctx.fill();
  }

  // 2. Anel armilar elíptico traseiro inclinado em 3D (atrás do avatar)
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-0.42);
  ctx.scale(1.18, 0.88);
  const ringG = ctx.createLinearGradient(-R, -R, R, R);
  ringG.addColorStop(0, '#5c3d0e');
  ringG.addColorStop(0.35, '#d4a13c');
  ringG.addColorStop(0.55, '#fef3c7');
  ringG.addColorStop(0.8, '#92611b');
  ringG.addColorStop(1, '#452b08');
  ctx.strokeStyle = ringG;
  ctx.lineWidth = 14;
  ctx.shadowColor = 'rgba(251, 191, 36, 0.35)';
  ctx.shadowBlur = 18;
  ctx.beginPath();
  ctx.arc(0, 0, R + 32, 0, Math.PI * 2);
  ctx.stroke();

  // Graduações astronômicas gravadas no anel traseiro
  ctx.strokeStyle = 'rgba(255, 248, 220, 0.65)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2;
    const len = i % 5 === 0 ? 14 : 7;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * (R + 24), Math.sin(a) * (R + 24));
    ctx.lineTo(Math.cos(a) * (R + 24 + len), Math.sin(a) * (R + 24 + len));
    ctx.stroke();
  }
  ctx.restore();

  // 3. Poeira estelar distante
  for (let i = 0; i < 55; i++) {
    const a = rng() * Math.PI * 2;
    const d = R * (0.98 + rng() * 0.34);
    drawSculptedStar(ctx, cx + Math.cos(a) * d, cy + Math.sin(a) * d, 3 + rng() * 9, '#fffbeb', '#93c5fd', rng(), 0.55 + rng() * 0.45);
  }
  return c;
}

function renderAstralFront() {
  const c = newCanvas(1024, 1024), ctx = c.getContext('2d');
  const cx = 512, cy = 512, R = 354;

  // 1. Aro astrolábio principal esculpido em latão envelhecido com chanfro duplo
  ctx.save();
  ctx.shadowColor = 'rgba(6, 8, 24, 0.72)';
  ctx.shadowBlur = 22;
  ctx.shadowOffsetY = 8;
  // Base bronze escura
  ctx.strokeStyle = '#3b2408';
  ctx.lineWidth = 34;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // Camada principal metálica com luz direcional
  const brass = ctx.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
  brass.addColorStop(0, '#fff7d6');
  brass.addColorStop(0.22, '#e8b954');
  brass.addColorStop(0.48, '#9b671b');
  brass.addColorStop(0.72, '#f5d47a');
  brass.addColorStop(1, '#58370a');
  ctx.strokeStyle = brass;
  ctx.lineWidth = 24;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.stroke();

  // Sulco escuro interno + fio de luz dourado
  ctx.strokeStyle = 'rgba(34, 18, 4, 0.72)';
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(255, 250, 225, 0.78)';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(cx, cy, R - 10, -Math.PI * 0.9, Math.PI * 0.15);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, R + 10, -Math.PI * 0.85, Math.PI * 0.25);
  ctx.stroke();

  // 72 marcações de grau gravadas ao redor do astrolábio
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2;
    const major = i % 6 === 0;
    ctx.strokeStyle = major ? 'rgba(255, 245, 200, 0.85)' : 'rgba(255, 224, 150, 0.35)';
    ctx.lineWidth = major ? 2.8 : 1.4;
    const r0 = R - (major ? 10 : 6);
    const r1 = R + (major ? 10 : 6);
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
    ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
    ctx.stroke();
  }

  // 2. Filigrana dourada assimétrica saindo da silhueta (topo esquerdo e base direita)
  function drawFiligreeWing(startAng, dir) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(startAng);
    const fg = ctx.createLinearGradient(0, -R - 70, 120 * dir, -R + 30);
    fg.addColorStop(0, '#fff7d6');
    fg.addColorStop(0.5, '#e2ae48');
    fg.addColorStop(1, '#714710');
    ctx.strokeStyle = fg;
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 12;
    ctx.lineCap = 'round';
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(0, -R);
    ctx.bezierCurveTo(65 * dir, -R - 22, 130 * dir, -R - 70, 175 * dir, -R - 18);
    ctx.stroke();
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(35 * dir, -R - 14);
    ctx.bezierCurveTo(85 * dir, -R - 64, 145 * dir, -R - 86, 198 * dir, -R - 58);
    ctx.stroke();
    ctx.restore();
  }
  drawFiligreeWing(-0.68, -1);
  drawFiligreeWing(-0.68, 1);
  drawFiligreeWing(2.45, -1);
  drawFiligreeWing(2.45, 1);

  // 3. HERO: Meia-Lua Esculpida 3D no topo esquerdo ultrapassando a borda do avatar!
  ctx.save();
  ctx.translate(cx - 245, cy - 245);
  ctx.rotate(-0.55);
  ctx.shadowColor = 'rgba(4, 6, 22, 0.78)';
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 10;
  // Corpo da meia-lua
  const moonG = ctx.createLinearGradient(-95, -110, 95, 110);
  moonG.addColorStop(0, '#fffbeb');
  moonG.addColorStop(0.32, '#fde68a');
  moonG.addColorStop(0.68, '#d9982c');
  moonG.addColorStop(1, '#6c420b');
  ctx.fillStyle = moonG;
  ctx.beginPath();
  ctx.arc(0, 0, 118, 0.55, Math.PI * 2 - 0.55, false);
  ctx.arc(46, 0, 92, Math.PI * 2 - 0.72, 0.72, true);
  ctx.closePath();
  ctx.fill();

  // Relevo interno chanfrado da lua
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(104, 60, 10, 0.65)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(-8, 0, 102, 0.85, Math.PI * 2 - 0.85, false);
  ctx.stroke();
  ctx.restore();

  // 4. Safira lapidada principal engastada na junção da lua + gemas menores cardinais
  const sapphire = { bright: '#bae6fd', mid: '#2563eb', deep: '#172554', glow: 'rgba(125,211,252,0.45)', bounce: '#93c5fd' };
  const amethyst = { bright: '#f5d0fe', mid: '#9333ea', deep: '#3b0764', glow: 'rgba(232,121,249,0.4)', bounce: '#e879f9' };
  drawFacetedGem(ctx, cx - 228, cy - 230, 34, 42, -0.55, sapphire);
  drawFacetedGem(ctx, cx + 252, cy + 250, 28, 34, 0.78, amethyst);
  drawFacetedGem(ctx, cx + 292, cy - 196, 17, 22, 0.45, sapphire);
  drawFacetedGem(ctx, cx - 284, cy + 206, 16, 20, -0.45, amethyst);

  // 5. Pingentes estelares pendentes na base direita
  ctx.save();
  ctx.strokeStyle = '#f5d47a';
  ctx.lineWidth = 3.2;
  const chains = [
    [cx + 210, cy + 286, 56, 16],
    [cx + 270, cy + 235, 88, 22],
    [cx + 318, cy + 178, 52, 14],
  ];
  for (const [sx, sy, len, starR] of chains) {
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx, sy + len);
    ctx.stroke();
    // Contas douradas na corrente
    for (let k = 1; k <= 3; k++) {
      ctx.fillStyle = '#fef08a';
      ctx.beginPath();
      ctx.arc(sx, sy + (len * k) / 4, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
    // Pingente estrela metálica
    ctx.save();
    ctx.translate(sx, sy + len + starR * 0.45);
    ctx.shadowColor = 'rgba(251,191,36,0.75)';
    ctx.shadowBlur = 14;
    const sg = ctx.createLinearGradient(-starR, -starR, starR, starR);
    sg.addColorStop(0, '#ffffff');
    sg.addColorStop(0.45, '#fde047');
    sg.addColorStop(1, '#a16207');
    ctx.fillStyle = sg;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      const rr = i % 2 === 0 ? starR : starR * 0.34;
      const px = Math.cos(a) * rr, py = Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();

  // Brilhos especulares finais
  drawSculptedStar(ctx, cx - 285, cy - 310, 26, '#ffffff', '#fde68a', 0.1, 0.95);
  drawSculptedStar(ctx, cx + 310, cy - 245, 20, '#ffffff', '#93c5fd', 0.3, 0.9);
  drawSculptedStar(ctx, cx + 268, cy + 335, 22, '#ffffff', '#f5d0fe', 0.15, 0.9);
  return c;
}

// ============================================================================
// COLEÇÃO 2: HANAMI (Ramo de Cerejeira Pintado — BACK, FRONT, PETAL SPRITE)
// ============================================================================
function renderSakuraBack() {
  const c = newCanvas(1024, 1024), ctx = c.getContext('2d');
  const cx = 512, cy = 512, R = 354;

  // Aura quente suave de entardecer atrás da foto
  const aura = ctx.createRadialGradient(cx, cy, R * 0.82, cx, cy, R * 1.32);
  aura.addColorStop(0, 'rgba(244,114,182,0.22)');
  aura.addColorStop(0.55, 'rgba(251,207,232,0.14)');
  aura.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = aura;
  ctx.beginPath();
  ctx.arc(cx, cy, R * 1.32, 0, Math.PI * 2);
  ctx.fill();

  // Fita de seda rosa-dourada fluindo atrás pela direita e base esquerda
  ctx.save();
  ctx.shadowColor = 'rgba(90, 18, 52, 0.45)';
  ctx.shadowBlur = 18;
  const silkG = ctx.createLinearGradient(cx + 220, cy - 280, cx + 340, cy + 360);
  silkG.addColorStop(0, '#fbcfe8');
  silkG.addColorStop(0.35, '#f472b6');
  silkG.addColorStop(0.65, '#fde68a');
  silkG.addColorStop(1, '#be185d');
  ctx.strokeStyle = silkG;
  ctx.lineWidth = 26;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx + 150, cy - 340);
  ctx.bezierCurveTo(cx + 420, cy - 220, cx + 440, cy + 120, cx + 340, cy + 370);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,250,240,0.65)';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(cx + 154, cy - 344);
  ctx.bezierCurveTo(cx + 412, cy - 224, cx + 432, cy + 116, cx + 334, cy + 366);
  ctx.stroke();

  // Segunda fita fina
  ctx.strokeStyle = 'rgba(253, 224, 71, 0.72)';
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(cx - 320, cy + 180);
  ctx.bezierCurveTo(cx - 420, cy + 280, cx - 260, cy + 435, cx - 100, cy + 420);
  ctx.stroke();
  ctx.restore();

  // Galho traseiro principal que nasce atrás do avatar e sai pelo topo
  drawCherryBranch(ctx, [
    [cx - 395, cy + 195],
    [cx - 385, cy - 45],
    [cx - 285, cy - 275],
    [cx - 40, cy - 392],
    [cx + 215, cy - 355],
    [cx + 390, cy - 210],
  ], 34, 10);

  // Subgalho traseiro direito
  drawCherryBranch(ctx, [
    [cx + 170, cy - 360],
    [cx + 315, cy - 400],
    [cx + 435, cy - 345],
  ], 16, 6);

  // Flores de fundo (atrás da borda do avatar)
  drawSakuraBlossom(ctx, cx - 355, cy - 160, 68, -0.4, 1);
  drawSakuraBlossom(ctx, cx + 355, cy - 235, 72, 0.5, 1);
  drawSakuraBlossom(ctx, cx + 265, cy - 385, 62, 0.2, 1);
  drawSakuraBlossom(ctx, cx - 150, cy - 395, 66, -0.2, 1);
  drawSakuraBlossom(ctx, cx - 372, cy + 145, 58, 0.8, 1);
  return c;
}

function renderSakuraFront() {
  const c = newCanvas(1024, 1024), ctx = c.getContext('2d');
  const cx = 512, cy = 512, R = 352;

  // Aro delicado dourado-rosé atrás das flores frontais
  const roseGold = ctx.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
  roseGold.addColorStop(0, '#fff1f2');
  roseGold.addColorStop(0.3, '#f9a8d4');
  roseGold.addColorStop(0.6, '#d97757');
  roseGold.addColorStop(1, '#831843');
  ctx.save();
  ctx.shadowColor = 'rgba(42, 8, 28, 0.6)';
  ctx.shadowBlur = 16;
  ctx.strokeStyle = roseGold;
  ctx.lineWidth = 11;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // Ramo frontal esculpido que abraça a borda superior esquerda e avança sobre o aro
  drawCherryBranch(ctx, [
    [cx - 360, cy + 25],
    [cx - 348, cy - 155],
    [cx - 215, cy - 312],
    [cx - 10, cy - 356],
    [cx + 185, cy - 315],
  ], 26, 8);

  // Pequeno ramo inferior direito para equilibrar assimetricamente
  drawCherryBranch(ctx, [
    [cx + 352, cy + 115],
    [cx + 286, cy + 262],
    [cx + 148, cy + 345],
  ], 18, 7);

  // Folhinhas outonais/borgonha (nunca verde chapado!)
  function drawBurgundyLeaf(x, y, size, ang) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    const lg = ctx.createLinearGradient(0, -size, 0, size);
    lg.addColorStop(0, '#fda4af');
    lg.addColorStop(0.45, '#9f1239');
    lg.addColorStop(1, '#4c0519');
    ctx.fillStyle = lg;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(size * 0.48, -size * 0.42, 0, -size);
    ctx.quadraticCurveTo(-size * 0.48, -size * 0.42, 0, 0);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,228,230,0.45)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(0, -2); ctx.lineTo(0, -size * 0.85);
    ctx.stroke();
    ctx.restore();
  }
  drawBurgundyLeaf(cx - 285, cy - 275, 58, -0.9);
  drawBurgundyLeaf(cx + 85, cy - 365, 52, 0.5);
  drawBurgundyLeaf(cx + 322, cy + 205, 48, 2.1);
  drawBurgundyLeaf(cx - 342, cy - 55, 46, -1.6);

  // Botões fechados de cerejeira
  function drawBud(x, y, s, a) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    const bg = ctx.createRadialGradient(-s * 0.2, -s * 0.5, 2, 0, -s * 0.4, s);
    bg.addColorStop(0, '#ffe4e6');
    bg.addColorStop(0.6, '#f43f5e');
    bg.addColorStop(1, '#881337');
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(-s * 0.55, -s * 0.25, -s * 0.42, -s * 0.92, 0, -s * 1.15);
    ctx.bezierCurveTo(s * 0.42, -s * 0.92, s * 0.55, -s * 0.25, 0, 0);
    ctx.fill();
    ctx.restore();
  }
  drawBud(cx - 110, cy - 365, 28, -0.3);
  drawBud(cx + 240, cy - 285, 26, 0.8);
  drawBud(cx + 128, cy + 356, 24, 2.5);

  // Flores heroicas de primeiro plano (ricas, sobrepondo levemente a borda do avatar!)
  drawSakuraBlossom(ctx, cx - 225, cy - 285, 92, -0.25, 0);
  drawSakuraBlossom(ctx, cx - 325, cy - 172, 70, 0.42, 0);
  drawSakuraBlossom(ctx, cx - 65, cy - 348, 78, 0.18, 0);
  drawSakuraBlossom(ctx, cx + 118, cy - 322, 86, -0.42, 0);
  drawSakuraBlossom(ctx, cx + 225, cy - 248, 56, 0.65, 0);

  // Cluster assimétrico na base direita
  drawSakuraBlossom(ctx, cx + 265, cy + 258, 82, 0.35, 0);
  drawSakuraBlossom(ctx, cx + 178, cy + 328, 58, -0.3, 0);
  drawSakuraBlossom(ctx, cx + 332, cy + 165, 52, 0.72, 0);

  // Pétalas soltas flutuando à frente + brilho de pólen dourado
  drawSingleSakuraPetal(ctx, cx - 355, cy + 105, 32, -0.65);
  drawSingleSakuraPetal(ctx, cx + 368, cy - 75, 28, 0.52);
  drawSingleSakuraPetal(ctx, cx - 220, cy + 325, 26, 1.1);
  drawSculptedStar(ctx, cx - 210, cy - 340, 18, '#fffbeb', '#fde68a', 0.2, 0.9);
  drawSculptedStar(ctx, cx + 288, cy + 222, 16, '#fffbeb', '#fbcfe8', 0.4, 0.85);
  return c;
}

// ============================================================================
// COLEÇÃO 3: GLACIUM (Chifres de Dragão Glacial & Cristais — BACK, FRONT)
// ============================================================================
function renderFrostBack() {
  const c = newCanvas(1024, 1024), ctx = c.getContext('2d');
  const cx = 512, cy = 512, R = 352;

  // Névoa criogênica suave atrás
  const mist = ctx.createRadialGradient(cx, cy - 40, R * 0.78, cx, cy, R * 1.35);
  mist.addColorStop(0, 'rgba(56,189,248,0.28)');
  mist.addColorStop(0.5, 'rgba(14,165,233,0.14)');
  mist.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = mist;
  ctx.beginPath();
  ctx.arc(cx, cy, R * 1.35, 0, Math.PI * 2);
  ctx.fill();

  // Chifres majestosos de Dragão de Gelo emergindo atrás e ultrapassando o topo!
  function drawDragonHorn(dir) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(dir, 1);
    ctx.shadowColor = 'rgba(14, 165, 233, 0.55)';
    ctx.shadowBlur = 24;

    const hornG = ctx.createLinearGradient(160, -140, 390, -470);
    hornG.addColorStop(0, '#0f172a');
    hornG.addColorStop(0.28, '#1e40af');
    hornG.addColorStop(0.62, '#38bdf8');
    hornG.addColorStop(0.88, '#bae6fd');
    hornG.addColorStop(1, '#ffffff');
    ctx.fillStyle = hornG;

    ctx.beginPath();
    ctx.moveTo(215, -245);
    ctx.bezierCurveTo(325, -285, 415, -365, 385, -472);
    ctx.bezierCurveTo(368, -425, 310, -372, 232, -335);
    ctx.bezierCurveTo(192, -315, 165, -278, 172, -238);
    ctx.closePath();
    ctx.fill();

    // Faceta iluminada superior do chifre
    const ridgeG = ctx.createLinearGradient(200, -295, 385, -472);
    ridgeG.addColorStop(0, 'rgba(186,230,253,0.45)');
    ridgeG.addColorStop(0.6, 'rgba(240,249,255,0.82)');
    ridgeG.addColorStop(1, '#ffffff');
    ctx.fillStyle = ridgeG;
    ctx.beginPath();
    ctx.moveTo(190, -280);
    ctx.bezierCurveTo(285, -328, 355, -395, 385, -472);
    ctx.bezierCurveTo(345, -402, 265, -352, 185, -308);
    ctx.closePath();
    ctx.fill();

    // Anéis/sulcos segmentados do chifre dracônico
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.52)';
    ctx.lineWidth = 4;
    for (let k = 0; k < 5; k++) {
      const t = 0.18 + k * 0.14;
      const bx = 205 + t * 145;
      const by = -265 - t * 140;
      ctx.beginPath();
      ctx.arc(bx, by, 38 - k * 4.5, 0.7, 2.3);
      ctx.stroke();
    }

    // Esporão secundário cristalino saindo do chifre
    drawIceCrystal(ctx, 295, -320, 125, 40, 0.92, dir < 0);
    ctx.restore();
  }
  drawDragonHorn(-1);
  drawDragonHorn(1);

  // Espigões traseiros nas laterais inferiores
  drawIceCrystal(ctx, cx - 355, cy + 120, 130, 44, -2.15);
  drawIceCrystal(ctx, cx + 355, cy + 120, 130, 44, 2.15, true);
  return c;
}

function renderFrostFront() {
  const c = newCanvas(1024, 1024), ctx = c.getContext('2d');
  const cx = 512, cy = 512, R = 354;

  // Aro de prata congelada esculpida com chanfro
  ctx.save();
  ctx.shadowColor = 'rgba(6, 18, 42, 0.78)';
  ctx.shadowBlur = 20;
  ctx.shadowOffsetY = 6;
  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 28;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  const silverG = ctx.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
  silverG.addColorStop(0, '#f8fafc');
  silverG.addColorStop(0.28, '#bae6fd');
  silverG.addColorStop(0.52, '#475569');
  silverG.addColorStop(0.78, '#e0f2fe');
  silverG.addColorStop(1, '#1e3a8a');
  ctx.strokeStyle = silverG;
  ctx.lineWidth = 18;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.stroke();

  // Fio de brilho gelado interno
  ctx.strokeStyle = 'rgba(240, 249, 255, 0.85)';
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.arc(cx, cy, R - 7, 0, Math.PI * 2);
  ctx.stroke();

  // Diadema frontal superior de prata + gema glacial central
  ctx.save();
  ctx.translate(cx, cy - R + 6);
  ctx.shadowColor = 'rgba(8, 22, 54, 0.7)';
  ctx.shadowBlur = 16;
  const crownG = ctx.createLinearGradient(-150, -60, 150, 40);
  crownG.addColorStop(0, '#94a3b8');
  crownG.addColorStop(0.35, '#f8fafc');
  crownG.addColorStop(0.5, '#bae6fd');
  crownG.addColorStop(0.7, '#64748b');
  crownG.addColorStop(1, '#e2e8f0');
  ctx.fillStyle = crownG;
  ctx.beginPath();
  ctx.moveTo(0, -76);
  ctx.lineTo(38, -20);
  ctx.lineTo(130, -34);
  ctx.lineTo(95, 10);
  ctx.lineTo(0, 22);
  ctx.lineTo(-95, 10);
  ctx.lineTo(-130, -34);
  ctx.lineTo(-38, -20);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.restore();

  // Cristais heroicos no topo (sem encostar/cortar no topo y=0!) e clusters assimétricos na base
  drawIceCrystal(ctx, cx, cy - R - 8, 108, 46, 0);
  drawIceCrystal(ctx, cx - 54, cy - R - 2, 82, 32, -0.45);
  drawIceCrystal(ctx, cx + 54, cy - R - 2, 82, 32, 0.45, true);

  // Cluster poderoso na base direita sobrepondo levemente a borda do avatar
  drawIceCrystal(ctx, cx + 258, cy + 258, 152, 58, 2.25, true);
  drawIceCrystal(ctx, cx + 295, cy + 195, 114, 42, 1.85, true);
  drawIceCrystal(ctx, cx + 188, cy + 312, 110, 40, 2.68, true);
  drawIceCrystal(ctx, cx + 225, cy + 270, 82, 30, 0.55);

  // Cluster secundário na base esquerda
  drawIceCrystal(ctx, cx - 268, cy + 248, 120, 44, -2.35);
  drawIceCrystal(ctx, cx - 210, cy + 304, 88, 32, -2.75);

  // Gema glacial central + laterais
  const glacialGem = { bright: '#ffffff', mid: '#38bdf8', deep: '#1e3a8a', bezelLight: '#f8fafc', bezelMid: '#94a3b8', bezelDark: '#334155', bounce: '#e0f2fe' };
  drawFacetedGem(ctx, cx, cy - R + 4, 24, 32, 0, glacialGem);
  drawFacetedGem(ctx, cx + 245, cy + 245, 22, 26, 0.78, glacialGem);

  // Brilhos especulares cristalinos (com margem de segurança)
  drawSculptedStar(ctx, cx, cy - R - 118, 24, '#ffffff', '#7dd3fc', 0, 0.95);
  drawSculptedStar(ctx, cx + 345, cy + 315, 22, '#ffffff', '#bae6fd', 0.25, 0.9);
  drawSculptedStar(ctx, cx - 322, cy + 298, 18, '#ffffff', '#7dd3fc', 0.4, 0.85);
  return c;
}

// ============================================================================
// COLEÇÃO 4: SYNTH-NEKO (Gato Cyber Pintado — BACK, FRONT, BLINK OVERLAY)
// Alinhado estritamente em (512, 512) para encaixe perfeito em qualquer DPI!
// ============================================================================
function renderCyberCatBack() {
  const c = newCanvas(1024, 1024), ctx = c.getContext('2d');
  const cx = 512, cy = 512, R = 342;

  // Halo holográfico ciano-magenta suave atrás
  const halo = ctx.createRadialGradient(cx, cy, R * 0.84, cx, cy, R * 1.32);
  halo.addColorStop(0, 'rgba(56,232,255,0.28)');
  halo.addColorStop(0.55, 'rgba(244,63,158,0.16)');
  halo.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(cx, cy, R * 1.32, 0, Math.PI * 2);
  ctx.fill();

  // Cauda energética estilizada curvando atrás pela lateral direita!
  ctx.save();
  ctx.lineCap = 'round';
  ctx.shadowColor = 'rgba(56, 232, 255, 0.65)';
  ctx.shadowBlur = 24;
  // Base escura da cauda
  ctx.strokeStyle = '#18182e';
  ctx.lineWidth = 48;
  ctx.beginPath();
  ctx.moveTo(cx + 255, cy + 225);
  ctx.bezierCurveTo(cx + 420, cy + 165, cx + 448, cy - 35, cx + 382, cy - 178);
  ctx.bezierCurveTo(cx + 355, cy - 235, cx + 412, cy - 295, cx + 455, cy - 275);
  ctx.stroke();

  // Corpo graduado da cauda (navy -> ciano -> ponta magenta luminosa)
  const tailG = ctx.createLinearGradient(cx + 260, cy + 220, cx + 455, cy - 280);
  tailG.addColorStop(0, '#1e293b');
  tailG.addColorStop(0.35, '#334155');
  tailG.addColorStop(0.68, '#06b6d4');
  tailG.addColorStop(0.88, '#f43f9e');
  tailG.addColorStop(1, '#fff1f2');
  ctx.strokeStyle = tailG;
  ctx.lineWidth = 34;
  ctx.stroke();

  // Anéis neon na cauda + faixa especular
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(cx + 275, cy + 205);
  ctx.bezierCurveTo(cx + 408, cy + 148, cx + 436, cy - 35, cx + 374, cy - 175);
  ctx.stroke();
  ctx.restore();

  // Anel cyber externo traseiro chanfrado
  ctx.save();
  ctx.strokeStyle = 'rgba(56, 232, 255, 0.45)';
  ctx.lineWidth = 5;
  ctx.setLineDash([42, 18, 12, 18]);
  ctx.beginPath();
  ctx.arc(cx, cy, R + 34, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // Orelhas de energia holográfica projetadas atrás do gato (profundidade extra)
  drawSculptedStar(ctx, cx + 452, cy - 274, 24, '#ffffff', '#f472b6', 0.2, 0.95);
  return c;
}

function renderCyberCatFront(blinkOnly = false) {
  const c = newCanvas(1024, 1024), ctx = c.getContext('2d');
  const cx = 512, cy = 512, R = 342;

  if (!blinkOnly) {
    // 1. Aro mecha dark-chrome com inlays ciano e magenta
    ctx.save();
    ctx.shadowColor = 'rgba(6, 10, 26, 0.78)';
    ctx.shadowBlur = 20;
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 28;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    const chromeG = ctx.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
    chromeG.addColorStop(0, '#64748b');
    chromeG.addColorStop(0.25, '#e2e8f0');
    chromeG.addColorStop(0.5, '#1e293b');
    chromeG.addColorStop(0.75, '#94a3b8');
    chromeG.addColorStop(1, '#0f172a');
    ctx.strokeStyle = chromeG;
    ctx.lineWidth = 18;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.stroke();

    // Trilhos neon ciano (esq) e magenta (dir)
    ctx.save();
    ctx.lineCap = 'round';
    ctx.shadowColor = '#22d3ee';
    ctx.shadowBlur = 14;
    ctx.strokeStyle = '#67e8f9';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(cx, cy, R, Math.PI * 0.55, Math.PI * 1.18);
    ctx.stroke();

    ctx.shadowColor = '#f43f9e';
    ctx.strokeStyle = '#f9a8d4';
    ctx.beginPath();
    ctx.arc(cx, cy, R, -Math.PI * 0.15, Math.PI * 0.42);
    ctx.stroke();
    ctx.restore();

    // Placa tática inferior esquerda com prisma acrílico
    ctx.save();
    ctx.translate(cx - 235, cy + 250);
    ctx.rotate(0.78);
    ctx.shadowColor = 'rgba(0,0,0,0.65)';
    ctx.shadowBlur = 14;
    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    ctx.roundRect(-64, -18, 128, 36, 10);
    ctx.fill();
    ctx.strokeStyle = '#67e8f9';
    ctx.lineWidth = 3;
    ctx.stroke();
    for (let k = -2; k <= 2; k++) {
      ctx.fillStyle = k % 2 === 0 ? '#38e8ff' : '#f43f9e';
      ctx.fillRect(k * 20 - 6, -6, 12, 12);
    }
    ctx.restore();
  }

  // 2. MASCOTE HEROICO: Gatinho Cyber Anime pintado apoiado no topo do avatar (com margem segura no topo)
  const hx = cx, hy = cy - R + 54; // Centro da cabeça apoiado na borda superior sem cortar as orelhas!

  if (!blinkOnly) {
    // Sombra de contato projetada pelo gatinho sobre o topo do avatar
    ctx.save();
    ctx.fillStyle = 'rgba(6, 8, 24, 0.55)';
    ctx.filter = 'blur(10px)';
    ctx.beginPath();
    ctx.ellipse(hx, hy + 72, 118, 28, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Fones de ouvido futuristas (arco traseiro + earcups)
    ctx.save();
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 24;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(hx, hy - 22, 134, Math.PI * 1.06, Math.PI * 1.94);
    ctx.stroke();
    const bandG = ctx.createLinearGradient(hx - 130, hy - 150, hx + 130, hy - 150);
    bandG.addColorStop(0, '#38e8ff');
    bandG.addColorStop(0.5, '#cbd5e1');
    bandG.addColorStop(1, '#f43f9e');
    ctx.strokeStyle = bandG;
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.arc(hx, hy - 22, 134, Math.PI * 1.12, Math.PI * 1.88);
    ctx.stroke();
    ctx.restore();

    // Orelhas pontudas expressivas (esquerda e direita)
    function drawEar(dir) {
      ctx.save();
      ctx.translate(hx + dir * 72, hy - 96);
      ctx.rotate(dir * 0.28);
      ctx.shadowColor = 'rgba(12, 15, 36, 0.55)';
      ctx.shadowBlur = 12;
      const earG = ctx.createLinearGradient(0, -108, 0, 28);
      earG.addColorStop(0, '#1e1b4b');
      earG.addColorStop(0.45, '#4338ca');
      earG.addColorStop(0.75, '#e2e8f0');
      earG.addColorStop(1, '#ffffff');
      ctx.fillStyle = earG;
      ctx.beginPath();
      ctx.moveTo(-44, 24);
      ctx.quadraticCurveTo(-34, -58, 0, -106);
      ctx.quadraticCurveTo(38, -55, 48, 24);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.65)';
      ctx.lineWidth = 3;
      ctx.stroke();

      // Interior rosa suave da orelha
      const inG = ctx.createLinearGradient(0, -76, 0, 14);
      inG.addColorStop(0, '#f43f9e');
      inG.addColorStop(0.65, '#fbcfe8');
      inG.addColorStop(1, '#fff1f2');
      ctx.fillStyle = inG;
      ctx.beginPath();
      ctx.moveTo(-22, 12);
      ctx.quadraticCurveTo(-16, -42, 0, -74);
      ctx.quadraticCurveTo(18, -40, 24, 12);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    drawEar(-1);
    drawEar(1);

    // Cabeça fofa com tufos nas bochechas e sombreamento volumétrico
    ctx.save();
    ctx.shadowColor = 'rgba(10, 14, 34, 0.65)';
    ctx.shadowBlur = 20;
    ctx.shadowOffsetY = 8;
    const headG = ctx.createRadialGradient(hx - 35, hy - 55, 16, hx, hy - 12, 145);
    headG.addColorStop(0, '#ffffff');
    headG.addColorStop(0.55, '#f8fafc');
    headG.addColorStop(0.84, '#cbd5e1');
    headG.addColorStop(1, '#94a3b8');
    ctx.fillStyle = headG;
    ctx.beginPath();
    ctx.moveTo(hx - 122, hy - 12);
    ctx.bezierCurveTo(hx - 126, hy - 102, hx - 58, hy - 128, hx, hy - 126);
    ctx.bezierCurveTo(hx + 58, hy - 128, hx + 126, hy - 102, hx + 122, hy - 12);
    // Tufo direito
    ctx.lineTo(hx + 138, hy + 4);
    ctx.quadraticCurveTo(hx + 116, hy + 56, hx + 62, hy + 68);
    ctx.quadraticCurveTo(hx, hy + 78, hx - 62, hy + 68);
    ctx.quadraticCurveTo(hx - 116, hy + 56, hx - 138, hy + 4);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(30, 41, 59, 0.65)';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.restore();

    // Mecha frontal estilizada na testa (navy + reflexo ciano)
    const tuftG = ctx.createLinearGradient(hx - 40, hy - 128, hx + 40, hy - 70);
    tuftG.addColorStop(0, '#312e81');
    tuftG.addColorStop(0.5, '#1e1b4b');
    tuftG.addColorStop(1, '#38bdf8');
    ctx.fillStyle = tuftG;
    ctx.beginPath();
    ctx.moveTo(hx - 48, hy - 118);
    ctx.quadraticCurveTo(hx - 18, hy - 72, hx - 4, hy - 86);
    ctx.quadraticCurveTo(hx + 4, hy - 60, hx + 20, hy - 84);
    ctx.quadraticCurveTo(hx + 36, hy - 74, hx + 48, hy - 118);
    ctx.quadraticCurveTo(hx, hy - 132, hx - 48, hy - 118);
    ctx.fill();

    // Earcups neon dos fones nas laterais da cabeça
    for (const dir of [-1, 1]) {
      ctx.save();
      ctx.translate(hx + dir * 124, hy - 14);
      ctx.rotate(dir * 0.12);
      ctx.shadowColor = dir < 0 ? 'rgba(56,232,255,0.75)' : 'rgba(244,63,158,0.75)';
      ctx.shadowBlur = 16;
      ctx.fillStyle = '#0f172a';
      ctx.beginPath();
      ctx.roundRect(-22, -38, 44, 76, 18);
      ctx.fill();
      ctx.strokeStyle = dir < 0 ? '#38e8ff' : '#f43f9e';
      ctx.lineWidth = 5;
      ctx.stroke();
      // Núcleo luminoso do fone
      ctx.fillStyle = dir < 0 ? '#67e8f9' : '#f9a8d4';
      ctx.beginPath();
      ctx.roundRect(-8, -20, 16, 40, 8);
      ctx.fill();
      ctx.restore();
    }

    // Bochechas rosadas suaves
    for (const dir of [-1, 1]) {
      const blush = ctx.createRadialGradient(hx + dir * 72, hy + 18, 2, hx + dir * 72, hy + 18, 26);
      blush.addColorStop(0, 'rgba(244, 114, 182, 0.55)');
      blush.addColorStop(1, 'rgba(244, 114, 182, 0)');
      ctx.fillStyle = blush;
      ctx.beginPath();
      ctx.ellipse(hx + dir * 72, hy + 18, 26, 16, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Narizinho + boca 'w'
    ctx.fillStyle = '#f472b6';
    ctx.beginPath();
    ctx.moveTo(hx - 7, hy + 12);
    ctx.lineTo(hx + 7, hy + 12);
    ctx.lineTo(hx, hy + 20);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 3.6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(hx - 18, hy + 26);
    ctx.quadraticCurveTo(hx - 9, hy + 36, hx, hy + 24);
    ctx.quadraticCurveTo(hx + 9, hy + 36, hx + 18, hy + 26);
    ctx.stroke();

    // Patinhas fofas apoiadas SOBRE a borda superior do avatar!
    for (const dir of [-1, 1]) {
      const px = hx + dir * 68, py = hy + 68;
      ctx.save();
      ctx.shadowColor = 'rgba(8, 12, 28, 0.65)';
      ctx.shadowBlur = 12;
      ctx.shadowOffsetY = 5;
      const pawG = ctx.createRadialGradient(px - 8, py - 10, 4, px, py, 36);
      pawG.addColorStop(0, '#ffffff');
      pawG.addColorStop(0.7, '#e2e8f0');
      pawG.addColorStop(1, '#94a3b8');
      ctx.fillStyle = pawG;
      ctx.beginPath();
      ctx.ellipse(px, py, 34, 24, dir * 0.14, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 3.2;
      ctx.stroke();
      ctx.restore();
      // Dedinhos sutis
      ctx.strokeStyle = 'rgba(100, 116, 139, 0.65)';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(px - 10, py + 6); ctx.lineTo(px - 10, py + 18);
      ctx.moveTo(px + 10, py + 6); ctx.lineTo(px + 10, py + 18);
      ctx.stroke();
    }
  }

  // Olhos expressivos anime (ou pálpebras felizes no blinkOnly)
  for (const dir of [-1, 1]) {
    const ex = hx + dir * 48, ey = hy - 14;
    if (blinkOnly) {
      // Cobre os olhos abertos com pelagem e desenha arco sorridente ^ ^
      ctx.fillStyle = '#f8fafc';
      ctx.beginPath();
      ctx.ellipse(ex, ey, 30, 34, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 7;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(ex, ey + 8, 20, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();
    } else {
      // Olho anime grande com íris ciano/safira e brilho duplo
      ctx.save();
      ctx.fillStyle = '#0f172a';
      ctx.beginPath();
      ctx.ellipse(ex, ey, 24, 29, 0, 0, Math.PI * 2);
      ctx.fill();

      const irisG = ctx.createLinearGradient(ex, ey - 24, ex, ey + 24);
      irisG.addColorStop(0, '#0e1b4d');
      irisG.addColorStop(0.45, '#0284c7');
      irisG.addColorStop(0.78, '#38e8ff');
      irisG.addColorStop(1, '#e0f2fe');
      ctx.fillStyle = irisG;
      ctx.beginPath();
      ctx.ellipse(ex, ey + 2, 20, 24, 0, 0, Math.PI * 2);
      ctx.fill();

      // Pupila escura
      ctx.fillStyle = '#070b1e';
      ctx.beginPath();
      ctx.ellipse(ex, ey - 1, 9, 13, 0, 0, Math.PI * 2);
      ctx.fill();

      // Catchlights brancos brilhantes
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.ellipse(ex - 7, ey - 10, 6.5, 5.5, -0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(ex + 8, ey + 10, 3.6, 0, Math.PI * 2);
      ctx.fill();

      // Cílios superiores nítidos
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(ex, ey + 2, 24, Math.PI * 1.12, Math.PI * 1.88);
      ctx.stroke();
      ctx.restore();
    }
  }
  return c;
}

// ============================================================================
// PROFILE FRAMES ASSIMÉTRICAS (Cantos pintados 640x480 — TL, TR, BR)
// ============================================================================
function renderFrameAstralTL() {
  const c = newCanvas(640, 480), ctx = c.getContext('2d');
  // Arco dourado gravado descendo pela borda superior e lateral esquerda
  ctx.save();
  ctx.shadowColor = 'rgba(4, 6, 20, 0.72)';
  ctx.shadowBlur = 18;
  const g = ctx.createLinearGradient(0, 0, 480, 340);
  g.addColorStop(0, '#fff7d6');
  g.addColorStop(0.35, '#e8b954');
  g.addColorStop(0.75, '#9b671b');
  g.addColorStop(1, 'rgba(90, 56, 12, 0)');
  ctx.strokeStyle = g;
  ctx.lineWidth = 14;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(22, 370);
  ctx.lineTo(22, 48);
  ctx.quadraticCurveTo(22, 22, 48, 22);
  ctx.lineTo(520, 22);
  ctx.stroke();

  // Filigrana curva interna
  ctx.lineWidth = 5;
  ctx.strokeStyle = 'rgba(254, 243, 199, 0.72)';
  ctx.beginPath();
  ctx.moveTo(38, 250);
  ctx.quadraticCurveTo(42, 42, 250, 38);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(22, 160);
  ctx.bezierCurveTo(95, 130, 130, 95, 160, 22);
  ctx.stroke();
  ctx.restore();

  // Meia-lua esculpida + safira no canto superior esquerdo
  ctx.save();
  ctx.translate(64, 64);
  ctx.rotate(-0.78);
  ctx.shadowColor = 'rgba(4, 6, 20, 0.75)';
  ctx.shadowBlur = 18;
  const mg = ctx.createLinearGradient(-48, -48, 48, 48);
  mg.addColorStop(0, '#fffbeb');
  mg.addColorStop(0.4, '#f5c75d');
  mg.addColorStop(1, '#78480c');
  ctx.fillStyle = mg;
  ctx.beginPath();
  ctx.arc(0, 0, 50, 0.55, Math.PI * 2 - 0.55, false);
  ctx.arc(20, 0, 38, Math.PI * 2 - 0.72, 0.72, true);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#fffbeb';
  ctx.lineWidth = 2.4;
  ctx.stroke();
  ctx.restore();

  drawFacetedGem(ctx, 64, 64, 20, 24, -0.78, { bright: '#bae6fd', mid: '#2563eb', deep: '#172554', bounce: '#93c5fd' });
  drawSculptedStar(ctx, 138, 42, 18, '#ffffff', '#fde68a', 0.1, 0.95);
  drawSculptedStar(ctx, 42, 148, 14, '#ffffff', '#93c5fd', 0.3, 0.9);
  return c;
}

function renderFrameAstralTR() {
  const c = newCanvas(640, 480), ctx = c.getContext('2d');
  // Arco superior direito + pingentes estelares descendo assimetricamente
  ctx.save();
  ctx.shadowColor = 'rgba(4, 6, 20, 0.72)';
  ctx.shadowBlur = 16;
  const g = ctx.createLinearGradient(640, 0, 140, 260);
  g.addColorStop(0, '#fff7d6');
  g.addColorStop(0.4, '#e5b14a');
  g.addColorStop(1, 'rgba(120, 74, 16, 0)');
  ctx.strokeStyle = g;
  ctx.lineWidth = 12;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(150, 22);
  ctx.lineTo(592, 22);
  ctx.quadraticCurveTo(618, 22, 618, 48);
  ctx.lineTo(618, 300);
  ctx.stroke();
  ctx.restore();

  // Pingentes dourados suspensos no canto direito
  ctx.strokeStyle = '#fde68a';
  ctx.lineWidth = 2.6;
  const drops = [[572, 26, 138, 22], [530, 24, 92, 16], [486, 24, 56, 12]];
  for (const [x, y, len, sr] of drops) {
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + len); ctx.stroke();
    drawSculptedStar(ctx, x, y + len + 4, sr, '#fffbeb', '#fbbf24', 0, 0.95);
  }
  drawFacetedGem(ctx, 594, 46, 16, 20, 0.78, { bright: '#f5d0fe', mid: '#9333ea', deep: '#3b0764', bounce: '#e879f9' });
  return c;
}

function renderFrameSakuraTL() {
  const c = newCanvas(640, 480), ctx = c.getContext('2d');
  // Galho frondoso de cerejeira entrando pelo canto superior esquerdo!
  drawCherryBranch(ctx, [[-10, 45], [85, 62], [210, 42], [355, 68], [475, 40]], 26, 7);
  drawCherryBranch(ctx, [[32, 42], [44, 150], [26, 268], [42, 355]], 20, 6);
  drawCherryBranch(ctx, [[160, 50], [215, 118], [268, 148]], 12, 4);

  // Flores pintadas em camadas (não cobrem avatar ou bio)
  drawSakuraBlossom(ctx, 64, 58, 56, -0.3, 0);
  drawSakuraBlossom(ctx, 162, 48, 48, 0.25, 0);
  drawSakuraBlossom(ctx, 275, 58, 44, -0.15, 0);
  drawSakuraBlossom(ctx, 385, 48, 36, 0.5, 0);
  drawSakuraBlossom(ctx, 44, 152, 42, 0.4, 1);
  drawSakuraBlossom(ctx, 36, 244, 34, -0.5, 0);
  drawSakuraBlossom(ctx, 232, 128, 30, 0.2, 0);
  drawSingleSakuraPetal(ctx, 138, 124, 18, -0.4);
  drawSingleSakuraPetal(ctx, 336, 108, 16, 0.65);
  return c;
}

function renderFrameSakuraTR() {
  const c = newCanvas(640, 480), ctx = c.getContext('2d');
  // Pequeno ramo assimétrico no canto direito + sininho/pingente de seda dourada
  drawCherryBranch(ctx, [[650, 54], [568, 66], [475, 42]], 18, 6);
  drawCherryBranch(ctx, [[604, 60], [614, 156], [596, 230]], 14, 5);
  // Cordão de seda com pequeno sino/tassel dourado
  ctx.save();
  ctx.strokeStyle = '#f9a8d4';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(568, 66); ctx.lineTo(568, 148); ctx.stroke();
  const bellG = ctx.createRadialGradient(564, 156, 2, 568, 162, 18);
  bellG.addColorStop(0, '#fffbeb');
  bellG.addColorStop(0.55, '#fbbf24');
  bellG.addColorStop(1, '#92400e');
  ctx.fillStyle = bellG;
  ctx.beginPath(); ctx.arc(568, 162, 14, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#f472b6';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(568, 176); ctx.quadraticCurveTo(574, 206, 564, 232); ctx.stroke();
  ctx.restore();

  drawSakuraBlossom(ctx, 594, 58, 46, 0.35, 0);
  drawSakuraBlossom(ctx, 514, 48, 34, -0.25, 0);
  drawSakuraBlossom(ctx, 606, 150, 32, 0.6, 1);
  drawSingleSakuraPetal(ctx, 520, 128, 16, 0.5);
  return c;
}

function renderFrameFrostTL() {
  const c = newCanvas(640, 480), ctx = c.getContext('2d');
  // Prata congelada + estalactites de cristal no canto superior esquerdo
  ctx.save();
  ctx.shadowColor = 'rgba(14, 165, 233, 0.45)';
  ctx.shadowBlur = 16;
  const g = ctx.createLinearGradient(0, 0, 420, 320);
  g.addColorStop(0, '#f8fafc');
  g.addColorStop(0.4, '#7dd3fc');
  g.addColorStop(1, 'rgba(30, 58, 138, 0)');
  ctx.strokeStyle = g;
  ctx.lineWidth = 11;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(20, 350); ctx.lineTo(20, 40);
  ctx.quadraticCurveTo(20, 20, 40, 20);
  ctx.lineTo(460, 20);
  ctx.stroke();
  ctx.restore();

  drawIceCrystal(ctx, 32, 36, 135, 44, 2.35);
  drawIceCrystal(ctx, 88, 22, 92, 32, 2.95);
  drawIceCrystal(ctx, 22, 98, 96, 32, 1.78);
  drawIceCrystal(ctx, 164, 18, 66, 24, 3.05);
  drawIceCrystal(ctx, 20, 178, 64, 22, 1.65);
  drawFacetedGem(ctx, 40, 40, 18, 22, -0.78, { bright: '#ffffff', mid: '#38bdf8', deep: '#1e3a8a', bezelLight: '#f8fafc', bezelMid: '#94a3b8', bezelDark: '#334155' });
  return c;
}

function renderFrameFrostTR() {
  const c = newCanvas(640, 480), ctx = c.getContext('2d');
  ctx.save();
  ctx.shadowColor = 'rgba(14, 165, 233, 0.45)';
  ctx.shadowBlur = 16;
  const g = ctx.createLinearGradient(640, 0, 220, 280);
  g.addColorStop(0, '#f8fafc');
  g.addColorStop(0.4, '#7dd3fc');
  g.addColorStop(1, 'rgba(30, 58, 138, 0)');
  ctx.strokeStyle = g;
  ctx.lineWidth = 10;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(210, 20); ctx.lineTo(600, 20);
  ctx.quadraticCurveTo(620, 20, 620, 40);
  ctx.lineTo(620, 320);
  ctx.stroke();
  ctx.restore();

  drawIceCrystal(ctx, 608, 36, 145, 46, -2.35, true);
  drawIceCrystal(ctx, 548, 20, 94, 32, -2.92, true);
  drawIceCrystal(ctx, 618, 108, 102, 34, -1.78, true);
  drawIceCrystal(ctx, 472, 18, 64, 22, -3.05, true);
  drawFacetedGem(ctx, 600, 40, 16, 20, 0.78, { bright: '#ffffff', mid: '#38bdf8', deep: '#1e3a8a', bezelLight: '#f8fafc', bezelMid: '#94a3b8', bezelDark: '#334155' });
  return c;
}

function renderFrameCyberTL() {
  const c = newCanvas(640, 480), ctx = c.getContext('2d');
  // Placa tática chanfrada dark-titanium + faixa LED ciano + prisma holográfico
  ctx.save();
  ctx.shadowColor = 'rgba(6, 10, 26, 0.8)';
  ctx.shadowBlur = 18;
  const plateG = ctx.createLinearGradient(0, 0, 380, 220);
  plateG.addColorStop(0, '#334155');
  plateG.addColorStop(0.35, '#0f172a');
  plateG.addColorStop(1, '#1e293b');
  ctx.fillStyle = plateG;
  ctx.beginPath();
  ctx.moveTo(14, 240);
  ctx.lineTo(14, 28);
  ctx.lineTo(28, 14);
  ctx.lineTo(390, 14);
  ctx.lineTo(364, 42);
  ctx.lineTo(78, 42);
  ctx.lineTo(44, 76);
  ctx.lineTo(44, 212);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#64748b';
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // Inlay LED ciano brilhante
  ctx.shadowColor = '#38e8ff';
  ctx.shadowBlur = 14;
  ctx.strokeStyle = '#67e8f9';
  ctx.lineWidth = 4.5;
  ctx.beginPath();
  ctx.moveTo(26, 192); ctx.lineTo(26, 36); ctx.lineTo(36, 26); ctx.lineTo(320, 26);
  ctx.stroke();

  // Barrinhas HUD de telemetria
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = i < 3 ? '#38e8ff' : '#f43f9e';
    ctx.fillRect(92 + i * 24, 21, 16, 8);
  }
  ctx.restore();
  return c;
}

function renderFrameCyberTR() {
  const c = newCanvas(640, 480), ctx = c.getContext('2d');
  // Módulo prismático magenta/ciano + orelha-visor estilizada no canto superior direito!
  ctx.save();
  ctx.shadowColor = 'rgba(244, 63, 158, 0.45)';
  ctx.shadowBlur = 20;
  const pG = ctx.createLinearGradient(626, 14, 340, 260);
  pG.addColorStop(0, '#334155');
  pG.addColorStop(0.4, '#0f172a');
  pG.addColorStop(1, '#1e1b4b');
  ctx.fillStyle = pG;
  ctx.beginPath();
  ctx.moveTo(270, 14);
  ctx.lineTo(612, 14);
  ctx.lineTo(626, 28);
  ctx.lineTo(626, 290);
  ctx.lineTo(596, 262);
  ctx.lineTo(596, 82);
  ctx.lineTo(556, 44);
  ctx.lineTo(298, 44);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#f43f9e';
  ctx.lineWidth = 3;
  ctx.stroke();

  // Fragmento prismático translúcido holográfico saindo do canto
  const holo = ctx.createLinearGradient(545, 22, 622, 170);
  holo.addColorStop(0, 'rgba(56,232,255,0.78)');
  holo.addColorStop(0.5, 'rgba(244,63,158,0.68)');
  holo.addColorStop(1, 'rgba(168,85,247,0.22)');
  ctx.fillStyle = holo;
  ctx.beginPath();
  ctx.moveTo(525, 44);
  ctx.lineTo(592, 16);
  ctx.lineTo(622, 76);
  ctx.lineTo(584, 156);
  ctx.lineTo(548, 108);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Linha neon magenta
  ctx.shadowColor = '#f43f9e';
  ctx.shadowBlur = 14;
  ctx.strokeStyle = '#f9a8d4';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(330, 27); ctx.lineTo(604, 27); ctx.lineTo(612, 35); ctx.lineTo(612, 240);
  ctx.stroke();

  // Silhueta holográfica de gatinho cyber (marca Synth-Neko!)
  ctx.save();
  ctx.translate(576, 78);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.moveTo(-20, 12); ctx.lineTo(-22, -12); ctx.lineTo(-8, -2);
  ctx.lineTo(8, -2); ctx.lineTo(22, -12); ctx.lineTo(20, 12);
  ctx.quadraticCurveTo(0, 22, -20, 12);
  ctx.stroke();
  ctx.fillStyle = '#38e8ff';
  ctx.beginPath(); ctx.arc(-8, 6, 3.2, 0, Math.PI * 2); ctx.arc(8, 6, 3.2, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  ctx.restore();
  return c;
}

// Ornamentos assimétricos de canto inferior direito (BR) — fecham a silhueta do card sem tocar botões/texto!
function renderFrameAstralBR() {
  const c = newCanvas(480, 360), ctx = c.getContext('2d');
  ctx.save();
  ctx.shadowColor = 'rgba(4,6,20,0.72)'; ctx.shadowBlur = 16;
  const g = ctx.createLinearGradient(460, 340, 120, 100);
  g.addColorStop(0, '#fff7d6'); g.addColorStop(0.45, '#e2ae48'); g.addColorStop(1, 'rgba(120,74,16,0)');
  ctx.strokeStyle = g; ctx.lineWidth = 11; ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(458, 95); ctx.lineTo(458, 316); ctx.quadraticCurveTo(458, 338, 436, 338); ctx.lineTo(135, 338);
  ctx.stroke();
  // Selo astrolábio em arco no canto inferior direito
  ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(254,243,199,0.62)';
  ctx.beginPath(); ctx.arc(432, 312, 82, Math.PI, Math.PI * 1.5); ctx.stroke();
  ctx.beginPath(); ctx.arc(432, 312, 56, Math.PI, Math.PI * 1.5); ctx.stroke();
  ctx.restore();
  drawFacetedGem(ctx, 434, 314, 16, 20, -0.78, { bright: '#f5d0fe', mid: '#9333ea', deep: '#3b0764', bounce: '#e879f9' });
  drawSculptedStar(ctx, 355, 326, 16, '#ffffff', '#fde68a', 0.2, 0.9);
  return c;
}

function renderFrameSakuraBR() {
  const c = newCanvas(480, 360), ctx = c.getContext('2d');
  drawCherryBranch(ctx, [[490, 315], [420, 324], [320, 336], [235, 328]], 18, 5);
  drawCherryBranch(ctx, [[450, 320], [456, 240], [442, 165]], 14, 5);
  drawSakuraBlossom(ctx, 430, 312, 46, 0.4, 0);
  drawSakuraBlossom(ctx, 354, 328, 34, -0.2, 0);
  drawSakuraBlossom(ctx, 448, 232, 32, 0.7, 1);
  drawSingleSakuraPetal(ctx, 290, 304, 16, -0.5);
  return c;
}

function renderFrameFrostBR() {
  const c = newCanvas(480, 360), ctx = c.getContext('2d');
  ctx.save();
  ctx.shadowColor = 'rgba(14,165,233,0.42)'; ctx.shadowBlur = 14;
  const g = ctx.createLinearGradient(460, 340, 140, 120);
  g.addColorStop(0, '#f8fafc'); g.addColorStop(0.45, '#7dd3fc'); g.addColorStop(1, 'rgba(30,58,138,0)');
  ctx.strokeStyle = g; ctx.lineWidth = 9; ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(458, 125); ctx.lineTo(458, 320); ctx.quadraticCurveTo(458, 340, 438, 340); ctx.lineTo(155, 340);
  ctx.stroke();
  ctx.restore();
  drawIceCrystal(ctx, 446, 332, 126, 42, -0.78, true);
  drawIceCrystal(ctx, 394, 340, 82, 28, -0.25, true);
  drawIceCrystal(ctx, 456, 272, 86, 28, -1.35, true);
  return c;
}

function renderFrameCyberBR() {
  const c = newCanvas(480, 360), ctx = c.getContext('2d');
  ctx.save();
  ctx.shadowColor = 'rgba(56,232,255,0.45)'; ctx.shadowBlur = 16;
  ctx.fillStyle = '#0f172a';
  ctx.beginPath();
  ctx.moveTo(466, 150); ctx.lineTo(466, 334); ctx.lineTo(452, 348); ctx.lineTo(200, 348);
  ctx.lineTo(224, 326); ctx.lineTo(426, 326); ctx.lineTo(444, 308); ctx.lineTo(444, 174);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#38e8ff'; ctx.lineWidth = 2.8; ctx.stroke();
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = i % 2 === 0 ? '#38e8ff' : '#f43f9e';
    ctx.fillRect(280 + i * 24, 334, 14, 7);
  }
  ctx.restore();
  return c;
}

// Conquistas exclusivas (Fundação Imperial & Arquitetura Dev — arte pintada V5!)
function renderFrameFounderTL() {
  const c = newCanvas(640, 480), ctx = c.getContext('2d');
  ctx.save();
  ctx.shadowColor = 'rgba(20, 6, 4, 0.78)'; ctx.shadowBlur = 18;
  const g = ctx.createLinearGradient(0, 0, 460, 320);
  g.addColorStop(0, '#fffbeb'); g.addColorStop(0.38, '#fbbf24'); g.addColorStop(0.72, '#b45309'); g.addColorStop(1, 'rgba(120,53,15,0)');
  ctx.strokeStyle = g; ctx.lineWidth = 15; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(22, 360); ctx.lineTo(22, 44); ctx.quadraticCurveTo(22, 22, 44, 22); ctx.lineTo(490, 22); ctx.stroke();
  // Coroa imperial esculpida no canto
  const cg = ctx.createLinearGradient(24, 20, 120, 110);
  cg.addColorStop(0, '#fffbeb'); cg.addColorStop(0.5, '#f59e0b'); cg.addColorStop(1, '#78350f');
  ctx.fillStyle = cg;
  ctx.beginPath(); ctx.moveTo(26, 98); ctx.lineTo(36, 36); ctx.lineTo(66, 62); ctx.lineTo(94, 26); ctx.lineTo(106, 86); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#fffbeb'; ctx.lineWidth = 2.4; ctx.stroke();
  ctx.restore();
  drawFacetedGem(ctx, 64, 64, 20, 24, -0.78, { bright: '#fecdd3', mid: '#e11d48', deep: '#4c0519', bounce: '#fda4af' });
  drawSculptedStar(ctx, 136, 40, 18, '#fffbeb', '#fbbf24', 0.1, 0.95);
  return c;
}

function renderFrameDevTL() {
  const c = newCanvas(640, 480), ctx = c.getContext('2d');
  ctx.save();
  ctx.shadowColor = 'rgba(16, 185, 129, 0.45)'; ctx.shadowBlur = 18;
  ctx.fillStyle = '#071a14';
  ctx.beginPath();
  ctx.moveTo(14, 250); ctx.lineTo(14, 28); ctx.lineTo(28, 14); ctx.lineTo(400, 14);
  ctx.lineTo(372, 42); ctx.lineTo(80, 42); ctx.lineTo(44, 78); ctx.lineTo(44, 224);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#34d399'; ctx.lineWidth = 3; ctx.stroke();
  ctx.strokeStyle = '#6ee7b7'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(26, 200); ctx.lineTo(26, 34); ctx.lineTo(34, 26); ctx.lineTo(330, 26); ctx.stroke();
  ctx.restore();
  drawFacetedGem(ctx, 56, 56, 16, 20, -0.78, { bright: '#d1fae5', mid: '#10b981', deep: '#064e3b', bezelLight: '#a7f3d0', bezelMid: '#059669', bezelDark: '#064e3b' });
  return c;
}

// Sprites individuais para os Profile Effects narrativos (256x256)
function renderEffectPetalSprite() {
  const c = newCanvas(256, 256), ctx = c.getContext('2d');
  drawSingleSakuraPetal(ctx, 128, 128, 92, 0.25);
  return c;
}
function renderEffectBlossomSprite() {
  const c = newCanvas(256, 256), ctx = c.getContext('2d');
  drawSakuraBlossom(ctx, 128, 128, 102, 0.1, 0);
  return c;
}
function renderEffectCrystalSprite() {
  const c = newCanvas(256, 256), ctx = c.getContext('2d');
  drawIceCrystal(ctx, 128, 226, 198, 72, 0);
  return c;
}
function renderEffectCometSprite() {
  const c = newCanvas(256, 256), ctx = c.getContext('2d');
  // Cometa astral pintado com cauda volumétrica
  const tailG = ctx.createLinearGradient(20, 128, 215, 128);
  tailG.addColorStop(0, 'rgba(99,102,241,0)');
  tailG.addColorStop(0.45, 'rgba(167,139,250,0.45)');
  tailG.addColorStop(0.8, 'rgba(253,230,138,0.85)');
  tailG.addColorStop(1, '#ffffff');
  ctx.fillStyle = tailG;
  ctx.beginPath();
  ctx.moveTo(20, 128);
  ctx.quadraticCurveTo(135, 92, 212, 114);
  ctx.arc(212, 128, 14, -Math.PI / 2, Math.PI / 2);
  ctx.quadraticCurveTo(135, 164, 20, 128);
  ctx.closePath();
  ctx.fill();
  drawSculptedStar(ctx, 212, 128, 38, '#ffffff', '#fde68a', 0, 1);
  return c;
}
function renderEffectPrismSprite() {
  const c = newCanvas(256, 256), ctx = c.getContext('2d');
  ctx.save();
  ctx.translate(128, 128);
  ctx.shadowColor = 'rgba(56,232,255,0.65)';
  ctx.shadowBlur = 22;
  const g1 = ctx.createLinearGradient(-70, -90, 70, 90);
  g1.addColorStop(0, '#ffffff');
  g1.addColorStop(0.3, '#67e8f9');
  g1.addColorStop(0.7, '#f43f9e');
  g1.addColorStop(1, '#4c1d95');
  ctx.fillStyle = g1;
  ctx.beginPath();
  ctx.moveTo(0, -104); ctx.lineTo(68, -10); ctx.lineTo(0, 104); ctx.lineTo(-68, -10);
  ctx.closePath();
  ctx.fill();
  // Faceta clara esquerda
  ctx.fillStyle = 'rgba(255,255,255,0.42)';
  ctx.beginPath();
  ctx.moveTo(0, -104); ctx.lineTo(-68, -10); ctx.lineTo(0, 12);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, -104); ctx.lineTo(68, -10); ctx.lineTo(0, 104); ctx.lineTo(-68, -10); ctx.closePath();
  ctx.stroke();
  ctx.restore();
  return c;
}

// Folha de inspeção visual: 4 avatares + 4 cards de perfil sobre fundo real escuro do Sanvo!
function renderContactSheet(assets) {
  const c = newCanvas(1600, 1120), ctx = c.getContext('2d');
  ctx.fillStyle = '#0f1219';
  ctx.fillRect(0, 0, 1600, 1120);

  ctx.fillStyle = '#f8fafc';
  ctx.font = '700 28px "Segoe UI", sans-serif';
  ctx.fillText('SANVO V5 — INSPEÇÃO VISUAL REAL (4 AVATAR DECORATIONS + 4 PROFILE FRAMES)', 42, 48);

  const avList = [
    ['Astrolábio Celestial', assets['deco_astral_back'], assets['deco_astral_front'], '#4f46e5', 'SW'],
    ['Ramo de Hanami', assets['deco_sakura_back'], assets['deco_sakura_front'], '#be185d', 'SW'],
    ['Dragão Glacial', assets['deco_frost_back'], assets['deco_frost_front'], '#0284c7', 'SW'],
    ['Kitsune-Neko Cyber', assets['deco_cyber_back'], assets['deco_cyber_front'], '#7c3aed', 'SW'],
  ];

  avList.forEach(([label, back, front, bg, init], idx) => {
    const bx = 65 + idx * 380, by = 92;
    ctx.fillStyle = '#181d28';
    ctx.beginPath(); ctx.roundRect(bx, by, 330, 360, 18); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1.5; ctx.stroke();

    const cx = bx + 165, cy = by + 172;
    // Back layer
    ctx.drawImage(back, cx - 140, cy - 140, 280, 280);
    // Simulated Avatar Circle (radius = 345/1024 * 280 = 94px, 100% centrado!)
    const ar = 94;
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, ar, 0, Math.PI * 2); ctx.clip();
    const ag = ctx.createLinearGradient(cx - ar, cy - ar, cx + ar, cy + ar);
    ag.addColorStop(0, bg); ag.addColorStop(1, '#111827');
    ctx.fillStyle = ag; ctx.fillRect(cx - ar, cy - ar, ar * 2, ar * 2);
    ctx.fillStyle = '#ffffff'; ctx.font = '800 54px "Segoe UI", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(init, cx, cy + 2);
    ctx.restore();
    // Front layer
    ctx.drawImage(front, cx - 140, cy - 140, 280, 280);

    ctx.fillStyle = '#e2e8f0'; ctx.font = '600 18px "Segoe UI", sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(label, cx, by + 334);
  });

  // Linha inferior: 4 Profile Cards com as Profile Frames assimétricas (TL + TR + BR) + Avatar Decorations!
  const frList = [
    ['Observatório Astralium', assets['frame_astral_tl'], assets['frame_astral_tr'], assets['frame_astral_br'], assets['deco_astral_back'], assets['deco_astral_front'], ['#1e1b4b', '#312e81']],
    ['Jardim de Hanami', assets['frame_sakura_tl'], assets['frame_sakura_tr'], assets['frame_sakura_br'], assets['deco_sakura_back'], assets['deco_sakura_front'], ['#4c0519', '#831843']],
    ['Cidadela de Glacium', assets['frame_frost_tl'], assets['frame_frost_tr'], assets['frame_frost_br'], assets['deco_frost_back'], assets['deco_frost_front'], ['#0c4a6e', '#1e3a8a']],
    ['Chassi Synth-Neko', assets['frame_cyber_tl'], assets['frame_cyber_tr'], assets['frame_cyber_br'], assets['deco_cyber_back'], assets['deco_cyber_front'], ['#1e1b4b', '#3b0764']],
  ];

  frList.forEach(([label, tl, tr, br, db, df, ban], idx) => {
    const x = 65 + idx * 380, y = 490, w = 330, h = 560;
    ctx.save();
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 16); ctx.clip();
    ctx.fillStyle = '#151924'; ctx.fillRect(x, y, w, h);
    const bg = ctx.createLinearGradient(x, y, x + w, y + 128);
    bg.addColorStop(0, ban[0]); bg.addColorStop(1, ban[1]);
    ctx.fillStyle = bg; ctx.fillRect(x, y, w, 128);
    ctx.restore();

    // Borda sutil do card
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 16); ctx.stroke();

    // Frame TL, TR & BR pintados!
    ctx.drawImage(tl, x - 6, y - 6, 210, 158);
    ctx.drawImage(tr, x + w - 204, y - 6, 210, 158);
    ctx.drawImage(br, x + w - 178, y + h - 134, 184, 138);

    // Avatar com decoração sobre o banner (100% concêntrico!)
    const acx = x + 64, acy = y + 128;
    ctx.drawImage(db, acx - 62, acy - 62, 124, 124);
    ctx.save();
    ctx.beginPath(); ctx.arc(acx, acy, 41, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = '#2563eb'; ctx.fillRect(acx - 42, acy - 42, 84, 84);
    ctx.fillStyle = '#fff'; ctx.font = '800 24px "Segoe UI"'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('SW', acx, acy + 1);
    ctx.restore();
    ctx.drawImage(df, acx - 62, acy - 62, 124, 124);

    // Texto de perfil simulado para validar legibilidade 100%
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#f8fafc'; ctx.font = '700 22px "Segoe UI"';
    ctx.fillText('Swag', x + 22, y + 218);
    ctx.fillStyle = '#94a3b8'; ctx.font = '500 13px "Segoe UI"';
    ctx.fillText('@swag • ' + label, x + 22, y + 238);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.beginPath(); ctx.roundRect(x + 20, y + 260, w - 40, 268, 10); ctx.fill();
    ctx.fillStyle = '#cbd5e1'; ctx.font = '500 13px "Segoe UI"';
    ctx.fillText('Perfil limpo, legível e com identidade', x + 34, y + 292);
    ctx.fillText('artística real em múltiplas camadas.', x + 34, y + 314);
  });
  return c;
}

window.__RENDER_ALL = () => {
  const map = {
    deco_astral_back: renderAstralBack(),
    deco_astral_front: renderAstralFront(),
    deco_sakura_back: renderSakuraBack(),
    deco_sakura_front: renderSakuraFront(),
    deco_frost_back: renderFrostBack(),
    deco_frost_front: renderFrostFront(),
    deco_cyber_back: renderCyberCatBack(),
    deco_cyber_front: renderCyberCatFront(false),
    deco_cyber_blink: renderCyberCatFront(true),
    frame_astral_tl: renderFrameAstralTL(),
    frame_astral_tr: renderFrameAstralTR(),
    frame_astral_br: renderFrameAstralBR(),
    frame_sakura_tl: renderFrameSakuraTL(),
    frame_sakura_tr: renderFrameSakuraTR(),
    frame_sakura_br: renderFrameSakuraBR(),
    frame_frost_tl: renderFrameFrostTL(),
    frame_frost_tr: renderFrameFrostTR(),
    frame_frost_br: renderFrameFrostBR(),
    frame_cyber_tl: renderFrameCyberTL(),
    frame_cyber_tr: renderFrameCyberTR(),
    frame_cyber_br: renderFrameCyberBR(),
    frame_founder_tl: renderFrameFounderTL(),
    frame_dev_tl: renderFrameDevTL(),
    fx_sakura_petal: renderEffectPetalSprite(),
    fx_sakura_blossom: renderEffectBlossomSprite(),
    fx_frost_crystal: renderEffectCrystalSprite(),
    fx_astral_comet: renderEffectCometSprite(),
    fx_cyber_prism: renderEffectPrismSprite(),
  };
  map.contact_sheet = renderContactSheet(map);
  const out = {};
  for (const [k, canvas] of Object.entries(map)) {
    out[k] = canvas.toDataURL('image/png');
  }
  return out;
};
</script>
</body>
</html>`;

const srv = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(STUDIO_HTML);
});

srv.listen(0, '127.0.0.1', async () => {
  const port = srv.address().port;
  const dbgPort = 19700 + Math.floor(Math.random() * 400);
  const userDir = path.join(process.env.TEMP, 'sanvo-v5-studio-' + Date.now());
  const edge = spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', [
    '--headless=new', '--disable-gpu', `--remote-debugging-port=${dbgPort}`,
    `--user-data-dir=${userDir}`, '--no-first-run', '--no-default-browser-check',
    `http://127.0.0.1:${port}/`
  ], { stdio: 'ignore' });

  const cleanup = () => {
    try { edge.kill(); } catch {}
    try { srv.close(); } catch {}
    try { fs.rmSync(userDir, { recursive: true, force: true }); } catch {}
  };
  setTimeout(() => { console.error('TIMEOUT'); cleanup(); process.exit(1); }, 30000);

  let target = null;
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${dbgPort}/json`);
      const list = await r.json();
      target = list.find(t => t.type === 'page' && t.url.includes(`127.0.0.1:${port}`));
      if (target) break;
    } catch {}
    await new Promise(r => setTimeout(r, 150));
  }
  if (!target) { console.error('NO TARGET'); cleanup(); process.exit(1); }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 1;
  const pending = new Map();
  const call = (method, params = {}) => new Promise((res, rej) => {
    const id = seq++;
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params }));
  });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id); pending.delete(msg.id);
      if (msg.error) p.rej(msg.error); else p.res(msg.result);
    }
  };
  await new Promise(r => ws.onopen = r);
  await call('Runtime.enable');
  for (let i = 0; i < 40; i++) {
    const chk = await call('Runtime.evaluate', { expression: 'typeof window.__RENDER_ALL', returnByValue: true });
    if (chk.result?.value === 'function') break;
    await new Promise(r => setTimeout(r, 100));
  }

  const evalRes = await call('Runtime.evaluate', {
    expression: 'window.__RENDER_ALL()',
    returnByValue: true,
  });
  if (evalRes.exceptionDetails) {
    console.error('STUDIO ERROR:', JSON.stringify(evalRes.exceptionDetails));
    cleanup(); process.exit(1);
  }
  const images = evalRes.result.value;
  for (const [name, dataUrl] of Object.entries(images)) {
    const b64 = dataUrl.replace(/^data:image\/png;base64,/, '');
    fs.writeFileSync(path.join(RAW_DIR, `${name}.png`), Buffer.from(b64, 'base64'));
  }
  console.log(`RENDERED ${Object.keys(images).length} PNGs to ${RAW_DIR}`);
  cleanup();

  // Converte para WebP HiDPI otimizado em static/cosmetics/assets usando Pillow (Lanczos supersampling!)
  const pyScript = `
import os, glob
from PIL import Image

raw_dir = r"${RAW_DIR}"
out_dir = r"${OUT_DIR}"
total = 0
for fp in sorted(glob.glob(os.path.join(raw_dir, "*.png"))):
    name = os.path.splitext(os.path.basename(fp))[0]
    if name == "contact_sheet":
        continue
    im = Image.open(fp).convert("RGBA")
    if name.startswith("deco_"):
        im = im.resize((320, 320), Image.Resampling.LANCZOS)
    elif name.startswith("frame_"):
        im = im.resize((360, 270), Image.Resampling.LANCZOS)
    elif name.startswith("fx_"):
        im = im.resize((192, 192), Image.Resampling.LANCZOS)
    out_path = os.path.join(out_dir, f"{name}.webp")
    im.save(out_path, "WEBP", quality=90, method=6)
    sz = os.path.getsize(out_path)
    total += sz
    print(f"  {name}.webp: {im.size[0]}x{im.size[1]} ({sz/1024:.1f} KB)")
print(f"TOTAL WEBP BUDGET: {total/1024:.1f} KB")
`;
  const pyOut = execFileSync('python', ['-c', pyScript], { encoding: 'utf8' });
  console.log(pyOut);
  process.exit(0);
});
