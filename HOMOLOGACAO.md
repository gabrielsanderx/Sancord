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
