# Fase 6 — voz: auditoria e correções

Revisão em 17/11/2026, após as alterações recentes do Claude. A fase 6 já estava
em desenvolvimento; esta revisão preservou sua implementação e o visual existente.
Não houve publicação nem alteração do banco principal nesta revisão.

## Estado encontrado na primeira revisão (histórico)

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

## Correções feitas na primeira revisão

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

## Validação da primeira revisão

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

## Continuação em 17/11/2026 — ciclo de vida do áudio

Após a implementação de GitHub e updater, o projeto possui Git e remoto público.
As referências acima a ausência de Git e pacotes antigos descrevem a primeira revisão.
Nenhuma nova tag/release ou migração do banco principal foi feita nesta continuação.

- Pedidos concorrentes compartilham a abertura do microfone. Sair ou escolher outro
  canal invalida entradas pendentes; a captura que chega depois da saída é parada.
- Falha no envio pelo WebSocket deixa a nova chamada desconectada e libera a captura.
- Ofertas/respostas e tracks atrasados conferem a participação e a conexão atual.
- Fechar um participante desconecta os nós de áudio e remove callbacks antigos,
  além de pausar e desanexar o elemento de áudio.
- Recusar permissão não repete o pedido e informa que só é possível ouvir a chamada.
  O contexto silencioso de fallback é fechado ao liberar a captura.
- Encerrar o teste do microfone ou fechar as configurações libera a captura fora de
  uma chamada. Fechar durante o pedido não reativa o teste posteriormente.
- `tests/frontend-voice-lifecycle.test.cjs` cobre dez regressões de ciclo de vida.

Validação automatizada: `cargo check --locked --all-targets` passou; **77 testes
do núcleo, 7 do desktop e 39 JavaScript passaram**, usando `target-review-phase6`.
A sintaxe de JavaScript e scripts PowerShell foi verificada. O build dos dois
executáveis passou também pela preparação no Windows PowerShell 5.1.

## Ensaio local com duas instâncias

O usuário escolheu duas instâncias neste computador. Execute no PowerShell:

```powershell
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File "D:\Sancord\scripts\voice-qa.ps1"
```

`RemoteSigned` aplica-se apenas ao processo iniciado, sem alteração persistente da
política do Windows. A preparação sem iniciar nada usa `-PrepareOnly`.

O script compila backend/cliente, cria dados em `qa-voice-local-3106/`, escuta somente
em `127.0.0.1:3106` e abre janelas A/B com perfis WebView2 separados. Descoberta,
registro de protocolo, host automático e updater ficam desativados nesse ensaio.
`scripts/seed-voice-qa.mjs` usa HTTP/WS reais para preparar contas, amizade e servidor;
não aceita a porta de produção. Não inicia uma chamada nem captura áudio.

1. Entrar na A como `VozQA_A` e na B como `VozQA_B`, com a senha de QA impressa no
   terminal (também no arquivo local ignorado `credentials.json`).
2. Abrir **Voz QA local → Call Privada** nas duas. O próprio usuário decide a
   permissão do microfone. Usar fones e apenas um microfone aberto por vez.
3. Verificar A → B, depois B → A; mute/deafen, volume local e saída/retorno à voz.
4. Testar chamada privada entre as contas, aceitação/recusa e finalização.
5. Sair durante a captura pendente e verificar que não entra novamente sozinho.
6. Para encerrar somente estes processos, usar o mesmo comando com `-Stop`.
   O script confere PID, caminho e horário de criação; os dados ficam preservados.

A revisão automática bloqueou a inicialização pelo agente ("blocked by policy");
o usuário executou o script manualmente e confirmou duas janelas abertas. Os logs
confirmam criação de contas, login e entrada dos dois clientes no mesmo canal.
A inspeção da interface também confirmou os dois participantes; o usuário relatou
"Deu certo tudo funcionando" no ensaio local. Não houve medição independente do áudio
nem validação individual de todos os itens do roteiro. Redes diferentes, NAT/TURN,
dispositivos distintos, retomada de rede e moderação durante transmissão ainda
precisam de ensaios específicos antes de encerrar a fase 6.
