# Retomada do Sancord — 17/11/2026

**Estado mais recente:** a Fase 4 foi implementada nos fontes e validada em ambiente
isolado. [FASE4.md](FASE4.md) registra a correção de hierarquia, permissões por canal,
canais privados, os 70 testes e as limitações. O restante deste arquivo preserva o histórico da Fase 3.

Atualização após conferir o prompt original completo: [ROADMAP.md](ROADMAP.md)
mapeia as nove fases e registra uma escalada de privilégio reproduzida no ambiente
isolado. A próxima prioridade passa a ser a segurança de cargos da Fase 4.

## Estado encontrado

- Não existe `.git` em `D:\Sancord` nem nos diretórios pais consultados. `git status`,
  `git diff`, `git diff --stat` e `git log --oneline -15` não fornecem histórico nesta cópia.
- O relato anexado do Claude e as datas dos arquivos apontam para a Fase 3 do chat.
  Os últimos arquivos alterados eram `styles.css`, `chat.js`, `index.html`, `ws.rs` e `state.rs`.
- Arquitetura mantida: Axum/Tokio, HTTP/WS, SQLite/rusqlite com escritor dedicado,
  HTML/CSS/JS sem bundler, desktop Windows wry/tao/WebView2 e WebRTC P2P.
- Implementações reais encontradas: autenticação e sessões; servidores, convites, canais,
  categorias, cargos e moderação; amigos e DMs; chat, uploads, leitura e paginação.
  A presença de implementação não equivale a validar todos esses fluxos manualmente.
- A busca por TODO/FIXME/HACK/todo!/unimplemented! não revelou uma etapa interrompida.
  O ponto mais preciso de retomada era a validação final do chat descrita pelo Claude.
- Na inspeção inicial não havia listeners nas portas 3000/3100. Não se confirmou a antiga
  instância da Fase 2 mencionada no relato; nenhum servidor preexistente foi encerrado.

## Alterações desta retomada

- `static/js/chat.js`: preserva edição inline (texto, seleção, foco) em atualizações realtime
  e reconstruções da lista; encerra a edição anterior ao editar outra mensagem.
- `static/app.js`: encaminha atualizações para o helper que preserva o editor e mantém o
  agrupamento. Eventos de mensagens fora da janela não recriam desnecessariamente a lista.
- Leitura: falha de envio do `AckChannel` não apaga o estado local. DMs usam a mesma contagem
  dos estados de leitura; o Welcome limpa badges antigos. Abrir a DM não a marca como lida
  antes da verificação de foco/posição.
- Composer: sair da conversa cancela o envio automático aguardando uploads. Callbacks de
  uploads removidos são ignorados; erros de rede/remover arquivos cancelam esse envio.
  Os rascunhos/anexos continuam compartilhados pelo composer, sem armazenamento por canal.
- Histórico realtime: aplica o limite existente de 300 mensagens também às mensagens novas;
  preserva a janela de quem lê longe do fim e oferece carregamento das mensagens seguintes.
- Salto para mensagens: posicionamento imediato evita paginação durante uma animação.
  Imagens com dimensões reservadas não forçam rolagem no carregamento; imagens legadas
  também respeitam a janela histórica e a distância do fim.
- Visual e CSS existentes preservados, incluindo o último ajuste do Claude que esconde
  a barra de ações durante a edição.

## Verificação realizada

- `cargo check --locked --all-targets --target-dir target-dev`: passou.
- `cargo build --locked --bin sancord --target-dir target-dev`: passou.
- `cargo test --locked --lib --target-dir target-dev`: 47 testes passaram.
- `cargo test --locked --bin SancordApp --target-dir target-dev`: 2 testes passaram.
- `node --test tests/frontend-chat.test.cjs`: 11 testes passaram.
- `node --check` nos quatro arquivos JS: passou.
- Frontend servido diretamente pelo backend; não há build npm separado.
- Navegador com servidor real isolado em `127.0.0.1:3100`, banco em `qa-phase3/data`:
  envio/edição; reação recebida por outro cliente WS durante edição (rascunho/seleção/foco
  preservados); ações ocultas durante edição; upload de `logo.png` e `README.md` reais do
  disco; renderização/ampliação da imagem; menção e DM com badges; leitura automática com
  ack e resposta do servidor; salto para uma mensagem ausente das 50 iniciais e volta ao presente.
- Histórico de QA gerado via WS real, respeitando o limite de envio. Após recarregar, a página
  inicial tinha 50 mensagens e começava em “Histórico QA 17”; clicar na resposta carregou a
  janela com “Histórico QA 1”, cuja posição dentro da área visível foi verificada novamente.
- Evidência visual: `qa-phase3/historico-validado.jpg`.
- A instância de QA usa dados artificiais isolados. Nenhuma funcionalidade de produto foi
  substituída por mocks. As unidades JS usam DOM/rede mínimos simulados; não substituem o teste visual.

## Preservação e continuidade

- Fontes anteriores às edições desta sessão copiados para `qa-phase3/baseline/`
  (`app.js`, `chat.js`, `README.md`), pois não há Git.
- Banco principal `data/sancord.db`, backups anteriores, executáveis distribuídos e scripts
  de produção preservados. O build usa `target-dev`, sem substituir `target/debug/sancord.exe`.
- O servidor isolado desta sessão foi encerrado após os testes; os dados de QA foram preservados.
- Não houve publicação nem atualização do servidor de produção. Antes de publicar, é preciso
  preparar backup consistente do SQLite e usar backend/frontend da mesma fase.
- Próxima pendência técnica da Fase 3: ciclo de vida dos uploads abandonados (não apagar
  anexos referenciados nem uploads recentes/em andamento). Prévias de links exigem projeto de
  proteção SSRF/proxy; emojis próprios permanecem ausentes. Não iniciar essas tarefas supondo
  que cargos, permissões ou os demais recursos já encontrados precisem ser recriados.
- Limites desta validação: não houve teste manual de voz/vídeo/tela entre máquinas, migração
  sobre cópia do banco principal, teste de carga nem reinstalação/distribuição do desktop.
