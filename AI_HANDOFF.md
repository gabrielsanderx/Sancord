# Handoff — Sanvo (nome legado: Sancord)

> **Nome atual do projeto:** **Sanvo** (`Sanvo Desktop`)
> **Nome legado:** `Sancord` (mantido apenas em camadas técnicas de compatibilidade e persistência documentadas na Rodada 13 para preservar contas, banco SQLite, sessões DPAPI, configurações locais e atualizações de instalações existentes).

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
  - Servidor de produção iniciado na porta `3000` (mantendo o túnel `cloudflared` ativo); `/api/health` respondeu `version: "0.2.1"`, `ok: true`, `protocol_version: 2` tanto localmente (`http://127.0.0.1:3000/api/health`) quanto pelo túnel público (`https://<tunel-publico>.trycloudflare.com/api/health`).

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
  - **248 testes automatizados aprovados** (`111` núcleo Rust + `8` desktop + `1` manutenção + `128` frontend) + **1 ensaio HTTPS com o artefato real assinado do CI = 249 testes aprovados**.
  - Ensaio de migração em cópia somente-leitura do banco real (`scripts/test-migration.ps1`): `v13 → v14; 31 tabelas antigas preservadas por hash; integridade OK`.

### Release v0.2.2 publicada e produção atualizada — 18/11/2026

- **Commit final:** `fd10d6ee6b21bd93000096d48237ec310f6d6a87` (pai `8123c3cb`), branch `main` avançada sem `force`, tag `v0.2.2` criada no mesmo commit.
- **CI e Release no GitHub Actions:**
  - **Windows CI (`main`):** [Run 44393803445](https://github.com/gabrielsanderx/Sancord/actions/runs/44393803445) concluído com `success` em `4m44s`.
  - **Stable Windows release (`v0.2.2`):** [Run 44393805417](https://github.com/gabrielsanderx/Sancord/actions/runs/44393805417) concluído com `success` em `17m39s` (`tests / test`, `package`, `sign`, `verify-package` e `publish`).
  - Release pública marcada como `latest`: https://github.com/gabrielsanderx/Sancord/releases/tag/v0.2.2
- **Coleta e verificação local dos assets publicados (`qa-candidate-0.2.2/published-v0.2.2/`):**
  - `sancord-release verify` aprovado (`Assinatura e integridade válidas.`).
  - `https_downloads_real_ci_artifact_with_embedded_release_key` aprovado (`1 passed`).
  - Hashes SHA-256 dos arquivos publicados na `v0.2.2`:
    - `Sancord.exe` (`10.697.728` bytes): `0cabbed6433d0aa688d27f63c30ee01740c918389d228374c73eb3f526f4f91a`
    - `SancordServer.exe` (`10.737.664` bytes): `569ffa8360d56b5c8588a6e275c0a48183e43207cee6d126944727b8a9e2ce6e`
    - `Sancord-0.2.2-windows-x64.zip` (`5.896.547` bytes): `3694f1c5b3076555ebb9673e25bb4fa531c91ea6af845fd5ed9fd0dc259d1d8d`
    - `sancord-update.json` (`1.586` bytes): `23392c290b13404ca0d162b8a3fead890bb397e83d1285696e52f4943df9e67e`
    - `sancord-update.sig` (`128` bytes): `fea49ad409d821b72ab145a227995046dcef862c3c1ab9f2b14114ac70713cbd`
- **Produção atualizada para `0.2.2`:**
  - Backup completo pré-`0.2.2` verificado em `D:\Sancord\data-backup-pre-0.2.2-20261118-1803/` (`11` arquivos de `data/`, `2.615.371` bytes, banco v13 com `integrity_check = ok` + `SancordServer-0.2.1.exe` e `Sancord-0.2.1.exe`).
  - `D:\Sancord\SancordServer.exe`, `D:\Sancord\Sancord.exe` e `D:\Sancord\dist\` atualizados com os binários oficiais assinados da release `v0.2.2`.
  - `scripts/install-autostart.ps1 -Action Install` registrado em `HKCU:\Software\Microsoft\Windows\CurrentVersion\Run\SancordHost` (`AutostartInstalled: True`, `BackendPort3000: True`, `CloudflaredRunning: True`). Túnel continua em modo rápido `trycloudflare.com` com descoberta assinada (túnel nomeado fixo depende de conta/domínio Cloudflare próprio).
  - Servidor de produção `0.2.2` iniciado na porta `3000` (mantendo o túnel `cloudflared` PID `13076` ativo); `data/sancord.db` migrado automaticamente para o esquema `14` (coluna `reason` confirmada em `bans`), e `/api/health` responde `version: "0.2.2", ok: true, protocol_version: 2` localmente (`http://127.0.0.1:3000/api/health`) e pelo túnel público (`https://<tunel-publico>.trycloudflare.com/api/health`).
  - Próximas etapas no roteiro (`DISCORD_GAP_AUDIT.md`): conferir visualmente notificações nativas/updater no `.exe` (Etapa A.4) e iniciar a **Etapa C (UX de chat e social)** ou **Etapa D (TURN provisionado)**.

## Etapa C — item 1: prévia de links (Claude, 18/11/2026) — nos fontes, não publicado

- Conferência do relato do Gemini: GitHub (v0.2.1 e v0.2.2), fontes = `main` `fd10d6e`
  (exceto anotações de documentação), 248 testes, produção 0.2.2/banco v14 e autostart — tudo
  confirmado. Backend de QA esquecido na porta 3122 desligado; o da 3110 (PID 8300) roda como
  administrador e só o usuário pode encerrá-lo.
- **`src/link_preview.rs`**: depois de enviar/editar (e em mensagens de bots/webhooks), o servidor
  busca até 3 links e grava `ChatMessage.embeds` (site, título, descrição, imagem). Chega aos
  clientes como `MessageUpdated`; persistido no JSON da mensagem (sem migração).
  - Proteção contra SSRF: só http/https sem credenciais; todo IP resolvido precisa ser público
    (loopback, privados, link-local, CGNAT, multicast, reservados, IPv4 mapeado, NAT64…);
    conexão presa ao IP verificado (`resolve`, contra DNS rebinding); redirecionamentos manuais
    (máx. 3) revalidados; 6 s; HTML até 512 KiB; imagem até 5 MiB e só png/jpeg/gif/webp.
  - Imagem só pelo proxy `GET /api/link-preview/:canal/:mensagem/:índice`: presa a um embed
    gravado pelo servidor (não é proxy aberto) e sem expor o IP de quem lê. Cache em memória
    (prévias 1 h/500; imagens 32 MiB).
  - `SANCORD_LINK_PREVIEWS=0` desliga. `<https://…>` e links em código não geram prévia.
  - Cliente: `buildEmbedsNode` (chat.js) só com `textContent`; respeita "Pré-visualizar …
    automaticamente" (rótulo atualizado). Token novo `--link` (mais escuro no tema Claro).
- **Bug grave encontrado no QA e corrigido (presente na 0.2.2 publicada):** em canais com
  rolagem, as mensagens encolhiam para 22 px e o texto se sobrepunha (lista flex em coluna +
  `min-height` explícito em `.message-item`). Correção: `#chat-messages > * { flex-shrink: 0 }`
  em `ui.css` (versão `?v=2`), com teste de regressão `tests/frontend-chat-layout.test.cjs`.
- Bug achado com sites reais e corrigido: `og:title` vazio impedia o uso do `<title>`.
- Testes: `src/link_preview_tests.rs` (5: extração, IPs, HTML, SSRF inclusive por
  redirecionamento, fluxo completo com proxy) + `tests/frontend-link-embeds.test.cjs` (2) +
  regressão de layout (2). Suíte: 116 núcleo + 8 desktop + 1 manutenção + 132 frontend.
- QA na instância 3100 com sites reais (rust-lang.org e GitHub): prévias geradas, imagens pelo
  proxy. Limite conhecido: geradores lentos de imagem (ex.: opengraph.githubassets.com) podem
  estourar 6 s no primeiro pedido; a imagem some nessa exibição e carrega numa próxima.
- **Para publicar (0.2.3):** subir versão, seção no CHANGELOG, commit (sem git local: pela API,
  como na 0.2.1), CI e autorização do usuário. A correção do chat sobreposto justifica publicar
  logo.

## Etapa C — item 2: resposta com/sem menção e encaminhamento real (Claude, 18/11/2026) — nos fontes, não publicado

- **Resposta sem menção:** `SendChat.reply_mention` (padrão true) e `ReplyRef.mention`. Sem menção, o
  autor original não entra em `mentions` (nem depois de editar). Cliente: botão "@ ATIVADO/DESATIVADO"
  na barra de resposta (some ao responder a si mesmo), lembrado neste aparelho (`audioSettings.replyMention`).
- **Encaminhar:** `SendChat.forward { channel_id, message_id }` vira `ChatMessage.forward: ForwardSnapshot`
  (cópia congelada: texto, anexos, prévias, rótulo de origem, data original). Reaproveita todo o caminho
  de envio: permissões, castigo, modo lento, AutoMod (inclui o texto encaminhado), solicitações de DM.
  - Regras: quem encaminha precisa poder ler a origem; enquetes não são encaminhadas; não vai para canais
    de anúncios (nem fóruns); reencaminhar mantém a origem original; o texto da mensagem vira comentário
    opcional; sem notificações a partir do conteúdo encaminhado.
  - Proxy de imagens: índices 100+ apontam para as prévias da cópia (`FORWARD_INDEX_BASE`).
  - Cliente: diálogo com até 5 destinos (canais onde se pode escrever em qualquer servidor, DMs, grupos) e
    comentário; bloco "↪ Encaminhada" com rodapé de origem que leva à original (`buildForwardNode`).
    O modal antigo (que copiava texto com prefixo) foi removido do código; o HTML antigo segue no index.
- Testes: `src/forward_tests.rs` (2) + `tests/frontend-forward-reply.test.cjs` (2). Suíte: 118 núcleo +
  8 desktop + 1 manutenção + 134 frontend.
- QA (instância 3100, cliques reais): encaminhada para #memes e DM ao mesmo tempo com comentário; cópia com
  prévia e imagem; rodapé leva à original destacada; botão "@" alterna e muda de cor.

## Etapa C — item 3: silenciar por tempo, silenciar categoria e caixa de menções (Claude, 18/11/2026) — nos fontes, não publicado

- **Silêncio com prazo:** `UserPrefs.mutes: HashMap<id, fim_ms>` (0 = até reativar), enviado por
  `UpdateUserPrefs.mutes`. O servidor limpa (`UserPrefs::sanitize_mutes`: chave de 1 a 120 caracteres,
  prazo no futuro, máximo 500) e `prefs_for` não devolve os que já venceram. Sem migração: as preferências
  são JSON. `muted_servers` (lista antiga) continua valendo e sai ao reativar pelo menu novo.
- **Cliente (`static/js/polish.js`):** `muteUntil`/`isMutedId`/`isChannelMuted` (canal → thread-pai →
  categoria → servidor), `setMute`, `muteMenuItems` ("Silenciar …" abre 15 min/1 h/3 h/8 h/24 h/até
  reativar; "Reativar …" mostra até quando) e `scheduleMuteExpiry` (redesenha quando o prazo vence).
  Menus: servidor, categoria (novo; ganhou também "Marcar como lida"), canal, thread, grupo e DM (a DM
  ganhou menu: abrir, marcar como lida, silenciar e notificações). Itens silenciados ficam esmaecidos e não
  ficam em negrito por não lidas; menções continuam contando.
- **Regra de prioridade em `notificationPolicy`:** "Nada" > silêncio do próprio canal/thread/conversa >
  nível explícito "tudo"/"menções" > silêncio herdado (categoria/servidor) > padrão. Silenciado: só menção
  direta toca e avisa (como antes com servidor silenciado).
- **Caixa de menções:** botão de sino no cabeçalho do chat e na tela de Amigos; painel fixo com recorte
  "todos" ou "este servidor". Usa `SearchMessages` com `mentions_me` e `request_id` "inbox…". O filtro de
  menções da busca (`db::search_messages`) agora inclui menções aos **cargos do usuário** e **exclui as
  próprias mensagens** (vale também para `menciona:eu` na busca normal). Não lidas com faixa azul; o clique
  leva à mensagem.
- Testes: `src/inbox_mute_tests.rs` (3) + `tests/frontend-mute-inbox.test.cjs` (4); dois testes antigos
  que copiam funções do polish.js passaram a copiar também as funções de silêncio. Suíte: 121 núcleo +
  8 desktop + 1 manutenção + 138 frontend, tudo verde.
- QA (instância 3100, cliques reais): categoria silenciada por 1 h → mensagem comum em #memes sem som, sem
  aviso e sem negrito; menção direta tocou, avisou e contou "1"; a caixa mostrou só a menção e levou até
  ela; persistiu após recarregar; reativar pelo menu; servidor "até reativar" esmaece barra e canais;
  DM por 15 min; expiração automática conferida; caixa aberta também pela tela de Amigos.
- **Limite conhecido:** DM silenciada continua mostrando o contador vermelho (o contador vem do servidor);
  sem abas "Não lidas"/"Para você" do Discord.
- Versões dos assets: `ui.css?v=3`, `servers.js?v=19`, `app.js?v=19`, `chat.js?v=18`, `social.js?v=3`,
  `threads.js?v=2`, `polish.js?v=2`.
## Etapa C — item 4: menu completo do usuário e apelido por servidor (Claude, 18/11/2026) — nos fontes, não publicado

- **Apelido por servidor:** `GuildServer.member_nicks` (username_lower → apelido), gravado na coluna nova
  `server_members.nickname`. **Esquema v15** (`ALTER TABLE` só se a coluna faltar; a coluna também entrou
  no `CREATE` da conversão v1→v2, como já era feito com `slowmode_secs`). Migração conferida numa cópia de
  QA (`qa-migration-c4-…`, cópia de outra cópia de QA v14, nunca o banco principal):
  `sancord-release check-migration` → v14 → v15, 31 tabelas antigas iguais por hash, integridade OK.
- **Comando** `SetMemberNickname { server_id, target_username, nickname }` → `src/nicknames.rs`
  (resposta `ServerFeedback` com action `member_nick`; auditoria `member_nick`; `ServerUpdated` para todos).
  - Apelido: espaços e caracteres de controle normalizados, 1 a 32 caracteres; vazio ou `null` remove.
  - Próprio apelido: permissão nova `change_nickname` (padrão **sim**, inclusive em cargos antigos via
    `serde default`); de castigo, não pode (o castigo vale por canal, então é conferido à parte).
  - De outra pessoa: permissão nova `manage_nicknames` e alvo abaixo na hierarquia; ninguém além do dono
    mexe no apelido do dono. As duas permissões estão no editor de cargos e no preset de moderação.
  - O apelido some quando a pessoa sai, é expulsa, banida ou excluída, e acompanha a troca de nome de usuário.
- **Cliente:** `memberNickname`/`displayNameIn` (chat.js) mostram o apelido no autor da mensagem (com
  `title="@usuario"`), na linha de resposta, na lista de membros e no perfil aberto dentro do servidor.
  Mudou o apelido: o chat aberto é redesenhado (`ServerUpdated` compara `member_nicks`). Menções
  continuam por `@usuario` (o "Mencionar" do menu insere esse formato).
- **Menu do usuário na lista de membros** (`memberUserMenuItems`, advanced.js): ver perfil, mensagem,
  ligar (abre a DM e entra na chamada dela), mencionar, adicionar/aceitar amizade (ou "pedido enviado"),
  mudar apelido, cargos (lista com cargos acima do seu desativados e preservados), copiar nome e ID,
  bloquear e a moderação que já existia (castigo, expulsar, banir, transferir posse). No menu do servidor:
  "Editar meu apelido…".
- Testes: `src/nickname_tests.rs` (3) + `tests/frontend-member-menu.test.cjs` (4). Suíte: 124 núcleo +
  8 desktop + 1 manutenção + 142 frontend, tudo verde.
- QA (instância 3100, que migrou para v15): menu completo na lista de membros; apelido de outro membro e o
  próprio (pelo menu do servidor) aparecem ao vivo no chat, na lista e após recarregar; "Cargos…" aplicou
  Moderador (depois desfeito); "Mencionar" inseriu `@fase8membro `.
- **Limites conhecidos:** sem avatar/bio por servidor; o diálogo genérico (`formDialog`) fica largo em
  janelas pequenas; "Ligar" não foi clicado no QA (pediria microfone), coberto por teste de interface.
- Versões dos assets: `servers.js?v=20`, `app.js?v=20`, `chat.js?v=19`, `advanced.js?v=2`.
- **Publicação:** a 0.2.3 agora inclui uma migração de banco (v15); fazer o ensaio de migração da cópia
  de produção no fluxo de release, como nas versões anteriores.
## Etapa C — item 5: emojis próprios do servidor (Claude, 18/11/2026) — nos fontes, não publicado

- **Modelo:** `GuildServer.emojis: Vec<ServerEmoji { id, name, animated, creator, created_at }>`. O `id` do
  emoji é o ID do anexo com a imagem (32 hex): qualquer cliente desenha `<:nome:id>` (ou `<a:nome:id>`,
  animado) por `/api/attachments/{id}/emoji`, que já serve imagens com `nosniff` e CSP `sandbox`.
  Anexos não são apagados automaticamente, então a imagem não some.
- **Banco: esquema v16**, tabela `server_emojis` (regravada com o servidor em `replace_server`, como os
  cargos; também criada na conversão v1→v2). Ensaio numa cópia de QA (`qa-migration-c5-…`, cópia de outra
  cópia v14): `check-migration` → v14 → v16, 31 tabelas antigas iguais por hash, integridade OK.
- **Comandos** `CreateServerEmoji { server_id, name, attachment_id }`, `RenameServerEmoji`,
  `DeleteServerEmoji` → `src/emojis.rs` (feedback `server_emoji`; auditoria `emoji_create/update/delete`;
  `ServerUpdated` para todos). Regras: permissão nova `manage_expressions` (ou dono/administrador; está no
  editor de cargos e no preset de moderação); nome `[A-Za-z0-9_]{2,32}` único no servidor sem diferenciar
  maiúsculas; até 50 por servidor; só PNG/JPEG/GIF/WebP de até 256 KB, enviados pela própria pessoa; a
  mesma imagem não vira dois emojis; GIF = animado.
- **Mensagens:** `SendChat` e `EditChat` passam por `emojis::normalize_content`. Um código só fica se o
  emoji existir num servidor de que o autor é membro (vale em outros servidores e DMs, como emojis
  externos do Discord), já com o nome atual e o "a" correto; senão vira `:nome:`.
- **Reações:** aceitam o código do emoji (chave `<:nome:id>` canônica). Emoji excluído ou de servidor que
  a pessoa deixou só serve para tirar a própria reação.
- **Cliente:** `:nome:` vira código no envio (fora de trechos de código; com nome repetido vale o do
  servidor aberto) e volta a `:nome:` ao editar; imagem no texto (grande quando a mensagem é só emoji),
  nas reações, no autocompletar `:` (emojis do servidor primeiro, com o nome do servidor) e no seletor
  (uma seção por servidor, recentes, busca). Prévias de texto puro (resposta, notificação, busca, caixa de
  menções) mostram `:nome:`. Aba "Emojis" nas configurações: enviar (nome sugerido pelo arquivo), lista
  com contador, renomear e excluir.
- Testes: `src/emoji_tests.rs` (2) + `emojis::tests` (1) + `tests/frontend-server-emojis.test.cjs` (5).
  Suíte: 127 núcleo + 8 desktop + 1 manutenção + 147 frontend, tudo verde.
- QA (instância 3100, migrou para v16): emoji criado pela aba (PNG gerado num canvas e entregue ao campo
  de arquivo, já que o seletor nativo não é automatizável), autocompletar `:fes` → envio com imagem no
  texto; mensagem só com emoji em 48 px; reação pelo seletor; excluir pela aba (confirmação) → `:festa_qa:`
  deixa de converter e mensagens antigas continuam com a imagem.
- **Bug achado no QA e corrigido:** com `loading="lazy"` a imagem do emoji não carregava dentro das
  configurações; removido (emojis são pequenos e ficam em cache imutável).
- **Limites conhecidos:** sem stickers; sem restringir emoji por cargo; sem recorte/redimensionamento no
  envio (a imagem é mostrada em 22/48 px como vier).
- Versões dos assets: `ui.css?v=4`, `app.js?v=21`, `chat.js?v=21`, `advanced.js?v=3`, `polish.js?v=3`.
## Etapa C — item 6: ordenar fórum, membros da thread e arquivamento automático (Claude, 19/11/2026) — nos fontes, não publicado

- **Thread** ganhou `auto_archive_minutes` (60, 1440, 4320 ou 10080; padrão 1440 = 24 h, também para
  threads antigas via `serde default`) e `members` (username_lower). Ficam no JSON da thread: **sem
  migração de banco**.
- **Membros:** quem cria segue; quem escreve passa a seguir (`threads::on_message` recebe o autor); comandos
  `JoinThread`/`LeaveThread` para quem vê a thread (máx. 1000). Sem mudança de notificação: seguir hoje
  serve para a lista e a ordem da barra lateral.
- **Arquivamento automático:** `threads::archive_idle` (no laço de 30 s do `main.rs`, com castigos e
  status) arquiva quem passou do próprio prazo sem mensagens (conta desde a última mensagem ou da criação).
  Nova mensagem desarquiva, como antes. `UpdateThread.auto_archive_minutes` só para dona(o) da thread ou
  moderação, só com os 4 valores.
- **Atenção na publicação:** threads existentes sem mensagens há mais de 24 h serão arquivadas no primeiro
  minuto depois da atualização (comportamento do Discord). Continuam acessíveis e voltam ao escrever.
- **Cliente (threads.js):** seletor "Atividade recente / Data de criação" no fórum (lembrado por fórum em
  `localStorage`, arquivadas sempre por último); menu da thread com "Seguir thread / Deixar de seguir",
  "Membros da thread (N)" e "Arquivar após inatividade ▸" (atual marcado); cabeçalho com "N membros •
  seguindo"; com uma thread aberta, a lista lateral mostra só quem segue ("MEMBROS DA THREAD — N"); na barra
  lateral, as threads seguidas vêm primeiro. Ordenação ficou robusta para `archived` ausente.
- Testes: `src/thread_c6_tests.rs` (2) + `tests/frontend-thread-c6.test.cjs` (3). Suíte: 129 núcleo +
  8 desktop + 1 manutenção + 150 frontend, tudo verde.
- QA (instância 3100, cliques reais): duas postagens criadas; ordem por atividade e por criação; prazo de
  1 semana pelo menu; postagem antiga (22,7 h parada) com prazo de 1 h foi arquivada pelo laço do servidor em
  7 s; "Deixar de seguir" → "0 membros" e lista vazia com aviso; sem erros de script.
- **Limites conhecidos:** seguir não muda notificações; sem ordem padrão do fórum definida pela moderação;
  sem visualização em galeria nem diretrizes do fórum.
- Versões dos assets: `app.js?v=22`, `threads.js?v=3`.
## Etapa C — item 7: seletor de GIF local (Claude, 19/11/2026) — nos fontes, não publicado

- **Decisão do usuário:** sem serviço externo (Tenor/GIPHY/KLIPY exigiriam chave de API e mandariam as
  buscas a terceiros). O seletor é só local; busca na internet fica para depois, se for desejada.
- **Conta:** `UserPrefs.favorite_gifs` (IDs de anexos, mais recente primeiro). `UpdateUserPrefs.favorite_gifs`
  passa por `UserPrefs::sanitize_favorite_gifs`: só IDs de 32 hex, sem repetir, que existam em
  `st.attachments` com `content_type = image/gif`, no máximo 200. Sem migração (preferências são JSON).
- **Envio:** mandar um GIF = `SendChat` com `attachment_ids: [id]`. Já era permitido reusar um anexo pelo
  ID (o ID funciona como URL de capacidade; quem o tem já consegue baixá-lo); o envio continua passando por
  todas as regras do canal.
- **Cliente (chat.js):** botão "GIF" ao lado do emoji; painel com abas "Favoritos (N)" e "Nas conversas (N)"
  (GIFs das mensagens carregadas, inclusive encaminhadas, sem repetir, mais recentes primeiro), filtro pelo
  nome do arquivo e estrela em cada item; um clique envia (respeitando a resposta em andamento) e fecha.
  Nos GIFs do chat aparece uma ☆ ao passar o mouse para favoritar/desfavoritar (o sistema de ícones a
  desenha como SVG). Abrir um seletor fecha o outro.
- Testes: `src/gif_tests.rs` (2) + `tests/frontend-gif-picker.test.cjs` (4); `buildAttachmentsNode` ficou
  defensivo para o teste antigo que a isola. Suíte: 131 núcleo + 8 desktop + 1 manutenção + 154 frontend.
- QA (instância 3100, cliques reais): GIFs enviados pelo caminho de anexos (um de 1×1 e um de 48×48 gerado
  byte a byte, já que a janela de arquivos do sistema não é automatizável); ☆ favoritou; o seletor mostrou
  Favoritos (2) e Nas conversas (2); clique no GIF laranja enviou a mensagem só com ele; favoritos
  persistiram após recarregar; sem erros de script.
- **Limites conhecidos:** sem busca na internet; "Nas conversas" só vê mensagens já carregadas; só
  `image/gif` (vídeos curtos/"gifv" não entram).
- Versões dos assets: `ui.css?v=5`, `chat.js?v=22`, `servers.js?v=21`.
- **Etapa C completa nos fontes (itens 1 a 7).** Nada publicado: a 0.2.3 inclui C1–C7, a correção do chat
  sobreposto e as migrações v15 e v16.
## Perfis — Fase P1: modelo, editor, avatar, banner, bio e tema (Claude, 19/11/2026) — nos fontes, não publicado

Pedido do usuário: expansão completa do sistema de perfis em 8 fases, **antes de publicar a 0.2.3**.
Documentação viva da arquitetura: `PROFILE_SYSTEM.md`.

- **Análise do que existia:** avatar e banner como data-URL na conta (difundidos inteiros a todos a cada
  mudança), tema com 2 cores, editor com rascunho e prévia, 24 decorações/12 efeitos/11 placas/11 estilos
  desenhados no cliente, status personalizado com emoji e prazo. Cosméticos eram texto livre (sem checagem).
- **Servidor:**
  - `ProfileExtras` (`models.rs`) achatado em `Account`/`UserInfo`/`FriendInfo` (JSON, sem migração):
    `avatar_animated`, `banner_animated`, `theme_highlight`, `theme_mode`, `theme_direction`,
    `profile_frame`, `badges`. `Account.inventory` (privado).
  - `src/cosmetics.rs`: catálogo (`CosmeticItem`, tipos, raridade, disponibilidade free/badge/grant),
    posse e `check_equip`. `UpdateProfile` valida decoração, estilo de nome, placa, efeito e moldura pelo
    catálogo (recusa com `ServerFeedback update_profile`). `CosmeticsState` vai logo após o `Welcome`.
  - `src/profile.rs`: `SetProfileMedia` (anexo do próprio usuário, PNG/JPEG/WebP/GIF, avatar 6 MB, banner
    8 MB, caminho `/api/attachments/...`, GIF = animado), `clean_choice`, bio 300.
  - **Bug corrigido (pré-existente):** o middleware `response_headers` forçava `no-store` em TODAS as
    respostas, anulando o cache imutável dos anexos. Agora respeita quem já definiu `Cache-Control`.
- **Cliente:** módulo novo `static/js/profile.js` (embutido no desktop em `desktop_assets.rs`):
  catálogo/posse, política de animação (Sempre/Hover/Nunca + Reduzir animações do app ou Windows, com
  quadro parado em canvas), tema (`profileThemeBackground`, `profileTextTone`, `applyProfileTheme`),
  banner como `<img>`, bio markdown segura com contador, rascunho de mídia (envio só em Salvar), prévia
  em contextos (Perfil/Chat/Membros/DM). `app.js`: recorte generalizado (avatar círculo / banner faixa,
  exporta WebP via `toBlob`), editor com controles de tema, chat redesenhado quando a aparência de alguém
  muda (`VoiceStateSync`). `ui-kit.js`: `cachedMediaUrl` resolve `/api/...` para o servidor.
  - **Bug corrigido (pré-existente desde a refatoração visual):** `.profile-card-body` e
    `.profile-modal-left` tinham fundo sólido e escondiam o tema do perfil; agora ficam transparentes
    quando há tema, com contraste automático.
- Testes: `src/profile_p1_tests.rs` (3: mídia/sync/regras/persistência, cache, cosméticos/tema/bio) +
  `cosmetics::tests` (1) + `tests/frontend-profile-p1.test.cjs` (7). Suíte: 135 núcleo + 8 desktop +
  1 manutenção + 161 frontend, tudo verde; `cargo build --all-targets` ok.
- QA (instância 3100, cliques reais): avatar e banner escolhidos pelo campo de arquivo (PNG gerado em
  canvas), recorte circular e em faixa (arraste ok), rascunho com barra de "não salvo", tema gradiente
  diagonal + destaque + contraste escuro, bio com negrito/link e contador "47 / 300", prévia "Chat",
  Salvar → servidor gravou caminhos `/api/attachments/...` WebP; outro usuário (Fase8Membro) recebeu o
  perfil novo (lista de usuários com 3 KB); imagem com `Cache-Control: immutable` após o ajuste; popout
  com tema, banner e bio corretos.
- **Observação:** nesta máquina o Windows pede "reduzir movimento", então a política vira "Nunca" e o
  seletor fica desativado com explicação (comportamento pedido: respeitar Reduzir movimento).
- Versões dos assets: `ui.css?v=6`, `app.js?v=23`, `ui-kit.js?v=19`, `profile.js?v=1`.
- **Próximo:** Fase 2 (decorações de avatar com camadas e molduras de perfil próprias, coleção
  "Sancord Core", molduras por conquista com badges concedidas pelo servidor).
## Perfis — Fase P2: decorações de avatar, molduras de perfil e badges (Claude, 19/11/2026) — nos fontes

- **Servidor (`src/cosmetics.rs`):** 41 itens novos no catálogo (`PHASE2`): coleção Sancord Core (Órbita +
  Pulso Core), 11 decorações novas, 9 molduras estáticas, 11 animadas, 2 reativas, 6 por conquista
  (`badge:<id>`) e 1 de temporada (`grant`). `BADGES` (8 de confiança, 5 cosméticas). Badges efetivas =
  `badges.json` do operador (pasta de dados, lido ao iniciar; `ServerState.badge_grants`) + `early_user`
  automática (contas antes de 01/01/2027); calculadas na carga (`state.rs`) e ao entrar (`ws.rs`).
  `CosmeticsState` ganhou `badges` (definições).
- **Cliente (`static/js/profile.js`):** arte SVG própria das decorações novas (`SANCORD_DECORATION_ART`,
  ligada em `getDecoSvgHtml`), molduras (`applyProfileFrame`: uma `.pf-layer` sobre o cartão, só a borda
  por máscara, ornamentos próprios; remove só a classe da moldura anterior), moldura reativa
  (`setFrameReactiveState` + `onFrameVoiceState` agrupado em 150 ms, ligado aos 3 pontos que mudam
  `state.speakingUsers`), badges (`renderProfileBadges`, ícones SVG próprios, confiança × cosmética) e o
  seletor de cosméticos do catálogo (decorações e molduras separados; abas, coleções, bloqueados com "como
  conseguir", prévia grande). `app.js`: rascunho/salvar/rótulo da moldura, popout e prévia com moldura,
  estado reativo e badges.
- **CSS (`ui.css`):** animações das decorações, 29 molduras, reativas por `data-presence`/`data-voice`,
  badges, seletor; política "Nunca"/Reduzir animações/`prefers-reduced-motion` param tudo; com moldura, a
  borda de destaque do tema sai (hierarquia).
- **Bugs achados e corrigidos na fase:** `applyProfileFrame` apagava outras classes `pf-*` (achado pelo
  teste); borda de destaque escondia as molduras nas miniaturas e no cartão (achado no QA); badges claras
  ilegíveis em cartão claro (achado no QA).
- Testes: `src/profile_p2_tests.rs` (2) + `cosmetics::tests::badge_dates_and_order` +
  `tests/frontend-profile-p2.test.cjs` (6). Suíte: 138 núcleo + 8 desktop + 1 manutenção + 167 frontend.
- QA (3100, cliques reais): `qa-phase8/data/badges.json` concedeu founder + bug_hunter à Fase8Dona (só na
  pasta de QA); seletor de molduras com 29 itens e bloqueados certos; "Fundação" aplicada; seletor de
  decorações (35) com "Órbita Nebular"; Salvar; popout com moldura dourada + ornamento, decoração e 3
  badges; outro usuário recebeu moldura/decoração/badges e não possui a moldura de conquista; Aura Reativa
  vermelha/apagada em "Não perturbe" e verde em "Online".
- **Não verificado ao vivo:** reação à voz (precisaria de chamada com áudio); animações (o Windows desta
  máquina pede "reduzir movimento", então tudo fica estático — comportamento correto).
- Versões: `ui.css?v=7`, `app.js?v=24`, `profile.js?v=2`.
- **Próximo:** Fase 3 (efeitos de perfil próprios com entrada→animação→estável, botão "Reproduzir efeito",
  redução da moldura enquanto o efeito roda).

### Conferência das fases de perfil — 19/11/2026

- Comparados o prompt de 100 itens, `PROFILE_SYSTEM.md`, o histórico e a implementação. P1/P2 estão nos fontes. P3/P4/P5/P7/P8 já têm partes aproveitáveis. P6, privacidade e conexões ainda faltam. O mapa está em `PROFILE_SYSTEM.md` e a seção de perfis da auditoria foi atualizada.
- A versão estável do GitHub é `v0.2.2` (`fd10d6e`). O Git local da pasta principal ainda parte de `390aeee`, com alterações em andamento. `git fetch` atualizou a referência de `origin/main` preservando a pasta de trabalho. `Cargo.toml` e `Cargo.lock` ainda indicam `0.2.2`, embora os fontes incluam o esquema v16 e o trabalho previsto para `0.2.3`.
- Corrigido o cartão visitado em `static/app.js` e `static/js/social.js`. A resposta `UserProfile` agora aplica avatar, banner, bio, pronomes, tema, moldura e selos também para quem está offline e preserva o apelido do servidor. A área de relações aguarda dados reais do servidor em vez de apresentar estimativas incorretas. Assets `app.js?v=25` e `social.js?v=4`.
- `tests/frontend-dom.test.cjs` cobre a atualização de um perfil offline e o estado das relações. `cargo check --locked --all-targets`, suíte Rust (138 núcleo + 8 desktop + 1 manutenção) e frontend (168) aprovados. Um teste Rust que exige artefato assinado ficou ignorado. A conferência desta correção foi em DOM e testes automatizados.
- Próximo passo do prompt: P3 sobre o sistema existente de efeitos. Tratar conjuntamente a política de segundo plano e os limites de animação. O salvamento com confirmação do servidor continua como pendência técnica do editor.

### Perfis — Fase P3 de efeitos de entrada — 19/11/2026

- Mantidos os efeitos clássicos e o equipamento existente. `src/cosmetics.rs` acrescenta sete efeitos gratuitos. Sinal Core integra a coleção de Órbita e Pulso Core. Os efeitos novos aparecem no seletor quando o backend anuncia suas definições.
- `static/js/profile.js` limita a um efeito por janela e 1,5 s por execução. A abertura do cartão toca uma vez, inclusive quando o efeito chega com `UserProfile` em visita a um usuário offline. O editor e o seletor permitem replay. A lateral da DM fica estática.
- `static/ui.css` contém a arte dos efeitos novos, a transição de entrada/saída e a pausa da moldura durante o efeito. As variações mais bruscas de Tempestade Arcana e Sinal VHS foram suavizadas. Fechamento, perda de foco, janela oculta e redução de movimento cancelam o efeito. GIFs de avatar e banner continuam com a política de mídia da P1.
- `static/app.js`, `static/js/social.js` e `static/index.html` conectam seleção, replay, visita e rascunho. `UpdateProfile` e `profile_effect` continuam sendo a rota de salvamento, sem migração ou mudança de protocolo. Versões locais dos scripts: app 26, social 5, profile 3, ui.css 8 e styles.css 19.
- `tests/frontend-profile-p3.test.cjs` cobre reprodução única, replay, rascunho, posse, fim da animação e interrupções. `src/profile_p1_tests.rs` cobre catálogo, equipamento pelo WebSocket existente e persistência após reabrir o banco. Validação automatizada, sem confirmação da arte em WebView2 real nesta etapa.
- `cargo check --locked --all-targets` e build de `SancordApp` e `sancord` aprovados. Suíte verde com 139 testes de núcleo, 8 desktop, 1 manutenção e 171 frontend, total de 319. Um teste Rust de artefato assinado permaneceu ignorado.
- Próximo passo do prompt: **P4**, ampliar as nameplates e os estilos de nome que já existem. Nenhuma versão é publicada durante esta etapa.

### Perfis — Fase P4 de placas e estilos de nome — 19/11/2026

- `src/cosmetics.rs` acrescenta nove placas e oito estilos. IDs clássicos preservados. Faixa Core completa a coleção Core. Os itens novos são apresentados quando o servidor os anuncia e são equipados pela validação de catálogo/posse existente.
- Campos opcionais `name_color_secondary` e `name_gradient_direction` em `ProfileExtras` e `UpdateProfile`, com hex de seis dígitos e quatro direções permitidas. Mantida a cor primária existente. `VoiceStateSync`, `FriendsSync` e `UserProfile` recebem os campos das estruturas já usadas e as sessões da mesma conta recebem as mudanças de nome e placa. Sem migração.
- `static/app.js`, `chat.js`, `profile.js`, `index.html` e `ui.css` integram gradiente em tempo real na prévia, placas em amigos, DMs e perfis, e nomes personalizados no chat e nos membros. A opção em Aparência troca as superfícies por nomes simples usando a configuração local, preservando apelidos, cores de cargo e selos. As animações são breves e respeitam Reduzir movimento e Animações de perfil.
- Salvar verifica o retorno do envio de `UpdateProfile` antes de atualizar a UI local. Sem conexão, permanece o rascunho. Com envio aceito pelo socket, o aviso diz que as alterações foram enviadas. A resposta/sincronização existente do servidor continua responsável pelo estado confirmado.
- Testes em `src/profile_p1_tests.rs` e `tests/frontend-profile-p4.test.cjs` cobrem catálogo, persistência, sincronização de duas sessões, cliente legado, validação, rascunho, prévia e preferência local. Animação e contraste visual no WebView2 ainda não foram inspecionados nesta etapa.
- `cargo check --locked --all-targets` e build desktop/servidor aprovados, com **322 testes** na suíte (140 núcleo, 8 desktop, 1 manutenção e 173 frontend). O teste que depende de um artefato assinado ficou ignorado.
- Assets: `app.js?v=27`, `chat.js?v=23`, `profile.js?v=4`, `ui.css?v=9`. Próxima fase do prompt: **P5**, identidade por servidor sobre o sistema de apelidos já existente.

### Perfis — Fase P5 de identidade por servidor — 19/11/2026

- O menu do servidor abre **Editar perfil do servidor…** para personalizar avatar, banner e bio. A ação de apelidos continua usando `SetMemberNickname` e suas permissões de moderação. Outros aspectos de aparência e status herdam o perfil global.
- `SetServerProfile` aceita alterações esparsas para a própria conta de um membro. Campos ausentes preservam o valor local. Texto vazio remove a personalização. O servidor valida a titularidade, o tipo e o tamanho dos anexos antes de aplicar o conjunto de alterações.
- Migração SQLite v17 adiciona `server_members.profile_json` e conserva a coluna de apelidos. Personalizações acompanham mudanças de nome de usuário e são removidas ao perder a associação com o servidor. O evento `ServerProfileUpdated` e os snapshots só enviam os dados aos membros.
- O cartão visitado resolve a aparência pelo contexto de abertura. Cartão, chat e lista de membros reagem ao evento ao vivo. GetUserProfile continua fornecendo os dados globais e relações. A interface ignora respostas atrasadas de outro contexto. A mídia segue as regras de acesso do serviço de anexos existente.
- Testes de integração em `src/profile_p5_tests.rs` cobrem duas sessões via WebSocket, adesão posterior, membro externo, anexos, mutação atômica, recarga de SQLite e saída. O DOM em `tests/frontend-profile-p5.test.cjs` cobre formulário, upload, remoção, atualização ao vivo e isolamento de DM.
- As suítes passaram com 141 testes de núcleo, 8 desktop, 1 manutenção e 175 frontend. O teste de artefato assinado segue condicionado a um pacote de CI. A verificação visual do editor no WebView2 permanece pendente.
- Assets alterados: app 28, chat 24, profile 5, social 6, servers 22 e ui-kit 20. Próxima fase do prompt: **P6**, mural e widgets.

### Perfis — Fase P6 de mural e widgets — 19/11/2026

- **Configurações → Perfil → Editar mural** abre o editor de ordem, visibilidade e audiência. A aba Mural do cartão atende visitantes. Implementados Jogo favorito (capa/descrição), Jogando agora (manual), Quero jogar, Sobre mim, Link e Conquistas derivadas dos selos concedidos pelo servidor.
- `Account.profile_board` guarda a lista, ordem, visibilidade, audiência e revisão no SQLite. Compatibilidade por `serde(default)` no JSON da conta, sem migração de esquema. `GetProfileBoard` carrega a configuração do titular. `SaveProfileBoard` valida campos e anexos, rejeita conflitos de revisão e atualiza outras sessões da conta.
- `GetUserProfile` retorna uma projeção autorizada que exclui widgets ocultos e considera bloqueios em ambos os sentidos. Ficam disponíveis as audiências Todos, Amigos e pessoas com servidor em comum, e Somente amigos. As regras do mural são independentes das demais partes do perfil.
- `static/js/profile-board.js` é embutido no desktop. O editor permite arrastar pela alça e usar botões Subir/Descer. Rascunhos recebem confirmação de salvamento do servidor. Assets: app 29, social 7, ui.css 10 e profile-board 1.
- Testes de integração de WebSocket e SQLite em `src/profile_board_tests.rs`. Testes de DOM em `tests/frontend-profile-board.test.cjs` exercitam edição, upload, ordenação, conflito entre sessões e renderização.
- Suítes aprovadas com 143 testes de núcleo, 8 desktop, 1 manutenção e 178 frontend. O teste de artefato assinado segue condicionado a um pacote de CI. A conferência visual no WebView2 segue pendente.
- Próxima fase do prompt: **P7**, coleções, inventário e presets. Marcos de contagem, widget personalizado e privacidade do perfil inteiro são expansões do mural.

### Perfis — Fase P7 de coleções, inventário e presets — 19/11/2026

- **Configurações → Perfil → Minha Coleção** agrupa os itens possuídos por coleção. Tem filtros de categoria, conjunto e favoritos, estado equipado, marca de itens ainda não vistos e prévia. Um item avulso entra no rascunho pelo botão **Usar no editor**.
- `Account.cosmetic_collection` persiste favoritos, itens vistos e até 12 presets no JSON da conta em SQLite. `CosmeticsState` inclui a coleção na conexão. `CosmeticCollectionUpdated` sincroniza as alterações com as demais sessões da conta. O esquema continua v17.
- `ProfileAppearance` contém exclusivamente os campos visuais do tema e dos cinco tipos de cosmético. `EquipProfileLook` valida todos os campos e a posse atual antes de aplicar presets ou combinações. A aplicação atualiza a conta e suas conexões ativas. O editor conserva os demais campos de rascunho.
- **Surpreenda-me** escolhe cosméticos com base no catálogo e nas chaves de posse retornadas pelo servidor. O botão de aplicar só envia depois da prévia. O replay reutiliza as preferências de movimento do perfil.
- Adicionados `src/cosmetic_collection.rs` e `static/js/profile-collection.js` com recurso embutido no desktop. Assets alterados: app 30, profile 6, profile-collection 1 e ui.css 11. Testes direcionados cobrem posse revogada, exclusão, isolamento das sessões, persistência, ordenação visual por coleção e prévia.
- Suítes aprovadas com 145 testes de núcleo, oito desktop, um de manutenção e 181 frontend. Um teste de artefato assinado segue condicionado a um pacote de CI. A conferência visual no WebView2 segue pendente.
- Próxima fase do prompt: **P8**, polimento, desempenho e acessibilidade.

### Perfis — Fase P8 de polimento, desempenho e acessibilidade — 19/11/2026

- **Aparência → Acessibilidade do perfil** tem controles locais para animação, decoração, moldura, efeito, placa de nome e estilo de nome. A redução de movimento do aplicativo e do Windows continua prioritária.
- `static/js/profile-motion.js` carrega até dois GIFs originais visíveis, gera quadros estáticos no `ImageDecoder` com limite de duas tarefas e mantém até 64 resultados no cache. Em segundo plano, retira os originais do DOM e cancela as tarefas. Uma área de cosméticos anima por vez. Efeitos de entrada continuam limitados a uma execução de 1,5 s. Assets: app 31, profile 7, profile-motion 1, styles.css 20 e ui.css 12.
- `UpdateProfile` sincroniza as mudanças entre as sessões da conta. Avatar e moldura do cartão permanecem no DOM se a origem e o item já estão corretos. A validação de anexos acrescenta limite de dimensões e área. O esquema continua v17.
- `cargo check --locked --all-targets`, build Windows de desktop/servidor e **338 testes automatizados** aprovados. Um teste de artefato de CI permanece ignorado.
- QA real do executável com `scripts/profile-motion-qa.mjs`. 240 perfis sintéticos e 110 visíveis, 2 GIFs ligados e 0 desligados ou após perda de foco simulada. As medidas de responsividade, CPU, GPU e memória estão em `PROFILE_SYSTEM.md`. A validação usou mídia sintética e dados temporários.

### Fechamento de perfis e preparação local da 0.2.3 — 19/11/2026

- Privacidade geral e por campo projetada pelo servidor em usuários, conversas, grupos e personalizações por servidor. Conexões são ocultas por padrão. O GitHub pode ser verificado por desafio temporário na bio pública, com consulta HTTPS fixa e revalidação do estado antes da confirmação.
- Cartão rápido para avatares de mensagem e lista de membros. O perfil completo está disponível por ação e pelo menu. Prévias do cartão rápido e do painel inferior integradas ao editor.
- Candidata 0.2.3 com pacote em `qa-release-0.2.3`, esquema v17 e migração da cópia de v14 validada. Auditoria Git aprovada e comparação com `origin/main` em índice separado.
- O ensaio público do updater entre 0.2.1 e 0.2.2 passou com instalação e reinício. Notificação desktop entregue no QA WebView2. Restam câmera física, TURN entre redes distintas e o workflow MSVC com assinatura da candidata. Detalhes em `HOMOLOGACAO.md`.
- O pacote local 0.2.3 passou no QA dos cartões, privacidade, conexões e notificação. A suíte totaliza 344 testes com o ensaio separado de artefato assinado. Candidata Git local em `codex/prepare-0.2.3` sobre a ponta publicada de `main`. O índice e a branch de trabalho foram preservados.

### Expansões adicionais pré-0.2.3 (cosméticos por servidor, mural completo, conexões/admin de selos e Etapa D) — 19/11/2026

- **Cosméticos e tema por servidor:** `ServerMemberProfile` e `ServerProfileChanges` ampliados com `avatar_decoration`, `profile_frame`, `profile_effect`, `nameplate_style`, `name_style`, `name_color`, `name_color_secondary`, `name_gradient_direction`, `theme_primary`, `theme_accent`, `theme_highlight`, `theme_mode` e `theme_direction` (validados por `cosmetics::check_equip`, redactados por privacidade em `project_member_profile` e aplicados em chat, lista de membros, cartão rápido e perfil completo; DMs mantêm perfil global).
- **Mural completo:** adicionado `ProfileWidgetContent::Custom` (título, emoji opcional, texto e imagem opcional até 4 MB) e marcos automáticos em `profile_board::view` (`milestone_first_server`, `milestone_5_friends`, `milestone_100_messages`, `milestone_500_messages`) com contagem via `db.count_messages_by_author` + cache em memória.
- **Conexões sociais e painel admin de selos:** detecção/seleção de plataformas sociais em `ProfileLink`/`ProfileLinkView` (sem falsificar verificação fora do GitHub) e comandos `GetBadgeAdminState` / `SetUserBadges` restritos a operadores (`founder`/`developer` ou `SANCORD_OPERATORS`) com gravação atômica em `badges.json` e guarda contra remoção do último operador.
- **Etapa D (chat em canais de voz + bitrate de áudio):** canais de voz aceitam mensagens (`ChannelKind::accepts_messages`), histórico, reações, fixados, permissões, busca e limpeza na exclusão, com botão `💬` na lista de canais de voz e no palco de chamada; adicionada coluna `channels.bitrate_kbps` (migração SQLite **v18**, faixa `32..=256` kbps ou `0` padrão) configurável em `UpdateChannel` e injetada na negociação Opus/SDP.
- **Validação:** `cargo test --locked --all-targets --target-dir target-review-phase6` (154 núcleo + 8 desktop + 1 release_tools, 1 ignorado de CI) e `node --test tests/frontend-*.test.cjs` (189 frontend) = **352 testes aprovados, 0 falhas**. Migração segura em cópia somente-leitura (`scripts/test-migration.ps1`): **v14 → v18** com 31 tabelas antigas preservadas por hash e integridade OK. Publicação da `0.2.3` mantida em espera conforme pedido do usuário (mais itens previstos antes do release).

### Expansão Completa da Central de Configurações — 19/11/2026

- **Arquivos alterados/criados:** `static/index.html`, `static/ui.css`, `static/js/icons.js`, `static/app.js`, `static/js/chat.js`, `static/js/social.js`, `static/js/settings-center.js` (novo), `src/bin/desktop_assets.rs`, `src/bin/SancordApp.rs`, `tests/frontend-settings-center.test.cjs` (novo), `DISCORD_GAP_AUDIT.md`, `CHANGELOG.md`.
- **22 páginas reais em 4 grupos:**
  - `CONTA`: `account`, `profile` (sub-abas Global e Perfis por servidor), `security`, `devices`, `connections`.
  - `PRIVACIDADE E SOCIAL`: `privacy`, `social`, `requests`, `blocked`, `activity`.
  - `CONFIGURAÇÕES DO APP`: `voice`, `notifications`, `appearance`, `accessibility`, `chat`, `language`, `shortcuts`, `windows`.
  - `SANCORD`: `updates`, `advanced`, `diagnostics`, `about`.
- **Componentes e UX:** busca profunda (`#settings-search-results`) navegando e destacando opções por página; `SettingsSection`, `SettingsRow`, switch unificado, indicador `Sincronizado com sua conta` vs `Somente neste dispositivo`, botão de fechar com rótulo `ESC`, scroll independente de sidebar e conteúdo, coluna útil de 860px (1060px no editor de Perfil).
- **Novas chaves locais (`localStorage["sancord_audio_settings"]`, retrocompatível via merge com `DEFAULT_AUDIO_SETTINGS`):** `pttReleaseDelayMs`, `screenDefaultQuality`, `screenDefaultFps`, `screenDefaultAudio`, `soundEvents` (10 sons individuais), `showChatAvatars`, `showChatTimestamps`, `compactSidebar`, `chatGroupGap`, `uiZoom`, `customAccentColor`, `notifShowPreview`, `notifWhenFocused`, `notifTitleBadge`, `uiSaturation`, `highContrast`, `roleColorsMode`, `enhancedFocus`, `ttsEnabled`, `ttsRate`, `ttsVolume`, `chatConvertEmoticons`, `chatInlineImages`, `chatAutoplayVideo`, `chatSpellcheck`, `chatEnterSends`, `chatGroupMessages`, `chatGroupWindowMins`, `chatTimeFormat`, `regionalDateFormat`, `customShortcuts`, `updatesAutoCheck`, `developerMode`, `logLevel`.
- **IPC Desktop Windows (`src/bin/SancordApp.rs`):** `desktop:get-state`, `desktop:set-autostart:1|0` (`HKCU\...\Run\SancordDesktop`), `desktop:set-start-minimized:1|0`, `desktop:set-minimize-on-close:1|0`, `desktop:open-data-dir`, flag CLI `--minimized` e `desktop-prefs.json` no diretório de dados do cliente.
- **Validação:** `cargo test --locked --all-targets --target-dir target-review-phase6` (**154 núcleo + 8 desktop + 1 release_tools**) e `node --test tests/frontend-*.test.cjs` (**192 frontend**) = **355 testes aprovados, 0 falhas** (1 teste de artefato assinado de CI ignorado).
- **Pendências honestas (não simuladas):** TOTP/Passkey (planejado), OAuth externo para Steam/Twitch/Spotify/YouTube (hoje links manuais + GitHub verificado por bio), detecção nativa de jogos em execução, bandeja do sistema (tray icon) além de minimizar para barra de tarefas, e conferência visual no executável Windows WebView2 em 1366×768 / 1920×1080 / 2560×1440.
- **Próximo passo:** aguardar novas solicitações do usuário ou autorização explícita para empacotar/publicar `v0.2.3`.

### Reforma e Expansão Completa do Sistema de Convites de Servidores — 19/11/2026

- **Arquivos alterados/criados:** `src/models.rs`, `src/permissions.rs`, `src/chat.rs`, `src/db.rs` (migração `SCHEMA_VERSION = 19`), `src/state.rs`, `src/access.rs`, `src/http.rs`, `src/lib.rs`, `src/ws.rs`, `src/invites_tests.rs` (novo), `src/tests.rs`, `src/bin/desktop_assets.rs`, `static/js/transport.js`, `static/js/icons.js`, `static/js/permissions.js`, `static/js/invites.js` (novo), `static/js/servers.js`, `static/js/chat.js`, `static/app.js`, `static/index.html`, `static/ui.css`, `tests/frontend-invites.test.cjs` (novo), `CHANGELOG.md`, `DISCORD_GAP_AUDIT.md`.
- **Backend & Segurança (schema v19):**
  - Códigos criptográficos via `OsRng` no formato `SANC-XXXXXXXX` (8 chars Base32 sem ambiguidade, 40 bits de entropia, mantendo retrocompatibilidade com códigos `SANC-XXXXXX` legados).
  - Revogação por tombstone (`invites.revoked_at`, `invites.revoked_by`): códigos revogados nunca são reutilizados e retornam `410` / `"Este convite não é mais válido."`.
  - Convites vinculados a canal (`invites.channel_id`), associação temporária (`invites.temporary`, `server_members.temporary`, com remoção automática ao desconectar a última sessão caso o membro não tenha recebido cargo — e promoção automática a permanente ao receber cargo) e registro de `last_used_at`.
  - Pausa/retomada de convites (`servers.invites_paused`, `ClientMessage::SetInvitesPaused`) sem apagar links ativos e preservando expirações naturais.
  - Regras opcionais de entrada (`servers.rules_text`), link personalizado por slug (`SetCustomInviteSlug` + `ServerState::validate_custom_invite_slug`: 3–32 chars `[a-z0-9-]`, palavras reservadas bloqueadas, unicidade global entre servidores e códigos/tombstones de convite, auditoria `custom_invite_slug_set`/`clear` e UI dedicada em Configurações do Servidor → Convites), permissão `manage_invites` separada de `create_invites` e sobrescrita por canal de `create_invites`.
  - Prévia HTTP em `GET /api/invites/:code` (e alias legado `/api/invite/:code`) com autenticação Bearer opcional (`already_member`, `banned` genérico sem vazar motivo), ocultação de nome de canal privado e rate limits em prévia, criação, entrada e envio por DM.
  - Entrada atômica sob lock de escrita (evita race condition em convites com 1 uso restante), incremento de `uses` somente após entrada bem-sucedida, registro de auditoria (`invite_create`, `invite_revoke`, `invites_paused`, `invites_resumed`, `member_join_invite`) e mensagem de sistema persistida + `ServerMemberJoined`.
- **Frontend (`static/js/invites.js` + `static/js/transport.js`):**
  - Abstração central `SancordNet.INVITE_BASE_URL`, `SancordNet.inviteUrl(code, origin)` e `SancordNet.extractInviteCode(raw)`.
  - `InviteModal` (2 páginas: busca instantânea de amigos/contatos de DM, estado `"Já está no servidor"`, envio em 1 clique com trava `"Enviado ✓"`, link + copiar `"Copiado ✓"`, e Página 2 `← Configurações do convite` com expiração, limite de usos, canal e associação temporária sempre gerando um novo link).
  - Pontos de entrada: cabeçalho do servidor, menu de contexto do servidor, ícone hover `user-plus` ao lado de canais com permissão `create_invites`, e Configurações do Servidor → Convites (`+ Criar convite`).
  - `InvitePreviewModal` completo antes de entrar (ícone, banner, descrição, online/membros, convidador, canal, checkbox de regras, `"Você já participa deste servidor."` e erros claros) + hidratação ao vivo de `.dm-server-invite-card`.
  - `InviteManagementPage` com tabela estruturada (`CÓDIGO | CRIADO POR | CANAL | USOS | EXPIRAÇÃO | AÇÕES`), banner e botão de pausa/retomada, detalhes completos, confirmação para revogar e sincronização em tempo real via `InvitesList`.
- **Migração verificada:** `scripts/test-migration.ps1` validou cópia somente-leitura do banco real (`v14 → v19`; 31 tabelas preservadas por hash; integridade OK).
- **Validação automatizada:** `cargo test --locked --all-targets --target-dir target-review-phase6` (**162 núcleo + 8 desktop + 1 release_tools**, 1 ignorado de CI) e `node --test tests/frontend-*.test.cjs` (**197 frontend**) = **368 testes aprovados, 0 falhas**.
- **QA Visual & Funcional no WebView2 nativo (`SancordApp.exe` + `sancord.exe` em pasta/porta temporárias isoladas):**
  - Verificados ao vivo: login pela interface, criação de servidor com regras, link personalizado (`comunidade-qa`), botão hover de convite nos canais, `InviteModal` Páginas 1 e 2, `InvitePreviewModal` via slug personalizado, `InviteManagementPage` com tabela de 3 convites + toolbar + slug, Central de Configurações com 22 páginas em 4 grupos e IPC Windows Desktop (`winAvailable: true`) em `1366×768` e `1920×1080`, com **0 erros de console** e **0 overflow horizontal**.
  - Quatro refinamentos visuais identificados na primeira captura (alinhamento à esquerda no `InviteModal`, altura do botão `Copiar`, banner full-bleed + botão fechar contrastado no `InvitePreviewModal` e toolbar em linha única no gerenciamento) foram corrigidos em `static/ui.css`, retestados e revalidados em nova rodada de capturas no WebView2.
- **Próximo passo:** empacotar/publicar `v0.2.3` quando autorizado pelo usuário.

## 19/11/2026 · Refatoração visual de perfis e mural

Implementação local sobre as fontes da v0.2.3.

- `static/js/profile-card.js` centraliza a identidade do cartão, o avatar e a arte versionada de três coleções. `profile-sharing.js` usa esse renderizador no cartão rápido ancorado, com campos filtrados pela resposta `UserProfile`. O perfil completo preserva o mural e as demais abas. `profile.js` e `settings-center.js` usam o mesmo renderizador nas prévias, nos seletores e no formulário por servidor.
- O editor oferece seis contextos, tema claro/escuro independente, amostras de fontes e efeitos, replay e confirmação ao fechar um rascunho. Selecionar um cosmético ou aceitar o resultado de **Surpreenda-me** prepara o rascunho. **Salvar alterações** continua enviando `UpdateProfile` e preserva a validação de posse existente.
- Cada arte de referência tem planos específicos para decoração, moldura e efeito. As preferências de movimento por família são locais. A renderização mantém a política do Windows, interrompe reprodução em segundo plano e reaproveita elementos de avatar, garantindo os limites existentes de animação e mídia.
- Esquema SQLite 20. `Account.created_community` registra a autoria sem exibi-la no JSON público. `restore_first_creation` tenta recuperar criadores antigos pelo convite permanente criado junto com o servidor. Conquistas de mensagem consultam o índice de autor fora do lock de escrita e contam até 500. Os testes cobrem transferência, recuperação e persistência da autoria, contagem e privacidade do mural.
- Builds locais de `SancordApp.exe` e `sancord.exe` usam `target-review-phase6`. Suítes aprovadas com 199 testes frontend e 173 testes Rust, incluindo desktop e ferramenta de manutenção. Um ensaio de assinatura continua marcado como ignorado no ambiente local. Migração de cópia de v19 para v20 preservou por hash as 32 tabelas existentes e passou a verificação de integridade.
- `scripts/profile-motion-qa.mjs --art` usa `scripts/profile-art-qa.mjs` para capturar a interface embutida real no WebView2 em 1366×768, 1920×1080 e 2560×1440. O ensaio usa perfis e imagens sintéticos sem usar contas ou banco de produção. A pasta `qa-profile-redesign` é ignorada pelo Git. O ensaio de movimento com 240 perfis confirmou limite de dois GIFs e uma superfície animada, com zero originais e zero superfícies após perda de foco.
- Pendências de homologação externa incluem webcam física e conexão TURN entre redes independentes. O ensaio local de mídia continua limitado à infraestrutura disponível.

## 19/11/2026 · Composer e chamadas desktop

Implementação local sobre as fontes da v0.2.3. O cliente Windows continua carregando o frontend embutido. O `Welcome` anuncia suporte a figurinhas, mensagem de voz e agendamento. Instalações que apontam para backends anteriores continuam com as ações compatíveis.

- `static/js/composer.js` coordena o menu, as permissões visuais e os rascunhos em memória por conta e conversa. `chat.js` mantém o envio WebSocket, a edição inline e os anexos. Os anexos aguardam o envio na bandeja e o texto é preservado ao trocar de canal. A fila de upload avança em segundo plano sem enviar em outra conversa. O menu e o submenu usam `SancordUI.contextMenu`.
- `static/js/stickers.js` fornece a coleção original e a importação, com listas de servidor, recentes e favoritos. `static/js/voice-recorder.js` captura uma trilha própria, limita a sessão a cinco minutos e libera as trilhas ao parar, cancelar ou trocar de conversa. `src/uploads.rs` valida e persiste os tipos de apresentação `sticker` e `voice` nos anexos. O runtime reutiliza o MIME e a entrega existentes.
- `src/scheduled.rs` controla a fila privada. `scheduled_messages` entra no esquema SQLite 21. Publicação e remoção da fila usam a mesma transação do escritor do banco e um ID determinístico. `ws::send_chat_message` aplica o fluxo normal de permissão, AutoMod, menções, modo lento e distribuição também a envios agendados. Falhas permanecem na fila até o usuário remover a entrada. O app aceita agendamentos de texto em até 30 dias.
- `servers.js` monta as salas e `voice.js` monta os participantes, o menu de volume local, a qualidade WebRTC e os controles da chamada privada. A deteção de fala altera as classes e o ícone da pessoa correspondente. Captura, reprodução, renegociação WebRTC e compartilhamento continuam pelos fluxos existentes.
- `scripts/profile-motion-qa.mjs --composer-voice` usa `scripts/composer-voice-qa.mjs` para abrir `SancordApp.exe` numa sessão isolada, usar o microfone virtual do WebView2 e gerar capturas em `qa-composer-voice`. As capturas incluem menu e submenu, enquete, figurinhas, anexos e resposta, gravação, dez participantes, volume e chamada privada. `SANCORD_QA_EXE` aponta para builds fora de `target/debug`. O original do banco foi aberto para leitura no ensaio de migração. A cópia de v19 para v21 preservou 32 tabelas por hash.
- Validação final com 381 testes aprovados e um ensaio de assinatura ignorado. O desktop foi conferido em 1120×730, 1366×768 e 1920×1080, incluindo a reprodução da gravação feita com microfone virtual. Testes WebSocket confirmaram acesso privado à fila, cancelamento, retomada após reinício, publicação com autor desconectado e revalidação de acesso no horário previsto.
- Clipes e execução de comandos de apps de terceiros ficam para outra etapa. A nova UX de voz continua com homologação pendente em webcam física e TURN entre redes independentes.

## 19/11/2026 · Homologação RTC sem webcam

- `scripts/rtc-qa.mjs` usa dois clientes Windows, contas e backend locais descartáveis, microfone virtual do WebView2 e stream de câmera sintético. O caminho normal de sinalização, RTP, palco e controles passou em conexão direta e com TURN/UDP forçado. Também foram confirmados mute da trilha, encerramento da câmera e saída/retorno à sala.
- O servidor Pion TURN executou temporariamente com credenciais efêmeras. Ambos os clientes usaram candidato selecionado `relay` nas duas pontas. As evidências ficam em `qa-rtc/direto` e `qa-rtc/relay`. O roteiro e os limites do ensaio estão em `HOMOLOGACAO.md`.
- O segundo ensaio passou com TURN/UDP por dois NATs virtuais isolados do QEMU e confirmou áudio e vídeo nos dois sentidos. `SANCORD_QA_TURN_URL_B` permite indicar uma rota separada para o segundo cliente. As medições de cada NAT e as estatísticas WebRTC estão em `qa-rtc/nats-isolados`. Seguem pendentes webcam física e TURN com dois acessos independentes à internet.

## 19/11/2026 · Novo ícone do app ("Diálogo em S")

- O ícone antigo era a ilustração em `static/logo.png`: ilegível abaixo de 48 px, e o favicon usava `#5865F2`. Ele foi trocado por uma marca geométrica de dois balões de fala em simetria rotacional. Juntos, os balões formam um S, sem texto, sem rosto e sem elementos do Discord.
- `branding/ICON_DESIGN.md` registra:
  - os 3 conceitos e a comparação;
  - a escolha e o refinamento;
  - o mini design system: geometria, raios, cores, sombra, versões e regras de uso.
- As fontes ficam em `branding/icon/`:
  - SVG mestre, versão pequena de 16–32 px, quadrado sangrado, símbolo para fundo escuro e claro, versão monocromática;
  - PNGs de 16 a 512;
  - `sancord.ico` com 16–64 em BMP 32 bits e 128/256 em PNG;
  - RGBA 64×64.
- Os conceitos e `comparativo.png` ficam em `branding/concepts/`. `branding/export.html` regenera tudo e depende de um servidor local com `POST /save`.
- Aplicado em:
  - `icon.ico` (recurso do `.exe` via `icon.rc`);
  - `icon_rgba.bin` (ícone da janela);
  - `static/sancord-icon.svg` (favicon, versão pequena);
  - `static/logo.png` (quadrado sangrado 512, usado no login, ícone do hub, avatar do sistema e Sobre).
- Os arquivos antigos foram preservados em `branding/legacy/`.
- Validação: `cargo build --all-targets`, 176 testes Rust aprovados (1 ignorado) e 205 frontend aprovados. O PNG 256 foi confirmado dentro do `SancordApp.exe` recompilado em `target-dev`. A tela de login foi conferida no navegador.
- Produção não foi tocada. O novo ícone só chega aos usuários num próximo build/release, que depende de autorização de publicação.- **Cliente do atalho atualizado (autorizado pelo usuário, 19/11/2026):**
  - `D:\Sancord\Sancord.exe` agora é o bundle release gerado por `scripts/build-desktop.ps1 -OutputDir qa-desktop-icon`, com SHA-256 `5E3251D61E6E…` e 9.779.200 bytes, já com o novo ícone.
  - O exe anterior ficou em `Sancord-before-icon.exe` (`2A80C90AFF4E…`).
  - O atalho da área de trabalho passou a apontar o ícone para `Sancord.exe,0`, e o cache de ícones foi renovado com `ie4uinit -show`.
  - O app abriu normalmente (`SancordDesktop`, janela "Sancord").
  - `SancordServer.exe`, a produção na porta 3000, não foi parado nem trocado. O `/logo.png` servido por ele aos outros clientes continua o antigo até a próxima atualização do servidor.
  - **Rollback:** fechar o app e copiar `Sancord-before-icon.exe` de volta para `Sancord.exe`.
## 19/11/2026 · Compartilhar tela: janelas minimizadas e janelas fantasmas

- **Problema relatado:** a aba Aplicativos não mostrava os programas abertos. Aparecia apenas "Configurações" (duas vezes) e "Experiência de Entrada do Windows".
- **Causa:** em `src/bin/capture_bridge.rs`, `enum_windows_proc` descartava toda janela minimizada (`IsIconic`) e não filtrava as janelas ocultas pelo DWM (`DWMWA_CLOAKED`): apps UWP suspensos, o painel de entrada e janelas de outras áreas de trabalho. O filtro "Windows Input Experience" só funcionava com o Windows em inglês.
- **Correção:**
  - `is_shareable_app_window` aplica a regra do Alt+Tab: janela visível, não oculta pelo DWM, sem `WS_EX_TOOLWINDOW`, sem dono (a não ser com `WS_EX_APPWINDOW`) e de outro processo;
  - janelas minimizadas entram na lista depois das abertas, com o tamanho de `rcNormalPosition` e uma miniatura com o ícone do app (`WM_GETICON` com timeout, depois o ícone da classe). `CaptureSourceInfo.minimized` sinaliza esses casos;
  - `start_capture` restaura a janela minimizada com `SW_SHOWNOACTIVATE`, sem roubar o foco. Se ela for minimizada durante a transmissão, os espectadores continuam vendo o último quadro;
  - adicionada a feature `Win32_Graphics_Dwm` do crate `windows`, sem crate novo e sem mudança no lock;
  - no frontend, o card ganhou a etiqueta "Minimizada" (`app.js?v=35`, `styles.css?v=21`).
- **Testes:**
  - novo `tests/frontend-screen-picker.test.cjs`; frontend com 206 aprovados;
  - Rust com 176 aprovados;
  - teste manual ignorado `lista_janelas_reais`, rodado na máquina real: listou Claude, WhatsApp, Brave e Discord, os três últimos minimizados com ícone, e nenhuma "Configurações" fantasma.
- **Ainda não testado:** transmitir de fato uma janela minimizada numa chamada e ver a restauração.
- **Instalação local:** `Sancord.exe` do atalho trocado pelo novo release (`EC930121FF0B…`, 9.785.344 bytes). O backup do original segue em `Sancord-before-icon.exe`.
- **Publicação:** a `v0.2.3` já está no GitHub (tag `af2ff0dd`, publicada em 19/11 às 18:43Z). As mudanças do ícone e desta correção sairão como `0.2.4`. Isso exige subir a versão no `Cargo.toml`/`Cargo.lock`, escrever o CHANGELOG, fazer o commit pela API do GitHub (não há git local) e criar a tag, com autorização do usuário.
## 19/11/2026 · EM ANDAMENTO (Claude): pedidos do usuário nesta rodada

> Se outra IA continuar daqui: leia esta seção inteira primeiro. Os itens marcados ✅ estão nos fontes, testados e instalados no atalho (`D:\Sancord\Sancord.exe`). Os itens 🔧 estão em andamento. Os itens ⏳ ainda não foram iniciados. Nada foi publicado no GitHub: a `v0.2.3` já existe lá (tag `af2ff0dd`, publicada pela outra IA), então a próxima versão será a **0.2.4**, e só com autorização.

### Ordem pedida pelo usuário
1. ✅ Novo ícone do app ("Diálogo em S"). Detalhes na seção do ícone acima e em `branding/ICON_DESIGN.md`.
2. ✅ Compartilhar tela: janelas minimizadas e janelas fantasmas. Ver a seção correspondente acima.
3. ✅ **Microfone não funcionava nas calls.**
   - **Causa:** o perfil WebView2 do cliente (`%LOCALAPPDATA%\SancordDesktopData\EBWebView\Default\Preferences`) tinha `media_stream_mic` bloqueado (setting=2) para `http://sancord.localhost:80`. O Windows liberava, e o microfone AOC GH300 estava OK.
   - **Correção:** novo `src/bin/desktop_permissions.rs`. Ao abrir, o app chama `ICoreWebView2Profile4::SetPermissionState`, com ALLOW de microfone e câmera para `APP_ORIGIN`, e trata `PermissionRequested` liberando só microfone e câmera e só em `desktop_assets::is_app_page`.
   - Foi adicionada a dependência direta `webview2-com = "0.33"` (mesma versão que o wry usa; o `Cargo.lock` ganhou só essa linha) e a feature `Win32_System_WinRT`.
   - Há teste unitário da regra.
   - Instalado no atalho (`Sancord.exe` com hash `75449B5E1054…`). O usuário precisa fechar e reabrir o app. **Confirmado pelo usuário em 22/11/2026: o microfone voltou a funcionar.**
4. ✅ **Refazer completamente a interface de personalização de perfil.** O prompt longo do usuário pede 3 colunas no estilo da referência: editor compacto à esquerda, perfil completo real no centro e mural/widgets à direita, com subeditores, prévia ao vivo e salvar só no fim.
   - O usuário citou 2 imagens de referência que **não chegaram**. Foi implementado e validado seguindo a descrição completa em texto.
   - **Feito e validado (211 testes frontend + 177 Rust passando = 388 testes):**
     - `static/index.html`: `#settings-tab-profile` foi reescrito. `.pe-shell` contém:
       - `.pe-sidebar`, com as views `data-pe-view` = home | name | theme | banner | decoration | frame | effect | nameplate | about | status | collection | board;
       - `.pe-stage`, com `#live-profile-preview-card.profile-card.profile-modal-2col`: o MESMO cartão do perfil visitado, com coluna esquerda e mural/atividade à direita;
       - `#pe-context-popover`, o menu "Pré-visualizar em" com cartão rápido, mensagem, membros, DM e painel.
       - Todos os IDs antigos dos controles foram preservados (só mudaram de lugar).
       - As abas antigas "Perfil global/Perfis por servidor" ficaram escondidas: o seletor `#pe-profile-target` leva para a página de perfil por servidor.
     - `static/js/profile-editor.js` (novo, `?v=1`, rota em `desktop_assets.rs`):
       - navegação `openPeView` / `closePeSubeditor` / `handlePeEscape`;
       - galerias de decoração e moldura com filtros;
       - listas de efeito e placa com amostra real (hover reproduz, clique aplica ao rascunho e toca o efeito uma vez no perfil);
       - abas Fontes/Efeitos/Cores do nome com prévia no hover;
       - faixa com "Reposicionar e zoom" (reabre o recorte);
       - `peAfterRefresh`: membro desde, conexões visíveis, "Adicionar pronomes" e "Adicionar uma bio" só no editor, miniaturas de efeito e moldura, atividade;
       - `onBoardEditorChanged`: mural do rascunho, atalhos de widget e "Ver todos os widgets";
       - `onProfileEditorShown`, chamado por `switchSettingsTab("profile")`.
     - `app.js`:
       - os botões de decoração, moldura, efeito e placa abrem os subeditores, não os modais antigos;
       - `isProfileDraftDirty = isProfileFieldsDirty || boardIsDirty`;
       - Salvar envia também o mural (`board-save`), e Redefinir e Descartar também descartam o mural;
       - Esc volta do subeditor antes de fechar;
       - `refreshLiveProfilePreview` chama `peAfterRefresh`.
     - `profile.js`: o contexto "popout" saiu; os contextos não escondem mais o perfil; o replay usa `#preview-effect-layer`.
     - `profile-board.js`: `renderVisitedBoard(board, msg, root)` e o gancho `onBoardEditorChanged`.
     - `profile-sharing.js`: `selfProfileLinks` e `renderVisitedProfileLinks(links, wrap, list)`.
     - `ui.css` (`?v=16`):
       - bloco "Editor visual de perfil" no fim do arquivo;
       - layout full-height com rolagem independente;
       - responsivo por container query (abaixo de 980px some o mural);
       - pausa de animações fora do hover ou da seleção;
       - fundo do mural com `color-mix` para o tema do perfil aparecer, valendo também no perfil visitado;
       - **ajustes finos de CSS pós-QA visual no WebView2:**
         - `.pe-placeholder-link` com contraste adaptável ao tema do cartão (`color-mix(in srgb, currentColor 86%, var(--accent, var(--brand)))`);
         - `.pe-widget-grid` com `repeat(auto-fit, minmax(128px, 1fr))` para preencher bem a largura do mural em telas 1080p sem deixar espaço vazio à direita;
         - `.effect-option-preview:has([data-profile-effect="..."])` com prévia estática colorida para todos os 19 efeitos de perfil (corrigindo miniaturas pretas fora do hover, como "Brasas Carmesim").
     - Testes atualizados para o novo layout: `frontend-profile-art`, `p1`, `p3` e `p4`.
5. ✅ (instalado em `D:\Sancord\Sancord.exe`) **Criar canal de voz criava canal de texto.**
   - **Causa,** confirmada no `audit_log` de uma CÓPIA do banco (`channel_create privadão tipo: text`): o "+" da categoria de voz (e "Criar canal aqui") abria o diálogo já em "Texto".
   - **Correção:** `categoryChannelKind(srv, cat)` em `servers.js`. Categoria só com voz, ou vazia com nome de voz/call, abre em "Voz".
   - Também corrigido `ChannelCreated` em `app.js`: anúncio e fórum iam para a lista de voz até recarregar.
   - Teste novo: `tests/frontend-create-channel.test.cjs`.
6. ✅ (instalado em `D:\Sancord\Sancord.exe`) **Nome do canal cortado** ("fotos-rand…"): os botões de convite e engrenagem eram invisíveis, mas ocupavam espaço. Agora, em `ui.css`, eles só ocupam espaço no hover ou foco, e o nome usa a largura toda.
7. ✅ (instalado em `D:\Sancord\Sancord.exe`; corrigido com `voiceStageMatchesView` e `syncVoiceStageContext` em `app.js`, classe `.stage-out-of-context` e teste `frontend-voice-stage-context`) **Painel da call do servidor aparecendo dentro da conversa privada (DM).** O usuário estava numa call ("Call") de outro servidor e, ao abrir a DM com um amigo, o palco da call aparecia em cima do chat da DM. O palco deve aparecer só no servidor e canal da call, ou na DM quando a call é privada com aquela pessoa.
8. ⏳ Publicação da **0.2.4** (aguardando autorização explícita do usuário):
   - versão no `Cargo.toml` e no `Cargo.lock`;
   - CHANGELOG;
   - commit pela API do GitHub, porque não há git local (ver a seção "Commit 0.2.1 pela API");
   - tag `v0.2.4`.
   - O servidor de produção (`SancordServer.exe`, porta 3000, v0.2.3) não foi tocado em nada disso.
### Atualização 19/11/2026 18:45: QA WebView2 concluído + ajustes finos + build final instalado
- **QA visual e funcional real no WebView2 (binários release `target/release/sancord.exe` + `target/release/SancordApp.exe`):**
  - Resoluções testadas: `1366×768` (3 colunas: editor `290 px`, prévia `768 px`, mural `267 px`, sem overflow horizontal), `1920×1080` (grade de widgets preenchida em 4 colunas e miniaturas estáticas de efeito/moldura visíveis) e `900×720` (mural recolhido via container query, sem overflow).
  - Fluxo completo validado contra servidor real isolado: subeditores (`name`, `theme`, `decoration`, `frame`, `effect`, `about`), popover `"Pré-visualizar em"`, `Salvar alterações` (`#save-profile-btn` persistindo bio, pronomes, decoração `flame-violet`, moldura `core-pulse` e efeito `embers`, limpando barra dirty) e `Redefinir` (`#reset-profile-draft-btn` restaurando estado salvo).
  - Validados também os itens 5 (`inferredVoiceKind: "voice"` no `+` de categoria de voz) e 6 (`nameWidthRatio: 0.79` em canal de nome longo), com **0 erros de console**.
- **Testes automatizados após os ajustes finais de CSS:** `211/211` frontend (`node --test tests/frontend-*.test.cjs`) e `177/177` Rust (`cargo test --locked --all-targets --target-dir target-review-phase6`; 2 testes manuais/CI ignorados) = **388 aprovados, 0 falhas**.
- **Instalado no atalho `D:\Sancord\Sancord.exe`:**
  - SHA-256: `99CE6DCFB4CC1652CA4DF4F6ED4B8609A161C5651E3782C14F3ACB39504EB03F`
  - Tamanho: `9.847.296` bytes (gerado via `scripts/build-desktop.ps1 -OutputDir qa-desktop-icon`; backup original preservado em `D:\Sancord\Sancord-before-icon.exe`).
  - `D:\Sancord\SancordServer.exe` (`v0.2.3`, porta 3000) e `D:\Sancord\data\sancord.db` não foram tocados e seguem saudáveis.
### Atualização 19/11/2026 19:02: Lista lateral de membros refatorada + build reinstalado
- ✅ **Agrupamento e apresentação da lista lateral de membros (`static/js/member-list.js`, `static/app.js`, `static/index.html`, `static/ui.css`, `static/js/servers.js`, `src/bin/desktop_assets.rs`):**
  - Removido o cabeçalho global `MEMBROS ONLINE — X` na visualização de servidor (mantido apenas `MEMBROS DA THREAD — X` em threads); contagem online preservada nos tooltips do servidor.
  - Função central pura `buildMemberGroups(members, roles, options)` + componentes `MemberList`, `MemberGroup`, `MemberGroupHeader` e `MemberItem` em `static/js/member-list.js`.
  - Ordem estrita: cargos destacados (`hoist` / `display_separately`) por hierarquia (`position` decrescente) → `Disponível — X` (online/ausente/DND sem cargo destacado) → `Offline — X` (offline/invisível, sem duplicação e com visual apagado/dessaturado legível). Seções vazias omitidas.
  - Sem hardcode de `FUNDADOR`, `OWNER` ou `BOT'S`; nome exato do cargo preservado (sem `text-transform: uppercase` nem emojis automáticos no cabeçalho).
  - Cor do nome resolvida pelo cargo mais alto com cor explícita (independente de `hoist`); coroa pequena do proprietário (`SVG`) à direita do nome; badge `APP` para bots/aplicações; atividade em linha única priorizando castigo → canal de voz visível (`🔊 Call Privada`, respeitando `view_channel`) → atividade/status personalizado; decorações compactas sem alterar altura da linha; memoização por assinatura de render para evitar rebuilds desnecessários.
  - Rótulo da configuração do cargo atualizado para `"Exibir membros deste cargo separadamente na lista de membros"` e novos cargos criados com `hoist: false` por padrão.
- **Testes automatizados:** `216/216` frontend (incluindo novo `tests/frontend-member-list.test.cjs` com cobertura unitária, DOM e realtime) + `177/177` Rust = **393 aprovados, 0 falhas**.
- **QA visual no WebView2 (release):** verificado em `1366×768` com `👑 DEUS — 1`, `| 💻 | Bot's — 1`, `Disponível — 2`, `Offline — 3`, coroa pós-nome, badge `APP`, voz `🔊 Call Privada`, 0 duplicatas e 0 erros de console.
- **Instalado no atalho `D:\Sancord\Sancord.exe`:**
  - SHA-256: `D8596B5106ABAF2F4D2973576DF923872C461466D17163D86E675DCE1CED0C61`
  - Tamanho: `9.863.168` bytes (`D:\Sancord\Sancord-before-icon.exe` e `D:\Sancord\SancordServer.exe` `v0.2.3` preservados intactos).
### Atualização 19/11/2026 19:15: Rebalanceamento espacial e responsividade do Editor de Perfil + build reinstalado
- ✅ **Proporções, respiro visual e responsividade do novo Editor de Perfil (`static/ui.css`, `static/index.html`, `static/js/profile-editor.js`):**
  - Tokens consolidados em `.settings-profile-panel`: `--profile-editor-gap`, `--profile-section-gap`, `--profile-card-padding`, `--profile-column-gap`, `--profile-preview-padding`, `--widget-grid-gap`.
  - Hierarquia de larguras rebalanceada sem alterar o layout em 3 colunas nem mexer no backend:
    - `1920×1080` (100% DPI): Settings `234 px` | Editor `350 px` | Prévia **`783 px`** (protagonista; cresce para `1272 px` ao ocultar Mural) | Mural **`471 px`** (grade 2×2).
    - `2560×1440` (100% DPI): Settings `236 px` | Editor `350 px` | Prévia **`1132 px`** | Mural **`600 px`** (centralizado com `max-width: 2120px`).
    - `1600×900` (100% DPI): Settings `208 px` | Editor `303 px` | Prévia **`628 px`** | Mural **`379 px`** (grade 2×2).
    - `1366×768` (100% DPI): Settings `208 px` | Editor `300 px` | Prévia **`795 px`** | Mural recolhido por padrão, acessível como gaveta lateral (`420 px`) pelo botão `Mural` (`#pe-mural-toggle`) e fechável por `✕` ou `Esc`.
    - `1920×1080` @ `125% DPI` (`1536×864`): `208` + `300` + `590` + `357` px (4 áreas equilibradas).
    - `1920×1080` @ `150% DPI` (`1280×720`): `208` + `300` + `708` px (Mural recolhido via botão).
    - Janela pequena (`960×720`): botão `☰` (`#pe-nav-toggle`) recolhe a sidebar de Configurações (`208 → 0 px`), preservando Editor (`300 px`) + Prévia (`596 px`) lado a lado; `0` overflow horizontal em todos os cenários.
  - Respiro interno aumentado: padding `18 px` no editor com superfície sutil, tiles maiores (`min-height: 124 px`) com ellipsis + tooltip `title` automático, banner `132 px`, padding lateral `24 px` na prévia, safe area do avatar/decoração, `profile-card-info-stack` mais espaçoso, scrollbars discretas (`scrollbar-width: thin`) e grid do mural adaptativo (`2 cols → 1 col` abaixo de `310 px`).
- **Testes automatizados:** `216/216` frontend + `9/9` `SancordApp` aprovados, `0` falhas, `0` erros de console no QA WebView2 multi-resolução.
- **Instalado no atalho `D:\Sancord\Sancord.exe`:**
  - SHA-256: `ADC22819FB8791F17462407B916AED0872BD86E33A065F968B82093F7014428B`
  - Tamanho: `9.871.360` bytes (`D:\Sancord\Sancord-before-icon.exe` e `D:\Sancord\SancordServer.exe` `v0.2.3` preservados intactos).
### Atualização 19/11/2026 19:43: Sancord v0.2.4 publicado oficialmente no GitHub
- ✅ Atalho da área de trabalho (`C:\Users\gabri\Desktop\Sancord.lnk`) atualizado para `IconLocation = D:\Sancord\icon.ico,0` + flush do cache de ícones do Windows (`SHChangeNotify` + `ie4uinit.exe -show`).
- ✅ **Commit na `main`:** `8db77453ffccda5e9a09a4ace4db83deba1b8c69` (53 alterados, 51 novos, 0 removidos; `Cargo.toml`, `Cargo.lock` e `CHANGELOG.md` em `0.2.4`; `sancord-release validate v0.2.4` OK; `393` testes aprovados).
- ✅ **Tag e Release oficial (`Latest`):** `v0.2.4` — https://github.com/gabrielsanderx/Sancord/releases/tag/v0.2.4
  - GitHub Actions `Stable Windows release` run `44628337277`: `tests`, `package`, `sign`, `verify-package` (HTTPS assinado) e `publish` todos aprovados (`0` falhas).
  - Artefatos publicados: `Sancord.exe` (`9.748.480` B), `SancordServer.exe` (`14.701.568` B), `Sancord-0.2.4-windows-x64.zip` (`4.395.704` B), `sancord-update.json` (`2.155` B) e `sancord-update.sig` (`128` B).
- **Produção local:** `D:\Sancord\SancordServer.exe` ainda segue na `v0.2.3` (porta `3000`, `data/sancord.db` esquema `v19`) aguardando autorização caso o usuário queira migrar o host local para a `v0.2.4` oficial (com backup prévio antes da migração `v19 → v21`).
### Atualização 19/11/2026 19:55: Self Profile Menu no painel inferior (local, pós-v0.2.4)
- ✅ **Self Profile Menu (`static/js/self-profile-menu.js`, `static/index.html`, `static/app.js`, `static/ui.css`, `src/bin/desktop_assets.rs`):**
  - Removida a abertura direta de Configurações / file picker ao clicar no avatar/nome do painel inferior (`#self-profile-trigger` / `#self-avatar`); agora alterna o menu rápido `#self-profile-menu` ancorado acima do dock (`328 px`, reposicionado no resize, animação `120ms` fade+translate).
  - Engrenagem (`⚙`), Microfone (`🎙`) e Fone (`🎧`) permanecem independentes; hover sutil apenas sobre `#self-profile-trigger`.
  - Cabeçalho reutiliza `renderProfileCardIdentity(..., "SELF_PROFILE_MENU")` com dados em cache (abertura instantânea, efeito pesado desativado neste contexto, sincronizado em realtime via `updateSelfProfileUI`).
  - Ações reais com ícones SVG do Sancord (`SancordIcons`): **Editar perfil** (abre `Configurações → Perfis`), **Status ›** (`Online`, `Ausente`, `Não perturbe`, `Invisível` em realtime + modal rápido **Definir status personalizado** + **Limpar status personalizado**), **Insígnias ›** (exibida apenas se a conta possuir badges reais), **Minha coleção ›** (atalhos diretos para decorações, molduras, efeitos, placas, estilos de nome e coleção/presets), **Mudar de conta ›** (seletor multi-conta com tokens isolados por origem, `Adicionar conta` e `Sair de todas as contas`) e **Copiar ID do usuário** (visível somente com Modo Desenvolvedor ativo, com feedback `ID copiado ✓`). Sem botões mortos (`Clipes`/`Orbs`).
  - Navegação completa por teclado (`↑`, `↓`, `→`, `←`, `Enter`, `Esc`), clique fora e clique repetido fecham o menu.
- **Testes:** `219/219` frontend (incluindo novo `tests/frontend-self-profile-menu.test.cjs`) + `9/9` `SancordApp` aprovados; QA visual no WebView2 (`1366×768`) aprovado com `0` erros de console.
- **Instalado no atalho `D:\Sancord\Sancord.exe`:** SHA-256 `76BC26229AF3AF4DBB8A5E602AA851715DACB16B2A73751A5546944CE3CD1733` (`9.920.000` bytes; inclui correção do traço do status `Não perturbe` e fixação/atraso de intenção nos submenus).
### Atualização 19/11/2026 20:40: Sancord v0.2.5 publicado oficialmente no GitHub
- ✅ **Commit na `main`:** `4c93c8645cfd55142b565b7e8c4482711799f5bd` (8 alterados, 2 novos; `Cargo.toml`, `Cargo.lock` e `CHANGELOG.md` em `0.2.5`; `sancord-release validate v0.2.5` OK; `396` testes aprovados).
- ✅ **Tag e Release oficial (`Latest`):** `v0.2.5` — https://github.com/gabrielsanderx/Sancord/releases/tag/v0.2.5
  - GitHub Actions `Stable Windows release` run `44637052157`: `tests`, `package`, `sign`, `verify-package` (HTTPS assinado) e `publish` todos aprovados (`0` falhas).
  - Artefatos publicados: `Sancord.exe` (`9.797.632` B), `SancordServer.exe` (`14.701.568` B), `Sancord-0.2.5-windows-x64.zip` (`4.401.444` B), `sancord-update.json` (`1.432` B) e `sancord-update.sig` (`128` B).
### Atualização 22/11/2026: servidor de produção atualizado para a v0.2.5 (autorizado pelo usuário)
- **Executável:** `SancordServer.exe` oficial da release `v0.2.5`, baixado com `gh release download`. SHA-256 `a0d57ad7…e338`, igual ao digest publicado. A cópia de download ficou em `qa-deploy-0.2.5/`.
- **Ensaio antes da troca:** `scripts/test-migration.ps1`, num snapshot somente-leitura, deu "v19 → v21; 32 tabelas antigas preservadas por hash; integridade OK".
- **Troca:**
  1. Parado só o PID 13960, com o caminho conferido (`D:\Sancord\SancordServer.exe`).
  2. Backup completo em `D:\Sancord\data-backup-pre-0.2.5-20261122-1915/`: 12 arquivos, 6.391.234 bytes, todos iguais por hash (exceto `tunnel.log`, que o túnel mantém aberto), banco v19 com `integrity_check = ok`, mais `SancordServer-0.2.3.exe`.
  3. Executável trocado e religado por `scripts/start-host.ps1`. O `cloudflared` (PID 14356) continuou rodando, então a URL pública não mudou.
- **Depois da troca:**
  - `/api/health` respondeu `version: "0.2.5"`, local e pelo túnel público;
  - verificado numa cópia: banco v21, `integrity_check = ok`, 33 tabelas, `scheduled_messages` presente, 6 usuários, 2 servidores, 6 canais e 15 mensagens;
  - o log não teve erro, e o cliente do usuário reconectou sozinho.
- **Rollback:** parar o servidor pelo PID, restaurar `data/` a partir do backup e voltar `SancordServer-0.2.3.exe` para `SancordServer.exe`.
## 22/11/2026 · Remoção do hub público "Sancord" (pedido do usuário: esconder e apagar os dados)

- **Antes:** em todo servidor Sancord, `default_hub` (em `src/state.rs`) criava o servidor `sancord`, e cada conta entrava nele sozinha ao logar (em `src/ws.rs`, no JoinServer). O usuário não quer esse servidor para ninguém.
- **Agora (nos fontes, NÃO publicado):**
  - `Config.legacy_hub` vale `false` em produção (`from_env`). Só `Config::for_tests` liga o hub, porque os testes antigos usam o canal "geral" como atalho.
  - Sem o hub não há criação nem entrada automática, e o Welcome vai com `servers: []` e `text_channels/voice_channels` vazios.
  - `ServerState::purge_legacy_hub()` roda ao iniciar quando `legacy_hub` está desligado. Ele apaga de vez o hub antigo: tira o servidor (cascata no banco), canais, threads, histórico, read states, integrações, agendamentos, convites e eventos.
  - Os ramos `== "sancord"` que sobraram no código ficaram inertes, porque não existe mais servidor com esse id.
  - Cliente (`app.js`): `activeServerId` começa `null`. Sem servidor, o Welcome abre o Início, e `ServerRemoved` do último servidor também volta para o Início.
- **Testes:**
  - `src/hub_removal_tests.rs` (conta nova sem hub; hub antigo apagado ao iniciar e continua apagado após reiniciar; servidor próprio preservado);
  - `tests/frontend-no-hub.test.cjs`;
  - suítes: 221 frontend e 179 Rust aprovados.
- **Ensaio numa cópia do banco real** (`qa-hub-removal/`, ignorada pelo Git, contém dados reais):
  - antes: servidores `sancord` e `srv-4a0a2922` ("Só tristeza"); mensagens sancord=4, Só tristeza=1, DMs=10; 6 usuários;
  - depois, com o servidor novo (porta 3100): só "Só tristeza"; mensagens Só tristeza=1, DMs=10; 6 usuários;
  - log: `Hub público "sancord" removido com 2 canais/threads`.
- **Falta, com autorização do usuário:**
  - publicar a **0.2.6**: versão, CHANGELOG, commit pela API e tag `v0.2.6`;
  - atualizar a produção como na 0.2.5: backup de `data/`, parar pelo PID e trocar o exe. Na primeira inicialização, a 0.2.6 apaga o hub do banco real.
  - Clientes 0.2.5 conectados a um servidor sem hub abrem com a área de servidor vazia até atualizarem: não quebram, só ficam sem canal aberto.
### Atualização 22/11/2026: v0.2.6 publicada e servidor de produção atualizado (autorizado pelo usuário)
- **Commit na `main`:** `eabd597cfb6689246062e9567f9d7290e7c34f3d`, com pai `4c93c86` e sem force, feito pela API do GitHub.
  - Entraram 10 arquivos, com o hash de cada blob conferido contra o arquivo local.
  - `sancord-release validate v0.2.6` OK.
  - Auditoria de segredos, e-mail, URL de túnel e senha de QA: limpa.
  - Testes: 221 frontend e 179 Rust.
- **Tag `v0.2.6`:**
  - run `45078195554` ("Stable Windows release"): todos os jobs aprovados;
  - run `45078195251` ("Windows CI"): aprovado;
  - release publicada em 22/11 às 22:44Z, com `SancordServer.exe` (sha256 `cc4cafcd…7957`) e `Sancord.exe` (sha256 `686d6e90…07ee`).
- **Produção:**
  1. Parado o PID 20100 (caminho conferido).
  2. Backup em `D:\Sancord\data-backup-pre-0.2.6-20261122-1945/`, igual por hash (exceto `tunnel.log`), com `SancordServer-0.2.5.exe`.
  3. Executável oficial trocado e religado por `start-host.ps1`, com o cloudflared mantido.
  4. O log mostra `Hub público "sancord" removido com 2 canais/threads`.
- **Conferência pós-troca** (cópia do banco):
  - banco v21, `integrity_check = ok`;
  - só resta o servidor `srv-4a0a2922` ("Só tristeza");
  - 0 canais do hub, 0 mensagens em `geral`, 0 convites `SANCORD`;
  - 6 usuários, DMs (10 mensagens) e a mensagem de "Só tristeza" preservadas;
  - `/api/health` responde `0.2.6`, local e pelo túnel.
- **Rollback:** restaurar `data/` desse backup e voltar `SancordServer-0.2.5.exe`. O hub voltaria junto, porque está no backup.
- O cliente do atalho (`Sancord.exe`) continua na 0.2.5 até o atualizador automático oferecer a 0.2.6.

## 22/11/2026 · Revisão de perfil e personalização após a v0.2.6

- Antes desta rodada, os hashes dos dois executáveis em uso já coincidiam com a release oficial 0.2.6. A revisão atual está nos fontes e no build de QA em `target-dev/debug`.
- O cartão rápido ganhou uma ordem de leitura compacta, data, conexões com os mesmos links validados do perfil completo e acesso à nota privada sincronizada. Popout, perfil completo e prévia usam `renderProfileCardIdentity` em `static/js/profile-card.js`. As decorações em planos frontal e traseiro também aparecem em membros e DMs.
- A coluna de personalização mantém prévia ao vivo e separa as escolhas cosméticas em subeditores com Aplicar e Cancelar. Cancelar restaura somente os campos daquele subeditor. Salvar alterações segue no perfil. O menu do próprio usuário abre o perfil pelo avatar e preserva os atalhos existentes.
- A composição `fonte+efeito` é validada em `src/cosmetics.rs`, com verificação de posse das duas peças. O servidor continua aceitando IDs antigos e usa o campo SQLite existente. Perfil por servidor e presets preservam a composição. O formato `default+default` permite escolher o estilo simples por servidor quando o perfil global usa cosméticos. Para distribuir essas combinações, publique cliente e servidor compatíveis juntos.
- O mural mostra a lista de desejos a partir dos widgets `want_to_play` que a pessoa pode ver. Decorações, molduras, efeitos de entrada e placas das coleções revisadas usam arte própria. O orçamento de movimento aplica animação a uma superfície por vez, conserva o retrato estático em listas e respeita movimento reduzido.
- Validação local em Windows GNU/LLVM com `node --test tests/frontend-*.test.cjs` e `cargo test --locked --target-dir target-dev --all-targets`. O executável local também passou por `node scripts/profile-motion-qa.mjs --art` e `node scripts/profile-motion-qa.mjs --live-profile` com `SANCORD_QA_EXE` apontando para `target-dev/debug/SancordApp.exe` e `SANCORD_QA_SCREENSHOTS=qa-profile-parity`. O modo ao vivo usa o `sancord.exe` ao lado do cliente, com porta de loopback, dados e contas descartáveis.
- Escopo da inspeção, diferenças visuais e limites de cobertura estão em `DISCORD_GAP_AUDIT.md`. A comparação com a interface de referência incluiu menu próprio, perfil completo, editor e seletor de nome. O teste manual adicional foi interrompido ao encerrar o controle do computador.

## 22/11/2026 · Autenticação desktop em uma coluna

- `static/index.html`, `static/ui.css`, `static/js/auth-screen.js` e `static/js/i18n.js` implementam o card com os modos Entrar, Criar conta e Recuperar senha. Os campos correspondem ao backend atual. As ações têm foco inicial, atalhos nativos de formulário, erros inline, spinner e controle de reenvio. O cartão de autenticação só sai quando o WebSocket confirma a sessão. O contexto de convites passa pelo `Welcome` já existente.
- As rotas são `POST /api/login`, `/api/register`, `/api/session`, `/api/logout` e `/api/recover-password`. O backend conserva SQLite, hash Argon2id e os tokens atuais. Em `src/http.rs`, as respostas de credenciais inválidas também cobrem usuários desconhecidos e os erros de recuperação têm mensagem neutra. As tentativas de login e recuperação mantêm o limite por conta.
- `static/js/auth-storage.js` integra o armazenamento do WebView2 ao DPAPI do usuário Windows via `src/bin/desktop_auth_storage.rs` e IPC, com criptografia fora da thread da janela. Token, usuário e lista de contas usam a chave protegida por origem e pelo tipo de sessão. Os valores legados são migrados depois de serem gravados no formato protegido. `static/js/transport.js` exige HTTPS para autenticação fora do loopback. [DPAPI no Windows](https://learn.microsoft.com/en-us/windows/win32/api/dpapi/nf-dpapi-cryptprotectdata)
- `node scripts/auth-qa.mjs` executa o cliente e o backend de `target-dev/debug`, com perfil e banco descartáveis. Exercita cadastro pelo teclado, falha de rede, retomada de convite, login inválido, sessão persistente e temporária, migração, conta salva, logout e recuperação. As capturas ficam em `qa-auth/`. Os testes DOM ficam em `tests/frontend-auth.test.cjs` e a validação de DPAPI está no módulo Rust.
- Esta rodada usa os mecanismos existentes de recuperação e sessões. E-mail e data de nascimento seguem fora do cadastro. A recuperação por e-mail, MFA, passkeys e um limite separado de cadastros ainda exigem trabalho de servidor. QR é assunto futuro, condicionado ao app mobile. O build de homologação local está em `target-dev/debug`.

## 22/11/2026 · Primeiro acesso, consistência visual e chat

- O Início de contas sem servidores oferece criar servidor, entrar com convite e adicionar amigo. Os três atalhos reutilizam as telas e a validação existentes. O cartão acompanha a lista de servidores e a aba ativa. O assistente de servidor leva o foco ao campo inicial e devolve o foco ao controle de origem ao cancelar.
- DMs, estado de espera de voz, mural e busca nas configurações reutilizam o componente de estado vazio. A busca de configurações aceita setas e Escape, a barra de Amigos quebra em duas linhas na janela estreita e o painel inferior preserva a área dos controles ao encurtar nomes.
- Solicitações do histórico mantêm a janela atual enquanto aguardam a página. O salto da busca limpa o filtro local e ignora respostas de alvos cancelados. Em tempo real, quando o cache chega a 300 mensagens, o chat conserva os elementos retidos e atualiza as bordas da janela. Ao tentar enviar sem conexão, o composer mantém texto e anexos prontos. Se a conexão cair depois de enviar e antes da confirmação, o app orienta a conferir o histórico para evitar duplicação.
- Homologação Windows com `node scripts/auth-qa.mjs --first-access-chat` e `SANCORD_AUTH_QA_SCREENSHOTS=qa-onboarding-chat`. O script usa o `.exe` da build local e um backend Rust em loopback com SQLite descartável. O histórico de QA inclui 400 mensagens semeadas e um arquivo enviado pela API real. O script exercita busca, salto, retorno ao presente, atualizações WebSocket, reconexão e envio de anexo. O ensaio visual usa tema escuro em 1366×768 e tema claro em 940×600 lógicos a 150%.
- Medianas do ensaio no WebView2 para chegada de uma mensagem com 300 itens na janela: 74,5 ms para reconstruir a lista e 22,5 ms para atualizar as bordas. Foram dez medições por caminho após o aquecimento. As regressões de autenticação e de perfil com backend real também passaram na build local.

## 22/11/2026 · Reconexão, modo offline, cache DPAPI e outbox durável (Rodada 4)

- `static/js/connection.js`, `static/js/offline-cache.js` e `static/js/outbox.js` estruturam o ciclo de reconexão e uso offline no cliente desktop: backoff escalonado (`1s` a `30s`), detecção de queda silenciosa por heartbeat, diagnóstico de motivo (rede offline, servidor indisponível, queda do tempo real ou manutenção), faixa de status não intrusiva, retomada automática da voz com interrupção limpa de câmera/tela durante a queda e ressincronização automática de mensagens editadas, apagadas e reações.
- O cache offline (`SancordOfflineCache`) grava snapshot cifrado por DPAPI do Windows (`sancord_offline_snapshot`, teto de 60 KB, TTL de 7 dias, vinculado à conta e à origem) apenas quando a sessão persistente está ativa. Ao reabrir sem servidor disponível, o app exibe imediatamente servidores, canais, membros e histórico recente em modo consulta, mantendo tentativa automática em segundo plano.
- A fila de envio (`SancordOutbox`) enfileira texto e respostas durante a queda (até 30 itens por conta, com cadência e reenvio idempotente por `nonce`) e se apoia na capacidade `connection_v1` no backend (`src/ws.rs`, `src/models.rs`, `src/state.rs`, `src/db.rs`). O SQLite subiu para `SCHEMA_VERSION = 22` com recibos duráveis de entrega (`delivery_receipts`) que sobrevivem a reconexões, exclusão da mensagem e reabertura do banco, evitando duplicação em caso de confirmação perdida.
- Validação local concluída sobre o build reconstruído em `target-dev/debug`:
  - `node --test tests/frontend-*.test.cjs`: **227/227** aprovados;
  - `cargo test --locked --all-targets --target-dir target-dev`: **181/181** aprovados (170 núcleo + 10 `SancordApp` + 1 `sancord-release`; 2 ensaios manuais/CI ignorados);
  - `node scripts/auth-qa.mjs --reconnect` com `SANCORD_AUTH_QA_SCREENSHOTS=qa-reconnect`: **3/3 cenários nativos no WebView2** aprovados (queda só de WebSocket com outbox + confirmação perdida + resync + retorno de voz; backend interrompido + reabertura offline via cache DPAPI + manutenção + retorno automático; heartbeat sem resposta + sessão revogada) e 5 capturas conferidas em `qa-reconnect/`;
  - `scripts/test-migration.ps1` (snapshot somente leitura do banco real): migração **v21 → v22** validada com 33 tabelas antigas preservadas por hash e `integrity_check = OK`.
- Todas as 4 rodadas pós-`v0.2.6` permanecem apenas nos fontes locais e em `target-dev/debug` (`Cargo.toml` segue em `0.2.6`). A produção local (`D:\Sancord\SancordServer.exe`, banco `v21`) e o repositório GitHub (`v0.2.6`, `eabd597c`) continuam intactos aguardando autorização para empacotar/publicar a `v0.2.7`.

## 22/11/2026 · Detecção de jogos, Rich Presence e Pesquisa Avançada de Mensagens (Rodada 5)

- **O que já existia e foi reaproveitado:**
  - *Atividade/Presença:* `status_kind` e `custom_status` em `UserInfo`/`FriendInfo` (`src/models.rs`), privacidade `ProfilePrivacy.activity` e projeção por destinatário (`src/profile_sharing.rs`, `src/access.rs`), prioridade na lista de membros (`static/js/member-list.js`), cartões de atividade do perfil (`static/app.js`, `static/js/profile-editor.js`), aba **Atividade e Presença** (`static/index.html`) e IPC nativo do desktop (`src/bin/SancordApp.rs`).
  - *Pesquisa:* índice SQLite **FTS5** `messages_fts` (`unicode61 remove_diacritics 2`) com triggers automáticos de insert/update/delete (`src/db.rs`), `moderation::search` com checagem dupla de permissões (`src/moderation.rs`), `db.messages_around` (`src/db.rs`), parser textual básico (`static/js/advanced.js`) e `jumpToMessage` com `around_id` e `flash-highlight` (`static/js/chat.js`).
- **O que foi criado:**
  - `src/activity.rs`: validação/sanitização estrita de `UserActivity` / Rich Presence (limites de tamanho, URLs `https`/`http` seguras, até 2 botões, party, timestamps, metadata) e handler `update_activity` com rate limit e deduplicação.
  - `src/bin/desktop_activity.rs`: detector nativo Windows via `EnumWindows` + `GetForegroundWindow` + `QueryFullProcessImageNameW` (handles RAII sem vazamento, polling 4 s dormindo em Condvar quando desligado), blocklist rigorosa de sistema/navegadores/Sancord/Discord, catálogo local de jogos, leitura de manifestos Steam (`libraryfolders.vdf` + `appmanifest_*.acf`) e Epic (`*.item`), resolução determinística de múltiplos jogos com preservação de `started_at` e persistência local de jogos registrados (`activity-config.json` / `activity-games.json`).
  - `static/js/activity.js`: módulo `SancordActivity` multi-fonte (`rpc` > `game_detector` > `manual`), controle local de privacidade/detecção, gestão de jogos registrados (adicionar aplicativo aberto ou manual, renomear, remover), timer ao vivo (`há Xh Ymin`) e renderizador compartilhado de cartão Rich Presence (`createRichActivityCard`).
  - `static/js/search.js`: módulo `SancordSearch` (popover de sugestões/autocomplete para `de:`, `em:`, `tem:`, `menciona:`, datas e histórico local limpável; chips removíveis + botões rápidos; debounce + cancelamento de requisições antigas; paginação 25/página; ordenação; highlight seguro; preview inline `Ver contexto`; skeleton, vazio e erro com retry).
  - `src/activity_search_tests.rs` e `tests/frontend-activity-search.test.cjs`: testes de integração ponta a ponta e testes unitários de frontend.
- **Arquivos modificados:** `src/lib.rs`, `src/models.rs`, `src/chat.rs`, `src/profile_sharing.rs`, `src/access.rs`, `src/state.rs`, `src/db.rs`, `src/moderation.rs`, `src/ws.rs`, `src/tests.rs`, `src/bin/SancordApp.rs`, `src/bin/desktop_assets.rs`, `static/index.html`, `static/app.js`, `static/styles.css`, `static/js/advanced.js`, `static/js/member-list.js`, `static/js/profile-card.js`, `static/js/profile-editor.js`, `tests/frontend-advanced.test.cjs`, `DISCORD_GAP_AUDIT.md`.
- **Modelos, eventos WebSocket, IPC e banco:**
  - *Modelos:* `UserActivity` e `ActivityButton` em `UserInfo`/`FriendInfo` (efêmeros em memória, sem migração de banco — SQLite permanece na `v22`); `SearchHit` enriquecido com `parent_channel_name`, `is_thread` e `is_forum`; `SearchFilter` ampliado com `has_list`, `mentions_include_roles`, `matching_thread_channels`, `sort` e `offset`.
  - *WebSocket:* `ClientMessage::UpdateActivity`, `ServerMessage::UserActivityUpdated`, `ClientMessage::SearchMessages` (estendido com `has_list`, `mentions_user`, `sort`, `offset`), `ServerMessage::SearchResults` (estendido com `total_count`, `offset`, `sort`, `error`), `ClientMessage::GetMessageContext` e `ServerMessage::MessageContext`. Capacidades anunciadas no `Welcome`: `activity_v1` e `search_v2`.
  - *IPC Desktop (`SancordApp`):* canal `activity:<get-state|scan-now|set-config|register-game|update-game|remove-game>` respondendo via evento `sancord-activity-state` (habilitado quando `window.__SANCORD_ACTIVITY_NATIVE === true`).
- **Testes validados:**
  - `node --test tests/frontend-*.test.cjs`: **232/232** aprovados;
  - `cargo test --locked --all-targets --target-dir target-dev`: **190/190** aprovados (174 núcleo + 15 `SancordApp` + 1 `sancord-release`; 2 manuais/CI ignorados);
  - Binários de QA recompilados em `target-dev/debug` (`sancord.exe` e `SancordApp.exe`).
- **Limitações conhecidas e próximos passos:**
  - Integração direta de jogos externos com Rich Presence via pipe/IPC local (SDK de desenvolvedores) ainda é evolução futura, mas já encontra o modelo `UserActivity` e a prioridade de fontes (`rpc` > `game_detector`) prontos.
  - A busca em anexos indexa o nome do arquivo (`relatorio.pdf`), sem OCR ou extração de conteúdo interno.
  - Quando autorizado pelo usuário, empacotar e publicar **`v0.2.7`** no GitHub e atualizar o servidor/cliente locais (incluindo migração `v21 → v22`).

## 22/11/2026 · Menu Contextual de DM/Amigo (sem Apps), Nome Longo no Dock e Membros Offline (Rodada 6)

- **Funções e estruturas reaproveitadas:** `SancordUI.contextMenu`/`formDialog`/`confirm` (`static/js/ui-kit.js`), `SancordIcons` (`static/js/icons.js`), `UserPrefs.user_notes`/`ignored_users`/`mutes`/`notify_levels` (`src/models.rs`), `getUserProfileNote`/`setUserProfileNote`/`saveModerationLists` (`static/app.js`), `MUTE_CHOICES`/`muteUntil`/`setMute`/`channelNotifyLevel` (`static/js/polish.js`), `InviteFriendToServer`, `AckChannel`, `SendFriendRequest`/`RemoveFriend`/`CancelFriendRequest`/`RespondFriendRequest`, `BlockUser`/`UnblockUser`, `openMemberProfilePopover`, `joinVoiceChannel`/`leaveVoiceChannel` e `state.uiSettings.developerMode`.
- **Componentes e módulos novos/atualizados:**
  - `static/js/ui-kit.js`: exporta builders reutilizáveis (`ContextMenu`, `ContextMenuItem`, `ContextMenuDangerItem`, `ContextMenuSubmenu`, `ContextMenuSeparator`, `ContextMenuLabel`), suporte a `sublabel`, `checked`, submenus com hover tolerante + navegação `↑`/`↓`/`→`/`←`/`Enter`/`Esc`, inversão lateral automática e scroll em janelas baixas.
  - `static/js/dm-context-menu.js`: `DmContextMenu` (embutido em `src/bin/desktop_assets.rs` e carregado em `static/index.html`) acionado pelo botão direito em DMs (`renderDmList`) e em amigos (`buildFriendRow` clique direito e botão `⋯`), **sem a opção "Apps"**.
  - **Backend (`src/models.rs`, `src/state.rs`, `src/ws.rs`, `src/access.rs`):** `UserPrefs.pinned_dms` e `UserPrefs.favorite_dms` (com `sanitize_dm_ids`), `ClientMessage::CloseDm { dm_id }` (oculta apenas de `open_dms` sem apagar histórico nem amizade), `FriendInfo.id` com `account.id` real para Developer Mode, `AckChannel` aceitando `message_id: ""` para marcar DM como lida mesmo sem histórico carregado, validação de `invites_paused`/membro/banido em `InviteFriendToServer`, e `GuildServer.member_roster` (efêmero, projetado em `access.rs` com `ProfilePrivacy`) para manter personalizações de membros offline na lista lateral.
  - **UI (`static/app.js`, `static/styles.css`, `static/ui.css`):** seção **FIXADAS** em `renderDmList`, conversas favoritadas integradas na aba **Favoritos** (`renderHomeStarredView` + badge `home-starred-badge`), correção de overflow de nomes longos em `#self-profile-trigger`/`#self-username` e `.member-display-name`, e preservação de cores/estilos de nome de membros offline.
- **Testes validados:**
  - `node --test tests/frontend-*.test.cjs`: **236/236** aprovados (incluindo `tests/frontend-dm-context-menu.test.cjs` e `tests/frontend-visual.test.cjs`);
  - `cargo test --locked --all-targets --target-dir target-dev`: **192/192** aprovados (incluindo `offline_server_member_keeps_profile_customizations_in_member_roster` e `dm_context_menu_backend_close_pin_favorite_note_privacy_and_invite`);
  - Binários QA em `target-dev/debug` recompilados; nenhuma alteração feita no servidor/banco em produção (`v0.2.6`, banco `v21`) nem no GitHub.
- **Pendências:** aguardar autorização do usuário para empacotar e publicar a **`v0.2.7`** no GitHub e atualizar o servidor/cliente locais.

## 22/11/2026 · Refatoração Visual do Self Profile Menu e Editor de Insígnias (Rodada 7)

- **Self Profile Menu (`static/js/self-profile-menu.js`, `static/ui.css`):**
  - Removidos completamente das ações do menu: botões/submenus de **Insígnias**, **Minha coleção**, além de garantir ausência de **Clipes**, **Orbs**, **Inventário** ou placeholders.
  - Layout refatorado para popover vertical compacto (`clamp(296px, 21vw, 316px)`), altura guiada pelo conteúdo, borda discreta sem brilho roxo artificial (mantendo o sistema real de *Profile Frames* quando equipado), banner proporcional (`68 px`), avatar sobreposto (`68 px`) com recorte compatível com tema personalizado (`--profile-surface`), decoração preservada, status, nome exibido estilizado, `@username`, **ícones reais de insígnias visíveis com tooltip** no cabeçalho e status personalizado condicional.
  - Ações organizadas em **2 cards compactos**: Card 1 (`Editar perfil` + `Status atual >` com Online/Ausente/Não perturbe/Invisível/Status personalizado); Card 2 (`Mudar de conta >` com contador real só quando >1 conta + `Copiar ID do usuário` apenas com Modo Desenvolvedor ON).
- **Personalização de Insígnias no Editor de Perfil (`Configurações → Perfis → Perfil principal → Insígnias`):**
  - **Backend (`src/cosmetics.rs`, `src/models.rs`, `src/profile.rs`, `src/state.rs`, `src/ws.rs`, `src/http.rs`):** separação estrita entre badges realmente possuídas (`Account.owned_badges`, nunca manipuláveis pelo cliente) e badges exibidas (`Account.profile.badges`, derivadas por `resolve_visible_badges` aplicando `Account.badge_order` e `Account.hidden_badges`, limite `MAX_VISIBLE_BADGES = 6` e suporte a `BadgeDef.can_hide` — ex.: `verified_bot` não ocultável). `ClientMessage::UpdateProfile` aceita `badge_order`/`hidden_badges`, sanitiza por interseção estrita com `owned_badges` (impedindo injeção de badges não possuídas), preserva posse de molduras de conquista e permissão de operador mesmo com badge oculta, e propaga em tempo real via `CosmeticsState`, `VoiceStateSync`, `FriendsSync` e `profile_sharing::refresh_viewers`. Sem alteração de esquema SQLite (permanece na `v22`).
  - **Frontend (`static/index.html`, `static/js/profile.js`, `static/js/profile-editor.js`, `static/app.js`, `static/ui.css`):** entrada **Insígnias** recolhida na coluna lateral do editor (`data-pe-open="badges"`), abrindo subeditor dedicado (`renderPeBadgesEditor`) com estado vazio limpo (0 badges), prévia ao vivo sincronizada com o cartão central (`draftPreviewUser`), alternância de visibilidade respeitando `can_hide`, reordenação por botões acessíveis (`↑`/`↓`) e drag-and-drop, botão *Restaurar padrão*, fluxo *Cancelar/Aplicar* no subeditor e persistência via *Salvar alterações*.
- **Testes validados:**
  - `node --test tests/frontend-*.test.cjs`: **237/237** aprovados (incluindo `tests/frontend-self-profile-menu.test.cjs` atualizado com cobertura completa do Self Profile Menu e do subeditor de Insígnias);
  - `cargo test --locked --all-targets --target-dir target-dev`: **194/194** aprovados (`178` núcleo + `15` `SancordApp` + `1` `sancord-release`; 2 manuais/CI ignorados), incluindo `cosmetics::tests::badge_visibility_order_cap_and_security` e `tests::activity_search::profile_badges_visibility_order_security_and_realtime_sync`;
  - Binários QA recompilados em `target-dev/debug` (`sancord.exe` e `SancordApp.exe`). Produção (`v0.2.6`, banco `v21`) e GitHub seguem intactos aguardando autorização para publicar a **`v0.2.7`**.

## 23/11/2026 · Motor Unificado de Cosméticos v3, Arte em Camadas e Animações Orgânicas (Rodada 8)

- **Publicação anterior:** a **`v0.2.7`** (`40b7b9bf`) foi publicada no GitHub (`Stable Windows release` 100% verde) e implantada localmente com backup em `data-backup-v21-20261123` (SQLite migrado para `v22`).
- **Ajuste fino no Self Profile Menu (`static/ui.css`):** bloqueada a propagação de `--profile-highlight` quando não há *Profile Frame* equipada (`.self-profile-menu.profile-card:not(.has-frame)[style*="--profile-highlight"]`) e calibradas proporções de banner (`84 px`), avatar (`72 px`), cards translúcidos (`rgba(17, 18, 22, 0.54)`) e pílula de badges ao lado do `@username`.
- **Arquitetura e Asset Pipeline (`static/cosmetics/cosmetics-engine.js`, `static/cosmetics/cosmetics.css`, `src/bin/desktop_assets.rs`, `static/index.html`):**
  - Criado módulo unificado `SancordCosmetics` (`VERSION = 3`) com registro estruturado por categoria (`avatar_decorations`, `frames`, `profile_effects`, `nameplates`), metadata completa (`id`, `type`, `name`, `collection`, `animated`, `animation_mode`, `bleed`, `reduced_motion`, `version`, `artDirection`) e renderers compartilhados integrados em `profile-card.js`, `profile.js`, `app.js` e `member-list.js` sem duplicação.
  - **Modos de animação e orçamento (`CosmeticMotionScheduler`):** suporte a `STATIC`, `LOOP`, `HOVER`, `PLAY_ON_OPEN`, `ONE_SHOT`, `IDLE_WITH_EVENTS` e `REACTIVE`. O scheduler `IDLE_WITH_EVENTS` limita o orçamento a no máximo `6` hosts simultâneos visíveis (`IntersectionObserver`), `0` na `MEMBER_LIST`, pausa automaticamente fora de tela, com janela minimizada/desfocada ou `reduceMotion`/`prefers-reduced-motion: reduce`, e dispara eventos secundários (`7,5–14 s`, com jitter) e raros (`18–28 s`) orgânicos.
- **Peças flagship refeitas em profundidade (preservando 100% dos IDs existentes sem perda de inventário):**
  - **Avatar Decorations (8 peças v3 com `BACK_LAYER` + `AVATAR` + `FRONT_LAYER` + `PARTICLES`/`HIGHLIGHT`):** `galaxy-portal` (*Guardião Celeste* com companheiro que pisca e estrela cadente rara), `sakura-glow` (*Brisa de Sakura* com galho, 3 flores, amuleto oscilante e pétala solta), `core-orbit` (*Núcleo Orbital Sancord* com brilho especular), `cat-gamer` (*Companheiro Felino Cyber* com orelha que mexe), `frost-crown` (*Diadema Glacial*), `dragon-fire` (*Fênix & Brasas*), além de 2 peças estáticas ricas (`static-royal-crown` e `static-emerald`) e upgrade dos clássicos de 1 círculo (`static-blurple`, `static-angel`, `static-crimson`, `static-diamond`).
  - **Profile Frames (8 molduras arquitetônicas responsivas por contexto `FULL_PROFILE`, `EDITOR_PREVIEW`, `PROFILE_POPOUT`, `SELF_PROFILE_MENU`, `MINI`):** `core-pulse`, `cosmic-drift`, `sakura-wind`, `royal` (estática dourada gravada), `frost-glint`, `cyber-corners` (estática HUD tática), `ember-trail` e `liquid` — todas com 4 cantos SVG, crista superior SVG, selo inferior SVG (ocultado em contextos compactos) e trilhos laterais.
  - **Profile Effects (6 timelines multi-estágio `init → entrance → main → climax → dissipate` com `effect-plane-back` + `effect-plane-front`):** `core-signal` (`2300 ms`), `star-trail` (`2600 ms`), `petal-drift` (`2700 ms`), `circuit-boot` (`2400 ms`), `polar-ribbon` (`2800 ms`) e `embers` (`2500 ms`), tocando uma vez ao abrir (sem loop explosivo) e com *Reproduzir novamente*.
  - **Nameplates (8 peças gráficas SVG `.np-art-layer` com leitura preservada):** `starlit-silt`, `twilight-garden`, `core-stripe`, `circuit-weave`, `gold-leaf`, `tide-glass`, `ember-line` e `frost-vein`, aplicadas em Cartão, Editor, DMs, Amigos, Dock e Lista de Membros (reduzida a `56%` estática). Removidos emojis usados como arte dos nomes no catálogo de cliente.
  - **Display Name Styles (`src/cosmetics.rs`, `static/app.js`, `static/cosmetics/cosmetics.css`):** expandido para **10 fontes distintas** (adicionadas `editorial`, `bubble`, `cyber`, `fantasy`) e **3 novos materiais** (`gummy`, `ink`, `cosmic`), além de upgrade de `prism`, `holographic` e `outline` com animação lenta apenas no material e bloqueio na `MEMBER_LIST` e em `reduceMotion`.
- **Trabalho restante:** migrar gradualmente os demais itens legados de Phase 1/2 (ex.: `crimson-vortex`, `rainbow-prism`, `heart-pixel`, `neon-glitch` e frames puramente CSS como `carbon`/`inferno`) para receitas v3 ilustradas ou WebP/APNG dedicados conforme prioridade.

## 23/11/2026 · Insígnia Exclusiva de Fundador (`Swag`) + Catálogo de Jogos, `GamePicker` Central e Widgets de Jogos no Mural (Rodada 9)

- **Insígnia exclusiva de Fundador do Sancord:**
  - Criado `data/badges.json` concedendo `"founder"` **exclusivamente** à conta `swag` (servidor `SancordServer.exe` recarregado para ativação imediata).
  - Atualizado `BadgeDef` de `"founder"` em `src/cosmetics.rs` para `name: "Fundador do Sancord"` e `description: "Fundador oficial do projeto Sancord."` (mantendo ID `"founder"`, posse da moldura exclusiva de fundador e permissão de operador de insígnias).
- **Backend de Catálogo de Jogos & Cache (`src/games.rs`, `src/config.rs`, `src/state.rs`, `src/lib.rs`, `src/models.rs`, `src/profile_board.rs`):**
  - Novo módulo `src/games.rs`: catálogo curado embutido (~48 jogos populares com aliases em PT/EN e capas oficiais Steam CDN), busca ao vivo intermediada pelo servidor via Steam Store Search API (zero chave embutida no cliente, timeout `3.5s`, extensível por `RAWG_API_KEY` opcional no servidor), cache em memória (TTL `6h`) + persistido em `data/game-catalog-cache.json` e validação estrita de URLs de capa (`is_safe_game_cover_url`).
  - Novos endpoints HTTP: `GET /api/games/popular`, `GET /api/games/search?q=...`, `GET /api/games/resolve?name=...` e `GET /api/games/:id`.
  - `ProfileWidgetContent` (`FavoriteGame`, `WantToPlay`, `Playing`) estendido de forma retrocompatível (`#[serde(default, skip_serializing_if = ...)]`) com `game_id`, `cover_url`, `release_year`, `platforms`, `note` e `Playing.auto_activity` (permite `name: ""` somente quando `auto_activity == true`). Sem alteração de esquema SQLite (permanece `v22`).
- **Frontend `GamePicker` Reutilizável + Integração Real com Activity (`static/js/game-picker.js`, `static/js/profile-board.js`, `static/js/profile-editor.js`, `static/js/activity.js`, `static/js/social.js`, `static/app.js`, `static/ui.css`, `static/index.html`, `src/bin/desktop_assets.rs`):**
  - `SancordGamePicker`: seletor central reutilizado por **Jogo favorito**, **Quero jogar**, **Jogando agora** e **Lista de desejos** (`#pe-add-wishlist`), com busca com debounce (`250ms`) + `AbortController`, skeleton loading, seções **Recentes** (`localStorage` por conta), **Jogos detectados no seu PC** (reaproveitando `SancordActivity`), **Populares**, prévia ao vivo com nota opcional, fallback limpo sem capa, tratamento de erro com *Tentar novamente*, modo offline e link secundário *"Não encontrou seu jogo? Adicionar manualmente"* como último recurso.
  - **Integração real com `SancordActivity`:** **Jogo favorito** e **Quero jogar** permanecem escolhas fixas; **Jogando agora** inicia com *"Atualizar automaticamente com minha atividade"* ligado por padrão, exibe capa resolvida + tempo real de sessão (`started_at`), atualiza instantaneamente ao abrir/trocar/fechar jogos (mostrando estado discreto *"Nenhum jogo no momento"* sem apagar a configuração) e respeita privacidade (`activity_visible`).
  - Clique em qualquer widget de jogo no Mural abre modal compacto de detalhes (capa, título, ano, plataformas, nota, tempo de sessão e ações *Trocar jogo*/*Remover do Mural* para o dono).
- **Testes validados:** `node --test tests/frontend-*.test.cjs` (**245/245** aprovados, incluindo `tests/frontend-game-picker.test.cjs` e `tests/frontend-profile-board.test.cjs`) e `cargo test --locked --all-targets --target-dir target-dev` (todos aprovados, incluindo `games::tests::*` e `profile_board::game_catalog_api_and_game_widget_metadata_persist_safely`).

## 23/11/2026 · Notificações de DM na Barra Lateral, `NotificationManager`, Som Original do Sancord e Densidade da Lista de DMs (Rodada 10)

- **Auditoria e reaproveitamento:** reaproveitados integralmente `read_states` no SQLite (`last_read_at` + `mention_count`), `AckChannel`, `ReadStateUpdated`, `Welcome.read_states`, `notificationPolicy`, `isMutedId`, `maybeDesktopNotify`, `playUiSound`, `DmContextMenu` e `groupContextMenu`, sem duplicar sistemas.
- **Backend (`src/state.rs`, `src/ws.rs`):**
  - `bump_mentions` agora ignora remetentes bloqueados pelo destinatário (`has_blocked`) também em Group DMs.
  - Em `send_chat_message`, quando o autor responde em uma DM que possuía `mention_count > 0`, o servidor propaga `ReadStateUpdated` (`mention_count: 0`) para todas as outras sessões ativas da conta (sincronia multi-device).
- **Frontend `NotificationManager` & Som Original (`static/js/notification-manager.js`, `static/js/chat.js`, `static/app.js`, `static/js/settings-center.js`, `static/index.html`, `src/bin/desktop_assets.rs`):**
  - Criado `SancordNotifications` centralizando `shouldIncrementUnread`, `shouldPlaySound`, `shouldShowDesktopNotification`, `shouldShowDmBadge` e `formatUnreadCount` (`1–99` e `99+`).
  - Som original de DM sintetizado via Web Audio API (`synthesizeSancordDmChime`: acorde curto e suave `E5 → A5` com filtro lowpass e limiter anti-clipping, ~240ms), respeitando volume (`#notif-ui-volume-slider`), mute, DND, som OFF, janela aberta/focada, bloqueados, Message Requests e cooldown/coalescing (`1100ms` por canal / `450ms` global) para evitar sobreposição em rajadas e rajada de sons após reconnect.
  - Avatares de DMs e Group DMs não lidas integrados na barra lateral esquerda (`#rail-unread-dms`, entre `#rail-home-wrap` e `.guild-separator`), com badge circular vermelha numerada sobreposta ao avatar, pílula branca lateral, micro-animações discretas (`is-entering` / `is-bumping` respeitando `prefers-reduced-motion`), atualização ao vivo de avatar, tooltip, clique esquerdo abrindo a DM/Grupo e clique direito no `DmContextMenu`/`groupContextMenu`.
  - Adicionado toggle `#notif-dm-rail-badge` em **Configurações → Notificações** para separar controle visual de badges do controle de som.
- **Refinamento Visual da Lista de Mensagens Diretas (`static/ui.css`, `static/app.js`, `static/js/social.js`):**
  - Ajustes estritamente escopados a `.dm-list`: altura compacta (`min-height: 42px`, `padding: 5px 8px`), avatar reduzido (`28px`, status `9px`), contenção de *Display Name Styles* e *Nameplates* na lista de DMs (evitando nomes superdimensionados e aspecto de card grande), tipografia refinada (`13.5px` nome / `11.5px` subtítulo), chip compacto `APP` para bots e badges `99+`.
- **Testes validados:** `tests/frontend-dm-notifications.test.cjs` (cobertura completa dos 16 cenários de DM/Group DM/mute/DND/reconnect/multi-device/lista compacta) e `dm_unread_multi_device_sync_and_blocked_group_sender_isolation` em `src/activity_search_tests.rs`.

## 23/11/2026 · Sistema Completo de Efeitos Sonoros Compartilhados de Chamadas, Voz, Stream e Câmera (Rodada 11)

- **Arquitetura de eventos compartilhados vs locais (sem transmitir áudio pela call):**
  - **Backend autoritativo (`src/models.rs`, `src/voice.rs`, `src/ws.rs`, `src/state.rs`, `src/access.rs`):** novo evento `ServerMessage::VoiceCueEvent { event_id, event_type, voice_session_id, actor_user_id, timestamp }` emitido exclusivamente pelo servidor após confirmar permissão e transição real de estado (`false → true` / `true → false`) para participantes conectados na mesma `voice_session_id` (canais de servidor, `dmvoice:*` e `gdmvoice:*`), protegido por `access.rs` (`can_view_channel`), rate limit anti-spam por ator/categoria (`850 ms`) e supressão em `resume: true` (reconnect). Trocar resolução/janela/dispositivo durante stream ou câmera ativa não reemite cue.
  - **16 assets originais do Sancord (`static/assets/sounds/**`, embutidos em `src/bin/desktop_assets.rs`, ~230 KB totais):** família sonora própria normalizada a `-8 dBFS` sem clipping (`voice/{join,leave,connected,disconnected,reconnected}.wav`, `stream/{start,stop}.wav`, `camera/{on,off}.wav`, `controls/{mute,unmute,deafen,undeafen}.wav`, `calls/{incoming,outgoing}.wav`, `errors/voice_error.wav`).
  - **`SancordSoundManager` (`static/js/sound-manager.js`):** preload e decodificação antecipada em `AudioBuffer` ao entrar em call, compressor/limiter anti-clipping (`DynamicsCompressorNode`), limite de polifonia (`3`), coalescing/cooldown por categoria, controle limpo de loops (`incoming`/`outgoing`) e roteamento pelo dispositivo de saída configurado (`setSinkId`).
  - **`SancordVoiceSounds` (`static/js/voice-event-sounds.js`, integrado em `static/app.js` e `static/js/voice.js`):** classificação centralizada (`SHARED`: join/leave/stream_start/stream_stop/camera_on/camera_off/call_connected/call_disconnected; `LOCAL`: mute/deafen/voice_reconnected/voice_error/ringtones; preparado para `sharedMute`), cache de deduplicação de `256` `event_id`s, anti-spam por `actor_user_id`, política de deafen (suprime shared cues mantendo feedback local de deafen) e encerramento imediato de ringtones ao aceitar/recusar/cancelar/expirar.
  - **Configurações → Notificações → Sons de chamadas (`static/index.html`, `static/js/settings-center.js`):** master toggle `#call-sounds-master`, slider independente `#call-sounds-volume` (`0–100%`, separado do volume dos participantes) e controles individuais com preview `▶` para Entrada, Saída, Transmissão iniciada, Transmissão encerrada, Câmera, Mute/Deafen local e Chamadas recebidas.
- **Testes validados:** `tests/frontend-voice-sounds.test.cjs` (validação dos 16 WAVs + deduplicação + spam + canais isolados + volume 0/50/100 + deafen + output device + ringtones) e `voice_cue_events_isolate_channels_track_transitions_dedupe_and_rate_limit` (4 clientes em 2 canais + transição de canal + DM Call) em `src/activity_search_tests.rs`.

## 23/11/2026 · Refinamento do Supressor de Ruído DSP (`AudioWorklet`) e Polimento Visual do Cabeçalho de Perfil nos 4 Contextos (Rodada 12)

- **Auditoria do Pipeline de Voz e Supressão de Ruído Existente (`static/app.js`, `static/index.html`):**
  - *Classificação anterior:* 🟡 **funcional mas melhorável** — utilizava apenas `BiquadFilterNode` high-pass (`85 Hz`) + `DynamicsCompressorNode` + `AnalyserNode` broadband time-domain gate (`thresholdDb`) combinado com `noiseSuppression: true` nativo do browser em `getUserMedia`, sem separação espectral entre voz e ruído estacionário/transientes de teclado e com risco de dupla supressão.
  - **Refinamento do pipeline único (`static/js/voice-dsp-core.js`, `static/js/voice-dsp-worklet.js`, `static/app.js`, `static/index.html`, `static/ui.css`, `src/bin/desktop_assets.rs`):**
    - Criado `SancordNoiseSuppressorCore` (`static/js/voice-dsp-core.js`, zero alocações no loop de áudio) e `SancordNoiseSuppressorProcessor` (`AudioWorkletProcessor` em `static/js/voice-dsp-worklet.js`, rodando na thread de renderização Web Audio).
    - **Ordem final do pipeline de captura:** `getUserMedia` (`echoCancellation: AEC`, `autoGainControl: AGC`, `noiseSuppression: false` quando o worklet do Sancord está ativo para evitar dupla supressão; fallback automático para `noiseSuppression` nativo do WebRTC se `AudioWorklet` não estiver disponível) → `HighPassFilter (70 Hz, Q=0.707)` → `SancordNoiseSuppressorWorklet` (STFT `256` amostras com janela `sqrt-Hann`, hop `128` amostras = `2,67 ms` a `48 kHz`, estimador adaptativo de PSD de ruído com warm-up rápido de `12` hops, VAD suave multi-característica SNR + tonalidade com ataque `~6 ms` e hangover `~220 ms`, atenuador de transientes impulsivos de teclado/mouse `> 2 kHz` com recuo automático durante fala simultânea, ganho Decision-Directed Wiener `alpha = 0,90–0,96` com suavização entre bins vizinhos e proteção de fricativas `1,8–6,5 kHz`, e safety soft-knee limiter a `-1,5 dBFS`) → `DynamicsCompressorNode` → `GainNode` (volume de entrada + gate VAD/PTT com fade exponencial sem estalos) → `MediaStreamAudioDestinationNode` (WebRTC Opus).
    - **5 modos configuráveis em tempo real (sem reiniciar chamada nem gerar click/pop):** `Automático` (`auto`, padrão), `Leve` (`light`), `Padrão` (`standard`), `Forte` (`strong`, com aviso de uso apenas em ambientes muito barulhentos) e `Desligado` (`off`, bypass verdadeiro bit-exato). Migração automática do antigo booleano `noiseGate` e perfil `studio`.
    - **Controles e Teste de Microfone (`Configurações → Voz e vídeo`):** seletor `#dsp-ns-mode` com descrição dinâmica e botão rápido no painel de voz (`#voice-ns-quick-btn`), toggles independentes de **Cancelamento de eco (AEC)** (`#dsp-aec`) e **Controle automático de ganho (AGC)** (`#dsp-agc`), **Teste do microfone** usando o mesmo pipeline real localmente com botão de comparação A/B ao vivo (`Com supressão` vs `Sem supressão (bruto)`), pílulas de status (`Voz detectada`/`Silêncio`, `Supressão ativa`, alerta de clipping na entrada) e telemetria DSP (`sampleRate`, `frameSize`, `mode`, `noiseFloor`, `VAD`, `processMs`, `overruns`) exibida somente com **Modo Desenvolvedor** ativo.
    - **Métricas reais medidas (`tests/frontend-voice-dsp.test.cjs` a `48 kHz`):** latência algorítmica de hop `2,67 ms` (`128` amostras a `48 kHz`), custo médio de CPU `~0,02 ms` por hop (`< 1%` do orçamento de tempo real de `2,67 ms`), `0` overruns em soak test e tolerância a `NaN`/`Infinity`/blocos atípicos/troca de sample rate (`48 kHz`/`44,1 kHz`/`16 kHz`).
    - **Limitações conhecidas:** como opera via DSP espectral ultraleve em CPU sem modelo neural pesado de dezenas de MB, vozes humanas secundárias próximas ao microfone (TV/outra pessoa falando alto no mesmo quarto) ou música alta captada diretamente pelo microfone são parcialmente preservadas por compartilharem estrutura harmônica com a voz principal.
- **Polimento Visual do Cabeçalho de Perfil nos 4 Contextos Compartilhados (`static/ui.css`, `static/cosmetics/cosmetics.css`):**
  - Aplicado de forma unificada em **Self Profile Menu** (`#self-profile-menu`), **Profile Popout** (`#compact-profile-modal`), **Full Profile** (`#profile-popover-card`) e **Editor/Preview** (`#live-profile-preview-card`):
    - **Remoção da tarja/retângulo artificial atrás do Display Name:** `.profile-card .profile-nameplate-wrap` (mesmo quando `.profile-nameplate-chip`, `.has-np-art` ou `.nameplate-*` estão presentes no DOM) agora tem `background: transparent !important; padding: 0 !important; border: 0 !important; box-shadow: none !important;` e oculta `.np-art-layer` dentro do cabeçalho do cartão de perfil (mantendo as Nameplates ativas nas listas de DMs, Amigos, Membros e seletor).
    - **Hierarquia tipográfica e contenção de Display Name Styles:** Display Name calibrado (`20px` no Perfil Completo/Prévia, `19px` no Popout, `18.5px` no Self Profile Menu; `font-weight: 700; line-height: 1.22; letter-spacing: -0.015em`) com efeito cosmético acontecendo exclusivamente nas letras (`.name-style-gta` contido em `1.05em` com sombra limpa).
    - **Sublinha `@username` + Pronomes + Badges proporcionais:** `@username` claramente secundário (`13px`, peso `500`, contraste suave), pronomes discretos (`12px` com separador `•`), e `.profile-badges` estilizadas como acessórios visuais delicados (`16px × 16px` no Perfil Completo/Popout e `15.5px × 15.5px` no Self Profile Menu, ícone SVG `13–13.5px`, sem caixa dupla ao redor de cada ícone) agrupadas em uma única pílula sutil (`gap: 3px; padding: 2px 5px; border-radius: 6px; background: rgba(0, 0, 0, 0.22)`) alinhada na mesma linha do `@username` e totalmente oculta quando o usuário possui `0` badges.
- **Testes validados:** `node --test tests/frontend-*.test.cjs` (**258/258** aprovados, incluindo `tests/frontend-voice-dsp.test.cjs` e o novo teste dos 4 contextos de cabeçalho em `tests/frontend-self-profile-menu.test.cjs`) e `cargo test --locked --all-targets --target-dir target-dev` (**199/199** aprovados).

## 23/11/2026 · Renomeação Oficial e Migração Compatível `Sancord` → `Sanvo` (Rodada 13)

- **Nome atual do projeto:** **Sanvo** (`Sanvo Desktop`) · **Nome legado:** `Sancord`.
- **Auditoria e Branding completo (`static/index.html`, `static/app.js`, `static/js/*.js`, `static/cosmetics/cosmetics-engine.js`, `static/sanvo-icon.svg`, `src/cosmetics.rs`, `src/social.rs`, `src/ws.rs`, `src/state.rs`, `src/main.rs`, `src/bin/SancordApp.rs`, `src/bin/SancordBundle.rs`):**
  - Substituídas todas as ocorrências visíveis ao usuário por `Sanvo` / `Sanvo Desktop`: barra de título nativa (`SANVO DESKTOP`), tela de conexão/loader (`Sanvo Desktop`, `Localizando servidor Sanvo...`), login/recuperação/offline (`Entrar no Sanvo`, `Conectando ao Sanvo`), Configurações (`Sobre o Sanvo`, categoria `SANVO`, `ID DA CONTA SANVO`, `Exclusivo Sanvo`, `Atmosferas livres do Sanvo`, `Aurora Sanvo`, `Testar som do Sanvo`, `Abrir Sanvo ao iniciar o Windows`), cartões de perfil (`Membro do Sanvo`, `Amigos no Sanvo ✓`, `Perfil no Sanvo`), coleção `Sanvo Core` (`Brasão Sanvo`, `Núcleo Orbital Sanvo`, `Arquitetura Sanvo Core`, `Inicialização Sanvo`, `Núcleo Sanvo`) e insígnias existentes (`Fundador do Sanvo`, `Integração verificada pelo Sanvo.`, `Conta criada na fase inicial do Sanvo.`, `Apoiou o Sanvo no início.`).
  - Expostos aliases globais `Sanvo*` no frontend (`SanvoUI`, `SanvoIcons`, `SanvoNet`, `SanvoSessions`, `SanvoConnection`, `SanvoOutbox`, `SanvoOfflineCache`, `SanvoNotifications`, `SanvoSoundManager`, `SanvoVoiceSounds`, `SanvoVoiceDspCore`, `SanvoNoiseSuppressorCore`, `SanvoActivity`, `SanvoSearch`, `SanvoCosmetics`, `SanvoGamePicker`, `SanvoSelfProfileMenu`, `SanvoMemberList`, `SanvoInvites`) ao lado de `Sancord*`.
- **Metadados Windows e Executáveis (`icon.rc`, `scripts/build-desktop.ps1`, `scripts/package-release.ps1`, `.github/workflows/release.yml`):**
  - Adicionado bloco `VERSIONINFO` em `icon.rc` (`ProductName: "Sanvo"`, `FileDescription: "Sanvo Desktop"`, `InternalName: "Sanvo"`, `OriginalFilename: "Sanvo.exe"`).
  - Scripts de build e release passam a produzir `Sanvo.exe`, `SanvoServer.exe`, `Sanvo-<version>-windows-x64.zip`, `sanvo-update.json` e `sanvo-update.sig`, mantendo cópias de transição `Sancord.exe`, `SancordServer.exe`, `Sancord-<version>-windows-x64.zip`, `sancord-update.json` e `sancord-update.sig` assinadas com a mesma chave Ed25519.
- **Camada Centralizada `LegacySancordMigration` (`src/legacy_sancord_migration.rs`, `static/js/auth-storage.js`, `src/bin/desktop_auth_storage.rs`, `src/bin/desktop_links.rs`, `src/bin/desktop_assets.rs`, `src/updates.rs`, `src/bin/release_tools.rs`):**
  - **AppData (`%LOCALAPPDATA%\Sanvo`):** em instalação limpa cria apenas `%LOCALAPPDATA%\Sanvo` (sem criar pastas `Sancord*`); em instalação existente com `%LOCALAPPDATA%\SancordDesktopData`, copia de forma segura `desktop-prefs.json`, `known_endpoints.json`, `activity-config.json`, `activity-games.json`, `updates/result.json` e `EBWebView/Default/Local Storage/leveldb` para `%LOCALAPPDATA%\Sanvo` sem apagar a pasta antiga.
  - **Sessões DPAPI:** novos tokens são selados com `"Sanvo desktop auth v1:{scope}"` e `open` tenta `"Sanvo desktop auth v1:{scope}"` com fallback transparente para `"Sancord desktop auth v1:{scope}"`.
  - **LocalStorage / SessionStorage:** `LegacySancordMigration` migra e espelha chaves `sancord_*` ↔ `sanvo_*` sem perda de preferências ou sessão.
  - **Protocolos, Convites e Variáveis de Ambiente:** suporte simultâneo a `sanvo://open/?...` e `sancord://open/?...`, `sanvo.gg/` e `sancord.gg/`, `SANV-` e `SANC-`, autostart `"SanvoDesktop"` (limpando `"SancordDesktop"` legado) e `env_var_compat("SANVO_*", "SANCORD_*")`.
  - **Persistência SQLite e Origin WebView2 preservadas:** mantidos `data/sancord.db`, IDs de catálogo/banco (`sancord:minecraft`, `"sancord-core"`, `"sancord"` hub legado, `sancord_salt_v1:`) e partição interna `sancord://localhost/index.html` (`http://sancord.localhost`) no WebView2 para não invalidar dados existentes.
- **Testes validados:** `node --test tests/frontend-*.test.cjs` (**259/259** aprovados) e `cargo test --locked --all-targets --target-dir target-dev` (**205/205** aprovados, incluindo 4 novos testes em `legacy_sancord_migration::tests`, `legacy_sancord_ciphertext_opens_cleanly_in_sanvo` em `desktop_auth_storage::tests`, `links_only_load_embedded_interface` para `sanvo://` e `transition_accepts_sanvo_and_sancord_manifests_with_same_ed25519_key`).

## 23/11/2026 · Som Original `message_received.wav`, Contador Global de Não Lidas e Badge Nativa na Barra de Tarefas do Windows (`ITaskbarList3`) (Rodada 14)

- **Asset sonoro original `message_received` e separação de categorias (`static/assets/sounds/notifications/message_received.wav`, `src/bin/desktop_assets.rs`, `static/js/sound-manager.js`, `static/js/notification-manager.js`, `static/app.js`):**
  - Gerado e embutido o asset WAV original `/assets/sounds/notifications/message_received.wav` (`48 kHz`, `16-bit` mono PCM, normalizado a `-8 dBFS`, zero clipping, timbre cristalino curto em duas notas `F#5 → C#6` com decaimento rápido de ~225 ms, distinto dos sons de call/voz/stream/câmera).
  - `SancordSoundManager` (`SanvoSoundManager`) passa a declarar explicitamente `SOUND_CATEGORIES` (`NOTIFICATION`, `VOICE_EVENT`, `CALL`, `UI`) e `preloadNotificationCues()`.
  - `SancordNotifications.handleIncomingSound` reproduz `message_received` usando exclusivamente o **Volume de notificações** (`state.audioSettings.uiVolume`), separado do volume dos efeitos de call e do volume dos participantes.
  - Regras estritas de reprodução: nunca toca ao carregar histórico (`LoadMessages`), nunca toca para mensagens próprias (inclusive sync multi-device), nunca toca em conversas/canais/servidores silenciados (`mute`), nunca toca em **Não perturbe** (`dnd`), nunca toca rajada de sons antigos ao reconectar (`onWelcomeSync`), respeita cooldown (`1100 ms` por canal / `450 ms` global) e segue a preferência de notificação dos servidores (`all` = todas as mensagens, `mentions`/`default` = apenas menções relevantes, `none` = nada).
- **Fonte única de verdade do contador global (`SancordNotifications.getGlobalUnreadNotificationCount`) e integridade de estado (`static/js/notification-manager.js`, `static/js/chat.js`, `src/state.rs`, `src/ws.rs`):**
  - `getGlobalUnreadNotificationCount()` agrega apenas notificações acionáveis reais (`read_states.mention_count` e `unreadDms` de DMs 1:1 relevantes, Group DMs e menções/respostas em servidores, excluindo solicitações de mensagem pendentes e remetentes bloqueados, e retornando `0` antes do login).
  - **Deduplicação (`hasProcessedMessage` / `rememberProcessedId`):** mensagens com o mesmo `message.id` entregues em duplicidade pelo WebSocket jamais incrementam o contador ou tocam som duas vezes.
  - **Edição e Deleção (`MessageUpdated` / `MessageDeleted` / `MessagesBulkDeleted`):** editar mensagem não gera notificação; apagar mensagem não lida decrementa imediatamente `mention_count` no cliente (`onMessageDeleted`) e no servidor (`ServerState::decrement_mentions_on_delete`, emitindo `ReadStateUpdated` para sessões conectadas).
  - **Logout, Troca de Conta e Marcar Tudo como Lido:** `clearSessionState()` zera imediatamente o estado e envia `taskbar-badge:0` ao deslogar (`logoutAccount`, `SancordConnection.reject`) ou trocar de conta (`switchToSavedAccount`, `beginAddAccountFlow`, `logoutAllAccounts`); `markAllAsRead()` zera todas as notificações pendentes e atualiza a barra de tarefas imediatamente.
  - **Moderação de Taskbar Flash (`shouldFlashTaskbar`):** separado da badge numérica, com cooldown de `15 s` apenas quando a janela está sem foco e fora de `dnd`.
- **Integração nativa com a Barra de Tarefas do Windows (`src/bin/desktop_taskbar.rs`, `src/bin/SancordApp.rs`, `Cargo.toml`):**
  - Implementado `desktop_taskbar::apply_taskbar_badge(hwnd, count)` usando a API COM oficial do Windows `ITaskbarList3::SetOverlayIcon` (`Win32_UI_Shell`), sem modificar `icon.ico` no disco.
  - Renderizador supersampled `4×4` anti-aliased em memória (`render_badge_bgra` + `create_badge_hicon` via `CreateDIBSection` 32-bit ARGB top-down + `CreateIconIndirect` + `DestroyIcon`):
    - `count == 0`: remove completamente o overlay (`SetOverlayIcon(hwnd, HICON(0), null)`).
    - `1..=99`: exibe `"1"`..`"99"`; `100+`: exibe `"99+"`.
    - Escalonamento automático por DPI da janela (`GetDpiForWindow` + `GetSystemMetricsForDpi(SM_CXSMICON)`: `16×16` em 100%, `20×20` em 125%, `24×24` em 150%, `32×32` em 200%) e re-aplicação em `WindowEvent::ScaleFactorChanged`.
    - Círculo/pílula vermelha Sanvo (`#f43f43` → `#d9282e`) com anel externo escuro de contraste (`rgba(17, 19, 26, 0.94)`) e dígitos brancos nítidos para leitura perfeita em barras de tarefas claras e escuras do Windows.
- **Configurações (`static/index.html`, `static/app.js`, `static/js/settings-center.js`):**
  - Adicionado toggle independente **Mostrar contador de notificações no ícone do Sanvo** (`#notif-taskbar-badge`, `state.audioSettings.notifTaskbarBadge`), além de **Som de nova mensagem** (`#notif-sound-messages`) e **Volume de notificações** (`#notif-ui-volume-slider`).
- **Testes validados:** `node --test tests/frontend-*.test.cjs` (**260/260** aprovados) e `cargo test --locked --all-targets --target-dir target-dev` (**208/208** aprovados, incluindo 3 testes unitários de DPI/renderização/HICON em `desktop_taskbar::tests` e deleção de mensagem não lida em `dm_unread_multi_device_sync_and_blocked_group_sender_isolation`).

## 23/11/2026 · Motor de Tooltips em Portal + Ciclo de Vida Completo de Chamadas Privadas (Rodada 15)

- **Sistema Central de Tooltips em Portal (`static/js/ui-kit.js`, `static/styles.css`, `static/ui.css`, `src/bin/SancordApp.rs`, `static/js/polish.js`, `static/js/self-profile-menu.js`):**
  - Unificada hierarquia de `z-index` via tokens em `:root` (`--z-base: 1`, `--z-sticky: 30`, `--z-dropdown: 300`, `--z-modal: 1200`, `--z-dialog: 3000`, `--z-popover: 5000`, `--z-titlebar: 9000`, `--z-toast: 100000`, `--z-tooltip: 110000`) — eliminando sobreposição da barra nativa `#sancord-native-titlebar` sobre tooltips.
  - Motor `computeTooltipPosition` / `getTooltipSafeBounds` em portal no `document.body` com detecção da topbar (`30px + 10px` de margem de segurança), flip automático em 4 direções (`top`/`bottom`/`right`/`left`), shift/clamp sem sair da viewport, seta CSS `::after` ancorada (`--tooltip-arrow-x`/`--tooltip-arrow-y`), lado contextual (`.guild-rail` → `"right"`, `#sancord-native-titlebar` → `"bottom"`), `aria-describedby` e deduplicação de listeners em `SancordUI.tooltip`.
- **Ciclo de Vida Profissional de Chamadas Privadas DM / Group DM (`src/models.rs`, `src/state.rs`, `src/voice.rs`, `src/ws.rs`, `src/bin/desktop_taskbar.rs`, `src/bin/SancordApp.rs`, `static/js/sound-manager.js`, `static/js/voice-event-sounds.js`, `static/js/notification-manager.js`, `static/js/voice.js`, `static/app.js`, `static/index.html`, `static/js/settings-center.js`, `static/ui.css`):**
  - **Separação estrita `RINGING` ≠ `CALL SESSION`:** máquina de estados autoritativa no backend (`CallState`: `RINGING` → `WAITING_ACTIVE` → `CONNECTED` → `ENDED`) com `call_id` único (idempotente), `ringing_targets`, `declined_by` e timestamps reais do servidor (`created_at`, `ring_started_at`, `ring_expires_at`, `connected_at`, `session_expires_at`, `ended_at`, `server_now`).
  - **Timers centralizados (`CallTimingConfig` em `src/voice.rs`):** `DEFAULT_CALL_RING_DURATION_MS = 30_000` (30s de toque), `DEFAULT_CALL_IDLE_GRACE_MS = 300_000` (5 min de disponibilidade ociosa após saída sem atendimento) e `DEFAULT_CALL_RING_COOLDOWN_MS = 5_000` + janela deslizante anti-spam (`6` disparos / `60s`).
  - **Eventos WebSocket em tempo real:** `CallStateUpdated`, `ActiveCallsSync` (no `Welcome` para reconstrução fiel após reconexão usando `ring_expires_at - server_now`, sem reiniciar o toque do zero), `CallAnswered`, `CallRingTimeout`, `CallCanceled`, `CallDeclined`, `CallEnded`, além dos novos comandos cliente `CancelCall` e `RingCall` (*Chamar novamente*).
  - **Fluxo de timeout, entrada tardia e recusa:**
    - Quando `CALL_RING_DURATION` expira, o toque para nos destinatários (`CallRingTimeout`), mas **quem ligou permanece na sala** (`WAITING_ACTIVE`, nunca expulso) com opção *Chamar novamente* (com cooldown) e o destinatário vê o banner `#dm-active-call-banner` **Chamada em andamento · [Entrar na chamada]** para entrada tardia no mesmo `call_id`.
    - Se o destinatário entra tarde, a duração real da chamada conta a partir de `connected_at` (não inclui o tempo de toque) e não é registrada como *Chamada perdida*.
    - Se todos os participantes saem sem atendimento e sem recusa unânime (incluindo crash/queda do chamador), o toque para imediatamente e a sessão aguarda `CALL_IDLE_GRACE_PERIOD`; expirando vazia, encerra com `CallEnded(reason="expired")` e registra *Chamada perdida*. Enquanto houver participante conectado, a sessão nunca expira por ociosidade.
    - Recusar (`DeclineCall`) para o toque em todos os aparelhos do destinatário e avisa o chamador sem derrubá-lo automaticamente.
    - **Multi-dispositivo:** atender ou recusar em um aparelho envia `CallAnswered`/`CallDeclined` a todas as sessões da conta, interrompendo o ringtone imediatamente nos demais.
    - **Group DM:** toca apenas para participantes elegíveis que ainda não estão na call (excluindo bloqueados); quando um atende, os demais continuam tocando até `ring_expires_at` e podem fazer entrada tardia enquanto a call estiver ativa.
  - **Áudio, Notificações, DND e Desktop Windows:**
    - `SancordSoundManager.stopLoop` interrompe imediatamente a reprodução ativa (`AudioBufferSourceNode` com ramp-down anti-click de `15 ms` ou `HTMLAudioElement.pause()`), eliminando sobreposição entre ringtone/ringback e `call_connected`/`voice_join`.
    - `SancordVoiceSounds` respeita **Não perturbe (`dnd`)** e conversas silenciadas (silencia o ringtone mantendo o aviso visual), além de oferecer controle dedicado **Volume do toque de chamadas** (`#call-ringtone-volume`) e toggle **Toque de chamadas recebidas** (`#call-sound-incoming`).
    - Integração Windows em `desktop_taskbar::set_call_attention_flash` (`FlashWindowEx` discreto de 3 pulsos sem loop infinito via IPC `call-attention:start`/`stop` e `window:focus`) + notificação nativa clicável (`SancordNotifications.notifyIncomingCall`) quando minimizado/sem foco + aviso/confirmação ao receber chamada durante outra call ou transmissão ativa.
- **Testes validados:** `node --test tests/frontend-*.test.cjs` (**272/272** aprovados, incluindo `tests/frontend-tooltips.test.cjs` e `tests/frontend-private-calls.test.cjs`) e `cargo test --locked --all-targets --target-dir target-dev` (**214/214** aprovados, incluindo 5 novos testes de integração em `src/phase6_tests.rs` cobrindo ring timeout + entrada tardia, expiração de grace period ocioso, cancelamento/re-toque com cooldown, multi-dispositivo + reconexão preservando `ring_expires_at` e Group DM com 4 participantes).

## 23/11/2026 · Refinamento Tipográfico do Perfil + Ativação e Motor Vivo de Cosméticos Animados (Rodada 16)

- **Refinamento visual do Profile Popout / Perfil Completo (`static/js/profile-sharing.js`, `static/ui.css`, `static/styles.css`):**
  - Escala hierárquica mais compacta nos cabeçalhos de seção (`MEMBRO DESDE`, `CONEXÕES`, `CARGOS`, `NOTA PRIVADA`), pílulas de cargos discretas e exibição limpa das conexões públicas (removido o texto técnico `"Link manual"` do perfil público mantendo-o em Configurações).
- **Diagnóstico e correção da causa raiz dos cosméticos estáticos (`static/ui.css`, `static/styles.css`, `static/cosmetics/cosmetics.css`, `static/cosmetics/cosmetics-engine.js`, `static/js/profile-motion.js`, `static/js/profile.js`, `static/js/profile-editor.js`, `static/js/self-profile-menu.js`, `static/app.js`, `src/cosmetics.rs`):**
  - **Cascata CSS corrigida:** removidos os bloqueios `animation: none !important` de `static/ui.css` em `:not(.profile-motion-active *)` (substituídos por `animation-play-state: paused` fora de contextos ativos/hover, mantendo `animation: none !important` estritamente em `Reduced Motion`, `anim-policy-never`, `profile-window-inactive` e `profile-static-*`). Corrigido `transform-box: view-box; transform-origin: 50px 50px` em `.deco-spin-*`/`.deco-pulse-soft` para órbita centrada sem oscilação.
  - **Superfícies simultâneas em `profile-motion.js`:** substituído o limite de superfície única (`.profile-motion-active` em apenas 1 nó) por conjunto de superfícies primárias vivas (`#live-profile-preview-card`, `#profile-popover-card`, `.compact-profile-dialog`, `#self-profile-menu`, `#dm-peer-panel .profile-card`, `.cosmetic-picker-detail`, `.name-style-showcase-box`) + 1 superfície secundária de hover — impedindo que passar o mouse sobre mensagens/botões congele o perfil aberto.
  - **Scheduler `IDLE_WITH_EVENTS` e Classificação Canônica (`static/cosmetics/cosmetics-engine.js`):**
    - Adicionado `COSMETIC_ANIMATION_MAP` e `getAnimationMode(kind, id)` cobrindo todos os cosméticos do catálogo em `STATIC`, `LOOP`, `IDLE_WITH_EVENTS`, `PLAY_ON_OPEN` e `REACTIVE` (preservando todos os itens estáticos como `STATIC` e corrigindo metadata em `src/cosmetics.rs` para `starlit-silt`, `twilight-garden`, `neon`, `chrome`, `sakura` e `royal`).
    - Corrigida visibilidade inicial síncrona em `registerIdleHost` (`isElementLikelyVisible`), prioridade de superfícies primárias no budget (`BUDGET.maxConcurrentIdleHosts = 6`), primeiro evento orgânico rápido (`3,2–5,6 s`) seguido de cadência com jitter (`8–14,5 s` secundário / `16,5–26 s` raro), disparo imediato ao abrir Perfil Completo, Popout, Self Profile Menu, Editor e Seletor, e isolamento de erros `try/catch` com fallback estático seguro em todos os renderers.
  - **Animações ativadas por categoria sem redesenhar a arte aprovada:**
    - *Avatar Decorations:* camadas `back` + `front` com respiração de halo/companheiro, balanço de galho/pingente/cachecol/asas, cintilação, brasas/cristais, piscar de olhos, orelha mexendo, pétala solta, estrela cadente e glint especular.
    - *Profile Frames:* trilhos laterais com pulso luminoso suave (`.frame-art-rail::after`), crista com respiração, brilho diagonal periódico (`.frame-art-glint`) e detalhes temáticos (cristais, magma, sakura, pérolas, constelações) em `IDLE_WITH_EVENTS`, mantendo frames estáticas (`royal`, `cyber-corners`, etc.) intactas.
    - *Profile Effects:* `PLAY_ON_OPEN` / `ONE_SHOT` multi-estágio (`init → entrance → main → climax → dissipate`) com animações completas em `.ef-wind-ribbons`, `.ef-particles`, `.ef-grid-trace`, `.ef-constellation` e `.ef-layer-wash`, sem loop infinito e sem reiniciar ao editar bio.
    - *Display Name Styles:* animação exclusivamente no material (sem deslocar o texto) em todos os contextos (`full`, `FULL_PROFILE`, `editor-full`, `EDITOR_PREVIEW`, `editor`, `compact`, `popout`, `PROFILE_POPOUT`, `SELF_PROFILE_MENU`), cobrindo `gradient`, `custom-gradient`, `prism`, `holographic`, `cosmic`, `sakura`, `neon`/`glow` (pulso luminoso suave) e `chrome`/`royal` (reflexo metálico especular), mantendo estilos estáticos e fontes estáticas intactos.
    - *Nameplates:* sheen especular periódico (`.np-art-layer::after`) e elementos internos vivos (constelações, ramo de sakura, brasas, bolhas) sem deslocar o card; aplicadas também no preview de contexto do editor (`profile.js`).
    - *Idempotência & Member List:* `applyDecoToElement`, `applyProfileFrame`, `applyNameStyleToEl` e `applyNameplateChip` preservam nós/classes inalterados para não reiniciar animações em pequenos re-renders; `MEMBER_LIST` pausa por padrão e anima apenas no hover/foco do item.
- **Correção do overlay do GamePicker / Mural (`static/js/game-picker.js`, `static/ui.css`, `static/styles.css`, `tests/frontend-game-picker.test.cjs`):**
  - Corrigida a ausência da classe `modal-backdrop` em `SancordGamePicker.open` e `openGameDetails` + regra `.gp-backdrop` sem `position: fixed` e com `z-index: 950` (abaixo de `#settings-modal` `1200`), que empurrava toda a janela do app para cima e cortava o modal no rodapé; agora `.sancord-dialog-backdrop` e `.gp-backdrop` garantem `position: fixed; inset: 0; z-index: var(--z-dialog, 3000)` com margem segura da barra nativa (`--native-titlebar-h`).
  - Corrigido `apiBaseUrl` em `game-picker.js` para resolver `/api/games/*` via `SancordNet.url(path)` (antes chamava `apiUrl` inexistente, fazendo o desktop cair em `"Modo offline"` no `sancord://localhost`).
- **Desbloqueio de animações no Windows com `SPI_GETCLIENTAREAANIMATION = False` (`static/index.html`, `static/js/polish.js`, `static/js/profile.js`, `static/cosmetics/cosmetics-engine.js`, `static/ui.css`, `static/cosmetics/cosmetics.css`):**
  - Identificado que no Windows com "Efeitos de animação" desativados nas configurações do sistema, o Chromium/WebView2 ativa `@media (prefers-reduced-motion: reduce)` e a regra global `*, *::before, *::after { animation-duration: .001ms !important }` + `systemPrefersReducedMotion()` congelavam **todos** os cosméticos no Sanvo mesmo com *Reduzir movimento* desligado no app.
  - Adicionado toggle independente **Sincronizar com o computador** (`#appearance-sync-reduce-motion`, `syncReducedMotion`, padrão `false`, paridade com Discord Desktop) em Configurações → Acessibilidade e vinculadas as regras globais/cosméticas de redução de movimento a `body.reduce-motion` / `body.anim-policy-never`.
- **Resiliência do GamePicker em servidores sem `/api/games/*` (`static/js/game-picker.js`):** fallback transparente para busca no catálogo local quando `/api/games/search` responde `404`.
- **Testes validados:** `node --test tests/frontend-*.test.cjs` (**278/278** aprovados, incluindo regressão do `GamePicker`, Windows `prefers-reduced-motion` e 3 novos testes em `tests/frontend-cosmetics-v3.test.cjs`) e `cargo test --locked --all-targets --target-dir target-dev` (**214/214** aprovados).

## 23/11/2026 · Nova Geração V4 Premium de Cosméticos de Perfil (Substituição Total + Motor Híbrido Canvas 2D VFX + SVG) (Rodada 17)

- **Direção e substituição completa:** Substituída toda a antiga coleção básica de cosméticos de perfil (molduras simples de círculo, anéis recoloridos e efeitos CSS genéricos) pela **Biblioteca V4 Premium**, elevando Avatar Decorations, Profile Frames, Profile Effects e Nameplates ao padrão de produto desktop de alto acabamento, mantendo 100% intactos layout de perfil, bio, cargos, conexões e tipografia geral.
- **Motor Híbrido Canvas 2D Procedural 60fps + SVG Esculpido (`static/cosmetics/cosmetics-vfx.js`, `static/cosmetics/cosmetics-engine.js`, `static/cosmetics/cosmetics.css`, `src/bin/desktop_assets.rs`, `static/index.html`):**
  - **`SanvoCosmeticsVFX` (`cosmetics-vfx.js`, embutido em `desktop_assets.rs`):** loop único compartilhado `requestAnimationFrame` com HiDPI (`dpr ≤ 2`), `delta-time` limitado, limite de 10 instâncias ativas simultâneas (`MAX_ACTIVE_VFX`), pausa automática em janela inativa/oculta, `0` canvases na `MEMBER_LIST` (hover-only CSS), modo hover-only em thumbnails `MINI` do picker e pose estática curada em `Reduced Motion` (`t = 1.35`). Guard jsdom para manter testes DOM limpos.
  - **Avatar Decorations V4 (16 peças: 12 animadas multi-camada `BACK + AVATAR + FRONT` com 2 planos Canvas 2D independentes + 4 estáticas de colecionador):** `galaxy-portal`, `sakura-glow`, `core-orbit`, `cat-gamer`, `dragon-fire`, `frost-crown`, `angel-wings`, `blood-moon`, `ocean-bubbles`, `electric-pulse`, `cyber-ring`, `lunar` (`IDLE_WITH_EVENTS`, partículas orbitando atrás e passando na frente, neblina/estrelas/pétalas/brasas/cristais/penas/bolhas/arcos elétricos/fases lunares) + `static-royal-crown`, `static-emerald`, `static-cyber-hud`, `static-diamond` (`STATIC`).
  - **Profile Frames V4 (21 peças: 15 arquitetônicas vivas + 2 reativas + 4 estáticas/conquistas):** toda moldura animada agora combina arquitetura SVG esculpida (crista superior, cantos, selo inferior, trilhos) com Canvas VFX perimetral seguro (nunca cobre texto/botões): `cosmic-drift`, `sakura-wind`, `ember-trail`, `frost-glint`, `winter-2026`, `liquid`, `arcane-grimoire`, `eclipse-crown`, `seraphim-arch`, `dream-sanctuary`, `core-pulse`, `holographic`, `neon-pulse`, `founder`, `developer` (`IDLE_WITH_EVENTS`), `reactive-aura` e `voice-pulse` (`REACTIVE`), e `royal`, `cyber-corners`, `minimal`, `early-user` (`STATIC`).
  - **Profile Effects V4 (12 peças cinematográficas em 4 atos `PLAY_ON_OPEN` / `ONE_SHOT`, `3,2–3,6 s`):** `star-trail`, `petal-drift`, `embers`, `polar-ribbon`, `core-signal`, `circuit-boot`, `arcane-sigil`, `eclipse-flare`, `abyssal-tide`, `seraphim-fall`, `synth-overdrive`, `dream-butterflies` — abertura → desenvolvimento → clímax → dissipação limpa no Canvas 2D + SVG sem loop infinito e com *Reproduzir novamente* no editor/seletor.
  - **Nameplates V4 (11 peças: 8 animadas + 3 estáticas):** expandidas com `arcane-velvet`, `eclipse-gold` e `dream-mist` além das 5 animadas e 3 estáticas existentes.
- **Limpeza do catálogo na UI + compatibilidade transparente (`src/cosmetics.rs`, `static/cosmetics/cosmetics-engine.js`, `static/app.js`, `static/js/profile.js`, `static/js/profile-motion.js`, `static/ui.css`):**
  - Removidos do `catalog()` exibido na interface todos os itens legados básicos/protótipo (`flame-violet`, `devil-horns`, `cyber-cyan`, `golden-halo`, `crimson-vortex`, `rainbow-prism`, `electric-surge`, `heart-pixel`, `neon-glitch`, `nebula-orbit`, `sakura-fall`, `ember`, `snowfall`, `digital-rain`, `retro-pixels`, `static-gold`, `static-crimson`, `static-blurple`, `static-angel`, molduras genéricas `aurora`/`gold`/`obsidian`/`diamond`/`crimson`/`emerald`/`violet`/`neon-cyber`/`rainbow`/`sakura`/`glitch`/`galaxy`/`ice`/`fire`/`pixel`/`angel`/`demon`/`vintage`/`plasma`, efeitos antigos `aurora`/`cherry-petals`/`fire-sparks`/`electric-arc`/`snow-drift`/`confetti-burst`/`cosmic-dust`/`sakura-breeze`/`neon-grid`/`matrix-rain`/`golden-shimmer`/`void-mist`/`rainbow-wave` e placas legadas).
  - Mantido `LEGACY_COSMETIC_ALIASES` no frontend e `LEGACY_FREE_IDS` em `src/cosmetics.rs` (`check_equip` + `owned_keys`) para que contas/presets já salvos no banco migrem visualmente de forma transparente para as peças V4 correspondentes sem quebrar nenhum dado ou protocolo.
- **Limitações conhecidas:** no ambiente de teste jsdom, `HTMLCanvasElement.getContext("2d")` não existe nativamente, portanto a renderização de pixels do Canvas VFX é validada no WebView2 real (enquanto DOM, camadas `back`/`front`, ciclo de vida, aliases, isolamento da `MEMBER_LIST` e `Reduced Motion` são validados automaticamente via Node/jsdom).
- **Testes validados:** `node --check` em todos os arquivos JS, `node --test tests/frontend-*.test.cjs` (**279/279** aprovados, incluindo suíte V4 em `tests/frontend-cosmetics-v3.test.cjs`) e `cargo test --locked --all-targets --target-dir target-dev` (**214/214** aprovados, incluindo `desktop_assets::tests::assets_are_embedded_and_routes_are_closed`).

## 23/11/2026 · Reconstrução Visual do Zero — Biblioteca Flagship V5 Pintada (HiDPI RGBA WebP Multicamada) (Rodada 18)

- **Substituição completa da base visual:** Descartados todos os assets vetoriais/SVG/CSS básicos anteriores das 3 categorias principais de cosméticos de perfil e substituídos por **28 assets reais pintados em alta resolução** (`1024×1024` / `640×480` renderizados em Chromium/Edge headless com downsampling Lanczos via Pillow para **HiDPI RGBA WebP**, orçamento total de apenas **343,1 KB** em `static/cosmetics/assets/*.webp`, embutidos em `src/bin/desktop_assets.rs` com `image/webp` e `Cache-Control: public, max-age=31536000, immutable`). Gerador reprodutível em `scripts/generate-v5-cosmetics.mjs`.
- **4 Coleções Flagship Coesas (qualidade sobre quantidade, zero bordas/círculos genéricos ou emojis):**
  - **Avatar Decorations V5 (`320×320`, `BACK + AVATAR + FRONT` + camada `BLINK` real no personagem):**
    - `galaxy-portal` (*Astrolábio Celestial*, `IDLE_WITH_EVENTS`): anéis armilares dourados e nebulosa violeta em 2 planos + partículas orbitais 3D.
    - `sakura-glow` (*Ramo de Hanami*, `IDLE_WITH_EVENTS`): ramo de cerejeira ilustrado com lanternas quentes em balanço orgânico + pétalas em profundidade.
    - `frost-crown` (*Dragão Glacial*, `IDLE_WITH_EVENTS`): crista de cristais facetados com reflexo especular azul-gelo + neve cristalina.
    - `cat-gamer` (*Kitsune-Neko Cyber*, `IDLE_WITH_EVENTS`): gatinha synthwave pintada com fones, cauda viva e camada `deco_cyber_blink.webp` para piscar real de olhos.
  - **Profile Frames V5 Assimétricas (`360×270`, ornamentos `TL + TR + BR` pintados em WebP, zero `.pf-ring` / borda neon):**
    - `cosmic-drift` (*Observatório Astralium*), `sakura-wind` (*Jardim de Hanami*), `frost-glint` (*Cidadela de Glacium*), `holographic` (*Chassi Synth-Neko*) + 4 molduras exclusivas de conquista/temporada preservadas (`founder`, `developer`, `winter-2026`, `early-user`).
    - Harmonia automática Frame ↔ Effect: durante o clímax do Profile Effect (`p ∈ [0.38, 0.78]`), o motor adiciona `.cos-effect-climax` no `.profile-card`, atenuando discretamente a moldura para o efeito protagonizar sem poluição visual.
  - **Profile Effects V5 Narrativos em 4 Atos (`192×192` hero sprites WebP + Canvas 2D VFX, `PLAY_ON_OPEN` / `ONE_SHOT`, `3,6 s`, nunca loop infinito):**
    - `star-trail` (*Eclipse da Nebulosa*), `petal-drift` (*Rajada de Cerejeira*), `polar-ribbon` (*Tempestade Polar*), `circuit-boot` (*Inicialização Holográfica*), todos com entrada direcional → desenvolvimento → clímax → dissipação limpa e botão *Reproduzir novamente*.
  - **Nameplates & Name Styles:** 4 placas coordenadas (`starlit-silt`, `twilight-garden`, `frost-vein`, `core-stripe`) + 26 fontes/materiais preservados.
- **Compatibilidade total de contas, banco e inventário (`src/cosmetics.rs`, `src/cosmetic_collection.rs`, `static/cosmetics/cosmetics-engine.js`, `static/js/profile-editor.js`):**
  - Todos os IDs legados continuam aceitos via `LEGACY_FREE_IDS` (`check_equip`, `owned_keys`, `owns_key`) e mapeados visualmente via `LEGACY_COSMETIC_ALIASES` para as peças Flagship V5 correspondentes, preservando 100% do inventário, favoritos, presets e molduras exclusivas desbloqueadas (como na conta `Swag`).
- **Correções adicionais da mesma sessão:**
  - `src/legacy_sancord_migration.rs` + `static/js/updater.js`: movido `updates/result.json` para `ONE_SHOT_MIGRATION_FILES` (eliminando o toast recorrente *"Atualização concluída"* em toda abertura).
  - `static/app.js`: corrigido `TypeError: Illegal invocation` no getter WebIDL `AudioContext.prototype.audioWorklet` (que impedia os botões **Ligar** / **Vídeo** em DMs) com guarda segura `typeof window !== "undefined"` e `"audioWorklet" in AudioCtxCtor.prototype`.
- **Verificação visual real e testes:**
  - Inspecionados visualmente contact sheet dos 28 assets e capturas reais em Chromium headless (150% DPI) no Editor de Perfil ao vivo, corrigindo deslocamento de `.cos-v5-deco` sobre `.deco-svg-layer`, colisão de `.pe-preview-tools` com o ornamento `TR` e recorte de orelhas nas miniaturas da barra lateral.
  - **Testes aprovados:** `node --check` (**47** arquivos JS OK), `node --test tests/frontend-*.test.cjs` (**280/280** aprovados) e `cargo test --locked --all-targets --target-dir target-dev` (**214/214** aprovados: 193 núcleo + 20 desktop + 1 manutenção). Executáveis `Sanvo.exe`, `Sancord.exe`, `SanvoServer.exe` e `SancordServer.exe` recompilados e implantados localmente.

### Expansão V5 Pintada (+4 Coleções Flagship + Conjunto Exclusivo Soberano + 6 Insígnias Exclusivas Jewel)

- **33 novos assets HiDPI RGBA WebP** gerados por `scripts/generate-v5-expansion.mjs` (`422,6 KB`; orçamento total combinado de **61 assets = 765,7 KB**), embutidos em `src/bin/desktop_assets.rs`:
  - **Forja de Drakon (Infernal):** `dragon-fire` (*Chamas de Drakon*), `ember-trail` (*Forja de Drakon*), `embers` (*Erupção de Brasas*), `ember-line` (*Veio de Brasa*).
  - **Grimório Arcano:** `blood-moon` (*Oráculo do Eclipse*), `arcane-grimoire` (*Grimório Arcano*), `arcane-sigil` (*Selo do Eclipse*), `arcane-velvet` (*Veludo Arcano*).
  - **Santuário Abissal:** `ocean-bubbles` (*Coroa das Profundezas*), `liquid` (*Santuário Abissal*), `abyssal-tide` (*Maré Bioluminescente*), `tide-glass` (*Vidro de Maré*).
  - **Arco de Serafim:** `angel-wings` (*Asas de Serafim*), `seraphim-arch` (*Arco de Serafim*), `seraphim-fall` (*Chuva de Plumas*), `eclipse-gold` (*Ouro de Serafim*).
  - **Soberano Imperial (exclusivo `badge:sovereign`):** `eclipse-sovereign` (*Coroa do Soberano*) e `sovereign-crest` (*Trono Soberano*).
- **6 novas insígnias exclusivas com arte multi-tom `.badge-jewel`** (`src/cosmetics.rs`, `static/js/profile.js`, `static/ui.css`): `architect` (*Arquiteto do Sanvo*), `sovereign` (*Soberano Imperial*), `astral_guardian` (*Guardião Astralium*), `dragon_forged` (*Forjado em Drakon*), `prism_collector` (*Colecionador Prismático*) e `obsidian_vip` (*Núcleo Obsidiana*) — concedidas em `data/badges.json` exclusivamente para a conta `Swag` (junto com `founder` e `developer`).
- **Verificação visual em Chromium (Edge Headless, 150% DPI):** inspecionadas capturas ao vivo do Editor de Perfil (0 erros de console), corrigindo lookup direto em `V5_AVATAR_ART`/`V5_FRAME_ART` e lista `isV5Flagship` dos 8 efeitos em `cosmetics-engine.js` para eliminar completamente elementos SVG herdados da V3.

## 23/11/2026 · Túneis duplicados e scripts com o nome Sanvo (Claude)

- **Problema:** havia 9 processos `cloudflared` abertos ao mesmo tempo, cada um com um endereço público ativo.
  - Causa: `ensure_local_host_started_if_present` (em `src/bin/SancordApp.rs`) abria um túnel novo sempre que o app encontrava o servidor desligado, sem checar se já existia um.
  - Os reinícios do servidor durante as rodadas foram acumulando os túneis.
- **Correção:**
  - novo `src/bin/desktop_tunnel.rs`: `tunnel_running(exe)` lista os processos (feature `Win32_System_Diagnostics_ToolHelp`) e compara o caminho com `query_process_image_path`, que agora é `pub(crate)` em `desktop_activity.rs`;
  - o app só cria o túnel e apaga o `tunnel.log` quando não há nenhum `cloudflared.exe` da mesma pasta rodando;
  - testes: comparação de caminhos, processo inexistente e o teste manual ignorado `tunel_real_em_execucao_e_detectado`, conferido com o túnel real.
- **Scripts:**
  - `start-host.ps1` procura `SanvoServer.exe` e usa `SancordServer.exe` só como reserva;
  - `stop-host.ps1` aceita os dois nomes;
  - `install-autostart.ps1` mostra "Sanvo" nas mensagens e mantém o valor `SancordHost` no registro, para não duplicar a inicialização.
- **Limpeza:** os 8 túneis antigos foram encerrados pelo PID, com o caminho conferido. Ficou só o PID 19012, cujo endereço é o anunciado pelo servidor; ele respondeu `/api/health` antes e depois da limpeza.
- **Testes:** 280 de frontend e 217 em Rust aprovados.
- **Instalação:** `Sanvo.exe` e a cópia `Sancord.exe` foram trocados no atalho pela build `qa-desktop-tunnel`. A versão anterior ficou em `qa-desktop-tunnel/Sanvo-antes-*.exe`. O servidor não mudou.
- **Não publicado** no GitHub: segue junto com as rodadas locais (16 a 18 e Expansão V5), aguardando autorização.
## 23/11/2026 · E-mail obrigatório no cadastro e no login, com confirmação por código (Claude) — nos fontes, NÃO publicado

- **Decisões do usuário:**
  - o login aceita **e-mail ou nome de usuário**;
  - contas antigas cadastram o e-mail no próximo login;
  - confirmação **por código** enviado por **SMTP genérico**.
- **Backend:**
  - `src/email_verification.rs`, módulo novo:
    - `email_step` (`add`/`verify`), `target_email`, `email_in_use`, `account_key_by_email`;
    - códigos de 6 dígitos guardados só como hash e só em memória: valem 15 min, aceitam 5 tentativas, exigem 60 s entre envios e no máximo 6 por hora;
    - rotas `POST /api/email/start` (cadastrar ou trocar e-mail, ou reenviar) e `POST /api/email/verify`.
  - `src/mailer.rs`, módulo novo:
    - SMTP via `lettre` 0.11 com TLS nativo do Windows (schannel); dependência nova no `Cargo.lock`;
    - a configuração vem de `data/smtp.json` (há um modelo em `smtp.example.json`) ou de `SANVO_SMTP_*`;
    - sem configuração, o código só aparece no log (`Mailer::Log`); nos testes, `Mailer::Memory`.
  - `Account` ganhou `email_verified` e `pending_email`, campos do JSON da conta (sem migração de esquema).
  - `AuthRequest.email` e `AuthResponse.{code, email_step, email_hint, retry_after}`.
  - Cadastro: e-mail obrigatório e único, sem diferenciar maiúsculas; o código é enviado no cadastro.
  - Login e recuperação aceitam e-mail ou nome.
  - `Config.require_verified_email`: `true` em produção e `false` em `for_tests` (os testes antigos não passam pela confirmação).
  - O WebSocket envia `EmailVerificationRequired { step, email_hint }` e fecha quando falta o e-mail.
  - `UpdateAccountEmail`: o novo e-mail fica em `pending_email` até o código ser confirmado, e o e-mail não pode ser removido.
- **App:**
  - `auth-screen.js`: modos `add-email` e `verify`, campo de e-mail no cadastro e "E-mail ou nome de usuário" no login;
  - código com envio automático ao digitar o 6º número, reenviar com contagem regressiva, "Usar outro e-mail" e "Entrar com outra conta";
  - `connection.js` trata `EmailVerificationRequired` sem apagar a sessão salva;
  - Configurações → E-mail pede o código (`promptAccountEmailCode`);
  - textos em `i18n.js`, em pt-BR e en.
- **Testes:**
  - `src/email_tests.rs` (4 testes de integração);
  - unitário em `email_verification`;
  - `tests/frontend-auth-email.test.cjs` (3 testes);
  - suítes: 283 frontend e 222 Rust aprovados.
- **Ensaio real** (servidor de QA na porta 3100, cópia do banco, sem SMTP):
  - cadastro sem e-mail → 400;
  - cadastro com e-mail → passo `verify`;
  - WebSocket → `EmailVerificationRequired`;
  - login pelo e-mail → 200;
  - reenvio imediato → 429;
  - código lido no log → confirmado;
  - WebSocket → `Welcome`;
  - mesmo e-mail em outra conta → 409.
- **Impacto ao publicar:** das 7 contas reais, só 1 tem e-mail e nenhuma está confirmada. Todas vão passar pelo passo de e-mail no próximo login.
  - **Antes de publicar, configurar `data/smtp.json` no servidor de produção**: sem isso, os códigos só aparecem no log e ninguém consegue confirmar sozinho.
## 23/11/2026 · Autor das mensagens de sistema: "Sancord" → "Sanvo" (Claude)

- O servidor passou a criar as mensagens de sistema como `Sanvo` e o bot como `Sanvo Bot`, em `social.rs`, `voice.rs`, `ws.rs` (2) e `state.rs`.
- As mensagens antigas já gravadas continuam com "Sancord" no banco. O app as exibe como "Sanvo" via `renameLegacySystemAuthors` no início de `handleServerMessage` (`app.js`), que só vale para autores de sistema e não renomeia pessoas. `profile-sharing.js` reconhece também "Sanvo Bot".
- Teste novo: `tests/frontend-sanvo-system-author.test.cjs`. Suítes: 284 frontend e 222 Rust.
- Cliente instalado no atalho (`qa-desktop-sanvo`, hash `176E5B4EEFFD…`). Ele é compatível com o servidor atual, que não exige e-mail. A troca no servidor só vale depois da próxima publicação.
- `data/smtp.json` foi criado para `sanvodesktop@gmail.com` com `password` = `COLE-AQUI-A-SENHA-DE-APP`. **O usuário cola a senha de app do Google**; nenhuma IA deve digitar ou ler essa senha.
### Atualização 23/11/2026: envio real de e-mail homologado
- `data/smtp.json` está configurado pelo usuário com o Gmail `sanvodesktop@gmail.com`, senha de app (a senha não foi lida nem registrada).
- O `mailer.rs` ficou mais tolerante:
  - remove os espaços da senha de app quando o host é `smtp.gmail.com`;
  - em erro de JSON, o log mostra só linha e coluna, sem o conteúdo do arquivo.
  - Na primeira tentativa, o usuário tinha colado a senha com uma quebra de linha dentro das aspas.
- **Ensaio real** no servidor de QA (porta 3100, cópia do banco, com o `smtp.json`):
  - cadastro de `TesteSmtp458816`;
  - o Gmail aceitou o envio e o e-mail "655323 é o seu código do Sanvo" chegou na caixa de entrada (confirmado pelo usuário);
  - `/api/email/verify` respondeu 200, e o WebSocket respondeu `Welcome`.
  - O servidor de QA foi parado e a cópia do `smtp.json` na pasta de QA foi apagada.
- **Pronto para publicar.** Tudo o que está só local (rodadas 16 a 18 + Expansão V5, túneis, e-mail obrigatório, autores "Sanvo") pode sair como **v0.2.9**, com autorização.
  - Ao atualizar a produção, o servidor carrega o `data/smtp.json`, e todas as 7 contas passam pelo passo de e-mail.
## 23/11/2026 · v0.2.9 publicada e produção atualizada (Claude, autorizado pelo usuário)
- **Commit:** `dcbda7c39dfae1a2b3934f559c54c1a341c71709` na `main` (pai `535a0fa`, sem force), feito pela API do GitHub.
  - 119 arquivos, todos com o hash de blob conferido. As imagens WebP foram enviadas byte a byte, e só os arquivos de texto tiveram as quebras de linha normalizadas para LF.
  - `sancord-release validate v0.2.9` OK.
  - Auditoria limpa: nenhum segredo, URL de túnel, e-mail pessoal ou senha de app. A pasta `data/` (com o `smtp.json`) ficou fora.
  - Testes: 284 frontend e 222 Rust.
- **Tag** `v0.2.9`: run 45240839610 ("Stable Windows release") e "Windows CI", ambos com sucesso. Release publicada em 23/11 às 19:03Z.
  - `SanvoServer.exe`: sha256 `99a1ab39…ecb81`.
  - `Sanvo.exe`: sha256 `5e6882cb…65ec`.
- **Produção:**
  1. Parado o PID 16096 (`SanvoServer.exe`, caminho conferido).
  2. Backup em `data-backup-pre-0.2.9-20261123-1603/`, igual por hash (exceto `tunnel.log`), com `SanvoServer-0.2.8-local.exe`.
  3. `SanvoServer.exe` e a cópia `SancordServer.exe` trocados pelo oficial e religados com `start-host.ps1`. Ficou 1 túnel só.
- **Conferido:**
  - o log mostra "SMTP configurado (smtp.gmail.com:587)";
  - `/api/health` responde `0.2.9`, local e pelo túnel;
  - banco v22, `integrity_check = ok`, 7 contas.
- **Cliente:** cliente oficial instalado: 5E6882CBF592.
- **Rollback:** restaurar `data/` desse backup e voltar `SanvoServer-0.2.8-local.exe`.
- **Efeito:** as 7 contas passam pelo passo de e-mail no próximo login, com o código enviado pelo Gmail `sanvodesktop@gmail.com`.

## 23/11/2026 · Workspace volta a focar no Sanvo Desktop

- A etapa experimental do aplicativo móvel foi retirada antes de publicação, incluindo o projeto, a homologação e os recursos exclusivos dele nos arquivos compartilhados. A cópia de recuperação está fora do repositório.
- Os arquivos compartilhados alterados nessa etapa foram comparados com a tag pública `v0.2.9` e voltaram ao conteúdo da release. A produção usa os binários oficiais dessa tag, conferidos por SHA-256. O atalho aponta para `D:\Sancord\Sanvo.exe`.

## 23/11/2026 · Otimização em repouso e ao minimizar

- O host Windows informa ao WebView2 o estado real de minimização. O frontend suspende animações CSS e cancela os timers de duração, qualidade da chamada, indicadores remotos de fala e contadores de atividade enquanto a janela está oculta. Ao restaurar, os indicadores voltam a partir do estado e dos horários existentes. O processamento de captura e o heartbeat continuam rodando.
- O Canvas de cosméticos desenha nas áreas visíveis, incluindo a posição de rolagem. O fundo animado opcional pausa após 15 segundos sem interação e retoma com mouse, teclado ou rolagem. Os medidores do microfone evitam atualizações do DOM quando estão fora de vista.
- `node scripts/profile-motion-qa.mjs --idle` valida minimização real, restauração, rolagem e `Pong` de um backend Rust isolado. Use `--idle --baseline` com o `.exe` anterior para comparar. No ensaio de 16 segundos, o Canvas recortado foi de 1.602 desenhos a zero e o visível manteve 1.602. O tempo de tarefas do renderizador foi de 361 ms para 329 ms nesse cenário. O ensaio não mede o consumo total da GPU.

## 23/11/2026 · Sanoted no cliente desktop

- A Home abre a área **Sanoted** abaixo de Servidores. `static/js/sanoted.js` cuida da biblioteca, pastas aninhadas, pesquisa, filtros, ordenação, lixeira e sincronização. O editor de `static/js/sanoted-editor.js` usa blocos JSON para títulos, formatação, citação, código, listas, checklists, links e referências de anexos. Os atalhos na área são Ctrl+N, Ctrl+F, Ctrl+B, Ctrl+I e Ctrl+Shift+7.
- A migração SQLite 23 cria `sanoted_notes`, `sanoted_folders` e `sanoted_assets`. Todas as consultas de `src/sanoted.rs` usam a conta obtida da sessão Bearer. É o ID persistente da conta, distinto do ID da conexão. O campo `user_id` enviado dentro de uma mutação é rejeitado. As rotas não expõem HTML, links de anexo públicos nem identificadores internos de disco. O WebSocket envia apenas uma sinalização de mudança às sessões da mesma conta.
- `static/js/sanoted-storage.js` grava a edição local durante a digitação. Os registros e arquivos do IndexedDB são cifrados com AES-GCM e a chave é protegida por DPAPI, com escopo por conta e origem do backend. O fechamento pela janela aguarda a gravação local. Uma nota aberta anteriormente pode ser editada offline e as alterações pendentes são recuperadas após reiniciar. O cache inicial depende da sessão lembrada e do snapshot offline já existente no cliente.
- O envio ao backend espera 650 ms de pausa. O cliente reaproveita a reconexão do Sanvo e mantém o rascunho se a sincronização falhar. Cada mutação leva uma revisão-base e um UUID de operação, para deduplicação e resposta de conflito. O usuário pode manter sua edição ou usar a versão retornada pelo servidor. Na reconexão e ao receber uma mudança privada, o cliente atualiza a biblioteca e carrega o documento selecionado conforme necessário.
- Imagens por colagem, arraste ou seletor e arquivos PDF ou texto passam pelo mesmo diretório de uploads existente. O backend valida formato, dimensões e tamanho e usa um identificador interno aleatório no disco. A leitura exige a conta autorizada e só é atendida pela rota privada. Imagens podem ser ampliadas, redimensionadas e legendadas, com carregamento sob demanda. Os limites são 500 notas, 100 pastas, 128 KiB por documento, 10 MiB por arquivo, 24 anexos armazenados por nota e 250 MiB por conta. Anexos removidos do documento permanecem associados à nota até a exclusão permanente, para preservar a resolução de conflitos.
- QA de API em `src/sanoted_tests.rs`. QA de ponta a ponta em `scripts/sanoted-qa.mjs` com processos Windows, backend e perfis WebView2 descartáveis. O teste derruba o backend de QA, recupera uma edição e uma imagem após encerrar o cliente e confere a sincronização em outro perfil. A colagem e o arraste são exercitados com eventos de entrada do WebView2. O atalho físico Win+Shift+S e a sincronização entre dois computadores físicos ficam para homologação.
- Entrega local, com atualização conjunta de cliente e backend necessária para disponibilizar a área em produção.

## 23/11/2026 · v0.2.10 publicada e produção atualizada (autorizada pelo usuário)

- **Commit:** `2e49d405a1ddc74aa1d86175916a95845590ca7c` na `main` de `gabrielsanderx/Sanvo` (pai `dcbda7c3`, sem force), via GitHub API com 35 arquivos alterados/novos conferidos por SHA-1 e `0` segredos/arquivos proibidos.
  - `sancord-release validate v0.2.10` OK; suítes locais aprovadas (**284** frontend + **224** Rust + QA E2E `sanoted-qa.mjs` e `profile-motion-qa.mjs --idle`).
- **Tag** `v0.2.10`:
  - `Stable Windows release` (run `45283847492`): `tests`, `package`, `sign`, `verify-package` e `publish` concluídos com sucesso.
  - `Windows CI` na `main` (run `45283845869`): sucesso.
  - `sancord-release verify` local sobre os ativos publicados: assinatura Ed25519 e integridade válidas.
  - `SanvoServer.exe` / `SancordServer.exe`: `16.742.912` bytes, SHA-256 `1b80a194d16298bd1698dd2bdfd93faa9350eb5ee925e939e5193e9448dbf73e`.
  - `Sanvo.exe` / `Sancord.exe`: `13.825.024` bytes, SHA-256 `d062eb0a5ef807eaf5ce02ea46c7ed64e11067a5cb3db1f1e4de9efd3bed6604`.
- **Produção atualizada:**
  1. Parado apenas o `SanvoServer.exe` anterior (PID `16328`); o túnel `cloudflared.exe` (PID `19012`) permaneceu intacto e único.
  2. Backup completo criado em `data-backup-pre-0.2.10-20261123-2018/` (`data/` + `SanvoServer-0.2.9.exe` + `Sanvo-0.2.9.exe`).
  3. `SanvoServer.exe`, `SancordServer.exe`, `Sanvo.exe` e `Sancord.exe` substituídos pelos binários oficiais assinados `v0.2.10` e servidor religado via `scripts/start-host.ps1` (PID `25288`).
- **Conferido:**
  - `/api/health` responde `0.2.10`, `ok: true`, protocolo `2`;
  - log confirma `SMTP configurado (smtp.gmail.com:587, starttls)` e URL pública assinada anunciada;
  - banco migrado de **v22 → v23** com `integrity_check = ok`, 7 contas e 23 mensagens preservadas, tabelas `sanoted_notes`, `sanoted_folders` e `sanoted_assets` criadas.
- **Rollback:** parar `SanvoServer.exe`, restaurar `data/` e `SanvoServer-0.2.9.exe` / `Sanvo-0.2.9.exe` de `data-backup-pre-0.2.10-20261123-2018/`.

## 23/11/2026 · Barra inferior limpa (estilo Discord) + Expansão Flagship V5 Wave 3 (12 Coleções Pintadas)

- **Barra inferior de usuário (`#self-user-profile-bar` e `.profile-panel-preview`):**
  - Removido o fundo/gradiente e a arte SVG de nameplate da barra inferior esquerda do usuário para espelhar o dock escuro e limpo do Discord Desktop (`static/app.js`, `static/js/profile.js`, `static/ui.css`, `static/cosmetics/cosmetics.css`), mantendo na barra apenas a decoração de avatar e a tipografia/cor do nome (`name_style`), enquanto as nameplates continuam ativas na lista de membros, lista de DMs e editor.
- **Expansão Flagship V5 Wave 3 (`scripts/generate-v5-wave3.mjs`, 37 novos assets WebP HiDPI RGBA, totalizando 98 assets embutidos em `src/bin/desktop_assets.rs`):**
  1. **Bosque Onírico (`dream`):**
     - Avatar Decoration `lunar` (*Guardião das Borboletas*): `deco_dream_back.webp` + `deco_dream_front.webp` + `deco_dream_blink.webp` (evento secundário real de bater de asas);
     - Profile Frame `dream-sanctuary` (*Bosque Onírico*): `frame_dream_{tl,tr,br}.webp`;
     - Profile Effect `dream-butterflies` (*Revoada Onírica*): narrativa de 4 atos com animação 60fps real de bater de asas alternando `fx_dream_butterfly.webp` e `fx_dream_wing_closed.webp`;
     - Nameplate `dream-mist` (*Bruma Onírica*).
  2. **Templo do Trovão (`synth` / Raijin):**
     - Avatar Decoration `electric-pulse` (*Espírito Raijin*): `deco_storm_back.webp` (tamborins Tomoe em órbita) + `deco_storm_front.webp` (mascotes Raiju) + `deco_storm_blink.webp` (piscar elétrico);
     - Profile Frame `neon-pulse` (*Templo do Trovão*): `frame_storm_{tl,tr,br}.webp`;
     - Profile Effect `synth-overdrive` (*Fúria de Raijin*): narrativa de 4 atos com relâmpagos `fx_storm_bolt.webp` e orbes `fx_storm_orb.webp`;
     - Nameplate `circuit-weave` (*Corrente de Raijin*).
  3. **Horizonte Arcade (`retro` / 16-Bit Pixel-Bot):**
     - Avatar Decoration `cyber-ring` (*Companheiro Pixel-Bot*): `deco_arcade_back.webp` + `deco_arcade_front.webp` + `deco_arcade_blink.webp` (piscada CRT `^ ω -`);
     - Profile Frame `eclipse-crown` (*Gabinete Arcade*): `frame_arcade_{tl,tr,br}.webp`;
     - Profile Effect `eclipse-flare` (*Overdrive Arcade*): narrativa de 4 atos com `fx_arcade_star.webp` e corações 16-bit `fx_arcade_heart.webp`.
  4. **Lagoa de Jade (`royal` / Imperial Koi & Lotus):**
     - Avatar Decoration `core-orbit` (*Koi de Jade & Ouro*): `deco_jade_back.webp` + `deco_jade_front.webp` (duas carpas imperiais nadando em órbita Yin-Yang contínua ao redor do avatar);
     - Profile Frame `core-pulse` (*Lagoa de Jade*): `frame_jade_{tl,tr,br}.webp`;
     - Profile Effect `core-signal` (*Dança dos Koi*): narrativa de 4 atos com carpas `fx_jade_koi.webp`, flores de lótus `fx_jade_lotus.webp` e ondas na água;
     - Nameplate `gold-leaf` (*Lótus de Jade & Ouro*).
  5. **Upgrades visuais em coleções existentes:**
     - Adicionados overlays secundários `deco_frost_blink.webp` (`frost-crown`) e `deco_infernal_blink.webp` (`dragon-fire`), além de regra CSS universal `.cos-v5-blink-img` para todas as decorações V5 com camada de evento secundário;
     - Molduras exclusivas `founder` (`frame_founder_{tl,tr,br}.webp`) e `developer` (`frame_dev_{tl,tr,br}.webp`) agora possuem ornamentos WebP dedicados de 3 cantos.
- **Subeditor de Avatar com Avatares Predefinidos + Envio de Imagem (`data-pe-view="avatar"`):**
  - Ao clicar no card **Avatar** (`#settings-change-avatar-btn`) ou no avatar do cartão de prévia ao vivo (`#preview-card-avatar`), o editor abre o subeditor lateral **Avatar do perfil** (`data-pe-view="avatar"`) em vez de acionar o seletor de arquivos diretamente.
  - O subeditor oferece **12 avatares predefinidos ilustrados do Sanvo** (`SANVO_PRESET_AVATARS`, gerados via `scripts/generate-preset-avatars.mjs` em `static/cosmetics/assets/preset_avatar_*.webp` e embutidos em `src/bin/desktop_assets.rs`, totalizando 110 assets WebP embutidos), além da opção **Iniciais**, do botão **Enviar uma imagem** (`#pe-upload-avatar-btn` para PNG, JPG, WebP ou GIF com editor de recorte/zoom) e de **Reposicionar e zoom** (`#pe-avatar-reposition`). Também disponível no diálogo de Perfil por Servidor (`openServerProfileDialog`).
- **Validação e Deploy Local:** `285/285` testes de frontend (`npm.cmd test`), `224/224` testes em Rust (`cargo test --locked --all-targets`), verificação visual HiDPI 150% em Chromium e atualização local de `Sanvo.exe` / `SanvoServer.exe` mantendo `cloudflared.exe` ativo.
