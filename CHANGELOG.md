# Histórico de versões

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
