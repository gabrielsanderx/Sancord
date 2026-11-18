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
