# Sancord

Plataforma de comunicação em tempo real para comunidades, amigos e grupos.
Backend em **Rust** (Axum + Tokio + WebSockets + SQLite), aplicativo Windows
**SancordApp** (WebView2 via `wry`) com HTML/CSS/JS compilados dentro do executável.
Não há versão web pública: o backend fornece API, WebSocket e anexos.
Voz, vídeo e compartilhamento de tela usam **WebRTC P2P (mesh)**; o servidor só repassa a sinalização.

Estado atual: os fontes incluem o trabalho das nove fases originais, com validações
de mídia ainda pendentes. Consulte [Fase 8 — Avançados](FASE8.md),
[Fase 9 — Polimento](FASE9.md) e a etapa atual de [homologação e candidata 0.2.0](HOMOLOGACAO.md).
O idioma de entrega é pt-BR; inglês permanece preview. Os documentos distinguem código,
testes e pendências; os pacotes antigos na raiz não contêm automaticamente as mudanças.

Distribuição, GitHub Actions, assinatura e atualizações automáticas:
[DISTRIBUTION.md](DISTRIBUTION.md). Continuidade entre IAs: [AI_HANDOFF.md](AI_HANDOFF.md).

## Arquitetura

```
 Cliente .exe (fontes em static/, recursos embutidos em tempo de compilação)
   │  HTTP  ── /api/register /api/login /api/session /api/logout /api/invite/:code /api/health
   │  WS    ── /ws  (eventos JSON { type, payload }: mensagens, presença, typing, reações,
   │                 servidores/canais/cargos, amigos/DMs, sinalização WebRTC)
   │  WebRTC ─ áudio/vídeo/tela direto entre clientes (STUN público)
   ▼
 Servidor Rust (src/)
   main.rs      inicialização, logs, porta, encerramento
   lib.rs       roteador (build_router)
   config.rs    variáveis de ambiente
   http.rs      endpoints HTTP (auth, sessão, convites, saúde)
   ws.rs        WebSocket: autenticação, heartbeat, handlers de eventos
   state.rs     estado em memória (cache) + envio de eventos
   db.rs        SQLite: esquema, migração dos JSON antigos, thread de escrita
   auth.rs      Argon2id, tokens de sessão, regras de usuário/senha, rate limit
   chat.rs      menções, validação de reações e limites de envio
   permissions.rs permissões efetivas por canal e autorização da hierarquia
   access.rs    projeção de eventos por destinatário e isolamento da voz
   uploads.rs   upload HTTP, detecção de conteúdo e download de anexos
   validate.rs  validação de imagens (data URL), cores e caminhos
   models.rs    tipos do protocolo e do domínio
   bin/SancordApp.rs, bin/capture_bridge.rs   app desktop (Windows)
   bin/desktop_assets.rs  recursos locais compilados, protocolo interno
   bin/desktop_links.rs   links sancord:// e escolha de backend
```

### Persistência
- Banco: `data/sancord.db` (SQLite em modo WAL, compilado junto via `rusqlite` *bundled*).
- Toda escrita é enfileirada para uma thread dedicada que grava em lotes transacionais;
  nenhum handler faz I/O de disco com o lock do estado segurado.
- Mensagens ficam numa tabela própria com índice `(channel_id, created_at, id)`; o servidor
  mantém só as 100 mais recentes por canal em memória e envia 50 no login. Mensagens antigas
  são carregadas sob demanda (`LoadMessages`) ao rolar o chat para cima. **Nada é descartado.**
- Fontes atuais usam **esquema v10** (incluindo as integrações HTTP). A normalização v4
  contém `servers`, `categories`, `channels`, `server_members` (com data de
  entrada), `roles`, `member_roles`, `bans`, `invites`, `user_prefs`, além de `messages` e `sessions`.
  Ao abrir um banco v1, a tabela antiga de servidores (JSON) é convertida e mantida como `servers_v1`.
- A migração v2 → v3 acrescenta `attachments` e `read_states`, preservando mensagens,
  servidores, contas e sessões existentes. Os arquivos ficam em `data/uploads/`.
- `users` e amizades (`kv`) ainda guardam documento JSON; os recursos sociais atuais
  e seus limites estão em [FASE5.md](FASE5.md).
- **Migração automática**: na primeira execução com um banco vazio, `accounts.json`,
  `servers.json`, `chat_history.json` e `friends.json` são importados e renomeados para
  `*.migrated.bak` (nada é apagado). Tokens antigos viram sessões válidas por 30 dias, então
  quem já estava logado continua logado.

### Autenticação e segurança
- Senhas com **Argon2id**. Contas antigas (hash legado) são re-hasheadas no primeiro login.
- Sessões: token aleatório de 256 bits entregue ao cliente; o banco guarda só o **SHA-256**.
  "Manter conectado" = 30 dias (renovação deslizante); sem a opção = 24 h e token em `sessionStorage`.
- Logout revoga a sessão no servidor; troca de senha encerra as outras sessões.
- O WebSocket **exige** um token válido no primeiro pacote (`JoinServer`). Sem token válido o
  servidor responde `AuthFailed` e fecha com código `4001`.
- Limite de tentativas de login: 8 falhas em 10 min por usuário → HTTP 429.
- Imagens de perfil (avatar, banner, ícone) e anexos legados só são aceitos como `data:image/{png,jpeg,webp,gif,bmp,avif};base64,...`
  válidas, com limite de tamanho; cores só em hexadecimal. Isso fecha injeções de atributo/XSS no WebView.

### Chat (Fase 3)
- Mensagens, edição, exclusão, respostas, reações, fixadas, menções e indicador de digitação
  têm handlers WebSocket reais e persistência SQLite.
- Anexos novos usam `POST /api/attachments?filename=...` com token Bearer e corpo binário;
  a mensagem leva somente os IDs. Até 10 arquivos por mensagem e 25 MB por arquivo.
  O conteúdo determina o tipo; HTML/SVG são downloads, sem renderização inline.
- `static/js/chat.js`, carregado depois do `app.js`, implementa composer com várias linhas,
  Markdown escapado, autocompletar, uploads com progresso e seletor de emojis.
- Posição de leitura e contagem de menções sincronizam pelo servidor. O ack automático exige
  conversa visível, janela com foco e posição próxima do fim; uma falha no envio preserva o badge.
- Saltos para respostas/fixadas buscam mensagens fora da página atual. O cache do cliente
  mantém até 300 mensagens por canal, inclusive no fluxo realtime; o restante fica no banco.
- Atualizações de reação/fixação preservam rascunho, seleção e foco da edição inline.
  Trocar de conversa cancela o envio automático que aguardava uploads terminarem.
- Pendentes: prévias de links com proteção contra SSRF, emojis próprios e limpeza de uploads
  abandonados. Voz/vídeo/tela não foram revalidados na retomada da Fase 3.

### Cargos, permissões e canais privados (Fase 4)
- `permissions.rs` reúne as regras de concessão, atribuição e hierarquia de cargos.
  Gerenciar cargos não permite elevar o próprio acesso nem conceder permissões ausentes.
  Proprietário permanece protegido e administradores respeitam a hierarquia de cargos.
- Cálculo: permissões dos cargos no servidor → categoria → exceções do canal.
  Em cada camada: `everyone`, união dos cargos (allow vence deny entre cargos) e exceção
  individual. Chaves ausentes herdam; `true` permite; `false` nega.
- Proprietário e administrador têm acesso completo. Demais usuários sem `view_channel`
  não recebem estrutura, histórico, digitação ou mensagens daquele canal.
- Migração v3 → v4 acrescenta `permission_overwrites` em categorias/canais e
  `permissions_synced` em canais. Dados antigos continuam herdando o acesso existente.
- A criação tem a opção **Canal privado**. Botão direito no canal/categoria abre
  **Permissões**, com permitir/negar/herdar por cargo ou membro. Sincronizar um canal
  remove as exceções próprias e passa a seguir a categoria.
- O editor existente possui 18 permissões e arraste da hierarquia. Todas as alterações
  continuam sendo validadas pelo backend e sincronizadas entre clientes.
- Mudanças de acesso limpam caches inacessíveis no cliente. Históricos recém-liberados
  são buscados sob demanda; não se duplica todo o chat a cada mudança de cargo.
- A sinalização WebRTC exige participantes no mesmo canal e valida publicação de mídia;
  revogar acesso ou direitos de mídia encerra a sessão de voz. Isso não substitui testes
  de áudio/vídeo entre máquinas. Veja limites e evidências em [FASE4.md](FASE4.md).

### Tempo real e reconexão
- Servidor envia ping a cada 30 s e derruba conexões sem tráfego por 90 s.
- Fila de saída por conexão limitada (1024 eventos); cliente lento demais é desconectado e
  ressincroniza ao voltar, em vez de consumir memória sem limite.
- Cliente reconecta com backoff exponencial (1 s → 30 s, com jitter), mostra o aviso
  "Reconectando…" com botão "Tentar agora", reage aos eventos `online`/`offline` do sistema e, ao voltar,
  recebe o estado completo (`Welcome`), incluindo o que perdeu.
- Envio de mensagem com confirmação (`nonce`): se falhar ou não for confirmado em 10 s, aparece
  "Não foi possível enviar a mensagem." com **Tentar novamente**.

### Servidores, categorias e convites
- Canais: `text`, `voice` e `announcement` (todos leem, só quem tem "Gerenciar mensagens" publica),
  com categoria, posição e descrição. Estrutura preparada para novos tipos (`ChannelKind`).
- Eventos WS: `CreateChannel`, `UpdateChannel`, `DeleteChannel`, `CreateCategory`, `UpdateCategory`,
  `DeleteCategory`, `ReorderServerLayout` (arrastar e soltar), `CreateInvite`, `ListInvites`,
  `RevokeInvite`, `UpdateUserPrefs`. Toda alteração é validada no servidor e enviada a todos os
  membros conectados (`ServerUpdated`).
- Convites `SANC-XXXXXX` com validade (até 30 dias) e limite de usos; o convite padrão de cada
  servidor é permanente e só pode ser trocado ("Gerar novo código"). `GET /api/invite/:code` mostra
  membros, online, tipo (privado/comunidade) e validade.
- Barra de servidores: ordem, pastas (nome, cor, aberta/fechada) e servidores silenciados ficam em
  `user_prefs` e sincronizam entre dispositivos.
- Frontend: `static/js/ui-kit.js` (menu de contexto, diálogos, tooltips) e `static/js/servers.js`
  (árvore de canais, barra de servidores, convites), carregados antes do `app.js`.

### App desktop: descoberta e isolamento
- **Descoberta assinada**: o servidor do host cria uma chave Ed25519 em `data/discovery.key`
  (privada; **nunca compartilhe a pasta `data/`**) e a pública em `data/discovery_public.key`.
  Ao detectar a URL do túnel em `data/tunnel.log`, o servidor publica no ntfy
  `v1|<url>|<timestamp>|<assinatura>`. O `build.rs` embute a chave pública no SancordApp, que só
  aceita anúncios assinados, com menos de 48 h, para `https://<sub>.trycloudflare.com`.
  Sem chave embutida, a descoberta remota fica desligada (use "Conectar a um endereço específico").
- **Interface local**: a janela carrega somente recursos do executável, pelo protocolo
  interno `sancord://localhost`. No Windows, o WebView2 representa a origem como
  `http://sancord.localhost`. O backend escolhido fornece dados, nunca a página da aplicação.
- **IPC** (barra de título/navegação) só responde à interface embutida; "navigate:" só vem da tela de conexão.
- **Links do aplicativo**: convites, canais e mensagens usam `sancord://open/?endpoint=...`.
  O primeiro início registra o protocolo para o usuário atual. Links externos HTTP(S)
  continuam abrindo no navegador padrão; isso não publica uma versão web do Sancord.
- Tokens de sessão ficam separados pelo endereço do backend. A mudança de origem requer
  um novo login na primeira abertura; contas, servidores e mensagens permanecem no banco.
- **Ponte de captura** (`127.0.0.1:<porta aleatória>`): exige cabeçalho `Origin` confiável **e** o
  segredo aleatório da execução (`?token=`), injetado só em páginas confiáveis depois do carregamento.
  Antes, qualquer site aberto em qualquer navegador do PC podia se conectar e capturar a tela.

### Distribuir o Sancord.exe para amigos
1. Rode o backend uma vez (`cargo run --bin sancord`) para gerar `data/discovery_public.key`.
2. Execute `./scripts/build-desktop.ps1`. O build embute a chave pública e os recursos locais.
3. Envie apenas `dist/Sancord.exe` para os amigos. Ele extrai o cliente e o loader WebView2
   por versão em `%LOCALAPPDATA%/SancordDesktopData/bin_v4/`.
4. No anfitrião, mantenha `Sancord.exe` e `SancordServer.exe` juntos, ao lado da pasta `data/`.
   O cliente inicia o backend adjacente quando a porta local não está ocupada.

É necessário atualizar também os clientes antigos, que dependiam de HTML servido pelo backend.
O túnel continua necessário para conexões remotas: ele expõe a API, não um site da aplicação.

## Como compilar

Requisitos: Rust estável (`rustup`), e no Windows um compilador C (MSVC Build Tools ou LLVM-MinGW)
para o SQLite embutido.

```powershell
./scripts/prepare-windows.ps1        # checkout novo: obtém o loader pelo Cargo.lock
cargo build --bin sancord            # servidor (debug)
cargo build --release --bin sancord  # servidor otimizado
cargo build --release --bin SancordApp   # app desktop
```

## Como rodar

```powershell
cargo run --bin sancord
```
Abra `Sancord.exe` ou `iniciar-sancord.bat`; não abra um endereço no navegador.
No anfitrião, o aplicativo inicia o backend adjacente e o túnel (`cloudflared.exe`, se presente).

> Ao atualizar, encerre o backend anterior antes de abrir o novo. Não execute dois processos
> sobre o mesmo banco. Preserve `data/`; as migrações são automáticas. A saúde do novo backend
> informa `client_delivery: embedded-desktop`, e `/` ou `/index.html` retornam 404.

## Testes

```powershell
cargo test --lib              # servidor
cargo test --bin SancordApp   # app desktop (origens confiáveis + ponte de captura)
npm ci --ignore-scripts --no-audit --no-fund
npm test                     # helpers, DOM completo e CSS/temas
```
Inclui testes de: hash de senha (Argon2 e legado), tokens, regras de usuário/senha, rate limit,
validação de imagens/cores, banco (paginação, edição, renomeação, sessões, migração dos JSON),
serialização do protocolo e testes ponta a ponta com servidor real e clientes WebSocket
(cadastro/login/logout, recusa de token falso, criar servidor → convite → conversa → reação,
histórico após reinício + paginação, reconexão recebendo mensagens perdidas).

As dependências npm são ferramentas de desenvolvimento, fixadas em `package-lock.json`.
O aplicativo distribuído continua usando somente os assets embutidos no EXE. A suíte
de DOM valida também foco dos diálogos, ícones e abertura de Voz sem solicitar captura;
ela não substitui a homologação visual no WebView2. Consulte [a refatoração visual](VISUAL_REFACTOR.md).

## Configuração (variáveis de ambiente)

| Variável | Padrão | Descrição |
|---|---|---|
| `SANCORD_BIND` | `0.0.0.0:3000` | Endereço e porta HTTP/WebSocket |
| `SANCORD_DATA_DIR` | `data` | Pasta do banco (`sancord.db`) e dos backups da migração |
| `SANCORD_SERVER_URL` | descoberta | Backend escolhido pelo cliente desktop |
| `SANCORD_DESKTOP_DATA_DIR` | `%LOCALAPPDATA%/SancordDesktopData` | Perfil local do cliente |
| `SANCORD_DISABLE_LOCAL_HOST` | desligado | `1` impede iniciar backend/túnel local, útil em QA |
| `SANCORD_REGISTER_PROTOCOL` | ligado | `0` impede registro de links do app, útil em QA |
| `SANCORD_LOG_DIR` | `logs` | Logs técnicos diários (`sancord.log.AAAA-MM-DD`) |
| `SANCORD_LOG` | `sancord=info,tower_http=warn` | Filtro de log (sintaxe `tracing`) |
| `SANCORD_SESSION_DAYS` | `30` | Validade da sessão com "manter conectado" |
| `SANCORD_SESSION_HOURS` | `24` | Validade da sessão sem "manter conectado" |
| `SANCORD_DISCOVERY` | ligado | `0` desliga o anúncio da URL do túnel |
| `SANCORD_DISCOVERY_TOPIC` | `sancord_srv_8f92a1b4c7` | Tópico ntfy usado na descoberta |
| `SANCORD_DISCOVERY_LEGACY` | ligado | `0` para de publicar também a URL crua (formato antigo) |
| `SANCORD_DISCOVERY_PUBKEY` | (arquivo) | Só na compilação: chave pública a embutir no SancordApp |

## Portas

| Porta | Uso |
|---|---|
| 3000/TCP | HTTP + WebSocket do servidor (configurável) |
| 127.0.0.1:aleatória | Ponte local de captura de tela/áudio do app desktop |
| UDP dinâmicas | WebRTC P2P entre clientes (STUN: Google/Cloudflare) |
