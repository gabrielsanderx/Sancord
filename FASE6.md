# Fase 6 — voz: auditoria e correções

Revisão em 17/11/2026, após as alterações recentes do Claude. A fase 6 já estava
em desenvolvimento; esta revisão preservou sua implementação e o visual existente.
Não houve publicação nem alteração do banco principal nesta revisão.

## Estado encontrado

- Rust, Axum/Tokio, WebSocket e SQLite; cliente Windows Wry/Tao/WebView2 com
  interface compilada dentro do executável. O backend continua sem servir o site.
- A fase 5 acrescentou bloqueio e privacidade no servidor, solicitações de mensagem,
  grupos privados, campos de perfil, expiração de status e denúncias. Consulte
  [FASE5.md](FASE5.md) para recursos e pendências específicos.
- A fase 6 acrescentou `src/voice.rs`, `static/js/voice.js`,
  `src/phase6_tests.rs` e `tests/frontend-voice.test.cjs`.
- Entrar/sair da voz, mover/desconectar membros, silenciar/ensurdecer por servidor,
  hierarquia de moderação e limite de participantes possuem lógica real no backend.
- Chamadas privadas possuem eventos de início, recusa e fim, registro no chat e
  regras de privacidade. O cliente possui toque, temporizador de chamada sem resposta,
  volume/silêncio local por pessoa, retomada após reconexão e tentativa de reinício de ICE.
- STUN/TURN são configurados pelo backend e enviados no `Welcome`; isso não instala
  nem provisiona um serviço TURN. Variáveis: `SANCORD_STUN_URLS`, `SANCORD_TURN_URLS`,
  `SANCORD_TURN_USERNAME` e `SANCORD_TURN_CREDENTIAL`.
- O esquema dos fontes é v6. Leitura dos bancos existentes encontrou principal em v4,
  QA da fase 5 em v5 e QA da fase 6 em v6. Não os migrei ou substituí nesta revisão.
- Os executáveis na raiz e em `dist/` são anteriores às fases 5/6. A compilação desta
  revisão foi isolada em `target-review-phase6/`, sem atualizar esses pacotes.
- Não existe `.git` neste workspace. O estado recebido foi copiado para
  `qa-review-phase6/baseline/` antes das correções, permitindo comparar o diff.

## Correções feitas nesta revisão

1. **Retomada duplicada da voz:** `onConnectionReady` e o processamento de `Welcome`
   enviavam a mesma entrada. A retomada passou a ocorrer apenas depois de aplicar o
   estado e os servidores ICE recebidos no `Welcome`.
2. **Callback WebRTC antigo:** um evento `closed` de um peer substituído podia fechar
   a nova conexão da mesma pessoa. O callback agora confere se pertence ao peer atual.
3. **Troca de nome removia a moderação:** silêncio/surdez persistidos ficavam vinculados
   ao nome anterior. O handler agora move a entrada em memória e renomeia a referência
   SQLite pela fila de escrita existente, preservando as flags após reinício.

Os três casos tiveram testes novos que falharam antes e passaram após a correção.
Arquivos de implementação alterados: `static/app.js`, `src/ws.rs` e `src/db.rs`.
Não foram adicionadas novas funcionalidades de produto.

## Validação desta revisão

- `cargo check --locked --all-targets --target-dir target-review-phase6`: passou.
- `cargo test --locked --lib --bin SancordApp --target-dir target-review-phase6`:
  **67 testes do núcleo + 6 do desktop**, todos passaram.
- `node --test tests/frontend-*.test.cjs`: **27 testes**, todos passaram.
- Verificação de sintaxe dos arquivos JavaScript: passou.
- `cargo build --locked --bin sancord --bin SancordApp --target-dir target-review-phase6`:
  passou, sem iniciar o aplicativo.
- Os testes Rust de integração usam servidores e clientes WebSocket reais em portas
  temporárias, com dados isolados. Os testes JavaScript não comprovam mídia real.

## O que ainda precisa ser validado

A fase 6 não deve ser declarada concluída apenas por esses testes. Falta comprovar
áudio real entre dois clientes desktop, dispositivos de entrada/saída, redes diferentes,
NAT restritivo com TURN real, perda/retomada da rede, chamadas de grupo e moderação
durante transmissão. Não capturei microfone, câmera ou tela nesta revisão.

A arquitetura continua WebRTC P2P mesh: o servidor controla participação e sinalização,
e os receptores oficiais aplicam silêncio/surdez ao áudio. Isso não equivale a um servidor
de mídia que interrompe os pacotes de áudio na origem.

O próximo passo é validar esses fluxos no `.exe` de QA, mantendo os pacotes de
distribuição e os dados principais separados até a publicação planejada.
