// ============================================================================
// Sancord — Chat: renderização de mensagens, formatação, composer, anexos,
// não lidas, saltos de histórico, fixadas e seletor de emojis.
// Usa o estado/elementos do app.js apenas em tempo de execução.
// ============================================================================

const HISTORY_WINDOW_CAP = 300; // mensagens mantidas em memória por canal
const GROUP_WINDOW_MS = 7 * 60 * 1000;
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const MAX_FILES_PER_MESSAGE = 10;

// ---------------------------------------------------------------------------
// Emojis (pt-BR): "emoji palavras-chave|..."
// ---------------------------------------------------------------------------
const EMOJI_SOURCE = [
  ["Rostos", "😀", "😀 sorriso feliz|😃 alegre feliz|😄 sorriso olhos|😁 sorrisão dentes|😆 risada|😅 suor nervoso riso|🤣 rolando rir|😂 chorando de rir lagrimas|🙂 sorriso leve|🙃 de cabeça para baixo ironia|😉 piscadela|😊 corado feliz|😇 anjo inocente|🥰 apaixonado coracoes|😍 olhos de coracao amor|🤩 estrelas uau|😘 beijo|😗 beijinho|😚 beijo olhos fechados|😋 delicia gostoso|😛 lingua|😜 lingua piscando|🤪 maluco doido|😝 lingua olhos fechados|🤑 dinheiro rico|🤗 abraco|🤭 ops mao na boca|🤫 silencio segredo|🤔 pensando hmm|🤐 boca fechada ziper|🤨 desconfiado sobrancelha|😐 neutro|😑 sem expressao|😶 sem boca mudo|😏 sorriso malicioso|😒 entediado|🙄 revirando olhos|😬 careta constrangido|😌 aliviado|😔 pensativo triste|😪 sono|🤤 babando|😴 dormindo|😷 mascara doente|🤒 febre|🤕 machucado|🤢 enjoado|🤮 vomitando|🥵 calor|🥶 frio congelando|🥴 tonto bebado|😵 atordoado|🤯 cabeca explodindo mente|🤠 cowboy|🥳 festa comemorando|😎 oculos escuros legal|🤓 nerd|🧐 monoculo analisando|😕 confuso|😟 preocupado|🙁 triste leve|😮 surpreso|😯 espantado|😲 chocado|😳 envergonhado corado|🥺 pidao fofo|😦 boquiaberto|😧 angustiado|😨 com medo|😰 ansioso suor|😥 decepcionado aliviado|😢 chorando lagrima|😭 chorando muito|😱 gritando medo|😖 confundido|😣 perseverante|😞 desapontado|😓 suando frio|😩 cansado|😫 exausto|🥱 bocejo|😤 bufando bravo|😡 bravo raiva|😠 irritado|🤬 xingando palavrao|😈 diabinho|👿 diabo bravo|💀 caveira morri|☠️ caveira ossos|💩 coco|🤡 palhaco|👻 fantasma|👽 alien|🤖 robo|😺 gato sorrindo|😹 gato rindo|😻 gato apaixonado|🙈 macaco nao vejo|🙉 macaco nao ouco|🙊 macaco nao falo"],
  ["Gestos", "👍", "👍 joinha positivo curtir|👎 negativo nao curti|👌 ok perfeito|🤌 italiano|✌️ paz vitoria|🤞 dedos cruzados sorte|🤟 te amo|🤘 rock|🤙 me liga hang loose|👈 esquerda|👉 direita|👆 cima|👇 baixo|☝️ atencao um|✋ mao parar|🤚 costas da mao|🖐️ mao aberta|🖖 vulcano spock|👋 tchau ola acenar|🤝 aperto de mao acordo|👏 palmas aplausos|🙌 celebrar maos|👐 maos abertas|🤲 palmas juntas|🙏 por favor obrigado reza|✍️ escrevendo|💪 forca musculo|🦾 braco robotico|🧠 cerebro|👀 olhos olhando|👁️ olho|👂 orelha|👃 nariz|👄 boca|💋 beijo marca"],
  ["Coração", "❤️", "❤️ coracao amor vermelho|🧡 coracao laranja|💛 coracao amarelo|💚 coracao verde|💙 coracao azul|💜 coracao roxo|🖤 coracao preto|🤍 coracao branco|🤎 coracao marrom|💔 coracao partido|❣️ exclamacao coracao|💕 dois coracoes|💞 coracoes girando|💓 coracao batendo|💗 coracao crescendo|💖 coracao brilhante|💘 flecha cupido|💝 presente coracao|💯 cem perfeito|💢 raiva simbolo|💥 explosao|💫 tonto estrela|💦 gotas suor|💨 vento rapido|💬 balao fala|💭 pensamento|💤 sono zzz"],
  ["Natureza", "🐶", "🐶 cachorro|🐱 gato|🐭 rato|🐹 hamster|🐰 coelho|🦊 raposa|🐻 urso|🐼 panda|🐨 coala|🐯 tigre|🦁 leao|🐮 vaca|🐷 porco|🐸 sapo|🐵 macaco|🐔 galinha|🐧 pinguim|🐦 passaro|🦆 pato|🦅 aguia|🦉 coruja|🦇 morcego|🐺 lobo|🐗 javali|🐴 cavalo|🦄 unicornio|🐝 abelha|🐛 lagarta|🦋 borboleta|🐌 lesma|🐞 joaninha|🐢 tartaruga|🐍 cobra|🦖 dinossauro|🐙 polvo|🦑 lula|🦀 caranguejo rust|🐠 peixe|🐬 golfinho|🐳 baleia|🦈 tubarao|🌵 cacto|🎄 arvore natal|🌲 pinheiro|🌳 arvore|🌴 palmeira|🌱 broto planta|🍀 trevo sorte|🍁 folha outono|🌷 tulipa|🌹 rosa|🌻 girassol|🌸 flor cerejeira|🌞 sol rosto|🌝 lua cheia|🌙 lua|⭐ estrela|🌟 estrela brilhante|✨ brilhos|⚡ raio energia|🔥 fogo|🌈 arco iris|☀️ sol|⛅ nublado|🌧️ chuva|⛈️ tempestade|❄️ neve floco|☃️ boneco de neve|🌊 onda mar|💧 gota agua"],
  ["Comida", "🍕", "🍏 maca verde|🍎 maca|🍐 pera|🍊 laranja|🍋 limao|🍌 banana|🍉 melancia|🍇 uva|🍓 morango|🍒 cereja|🍑 pessego|🥭 manga|🍍 abacaxi|🥥 coco|🥝 kiwi|🍅 tomate|🥑 abacate|🌽 milho|🌶️ pimenta|🥕 cenoura|🥔 batata|🍞 pao|🧀 queijo|🥚 ovo|🍳 fritando ovo|🥓 bacon|🍔 hamburguer|🍟 batata frita|🍕 pizza|🌭 cachorro quente|🌮 taco|🌯 burrito|🍝 macarrao|🍜 lamen|🍣 sushi|🍤 camarao|🍙 onigiri|🍚 arroz|🍰 bolo fatia|🎂 bolo aniversario|🧁 cupcake|🍩 rosquinha|🍪 biscoito cookie|🍫 chocolate|🍬 bala doce|🍭 pirulito|🍿 pipoca|☕ cafe|🍵 cha|🧃 suco|🥤 refrigerante|🍺 cerveja|🍻 brinde cervejas|🍷 vinho|🥂 brinde champanhe|🍹 drinque"],
  ["Atividades", "⚽", "⚽ futebol bola|🏀 basquete|🏈 futebol americano|⚾ beisebol|🎾 tenis|🏐 volei|🎱 sinuca|🏓 ping pong|🏸 badminton|🥊 boxe|🥋 artes marciais|⛳ golfe|🎣 pesca|🏆 trofeu campeao|🥇 medalha ouro primeiro|🥈 prata segundo|🥉 bronze terceiro|🏅 medalha|🎖️ medalha militar|🎮 videogame controle jogo|🕹️ joystick fliperama|🎲 dado|♟️ xadrez|🎯 alvo dardo|🎳 boliche|🎰 caca niquel|🧩 quebra cabeca|🎨 arte pintura|🎭 teatro|🎤 microfone cantar|🎧 fone de ouvido musica|🎼 partitura|🎹 teclado piano|🥁 bateria|🎷 saxofone|🎺 trompete|🎸 guitarra|🎻 violino|🎬 claquete filme|🎉 festa confete|🎊 confete|🎈 balao|🎁 presente|🎀 laco|🎃 abobora halloween|🎄 natal"],
  ["Viagem", "🚀", "🚗 carro|🚕 taxi|🚌 onibus|🏎️ carro corrida|🚓 policia|🚑 ambulancia|🚒 bombeiro|🚚 caminhao|🚲 bicicleta|🛵 moto scooter|🏍️ moto|✈️ aviao|🚁 helicoptero|🚀 foguete lancamento|🛸 disco voador|⛵ veleiro|🚢 navio|⚓ ancora|🗺️ mapa|🗿 moai|🗽 estatua liberdade|🏰 castelo|🏠 casa|🏢 predio|🏫 escola|🏥 hospital|⛪ igreja|🏝️ ilha|🏖️ praia|⛰️ montanha|🌋 vulcao|🏕️ acampamento|🌃 cidade noite|🌆 por do sol cidade|🌉 ponte"],
  ["Objetos", "💡", "⌚ relogio|📱 celular|💻 notebook|⌨️ teclado|🖥️ computador monitor|🖨️ impressora|🖱️ mouse|💾 disquete salvar|💿 cd|📷 camera|📸 foto flash|🎥 camera filme|📺 tv|📻 radio|🎙️ microfone estudio|⏰ despertador|⏳ ampulheta|🔋 bateria|🔌 tomada|💡 lampada ideia|🔦 lanterna|🕯️ vela|💸 dinheiro voando|💰 saco dinheiro|💳 cartao|💎 diamante|🔧 chave inglesa|🔨 martelo|⚙️ engrenagem|🔩 parafuso|🧲 ima|🔫 pistola agua|💣 bomba|🔪 faca|🛡️ escudo|🔮 bola de cristal|🧪 tubo ensaio|💊 remedio|🩹 curativo|🚪 porta|🛏️ cama|🛒 carrinho compras|🔑 chave|🗝️ chave antiga|🔒 cadeado fechado|🔓 cadeado aberto|📌 alfinete fixar|📎 clipe|✏️ lapis|🖊️ caneta|📝 anotacao|📁 pasta|📅 calendario|📈 grafico subindo|📉 grafico descendo|📊 grafico barras|📋 prancheta|📚 livros|📖 livro aberto|🔗 link corrente|📦 caixa pacote|✉️ envelope carta|📧 email|📢 megafone anuncio|🔔 sino notificacao|🔕 sino mudo|🏷️ etiqueta"],
  ["Símbolos", "✅", "✅ certo feito|☑️ caixa marcada|✔️ visto|❌ errado x|❎ x quadrado|➕ mais|➖ menos|➗ dividir|❓ pergunta|❔ pergunta branca|❗ exclamacao|‼️ dupla exclamacao|⚠️ aviso atencao|🚫 proibido|⛔ entrada proibida|🔞 maiores de 18|♻️ reciclar|🆗 ok|🆕 novo|🆒 cool|🆓 gratis|🆘 socorro sos|🔝 topo|🔜 em breve|🔴 circulo vermelho|🟠 laranja|🟡 amarelo|🟢 verde online|🔵 azul|🟣 roxo|⚫ preto|⚪ branco|🟥 quadrado vermelho|🟩 quadrado verde|🟦 quadrado azul|⬆️ seta cima|⬇️ seta baixo|⬅️ seta esquerda|➡️ seta direita|🔄 recarregar|🔁 repetir|▶️ play|⏸️ pausa|⏹️ parar|⏭️ proximo|🔊 volume alto|🔇 mudo|💤 dormir|🎵 nota musical|🎶 notas musicais|➰ laco|💲 cifrao|©️ copyright|®️ registrado|™️ marca|#️⃣ hashtag|*️⃣ asterisco|0️⃣ zero|1️⃣ um|2️⃣ dois|3️⃣ tres|🇧🇷 brasil bandeira|🏳️‍🌈 arco iris orgulho|🏴‍☠️ pirata"],
];

const EMOJI_CATEGORIES = EMOJI_SOURCE.map(([label, icon, raw]) => ({
  label,
  icon,
  emojis: raw.split("|").map((entry) => {
    const sp = entry.indexOf(" ");
    return { e: entry.slice(0, sp), k: entry.slice(sp + 1) };
  }),
}));
const ALL_EMOJIS = EMOJI_CATEGORIES.flatMap((c) => c.emojis);

function normalizeSearch(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function searchEmojis(query, limit = 40) {
  const q = normalizeSearch(query).trim();
  if (!q) return [];
  const starts = [];
  const contains = [];
  for (const em of ALL_EMOJIS) {
    const words = em.k.split(" ");
    if (words.some((w) => w.startsWith(q))) starts.push(em);
    else if (em.k.includes(q)) contains.push(em);
    if (starts.length >= limit) break;
  }
  return [...starts, ...contains].slice(0, limit);
}

function getRecentEmojis() {
  try {
    return JSON.parse(localStorage.getItem("sancord_recent_emojis") || "[]").slice(0, 24);
  } catch (_) {
    return [];
  }
}

function pushRecentEmoji(e) {
  try {
    const list = [e, ...getRecentEmojis().filter((x) => x !== e)].slice(0, 24);
    localStorage.setItem("sancord_recent_emojis", JSON.stringify(list));
  } catch (_) {}
}

// ---------------------------------------------------------------------------
// Utilitários
// ---------------------------------------------------------------------------
function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatBytes(n) {
  if (!Number.isFinite(n)) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1).replace(".", ",")} KB`;
  return `${(n / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function formatDayLabel(ts) {
  const d = new Date(ts);
  const today = new Date();
  const yest = new Date();
  yest.setDate(today.getDate() - 1);
  if (dayKey(ts) === dayKey(today.getTime())) return "Hoje";
  if (dayKey(ts) === dayKey(yest.getTime())) return "Ontem";
  return d.toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: "numeric" });
}

/** "Hoje às 14:50", "Ontem às 09:12" ou "12/11/2026 14:50". */
function formatMessageTime(msg) {
  const validStamp = /^\d{1,2}:\d{2}$/.test(msg.timestamp || "");
  const hhmm = validStamp
    ? msg.timestamp
    : msg.created_at
      ? new Date(msg.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
      : msg.timestamp || "";
  if (!msg.created_at) return hhmm;
  const label = formatDayLabel(msg.created_at);
  if (label === "Hoje" || label === "Ontem") return `${label} às ${hhmm}`;
  return `${new Date(msg.created_at).toLocaleDateString("pt-BR")} ${hhmm}`;
}

function myLower() {
  return state.selfUser?.username?.toLowerCase() || "";
}

function isOwnMessage(msg) {
  if (msg.author_kind && msg.author_kind !== "user") return false;
  return msg.author_id === state.selfUser?.id || (msg.author_name || "").toLowerCase() === myLower();
}

/** Tipo do autor: "user" | "system" | "bot" | "webhook" (mensagens antigas: author_id "system"). */
function authorKindOf(msg) {
  if (msg?.author_kind && msg.author_kind !== "user") return msg.author_kind;
  return msg?.author_id === "system" ? "system" : "user";
}

function serverForChannel(channelId) {
  if (!channelId || isPrivateTextId(channelId)) return null;
  const thread = state.threadIndex?.get(channelId);
  if (thread) return (state.servers || []).find((s) => s.id === thread.server_id) || null;
  return (state.servers || []).find((s) => (s.text_channels || []).some((c) => c.id === channelId)) || null;
}

/** A mensagem menciona o usuário atual? Usa as menções resolvidas pelo servidor. */
function messageMentionsMe(msg) {
  if (!msg || isOwnMessage(msg)) return false;
  const me = myLower();
  const m = msg.mentions;
  if (!m) {
    // Mensagens antigas (antes da Fase 3) não têm menções resolvidas.
    const lower = (msg.content || "").toLowerCase();
    return Boolean(me && lower.includes(`@${me}`)) || lower.includes("@everyone");
  }
  if (m.everyone || (m.users || []).includes(me)) return true;
  if (m.online && state.selfUser?.status_kind !== "invisible") return true;
  const srv = serverForChannel(msg.channel_id);
  const myRoles = srv?.member_roles?.[me] || [];
  return (m.roles || []).some((r) => myRoles.includes(r));
}

function findLiveUserByName(lower) {
  for (const u of state.users.values()) {
    if (u.username.toLowerCase() === lower) return u;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Formatação de mensagens (Markdown seguro)
// ---------------------------------------------------------------------------
/**
 * Suporta: **negrito**, *itálico* ou _itálico_, __sublinhado__, ~~riscado~~,
 * `código`, ```blocos```, > citação, listas (-, *, 1.), links, ||spoiler||,
 * menções (@usuário, @cargo, @everyone, @online) e #canais.
 * Tudo é escapado antes; o HTML gerado só contém as tags acima.
 */
function renderMarkdown(src, msg = null) {
  const slots = [];
  const ph = (html) => {
    slots.push(html);
    return `\u0000${slots.length - 1}\u0000`;
  };
  let text = String(src || "");

  text = text.replace(/```(?:([a-zA-Z0-9_+-]{1,20})\n)?([\s\S]*?)```/g, (_m, lang, code) =>
    ph(`<pre class="code-block"${lang ? ` data-lang="${escapeHtml(lang)}"` : ""}><button type="button" class="code-copy-btn" aria-label="Copiar código">Copiar</button><code>${escapeHtml(code.replace(/^\n+|\n+$/g, ""))}</code></pre>`)
  );
  text = text.replace(/`([^`\n]+)`/g, (_m, code) => ph(`<code class="inline-code">${escapeHtml(code)}</code>`));

  let html = escapeHtml(text);

  // Cartão de convite enviado pelo próprio Sancord: [[INVITE:CODIGO:NOME]]
  html = html.replace(/\[\[INVITE:([A-Za-z0-9_-]+):([^\]]+)\]\]/g, (_m, code, srvName) =>
    ph(`<div class="dm-server-invite-card"><div class="dm-server-invite-meta"><strong>🎟️ ${srvName}</strong><span>Código: <code>${code}</code></span></div><button type="button" class="btn-primary small-btn dm-join-invite-btn" data-join-invite="${code}">Entrar</button></div>`)
  );

  // Convites e referências abrem no aplicativo, sem uma página pública.
  html = html.replace(/sancord:\/\/open\/\?[^\s<\u0000]+/g, raw =>
    ph(`<a href="${raw}" class="chat-link">${raw}</a>`)
  );
  // Links externos (o texto já está escapado; só http/https viram link).
  html = html.replace(/\bhttps?:\/\/[^\s<\u0000]+/g, (raw) => {
    let url = raw;
    let tail = "";
    while (/[.,;:!?)\]]$/.test(url) || url.endsWith("&quot;") || url.endsWith("&#39;")) {
      if (url.endsWith("&quot;")) {
        tail = "&quot;" + tail;
        url = url.slice(0, -6);
      } else if (url.endsWith("&#39;")) {
        tail = "&#39;" + tail;
        url = url.slice(0, -5);
      } else {
        tail = url.slice(-1) + tail;
        url = url.slice(0, -1);
      }
    }
    return ph(`<a href="${url}" target="_blank" rel="noopener noreferrer" class="chat-link">${url}</a>`) + tail;
  });

  // Menções e canais viram "pílulas" (protegidas em slots).
  html = applyMentionPills(html, msg, ph);

  html = html.replace(/\|\|([^|\n]+?)\|\|/g, '<span class="spoiler" tabindex="0" role="button" aria-label="Spoiler: clique para revelar">$1</span>');
  html = html.replace(/\*\*([^*\n]+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/__([^_\n]+?)__/g, "<u>$1</u>");
  html = html.replace(/(^|[^*\w])\*([^*\n]+?)\*(?![*\w])/g, "$1<em>$2</em>");
  html = html.replace(/(^|[^_\w])_([^_\n]+?)_(?![_\w])/g, "$1<em>$2</em>");
  html = html.replace(/~~([^~\n]+?)~~/g, "<s>$1</s>");

  // Blocos por linha: citações e listas.
  const out = [];
  let block = null; // { type: "quote"|"ul"|"ol", items: [] }
  const flush = () => {
    if (!block) return;
    if (block.type === "quote") out.push(`<blockquote>${block.items.join("<br>")}</blockquote>`);
    else out.push(`<${block.type}>${block.items.map((i) => `<li>${i}</li>`).join("")}</${block.type}>`);
    block = null;
  };
  let pendingLines = [];
  const flushLines = () => {
    if (pendingLines.length) out.push(pendingLines.join("<br>"));
    pendingLines = [];
  };
  for (const line of html.split("\n")) {
    let m;
    let type = null;
    let content = line;
    if ((m = line.match(/^&gt; ?(.*)$/))) {
      type = "quote";
      content = m[1];
    } else if ((m = line.match(/^\s*[-*] (.+)$/))) {
      type = "ul";
      content = m[1];
    } else if ((m = line.match(/^\s*\d{1,3}[.)] (.+)$/))) {
      type = "ol";
      content = m[1];
    }
    if (type) {
      flushLines();
      if (!block || block.type !== type) {
        flush();
        block = { type, items: [] };
      }
      block.items.push(content);
    } else {
      flush();
      pendingLines.push(line);
    }
  }
  flush();
  flushLines();
  html = out.join("");

  return html.replace(/\u0000(\d+)\u0000/g, (_m, i) => slots[Number(i)] ?? "");
}

function applyMentionPills(html, msg, ph) {
  const srv = msg ? serverForChannel(msg.channel_id) : getActiveServer();
  const m = msg?.mentions;
  if (m) {
    const users = [...(m.users || [])].sort((a, b) => b.length - a.length);
    for (const lower of users) {
      const re = new RegExp(`@(${escapeRegExp(escapeHtml(lower))})(?![\\w-])`, "gi");
      html = html.replace(re, (_x, name) =>
        ph(`<span class="mention-pill ${lower === myLower() ? "mention-me" : ""}" role="button" tabindex="0" data-mention-user="${escapeHtml(lower)}">@${name}</span>`)
      );
    }
    if (m.everyone) html = html.replace(/@everyone\b/g, () => ph(`<span class="mention-pill mention-me">@everyone</span>`));
    if (m.online) html = html.replace(/@online\b/g, () => ph(`<span class="mention-pill mention-me">@online</span>`));
    for (const roleId of m.roles || []) {
      const role = (srv?.roles || []).find((r) => r.id === roleId);
      if (!role) continue;
      const re = new RegExp(`@(${escapeRegExp(escapeHtml(role.name))})(?![\\w-])`, "gi");
      const color = /^#[0-9a-f]{3,8}$/i.test(role.color) ? role.color : "#5865f2";
      html = html.replace(re, (_x, name) =>
        ph(`<span class="mention-pill mention-role" style="--role-color:${color}" data-mention-role="${escapeHtml(role.id)}">@${name}</span>`)
      );
    }
  } else if (msg) {
    // Mensagens anteriores à Fase 3 (sem menções resolvidas): só @everyone e o próprio nome.
    const me = myLower();
    html = html.replace(/(^|\s)@(everyone|[^\s@]+)/gi, (whole, pre, tag) =>
      tag.toLowerCase() === "everyone" || (me && tag.toLowerCase() === escapeHtml(me))
        ? `${pre}${ph(`<span class="mention-pill mention-me">@${tag}</span>`)}`
        : whole
    );
  }
  // #canal do mesmo servidor vira link clicável.
  const channels = srv?.text_channels || [];
  if (channels.length) {
    html = html.replace(/(^|[\s(])#([\p{L}\p{N}_-]{1,28})/gu, (whole, pre, name) => {
      const ch = channels.find((c) => c.name === name.toLowerCase());
      if (!ch) return whole;
      return `${pre}${ph(`<span class="mention-pill mention-channel" role="button" tabindex="0" data-channel-link="${escapeHtml(ch.id)}">#${escapeHtml(ch.name)}</span>`)}`;
    });
  }
  return html;
}

// ---------------------------------------------------------------------------
// Anexos na mensagem
// ---------------------------------------------------------------------------
function fileIconFor(att) {
  const name = (att.filename || "").toLowerCase();
  if (att.content_type === "application/pdf" || name.endsWith(".pdf")) return "📕";
  if (/\.(zip|rar|7z|gz|tar)$/.test(name) || /zip|rar|7z|gzip/.test(att.content_type)) return "🗜️";
  if (/\.(txt|md|log|csv|json)$/.test(name)) return "📝";
  if (/\.(docx?|odt)$/.test(name)) return "📄";
  if (/\.(xlsx?|ods)$/.test(name)) return "📊";
  if (/\.(exe|msi|apk)$/.test(name)) return "⚙️";
  return "📦";
}

function buildAttachmentsNode(msg) {
  const list = msg.attachments || [];
  if (!list.length && !msg.image_url) return null;
  const wrap = document.createElement("div");
  wrap.className = "message-attachments";
  const showMedia = state.audioSettings?.autoEmbeds !== false;
  if (msg.image_url) {
    // Formato antigo (imagem embutida como data URL).
    list.unshift({ id: "legacy", kind: "image", url: msg.image_url, filename: "imagem", size: 0 });
  }
  for (const att of list) {
    if (att.kind === "image" && showMedia) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "attachment-image";
      btn.setAttribute("aria-label", `Abrir imagem ${att.filename || ""}`);
      const img = document.createElement("img");
      img.loading = "lazy";
      img.decoding = "async";
      img.alt = att.filename || "Imagem";
      img.src = SancordNet.imageUrl(att.url);
      if (att.width && att.height) {
        // Reserva o espaço antes de carregar (sem "pulos" na rolagem).
        const scale = Math.min(1, 400 / att.width, 300 / att.height);
        img.style.width = `${Math.max(1, Math.round(att.width * scale))}px`;
        img.style.aspectRatio = `${att.width} / ${att.height}`;
      }
      if (!att.width || !att.height) {
        img.addEventListener("load", () => {
          // Não interfere em saltos/leituras antigas. Imagens com dimensões já
          // reservam espaço e não precisam mover a conversa quando carregam.
          if (msg.channel_id === getActiveTextChannelId() && !getHistoryState(msg.channel_id).hasNewer && isNearBottom(150)) {
            chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
          }
        }, { once: true });
      }
      btn.appendChild(img);
      btn.addEventListener("click", () => {
        lightboxImg.src = SancordNet.imageUrl(att.url);
        imageLightboxModal.classList.remove("hidden");
      });
      wrap.appendChild(btn);
    } else if (att.kind === "video" && showMedia) {
      const video = document.createElement("video");
      video.className = "attachment-video";
      video.controls = true;
      video.preload = "metadata";
      video.src = SancordNet.url(att.url);
      wrap.appendChild(video);
    } else {
      const card = document.createElement("div");
      card.className = `attachment-file kind-${att.kind}`;
      const icon = document.createElement("span");
      icon.className = "attachment-file-icon";
      icon.textContent = att.kind === "audio" ? "🎵" : att.kind === "image" ? "🖼️" : att.kind === "video" ? "🎞️" : fileIconFor(att);
      const meta = document.createElement("div");
      meta.className = "attachment-file-meta";
      const link = document.createElement("a");
      link.className = "attachment-file-name";
      link.href = SancordNet.url(att.url);
      link.download = att.filename || "arquivo";
      link.textContent = att.filename || "arquivo";
      const size = document.createElement("span");
      size.className = "attachment-file-size";
      size.textContent = formatBytes(att.size);
      meta.append(link, size);
      if (att.kind === "audio") {
        const audio = document.createElement("audio");
        audio.controls = true;
        audio.preload = "none";
        audio.src = SancordNet.url(att.url);
        meta.appendChild(audio);
      }
      const dl = document.createElement("a");
      dl.className = "attachment-download-btn";
      dl.href = SancordNet.url(att.url);
      dl.download = att.filename || "arquivo";
      dl.setAttribute("aria-label", `Baixar ${att.filename || "arquivo"}`);
      dl.innerHTML = SancordIcons.html("download");
      card.append(icon, meta, dl);
      wrap.appendChild(card);
    }
  }
  return wrap;
}

// ---------------------------------------------------------------------------
// Elemento de mensagem
// ---------------------------------------------------------------------------
function buildReactionsNode(msg) {
  const entries = Object.entries(msg.reactions || {}).filter(([, arr]) => Array.isArray(arr) && arr.length);
  if (!entries.length) return null;
  const row = document.createElement("div");
  row.className = "reactions-row";
  const me = state.selfUser?.username;
  for (const [emoji, users] of entries) {
    const btn = document.createElement("button");
    btn.disabled = !messagePermissions(msg).add_reactions;
    btn.type = "button";
    const reacted = Boolean(me && users.includes(me));
    btn.className = `reaction-pill ${reacted ? "reacted" : ""}`;
    btn.setAttribute("aria-pressed", String(reacted));
    const e = document.createElement("span");
    e.textContent = emoji;
    const c = document.createElement("span");
    c.className = "reaction-count";
    c.textContent = users.length;
    btn.append(e, c);
    const names = users.slice(0, 6).join(", ") + (users.length > 6 ? ` e mais ${users.length - 6}` : "");
    SancordUI.tooltip(btn, `${emoji} ${names}`, "top");
    btn.addEventListener("click", () => {
      pushRecentEmoji(emoji);
      sendWs("ToggleReaction", { channel_id: msg.channel_id, message_id: msg.id, emoji });
    });
    row.appendChild(btn);
  }
  const add = document.createElement("button");
  add.disabled = !messagePermissions(msg).add_reactions;
  add.type = "button";
  add.className = "reaction-pill reaction-add";
  add.innerHTML = SancordIcons.html("plus");
  SancordUI.tooltip(add, "Adicionar reação", "top");
  add.addEventListener("click", (e) => {
    e.stopPropagation();
    openEmojiPickerFor(msg, add);
  });
  row.appendChild(add);
  return row;
}

function captureMessageEdit() {
  const id = state.editingMsgId;
  const input = id && chatMessagesEl?.querySelector(`[data-msg-id="${CSS.escape(id)}"] .inline-edit-input`);
  if (!input) return null;
  return {
    id, value: input.value, start: input.selectionStart, end: input.selectionEnd,
    direction: input.selectionDirection, focused: document.activeElement === input,
  };
}

function restoreMessageEdit(draft) {
  if (!draft || state.editingMsgId !== draft.id) return;
  const input = chatMessagesEl?.querySelector(`[data-msg-id="${CSS.escape(draft.id)}"] .inline-edit-input`);
  if (!input) return;
  input.value = draft.value;
  autosizeTextarea(input);
  if (draft.focused) input.focus({ preventScroll: true });
  input.setSelectionRange(draft.start, draft.end, draft.direction);
}

/** Atualizações de reação/fixação não podem apagar uma edição ainda não salva. */
function updateChatMessageUI(msg) {
  const el = chatMessagesEl?.querySelector(`[data-msg-id="${CSS.escape(msg.id)}"]`);
  if (!el) return;
  const draft = captureMessageEdit();
  el.replaceWith(buildMessageElementV2(msg, { grouped: el.classList.contains("grouped") }));
  restoreMessageEdit(draft);
}

function startEditingMessage(msg) {
  if (!chatMessagesEl?.querySelector(`[data-msg-id="${CSS.escape(msg.id)}"]`)) return;
  const previousId = state.editingMsgId;
  state.editingMsgId = msg.id;
  if (previousId && previousId !== msg.id) {
    const previous = (state.chatHistory[msg.channel_id] || []).find(m => m.id === previousId);
    if (previous) updateChatMessageUI(previous);
  }
  updateChatMessageUI(msg);
  const input = chatMessagesEl.querySelector(`[data-msg-id="${CSS.escape(msg.id)}"] .inline-edit-input`);
  if (input) {
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    autosizeTextarea(input);
  }
}

function stopEditingMessage(msg) {
  state.editingMsgId = null;
  const latest = (state.chatHistory[msg.channel_id] || []).find(m => m.id === msg.id) || msg;
  updateChatMessageUI(latest);
  chatInput?.focus();
}

async function confirmDeleteMessage(msg, skipConfirm = false) {
  if (!skipConfirm) {
    const preview = (msg.content || "").slice(0, 120) || (msg.attachments?.length ? `${msg.attachments.length} anexo(s)` : "[Imagem]");
    const ok = await SancordUI.confirm({
      title: "Excluir mensagem?",
      message: `${msg.author_name}: "${preview}"${isOwnMessage(msg) ? "\n\nDica: segure Shift ao clicar para excluir sem confirmar." : ""}`,
      confirmLabel: "Excluir",
      danger: true,
    });
    if (!ok) return;
  }
  sendWs("DeleteChat", { channel_id: msg.channel_id, message_id: msg.id });
}

function buildMessageElementV2(msg, { grouped = false } = {}) {
  const div = document.createElement("div");
  const mine = isOwnMessage(msg);
  const authorLower = (msg.author_name || "").toLowerCase();

  if (!mine && state.blockedUsers.has(authorLower)) {
    div.className = "message-item blocked-msg-row";
    const t = document.createElement("div");
    t.className = "edited-tag";
    t.textContent = `🚫 Mensagem oculta de usuário bloqueado (${msg.author_name || "Usuário"})`;
    div.appendChild(t);
    div.dataset.msgId = msg.id;
    return div;
  }

  const isStarred = state.starredMsgIds.has(msg.id);
  const mentioned = messageMentionsMe(msg);
  div.className = [
    "message-item",
    grouped && "grouped",
    msg.pinned && "pinned-msg",
    isStarred && "starred-msg",
    mentioned && "mention-highlight",
    authorKindOf(msg) === "system" && "system-msg",
  ].filter(Boolean).join(" ");
  div.dataset.msgId = msg.id;
  div.dataset.author = authorLower;
  div.setAttribute("role", "article");
  div.setAttribute("aria-label", `${msg.author_name}, ${formatMessageTime(msg)}`);

  const liveUser = findLiveUserByName(authorLower) || state.users.get(msg.author_id);
  const avatarUrl = liveUser?.avatar_url || msg.author_avatar;
  const rawNameColor = typeof themedNameColor === "function" ? themedNameColor(liveUser?.name_color) : liveUser?.name_color;
  const nameColor = rawNameColor || (typeof themedNameColor === "function" ? themedNameColor(msg.author_color) : msg.author_color);
  const safeColor = /^#[0-9a-f]{3,8}$/i.test(nameColor || "") ? nameColor : "";
  const avatarColor = /^#[0-9a-f]{3,8}$/i.test(msg.author_color || "") ? msg.author_color : "#5865f2";
  const decoCls = getDecoClass(liveUser?.avatar_decoration);
  const nameCls = getNameStyleClass(liveUser?.name_style);
  const isEditing = state.editingMsgId === msg.id;

  const replyHtml = msg.reply_to
    ? `<div class="reply-context-line" role="button" tabindex="0" data-jump-msg="${escapeHtml(msg.reply_to.id)}" title="Ir para a mensagem original">
         <span class="reply-spine" aria-hidden="true"></span>
         <strong>@${escapeHtml(msg.reply_to.author_name)}</strong>
         <span class="reply-preview-text">${escapeHtml((msg.reply_to.preview || "").slice(0, 100))}</span>
       </div>`
    : "";

  const header = grouped
    ? `<span class="grouped-time" aria-hidden="true">${escapeHtml(msg.timestamp || "")}</span>`
    : `<div class="avatar-status-wrap ${decoCls}">
         <div class="avatar clickable-profile" style="background: ${avatarColor}">${renderAvatarInner(msg.author_name, avatarUrl)}</div>
         ${getDecoSvgHtml(liveUser?.avatar_decoration)}
       </div>`;

  const meta = grouped
    ? ""
    : `<div class="message-meta">
         <span class="message-author clickable-profile styled-name ${nameCls}" style="${liveUser?.name_style === "gradient" || !safeColor ? "" : `color:${safeColor};--name-color:${safeColor};`}">${escapeHtml(msg.author_name)}</span>
         ${authorKindOf(msg) !== "user" ? `<span class="bot-tag author-${authorKindOf(msg)}">${typeof t === "function" ? t(`author.${authorKindOf(msg)}`) : "SISTEMA"}</span>` : ""}
         <time class="message-time" ${msg.created_at ? `datetime="${new Date(msg.created_at).toISOString()}" title="${escapeHtml(new Date(msg.created_at).toLocaleString("pt-BR"))}"` : ""}>${escapeHtml(formatMessageTime(msg))}</time>
         ${msg.pinned ? `<span class="pin-tag">📌 Fixada</span>` : ""}
         ${isStarred ? `<span class="star-tag">★ Favorita</span>` : ""}
       </div>`;

  div.innerHTML = `
    <div class="message-actions-bar" role="toolbar" aria-label="Ações da mensagem">
      <button type="button" class="msg-act-btn" data-quick-react="👍" aria-label="Reagir com 👍">👍</button>
      <button type="button" class="msg-act-btn" data-quick-react="❤️" aria-label="Reagir com ❤️">❤️</button>
      <button type="button" class="msg-act-btn" data-quick-react="😂" aria-label="Reagir com 😂">😂</button>
      <button type="button" class="msg-act-btn" data-act="react" aria-label="Adicionar reação">${SancordIcons.html("smile")}</button>
      <button type="button" class="msg-act-btn" data-act="reply" aria-label="Responder">${SancordIcons.html("reply")}</button>
      ${mine && msg.content ? `<button type="button" class="msg-act-btn" data-act="edit" aria-label="Editar">${SancordIcons.html("edit")}</button>` : ""}
      <button type="button" class="msg-act-btn" data-act="more" aria-label="Mais opções">${SancordIcons.html("more")}</button>
    </div>
    ${header}
    <div class="message-content-wrap">
      ${replyHtml}
      ${meta}
      ${isEditing
        ? `<form class="inline-edit-form">
             <textarea class="inline-edit-input" rows="1" maxlength="2000">${escapeHtml(msg.content || "")}</textarea>
             <div class="inline-edit-hint">esc para <button type="button" class="link-btn" data-edit-cancel>cancelar</button> • enter para <button type="submit" class="link-btn">salvar</button></div>
           </form>`
        : msg.content
          ? `<div class="message-text">${renderMarkdown(msg.content, msg)}${msg.edited ? ` <span class="edited-tag" title="Esta mensagem foi editada">(editado)</span>` : ""}</div>`
          : ""}
    </div>
  `;

  const contentWrap = div.querySelector(".message-content-wrap");
  const permissions = messagePermissions(msg);
  div.querySelectorAll("[data-quick-react], [data-act=react]").forEach(btn => { btn.disabled = !permissions.add_reactions; });
  const editButton = div.querySelector("[data-act=edit]");
  if (editButton) editButton.disabled = !permissions.send_messages;
  const atts = buildAttachmentsNode({ ...msg, attachments: [...(msg.attachments || [])] });
  if (atts) contentWrap.appendChild(atts);
  // Enquete (Fase 8): static/js/community.js.
  const pollNode = msg.poll && typeof buildPollNode === "function" ? buildPollNode(msg) : null;
  if (pollNode) contentWrap.appendChild(pollNode);
  // Thread iniciada nesta mensagem (static/js/threads.js).
  const threadLink = typeof buildThreadLinkNode === "function" ? buildThreadLinkNode(msg) : null;
  if (threadLink) contentWrap.appendChild(threadLink);
  const reactions = buildReactionsNode(msg);
  if (reactions) contentWrap.appendChild(reactions);

  div.querySelectorAll(".clickable-profile").forEach((el) => {
    el.style.cursor = "pointer";
    el.addEventListener("click", () => openMemberProfilePopover(liveUser?.id || msg.author_id, msg));
  });
  div.querySelector(".reply-context-line")?.addEventListener("click", () => jumpToMessage(msg.channel_id, msg.reply_to.id));
  div.querySelectorAll(".dm-join-invite-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (btn.dataset.joinInvite) sendWs("JoinServerByInvite", { invite_code: btn.dataset.joinInvite });
    });
  });
  div.querySelectorAll("[data-quick-react]").forEach((btn) => {
    btn.addEventListener("click", () => {
      pushRecentEmoji(btn.dataset.quickReact);
      sendWs("ToggleReaction", { channel_id: msg.channel_id, message_id: msg.id, emoji: btn.dataset.quickReact });
    });
  });
  div.querySelector('[data-act="react"]')?.addEventListener("click", (e) => {
    e.stopPropagation();
    openEmojiPickerFor(msg, e.currentTarget);
  });
  div.querySelector('[data-act="reply"]')?.addEventListener("click", () => setReplyingTo(msg));
  div.querySelector('[data-act="edit"]')?.addEventListener("click", () => startEditingMessage(msg));
  div.querySelector('[data-act="more"]')?.addEventListener("click", (e) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    openMessageContextMenu({ clientX: r.left, clientY: r.bottom + 4, preventDefault() {} }, msg);
  });

  const editForm = div.querySelector(".inline-edit-form");
  if (editForm) {
    const input = editForm.querySelector(".inline-edit-input");
    input.addEventListener("input", () => autosizeTextarea(input));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        stopEditingMessage(msg);
      } else if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        editForm.requestSubmit();
      }
    });
    editForm.querySelector("[data-edit-cancel]")?.addEventListener("click", () => stopEditingMessage(msg));
    editForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const next = input.value.trim();
      if (!next) {
        // Apagar todo o texto equivale a pedir para excluir.
        stopEditingMessage(msg);
        confirmDeleteMessage(msg);
        return;
      }
      state.editingMsgId = null;
      if (next !== msg.content) sendWs("EditChat", { channel_id: msg.channel_id, message_id: msg.id, content: next });
      stopEditingMessage(msg);
    });
  }

  div.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    openMessageContextMenu(e, msg);
  });
  return div;
}

// Cliques em pílulas, spoilers e botões de copiar código (delegação no container).
chatMessagesEl?.addEventListener("click", (e) => {
  const spoiler = e.target.closest(".spoiler");
  if (spoiler) {
    spoiler.classList.add("revealed");
    return;
  }
  const copyBtn = e.target.closest(".code-copy-btn");
  if (copyBtn) {
    copyTextSafe(copyBtn.parentElement.querySelector("code")?.textContent || "", "Código copiado!");
    return;
  }
  const chLink = e.target.closest("[data-channel-link]");
  if (chLink) {
    const srv = serverForChannel(chLink.dataset.channelLink);
    if (srv) switchToServerId(srv.id, chLink.dataset.channelLink);
    return;
  }
  const userPill = e.target.closest("[data-mention-user]");
  if (userPill) {
    const live = findLiveUserByName(userPill.dataset.mentionUser);
    if (live) openMemberProfilePopover(live.id);
    else showUiToast(`${userPill.textContent} está offline.`);
  }
});
chatMessagesEl?.addEventListener("keydown", (e) => {
  if ((e.key === "Enter" || e.key === " ") && e.target.matches(".spoiler, .mention-pill, .reply-context-line")) {
    e.preventDefault();
    e.target.click();
  }
});

// ---------------------------------------------------------------------------
// Lista de mensagens: agrupamento, separadores de dia, divisor de não lidas
// ---------------------------------------------------------------------------
function shouldGroup(prev, msg) {
  if (!prev || msg.reply_to || authorKindOf(prev) !== "user" || authorKindOf(msg) !== "user") return false;
  if ((prev.author_name || "").toLowerCase() !== (msg.author_name || "").toLowerCase()) return false;
  if (!prev.created_at || !msg.created_at) return false;
  if (dayKey(prev.created_at) !== dayKey(msg.created_at)) return false;
  // Mensagens migradas das versões antigas têm created_at artificial (segundos de
  // diferença); o horário "HH:MM" original evita agrupar conversas distantes.
  const toMin = (t) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(t || "");
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  const a = toMin(prev.timestamp);
  const b = toMin(msg.timestamp);
  if (a !== null && b !== null && Math.abs(b - a) > GROUP_WINDOW_MS / 60000) return false;
  return msg.created_at - prev.created_at < GROUP_WINDOW_MS;
}

function buildDaySeparator(ts) {
  const sep = document.createElement("div");
  sep.className = "day-separator";
  sep.setAttribute("role", "separator");
  const span = document.createElement("span");
  span.textContent = formatDayLabel(ts);
  sep.appendChild(span);
  return sep;
}

function buildUnreadDivider() {
  const divider = document.createElement("div");
  divider.className = "unread-msg-divider";
  divider.setAttribute("role", "separator");
  divider.innerHTML = `<span>NOVAS MENSAGENS</span>`;
  return divider;
}

function isNearBottom(px = 120) {
  if (!chatMessagesEl) return true;
  return chatMessagesEl.scrollHeight - chatMessagesEl.scrollTop - chatMessagesEl.clientHeight < px;
}

function renderChatMessagesV2({ preserveScroll = false } = {}) {
  const draft = captureMessageEdit();
  const chId = getActiveTextChannelId();
  const list = state.chatHistory[chId] || [];
  const q = (state.searchQuery || "").trim().toLowerCase();
  const filtered = q
    ? list.filter((m) => (m.content || "").toLowerCase().includes(q) || (m.author_name || "").toLowerCase().includes(q))
    : list;
  const hs = getHistoryState(chId);
  const frag = document.createDocumentFragment();

  if (!q && !hs.loading && !hs.hasMore && !hs.hasNewer) {
    const start = document.createElement("div");
    start.className = "history-start-marker channel-welcome";
    const channel = (state.textChannels || []).find(c => c.id === chId) || state.threadIndex?.get(chId);
    const isPrivate = /^(dm:|gdm:)/.test(chId || "");
    const name = channel?.name || (isPrivate ? document.getElementById("current-text-channel-title")?.textContent : chId) || "conversa";
    start.innerHTML = `<div class="channel-welcome-icon">${SancordIcons.html(isPrivate ? "chat" : "hash")}</div><h3>${escapeHtml(isPrivate ? name : `# ${name}`)}</h3><p>${escapeHtml(isPrivate ? "Este é o início desta conversa." : `Bem-vindo ao início do canal #${name}.`)}</p>`;
    frag.appendChild(start);
  }
  const unreadMsgId = state.unreadDividerByChannel.get(chId);
  let prev = null;
  for (const msg of filtered) {
    if (msg.created_at && (!prev || !prev.created_at || dayKey(prev.created_at) !== dayKey(msg.created_at))) {
      frag.appendChild(buildDaySeparator(msg.created_at));
    }
    if (unreadMsgId && msg.id === unreadMsgId) frag.appendChild(buildUnreadDivider());
    const grouped = !q && shouldGroup(prev, msg) && msg.id !== unreadMsgId;
    frag.appendChild(buildMessageElementV2(msg, { grouped }));
    prev = msg;
  }
  if (q && filtered.length === 0) {
    const empty = document.createElement("div");
    empty.innerHTML = SancordUI.emptyHTML({icon:"search", title:"Nenhuma mensagem encontrada", description:"Tente outros termos ou use a busca no histórico."});
    frag.appendChild(empty);
  }
  chatMessagesEl.innerHTML = "";
  chatMessagesEl.appendChild(frag);
  restoreMessageEdit(draft);
  updatePinnedBadge();
  updateJumpPresentBar();
  if (preserveScroll) return;
  const scrollToEnd = () => {
    const divider = chatMessagesEl.querySelector(".unread-msg-divider");
    if (divider && state.scrollToDividerOnce === chId) {
      divider.scrollIntoView({ block: "center" });
    } else {
      chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
    }
  };
  scrollToEnd();
  requestAnimationFrame(() => {
    scrollToEnd();
    state.scrollToDividerOnce = null;
    maybeAckActiveChannel();
  });
}

function appendChatMessageUIV2(msg) {
  const q = (state.searchQuery || "").trim().toLowerCase();
  if (q && !(msg.content || "").toLowerCase().includes(q) && !(msg.author_name || "").toLowerCase().includes(q)) return;
  const list = state.chatHistory[msg.channel_id] || [];
  const idx = list.findIndex((m) => m.id === msg.id);
  const prev = idx > 0 ? list[idx - 1] : null;
  const wasNearBottom = isNearBottom(160);
  if (msg.created_at && (!prev || !prev.created_at || dayKey(prev.created_at) !== dayKey(msg.created_at))) {
    chatMessagesEl.appendChild(buildDaySeparator(msg.created_at));
  }
  const el = buildMessageElementV2(msg, { grouped: shouldGroup(prev, msg) });
  el.classList.add("message-enter");
  chatMessagesEl.appendChild(el);
  if (wasNearBottom || isOwnMessage(msg)) {
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
  } else {
    showNewBelowHint();
  }
}

/** Aplica o mesmo limite das páginas ao fluxo realtime, sem saltar a leitura atual. */
function cacheIncomingChatMessage(message) {
  const chId = message.channel_id;
  const list = state.chatHistory[chId] || (state.chatHistory[chId] = []);
  list.push(message);
  if (list.length <= HISTORY_WINDOW_CAP) return { stored: true, trimmed: false };
  const hs = getHistoryState(chId);
  const viewing = chId === getActiveTextChannelId() && !(state.activeView === "home" && !state.activeDmId);
  if (viewing && !isNearBottom(160) && !isOwnMessage(message)) {
    // Conserva a janela que a pessoa está lendo; o restante continua no banco.
    list.pop();
    hs.hasNewer = true;
    return { stored: false, trimmed: false };
  }
  list.splice(0, list.length - HISTORY_WINDOW_CAP);
  hs.hasMore = true;
  return { stored: true, trimmed: true };
}

// ---------------------------------------------------------------------------
// Histórico: páginas antigas/novas, janela "destacada" e salto para mensagem
// ---------------------------------------------------------------------------
function requestNewerMessages() {
  const chId = getActiveTextChannelId();
  const hs = getHistoryState(chId);
  if (!chId || hs.loading || !hs.hasNewer) return;
  const list = state.chatHistory[chId] || [];
  const last = list[list.length - 1];
  if (!last) return;
  if (sendWs("LoadMessages", { channel_id: chId, after_id: last.id, limit: 50 })) {
    hs.loading = true;
    chatMessagesEl.classList.add("is-loading-history");
  }
}

function jumpToPresent() {
  const chId = getActiveTextChannelId();
  const hs = getHistoryState(chId);
  if (!hs.hasNewer) {
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
    hideJumpBar();
    return;
  }
  if (sendWs("LoadMessages", { channel_id: chId, limit: 50 })) {
    hs.loading = true;
    state.pendingPresent = chId;
  }
}

function flashMessage(el) {
  // O salto precisa terminar antes dos eventos de scroll: a animação partindo
  // do fundo disparava LoadMessages(after_id), recriando o DOM e perdendo o alvo.
  el.scrollIntoView({ block: "center", behavior: "instant" });
  el.classList.remove("flash-highlight");
  void el.offsetWidth;
  el.classList.add("flash-highlight");
}

/** Abre o canal (se preciso) e rola até a mensagem, carregando do servidor se não estiver em memória. */
function jumpToMessage(channelId, messageId) {
  if (!channelId || !messageId) return;
  // Na tela inicial sem DM aberta, getActiveTextChannelId() ainda devolve o último
  // canal de servidor: confere também a visão para não "pular" sem sair da home.
  const viewing = isPrivateTextId(channelId)
    ? state.activeView === "home" && state.activeDmId === channelId
    : state.activeView !== "home" && getActiveTextChannelId() === channelId;
  if (!viewing) {
    if (isPrivateTextId(channelId)) {
      openDmConversation(channelId);
    } else {
      const srv = serverForChannel(channelId);
      if (!srv) {
        showUiToast("Você não tem acesso a este canal.");
        return;
      }
      switchToServerId(srv.id, channelId);
    }
  }
  const el = chatMessagesEl.querySelector(`[data-msg-id="${CSS.escape(messageId)}"]`);
  if (el) {
    flashMessage(el);
    return;
  }
  state.pendingJump = { channelId, messageId };
  getHistoryState(channelId).loading = true;
  sendWs("LoadMessages", { channel_id: channelId, around_id: messageId, limit: 50 });
}

function mergeLatestPage(messages, current) {
  const lastAt = messages[messages.length - 1]?.created_at || 0;
  const ids = new Set(messages.map(m => m.id));
  const incoming = current.filter(m => (m.created_at || 0) > lastAt && !ids.has(m.id));
  return [...messages, ...incoming].slice(-HISTORY_WINDOW_CAP);
}

function handleMessagesPageV2(payload) {
  const { channel_id, messages = [], has_more, has_more_after, around_id, after_id, before_id } = payload;
  const hs = getHistoryState(channel_id);
  hs.loading = false;
  chatMessagesEl.classList.remove("is-loading-history");
  const isActive = channel_id === getActiveTextChannelId();

  if (around_id || (!before_id && !after_id)) {
    // Janela nova: ao redor de uma mensagem, ou "voltar ao presente".
    if (around_id && messages.length === 0) {
      state.pendingJump = null;
      showUiToast("Essa mensagem não existe mais.");
      return;
    }
    state.chatHistory[channel_id] = around_id ? messages : mergeLatestPage(messages, state.chatHistory[channel_id] || []);
    hs.hasMore = Boolean(has_more);
    hs.hasNewer = Boolean(around_id && has_more_after);
    if (!isActive) return;
    renderChatMessagesV2({ preserveScroll: Boolean(around_id) });
    if (around_id) {
      const el = chatMessagesEl.querySelector(`[data-msg-id="${CSS.escape(around_id)}"]`);
      if (el) flashMessage(el);
      state.pendingJump = null;
    } else {
      state.pendingPresent = null;
    }
    return;
  }

  const current = state.chatHistory[channel_id] || [];
  const known = new Set(current.map((m) => m.id));
  const fresh = messages.filter((m) => !known.has(m.id));

  if (after_id) {
    let merged = [...current, ...fresh];
    if (merged.length > HISTORY_WINDOW_CAP) {
      merged = merged.slice(merged.length - HISTORY_WINDOW_CAP);
      hs.hasMore = true;
    }
    state.chatHistory[channel_id] = merged;
    hs.hasNewer = Boolean(has_more_after);
    if (isActive) {
      const top = chatMessagesEl.scrollTop;
      const anchorId = current[current.length - 1]?.id;
      const anchor = anchorId && chatMessagesEl.querySelector(`[data-msg-id="${CSS.escape(anchorId)}"]`);
      const anchorTop = anchor ? anchor.getBoundingClientRect().top : 0;
      renderChatMessagesV2({ preserveScroll: true });
      const again = anchorId && chatMessagesEl.querySelector(`[data-msg-id="${CSS.escape(anchorId)}"]`);
      if (again) chatMessagesEl.scrollTop += again.getBoundingClientRect().top - anchorTop;
      else chatMessagesEl.scrollTop = top;
      maybeAckActiveChannel();
    }
    return;
  }

  // Mensagens mais antigas (rolagem para cima).
  hs.hasMore = Boolean(has_more);
  let merged = [...fresh, ...current];
  if (merged.length > HISTORY_WINDOW_CAP) {
    // Limita a memória/DOM: descarta as mais novas e passa a carregá-las sob demanda.
    merged = merged.slice(0, HISTORY_WINDOW_CAP);
    hs.hasNewer = true;
  }
  state.chatHistory[channel_id] = merged;
  if (isActive && fresh.length) {
    const prevHeight = chatMessagesEl.scrollHeight;
    const prevTop = chatMessagesEl.scrollTop;
    renderChatMessagesV2({ preserveScroll: true });
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight - prevHeight + prevTop;
  } else if (isActive) {
    renderChatMessagesV2({ preserveScroll: true });
  }
}

const jumpBar = document.getElementById("jump-present-bar");
const jumpBarText = document.getElementById("jump-present-text");
document.getElementById("jump-present-btn")?.addEventListener("click", () => {
  if (jumpBar?.dataset.mode === "below") {
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
    hideJumpBar();
  } else {
    jumpToPresent();
  }
});

function hideJumpBar() {
  jumpBar?.classList.add("hidden");
}

function showNewBelowHint() {
  if (!jumpBar) return;
  jumpBar.dataset.mode = "below";
  jumpBarText.textContent = "Novas mensagens abaixo";
  jumpBar.classList.remove("hidden");
}

function updateJumpPresentBar() {
  const hs = getHistoryState(getActiveTextChannelId());
  if (!jumpBar) return;
  if (hs.hasNewer) {
    jumpBar.dataset.mode = "present";
    jumpBarText.textContent = "Você está vendo mensagens antigas";
    jumpBar.classList.remove("hidden");
  } else if (jumpBar.dataset.mode === "present") {
    hideJumpBar();
  }
}

let ackScrollTimer = null;
chatMessagesEl?.addEventListener(
  "scroll",
  () => {
    if (isNearBottom(150)) {
      requestNewerMessages();
      if (jumpBar?.dataset.mode === "below") hideJumpBar();
    }
    clearTimeout(ackScrollTimer);
    ackScrollTimer = setTimeout(() => maybeAckActiveChannel(), 250);
  },
  { passive: true }
);

// ---------------------------------------------------------------------------
// Não lidas e menções
// ---------------------------------------------------------------------------
function getReadState(channelId) {
  if (!state.readStates) state.readStates = new Map();
  if (!state.readStates.has(channelId)) state.readStates.set(channelId, { last_read_at: 0, mention_count: 0 });
  return state.readStates.get(channelId);
}

function lastForeignMessageAt(channelId) {
  const list = state.chatHistory?.[channelId] || [];
  for (let i = list.length - 1; i >= 0; i--) {
    if (!isOwnMessage(list[i])) return list[i].created_at || 0;
  }
  return 0;
}

function channelUnreadInfo(channelId) {
  const rs = getReadState(channelId);
  const unread = getHistoryState(channelId).hasNewer || lastForeignMessageAt(channelId) > rs.last_read_at;
  return { unread, mentions: rs.mention_count || 0 };
}

function serverUnreadInfo(srv) {
  let unread = false;
  let mentions = 0;
  for (const ch of srv?.text_channels || []) {
    const info = channelUnreadInfo(ch.id);
    unread = unread || info.unread;
    mentions += info.mentions;
  }
  return { unread: unread && !isServerMuted(srv.id), mentions };
}

function onWelcomeReadStates(list) {
  state.readStates = new Map();
  state.unreadDms.clear();
  for (const rs of list || []) {
    state.readStates.set(rs.channel_id, { last_read_at: rs.last_read_at, mention_count: rs.mention_count });
    if (isPrivateTextId(rs.channel_id)) {
      if (rs.mention_count > 0) state.unreadDms.set(rs.channel_id, rs.mention_count);
      else state.unreadDms.delete(rs.channel_id);
    }
  }
  updateHomeNotificationBadges?.();
}

function onReadStateUpdated(payload) {
  const s = payload?.state;
  if (!s) return;
  const prev = getReadState(s.channel_id);
  const movedBack = s.last_read_at < prev.last_read_at;
  state.readStates.set(s.channel_id, { last_read_at: s.last_read_at, mention_count: s.mention_count });
  if (isPrivateTextId(s.channel_id)) {
    if (s.mention_count > 0) state.unreadDms.set(s.channel_id, s.mention_count);
    else state.unreadDms.delete(s.channel_id);
    updateHomeNotificationBadges?.();
    renderDmList?.();
  }
  if (movedBack && s.channel_id === getActiveTextChannelId()) {
    // "Marcar como não lida": mostra o divisor e não lê de novo até sair do canal.
    state.suppressAckFor = s.channel_id;
    placeUnreadDivider(s.channel_id);
    renderChatMessagesV2({ preserveScroll: true });
  }
  refreshUnreadIndicators();
}

/** Define onde fica a linha "NOVAS MENSAGENS" ao abrir um canal. */
function placeUnreadDivider(channelId) {
  const rs = getReadState(channelId);
  const first = (state.chatHistory[channelId] || []).find((m) => (m.created_at || 0) > rs.last_read_at && !isOwnMessage(m));
  if (first) {
    state.unreadDividerByChannel.set(channelId, first.id);
    state.scrollToDividerOnce = channelId;
  } else {
    state.unreadDividerByChannel.delete(channelId);
  }
}

/** Chamado sempre que o usuário abre um canal/DM. */
function onChannelOpened(channelId) {
  if (state.composerChannelId !== channelId) {
    if (state.sendWhenUploaded) {
      state.sendWhenUploaded = false;
      showUiToast("Envio automático cancelado ao mudar de conversa. Confira os anexos antes de enviar.");
    }
    state.editingMsgId = null;
    state.composerChannelId = channelId;
  }
  if (state.suppressAckFor && state.suppressAckFor !== channelId) state.suppressAckFor = null;
  hideJumpBar();
  if (channelId) placeUnreadDivider(channelId);
}

const lastAckSent = new Map();
function maybeAckActiveChannel() {
  const chId = getActiveTextChannelId();
  if (!chId || !chatMainView || chatMainView.classList.contains("hidden")) return;
  if (state.activeView === "home" && !state.activeDmId) return;
  if (state.suppressAckFor === chId || document.hidden || !document.hasFocus()) return;
  if (!isNearBottom(150) || getHistoryState(chId).hasNewer) return;
  const list = state.chatHistory[chId] || [];
  const last = list[list.length - 1];
  if (!last) return;
  const rs = getReadState(chId);
  if ((last.created_at || 0) <= rs.last_read_at && !rs.mention_count) return;
  const now = Date.now();
  if (now - (lastAckSent.get(chId) || 0) < 700) {
    setTimeout(maybeAckActiveChannel, 750);
    return;
  }
  if (!sendWs("AckChannel", { channel_id: chId, message_id: last.id })) return;
  lastAckSent.set(chId, now);
  rs.last_read_at = Math.max(rs.last_read_at, last.created_at || 0);
  rs.mention_count = 0;
  if (isPrivateTextId(chId)) {
    state.unreadDms.delete(chId);
    renderDmList();
  }
  refreshUnreadIndicators();
}

window.addEventListener("focus", () => setTimeout(maybeAckActiveChannel, 100));
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) setTimeout(maybeAckActiveChannel, 100);
});

let unreadRefreshQueued = false;
function refreshUnreadIndicators() {
  if (unreadRefreshQueued) return;
  unreadRefreshQueued = true;
  // setTimeout (e não requestAnimationFrame): rAF fica pausado com a janela
  // minimizada, e os badges/título precisam atualizar mesmo assim.
  setTimeout(() => {
    unreadRefreshQueued = false;
    renderChannelTree();
    renderGuildRailV2();
    updateHomeNotificationBadges?.();
    updateDocumentTitle();
  }, 16);
}

function updateDocumentTitle() {
  let mentions = 0;
  for (const rs of state.readStates?.values?.() || []) mentions += rs.mention_count || 0;
  document.title = mentions > 0 ? `(${mentions}) Sancord` : "Sancord";
  // No .exe a janela não usa o título da página: avisa o app nativo (só quando muda).
  if (state.lastBadgeSent !== mentions) {
    state.lastBadgeSent = mentions;
    try {
      window.ipc?.postMessage(`badge:${mentions}`);
    } catch (_) {}
  }
}

/** Processa uma nova mensagem para não lidas, som e notificação. Retorna se deve anexar à tela. */
function onNewMessageForUnread(message) {
  const chId = message.channel_id;
  const rs = getReadState(chId);
  const own = isOwnMessage(message);
  const active = chId === getActiveTextChannelId() && !(state.activeView === "home" && !state.activeDmId);
  const hs = getHistoryState(chId);
  if (own) {
    rs.last_read_at = Math.max(rs.last_read_at, message.created_at || 0);
  } else {
    const mentioned = messageMentionsMe(message) || (isPrivateTextId(chId) && !isMessageRequest(chId));
    const willSee = active && !document.hidden && document.hasFocus() && isNearBottom(160) && !hs.hasNewer && state.suppressAckFor !== chId;
    if (mentioned && !willSee) {
      rs.mention_count = (rs.mention_count || 0) + 1;
    }
    // Notificação e aviso na barra de tarefas seguem o nível do canal/servidor.
    const policy = typeof notificationPolicy === "function" ? notificationPolicy(message) : { notify: mentioned };
    if (policy.notify && !willSee) {
      maybeDesktopNotify(message);
      if (typeof requestWindowAttention === "function") requestWindowAttention();
    }
  }
  if (isPrivateTextId(chId)) {
    if (rs.mention_count > 0) state.unreadDms.set(chId, rs.mention_count);
    else state.unreadDms.delete(chId);
    renderDmList();
  }
  refreshUnreadIndicators();
  // Numa janela antiga, não emenda a mensagem (criaria um buraco no histórico).
  return !hs.hasNewer;
}

function maybeDesktopNotify(message) {
  if (!state.audioSettings?.desktopNotif || document.hasFocus()) return;
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  const srv = serverForChannel(message.channel_id);
  if (srv && isServerMuted(srv.id) && !(message.mentions?.users || []).includes(myLower())) return;
  try {
    const where = srv ? `${srv.name} • #${(srv.text_channels || []).find((c) => c.id === message.channel_id)?.name || ""}` : "Mensagem direta";
    const n = new Notification(`${message.author_name} (${where})`, {
      body: (message.content || (message.attachments?.length ? "📎 Anexo" : "")).slice(0, 180),
      tag: message.channel_id,
      silent: true,
    });
    n.onclick = () => {
      window.focus();
      jumpToMessage(message.channel_id, message.id);
      n.close();
    };
  } catch (_) {}
}

// ---------------------------------------------------------------------------
// Fixadas (lista completa vinda do servidor)
// ---------------------------------------------------------------------------
pinnedMsgsBtn?.addEventListener("click", () => {
  const chId = getActiveTextChannelId();
  if (chId) sendWs("ListPins", { channel_id: chId });
});

function onPinnedMessages(payload) {
  if (payload.channel_id !== getActiveTextChannelId() || !pinnedPopoverList) return;
  const list = payload.messages || [];
  if (pinnedCountBadge) {
    pinnedCountBadge.textContent = list.length;
    pinnedCountBadge.classList.toggle("hidden", list.length === 0);
  }
  if (!list.length) {
    pinnedPopoverList.innerHTML = `<div class="pinned-empty">Nenhuma mensagem fixada neste canal ainda.</div>`;
    return;
  }
  pinnedPopoverList.innerHTML = "";
  for (const m of list) {
    const card = document.createElement("div");
    card.className = "pinned-card";
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    const head = document.createElement("div");
    head.className = "pinned-card-author";
    head.style.color = /^#[0-9a-f]{3,8}$/i.test(m.author_color || "") ? m.author_color : "";
    head.textContent = `${m.author_name} `;
    const time = document.createElement("span");
    time.className = "message-time";
    time.textContent = formatMessageTime(m);
    head.appendChild(time);
    const body = document.createElement("div");
    body.innerHTML = m.content ? renderMarkdown(m.content, m) : `<em>${m.attachments?.length ? `📎 ${m.attachments.length} anexo(s)` : "[Imagem]"}</em>`;
    card.append(head, body);
    const go = () => {
      pinnedPopover?.classList.add("hidden");
      jumpToMessage(m.channel_id, m.id);
    };
    card.addEventListener("click", go);
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter") go();
    });
    pinnedPopoverList.appendChild(card);
  }
}

// ---------------------------------------------------------------------------
// Composer: textarea, teclas, autocompletar
// ---------------------------------------------------------------------------
function autosizeTextarea(el) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, 200, Math.round(window.innerHeight * 0.3))}px`;
}

const autocompleteEl = document.getElementById("composer-autocomplete");
const ac = { open: false, items: [], index: 0, start: 0, end: 0 };

function closeAutocomplete() {
  ac.open = false;
  ac.items = [];
  autocompleteEl?.classList.add("hidden");
  chatInput?.removeAttribute("aria-activedescendant");
}

function autocompleteCandidates(trigger, query) {
  const q = normalizeSearch(query);
  const srv = state.activeView === "server" ? getActiveServer() : null;
  const out = [];
  if (trigger === "@") {
    const perms = srv ? getServerPermissionsFor(srv, state.selfUser?.username) : {};
    let people = [];
    if (srv) {
      // O hub "sancord" aceita todos: inclui também quem está online e quem já falou nos canais.
      const names = new Map();
      for (const l of [...(srv.members || []), srv.owner_username].filter(Boolean)) names.set(l, l);
      if (srv.id === "sancord") {
        for (const u of state.users.values()) names.set(u.username.toLowerCase(), u.username);
      }
      for (const ch of srv.text_channels || []) {
        for (const m of state.chatHistory?.[ch.id] || []) {
          if (m.author_id !== "system") names.set((m.author_name || "").toLowerCase(), m.author_name);
        }
      }
      names.delete(myLower());
      people = [...names.entries()].map(([l, n]) => {
        const live = findLiveUserByName(l);
        return { lower: l, name: live?.username || n, online: Boolean(live) };
      });
    } else if (state.activeDmId) {
      people = privateConversationPeople(state.activeDmId).map((p) => ({ lower: p.username.toLowerCase(), name: p.username, online: p.online }));
    }
    for (const p of people) {
      if (normalizeSearch(p.name).includes(q)) out.push({ kind: "user", label: p.name, hint: p.online ? "online" : "", insert: `@${p.name} `, user: p });
    }
    if (srv) {
      for (const r of srv.roles || []) {
        if (r.id === "everyone" || !(r.mentionable || perms.mention_everyone)) continue;
        if (normalizeSearch(r.name).includes(q)) out.push({ kind: "role", label: r.name, hint: "cargo", insert: `@${r.name} `, color: r.color });
      }
      if (perms.mention_everyone) {
        if ("everyone".includes(q)) out.push({ kind: "special", label: "everyone", hint: "notifica todos os membros", insert: "@everyone " });
        if ("online".includes(q)) out.push({ kind: "special", label: "online", hint: "notifica quem está online", insert: "@online " });
      }
    }
  } else if (trigger === "#" && srv) {
    for (const c of srv.text_channels || []) {
      if (normalizeSearch(c.name).includes(q)) out.push({ kind: "channel", label: c.name, hint: c.kind === "announcement" ? "anúncios" : "", insert: `#${c.name} ` });
    }
  } else if (trigger === ":" && q.length >= 2) {
    for (const em of searchEmojis(q, 8)) out.push({ kind: "emoji", label: em.k.split(" ")[0], emoji: em.e, insert: `${em.e} ` });
  }
  out.sort((a, b) => Number(normalizeSearch(b.label).startsWith(q)) - Number(normalizeSearch(a.label).startsWith(q)));
  return out.slice(0, 8);
}

function updateAutocomplete() {
  if (!chatInput || !autocompleteEl) return;
  const caret = chatInput.selectionStart ?? chatInput.value.length;
  const before = chatInput.value.slice(0, caret);
  const m = before.match(/(^|[\s(])([@#:])([^\s@#:]{0,32})$/);
  if (!m) return closeAutocomplete();
  const items = autocompleteCandidates(m[2], m[3]);
  if (!items.length) return closeAutocomplete();
  ac.open = true;
  ac.items = items;
  ac.index = 0;
  ac.start = caret - m[3].length - 1;
  ac.end = caret;
  renderAutocomplete(m[2]);
}

function renderAutocomplete(trigger) {
  autocompleteEl.innerHTML = "";
  const title = document.createElement("div");
  title.className = "composer-autocomplete-title";
  title.textContent = trigger === "@" ? "Membros e cargos" : trigger === "#" ? "Canais" : "Emojis";
  autocompleteEl.appendChild(title);
  ac.items.forEach((item, i) => {
    const row = document.createElement("div");
    row.className = `composer-autocomplete-item ${i === ac.index ? "active" : ""}`;
    row.id = `ac-item-${i}`;
    row.setAttribute("role", "option");
    row.setAttribute("aria-selected", String(i === ac.index));
    const icon = document.createElement("span");
    icon.className = "ac-icon";
    if (item.kind === "user") {
      const live = findLiveUserByName(item.user.lower);
      icon.innerHTML = `<span class="avatar small-avatar" style="background:${/^#[0-9a-f]{3,8}$/i.test(live?.avatar_color || "") ? live.avatar_color : "#5865f2"}">${renderAvatarInner(item.label, live?.avatar_url)}</span>`;
    } else if (item.kind === "emoji") {
      icon.textContent = item.emoji;
    } else if (item.kind === "channel") {
      icon.textContent = "#";
    } else {
      icon.textContent = "@";
      if (item.color && /^#[0-9a-f]{3,8}$/i.test(item.color)) icon.style.color = item.color;
    }
    const label = document.createElement("span");
    label.className = "ac-label";
    label.textContent = item.kind === "emoji" ? `:${item.label}:` : item.label;
    const hint = document.createElement("span");
    hint.className = "ac-hint";
    hint.textContent = item.hint || "";
    row.append(icon, label, hint);
    row.addEventListener("mousedown", (e) => {
      e.preventDefault();
      ac.index = i;
      applyAutocomplete();
    });
    autocompleteEl.appendChild(row);
  });
  autocompleteEl.classList.remove("hidden");
  chatInput.setAttribute("aria-activedescendant", `ac-item-${ac.index}`);
}

function applyAutocomplete() {
  const item = ac.items[ac.index];
  if (!item) return closeAutocomplete();
  const v = chatInput.value;
  chatInput.value = v.slice(0, ac.start) + item.insert + v.slice(ac.end);
  const pos = ac.start + item.insert.length;
  chatInput.setSelectionRange(pos, pos);
  if (item.kind === "emoji") pushRecentEmoji(item.emoji);
  closeAutocomplete();
  autosizeTextarea(chatInput);
  chatInput.focus();
}

chatInput?.addEventListener("input", () => {
  autosizeTextarea(chatInput);
  updateAutocomplete();
});
chatInput?.addEventListener("click", updateAutocomplete);
chatInput?.addEventListener("blur", () => setTimeout(closeAutocomplete, 120));

chatInput?.addEventListener("keydown", (e) => {
  if (ac.open) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      ac.index = (ac.index + (e.key === "ArrowDown" ? 1 : -1) + ac.items.length) % ac.items.length;
      renderAutocomplete(chatInput.value[ac.start] || "@");
      return;
    }
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      applyAutocomplete();
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      closeAutocomplete();
      return;
    }
  }
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    chatForm.requestSubmit();
    return;
  }
  if (e.key === "ArrowUp" && !chatInput.value) {
    // Editar a última mensagem própria do canal.
    const list = state.chatHistory[getActiveTextChannelId()] || [];
    const lastMine = [...list].reverse().find((m) => isOwnMessage(m) && m.content);
    if (lastMine) {
      e.preventDefault();
      startEditingMessage(lastMine);
    }
    return;
  }
  if (e.key === "Escape" && state.replyingTo) {
    clearReplyingTo();
  }
});

// ---------------------------------------------------------------------------
// Anexos no composer: upload com progresso, arrastar e soltar, colar
// ---------------------------------------------------------------------------
const composerTray = document.getElementById("composer-attachments");
state.composerFiles = [];

function addComposerFiles(fileList) {
  const files = Array.from(fileList || []).filter((f) => f && f.size >= 0);
  if (!files.length) return;
  if (!messagePermissions({ channel_id: getActiveTextChannelId() }).attach_files) {
    showErrorToast("Você não tem permissão para anexar arquivos neste canal.");
    return;
  }
  if (chatInput?.disabled) {
    showErrorToast("Você não pode enviar arquivos neste canal.");
    return;
  }
  for (const file of files) {
    if (state.composerFiles.length >= MAX_FILES_PER_MESSAGE) {
      showErrorToast(`No máximo ${MAX_FILES_PER_MESSAGE} arquivos por mensagem.`);
      break;
    }
    const item = {
      key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      file,
      name: file.name || (file.type.startsWith("image/") ? "imagem colada.png" : "arquivo"),
      status: "pending",
      progress: 0,
      attachment: null,
      error: "",
      preview: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
      xhr: null,
    };
    state.composerFiles.push(item);
    if (file.size > MAX_UPLOAD_BYTES) {
      item.status = "error";
      item.error = "Maior que 25 MB";
    } else {
      uploadComposerFile(item);
    }
  }
  renderComposerTray();
  chatInput?.focus();
}

function uploadComposerFile(item) {
  item.status = "uploading";
  item.progress = 0;
  item.error = "";
  const xhr = new XMLHttpRequest();
  item.xhr = xhr;
  xhr.open("POST", SancordNet.url(`/api/attachments?filename=${encodeURIComponent(item.name)}`));
  xhr.setRequestHeader("Authorization", `Bearer ${getStoredToken() || ""}`);
  xhr.setRequestHeader("Content-Type", "application/octet-stream");
  xhr.upload.onprogress = (e) => {
    if (e.lengthComputable) {
      item.progress = e.loaded / e.total;
      updateTrayItemProgress(item);
    }
  };
  xhr.onload = () => {
    if (!state.composerFiles.includes(item) || item.xhr !== xhr) return;
    item.xhr = null;
    let data = null;
    try {
      data = JSON.parse(xhr.responseText);
    } catch (_) {}
    if (xhr.status === 200 && data?.ok) {
      item.status = "done";
      item.attachment = data.attachment;
    } else {
      item.status = "error";
      item.error = data?.message || (xhr.status === 413 ? "Arquivo grande demais" : `Falha no envio (${xhr.status})`);
    }
    renderComposerTray();
    if (state.sendWhenUploaded && !state.composerFiles.some((f) => f.status === "uploading")) {
      state.sendWhenUploaded = false;
      if (!state.composerFiles.some((f) => f.status === "error")) chatForm.requestSubmit();
    }
  };
  xhr.onerror = () => {
    if (!state.composerFiles.includes(item) || item.xhr !== xhr) return;
    item.xhr = null;
    item.status = "error";
    item.error = "Sem conexão";
    state.sendWhenUploaded = false;
    renderComposerTray();
  };
  xhr.send(item.file);
}

function removeComposerFile(item) {
  state.sendWhenUploaded = false;
  item.xhr?.abort();
  if (item.preview) URL.revokeObjectURL(item.preview);
  state.composerFiles = state.composerFiles.filter((f) => f !== item);
  renderComposerTray();
}

function clearComposerFiles() {
  state.sendWhenUploaded = false;
  for (const f of state.composerFiles) {
    f.xhr?.abort();
    if (f.preview) URL.revokeObjectURL(f.preview);
  }
  state.composerFiles = [];
  renderComposerTray();
}

function updateTrayItemProgress(item) {
  const bar = composerTray?.querySelector(`[data-file-key="${item.key}"] .tray-progress-fill`);
  if (bar) bar.style.width = `${Math.round(item.progress * 100)}%`;
}

function renderComposerTray() {
  if (!composerTray) return;
  composerTray.innerHTML = "";
  composerTray.classList.toggle("hidden", state.composerFiles.length === 0);
  for (const item of state.composerFiles) {
    const chip = document.createElement("div");
    chip.className = `tray-item status-${item.status}`;
    chip.dataset.fileKey = item.key;
    const thumb = document.createElement("div");
    thumb.className = "tray-thumb";
    if (item.preview) {
      const img = document.createElement("img");
      img.src = item.preview;
      img.alt = "";
      thumb.appendChild(img);
    } else {
      thumb.textContent = fileIconFor({ filename: item.name, content_type: item.file.type });
    }
    const info = document.createElement("div");
    info.className = "tray-info";
    const name = document.createElement("span");
    name.className = "tray-name";
    name.textContent = item.name;
    const sub = document.createElement("span");
    sub.className = "tray-sub";
    sub.textContent =
      item.status === "error" ? item.error : item.status === "done" ? formatBytes(item.file.size) : `Enviando… ${formatBytes(item.file.size)}`;
    info.append(name, sub);
    if (item.status === "uploading") {
      const bar = document.createElement("div");
      bar.className = "tray-progress";
      bar.innerHTML = `<div class="tray-progress-fill" style="width:${Math.round(item.progress * 100)}%"></div>`;
      info.appendChild(bar);
    }
    const actions = document.createElement("div");
    actions.className = "tray-actions";
    if (item.status === "error" && item.file.size <= MAX_UPLOAD_BYTES) {
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "tray-btn";
      retry.textContent = "↻";
      retry.setAttribute("aria-label", `Tentar enviar ${item.name} de novo`);
      retry.addEventListener("click", () => {
        uploadComposerFile(item);
        renderComposerTray();
      });
      actions.appendChild(retry);
    }
    const rm = document.createElement("button");
    rm.type = "button";
    rm.className = "tray-btn danger";
    rm.textContent = "✕";
    rm.setAttribute("aria-label", `Remover ${item.name}`);
    rm.addEventListener("click", () => removeComposerFile(item));
    actions.appendChild(rm);
    chip.append(thumb, info, actions);
    composerTray.appendChild(chip);
  }
}

/** Envio do composer (texto + anexos). */
function submitComposer() {
  if (chatInput.disabled) { showErrorToast("Você não pode enviar mensagens neste canal."); return; }
  const slowWait = currentSlowmodeWait(getActiveTextChannelId());
  if (slowWait > 0) { showErrorToast(`Modo lento: aguarde ${formatSlowmodeWait(slowWait)} para enviar de novo.`); return; }
  const content = chatInput.value.trim();
  const files = state.composerFiles;
  if (files.some((f) => f.status === "uploading")) {
    state.sendWhenUploaded = true;
    showUiToast("Enviando assim que os anexos terminarem de subir...");
    return;
  }
  if (files.some((f) => f.status === "error")) {
    showErrorToast("Alguns anexos falharam. Remova-os ou tente de novo antes de enviar.");
    return;
  }
  const attachmentIds = files.filter((f) => f.status === "done").map((f) => f.attachment.id);
  if (!content && !attachmentIds.length) return;
  const sent = sendChatPayload({
    channel_id: getActiveTextChannelId(),
    content,
    reply_to_id: state.replyingTo ? state.replyingTo.id : null,
    attachment_ids: attachmentIds,
  });
  if (!sent) return;
  chatInput.value = "";
  autosizeTextarea(chatInput);
  closeAutocomplete();
  for (const f of files) if (f.preview) URL.revokeObjectURL(f.preview);
  state.composerFiles = [];
  renderComposerTray();
  clearReplyingTo();
}

// Arrastar e soltar arquivos no chat.
const dropOverlay = document.getElementById("chat-drop-overlay");
let dragDepth = 0;
const hasFiles = (e) => Array.from(e.dataTransfer?.types || []).includes("Files");
chatMainView?.addEventListener("dragenter", (e) => {
  if (!hasFiles(e) || chatInput?.disabled) return;
  e.preventDefault();
  dragDepth += 1;
  const where = state.activeView === "server" ? `#${state.textChannels.find((c) => c.id === state.currentTextChannel)?.name || "canal"}` : "esta conversa";
  const target = document.getElementById("chat-drop-target");
  if (target) target.textContent = `Os arquivos serão enviados para ${where}.`;
  dropOverlay?.classList.remove("hidden");
});
chatMainView?.addEventListener("dragover", (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "copy";
});
chatMainView?.addEventListener("dragleave", (e) => {
  if (!hasFiles(e)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) dropOverlay?.classList.add("hidden");
});
chatMainView?.addEventListener("drop", (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  dropOverlay?.classList.add("hidden");
  addComposerFiles(e.dataTransfer.files);
});

// ---------------------------------------------------------------------------
// Seletor de emojis (busca, categorias, recentes)
// ---------------------------------------------------------------------------
let emojiPickerBuilt = false;

function initEmojiPicker() {
  if (!emojiPopover || emojiPickerBuilt) return;
  emojiPickerBuilt = true;
  emojiPopover.innerHTML = `
    <div class="emoji-picker-head">
      <input type="search" class="emoji-search" placeholder="Buscar emoji (ex.: risada, fogo, joinha)" aria-label="Buscar emoji" />
    </div>
    <div class="emoji-picker-tabs" role="tablist"></div>
    <div class="emoji-picker-body" tabindex="-1"></div>
  `;
  const search = emojiPopover.querySelector(".emoji-search");
  const tabs = emojiPopover.querySelector(".emoji-picker-tabs");
  const body = emojiPopover.querySelector(".emoji-picker-body");
  const sections = [{ label: "Recentes", icon: "🕘", emojis: null }, ...EMOJI_CATEGORIES];
  sections.forEach((sec, i) => {
    const t = document.createElement("button");
    t.type = "button";
    t.className = "emoji-tab";
    t.textContent = sec.icon;
    t.setAttribute("role", "tab");
    t.setAttribute("aria-label", sec.label);
    t.title = sec.label;
    t.addEventListener("click", () => body.querySelector(`[data-sec="${i}"]`)?.scrollIntoView({ block: "start" }));
    tabs.appendChild(t);
  });
  const renderBody = () => {
    const q = search.value.trim();
    body.innerHTML = "";
    const addGrid = (label, list, idx) => {
      if (!list.length) return;
      const h = document.createElement("div");
      h.className = "emoji-section-title";
      h.textContent = label;
      if (idx !== undefined) h.dataset.sec = idx;
      const grid = document.createElement("div");
      grid.className = "emoji-grid";
      for (const em of list) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "emoji-choice-btn";
        b.textContent = em.e;
        b.title = em.k ? `:${em.k.split(" ")[0]}:` : em.e;
        b.dataset.emoji = em.e;
        grid.appendChild(b);
      }
      body.append(h, grid);
    };
    if (q) {
      const found = searchEmojis(q, 80);
      if (found.length) addGrid(`Resultados para "${q}"`, found);
      else body.innerHTML = `<div class="pinned-empty">Nenhum emoji encontrado.</div>`;
      return;
    }
    const recents = getRecentEmojis().map((e) => ALL_EMOJIS.find((x) => x.e === e) || { e, k: "" });
    addGrid("Recentes", recents, 0);
    EMOJI_CATEGORIES.forEach((c, i) => addGrid(c.label, c.emojis, i + 1));
  };
  search.addEventListener("input", renderBody);
  search.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      emojiPopover.classList.add("hidden");
      chatInput?.focus();
    } else if (e.key === "Enter") {
      e.preventDefault();
      body.querySelector(".emoji-choice-btn")?.click();
    }
  });
  body.addEventListener("click", (e) => {
    const btn = e.target.closest(".emoji-choice-btn");
    if (!btn) return;
    const em = btn.dataset.emoji;
    pushRecentEmoji(em);
    if (emojiTargetMsg) {
      sendWs("ToggleReaction", { channel_id: emojiTargetMsg.channel_id, message_id: emojiTargetMsg.id, emoji: em });
      emojiTargetMsg = null;
      emojiPopover.style.cssText = "";
      emojiPopover.classList.add("hidden");
    } else {
      insertAtCaret(chatInput, em);
      if (!e.shiftKey) emojiPopover.classList.add("hidden");
    }
  });
  emojiPopover.renderBody = renderBody;
  renderBody();
}

function insertAtCaret(el, text) {
  if (!el) return;
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  el.value = el.value.slice(0, start) + text + el.value.slice(end);
  const pos = start + text.length;
  el.focus();
  el.setSelectionRange(pos, pos);
  autosizeTextarea(el);
}

function openEmojiPickerFor(msg, anchorEl) {
  initEmojiPicker();
  emojiTargetMsg = msg;
  emojiPopover.classList.remove("hidden");
  emojiPopover.style.position = "fixed";
  const r = anchorEl.getBoundingClientRect();
  const w = 340;
  const h = 380;
  emojiPopover.style.left = `${Math.max(8, Math.min(r.left - w + r.width, window.innerWidth - w - 8))}px`;
  emojiPopover.style.top = `${Math.max(8, Math.min(r.bottom + 6, window.innerHeight - h - 8))}px`;
  emojiPopover.style.right = "auto";
  emojiPopover.style.bottom = "auto";
  emojiPopover.style.zIndex = "2600";
  emojiPopover.renderBody?.();
  setTimeout(() => emojiPopover.querySelector(".emoji-search")?.focus(), 0);
}

emojiPickerBtn?.addEventListener("click", () => {
  initEmojiPicker();
  emojiPopover.renderBody?.();
  setTimeout(() => {
    if (!emojiPopover.classList.contains("hidden")) emojiPopover.querySelector(".emoji-search")?.focus();
  }, 0);
});
