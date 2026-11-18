# Fase 8 — recursos avançados

Iniciada em 18/11/2026, depois de conferir o estado deixado pelas Fases 6 e 7 (ver
`FASE6.md`, `FASE7.md` e `AI_HANDOFF.md`). Nada foi publicado; o banco principal e os
executáveis distribuídos não foram alterados.

## Conferência antes de começar

- Build e suítes: 78 testes do núcleo, 7 do desktop e 57 do frontend passaram, igual ao
  relatado.
- Fase 7 no código: câmera com escolha de dispositivo e qualidade, tela com seletor nativo,
  grade, destaque e tela cheia, cancelamento de capturas tardias e testes de sinalização.
- Lacuna encontrada e corrigida: a seção 33 pede chamada de **vídeo** em DM e grupo. Foi
  adicionado o botão **Vídeo** no cabeçalho da DM/grupo; ele entra na chamada e liga a câmera.
- Continuam pendentes da 6/7, sem mudança: webcam física, redes diferentes com TURN real e
  carga com mais participantes.
- As alterações da continuação das Fases 6/7 (depois do commit `5e43107`) e as desta fase
  ainda **não foram commitadas**. Não há `git.exe` acessível nesta máquina para o agente.

## Implementado nesta etapa

### Registro de auditoria (persistido)
- Tabela `audit_log` (schema v7) e a permissão nova **Ver registro de auditoria**
  (`view_audit_log`). Administradores e o dono já têm essa permissão.
- Ações registradas no servidor:
  - membros: expulsar, banir, desbanir e alterar cargos;
  - cargos: criar, editar, excluir e reordenar;
  - canais e categorias: criar, editar, excluir e mudar permissões;
  - convites: criar e revogar;
  - servidor: editar;
  - mensagens de outra pessoa: excluir, fixar e desafixar;
  - voz: silenciar, ensurdecer, mover e desconectar;
  - AutoMod: alterar a configuração e cada bloqueio.
- Nas configurações do servidor, a aba **Registro de auditoria** traz filtro por ação,
  paginação e as datas.

### AutoMod (aplicado no servidor)
- Regras por servidor, persistidas em `automod_config`:
  - palavras proibidas, sem acento e sem diferenciar maiúsculas; `palavra*` pega prefixos;
  - bloqueio de links com domínios liberados;
  - bloqueio de convites (`SANC-…`, `sancord://`);
  - limite de menções;
  - mensagem repetida 3 vezes em 30 s.
- Vale para enviar **e editar**. A mensagem barrada não é gravada nem distribuída, e quem
  enviou recebe o motivo.
- Isentos: dono, administradores, quem gerencia o servidor ou as mensagens, e os cargos
  marcados como isentos. DMs não passam pelo AutoMod.
- Canal de alertas opcional: a moderação recebe "mensagem de X bloqueada em #canal".
- Só quem tem **Gerenciar servidor** vê e altera as regras. Elas ficam na aba **AutoMod**
  das configurações do servidor.

### Busca no histórico completo
- Índice FTS5 (`messages_fts`) mantido por gatilhos:
  - não diferencia acento nem maiúsculas e busca por prefixo;
  - o histórico existente é indexado na migração;
  - editar ou excluir uma mensagem atualiza o índice.
- O servidor só busca nos canais que a pessoa pode ler, e revalida o acesso no resultado.
  Pedir um canal privado não devolve nada.
- Filtros digitados na caixa **Buscar** (Enter):
  - `de:nome`
  - `tem:link|arquivo|imagem`
  - `fixadas`
  - `antes:AAAA-MM-DD` e `depois:AAAA-MM-DD`
  - `menciona:eu`
- Escopo: o servidor ou a conversa aberta, ou "Em tudo".
- O painel mostra os 25 resultados mais recentes. Clicar num resultado leva até a mensagem.
- O texto digitado nunca vira sintaxe FTS: só letras e números entram, cada termo entre aspas.

### Correções encontradas no caminho
- **Corrida de leitura:** histórico e fixadas eram lidos do banco sem esperar a fila de
  escrita, e uma mensagem recém-fixada podia não aparecer. Agora a leitura espera a fila,
  como a busca e a auditoria já fazem.
- **Salto a partir da tela inicial:** `jumpToMessage` achava que já estava no canal e não
  saía da home. Corrigido em `static/js/chat.js`.

### Enquetes (18/11/2026)
- A enquete vai dentro da própria mensagem (`ChatMessage.poll`), então fica salva com ela e
  é encontrada pela busca.
- Regras:
  - de 2 a 10 opções, sem opções repetidas;
  - voto único ou múltiplo;
  - prazo de 1 h a 7 dias, ou sem prazo.
- Votar troca o voto anterior; lista vazia retira o voto.
- Só o autor ou quem gerencia mensagens encerra a enquete. Depois de encerrada ou vencida, o
  servidor recusa novos votos.
- O AutoMod confere a pergunta **e** as opções.
- Interface:
  - botão 📊 no composer abre o diálogo;
  - o cartão mostra barras, porcentagens e o ✓ no meu voto;
  - passar o mouse numa opção mostra quem votou;
  - o cartão mostra o tempo restante e o botão Encerrar.

### Eventos do servidor (18/11/2026)
- Tabela `server_events` (schema **v8**).
- Cada evento tem título, descrição, canal (voz ou texto) ou local livre, início e fim
  opcional, e a lista de interessados.
- Regras:
  - quem gerencia o servidor ou os canais cria eventos;
  - o próprio autor ou a gestão editam e excluem;
  - o evento precisa começar no futuro (até 1 ano);
  - o fim precisa ser depois do início;
  - até 100 eventos por servidor.
- Todos os membros recebem a lista atualizada a cada mudança. Se o evento for num canal que
  a pessoa não vê, o canal fica oculto para ela.
- Criar, editar e excluir eventos entram na auditoria.
- Interface:
  - botão **Eventos** no topo da lista de canais, com o número de eventos próximos;
  - janela com os cartões, "Acontecendo agora", Tenho interesse, Entrar na call (quando é
    num canal de voz e está ao vivo), Editar e Excluir.

### Threads e fóruns (18/11/2026)
- **Thread:** conversa filha de um canal de texto, que pode nascer de uma mensagem ("Criar
  thread" no menu da mensagem).
  - As mensagens usam o id da thread (`thr-…`) como canal, e as **permissões são as do
    canal-pai**.
  - Por isso histórico, menções, não lidas, digitando, fixadas, AutoMod e busca valem
    também nas threads.
  - Thread de canal privado não aparece para quem não vê o canal.
- **Fórum:** novo tipo de canal (`forum`), em que cada postagem é uma thread.
  - Não é possível escrever direto no fórum.
  - "Nova postagem" pede título e mensagem.
  - A visão do fórum lista as postagens (ativas primeiro, mais recentes primeiro), com filtro.
- **Gerenciar uma thread:**
  - renomear ou arquivar: quem criou ou a moderação;
  - trancar: só a moderação (trancada, só a moderação escreve);
  - nova mensagem desarquiva a thread, se ela não estiver trancada;
  - excluir: quem criou ou a moderação, e o histórico vai junto;
  - excluir o canal-pai exclui as threads dele.
- Ações de moderação em threads entram na auditoria.
- Persistência na tabela `threads` (schema **v9**); as mensagens continuam em `messages`.
- Interface:
  - threads ativas aninhadas sob o canal (até 5), com não lidas e menu de botão direito;
  - link "🧵 nome • N mensagens" sob a mensagem que originou a thread;
  - cabeçalho "← Thread em #canal", que volta ao canal;
  - composer bloqueado quando a thread está trancada.

## Pendente na Fase 8
- Nada das funcionalidades. Os limites estão na seção abaixo.

## Parcial / limites
- **Threads:**
  - não há threads privadas (por convite);
  - não existem tags nem ordenação configurável no fórum;
  - não há arquivamento automático por inatividade;
  - o dono da thread é guardado pelo nome de usuário, e renomear a conta não atualiza isso.
- A busca devolve os 25 resultados mais recentes, sem página seguinte; o caminho é refinar
  os filtros.
- O AutoMod bloqueia a mensagem, mas não aplica castigo temporário (timeout), que ainda não
  existe no projeto.
- A auditoria guarda nomes de usuário: renomear uma conta não reescreve o histórico antigo.

## Testado
- `cargo test --all-targets`: **87 testes do núcleo** e 7 do desktop, todos passando.
  - Inclui threads (herança de permissão, atividade, arquivar, trancar, canal privado, exclusão
    em cascata) e fórum (sem mensagem direta, postagem, busca, persistência, exclusão).
  - 7 são da Fase 8, em `src/phase8_tests.rs`: auditoria, AutoMod, busca, normalização,
    enquetes (validação, voto, troca, encerramento, persistência), AutoMod em enquete e
    eventos (permissões, interesse, persistência, auditoria).
- `node --test tests/frontend-*.test.cjs`: **68 testes**, todos passando.
  - 8 novos: `frontend-advanced` e `frontend-community`.
- 18/11, enquetes e eventos: instância 3100 com cópia nova dos dados reais.
  - A migração foi até a **v8**.
  - **Conferido na tela, com capturas:** criar a enquete pelo diálogo, votar (✓, barra e
    100%), criar o evento pelo diálogo, contador "1" no botão Eventos, alternar o
    interesse e o cartão do evento. Nenhum erro no console.
- Instância isolada `127.0.0.1:3100` com cópia dos dados reais:
  - a migração v4 → v7 rodou e as mensagens antigas foram indexadas;
  - contas e mensagens de QA vieram de `qa-phase8/seed.mjs`;
  - pela interface, com um cliente WebSocket real (`qa-phase8/member-try.mjs`) fazendo o
    papel do membro, conferi: configurar o AutoMod, bloqueios, avisos no canal de alertas,
    a aba de auditoria com filtro, a busca com `de:` e `tem:link`, e o clique no resultado.
  - Nenhum erro no console.
- O painel do navegador estava oculto: a interface foi conduzida por script, **sem
  conferência visual por captura de tela**.
- 18/11, threads e fóruns: instância 3100 com cópia nova dos dados reais (migração até a **v9**).
  - **Conferido na tela, com capturas:** criar a thread pelo menu da mensagem, a thread
    aninhada na árvore, enviar mensagem nela e o link "🧵" sob a mensagem original.
  - Também: criar o fórum, a visão de postagens, a "Nova postagem" com a primeira mensagem,
    voltar a um canal comum (o fórum fecha) e, depois de recarregar, threads e mensagens
    preservadas.
  - Nenhum erro no console.