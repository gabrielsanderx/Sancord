# Fase 5 — Social

Data: 17/11/2026. Ainda **não publicada em produção**: por decisão do usuário, as fases
serão concluídas e publicadas juntas. A produção (porta 3000) não foi alterada.

## Implementado

### Bloqueio (no servidor)
- `BlockUser` / `UnblockUser`. Bloquear desfaz amizade e pedidos pendentes nos dois sentidos
  e tira a conversa das solicitações de quem bloqueou.
- Quem foi bloqueado não consegue mandar DM, pedido de amizade nem ligar (`dmvoice:`).
  A mensagem de erro não revela o bloqueio. Quem bloqueou também não envia enquanto não desbloquear.
- `enforce_voice_access` derruba uma chamada 1:1 em andamento quando ocorre um bloqueio.
- Na lista lateral, as conversas com bloqueados somem; as mensagens deles ficam ocultas no chat.
  `state.blockedUsers` passou a vir do servidor e não mais do localStorage.
- Na tela de Amigos há a aba **Bloqueados**, com botão Desbloquear. A lista também aparece em
  Configurações → Dados e privacidade.

### Privacidade (no servidor)
- `UserPrefs.privacy`:
  - `dm_policy`: `everyone`, `requests` (padrão) ou `friends`.
  - `friend_requests`: `everyone` (padrão), `mutual` ou `none`.
  - Valores desconhecidos voltam ao padrão seguro.
- Gravada via `UpdateUserPrefs { privacy }` e aplicada em `SendChat` (`dm_delivery`) e `SendFriendRequest`.
- `mutual` aceita pedidos de amigos de amigos e de quem divide um servidor (o hub público não conta).
- Em Configurações, a opção local falsa "DMs só de amigos" foi trocada por dois seletores reais.

### Solicitações de mensagem
- Uma DM de quem não é amigo vira solicitação quando a política é `requests`.
  - Não notifica, não conta menção e não toca o som de menção.
  - Fica fora da lista de DMs, numa área própria: "Solicitações de mensagem" na barra lateral
    e a aba **Solicitações** em Amigos.
- Ações: Aceitar, Ignorar, Bloquear e Denunciar. Uma faixa aparece dentro da própria conversa.
- Responder a uma solicitação equivale a aceitar. Virar amigo converte a solicitação em DM normal.
- Ignorar oculta a conversa (`ignored_dms`). Novas mensagens dessa pessoa continuam sem
  notificar, até você mesmo abrir a conversa.

### Grupos privados (até 10 pessoas)
- Persistidos em tabelas próprias (`group_dms`, `group_dm_members`; schema v5). Canal de texto
  `gdm:<uuid>`, chamada `gdmvoice:<uuid>`.
- Criar só com amigos, sem bloqueio entre os membros.
- Renomear e trocar o ícone: o ícone é validado como imagem e recortado em 256 px no cliente.
- Adicionar amigos ao grupo.
- Só o dono remove membros.
- Sair do grupo: se o dono sai, a posse passa ao próximo membro. Quando o último membro sai,
  o grupo e o histórico são apagados.
- Mensagens de sistema registram criação, entrada, saída, remoção, nome e ícone.
- Chat, menções, não lidas, fixadas e reações reutilizam o fluxo de DM: `is_private_text`,
  `private_participants`.
- A chamada do grupo toca para os outros membros (`DmCallIncoming` com o id do grupo).
  Quem sai ou é removido perde o acesso à chamada.
- Interface:
  - O botão "+" de Mensagens diretas abre "Criar grupo" ou "Adicionar amigo".
  - O diálogo usa caixas de seleção (novo campo `checklist` no UI kit).
  - O grupo aparece na lista com ícone e não lidas, e tem menu de botão direito.
  - O cabeçalho mostra membros e quantos estão online.
  - O painel direito tem membros, dono 👑 e ações.

### Perfil
- Novos campos na conta: nome de exibição, pronomes, emoji do status e prazo do status
  (30 min a 7 dias, ou nunca). Todos ficam no editor de perfil.
- Uma tarefa no servidor limpa status vencidos a cada 30 s e avisa os clientes.
  O cliente também esconde um status vencido.
- `GetUserProfile` devolve:
  - o relacionamento (`self`, `friend`, `incoming`, `outgoing`, `blocked`, `none`);
  - amigos em comum e servidores em comum, calculados no servidor;
  - a data real de entrada no servidor aberto, revelada só a quem também é membro dele.
- O cartão de perfil usa esses dados. Foi removida a data fixa "15 de nov. de 2026".
- O nome de exibição aparece na lista de DMs, em Amigos, no painel da DM e no cartão de perfil.

### Denúncias
- `ReportUser` grava na tabela `reports` (motivo de até 500 caracteres e id opcional da mensagem).
- A interface tem um diálogo de motivo, que substituiu o toast falso.

## Parcial
- **Nome de exibição nas mensagens:** o autor da mensagem continua sendo o nome de usuário.
  O nome de exibição aparece nos perfis, nas DMs e em Amigos.
- **Bloqueio dentro de grupo:** bloquear alguém não tira essa pessoa de um grupo em comum.
  As mensagens dela ficam ocultas para quem bloqueou, e não é possível adicioná-la a grupos novos
  junto com quem a bloqueou.
- **Amizades:** continuam no documento JSON `friends` (`kv`), agora com `blocked`, `dm_requests`
  e `ignored_dms`. A normalização em tabelas ficou para depois.
- **Bloqueios antigos:** os bloqueios feitos antes desta fase (só no localStorage) não foram
  migrados, porque o bloqueio real também desfaz a amizade. Eles deixam de valer quando chega a
  lista do servidor.

## Pendente (Fase 5)
- Perfil por servidor (apelido/avatar por servidor).
- Tela de moderação para ler as denúncias. Por enquanto elas ficam só no banco.

## Testado
- `cargo test --lib`: 60 testes, todos passando. Os 6 novos da Fase 5 estão em `src/phase5_tests.rs`:
  1. bloqueio (DM, pedido, chamada, mensagem genérica, desbloqueio);
  2. solicitação de mensagem e política `friends` / `none` (com fallback do valor inválido);
  3. ignorar solicitação;
  4. ciclo do grupo (não-amigo recusado, criação, mensagem e menção, estranho barrado no texto
     e na voz, só o dono remove, posse transferida, persistência, exclusão ao sair o último);
  5. perfil com amigos e servidores em comum, sem vazar a data de entrada no servidor, e denúncia
     persistida;
  6. campos de perfil e expiração do status.
- `cargo test --bin SancordApp`: 6 testes passando.
- Frontend (`node --test`): 21 testes passando, 3 deles novos em `tests/frontend-social.test.cjs`.
- Instância isolada `127.0.0.1:3100` com cópia dos dados de produção. A migração para v5 rodou
  sobre a cópia. Contas de QA criadas pelo script `qa-phase5/seed.mjs`.
- Validado no navegador:
  - aceitar uma solicitação pela faixa da conversa;
  - abrir o grupo e enviar mensagem;
  - abrir o diálogo de criar grupo;
  - cartão de perfil com nome de exibição, pronomes, emoji e data real;
  - bloquear pelo cartão e ver a pessoa na aba Bloqueados;
  - mudar a privacidade e conferir o eco do servidor;
  - salvar o perfil com prazo do status;
  - enviar uma denúncia.
  - Nenhum erro no console.
- **Não testado:** chamada de voz em grupo com áudio real entre duas máquinas, que depende da
  validação da Fase 6.

## Correção encontrada no caminho
- O editor de perfil removia a classe `nameplate-trigger-box` do botão "Placa de identificação",
  que aparecia com o fundo branco padrão. Corrigido em `static/app.js`.
