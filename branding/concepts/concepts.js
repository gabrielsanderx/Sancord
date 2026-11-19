// Conceitos do ícone Sancord, em grade 100x100.
const BG = `<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#302A7A"/><stop offset="1" stop-color="#171338"/></linearGradient>
  <linearGradient id="mk" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#D6CCFF"/></linearGradient>`;
const TILE = inner => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <defs>${BG}</defs>
  <rect x="2" y="2" width="96" height="96" rx="24" fill="url(#bg)"/>
  <rect x="2.75" y="2.75" width="94.5" height="94.5" rx="23.25" fill="none" stroke="#FFFFFF" stroke-opacity=".12" stroke-width="1.5"/>
  ${inner}
</svg>`;

const S_PATH = 'M60.34 27.82 A13.5 13.5 0 1 0 50 50 A13.5 13.5 0 1 1 39.66 72.18';
const BUBBLE = 'M30 24 H70 A12 12 0 0 1 82 36 V58 A12 12 0 0 1 70 70 H44 L30 80 V70 A12 12 0 0 1 18 58 V36 A12 12 0 0 1 30 24 Z';

window.CONCEPTS = {
  '1a · S monograma': TILE(`<path d="${S_PATH}" fill="none" stroke="url(#mk)" stroke-width="13" stroke-linecap="round"/>`),
  '1b · S de conexão (nós)': TILE(`
    <path d="${S_PATH}" fill="none" stroke="url(#mk)" stroke-width="11" stroke-linecap="round"/>
    <circle cx="60.34" cy="27.82" r="8.5" fill="#9B82FF"/><circle cx="39.66" cy="72.18" r="8.5" fill="#9B82FF"/>`),
  '2a · Balão + barras de voz': TILE(`
    <path d="${BUBBLE}" fill="url(#mk)"/>
    <rect x="34" y="40" width="7" height="14" rx="3.5" fill="#5B3FE0"/>
    <rect x="46.5" y="33" width="7" height="28" rx="3.5" fill="#5B3FE0"/>
    <rect x="59" y="37" width="7" height="20" rx="3.5" fill="#5B3FE0"/>`),
  '2b · Balão + onda': TILE(`
    <path d="${BUBBLE}" fill="url(#mk)"/>
    <path d="M31 47 C37 34 44 34 50 47 S63 60 69 47" fill="none" stroke="#5B3FE0" stroke-width="7.5" stroke-linecap="round"/>`),
  '3a · Diálogo (dois balões em S)': TILE(`
    <path d="M24 46 A22 22 0 0 1 46 24 H52 V46 A6 6 0 0 1 46 52 H24 Z" fill="url(#mk)" transform="translate(-1,-1)"/>
    <path d="M76 54 A22 22 0 0 1 54 76 H48 V54 A6 6 0 0 1 54 48 H76 Z" fill="#9B82FF" transform="translate(1,1)"/>`),
  'R1 · Balão + S deitado (arcos 180°)': TILE(`
    <path d="M27 25 H73 A11 11 0 0 1 84 36 V60 A11 11 0 0 1 73 71 H41 L27 81 V71 A11 11 0 0 1 16 60 V36 A11 11 0 0 1 27 25 Z" fill="url(#mk)"/>
    <path d="M32 48 A9 9 0 0 1 50 48 A9 9 0 0 0 68 48" fill="none" stroke="#4E35D6" stroke-width="8" stroke-linecap="round"/>`),
  'R2 · Balão + S deitado (arcos 230°)': TILE(`
    <path d="M27 25 H73 A11 11 0 0 1 84 36 V60 A11 11 0 0 1 73 71 H41 L27 81 V71 A11 11 0 0 1 16 60 V36 A11 11 0 0 1 27 25 Z" fill="url(#mk)"/>
    <path d="M35.1 54.5 A8 8 0 1 1 50 48 A8 8 0 1 0 64.9 41.5" fill="none" stroke="#4E35D6" stroke-width="7.5" stroke-linecap="round"/>`),
  'R3 · Balão squircle + onda': TILE(`
    <path d="M50 22 C74 22 82 30 82 46 C82 62 74 70 50 70 C46 70 42.5 69.8 39.5 69.3 L27 79 L28.6 66.2 C21 63 18 56.5 18 46 C18 30 26 22 50 22 Z" fill="url(#mk)"/>
    <path d="M32 46 A9 9 0 0 1 50 46 A9 9 0 0 0 68 46" fill="none" stroke="#4E35D6" stroke-width="8" stroke-linecap="round"/>`),
  'B1 · Dois balões em S (bicolor)': TILE(`
    <path id="tb" d="M34 21 H53 A13 13 0 0 1 53 47 H31 L19 57 V34 A13 13 0 0 1 32 21 Z" fill="url(#mk)"/>
    <path d="M34 21 H53 A13 13 0 0 1 53 47 H31 L19 57 V34 A13 13 0 0 1 32 21 Z" fill="#8F78FF" transform="rotate(180 50 50)"/>`),
  'B2 · Dois balões em S (contorno do de baixo)': TILE(`
    <path d="M34 21 H53 A13 13 0 0 1 53 47 H31 L19 57 V34 A13 13 0 0 1 32 21 Z" fill="url(#mk)"/>
    <path d="M34 21 H53 A13 13 0 0 1 53 47 H31 L19 57 V34 A13 13 0 0 1 32 21 Z" fill="#6E55F0" transform="rotate(180 50 50)"/>`),
  'B3 · Balões em S (caudas nas pontas)': TILE(`<g transform="translate(50 50) scale(.9) translate(-50 -50)">
    <path d="M46 52 H67 A13 13 0 0 1 67 78 H45 L31 86 L33 70 V65 A13 13 0 0 1 46 52 Z" fill="#8F78FF"/>
    <path d="M46 52 H67 A13 13 0 0 1 67 78 H45 L31 86 L33 70 V65 A13 13 0 0 1 46 52 Z" fill="url(#mk)" transform="rotate(180 50 50)"/></g>`),
  'B4 · Balões em S (caudas nas pontas, gap 8)': TILE(`<g transform="translate(50 50) scale(.92) translate(-50 -50)">
    <path d="M47 54 H68 A12 12 0 0 1 68 78 H46 L32 86 L34 71 V67 A13 13 0 0 1 47 54 Z" fill="#8F78FF"/>
    <path d="M47 54 H68 A12 12 0 0 1 68 78 H46 L32 86 L34 71 V67 A13 13 0 0 1 47 54 Z" fill="url(#mk)" transform="rotate(180 50 50)"/></g>`),
  'B5 · B1 espelhado': TILE(`<g transform="matrix(-1 0 0 1 100 0)">
    <path d="M34 21 H53 A13 13 0 0 1 53 47 H31 L19 57 V34 A13 13 0 0 1 32 21 Z" fill="url(#mk)"/>
    <path d="M34 21 H53 A13 13 0 0 1 53 47 H31 L19 57 V34 A13 13 0 0 1 32 21 Z" fill="#8F78FF" transform="rotate(180 50 50)"/></g>`),
  'B6 · Espelhado, cauda curta, gap 7': TILE(`<g transform="matrix(-1 0 0 1 100 0)">
    <path d="M33 20 H54 A13.5 13.5 0 0 1 54 47 H31 L20 55 V33 A13 13 0 0 1 33 20 Z" fill="url(#mk)"/>
    <path d="M33 20 H54 A13.5 13.5 0 0 1 54 47 H31 L20 55 V33 A13 13 0 0 1 33 20 Z" fill="#8F78FF" transform="rotate(180 50 50)"/></g>`),
  '3b · Elo (dois anéis abertos)': TILE(`
    <path d="M44 30 A17 17 0 1 0 44 70" fill="none" stroke="url(#mk)" stroke-width="12" stroke-linecap="round" transform="translate(-4,0)"/>
    <path d="M56 70 A17 17 0 1 0 56 30" fill="none" stroke="#9B82FF" stroke-width="12" stroke-linecap="round" transform="translate(4,0) rotate(180 56 50)"/>`),
};
