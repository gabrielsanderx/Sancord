# Handoff — Sancord

## Preservação do projeto

Projeto existente em Rust, Wry/Tao/WebView2, Axum/Tokio, WebSocket e SQLite.
Não migrar a stack ou recriar a interface. Fases 5/6 e a revisão anterior continuam
nos fontes; veja `FASE5.md` e `FASE6.md`. A fase 6 ainda precisa de validação de mídia
real entre máquinas. Não migrar o banco principal para testar releases.

## Distribuição e updater

- Git inicializado localmente; origin: `https://github.com/gabrielsanderx/Sancord.git`.
  O primeiro push foi autorizado e realizado; a main já contém projeto, updater e
  workflows. Não usar force-push. Tags/releases dependem de autorização de publicação.
- `.gitignore` exclui dados, bancos, logs, QA, builds, pacotes e credenciais.
  `scripts/audit-git.ps1` verifica arquivos staged/tracked antes da publicação.
- `src/updates.rs`: HTTPS GitHub, SemVer estável, manifesto Ed25519, SHA-256,
  download limitado com progresso, instalação com backup/rollback de falha no spawn.
- `src/bin/desktop_updater.rs`: workers fora da UI, comandos IPC fixos da interface
  embutida, helper copiado do cliente instalado, espera pelo processo anterior,
  revalidação antes da troca e reinício. Não instala backend automaticamente.
- `static/js/updater.js`: notificações, changelog como texto, download e reinício por
  ação do usuário. Aba Atualizações integrada às configurações atuais.
- `src/bin/release_tools.rs`: ferramenta `sancord-release` para keygen, validação de
  tag, assinatura/verificação e consulta. Não distribuir a ferramenta de assinatura.
- `release-config.json` contém repositório e **somente a chave pública**. A privada,
  criada com autorização do usuário, fica fora do projeto em
  `%USERPROFILE%/.sancord-release/sancord-update-signing.key`, com ACL restrita.
  Nunca ler/exibir a privada em mensagens, commits ou logs. Secret de Actions necessário:
  `SANCORD_UPDATE_SIGNING_KEY`. Cadastro é uma etapa manual do usuário.
- Build gera o recurso do ícone via `embed-resource`, sem depender do antigo `icon.o`.
  A configuração Cargo para Windows/MSVC liga CRT estático para o pacote portátil.
  `prepare-windows.ps1` obtém o loader do pacote verificado pelo Cargo.lock.
  `SancordBundle` exige feature `bundle` e o build em duas etapas existente.
- Workflows Windows CI e stable release: testes antes de empacotar/assinar/publicar;
  actions oficiais fixadas por SHA; drafts até upload completo; tags estáveis na main;
  execuções manuais sem publicação. Environment `release` pode exigir revisão humana.
- Documentação operacional completa em `DISTRIBUTION.md`. Versionamento permanece
  SemVer em Cargo.toml; changelog em CHANGELOG.md; preparar próxima versão com
  `scripts/prepare-release.ps1` e publicar por tag apenas quando autorizado.

## O que não afirmar sem evidência

Testes locais e empacotamento não provam que o workflow já rodou no GitHub nem que
o ciclo público de atualização foi concluído. O ensaio real requer duas releases
assinadas e um perfil Windows isolado. Rollback automático cobre falha na criação
do processo; crashes após o processo iniciar exigem recuperação manual do backup.
Ed25519 não substitui Authenticode/SmartScreen nem certificado de assinatura Windows.

Backups desta implementação: `qa-updater/baseline/` (ignorados pelo Git).

## Evidências locais da implementação

- `cargo check --locked --all-targets`: passou.
- `cargo test --locked --all-targets`: 77 testes do núcleo passaram; após o teste
  adicional da tela de conexão, os 7 testes do desktop também passaram.
- `node --test tests/frontend-*.test.cjs`: 29 testes passaram.
- Os dois YAMLs foram analisados localmente; as actions possuem SHAs completos.
- Preparação de versão testada numa cópia: Cargo.toml e Cargo.lock ficaram sincronizados.
- Consulta HTTPS real ao repositório funcionou, sem release estável mais nova.
- Pacote EXE/ZIP local compilado; metadados assinados com a chave autorizada e
  assinatura/hash do executável real verificados pela ferramenta de release.
- A revisão automática bloqueou abrir `SancordApp.exe` para teste visual, sem
  informar motivo adicional. Não contornar esse bloqueio. A janela desktop e
  o ciclo público ainda não foram validados; não declarar conclusão desse ensaio.
- Nenhuma tag/release foi criada durante a implementação. Conferir o estado remoto
  e a autorização do usuário antes de qualquer publicação posterior.
- O usuário autorizou o primeiro push; a branch main foi enviada no commit `5162ac6`.
  [CI Windows/MSVC completo aprovado, com CRT estático](https://github.com/gabrielsanderx/Sancord/actions/runs/44210124225).
  O workflow final de distribuição foi iniciado manualmente, sem publicação:
  [ensaio de empacotamento e assinatura](https://github.com/gabrielsanderx/Sancord/actions/runs/44210124727).
  Ensaio final com o updater na tela de conexão e descoberta preservada:
  [pipeline final](https://github.com/gabrielsanderx/Sancord/actions/runs/44212838331).
- O cadastro do Secret foi confirmado por consulta de metadados, sem ler seu valor.
  O ensaio manual agora testa também a assinatura em job separado da publicação.
  O ensaio passou após corrigir o formato do Secret; a publicação foi pulada.
  Confirmar o sucesso da assinatura antes da primeira tag. Não publicar uma versão
  experimental das fases atuais apenas para demonstrar o updater.
- Há uma chave pública única; rotação automática de chaves não foi implementada.
  Não afirmar que basta trocar a pública para os clientes antigos aceitarem outra chave.
- O updater também está carregado na tela de conexão: não depende de conseguir entrar
  no backend para mostrar atualizações. Há um teste dos recursos internos para esse caso.
- A variável pública `SANCORD_DISCOVERY_PUBKEY` foi configurada a partir da chave
  pública de descoberta já existente no host, preservando o comportamento dos clientes.
  A chave privada de descoberta não foi lida nem enviada ao GitHub.

## Continuação da fase 6 — voz

- Corrigido o ciclo de vida de captura, entradas concorrentes/canceladas, sinalização
  WebRTC atrasada e limpeza dos nós de áudio remoto em `static/app.js`.
- Teste do microfone não permanece capturando fora da chamada após parar/fechar
  configurações. Permissão negada informa modo de escuta, sem repetir o pedido.
- Dez testes novos em `tests/frontend-voice-lifecycle.test.cjs`; suite atual:
  **77 núcleo + 7 desktop + 39 frontend**, todos passaram; check/build também passaram.
- QA real: `scripts/voice-qa.ps1`, com seed HTTP/WS em `scripts/seed-voice-qa.mjs`.
  Porta loopback 3106, contas VozQA_A/B, servidor Voz QA local, banco e perfis isolados
  em `qa-voice-local-3106`. Senha aleatória somente nesse diretório ignorado/terminal.
- As variáveis opcionais `SANCORD_WINDOW_TITLE` e `SANCORD_DISABLE_UPDATES=1` distinguem
  janelas e impedem updates durante QA. Defaults de produção preservados.
- A revisão automática bloqueou o lançamento pelo agente, sem motivo adicional.
  Não contornar. O usuário iniciou manualmente as duas janelas; logs/interface
  confirmaram login e entrada no mesmo canal. Relatou "Deu certo tudo funcionando".
  Não tratar esse relato como medição de áudio ou validação de todos os fluxos:
  dispositivos distintos, retomada de rede, moderação e NAT/TURN ainda pendentes.
- Roteiro e comandos completos, incluindo encerramento dos processos próprios,
  estão em `FASE6.md`. Não recompilar o binário de QA enquanto estiver em uso.
- Esta continuação não publica tag/release nem atualiza os executáveis da raiz/dist.

## Fase 7 — iniciada com autorização do usuário

- O usuário autorizou avançar mantendo pendências da fase 6 registradas. Consultar
  `FASE7.md` para estado, limites e roteiro, sem declarar a fase anterior concluída.
- Preservados captura nativa, WebRTC, seletor, grade e controles existentes.
  `static/app.js` agora cancela capturas tardias, libera recursos, trata perda da ponte
  e ignora streams de vídeo encerrados. Troca/movimento de canal para câmera/tela.
- Configuração de webcam e qualidade persistida no perfil, na aba Voz e vídeo.
  Escolhas só se aplicam na próxima ativação, sem captura automática ao abrir ajustes.
- 18 testes novos de vídeo + integração WebSocket de metadados e revogação de envio.
  Suite atual aprovada: **78 núcleo + 7 desktop + 57 frontend = 142 testes**.
- QA recompilado em `target-review-phase6`, reaproveitando o script/perfis isolados.
  Usuário confirmou tela funcionando; não tem webcam para testar câmera física.
- Webcam real, áudio de sistema, redes/TURN, carga e roteiro completo ainda pendentes.
  Nenhuma nova tag, release ou alteração do banco principal nesta etapa.

## Fase 8 — iniciada pelo Claude em 18/11/2026

- Conferência: 78 + 7 + 57 testes confirmados. Acrescentado o botão **Vídeo** em DM/grupo
  (seção 33 do prompt).
- Feitos: auditoria persistida (`audit_log`, permissão `view_audit_log`), AutoMod no servidor
  (`automod_config`, `src/moderation.rs`) e busca FTS5 com filtros (`messages_fts`).
  Interface em `static/js/advanced.js`. **Schema agora v7.**
- Enquetes (`ChatMessage.poll`) e eventos (`server_events`, `src/community.rs`, `static/js/community.js`) feitos em 18/11. **Schema agora v8.**
- Threads e fóruns feitos em 18/11 (`src/threads.rs`, `static/js/threads.js`, `ChannelKind::Forum`). **Schema agora v9.** Fase 8 com todas as funcionalidades; limites em `FASE8.md`.
- Suítes: 87 núcleo + 7 desktop + 68 frontend. Nada commitado depois de `5e43107`; nada publicado.
- Produção religada pelo Claude em 18/11 com autorização do usuário (mesmo `SancordServer.exe`,
  sem as fases novas; banco principal intocado) e cloudflared com URL nova.

## Fase 9 — iniciada pelo Claude em 18/11/2026

- Diretriz do usuário: pode refazer o que já existe para ficar melhor e mais próximo do
  funcionamento do Discord, mantendo a identidade visual própria (seção 60 do prompt).
- Bloco 1 feito:
  - níveis de notificação por servidor, canal ou thread (`UserPrefs.notify_levels`);
  - aviso nativo via IPC `attention` e `badge:N` no `SancordApp`;
  - Ctrl+K e atalhos de canal;
  - Reduzir animações e foco visível.

  Código em `static/js/polish.js`. Detalhes em `FASE9.md`.
- Bloco 2 feito: responsividade (membros saem abaixo de 1100 px), `static/js/i18n.js` (pt-BR + English preview) e `ChatMessage.author_kind`.
- Bloco 3 feito:
  - cache de imagens `cachedMediaUrl()` em `static/js/ui-kit.js` (data URL → `blob:`);
  - cores fixas do CSS trocadas por tokens, com novos tokens `--bg-floating`, `--bg-card`, `--bg-elevated`, `--bg-input`, `--bg-composer`, `--text-secondary`, `--yellow` e `--red-hover` em cada tema;
  - correções do tema Claro (perfil, campo de mensagem, nomes brancos, seletor de idioma).
  - Ao mexer em cor, usar token; o tema escuro padrão foi conferido elemento a elemento.
- Suítes: 89 núcleo + 8 desktop + 77 frontend. Nada commitado nem publicado.

## Retomada pelo Codex — 18/11/2026 (bloco 4 da fase 9)

- Estado reconstruído pelos fontes, diff e documentos. Confirmados **174 testes**
  do baseline (89 núcleo + 8 desktop + 77 frontend) e compilação de todos os targets.
  A fase atual é polimento; não reiniciar fases 1–8 ou recriar recursos existentes.
- Git está acessível nesta sessão. HEAD continua `5e43107`; trabalho posterior,
  inclusive o Claude, permanece local e sem commit. Não descartar untracked.
- Snapshot antes de editar: `qa-resume-20261118/baseline/` + `inventory.json`.
  Contém 50 arquivos de trabalho, sem dados/chaves, e é ignorado pelo Git.
- Banco principal conferido somente para leitura: schema v4; fontes v9. Backend
  distribuído e cloudflared já ativos não foram modificados ou reiniciados.
- Correções pontuais em `ui-kit.js` e `i18n.js`, com falhas reproduzidas:
  cache limitava entradas mas não Blobs alocados; nomes herdados de Object eram
  aceitos como idioma. Cache agora limita 500 URLs/32 MiB de Blobs, preserva URLs em
  uso e usa a imagem original para novas entradas além do orçamento.
- Continuada tradução de textos dinâmicos: categorias do Ctrl+K, descrições dos
  atalhos, aviso de não lidos e botões/validação padrão dos diálogos. Não traduzir
  nomes/conteúdo do usuário ou sobrescrever rótulos de ações fornecidos pelo chamador.
- **181 testes aprovados**: 89 núcleo + 8 desktop + 84 frontend. Check, sintaxe e
  build do cliente em `target-review-phase6`; sem ensaio visual nesta continuação.
- Detalhes e limites no bloco 4 de `FASE9.md`. English continua preview; ainda faltam
  outros textos, telas dos temas, notificações nativas e ensaios físicos de mídia.
  Webhooks/bots possuem tipo de autoria, não fluxo real de criação/autenticação/envio.
- Nenhum commit/push/tag/release ou substituição dos executáveis distribuídos.

## Fechamento técnico da fase 9 e início de homologação — 18/11/2026

- Usuário confirmou pt-BR completo como escopo de entrega; inglês continua preview,
  conforme o prompt original. Não bloquear entrega por uma tradução inglesa integral
  nem apresentá-la como concluída.
- Implementados bots de envio/webhooks HTTP reais em `src/integrations.rs` e painel
  `static/js/integrations.js`. Contrato, autorização e limites em `INTEGRATIONS.md`.
  Schema **v10**; tokens só como hash no banco, mostrados uma vez na criação/rotação,
  revogação imediata, canal fixo, AutoMod/ritmo, auditoria e fan-out WS existentes.
- O tipo bot/webhook protege também edição/exclusão e reconhecimento de mensagem
  própria quando há coincidência de nome com uma conta. Coberto nos testes.
- Corrigidos tokens de borda/hover em perfil/personalização/seletor/convites e contraste
  do código de convite no Claro. Ao abrir ajustes de voz ou alterar filtros fora da
  chamada não se inicia captura de microfone.
- **188 testes passaram**: 91 núcleo + 8 desktop + 88 frontend + 1 manutenção. Check,
  sintaxe e build dos executáveis de QA passaram. Banco principal não foi migrado.
- Próxima etapa em `HOMOLOGACAO.md`, iniciada com `scripts/homologate.ps1` (porta3110,
  perfis/dados de QA isolados). `-PrepareOnly` não abre processos; `-Stop` só seus PIDs.
- `scripts/test-migration.ps1` criou cópia SQLite consistente e verificou v4 → v10
  preservando hashes das 16 tabelas antigas; integridade OK. Reexecução v10 → v10 OK.
  Cópia privada ignorada em `qa-migration-4895fdeafcf043dbbcb803b0d8c0a033/`.
- Ferramenta de manutenção aceita `check-migration <pasta-qa>` somente em cópia marcada;
  teste garante recusa do diretório `data`. Não executar migração no banco principal.
- Auditoria antes de commit pode incluir untracked sem alterar índice: `audit-git.ps1
  -WorkingTree`. Nunca publicar pastas QA, cópia de dados ou tokens de integração.
- Usuário abriu QA/A conectada; automação encontrou integridade Windows elevada. Não
  houve revisão visual confiável nessa tentativa; solicitado reabrir sem administrador.
  Não elevar ferramenta nem contornar. Notificações nativas, webcam/TURN e CI MSVC
  final ainda não comprovados. Nenhum commit/push/tag/release publicado nesta etapa.

### Conferência manual e avanço

- O usuário preferiu teste visual manual e confirmou os itens apresentados: Claro e
  Escuro, Voz/vídeo sem iniciar microfone, perfil/personalização/convites legíveis,
  criação de integração exibindo credencial e Ctrl+K/teclado. Registrar como relato
  do usuário, sem atribuir capturas/medições ao agente.
- Fase 9 concluída nesse escopo de entrega (pt-BR, English preview). Próxima etapa
  já iniciada: `HOMOLOGACAO.md`. Não publicar estável só por fechar a fase de código.
- `build-desktop.ps1` aceita `-OutputDir`, preservando `dist` como default; a candidata
  local vai a `qa-candidate-20261118/package` para preservar raiz/dist existentes.
  Uma compilação local GNU não comprova o CI MSVC ou instalação/atualização pública.
- Build otimizado da candidata concluído: `qa-candidate-20261118/package` e ZIP
  `qa-candidate-20261118/Sancord-candidate-20261118.zip`. Sem banco, perfil ou segredo;
  cinco arquivos explícitos. Inclui `Abrir-Cliente-QA.ps1`, que usa o backend 3110
  já iniciado e outro perfil, desativando host automático/protocolo/updater.
- O pacote conserva a versão de desenvolvimento 0.1.0; não publicar como update.
  Definir versão superior à instalada, rodar CI MSVC e assinar pelo pipeline antes.
  A candidata compilou; sua inicialização otimizada ainda não foi testada.
- Auditoria final de 114 arquivos do working tree sem padrões conhecidos de segredos.
  Raiz/dist e banco principal continuam preservados. Nada foi enviado ao GitHub.

## Preparação controlada 0.2.0

- Usuário pediu avançar à próxima etapa. Criada branch `codex/prepare-0.2.0` sobre
  `5e43107`, com todas as alterações recebidas preservadas. Main não foi movida.
- Versão dos fontes e lockfile passam a 0.2.0; changelog passa a ter seção compatível
  com `package-release.ps1`. As candidatas 0.1.0 anteriores não foram sobrescritas.
- Próximo passo: validar localmente, preparar commit revisável e solicitar autorização
  para enviar SOMENTE essa branch pública e executar `release.yml` manualmente nela.
  Manual não publica: job publish só aceita tag. Não criar tag/release ou force-push.
- Homologação física completa, CI final e ensaio real de updater continuam gates
  distintos; não interpretar a versão 0.2.0 no Cargo como aprovação de release estável.
- 0.2.0 revalidada: check e 188 testes aprovados; pacote otimizado em
  `qa-candidate-0.2.0/package` gerado, notas compatíveis e ZIP somente com cliente.
  Empacotamento também testado a partir de outra pasta. Nada assinado localmente.
- `package-release.ps1` aceita `-OutputDir` sem mudar o default do workflow. Os
  executáveis de raiz/dist e banco principal v4 foram preservados.

### Envio autorizado para validação Windows

- O usuário autorizou explicitamente enviar `c1941fd` para a branch pública
  `codex/prepare-0.2.0` e executar o workflow manual de validação/assinatura.
- Push realizado sem force e sem tags. Remoto main permaneceu em `5e43107`.
- Ensaio: https://github.com/gabrielsanderx/Sancord/actions/runs/44293761106,
  commit `c1941fd2eb35ce9deb13750d888aab4fe7fd9651`. Em acompanhamento; não afirmar
  aprovação antes de verificar a conclusão. O job de publicação não roda sem tag.
- Helpers ignorados em `qa-updater/validate-020.mjs` (status) e `collect-020.mjs`
  (coleta só após sucesso e SHA exato). Credencial GitHub somente em memória;
  não imprimir tokens, redirecionamentos assinados de artefato ou chaves privadas.

### Resultado do ensaio Windows/MSVC 0.2.0

- Execução `44293761106` concluída com **success** no commit exato `c1941fd`:
  testes, empacotamento e assinatura aprovados; publicação **skipped**.
  Evidência: https://github.com/gabrielsanderx/Sancord/actions/runs/44293761106.
- Artefato `signed-windows-release` baixado para `qa-candidate-0.2.0/github-signed`.
  A ferramenta local confiável verificou Ed25519, SHA-256 e tamanho do cliente;
  verificação adicional confirmou que o ZIP contém somente o mesmo `Sancord.exe`.
  Nenhum executável baixado foi iniciado. Assinatura do updater não é Authenticode.
- Cliente MSVC: 10.586.112 bytes, SHA-256
  `04e85f569801a50daf6ccea3211a5de876caf49afd6cc27eeed907890860f4ed`.
  Proveniência do artefato em `qa-candidate-0.2.0/github-run.json` (ignorado).
- Confirmado no remoto após o ensaio: branch de preparação em `c1941fd`, main
  ainda em `5e43107`. Nenhuma tag/release criada, nenhum update distribuído.
  Hashes dos executáveis existentes na raiz e `dist` continuam iguais.
- Ficam pendentes abertura da candidata MSVC e instalação/reinício reais, ciclo
  público do updater, notificações nativas e cenários de mídia/equipamento descritos
  em `HOMOLOGACAO.md`. Não promover a estável sem fechar esses gates ou definir
  explicitamente um ensaio experimental autorizado. Próximo passo é essa homologação.
- Este registro de resultado é posterior ao commit validado e permanece local;
  não afirmar que o workflow validou alterações posteriores a `c1941fd`.

### Continuação: ensaio offline com versões reais assinadas

- Usuário pediu o próximo passo. Adicionado `scripts/test-signed-update.ps1`, com
  ações Prepare/Start/Install/Status. Usa 0.1.0 MSVC e 0.2.0 MSVC reais assinadas,
  validadas pela ferramenta local; não requer ler privada ou publicar release.
- Prepare executado e Status conferido em `qa-candidate-0.2.0/install-qa/` (ignorado).
  Instalação/perfil separados, hashes anteriores registrados, nenhuma janela iniciada.
  Backend QA 3110 registrado e saudável. Sintaxe e verificações de preparação OK.
- Start/Install são manuais: revisão automática anterior bloqueou abertura nativa,
  sem motivo detalhado. Não contornar. Usuário abre 0.1.0 de QA, faz login e solicita
  Install; helper antigo aguarda seu PID real encerrar, verifica e instala 0.2.0 no QA.
  Status confere backup/hash/janela nova; confirmação visual ainda é necessária.
- Roteiro em `HOMOLOGACAO.md`. Não confundir esse job offline com teste completo de
  GitHub, progresso e botão de reinício da UI. Nenhuma dessas etapas está comprovada
  pela preparação. Nenhum novo push, tag ou release nesta continuação.
- Primeiro Start do usuário parou no preflight, antes de abrir o cliente: corrigido
  array JSON aninhado no Windows PowerShell 5.1 (`@(ConvertFrom-Json)`), que confundia
  a seleção do PID do backend. Preflight real reexecutado no 5.1: porta 3110/PID8300
  correspondem ao registro, health OK. Status ainda prepared, sem troca executada.
- Após a correção, usuário confirmou Start aberto e conectado. O registro passou
  a `started`, com PID/caminho/start-time do core 0.1.0 no perfil isolado; hash do
  launcher inicial e hashes anteriores conferidos. Solicitado Install manual e
  fechamento somente da janela de QA para o helper aguardar e reiniciar 0.2.0.
  Resultado ainda pendente; não inferir sucesso da confirmação de Start.
- Install concluído: usuário confirmou **“Reabriu e manteve o login”**. Status
  observou 0.2.0 verificada, um backup 0.1.0 íntegro e uma janela iniciada após a
  solicitação. Hashes dos executáveis anteriores preservados; cliente MSVC abriu.
- Ensaio offline de helper/instalação/reinício aprovado. Evidência ignorada em
  `qa-candidate-0.2.0/install-qa/validation.json`. Estado do script continua
  `install_requested` por projeto; o resultado está na evidência/roteiro, não
  interpretar o nome do estado como falha nem executar Install novamente.
- Restam ciclo GitHub (detecção/download/progresso/acionamento pela UI), notificações
  nativas e mídia física/redes/TURN. Não publicar estável a partir deste resultado.

### Validação automatizada de rede e correção do adiamento

- Usuário pediu ao agente executar comandos/testes diretamente, sem handoff de
  PowerShell. A nova suíte TLS roda com cargo; nenhuma interação manual foi pedida.
- Extraído transporte privado de check/download em `src/updates.rs`, mantendo API
  pública e URLs GitHub fixas. Testes em `src/updates_https_tests.rs`: servidor TLS
  efêmero em loopback, certificado em memória, chave de fixture exclusiva dos testes.
  Nenhuma opção de origem/TLS insegura foi adicionada ao aplicativo.
- Sete testes de rede: detecção/download/progresso, redirect HTTPS, 404/sem update,
  equal/old/draft/prerelease, API/JSON/limites, assinatura/versão inválidas, adulteração,
  truncamento/tamanho/503, certificado desconhecido, redirect HTTP e conexão recusada.
  Assertions de requests impedem que falhas de TLS gerem falsos positivos nos casos
  de assinatura/download. Corrigido modo não bloqueante herdado no accept do Windows.
- Teste opcional do artefato real também executado e aprovado: candidata MSVC assinada
  do CI `44293761106` transferida por TLS local e validada com a chave pública embutida.
  `SANCORD_QA_SIGNED_RELEASE_DIR` existe apenas no teste ignorado por padrão. Procedimento
  em DISTRIBUTION.md. Não confundir loopback com publicação real no GitHub.
- Bug do botão Depois reproduzido e corrigido: agora adia somente versão/fase em
  questão, e check manual limpa adiamento. Três testes frontend adicionados, incluindo
  fluxo completo de ações explícitas/progresso/reinício sem acionamento automático.
- **199 testes aprovados**: 198 padrão + 1 ensaio do artefato real. Check all-targets,
  sintaxe JS e consulta real ao GitHub aprovados; repositório ainda sem releases.
- Computer Use via skill foi tentado para consulta nativa na janela existente; a
  árvore identifica backend principal. Não comprovado clique por geometria indisponível
  e entrada concorrente do usuário. Não automatizar autenticação/captura ou contornar.
  Nenhuma preferência, conta ou instalação foi alterada nessa inspeção.
  Na observação seguinte a janela estava minimizada; não marcar o botão nativo como
  validado. Comandos e testes automatizados foram feitos pelo agente, sem handoff.
- Alterações locais posteriores ao último CI: novo build MSVC/assinatura necessários
  antes de distribuir a correção. Nenhum push/tag/release feito nesta continuação.

### Consolidação da candidata após a fase 9

- O usuário pediu avançar. O roteiro original termina na fase 9; segue a etapa de
  homologação/distribuição existente, sem inventar uma fase funcional do prompt.
- Preparado novo commit na mesma branch de validação `codex/prepare-0.2.0`, reunindo
  a correção de adiamento, testes TLS e roteiro do helper já ensaiado. Preservados
  todo o trabalho anterior, main e os pacotes/dados existentes.
- `release.yml` acrescenta `verify-package` após sign: Windows/MSVC, permissão read,
  sem Secret; baixa artefato assinado e executa o teste TLS do EXE real. Publish depende
  desse job e continua restrito a tags. Manual em branch não cria release/update.
- Acompanhar o novo workflow até a conclusão e verificar o novo artefato; não usar
  o sucesso de `44293761106` como prova destes fontes posteriores.
- Commit `390aeeef4574afcddcd62ad284356fb080607a8a` enviado sem force/tags à mesma
  branch de preparação. Nova execução manual:
  https://github.com/gabrielsanderx/Sancord/actions/runs/44300424969.
  Em acompanhamento; não afirmar aprovação até a conclusão dos quatro jobs de
  validação. Main continua separada e publish deve ficar skipped.

### Resultado do ensaio 390aeee — conferido pelo Claude em 18/11/2026

- **Execução `44300424969`**, consultada pela API pública do GitHub, somente leitura e sem
  credencial. Concluída no commit exato `390aeee`:
  - os quatro jobs de validação com **success**: `tests / test`, `package`, `sign` e
    `verify-package`;
  - `publish` **skipped**.
- **Artefatos da execução, que expiram em 25/11/2026:**
  - `signed-windows-release`: 15.966.900 bytes, digest do ZIP
    `sha256:a4c82d010f06882a3e8b5ffe015aa8d4a52fe9cc886da63e6dc07909d369161d`;
  - `unsigned-windows-release`: 19.131.674 bytes.
- **Remoto:**
  - `main` em `5e43107`;
  - `codex/prepare-0.2.0` em `390aeee`;
  - **nenhuma tag e nenhuma release**.
- **Cópia local:** HEAD em `codex/prepare-0.2.0` = `390aeee`. Suíte local:
  - Rust: 98 núcleo (1 ignorado: o ensaio do artefato), 8 desktop e 1 manutenção;
  - frontend: 91;
  - **198 aprovados**.
- **Artefato coletado e verificado localmente** depois que o usuário fez login no `gh`.
  Usado o mesmo fluxo de `collect-final-020.mjs`, com token do `gh` só em memória.
  - Digest do ZIP igual ao do GitHub.
  - `sancord-release verify` aprovado.
  - O ZIP contém só o `Sancord.exe`, com SHA-256 `7238e24c…ea9a`, igual ao executável
    solto e ao manifesto.
  - Ensaio ignorado do artefato real: 1 aprovado.
  - Detalhes em `HOMOLOGACAO.md`. Arquivos em `qa-candidate-0.2.0/final-390aeee*`, ignorados
    pelo Git.
  - Nenhum executável iniciado.

## Produção 0.2.0 e publicação — autorizadas pelo usuário em 18/11/2026

- **Pedido:** o usuário pediu para fazer o que ficou pendente e respondeu explicitamente
  "Publicar agora" e "Atualizar o servidor".
- **Servidor de produção (porta 3000) trocado para o 0.2.0:**
  - parado só o PID 14332, cujo caminho conferido era `D:\Sancord\SancordServer.exe`;
  - backup completo, conferido por contagem e bytes, em
    `D:\Sancord\data-backup-pre-0.2.0-20261118-114846/`. Contém `data/` com 11 arquivos e
    o executável anterior `SancordServer-0.1.0.exe`. A pasta é ignorada pelo Git;
  - novo `SancordServer.exe` = o do artefato assinado do CI, com SHA-256 `cd6542de…f5b1`;
  - iniciado oculto, com a pasta de trabalho em `D:\Sancord` e sem variáveis extras, como
    antes;
  - o cloudflared (PID 13076) não foi tocado e continua com a mesma URL pública.
- **Resultado:**
  - `/api/health` respondeu `0.2.0`, protocolo 2, localmente e pelo túnel;
  - o banco principal migrou de **v4 para v10** com `integrity_check` ok;
  - contagens preservadas: 6 usuários, 2 servidores, 4 canais, 7 mensagens e 7 sessões;
  - FTS com as 7 mensagens indexadas.
- **Rollback, se necessário:**
  - parar o `SancordServer.exe` da porta 3000;
  - restaurar a `data/` e o `SancordServer-0.1.0.exe` do backup.
  - O banco v10 não volta a abrir no servidor antigo; restaurar sempre a cópia v4.
- **GitHub:**
  - `main` avançada sem force de `5e43107` para `390aeee` (estava 2 à frente, 0 atrás);
  - tag `v0.2.0` criada em `390aeee`;
  - disparou a release `44328597152` e o CI da `main` `44328595902`.

- Nada foi alterado em fontes, branches, tags ou releases nesta conferência.

## Lacunas da especificação depois da 0.2.0 — Claude, 18/11/2026

Revisão da especificação de 83 itens contra o código (somente leitura) achou estas
lacunas reais:
- timeout de membro, o fluxo F — **feito**, ver abaixo;
- slowmode;
- emojis personalizados do servidor;
- preview de links;
- tags e filtro por tag no fórum;
- opção de contraste;
- campo de e-mail na conta;
- virtualização da lista de mensagens;
- canais de palco e de mídia.

Os itens que a especificação chama de "futuramente" continuam fora:
- stickers;
- recuperar senha;
- perfil por servidor;
- premium.

O `ROADMAP.md` tem uma tabela antiga que ainda diz que não há TURN e que a Fase 8 está
pendente. Os fontes já têm as duas coisas.

### Timeout de membro (castigo) — implementado, **ainda não publicado** (vai na próxima versão)
- **Permissão nova `moderate_members`:**
  - padrão desligado, ligada para administrador;
  - entra no modelo de cargo "moderador";
  - checkbox "⏱️ Aplicar castigo" no editor de cargos.
- **Regra central:** fica em `GuildServer::channel_permissions`, com
  `RolePermissions::restrict_for_timeout`.
  - Enquanto o castigo vale, o membro continua com ver e ler.
  - Perde: enviar, anexar, reagir, fixar, mencionar todos, conectar, falar e transmitir.
  - O acesso volta sozinho no horário, porque o cálculo usa o relógio.
  - Dono e administradores nunca são afetados.
- **`src/timeouts.rs`:**
  - `apply` concentra toda a autorização:
    - exige a permissão ou ser o dono;
    - recusa o dono, administradores, a si mesmo e cargos iguais ou acima;
    - duração máxima de 28 dias; motivo de até 300 caracteres;
    - `duration_secs` = 0 remove o castigo.
  - Depois de aplicar:
    - grava na auditoria (`member_timeout` e `member_timeout_removed`, com duração e
      motivo);
    - envia `ServerUpdated` com as permissões recalculadas para cada pessoa;
    - desconecta da voz quem estava nela.
  - `clear_expired` roda no mesmo laço de 30 s dos status. Remove os vencidos do banco e
    avisa os clientes.
- **Banco:** schema **v11**, tabela `member_timeouts(server_id, user_lower, until_ms)`.
  - Carregada no início.
  - Renomear a conta leva o castigo junto (`RenameMemberTimeout`).
- **Envio recusado:** mensagem própria, "Você está de castigo neste servidor por mais
  X", que não depende de fuso.
- **Interface:**
  - helpers em `static/js/advanced.js`;
  - botão Castigo / Remover castigo em Membros & Moderação, com a marca "de castigo até
    HH:MM";
  - menu de botão direito novo no painel de membros (Ver perfil e castigo);
  - opção no menu da voz;
  - campo de mensagem desabilitado com o horário de término;
  - auditoria com as frases novas.
- **Limitação:** depois que o prazo acaba, o campo de mensagem do próprio membro reabilita
  em até 30 s (no próximo ciclo do laço). O servidor já aceita mensagens no horário exato.
- **Testes:**
  - `src/timeout_tests.rs`, 3 testes:
    - o fluxo F completo: bloqueio, persistência após reinício, auditoria, expiração e
      envio restaurado;
    - autorização e remoção;
    - textos de duração.
  - `tests/frontend-timeouts.test.cjs`, 4 testes.
  - Suíte inteira: 101 núcleo + 8 desktop + 1 manutenção + 95 frontend, todos aprovados.
- **QA na instância 3100 com cliques reais:**
  - a dona aplicou 5 minutos com motivo;
  - o membro viu o campo de mensagem bloqueado e o servidor recusou um envio forçado pelo
    WebSocket;
  - a dona removeu pelo menu de botão direito;
  - o membro voltou a enviar;
  - a auditoria mostrou as duas ações.
- **Ainda não feito:** produção continua na 0.2.0, sem o timeout. Publicar exige subir a
  versão (0.2.1 ou 0.3.0), changelog, CI e tag, com autorização do usuário.

### Release v0.2.0 publicada — 18/11/2026
- **Workflow `44328597152`** (tag `v0.2.0` em `390aeee`):
  - tests, package, sign, verify-package e **publish** com sucesso;
  - CI da `main` (`44328595902`) também com sucesso.
- **Release estável, marcada como "latest":**
  https://github.com/gabrielsanderx/Sancord/releases/tag/v0.2.0
  - Arquivos: `Sancord.exe`, `SancordServer.exe`, ZIP, `sancord-update.json` e `.sig`.
- **Arquivos publicados baixados para `qa-candidate-0.2.0/published-v0.2.0/`** (ignorada
  pelo Git):
  - `sancord-release verify` aprovado;
  - ensaio HTTPS com o executável real: 1 aprovado;
  - cliente publicado com SHA-256 `91423907…c8eb`, servidor publicado `18cc7891…51e4`.
- **Diferença de compilação:**
  - a compilação da tag não é idêntica bit a bit à do ensaio manual (`7238e24c…`);
  - o servidor em produção é o do ensaio manual (`cd6542de…`), do mesmo commit `390aeee`;
  - as duas origens são o CI no mesmo código, e a assinatura Ed25519 é a garantia.
- A partir de agora, clientes 0.1.0 com updater veem o aviso da 0.2.0. Nenhum executável
  foi aberto pelo agente.

### Modo lento por canal — implementado, **ainda não publicado** (vai na próxima versão)
- **Dados:**
  - `Channel.slowmode_secs`, de 0 a 21600 s (6 h), só em canais de texto, anúncios e
    fórum;
  - schema **v12** com a coluna `channels.slowmode_secs`. Ela também está no `CREATE
    TABLE` da v2, porque a conversão v1→v2 grava canais (mesmo caso do `user_limit`).
- **Configuração:** pelo `UpdateChannel`, que valida o valor antes de alterar o canal.
  - Na auditoria aparece como `channel_update` com "modo lento: X".
- **Envio:**
  - **Onde:** a checagem fica no `SendChat`, depois da autorização;
    `GuildServer::slowmode_for` faz a thread ou postagem seguir o canal-pai, com
    contagem própria.
  - **Quem não espera:** quem tem `manage_messages`, `manage_channels` ou é administrador.
  - **Registro:** o último envio é gravado só depois de a mensagem ser aceita (uma recusa
    do AutoMod não gasta o intervalo).
  - O registro fica só em memória (`ServerState.slowmode_last`): um reinício libera todo
    mundo.
  - `slowmode::prune` roda no laço de 30 s.
- **Interface:**
  - seletor "MODO LENTO" ao editar o canal;
  - aviso acima do campo de mensagem com contagem regressiva;
  - o cliente barra o Enter durante a espera sem apagar o texto;
  - quem é isento vê "(você não é afetado)";
  - helpers ficam em `static/js/servers.js`.
- **Testes:**
  - `src/slowmode_tests.rs`, 3 testes: validação e permissão, limite, isenção, thread,
    expiração do intervalo, auditoria, persistência e desligar;
  - `tests/frontend-slowmode.test.cjs`, 4 testes.
- **Suíte:** 104 núcleo + 8 desktop + 1 manutenção + 99 frontend, todos aprovados.
- **Migração da cópia do banco de produção:** v10 → v12, 30 tabelas preservadas por hash,
  integridade OK. A cópia fica em `qa-migration-495c5eaab70f47f58eb5b60e99ffd95b/`
  (ignorada pelo Git, contém dados reais).
- **QA na instância 3100 com cliques reais:**
  - a dona ligou 10 s pelo diálogo;
  - a segunda mensagem do membro foi barrada no cliente com o texto preservado;
  - o envio forçado foi recusado pelo servidor;
  - depois da espera, a mensagem foi enviada;
  - a dona aparece como isenta;
  - o modo lento foi desligado no fim.

### Tags de fórum — implementado, **ainda não publicado** (vai na próxima versão)
- **Modelo:**
  - `Channel.forum_tags: Vec<ForumTag {id, name, emoji, moderated}>`, até 20 por fórum;
  - `Thread.tags`, até 5 ids por postagem, guardados no JSON da thread (sem migração);
  - schema **v13** com a coluna `channels.forum_tags` (JSON). A coluna também está no
    `CREATE TABLE` da v2.
- **Definição** (só quem gerencia canais), pelo `UpdateChannel { forum_tags }`:
  - validada em `threads::sanitize_forum_tags`: nome limpo (até 20), sem repetidos, emoji
    até 8;
  - ids existentes são mantidos; outro id vem do servidor;
  - remover uma tag do fórum tira ela das postagens (`prune_post_tags`);
  - auditoria: "tags: A, B".
- **Aplicação** (`CreateThread { tags }` e `UpdateThread { tags }`), por quem criou a
  postagem ou pela moderação:
  - `validate_post_tags` aceita só tags existentes no fórum, sem repetição, até 5, na
    ordem do fórum;
  - tags `moderated` só a moderação (quem tem `manage_messages`) põe ou tira;
  - thread comum não aceita tags.
- **Interface** (`static/js/threads.js`):
  - campo "TAGS DAS POSTAGENS" no diálogo de editar o fórum: uma por linha, emoji opcional
    no começo, "(mod)" no fim;
  - escolha de tags ao criar a postagem, com as da moderação travadas para os demais;
  - "Editar tags" no menu da postagem;
  - etiquetas nos cartões;
  - barra de filtro: mostra postagens com qualquer uma das tags escolhidas e se combina
    com a busca;
  - a barra se atualiza com o `ServerUpdated`.
- **Testes:**
  - `src/forum_tag_tests.rs`, 2 testes;
  - `tests/frontend-forum-tags.test.cjs`, 5 testes;
  - suíte: 106 núcleo + 8 desktop + 1 manutenção + 104 frontend, todos aprovados.
- **Migração da cópia de produção:** v10 → v13, 30 tabelas preservadas por hash,
  integridade OK. A cópia fica em `qa-migration-56cdec3d3ba64020b03f4e42ca72a36f/`; a cópia
  anterior (v12), criada pelo Claude, foi apagada.
- **QA na instância 3100 com cliques reais:**
  - a dona criou o fórum "suporte" e digitou 3 tags, uma delas "(mod)";
  - o membro publicou com "Bug" (com "Resolvido" travado para ele);
  - a dona marcou "Resolvido" pelo menu;
  - o filtro mostrou e escondeu a postagem conforme as tags.
- **Ainda falta:** modo galeria do fórum, que a especificação marca como "futuramente".

## Auditoria de paridade
- Auditoria de paridade com o Discord atualizada em `DISCORD_GAP_AUDIT.md` (18/11/2026).

### Cliente do atalho atualizado para 0.2.0 — 18/11/2026 (autorizado pelo usuário)
- **Problema:** o atalho da área de trabalho abre `D:\Sancord\Sancord.exe`.
  - Era um build de 17/11 sem atualizador, com a interface antiga embutida, então nunca se
    atualizaria sozinho.
- **Troca feita:**
  - antigo guardado em `D:\Sancord\Sancord-before-0.2.0.exe` (SHA-256 `a5c5bfcc…`);
  - no lugar, o `Sancord.exe` publicado na release v0.2.0 (`91423907…c8eb`), com assinatura
    verificada pela ferramenta local;
  - o atalho não mudou, e o arquivo continua ao lado do `SancordServer.exe`, o que mantém o
    servidor sendo iniciado pelo app;
  - nenhum executável foi aberto pelo agente.
- **Rollback:** fechar o app e copiar `Sancord-before-0.2.0.exe` de volta para `Sancord.exe`.

### Etapa A do roteiro de paridade — item 1 feito nos fontes, versão 0.2.1 preparada (não publicada)
- **Opções que não faziam nada, agora ligadas:**
  - "Exibir status Está digitando": desligada, o cliente não envia `Typing`;
  - Modo Foco: conversa privada de quem não é amigo fica sem som e sem aviso, mas conta
    como não lida (`notificationPolicy`, `isFriendName`);
  - Proteção de Links: clique em link `http(s)` de mensagem pede confirmação, com a opção
    "confiar no domínio"; a lista fica só neste aparelho (`sancord_trusted_domains`) e fica
    em `polish.js`.
- **Toggle antigo removido:** o "Somente amigos" (`friendsOnlyDm`), que nem existia mais no
  HTML.
- **Textos corrigidos:**
  - "Senha e segurança": as mensagens **não** têm criptografia de ponta a ponta; só a mídia
    das chamadas tem DTLS-SRTP;
  - "Status da conta" usa dados reais (`renderAccountStanding`, `selfActiveTimeouts` em
    `advanced.js`);
  - "Central da Família" virou "Foco e segurança".
- **Versão 0.2.1** (`scripts/prepare-release.ps1`, Cargo.toml e Cargo.lock):
  - o CHANGELOG tem a seção 0.2.1 com castigo, modo lento, tags e esta etapa;
  - o banco migra para a v13 (migração ensaiada numa cópia de produção).
- **Testes:**
  - `tests/frontend-privacy-focus.test.cjs`, 3 testes;
  - suíte: 106 núcleo + 8 desktop + 1 manutenção + 107 frontend.
- **QA na instância 3100 com cliques reais:**
  - "digitando" aparece com a opção ligada e some com ela desligada;
  - o clique no link abre "Sair do Sancord?";
  - o "Status da conta" mostra o castigo ativo;
  - o texto de segurança foi revisado na tela.
- **Bloqueio para publicar:** não há `git.exe` nesta máquina para o commit. O `gh` está
  autenticado. Falta autorização do usuário para o push na `main`, a tag `v0.2.1` e a troca
  do servidor de produção.

### Commit 0.2.1 pela API do GitHub (sem git local) — 18/11/2026
- O usuário escolheu "Commit pela API". O commit **`8c9cbd933cd33c97f5e15d19147be57745b7d810`**
  foi criado na branch nova `release/0.2.1`, com pai `390aeee`.
  - 25 arquivos alterados e 10 novos, comparados com a árvore do `390aeee` com finais de
    linha normalizados (LF), como o `.gitattributes` define.
  - Todo hash de blob devolvido pelo GitHub bateu com o calculado localmente.
  - Os outros ~90 arquivos versionados eram idênticos.
- **Auditoria de segredos antes do envio** (padrões do `audit-git.ps1`, mais e-mail do
  usuário, URL real do túnel e senha de QA): nada encontrado.
- **Ensaio do release.yml** na branch, sem tag e sem publicação: execução `44339673960`.
- **Ainda pendente:**
  - a `main` continua em `390aeee`; nenhuma tag v0.2.1, nenhuma release;
  - produção continua na 0.2.0.
- **O `.git` local não sabe desse commit:** a pasta continua com o HEAD em `390aeee` e as
  mesmas alterações. Quando houver git, rodar `git fetch` e alinhar a branch local antes de
  novos commits.
- **Ensaio `44339673960` concluído** no commit exato `8c9cbd9`:
  - tests, package, sign e verify-package com sucesso; publish pulado;
  - artefato assinado baixado (digest igual ao do GitHub) para `qa-candidate-0.2.1/final-8c9cbd9/`;
  - `sancord-release verify` aprovado; manifesto 0.2.1 confere com o `Sancord.exe`;
  - ensaio HTTPS do artefato real: 1 aprovado.
- **Pronto para publicar.** Falta autorização para: mover a `main` até `8c9cbd9`, criar a tag
  `v0.2.1` e atualizar a produção (migração v10→v13).

### Continuação visual global — 18/11/2026 (fontes implementados; homologação nativa pendente)

- **Este registro atualiza o estado anterior:** o CI de `8c9cbd9` cobre a candidata do
  Claude, mas não as alterações visuais locais abaixo. Não publicar aquele commit
  supondo que ele contenha esta interface.
- Pedido atendido sobre o workspace existente: completar o prompt de refatoração
  visual A–F, preservando o trabalho já implementado. Snapshot dos fontes anteriores
  em `qa-visual-20261118/baseline/`, ignorado, sem banco/segredos.
- Detalhes, cobertura do prompt, tokens, arquivos e roteiro de homologação em
  **`VISUAL_REFACTOR.md`**.
- Componentes: rail/sidebar/categorias/canais, user/voice panel, header/busca,
  mensagens/composer, membros online/offline, perfis, menus, settings, diálogos,
  tooltips, estados vazios, titlebar e conexão desktop.
- `static/ui.css` consolida os tokens e a camada visual iniciada pelo Claude.
  Correções incluem a grade com larguras realmente vinculadas aos tokens, preferência
  de raio/densidade/movimento, remoção do nameplate permanente no painel, quatro temas
  e precedência correta sobre o CSS legado no tema Escuro e nos inputs.
- Novo `static/js/icons.js`: catálogo SVG próprio, compartilhado, com decoração de
  subárvores inseridas; preserva classes, badges, labels e listeners. Emojis de
  conteúdo/reações, assets e marca mantidos. HTML e rota embutida incluídos no EXE.
- Boas-vindas no início do canal com nome real escapado; composer cresce até
  `min(200px, 30vh)` e botão enviar fica compacto/neutro. Agrupamento, timestamps,
  paging, drafts, reply, anexos e permissões existentes preservados.
- Lista de membros inclui offline a partir do cadastro real, sem perfis fictícios;
  deduplica sessões e permite perfil via teclado. Perfil offline consulta o servidor.
- Confirmações `confirm/alert` restantes do app foram integradas ao UI kit existente;
  operações assíncronas conservam o alvo escolhido. Tooltips mantêm nome acessível.
- Backend/protocolo/banco não foram refatorados nesta continuação. Castigos, modo
  lento, tags e preferências do Claude permanecem e passaram nas suítes existentes.
- **Testes:** baseline 222; agora **231 aprovados** (106 núcleo, 8 desktop,
  1 manutenção, 116 frontend), 1 teste de artefato ignorado por padrão. `cargo check`
  de todos os targets e build desktop aprovados. Teste de assets também verifica CSS.
- QA adicional isolado: parser CSS, pares principais de contraste/cascata de temas,
  carregamento de todos os scripts em DOM, ícones/badges/reações/listeners, themes,
  settings/diálogo e aba Voz sem solicitar captura. DOM não substitui WebView2 nem
  comprova fluxo de rede/mídia. Dependências JS desse ensaio ficam só na pasta ignorada.
- Pacote local em `qa-visual-20261118/package/`, ZIP somente cliente; sem assinatura,
  sem publicação e sem troca dos executáveis instalados. Artefato assinado anterior
  preservado; não representa o novo visual.
- **Bloqueio observado:** a revisão automática rejeitou a abertura do cliente de QA
  por `Start-Process` com `blocked by policy`, sem motivo detalhado. Não foi contornada.
  Comparação visual nativa, DPI e segunda rodada por screenshots continuam pendentes;
  não declarar o prompt totalmente homologado nem pedir ao usuário rotinas repetidas
  de PowerShell enquanto verificações autônomas forem possíveis.
- Próximo passo: homologar a janela candidata isolada quando disponível; alinhar o
  histórico local ao commit remoto sem perder o working tree, validar novo commit no
  CI e somente depois tratar publicação com autorização específica.

### Fechamento da validação automatizada e preparação do histórico — 18/11/2026

- A revisão solicitada encontrou uma falha de teclado nos diálogos: confirmação sem
  campos não recebia foco, deixando o botão anterior ativo. Reproduzida por teste
  inicialmente falhando. `formDialog` agora foca Cancelar na confirmação, respeita
  campos visíveis/habilitados, contém Tab/Shift+Tab e restaura foco ao cancelar.
  O callback de foco não atua se o diálogo já foi fechado.
- Ícones de mover para cima/baixo agora apontam na direção correta.
- Ensaios antes temporários promovidos à suíte permanente:
  `tests/frontend-dom.test.cjs` (5), `tests/frontend-css.test.cjs` (2), com helper
  `tests/helpers/dom.cjs`. DOM isolado, sem rede, mídia, conta ou banco reais.
- `package.json`/`package-lock.json` fixam `jsdom` e `css-tree` como ferramentas de
  desenvolvimento. `node_modules/` ignorado. CI e `homologate.ps1` executam
  `npm ci --ignore-scripts` e `npm test`; o cliente continua sem runtime Node.
- **Resultado atual: 238 testes aprovados** (106 núcleo + 8 desktop + 1 manutenção +
  123 frontend); 1 teste de artefato ignorado por padrão. Check de todos os targets,
  instalação reproduzível das dependências, sintaxe e auditoria sem segredos conhecidos
  aprovados. Pacote de QA recompilado após a correção de foco.
- `git fetch` recuperou o commit remoto do Claude (`8c9cbd9`) sem modificar o working
  tree original. A branch **`codex/visual-0.2.1`**, em
  `qa-visual-20261118/review-worktree/`, parte desse commit e recebe os fontes atuais.
  Não confundir o diff da pasta original contra `390aeee` com o diff desta continuação
  contra `8c9cbd9`: módulos do Claude que eram untracked localmente estão preservados.
- A pasta original continua na branch anterior com seu trabalho em andamento intacto;
  não foi usado reset, stash, clean ou descarte de arquivos. O worktree isolado permite
  revisar/commitar esta continuação com o pai correto e sem reescrever o histórico.
- O próximo passo externo exige envio dos novos fontes à branch pública e execução
  manual de `release.yml`, sem tag ou atualização aos usuários. Ainda não executado.
  A homologação visual nativa segue pendente pelo bloqueio anteriormente registrado;
  não foi tentado outro mecanismo de lançamento para contorná-lo.

### CI final autorizado e candidata assinada — 18/11/2026

- Usuário autorizou o envio do commit **`06a29d4d0fcd9ae82e1c0be0a6e8606fc57fbbf4`**
  à branch pública `codex/visual-0.2.1` e a execução manual de `release.yml`.
- Envio concluído, sem force push. Pai do commit: `8c9cbd9`; os módulos de backend do
  Claude continuam idênticos. Em `src/`, só assets/estilos do desktop diferem.
- **CI `44355471579` concluído com sucesso:**
  https://github.com/gabrielsanderx/Sancord/actions/runs/44355471579
  - `tests / test`: check, testes Rust/frontend, sintaxe e auditoria aprovados;
  - `package`: cliente/backend/ZIP compilados em Windows x64 MSVC;
  - `sign`: manifesto assinado e verificado;
  - `verify-package`: ensaio HTTPS do artefato real assinado aprovado;
  - `publish`: pulado, porque a execução é de branch, sem tag.
- Artefato `signed-windows-release` baixado para
  `qa-visual-20261118/signed-06a29d4/`. A ferramenta local de manutenção verificou
  assinatura e integridade. Conferidos versão 0.2.1, ZIP contendo somente o cliente,
  hash do EXE externo igual ao EXE do ZIP autenticado e changelog final em UTF-8.
  Nenhum executável baixado foi iniciado.
- Teste adicional local `https_downloads_real_ci_artifact_with_embedded_release_key`
  aprovado com esse pacote. **238 testes padrão + 1 do artefato = 239 aprovados**.
  Logs/metadados de proveniência ficam na pasta de QA ignorada.
- Assinatura Ed25519 é do updater; Authenticode continua sendo assunto separado,
  conforme `DISTRIBUTION.md`.
- A branch de revisão está limpa no commit enviado. A pasta original conserva o
  working tree anterior e recebe este registro local posterior ao CI. Não commitar
  tudo sobre o HEAD antigo `390aeee`; continuar a partir de `codex/visual-0.2.1`.
- **Pendência restante desta refatoração:** homologação visual nativa/DPI e fluxos na
  janela atualizada, ainda bloqueados pela revisão automática já descrita. Sem nova
  tentativa por mecanismo alternativo. Não declarar essa conferência realizada.
- `main`, tag/release estável, executáveis instalados e dados de produção não foram
  alterados. Promoção para estável exige resolver a homologação e autorização própria.

### Preparação da conferência nativa final — 18/11/2026

- Usuário pediu avançar com a conferência/promoção após confirmar que o atalho ainda
  abre 0.2.0. Antes de publicar ou substituir o instalado, retomada a homologação.
- Novo snapshot consistente do banco de produção, aberto somente para leitura.
  `check-migration` aprovou **v10→v13**, 30 tabelas antigas preservadas por hash e
  integridade OK. Caminho da cópia em `qa-visual-20261118/final-migration-path.txt`;
  a cópia contém dados reais, deve permanecer ignorada e não ser compartilhada.
- Assinatura/integridade da candidata `signed-06a29d4` verificadas novamente.
- Backend local de QA **0.2.1**, porta **3122**, iniciado a partir do servidor local
  compilado; dados/logs isolados em `qa-visual-20261118/native-final/` e descoberta
  desligada. Identidade do processo gravada em `backend-process.json`. Não parar
  processos de 3000/3100/3110 para trabalhar nesse QA.
- Nova tentativa pelo mesmo `Start-Process`, após a solicitação do usuário, foi
  novamente rejeitada pela revisão automática com **`blocked by policy`**, sem motivo
  detalhado. O comando foi rejeitado antes da execução; nenhum cliente iniciou.
  Não contornar com outro mecanismo de lançamento por ferramenta.
- Preparadas contas descartáveis VozQA_A/B, amizade e servidor real de teste no
  backend 3122. Credenciais somente na pasta ignorada; não imprimir/copiar ao chat.
- Para o usuário abrir manualmente, `native-final/Abrir-QA.cmd` aponta à candidata
  assinada, usa perfil separado e desliga host local, registro de protocolo e updater.
  `ACESSO-QA.txt` contém a entrada de QA para login manual; a skill de computer use
  proíbe automatizar diálogos de autenticação.
- Após o usuário informar que a janela "Sancord - QA final 0.2.1" está conectada,
  usar a skill de computer use para inspecionar a interface, temas e layout, sem
  iniciar captura nem alterar segurança/privacidade. Não declarar inspeção visual
  antes de observar essa janela. Não houve publicação/tag/main ou troca do atalho.

### Abertura nativa permitida após autorização explícita — 18/11/2026

- O usuário autorizou explicitamente que o agente abrisse a candidata e efetuasse
  a entrada com a conta de teste. Nova solicitação pelo mesmo `Start-Process` foi
  permitida. Não foi usado mecanismo alternativo para contornar a revisão.
- Janela observada: **"Sancord - QA final 0.2.1"**, app extraído do pacote assinado
  `signed-06a29d4`; endpoint exibido `http://127.0.0.1:3122` e perfil separado.
- Entrada com VozQA_A concluída; observado estado conectado e servidor "Voz QA local".
  Credencial exclusiva de QA lida sem exibição no chat. Não usar credenciais de produção.
- Tela principal escura observada nativamente: quatro colunas, welcome de #resenha,
  mensagem do sistema, membro online e membro offline, composer compacto e user panel.
  Isso é somente a primeira parte da conferência: temas, teclado, agrupamento e
  responsividade ainda não foram homologados na janela atualizada.
- Tentativa de mensagem de QA deixou um rascunho no composer; envio com Enter não
  foi confirmado. Não repetir ações assumindo que a entrada anterior funcionou.
- Controle recebeu **"user input was detected in this window"**; depois a janela
  apareceu minimizada. Recuperação com estado/ativação e handle atualizado também
  foi interrompida. Não insistir com coordenadas/índices antigos ou outra API de UI.
- Solicitado ao usuário somente deixar a janela de QA em primeiro plano e sem entrada
  concorrente para retomar os cliques. Não há necessidade de comandos ou nova senha.
  Após confirmação, reobter a janela pelo inventário antes de qualquer interação.
- Ainda sem tag/release v0.2.1, alteração de main, substituição do instalado ou migração
  de produção. A autorização atual permite avançar com a conferência, sem fingir que
  as etapas interrompidas foram aprovadas.

### Continuação e fechamento dos ajustes da conferência nativa — 18/11/2026

- Na retomada da janela **"Sancord - QA final 0.2.1"** (`http://127.0.0.1:3122`, conta
  `VozQA_A`), foram confirmados:
  - envio com `Enter`, nova linha com `Shift+Enter` e agrupamento de mensagens em
    `#resenha` (duas mensagens consecutivas gravadas no banco de QA 3122);
  - abertura dos quatro temas (`Claro`, `Ash`, `Escuro` e `Onyx/OLED`) em Configurações →
    Aparência;
  - filtragem e abertura do canal de texto via navegação rápida (`Ctrl+K`);
  - encerramento da chamada de voz que havia sido acionada durante atividade concorrente.
- **Achado visual na janela nativa (tema Claro em Aparência, Perfis e Atalhos) corrigido:**
  - rótulos secundários e selos `.accent-swatch-badge` (`EXCLUSIVO SANCORD`,
    `18 PALETAS LIVRES`, `ÚNICO DO SANCORD`), `.appearance-custom-banner`,
    `.density-choice-card.active`, `.theme-swatch-tile`/`.accent-swatch-tile`,
    `.ptt-key-badge` (`#ptt-key-display`), `.shortcut-row kbd`, `.settings-subnav`,
    `.security-pill.ok`, `.ui-toast`, `.reaction-pill.reacted` e `.mention-pill` no Claro
    passaram a usar tokens semânticos em `static/ui.css`;
  - no cartão/modal de perfil (`#profile-popover-modal`) e nos nomes sem cor personalizada
    (`static/app.js` `themedNameColor` e `static/js/chat.js`), valores claros padrão
    (`#ffffff`, `#f2f3f5`, `#dbdee1`) deixaram de ser fixados inline, preservando
    `var(--text-primary)` no tema Claro, além de `.profile-card-custom-status`,
    `.profile-tab-btn.active`, `.profile-note-textarea:focus` e `.profile-mutual-row > span`;
  - na responsividade (`static/ui.css`), a coluna de membros sai da grade primeiro em
    `<= 1100 px` (abrindo como painel flutuante pelo botão de membros e fechando ao
    clicar fora), enquanto `.channel-topic` e o divisor do cabeçalho do chat só saem em
    `<= 940 px`.
- **Validação automatizada atualizada:**
  - novos testes permanentes em `tests/frontend-css.test.cjs` (contraste `>= 4.5:1` em
    `--bg-chat`, `--bg-card` e `--bg-hover` nos 4 temas + verificação de tokens nos
    rótulos secundários de Aparência, perfis, atalhos e toast no tema Claro) e
    `tests/frontend-dom.test.cjs` (recolhimento/painel flutuante de membros em janela
    estreita e abertura de perfil sem cor inline clara fixa);
  - **240 testes padrão aprovados** (106 núcleo + 8 desktop + 1 manutenção + 125 frontend);
  - pacote local `qa-visual-20261118/package/` recompilado e sincronizado com o worktree
    `qa-visual-20261118/review-worktree/` (`codex/visual-0.2.1`).
- **Próximo passo para publicação da `0.2.1`:**
  - com autorização do usuário: commitar/enviar este ajuste final na branch
    `codex/visual-0.2.1` (ou direto para `main`), rodar o workflow `release.yml`, criar a
    tag `v0.2.1` e atualizar o `SancordServer.exe` + `Sancord.exe` de produção (migrando
    o banco principal de v10 para v13).

### Release v0.2.1 publicada e produção atualizada — 18/11/2026

- **Commit final:** `8123c3cb4c886a241280e29b9afedf3870f13c19` (pai `06a29d4`).
  - Branches `main`, `release/0.2.1` e `codex/visual-0.2.1` avançadas sem `force` (fast-forward).
  - Tag `v0.2.1` criada apontando para `8123c3cb4c886a241280e29b9afedf3870f13c19`.
- **CI e Release no GitHub Actions:**
  - **Windows CI (`main`):** [Run 44379587188](https://github.com/gabrielsanderx/Sancord/actions/runs/44379587188) concluído com `success`.
  - **Stable Windows release (`v0.2.1`):** [Run 44379590944](https://github.com/gabrielsanderx/Sancord/actions/runs/44379590944) concluído com `success` em todos os 5 jobs (`tests / test`, `package`, `sign`, `verify-package` e `publish`).
  - Release pública marcada como `latest`: https://github.com/gabrielsanderx/Sancord/releases/tag/v0.2.1
- **Coleta e verificação local dos assets publicados (`qa-candidate-0.2.1/published-v0.2.1/`):**
  - `sancord-release verify` aprovado ("Assinatura e integridade válidas.").
  - Ensaio HTTPS com o artefato real publicado (`https_downloads_real_ci_artifact_with_embedded_release_key`): **1 aprovado** (total: **241 testes aprovados**).
  - Hashes SHA-256 dos arquivos publicados na `v0.2.1`:
    - `Sancord.exe` (`10.676.224` bytes): `51cf4f210633bd1fe7af1e5e1d50a4960698a68a7c46faa7da5db4a0aee65b0d`
    - `SancordServer.exe` (`10.463.744` bytes): `c3b9f4e754d008c97e896d40ca45072262bbe997eea2cbdf0a38404c56d3375d`
    - `Sancord-0.2.1-windows-x64.zip` (`5.890.540` bytes): `4f254f2187839e7eeb04b28da3459b82edc997a73d08feab856956a778b98d8a`
    - `sancord-update.json` (`1.741` bytes): `8b0732b0906efd55f22cac3ca2c4ee05855912fb2ccee03e7e63eca6f600d896`
    - `sancord-update.sig` (`128` bytes): `9d93dffaa78f88a2f40e59c1d92124b63b04ac6c8b94ad483483f81b750160d2`
- **Produção atualizada para `0.2.1`:**
  - Backup completo pré-`0.2.1` verificado em `D:\Sancord\data-backup-pre-0.2.1-20261118-1623/` (`11` arquivos de `data/`, `2.582.411` bytes + `SancordServer-0.2.0.exe` e `Sancord-0.2.0.exe`).
  - `D:\Sancord\SancordServer.exe`, `D:\Sancord\Sancord.exe` e `D:\Sancord\dist\` atualizados com os binários oficiais assinados da release `v0.2.1`.
  - Servidor de produção iniciado na porta `3000` (mantendo o túnel `cloudflared` ativo); `/api/health` respondeu `version: "0.2.1"`, `ok: true`, `protocol_version: 2` tanto localmente (`http://127.0.0.1:3000/api/health`) quanto pelo túnel público (`https://treasure-practitioner-fred-reason.trycloudflare.com/api/health`).

## Implementação das Etapas A (restante) e B — v0.2.2 (schema v14) — 18/11/2026

- **Etapa A.3 (Autostart de produção no Windows):**
  - Criados `scripts/start-host.ps1` e `scripts/install-autostart.ps1` (`-Action Install|Uninstall|Status`), registrando `SancordHost` em `HKCU:\Software\Microsoft\Windows\CurrentVersion\Run` para subir `SancordServer.exe` e `cloudflared.exe` automaticamente no login do Windows.
- **Etapa A.5 (Preferências sincronizadas na conta):**
  - `UserPrefs` estendido com `user_notes`, `ignored_users` e `starred_messages` (com sanitização e migração automática na primeira conexão em `static/app.js` e `static/js/servers.js`); lista local legada `sancord_blocked_users` removida.
- **Etapa B.1 (E-mail opcional e recuperação de senha):**
  - `Account` estendido com `email` e `recovery_code_hash` (Argon2id, uso único); adicionados `UpdateAccountEmail`, `GenerateRecoveryCode`, `POST /api/recover-password` e diálogo de recuperação na tela de login (`#open-recover-password-btn`).
- **Etapa B.2 (Sessões e dispositivos ativos):**
  - Adicionados `ListSessions` e `RevokeSession` (incluindo `"others"` e desconexão imediata de WebSockets órfãos via `kick_orphaned_connections` e drenagem de mensagens finais antes do frame Close em `ws.rs`), com painel em Configurações → Minha Conta → Senha e segurança.
- **Etapa B.3 (Transferência de posse do servidor):**
  - Adicionado `TransferServerOwnership` com confirmação pelo nome do servidor, atualização do cargo Fundador e registro de auditoria `server_transfer_ownership`.
- **Etapa B.4 (Kick/Ban com motivo, limpeza de histórico no ban e exclusão em lote):**
  - Esquema SQLite migrado para **v14** (`ALTER TABLE bans ADD COLUMN reason TEXT`); `BanServerMember` aceita `reason` e `delete_message_seconds` (até 7 dias); `KickServerMember` aceita `reason`; adicionado `BulkDeleteMessages` (até 100 mensagens não fixadas, filtro opcional por autor) e evento `MessagesBulkDeleted`.
- **Etapa B.5 (Exclusão da própria conta):**
  - Adicionado `DeleteAccount` com verificação da senha atual, bloqueio caso o usuário ainda seja dono de algum servidor e limpeza completa em memória e no SQLite (`WriteOp::DeleteUser`).
- **Validação:**
  - **248 testes automatizados aprovados** (`111` núcleo Rust + `8` desktop + `1` manutenção + `128` frontend).
  - Ensaio de migração em cópia somente-leitura do banco real (`scripts/test-migration.ps1`): `v13 → v14; 31 tabelas antigas preservadas por hash; integridade OK`.
