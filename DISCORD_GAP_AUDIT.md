# Auditoria de paridade — Sanvo (legado: Sancord) × Discord Desktop

> **Nome atual do projeto:** **Sanvo** (`Sanvo Desktop`) · **Nome legado:** `Sancord`.

Documento vivo. Atualize as linhas quando um item mudar de estado e anote a data no histórico, no fim do arquivo.

## 0. Identificação

| Campo | Valor |
|---|---|
| Data da atualização de perfis, composer e voz | 19/11/2026 |
| Autoria | Auditoria inicial por Claude e atualização por Codex |
| Sancord publicado | Tag estável **v0.2.3** (`af2ff0d`) no GitHub, com esquema 19 |
| Sancord nos fontes | Perfis, mural, composer, gravação de mensagens de voz, fila de agendamentos e nova organização das chamadas, com esquema 21 |
| Tamanho no levantamento de 18/11 | Rust ~19 mil linhas (39 arquivos), `app.js` ~7,7 mil linhas, 15 módulos JS, `styles.css` ~7,8 mil linhas e `ui.css` ~1,1 mil linhas |
| Protocolo no levantamento de 18/11 | 84 tipos de pedido do cliente (`ClientMessage`) e 47 tipos de evento do servidor (`ServerMessage`) |
| Testes | 381 aprovados, com 167 de núcleo, 8 desktop, 1 de manutenção e 205 de frontend. Um ensaio de assinatura ignorado localmente. |
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
   - **Notificações:** ~~sem duração de silêncio nem silêncio por categoria~~ (feito na Etapa C3, fontes). Falta: DM silenciada ainda mostra o contador.
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
| Servidores | **70%** | Estrutura, convites, pastas, arrastar e perfil por servidor nos fontes. Faltam transferir propriedade e integrações de comunidade (onboarding, regras). |
| Social | **72%** | Amigos, DMs, solicitações e grupos completos. Notas e "ignorar" só locais, sem atividade rica, sem apelido de amigo. |
| Voz | **40%** | Funciona em malha P2P com filtros próprios e PTT. Sem SFU (escala), sem TURN provisionado, sem validação entre redes, sem texto na voz, sem soundboard. Testes físicos limitados. |
| Vídeo e tela | **40%** | Câmera, tela, janela e áudio de sistema existem. Webcam física não validada, sem pop-out, um modelo só de grade e foco, escala limitada pela malha. |
| Moderação | **65%** | Kick, ban, castigo, modo lento, AutoMod e auditoria. Faltam motivo e limpeza de mensagens no ban, exclusão em massa, revisão de denúncias, AutoMod que aplica castigo, nível de verificação e proteção contra raid. |
| Configurações | **86%** | Central desktop completa com 22 páginas reais em 4 grupos (`CONTA`, `PRIVACIDADE E SOCIAL`, `CONFIGURAÇÕES DO APP`, `SANCORD`), busca profunda com rolagem/destaque, Acessibilidade (movimento, GIFs, cosméticos, saturação, alto contraste, cores de cargo, TTS, foco), Chat & Mensagens, gerenciador de atalhos com detecção de conflito, Configurações do Windows via IPC nativo, Avançado/Modo Desenvolvedor, Diagnóstico sanitizado e Sobre com licenças reais. Pendentes: TOTP/Passkey, OAuth de plataformas externas além do GitHub e detecção nativa de jogos. |
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
| Cadastro | E-mail, senha, data de nascimento e verificação | Card central com nome de usuário e senha. Validação inline e confirmação de unicidade no servidor | ✅ | Verificação por e-mail depende de decisão de produto | P1 | M | Envio de e-mail |
| Login | E-mail ou telefone e senha, QR e passkey | Card único com usuário e senha, estados de conexão, limite de tentativas e seleção de conta salva | ✅ | Passkey depende de suporte no backend | P3 | A | Infraestrutura de autenticação |
| Login por QR | Aprovação no aplicativo mobile | Autenticação da build atual em uma coluna | — | Fora do escopo enquanto não houver aplicativo mobile e aprovação real | — | — | Sancord Mobile |
| Logout | Sim | Sim | ✅ | — | — | — | — |
| Manter sessão | Sim | Sessão persistente ou temporária, cifrada com DPAPI no Windows e isolada por servidor | ✅ | — | — | — | — |
| Recuperação de senha | Por e-mail | Tela integrada com código de uso único gerado nas configurações da conta. A redefinição revoga sessões antigas | ✅ | Envio de instruções por e-mail depende de infraestrutura própria | — | — | — |
| Alterar senha | Sim, exige a atual | Sim (`ChangePassword`) | ✅ | Encerrar as outras sessões ao trocar | P1 | B | Sessões |
| Alterar e-mail | Sim | E-mail opcional alterado nas configurações com a senha atual | 🟡 | Verificação do endereço | P1 | M | Envio de e-mail |
| Alterar username | Sim | Sim (`UpdateUsername`), migra cargos, castigos e convites | ✅ | — | — | — | — |
| Nome de exibição | Separado do username | Nome de usuário único; nome de exibição parcial no perfil | 🟡 | Separar nome de exibição e @username de forma consistente | P2 | M | — |
| Sessões e dispositivos | Lista e encerrar sessão | Configurações listam e revogam sessões. O login restaura sessões válidas e oferece as contas salvas | ✅ | — | — | — | — |
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
| Emoji | Unicode e do servidor | Unicode e do servidor (Etapa C5, fontes) | ✅ | Publicar | — | — | §34 |
| GIF | Seletor integrado | Seletor local (Etapa C7): favoritos na conta e GIFs das conversas; sem busca na internet | 🟡 | Busca externa (decisão: sem provedor por enquanto) | P3 | M | Provedor e chave |
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
| Silenciar e marcar como lido | Sim, com duração | Sim, com duração (Etapa C3, fontes) | ✅ | Publicar | — | — | — |
| Menu de contexto do servidor | Amplo | Marcar lido, convidar, silenciar, notificações, configurações, sair | ✅ | — | — | — | — |
| Perfil por servidor (apelido, avatar) | Sim | Apelido, avatar, banner e bio com herança global (Perfil P5, fontes) | ✅ | Cosméticos e status configuráveis por servidor | P3 | M | — |
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
| Fórum | Sim (tags, ordenar, galeria, diretrizes) | Sim, com tags, filtro e ordenar (Etapa C6); sem galeria, sem diretrizes | 🟡 | Diretrizes e galeria | P3 | B | — |
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
| Reply com ou sem menção (@ON/OFF) | Sim | Botão "@" na barra de resposta (Etapa C2, fontes) | ✅ | Publicar | — | — | — |
| Encaminhar | Snapshot imutável, até 5 destinos, com anexos, marcado como encaminhado | Cópia congelada com anexos e prévias, até 5 destinos, comentário opcional (Etapa C2, fontes) | ✅ | Publicar | — | — | — |
| Reações múltiplas, contagem e quem reagiu | Sim | Sim, inclusive com emojis do servidor (Etapa C5, fontes) | ✅ | — | — | — | §34 |
| Super reações | Pago | — | 🚫 | — | — | — | — |
| Fixar e painel de fixadas | Sim | Sim | ✅ | — | — | — | — |
| Copiar texto, link e ID | ID só no modo desenvolvedor | Sim; ID sempre visível | 🟡 | Esconder ID atrás de "Modo desenvolvedor" | P3 | B | — |
| Barra ao passar o mouse | Sim | Sim (reações rápidas e ações; testado) | ✅ | — | — | — | — |
| Menu de contexto da mensagem | Amplo | 4 reações rápidas e 11 ações (testado) | ✅ | "Criar thread" e "Falar mensagem" (P3) | — | — | — |
| Markdown, spoiler, código, citação, listas, links | Sim, com títulos e subtexto | Sim (exceto títulos `#` e subtexto `-#`) | 🟡 | Títulos e subtexto | P3 | B | — |
| Menções @user, @cargo, @todos, @online e #canal | Sim | Sim, com autocompletar e destaque | ✅ | Clicar em @cargo lista os membros (2026) | P3 | B | — |
| Preview de links (embeds) | Título, descrição e imagem, seguro | Gerado no servidor com proteção SSRF e proxy de imagem (Etapa C1, fontes) | ✅ | Publicar | — | — | — |
| Emoji Unicode, seletor, busca e recentes | Sim | Sim | ✅ | — | — | — | — |
| Emoji próprio do servidor | Sim | Sim (Etapa C5, fontes) | ✅ | Publicar | — | — | — |
| GIF (seletor) | Sim (Tenor) | Sim, local (Etapa C7, fontes): ☆ para favoritar GIFs do chat, abas Favoritos/Nas conversas, envio com um clique; nenhum dado sai para terceiros | 🟡 | Busca na internet ficou de fora por decisão (privacidade e chave de API) | P3 | M | Chave de API |
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
| Participantes, "seguir" e membros da thread | Sim | Sim (Etapa C6, fontes): quem cria ou escreve segue; Seguir/Deixar de seguir; lista lateral mostra quem segue | ✅ | Notificar seguidores por padrão | P3 | — | — |
| Arquivamento automático por inatividade | Sim (1 h a 1 semana) | Sim (Etapa C6, fontes): 1 h, 24 h (padrão), 3 dias ou 1 semana | ✅ | Publicar | — | — | — |
| Notificações por thread | Sim | Sim (nível por thread) | ✅ | — | — | — | — |
| Permissões | Criar threads públicas e privadas, enviar em threads | Herda do canal-pai (enviar mensagens) | 🟡 | Permissões próprias e threads privadas | P2 | M | — |

### 18. Fóruns

| Recurso | Discord | Sancord | St | Falta | P | Dif | Dep |
|---|---|---|---|---|---|---|---|
| Postagens com título, conteúdo e respostas | Sim | Sim | ✅ | — | — | — | — |
| Tags (moderadas), até 5 por post | Sim | Sim (fontes, não publicado) | ✅ | Publicar | — | — | — |
| Busca e filtro por tag | Sim | Sim | ✅ | — | — | — | — |
| Ordenar (atividade ou criação) | Sim | Sim (Etapa C6, fontes), lembrado por fórum neste aparelho | ✅ | Ordem padrão definida pela moderação | P3 | — | — |
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
| Reconexão e perda de pacote | Robustas | Retomada sinalizada e confirmada pelo servidor após reconectar. Câmera e tela param durante a queda. | 🟡 | Validar fluxo de áudio entre redes independentes sob perda de pacote | P1 | M | TURN |
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
| Criar threads (pública e privada), enviar em threads, criar enquetes, emojis externos, soundboard, apelidos, eventos, webhooks | Granulares | Apelidos (`change_nickname`, `manage_nicknames`, C4) e expressões (`manage_expressions`, C5) separados; o resto não | 🟡 | P2: criar threads, gerenciar eventos |
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
| Avatar (com GIF), banner, nome, username, bio, pronomes | Sim (GIF é pago) | Sim (Perfil P1, fontes): avatar e banner como arquivo validado com cache imutável, recorte de banner em faixa, bio de 300 com markdown seguro | ✅ | — |
| Status e status personalizado | Sim | Sim, com prazo | ✅ | — |
| Cargos, data de entrada, servidores e amigos em comum | Sim | Sim | ✅ | — |
| Tema e decorações de perfil | Sim | Tema sólido ou gradiente, decoração em dois planos e molduras adaptadas por contexto, com validação de posse | ✅ | Homologação da reação à fala em chamada entre redes |
| Efeitos de perfil | Sim | Entrada única, replay e pausa da moldura. Efeito capturado no WebView2 e equipamento validado pelo servidor | ✅ | — |
| Nameplates e estilos de nome | Sim | Gradiente configurável, amostras com o próprio nome, prévias clara e escura e controle de movimento | ✅ | — |
| Perfil por servidor | Sim | Apelido, avatar, banner, bio, nome, tema e cosméticos com herança por campo, comparação e prévia ao vivo | ✅ | Estado personalizado por servidor |
| Selos (badges) | Sim | Sim (Perfil P2, fontes): badges de confiança e cosméticas concedidas só pelo servidor (arquivo do operador + automáticas), com ícones próprios | ✅ | Painel de administração para conceder |
| Coleções e presets | Sim | Minha Coleção, favoritos, presets e combinação aleatória com paleta que vai ao rascunho antes de salvar | ✅ | — |
| Mural, conexões e privacidade do perfil | — | Mural P6 persistido com widgets, links e audiência própria | 🟡 | Conexões verificadas e privacidade dos demais campos |

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
| Silenciar categoria | Sim | Sim (Etapa C3, fontes): vale para os canais e threads dela | ✅ | Publicar | — |
| Duração do silêncio | Sim | 15 min, 1 h, 3 h, 8 h, 24 h ou até reativar, em servidor, categoria, canal, thread, DM e grupo; volta sozinho no prazo (C3, fontes) | ✅ | Publicar; o contador de DM silenciada ainda aparece | P3 |
| Caixa de entrada (Inbox de menções) | Sim | Só menções (diretas, @everyone e cargos seus), recorte "todos"/"este servidor", não lidas marcadas, clique leva à mensagem (C3, fontes) | 🟡 | Sem abas "Não lidas"/"Para você" do Discord | P3 |

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
| Emojis e stickers | Sim | Emojis sim (Etapa C5); stickers não | 🟡 (stickers P3) |
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
| Emojis próprios (envio, gerenciamento, uso em reações e mensagens) | Sim | Sim (Etapa C5, fontes): aba Emojis nas configurações, até 50 por servidor, PNG/JPG/GIF/WebP até 256 KB, permissão `manage_expressions`, código `<:nome:id>`, seletor, autocompletar, reações e uso em outros servidores para quem é membro | ✅ | Publicar | — | — |

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
| Servidor | Marcar lido, convidar, silenciar com duração (C3), notificações, configurações, criar canal/categoria, copiar ID, sair | — |
| Canal | Marcar lido, copiar link, silenciar com duração (C3), notificações, editar, excluir, permissões | Convidar |
| Categoria | Editar, excluir, recolher, marcar como lida e silenciar com duração (C3) | — |
| Mensagem | Completo (§15) | "Criar thread" no menu da mensagem (existe por outro caminho) |
| Usuário (lista de membros) | Perfil, mensagem, ligar, mencionar, amizade, apelido, cargos, copiar nome/ID, bloquear, castigo, expulsar, banir, transferir posse (Etapa C4) | Volume (existe só no menu da voz) |
| Usuário na voz | Perfil, volume, silenciar para mim, moderação de voz, castigo | — |
| DM e grupo | DM: abrir, marcar como lida, silenciar com duração, notificações (C3). Grupo: abrir, adicionar, editar, silenciar com duração, sair | Fechar DM da lista |

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
| Avatar animado só ao passar o mouse | Sim | ✅ (Perfil P1, fontes): "Animações de perfil" Sempre / Só ao passar o mouse / Nunca, e "Reduzir animações" (app ou Windows) desliga |
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
12. ~~**Emojis próprios do servidor.**~~ Feito na Etapa C5 (fontes).
13. **Reply com ou sem menção e encaminhamento real** (snapshot, anexos, vários destinos).
14. ~~**Silenciar com duração e silenciar categoria.**~~ Feito na Etapa C3 (fontes), com caixa de menções.
15. **Editor de atalhos e página de Acessibilidade** (contraste, saturação).
16. **Sincronizar pela conta:** notas, "ignorar" e favoritas.
17. **Fila de revisão de denúncias** para moderadores.
18. ~~**Menu de usuário completo** na lista de membros~~ Feito na Etapa C4 (fontes), com apelido por servidor.
19. **Virtualização da lista de mensagens.**
20. ~~**Seletor de GIF**~~ Feito na Etapa C7 (fontes), só local; busca externa adiada por decisão do usuário.

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
- ~~**Ordenar o fórum**~~ (feito na Etapa C6, fontes).
- **Botão "@" na barra de resposta** para mencionar ou não.
- ~~**Duração ao silenciar** servidor ou canal~~ (feito na Etapa C3, fontes).
- ~~**Menu de usuário na lista de membros**~~ (feito na Etapa C4, fontes).
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
- 18/11/2026 — Etapa A (itens 3 autostart e 5) e Etapa B completa (itens 1 a 5) implementadas, publicadas e colocadas em produção (**v0.2.2**, commit `fd10d6ee`, tag `v0.2.2`, run `44393805417`, schema `v14`): autostart do host no Windows (`scripts/install-autostart.ps1` + `scripts/start-host.ps1`), sincronização de notas/favoritas/ignorados na conta (`UserPrefs`), e-mail opcional e recuperação de senha por código único offline (`POST /api/recover-password`, sem SMTP externo), gerenciamento de sessões e dispositivos ativos (`ListSessions`/`RevokeSession`), transferência de posse de servidor (`TransferServerOwnership`), expulsão/banimento com motivo persistido (`bans.reason`), limpeza de histórico no banimento, exclusão de mensagens em lote (`BulkDeleteMessages`) e exclusão da própria conta (`DeleteAccount`). Pendentes de infraestrutura externa/validação manual na Etapa A: túnel nomeado fixo (requer domínio Cloudflare) e conferência nativa no `.exe` para notificações/updater (A.4). Próxima fase do roteiro: **Etapa C — UX de chat e social** (e/ou **Etapa D.1 — TURN provisionado**).

- 18/11/2026 — Etapa C1 (prévia de links) nos fontes; corrigido bug de mensagens sobrepostas da 0.2.2 (Claude).
- 18/11/2026 — Etapa C2 (resposta com/sem menção e encaminhamento real) nos fontes (Claude).
- 18/11/2026 — Etapa C3 (silenciar por tempo em todos os níveis, silenciar categoria, caixa de menções) nos fontes (Claude).
- 18/11/2026 — Etapa C4 (menu completo do usuário e apelido por servidor; esquema v15) nos fontes (Claude).
- 18/11/2026 — Etapa C5 (emojis próprios do servidor; esquema v16) nos fontes (Claude).
- 19/11/2026 — Etapa C6 (ordenar fórum, membros e seguir thread, arquivamento automático) nos fontes (Claude).
- 19/11/2026 — Etapa C7 (seletor de GIF local com favoritos; sem serviço externo, por decisão) nos fontes (Claude). Etapa C concluída nos fontes.
- 19/11/2026 — Perfil P1 (mídia por anexo, catálogo de cosméticos validado, tema completo, bio markdown, política de animação, prévia em contextos) nos fontes (Claude).
- 19/11/2026 — Perfil P2 (11 decorações novas, 29 molduras incluindo reativas, por conquista e de temporada, badges do servidor, seletor de cosméticos) nos fontes (Claude).
- 19/11/2026 — Perfil P3 (efeitos de entrada, replay, interrupção em segundo plano e coordenação com a moldura) nos fontes.
- 19/11/2026 — Expansão completa da Central de Configurações (22 páginas em 4 grupos, busca profunda, IPC Windows Desktop) e reforma completa do sistema de convites de servidores nos fontes (esquema **v19**, modal de 2 páginas `static/js/invites.js`, prévia rica com regras, DM InviteCard ao vivo, tombstone de revogação, link personalizado `SetCustomInviteSlug`, pausa/retomada `SetInvitesPaused`, associação temporária com limpeza na desconexão, permissão `manage_invites` e sobrescrita por canal, rate limits, **368 testes automatizados** e conferência visual/funcional concluída no executável real `SancordApp.exe` WebView2 em `1366×768` e `1920×1080`).

### 19/11/2026 · Refatoração visual de perfis nos fontes

| Área | Sancord após a refatoração | Escopo conferido |
|---|---|---|
| Cartão rápido e perfil completo | Banner de ponta a ponta, avatar sobreposto à esquerda, ações por contexto, identidade compartilhada e molduras adaptadas | Cartão no desktop e perfil completo com mural |
| Editor | Rascunho ao vivo, tema claro/escuro independente, nome real nas amostras, replay e aviso ao descartar | Cartão e perfil completo usam os renderizadores da visita. As outras superfícies têm amostras do contexto. |
| Perfil por servidor | Comparação global/local, herança por campo e prévia do formulário | Apelido, mídia, bio, tema, estilo de nome e cosméticos da conta |
| Cosméticos | Arte em camadas para Sancord Core, Cosmic e Sakura, seletor pesquisável de decoração e moldura, amostra de efeito | As três coleções receberam arte de referência. Os IDs do catálogo anterior continuam disponíveis. |
| Movimento e contraste | Replay controlado, preferências por tipo, redução de movimento e fallback estático | Limites existentes de superfície e GIF preservados |
| Mural | Autoria preservada na transferência e consulta limitada de mensagens fora do lock | O esquema aditivo 20 cria o índice por autor. A recuperação de autoria anterior depende da existência do convite original. |

Referências de hierarquia e interação desktop. [Perfis personalizados](https://support.discord.com/hc/en-us/articles/4403147417623-Custom-Profiles) · [Molduras](https://support.discord.com/hc/en-us/articles/40775065582615-Profile-Frames-FAQ) · [Estilos de nome](https://support.discord.com/hc/en-us/articles/33833879643927-Discord-Display-Name-Styles-FAQ)

### 19/11/2026 · Composer e chamadas desktop

| Área | Disponível nos fontes | Escopo |
|---|---|---|
| Composer | Menu `+` ancorado, ações por contexto, rascunho por conversa, atalhos e barra de resposta | Textos, DMs, grupos, threads, canais de voz e anúncios usam as permissões existentes. |
| Anexos | Seleção múltipla, arrastar, colar, miniaturas, progresso e repetição após falha | O upload começa ao enviar. Rascunhos e uploads ficam associados à conversa original. |
| GIF e Emoji | GIFs de conversas, recentes e favoritos. Emoji Unicode, categorias, busca e emoji de servidor | GIFs animam no hover ou foco. A busca funciona sobre o acervo disponível no cliente. |
| Figurinhas | Coleção original, importação, figurinhas do servidor, recentes e favoritos | O servidor valida tipo, dimensões e tamanho. A aba Servidor usa figurinhas das conversas carregadas. Favoritos ficam neste aparelho. |
| Enquete | Campos de opções separados, duração, escolhas múltiplas e envio | Usa os votos, a persistência, as permissões e o AutoMod existentes. |
| Mensagem de voz | Captura, forma de onda, cancelamento, reprodução e envio | Gravação separada da mídia das chamadas. O ensaio Windows usou microfone virtual. |
| Tópicos | Criação no menu `+` em canal elegível e no menu de uma mensagem | Mantém a regra de leitura e escrita do canal pai. |
| Agendamento | Horários rápidos, data local, fila privada, cancelamento e entrega com o cliente fechado | Texto em até 30 dias. SQLite 21 e revalidação de permissões, AutoMod e modo lento no horário de envio. |
| Apps e comandos | `/anexar`, `/enquete`, `/topico` e `/agendadas` | Clipes e comandos de apps de terceiros continuam como trabalho futuro. |
| Chamadas | Sala, participantes e dock separados. Perfil compartilhado, volume local e palco privado | Estados de fala e mídia usam a sessão atual. O painel de qualidade usa estatísticas WebRTC existentes. |

Referências de ergonomia para ações, anexos e navegação em voz. [Anexos](https://support.discord.com/hc/en-us/articles/25444343291031-File-Attachments-FAQ) · [Enquetes](https://support.discord.com/hc/en-us/articles/22163184112407-Polls-FAQ) · [Canais de voz](https://support.discord.com/hc/en-us/articles/19583625604887-Voice-Channels-FAQs) · [Chat da sala de voz](https://support.discord.com/hc/en-us/articles/4412085582359-Text-Channels-Text-Chat-In-Voice-Channels)

### 22/11/2026 · Jornadas de perfil e personalização no desktop

A inspeção do Discord Desktop cobriu o menu do próprio perfil, a abertura de um perfil pelo menu de contexto, o perfil completo, o editor e o seletor de estilo do nome. O Sancord usa essas jornadas como referência e mantém suas superfícies de Configurações, cores e arte. [Perfis personalizados](https://support.discord.com/hc/en-us/articles/4403147417623-Custom-Profiles) · [Estilos de nome](https://support.discord.com/hc/en-us/articles/33833879643927-Discord-Display-Name-Styles-FAQ) · [Widgets](https://support.discord.com/hc/en-us/articles/35344672307607-Profile-Widgets-FAQ)

| Área | Resultado no Sancord | Diferenças e escopo |
|---|---|---|
| Cartão rápido e completo | Avatar sobreposto à esquerda, nome, usuário, selos, pronomes, status, bio, cargos, conexões, data e nota privada conforme o contexto. A nota do cartão rápido usa o mesmo armazenamento do perfil completo. | O cartão rápido tem 334 px no desktop de QA, altura conforme o conteúdo e rolagem para perfis longos. Mantém “Perfil completo” como ação explícita. |
| Editor e seletores | Configurações, personalização, perfil e mural em colunas quando há espaço. A prévia usa o renderer de identidade da visita. Cada seletor mostra sua categoria, aplica ao rascunho ou cancela, e a barra geral salva o perfil. | A navegação de Configurações permanece no Sancord. Seletores usam a coluna do editor. A referência observada abria o seletor de nome em uma janela sobreposta. O mural do Sancord vira painel recolhível em espaço menor. |
| Cosméticos | Arte original em planos frontal e traseiro para Órbita, Portal Galáctico e Sakura. Molduras Core, Cosmic e Sakura têm cantos vetoriais, laterais e detalhes segmentados. Sinal Core, Rastro Celeste e Brisa de Pétalas têm arte animada de entrada com replay. As placas Core, Brasa e Maré ganharam padrões e brilho. | A maior parte do catálogo anterior conserva a arte existente. A inspeção de movimento cobriu amostras, e cada item e combinação ainda pode ser validado individualmente. A coleção usa a posse do catálogo Sancord. |
| Nome exibido e perfil por servidor | Fonte, efeito e cores podem ser combinados. O estilo combinado usa o campo existente e cada peça é validada pelo backend. A prévia local continua mostrando a herança de campos globais. | O perfil por servidor ainda abre o formulário próprio do Sancord. Fontes e efeitos têm opções do seu catálogo. Clientes antigos mostram texto para estilos novos e a composição exige o backend que a valida. |
| Mural e atividade | Abas Mural, Atividade e Lista de desejos. A lista de desejos projeta widgets “Quero jogar”, com o mesmo armazenamento e visibilidade do mural. | O catálogo de dados do Sancord permite jogos cadastrados pelo usuário e links próprios. O limite é de oito widgets por mural, e não há catálogo de jogos integrado. |
| Menu próprio, painel e membros | O avatar no menu abre o perfil completo. Status, coleção, insígnias, alternância de conta e copiar ID seguem os controles existentes. A lista continua agrupando cargos destacados, Disponível e Offline. | Engrenagem, microfone e fone têm controles independentes no painel próprio do Sancord. |

O QA do `SancordApp.exe` capturou cartão e cosméticos em 1366×768, 1920×1080 e 2560×1440. Os ensaios incluem efeito durante a abertura, movimento reduzido, editor, contexto Claro, molduras, perfil por servidor e menu do próprio usuário. O mesmo executável, com backend Rust isolado, passou por login, troca de presença, cancelamento, aplicação e salvamento. Uma segunda conta leu pela rede a combinação fonte+efeito, a decoração e a lista de desejos salvas. As capturas de `qa-profile-parity/` usam contas descartáveis e arte do Sancord. A segunda rodada no Discord foi interrompida, portanto a comparação manual ficou limitada às jornadas observadas.

### 22/11/2026 · Login, cadastro e recuperação no Windows

- O fluxo abre com um card de 448 px em uma coluna, logo Sancord e barra de título nativa. Login, criação de conta e redefinição de senha compartilham a mesma superfície. O formulário usa apenas os campos aceitos pelo backend. O fluxo atual prescinde de QR, telefone e data de nascimento.
- A ação principal mostra o carregamento até o WebSocket confirmar o usuário. Erros de autenticação aparecem junto aos campos. Indisponibilidade do servidor oferece nova tentativa e problemas de credencial têm resposta neutra.
- A recuperação usa código já gerado pelo titular da conta. O backend consome o código, redefine a senha e revoga as sessões anteriores. MFA, passkeys e verificação por e-mail dependem de infraestrutura que o produto ainda precisa definir.
- O cliente Windows cifra os tokens e as contas salvas via DPAPI, com ligação à origem do servidor. A migração remove as chaves legadas depois de gravar o valor protegido. Quando o usuário escolhe uma sessão temporária, o aplicativo pede login ao reabrir. Conexões remotas de autenticação exigem HTTPS.
- O QA nativo usa o backend Rust em loopback e contas descartáveis. As capturas estão em `qa-auth/`. A centralização foi conferida em 1366×768, 1600×900, 1920×1080 e 2560×1440, com escalas de 100%, 125% e 150% emuladas no WebView2.

A comparação de hierarquia e navegação usou a documentação oficial e as capturas do executável do Sancord. [Referência de login desktop](https://support.discord.com/hc/pt-br/articles/360057027354-Como-fazer-login-em-sua-conta) · [Referência de cadastro](https://support.discord.com/hc/en-us/articles/31676852332439-Discord-Sign-Up-and-Registration-Guide)

### 22/11/2026 · Reconexão, modo offline, cache DPAPI e fila de envio durável

- O cliente desktop ganhou máquina de estados de conexão (`static/js/connection.js`) com backoff automático, detecção de socket zumbi via heartbeat, distinção entre queda de rede, servidor fora do ar, queda do WebSocket e manutenção, retomada automática da sala de voz (com câmera e tela interrompidas durante a queda) e ressincronização do histórico ao voltar.
- Sessões persistentes gravam um snapshot offline cifrado com DPAPI no Windows (`static/js/offline-cache.js`, limite de 60 KB e validade de 7 dias), permitindo reabrir o Sancord sem conexão e consultar servidores, canais, membros e mensagens recentes enquanto tenta reconectar.
- Mensagens e respostas enviadas sem conexão entram na fila local (`static/js/outbox.js`) e são entregues sem duplicação via `connection_v1` e recibos duráveis no SQLite (`SCHEMA_VERSION = 22`). Uploads interrompidos durante a queda são sinalizados com opção de tentar novamente ou remover.
- Validado em Windows com `node --test tests/frontend-*.test.cjs` (227 aprovados), `cargo test --locked --all-targets --target-dir target-dev` (181 aprovados), `node scripts/auth-qa.mjs --reconnect` (capturas em `qa-reconnect/`) e `scripts/test-migration.ps1` (migração real somente leitura `v21 → v22`, 33 tabelas preservadas por hash, integridade OK). Pendente apenas validação física de áudio/vídeo entre redes independentes com TURN.

### 22/11/2026 · Detecção de jogos, Rich Presence e Pesquisa Avançada de Mensagens

| Recurso | Estado real | Resumo técnico e escopo |
|---|---|---|
| Game Detection | ✅ | Detector nativo Windows em `src/bin/desktop_activity.rs` (`EnumWindows` + `GetForegroundWindow` + `QueryFullProcessImageNameW` com handles RAII, polling a cada 4 s, blocklist de sistema/navegadores/Sancord/Discord, catálogo local + manifestos Steam `.acf` e Epic `.item`, prioridade para foreground/estabilidade no Alt+Tab e jogos registrados/renomeáveis pelo usuário). |
| Activity Status | ✅ | Separado da presença (`status_kind` e `custom_status`), propagado em tempo real via `UpdateActivity` / `UserActivityUpdated`, com timer estável (`há Xh Ymin`), privacidade local (`Mostrar atividade atual como status`), audiência sincronizada (`ProfilePrivacy.activity`), ocultação no modo Invisível e exibição na lista de membros, popout, perfil completo, prévia e Ativo Agora. |
| Rich Presence | 🟡 | Modelo estruturado completo (`UserActivity`: `kind`, `application_id`, `name`, `details`, `state`, `started_at`/`ends_at`, `large_image`/`small_image`, `party_size`/`party_max`, `buttons`, `join_secret`/`spectate_secret`, `source`, `metadata`) validado no backend (`src/activity.rs`), renderizado sem inventar campos e com arquitetura multi-fonte (`rpc` > `game_detector` > `manual`). SDK/pipe local de RPC para jogos externos fica preparado para evolução futura. |
| Advanced Search | ✅ | Evolução sobre o índice SQLite FTS5 existente (`messages_fts` com `unicode61 remove_diacritics 2`, triggers realtime de insert/edit/delete): busca em texto, nomes de anexos (`relatorio.pdf`), títulos/tags de threads e fóruns, DMs isoladas, paginação real (25/página com `total_count` e `offset`), ordenação (`recent`, `oldest`, `relevance` com `bm25`), rate limit dedicado, highlight seguro e preview inline `Ver contexto` (`GetMessageContext`). |
| Search Filters | ✅ | Parser textual (`de:`, `em:#canal`, `tem:imagem\|vídeo\|áudio\|arquivo\|link\|embed\|reação\|enquete` com múltiplos `tem:`, `menciona:@nome` e `menciona:eu`, `antes:`, `depois:`, `durante:`, `fixadas`) combinado com chips visuais removíveis e barra rápida de filtros. Permissões revalidadas no backend antes e depois da consulta. |
| Search Suggestions | ✅ | Popover interativo ao focar/digitar (`static/js/search.js`) com autocomplete dinâmico de usuários (`de:` / `menciona:`), canais e threads legíveis (`em:`), tipos suportados (`tem:`), datas sugeridas e histórico local de buscas recentes (limitado e limpável) com navegação por teclado. |
| Jump to Message | ✅ | Clique no resultado (ou no preview de contexto) abre servidor/canal/thread/DM correto via `jumpToMessage(channelId, messageId)`, carrega janela ao redor com `around_id` para mensagens antigas e aplica destaque temporário (`flash-highlight`). |

Validação local: **232/232** testes de frontend (`node --test tests/frontend-*.test.cjs`, incluindo `tests/frontend-activity-search.test.cjs` e `tests/frontend-advanced.test.cjs`) e **190/190** testes Rust (`cargo test --locked --all-targets --target-dir target-dev`, incluindo `activity::tests`, `desktop_activity::tests` e `tests::activity_search::*`).

### 22/11/2026 · Menu Contextual de DM/Amigo (sem Apps), DMs Fixadas, Favoritos e Correções Visuais

| Recurso | Estado real | Resumo técnico e escopo |
|---|---|---|
| DM Context Menu | ✅ | Novo `DmContextMenu` (`static/js/dm-context-menu.js`) sobre `SancordUI` reutilizável (`ContextMenu`, `ContextMenuItem`, `ContextMenuDangerItem`, `ContextMenuSubmenu`, `ContextMenuSeparator`, `ContextMenuLabel` em `static/js/ui-kit.js`), com ícones vetoriais `SancordIcons`, subtítulo em *Adicionar nota*, hover + teclado (`↑`/`↓`/`→`/`←`/`Enter`/`Esc`), reposicionamento junto às bordas, inversão lateral de submenu e scroll em janelas baixas. **Sem "Apps"**, sem cabeçalho grande e sem bloco permanente de Notificações no menu principal. |
| Favorites | ✅ | `favorite_dms` em `UserPrefs` (`UpdateUserPrefs`/`UserPrefsUpdated`) integrado diretamente à aba **Favoritos** em Home (`renderHomeStarredView` + badge `home-starred-badge`) e marcador discreto na DM, alternando *Adicionar aos favoritos* / *Remover dos favoritos*. |
| Pinned DMs | ✅ | `pinned_dms` em `UserPrefs` (sanitizado e sem duplicação), exibindo seção **FIXADAS** no topo da lista de DMs (`renderDmList`) e alternando *Fixar* / *Desafixar*. |
| Private Notes | ✅ | Reaproveita `UserPrefs.user_notes` privado no SQLite (nunca enviado ao alvo) com editor rápido modal (*Adicionar/Editar/Remover nota*) acessível direto do menu com subtítulo *"Visível apenas para você"*. |
| Relationship Actions | ✅ | Estado dinâmico real: *Adicionar amigo*, *Remover amigo* (com confirmação), *Cancelar solicitação*, *Aceitar amizade*, *Ignorar* / *Deixar de ignorar* (`UserPrefs.ignored_users`), *Bloquear* (danger + confirmação) / *Desbloquear* (`BlockUser`/`UnblockUser`), além de *Fechar mensagem direta* (`ClientMessage::CloseDm`, oculta sem apagar histórico e reaparece ao chegar nova mensagem). |
| Mute | ✅ | Unificado em **Silenciar @usuário >** (ou *Reativar som* com tempo restante) reutilizando `MUTE_CHOICES`/`setMute` e movendo as opções de **Notificações** da DM para dentro do submenu. |
| Invite to Server | ✅ | Submenu **Convidar para o servidor >** filtrando apenas servidores elegíveis (`create_invites`, `!invites_paused`, alvo não membro e não banido) e enviando convite real via `InviteFriendToServer`. |
| Developer IDs | ✅ | `FriendInfo.id` preenchido com o `account.id` real no backend; *Copiar ID do usuário* e *Copiar ID do canal* exibidos somente com Developer Mode ON. |

Também corrigidos nesta rodada: truncamento com reticências (`overflow: hidden` + `text-overflow: ellipsis`) para nomes longos na barra inferior esquerda (`#self-profile-trigger`/`#self-username`) e preservação de personalizações de perfil de membros offline na lista de servidores (`GuildServer.member_roster` projetado com `ProfilePrivacy` em `src/access.rs`). Validação local: **236/236** testes de frontend e **192/192** testes Rust aprovados.

### 22/11/2026 · Self Profile Menu Compacto e Personalização de Insígnias

| Recurso | Estado real | Resumo técnico e escopo |
|---|---|---|
| Self Profile Menu | ✅ | Popover vertical compacto (`clamp(296px, 21vw, 316px)`), altura pelo conteúdo, borda discreta sem contorno roxo artificial (preservando *Profile Frames* reais quando equipadas), banner proporcional (`68 px`), avatar sobreposto (`68 px`) com recorte sincronizado ao tema (`--profile-surface`), nome estilizado, `@username`, badges visíveis com tooltip no cabeçalho, status personalizado e **2 cards de ações** (*Editar perfil* + *Status atual >* ; *Mudar de conta >* + *Copiar ID do usuário* apenas com Developer Mode ON). Removidos botões *Insígnias*, *Minha coleção* e ausentes *Clipes*/*Orbs*. |
| Profile Badges | ✅ | Separação no backend (`src/cosmetics.rs`) entre badges possuídas (`owned_badges`, autoritativo no servidor) e exibidas (`profile.badges`), com metadado `can_hide`, teto simultâneo de 6 badges visíveis, inclusão automática de novas badges quando houver vaga, preservação de posse de molduras/permissões ao ocultar e atualização em tempo real em todos os contextos sem poluir a lista de membros. |
| Badge Customization | ✅ | Novo subeditor dedicado em **Configurações → Perfis → Perfil principal → Insígnias** (`static/js/profile-editor.js`), recolhido na lateral até clique, listando somente badges realmente possuídas, com prévia ao vivo no cartão central, ativar/ocultar (respeitando `can_hide`), reordenação por botões `↑`/`↓` e drag-and-drop, *Restaurar padrão*, *Cancelar/Aplicar* no subeditor e persistência validada no servidor (`UpdateProfile` com interseção estrita `requested ∩ owned`). |

Validação local: **237/237** testes de frontend (`node --test tests/frontend-*.test.cjs`) e **194/194** testes Rust (`cargo test --locked --all-targets --target-dir target-dev`) aprovados; binários de QA recompilados em `target-dev/debug`.

### 23/11/2026 · Refatoração Profunda de Cosméticos v3 (Qualidade Visual, Camadas e Timeline)

| Recurso | Estado real | Resumo técnico e escopo |
|---|---|---|
| Avatar Decorations | ✅ | Motor `SancordCosmetics` v3 (`static/cosmetics/cosmetics-engine.js`, `cosmetics.css`) com composição real em camadas (`BACK_LAYER` + `AVATAR` + `FRONT_LAYER` + partículas/highlights), 8 peças flagship ilustradas (6 `IDLE_WITH_EVENTS` com eventos secundários/raros orgânicos — piscar, estrela cadente, pétala solta, orelha mexendo, brilho especular — e 2 estáticas detalhadas `static-royal-crown`/`static-emerald`) + upgrade dos clássicos de 1 círculo. Itens legados restantes preservam IDs para migração progressiva. |
| Profile Frames | ✅ | 8 molduras arquitetônicas SVG (`core-pulse`, `cosmic-drift`, `sakura-wind`, `royal`, `frost-glint`, `cyber-corners`, `ember-trail`, `liquid`) envolvendo cantos, crista superior, selo inferior e trilhos laterais, responsivas por contexto (`FULL_PROFILE`, `EDITOR_PREVIEW`, `PROFILE_POPOUT`, `SELF_PROFILE_MENU`, `MINI`), mesclando peças estáticas gravadas e animações localizadas. |
| Profile Effects | ✅ | Engine de timeline multi-estágio (`init → entrance → main → climax → dissipate`) com planos de profundidade `back` + `front` em 6 efeitos flagship (`core-signal`, `star-trail`, `petal-drift`, `circuit-boot`, `polar-ribbon`, `embers`, `2,3–2,8 s`), tocando uma vez ao abrir (sem loop infinito) e com botão *Reproduzir novamente*. |
| Nameplates | ✅ | 8 placas gráficas compostas em SVG (`.np-art-layer`, `starlit-silt`, `twilight-garden`, `core-stripe`, `circuit-weave`, `gold-leaf`, `tide-glass`, `ember-line`, `frost-vein`) com leitura preservada em temas claro/escuro e aplicadas de forma unificada em Cartão, Editor, DMs, Amigos, Dock e Lista de Membros. |
| Display Name Styles | ✅ | 10 fontes distintas (`modern`, `rounded`, `mono`, `gta`, `retro`, `gothic`, `editorial`, `bubble`, `cyber`, `fantasy`) combináveis com materiais ricos (`gummy`, `ink`, `cosmic`, `prism`, `holographic`, `chrome`, `fire`, `ice`, `neon`, `outline`, `custom-gradient`), animando apenas o material nos contextos apropriados e mantendo a Lista de Membros estática. |
| Animated Previews | ✅ | Prévias ao vivo no editor com hover animado, aplicação imediata no rascunho sem salvar automaticamente, *Cancelar/Aplicar* e *Reproduzir novamente* para Profile Effects. |
| Cosmetic Quality | 🟡 | Salto qualitativo nas 5 coleções principais (`sancord-core`, `cosmic`, `sakura`, `cyber`, `royal`, `frost`, `inferno`, `ocean`) sem emojis como arte; itens clássicos secundários permanecem mais simples até a próxima onda de ilustrações/WebP animados. |
| Reduced Motion | ✅ | Respeito estrito a `reduceMotion`, `prefers-reduced-motion: reduce`, janela em segundo plano, offscreen (`IntersectionObserver`) e orçamento (`maxConcurrentIdleHosts = 6`, `0` na Member List), exibindo pose estática curada sem sumir com o cosmético. |

### 23/11/2026 · Catálogo de Jogos, `GamePicker` Reutilizável e Widgets de Jogos no Mural

| Recurso | Estado real | Resumo técnico e escopo |
|---|---|---|
| Game Catalog | ✅ | Catálogo central no backend (`src/games.rs`) com ~48 jogos populares curados (incluindo títulos fora da Steam), busca ao vivo intermediada pelo servidor (`/api/games/popular`, `/api/games/search`, `/api/games/resolve`, `/api/games/:id`), cache em memória (`6h`) + disco (`data/game-catalog-cache.json`), allowlist segura de URLs de capa e zero chaves de API no cliente desktop. |
| Game Picker | ✅ | Componente único `SancordGamePicker` (`static/js/game-picker.js`) reutilizado por *Jogo favorito*, *Quero jogar*, *Jogando agora* e *Lista de desejos*, com busca com debounce + `AbortController`, skeleton, *Recentes*, *Jogos detectados no seu PC*, *Populares*, prévia com nota opcional, modo offline, retry em erro e fallback secundário *"Não encontrou seu jogo? Adicionar manualmente"*. |
| Favorite Game Widget | ✅ | Escolha direta no catálogo com capa automática (`object-fit: cover` ou fallback limpo sem imagem quebrada), metadados (ano/plataformas), nota opcional, modal compacto de detalhes e escolha fixa independente do jogo aberto. |
| Want to Play / Wishlist | ✅ | Unificado ao mesmo `GamePicker` central (tanto no Mural quanto na aba *Lista de desejos*), com capas automáticas, metadados e persistência retrocompatível no `ProfileBoard`. |
| Playing Now Widget | ✅ | Integrado à fonte única `SancordActivity`: modo automático *"Atualizar automaticamente com minha atividade"* ativo por padrão, capa resolvida do catálogo, tempo real de sessão (`started_at`), transição automática para *"Nenhum jogo no momento"* ao fechar o jogo sem perder o widget e opção de modo fixo manual. |
| Activity Integration | ✅ | `SancordActivity` estendido com `getDetectedGame`, `getLocalGames` e `subscribe`, sincronizando em tempo real Activity + Popout + Perfil completo + Member List + Mural (`Jogando agora`) respeitando `ProfilePrivacy.activity`. |
| Founder Badge | ✅ | Insígnia `"founder"` (*Fundador do Sancord*) concedida exclusivamente à conta `Swag` via `data/badges.json` e ativa no servidor local. |

### 23/11/2026 · Notificações de DM na Barra Lateral, Som Original do Sancord e Densidade da Lista de DMs

| Recurso | Estado real | Resumo técnico e escopo |
|---|---|---|
| DM Unread Badge | ✅ | Avatares dedicados de DMs e Group DMs não lidas na barra lateral (`#rail-unread-dms` abaixo do botão Início), com badge vermelha numerada (`1–99`, `99+`) sobreposta ao avatar, pílula branca, 1 item por conversa, ícone real para Group DM, atualização ao vivo do avatar, tooltip, clique abrindo a DM e clique direito no `DmContextMenu`. Toggle independente em Configurações → Notificações (`#notif-dm-rail-badge`). |
| DM Notification Sound | ✅ | Chime original do Sancord sintetizado via Web Audio API (`synthesizeSancordDmChime` em `static/js/notification-manager.js`) com envelope suave, filtro lowpass, controle de volume, cooldown anti-clipping em rajadas (`1100ms`/`450ms`), silêncio em DND/mute/conversa aberta em foco/bloqueado/Message Request e proteção contra sons retroativos após reconnect. |
| Read State | ✅ | Fonte de verdade mantida no SQLite (`read_states`: `last_read_at` + `mention_count`), com `AckChannel`, *Marcar como lida*, sincronia multi-device em tempo real (`ReadStateUpdated` ao ler ou responder em outra sessão) e reconciliação completa no `Welcome` após reconexão. |
| Desktop Notifications | ✅ | Integradas ao `SancordNotifications` (`shouldShowDesktopNotification`), respeitando DND, mute, bloqueados, Message Requests e foco da janela, com clique focando o Sancord e abrindo diretamente a DM ou Group DM correspondente. |
| DM List Visual Density | ✅ | Lista de Mensagens Diretas refinada em escopo isolado (`.dm-list` em `static/ui.css`): itens compactos (`42px`), avatar `28px` com status `9px`, contenção de *Display Name Styles* e *Nameplates*, linha secundária discreta (`11.5px`), badge `99+` e chip `APP` compacto. |

### 23/11/2026 · Efeitos Sonoros Compartilhados de Voz, Chamadas, Stream e Câmera

| Recurso | Estado real | Resumo técnico e escopo |
|---|---|---|
| Voice Event Sounds | ✅ | Eventos compartilhados autoritativos (`ServerMessage::VoiceCueEvent` com `event_id`, `actor_user_id`, `voice_session_id` e rate limit) + `SancordSoundManager` + `SancordVoiceSounds` com deduplicação, isolamento por canal, política de deafen, polifonia controlada, coalescing e 16 assets WAV originais embutidos (`static/assets/sounds/`). |
| Call Sounds | ✅ | Sons distintos para `voice_join`, `voice_leave`, `call_connected`, `call_disconnected`, `voice_reconnected` e `voice_error`, além de controles locais `mute_on`/`mute_off` e `deafen_on`/`deafen_off` (com arquitetura pronta para `sharedMute`). |
| Stream Sounds | ✅ | `stream_start` e `stream_stop` compartilhados com todos os participantes elegíveis da call somente em transições reais confirmadas pelo servidor (troca de qualidade/janela não repete o som). |
| Camera Sounds | ✅ | `camera_on` e `camera_off` digitais curtos e discretos (sem efeito de obturador mecânico) compartilhados na call com cooldown anti-spam no servidor e cliente. |
| Ringtone | ✅ | Toques originais do Sancord em loop para chamada recebida (`incoming.wav`) e chamada sendo realizada (`outgoing.wav`), encerrados imediatamente ao atender (`call_connected`), recusar, cancelar ou expirar. |
| Voice Sound Settings | ✅ | Seção dedicada **Sons de chamadas** em Configurações → Notificações com master toggle, volume próprio (`0–100%` independente do volume das pessoas), preview `▶` e toggles por evento, respeitando o dispositivo de saída (`setSinkId`). |

### 23/11/2026 · Supressor de Ruído DSP (`AudioWorklet`) e Polimento Visual do Cabeçalho de Perfil

| Recurso | Estado real | Resumo técnico e escopo |
|---|---|---|
| Noise Suppression | ✅ | Pipeline DSP híbrido em `AudioWorklet` (`static/js/voice-dsp-core.js` + `static/js/voice-dsp-worklet.js`, STFT `256` amostras, hop `128` = `2,67 ms` a `48 kHz`, `~0,02 ms` CPU/hop, zero alocações por frame): estimador adaptativo de PSD de ruído + ganho Decision-Directed Wiener (`alpha = 0,90–0,96`) + suavização entre bins vizinhos (evita voz metálica/underwater) + proteção de fricativas (`1,8–6,5 kHz`). Desativa `noiseSuppression` nativo do browser quando o worklet está ativo para evitar dupla supressão e mantém fallback seguro para WebRTC nativo. |
| Voice Preservation / VAD | ✅ | VAD suave multi-característica (SNR na banda de voz + tonalidade harmônica) com ataque rápido (`~6 ms`), hangover (`~220 ms`) e piso dinâmico de ganho durante a fala, preservando sílabas iniciais (*"porta"*, *"fala"*) e consoantes finais (*"s"*, *"f"*, *"ch"*). |
| Keyboard Noise Reduction | ✅ | Detector de transientes impulsivos curtos (alto crest factor + salto abrupto `> 2 kHz` + baixa tonalidade) que atenua cliques secos de teclado/mouse fora da fala e recua automaticamente durante fala simultânea, somado ao filtro passa-alta de `70 Hz` contra impacto na mesa. |
| Voice Processing Modes | ✅ | 5 modos reais selecionáveis ao vivo sem reiniciar a call e sem clicks/pops (`Automático`, `Leve`, `Padrão`, `Forte` com aviso contextual, e `Desligado` com bypass verdadeiro), além de atalho rápido no painel de voz (`#voice-ns-quick-btn`), toggles independentes de **AEC** e **AGC**, comparação A/B ao vivo no **Teste do microfone**, detector de clipping e diagnóstico DSP no Modo Desenvolvedor. |
| Profile Header Layout | ✅ | Polimento visual unificado nos 4 contextos (`Self Profile Menu`, `Profile Popout`, `Full Profile`, `Editor/Preview`): remoção total da tarja/caixa retangular atrás do Display Name em `.profile-card .profile-nameplate-wrap`, escala tipográfica equilibrada (`20px` / `19px` / `18.5px`), contenção de sombras/escala em *Display Name Styles* (`.name-style-gta` a `1.05em`), `@username` secundário (`13px`) com pronomes discretos (`12px`) e insígnias refinadas como acessórios delicados (`15.5px–16px`) em pílula única sutil na mesma linha do `@username`. |

### 23/11/2026 · Renomeação Oficial e Migração Compatível `Sancord` → `Sanvo`

| Recurso | Estado real | Resumo técnico e escopo |
|---|---|---|
| Brand & UI Rename (`Sanvo`) | ✅ | Todas as ocorrências visíveis ao usuário atualizadas de `Sancord` para `Sanvo` / `Sanvo Desktop` (barra nativa `SANVO DESKTOP`, loader, login, configurações `SANVO` / `Sobre o Sanvo` / `ID DA CONTA SANVO`, cartões de perfil, coleção `Sanvo Core` e insígnias como `Fundador do Sanvo`). |
| `LegacySancordMigration` | ✅ | Módulo centralizado em Rust (`src/legacy_sancord_migration.rs`) e JS (`static/js/auth-storage.js`): migra `%LOCALAPPDATA%\SancordDesktopData` → `%LOCALAPPDATA%\Sanvo` sem apagar a pasta antiga (criando apenas `Sanvo` em instalação limpa), abre tokens DPAPI legados (`Sancord desktop auth v1:`) e sela novos com `Sanvo desktop auth v1:`, migra chaves `sancord_*` ↔ `sanvo_*`, aceita `sanvo://` + `sancord://` e `SANVO_*` + `SANCORD_*`. |
| Windows Metadata & Transition Updater | ✅ | `VERSIONINFO` em `icon.rc` (`ProductName: "Sanvo"`, `FileDescription: "Sanvo Desktop"`, `OriginalFilename: "Sanvo.exe"`), geração e assinatura Ed25519 simultânea de `Sanvo.exe` (`sanvo-update.json`) e cópias de transição `Sancord.exe` (`sancord-update.json`). |

### 23/11/2026 · Som `message_received.wav`, Contador Global de Não Lidas e Badge na Barra de Tarefas do Windows

| Recurso | Estado real | Resumo técnico e escopo |
|---|---|---|
| Message Notification Sound | ✅ | Asset WAV original embutido (`static/assets/sounds/notifications/message_received.wav`, 48 kHz 16-bit mono PCM a `-8 dBFS`) integrado ao `SancordSoundManager` (categoria `NOTIFICATION`) e `SancordNotifications.handleIncomingSound`, com volume independente (`#notif-ui-volume-slider`), cooldown anti-spam (`1100 ms` canal / `450 ms` global), supressão em histórico/própria mensagem/mute/DND/reconnect e respeito aos níveis de notificação por servidor/canal (`all`, `mentions`, `none`). |
| Taskbar Unread Badge | ✅ | Overlay icon nativo na barra de tarefas do Windows via COM `ITaskbarList3::SetOverlayIcon` (`src/bin/desktop_taskbar.rs` + IPC `taskbar-badge:N` em `src/bin/SancordApp.rs`), renderizando em memória um `HICON` 32-bit ARGB supersampled `4×4` (`1..99`, `99+`, removido quando `0`) escalado automaticamente por DPI (`100%` 16px, `125%` 20px, `150%` 24px, `200%` 32px) com anel de contraste para temas claro e escuro do Windows e toggle próprio (`#notif-taskbar-badge`). |
| Global Unread Count | ✅ | Fonte única `SancordNotifications.getGlobalUnreadNotificationCount()` derivada de `read_states` + `unreadDms` (apenas DMs relevantes, Group DMs e menções/respostas em servidores; exclui Message Requests e bloqueados), com deduplicação por `message.id`, recálculo imediato ao ler, *Marcar como lida*, *Marcar tudo como lido*, apagar mensagem não lida (`MessageDeleted` no cliente e `decrement_mentions_on_delete` no servidor), multi-device `ReadStateUpdated`, reconnect, logout e troca de conta. |
| Windows Notifications | ✅ | Decisão centralizada no `SancordNotifications` unificando unread state, som `message_received`, badge de DM na barra lateral, badge numérica na taskbar do Windows, toast nativo e flash moderado da janela (`shouldFlashTaskbar` com cooldown de 15s). |

### 23/11/2026 · Tooltips em Portal + Ciclo de Vida Completo de Chamadas Privadas (DM & Group DM)

| Recurso | Estado real | Resumo técnico e escopo |
|---|---|---|
| Incoming Call Ringing | ✅ | Ringtone original do Sanvo (`incoming.wav`) controlado por máquina de estados autoritativa no backend (`RINGING`, `ring_expires_at` de 30s configurável via `CallTimingConfig`), silenciado em DND/conversa silenciada (mantendo aviso visual), com notificação nativa do Windows, flash discreto na barra de tarefas (`FlashWindowEx`, 3 pulsos) e volume próprio (`#call-ringtone-volume`). |
| Outgoing Ringback | ✅ | Feedback visual (**Chamando...** + botão *Cancelar toque*) e sonoro (`outgoing.wav`) em chamadas privadas 1:1 e Group DM, interrompido imediatamente ao atender, recusar, cancelar ou expirar o timeout de toque. |
| Call Answer / Decline | ✅ | Botões **Atender** e **Recusar** no toast (`#dm-call-toast`) e no banner da conversa (`#dm-active-call-banner`), com parada instantânea do áudio sem sobreposição (`SancordSoundManager.stopLoop`), sincronização multi-dispositivo (`CallAnswered` / `CallDeclined`), restauração da janela (`window:focus`) e proteção/confirmação ao atender durante transmissão ativa. |
| Missed Calls | ✅ | Registrada no histórico da DM/Grupo (`📞 Chamada perdida de ...`) somente quando a sessão realmente encerra sem nenhum participante ter atendido (após recusa unânime ou expiração de `CALL_IDLE_GRACE_PERIOD`); se houver entrada tardia na mesma sessão, registra duração real a partir de `connected_at`. |
| Late Join | ✅ | Separação real entre `RINGING` e `CALL SESSION`: após o timeout de 30s do ringtone, o chamador permanece na sala (`WAITING_ACTIVE`, com *Chamar novamente* protegido por cooldown) e destinatários/membros de grupo veem **Chamada em andamento · [Entrar na chamada]** podendo entrar minutos depois no mesmo `call_id` (inclusive durante `CALL_IDLE_GRACE_PERIOD` de 5 min se a sala ficar temporariamente vazia). |
| Call Session Lifecycle | ✅ | Autoridade integral no backend (`src/voice.rs` + `src/ws.rs`): `call_id` idempotente, `ActiveCallsSync` no `Welcome` preservando `ring_expires_at` após reconexão sem reiniciar o toque, `CancelCall`, `RingCall` com anti-spam, limpeza automática de sessões ociosas e isolamento completo em canais de voz de servidor (que continuam join manual). |
| Portal Tooltips & Z-Index | ✅ | Motor central de tooltips em portal (`static/js/ui-kit.js`) com hierarquia de `z-index` unificada (`--z-tooltip: 110000` > `--z-titlebar: 9000`), detecção automática da barra superior, flip em 4 direções, shift/clamp na viewport e seta direcional ancorada. |
