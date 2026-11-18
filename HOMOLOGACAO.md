# Próxima etapa — homologação desktop e versão candidata

Esta etapa começa após a implementação da fase 9. Uma fase implementada não equivale
a uma release estável validada. O escopo de idioma confirmado pelo usuário é pt-BR;
inglês segue preview, conforme o prompt original.

## Preparação automatizada

```powershell
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File "D:\Sancord\scripts\homologate.ps1" -PrepareOnly
```

Executa check, testes Rust, testes/sintaxe JavaScript e build dos executáveis.
Não abre janela ou captura mídia. Usa o target existente e o isolamento do QA de voz.

Para iniciar o ensaio, executar sem `-PrepareOnly`. Backend loopback na porta 3110,
banco novo em `qa-voice-local-3110/data`, perfis A/B separados, contas VozQA_A/B e
senha impressa no terminal. Updater, descoberta pública e registro de protocolo ficam
desativados. Para parar apenas esses processos, usar `-Stop`. A política RemoteSigned
vale para esse processo PowerShell, sem alteração persistente.

## Conferência no executável

1. Login nas duas instâncias; janela em 940×600 e maior. Confirmar leitura do chat,
   barra de servidores/canais e painel de membros sem sobreposição.
2. Tema Claro e Escuro: Voz e vídeo, edição/personalização de perfil, seletor de tela,
   convites e novo painel de integrações. Comparar Ash e OLED sem apagar preferências.
   A aba de voz não deve iniciar microfone sozinha.
3. Criar webhook/bot, copiar a credencial e enviar texto por HTTP. O outro cliente
   recebe a mensagem com o selo correto. Renovar e revogar; token antigo deve falhar.
4. Ctrl+K, atalhos, foco visível, reduzir animações e troca de idioma; nenhum conteúdo
   de usuário deve ser traduzido ou perdido ao mudar idioma.
5. Notificação nativa com o aplicativo fora de foco: conferir título/contador e piscar
   da janela. Os testes de formato/IPC não substituem esse ensaio do Windows.
6. Mídia: tela/janela com e sem áudio, câmera física quando disponível, reconexão,
   moderação, duas redes e TURN. Manter pendências de `FASE6.md`/`FASE7.md` até evidência.

## Antes de distribuir

- Registrar resultados observados e corrigir falhas. Não declarar teste físico sem
  equipamento ou capturar microfone/câmera/tela automaticamente.
- Testar migração de uma cópia consistente do banco v4 para v10, preservando contas,
  mensagens, permissões e anexos. Não usar o banco principal como ambiente de ensaio.
  Comando reutilizável: `scripts/test-migration.ps1`. Usa backup SQLite online do
  original em modo somente leitura; migra apenas pasta `qa-*` marcada e compara
  hashes/contagens das colunas antigas, além de `integrity_check`.
- Revisar diff completo, inclusive trabalho do Claude ainda sem commit; auditar
  segredos e dados antes de preparar commit/push. Não usar force-push.
  A inspeção sem alterar o índice Git usa `scripts/audit-git.ps1 -WorkingTree`.
- Validar o build Windows/MSVC dos fontes finais pelo CI, atualizar versão e changelog,
  e preparar o pacote assinado. O CI antigo não comprova estes fontes ainda locais.
- O ciclo público do updater exige duas releases assinadas e continua separado.
  Não publicar tags/release sem autorização. Procedimento em `DISTRIBUTION.md`.

## Critério de saída

Testes automatizados aprovados, revisão nativa registrada, migração da cópia aprovada,
build final Windows/MSVC e pacote assinado verificado. Pendências de mídia precisam
estar resolvidas ou constar explicitamente como limitações de uma versão experimental;
não promover experimento para todos os usuários como estável.

## Evidências desta preparação (18/11/2026)

- Check/build e **188 testes aprovados**: 91 núcleo, 8 desktop, 88 frontend e 1 da
  ferramenta de manutenção (recusa migrar `data/`).
- Migração real de uma cópia consistente **v4 → v10**, preservando por hash as 16
  tabelas originais e com integridade OK. A reexecução v10 → v10 preservou 30 tabelas.
  O original foi conferido em v4 após o ensaio. Anexos em disco não foram movidos.
- Cópia em `qa-migration-4895fdeafcf043dbbcb803b0d8c0a033/`, ignorada pelo Git;
  contém dados reais e não é um artefato a publicar. O comando de manutenção
  `sancord-release check-migration <pasta-qa>` exige pasta marcada no workspace.
- Usuário abriu o QA 3110 e conectou a janela A. A inspeção nativa encontrou bloqueio
  de integridade do Windows (app elevado em relação à ferramenta). Essa tentativa
  **não valida** o resultado visual. Foi solicitado reabrir o QA sem administrador.
- Permanecem os gates de revisão nativa, mídia, CI final e pacote/release descritos acima.
- O usuário preferiu conferência manual e confirmou: telas legíveis no Claro/Escuro,
  aba de voz sem iniciar microfone, criação de integração mostrando credencial e
  navegação Ctrl+K/teclado. Esse relato não substitui os outros itens do roteiro.
- Candidata local otimizada compilada e empacotada em
  `qa-candidate-20261118/Sancord-candidate-20261118.zip` (cliente portátil, backend,
  abertura isolada de QA, instruções e hashes). Só esses cinco arquivos entram no ZIP;
  nenhum banco, perfil, log ou credencial está incluído.
- O pacote ainda usa a versão de desenvolvimento 0.1.0 e não possui metadados de
  atualização assinados. Não é uma release estável. A abertura da build otimizada
  e seu ciclo de instalação/reinício não foram executados pelo agente.
- Auditoria final do working tree: 114 arquivos, sem padrões conhecidos de segredo.

## Preparação da versão 0.2.0

- Branch local `codex/prepare-0.2.0`, preservando a main existente e todo o trabalho
  posterior ao commit `5e43107`.
- Cargo.toml/Cargo.lock sincronizados em 0.2.0, com notas próprias no changelog.
  Versionar os fontes não publica uma versão nem atualiza clientes.
- A candidata 0.1.0 anterior continua como fotografia de QA. A versão 0.2.0 será
  validada com check, testes e empacotamento antes de solicitar envio da branch.
- O envio ao repositório público e o disparo manual do workflow exigem autorização.
  A execução manual em branch testa Windows/MSVC, empacotamento e assinatura com
  o Secret já configurado; o job de publicar é pulado porque não há tag.
- Não criar/push de tag, não mover main e não publicar release nessa validação.
- A versão 0.2.0 passou nos 188 testes e check de todos os targets. Pacote local
  otimizado gerado em `qa-candidate-0.2.0/package`, com notas próprias e ZIP contendo
  somente o cliente. Não assinado localmente; chaves privadas não foram lidas.
- `package-release.ps1 -OutputDir` mantém `dist` como default e foi exercitado também
  a partir de outra pasta. A main remota consultada permanecia em `5e43107`; a branch
  de preparação não existia no remoto durante a consulta.

## Resultado Windows/MSVC e assinatura — 18/11/2026

- Após autorização explícita do usuário, `c1941fd` foi enviado à branch pública
  `codex/prepare-0.2.0`; a main continua em `5e43107`.
- [Execução 44293761106](https://github.com/gabrielsanderx/Sancord/actions/runs/44293761106)
  concluiu com sucesso: check/testes Rust, 88 testes frontend, sintaxe, auditoria,
  build Windows/MSVC e assinatura do updater. O total permanece em **188 testes**.
  O job de publicação foi pulado: execução manual, sem tag ou release.
- Artefato baixado e verificado em `qa-candidate-0.2.0/github-signed/`:
  `Sancord-0.2.0-windows-x64.zip` contém somente o cliente. Ed25519, SHA-256,
  tamanho e igualdade entre o executável e o conteúdo do ZIP foram confirmados
  com ferramenta local confiável. Nenhum executável baixado foi iniciado.
- Hash do cliente: `04e85f569801a50daf6ccea3211a5de876caf49afd6cc27eeed907890860f4ed`;
  tamanho: 10.586.112 bytes. Assinatura do updater não equivale a Authenticode.
  Os executáveis existentes na raiz e em `dist` foram preservados.
- Esta evidência fecha os itens de CI final e pacote assinado para `c1941fd`.
  Permanecem: abertura da candidata MSVC, instalação/reinício e ciclo público do
  updater, notificações nativas, webcam física e testes entre redes/TURN. A revisão
  manual anterior cobre somente os itens que o usuário confirmou, listados acima.
- Estes registros são locais e posteriores ao commit validado; nenhuma nova
  autorização para mover main, criar tag ou publicar release está implícita.

## Ensaio offline de instalação e reinício

`scripts/test-signed-update.ps1` usa os dois pacotes reais assinados já coletados:
0.1.0 em `qa-updater/github-signed` e 0.2.0 em `qa-candidate-0.2.0/github-signed`.
A ferramenta local verifica Ed25519 e hash antes de qualquer abertura. A preparação
foi executada com sucesso, sem iniciar processos; `Status` confirmou a cópia 0.1.0,
os hashes dos executáveis anteriores e ausência de janela de teste. O backend de QA
3110 registrado foi conferido saudável. Sintaxe PowerShell validada.

O diretório descartável é `qa-candidate-0.2.0/install-qa/`: instalação e perfil próprios,
sem backend junto ao cliente e sem migração do banco principal. `Prepare` recusa
sobrescrever uma sessão. O script não encerra processos, não publica e não usa chaves
privadas. Atualizações automáticas ficam desativadas durante o ensaio.

Executar manualmente, em PowerShell normal:

```powershell
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File "D:\Sancord\scripts\test-signed-update.ps1" -Action Start
```

1. Entrar com `VozQA_A`, usando a senha de QA impressa no terminal. Confirmar que
   o cliente inicial abre e conecta, sem acionar captura de mídia.
2. No mesmo terminal executar o comando com `-Action Install`. Fechar **somente** a
   janela `Sancord - QA update 0.1.0 para 0.2.0` em até 60 segundos. O helper real da
   versão antiga aguardará esse processo encerrar, revalidará o pacote, substituirá
   somente a cópia de QA, guardará backup e tentará reabrir o cliente novo.
3. Executar com `-Action Status`. Conferir hash 0.2.0, backup íntegro 0.1.0, janela
   criada após a solicitação e hashes anteriores preservados. Confirmar visualmente
   a versão nova e se o login de QA foi mantido. Não declarar conclusão só pelo hash.

Esse ensaio prepara um job local com manifesto real assinado: cobre helper nativo,
espera, substituição, backup e reinício. **Não cobre** descoberta/download de uma
release pública, progresso pela UI ou acionamento de reinício pelo botão do updater.
Esses itens continuam no roteiro completo com duas releases reais.

Ainda não foram executados `Start`/`Install` pelo agente. A revisão automática anterior
bloqueou a abertura de aplicativos nativos sem informar uma razão detalhada; a etapa
interativa fica para o usuário, sem repetir o lançamento por outro mecanismo.

Na primeira tentativa do usuário, Start parou antes de abrir o cliente. Corrigida
compatibilidade da leitura do array JSON de processos com Windows PowerShell 5.1;
preflight real revalidado nesse runtime, com porta/PID registrados e health OK.
Após essa correção, o usuário abriu e conectou o cliente; o registro passou a `started`.

### Resultado: instalação e reinício locais aprovados

- Usuário executou Install, encerrou a janela inicial e confirmou: **“Reabriu e
  manteve o login”**. Isso é relato do usuário, sem automação de login pelo agente.
- Status após o ensaio: launcher **0.2.0 verificado**, um backup íntegro **0.1.0** e
  uma janela desse QA com início posterior à solicitação. O helper real fez a troca
  no diretório isolado e o cliente MSVC reiniciou. Hashes anteriores preservados.
- Evidência local em `qa-candidate-0.2.0/install-qa/validation.json`, ignorada pelo Git.
  O backend de QA continua na versão anterior; o updater altera somente o cliente.
- Estes resultados fecham abertura da candidata MSVC e instalação/reinício no
  ensaio offline. Detecção/download por GitHub, progresso e botão de reinício da UI
  permanecem pendentes, assim como notificações nativas, câmera física e redes/TURN.
  Nenhuma release, tag ou mudança na main foi publicada para este teste.

## Continuação automatizada do updater — 18/11/2026

- Usuário pediu execução direta dos comandos/testes pelo agente. Não solicitar que
  execute PowerShell para verificações que a ferramenta consegue fazer; intervenção
  continua restrita ao que realmente exigir credencial, equipamento ou autorização.
- Consulta HTTPS real ao GitHub feita com o código atualizado da ferramenta:
  nenhuma release publicada, resultado correto de nenhuma atualização disponível.
- **198 testes da suíte padrão aprovados**: 98 núcleo (incluindo 7 novos testes de
  rede TLS), 8 desktop, 1 manutenção e 91 frontend. Check all-targets, sintaxe JS e
  diff check aprovados. O teste dependente de artefato foi executado separadamente:
  **1 aprovado**, transferindo o EXE real 0.2.0 por TLS e verificando assinatura,
  SHA-256, tamanho e progresso com a chave pública embutida. Nenhum pacote executado
  nesta transferência. Total desta validação: **199 testes aprovados**.
- Servidor TLS usa porta efêmera de loopback e certificado temporário em memória.
  Somente funções privadas recebem a origem de teste; a API pública continua usando
  GitHub HTTPS. As dependências rcgen/rustls do servidor são dev-dependencies.
- Corrigido bug comprovado por dois testes inicialmente falhando: Depois ocultava
  também avisos de versões futuras e da verificação manual. Adiamento agora identifica
  versão/fase, e a consulta manual reapresenta o aviso sem download automático.
- O fluxo dos botões/progresso/reinício foi conferido nos testes JavaScript. A inspeção
  nativa encontrou a janela de produção, sem janela QA; não comprovou o clique em
  Verificar atualizações. A ferramenta relatou geometria indisponível e depois entrada
  concorrente do usuário, interrompendo a tentativa. Não atribuir sucesso de IPC nativo
  aos testes da interface isolada. Nenhuma configuração de conta ou captura alterada.
  Uma nova observação encontrou a janela minimizada; a consulta por botão não foi
  marcada como aprovada nem foi solicitada intervenção para esses comandos.
- Fontes novos/correção locais são posteriores a `c1941fd`: exigem novo CI/build
  MSVC/assinatura antes de distribuir. O artefato já assinado comprova esse commit
  anterior, não a correção nova. Sem novo push, tag ou release nesta continuação.
- O ciclo positivo pela release pública e pelos botões nativos continua pendente.
  Não publicar uma estável só para desbloquear esse teste. Pendências de mídia e
  notificações nativas permanecem registradas.

## Consolidação da candidata e novo gate de distribuição

O próximo passo após as nove fases originais consolida as correções já testadas na
branch `codex/prepare-0.2.0`. O workflow agora exige `verify-package` após `sign`:
Windows/MSVC baixa o artefato real e executa explicitamente seu ensaio HTTPS, com
chave pública embutida e sem Secret nesse job. `publish` depende de sua aprovação
e mantém a condição de tag. A execução manual continua sem publicação.

O novo ensaio precisa ser acompanhado até terminar. O resultado do CI anterior
comprova apenas `c1941fd`, não o commit desta consolidação.

### Resultado: CI da consolidação aprovado (`390aeee`)

- [Execução 44300424969](https://github.com/gabrielsanderx/Sancord/actions/runs/44300424969)
  concluiu no commit exato `390aeee`:
  - `tests`, `package`, `sign` e `verify-package` com sucesso;
  - `publish` pulado (sem tag).
  - O `verify-package` baixou o artefato assinado e executou o ensaio HTTPS do EXE real
    com a chave pública embutida.
- Artefato `signed-windows-release`: digest
  `sha256:a4c82d010f06882a3e8b5ffe015aa8d4a52fe9cc886da63e6dc07909d369161d`.
  Disponível até 25/11/2026.
- Remoto conferido: nenhuma tag e nenhuma release; `main` continua em `5e43107`.
- Os 198 testes da suíte padrão foram aprovados também localmente, no mesmo commit.
- **Coleta e verificação local do novo artefato: aprovadas.**
  - O usuário fez o login no `gh`. O token ficou só na memória do processo de coleta e não
    foi exibido.
  - Mesmas travas de `collect-final-020.mjs`: execução aprovada, commit exato, origem
    `api.github.com`, redirecionamento HTTPS e limite de 128 MiB.
  - ZIP baixado: 15.966.900 bytes, SHA-256 **igual** ao digest registrado pelo GitHub.
  - `sancord-release verify`, compilado dos fontes locais `390aeee`: **"Assinatura e
    integridade válidas."** Manifesto 0.2.0, `windows-x86_64`.
  - `Sancord-0.2.0-windows-x64.zip` contém **somente** `Sancord.exe`, idêntico ao
    executável solto e ao manifesto:
    - 10.588.160 bytes;
    - SHA-256 `7238e24c76736cc5f9fb9bbbb853c544a804ae9b4a6a8d9d1b142cf90657ea9a`.
  - O `SancordServer.exe` do artefato tem SHA-256
    `cd6542de1d7507cfbb703cfeef7d51963ce7408e9117e56664c94238ac6df5b1`. Ele não entra no
    ZIP de atualização.
  - O ensaio ignorado `https_downloads_real_ci_artifact_with_embedded_release_key` foi
    executado com esta pasta: **1 aprovado**.
  - Arquivos em `qa-candidate-0.2.0/final-390aeee/`, `final-390aeee.zip` e
    `final-390aeee-run.json`, todos ignorados pelo Git.
  - Nenhum executável baixado foi iniciado. Nenhuma branch, tag ou release foi alterada.
  - Esta candidata **substitui** a de `c1941fd` (hash `04e85f56…`) como a versão 0.2.0 a
    distribuir.
- **Pendente:**
  - **gates que dependem do usuário:**
    - notificações nativas;
    - câmera física, redes e TURN;
    - ciclo público do updater, que exige duas releases;
    - autorização para mover a `main` ou criar tag.
