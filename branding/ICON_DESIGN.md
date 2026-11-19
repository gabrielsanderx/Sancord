# Ícone do Sancord — conceitos, escolha e mini design system

## O problema

O ícone antigo era uma ilustração (uma personagem com headset), guardada hoje em `legacy/logo.png`.
Ele funcionava como avatar, mas não como marca:

- abaixo de 48 px virava uma mancha;
- não dizia nada sobre o produto;
- o favicon antigo usava `#5865F2`, o azul-violeta do Discord.

## Os 3 conceitos

As versões ampliadas estão em `concepts/` e a folha de comparação em `concepts/comparativo.png`.
A folha mostra 128, 48, 32, 24 e 16 px, em fundo escuro e em fundo claro.

| # | Conceito | Ideia | Pontos fortes | Pontos fracos |
|---|----------|-------|---------------|---------------|
| 1 | **Monograma S** (`conceito-1-monograma.svg`) | Um S de traço grosso feito de dois arcos | O mais legível em 16 px | Genérico: um "S num quadrado" serve para qualquer marca e não fala de chat nem de voz |
| 2 | **Balão + onda de voz** (`conceito-2-balao-voz.svg`) | Balão de fala com uma onda, que é um S deitado | Comunica chat e voz de imediato | Balão com símbolo dentro é muito comum em apps de mensagem. Em 16 px a onda some e sobra um balão qualquer |
| 3 | **Diálogo** (`conceito-3-dialogo.svg`) | Dois balões em simetria rotacional, um respondendo ao outro | Original e forte em silhueta. As duas cores separam as formas mesmo em 16 px | Nessa orientação a silhueta lembra um "2" ou um "Z" |

### Comparação (1 = fraco, 5 = forte)

| Critério | 1 · Monograma | 2 · Balão + onda | 3 · Diálogo | **Final** |
|---|---|---|---|---|
| Legibilidade em 16–32 px | 5 | 3 | 4 | **4** |
| Originalidade | 2 | 2 | 4 | **5** |
| Força de marca | 3 | 2 | 4 | **5** |
| Profissionalismo | 4 | 3 | 4 | **5** |
| Reconhecimento | 3 | 2 | 4 | **5** |
| Adequação ao desktop (tile, barra de tarefas) | 4 | 3 | 4 | **5** |

## Escolha e refinamento: "Diálogo em S"

O ponto de partida foi o conceito 3. Os refinamentos foram estes:

1. **Espelhamento.** Os balões foram espelhados na horizontal. Assim o de cima arredonda à esquerda e o de baixo à direita, e as caudas viram as duas pontas de um **S**. Uma mesma forma lê como "duas pessoas conversando" e como a inicial da marca, sem usar texto.
2. **Vão constante.** Entre os balões fica um vão de 6 unidades, que vira 11 na versão pequena. Ele mantém as duas formas separadas na barra de tarefas.
3. **Cores com papéis.** O balão da frente é claro e o de trás é violeta. Isso dá profundidade sem precisar de detalhe.
4. **Versão pequena própria (16–32 px).** É a mesma geometria, com quatro ajustes:
   - sem sombra e sem filete;
   - cores chapadas;
   - símbolo 4% maior;
   - vão de 11 unidades.

O que o ícone evita:

- rosto, mascote, avatar ou texto;
- o azul `#5865F2` e qualquer forma de controle ou rosto parecida com a do Discord;
- detalhes finos.

## Mini design system

### Geometria (grade 100 × 100)

- **Tile:** 96 × 96 em (2, 2), com raio de canto 22 (cerca de 23% do lado). Tem um filete interno de 1,5 em branco a 12%, que dá acabamento em 48 px ou mais.
- **Balão da frente** (em cima, à direita):
  - corpo de x 34 a 81 e y 21 a 47 (47 × 26);
  - ponta esquerda em semicírculo de raio 13 (metade da altura);
  - canto superior direito com raio 13;
  - cauda no canto inferior direito, com base de 12 e altura de 10, até (81, 57).
- **Balão de trás:** é o balão da frente girado 180° em torno do centro (50, 50). A marca tem simetria de rotação, nunca de espelho.
- **Símbolo:** caixa de 62 × 58, cerca de 65% do tile. A margem óptica é de 17 a 19 unidades por lado.
- **Raios:**
  - 13 nos balões, que equivale à metade da altura do corpo;
  - 22 no tile;
  - pontas das caudas sempre vivas, sem arredondamento.
- **Traço:** a marca é só preenchimento, sem contorno. O único traço é o filete do tile, que a versão pequena dispensa.

### Cor

| Papel | Valor |
|---|---|
| Tile (degradê vertical) | `#312B7E` → `#15122F` |
| Balão da frente | `#FFFFFF` → `#DCD4FF` (diagonal, sutil) |
| Balão de trás | `#9C87FF` → `#7B5EFA` (diagonal, sutil) |
| Versão pequena (chapada) | tile `#2E2878` → `#1A163D`, frente `#FFFFFF`, trás `#9A85FF` |
| Símbolo em fundo claro | frente `#241F5E`, trás `#6A4FF0` |
| Monocromático | uma cor só (`currentColor`). O vão separa os balões |

Use degradê só como luz, nunca como efeito: os dois extremos ficam a no máximo um passo de tom de distância. Nada de neon, brilho ou contorno colorido.

### Sombra

Só há uma sombra, aplicada aos balões em tamanhos de 48 px ou mais: `dy 1,2`, desfoque `1,2`, cor `#0A0720` a 38%. Em 32 px ou menos não há sombra.

### Versões e uso

| Arquivo | Uso |
|---|---|
| `icon/sancord-icon.svg` | Mestre com tile (48 px ou mais, instalador, sobre, loja) |
| `icon/sancord-icon-small.svg` | 16–32 px (favicon, bandeja, barra de tarefas pequena) |
| `icon/sancord-icon-square.svg` | Quadrado sangrado para avatar e ícone de servidor (o app arredonda o recorte) |
| `icon/sancord-mark.svg` | Só o símbolo, sobre fundo escuro |
| `icon/sancord-mark-light.svg` | Só o símbolo, sobre fundo claro |
| `icon/sancord-mark-mono.svg` | Monocromático (`currentColor`) |
| `icon/png/sancord-{16…512}.png` | PNG em 16, 24, 32, 48, 64, 128, 256 e 512 (16 a 32 vêm da versão pequena) |
| `icon/png/sancord-mark*-512.png`, `sancord-square-512.png` | Símbolo e quadrado em PNG |
| `icon/sancord.ico` | ICO com 16, 24, 32, 48 e 64 em BMP 32 bits (com alfa) e 128 e 256 em PNG |
| `icon/sancord-64.rgba` | 64 × 64 RGBA cru, para o ícone da janela |

Área de respiro: em volta do símbolo sem tile, deixe pelo menos a altura de um balão dividida por 2 (13 unidades).

Proibido:

- girar ou espelhar a marca;
- trocar as cores dos dois balões entre si;
- juntar os balões (o vão é obrigatório);
- pôr texto ou contorno no tile.

## Onde está aplicado no app

| Destino | Origem |
|---|---|
| `icon.ico` (ícone do `.exe`, atalho e instalador, via `icon.rc`) | `icon/sancord.ico` |
| `icon_rgba.bin` (ícone da janela e da barra de tarefas no `SancordApp`) | `icon/sancord-64.rgba` |
| `static/sancord-icon.svg` (favicon) | `icon/sancord-icon-small.svg` |
| `static/logo.png` (marca no login, ícone do hub, avatar do sistema, tela Sobre) | `icon/png/sancord-square-512.png` |

Os arquivos antigos ficaram em `legacy/`.

## Como regenerar

1. Sirva a pasta `branding/` com um servidor local que aceite `POST /save?path=...` e grave dentro dela. É o que o `export.html` espera.
2. Abra `export.html` no navegador e rode `runExport()`. Ele rasteriza os SVGs e grava os PNGs, o ICO, o RGBA e a folha comparativa.
3. Copie para o projeto os arquivos listados acima.
