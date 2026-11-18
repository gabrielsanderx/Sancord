# Fase 7 — câmera e compartilhamento de tela

Continuação em 17/11/2026. O usuário autorizou iniciar esta fase mantendo as
pendências de redes/TURN e demais ensaios da fase 6 registrados em `FASE6.md`.
Não declarar a fase 6 encerrada por causa desse avanço.

## Implementação encontrada e preservada

- Cliente Windows Wry/Tao/WebView2 com interface embutida; backend sem site público.
- Câmera por `getUserMedia`, tela pelo seletor próprio de janelas/monitores e ponte
  Rust autenticada em loopback. Há fallback `getDisplayMedia` dentro do WebView2.
- Captura nativa GDI/PrintWindow, quadros I420, áudio WASAPI e geradores de tracks
  no cliente. Mantidos a ponte, o seletor e os controles atuais.
- Transporte WebRTC P2P mesh; backend autoriza participação, sinalização e permissão
  `stream_video`. A ponte local não é o servidor de mídia entre participantes.
- Grade de participantes, câmera/tela simultâneas, destaque, tela cheia, áudio da
  transmissão e opções existentes de resolução/FPS de tela.

## Alterações desta continuação

- Entrada assíncrona de câmera/tela vinculada ao canal e pedido de captura. Sair,
  trocar de canal, ser movido por moderação ou cancelar invalida o pedido. Capturas
  tardias têm suas tracks paradas e não são publicadas no canal novo.
- Segundo clique durante abertura da câmera cancela o pedido; callbacks de uma
  captura anterior não encerram a substituta.
- Parar a transmissão limpa geradores, writers, listeners, tracks e senders. Essa
  limpeza funciona mesmo antes de existir stream publicado. Mudanças de estado
  locais são aplicadas antes dos awaits da renegociação.
- Perda da ponte nativa interrompe a transmissão e informa o usuário. A conexão
  inicial tem timeout e compartilha um único pedido entre listagem e transmissão.
- Cabeçalhos, dimensões e tamanho dos pacotes locais são verificados antes do
  encoder; fila de áudio limitada a oito blocos. Frames/AudioData são liberados.
- Vídeo encerrado não permanece como tela por uma classificação de fallback de
  streams antigos. Câmera e tela seguem os identificadores e flags do servidor.
- Configurações **Voz e vídeo** permitem selecionar webcam e qualidade desejada
  (480p/720p/1080p, 30 FPS). Preferências persistem no armazenamento do perfil e
  são aplicadas ao ligar a câmera novamente. Não se inicia câmera ao abrir ajustes.
- Se a webcam escolhida estiver indisponível, a preferência é preservada e há erro
  ao tentar usá-la, sem abrir silenciosamente outro dispositivo.
- Erros de câmera/tela usam notificações da interface; nenhum redesenho da aplicação.

## Evidências

- `cargo check --locked --all-targets --target-dir target-review-phase6`: passou.
- `cargo test --locked --all-targets --target-dir target-review-phase6`:
  **78 testes do núcleo + 7 desktop**, aprovados. Após as últimas alterações da
  interface embutida, os sete testes do desktop foram executados novamente.
- `node --test tests/frontend-*.test.cjs`: **57 testes aprovados**, incluindo
  **18 testes de vídeo** em `tests/frontend-video.test.cjs`.
- `src/phase7_tests.rs`: servidor e dois clientes WebSocket reais comprovam câmera
  e tela simultâneas nos metadados, entrega de SDP e revogação de permissão durante
  publicação. O remetente é desconectado e pode voltar sem autorização para enviar
  vídeo; SDP de envio é bloqueado e SDP somente de recepção é entregue.
- JavaScript sem erros de sintaxe; diff sem erros de whitespace.
- Build local de `sancord` e `SancordApp` passou; preparação dos dois perfis de QA
  passou. Dados/banco principal e executáveis distribuídos não foram substituídos.
- O usuário iniciou o QA manualmente e relatou: **"A tela funciona; não tenho
  câmera para testar"**. Compartilhamento local tem esse relato; câmera física
  continua sem validação. Não houve captura de câmera/tela iniciada pelo agente.

Os testes JavaScript simulam APIs de mídia somente no ambiente de testes. Não
substituem codecs, dispositivos ou transmissão real. O teste Rust comprova controle
e sinalização, sem gerar vídeo fictício para representar o recurso como concluído.

## Roteiro e pendências antes da conclusão

Reutilizar `scripts/voice-qa.ps1` conforme `FASE6.md`: duas janelas, contas VozQA_A/B,
backend `127.0.0.1:3106`, perfis e dados em `qa-voice-local-3106/`, updater desativado.
Iniciar capturas e decidir permissões manualmente.

1. Com webcam física, escolher dispositivo e qualidade; A liga e B assiste. Testar
   ligar/desligar, negar permissão, dispositivo ocupado/removido e dois vídeos.
2. Confirmar individualmente câmera + tela simultâneas, parar/retomar, saída/troca
   de canal e movimento por moderador. O relato de tela não comprova todo o roteiro.
3. Testar janelas distintas, múltiplos monitores, fechamento/minimização da fonte,
   áudio do sistema e exclusão do retorno da chamada. Áudio de sistema é loopback;
   não prometer áudio isolado exclusivamente do aplicativo selecionado.
4. Verificar tela cheia, destaque e qualidade efetivamente recebida, com carga real.
   Resolução/FPS configurados são metas; 4K/60 não foi medido ou garantido.
5. Validar redes diferentes e TURN real, perda/retomada de conexão e grupos maiores.
   P2P mesh aumenta upload/CPU por participante; não foi acrescentado SFU.

Esta etapa permanece em validação. Nenhuma tag/release foi publicada e nenhuma
captura foi gravada. Não converter o relato local em garantia de produção.
