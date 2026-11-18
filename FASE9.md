# Fase 9 — polimento (concluída no escopo de entrega)

Iniciada em 18/11/2026. Nada foi publicado; o banco principal e os executáveis distribuídos
não foram alterados.

Diretriz do usuário (18/11): pode refazer o que já existe quando ficar melhor e mais próximo
de como o Discord funciona. Seguimos o comportamento conhecido (atalhos, notificações,
menus), mantendo a identidade visual própria do Sancord (seção 60 do prompt: sem cópia
pixel a pixel).

## Conferência inicial (o que já existia)
- Temas Claro, Ash, Escuro e Onyx/OLED por tokens CSS, cores de destaque, tamanho da fonte,
  modo compacto, efeitos de vidro e modo streamer.
- Animação de entrada de mensagem e respeito ao "reduzir movimento" do Windows em parte das
  animações. Foco visível em vários controles.
- Atalhos: Esc, Ctrl+Shift+M (microfone), Ctrl+Shift+D (ensurdecer) e Push-to-Talk.
- Notificações: sons, contador no título da página e a API Notification do WebView2.
- Cores fixas no código: 479 hex e 332 rgba no CSS, contra 529 usos de tokens; ~150 hex no JS.

## Implementado — bloco 1

### Notificações
- **Nível por servidor, canal ou thread:** Padrão, Todas as mensagens, Só @menções ou Nada.
  - Fica nas preferências da conta (`notify_levels`), sincronizado entre dispositivos e
    validado no servidor (valores conhecidos, até 500 itens).
  - O canal vence a thread, que vence o servidor.
  - "Padrão" mantém o comportamento anterior: som em tudo (exceto servidor silenciado) e
    notificação só em menções e DMs.
  - A escolha fica no botão direito do canal, do servidor e da thread.
- **Aviso nativo no `.exe`:**
  - a janela pisca na barra de tarefas quando chega algo que notifica e o app não está em
    foco (IPC `attention`);
  - o título da janela mostra as menções pendentes, ex.: "(3) Sancord" (IPC `badge:N`).
    Antes, o contador só ia para o título da página, que a janela sem moldura não mostra.

### Navegação e atalhos
- **Ctrl+K — navegação rápida:**
  - procura canais, canais de voz, threads, DMs, grupos, amigos e servidores;
  - ignora acentos e prefere o começo do nome; os não lidos vêm primeiro;
  - prefixos `#` (canais), `@` (pessoas) e `*` (servidores);
  - ↑↓, Enter e Esc.
- **Alt+↑/↓:** canal anterior ou próximo.
- **Alt+Shift+↑/↓:** canal não lido anterior ou próximo.
- **Esc** sem nada aberto marca o canal atual como lido.
- **Ctrl+F** vai para a busca do Sancord, no lugar da busca de página do WebView.
- **Ctrl+/** abre a lista de atalhos, que ganhou essas linhas novas.

### Acessibilidade
- Opção **Reduzir animações** em Aparência, independente da opção do Windows.
- Foco visível geral para teclado em botões, itens de lista e menu, links, seletores e caixas
  de marcação.

## Implementado — bloco 2

### Responsividade (seção 56)
- O tamanho mínimo da janela (940×600) já existia no `SancordApp` e foi mantido.
- Abaixo de 1100 px o **painel de membros sai primeiro**: deixa a grade, e o botão de membros
  abre um painel flutuante, que fecha ao clicar fora. O chat e o campo de mensagem ganham o
  espaço; antes ficavam espremidos (o texto do campo aparecia cortado).
- Ao alargar a janela de novo, o painel volta ao estado de antes, inclusive quando a mudança
  de tamanho não dispara o evento de mídia (há conferência no `resize`).

### Tradução (seção 70)
- `static/js/i18n.js` é carregado antes dos outros scripts e oferece:
  - `t("chave", {vars})`, com o português como base e volta ao português quando falta tradução;
  - `applyI18n()` para os atributos `data-i18n`, `data-i18n-placeholder` e `data-i18n-title`;
  - `setLanguage()`.
- Seletor **Idioma** em Aparência: Português (Brasil) ou English (preview). Fica salvo neste
  aparelho e muda na hora.
- Já traduzidos (48 textos marcados): tela de login (inclusive o botão que muda por código),
  navegação da tela inicial, abas de Amigos, menus de configurações do usuário e do servidor,
  Eventos, buscas, navegação rápida, fórum e menu de notificações.

### Tipo de autor (seção 66)
- `ChatMessage.author_kind`: `user`, `system`, `bot` ou `webhook`. Para usuário o campo não
  é enviado.
- O servidor marca como sistema: boas-vindas do servidor e do hub, registros de chamada,
  mensagens de grupo e alertas do AutoMod.
- O cliente não escolhe o tipo: um `author_kind` enviado junto da mensagem é ignorado.
- Mensagens antigas sem o campo, com `author_id = "system"`, continuam valendo como sistema.
- Interface: selo SISTEMA, BOT ou WEBHOOK, traduzido; mensagens que não são de pessoa não se
  agrupam com as de usuário.

## Implementado — bloco 3

### Desempenho (seção 63)
- **Medição antes:** 300 mensagens com avatar de ~140 KB geravam 42,2 MB de HTML no chat;
  cada redesenho levava 159–187 ms. A árvore de canais já era rápida (< 1 ms).
  - Causa: o avatar em data URL era repetido por inteiro em cada mensagem.
- **Correção:** `cachedMediaUrl()` em `static/js/ui-kit.js`.
  - Cada imagem PNG, JPEG, GIF ou WebP grande em data URL vira um endereço `blob:` curto,
    uma única vez, e é reaproveitada.
  - Até 500 entradas.
  - Usada nos avatares (`renderAvatarInner`) e nos ícones de servidor e grupo.
  - Imagens de avatar ganharam `loading="lazy"` e `decoding="async"`.
- **Medição depois:** 565 KB de HTML e 67–81 ms por redesenho.

### Cores em tokens (seção 64)
- **Novos tokens em todos os temas:**
  - `--bg-floating` (menus, toasts, cartões flutuantes);
  - `--bg-card`;
  - `--bg-elevated`;
  - `--bg-input`;
  - `--bg-composer` (campo de mensagem);
  - `--text-secondary`;
  - `--yellow`;
  - `--red-hover`.
- **Substituições:** 160 cores fixas do `styles.css` viraram tokens, com base no tipo de
  propriedade (fundo/borda ou texto). Mais 25 textos brancos sobre fundo neutro passaram a
  `--text-header`. As amostras de tema e as cores de destaque escolhidas ficaram de fora.
- **Cor de destaque:** `#5865f2` fixo virou `--brand`, então a cor de destaque escolhida
  agora vale também nesses pontos.
- **Conferência automática, cor calculada de cada elemento antes e depois** (1828
  elementos):
  - o tema Escuro padrão ficou **idêntico** na substituição por tokens;
  - Claro, Ash e Onyx passaram a seguir a própria paleta: 173, 74 e 295 elementos corrigidos.
  - Depois disso, os 25 textos brancos mudaram de `#fff` para `#f2f3f5` no escuro, o mesmo
    tom dos títulos.

### Revisão visual (seções 60 e 61), corrigido
- **Tema Claro:**
  - o campo de mensagem era escuro;
  - no perfil completo, o lado direito e o bloco de informações eram escuros, e o nome, o
    @usuário e os rótulos eram brancos e invisíveis;
  - "Sair da Conta" perdia o vermelho;
  - o item ativo do submenu de configurações era branco;
  - o quadrado do tema Claro sumia sobre o fundo claro.
- **Nome branco salvo no perfil:** era o padrão de muitas contas. Agora vale como "cor do
  tema", então aparece no tema Claro. Na lista de membros, a cor do cargo passa a aparecer
  nesse caso, como no Discord.
- **Fundo do cartão de perfil sem tema próprio:** era `#111214` fixo no JS e agora usa
  `--bg-floating`.
- **Seletor de Idioma (bloco 2):** estava entre o título "Temas padrão" e os quadrados de
  tema. Ganhou seção própria.

### Componentes (seção 65)
- `static/js/ui-kit.js` (`SancordUI`) segue como biblioteca única. Ele oferece:
  - menu de contexto;
  - formulário em modal;
  - confirmação;
  - tooltip;
  - agora, o cache de imagens.
- Não houve consolidação de componentes além disso neste bloco.

## Pendências históricas antes do fechamento técnico
- Traduzir o restante dos textos montados por código. O English segue como "preview".
- **Cores fixas que restam:**
  - ~350 hex, a maioria `#fff` em botões coloridos, que é correto;
  - ~330 `rgba`, sobretudo sombreados brancos que somem no tema Claro. Vão sendo corrigidos
    por tela.
  - ~150 hex no JS.
- Revisão visual das telas não abertas neste bloco: voz e vídeo, editor de perfil,
  personalização, modais de convite.
- Webhooks e bots de verdade (criação, token, envio) — só a estrutura do tipo existe.

## Testado
- `cargo test --all-targets`: **88 testes do núcleo** e **8 do desktop**, todos passando.
  - Novos: `src/phase9_tests.rs` (níveis validados, sincronizados e persistidos, e que não
    se apagam ao mudar outras preferências) e o título com contador no `SancordApp`.
- `node --test tests/frontend-*.test.cjs`: **71 testes**, todos passando (3 novos em
  `frontend-polish.test.cjs`: herança de nível, política de notificação e busca da navegação
  rápida).
- Instância 3100 com cópia dos dados reais. **Conferido com teclado real e capturas:**
  - Ctrl+K e a busca `#mem`;
  - Enter abre o canal; Alt+↑ volta ao canal anterior;
  - o menu do canal com "Notificações", e "Só @menções" salvo e devolvido pelo servidor
    depois de recarregar;
  - "Reduzir animações" liga e desliga.
- **Não testado:** piscar na barra de tarefas e o título nativo. Exigem abrir o `.exe`,
  que o agente não inicia. O código compila e o formato do título tem teste.
- Bloco 2:
  - `cargo test --all-targets`: **89 testes do núcleo** e 8 do desktop, todos passando.
    O novo teste de tipo de autor cobre: sistema marcado, cliente sem poder escolher o tipo,
    e mensagem antiga reconhecida.
  - Frontend: **74 testes**, todos passando (3 novos em `frontend-i18n.test.cjs`).
  - **Conferido na tela, com capturas, na instância 3100:**
    - 1000 px: painel de membros fora da grade, chat largo e painel flutuante pelo botão,
      fechando ao clicar fora;
    - 1300 px: layout normal;
    - estreito → largo sem recarregar: o painel volta;
    - troca para English: textos marcados mudam na hora, a escolha fica salva depois de
      recarregar e volta ao português sem erros no console.
  - **Problema achado e corrigido no QA:** ao alargar a janela o painel de membros não
    voltava.
- Bloco 3:
  - `cargo test --all-targets`: **89 testes do núcleo** e **8 do desktop**, todos passando.
  - Frontend: **77 testes**, todos passando. Os 3 novos estão em
    `frontend-ui-kit.test.cjs` e cobrem:
    - a conversão feita uma única vez e reaproveitada;
    - os endereços que não são convertidos;
    - o limite do cache.
  - **Na instância 3100, com capturas:**
    - medição de 300 mensagens antes e depois;
    - comparação automática das cores calculadas nos 4 temas;
    - tema Claro conferido nas seguintes telas: chat, menu do canal, Minha Conta, Aparência,
      perfil completo e Cargos do servidor;
    - perfil conferido também no Escuro.
  - **Não conferido:** as telas listadas como pendentes acima e o `.exe` (WebView2).

## Continuação — bloco 4 (Codex, 18/11/2026)

### Estado recebido e preservado

- Retomada baseada em `AI_HANDOFF.md`, documentos das fases, código e diff Git. O
  Claude havia encerrado o bloco 3; fases 8/9 e alterações anteriores estavam sem
  commit após `5e43107`. Não foram revertidas ou substituídas.
- Baseline conferido: **89 testes do núcleo + 8 desktop + 77 frontend = 174**, todos
  aprovados. Check de todos os targets e sintaxe JavaScript passaram antes das correções.
- Fontes usam schema v9; leitura somente de metadados do banco principal confirmou
  schema v4. Não abrir o banco principal com o backend novo para realizar QA.
- Backend distribuído e cloudflared já estavam executando. Não foram reiniciados,
  substituídos ou reconfigurados nesta continuação.
- Snapshot dos 50 arquivos de trabalho recebidos em `qa-resume-20261118/baseline/`,
  com inventário de hashes. A pasta é ignorada pelo Git e não contém banco ou chaves.

### Cache de imagens: orçamento efetivo

- Reproduzido: retirar uma entrada do `Map` sem revogar a URL deixava seu Blob alocado
  no WebView. O limite de 500 entradas não limitava a quantidade total de alocações.
- Mantidos o cache e seus endereços em uso. Agora há limite de **500 URLs e 32 MiB
  de bytes de imagem armazenados em Blobs pelo cache**. Ao atingir qualquer limite,
  imagens novas usam a data URL original; as já presentes continuam reaproveitadas.
- Não revoga imagens durante construção de HTML nem interrompe imagens visíveis.
  O orçamento não representa o consumo total do WebView, texturas ou demais caches.
- Testes novos comprovam limite de alocações, orçamento em bytes e fallback que
  mantém a imagem disponível. Não foi feita nova medição visual de desempenho.

### Traduções dinâmicas: continuação da seção 70

- Categorias da navegação rápida: servidor, voz, DM, grupo, amigo e thread sem servidor
  conhecido; aviso de nenhum canal não lido e seis descrições dos atalhos.
- Diálogos compartilhados: Salvar, Cancelar, Confirmar e mensagem de campo obrigatório.
  Nomes, títulos, conteúdo do usuário e rótulos explícitos de ação são preservados.
- Um diálogo aberto troca os botões padrão sem recriar os campos. A navegação rápida
  aberta refaz seus rótulos ao trocar o idioma, mantendo busca e seleção.
- Nomes herdados de `Object`, como `__proto__`, não são mais aceitos como idioma ou
  tradução; valor salvo inválido volta para pt-BR. Caso reproduzido antes da correção.
- Layout, cores, temas, frontend/backend e protocolo permanecem com a implementação
  existente. English continua **preview**, com outras telas/textos ainda pendentes.

### Validação do bloco 4

- Suite atual: **89 núcleo + 8 desktop + 84 frontend = 181 testes aprovados**.
  Os sete testes novos cobrem as correções e o uso integrado de i18n, diálogos e
  navegação. A suite Rust completa passou na auditoria; os oito testes do desktop
  passaram novamente após mudar os recursos embutidos.
- `cargo check --locked --all-targets --target-dir target-review-phase6`: passou.
- JavaScript sem erros de sintaxe. Build do cliente isolado em `target-review-phase6`.
- Não houve ensaio visual ou novo teste de microfone, câmera ou tela. Permanecem os
  limites registrados das fases 6/7 e a revisão visual restante desta fase.
- Não foram criados commit, tag ou release; executáveis de produção e banco principal
  permanecem separados desta revisão.

## Fechamento técnico — bloco 5 (18/11/2026)

O usuário confirmou **pt-BR completo e inglês preview**, conforme o escopo do prompt
original. A estrutura e os textos já traduzidos permanecem; inglês integral é trabalho
futuro, não requisito de entrega desta fase. Nada é apresentado como inglês completo.

- Bots de envio e webhooks agora possuem criação, canal fixo, credencial, renovação,
  revogação, persistência, auditoria e envio HTTP com atualização WS real. O painel
  está nas configurações do servidor. Contrato e limites em `INTEGRATIONS.md`.
- SQLite dos fontes passa a **v10**, com migração aditiva. Tokens são aleatórios,
  só hashes são persistidos e o envio verifica a autorização atual do responsável.
  AutoMod e limite de ritmo continuam ativos. Sem menções notificáveis/anexos/API
  pública completa de bots neste contrato de envio.
- Autoria protege mensagens de integrações contra a coincidência do nome com uma
  conta: não são mensagens próprias dessa pessoa, nem podem ser editadas/excluídas
  por ela apenas pelo nome. Moderação continua possível com a permissão correspondente.
- Revisão de superfícies de perfil, personalização, convites e seletor de tela:
  bordas/hover usam tokens e o código de convite tem contraste no Claro. Mantidos
  fundos pretos de vídeo, cores de marca e efeitos decorativos intencionais.
- Abrir Voz e vídeo ou mudar um filtro/dispositivo fora da chamada não inicia o
  microfone. Captura começa ao entrar na voz ou acionar o teste explicitamente.
- A próxima etapa já tem roteiro e script em `HOMOLOGACAO.md`: check, suites e build
  isolados, seguidos de ensaio nativo e preparação da candidata a release.

**Estado:** implementação concluída no escopo pt-BR, com inglês preview. O usuário
preferiu a conferência visual manual e confirmou em 18/11: Claro/Escuro legíveis nas
telas indicadas, aba de voz sem iniciar microfone, criação de integração exibindo
credencial e Ctrl+K/teclado funcionando. Trata-se de relato manual, sem medição visual
independente pelo agente. A tentativa automatizada foi bloqueada por integridade do
Windows e não conta como validação.

A próxima etapa, **homologação e versão candidata**, já começou em `HOMOLOGACAO.md`.
Isso não equivale a release estável aprovada: notificações nativas, equipamentos/redes,
CI final e ciclo público de atualização seguem os gates daquela etapa. Produção
continua separada; banco principal não foi aberto pelo backend novo.
