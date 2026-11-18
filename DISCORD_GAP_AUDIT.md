# Auditoria de paridade — Sancord × Discord Desktop

Documento vivo. Atualize as linhas quando um item mudar de estado e anote a data no histórico, no fim do arquivo.

## 0. Identificação

| Campo | Valor |
|---|---|
| Data da auditoria | 18/11/2026 |
| Quem auditou | Claude (sessão de código), a pedido do usuário |
| Sancord publicado | **v0.2.1**: tag `v0.2.1` = commit `8123c3cb` (branch `main`), release estável no GitHub e servidor/cliente de produção na 0.2.1 (banco v13) |
| Sancord nos fontes (não publicado) | Sincronizado com `v0.2.1` (`8123c3cb`): timeout de membro (schema v11), modo lento (v12), tags de fórum (v13), Etapa A itens 1 e 2 e refatoração visual desktop |
| Tamanho | Rust ~19 mil linhas (39 arquivos); front-end `app.js` ~7,7 mil linhas, 15 módulos JS, `styles.css` ~7,8 mil linhas e `ui.css` ~1,1 mil linhas |
| Protocolo | 84 tipos de pedido do cliente (`ClientMessage`) e 47 tipos de evento do servidor (`ServerMessage`) |
| Testes | 240 padrão + 1 artefato assinado = 241 aprovados: 106 núcleo, 8 desktop, 1 manutenção, 125 front-end e 1 HTTPS real |
| Referência Discord | Notas oficiais de atualização até **09/11/2026**; reforma visual de **25/03/2025** (temas Light, Ash, Dark e Onyx, 3 densidades, lista de canais redimensionável); criptografia de chamadas DAVE concluída em **maio/2026**; artigos de suporte sobre encaminhamento, polls, soundboard, texto em voz, stages e passkeys (as datas dos artigos variam, ver Fontes) |

**Como foi verificado:**
- **Leitura do código:** backend, banco e migrações, protocolo WebSocket, front-end, estilos, testes e documentos (`AI_HANDOFF.md`, `FASE*.md`, `HOMOLOGACAO.md`, `ROADMAP.md`).
- **Varredura automática:**
  - todos os 232 controles com `id` e os 81 botões sem `id` do `index.html` estão ligados a algum código;
  - nenhum TODO, mock ou dado fictício nos fontes;
  - preferências salvas que nunca são lidas (achadas 4, ver §55).
- **Interface na instância de QA (porta 3100, dados de QA), com cliques reais:**
  - Home e amigos, DM, mensagens agrupadas e barra de ações ao passar o mouse, menu de mensagem;
  - configurações do usuário (todas as páginas) e do servidor (todas as abas);
  - castigo, modo lento e fórum com tags;
  - temas Claro e Escuro, perfil.
- **Não verificado nesta auditoria:**
  - a janela nativa `SancordApp.exe`: abrir o `.exe` foi bloqueado pela revisão automática anterior;
  - voz, vídeo e tela com dispositivos físicos ou entre redes diferentes;
  - notificações nativas do Windows;
  - comparação direta lado a lado com o cliente do Discord: não há acesso a ele nesta sessão; a referência é a documentação e as notas oficiais.
- Por isso os itens de mídia e de janela nativa estão classificados com cautela.

**Legenda:**
- ✅ funciona de ponta a ponta;
- 🟡 parcial;
- 🎨 somente visual;
- ❌ ausente;
- ⚠️ com problema;
- 🚫 não recomendado agora.

**Prioridade:** P0 essencial · P1 importante · P2 melhoria relevante · P3 opcional/futuro.

**Dificuldade:** B baixa · M média · A alta · MA muito alta.

---

## 1. Resumo executivo (as 10 respostas)

1. **O que já temos.**
   - **Mensagens:** texto completo, com editar, excluir, responder, reações, fixar, menções, digitando, não lidas, histórico paginado e busca.
   - **Servidores:** categorias, canais de texto, voz, anúncios e fórum, convites com limite e validade, pastas de servidores e arrastar para reorganizar.
   - **Cargos e permissões:** permissões herdadas em três níveis (servidor, categoria, canal) com permitir/negar/herdar e cálculo central no backend.
   - **Moderação:** kick, ban, unban, castigo, modo lento, AutoMod e auditoria.
   - **Social:** amigos, DMs, solicitações de mensagem, grupos, perfis e status com prazo.
   - **Recursos avançados:** enquetes, eventos, threads, fóruns com tags, bots e webhooks de envio.
   - **Aparência e atualização:** quatro temas, atualização assinada.
2. **Parciais.**
   - **Voz, vídeo e tela:** funcionam, mas em malha P2P sem servidor de mídia e sem validação entre redes.
   - **Notificações:** sem duração de silêncio nem silêncio por categoria.
   - **Encaminhar:** copia texto, sem snapshot e sem anexos.
   - **Eventos:** sem início e fim automáticos.
   - **Busca:** funciona; falta conferir a experiência em listas grandes.
   - **Configurações:** sem página de Acessibilidade e sem editor de atalhos.
   - **Conta:** sem e-mail, sem recuperação e sem sessões.
3. **Somente visual.** Quatro opções salvas que nenhum código usa:
   - "Exibir status Está digitando";
   - "Modo Foco";
   - "Proteção de Links Externos";
   - o antigo "Somente amigos podem mandar DM".

   Além delas:
   - a página **"Status da conta"** diz sempre "Tudo certo";
   - o texto de segurança afirma que as **mensagens** usam DTLS-SRTP, o que não é verdade (§55).
4. **Ausentes que pesam:**
   - recuperação de senha e e-mail;
   - sessões e dispositivos;
   - transferir propriedade do servidor;
   - preview de links;
   - emojis próprios do servidor;
   - seletor de GIF;
   - texto dentro do canal de voz;
   - servidor de mídia (SFU);
   - TURN provisionado;
   - motivo do ban e apagar mensagens ao banir;
   - revisão de denúncias.
5. **Visual.**
   - O layout geral é muito próximo.
   - Diferenças principais:
     - a lista de canais não se redimensiona;
     - não há botões Voltar/Avançar;
     - o painel de voz é diferente;
     - restam ~330 cores `rgba` fixas;
     - algumas telas de configuração têm visual de "marketing".
6. **Comportamentos que faltam:**
   - escolher se a resposta menciona o autor ou não;
   - histórico de edição;
   - silenciar por um tempo;
   - "Shift+Esc" para marcar o servidor como lido;
   - "@time";
   - abrir o chat de texto da chamada.
7. **Não copiar agora:**
   - Nitro, loja, Quests, Orbs, Boost e cosméticos pagos;
   - Activities e jogos;
   - overlay de jogo;
   - Server Discovery público;
   - Clips;
   - Soundmoji e super reações;
   - Stage para 10 mil pessoas.
8. **Próxima prioridade:**
   - **Etapa A** (§59): corrigir o que é só visual ou enganoso e publicar o que já está pronto;
   - depois, **conta segura** (e-mail, recuperação, sessões);
   - depois, **voz confiável** (TURN e ensaio entre redes).
9. **Quão completo:** paridade geral estimada em **~57%** (§51). O núcleo de texto e de comunidade está bem mais à frente (~70–75%) que mídia (~40%) e conta/segurança (~35%).
10. **Melhor roteiro:** Etapas A → G em §59, começando por bugs e coisas enganosas, depois o que falta no núcleo, antes de qualquer recurso "de vitrine".

---

## 2. Índice de paridade (estimativa técnica)

| Área | Paridade | Por quê |
|---|---|---|
| Funcionalidade core (conta, servidores, canais, tempo real, persistência) | **68%** | Tempo real, persistência e permissões sólidas. Conta sem e-mail, recuperação, sessões e exclusão. |
| Chat | **72%** | Ciclo da mensagem completo e bem testado. Faltam embeds de link, GIF, emojis próprios, controle de menção no reply, histórico de edição, encaminhamento real e timestamps dinâmicos. |
| Servidores | **70%** | Estrutura, convites, pastas e arrastar ok. Faltam transferir propriedade, perfil por servidor, emojis e integrações de comunidade (onboarding, regras). |
| Social | **72%** | Amigos, DMs, solicitações e grupos completos. Notas e "ignorar" só locais, sem atividade rica, sem apelido de amigo. |
| Voz | **40%** | Funciona em malha P2P com filtros próprios e PTT. Sem SFU (escala), sem TURN provisionado, sem validação entre redes, sem texto na voz, sem soundboard. Testes físicos limitados. |
| Vídeo e tela | **40%** | Câmera, tela, janela e áudio de sistema existem. Webcam física não validada, sem pop-out, um modelo só de grade e foco, escala limitada pela malha. |
| Moderação | **65%** | Kick, ban, castigo, modo lento, AutoMod e auditoria. Faltam motivo e limpeza de mensagens no ban, exclusão em massa, revisão de denúncias, AutoMod que aplica castigo, nível de verificação e proteção contra raid. |
| Configurações | **50%** | Muitas páginas reais, mas 4 opções mortas, sem Acessibilidade, editor de atalhos, Avançado/modo desenvolvedor e Sobre. Status da conta fixo. |
| Visual | **70%** | Estrutura, temas e densidade muito próximos. Detalhes de proporção, cores fixas restantes e estilo de algumas páginas. |
| UX / microinterações | **60%** | Barra ao passar o mouse, agrupamento, menus e tooltips bons. Faltam feedbacks finos (indicador de servidor animado, prévias de reply, transições de painel, voltar/avançar). |
| **Paridade geral** | **~57%** | Média ponderada (core e chat pesam 2×, voz e vídeo 1,5×, o resto 1×), arredondada para baixo por causa do que não pôde ser testado fisicamente. |

**Método:**
- Cada área foi pontuada pela fração dos recursos que o Discord oferece de graça e que fazem sentido para o Sancord (excluindo o que está em §50).
- Peso: ✅ = 1, 🟡 = 0,5, 🎨 e ❌ = 0.
- Os números de voz e vídeo descontam a falta de validação física.

---

## 3. Matriz de paridade

Colunas: **Recurso | Discord | Sancord hoje | Status | O que falta | Prioridade | Dificuldade | Dependências.**

### 6. Conta e autenticação

| Recurso | Discord | Sancord | St | Falta | P | Dif | Dep |
|---|---|---|---|---|---|---|---|
| Cadastro | E-mail, senha, data de nascimento e verificação | Usuário e senha (Argon2id), regras de senha | 🟡 | E-mail e verificação | P1 | M | Envio de e-mail |
| Login | E-mail ou telefone e senha, QR e passkey | Usuário e senha, limite de tentativas | 🟡 | Passkey e QR (não prioritários) | P3 | A | — |
| Logout | Sim | Sim | ✅ | — | — | — | — |
| Manter sessão | Sim | "Manter conectado" (30 dias ou 24 h) | ✅ | — | — | — | — |
| Recuperação de senha | Por e-mail | Não existe | ❌ | Fluxo de reset por e-mail ou código | **P0** | M | E-mail na conta |
| Alterar senha | Sim, exige a atual | Sim (`ChangePassword`) | ✅ | Encerrar as outras sessões ao trocar | P1 | B | Sessões |
| Alterar e-mail | Sim | Não há e-mail | ❌ | Campo, verificação e troca | P1 | M | E-mail |
| Alterar username | Sim | Sim (`UpdateUsername`), migra cargos, castigos e convites | ✅ | — | — | — | — |
| Nome de exibição | Separado do username | Nome de usuário único; nome de exibição parcial no perfil | 🟡 | Separar nome de exibição e @username de forma consistente | P2 | M | — |
| Sessões e dispositivos | Lista e encerrar sessão | Sessões existem no banco, sem interface | ❌ | Listar, encerrar uma, encerrar todas | P1 | M | — |
| 2FA / passkeys | App, SMS, chaves de segurança e passkeys | Não existe | ❌ | TOTP e códigos de backup | P2 | A | Recuperação |
| Excluir ou desativar conta | Sim | Não existe | ❌ | Fluxo com confirmação e o destino das mensagens | P1 | M | Política de dados |
| Confirmar ações sensíveis | Senha ou MFA | Só a senha na troca de senha | 🟡 | Pedir senha para excluir servidor ou conta | P2 | B | — |
| Página "Status da conta" | Avisos de violação reais | Mostra os castigos ativos nos seus servidores (Etapa A, fontes) | ✅ | Bans não aparecem (quem foi banido não recebe o servidor) | P3 | B | — |

### 7. Home

| Recurso | Discord | Sancord | St | Falta | P | Dif | Dep |
|---|---|---|---|---|---|---|---|
| Home e amigos | Abas Online, Todos, Pendentes, Bloqueados e Adicionar | Disponível, Todos, Pendente, Solicitações, Bloqueados e Adicionar (testado) | ✅ | — | — | — | — |
| DMs recentes | Lista ordenada por atividade, com prévia | Sim, com prévia da última mensagem | ✅ | — | — | — | — |
| Grupos na lista | Sim | Sim | ✅ | — | — | — | — |
| "Ativo agora" | Atividades dos amigos (jogos, voz, streams) | Painel existe, mostra voz e tela de amigos | 🟡 | Sem atividade de jogos ou apps (ver §39) | P3 | A | Presença rica |
| Mensagens favoritas | Não existe no Discord (há "Salvos" em teste) | "Favoritas", só local | 🟡 | Sincronizar pela conta | P3 | B | — |
| Chamadas recentes | Registro na DM | Mensagens de sistema de chamada na DM | ✅ | — | — | — | — |

### 8. Amizade

| Recurso | Discord | Sancord | St | Falta | P | Dif | Dep |
|---|---|---|---|---|---|---|---|
| Enviar, aceitar, recusar e cancelar pedido | Sim | Sim (testado nas fases 5 e 9) | ✅ | — | — | — | — |
| Remover, bloquear e desbloquear | Sim | Sim, no servidor | ✅ | — | — | — | — |
| Ignorar | Por conta, sincronizado | Só local (`localStorage`) | 🟡 | Persistir pela conta | P2 | B | — |
| Pesquisar usuário | Por username exato | Por username | ✅ | — | — | — | — |
| Amigos e servidores em comum | No perfil | No perfil (abas) | ✅ | — | — | — | — |
| Nota sobre o usuário | Sincronizada | Só local | 🟡 | Persistir pela conta | P2 | B | — |
| Apelido de amigo | Sim (2024+) | Não | ❌ | — | P3 | B | — |

### 9. DMs

| Recurso | Discord | Sancord | St | Falta | P | Dif | Dep |
|---|---|---|---|---|---|---|---|
| Criar DM e enviar | Sim | Sim (testado) | ✅ | — | — | — | — |
| Editar, excluir, responder, reagir, anexar, fixar | Sim | Sim | ✅ | — | — | — | — |
| Emoji | Unicode e do servidor | Só Unicode | 🟡 | Emojis próprios (§34) | P2 | M | §34 |
| GIF | Seletor integrado | Só enviar arquivo GIF | 🟡 | Seletor (§15) | P2 | M | Provedor |
| Stickers | Sim | Não | ❌ | Ver §35 | P3 | M | — |
| Busca na DM | Sim | Sim (busca com escopo de privado) | ✅ | — | — | — | — |
| Chamada de voz, vídeo e tela | Sim | Sim (malha P2P); validação física parcial | 🟡 | Validação entre redes e TURN | P1 | M | TURN |
| Digitando e status | Sim | Sim; a opção de esconder "digitando" funciona (Etapa A, fontes) | ✅ | — | — | — | — |
| Solicitações de mensagem | Sim | Sim, no servidor | ✅ | — | — | — | — |
| Notificações | Sim | Sim (som e aviso do sistema) | 🟡 | Validar no Windows nativo | P1 | B | `.exe` |

### 10. Grupos (Group DMs)

| Recurso | Discord | Sancord | St | Falta | P | Dif | Dep |
|---|---|---|---|---|---|---|---|
| Criar, adicionar, remover, renomear, trocar ícone, sair | Sim (até 10) | Sim (fase 5) | ✅ | — | — | — | — |
| Mensagens, pins e notificações | Sim | Sim | ✅ | — | — | — | — |
| Chamada, vídeo e tela em grupo | Sim | Sim (malha) | 🟡 | Escala e validação | P1 | A | SFU |
| Dono do grupo e transferência | Sim | Dono existe; transferência não | 🟡 | Transferir | P3 | B | — |

### 11. Servidores

| Recurso | Discord | Sancord | St | Falta | P | Dif | Dep |
|---|---|---|---|---|---|---|---|
| Criar, com modelo, imagem e descrição | Sim | Sim | ✅ | — | — | — | — |
| Editar (nome, ícone, banner, descrição) | Sim | Sim | ✅ | — | — | — | — |
| Excluir e sair | Sim | Sim | ✅ | Pedir senha ao excluir | P2 | B | — |
| Transferir propriedade | Sim | **Não existe** | ❌ | Fluxo com confirmação e auditoria | **P1** | B | — |
| Pastas de servidores | Sim | Sim (nome, cor, contador) | ✅ | — | — | — | — |
| Arrastar para reorganizar | Sim | Sim | ✅ | — | — | — | — |
| Indicadores de não lido e menção | Sim | Sim | ✅ | — | — | — | — |
| Silenciar e marcar como lido | Sim, com duração | Sim, sem duração | 🟡 | Duração (15 min, 1 h, 8 h, 24 h, até reativar) | P2 | B | — |
| Menu de contexto do servidor | Amplo | Marcar lido, convidar, silenciar, notificações, configurações, sair | ✅ | — | — | — | — |
| Perfil por servidor (apelido, avatar) | Sim | Não | ❌ | Apelido por servidor primeiro | P2 | M | — |
| Tag do servidor e Boost | Sim | — | 🚫 | — | — | — | — |

### 12. Convites

| Recurso | Discord | Sancord | St | Falta | P | Dif | Dep |
|---|---|---|---|---|---|---|---|
| Gerar, código e link | Sim | Sim (`SANC-XXXXXX` e `sancord://`) | ✅ | — | — | — | — |
| Validade, limite de usos, permanente | Sim | Sim | ✅ | — | — | — | — |
| Prévia antes de entrar | Sim, com contagem | Sim (`/api/invite/:code`, membros e online) | ✅ | — | — | — | — |
| Listar e revogar, criador e usos | Sim | Sim | ✅ | — | — | — | — |
| Convite temporário (membro sai se desconectar) | Sim | Não | ❌ | — | P3 | M | — |

### 13. Categorias

| Recurso | Discord | Sancord | St | Falta | P | Dif | Dep |
|---|---|---|---|---|---|---|---|
| Criar, editar e excluir | Sim | Sim | ✅ | — | — | — | — |
| Recolher e expandir (lembrado) | Sim | Sim | ✅ | — | — | — | — |
| Reorganizar e mover canais | Sim | Sim (arrastar) | ✅ | — | — | — | — |
| Permissões e sincronizar | Sim | Sim (fase 4, testado) | ✅ | — | — | — | — |

### 14. Tipos de canal

| Tipo | Discord | Sancord | St | Necessário? | P | Dif | Dep |
|---|---|---|---|---|---|---|---|
| Texto | Sim | Sim | ✅ | Sim | — | — | — |
| Voz | Sim, com chat de texto próprio | Voz sim; **sem texto dentro do canal de voz** | 🟡 | Sim | P1 | M | — |
| Anúncios | Sim, com "seguir" para outro servidor | Sim, sem seguir | 🟡 | O "seguir" não | P3 | M | — |
| Fórum | Sim (tags, ordenar, galeria, diretrizes) | Sim, com tags e filtro; sem ordenar, sem galeria, sem diretrizes | 🟡 | Ordenar (atividade ou criação) e diretrizes | P2 | B | — |
| Mídia | Beta, ligado a assinaturas | Não | 🚫 | Pode ser um "fórum em galeria" no futuro | P3 | M | Galeria |
| Palco (Stage) | Comunidades grandes | Não | 🚫 | Não para a escala atual | P3 | A | SFU |
| Texto no canal de voz | Sim | Não | ❌ | Sim | P1 | M | — |

### 15. Chat (auditoria detalhada)

| Recurso | Discord | Sancord | St | Falta | P | Dif | Dep |
|---|---|---|---|---|---|---|---|
| Envio em tempo real, com nonce e "Tentar novamente" | Sim | Sim (testado) | ✅ | — | — | — | — |
| Edição ("editado") | Sim | Sim; seta ↑ edita a última | ✅ | — | — | — | — |
| Histórico de edição | Não público (só "editado") | Igual | ✅ | — | — | — | — |
| Exclusão (própria e moderação), com confirmação | Sim | Sim | ✅ | Exclusão em massa (§27) | — | — | — |
| Reply com link para a original | Sim | Sim | ✅ | — | — | — | — |
| Reply com ou sem menção (@ON/OFF) | Sim | **Sempre menciona** | ❌ | Opção na barra de resposta | P2 | B | — |
| Encaminhar | Snapshot imutável, até 5 destinos, com anexos, marcado como encaminhado | Copia o texto com "↪ Encaminhado de…", 1 destino, sem anexos | 🟡 | Snapshot real com anexos e vários destinos | P2 | M | — |
| Reações múltiplas, contagem e quem reagiu | Sim | Sim | ✅ | Emojis próprios | — | — | §34 |
| Super reações | Pago | — | 🚫 | — | — | — | — |
| Fixar e painel de fixadas | Sim | Sim | ✅ | — | — | — | — |
| Copiar texto, link e ID | ID só no modo desenvolvedor | Sim; ID sempre visível | 🟡 | Esconder ID atrás de "Modo desenvolvedor" | P3 | B | — |
| Barra ao passar o mouse | Sim | Sim (reações rápidas e ações; testado) | ✅ | — | — | — | — |
| Menu de contexto da mensagem | Amplo | 4 reações rápidas e 11 ações (testado) | ✅ | "Criar thread" e "Falar mensagem" (P3) | — | — | — |
| Markdown, spoiler, código, citação, listas, links | Sim, com títulos e subtexto | Sim (exceto títulos `#` e subtexto `-#`) | 🟡 | Títulos e subtexto | P3 | B | — |
| Menções @user, @cargo, @todos, @online e #canal | Sim | Sim, com autocompletar e destaque | ✅ | Clicar em @cargo lista os membros (2026) | P3 | B | — |
| Preview de links (embeds) | Título, descrição e imagem, seguro | **Não existe** (só imagens anexadas) | ❌ | Unfurl no servidor, com tamanho limitado e cache | **P1** | M | Proxy de imagens |
| Emoji Unicode, seletor, busca e recentes | Sim | Sim | ✅ | — | — | — | — |
| Emoji próprio do servidor | Sim | Não | ❌ | §34 | P2 | M | — |
| GIF (seletor) | Sim (Tenor) | Não, só upload | ❌ | Escolher provedor e privacidade | P2 | M | Chave de API |
| Stickers | Sim | Não | ❌ | §35 | P3 | M | — |
| Uploads (+, arrastar, Ctrl+V, progresso) | Sim | Sim | ✅ | — | — | — | — |
| Imagem com visualizador, vídeo e áudio com player, arquivo com tamanho | Sim | Sim | ✅ | — | — | — | — |
| Enquetes | Sim | Sim (§19) | ✅ | — | — | — | — |
| Digitando | Sim | Sim; opção de esconder morta | ⚠️ | §55 | P1 | B | — |
| Não lidas, divisor "novas" e marcar não lida | Sim | Sim | ✅ | — | — | — | — |
| Histórico paginado e saltar para a mensagem | Sim | Sim (testado) | ✅ | — | — | — | — |
| Virtualização de listas enormes | Sim | Não (DOM completo; cache de avatar ajuda) | 🟡 | Virtualizar acima de alguns milhares de mensagens | P2 | A | — |
| Agrupamento | Sim | Sim (§16) | ✅ | — | — | — | — |
| Separadores de data | Sim | Sim ("Hoje", datas) | ✅ | — | — | — | — |
| Timestamps dinâmicos (`<t:>`, @time) | Sim (2026) | Não | ❌ | — | P3 | B | — |
| Mensagem de sistema e selo bot/webhook | Sim | Sim (`author_kind`) | ✅ | — | — | — | — |

### 16. Mensagens agrupadas

| Aspecto | Discord | Sancord (testado na tela) | St |
|---|---|---|---|
| Sequência do mesmo autor sem repetir avatar e nome | Sim, com janela de tempo | Sim (classe `grouped`) | ✅ |
| Horário escondido que aparece ao passar o mouse | Sim | Sim ("12:29" visto na captura) | ✅ |
| Ações rápidas ao passar o mouse | Sim | Sim | ✅ |
| Quebra de grupo por sistema, bot ou reply | Sim | Sim (sistema e bot não agrupam) | ✅ |
| Espaçamento e densidade | Cozy ou compacto | Normal ou compacto | ✅ |

### 17. Threads

| Recurso | Discord | Sancord | St | Falta | P | Dif | Dep |
|---|---|---|---|---|---|---|---|
| Criar a partir de mensagem ou do canal | Sim | Sim | ✅ | — | — | — | — |
| Arquivar, desarquivar, trancar, renomear, excluir | Sim | Sim | ✅ | — | — | — | — |
| Contador de respostas | Sim | Sim | ✅ | — | — | — | — |
| Participantes, "seguir" e membros da thread | Sim | Não há lista de participantes | 🟡 | Membros e seguir/deixar | P2 | M | — |
| Arquivamento automático por inatividade | Sim (1 h a 1 semana) | Não | ❌ | — | P3 | B | — |
| Notificações por thread | Sim | Sim (nível por thread) | ✅ | — | — | — | — |
| Permissões | Criar threads públicas e privadas, enviar em threads | Herda do canal-pai (enviar mensagens) | 🟡 | Permissões próprias e threads privadas | P2 | M | — |

### 18. Fóruns

| Recurso | Discord | Sancord | St | Falta | P | Dif | Dep |
|---|---|---|---|---|---|---|---|
| Postagens com título, conteúdo e respostas | Sim | Sim | ✅ | — | — | — | — |
| Tags (moderadas), até 5 por post | Sim | Sim (fontes, não publicado) | ✅ | Publicar | — | — | — |
| Busca e filtro por tag | Sim | Sim | ✅ | — | — | — | — |
| Ordenar (atividade ou criação) | Sim | Só por atividade | 🟡 | Seletor | P2 | B | — |
| Fechar e reabrir (trancar) | Sim | Sim | ✅ | — | — | — | — |
| Galeria e diretrizes do fórum | Sim | Não | ❌ | — | P3 | M | — |

### 19. Enquetes

| Recurso | Discord | Sancord | St | Falta |
|---|---|---|---|---|
| Criar, 2 a 10 opções, várias escolhas, duração até 7 dias, votar, resultado, encerrar | Sim | Sim (fase 8, testado) | ✅ | Permissão própria "criar enquetes" (hoje basta enviar mensagens), P3 |

### 20. Busca

| Recurso | Discord | Sancord | St | Falta | P | Dif |
|---|---|---|---|---|---|---|
| Texto completo | Sim | FTS5 no banco, só em canais legíveis | ✅ | — | — | — |
| `from:`, `in:`, `has:` (link, arquivo, imagem, vídeo), `before:`/`after:`, `mentions:`, fixadas | Sim | Sim (em português e inglês) | ✅ | — | — | — |
| Ir até o resultado | Sim | Sim (bug corrigido na fase 8) | ✅ | — | — | — |
| Paginação dos resultados | Sim | Página de 25 com cursor | ✅ | — | — | — |
| Interface com chips de filtro e sugestões | Sim | Caixa com filtros digitados, sem sugestões visuais | 🟡 | Sugestões e chips | P2 | M |

### 21. Voz

| Recurso | Discord | Sancord | St | Falta | P | Dif | Dep |
|---|---|---|---|---|---|---|---|
| Entrar e sair, mute, deafen | Sim | Sim | ✅ | — | — | — | — |
| PTT e detecção de voz (com sensibilidade) | Sim | Sim (tecla configurável, porta de ruído) | ✅ | — | — | — | — |
| Dispositivos de entrada e saída, volume | Sim | Sim | ✅ | — | — | — | — |
| Volume e mute individuais (locais) | Sim | Sim (lembrado pelo nome) | ✅ | — | — | — | — |
| Indicador de fala | Sim | Sim (brilho no avatar) | ✅ | — | — | — | — |
| Teste de microfone | Sim | Sim (não fica capturando depois) | ✅ | — | — | — | — |
| Supressão de ruído | Krisp (aprendizado de máquina) | Restrições do navegador e porta, passa-alta e compressor | 🟡 | Modelo de supressão (RNNoise ou similar) | P2 | A | — |
| Cancelamento de eco e ganho automático | Sim | Sim (restrições WebRTC) | ✅ | — | — | — | — |
| Bitrate do canal | Configurável por canal | Ajustes de qualidade no cliente | 🟡 | Bitrate por canal | P3 | B | — |
| Arquitetura e escala | SFU próprio, centenas de pessoas | **Malha P2P**: cada um envia para cada um; acima de ~5–6 pessoas degrada | ⚠️ | SFU | **P1** | MA | Servidor de mídia |
| Travessia de NAT | Servidores próprios | Só STUN padrão; TURN configurável mas **não provisionado** | ⚠️ | Subir TURN (coturn) e testar | **P0** | M | Servidor ou VPS |
| Reconexão e perda de pacote | Robustas | Retomada da voz tratada no cliente; sem medição | 🟡 | Ensaios de queda de rede | P1 | M | TURN |
| Latência e qualidade (ping) | Painel de conexão | Indicador de ping e sinal | 🟡 | Estatísticas detalhadas | P3 | B | — |
| Criptografia ponta a ponta | DAVE (desde 05/2026) | DTLS-SRTP entre os pares (é ponta a ponta na malha P2P, mas sem verificação de identidade como o DAVE) | 🟡 | Documentar com precisão; se houver SFU, avaliar E2EE | P2 | A | SFU |
| Moderação de voz (silenciar, ensurdecer, mover, desconectar, limite) | Sim | Sim | ✅ | — | — | — | — |
| Soundboard | Sim | Não | 🚫 | §36 | P3 | M | — |
| Validação física (duas máquinas e redes) | — | Só um teste local relatado | ⚠️ | Roteiro do `HOMOLOGACAO.md` | **P0** | B | Usuário e equipamento |

**Resumo de voz:** funciona para conversas pequenas na mesma rede ou em redes favoráveis. Não é equivalente ao Discord. **~40%.**

### 22. Vídeo

| Recurso | Discord | Sancord | St | Falta | P | Dif |
|---|---|---|---|---|---|---|
| Webcam ligar e desligar, escolher câmera e qualidade | Sim | Sim (persistido) | 🟡 | Validação com câmera física | P1 | B |
| Grade, foco num usuário, tela cheia | Sim | Sim (grade, foco, `requestFullscreen`) | 🟡 | Validar com vários participantes | P1 | M |
| Vários usuários | Até 25 | Limitado pela malha | ⚠️ | SFU | P1 | MA |

### 23. Compartilhamento de tela

| Recurso | Discord | Sancord | St | Falta | P | Dif |
|---|---|---|---|---|---|---|
| Tela inteira, monitor e janela com seletor | Sim | Sim (ponte nativa `capture_bridge`) | ✅ | — | — | — |
| Áudio do sistema | Sim | Sim (loopback); validação parcial | 🟡 | Validar | P1 | M |
| Qualidade (720p a 4K) | Sim (resoluções altas são pagas) | Sim (opções até 4K) | ✅ | — | — | — |
| Assistir, tela cheia | Sim | Sim | ✅ | — | — | — |
| Pop-out (janela separada) | Sim | Não | ❌ | — | P3 | M |
| Várias transmissões ao mesmo tempo | Sim | Sim, limitado pela malha | 🟡 | SFU | P2 | MA |

### 24. Painel de voz (parte inferior)

| Recurso | Discord | Sancord | St | Falta |
|---|---|---|---|---|
| "Voz conectada", canal, qualidade e desconectar | Sim | Sim (cartão inferior com sinal) | ✅ | — |
| Botões de vídeo e tela, mute e deafen | Sim (barra de ações de 2025) | Sim | ✅ | Barra única de ações, como a de 2025 (P3) |

### 25. Cargos

| Recurso | Discord | Sancord | St | Falta | P | Dif |
|---|---|---|---|---|---|---|
| Criar, editar e excluir; nome, cor, emoji e ícone | Ícone de imagem (pago) | Emoji como ícone | ✅ | — | — | — |
| Hierarquia, arrastar, membros, mencionável, mostrar separado | Sim | Sim (`ReorderRoles`) | ✅ | — | — | — |
| @everyone, dono e administrador | Sim | Sim | ✅ | — | — | — |
| Cor em gradiente | Pago (2025) | — | 🚫 | — | — | — |

### 26. Permissões

| Aspecto | Discord | Sancord | St | Observação |
|---|---|---|---|---|
| Servidor, categoria, canal; cargo e membro; permitir, negar, herdar | Sim | Sim; cálculo central em `GuildServer::channel_permissions` (ordem: everyone → cargos → membro) | ✅ | Testado nas fases 4 e 8, e com escalada de privilégio |
| Ver, enviar, anexar, reagir, histórico, fixar, mencionar todos | Sim | Sim | ✅ | — |
| Gerenciar mensagens, canais, cargos e servidor; convites; kick, ban; auditoria | Sim | Sim | ✅ | — |
| Castigo (`moderate_members`) | Sim | Sim (fontes) | ✅ | Publicar |
| Conectar, falar, transmitir, mutar, ensurdecer e mover membros | Sim | Sim | ✅ | — |
| Criar threads (pública e privada), enviar em threads, criar enquetes, emojis externos, soundboard, apelidos, eventos, webhooks | Granulares | Não existem separadas | 🟡 | P2: criar threads, gerenciar eventos, gerenciar apelidos |
| Thread trancada | Só moderação escreve | Sim | ✅ | — |

### 27. Moderação

| Recurso | Discord | Sancord | St | Falta | P | Dif |
|---|---|---|---|---|---|---|
| Kick e ban, unban, lista de banidos | Com motivo e "apagar mensagens de X dias" | Sem motivo, sem limpeza | 🟡 | Motivo e limpeza | **P1** | B |
| Castigo com motivo e duração | Sim | Sim (fontes) | ✅ | Publicar | — | — |
| Modo lento | Sim | Sim (fontes) | ✅ | Publicar | — | — |
| Apagar mensagens alheias | Sim | Sim | ✅ | — | — | — |
| Exclusão em massa | Por bots e API | Não | ❌ | "Apagar últimas N" para moderadores | P2 | M |
| AutoMod: palavras, links, spam, menções, repetição | Sim | Sim | ✅ | — | — | — |
| AutoMod: ação de castigo automático | Sim | Bloqueia e alerta | 🟡 | Ação "castigo" | P2 | B |
| Auditoria | Sim | Sim (ações principais) | ✅ | — | — | — |
| Denúncias | Para a equipe do Discord | `ReportUser` grava, **sem interface de revisão** | 🟡 | Fila para o dono ou moderação | P2 | M |
| Nível de verificação e proteção contra raid | Sim | Não | ❌ | — | P3 | M |

### 28. Painel de membros

| Recurso | Discord | Sancord | St | Falta |
|---|---|---|---|---|
| Online e offline, grupos por cargo separado, cor do cargo, avatar, status | Sim | Sim | ✅ | — |
| Atividade | Jogos e apps | Voz e tela, status personalizado e castigo | 🟡 | Presença rica (P3) |
| Menu de contexto | Amplo | Novo: Ver perfil e castigo | 🟡 | Mensagem, chamar, adicionar amigo, cargos, kick e ban (P2, B) |
| Perfil rápido ao clicar | Sim | Sim | ✅ | — |

### 29. Perfis

| Recurso | Discord | Sancord | St | Falta |
|---|---|---|---|---|
| Avatar (com GIF), banner, nome, username, bio, pronomes | Sim (GIF é pago) | Sim, com recorte | ✅ | — |
| Status e status personalizado | Sim | Sim, com prazo | ✅ | — |
| Cargos, data de entrada, servidores e amigos em comum | Sim | Sim | ✅ | — |
| Tema de perfil, decorações, efeitos, estilo de nome | Pagos | **De graça** no Sancord | ✅ | Escolha consciente (diferencial) |
| Perfil por servidor | Sim | Não | ❌ | P2 |
| Selos (badges) | Sim | Só selo de cargo e sistema | 🟡 | P3 |

### 30. Status e presença

| Recurso | Discord | Sancord | St |
|---|---|---|---|
| Online, ausente, não perturbe, invisível, offline automático | Sim | Sim | ✅ |
| Ausente automático por inatividade | Sim | Há referência no código, sem prova de detecção de inatividade no cliente | 🟡 (P2) |
| Status personalizado com prazo e mudança em tempo real | Sim | Sim | ✅ |
| Atividade (jogo ou app) | Sim | Não | ❌ (P3) |

### 31. Notificações

| Recurso | Discord | Sancord | St | Falta | P |
|---|---|---|---|---|---|
| Mensagem, menção, reply e DM | Sim | Sim (nível por servidor, canal e thread) | ✅ | — | — |
| Pedido de amizade, chamada e evento | Sim | Chamada tem tela de chamada recebida; amizade e evento sem aviso do sistema | 🟡 | Avisos | P2 |
| Aviso do sistema (Windows) | Sim | Código pronto (Notification, IPC `attention` e `badge`) | 🟡 | Validar no `.exe` | P1 |
| Contador no título e na barra de tarefas | Sim | Sim (código e teste de formato) | 🟡 | Validar | P1 |
| Sons | Sim | Sim (volume e teste) | ✅ | — | — |
| Silenciar servidor, canal e thread | Sim | Sim | ✅ | — | — |
| Silenciar categoria | Sim | Não | ❌ | — | P2 |
| Duração do silêncio | Sim | Não | ❌ | — | P2 |
| Caixa de entrada (Inbox de menções) | Sim | Não | ❌ | — | P2 |

### 32. Configurações do usuário (páginas reais vistas na tela)

| Página | Discord | Sancord | St | Observação |
|---|---|---|---|---|
| Minha Conta e Informações | Sim | Sim (nome, ID, servidor conectado) | ✅ | — |
| Senha e segurança | Senha, MFA, chaves | "Mudar senha" e texto correto sobre o que é criptografado (Etapa A, fontes) | 🟡 | Sem MFA nem sessões |
| Status da conta | Avisos reais | Fixo, "Tudo certo" | 🎨 | — |
| Foco e segurança | (Discord: Central da Família, supervisão de menores) | Página própria: Modo Foco e Proteção de Links funcionando, mais tempo de sessão (Etapa A, fontes) | ✅ | — |
| Perfis | Sim | Sim (personalização ampla) | ✅ | — |
| Dados e privacidade | Sim | Privacidade de DM e amizade no servidor; "Exibir digitando" funciona | ✅ | — |
| Notificações | Sim | Sons, aviso do sistema, volume | ✅ | — |
| Voz e vídeo | Sim | Completa (dispositivos, filtros, PTT, câmera) | ✅ | — |
| Aparência | Temas, densidade, cor, fonte, zoom | Sim (4 temas, densidade, destaque, fonte, idioma, reduzir animações) | ✅ | — |
| Acessibilidade | Página própria (contraste, saturação, movimento, TTS) | Reduzir animações fica em Aparência; sem contraste nem saturação | 🟡 | P2 |
| Atalhos | Lista **editável** | Lista **fixa**; só a tecla do PTT é configurável | 🟡 | P2 |
| Idioma | Página própria | Em Aparência (pt-BR completo, inglês prévia) | 🟡 | P3 |
| Avançado (modo desenvolvedor) | Sim | Não existe; "Copiar ID" sempre visível | ❌ | P3 |
| Atualizações e Sobre | Sobre e versão | Atualizações sim; "Versão instalada: …" | 🟡 | Mostrar a versão sempre (P2) |
| Busca nas configurações | Sim | Sim | ✅ | — |

### 33. Configurações do servidor

| Aba | Discord | Sancord | St |
|---|---|---|---|
| Visão geral, cargos, membros e moderação, canais, convites | Sim | Sim | ✅ |
| Banimentos | Aba com motivo | Lista com desbanir, sem motivo | 🟡 |
| Emojis e stickers | Sim | Não | ❌ (P2/P3) |
| AutoMod, auditoria e integrações | Sim | Sim | ✅ |
| Eventos | Sim | Sim (modal de eventos) | ✅ |
| Segurança (verificação, 2FA de moderação) | Sim | Não | ❌ (P3) |
| Transferir propriedade | Sim | Não | ❌ (P1) |
| Excluir servidor | Sim | Sim | ✅ |
| Comunidade, onboarding e regras | Sim | Não | 🚫 / P3 |

### 34. Emojis

| Recurso | Discord | Sancord | St | Falta | P | Dif |
|---|---|---|---|---|---|---|
| Unicode, seletor, busca, recentes | Sim | Sim | ✅ | Favoritos | P3 | B |
| Autocompletar `:emoji:` | Sim | Sim | ✅ | — | — | — |
| Emojis próprios (envio, gerenciamento, uso em reações e mensagens) | Sim | **Não existe** | ❌ | Upload, armazenamento, permissão, sintaxe e cache | P2 | M |

### 35. Stickers
❌ ausente. **P3**, depois dos emojis próprios, reaproveitando o mesmo armazenamento. Pouco valor para a escala atual.

### 36. Soundboard
Discord: sons curtos tocados para todos na voz, com permissão própria. Sancord: ❌. Recomendação: **P3**. Divertido, mas só vale depois de a voz ser confiável (TURN e SFU).

### 37. Eventos

| Recurso | Discord | Sancord | St | Falta |
|---|---|---|---|---|
| Criar com data, hora, descrição e canal; interessados | Sim | Sim (fase 8) | ✅ | — |
| Imagem de capa | Sim | Não confirmado | 🟡 | P3 |
| Iniciar e terminar (estado ativo), avisar interessados | Sim | Sem estado ativo, sem aviso | 🟡 | P2 |

### 38. Bots, apps e webhooks

| Recurso | Discord | Sancord | St | P |
|---|---|---|---|---|
| Webhooks de envio (HTTP) com token, rotação e revogação | Sim | Sim (`src/integrations.rs`) | ✅ | — |
| Bots com conexão em tempo real (eventos) | Sim | Não; só envio | ❌ | P3 |
| Comandos de barra e de contexto | Sim | Não | ❌ | P3 |
| Permissões de aplicativo | Sim | Canal fixo por integração | 🟡 | P3 |

**Arquitetura futura:**
- Primeiro, um "gateway" somente leitura para bots com token próprio, aproveitando a projeção de permissões que já existe.
- Comandos depois.

### 39. Atividades
🚫 por enquanto. Jogos e apps embutidos só fazem sentido depois de voz e vídeo estarem excelentes e com SFU. P3 no máximo.

### 40. Acessibilidade

| Recurso | Sancord | St |
|---|---|---|
| Navegação por teclado e foco visível | Sim (fase 9) | ✅ |
| Tamanho da fonte e densidade | Sim | ✅ |
| Zoom | Sim (configuração de zoom) | ✅ |
| Contraste e saturação | Não | ❌ (P2) |
| Reduzir movimento | Sim (próprio e do Windows) | ✅ |
| Leitor de tela | `aria-live` e `aria-label` em partes; não auditado com NVDA | 🟡 (P2) |
| Navegação sem mouse em listas (setas) | Menus, Ctrl+K e Alt+↑/↓ | 🟡 |

### 41. Atalhos

| Atalho | Discord | Sancord | St |
|---|---|---|---|
| Ctrl+K (navegação rápida) | Sim | Sim | ✅ |
| Ctrl+F (busca) | Sim | Sim | ✅ |
| Esc (fechar e marcar lido) | Sim | Sim | ✅ |
| Shift+Esc (marcar o servidor como lido) | Sim | Não | ❌ (P3, B) |
| Enter / Shift+Enter | Sim | Sim | ✅ |
| Seta ↑ (editar a última) | Sim | Sim | ✅ |
| Alt+↑/↓ e Alt+Shift+↑/↓ (canais e não lidos) | Sim | Sim | ✅ |
| Ctrl+Shift+M e Ctrl+Shift+D (mute e deafen) | Sim | Sim | ✅ |
| Ctrl+/ (lista de atalhos) | Sim | Sim | ✅ |
| Atalhos personalizáveis e globais | Sim | Só o PTT | 🟡 (P2) |

### 42. Menus de contexto

| Onde | Sancord tem | Falta em relação ao Discord |
|---|---|---|
| Servidor | Marcar lido, convidar, silenciar, notificações, configurações, sair | Duração do silêncio, criar canal ou categoria, copiar ID |
| Canal | Marcar lido, copiar link, notificações, editar, excluir, permissões | Duração do silêncio, convidar |
| Categoria | Editar, excluir, recolher | Silenciar categoria, marcar como lida |
| Mensagem | Completo (§15) | "Criar thread" no menu da mensagem (existe por outro caminho) |
| Usuário (lista de membros) | Ver perfil e castigo (novo) | Mensagem, chamar, amigo, cargos, kick, ban, volume |
| Usuário na voz | Perfil, volume, silenciar para mim, moderação de voz, castigo | — |
| DM e grupo | Parcial (fechar, notificações) | Marcar como lida, silenciar com duração |

### 43. Arrastar e soltar

| Item | Sancord | St |
|---|---|---|
| Servidores e pastas | Sim | ✅ |
| Categorias e canais | Sim | ✅ |
| Cargos | Sim | ✅ |
| Upload (arrastar e Ctrl+V) | Sim | ✅ |
| Retorno visual ao arrastar | Sim (linhas de inserção) | ✅ |

---

## 4. Auditoria visual (§44)

Comparação com o Discord atual, a partir da documentação e das notas da reforma de 03/2025; não houve captura lado a lado.

| Elemento | Classificação | Nota |
|---|---|---|
| Proporções gerais (barra de servidores, canais, chat, membros) | MUITO PRÓXIMO | Mesma estrutura de 4 colunas |
| Largura das colunas | PRÓXIMO | A lista de canais **não se redimensiona** (no Discord, desde 2025, sim) |
| Altura do cabeçalho | MUITO PRÓXIMO | — |
| Barra de servidores | PRÓXIMO | Pastas, selos e indicadores; falta o indicador lateral animado ("pílula") igual em todos os estados |
| Lista de canais | PRÓXIMO | Ícones por tipo, não lidos e menções |
| Área do chat | MUITO PRÓXIMO | Agrupamento, horários e barra ao passar o mouse |
| Painel de membros | MUITO PRÓXIMO | — |
| Painel do usuário | PRÓXIMO | Cartão flutuante arredondado: diferente, mas bom |
| Campo de mensagem | MUITO PRÓXIMO | — |
| Espaçamento e densidade | PRÓXIMO | 3 densidades, como o Discord |
| Tipografia | DIFERENTE MAS BOM | Fonte própria do sistema |
| Cores e temas | MUITO PRÓXIMO | Claro, Ash, Escuro e Onyx, iguais em conceito; ~330 `rgba` fixas ainda podem falhar no Claro |
| Contraste | PRECISA MELHORAR | Sem opção de contraste; algumas telas do Claro ainda não revisadas |
| Ícones | PRECISA MELHORAR | Mistura de emoji e SVG; o Discord usa um conjunto de ícones uniforme |
| Bordas, raios e sombras | PRÓXIMO | Raios um pouco maiores em alguns cartões |
| Hover e seleção | PRÓXIMO | — |
| Selos | PRÓXIMO | — |
| Tooltips | PRÓXIMO | — |
| Menus de contexto | MUITO PRÓXIMO | `SancordUI.contextMenu` |
| Modais | PRÓXIMO | O diálogo de formulário é consistente; alguns modais antigos têm estilo próprio |
| Barras de rolagem | PRÓXIMO | — |
| Animações | PRÓXIMO | Curtas; respeitam "reduzir animações" |
| Páginas de configuração | PRECISA MELHORAR | Algumas páginas com selos de marketing ("WebRTC DTLS-SRTP Ativo", "Hash Salt Persistente") e textos promocionais |
| Voltar/Avançar (2026) | MUITO DIFERENTE | Não existem |

## 5. Microinterações (§46)

| Microinteração | Discord | Sancord |
|---|---|---|
| Indicador do servidor selecionado (pílula animada) | Sim | Parcial |
| Barra de ações ao passar o mouse na mensagem | Sim | ✅ |
| Tooltip nos ícones | Sim | ✅ |
| Marcador de não lido e divisor "novas" | Sim | ✅ |
| "Digitando" com animação | Sim | ✅ |
| Indicador de fala (anel verde) | Sim | ✅ (brilho) |
| Menu com animação curta | Sim | ✅ |
| Retorno visual ao arrastar | Sim | ✅ |
| Selo que aparece com animação | Sim | Parcial |
| Perfil rápido animado | Sim | ✅ |
| Prévia da mensagem respondida ao passar o mouse | Sim | ❌ |
| Mensagem recém-enviada aparece suavemente | Sim | ✅ |
| Avatar animado só ao passar o mouse | Sim | ❌ (GIF sempre anima) |
| Cópia confirmada ("Copiado!") | Sim | ✅ (toast) |
| Transição ao trocar de canal mantendo a rolagem | Sim | Parcial |

## 6. Jornadas (§47–49)

**Primeiro uso** (conta → entrar → amigo → servidor → convite → conversa → voz):
- Funciona sem passos quebrados.
- **Fricções:**
  - sem e-mail, uma senha esquecida perde a conta;
  - o convite depende de copiar o código ou link (há "convidar amigo" direto);
  - a voz falha entre redes restritivas sem TURN;
  - não há uma tela de boas-vindas guiada.

**Administrador** (servidor → canais → categorias → cargos → permissões → convite → moderar → auditoria):
- O fluxo está completo.
- **Lacunas:**
  - transferir propriedade;
  - motivo do ban e limpeza de mensagens;
  - revisão de denúncias;
  - permissões granulares de threads e eventos;
  - emojis do servidor.

**Social** (amigo → adicionar → conversar → chamar → grupo → tela):
- Tudo existe.
- **Lacunas:**
  - confiabilidade da chamada entre redes;
  - notas, "ignorar" e favoritas não sincronizam;
  - sem apelido de amigo nem atividade rica.

## 7. Recursos do Discord que NÃO recomendo implementar agora (§50)

| Recurso | Motivo |
|---|---|
| Nitro, Boost, loja, presentes, Orbs e Quests, Nitro Rewards | Monetização: fora do objetivo; os cosméticos do Sancord são grátis |
| Super reações, gradiente de cargo, temas pagos | Cosméticos pagos |
| Activities, jogos embutidos, overlay de jogo | Caro; depende de SFU e de um SDK |
| Server Discovery público, onboarding de Comunidade, regras, seguir anúncios | Escala atual é privada ou pequena |
| Stage para 10 mil e canais de mídia (assinaturas) | Escala e monetização |
| Clips, Soundmoji, Soundboard (por ora) | Pouco valor antes de voz confiável |
| Login por QR, conexões com contas externas (Spotify, Xbox), presença de jogos | Integrações externas caras para o tamanho atual |
| Central da Família no formato do Discord | Supervisão de menores exige processo jurídico; manter só controles próprios honestos |
| Server tags e Shop | Pouco valor |

## 8. Top 20 — o que mais falta para parecer um produto completo (§52)

Ordenado por impacto na qualidade do produto:

1. **Tirar o que é falso ou enganoso.** Ligar ou remover as 4 opções mortas, corrigir o texto de segurança, tornar "Status da conta" real ou retirá-lo, e renomear a "Central da Família".
2. **Publicar o que está pronto** (castigo, modo lento, tags) e pôr a produção como serviço que **sobe sozinho** depois de reiniciar o Windows. Hoje é manual.
3. **TURN provisionado e ensaio de voz entre redes:** sem isso, chamadas falham fora da rede local.
4. **E-mail na conta e recuperação de senha.**
5. **Sessões e dispositivos:** listar e encerrar; encerrar todas ao trocar a senha.
6. **Preview de links seguro** (unfurl no servidor).
7. **Transferir propriedade do servidor.**
8. **Ban com motivo e limpeza de mensagens,** mais exclusão em massa.
9. **Texto dentro do canal de voz.**
10. **Validar notificações nativas e contador** no `.exe`.
11. **SFU** para chamadas com mais de 5–6 pessoas.
12. **Emojis próprios do servidor.**
13. **Reply com ou sem menção e encaminhamento real** (snapshot, anexos, vários destinos).
14. **Silenciar com duração e silenciar categoria.**
15. **Editor de atalhos e página de Acessibilidade** (contraste, saturação).
16. **Sincronizar pela conta:** notas, "ignorar" e favoritas.
17. **Fila de revisão de denúncias** para moderadores.
18. **Menu de usuário completo** na lista de membros (mensagem, chamar, cargos, kick, ban).
19. **Virtualização da lista de mensagens.**
20. **Seletor de GIF**, escolhendo o provedor com atenção à privacidade.

## 9. Quick wins (§53)

Pouco trabalho, muito efeito, risco baixo:
- **Opções mortas:**
  - fazer "Exibir digitando" parar de enviar `Typing`;
  - remover o "Modo Foco" ou implementá-lo como silêncio de DMs de não amigos;
  - implementar a "Proteção de Links" como confirmação antes de abrir um domínio externo;
  - remover o toggle antigo de DM.
- **Textos de segurança corretos.** "Status da conta" mostrando castigos ou bans reais.
- **Versão sempre visível** em Atualizações e na tela de login.
- **Shift+Esc** para marcar o servidor como lido.
- **Ordenar o fórum** (atividade ou criação).
- **Botão "@" na barra de resposta** para mencionar ou não.
- **Duração ao silenciar** servidor ou canal (preferência no cliente já sincronizada; só o prazo).
- **Menu de usuário na lista de membros:** acrescentar mensagem, chamar, adicionar amigo, kick e ban (as ações já existem).
- **Motivo opcional no ban e no kick,** gravado na auditoria.
- **Esconder "Copiar ID" atrás de um "Modo desenvolvedor".**
- **Avatar GIF animando só ao passar o mouse.**

## 10. Grandes recursos ainda ausentes (§54)

| Recurso | Tamanho | Dependências |
|---|---|---|
| E-mail, verificação e recuperação de senha | Médio | Serviço de envio de e-mail (SMTP), política de dados |
| Sessões e dispositivos, MFA (TOTP e backup) | Médio a grande | E-mail para recuperação |
| TURN provisionado | Pequeno a médio | Uma VPS com porta UDP aberta |
| SFU (servidor de mídia) | Muito grande | Escolher a tecnologia (por exemplo, um SFU Rust ou externo), sinalização nova |
| Preview de links | Médio | Busca no servidor com limites, cache e proxy de imagens |
| Emojis e stickers do servidor | Médio | Armazenamento de mídia (já existe para anexos), permissões |
| Texto no canal de voz | Médio | Reaproveitar mensagens com o id do canal de voz |
| Virtualização da lista de mensagens | Grande | Refatorar a renderização do chat em `app.js` |
| Bots com conexão em tempo real e comandos | Grande a muito grande | Tokens de integração (já existem) |
| Perfil por servidor | Médio | Modelo de membro com apelido e avatar |
| Transferir propriedade | Pequeno | — |

## 11. Dívida técnica (§55)

- **Somente visual:** `showTyping`, `familyFocus`, `linkGuard` e `friendsOnlyDm` são gravados e nunca lidos (`static/app.js`).
- **Texto incorreto:** "Senha e segurança" atribui DTLS-SRTP às mensagens.
- **Página fixa:** "Status da conta" sempre "Tudo certo".
- **Estado só local:**
  - notas (`sancord_user_notes`);
  - favoritas (`sancord_starred_msgs`);
  - ignorar (`sancord_ignored_users`).

  O bloqueio já sincroniza pelo servidor, mas convive com uma lista local antiga (`sancord_blocked_users`).
- **Monólitos:**
  - `static/app.js` com ~7,7 mil linhas;
  - `styles.css` com ~7,8 mil linhas e várias camadas de sobrescrita (algumas regras específicas do tema Claro);
  - ~330 `rgba` e ~150 hex fixos no JS.
- **Backend sem interface:**
  - denúncias (`ReportUser` grava, ninguém revisa);
  - sessões (existem no banco, sem tela).
- **Escala de mídia:** a malha P2P não escala; não há TURN provisionado.
- **Operação:**
  - a produção é iniciada à mão, não sobe depois de reiniciar o Windows;
  - o túnel cloudflared "rápido" muda de URL a cada reinício (mitigado pela descoberta assinada).
- **Fontes à frente da produção:**
  - schema v13 nos fontes, v10 em produção;
  - três recursos prontos sem publicar.
- **Limite por IP:** atrás do túnel, todos chegam como 127.0.0.1, então o limite de tentativas é por conta, não por IP (`auth.rs`).
- **Modo lento:** o registro do último envio é só em memória (aceitável e documentado).
- **Não validado:** janela nativa, notificações nativas, mídia física e entre redes.

---

## 12. Roteiro recomendado (§59)

**Etapa A — bugs e coisas incompletas ou enganosas** (curta)
1. Ligar ou remover as 4 opções mortas. Corrigir o texto de segurança. "Status da conta" real. Renomear a "Central da Família".
2. Publicar a próxima versão (castigo, modo lento e tags), com CI, assinatura e migração v10→v13 da produção, como foi feito na 0.2.0.
3. Produção como serviço que sobe sozinho (tarefa agendada ou serviço do Windows) e túnel com URL estável (túnel nomeado).
4. Validar no `.exe`: notificações nativas, contador e atualização pela interface.
5. Sincronizar notas, "ignorar" e favoritas pela conta; remover a lista local de bloqueio antiga.

**Etapa B — núcleo que falta**
1. E-mail na conta, verificação e recuperação de senha.
2. Sessões e dispositivos (listar, encerrar; encerrar todas ao trocar a senha).
3. Transferir propriedade do servidor.
4. Ban e kick com motivo; limpeza de mensagens no ban; exclusão em massa.
5. Excluir ou desativar conta.

**Etapa C — UX de chat e social**
1. Preview de links seguro.
2. Reply com ou sem menção e encaminhamento real.
3. Silenciar com duração e silenciar categoria; caixa de entrada de menções.
4. Menu de usuário completo e perfil por servidor (apelido).
5. Emojis próprios do servidor (reações, mensagens, autocompletar).
6. Ordenar o fórum; membros e "seguir" thread; arquivamento automático.
7. Seletor de GIF.

**Etapa D — voz e vídeo**
1. TURN provisionado e roteiro físico entre duas redes (voz, câmera, tela, reconexão).
2. Texto dentro do canal de voz.
3. Supressão de ruído melhor.
4. SFU (projeto grande, com protótipo antes).
5. Pop-out de tela; bitrate por canal.

**Etapa E — administração e moderação**
1. Fila de revisão de denúncias.
2. AutoMod com ação de castigo; nível de verificação.
3. Permissões granulares: criar threads, gerenciar eventos, apelidos.
4. Eventos com início, fim e aviso aos interessados.

**Etapa F — polimento visual**
1. Lista de canais redimensionável; Voltar/Avançar.
2. Conjunto de ícones SVG uniforme (sem emojis como ícones de interface).
3. Eliminar as `rgba` fixas restantes; revisar o tema Claro em todas as telas.
4. Página de Acessibilidade (contraste e saturação) e editor de atalhos.
5. Microinterações: pílula do servidor, prévia da resposta, avatar animado só ao passar o mouse.
6. Virtualização da lista de mensagens; dividir o `app.js` em módulos.

**Etapa G — recursos avançados**
1. Bots com conexão em tempo real e comandos de barra.
2. Stickers; soundboard (se fizer sentido).
3. MFA (TOTP); passkeys mais adiante.
4. Galeria de fórum, canais de mídia e stage, se a escala pedir.

---

## Fontes de referência do Discord (consultadas em 18/11/2026)

- [Notas oficiais de 09/11/2026](https://discord.com/blog/discord-patch-notes-november-9-2026)
- [Atualização de 24/03/2026](https://discord.com/blog/discord-update-march-24-2026-changelog)
- [Notas de 04/08/2026](https://discord.com/blog/discord-patch-notes-august-4-2026)
- [Notas de 04/02/2026](https://discord.com/blog/discord-patch-notes-february-4-2026)
- [Reforma visual de 25/03/2025](https://discord.com/blog/discord-update-march-25-2025-changelog)
- [Engadget sobre a reforma](https://www.engadget.com/gaming/pc/discords-redesigned-pc-app-has-multiple-dark-modes-a-new-overlay-and-more-160019822.html)
- [Encaminhar mensagens](https://support.discord.com/hc/en-us/articles/24640649961367-Message-Forwarding)
- [Enquetes](https://support.discord.com/hc/en-us/articles/22163184112407-Polls-FAQ)
- [Texto em canais de voz](https://support.discord.com/hc/en-us/articles/4412085582359-Text-Channels-Text-Chat-In-Voice-Channels)
- [Soundboard](https://support.discord.com/hc/en-us/articles/12612888127767-Discord-Soundboard-Guide-Using-Adding-and-Managing-Sounds)
- [Stage](https://support.discord.com/hc/en-us/articles/1500005513722-Stage-Channels-FAQ)
- [Canais de mídia](https://creator-support.discord.com/hc/en-us/articles/14346342766743-Media-Channels-for-Server-Subscriptions-BETA)
- [MFA](https://support.discord.com/hc/en-us/articles/219576828-Setting-up-Multi-Factor-Authentication)
- [Passkeys](https://support.discord.com/hc/en-us/articles/25966860846231-Security-Keys-Passkeys-and-Passwordless-Login-on-Discord)
- [DAVE: criptografia de chamadas por padrão (05/2026)](https://www.macrumors.com/2026/05/20/discord-voice-video-calls-e2ee-default/)

## Histórico deste documento

- 18/11/2026 — primeira auditoria completa (Claude).
- 18/11/2026 — Etapa A, item 1, feito nos fontes (versão 0.2.1, não publicada): opções mortas ligadas ou removidas, textos de segurança corrigidos, Status da conta real e Central da Família renomeada para Foco e segurança.
- 18/11/2026 — Etapa A, item 2, concluído e publicado (**v0.2.1**, commit `8123c3cb`, run `44379590944`): refatoração visual desktop (`ui.css` + `icons.js`), ajustes de contraste e responsividade, release assinada publicada no GitHub e produção atualizada para 0.2.1 (banco migrado de v10 para v13).
- 18/11/2026 — Etapa A (itens 3 e 5) e Etapa B completa (itens 1 a 5) implementadas e validadas (**v0.2.2**, schema `v14`): autostart do host no Windows (`scripts/install-autostart.ps1` + `scripts/start-host.ps1`), sincronização de notas/favoritas/ignorados na conta (`UserPrefs`), e-mail opcional e recuperação de senha por código único (`POST /api/recover-password`), gerenciamento de sessões e dispositivos ativos (`ListSessions`/`RevokeSession`), transferência de posse de servidor (`TransferServerOwnership`), expulsão/banimento com motivo persistido (`bans.reason`), limpeza de histórico no banimento, exclusão de mensagens em lote (`BulkDeleteMessages`) e exclusão da própria conta (`DeleteAccount`).
