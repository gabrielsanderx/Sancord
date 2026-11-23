/**
 * Sanvo V5 Expansion Art Studio — Renderiza as 4 novas coleções Flagship pintadas
 * (Forja de Drakon, Grimório Arcano, Santuário Abissal, Arco de Serafim) +
 * conjunto exclusivo Soberano Imperial (badge:sovereign) em Chromium HiDPI RGBA WebP
 * com folha de inspeção visual para validação pixel a pixel.
 */
import http from 'http';
import fs from 'fs';
import path from 'path';
import { spawn, execFileSync } from 'child_process';

const ROOT = 'd:\\Sancord';
const OUT_DIR = path.join(ROOT, 'static', 'cosmetics', 'assets');
const RAW_DIR = 'C:\\Users\\gabri\\.gemini\\antigravity\\brain\\639e93b4-dc25-4b1f-b1eb-a0819523d71b\\scratch\\v5_exp_raw';
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(RAW_DIR, { recursive: true });

const STUDIO_HTML = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Sanvo V5 Expansion Studio</title></head>
<body style="margin:0;background:transparent;">
<canvas id="c" width="1024" height="1024"></canvas>
<script>
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

// ============================================================================
// Utilitários de Pintura Digital (PBR-like metal, gemas, plumas, chamas, vidro)
// ============================================================================
function drawSculptedStar(ctx, x, y, r, core = '#ffffff', glow = '#fde68a', rot = 0, alpha = 1) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.globalAlpha = alpha;
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 2.2);
  g.addColorStop(0, core);
  g.addColorStop(0.28, glow);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(0, 0, r * 2.2, 0, Math.PI * 2); ctx.fill();

  ctx.fillStyle = core;
  ctx.beginPath();
  const ir = r * 0.17;
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    const rad = i % 2 === 0 ? r : ir;
    const px = Math.cos(a) * rad, py = Math.sin(a) * rad;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

function drawFacetedGem(ctx, x, y, rx, ry, rot, pal) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  // Bezel metálico
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.68)';
  ctx.shadowBlur = rx * 0.45;
  ctx.shadowOffsetY = rx * 0.14;
  const bz = ctx.createLinearGradient(-rx, -ry, rx, ry);
  bz.addColorStop(0, pal.bezelLight || '#fff3c4');
  bz.addColorStop(0.48, pal.bezelMid || '#d4a13c');
  bz.addColorStop(1, pal.bezelDark || '#4a2d08');
  ctx.fillStyle = bz;
  ctx.beginPath(); ctx.ellipse(0, 0, rx * 1.24, ry * 1.24, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  // Corpo da gema
  const bg = ctx.createRadialGradient(-rx * 0.25, -ry * 0.3, rx * 0.05, 0, 0, Math.max(rx, ry));
  bg.addColorStop(0, pal.bright);
  bg.addColorStop(0.55, pal.mid);
  bg.addColorStop(1, pal.deep);
  ctx.fillStyle = bg;
  ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); ctx.fill();

  // Facetas lapidadas
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
    ctx.fillStyle = i < 3 ? 'rgba(255,255,255,0.34)' : i < 5 ? 'rgba(255,255,255,0.08)' : 'rgba(8,6,20,0.42)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = Math.max(1, rx * 0.04);
    ctx.stroke();
  }
  // Catchlight
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.ellipse(-rx * 0.28, -ry * 0.3, rx * 0.22, ry * 0.13, -0.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = pal.bounce || 'rgba(255,255,255,0.75)';
  ctx.beginPath(); ctx.arc(rx * 0.24, ry * 0.28, rx * 0.09, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

// Pluma pintada com barbas individuais, brilho dourado e raque central
function drawPaintedFeather(ctx, x, y, len, width, angle, pal = {}) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  const cLight = pal.light || '#fffdf5';
  const cMid = pal.mid || '#f6e1b2';
  const cTip = pal.tip || '#d49a35';
  const cShadow = pal.shadow || '#7c4e12';

  ctx.shadowColor = pal.glow || 'rgba(253,224,71,0.35)';
  ctx.shadowBlur = 14;

  // Silhueta principal da pluma com pequenos entalhes orgânicos
  const g = ctx.createLinearGradient(0, -len * 0.5, 0, len * 0.5);
  g.addColorStop(0, cLight);
  g.addColorStop(0.55, cMid);
  g.addColorStop(0.88, cTip);
  g.addColorStop(1, cShadow);

  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(0, -len * 0.52);
  ctx.bezierCurveTo(width * 0.65, -len * 0.38, width * 0.85, -len * 0.06, width * 0.52, len * 0.22);
  ctx.lineTo(width * 0.32, len * 0.16);
  ctx.lineTo(width * 0.44, len * 0.32);
  ctx.bezierCurveTo(width * 0.25, len * 0.46, width * 0.08, len * 0.52, 0, len * 0.56);
  ctx.bezierCurveTo(-width * 0.15, len * 0.5, -width * 0.48, len * 0.34, -width * 0.58, len * 0.14);
  ctx.lineTo(-width * 0.36, len * 0.08);
  ctx.lineTo(-width * 0.66, -len * 0.02);
  ctx.bezierCurveTo(-width * 0.84, -len * 0.26, -width * 0.52, -len * 0.44, 0, -len * 0.52);
  ctx.closePath();
  ctx.fill();

  // Barbas finas pintadas
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.lineWidth = Math.max(1, width * 0.032);
  for (let i = -7; i <= 7; i++) {
    const t = i / 8;
    const py = t * len * 0.44;
    const span = width * 0.62 * Math.cos(t * 1.25);
    if (span < 4) continue;
    ctx.beginPath();
    ctx.moveTo(0, py);
    ctx.quadraticCurveTo(span * 0.55, py - len * 0.04, span, py - len * 0.09);
    ctx.moveTo(0, py);
    ctx.quadraticCurveTo(-span * 0.55, py - len * 0.04, -span, py - len * 0.08);
    ctx.stroke();
  }

  // Raque dourada central
  const qg = ctx.createLinearGradient(0, -len * 0.52, 0, len * 0.62);
  qg.addColorStop(0, '#ffffff');
  qg.addColorStop(0.5, '#fde68a');
  qg.addColorStop(1, '#b45309');
  ctx.strokeStyle = qg;
  ctx.lineWidth = Math.max(2, width * 0.065);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, -len * 0.48);
  ctx.quadraticCurveTo(width * 0.05, 0, 0, len * 0.62);
  ctx.stroke();
  ctx.restore();
}

// Chama esculpida em camadas (núcleo branco-ouro, corpo laranja-rubro, fumaça obsidiana)
function drawPaintedFlame(ctx, x, y, len, width, angle, alpha = 1) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.globalAlpha = alpha;

  // Halo quente externo
  const hg = ctx.createRadialGradient(0, 0, width * 0.1, 0, 0, len * 0.72);
  hg.addColorStop(0, 'rgba(251,146,60,0.52)');
  hg.addColorStop(0.55, 'rgba(220,38,38,0.22)');
  hg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = hg;
  ctx.beginPath(); ctx.arc(0, 0, len * 0.72, 0, Math.PI * 2); ctx.fill();

  // Corpo externo rubro-laranja
  const g1 = ctx.createLinearGradient(0, len * 0.45, 0, -len * 0.55);
  g1.addColorStop(0, '#991b1b');
  g1.addColorStop(0.4, '#ea580c');
  g1.addColorStop(0.78, '#fbbf24');
  g1.addColorStop(1, '#fef9c3');
  ctx.fillStyle = g1;
  ctx.beginPath();
  ctx.moveTo(0, len * 0.46);
  ctx.bezierCurveTo(width * 0.75, len * 0.22, width * 0.58, -len * 0.18, 0, -len * 0.56);
  ctx.bezierCurveTo(-width * 0.52, -len * 0.14, -width * 0.78, len * 0.24, 0, len * 0.46);
  ctx.closePath();
  ctx.fill();

  // Núcleo incandescente
  const g2 = ctx.createLinearGradient(0, len * 0.34, 0, -len * 0.3);
  g2.addColorStop(0, '#f59e0b');
  g2.addColorStop(0.55, '#fef08a');
  g2.addColorStop(1, '#ffffff');
  ctx.fillStyle = g2;
  ctx.beginPath();
  ctx.moveTo(0, len * 0.34);
  ctx.bezierCurveTo(width * 0.36, len * 0.14, width * 0.28, -len * 0.1, 0, -len * 0.32);
  ctx.bezierCurveTo(-width * 0.26, -len * 0.08, -width * 0.38, len * 0.16, 0, len * 0.34);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// Chifre / garra de obsidiana esculpida com veios incandescentes
function drawObsidianHorn(ctx, x, y, scale, flip = false, rot = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  if (flip) ctx.scale(-1, 1);
  ctx.scale(scale, scale);

  ctx.shadowColor = 'rgba(0,0,0,0.75)';
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 6;

  // Corpo de obsidiana facetada
  const og = ctx.createLinearGradient(-40, 120, 90, -160);
  og.addColorStop(0, '#0f0a0e');
  og.addColorStop(0.35, '#271a24');
  og.addColorStop(0.68, '#44262c');
  og.addColorStop(0.88, '#9a3412');
  og.addColorStop(1, '#fb923c');
  ctx.fillStyle = og;
  ctx.beginPath();
  ctx.moveTo(-36, 126);
  ctx.bezierCurveTo(-18, 25, 22, -75, 86, -158);
  ctx.bezierCurveTo(58, -62, 50, 26, 46, 118);
  ctx.closePath();
  ctx.fill();

  // Borda especular de mineral
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(254,215,170,0.52)';
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.moveTo(-26, 114);
  ctx.bezierCurveTo(-8, 18, 28, -72, 82, -150);
  ctx.stroke();

  // Sulcos / anéis de chifre de dragão com brasa interna
  for (let i = 0; i < 6; i++) {
    const t = i / 6;
    const py = 92 - t * 185;
    const px = -12 + t * 65;
    const w = 48 * (1 - t * 0.65);
    ctx.strokeStyle = i < 3 ? 'rgba(251,146,60,0.82)' : 'rgba(254,240,138,0.88)';
    ctx.lineWidth = 3.2 - t * 1.4;
    ctx.beginPath();
    ctx.moveTo(px - w * 0.35, py + 8);
    ctx.quadraticCurveTo(px + w * 0.1, py - 4, px + w * 0.62, py + 6);
    ctx.stroke();
  }
  ctx.restore();
}

// Água-viva bioluminescente pintada
function drawJellyfish(ctx, x, y, r, rot = 0, alpha = 1) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.globalAlpha = alpha;

  // Tentáculos translúcidos ondulantes
  for (let i = -3; i <= 3; i++) {
    const ox = i * r * 0.2;
    const len = r * (1.85 - Math.abs(i) * 0.16);
    const tg = ctx.createLinearGradient(ox, r * 0.15, ox, r * 0.15 + len);
    tg.addColorStop(0, i % 2 === 0 ? 'rgba(103,232,249,0.88)' : 'rgba(192,132,252,0.78)');
    tg.addColorStop(0.55, 'rgba(34,211,238,0.45)');
    tg.addColorStop(1, 'rgba(34,211,238,0)');
    ctx.strokeStyle = tg;
    ctx.lineWidth = Math.max(1.8, r * (0.09 - Math.abs(i) * 0.01));
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(ox, r * 0.16);
    ctx.bezierCurveTo(
      ox + Math.sin(i + 1) * r * 0.36, r * 0.16 + len * 0.35,
      ox - Math.cos(i) * r * 0.38, r * 0.16 + len * 0.7,
      ox + Math.sin(i * 2) * r * 0.25, r * 0.16 + len
    );
    ctx.stroke();
  }

  // Halo bioluminescente
  const halo = ctx.createRadialGradient(0, -r * 0.1, r * 0.08, 0, 0, r * 1.55);
  halo.addColorStop(0, 'rgba(103,232,249,0.55)');
  halo.addColorStop(0.55, 'rgba(56,189,248,0.22)');
  halo.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = halo;
  ctx.beginPath(); ctx.arc(0, 0, r * 1.55, 0, Math.PI * 2); ctx.fill();

  // Sino translúcido
  const bg = ctx.createRadialGradient(-r * 0.2, -r * 0.35, r * 0.05, 0, -r * 0.05, r * 1.05);
  bg.addColorStop(0, 'rgba(236,254,255,0.96)');
  bg.addColorStop(0.38, 'rgba(103,232,249,0.84)');
  bg.addColorStop(0.75, 'rgba(99,102,241,0.68)');
  bg.addColorStop(1, 'rgba(30,27,75,0.52)');
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.moveTo(-r * 0.92, r * 0.18);
  ctx.bezierCurveTo(-r * 1.02, -r * 0.72, -r * 0.42, -r * 1.05, 0, -r * 1.05);
  ctx.bezierCurveTo(r * 0.42, -r * 1.05, r * 1.02, -r * 0.72, r * 0.92, r * 0.18);
  ctx.quadraticCurveTo(r * 0.45, r * 0.34, 0, r * 0.22);
  ctx.quadraticCurveTo(-r * 0.45, r * 0.34, -r * 0.92, r * 0.18);
  ctx.closePath();
  ctx.fill();

  // Nervuras brilhantes internas + catchlight
  ctx.strokeStyle = 'rgba(255,255,255,0.58)';
  ctx.lineWidth = Math.max(1.5, r * 0.045);
  for (let i = -2; i <= 2; i++) {
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.92);
    ctx.quadraticCurveTo(i * r * 0.36, -r * 0.45, i * r * 0.34, r * 0.16);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.78)';
  ctx.beginPath(); ctx.ellipse(-r * 0.26, -r * 0.52, r * 0.24, r * 0.12, -0.45, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

// Bolha iridescente perolada
function drawPearlBubble(ctx, x, y, r, alpha = 1) {
  ctx.save();
  ctx.translate(x, y);
  ctx.globalAlpha = alpha;
  const g = ctx.createRadialGradient(-r * 0.3, -r * 0.32, r * 0.08, 0, 0, r);
  g.addColorStop(0, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.28, 'rgba(165,243,252,0.45)');
  g.addColorStop(0.68, 'rgba(192,132,252,0.28)');
  g.addColorStop(0.88, 'rgba(34,211,238,0.72)');
  g.addColorStop(1, 'rgba(255,255,255,0.88)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();

  ctx.strokeStyle = 'rgba(224,242,254,0.85)';
  ctx.lineWidth = Math.max(1.2, r * 0.08);
  ctx.stroke();

  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.ellipse(-r * 0.34, -r * 0.36, r * 0.24, r * 0.14, -0.6, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

// ============================================================================
// COLEÇÃO 5: FORJA DE DRAKON (INFERNAL)
// ============================================================================
function renderInfernalBack() {
  const c = newCanvas(1024, 1024);
  const ctx = c.getContext('2d');
  const cx = 512, cy = 512, R = 338;

  // Aura vulcânica profunda atrás do avatar
  const aura = ctx.createRadialGradient(cx, cy, R * 0.72, cx, cy, R * 1.44);
  aura.addColorStop(0, 'rgba(234,88,12,0.56)');
  aura.addColorStop(0.45, 'rgba(153,27,27,0.38)');
  aura.addColorStop(0.82, 'rgba(30,10,12,0.24)');
  aura.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = aura;
  ctx.beginPath(); ctx.arc(cx, cy, R * 1.44, 0, Math.PI * 2); ctx.fill();

  // Asas dracônicas de obsidiana + membrana em brasa
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.translate(cx + side * 265, cy - 30);
    ctx.scale(side, 1);
    const wg = ctx.createLinearGradient(0, -180, 200, 190);
    wg.addColorStop(0, '#1c1014');
    wg.addColorStop(0.45, '#7c2d12');
    wg.addColorStop(0.8, '#ea580c');
    wg.addColorStop(1, '#fbbf24');
    ctx.fillStyle = wg;
    ctx.beginPath();
    ctx.moveTo(-25, 20);
    ctx.bezierCurveTo(30, -135, 130, -195, 210, -160);
    ctx.bezierCurveTo(175, -85, 188, -10, 160, 62);
    ctx.bezierCurveTo(120, 48, 95, 92, 66, 138);
    ctx.bezierCurveTo(28, 105, 5, 78, -25, 20);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(253,186,116,0.58)';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.restore();
  }

  // Chifres de dragão esculpidos subindo do topo
  drawObsidianHorn(ctx, cx - 228, cy - 228, 1.38, true, -0.32);
  drawObsidianHorn(ctx, cx + 228, cy - 228, 1.38, false, 0.32);

  // Anel forjado de obsidiana com magma interno
  const ring = ctx.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
  ring.addColorStop(0, '#fbbf24');
  ring.addColorStop(0.32, '#9a3412');
  ring.addColorStop(0.65, '#271418');
  ring.addColorStop(1, '#ea580c');
  ctx.strokeStyle = ring;
  ctx.lineWidth = 22;
  ctx.beginPath(); ctx.arc(cx, cy, R + 16, 0, Math.PI * 2); ctx.stroke();

  // Chamas saindo por trás
  drawPaintedFlame(ctx, cx - 295, cy + 120, 210, 88, -0.6, 0.85);
  drawPaintedFlame(ctx, cx + 295, cy + 120, 210, 88, 0.6, 0.85);
  return c;
}

function renderInfernalFront() {
  const c = newCanvas(1024, 1024);
  const ctx = c.getContext('2d');
  const cx = 512, cy = 512, R = 338;

  // Colar de armadura dracônica em obsidiana e ouro na base
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.72)';
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 8;
  const collarG = ctx.createLinearGradient(cx - 320, cy + 170, cx + 320, cy + 380);
  collarG.addColorStop(0, '#1c1216');
  collarG.addColorStop(0.32, '#451a1d');
  collarG.addColorStop(0.5, '#f59e0b');
  collarG.addColorStop(0.68, '#451a1d');
  collarG.addColorStop(1, '#1c1216');
  ctx.fillStyle = collarG;
  ctx.beginPath();
  ctx.arc(cx, cy, R + 44, 0.14 * Math.PI, 0.86 * Math.PI);
  ctx.arc(cx, cy, R - 4, 0.86 * Math.PI, 0.14 * Math.PI, true);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(254,215,170,0.62)';
  ctx.lineWidth = 3.5;
  ctx.stroke();
  ctx.restore();

  // Línguas de fogo pintadas abraçando as laterais inferiores
  drawPaintedFlame(ctx, cx - 275, cy + 210, 175, 76, -0.52, 0.96);
  drawPaintedFlame(ctx, cx + 275, cy + 210, 175, 76, 0.52, 0.96);
  drawPaintedFlame(ctx, cx - 348, cy + 20, 150, 58, -0.18, 0.88);
  drawPaintedFlame(ctx, cx + 348, cy + 20, 150, 58, 0.18, 0.88);

  // Gema rubi-magma central na base
  drawFacetedGem(ctx, cx, cy + R + 22, 34, 42, 0, {
    bright: '#fef08a', mid: '#ea580c', deep: '#7f1d1d',
    bezelLight: '#fde68a', bezelMid: '#b45309', bezelDark: '#3b1507',
    bounce: 'rgba(254,215,170,0.9)',
  });

  // Escamas/espinhos de ouro nas laterais da gema
  for (const s of [-1, 1]) {
    drawSculptedStar(ctx, cx + s * 104, cy + R + 4, 22, '#fffbeb', '#fb923c', 0.25, 0.92);
    drawSculptedStar(ctx, cx + s * 228, cy + 258, 16, '#ffffff', '#f97316', 0.4, 0.85);
  }
  drawSculptedStar(ctx, cx - 260, cy - 270, 20, '#fff7ed', '#fbbf24', 0.2, 0.88);
  drawSculptedStar(ctx, cx + 270, cy - 255, 18, '#fff7ed', '#fb923c', 0.5, 0.85);
  return c;
}

function renderFrameInfernalTL() {
  const c = newCanvas(640, 480);
  const ctx = c.getContext('2d');
  // Halo de forja no canto
  const g = ctx.createRadialGradient(90, 80, 10, 90, 80, 280);
  g.addColorStop(0, 'rgba(234,88,12,0.44)');
  g.addColorStop(0.55, 'rgba(153,27,27,0.18)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 420, 360);

  // Chapa de armadura dracônica em L assimétrico
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.72)';
  ctx.shadowBlur = 18;
  const ag = ctx.createLinearGradient(0, 0, 380, 280);
  ag.addColorStop(0, '#1a0e12');
  ag.addColorStop(0.35, '#431419');
  ag.addColorStop(0.65, '#9a3412');
  ag.addColorStop(1, '#fb923c');
  ctx.fillStyle = ag;
  ctx.beginPath();
  ctx.moveTo(14, 14);
  ctx.lineTo(390, 14);
  ctx.quadraticCurveTo(255, 42, 130, 56);
  ctx.quadraticCurveTo(64, 118, 48, 295);
  ctx.lineTo(14, 345);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(253,186,116,0.75)';
  ctx.lineWidth = 3.5;
  ctx.stroke();
  ctx.restore();

  // Chifre dracônico curvando sobre o canto
  drawObsidianHorn(ctx, 118, 108, 0.86, false, 0.92);
  drawPaintedFlame(ctx, 198, 56, 128, 50, 1.05, 0.92);
  drawPaintedFlame(ctx, 56, 196, 118, 44, -0.22, 0.88);
  drawFacetedGem(ctx, 64, 64, 28, 28, 0.78, {
    bright: '#fef08a', mid: '#ef4444', deep: '#7f1d1d',
    bezelLight: '#fde68a', bezelMid: '#d97706', bezelDark: '#451a03',
  });
  drawSculptedStar(ctx, 295, 36, 18, '#fffbeb', '#fb923c', 0.2, 0.9);
  return c;
}

function renderFrameInfernalTR() {
  const c = newCanvas(640, 480);
  const ctx = c.getContext('2d');
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.68)';
  ctx.shadowBlur = 16;
  const g = ctx.createLinearGradient(640, 0, 260, 260);
  g.addColorStop(0, '#1c1014');
  g.addColorStop(0.42, '#7c2d12');
  g.addColorStop(0.85, '#f97316');
  g.addColorStop(1, '#fde68a');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(626, 14);
  ctx.lineTo(310, 14);
  ctx.quadraticCurveTo(465, 38, 545, 76);
  ctx.quadraticCurveTo(585, 148, 594, 300);
  ctx.lineTo(626, 338);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(253,186,116,0.7)';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.restore();

  drawObsidianHorn(ctx, 544, 114, 0.78, true, -0.88);
  drawPaintedFlame(ctx, 472, 68, 118, 46, -0.92, 0.9);
  drawFacetedGem(ctx, 578, 62, 22, 22, 0.78, {
    bright: '#fef9c3', mid: '#f97316', deep: '#7c2d12',
    bezelLight: '#fde68a', bezelMid: '#b45309', bezelDark: '#3b1507',
  });
  drawSculptedStar(ctx, 392, 42, 16, '#fff7ed', '#fb923c', 0.3, 0.88);
  return c;
}

function renderFrameInfernalBR() {
  const c = newCanvas(640, 480);
  const ctx = c.getContext('2d');
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.68)';
  ctx.shadowBlur = 14;
  const g = ctx.createLinearGradient(640, 480, 320, 240);
  g.addColorStop(0, '#1c1014');
  g.addColorStop(0.5, '#7c2d12');
  g.addColorStop(1, '#fb923c');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(626, 466);
  ctx.lineTo(355, 466);
  ctx.quadraticCurveTo(510, 444, 565, 398);
  ctx.quadraticCurveTo(598, 345, 604, 215);
  ctx.lineTo(626, 190);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(253,186,116,0.68)';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.restore();

  drawPaintedFlame(ctx, 562, 392, 112, 44, -0.5, 0.9);
  drawFacetedGem(ctx, 578, 418, 22, 22, 0.78, {
    bright: '#fef08a', mid: '#ea580c', deep: '#7f1d1d',
  });
  drawSculptedStar(ctx, 465, 434, 15, '#fffbeb', '#f97316', 0.1, 0.85);
  return c;
}

function renderFxInfernalEmber() {
  const c = newCanvas(384, 384);
  const ctx = c.getContext('2d');
  // Estilhaço de magma incandescente
  const g = ctx.createRadialGradient(192, 192, 10, 192, 192, 150);
  g.addColorStop(0, 'rgba(254,240,138,0.85)');
  g.addColorStop(0.35, 'rgba(249,115,22,0.55)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(192, 192, 150, 0, Math.PI * 2); ctx.fill();

  ctx.save();
  ctx.translate(192, 192);
  ctx.rotate(-0.42);
  const sg = ctx.createLinearGradient(-45, -120, 45, 120);
  sg.addColorStop(0, '#ffffff');
  sg.addColorStop(0.3, '#fde047');
  sg.addColorStop(0.68, '#ea580c');
  sg.addColorStop(1, '#7f1d1d');
  ctx.fillStyle = sg;
  ctx.beginPath();
  ctx.moveTo(0, -135);
  ctx.lineTo(54, -22);
  ctx.lineTo(28, 115);
  ctx.lineTo(-22, 132);
  ctx.lineTo(-56, 12);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.65)';
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.restore();
  return c;
}

function renderFxInfernalFlame() {
  const c = newCanvas(384, 384);
  const ctx = c.getContext('2d');
  drawPaintedFlame(ctx, 192, 200, 290, 138, 0.1, 1);
  return c;
}

// ============================================================================
// COLEÇÃO 6: GRIMÓRIO ARCANO (ARCANE ECLIPSE)
// ============================================================================
function drawArcaneRing(ctx, cx, cy, R) {
  ctx.save();
  // Anel de latão antigo com runas
  const rg = ctx.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
  rg.addColorStop(0, '#fef3c7');
  rg.addColorStop(0.35, '#d97706');
  rg.addColorStop(0.65, '#6b21a8');
  rg.addColorStop(1, '#f59e0b');
  ctx.strokeStyle = rg;
  ctx.lineWidth = 10;
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();

  ctx.strokeStyle = 'rgba(233,213,255,0.58)';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(cx, cy, R + 22, 0, Math.PI * 2); ctx.stroke();

  // Marcas rúnicas ao redor
  ctx.strokeStyle = 'rgba(253,230,138,0.82)';
  ctx.lineWidth = 3.2;
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const r1 = R + 6, r2 = i % 3 === 0 ? R + 28 : R + 18;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
    ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
    ctx.stroke();
  }
  ctx.restore();
}

function renderArcaneBack() {
  const c = newCanvas(1024, 1024);
  const ctx = c.getContext('2d');
  const cx = 512, cy = 512, R = 342;

  // Névoa ametista-carmesim atrás
  const aura = ctx.createRadialGradient(cx, cy, R * 0.72, cx, cy, R * 1.45);
  aura.addColorStop(0, 'rgba(168,85,247,0.52)');
  aura.addColorStop(0.48, 'rgba(159,18,57,0.34)');
  aura.addColorStop(0.84, 'rgba(30,11,48,0.2)');
  aura.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = aura;
  ctx.beginPath(); ctx.arc(cx, cy, R * 1.45, 0, Math.PI * 2); ctx.fill();

  drawArcaneRing(ctx, cx, cy, R + 22);

  // Lua crescente carmesim e ouro atrás no topo esquerdo
  ctx.save();
  ctx.translate(cx - 235, cy - 235);
  ctx.rotate(-0.45);
  ctx.shadowColor = 'rgba(244,63,94,0.65)';
  ctx.shadowBlur = 24;
  const mg = ctx.createLinearGradient(-80, -80, 90, 90);
  mg.addColorStop(0, '#fff1f2');
  mg.addColorStop(0.35, '#fb7185');
  mg.addColorStop(0.75, '#be123c');
  mg.addColorStop(1, '#581c87');
  ctx.fillStyle = mg;
  ctx.beginPath();
  ctx.arc(0, 0, 112, 0.3, Math.PI * 2 - 0.3);
  ctx.arc(38, -14, 92, Math.PI * 2 - 0.5, 0.5, true);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(253,230,138,0.8)';
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.restore();

  // Pergaminhos/páginas místicas flutuando atrás à direita
  for (let i = 0; i < 2; i++) {
    ctx.save();
    ctx.translate(cx + 285 + i * 24, cy - 155 + i * 76);
    ctx.rotate(0.28 + i * 0.22);
    const pg = ctx.createLinearGradient(-45, -60, 45, 60);
    pg.addColorStop(0, '#fef3c7');
    pg.addColorStop(0.5, '#d8b4fe');
    pg.addColorStop(1, '#581c87');
    ctx.fillStyle = pg;
    ctx.beginPath();
    ctx.roundRect(-42, -56, 84, 112, 10);
    ctx.fill();
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 4;
    ctx.stroke();
    // Símbolo rúnico na página
    ctx.strokeStyle = '#be123c';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(-18, -18); ctx.lineTo(18, 18); ctx.moveTo(18, -18); ctx.lineTo(-18, 18); ctx.stroke();
    ctx.restore();
  }
  return c;
}

function renderArcaneFront() {
  const c = newCanvas(1024, 1024);
  const ctx = c.getContext('2d');
  const cx = 512, cy = 512, R = 342;

  // Filigrana de grimório em ouro antigo abraçando a base
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.72)';
  ctx.shadowBlur = 18;
  const fg = ctx.createLinearGradient(cx - 320, cy + 160, cx + 320, cy + 390);
  fg.addColorStop(0, '#4c1d95');
  fg.addColorStop(0.28, '#f59e0b');
  fg.addColorStop(0.5, '#fef3c7');
  fg.addColorStop(0.72, '#d97706');
  fg.addColorStop(1, '#4c1d95');
  ctx.strokeStyle = fg;
  ctx.lineWidth = 18;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(cx, cy, R + 24, 0.16 * Math.PI, 0.84 * Math.PI);
  ctx.stroke();

  // Volutas douradas laterais
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx + s * 295, cy + 178);
    ctx.bezierCurveTo(cx + s * 375, cy + 130, cx + s * 392, cy + 35, cx + s * 336, cy - 22);
    ctx.lineWidth = 10;
    ctx.stroke();
  }
  ctx.restore();

  // Gema ametista-carmesim central em medalhão de ouro
  drawFacetedGem(ctx, cx, cy + R + 24, 38, 46, 0, {
    bright: '#fbcfe8', mid: '#c026d3', deep: '#4a044e',
    bezelLight: '#fef3c7', bezelMid: '#d97706', bezelDark: '#451a03',
    bounce: 'rgba(244,114,182,0.9)',
  });

  // Pingentes de cristal nas laterais inferiores
  for (const s of [-1, 1]) {
    drawFacetedGem(ctx, cx + s * 172, cy + 305, 18, 28, s * -0.45, {
      bright: '#e9d5ff', mid: '#9333ea', deep: '#3b0764',
    });
    drawSculptedStar(ctx, cx + s * 282, cy + 165, 22, '#ffffff', '#e879f9', 0.25, 0.92);
  }

  // Lanterna estelar pendente no topo direito
  ctx.save();
  ctx.translate(cx + 266, cy - 220);
  drawSculptedStar(ctx, 0, 0, 34, '#ffffff', '#fde68a', 0, 0.96);
  drawFacetedGem(ctx, 0, 0, 16, 22, 0, {
    bright: '#ffe4e6', mid: '#f43f5e', deep: '#881337',
  });
  ctx.restore();
  return c;
}

function renderFrameArcaneTL() {
  const c = newCanvas(640, 480);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(88, 82, 12, 88, 82, 270);
  g.addColorStop(0, 'rgba(168,85,247,0.42)');
  g.addColorStop(0.55, 'rgba(190,24,93,0.18)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 420, 360);

  // Fecho iluminado de grimório antigo em ouro + veludo roxo
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.72)';
  ctx.shadowBlur = 16;
  const fg = ctx.createLinearGradient(10, 10, 360, 260);
  fg.addColorStop(0, '#fef3c7');
  fg.addColorStop(0.32, '#d97706');
  fg.addColorStop(0.68, '#7e22ce');
  fg.addColorStop(1, '#f472b6');
  ctx.strokeStyle = fg;
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.moveTo(22, 320);
  ctx.lineTo(22, 32);
  ctx.quadraticCurveTo(22, 22, 32, 22);
  ctx.lineTo(368, 22);
  ctx.stroke();

  // Volutas barrocas de ouro
  ctx.lineWidth = 6.5;
  ctx.beginPath();
  ctx.moveTo(46, 230);
  ctx.bezierCurveTo(46, 118, 92, 74, 232, 48);
  ctx.stroke();

  // Base em veludo escuro sob a gema
  ctx.fillStyle = '#2e1065';
  ctx.beginPath();
  ctx.moveTo(18, 18); ctx.lineTo(148, 18); ctx.quadraticCurveTo(86, 86, 18, 148); ctx.closePath();
  ctx.fill();
  ctx.restore();

  drawFacetedGem(ctx, 64, 64, 28, 34, -0.78, {
    bright: '#fbcfe8', mid: '#c026d3', deep: '#4a044e',
    bezelLight: '#fef3c7', bezelMid: '#d97706', bezelDark: '#451a03',
  });
  drawSculptedStar(ctx, 185, 42, 20, '#ffffff', '#fde68a', 0, 0.92);
  drawSculptedStar(ctx, 42, 186, 16, '#ffffff', '#e879f9', 0.3, 0.88);
  return c;
}

function renderFrameArcaneTR() {
  const c = newCanvas(640, 480);
  const ctx = c.getContext('2d');
  // Lua crescente & selo rúnico flutuante no canto superior direito
  ctx.save();
  ctx.translate(544, 92);
  const g = ctx.createRadialGradient(0, 0, 10, 0, 0, 125);
  g.addColorStop(0, 'rgba(217,70,239,0.42)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(0, 0, 125, 0, Math.PI * 2); ctx.fill();

  ctx.strokeStyle = '#fbbf24';
  ctx.lineWidth = 4.5;
  ctx.beginPath(); ctx.arc(0, 0, 62, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = 'rgba(233,213,255,0.65)';
  ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(0, 0, 46, 0, Math.PI * 2); ctx.stroke();

  // Estrela de 6 pontas arcana
  for (let t = 0; t < 2; t++) {
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + (t ? Math.PI / 3 : 0) - Math.PI / 2;
      const px = Math.cos(a) * 44, py = Math.sin(a) * 44;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.strokeStyle = 'rgba(253,230,138,0.82)';
    ctx.lineWidth = 2.6;
    ctx.stroke();
  }
  drawFacetedGem(ctx, 0, 0, 18, 18, 0, { bright: '#ffe4e6', mid: '#f43f5e', deep: '#881337' });
  ctx.restore();

  // Filete de ouro descendo a lateral direita
  ctx.strokeStyle = 'rgba(245,158,11,0.78)';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(350, 22); ctx.lineTo(612, 22); ctx.lineTo(612, 260);
  ctx.stroke();
  drawSculptedStar(ctx, 442, 44, 18, '#ffffff', '#fde68a', 0, 0.9);
  return c;
}

function renderFrameArcaneBR() {
  const c = newCanvas(640, 480);
  const ctx = c.getContext('2d');
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.65)';
  ctx.shadowBlur = 14;
  const fg = ctx.createLinearGradient(620, 460, 360, 260);
  fg.addColorStop(0, '#fef3c7');
  fg.addColorStop(0.4, '#d97706');
  fg.addColorStop(1, '#a855f7');
  ctx.strokeStyle = fg;
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(370, 458); ctx.lineTo(614, 458); ctx.lineTo(614, 240);
  ctx.stroke();
  ctx.restore();

  drawFacetedGem(ctx, 578, 422, 22, 28, 0.78, {
    bright: '#e9d5ff', mid: '#a855f7', deep: '#3b0764',
  });
  drawSculptedStar(ctx, 495, 434, 18, '#ffffff', '#fde68a', 0.2, 0.88);
  return c;
}

function renderFxArcaneSigil() {
  const c = newCanvas(384, 384);
  const ctx = c.getContext('2d');
  const cx = 192, cy = 192;
  const g = ctx.createRadialGradient(cx, cy, 12, cx, cy, 176);
  g.addColorStop(0, 'rgba(232,121,249,0.55)');
  g.addColorStop(0.5, 'rgba(147,51,234,0.28)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(cx, cy, 176, 0, Math.PI * 2); ctx.fill();

  ctx.strokeStyle = '#fde68a';
  ctx.lineWidth = 6;
  ctx.beginPath(); ctx.arc(cx, cy, 134, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = '#e879f9';
  ctx.lineWidth = 3.5;
  ctx.beginPath(); ctx.arc(cx, cy, 108, 0, Math.PI * 2); ctx.stroke();

  for (let t = 0; t < 2; t++) {
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + (t ? Math.PI / 4 : 0);
      const px = cx + Math.cos(a) * 108, py = cy + Math.sin(a) * 108;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.strokeStyle = t === 0 ? '#fef08a' : '#f472b6';
    ctx.lineWidth = 4;
    ctx.stroke();
  }
  drawSculptedStar(ctx, cx, cy, 42, '#ffffff', '#f0abfc', 0, 0.96);
  return c;
}

function renderFxArcaneRune() {
  const c = newCanvas(384, 384);
  const ctx = c.getContext('2d');
  drawFacetedGem(ctx, 192, 192, 74, 118, 0.2, {
    bright: '#fae8ff', mid: '#c026d3', deep: '#4a044e',
    bezelLight: '#fef3c7', bezelMid: '#d97706', bezelDark: '#451a03',
  });
  drawSculptedStar(ctx, 162, 136, 36, '#ffffff', '#fde68a', 0, 0.95);
  return c;
}

// ============================================================================
// COLEÇÃO 7: SANTUÁRIO ABISSAL (BIOLUMINESCENTE)
// ============================================================================
function renderAbyssalBack() {
  const c = newCanvas(1024, 1024);
  const ctx = c.getContext('2d');
  const cx = 512, cy = 512, R = 338;

  // Bioluminescência oceânica profunda
  const aura = ctx.createRadialGradient(cx, cy, R * 0.7, cx, cy, R * 1.46);
  aura.addColorStop(0, 'rgba(34,211,238,0.48)');
  aura.addColorStop(0.5, 'rgba(14,116,144,0.34)');
  aura.addColorStop(0.84, 'rgba(49,46,129,0.22)');
  aura.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = aura;
  ctx.beginPath(); ctx.arc(cx, cy, R * 1.46, 0, Math.PI * 2); ctx.fill();

  // Corais bioluminescentes abrindo atrás nas laterais
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.translate(cx + side * 265, cy + 50);
    ctx.scale(side, 1);
    const cg = ctx.createLinearGradient(0, 120, 160, -240);
    cg.addColorStop(0, '#0f766e');
    cg.addColorStop(0.55, '#22d3ee');
    cg.addColorStop(1, '#a5f3fc');
    ctx.strokeStyle = cg;
    ctx.lineCap = 'round';
    const branches = [
      [[0, 60], [65, -40], [140, -165], 16],
      [[45, -10], [115, -45], [168, -90], 11],
      [[75, -80], [92, -160], [105, -225], 10],
      [[20, 20], [95, 30], [156, 8], 12],
    ];
    for (const [p0, p1, p2, w] of branches) {
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(p0[0], p0[1]);
      ctx.quadraticCurveTo(p1[0], p1[1], p2[0], p2[1]);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Anel de correnteza perolada
  const rg = ctx.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
  rg.addColorStop(0, '#a5f3fc');
  rg.addColorStop(0.45, '#0891b2');
  rg.addColorStop(0.75, '#6366f1');
  rg.addColorStop(1, '#67e8f9');
  ctx.strokeStyle = rg;
  ctx.lineWidth = 18;
  ctx.beginPath(); ctx.arc(cx, cy, R + 16, 0, Math.PI * 2); ctx.stroke();

  // Água-viva pairando no canto superior esquerdo atrás
  drawJellyfish(ctx, cx - 265, cy - 230, 96, -0.35, 0.94);
  return c;
}

function renderAbyssalFront() {
  const c = newCanvas(1024, 1024);
  const ctx = c.getContext('2d');
  const cx = 512, cy = 512, R = 338;

  // Fitas d'água luminescentes envolvendo a base
  ctx.save();
  ctx.shadowColor = 'rgba(34,211,238,0.65)';
  ctx.shadowBlur = 18;
  const wg = ctx.createLinearGradient(cx - 340, cy + 160, cx + 340, cy + 360);
  wg.addColorStop(0, 'rgba(103,232,249,0.2)');
  wg.addColorStop(0.28, 'rgba(103,232,249,0.92)');
  wg.addColorStop(0.55, 'rgba(232,121,249,0.78)');
  wg.addColorStop(0.82, 'rgba(56,189,248,0.92)');
  wg.addColorStop(1, 'rgba(103,232,249,0.18)');
  ctx.strokeStyle = wg;
  ctx.lineWidth = 18;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(cx, cy, R + 22, 0.14 * Math.PI, 0.86 * Math.PI);
  ctx.stroke();
  ctx.restore();

  // Pequena água-viva translúcida no canto inferior direito
  drawJellyfish(ctx, cx + 266, cy + 205, 76, 0.42, 0.95);

  // Concha perolada central na base
  drawFacetedGem(ctx, cx, cy + R + 22, 34, 34, 0, {
    bright: '#ffffff', mid: '#67e8f9', deep: '#155e75',
    bezelLight: '#e0f2fe', bezelMid: '#38bdf8', bezelDark: '#1e3a8a',
    bounce: 'rgba(232,121,249,0.85)',
  });

  // Bolhas iridescentes em vários tamanhos
  const bubbles = [
    [cx - 285, cy + 170, 34], [cx - 325, cy + 75, 22], [cx - 235, cy + 258, 18],
    [cx + 315, cy - 115, 28], [cx + 265, cy - 235, 20], [cx - 170, cy + 312, 16],
  ];
  for (const [bx, by, br] of bubbles) drawPearlBubble(ctx, bx, by, br, 0.94);

  drawSculptedStar(ctx, cx + 230, cy - 270, 22, '#ffffff', '#67e8f9', 0.2, 0.92);
  drawSculptedStar(ctx, cx - 295, cy - 75, 18, '#ffffff', '#c084fc', 0.5, 0.86);
  return c;
}

function renderFrameAbyssalTL() {
  const c = newCanvas(640, 480);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(95, 88, 12, 95, 88, 280);
  g.addColorStop(0, 'rgba(34,211,238,0.44)');
  g.addColorStop(0.55, 'rgba(99,102,241,0.18)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 440, 380);

  // Corais + fita aquática translúcida no canto superior esquerdo
  ctx.save();
  const wg = ctx.createLinearGradient(16, 16, 360, 260);
  wg.addColorStop(0, '#ecfeff');
  wg.addColorStop(0.4, '#22d3ee');
  wg.addColorStop(0.8, '#818cf8');
  wg.addColorStop(1, 'rgba(34,211,238,0)');
  ctx.strokeStyle = wg;
  ctx.lineWidth = 10;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(24, 300);
  ctx.bezierCurveTo(24, 110, 42, 34, 130, 26);
  ctx.bezierCurveTo(225, 18, 310, 24, 380, 32);
  ctx.stroke();
  ctx.restore();

  drawJellyfish(ctx, 112, 96, 68, -0.32, 0.96);
  drawPearlBubble(ctx, 218, 52, 22, 0.95);
  drawPearlBubble(ctx, 268, 42, 13, 0.9);
  drawPearlBubble(ctx, 54, 218, 18, 0.92);
  drawSculptedStar(ctx, 194, 88, 16, '#ffffff', '#67e8f9', 0, 0.9);
  return c;
}

function renderFrameAbyssalTR() {
  const c = newCanvas(640, 480);
  const ctx = c.getContext('2d');
  const wg = ctx.createLinearGradient(620, 20, 340, 260);
  wg.addColorStop(0, '#a5f3fc');
  wg.addColorStop(0.5, '#38bdf8');
  wg.addColorStop(1, 'rgba(99,102,241,0)');
  ctx.strokeStyle = wg;
  ctx.lineWidth = 8;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(360, 24);
  ctx.bezierCurveTo(500, 22, 588, 36, 608, 128);
  ctx.bezierCurveTo(618, 195, 616, 260, 610, 310);
  ctx.stroke();

  drawPearlBubble(ctx, 566, 76, 30, 0.95);
  drawPearlBubble(ctx, 514, 52, 18, 0.92);
  drawPearlBubble(ctx, 594, 142, 16, 0.9);
  drawSculptedStar(ctx, 470, 56, 18, '#ffffff', '#a5f3fc', 0.25, 0.92);
  return c;
}

function renderFrameAbyssalBR() {
  const c = newCanvas(640, 480);
  const ctx = c.getContext('2d');
  const wg = ctx.createLinearGradient(620, 460, 380, 250);
  wg.addColorStop(0, '#67e8f9');
  wg.addColorStop(0.55, '#818cf8');
  wg.addColorStop(1, 'rgba(34,211,238,0)');
  ctx.strokeStyle = wg;
  ctx.lineWidth = 8;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(390, 456);
  ctx.bezierCurveTo(510, 456, 596, 438, 610, 340);
  ctx.lineTo(614, 240);
  ctx.stroke();

  drawJellyfish(ctx, 548, 386, 54, 0.35, 0.94);
  drawPearlBubble(ctx, 472, 432, 18, 0.92);
  drawPearlBubble(ctx, 592, 308, 14, 0.88);
  return c;
}

function renderFxAbyssalJelly() {
  const c = newCanvas(384, 384);
  const ctx = c.getContext('2d');
  drawJellyfish(ctx, 192, 148, 92, -0.15, 1);
  return c;
}

function renderFxAbyssalBubble() {
  const c = newCanvas(384, 384);
  const ctx = c.getContext('2d');
  drawPearlBubble(ctx, 192, 192, 128, 1);
  return c;
}

// ============================================================================
// COLEÇÃO 8: ARCO DE SERAFIM (CELESTIAL DOURADO)
// ============================================================================
function renderSeraphBack() {
  const c = newCanvas(1024, 1024);
  const ctx = c.getContext('2d');
  const cx = 512, cy = 512, R = 338;

  // Aura solar quente de marfim e ouro
  const aura = ctx.createRadialGradient(cx, cy, R * 0.72, cx, cy, R * 1.48);
  aura.addColorStop(0, 'rgba(254,243,199,0.58)');
  aura.addColorStop(0.46, 'rgba(245,158,11,0.32)');
  aura.addColorStop(0.84, 'rgba(217,119,6,0.12)');
  aura.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = aura;
  ctx.beginPath(); ctx.arc(cx, cy, R * 1.48, 0, Math.PI * 2); ctx.fill();

  // Raios de luz atrás do avatar
  ctx.save();
  ctx.translate(cx, cy);
  for (let i = 0; i < 16; i++) {
    ctx.rotate((Math.PI * 2) / 16);
    const rg = ctx.createLinearGradient(0, R * 0.85, 0, R * 1.44);
    rg.addColorStop(0, 'rgba(254,249,195,0.52)');
    rg.addColorStop(1, 'rgba(254,249,195,0)');
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.moveTo(-10, R * 0.85);
    ctx.lineTo(0, R * (i % 2 === 0 ? 1.44 : 1.24));
    ctx.lineTo(10, R * 0.85);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // Asas emplumadas de serafim em camadas nas laterais
  for (const side of [-1, 1]) {
    const feathers = [
      [355, -130, 290, 82, side * 0.62],
      [392, -35, 280, 78, side * 1.02],
      [390, 68, 255, 72, side * 1.42],
      [345, 165, 225, 66, side * 1.78],
      [278, -220, 235, 68, side * 0.3],
    ];
    for (const [dx, dy, len, w, ang] of feathers) {
      drawPaintedFeather(ctx, cx + side * dx, cy + dy, len, w, ang, {
        light: '#ffffff', mid: '#fef3c7', tip: '#f59e0b', shadow: '#92400e',
      });
    }
  }

  // Halo dourado duplo atrás
  const hg = ctx.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
  hg.addColorStop(0, '#ffffff');
  hg.addColorStop(0.35, '#fde68a');
  hg.addColorStop(0.7, '#d97706');
  hg.addColorStop(1, '#fef9c3');
  ctx.strokeStyle = hg;
  ctx.lineWidth = 16;
  ctx.beginPath(); ctx.arc(cx, cy, R + 18, 0, Math.PI * 2); ctx.stroke();
  return c;
}

function renderSeraphFront() {
  const c = newCanvas(1024, 1024);
  const ctx = c.getContext('2d');
  const cx = 512, cy = 512, R = 338;

  // Coroa de louros dourados na base
  ctx.save();
  ctx.shadowColor = 'rgba(120,53,15,0.45)';
  ctx.shadowBlur = 16;
  const lg = ctx.createLinearGradient(cx - 320, cy + 160, cx + 320, cy + 370);
  lg.addColorStop(0, '#b45309');
  lg.addColorStop(0.3, '#fde68a');
  lg.addColorStop(0.5, '#ffffff');
  lg.addColorStop(0.7, '#f59e0b');
  lg.addColorStop(1, '#b45309');
  ctx.strokeStyle = lg;
  ctx.lineWidth = 14;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(cx, cy, R + 22, 0.16 * Math.PI, 0.84 * Math.PI);
  ctx.stroke();

  // Pequenas plumas douradas sobrepostas nas laterais inferiores
  drawPaintedFeather(ctx, cx - 280, cy + 205, 165, 52, -0.78, { light: '#ffffff', mid: '#fef9c3', tip: '#f59e0b' });
  drawPaintedFeather(ctx, cx + 280, cy + 205, 165, 52, 0.78, { light: '#ffffff', mid: '#fef9c3', tip: '#f59e0b' });
  ctx.restore();

  // Broche solar de citrino/diamante na base
  drawFacetedGem(ctx, cx, cy + R + 22, 34, 34, 0.78, {
    bright: '#ffffff', mid: '#fde047', deep: '#b45309',
    bezelLight: '#fffbeb', bezelMid: '#eab308', bezelDark: '#713f12',
  });

  // Halo solar leve no topo
  drawSculptedStar(ctx, cx, cy - R - 26, 40, '#ffffff', '#fde68a', 0, 0.96);
  drawSculptedStar(ctx, cx - 235, cy - 265, 22, '#ffffff', '#fcd34d', 0.25, 0.9);
  drawSculptedStar(ctx, cx + 245, cy - 255, 22, '#ffffff', '#fcd34d', 0.25, 0.9);
  return c;
}

function renderFrameSeraphTL() {
  const c = newCanvas(640, 480);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(90, 82, 12, 90, 82, 270);
  g.addColorStop(0, 'rgba(254,243,199,0.44)');
  g.addColorStop(0.55, 'rgba(245,158,11,0.16)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 430, 360);

  // Filigrana dourada catedral
  ctx.strokeStyle = '#fde68a';
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(22, 310); ctx.lineTo(22, 28); ctx.quadraticCurveTo(22, 22, 28, 22); ctx.lineTo(370, 22);
  ctx.stroke();

  drawPaintedFeather(ctx, 152, 62, 190, 56, 1.28, { light: '#ffffff', mid: '#fef3c7', tip: '#f59e0b' });
  drawPaintedFeather(ctx, 64, 152, 180, 54, 0.28, { light: '#ffffff', mid: '#fef3c7', tip: '#d97706' });
  drawFacetedGem(ctx, 64, 64, 24, 24, 0.78, { bright: '#ffffff', mid: '#fde047', deep: '#b45309' });
  drawSculptedStar(ctx, 272, 42, 20, '#ffffff', '#fde68a', 0, 0.95);
  return c;
}

function renderFrameSeraphTR() {
  const c = newCanvas(640, 480);
  const ctx = c.getContext('2d');
  ctx.strokeStyle = 'rgba(253,230,138,0.85)';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(355, 22); ctx.lineTo(612, 22); ctx.lineTo(612, 270);
  ctx.stroke();
  drawPaintedFeather(ctx, 515, 68, 175, 52, -1.2, { light: '#ffffff', mid: '#fef3c7', tip: '#f59e0b' });
  drawPaintedFeather(ctx, 578, 152, 150, 44, -0.22, { light: '#ffffff', mid: '#fef3c7', tip: '#d97706' });
  drawSculptedStar(ctx, 576, 62, 28, '#ffffff', '#fde68a', 0, 0.96);
  return c;
}

function renderFrameSeraphBR() {
  const c = newCanvas(640, 480);
  const ctx = c.getContext('2d');
  ctx.strokeStyle = 'rgba(253,230,138,0.82)';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(380, 458); ctx.lineTo(614, 458); ctx.lineTo(614, 250);
  ctx.stroke();
  drawPaintedFeather(ctx, 528, 412, 160, 48, 0.85, { light: '#ffffff', mid: '#fef3c7', tip: '#f59e0b' });
  drawFacetedGem(ctx, 578, 422, 20, 20, 0.78, { bright: '#ffffff', mid: '#fde047', deep: '#b45309' });
  drawSculptedStar(ctx, 456, 434, 18, '#ffffff', '#fde68a', 0, 0.9);
  return c;
}

function renderFxSeraphFeather() {
  const c = newCanvas(384, 384);
  const ctx = c.getContext('2d');
  drawPaintedFeather(ctx, 192, 192, 295, 96, 0.35, { light: '#ffffff', mid: '#fef3c7', tip: '#f59e0b', shadow: '#92400e' });
  return c;
}

function renderFxSeraphStar() {
  const c = newCanvas(384, 384);
  const ctx = c.getContext('2d');
  drawSculptedStar(ctx, 192, 192, 140, '#ffffff', '#fde68a', 0, 1);
  return c;
}

// ============================================================================
// CONJUNTO EXCLUSIVO: SOBERANO IMPERIAL (badge:sovereign — liberado só p/ Swag)
// ============================================================================
function renderSovereignBack() {
  const c = newCanvas(1024, 1024);
  const ctx = c.getContext('2d');
  const cx = 512, cy = 512, R = 338;

  // Aura imperial rubi & ouro escuro
  const aura = ctx.createRadialGradient(cx, cy, R * 0.7, cx, cy, R * 1.48);
  aura.addColorStop(0, 'rgba(245,158,11,0.5)');
  aura.addColorStop(0.45, 'rgba(159,18,57,0.38)');
  aura.addColorStop(0.84, 'rgba(15,10,20,0.28)');
  aura.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = aura;
  ctx.beginPath(); ctx.arc(cx, cy, R * 1.48, 0, Math.PI * 2); ctx.fill();

  // Raios imperiais de ouro negro e champanhe
  ctx.save();
  ctx.translate(cx, cy);
  for (let i = 0; i < 12; i++) {
    ctx.rotate((Math.PI * 2) / 12);
    const rg = ctx.createLinearGradient(0, R * 0.9, 0, R * 1.42);
    rg.addColorStop(0, 'rgba(251,191,36,0.68)');
    rg.addColorStop(0.65, 'rgba(244,63,94,0.28)');
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.moveTo(-14, R * 0.9);
    ctx.lineTo(0, R * (i % 2 === 0 ? 1.42 : 1.22));
    ctx.lineTo(14, R * 0.9);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // Anel de ouro imperial duplo
  const rg = ctx.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
  rg.addColorStop(0, '#fef08a');
  rg.addColorStop(0.35, '#d97706');
  rg.addColorStop(0.65, '#1f1218');
  rg.addColorStop(1, '#fbbf24');
  ctx.strokeStyle = rg;
  ctx.lineWidth = 22;
  ctx.beginPath(); ctx.arc(cx, cy, R + 18, 0, Math.PI * 2); ctx.stroke();
  return c;
}

function renderSovereignFront() {
  const c = newCanvas(1024, 1024);
  const ctx = c.getContext('2d');
  const cx = 512, cy = 512, R = 338;

  // Coroa Imperial esculpida no topo do avatar (posição segura, sem cortar!)
  ctx.save();
  ctx.translate(cx, cy - R - 20);
  ctx.shadowColor = 'rgba(0,0,0,0.75)';
  ctx.shadowBlur = 20;
  ctx.shadowOffsetY = 8;
  const cg = ctx.createLinearGradient(-155, -88, 155, 65);
  cg.addColorStop(0, '#78350f');
  cg.addColorStop(0.25, '#fbbf24');
  cg.addColorStop(0.5, '#fef9c3');
  cg.addColorStop(0.75, '#d97706');
  cg.addColorStop(1, '#451a03');
  ctx.fillStyle = cg;
  ctx.beginPath();
  ctx.moveTo(-132, 42);
  ctx.lineTo(-152, -52);
  ctx.lineTo(-78, -6);
  ctx.lineTo(-44, -84);
  ctx.lineTo(0, -28);
  ctx.lineTo(0, -104);
  ctx.lineTo(0, -28);
  ctx.lineTo(44, -84);
  ctx.lineTo(78, -6);
  ctx.lineTo(152, -52);
  ctx.lineTo(132, 42);
  ctx.quadraticCurveTo(0, 18, -132, 42);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#fffbeb';
  ctx.lineWidth = 3.5;
  ctx.stroke();

  // Ponta central real
  ctx.fillStyle = cg;
  ctx.beginPath();
  ctx.moveTo(-36, -18); ctx.lineTo(0, -106); ctx.lineTo(36, -18); ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  // Rubis imperiais na coroa e na base
  drawFacetedGem(ctx, cx, cy - R - 34, 24, 30, 0, {
    bright: '#ffe4e6', mid: '#e11d48', deep: '#4c0519',
    bezelLight: '#fef3c7', bezelMid: '#d97706', bezelDark: '#451a03',
  });
  drawFacetedGem(ctx, cx - 82, cy - R - 22, 15, 19, -0.25, { bright: '#ffe4e6', mid: '#f43f5e', deep: '#881337' });
  drawFacetedGem(ctx, cx + 82, cy - R - 22, 15, 19, 0.25, { bright: '#ffe4e6', mid: '#f43f5e', deep: '#881337' });

  // Filigrana inferior imperial + rubi central
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.72)';
  ctx.shadowBlur = 16;
  const bg = ctx.createLinearGradient(cx - 320, cy + 160, cx + 320, cy + 380);
  bg.addColorStop(0, '#181016');
  bg.addColorStop(0.3, '#d97706');
  bg.addColorStop(0.5, '#fef3c7');
  bg.addColorStop(0.7, '#d97706');
  bg.addColorStop(1, '#181016');
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.arc(cx, cy, R + 42, 0.16 * Math.PI, 0.84 * Math.PI);
  ctx.arc(cx, cy, R - 2, 0.84 * Math.PI, 0.16 * Math.PI, true);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  drawFacetedGem(ctx, cx, cy + R + 22, 36, 44, 0, {
    bright: '#ffe4e6', mid: '#e11d48', deep: '#4c0519',
    bezelLight: '#fef3c7', bezelMid: '#eab308', bezelDark: '#451a03',
  });
  drawSculptedStar(ctx, cx, cy - R - 122, 26, '#ffffff', '#fde68a', 0, 0.96);
  drawSculptedStar(ctx, cx - 220, cy + 280, 18, '#ffffff', '#fb7185', 0.2, 0.88);
  drawSculptedStar(ctx, cx + 220, cy + 280, 18, '#ffffff', '#fb7185', 0.2, 0.88);
  return c;
}

function renderFrameSovereignTL() {
  const c = newCanvas(640, 480);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(88, 82, 12, 88, 82, 270);
  g.addColorStop(0, 'rgba(225,29,72,0.42)');
  g.addColorStop(0.55, 'rgba(245,158,11,0.2)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 420, 360);

  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.78)';
  ctx.shadowBlur = 18;
  const ag = ctx.createLinearGradient(12, 12, 360, 260);
  ag.addColorStop(0, '#140c10');
  ag.addColorStop(0.38, '#581c2c');
  ag.addColorStop(0.68, '#d97706');
  ag.addColorStop(1, '#fef08a');
  ctx.fillStyle = ag;
  ctx.beginPath();
  ctx.moveTo(14, 14); ctx.lineTo(392, 14);
  ctx.quadraticCurveTo(235, 38, 120, 56);
  ctx.quadraticCurveTo(58, 124, 44, 300);
  ctx.lineTo(14, 345); ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#fde68a';
  ctx.lineWidth = 3.5;
  ctx.stroke();
  ctx.restore();

  drawFacetedGem(ctx, 64, 64, 30, 36, -0.78, {
    bright: '#ffe4e6', mid: '#e11d48', deep: '#4c0519',
    bezelLight: '#fef3c7', bezelMid: '#eab308', bezelDark: '#451a03',
  });
  drawSculptedStar(ctx, 210, 40, 22, '#ffffff', '#fde68a', 0, 0.94);
  drawSculptedStar(ctx, 42, 210, 18, '#ffffff', '#fb7185', 0.25, 0.9);
  return c;
}

function renderFrameSovereignTR() {
  const c = newCanvas(640, 480);
  const ctx = c.getContext('2d');
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.72)';
  ctx.shadowBlur = 16;
  const g = ctx.createLinearGradient(626, 14, 320, 260);
  g.addColorStop(0, '#140c10');
  g.addColorStop(0.45, '#881337');
  g.addColorStop(0.85, '#f59e0b');
  g.addColorStop(1, '#fef08a');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(626, 14); ctx.lineTo(335, 14);
  ctx.quadraticCurveTo(488, 34, 558, 72);
  ctx.quadraticCurveTo(592, 140, 600, 290);
  ctx.lineTo(626, 325); ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#fde68a';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.restore();

  drawFacetedGem(ctx, 578, 62, 24, 24, 0.78, { bright: '#ffe4e6', mid: '#e11d48', deep: '#4c0519' });
  drawSculptedStar(ctx, 455, 42, 20, '#ffffff', '#fde68a', 0, 0.92);
  return c;
}

function renderFrameSovereignBR() {
  const c = newCanvas(640, 480);
  const ctx = c.getContext('2d');
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.7)';
  ctx.shadowBlur = 14;
  const g = ctx.createLinearGradient(626, 466, 360, 260);
  g.addColorStop(0, '#140c10');
  g.addColorStop(0.48, '#881337');
  g.addColorStop(1, '#fbbf24');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(626, 466); ctx.lineTo(365, 466);
  ctx.quadraticCurveTo(518, 444, 572, 398);
  ctx.quadraticCurveTo(602, 342, 606, 220);
  ctx.lineTo(626, 196); ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#fde68a';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.restore();

  drawFacetedGem(ctx, 578, 420, 22, 22, 0.78, { bright: '#ffe4e6', mid: '#e11d48', deep: '#4c0519' });
  drawSculptedStar(ctx, 478, 434, 18, '#ffffff', '#fde68a', 0.15, 0.9);
  return c;
}

// ============================================================================
// FOLHA DE CONTATO VISUAL PARA INSPEÇÃO PIXEL A PIXEL (5 CARTÕES SIMULADOS)
// ============================================================================
function renderContactSheet(map) {
  const c = newCanvas(1920, 620);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#0b0d14';
  ctx.fillRect(0, 0, c.width, c.height);

  const cards = [
    ['Forja de Drakon', 'infernal', '#2c1112', '#140b0e'],
    ['Grimório Arcano', 'arcane', '#2a1242', '#110c1c'],
    ['Santuário Abissal', 'abyssal', '#0b2d3b', '#0a1220'],
    ['Arco de Serafim', 'seraph', '#35260e', '#14110b'],
    ['Soberano Imperial', 'sovereign', '#330c18', '#120a10'],
  ];

  cards.forEach(([label, key, c1, c2], idx) => {
    const x = 32 + idx * 376, y = 34, w = 344, h = 548;
    ctx.save();
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 18); ctx.clip();
    const bg = ctx.createLinearGradient(x, y, x, y + h);
    bg.addColorStop(0, c1); bg.addColorStop(0.34, c2); bg.addColorStop(1, '#11131b');
    ctx.fillStyle = bg; ctx.fillRect(x, y, w, h);

    // Banner
    const bng = ctx.createLinearGradient(x, y, x + w, y + 128);
    bng.addColorStop(0, c1); bng.addColorStop(1, '#1e1b2e');
    ctx.fillStyle = bng; ctx.fillRect(x, y, w, 128);

    // Ornamentos da Frame
    const tl = map['frame_' + key + '_tl'];
    const tr = map['frame_' + key + '_tr'];
    const br = map['frame_' + key + '_br'];
    if (tl) ctx.drawImage(tl, x, y, 224, 168);
    if (tr) ctx.drawImage(tr, x + w - 216, y, 216, 162);
    if (br) ctx.drawImage(br, x + w - 192, y + h - 144, 192, 144);
    ctx.restore();

    // Avatar + Decoração BACK & FRONT
    const acx = x + 76, acy = y + 126;
    const db = map['deco_' + key + '_back'];
    const df = map['deco_' + key + '_front'];
    if (db) ctx.drawImage(db, acx - 62, acy - 62, 124, 124);
    ctx.save();
    ctx.beginPath(); ctx.arc(acx, acy, 41, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = '#2563eb'; ctx.fillRect(acx - 42, acy - 42, 84, 84);
    ctx.fillStyle = '#fff'; ctx.font = '800 24px "Segoe UI"'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('SW', acx, acy + 1);
    ctx.restore();
    if (df) ctx.drawImage(df, acx - 62, acy - 62, 124, 124);

    // Texto de perfil simulado
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#f8fafc'; ctx.font = '700 20px "Segoe UI"';
    ctx.fillText('Swag', x + 22, y + 218);
    ctx.fillStyle = '#94a3b8'; ctx.font = '500 13px "Segoe UI"';
    ctx.fillText('@swag • ' + label, x + 22, y + 238);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.beginPath(); ctx.roundRect(x + 20, y + 260, w - 40, 260, 10); ctx.fill();
    ctx.fillStyle = '#cbd5e1'; ctx.font = '500 13px "Segoe UI"';
    ctx.fillText('Expansão Flagship V5 Pintada', x + 34, y + 292);
    ctx.fillText('Camadas WebP HiDPI + 4 atos.', x + 34, y + 314);
  });
  return c;
}

window.__RENDER_EXPANSION = () => {
  const map = {
    deco_infernal_back: renderInfernalBack(),
    deco_infernal_front: renderInfernalFront(),
    frame_infernal_tl: renderFrameInfernalTL(),
    frame_infernal_tr: renderFrameInfernalTR(),
    frame_infernal_br: renderFrameInfernalBR(),
    fx_infernal_ember: renderFxInfernalEmber(),
    fx_infernal_flame: renderFxInfernalFlame(),

    deco_arcane_back: renderArcaneBack(),
    deco_arcane_front: renderArcaneFront(),
    frame_arcane_tl: renderFrameArcaneTL(),
    frame_arcane_tr: renderFrameArcaneTR(),
    frame_arcane_br: renderFrameArcaneBR(),
    fx_arcane_sigil: renderFxArcaneSigil(),
    fx_arcane_rune: renderFxArcaneRune(),

    deco_abyssal_back: renderAbyssalBack(),
    deco_abyssal_front: renderAbyssalFront(),
    frame_abyssal_tl: renderFrameAbyssalTL(),
    frame_abyssal_tr: renderFrameAbyssalTR(),
    frame_abyssal_br: renderFrameAbyssalBR(),
    fx_abyssal_jelly: renderFxAbyssalJelly(),
    fx_abyssal_bubble: renderFxAbyssalBubble(),

    deco_seraph_back: renderSeraphBack(),
    deco_seraph_front: renderSeraphFront(),
    frame_seraph_tl: renderFrameSeraphTL(),
    frame_seraph_tr: renderFrameSeraphTR(),
    frame_seraph_br: renderFrameSeraphBR(),
    fx_seraph_feather: renderFxSeraphFeather(),
    fx_seraph_star: renderFxSeraphStar(),

    deco_sovereign_back: renderSovereignBack(),
    deco_sovereign_front: renderSovereignFront(),
    frame_sovereign_tl: renderFrameSovereignTL(),
    frame_sovereign_tr: renderFrameSovereignTR(),
    frame_sovereign_br: renderFrameSovereignBR(),
  };
  map.contact_sheet_expansion = renderContactSheet(map);
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
  const dbgPort = 19750 + Math.floor(Math.random() * 400);
  const userDir = path.join(process.env.TEMP, 'sanvo-v5-exp-' + Date.now());
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
  setTimeout(() => { console.error('TIMEOUT'); cleanup(); process.exit(1); }, 35000);

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
    const chk = await call('Runtime.evaluate', { expression: 'typeof window.__RENDER_EXPANSION', returnByValue: true });
    if (chk.result?.value === 'function') break;
    await new Promise(r => setTimeout(r, 100));
  }

  const evalRes = await call('Runtime.evaluate', {
    expression: 'window.__RENDER_EXPANSION()',
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

  const pyScript = `
import os, glob
from PIL import Image

raw_dir = r"${RAW_DIR}"
out_dir = r"${OUT_DIR}"
total = 0
for fp in sorted(glob.glob(os.path.join(raw_dir, "*.png"))):
    name = os.path.splitext(os.path.basename(fp))[0]
    if name.startswith("contact_sheet"):
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
print(f"EXPANSION WEBP BUDGET: {total/1024:.1f} KB")
`;
  const pyOut = execFileSync('python', ['-c', pyScript], { encoding: 'utf8' });
  console.log(pyOut);
  process.exit(0);
});
