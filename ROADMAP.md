# Conferência do prompt original — Sancord

**Atualização posterior:** a falha de cargos registrada abaixo foi corrigida, e o núcleo
de permissões/canais privados foi implementado e testado. Consulte [FASE4.md](FASE4.md).
A Fase 5 (bloqueio e privacidade no servidor, solicitações de mensagem, grupos, perfil
completo e denúncias) está em [FASE5.md](FASE5.md), ainda não publicada em produção.
A Fase 6 (voz) já foi iniciada e revisada; estado, correções e limites de validação
estão em [FASE6.md](FASE6.md). A Fase 7 (câmera e tela) está em [FASE7.md](FASE7.md),
com validação de webcam e redes pendente. A Fase 8 (auditoria, AutoMod, busca, enquetes, eventos, threads e fóruns) está em
[FASE8.md](FASE8.md). A Fase 9 (polimento) está em andamento em [FASE9.md](FASE9.md).
A tabela histórica abaixo não representa esses avanços.
O fechamento da Fase 9 no escopo pt-BR está descrito em [FASE9.md](FASE9.md), com bots de
envio/webhooks e schema v10. A etapa seguinte já foi iniciada:
[homologação desktop e versão candidata](HOMOLOGACAO.md), ainda sem release publicada.
Este levantamento abaixo foi preservado como fotografia anterior à implementação.

Data: 17/11/2026. Comparação do prompt de 83 seções enviado ao Claude com os fontes
atuais, os testes já executados e uma reprodução adicional isolada de autorização.

**Critério:** código presente não significa fluxo completo validado. “Implementado”
indica lógica encontrada; “testado” se refere somente à evidência descrita. Não há
base para afirmar que uma fase inteira ou determinado percentual do produto está pronto.

## Situação das nove fases

| Fase | Situação | O que já existe | O que impede considerar a fase encerrada |
|---|---|---|---|
| 1 — Base e estabilidade | Base operacional, com testes | Axum/Tokio; autenticação Argon2id e sessões; SQLite v3; WS autenticado; reconexão; histórico persistido; erros de envio com retry; logs | Autorização de cargos incompleta; estado sob um RwLock compartilhado; identidade de autoria ainda ligada à conexão/nome em parte do protocolo; falta medir carga e falhas prolongadas |
| 2 — Servidores | Núcleo implementado e coberto por testes | Criar/editar/excluir/sair; proprietário; templates; categorias; texto/voz/anúncios; ordenação; pastas; preferências; convites com validade/usos e preview | Permissões de categoria/canal pertencem à Fase 4; painel de membros usa conectados e não lista offline completa; itens futuros do menu dependem das fases seguintes |
| 3 — Chat | Núcleo implementado e testado | Enviar/editar/excluir/responder; anexos HTTP; reações; menções; typing; fixadas; leitura persistida; paginação e saltos; Markdown; composer multilinha; emojis Unicode | Uploads abandonados sem limpeza; emojis próprios; prévias seguras de links. Busca global avançada pertence à Fase 8. Rascunhos/anexos ainda não são separados por conversa |
| 4 — Cargos e permissões | Parcial; próxima prioridade | Cargos persistidos; editor; cor/posição/hoist/emoji; atribuição; permissões de servidor; função effective_permissions; verificações de kick/ban/algumas operações | Escalada de privilégio reproduzida; faltam herança e sobrescritas permitir/negar; canais privados; sincronização categoria/canal; permissões granulares; hierarquia completa e seus testes |
| 5 — Social | Parcial, já possui backend | Solicitar/aceitar/recusar/cancelar/remover amizade; DMs persistidas; perfil/avatar/banner/bio; status e presença | Grupos privados; solicitações de mensagem; bloqueio e privacidade no backend; expiração de status; campos/perfil por servidor; amigos/servidores em comum e demais detalhes |
| 6 — Voz | Implementação real encontrada; validação de mídia pendente | WebRTC mesh; microfone; processamento de áudio; VAD/PTT; mute/deafen; volume por pessoa; dispositivos; teste de microfone; chamadas DM | Testar entre máquinas/redes e dispositivos; somente STUN configurado, sem TURN; permissões speak_voice/stream_video sem fiscalização nos handlers de estado/sinalização; limites de escala do mesh |
| 7 — Vídeo e tela | Implementação real encontrada; validação de mídia pendente | Câmera, captura de tela, seleção/qualidade e interface de streams; ponte Windows de captura/áudio | Teste ponta a ponta de câmera/tela/áudio; reconexão; isolamento/autorização da sinalização; comportamento em diferentes redes e equipamentos |
| 8 — Avançados | Majoritariamente pendente | Busca simples local e anti-spam fixo por conexão são bases existentes | Threads, fóruns, enquetes, eventos, busca no banco com filtros, AutoMod configurável e auditoria persistida |
| 9 — Polimento | Parcial e já iniciado | Temas, acentos, tooltips, menus/modais, estados visuais, notificações, alguns atalhos, foco/ARIA e reduzir movimento | Acessibilidade completa; navegação rápida e atalhos restantes; traduções; configurações finas por canal/categoria; notificações Windows verificadas; desempenho e cache de mídia medidos |

As fases não foram construídas em sequência estrita: existem recursos das fases
5, 6, 7 e 9 antes de a Fase 4 estar completa. Essas implementações devem ser aproveitadas.

## Achados que mudam a prioridade

### 1. Hierarquia de cargos: falha reproduzida

`src/ws.rs`, handler `AssignUserRoles`, verifica a capacidade de gerenciar cargos,
mas a lista recebida é filtrada apenas por existência e por não ser `everyone`.
Não limita os cargos concedidos à hierarquia do ator nem compara a hierarquia do alvo.

Reprodução em `127.0.0.1:3101`, com banco novo em `qa-roadmap/data`:

1. Proprietário criou “Gestor”, posição 11, com manage_roles.
2. Proprietário criou “Administrador superior”, posição 12, com administrator.
3. Proprietário deu somente “Gestor” ao membro de teste.
4. Esse membro atribuiu a si o cargo superior via WS.
5. O backend aceitou a atribuição e também aceitou a alteração do nome do servidor pelo membro.

Resultado: **escalada de privilégio confirmada em ambiente isolado**. O fluxo
precisa ser corrigido antes de classificar administração como concluída.

Reprodutor: `qa-roadmap/verify-role-hierarchy.mjs` (somente porta 3101, contas
descartáveis; exige banco novo). Ele documenta a falha atual; sua saída bem-sucedida
não é uma aprovação de segurança. A instância foi encerrada após o teste.

Outros pontos encontrados por leitura, ainda sem reprodução adicional: `CreateRole`
aceita o conjunto de permissões informado sem limitar concessões; `UpdateRole`
valida a posição antiga, mas aceita uma nova posição arbitrária. Devem entrar no
mesmo conjunto de regras e testes.

### 2. Canais privados e herança ainda não existem

`Channel` guarda tipo/categoria/posição/descrição, sem ACL/sobrescritas. `Category`
também não tem permissões. `can_read_text_channel` permite leitura com base na
participação no servidor; o histórico inicial e os broadcasts também operam nesse nível.

Adicionar somente um campo “privado” ou esconder a linha do canal no frontend não
cumprirá o requisito: Welcome, histórico, fixadas, typing, leitura, menções, WS e
eventos precisam compartilhar a decisão de acesso do backend.

### 3. Recursos visuais/parciais encontrados

| Recurso | Estado observado |
|---|---|
| Bloquear usuário | Oculta mensagens e salva localStorage; não é bloqueio de entrega no servidor nem sincroniza entre dispositivos |
| “DMs só de amigos” | Opção salva localmente; não há regra correspondente no protocolo/backend de DM |
| Denunciar perfil | Mostra “registrada para análise”, mas o handler apenas chama showUiToast; não envia nem persiste denúncia |
| Data do perfil | Há fallback fixo “15 de nov. de 2026”; não comprova a data real de entrada naquele servidor |
| Busca | Filtra texto/autor nas mensagens já carregadas; não pesquisa todo o banco nem implementa filtros avançados |
| Painel de membros | Agrupa conexões online por cargo destacado; não representa todos os membros offline/estados exigidos |
| Anti-spam | Limitador real e testado; não equivale a AutoMod com regras, punições e registros |
| Notificações | Badges/sons e uso da API Notification existem; não comprovam toda a integração nativa e as preferências previstas |

## Cobertura das demais seções do prompt

| Seções originais | Conferência |
|---|---|
| 1–5, 21, 43, 57–59 | Estrutura visual, servidores/canais/categorias e painéis existentes. Membros offline, permissões e telas avançadas permanecem parciais |
| 6–11, 13, 17, 19–20 | Implementações reais de mensagens e mídia presentes; testes de chat e validação visual descritos em RETOMADA.md |
| 12, 14–16, 18 | Unicode/links básicos existem; emojis próprios, embeds seguros, enquetes, threads e busca avançada pendentes |
| 22–28 | Perfis, status, amigos e DMs existem parcialmente; bloqueio/privacidade reais, solicitações e grupos ainda faltam |
| 29–33 | Código de voz/vídeo/tela/chamadas presente; não declarar esses fluxos concluídos sem teste real entre clientes |
| 34–38 | Cargos/kick/ban/unban e algumas permissões existem; herança, timeout, slowmode, AutoMod e auditoria faltam |
| 39–42 | Convites reais testados; notificações/configurações parciais; eventos ausentes |
| 44–47, 56, 60–65, 69 | Menus, arraste de servidores/canais/categorias, presença, UI e temas existentes; cargos usam controles de posição, sem DnD completo; atalhos/componentização/acessibilidade parciais |
| 48–55, 72–74, 80–81 | Rede/persistência/reconexão/erros/testes/README existentes. Modelos futuros, autorização completa, carga, cache de mídia e concorrência por domínio continuam trabalho aberto |
| 66–68, 70 | Bots/webhooks/API externa, premium e internacionalização são futuros; bot de sistema existe, não uma plataforma de bots |
| 71, 75–79, 82–83 | Regras de execução e critérios de aceite. Fluxos A/D/E têm cobertura automática; B tem falha de hierarquia; C exige teste real de voz; F depende de timeout ainda ausente |

## Próxima implementação lógica

**Fase 4, aproveitando cargos existentes**, nesta sequência:

1. Centralizar autorização de administrar cargos/membros: participação, proprietário,
   administrador, hierarquia do ator/alvo/cargo, cargos que o ator pode conceder,
   posição nova válida e proteção de everyone/proprietário. Cobrir autorizações e recusas por WS.
2. Introduzir permissões efetivas por servidor → categoria → canal, com permitir/negar/herdar
   e sincronização de categoria, preservando permissões atuais em uma migração compatível.
3. Aplicar o cálculo ao backend inteiro e filtrar dados/eventos de canais inacessíveis;
   testar que membros não recebem estrutura/histórico/typing/menções de canais privados.
4. Estender o editor e os diálogos existentes, mantendo o layout e a identidade visual.
5. Validar o fluxo B do prompt e regressões das fases 1–3; depois seguir para Social,
   aproveitando amigos/DMs/perfis já existentes.

Arquivos previstos: `src/models.rs`, `src/db.rs`, `src/state.rs`, `src/ws.rs`,
`src/tests.rs`, `static/app.js`, `static/js/servers.js` e os diálogos de `static/index.html`.
Um módulo específico de autorização pode ser adicionado para reunir regras, caso reduza
duplicação. Não há motivo identificado para trocar a stack ou recriar o projeto.

## O que foi testado e o que foi alterado nesta conferência

- A retomada anterior validou cargo check/build, 47 testes do servidor, 2 do desktop
  e 11 do frontend, além dos fluxos visuais registrados em RETOMADA.md.
- Nesta conferência não se repetiu toda essa suíte: os fontes do aplicativo não mudaram.
  Foi executado o cenário adicional de hierarquia com servidor HTTP/WS real e duas contas de QA.
- Foram adicionados este levantamento e o reprodutor de QA; não foram alterados
  permissões, dados ou usuários do banco principal. A falha identificada permanece aberta.
