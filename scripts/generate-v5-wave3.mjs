/**
 * Sanvo V5 Wave 3 Art Studio — Renderiza 4 novas coleções Flagship pintadas em alta resolução:
 *  9. Bosque Onírico (Borboletas Morpho com bater de asas real + Flores Lunares)
 * 10. Templo do Trovão (Espírito Raijin com piscar real + Tambores Tomoe + Plasma)
 * 11. Horizonte Arcade (Companheiro Pixel-Bot CRT com wink real + Synthwave Outrun)
 * 12. Lagoa de Jade (Carpas Koi Imperiais + Lótus de Jade & Ouro)
 * + Camadas BLINK extras para Dragão Glacial e Chamas de Drakon
 * + Cantos TR/BR exclusivos dedicados para Fundação Imperial e Arquitetura Dev.
 */
import http from 'http';
import fs from 'fs';
import path from 'path';
import { spawn, execFileSync } from 'child_process';

const ROOT = 'd:\\Sancord';
const OUT_DIR = path.join(ROOT, 'static', 'cosmetics', 'assets');
const RAW_DIR = 'C:\\Users\\gabri\\.gemini\\antigravity\\brain\\639e93b4-dc25-4b1f-b1eb-a0819523d71b\\scratch\\v5_wave3_raw';
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(RAW_DIR, { recursive: true });

const STUDIO_HTML = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Sanvo V5 Wave 3 Studio</title></head>
<body style="margin:0;background:transparent;">
<canvas id="c" width="1024" height="1024"></canvas>
<script>
function newCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

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

  const bg = ctx.createRadialGradient(-rx * 0.25, -ry * 0.3, rx * 0.05, 0, 0, Math.max(rx, ry));
  bg.addColorStop(0, pal.bright);
  bg.addColorStop(0.55, pal.mid);
  bg.addColorStop(1, pal.deep);
  ctx.fillStyle = bg;
  ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); ctx.fill();

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
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.ellipse(-rx * 0.28, -ry * 0.3, rx * 0.22, ry * 0.13, -0.5, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

// Borboleta Morpho Feérica pintada (com wingSpread = 1.0 aberta ou 0.38 batendo asas!)
function drawMorphoButterfly(ctx, x, y, size, rot = 0, wingSpread = 1.0, pal = {}) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  const cOuter = pal.outer || '#311042';
  const cMid = pal.mid || '#c084fc';
  const cInner = pal.inner || '#38bdf8';
  const cCore = pal.core || '#fef08a';

  ctx.shadowColor = pal.glow || 'rgba(192,132,252,0.65)';
  ctx.shadowBlur = size * 0.28;

  for (const side of [-1, 1]) {
    ctx.save();
    ctx.scale(side * wingSpread, 1);

    // Asa inferior
    const lg = ctx.createRadialGradient(0, size * 0.1, size * 0.05, size * 0.45, size * 0.35, size * 0.75);
    lg.addColorStop(0, cCore);
    lg.addColorStop(0.32, cInner);
    lg.addColorStop(0.72, cMid);
    lg.addColorStop(1, cOuter);
    ctx.fillStyle = lg;
    ctx.beginPath();
    ctx.moveTo(0, size * 0.05);
    ctx.bezierCurveTo(size * 0.78, size * 0.08, size * 0.86, size * 0.62, size * 0.42, size * 0.78);
    ctx.bezierCurveTo(size * 0.22, size * 0.86, size * 0.08, size * 0.56, 0, size * 0.28);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.62)';
    ctx.lineWidth = Math.max(1.5, size * 0.025);
    ctx.stroke();

    // Asa superior (maior e recortada)
    const ug = ctx.createRadialGradient(size * 0.12, -size * 0.12, size * 0.04, size * 0.52, -size * 0.28, size * 0.96);
    ug.addColorStop(0, '#ffffff');
    ug.addColorStop(0.24, cInner);
    ug.addColorStop(0.66, cMid);
    ug.addColorStop(1, cOuter);
    ctx.fillStyle = ug;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(size * 0.32, -size * 0.78, size * 0.98, -size * 0.88, size * 0.96, -size * 0.26);
    ctx.bezierCurveTo(size * 0.94, size * 0.08, size * 0.55, size * 0.22, 0, size * 0.08);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Nervuras luminescentes e ocelos perolados nas pontas das asas
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255,255,255,0.48)';
    ctx.lineWidth = Math.max(1, size * 0.018);
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.quadraticCurveTo(size * 0.45, -size * 0.35, size * 0.82, -size * 0.42);
    ctx.moveTo(0, 0); ctx.quadraticCurveTo(size * 0.42, -size * 0.12, size * 0.84, -size * 0.15);
    ctx.moveTo(0, size * 0.1); ctx.quadraticCurveTo(size * 0.38, size * 0.32, size * 0.52, size * 0.62);
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(size * 0.76, -size * 0.46, size * 0.055, 0, Math.PI * 2);
    ctx.arc(size * 0.78, -size * 0.22, size * 0.04, 0, Math.PI * 2);
    ctx.arc(size * 0.48, size * 0.54, size * 0.045, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Corpo dourado e antenas finas
  ctx.fillStyle = '#fef3c7';
  ctx.beginPath();
  ctx.ellipse(0, size * 0.04, Math.max(2, size * 0.055), size * 0.34, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#fde68a';
  ctx.lineWidth = Math.max(1.2, size * 0.02);
  ctx.beginPath();
  ctx.moveTo(0, -size * 0.24); ctx.quadraticCurveTo(-size * 0.18, -size * 0.52, -size * 0.28, -size * 0.56);
  ctx.moveTo(0, -size * 0.24); ctx.quadraticCurveTo(size * 0.18, -size * 0.52, size * 0.28, -size * 0.56);
  ctx.stroke();
  ctx.restore();
}

// Flor Lunar / Lótus pintada em camadas de pétalas
function drawPaintedLotus(ctx, x, y, r, rot = 0, pal = {}) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  const cBase = pal.base || '#701a75';
  const cMid = pal.mid || '#f472b6';
  const cTip = pal.tip || '#fdf2f8';

  ctx.shadowColor = pal.glow || 'rgba(244,114,182,0.5)';
  ctx.shadowBlur = r * 0.32;

  for (let ring = 0; ring < 2; ring++) {
    const count = ring === 0 ? 8 : 6;
    const pr = ring === 0 ? r : r * 0.72;
    for (let i = 0; i < count; i++) {
      ctx.save();
      ctx.rotate((i / count) * Math.PI * 2 + ring * 0.38);
      const pg = ctx.createLinearGradient(0, 0, 0, -pr);
      pg.addColorStop(0, cBase);
      pg.addColorStop(0.55, cMid);
      pg.addColorStop(1, cTip);
      ctx.fillStyle = pg;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.bezierCurveTo(pr * 0.36, -pr * 0.28, pr * 0.34, -pr * 0.76, 0, -pr);
      ctx.bezierCurveTo(-pr * 0.34, -pr * 0.76, -pr * 0.36, -pr * 0.28, 0, 0);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = Math.max(1, r * 0.028);
      ctx.stroke();
      ctx.restore();
    }
  }
  // Pistilo dourado luminoso
  const cg = ctx.createRadialGradient(0, 0, 1, 0, 0, r * 0.26);
  cg.addColorStop(0, '#ffffff');
  cg.addColorStop(0.5, '#fde047');
  cg.addColorStop(1, '#d97706');
  ctx.fillStyle = cg;
  ctx.beginPath(); ctx.arc(0, 0, r * 0.24, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

// Carpa Koi Imperial pintada (corpo curvo orgânico, barbatanas de seda translúcida, manchas ouro/carmesim)
function drawImperialKoi(ctx, x, y, size, rot = 0, flip = false) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  if (flip) ctx.scale(-1, 1);

  ctx.shadowColor = 'rgba(16,185,129,0.55)';
  ctx.shadowBlur = size * 0.22;

  // Nadadeira caudal dupla de seda fluida
  const tg = ctx.createLinearGradient(0, size * 0.25, 0, size * 0.98);
  tg.addColorStop(0, 'rgba(254,243,199,0.92)');
  tg.addColorStop(0.5, 'rgba(251,146,60,0.68)');
  tg.addColorStop(1, 'rgba(52,211,153,0.08)');
  ctx.fillStyle = tg;
  ctx.beginPath();
  ctx.moveTo(0, size * 0.32);
  ctx.bezierCurveTo(size * 0.46, size * 0.58, size * 0.52, size * 0.88, size * 0.22, size * 0.98);
  ctx.quadraticCurveTo(size * 0.04, size * 0.72, 0, size * 0.56);
  ctx.quadraticCurveTo(-size * 0.08, size * 0.76, -size * 0.28, size * 0.94);
  ctx.bezierCurveTo(-size * 0.48, size * 0.76, -size * 0.36, size * 0.5, 0, size * 0.32);
  ctx.closePath();
  ctx.fill();

  // Nadadeiras peitorais abertas
  for (const s of [-1, 1]) {
    ctx.save();
    ctx.scale(s, 1);
    const fg = ctx.createLinearGradient(size * 0.1, -size * 0.12, size * 0.48, size * 0.12);
    fg.addColorStop(0, 'rgba(255,255,255,0.9)');
    fg.addColorStop(0.6, 'rgba(253,224,71,0.65)');
    fg.addColorStop(1, 'rgba(16,185,129,0.1)');
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.moveTo(size * 0.14, -size * 0.16);
    ctx.bezierCurveTo(size * 0.48, -size * 0.18, size * 0.52, size * 0.08, size * 0.26, size * 0.16);
    ctx.quadraticCurveTo(size * 0.14, size * 0.04, size * 0.14, -size * 0.16);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // Corpo esculpido marfim-perolado com manchas ouro/vermelho imperial
  const bg = ctx.createLinearGradient(-size * 0.24, -size * 0.5, size * 0.24, size * 0.45);
  bg.addColorStop(0, '#ffffff');
  bg.addColorStop(0.45, '#fef3c7');
  bg.addColorStop(0.82, '#fbbf24');
  bg.addColorStop(1, '#d97706');
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.moveTo(0, -size * 0.54);
  ctx.bezierCurveTo(size * 0.28, -size * 0.44, size * 0.28, size * 0.02, size * 0.06, size * 0.44);
  ctx.lineTo(-size * 0.06, size * 0.44);
  ctx.bezierCurveTo(-size * 0.24, size * 0.04, -size * 0.28, -size * 0.44, 0, -size * 0.54);
  ctx.closePath();
  ctx.fill();

  // Manchas Kohaku (laranja-rubro e ouro)
  ctx.save();
  ctx.clip();
  ctx.fillStyle = '#ea580c';
  ctx.beginPath();
  ctx.arc(size * 0.04, -size * 0.34, size * 0.13, 0, Math.PI * 2);
  ctx.arc(-size * 0.05, -size * 0.06, size * 0.16, 0, Math.PI * 2);
  ctx.arc(size * 0.03, size * 0.2, size * 0.11, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Nadadeira dorsal e bigodes dourados + olhos brilhantes
  ctx.strokeStyle = '#fef08a';
  ctx.lineWidth = Math.max(2, size * 0.035);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, -size * 0.22);
  ctx.quadraticCurveTo(size * 0.08, 0, 0, size * 0.26);
  ctx.moveTo(-size * 0.08, -size * 0.5);
  ctx.quadraticCurveTo(-size * 0.22, -size * 0.62, -size * 0.26, -size * 0.56);
  ctx.moveTo(size * 0.08, -size * 0.5);
  ctx.quadraticCurveTo(size * 0.22, -size * 0.62, size * 0.26, -size * 0.56);
  ctx.stroke();

  ctx.fillStyle = '#0f172a';
  ctx.beginPath();
  ctx.arc(-size * 0.12, -size * 0.38, size * 0.032, 0, Math.PI * 2);
  ctx.arc(size * 0.12, -size * 0.38, size * 0.032, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// Raio de plasma esculpido com núcleo branco e halo elétrico ciano/violeta
function drawLightningBolt(ctx, pts, width, coreColor = '#ffffff', glowColor = '#38bdf8') {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowColor = glowColor;
  ctx.shadowBlur = width * 2.4;
  ctx.strokeStyle = glowColor;
  ctx.lineWidth = width * 1.9;
  ctx.beginPath();
  pts.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
  ctx.stroke();

  ctx.shadowBlur = width * 0.8;
  ctx.strokeStyle = coreColor;
  ctx.lineWidth = width * 0.72;
  ctx.stroke();
  ctx.restore();
}

// Tambor Raijin Tomoe dourado e obsidiana
function drawTomoeDrum(ctx, x, y, r, rot = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.shadowColor = 'rgba(56,189,248,0.65)';
  ctx.shadowBlur = r * 0.38;

  const rim = ctx.createLinearGradient(-r, -r, r, r);
  rim.addColorStop(0, '#fef08a');
  rim.addColorStop(0.5, '#d97706');
  rim.addColorStop(1, '#78350f');
  ctx.fillStyle = rim;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();

  const face = ctx.createRadialGradient(0, 0, r * 0.05, 0, 0, r * 0.82);
  face.addColorStop(0, '#312e81');
  face.addColorStop(0.7, '#1e1b4b');
  face.addColorStop(1, '#090d16');
  ctx.fillStyle = face;
  ctx.beginPath(); ctx.arc(0, 0, r * 0.8, 0, Math.PI * 2); ctx.fill();

  // 3 vírgulas Tomoe elétricas
  for (let i = 0; i < 3; i++) {
    ctx.save();
    ctx.rotate((i * Math.PI * 2) / 3);
    ctx.fillStyle = '#38bdf8';
    ctx.beginPath();
    ctx.arc(0, -r * 0.36, r * 0.18, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(r * 0.16, -r * 0.36);
    ctx.quadraticCurveTo(r * 0.28, -r * 0.05, 0, r * 0.08);
    ctx.quadraticCurveTo(r * 0.08, -r * 0.16, -r * 0.12, -r * 0.28);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(-r * 0.04, -r * 0.4, r * 0.06, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

// ============================================================================
// COLEÇÃO 9: BOSQUE ONÍRICO (BORBOLETAS MORPHO & FLORES LUNARES)
// ============================================================================
function renderDreamBack() {
  const c = newCanvas(1024, 1024);
  const ctx = c.getContext('2d');
  const cx = 512, cy = 512, R = 338;

  const aura = ctx.createRadialGradient(cx, cy, R * 0.7, cx, cy, R * 1.46);
  aura.addColorStop(0, 'rgba(192,132,252,0.52)');
  aura.addColorStop(0.5, 'rgba(56,189,248,0.32)');
  aura.addColorStop(0.85, 'rgba(88,28,135,0.18)');
  aura.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = aura;
  ctx.beginPath(); ctx.arc(cx, cy, R * 1.46, 0, Math.PI * 2); ctx.fill();

  // Cipós prateados e folhas bioluminescentes envolvendo o avatar
  const vg = ctx.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
  vg.addColorStop(0, '#e9d5ff');
  vg.addColorStop(0.45, '#38bdf8');
  vg.addColorStop(0.75, '#c084fc');
  vg.addColorStop(1, '#fde68a');
  ctx.strokeStyle = vg;
  ctx.lineWidth = 18;
  ctx.beginPath(); ctx.arc(cx, cy, R + 16, 0, Math.PI * 2); ctx.stroke();

  // Borboletas menores em revoada atrás
  drawMorphoButterfly(ctx, cx - 285, cy - 220, 96, -0.55, 0.92);
  drawMorphoButterfly(ctx, cx - 335, cy + 85, 76, -1.1, 0.85, { inner: '#f472b6', mid: '#a855f7' });
  drawMorphoButterfly(ctx, cx + 325, cy + 125, 82, 0.95, 0.88);
  return c;
}

function renderDreamFront(folded = false) {
  const c = newCanvas(1024, 1024);
  const ctx = c.getContext('2d');
  const cx = 512, cy = 512, R = 338;

  // Cipó florido prateado na base
  ctx.save();
  ctx.shadowColor = 'rgba(168,85,247,0.6)';
  ctx.shadowBlur = 16;
  const bg = ctx.createLinearGradient(cx - 320, cy + 160, cx + 320, cy + 370);
  bg.addColorStop(0, '#3b0764');
  bg.addColorStop(0.3, '#c084fc');
  bg.addColorStop(0.5, '#e0f2fe');
  bg.addColorStop(0.7, '#c084fc');
  bg.addColorStop(1, '#3b0764');
  ctx.strokeStyle = bg;
  ctx.lineWidth = 16;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(cx, cy, R + 22, 0.16 * Math.PI, 0.84 * Math.PI);
  ctx.stroke();
  ctx.restore();

  // Flores lunares na base e lateral
  drawPaintedLotus(ctx, cx, cy + R + 24, 48, 0);
  drawPaintedLotus(ctx, cx - 265, cy + 218, 34, -0.4, { mid: '#38bdf8', tip: '#e0f2fe' });
  drawPaintedLotus(ctx, cx + 265, cy + 218, 34, 0.4, { mid: '#38bdf8', tip: '#e0f2fe' });

  // Borboleta Morpho protagonista pousada na borda superior direita (bate as asas no evento blink!)
  drawMorphoButterfly(ctx, cx + 246, cy - 242, 134, 0.48, folded ? 0.36 : 1.0);

  drawSculptedStar(ctx, cx - 240, cy - 265, 24, '#ffffff', '#e879f9', 0.2, 0.92);
  drawSculptedStar(ctx, cx + 335, cy - 95, 20, '#ffffff', '#38bdf8', 0.4, 0.9);
  return c;
}

function renderFrameDreamTL() {
  const c = newCanvas(640, 480);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(90, 82, 10, 90, 82, 270);
  g.addColorStop(0, 'rgba(192,132,252,0.44)');
  g.addColorStop(0.55, 'rgba(56,189,248,0.18)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 430, 360);

  ctx.strokeStyle = '#e9d5ff';
  ctx.lineWidth = 8;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(24, 295); ctx.bezierCurveTo(22, 100, 38, 28, 135, 24); ctx.lineTo(365, 24);
  ctx.stroke();

  drawPaintedLotus(ctx, 74, 72, 46, -0.4);
  drawMorphoButterfly(ctx, 182, 58, 74, 0.38, 0.95);
  drawSculptedStar(ctx, 292, 42, 18, '#ffffff', '#38bdf8', 0, 0.92);
  return c;
}

function renderFrameDreamTR() {
  const c = newCanvas(640, 480);
  const ctx = c.getContext('2d');
  ctx.strokeStyle = '#c084fc';
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(355, 24); ctx.lineTo(612, 24); ctx.lineTo(612, 265);
  ctx.stroke();
  drawMorphoButterfly(ctx, 548, 82, 82, -0.48, 0.96);
  drawSculptedStar(ctx, 452, 46, 20, '#ffffff', '#f472b6', 0.2, 0.92);
  return c;
}

function renderFrameDreamBR() {
  const c = newCanvas(640, 480);
  const ctx = c.getContext('2d');
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(375, 456); ctx.lineTo(612, 456); ctx.lineTo(612, 240);
  ctx.stroke();
  drawPaintedLotus(ctx, 574, 418, 38, 0.4, { mid: '#38bdf8', tip: '#e0f2fe' });
  drawMorphoButterfly(ctx, 488, 424, 58, -0.35, 0.9);
  return c;
}

function renderFxDreamButterfly(folded = false) {
  const c = newCanvas(384, 384);
  const ctx = c.getContext('2d');
  drawMorphoButterfly(ctx, 192, 196, 156, -0.22, folded ? 0.34 : 1.0);
  return c;
}

// ============================================================================
// COLEÇÃO 10: TEMPLO DO TROVÃO (ESPÍRITO RAIJIN & PLASMA CELESTE)
// ============================================================================
function renderStormBack() {
  const c = newCanvas(1024, 1024);
  const ctx = c.getContext('2d');
  const cx = 512, cy = 512, R = 338;

  const aura = ctx.createRadialGradient(cx, cy, R * 0.72, cx, cy, R * 1.48);
  aura.addColorStop(0, 'rgba(56,189,248,0.56)');
  aura.addColorStop(0.48, 'rgba(99,102,241,0.38)');
  aura.addColorStop(0.84, 'rgba(30,27,75,0.22)');
  aura.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = aura;
  ctx.beginPath(); ctx.arc(cx, cy, R * 1.48, 0, Math.PI * 2); ctx.fill();

  // Arco Raijin com tambores Tomoe atrás do avatar
  ctx.strokeStyle = '#fbbf24';
  ctx.lineWidth = 14;
  ctx.beginPath(); ctx.arc(cx, cy, R + 32, -0.88 * Math.PI, -0.12 * Math.PI); ctx.stroke();

  const drumAngles = [-0.82 * Math.PI, -0.62 * Math.PI, -0.38 * Math.PI, -0.18 * Math.PI];
  for (const a of drumAngles) {
    drawTomoeDrum(ctx, cx + Math.cos(a) * (R + 42), cy + Math.sin(a) * (R + 42), 54, a + Math.PI / 2);
  }

  // Raios elétricos rasgando as laterais
  drawLightningBolt(ctx, [[cx - 355, cy - 85], [cx - 395, cy - 10], [cx - 342, cy + 45], [cx - 388, cy + 135]], 7);
  drawLightningBolt(ctx, [[cx + 355, cy - 85], [cx + 395, cy - 10], [cx + 342, cy + 45], [cx + 388, cy + 135]], 7);
  return c;
}

function renderStormFront(blink = false) {
  const c = newCanvas(1024, 1024);
  const ctx = c.getContext('2d');
  const cx = 512, cy = 512, R = 338;

  // Nuvens de tempestade orientais esculpidas em azul-noite e ouro na base
  ctx.save();
  ctx.shadowColor = 'rgba(56,189,248,0.65)';
  ctx.shadowBlur = 18;
  const cg = ctx.createLinearGradient(cx - 340, cy + 160, cx + 340, cy + 380);
  cg.addColorStop(0, '#1e1b4b');
  cg.addColorStop(0.35, '#312e81');
  cg.addColorStop(0.5, '#38bdf8');
  cg.addColorStop(0.65, '#312e81');
  cg.addColorStop(1, '#1e1b4b');
  ctx.fillStyle = cg;
  const puffs = [
    [cx - 245, cy + 255, 64], [cx - 145, cy + 312, 72], [cx, cy + 338, 82],
    [cx + 145, cy + 312, 72], [cx + 245, cy + 255, 64],
  ];
  ctx.beginPath();
  for (const [px, py, pr] of puffs) { ctx.moveTo(px + pr, py); ctx.arc(px, py, pr, 0, Math.PI * 2); }
  ctx.fill();
  ctx.strokeStyle = '#fde68a';
  ctx.lineWidth = 4.5;
  ctx.stroke();
  ctx.restore();

  // Espírito do Trovão (Kitsune/Raiju elétrico) no topo central com olhos que piscam/brilham!
  ctx.save();
  ctx.translate(cx, cy - R - 18);
  ctx.shadowColor = 'rgba(56,189,248,0.8)';
  ctx.shadowBlur = 20;
  const sg = ctx.createLinearGradient(-90, -70, 90, 60);
  sg.addColorStop(0, '#0f172a');
  sg.addColorStop(0.5, '#1e3a8a');
  sg.addColorStop(1, '#38bdf8');
  ctx.fillStyle = sg;
  ctx.beginPath();
  ctx.moveTo(-78, 22);
  ctx.lineTo(-104, -58); ctx.lineTo(-42, -26);
  ctx.lineTo(0, -72);
  ctx.lineTo(42, -26); ctx.lineTo(104, -58);
  ctx.lineTo(78, 22);
  ctx.quadraticCurveTo(0, 48, -78, 22);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#fde047';
  ctx.lineWidth = 4;
  ctx.stroke();

  // Olhos de plasma do Espírito Raijin (abertos vs piscando em arco elétrico!)
  if (blink) {
    ctx.strokeStyle = '#fef08a';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-44, 2); ctx.quadraticCurveTo(-28, -10, -14, 4);
    ctx.moveTo(14, 4); ctx.quadraticCurveTo(28, -10, 44, 2);
    ctx.stroke();
  } else {
    ctx.fillStyle = '#fef08a';
    ctx.beginPath();
    ctx.ellipse(-28, 2, 14, 9, 0.2, 0, Math.PI * 2);
    ctx.ellipse(28, 2, 14, 9, -0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(-26, 0, 5, 0, Math.PI * 2);
    ctx.arc(26, 0, 5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  drawTomoeDrum(ctx, cx, cy + R + 32, 48, 0);
  drawLightningBolt(ctx, [[cx - 210, cy + 280], [cx - 135, cy + 310], [cx - 65, cy + 335]], 5.5, '#ffffff', '#fde047');
  drawLightningBolt(ctx, [[cx + 210, cy + 280], [cx + 135, cy + 310], [cx + 65, cy + 335]], 5.5, '#ffffff', '#fde047');
  return c;
}

function renderFrameStormTL() {
  const c = newCanvas(640, 480);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(90, 82, 12, 90, 82, 280);
  g.addColorStop(0, 'rgba(56,189,248,0.46)');
  g.addColorStop(0.55, 'rgba(99,102,241,0.2)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 430, 360);

  drawLightningBolt(ctx, [[22, 310], [28, 140], [22, 26], [175, 32], [360, 22]], 8);
  drawTomoeDrum(ctx, 76, 74, 52, -0.35);
  drawSculptedStar(ctx, 215, 42, 22, '#ffffff', '#38bdf8', 0, 0.95);
  return c;
}

function renderFrameStormTR() {
  const c = newCanvas(640, 480);
  const ctx = c.getContext('2d');
  drawLightningBolt(ctx, [[360, 24], [520, 30], [612, 24], [606, 150], [614, 280]], 7.5);
  drawTomoeDrum(ctx, 566, 72, 44, 0.35);
  drawSculptedStar(ctx, 456, 44, 20, '#ffffff', '#fde047', 0.25, 0.92);
  return c;
}

function renderFrameStormBR() {
  const c = newCanvas(640, 480);
  const ctx = c.getContext('2d');
  drawLightningBolt(ctx, [[380, 456], [535, 450], [612, 456], [608, 330], [614, 235]], 7);
  drawTomoeDrum(ctx, 574, 418, 40, 0.78);
  return c;
}

function renderFxStormBolt() {
  const c = newCanvas(384, 384);
  const ctx = c.getContext('2d');
  drawLightningBolt(ctx, [[192, 24], [134, 145], [224, 178], [142, 356]], 14, '#ffffff', '#38bdf8');
  drawLightningBolt(ctx, [[134, 145], [68, 228]], 8, '#fef08a', '#f59e0b');
  return c;
}

function renderFxStormOrb() {
  const c = newCanvas(384, 384);
  const ctx = c.getContext('2d');
  drawTomoeDrum(ctx, 192, 192, 136, 0);
  return c;
}

// ============================================================================
// COLEÇÃO 11: HORIZONTE ARCADE (PIXEL-BOT CRT & SYNTHWAVE OUTRUN)
// ============================================================================
function drawPixelHeart(ctx, x, y, scale, pal = ['#ff2a85', '#ff7eb3', '#ffffff']) {
  ctx.save();
  ctx.translate(x, y);
  const grid = [
    " 11 11 ",
    "1221111",
    "1211111",
    " 11111 ",
    "  111  ",
    "   1   "
  ];
  const s = scale;
  ctx.shadowColor = pal[0];
  ctx.shadowBlur = s * 2;
  grid.forEach((row, ry) => {
    [...row].forEach((ch, rx) => {
      if (ch === ' ') return;
      ctx.fillStyle = ch === '2' ? pal[2] : pal[0];
      ctx.fillRect((rx - 3.5) * s, (ry - 3) * s, s, s);
    });
  });
  ctx.restore();
}

function drawArcadeBot(ctx, x, y, scale, wink = false) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.shadowColor = 'rgba(244,63,158,0.65)';
  ctx.shadowBlur = 18;

  // Antena com esfera neon
  ctx.strokeStyle = '#fde047';
  ctx.lineWidth = 6;
  ctx.beginPath(); ctx.moveTo(0, -64); ctx.lineTo(0, -96); ctx.stroke();
  ctx.fillStyle = '#38e8ff';
  ctx.beginPath(); ctx.arc(0, -102, 12, 0, Math.PI * 2); ctx.fill();

  // Gabinete CRT arredondado
  const bg = ctx.createLinearGradient(-72, -64, 72, 64);
  bg.addColorStop(0, '#c084fc');
  bg.addColorStop(0.5, '#6366f1');
  bg.addColorStop(1, '#312e81');
  ctx.fillStyle = bg;
  ctx.beginPath(); ctx.roundRect(-72, -64, 144, 124, 26); ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 4.5;
  ctx.stroke();

  // Tela CRT escura
  ctx.fillStyle = '#090d16';
  ctx.beginPath(); ctx.roundRect(-54, -46, 108, 84, 16); ctx.fill();
  ctx.strokeStyle = '#38e8ff';
  ctx.lineWidth = 3;
  ctx.stroke();

  // Rosto Pixel LED na tela (pisca ^ ω - quando wink = true!)
  ctx.strokeStyle = '#38e8ff';
  ctx.fillStyle = '#38e8ff';
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (wink) {
    ctx.beginPath();
    ctx.moveTo(-36, -6); ctx.lineTo(-24, -18); ctx.lineTo(-12, -6);
    ctx.moveTo(14, -12); ctx.lineTo(36, -12);
    ctx.stroke();
  } else {
    ctx.fillRect(-34, -22, 16, 22);
    ctx.fillRect(18, -22, 16, 22);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(-30, -18, 6, 6);
    ctx.fillRect(22, -18, 6, 6);
  }
  // Boquinha feliz + bochechas magenta
  ctx.fillStyle = '#f43f9e';
  ctx.beginPath();
  ctx.arc(-40, 12, 7, 0, Math.PI * 2);
  ctx.arc(40, 12, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#fde047';
  ctx.lineWidth = 4.5;
  ctx.beginPath(); ctx.arc(0, 10, 12, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
  ctx.restore();
}

function renderArcadeBack() {
  const c = newCanvas(1024, 1024);
  const ctx = c.getContext('2d');
  const cx = 512, cy = 512, R = 338;

  // Sol Synthwave Outrun listrado atrás
  const sun = ctx.createLinearGradient(cx, cy - R * 1.35, cx, cy + R * 1.2);
  sun.addColorStop(0, 'rgba(253,224,71,0.58)');
  sun.addColorStop(0.45, 'rgba(244,63,158,0.48)');
  sun.addColorStop(0.85, 'rgba(126,34,206,0.28)');
  sun.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = sun;
  ctx.beginPath(); ctx.arc(cx, cy, R * 1.44, 0, Math.PI * 2); ctx.fill();

  // Anel neon duplo ciano + magenta
  ctx.strokeStyle = '#38e8ff';
  ctx.lineWidth = 14;
  ctx.beginPath(); ctx.arc(cx, cy, R + 22, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = '#f43f9e';
  ctx.lineWidth = 8;
  ctx.beginPath(); ctx.arc(cx, cy, R + 6, 0, Math.PI * 2); ctx.stroke();
  return c;
}

function renderArcadeFront(wink = false) {
  const c = newCanvas(1024, 1024);
  const ctx = c.getContext('2d');
  const cx = 512, cy = 512, R = 338;

  // Barra de energia Arcade & D-Pad na base
  ctx.save();
  ctx.shadowColor = 'rgba(56,232,255,0.6)';
  ctx.shadowBlur = 16;
  const bg = ctx.createLinearGradient(cx - 320, cy + 160, cx + 320, cy + 370);
  bg.addColorStop(0, '#312e81');
  bg.addColorStop(0.3, '#f43f9e');
  bg.addColorStop(0.5, '#fde047');
  bg.addColorStop(0.7, '#38e8ff');
  bg.addColorStop(1, '#312e81');
  ctx.strokeStyle = bg;
  ctx.lineWidth = 20;
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(cx, cy, R + 22, 0.16 * Math.PI, 0.84 * Math.PI); ctx.stroke();
  ctx.restore();

  // Companheiro Pixel-Bot CRT empoleirado no topo esquerdo!
  drawArcadeBot(ctx, cx - 245, cy - 238, 1.05, wink);

  // Corações 16-bit e estrelas arcade
  drawPixelHeart(ctx, cx + 265, cy - 225, 13);
  drawPixelHeart(ctx, cx - 255, cy + 235, 11);
  drawPixelHeart(ctx, cx + 255, cy + 235, 11);
  drawFacetedGem(ctx, cx, cy + R + 24, 36, 36, 0.78, {
    bright: '#ffffff', mid: '#38e8ff', deep: '#1e3a8a',
    bezelLight: '#fef08a', bezelMid: '#f43f9e', bezelDark: '#4c0519',
  });
  return c;
}

function renderFrameArcadeTL() {
  const c = newCanvas(640, 480);
  const ctx = c.getContext('2d');
  ctx.strokeStyle = '#38e8ff';
  ctx.lineWidth = 8;
  ctx.beginPath(); ctx.moveTo(22, 290); ctx.lineTo(22, 22); ctx.lineTo(360, 22); ctx.stroke();
  ctx.strokeStyle = '#f43f9e';
  ctx.lineWidth = 5;
  ctx.beginPath(); ctx.moveTo(34, 250); ctx.lineTo(34, 34); ctx.lineTo(310, 34); ctx.stroke();
  drawArcadeBot(ctx, 94, 88, 0.74, false);
  drawPixelHeart(ctx, 210, 56, 9);
  drawPixelHeart(ctx, 275, 56, 9);
  return c;
}

function renderFrameArcadeTR() {
  const c = newCanvas(640, 480);
  const ctx = c.getContext('2d');
  ctx.strokeStyle = '#f43f9e';
  ctx.lineWidth = 8;
  ctx.beginPath(); ctx.moveTo(355, 22); ctx.lineTo(614, 22); ctx.lineTo(614, 265); ctx.stroke();
  drawPixelHeart(ctx, 565, 68, 11);
  drawSculptedStar(ctx, 485, 52, 22, '#ffffff', '#fde047', 0, 0.95);
  return c;
}

function renderFrameArcadeBR() {
  const c = newCanvas(640, 480);
  const ctx = c.getContext('2d');
  ctx.strokeStyle = '#fde047';
  ctx.lineWidth = 7;
  ctx.beginPath(); ctx.moveTo(380, 456); ctx.lineTo(614, 456); ctx.lineTo(614, 240); ctx.stroke();
  drawPixelHeart(ctx, 568, 418, 10);
  drawSculptedStar(ctx, 495, 430, 18, '#ffffff', '#38e8ff', 0, 0.92);
  return c;
}

function renderFxArcadeHeart() {
  const c = newCanvas(384, 384);
  const ctx = c.getContext('2d');
  drawPixelHeart(ctx, 192, 196, 36);
  return c;
}

function renderFxArcadeStar() {
  const c = newCanvas(384, 384);
  const ctx = c.getContext('2d');
  drawArcadeBot(ctx, 192, 204, 1.85, false);
  return c;
}

// ============================================================================
// COLEÇÃO 12: LAGOA DE JADE (CARPAS KOI IMPERIAIS & LÓTUS DE JADE)
// ============================================================================
function renderJadeBack() {
  const c = newCanvas(1024, 1024);
  const ctx = c.getContext('2d');
  const cx = 512, cy = 512, R = 338;

  const aura = ctx.createRadialGradient(cx, cy, R * 0.7, cx, cy, R * 1.46);
  aura.addColorStop(0, 'rgba(16,185,129,0.52)');
  aura.addColorStop(0.5, 'rgba(20,184,166,0.32)');
  aura.addColorStop(0.84, 'rgba(6,78,59,0.2)');
  aura.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = aura;
  ctx.beginPath(); ctx.arc(cx, cy, R * 1.46, 0, Math.PI * 2); ctx.fill();

  // Anel de jade lapidado e ouro imperial
  const jg = ctx.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
  jg.addColorStop(0, '#a7f3d0');
  jg.addColorStop(0.35, '#10b981');
  jg.addColorStop(0.7, '#065f46');
  jg.addColorStop(1, '#fde68a');
  ctx.strokeStyle = jg;
  ctx.lineWidth = 20;
  ctx.beginPath(); ctx.arc(cx, cy, R + 16, 0, Math.PI * 2); ctx.stroke();

  // Vitórias-régias de jade atrás
  for (const [lx, ly, lr] of [[cx - 285, cy + 165, 76], [cx + 295, cy - 175, 72]]) {
    ctx.save();
    ctx.translate(lx, ly);
    const pg = ctx.createRadialGradient(0, 0, 5, 0, 0, lr);
    pg.addColorStop(0, '#34d399');
    pg.addColorStop(1, '#065f46');
    ctx.fillStyle = pg;
    ctx.beginPath(); ctx.arc(0, 0, lr, 0.25, Math.PI * 2 - 0.25); ctx.lineTo(0, 0); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#fde68a'; ctx.lineWidth = 3; ctx.stroke();
    ctx.restore();
  }
  return c;
}

function renderJadeFront() {
  const c = newCanvas(1024, 1024);
  const ctx = c.getContext('2d');
  const cx = 512, cy = 512, R = 338;

  // Duas Carpas Koi Imperiais nadando em harmonia Yin-Yang ao redor do avatar!
  drawImperialKoi(ctx, cx - 325, cy - 95, 225, 0.35, false);
  drawImperialKoi(ctx, cx + 325, cy + 95, 225, Math.PI + 0.35, false);

  // Flores de Lótus imperiais e gema de jade na base
  drawPaintedLotus(ctx, cx, cy + R + 24, 52, 0, { base: '#065f46', mid: '#34d399', tip: '#ecfdf5', glow: 'rgba(52,211,153,0.6)' });
  drawPaintedLotus(ctx, cx + 245, cy - 255, 42, 0.35);
  drawSculptedStar(ctx, cx - 235, cy - 275, 24, '#ffffff', '#fde68a', 0, 0.94);
  drawSculptedStar(ctx, cx + 235, cy + 285, 22, '#ffffff', '#6ee7b7', 0.2, 0.92);
  return c;
}

function renderFrameJadeTL() {
  const c = newCanvas(640, 480);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(90, 82, 12, 90, 82, 270);
  g.addColorStop(0, 'rgba(16,185,129,0.44)');
  g.addColorStop(0.55, 'rgba(245,158,11,0.18)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 430, 360);

  ctx.strokeStyle = '#6ee7b7';
  ctx.lineWidth = 8;
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(24, 300); ctx.bezierCurveTo(22, 100, 38, 28, 130, 24); ctx.lineTo(365, 24); ctx.stroke();

  drawImperialKoi(ctx, 156, 86, 136, 1.18, false);
  drawPaintedLotus(ctx, 64, 68, 44, -0.3);
  return c;
}

function renderFrameJadeTR() {
  const c = newCanvas(640, 480);
  const ctx = c.getContext('2d');
  ctx.strokeStyle = '#fde68a';
  ctx.lineWidth = 7;
  ctx.beginPath(); ctx.moveTo(360, 24); ctx.lineTo(612, 24); ctx.lineTo(612, 265); ctx.stroke();
  drawPaintedLotus(ctx, 568, 72, 42, 0.35, { base: '#065f46', mid: '#34d399', tip: '#ecfdf5' });
  drawSculptedStar(ctx, 472, 46, 20, '#ffffff', '#fde68a', 0, 0.94);
  return c;
}

function renderFrameJadeBR() {
  const c = newCanvas(640, 480);
  const ctx = c.getContext('2d');
  ctx.strokeStyle = '#34d399';
  ctx.lineWidth = 7;
  ctx.beginPath(); ctx.moveTo(380, 456); ctx.lineTo(612, 456); ctx.lineTo(612, 240); ctx.stroke();
  drawImperialKoi(ctx, 526, 404, 118, -0.82, false);
  drawPaintedLotus(ctx, 578, 422, 34, 0.2);
  return c;
}

function renderFxJadeKoi() {
  const c = newCanvas(384, 384);
  const ctx = c.getContext('2d');
  drawImperialKoi(ctx, 192, 192, 240, 0.45, false);
  return c;
}

function renderFxJadeLotus() {
  const c = newCanvas(384, 384);
  const ctx = c.getContext('2d');
  drawPaintedLotus(ctx, 192, 192, 142, 0.2);
  return c;
}

// ============================================================================
// EXTRAS DE MELHORIA VISUAL PARA AS COLEÇÕES EXISTENTES:
//  - deco_frost_blink & deco_infernal_blink (flashes de evento secundário!)
//  - frame_founder_tr/br & frame_dev_tr/br dedicados!
// ============================================================================
function renderFrostBlink() {
  const c = newCanvas(1024, 1024);
  const ctx = c.getContext('2d');
  const cx = 512, cy = 512, R = 338;
  drawSculptedStar(ctx, cx, cy - R - 38, 68, '#ffffff', '#38bdf8', 0, 0.98);
  drawSculptedStar(ctx, cx - 190, cy - 295, 44, '#ffffff', '#7dd3fc', 0.3, 0.92);
  drawSculptedStar(ctx, cx + 190, cy - 295, 44, '#ffffff', '#7dd3fc', -0.3, 0.92);
  drawSculptedStar(ctx, cx, cy + R + 22, 52, '#ffffff', '#bae6fd', 0, 0.95);
  return c;
}

function renderInfernalBlink() {
  const c = newCanvas(1024, 1024);
  const ctx = c.getContext('2d');
  const cx = 512, cy = 512, R = 338;
  drawSculptedStar(ctx, cx, cy + R + 22, 64, '#ffffff', '#fb923c', 0, 0.98);
  drawSculptedStar(ctx, cx - 228, cy - 228, 48, '#fef08a', '#ea580c', 0.2, 0.94);
  drawSculptedStar(ctx, cx + 228, cy - 228, 48, '#fef08a', '#ea580c', -0.2, 0.94);
  return c;
}

function renderFrameFounderTR() {
  const c = newCanvas(640, 480);
  const ctx = c.getContext('2d');
  ctx.strokeStyle = '#fbbf24';
  ctx.lineWidth = 8;
  ctx.beginPath(); ctx.moveTo(350, 22); ctx.lineTo(614, 22); ctx.lineTo(614, 270); ctx.stroke();
  drawFacetedGem(ctx, 578, 62, 26, 26, 0.78, { bright: '#fffbeb', mid: '#f59e0b', deep: '#78350f' });
  drawSculptedStar(ctx, 468, 42, 22, '#ffffff', '#fde68a', 0, 0.96);
  return c;
}

function renderFrameFounderBR() {
  const c = newCanvas(640, 480);
  const ctx = c.getContext('2d');
  ctx.strokeStyle = '#fbbf24';
  ctx.lineWidth = 7;
  ctx.beginPath(); ctx.moveTo(375, 456); ctx.lineTo(614, 456); ctx.lineTo(614, 245); ctx.stroke();
  drawFacetedGem(ctx, 578, 420, 22, 22, 0.78, { bright: '#fffbeb', mid: '#f59e0b', deep: '#78350f' });
  drawSculptedStar(ctx, 488, 434, 18, '#ffffff', '#fde68a', 0.2, 0.92);
  return c;
}

function renderFrameDevTR() {
  const c = newCanvas(640, 480);
  const ctx = c.getContext('2d');
  ctx.strokeStyle = '#34d399';
  ctx.lineWidth = 7;
  ctx.beginPath(); ctx.moveTo(355, 22); ctx.lineTo(614, 22); ctx.lineTo(614, 265); ctx.stroke();
  drawFacetedGem(ctx, 576, 62, 24, 24, 0.78, { bright: '#ecfdf5', mid: '#10b981', deep: '#064e3b' });
  drawSculptedStar(ctx, 472, 42, 20, '#ffffff', '#6ee7b7', 0, 0.94);
  return c;
}

function renderFrameDevBR() {
  const c = newCanvas(640, 480);
  const ctx = c.getContext('2d');
  ctx.strokeStyle = '#34d399';
  ctx.lineWidth = 7;
  ctx.beginPath(); ctx.moveTo(380, 456); ctx.lineTo(614, 456); ctx.lineTo(614, 245); ctx.stroke();
  drawFacetedGem(ctx, 578, 420, 22, 22, 0.78, { bright: '#ecfdf5', mid: '#10b981', deep: '#064e3b' });
  return c;
}

function renderContactSheet(map) {
  const c = newCanvas(1600, 620);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#0b0d14';
  ctx.fillRect(0, 0, c.width, c.height);

  const cards = [
    ['Bosque Onírico', 'dream', '#2e1045', '#120b1d'],
    ['Templo do Trovão', 'storm', '#0f2347', '#0a1022'],
    ['Horizonte Arcade', 'arcade', '#351042', '#120a24'],
    ['Lagoa de Jade', 'jade', '#07362c', '#091816'],
  ];

  cards.forEach(([label, key, c1, c2], idx) => {
    const x = 32 + idx * 388, y = 34, w = 356, h = 548;
    ctx.save();
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 18); ctx.clip();
    const bg = ctx.createLinearGradient(x, y, x, y + h);
    bg.addColorStop(0, c1); bg.addColorStop(0.34, c2); bg.addColorStop(1, '#11131b');
    ctx.fillStyle = bg; ctx.fillRect(x, y, w, h);

    const bng = ctx.createLinearGradient(x, y, x + w, y + 128);
    bng.addColorStop(0, c1); bng.addColorStop(1, '#1e1b2e');
    ctx.fillStyle = bng; ctx.fillRect(x, y, w, 128);

    const tl = map['frame_' + key + '_tl'];
    const tr = map['frame_' + key + '_tr'];
    const br = map['frame_' + key + '_br'];
    if (tl) ctx.drawImage(tl, x, y, 224, 168);
    if (tr) ctx.drawImage(tr, x + w - 216, y, 216, 162);
    if (br) ctx.drawImage(br, x + w - 192, y + h - 144, 192, 144);
    ctx.restore();

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

    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#f8fafc'; ctx.font = '700 20px "Segoe UI"';
    ctx.fillText('Swag', x + 22, y + 218);
    ctx.fillStyle = '#94a3b8'; ctx.font = '500 13px "Segoe UI"';
    ctx.fillText('@swag • ' + label, x + 22, y + 238);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.beginPath(); ctx.roundRect(x + 20, y + 260, w - 40, 260, 10); ctx.fill();
    ctx.fillStyle = '#cbd5e1'; ctx.font = '500 13px "Segoe UI"';
    ctx.fillText('Wave 3 Flagship V5 Pintada', x + 34, y + 292);
    ctx.fillText('Personagens vivos + 4 atos.', x + 34, y + 314);
  });
  return c;
}

window.__RENDER_WAVE3 = () => {
  const map = {
    deco_dream_back: renderDreamBack(),
    deco_dream_front: renderDreamFront(false),
    deco_dream_blink: renderDreamFront(true),
    frame_dream_tl: renderFrameDreamTL(),
    frame_dream_tr: renderFrameDreamTR(),
    frame_dream_br: renderFrameDreamBR(),
    fx_dream_butterfly: renderFxDreamButterfly(false),
    fx_dream_wing_closed: renderFxDreamButterfly(true),

    deco_storm_back: renderStormBack(),
    deco_storm_front: renderStormFront(false),
    deco_storm_blink: renderStormFront(true),
    frame_storm_tl: renderFrameStormTL(),
    frame_storm_tr: renderFrameStormTR(),
    frame_storm_br: renderFrameStormBR(),
    fx_storm_bolt: renderFxStormBolt(),
    fx_storm_orb: renderFxStormOrb(),

    deco_arcade_back: renderArcadeBack(),
    deco_arcade_front: renderArcadeFront(false),
    deco_arcade_blink: renderArcadeFront(true),
    frame_arcade_tl: renderFrameArcadeTL(),
    frame_arcade_tr: renderFrameArcadeTR(),
    frame_arcade_br: renderFrameArcadeBR(),
    fx_arcade_heart: renderFxArcadeHeart(),
    fx_arcade_star: renderFxArcadeStar(),

    deco_jade_back: renderJadeBack(),
    deco_jade_front: renderJadeFront(),
    frame_jade_tl: renderFrameJadeTL(),
    frame_jade_tr: renderFrameJadeTR(),
    frame_jade_br: renderFrameJadeBR(),
    fx_jade_koi: renderFxJadeKoi(),
    fx_jade_lotus: renderFxJadeLotus(),

    deco_frost_blink: renderFrostBlink(),
    deco_infernal_blink: renderInfernalBlink(),
    frame_founder_tr: renderFrameFounderTR(),
    frame_founder_br: renderFrameFounderBR(),
    frame_dev_tr: renderFrameDevTR(),
    frame_dev_br: renderFrameDevBR(),
  };
  map.contact_sheet_wave3 = renderContactSheet(map);
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
  const dbgPort = 19780 + Math.floor(Math.random() * 200);
  const userDir = path.join(process.env.TEMP, 'sanvo-v5-wave3-' + Date.now());
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
    const chk = await call('Runtime.evaluate', { expression: 'typeof window.__RENDER_WAVE3', returnByValue: true });
    if (chk.result?.value === 'function') break;
    await new Promise(r => setTimeout(r, 100));
  }

  const evalRes = await call('Runtime.evaluate', {
    expression: 'window.__RENDER_WAVE3()',
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
print(f"WAVE 3 WEBP BUDGET: {total/1024:.1f} KB")
`;
  const pyOut = execFileSync('python', ['-c', pyScript], { encoding: 'utf8' });
  console.log(pyOut);
  process.exit(0);
});
