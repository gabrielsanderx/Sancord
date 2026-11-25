# Histórico de versões

## 0.2.18

### Atualização do perfil em mensagens antigas (servidores e DMs)
- **Hidratação do autor no servidor (`access.rs`, `state.rs`, `profile.rs`, `ws.rs`):** mensagens de usuários em `Welcome`, `FriendsSync`, `DmOpened`, `MessagesPage`, `PinnedMessages`, `MessageContext`, `SearchResults`, `NewChatMessage` e `MessageUpdated` agora recebem automaticamente o avatar e a cor atuais da conta do autor, inclusive ao carregar páginas antigas do histórico ou após reiniciar o servidor.
- **Resolução completa de perfil para autores offline e reconectados (`chat.js`, `app.js`, `profile-sharing.js`, `social.js`, `profile-collection.js`):** mensagens antigas agora resolvem foto de perfil, decoração de avatar, estilo/cor do nome e nome de exibição usando o roster do servidor, cache local, lista de amigos, DMs e grupos (mesmo quando o autor está offline ou invisível), e redesenham o chat em tempo real ao receber atualizações de perfil, reconexões com novo ID de sessão ou `FriendsSync`.
- **Avatares animados no chat (`chat.js`):** chamada de `refreshAnimatedMedia` ao renderizar, anexar e atualizar mensagens para garantir exibição correta de avatares GIF nas conversas.

## 0.2.17

### Eliminação do zumbido de fundo, indicador de fala e calibração padrão estilo Discord
- **Janela Root-Hann casada (análise + síntese IFFT) no DSP (`voice-dsp-core.js`):** aplica janelamento seno tanto na entrada quanto na saída da IFFT ($\sin^2 + \cos^2 = 1.0$) e interpola o envelope de silêncio amostra a amostra, eliminando 100% a descontinuidade de borda de bloco em 375 Hz (que gerava o som de "maquininha" no silêncio) e removendo o `usedtx=1` do SDP do Opus.
- **Indicador de fala (anel verde / ícone Falando) corrigido:** em `setupVoiceActivityDetection`, o `AnalyserNode` de áudio WebRTC remoto agora é conectado a um `GainNode(0)` ligado ao `destination` (garantindo que o WebView2 puxe os pacotes continuamente), com sensibilidade de `-58 dB` e *hold* suave de 240 ms; no microfone local, combina nível dB e VAD harmônico do Worklet.
- **Configuração padrão automática estilo Discord (`voiceDspPresetVersion: 3`):** migra automaticamente os ajustes salvos para o perfil calibrado (`noiseSuppressionMode: "auto"`, `aec: true`, `agc: true`, `highpass: true`, `compressor: true`, `noiseGate: false`, `gateThreshold: -56`, `opusHd: true`).
- **Alinhamento do avatar decorado no chat (`cosmetics.css`):** preservado o posicionamento absoluto (`.message-item > .avatar-status-wrap`) ao usar decorações de avatar V5.

## 0.2.16

### Correção de alinhamento do avatar decorado no chat
- Preservado o posicionamento absoluto (`.message-item > .avatar-status-wrap`) das mensagens do chat ao usar decorações de avatar V5, mantendo o avatar alinhado à esquerda sem sobrepor o nome ou o texto da mensagem.

## 0.2.15

### Transmissão de tela em chamadas privadas e servidores
- Corrigido o erro `ReferenceError: volPct is not defined` em `renderVoiceStage()` que impedia o card de vídeo da transmissão de tela de aparecer para os demais participantes da chamada (tanto em chamadas privadas quanto em canais de voz de servidores).
- Melhorada a resolução de streams remotos quando o `stream.id` recebido no `ontrack` diverge do ID anunciado, com reprodução automática resiliente no WebView2.
- Selo **AO VIVO** na lista de participantes agora é clicável (além da opção **Assistir transmissão** no menu de contexto) para abrir o palco e focar direto na tela compartilhada.

### Qualidade da voz e supressão de ruído (estilo Discord)
- Ativada a cascata híbrida de supressão de ruído: supressor nativo C++ do WebRTC/Chromium (`noiseSuppression`) em modos `auto`, `standard` e `strong`, combinado ao motor DSP adaptativo `SancordNoiseSuppressorCore` em AudioWorklet (com alternância em tempo real e bypass verdadeiro em `off`).
- Upgrade do motor DSP (`voice-dsp-core.js`): passa-alta de 85 Hz, hangover de 260 ms, envelope suave de silêncio (`-35` a `-48 dB` nos intervalos sem fala sem cortar inícios ou finais de palavras) e supressão reforçada de cliques de teclado/mouse.
- Pipeline Web Audio e Opus calibrados para voz limpa: filtro de clareza vocal sutil em 3 kHz, compressor mais transparente (sem amplificar ruído de fundo no silêncio) e Opus mono 48 kHz com `useinbandfec=1` e `usedtx=1`.

### Correção visual nas decorações de avatar no chat
- Corrigida a ordem de camadas (`z-index`) em `.avatar-status-wrap`: a foto de perfil agora permanece acima da camada traseira (`avatar-art-back`) das decorações V5 nas mensagens do chat, lista de membros e DMs, evitando que o brilho/arte de fundo encubra o avatar.

## 0.2.14

### Transmissão de tela em chamadas privadas e servidores
- Corrigido o erro `ReferenceError: volPct is not defined` em `renderVoiceStage()` que impedia o card de vídeo da transmissão de tela de aparecer para os demais participantes da chamada (tanto em chamadas privadas quanto em canais de voz de servidores).
- Melhorada a resolução de streams remotos quando o `stream.id` recebido no `ontrack` diverge do ID anunciado, com reprodução automática resiliente no WebView2.
- Selo **AO VIVO** na lista de participantes agora é clicável (além da opção **Assistir transmissão** no menu de contexto) para abrir o palco e focar direto na tela compartilhada.

### Qualidade da voz e supressão de ruído (estilo Discord)
- Ativada a cascata híbrida de supressão de ruído: supressor nativo C++ do WebRTC/Chromium (`noiseSuppression`) em modos `auto`, `standard` e `strong`, combinado ao motor DSP adaptativo `SancordNoiseSuppressorCore` em AudioWorklet (com alternância em tempo real e bypass verdadeiro em `off`).
- Upgrade do motor DSP (`voice-dsp-core.js`): passa-alta de 85 Hz, hangover de 260 ms, envelope suave de silêncio (`-35` a `-48 dB` nos intervalos sem fala sem cortar inícios ou finais de palavras) e supressão reforçada de cliques de teclado/mouse.
- Pipeline Web Audio e Opus calibrados para voz limpa: filtro de clareza vocal sutil em 3 kHz, compressor mais transparente (sem amplificar ruído de fundo no silêncio) e Opus mono 48 kHz com `useinbandfec=1` e `usedtx=1`.

## 0.2.13

### Correções no cliente desktop (Windows / WebView2)
- Corrigida a navegação após descoberta automática do servidor remoto, conexão manual e abertura de links `sanvo://` / `sancord://`: o cliente agora converte `sancord://localhost/...` para `http://sancord.localhost/...` antes de chamar `webview.load_url`, eliminando o aviso *"Este site está tentando abrir o Sanvo Desktop"* e a abertura de janela preta duplicada no PC dos convidados.

## 0.2.12

### Conectividade e descoberta automática
- Atualizada a chave pública de descoberta automática do servidor anfitrião para reconexão direta dos clientes desktop.

## 0.2.11

### Expansão Flagship V5 (12 Coleções Pintadas) e Avatares Predefinidos
- **4 novas coleções pintadas Flagship V5 (totalizando 12 coleções completas e 110 assets WebP HiDPI embutidos):**
  - **Bosque Onírico (`dream`):** decoração *Guardião das Borboletas* (`lunar`) com evento secundário real de bater de asas, moldura *Bosque Onírico* (`dream-sanctuary`), efeito narrativo de 4 atos *Revoada Onírica* (`dream-butterflies`) com animação de bater de asas em 60fps e placa *Bruma Onírica* (`dream-mist`).
  - **Templo do Trovão (`synth`):** decoração *Espírito Raijin* (`electric-pulse`) com tambores Tomoe em órbita e piscada elétrica, moldura *Templo do Trovão* (`neon-pulse`), efeito *Fúria de Raijin* (`synth-overdrive`) e placa *Corrente de Raijin* (`circuit-weave`).
  - **Horizonte Arcade (`retro`):** decoração *Companheiro Pixel-Bot* (`cyber-ring`) com piscada CRT `^ ω -`, moldura *Gabinete Arcade* (`eclipse-crown`) e efeito *Overdrive Arcade* (`eclipse-flare`) com robôs CRT e corações 16-bit.
  - **Lagoa de Jade (`royal`):** decoração *Koi de Jade & Ouro* (`core-orbit`) com duas carpas imperiais nadando em órbita Yin-Yang contínua ao redor do avatar, moldura *Lagoa de Jade* (`core-pulse`), efeito *Dança dos Koi* (`core-signal`) e placa *Lótus de Jade & Ouro* (`gold-leaf`).
- **Upgrades visuais em coleções existentes:** camadas secundárias pintadas de cintilação para *Dragão Glacial* (`frost-crown`) e *Chamas de Drakon* (`dragon-fire`), além de ornamentos WebP dedicados de 3 cantos para as molduras exclusivas **Fundador** (`founder`) e **Arquitetura Dev** (`developer`).
- **Seletor de Avatar com 12 Avatares Predefinidos + Envio de Imagem:** clicar em **Avatar** no editor de perfil (ou no avatar do cartão de prévia) agora abre o subeditor **Avatar do perfil**, permitindo escolher entre **12 avatares predefinidos ilustrados do Sanvo**, voltar às iniciais, reposicionar/zoom ou clicar em **Enviar uma imagem** para enviar PNG, JPG, WebP ou GIF personalizado (também disponível no Perfil por Servidor).
- **Barra inferior de usuário limpa (estilo Discord):** removido o fundo/arte de nameplate da barra inferior esquerda do usuário (`#self-user-profile-bar`), mantendo o painel escuro e limpo como no Discord Desktop enquanto preserva a decoração de avatar e o estilo tipográfico do nome.

## 0.2.10

### Sanoted (notas privadas no desktop)
- **Área dedicada na Home:** acesse o **Sanoted** abaixo de *Servidores* para organizar notas privadas com pastas aninhadas, pesquisa instantânea, filtros (Todas, Favoritas, Lixeira), ordenação, fixação e lixeira com restauração ou exclusão permanente.
- **Editor de blocos ricos e anexos:** suporte a títulos, negrito, itálico, citação, código, listas, checklists interativos, links seguros e anexos de imagens (colagem, arraste ou seletor com legenda, redimensionamento e lightbox) além de PDFs e arquivos de texto — armazenados em rotas privadas autenticadas (`500` notas, `100` pastas, `128 KiB` por nota, `10 MiB` por arquivo e `250 MiB` por conta).
- **Offline cifrado e sincronização com conflitos:** edição salva localmente em IndexedDB cifrado com AES-GCM e chave protegida por DPAPI vinculada à conta e origem do servidor; edições e imagens feitas offline sincronizam automaticamente ao reconectar, com resolução visual de conflitos entre dispositivos.
- **Banco de dados:** o servidor migra automaticamente o SQLite para o esquema `v23` (`sanoted_notes`, `sanoted_folders`, `sanoted_assets`), preservando integralmente todos os dados existentes.

### Otimização em repouso e ao minimizar
- **Menor uso de CPU/GPU quando minimizado ou ocioso:** o aplicativo Windows informa ao WebView2 o estado real de minimização, suspendendo animações CSS, desenhos de Canvas fora da área visível e timers visuais de voz/atividade enquanto oculto (mantendo heartbeat e captura de áudio ativos).
- **Fundo animado e medidores inteligentes:** o efeito ambiente opcional pausa após 15 segundos sem interação e retoma instantaneamente ao usar mouse, teclado ou rolagem; medidores de microfone fora de vista evitam atualizações desnecessárias do DOM.

## 0.2.9

### E-mail obrigatório e confirmado
- **Cadastro com e-mail:** criar conta pede nome de usuário, e-mail e senha. O e-mail é único entre as contas (sem diferenciar maiúsculas) e é confirmado com um código de 6 dígitos enviado à caixa de entrada (válido por 15 minutos, 5 tentativas, reenvio após 60 s).
- **Login por e-mail ou nome de usuário:** o mesmo campo aceita os dois; a recuperação de senha também.
- **Contas antigas:** entram normalmente uma última vez e cadastram e confirmam o e-mail antes de continuar. O servidor só libera o app depois da confirmação.
- **Configurações → E-mail:** o e-mail não pode ser removido; trocar exige confirmar o novo endereço com código (o atual vale até lá).
- **Envio por SMTP:** configurado em `data/smtp.json` no servidor (modelo em `smtp.example.json`). Sem configuração, os códigos aparecem só no log do servidor.

### Cosméticos de perfil pintados (V5) e motor vivo
- Nova biblioteca de cosméticos pintados em alta resolução: decorações de avatar em camadas, molduras, efeitos de perfil e placas em coleções coesas, com animações orgânicas que respeitam o orçamento de movimento e o "Reduzir movimento".
- Animações dos cosméticos voltam a funcionar mesmo com as animações do Windows desligadas (opção "Sincronizar com o computador" em Acessibilidade).

### Correções
- O app não abre mais um túnel público novo a cada vez que liga o servidor; só cria um se não houver outro rodando.
- Scripts de inicialização usam `SanvoServer.exe` (com o nome antigo como reserva).
- Mensagens do sistema e o bot aparecem como **Sanvo** / **Sanvo Bot**, inclusive as mensagens antigas.
- Seletor de jogos do mural não sai mais da tela; os botões Ligar e Vídeo das DMs voltaram a funcionar; o aviso "Atualização concluída" não se repete a cada abertura.

## 0.2.8

### Sancord agora é Sanvo
- **Renomeação oficial e migração compatível (`Sancord` → `Sanvo`):** o aplicativo passa a se chamar oficialmente **Sanvo** (`Sanvo Desktop`). Toda a interface, barra de título nativa (`SANVO DESKTOP`), telas de login/conexão, configurações (`Sobre o Sanvo`, categoria `SANVO`, `ID DA CONTA SANVO`), cartões de perfil, coleções (`Sanvo Core`) e insígnias (`Fundador do Sanvo`) foram atualizadas para `Sanvo`, mantendo total compatibilidade com contas, banco de dados (`data/sancord.db`), sessões DPAPI, configurações locais (`%LOCALAPPDATA%\SancordDesktopData` → `%LOCALAPPDATA%\Sanvo`), protocolos (`sanvo://` e `sancord://`), variáveis de ambiente (`SANVO_*` e `SANCORD_*`) e atualizações automáticas (`sanvo-update.json` e `sancord-update.json`).
- **Ciclo de vida profissional de chamadas privadas (DM e Group DM):** máquina de estados autoritativa no servidor (`RINGING` → `WAITING_ACTIVE` → `CONNECTED` → `ENDED`) separando o período de toque (`CALL_RING_DURATION = 30s`) da sessão de voz ativa (`CALL_IDLE_GRACE_PERIOD = 5 min`); ringtone e ringback originais com parada imediata sem sobreposição, botão *Cancelar toque*, *Chamar novamente* com cooldown anti-spam, entrada tardia (*Chamada em andamento · Entrar na chamada*) preservando o mesmo `call_id`, duração contada a partir da conexão real, sincronização multi-dispositivo (`CallAnswered`/`CallDeclined`), reconstrução fiel após reconexão (`ActiveCallsSync`), silêncio sonoro em Não Perturbe (mantendo aviso visual), volume dedicado do toque e atenção discreta na barra de tarefas do Windows (`FlashWindowEx`).
- **Notificações desktop, som original `message_received.wav` e badge nativa na barra de tarefas do Windows:** avatares dedicados de DMs/Group DMs não lidas no rail lateral com badge numerada (`1–99`, `99+`), asset WAV original `message_received.wav` (`48 kHz`), contador global unificado de não lidas com deduplicação e recálculo em deleções, e overlay icon nativo na barra de tarefas do Windows via `ITaskbarList3::SetOverlayIcon` com escalonamento automático por DPI (`100%`–`200%`).
- **Efeitos sonoros compartilhados de voz, chamadas, transmissão e câmera:** 17 assets WAV originais do Sanvo embutidos (`static/assets/sounds/`), eventos compartilhados autoritativos (`VoiceCueEvent` com deduplicação por `event_id` e isolamento por canal), gerenciamento central (`SancordSoundManager` + `SancordVoiceSounds`) com compressor anti-clipping, `setSinkId` e página de configurações com preview `▶` e volume independente.
- **Supressor de ruído DSP v2 (`AudioWorklet` em 48 kHz):** motor espectral zero-allocation (`static/js/voice-dsp-core.js`, `static/js/voice-dsp-worklet.js`) com latência de `2,67 ms`, 5 modos ao vivo (`Automático`, `Leve`, `Padrão`, `Forte` e `Desligado` com bypass verdadeiro), redução de cliques de teclado e ventilador com proteção vocal, toggles independentes de AEC/AGC, comparação A/B ao vivo no teste do microfone e telemetria no Modo Desenvolvedor.
- **Cosméticos v3, Game Picker de catálogo e Polimento Visual:** motor visual em camadas para Avatar Decorations, Profile Frames, Profile Effects, Nameplates e Display Name Styles (`static/cosmetics/`), seletor de jogos com catálogo central (`src/games.rs`, `static/js/game-picker.js`), insígnia exclusiva de Fundador, polimento unificado do cabeçalho de perfil nos 4 contextos e novo motor central de tooltips em portal (`static/js/ui-kit.js`) com hierarquia de `z-index` unificada, detecção da topbar, flip automático em 4 direções, shift/clamp e seta ancorada.

## 0.2.7

- **Autenticação desktop e segurança local:** nova tela unificada em coluna única para Entrar, Criar conta e Recuperar senha (`static/js/auth-screen.js`), armazenamento de tokens e contas salvas cifrado com DPAPI do Windows vinculado à origem (`src/bin/desktop_auth_storage.rs`, `static/js/auth-storage.js`) e obrigatoriedade de HTTPS fora do loopback.
- **Primeiro acesso, reconexão e modo offline:** fluxo guiado no Início para contas sem servidores, máquina de estados de reconexão automática (`static/js/connection.js`) com backoff e heartbeat, retomada automática da voz, snapshot offline cifrado via DPAPI (`static/js/offline-cache.js`) e fila de envio durável sem duplicação (`static/js/outbox.js`, capacidade `connection_v1`, esquema SQLite `v22` com `delivery_receipts`).
- **Detecção automática de jogos e Rich Presence:** detector nativo Windows (`src/bin/desktop_activity.rs`) com blocklist de sistema/navegadores, catálogo local, manifestos Steam/Epic e gestão de jogos registrados em Configurações → Atividade e Presença; modelo estruturado de Rich Presence (`src/activity.rs`, `static/js/activity.js`) com privacidade, modo Invisível, timer ao vivo e sincronização em tempo real.
- **Pesquisa avançada de mensagens:** evolução sobre o índice SQLite FTS5 (`static/js/search.js`, `src/moderation.rs`) com filtros combináveis (`de:`, `em:`, `tem:`, `menciona:`, `antes:`, `depois:`, `durante:`, `fixadas`), chips removíveis, popover de sugestões e histórico local, paginação real, ordenação (`recent`, `oldest`, `relevance`), highlight seguro, preview inline `Ver contexto` e salto direto (`around_id`).
- **Menu contextual de DM/Amigo, DMs fixadas e Favoritos:** novo menu contextual completo (`static/js/dm-context-menu.js`, sobre `SancordUI` reutilizável, sem "Apps") com *Marcar como lida*, *Fixar/Desafixar* (seção `FIXADAS`), *Adicionar/Remover dos favoritos* (integrado à aba Favoritos), *Perfil*, *Iniciar chamada*, *Adicionar nota* privada, *Fechar mensagem direta* (`CloseDm`), *Convidar para o servidor*, ações dinâmicas de amizade/ignorar/bloquear, *Silenciar @usuário* com notificações integradas e *Copiar ID* com Modo Desenvolvedor.
- **Self Profile Menu compacto e Personalização de Insígnias:** refatoração visual do Self Profile Menu para popover vertical compacto com 2 cards de ações (*Editar perfil* + *Status atual >* ; *Mudar de conta >* + *Copiar ID do usuário* com Modo Desenvolvedor), borda discreta preservando *Profile Frames* reais, ícones de insígnias visíveis no cabeçalho e remoção dos botões *Insígnias* e *Minha coleção* do popover; novo subeditor **Configurações → Perfis → Perfil principal → Insígnias** (`static/js/profile-editor.js`, `src/cosmetics.rs`) para ocultar/exibir (respeitando `can_hide`) e reordenar apenas insígnias realmente possuídas com prévia ao vivo e validação autoritativa no servidor.
- **Polimento visual:** correção de truncamento para nomes longos no painel inferior esquerdo e preservação das personalizações de perfil de membros offline na lista de servidores (`member_roster` com `ProfilePrivacy`).
- O servidor migra automaticamente o SQLite para o esquema `v22` (`delivery_receipts`), preservando todos os dados existentes.

## 0.2.6

- Removido o servidor público "Sancord" (hub), no qual toda conta entrava automaticamente. Contas novas não entram em nenhum servidor por conta própria e o aplicativo abre no Início (amigos e conversas) até a pessoa criar um servidor ou aceitar um convite.
- Ao iniciar a 0.2.6, o servidor apaga de vez o hub antigo do banco: canais, mensagens, threads, convites, eventos, integrações e agendamentos dele. Servidores criados pelas pessoas, conversas privadas e contas não são alterados.
- Excluir ou sair do último servidor leva ao Início em vez de deixar a área de servidor vazia.

## 0.2.5

- Novo **Self Profile Menu** (`static/js/self-profile-menu.js`) no painel do próprio usuário no canto inferior esquerdo: clicar no avatar, nome ou status abre um cartão rápido ancorado acima do dock em vez de ir direto para Configurações, preservando Engrenagem (`⚙`), Microfone (`🎙`) e Fone (`🎧`) independentes.
- Cabeçalho do Self Profile Menu renderizado com o sistema real de perfil (`SELF_PROFILE_MENU`), exibindo banner, avatar, decoração, presença, estilo de nome, `@username`, insígnias reais, tema e moldura com abertura instantânea a partir do cache.
- Ações rápidas com ícones SVG do Sancord, navegação por teclado (`↑`, `↓`, `→`, `←`, `Enter`, `Esc`) e submenus com atraso de intenção no hover e fixação ao clicar: **Editar perfil**, **Status** (`Online`, `Ausente`, `Não perturbe`, `Invisível` em tempo real + modal rápido de **Status personalizado** com emoji e prazo), **Insígnias** (apenas badges reais possuídos), **Minha coleção** (atalhos diretos para cosméticos e presets), **Mudar de conta** (seletor multi-conta com sessões isoladas por servidor) e **Copiar ID do usuário** condicionado ao Modo Desenvolvedor.

## 0.2.4

- Novo ícone do aplicativo Sancord ("Diálogo em S", `icon.ico`, `static/sancord-icon.svg`, `static/logo.png` e pacote de marca em `branding/`).
- Novo editor visual de perfil em 3 colunas (`static/js/profile-editor.js`): lateral de edição com subeditores (`← Voltar` / `Esc`), prévia completa protagonista ao vivo, menu "Pré-visualizar em", mural recolhível (`Mural` / gaveta lateral em telas menores), responsividade progressiva (1366×768, 1600×900, 1920×1080, 2560×1440 e DPIs 100/125/150%), amostras estáticas para os 19 efeitos de perfil e tokens de espaçamento consolidados.
- Refatoração do cartão de perfil e mural (`static/js/profile-card.js`, esquema SQLite `v20`), composer aprimorado com stickers, gravação de áudio e mensagens agendadas (`src/scheduled.rs`, `static/js/scheduled.js`, esquema SQLite `v21`) e melhoria de chamadas desktop/WebRTC.
- Lista lateral de membros refatorada (`static/js/member-list.js`): remoção do cabeçalho global `MEMBROS ONLINE`, agrupamento central sem duplicação por cargos destacados (`hoist`) segundo hierarquia → `Disponível` → `Offline`, cor do nome independente de agrupamento, coroa discreta do proprietário à direita do nome, badge `APP`, linha única de atividade respeitando permissão de canal de voz e atualização realtime otimizada.
- Permissões de microfone e câmera no WebView2 (`src/bin/desktop_permissions.rs`, `webview2-com = "0.33"`) corrigindo chamadas sem áudio no aplicativo Windows.
- Compartilhamento de tela no Windows: suporte a janelas minimizadas e filtragem de janelas fantasmas/DWM-cloaked (`src/bin/capture_bridge.rs`).
- Correções de canais e voz: criação de canal pelo `+` de categoria de voz já seleciona `Voz`, nomes longos de canal não cortam com botões ocultos de hover, e o palco da chamada de servidor não aparece fora de contexto dentro de conversas privadas (DM).

## 0.2.3

- Perfil desktop com cartão rápido, perfil completo e prévias para chat, membros, DMs e painel inferior.
- Aparência por servidor com herança do perfil global, incluindo apelido, avatar, banner, bio, cosméticos (decoração, moldura, efeito, placa e estilo/cores do nome) e tema do cartão, com validação de posse e respeito à privacidade.
- Mural de perfil com edição, ordenação, visibilidade e audiência: jogos, capas, links, bloco personalizado (título, emoji, texto e imagem opcional) e conquistas com selos do Sancord + marcos automáticos (primeiro servidor criado, 5 amigos, 100 e 500 mensagens).
- Minha Coleção com favoritos, itens vistos, presets e combinação aleatória com prévia. O servidor valida a posse dos itens antes de equipá-los.
- Visibilidade do cartão e de campos opcionais aplicada no servidor. Conexões com detecção e seleção de plataformas sociais (GitHub, Steam, Twitch, YouTube, Spotify, X, Instagram, Xbox, PlayStation, TikTok, LinkedIn, Reddit e site), visibilidade individual e verificação do perfil público do GitHub.
- Painel administrativo de selos em Configurações (visível apenas a operadores autorizados), persistindo em `badges.json` com aplicação imediata e proteção contra remoção do último operador.
- Etapa D: chat de texto dentro dos canais de voz (com permissões do canal, histórico, reações, fixados, busca, limpeza ao excluir canal e atalho direto na lista de canais e no palco de chamada) e qualidade de áudio (bitrate `32–256 kbps`) configurável por canal de voz e aplicada na negociação Opus/WebRTC.
- Cinco controles de exibição de cosméticos, controle de animações e limites para GIFs no cliente Windows.
- Melhorias de chat e comunidade, incluindo emojis de servidor, encaminhamento, GIFs, prévias de links, preferências de notificação, tags de fórum e acompanhamento de threads.
- Central de Configurações expandida para aplicativo desktop completo: 22 páginas reais organizadas em 4 grupos (`CONTA`, `PRIVACIDADE E SOCIAL`, `CONFIGURAÇÕES DO APP`, `SANCORD`), busca profunda com rolagem até a opção, coluna de leitura limitada, botão `ESC`, Minha Conta com e-mail parcialmente oculto e ID condicionado ao Modo Desenvolvedor, Perfis Global/por Servidor, Segurança, Dispositivos, Conexões, Conteúdo e Social, Solicitações, Bloqueados, Atividade, Voz e Vídeo (preview de câmera, teste de saída, atraso PTT, padrões de tela), Notificações (matriz de 10 sons com preview), Aparência (zoom, accent customizado, espaçamento de grupos), Acessibilidade (saturação, alto contraste, cores de cargo, TTS, foco reforçado), Chat e Mensagens (Enter vs Ctrl+Enter, emoticons, agrupamento, formato 24h/12h), Idioma + formato regional, gerenciador de atalhos com detecção de conflito, Configurações do Windows (IPC nativo para inicialização/minimizar/pasta de dados), Avançado, Diagnóstico sanitizado e Sobre.
- Sistema completo de convites de servidores: modal central de 2 páginas (`InviteModal`, com busca instantânea de amigos/contatos de DM, envio em 1 clique com trava anti-duplicação, cópia com feedback e configurações de expiração, limite de usos, canal de destino e associação temporária), botão de convite ao passar o mouse nos canais, cartão rico de convite em DMs hidratado ao vivo, modal de prévia antes de entrar (`InvitePreviewModal`) com contagem online/membros, regras de entrada opcionais e estados de erro distintos, códigos criptográficos de 40 bits (`SANC-XXXXXXXX`) com revogação por tombstone (jamais reutilizados), link personalizado por slug (`SetCustomInviteSlug`, validação 3–32 chars + palavras reservadas + unicidade global), pausa/retomada de convites (`SetInvitesPaused`), permissão dedicada `manage_invites` + sobrescrita `create_invites` por canal, limpeza automática de membros temporários sem cargo na desconexão, mensagem de sistema `ServerMemberJoined`, rate limits e gerenciamento em tabela nas Configurações do Servidor → Convites.
- O servidor migra o SQLite até o esquema 19 (`server_members.profile_json` na v17, `channels.bitrate_kbps` na v18 e colunas/índices do sistema expandido de convites na v19), mantendo os dados existentes preservados.

## 0.2.2

- Preferências sincronizadas na conta (`UserPrefs`): notas privadas de perfil,
  usuários ignorados e mensagens favoritas agora acompanham a conta entre dispositivos
  e sessões; lista local legada de bloqueios (`sancord_blocked_users`) removida.
- E-mail opcional da conta e recuperação de senha por código único (`SANC-XXXX-XXXX-XXXX`,
  hash Argon2id de uso único e `POST /api/recover-password`) direto na tela de login.
- Gerenciamento de sessões e dispositivos ativos em Configurações → Minha Conta →
  Senha e segurança (`ListSessions`, `RevokeSession`, encerramento imediato de conexões
  WebSocket revogadas).
- Transferência de posse do servidor (`TransferServerOwnership`) com confirmação e
  registro de auditoria (`server_transfer_ownership`), além de exclusão da própria conta
  (`DeleteAccount`) protegida por senha e verificação de posse de servidores.
- Expulsão e banimento com motivo persistido no SQLite (esquema `v14`, coluna
  `bans.reason`), opção de apagar histórico recente do membro banido (1 h, 24 h ou 7 dias)
  e limpeza de mensagens em lote (`BulkDeleteMessages`) para moderadores.
- Scripts de inicialização e autostart do host no Windows (`scripts/start-host.ps1` e
  `scripts/install-autostart.ps1`).
- Banco migra para a versão 14 ao iniciar o servidor.

## 0.2.1

- Refatoração visual desktop: tokens e paleta próprios, ícones SVG consistentes,
  colunas e controles compactos, chat/composer, membros, perfis, menus e configurações.
- Início de canal contextual, estados vazios compartilhados, membros offline reais,
  tooltips acessíveis e confirmações integradas ao aplicativo.
- Confirmações recebem foco e contêm a navegação por teclado; ensaios de DOM e
  contraste dos temas passam a integrar o CI. Ícones de reordenação e contraste de
  rótulos secundários em Aparência, perfis, atalhos e tema Claro corrigidos.
- Candidata local: testes automatizados aprovados; homologação visual nativa e CI do
  commit com a refatoração ainda pendentes. Esta alteração não publica uma release.
- Castigo (timeout) de membros: duração de 60 segundos a 28 dias, motivo na auditoria,
  validação no servidor e fim automático. Nova permissão "Aplicar castigo".
- Modo lento por canal (de 5 segundos a 6 horas), com contagem regressiva no campo de
  mensagem. Moderadores ficam isentos.
- Tags nos fóruns: até 20 por fórum (algumas só a moderação aplica), até 5 por postagem e
  filtro por tag.
- "Exibir status Está digitando", Modo Foco e Proteção de Links Externos agora funcionam.
  O Status da conta mostra os castigos ativos.
- Textos de segurança corrigidos: só as chamadas têm criptografia entre participantes, as
  mensagens não.
- Banco migra para a versão 13 ao iniciar o servidor.

## 0.2.0

- Auditoria persistida, AutoMod configurável e busca no histórico com filtros e
  verificação de acesso aos canais.
- Enquetes, eventos, threads e fóruns com persistência e permissões herdadas.
- Notificações por servidor/canal, navegação rápida, atalhos, responsividade,
  melhorias dos temas e estrutura de idioma pt-BR com inglês preview.

- Integrações HTTP por canal: bots de envio e webhooks com token revogável, rotação,
  persistência, auditoria, AutoMod e mensagens em tempo real (schema v10).
- Proteção de autoria de integrações, contraste nos ajustes/convites e captura de
  microfone iniciada somente por chamada/teste explícito.
- Preparação de homologação desktop e ensaio seguro de migração em cópia do banco.
- Correção do botão Depois no updater: adiar uma versão preserva o aviso de versões
  posteriores; verificar manualmente reapresenta a atualização adiada.
- Testes HTTPS automatizados de detecção, download, progresso e falhas do updater,
  com ensaio adicional do artefato real assinado pelo CI.
- Publicação condicionada também à validação HTTPS do pacote real já assinado,
  executada em um job Windows/MSVC separado e sem acesso à chave privada.

- Continuação do polimento: traduções dinâmicas da navegação rápida, atalhos e
  diálogos; preservação de nomes e conteúdo do usuário.
- Correções dos limites efetivos do cache de imagens e validação de idioma salvo.

- Câmera: seleção de webcam e qualidade nas configurações de Voz e vídeo.
- Cancelamento de câmera/tela ao sair ou trocar de canal; limpeza de recursos e
  tratamento de perda da ponte de captura.
- Correções na identificação de streams remotos e novas verificações de vídeo.
- Fase 7 em validação: teste local de tela relatado pelo usuário; webcam física
  e cenários entre redes diferentes ainda pendentes.
- Candidata em homologação: testes locais e migração da cópia aprovados; CI final
  Windows/MSVC, pacote assinado final e ciclo público de atualização ainda exigem
  validação. Nenhuma publicação estável é autorizada por este changelog.

## 0.1.0

- Cliente Windows com interface embutida no executável.
- Chat persistido, permissões de canais e recursos sociais.
- Voz em desenvolvimento, com moderação e correções de reconexão.
- Atualizações do cliente por GitHub Releases, com assinatura Ed25519 e SHA-256.
- Áudio entre máquinas e o primeiro ciclo público do updater ainda exigem validação.
