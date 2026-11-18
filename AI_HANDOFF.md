# Handoff — Sancord

## Preservação do projeto

Projeto existente em Rust, Wry/Tao/WebView2, Axum/Tokio, WebSocket e SQLite.
Não migrar a stack ou recriar a interface. Fases 5/6 e a revisão anterior continuam
nos fontes; veja `FASE5.md` e `FASE6.md`. A fase 6 ainda precisa de validação de mídia
real entre máquinas. Não migrar o banco principal para testar releases.

## Distribuição e updater

- Git inicializado localmente; origin: `https://github.com/gabrielsanderx/Sancord.git`.
  A consulta ao remoto público encontrou repositório vazio. Verificar novamente antes
  do primeiro push. Não usar force-push. Publicação depende da autorização do usuário.
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
- `cargo test --locked --all-targets`: 77 testes do núcleo e 6 do desktop passaram.
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
  [CI Windows/MSVC completo aprovado](https://github.com/gabrielsanderx/Sancord/actions/runs/44208760294).
  O workflow de distribuição também foi iniciado manualmente, sem publicação:
  [ensaio de empacotamento](https://github.com/gabrielsanderx/Sancord/actions/runs/44208930903).
- O cadastro do Secret foi confirmado por consulta de metadados, sem ler seu valor.
  O ensaio manual agora testa também a assinatura em job separado da publicação.
  Confirmar o sucesso da assinatura antes da primeira tag. Não publicar uma versão
  experimental das fases atuais apenas para demonstrar o updater.
- Há uma chave pública única; rotação automática de chaves não foi implementada.
  Não afirmar que basta trocar a pública para os clientes antigos aceitarem outra chave.
