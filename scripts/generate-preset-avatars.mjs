import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const RAW_DIR = 'C:\\Users\\gabri\\.gemini\\antigravity\\brain\\639e93b4-dc25-4b1f-b1eb-a0819523d71b\\scratch\\preset_avatars_raw';
const ASSETS_DIR = 'D:\\Sancord\\static\\cosmetics\\assets';

fs.mkdirSync(RAW_DIR, { recursive: true });
fs.mkdirSync(ASSETS_DIR, { recursive: true });

// 12 Avatares Predefinidos Pintados (512x512 Supersampled -> 256x256 WebP)
const htmlContent = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body {
    margin: 0;
    padding: 0;
    background: #070a12;
    display: flex;
    flex-wrap: wrap;
    width: 2048px;
  }
  canvas {
    width: 512px;
    height: 512px;
    display: block;
  }
</style>
</head>
<body>
<script>
const ITEMS = [
  'preset_avatar_kitsune',
  'preset_avatar_astral',
  'preset_avatar_sakura',
  'preset_avatar_frost',
  'preset_avatar_infernal',
  'preset_avatar_arcane',
  'preset_avatar_abyssal',
  'preset_avatar_seraph',
  'preset_avatar_dream',
  'preset_avatar_storm',
  'preset_avatar_arcade',
  'preset_avatar_jade',
];

function fillBg(ctx, c1, c2, c3, glowCol) {
  const g = ctx.createLinearGradient(0, 0, 512, 512);
  g.addColorStop(0, c1);
  g.addColorStop(0.55, c2);
  g.addColorStop(1, c3);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 512);

  const rg = ctx.createRadialGradient(256, 230, 20, 256, 256, 260);
  rg.addColorStop(0, glowCol);
  rg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = rg;
  ctx.fillRect(0, 0, 512, 512);
}

function drawSparkle(ctx, x, y, r, col) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = col;
  ctx.shadowColor = col;
  ctx.shadowBlur = 12;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    const rad = i % 2 === 0 ? r : r * 0.28;
    const px = Math.cos(a) * rad;
    const py = Math.sin(a) * rad;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function renderAvatar(id, ctx) {
  ctx.save();
  if (id === 'preset_avatar_kitsune') {
    // 1. Kitsune Cyber (Synth-Neko com visor neon ciano/magenta)
    fillBg(ctx, '#090d1e', '#1e1b4b', '#3b0764', 'rgba(34,211,238,0.35)');
    // Cyber grid rings
    ctx.strokeStyle = 'rgba(34,211,238,0.22)';
    ctx.lineWidth = 3;
    for (const r of [180, 220]) {
      ctx.beginPath(); ctx.arc(256, 256, r, 0, Math.PI * 2); ctx.stroke();
    }
    // Ears
    for (const dir of [-1, 1]) {
      ctx.save();
      ctx.translate(256 + dir * 95, 155);
      ctx.rotate(dir * 0.22);
      const eg = ctx.createLinearGradient(0, -90, 0, 40);
      eg.addColorStop(0, '#ec4899');
      eg.addColorStop(1, '#1e1b4b');
      ctx.fillStyle = eg;
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(0, -85);
      ctx.lineTo(52, 45);
      ctx.lineTo(-52, 45);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      // Inner ear neon
      ctx.fillStyle = 'rgba(34,211,238,0.65)';
      ctx.beginPath();
      ctx.moveTo(0, -55);
      ctx.lineTo(28, 30);
      ctx.lineTo(-28, 30);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    // Head silhouette
    const hg = ctx.createRadialGradient(256, 240, 20, 256, 265, 145);
    hg.addColorStop(0, '#312e81');
    hg.addColorStop(1, '#0f172a');
    ctx.fillStyle = hg;
    ctx.strokeStyle = '#22d3ee';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(256, 135);
    ctx.bezierCurveTo(365, 135, 395, 235, 365, 315);
    ctx.bezierCurveTo(335, 375, 285, 398, 256, 402);
    ctx.bezierCurveTo(227, 398, 177, 375, 147, 315);
    ctx.bezierCurveTo(117, 235, 147, 135, 256, 135);
    ctx.fill(); ctx.stroke();
    // Holographic Visor
    const vg = ctx.createLinearGradient(150, 240, 362, 280);
    vg.addColorStop(0, '#06b6d4');
    vg.addColorStop(0.5, '#f472b6');
    vg.addColorStop(1, '#22d3ee');
    ctx.fillStyle = vg;
    ctx.shadowColor = '#22d3ee';
    ctx.shadowBlur = 18;
    ctx.beginPath();
    ctx.roundRect(156, 226, 200, 58, 28);
    ctx.fill();
    ctx.shadowBlur = 0;
    // Glowing cyber eyes inside visor
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    for (const dir of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(256 + dir * 32, 256);
      ctx.lineTo(256 + dir * 52, 242);
      ctx.lineTo(256 + dir * 72, 256);
      ctx.stroke();
    }
    // Cute cat mouth & whiskers
    ctx.strokeStyle = '#f472b6';
    ctx.lineWidth = 4.5;
    ctx.beginPath();
    ctx.moveTo(234, 326);
    ctx.quadraticCurveTo(245, 338, 256, 326);
    ctx.quadraticCurveTo(267, 338, 278, 326);
    ctx.stroke();
    drawSparkle(ctx, 110, 120, 16, '#22d3ee');
    drawSparkle(ctx, 405, 140, 14, '#f472b6');
  } else if (id === 'preset_avatar_astral') {
    // 2. Guardião Astral (Celestial Mage / Sun & Moon Astrolabe)
    fillBg(ctx, '#09071a', '#1e1b4b', '#311042', 'rgba(250,204,21,0.32)');
    // Golden astrolabe ring behind
    ctx.strokeStyle = 'rgba(251,191,36,0.55)';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(256, 256, 195, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([8, 10]);
    ctx.beginPath(); ctx.arc(256, 256, 172, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    // Hooded cloak
    const cg = ctx.createLinearGradient(256, 95, 256, 440);
    cg.addColorStop(0, '#4338ca');
    cg.addColorStop(0.6, '#1e1b4b');
    cg.addColorStop(1, '#0f172a');
    ctx.fillStyle = cg;
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(256, 92);
    ctx.bezierCurveTo(375, 110, 415, 250, 395, 425);
    ctx.lineTo(117, 425);
    ctx.bezierCurveTo(97, 250, 137, 110, 256, 92);
    ctx.fill(); ctx.stroke();
    // Cosmic shadow inside hood
    ctx.fillStyle = '#070510';
    ctx.beginPath();
    ctx.ellipse(256, 270, 98, 112, 0, 0, Math.PI * 2);
    ctx.fill();
    // Glowing golden star-eyes & forehead crescent
    ctx.fillStyle = '#fde047';
    ctx.shadowColor = '#fbbf24';
    ctx.shadowBlur = 16;
    for (const dir of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(256 + dir * 42, 265, 18, 10, dir * -0.15, 0, Math.PI * 2);
      ctx.fill();
    }
    // Forehead crescent moon
    ctx.beginPath();
    ctx.arc(256, 205, 20, 0.2, Math.PI - 0.2);
    ctx.arc(256, 198, 16, Math.PI - 0.2, 0.2, true);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    drawSparkle(ctx, 130, 145, 18, '#fde047');
    drawSparkle(ctx, 388, 160, 15, '#c084fc');
    drawSparkle(ctx, 256, 64, 20, '#fef08a');
  } else if (id === 'preset_avatar_sakura') {
    // 3. Espírito Hanami (White Kitsune Spirit & Cherry Blossoms)
    fillBg(ctx, '#2a0a1e', '#501233', '#831843', 'rgba(244,114,182,0.38)');
    // Ears
    for (const dir of [-1, 1]) {
      ctx.save();
      ctx.translate(256 + dir * 92, 150);
      ctx.rotate(dir * 0.25);
      ctx.fillStyle = '#fff1f2';
      ctx.strokeStyle = '#f472b6';
      ctx.lineWidth = 4.5;
      ctx.beginPath();
      ctx.moveTo(0, -88);
      ctx.quadraticCurveTo(55, -20, 48, 50);
      ctx.lineTo(-48, 50);
      ctx.quadraticCurveTo(-55, -20, 0, -88);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fb7185';
      ctx.beginPath();
      ctx.moveTo(0, -58);
      ctx.lineTo(25, 32);
      ctx.lineTo(-25, 32);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    // White Fox face
    const fg = ctx.createRadialGradient(256, 245, 20, 256, 270, 155);
    fg.addColorStop(0, '#ffffff');
    fg.addColorStop(1, '#ffe4e6');
    ctx.fillStyle = fg;
    ctx.strokeStyle = '#f472b6';
    ctx.lineWidth = 4.5;
    ctx.beginPath();
    ctx.moveTo(256, 135);
    ctx.bezierCurveTo(370, 140, 410, 255, 360, 325);
    ctx.lineTo(256, 405);
    ctx.lineTo(152, 325);
    ctx.bezierCurveTo(102, 255, 142, 140, 256, 135);
    ctx.fill(); ctx.stroke();
    // Red Kitsune markings
    ctx.strokeStyle = '#e11d48';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    for (const dir of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(256 + dir * 25, 220);
      ctx.quadraticCurveTo(256 + dir * 65, 190, 256 + dir * 105, 215);
      ctx.stroke();
      // Happy closed fox eyes
      ctx.strokeStyle = '#881337';
      ctx.beginPath();
      ctx.arc(256 + dir * 56, 265, 24, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();
      ctx.strokeStyle = '#e11d48';
    }
    // Nose
    ctx.fillStyle = '#e11d48';
    ctx.beginPath();
    ctx.arc(256, 342, 10, 0, Math.PI * 2);
    ctx.fill();
    // Sakura flower on ear
    ctx.save();
    ctx.translate(160, 148);
    for (let i = 0; i < 5; i++) {
      ctx.rotate((Math.PI * 2) / 5);
      ctx.fillStyle = '#fbcfe8';
      ctx.strokeStyle = '#f472b6';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.ellipse(0, -24, 13, 22, 0, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
    }
    ctx.fillStyle = '#fde047';
    ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  } else if (id === 'preset_avatar_frost') {
    // 4. Drakon Glacial (Ice Crystal Dragon)
    fillBg(ctx, '#061426', '#0c4a6e', '#0284c7', 'rgba(125,211,252,0.42)');
    // Crystal horns
    for (const dir of [-1, 1]) {
      ctx.save();
      ctx.translate(256 + dir * 88, 150);
      ctx.rotate(dir * 0.35);
      const hg = ctx.createLinearGradient(0, -110, 0, 40);
      hg.addColorStop(0, '#e0f2fe');
      hg.addColorStop(0.5, '#38bdf8');
      hg.addColorStop(1, '#0369a1');
      ctx.fillStyle = hg;
      ctx.strokeStyle = '#bae6fd';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(0, -110);
      ctx.lineTo(36, 30);
      ctx.lineTo(-30, 40);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.restore();
    }
    // Dragon head crest
    const dg = ctx.createLinearGradient(256, 120, 256, 410);
    dg.addColorStop(0, '#7dd3fc');
    dg.addColorStop(0.5, '#0284c7');
    dg.addColorStop(1, '#0c4a6e');
    ctx.fillStyle = dg;
    ctx.strokeStyle = '#e0f2fe';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(256, 112);
    ctx.lineTo(355, 190);
    ctx.lineTo(375, 295);
    ctx.lineTo(256, 412);
    ctx.lineTo(137, 295);
    ctx.lineTo(157, 190);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    // Center ice diamond
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(256, 155); ctx.lineTo(278, 195); ctx.lineTo(256, 235); ctx.lineTo(234, 195);
    ctx.closePath(); ctx.fill();
    // Glowing frost eyes
    ctx.fillStyle = '#e0f2fe';
    ctx.shadowColor = '#38bdf8';
    ctx.shadowBlur = 18;
    for (const dir of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(256 + dir * 32, 268);
      ctx.lineTo(256 + dir * 88, 250);
      ctx.lineTo(256 + dir * 72, 286);
      ctx.closePath();
      ctx.fill();
    }
    ctx.shadowBlur = 0;
    drawSparkle(ctx, 110, 130, 18, '#e0f2fe');
    drawSparkle(ctx, 400, 120, 15, '#7dd3fc');
  } else if (id === 'preset_avatar_infernal') {
    // 5. Fênix Dracônica (Infernal Magma Spirit)
    fillBg(ctx, '#1c0604', '#7c2d12', '#c2410c', 'rgba(251,146,60,0.45)');
    // Flame crown behind
    const fg = ctx.createLinearGradient(256, 55, 256, 390);
    fg.addColorStop(0, '#fef08a');
    fg.addColorStop(0.45, '#f97316');
    fg.addColorStop(1, '#991b1b');
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.moveTo(256, 55);
    ctx.quadraticCurveTo(320, 130, 345, 95);
    ctx.quadraticCurveTo(430, 210, 375, 360);
    ctx.lineTo(137, 360);
    ctx.quadraticCurveTo(82, 210, 167, 95);
    ctx.quadraticCurveTo(192, 130, 256, 55);
    ctx.fill();
    // Dark obsidian helm/face
    ctx.fillStyle = '#18181b';
    ctx.strokeStyle = '#fb923c';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(256, 135);
    ctx.lineTo(360, 215);
    ctx.lineTo(335, 375);
    ctx.lineTo(256, 415);
    ctx.lineTo(177, 375);
    ctx.lineTo(152, 215);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    // Molten core eyes
    ctx.fillStyle = '#fef08a';
    ctx.shadowColor = '#f97316';
    ctx.shadowBlur = 20;
    for (const dir of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(256 + dir * 28, 275);
      ctx.lineTo(256 + dir * 92, 252);
      ctx.lineTo(256 + dir * 74, 292);
      ctx.closePath();
      ctx.fill();
    }
    ctx.shadowBlur = 0;
    drawSparkle(ctx, 256, 185, 22, '#fef08a');
  } else if (id === 'preset_avatar_arcane') {
    // 6. Mago do Eclipse (Arcane Grimoire Owl/Oracle)
    fillBg(ctx, '#110622', '#3b0764', '#581c87', 'rgba(192,132,252,0.42)');
    // Arcane runic halo
    ctx.strokeStyle = '#e879f9';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(256, 256, 188, 0, Math.PI * 2); ctx.stroke();
    // Mystic Owl / Oracle silhouette
    const og = ctx.createRadialGradient(256, 250, 20, 256, 280, 155);
    og.addColorStop(0, '#6b21a8');
    og.addColorStop(1, '#1e1b4b');
    ctx.fillStyle = og;
    ctx.strokeStyle = '#f0abfc';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(256, 275, 135, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    // Feather crest tufts
    for (const dir of [-1, 1]) {
      ctx.fillStyle = '#c084fc';
      ctx.beginPath();
      ctx.moveTo(256 + dir * 40, 175);
      ctx.lineTo(256 + dir * 135, 105);
      ctx.lineTo(256 + dir * 105, 205);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
    }
    // Large glowing arcane eyes
    for (const dir of [-1, 1]) {
      ctx.fillStyle = '#090514';
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 4.5;
      ctx.beginPath(); ctx.arc(256 + dir * 56, 265, 42, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#e879f9';
      ctx.shadowColor = '#e879f9';
      ctx.shadowBlur = 14;
      ctx.beginPath(); ctx.arc(256 + dir * 56, 265, 22, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(256 + dir * 48, 256, 8, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    }
    // Golden beak / rune gem
    ctx.fillStyle = '#fbbf24';
    ctx.beginPath();
    ctx.moveTo(256, 295); ctx.lineTo(274, 325); ctx.lineTo(256, 355); ctx.lineTo(238, 325);
    ctx.closePath(); ctx.fill();
    drawSparkle(ctx, 256, 135, 20, '#fde047');
  } else if (id === 'preset_avatar_abyssal') {
    // 7. Guardião Abissal (Bioluminescent Sea Spirit / Axolotl-Leviathan)
    fillBg(ctx, '#021019', '#063445', '#0f766e', 'rgba(45,212,191,0.4)');
    // Bioluminescent gills/fins
    for (const dir of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        ctx.save();
        ctx.translate(256 + dir * 115, 210 + i * 38);
        ctx.rotate(dir * (-0.3 + i * 0.25));
        const fg = ctx.createLinearGradient(0, 0, dir * 85, 0);
        fg.addColorStop(0, '#0d9488');
        fg.addColorStop(1, '#5eead4');
        ctx.fillStyle = fg;
        ctx.strokeStyle = '#99f6e4';
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.ellipse(dir * 38, 0, 44, 16, 0, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
        ctx.restore();
      }
    }
    // Head
    const ag = ctx.createRadialGradient(256, 250, 20, 256, 270, 140);
    ag.addColorStop(0, '#2dd4bf');
    ag.addColorStop(0.7, '#0f766e');
    ag.addColorStop(1, '#115e59');
    ctx.fillStyle = ag;
    ctx.strokeStyle = '#a7f3d0';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.ellipse(256, 270, 128, 112, 0, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    // Pearl crown gem
    ctx.fillStyle = '#fef08a';
    ctx.shadowColor = '#2dd4bf';
    ctx.shadowBlur = 15;
    ctx.beginPath(); ctx.arc(256, 195, 16, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    // Cute deep-sea eyes
    for (const dir of [-1, 1]) {
      ctx.fillStyle = '#042f2e';
      ctx.beginPath(); ctx.arc(256 + dir * 56, 265, 24, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#5eead4';
      ctx.beginPath(); ctx.arc(256 + dir * 50, 258, 9, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(256 + dir * 60, 272, 4, 0, Math.PI * 2); ctx.fill();
    }
    // Smile
    ctx.strokeStyle = '#042f2e';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(256, 295, 22, 0.2, Math.PI - 0.2);
    ctx.stroke();
  } else if (id === 'preset_avatar_seraph') {
    // 8. Valquíria Celestial (Seraphim Winged Golden Helm)
    fillBg(ctx, '#1c1204', '#451a03', '#78350f', 'rgba(253,224,71,0.45)');
    // Radiant halo behind
    ctx.strokeStyle = '#fef08a';
    ctx.lineWidth = 6;
    ctx.shadowColor = '#fbbf24';
    ctx.shadowBlur = 20;
    ctx.beginPath(); ctx.arc(256, 240, 175, 0, Math.PI * 2); ctx.stroke();
    ctx.shadowBlur = 0;
    // Angelic wings on sides
    for (const dir of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        ctx.save();
        ctx.translate(256 + dir * 105, 240 + i * 28);
        ctx.rotate(dir * (-0.35 + i * 0.18));
        ctx.fillStyle = '#fffbeb';
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.ellipse(dir * 52, 0, 62 - i * 8, 20, 0, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
        ctx.restore();
      }
    }
    // Golden Valkyrie Helm
    const sg = ctx.createLinearGradient(256, 110, 256, 400);
    sg.addColorStop(0, '#fef9c3');
    sg.addColorStop(0.5, '#f59e0b');
    sg.addColorStop(1, '#b45309');
    ctx.fillStyle = sg;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(256, 105);
    ctx.bezierCurveTo(355, 125, 365, 260, 340, 385);
    ctx.lineTo(256, 415);
    ctx.lineTo(172, 385);
    ctx.bezierCurveTo(147, 260, 157, 125, 256, 105);
    ctx.fill(); ctx.stroke();
    // Visor slit (glowing white-gold light)
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#fde047';
    ctx.shadowBlur = 18;
    ctx.beginPath();
    ctx.moveTo(185, 250);
    ctx.lineTo(256, 272);
    ctx.lineTo(327, 250);
    ctx.lineTo(315, 282);
    ctx.lineTo(256, 304);
    ctx.lineTo(197, 282);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
  } else if (id === 'preset_avatar_dream') {
    // 9. Fada Onírica (Glowing Morpho Butterfly & Moon Spirit)
    fillBg(ctx, '#0f0728', '#2e1065', '#1e3a8a', 'rgba(167,139,250,0.45)');
    // Giant glowing Morpho Butterfly
    for (const dir of [-1, 1]) {
      ctx.save();
      ctx.translate(256, 256);
      ctx.scale(dir, 1);
      // Upper wing
      const wg = ctx.createLinearGradient(0, -140, 175, 40);
      wg.addColorStop(0, '#c084fc');
      wg.addColorStop(0.5, '#38bdf8');
      wg.addColorStop(1, '#818cf8');
      ctx.fillStyle = wg;
      ctx.strokeStyle = '#f8fafc';
      ctx.lineWidth = 5;
      ctx.shadowColor = '#38bdf8';
      ctx.shadowBlur = 18;
      ctx.beginPath();
      ctx.moveTo(8, -20);
      ctx.bezierCurveTo(55, -165, 215, -145, 195, -20);
      ctx.bezierCurveTo(180, 40, 75, 35, 8, 10);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      // Lower wing
      ctx.beginPath();
      ctx.moveTo(8, 12);
      ctx.bezierCurveTo(95, 25, 170, 115, 115, 155);
      ctx.bezierCurveTo(65, 180, 20, 110, 8, 45);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.shadowBlur = 0;
      // Wing shimmer dots
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(135, -65, 9, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(105, 105, 7, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    // Butterfly body
    ctx.fillStyle = '#fef08a';
    ctx.beginPath();
    ctx.roundRect(246, 175, 20, 155, 10);
    ctx.fill();
    drawSparkle(ctx, 256, 105, 22, '#fef08a');
    drawSparkle(ctx, 110, 370, 15, '#a78bfa');
    drawSparkle(ctx, 400, 360, 15, '#38bdf8');
  } else if (id === 'preset_avatar_storm') {
    // 10. Lobo Raijin (Thunder Wolf Spirit)
    fillBg(ctx, '#070b19', '#1e3a8a', '#0284c7', 'rgba(250,204,21,0.4)');
    // Wolf ears
    for (const dir of [-1, 1]) {
      ctx.save();
      ctx.translate(256 + dir * 92, 145);
      ctx.rotate(dir * 0.18);
      ctx.fillStyle = '#0f172a';
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(0, -95); ctx.lineTo(48, 55); ctx.lineTo(-48, 55); ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#facc15';
      ctx.beginPath();
      ctx.moveTo(0, -58); ctx.lineTo(24, 38); ctx.lineTo(-24, 38); ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    // Wolf head
    const wg = ctx.createLinearGradient(256, 130, 256, 415);
    wg.addColorStop(0, '#1e293b');
    wg.addColorStop(1, '#090d16');
    ctx.fillStyle = wg;
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(256, 130);
    ctx.lineTo(368, 205);
    ctx.lineTo(385, 285);
    ctx.lineTo(256, 415);
    ctx.lineTo(127, 285);
    ctx.lineTo(144, 205);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    // Lightning bolt crest on forehead
    ctx.fillStyle = '#fde047';
    ctx.shadowColor = '#facc15';
    ctx.shadowBlur = 16;
    ctx.beginPath();
    ctx.moveTo(268, 152);
    ctx.lineTo(234, 205);
    ctx.lineTo(260, 205);
    ctx.lineTo(242, 252);
    ctx.lineTo(284, 194);
    ctx.lineTo(258, 194);
    ctx.closePath();
    ctx.fill();
    // Electric cyan eyes
    ctx.fillStyle = '#38bdf8';
    ctx.shadowColor = '#38bdf8';
    for (const dir of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(256 + dir * 34, 275);
      ctx.lineTo(256 + dir * 95, 254);
      ctx.lineTo(256 + dir * 75, 290);
      ctx.closePath();
      ctx.fill();
    }
    ctx.shadowBlur = 0;
  } else if (id === 'preset_avatar_arcade') {
    // 11. Pixel-Bot 16-Bit (Retro CRT Companion)
    fillBg(ctx, '#240738', '#701a75', '#db2777', 'rgba(34,211,238,0.42)');
    // Antenna
    ctx.strokeStyle = '#22d3ee';
    ctx.lineWidth = 8;
    ctx.beginPath(); ctx.moveTo(256, 130); ctx.lineTo(256, 78); ctx.stroke();
    ctx.fillStyle = '#facc15';
    ctx.shadowColor = '#facc15';
    ctx.shadowBlur = 16;
    ctx.beginPath(); ctx.arc(256, 72, 18, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    // CRT Casing
    const bg = ctx.createLinearGradient(116, 130, 396, 390);
    bg.addColorStop(0, '#38bdf8');
    bg.addColorStop(1, '#6366f1');
    ctx.fillStyle = bg;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.roundRect(116, 130, 280, 245, 42);
    ctx.fill(); ctx.stroke();
    // Dark CRT Screen
    ctx.fillStyle = '#090d1e';
    ctx.strokeStyle = '#ec4899';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.roundRect(142, 156, 228, 193, 28);
    ctx.fill(); ctx.stroke();
    // Glowing 16-bit eyes & happy smile
    ctx.fillStyle = '#22d3ee';
    ctx.shadowColor = '#22d3ee';
    ctx.shadowBlur = 14;
    ctx.fillRect(178, 206, 36, 44);
    ctx.fillRect(298, 206, 36, 44);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(184, 212, 14, 14);
    ctx.fillRect(304, 212, 14, 14);
    // Pixel blush cheeks
    ctx.fillStyle = '#f472b6';
    ctx.fillRect(164, 262, 26, 14);
    ctx.fillRect(322, 262, 26, 14);
    // Pixel smile
    ctx.fillStyle = '#4ade80';
    ctx.fillRect(222, 278, 68, 14);
    ctx.fillRect(208, 264, 14, 14);
    ctx.fillRect(290, 264, 14, 14);
    ctx.shadowBlur = 0;
  } else if (id === 'preset_avatar_jade') {
    // 12. Carpa Imperial (Jade & Gold Yin-Yang Koi)
    fillBg(ctx, '#022c22', '#065f46', '#0f766e', 'rgba(251,191,36,0.38)');
    // Water ripple rings
    ctx.strokeStyle = 'rgba(110,231,183,0.3)';
    ctx.lineWidth = 3.5;
    for (const r of [145, 195]) {
      ctx.beginPath(); ctx.arc(256, 256, r, 0, Math.PI * 2); ctx.stroke();
    }
    // Lotus flower in center
    ctx.save();
    ctx.translate(256, 256);
    for (let i = 0; i < 8; i++) {
      ctx.rotate(Math.PI / 4);
      const lg = ctx.createLinearGradient(0, -20, 0, -145);
      lg.addColorStop(0, '#fef3c7');
      lg.addColorStop(0.5, '#f472b6');
      lg.addColorStop(1, '#fb7185');
      ctx.fillStyle = lg;
      ctx.strokeStyle = '#fde68a';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(38, -75, 0, -148);
      ctx.quadraticCurveTo(-38, -75, 0, 0);
      ctx.fill(); ctx.stroke();
    }
    for (let i = 0; i < 8; i++) {
      ctx.rotate(Math.PI / 4 + 0.39);
      ctx.fillStyle = '#fbcfe8';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(26, -55, 0, -105);
      ctx.quadraticCurveTo(-26, -55, 0, 0);
      ctx.fill();
    }
    // Golden lotus heart
    ctx.fillStyle = '#fbbf24';
    ctx.shadowColor = '#fbbf24';
    ctx.shadowBlur = 16;
    ctx.beginPath(); ctx.arc(0, 0, 32, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.restore();
    drawSparkle(ctx, 125, 125, 16, '#fef08a');
    drawSparkle(ctx, 385, 385, 16, '#6ee7b7');
  }
  ctx.restore();
}

window.addEventListener('DOMContentLoaded', () => {
  for (const id of ITEMS) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    canvas.id = id;
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    renderAvatar(id, ctx);
  }
});
</script>
</body>
</html>`;

const htmlPath = path.join(RAW_DIR, 'preset_avatars_sheet.html');
const pngPath = path.join(RAW_DIR, 'preset_avatars_sheet.png');
fs.writeFileSync(htmlPath, htmlContent, 'utf-8');

const edge = spawn(EDGE_PATH, [
  '--headless=new',
  '--disable-gpu',
  '--force-device-scale-factor=1',
  '--window-size=2048,1536',
  '--virtual-time-budget=1000',
  `--screenshot=${pngPath}`,
  `file:///${htmlPath.replace(/\\/g, '/')}`,
], { stdio: 'inherit' });

edge.on('exit', (code) => {
  if (code !== 0) process.exit(code || 1);
  const pyScript = `
from PIL import Image
import os

sheet = Image.open(r'${pngPath}').convert('RGBA')
items = [
  'preset_avatar_kitsune',
  'preset_avatar_astral',
  'preset_avatar_sakura',
  'preset_avatar_frost',
  'preset_avatar_infernal',
  'preset_avatar_arcane',
  'preset_avatar_abyssal',
  'preset_avatar_seraph',
  'preset_avatar_dream',
  'preset_avatar_storm',
  'preset_avatar_arcade',
  'preset_avatar_jade',
]
assets_dir = r'${ASSETS_DIR}'
total_kb = 0
for idx, name in enumerate(items):
    col = idx % 4
    row = idx // 4
    x0, y0 = col * 512, row * 512
    tile = sheet.crop((x0, y0, x0 + 512, y0 + 512)).resize((256, 256), Image.Resampling.LANCZOS)
    out_path = os.path.join(assets_dir, f'{name}.webp')
    tile.save(out_path, 'WEBP', quality=92, method=6)
    kb = os.path.getsize(out_path) / 1024
    total_kb += kb
    print(f'Saved {name}.webp ({kb:.1f} KB)')
print(f'Total 12 Preset Avatars size: {total_kb:.1f} KB')
`;
  const pyPath = path.join(RAW_DIR, 'slice_presets.py');
  fs.writeFileSync(pyPath, pyScript, 'utf-8');
  const py = spawn('python', [pyPath], { stdio: 'inherit' });
  py.on('exit', (pCode) => process.exit(pCode || 0));
});
