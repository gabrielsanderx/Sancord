# Sistema de perfis do Sancord

Documento vivo da expansão de perfis e personalização. Cada fase atualiza a sua seção.
Estado em 19/11/2026: **Fases 1 a 8 nos fontes locais**, com o escopo registrado abaixo.

## Princípios

- **Servidor é a fonte de verdade** para mídia do perfil, itens possuídos, itens equipados e
  badges. O cliente nunca afirma "eu possuo tal item"; ele só pede para equipar, e o servidor
  confere catálogo, tipo e posse.
- **Arte própria do Sancord.** Nada de assets, nomes de coleção ou branding de outros apps. As
  decorações e efeitos são desenhados em SVG e CSS no próprio cliente, pelo `id`.
- **Informação > legibilidade > cosmético.** Nome, status e ações continuam fáceis de ler.
- **Leve.** Animações respeitam uma política global e "Reduzir animações".

## Modelo de perfil

Campos antigos (na conta, como JSON na tabela `users`): `avatar_url`, `banner_url`,
`display_name`, `pronouns`, `bio`, `status_kind`, `custom_status` (+ emoji e prazo),
`theme_primary`, `theme_accent`, `avatar_decoration`, `name_style`, `name_color`,
`nameplate_style`, `profile_effect`.

Campos novos (`ProfileExtras`, achatado no mesmo JSON de `Account`, `UserInfo` e `FriendInfo`;
**sem migração**):

| Campo | Valores | Quem escreve |
|---|---|---|
| `avatar_animated`, `banner_animated` | bool (GIF) | servidor, em `SetProfileMedia` |
| `theme_highlight` | `#rrggbb` | `UpdateProfile` (só hex) |
| `theme_mode` | `solid` \| `gradient` | `UpdateProfile` (lista fechada) |
| `theme_direction` | `vertical` \| `horizontal` \| `diagonal` \| `radial` | `UpdateProfile` |
| `profile_frame` | id do catálogo | `UpdateProfile`, validado |
| `badges` | ids | **só o servidor** |

Privado da conta: `Account.inventory` (chaves `tipo:id` de itens não gratuitos).

Tema: perfis antigos com duas cores e sem modo continuam como gradiente vertical. Valor de tema
fora da lista é ignorado (não apaga o atual); texto vazio limpa. O fundo do cartão é calculado
por `profileThemeBackground` (preparado para N cores) e o tom do texto por `profileTextTone`
(luminância WCAG média > 0,45 → texto escuro).

Bio: até **300** caracteres, renderizada pelo `renderMarkdown` do chat (o texto é escapado antes;
nenhum HTML do usuário passa).

## Mídia do perfil (avatar e banner)

1. O cliente recorta (avatar círculo 512×512; banner faixa 2,5:1, 1200×480) e exporta **WebP**; GIF
   pode ser mantido sem recorte para preservar a animação.
2. Envia como anexo comum (`POST /api/attachments`, tipo detectado pelos bytes).
3. `SetProfileMedia { kind: "avatar" | "banner", attachment_id? }`: o servidor confere dono do
   anexo, tipo (PNG/JPEG/WebP/GIF) e tamanho (avatar 6 MB, banner 8 MB) e grava só o caminho
   `/api/attachments/{id}/{nome}`. Sem `attachment_id` remove e volta ao padrão.
4. Difusão: `VoiceStateSync` (lista de usuários) + listas de amigos. A lista agora leva caminhos
   curtos em vez de data-URLs.

**Cache e invalidação:** o anexo é servido com `Cache-Control: private, max-age=31536000,
immutable`. Trocar a imagem muda o ID e, portanto, a URL: nunca aparece a imagem antiga. O
middleware global só põe `no-store` em respostas que ainda não definiram a própria política
(antes ele anulava o cache de todos os anexos).

Data-URLs antigas (`UpdateAvatar` e `banner_url` em `UpdateProfile`) continuam aceitas para
compatibilidade; o cliente novo não as envia mais.

No editor, avatar e banner novos ficam em **rascunho** (`profileDraft.media`) com prévia imediata
e só sobem ao clicar em **Salvar**. Fora do editor (clique no próprio avatar), o avatar é aplicado
na hora.

## Catálogo de cosméticos

`src/cosmetics.rs`: `CosmeticItem { id, kind, name, collection, rarity, animated, availability }`.

- `kind`: `avatar_decoration`, `profile_frame`, `profile_effect`, `nameplate`, `name_style`.
- `rarity`: `common`, `rare`, `epic`, `legendary`, `event`, `founder` (sem lootbox; só rótulo).
- `availability`: `free` (todos), `badge:<id>` (quem tem a badge), `grant` (só por inventário:
  eventos, presentes, códigos). **Não há pagamento**; a arquitetura não amarra itens a compra.
- Posse: gratuito, ou `tipo:id` em `inventory`, ou badge exigida.
- `check_equip`: `none`/`default`/vazio tira; id inexistente, de outro tipo ou não possuído é
  recusado com `ServerFeedback { action: "update_profile", ok: false }`.
- O cliente recebe `CosmeticsState { catalog, owned }` logo após o `Welcome`.

Fase 1 registra a primeira leva (coleção `classicos`: 24 decorações, 12 efeitos, 11 placas, 11
estilos de nome) como gratuita, para manter tudo o que já existia.

## Animação e desempenho

Política em **Configurações → Aparência → Animações de perfil**: Sempre / Só ao passar o mouse
(padrão) / Nunca. "Reduzir animações" do Sancord **ou do Windows** força "Nunca".

- Mídia GIF recebe `data-anim`. A política de carregamento e os limites atuais estão na Fase 8.
- O banner virou `<img>` dentro do `.profile-card-banner` para poder ter quadro parado.



## Camadas (Fase 2)

Avatar, de baixo para cima: **avatar** (1) → **partículas da decoração** (2) → **arte/anel da
decoração** (4, `.deco-svg-layer`) → **status** (5–6, `.status-badge`). O status oficial nunca fica
coberto. A decoração é uma camada própria: trocar o avatar mantém a decoração, e ela nunca é
gravada na imagem.

Cartão de perfil: conteúdo → **efeito de perfil** (`.profile-effect-layer`, z 4) → **moldura**
(`.pf-layer`, z 8, só a borda via máscara). A moldura envolve o cartão inteiro e **não aparece nas
mensagens** — só no popout, no perfil e nas prévias. Quando há moldura, a borda de destaque do tema
sai (a moldura manda, §80–81).

## Decorações e molduras (Fase 2)

- **Decorações novas** (arte SVG própria em `static/js/profile.js`, `SANCORD_DECORATION_ART`):
  Órbita (Sancord Core), Órbita Nebular, Pétalas ao Vento, Anel Cyber, Pulso Elétrico, Lunar, Brasa,
  Nevada, Bolhas do Oceano, Chuva Digital, Pixels Retrô. Animações por CSS (`decoFall`,
  `decoRise`, `decoTwinkle`, `decoDash`, `decoPixel`), lentas.
- **Molduras** (`.pf-<id>` em `ui.css`, anel por máscara + ornamentos próprios):
  - estáticas: Minimal, Carbono, Cantos Cyber, Flores de Canto, Real, Pixel Retrô, Cósmica, Inferno,
    Geada;
  - animadas: Pulso Core, Neon Pulsante, Fluxo Prisma (conic com `@property --pf-angle`), Elétrica,
    Deriva Cósmica, Vento Sakura, Rastro de Brasa, Brilho de Geada, Glitch Digital (2% do tempo,
    deslocamento de 1,5 px), Líquida, Holográfica;
  - **reativas (exclusivas do Sancord)**: Aura Reativa (cor e intensidade seguem presença: online,
    ausente, não perturbe, offline; voz: falando pulsa, mutado reduz, transmitindo muda o tom) e
    Pulso de Voz (onda percorre a borda enquanto a pessoa fala). Atributos `data-presence` e
    `data-voice` no cartão; atualização de voz agrupada em **no máximo 1 a cada 150 ms**
    (`onFrameVoiceState`), reaproveitando a detecção de fala que já existe (`state.speakingUsers`).
    Só cosmético: o indicador de status continua no avatar.
  - **por conquista** (`availability: badge:<id>`): Pioneira, Fundação, Construção, Caça-Bugs,
    Comunidade, Campeã de Evento;
  - **temporada** (`grant`, preparada): Inverno 2026. Quem recebe no inventário mantém.
- **Seletor** (painel interno, não janela): abas Todas / Animadas / Estáticas / Conquistas / Evento,
  grade por coleção, itens bloqueados com cadeado e "como conseguir", prévia grande, Remover /
  Cancelar / Aplicar (vai para o rascunho; persiste em Salvar). Na grade a animação só roda no hover.

## Badges (Fase 2)

`cosmetics::BADGES`: **confiança** (founder, developer, moderator, verified_bot, verified_developer,
contributor, bug_hunter, event_winner) e **cosméticas** (early_user, alpha, beta, community,
supporter). Ícones SVG próprios; badges de confiança têm estilo distinto e vêm primeiro.

- **Só o servidor concede.** Fontes: arquivo do operador `badges.json` na pasta de dados
  (`{"usuario": ["founder", ...]}`, lido ao iniciar) + automáticas (`early_user` para contas criadas
  antes de 01/01/2027). Ids desconhecidos são ignorados. Calculadas na carga e ao entrar.
- O cliente não tem como enviar badges (`UpdateProfile` não tem esse campo; campos extras são
  ignorados).
- `CosmeticsState` traz as definições (`badges`) para o cliente mostrar nome e descrição.

## Desempenho e acessibilidade das animações (Fase 2)

- Molduras só existem em cartões abertos (popout, perfil, prévia, seletor), nunca nas listas.
- "Animações de perfil: Nunca", "Reduzir animações" do app e `prefers-reduced-motion` do sistema
  param decorações e molduras (fica a arte estática).
- Sem flashes: todas as animações têm ciclo ≥ 1,4 s e variação suave de opacidade; o glitch é um
  deslocamento mínimo, sem troca de contraste.

## Efeitos de entrada (Fase 3)

- Os 12 IDs clássicos continuam válidos. O catálogo ganhou sete itens gratuitos com arte CSS própria: Sinal Core, Rastro Celeste, Circuito de Entrada, Brisa de Pétalas, Fita Polar, Montagem de Pixels e Poço de Luz.
- Cada visita reproduz o efeito uma vez por 1,5 s. Se o perfil chegar do servidor depois de abrir, o cartão toca quando receber o efeito. Uma atualização do mesmo cartão não dispara a entrada de novo. A lateral da DM não toca efeito.
- Há replay no editor e no seletor. Escolher um efeito atualiza o rascunho. **Salvar** usa o `UpdateProfile` existente. O catálogo valida o tipo e a posse, e o mesmo campo `profile_effect` persiste na conta e é sincronizado. Sem migração de perfil nem alterações de protocolo.
- Somente um efeito fica ativo por janela, com até duas camadas de arte em CSS. A moldura mantém a borda visível com menos intensidade e pausa suas animações até o fim. Após o ciclo, a camada sai e a moldura volta ao normal.
- Perder foco, ocultar a janela, fechar o cartão, mudar o contexto da prévia ou desativar as animações encerra a reprodução. A política do Sancord e a preferência do Windows por movimento reduzido impedem o início. Os efeitos são silenciosos. Tempestade Arcana e Sinal VHS passaram a usar variações suaves.

## Fases

| Fase | Conteúdo | Estado |
|---|---|---|
| 1 | Modelo, editor, avatar, banner, bio, tema | **Nos fontes** |
| 2 | Decorações de avatar e molduras de perfil | **Nos fontes**. Reação à fala e animações ainda sem confirmação visual ao vivo registrada. |
| 3 | Efeitos de perfil e animações | **Nos fontes**. Efeitos de entrada, replay, interrupção em segundo plano e integração com molduras. Conferência automatizada concluída. |
| 4 | Nameplates e estilos de nome | **Nos fontes**. Novos designs, gradiente configurável, prévias e opção local de nomes simples. Conferência automatizada concluída. |
| 5 | Perfis por servidor | **Nos fontes**. Apelido, avatar, banner e bio por servidor, com herança do perfil global por campo. |
| 6 | Mural e widgets | **Nos fontes**. Aba Mural, editor com arraste e botões de ordem, controle de visibilidade e persistência. |
| 7 | Coleções, inventário e presets | **Nos fontes**. Minha Coleção, favoritos, itens novos, presets e combinações aleatórias com prévia. |
| 8 | Polimento, desempenho e acessibilidade | **Nos fontes**. Controles individuais, limite de animações e teste de carga em WebView2. |

Itens do prompt fora da tabela: privacidade do perfil, conexões e cartão rápido integram a candidata local 0.2.3. Loja, presentes, monetização e os demais provedores de verificação foram propostos para expansão.

Pontos técnicos para as próximas fases:

- O editor mantém o rascunho quando `UpdateProfile` não pode ser enviado. A confirmação de persistência do editor ainda depende da sincronização existente do servidor.
- A candidata local é `0.2.3`. O esquema v17 adiciona `server_members.profile_json`. `ProfileExtras`, o inventário e as preferências de privacidade usam o JSON da conta.

## Privacidade, conexões e cartão rápido

- Em **Configurações → Dados e privacidade**, a audiência do perfil inteiro é aplicada em conjunto com as audiências de bio, pronomes, banner, status personalizado, atividade, selos cosméticos, mural e conexões. O servidor filtra esses dados em perfis, listas, DMs e atualizações de membros. A identidade e os selos de confiança permanecem disponíveis. O acesso à chamada continua determinando quem recebe a sinalização de voz.
- Cada conexão pode ser ocultada. Para verificar um perfil pessoal do GitHub, gere um código válido por 20 minutos e publique-o temporariamente na bio pública. O servidor consulta o perfil e valida o código antes de conceder o indicador. Alterar o endereço exige nova verificação. [API pública de perfis do GitHub](https://docs.github.com/en/rest/users/users#get-a-user)
- Clicar num avatar de mensagem ou em um membro abre o cartão rápido, com acesso ao perfil completo e à conversa. O editor ganhou prévias do cartão rápido e do painel inferior. Um endereço de anexo já conhecido segue as regras do serviço de mídia.

A revisão corrigiu duas regressões no cartão existente. Os campos de aparência da resposta `UserProfile` agora são aplicados ao visitar membros offline, mantendo o apelido do servidor. As abas de relações só mostram resultados retornados pelo servidor. A suíte de DOM cobre ambos os casos.

## Perfis por servidor (Fase 5 — expandida)

- No menu do servidor, **Editar perfil do servidor…** permite personalizar avatar, banner, bio, decoração de avatar, moldura de perfil, efeito de perfil, placa de nome, estilo/cores do nome e tema do cartão. **Editar meu apelido…** conserva as permissões, a hierarquia e o registro de moderação existentes. Cada campo vazio volta a herdar seu correspondente global.
- O servidor valida posse (`cosmetics::check_equip`) e formato das cores/modos antes de salvar, e `profile_sharing::project_member_profile` oculta os overrides visuais quando a privacidade do membro restringe detalhes do cartão.
- O cartão visitado, o cartão rápido, a lista de membros e o chat do servidor combinam o perfil global com as personalizações daquele servidor; DMs e amigos continuam usando o perfil global.
- O SQLite salva somente as personalizações do membro em `server_members.profile_json`. A alteração chega aos membros via `ServerProfileUpdated` e é removida ao sair, ser expulso ou excluir a conta.

## Mural de perfil (Fase 6 — expandida)

- Em **Configurações → Perfil → Editar mural**, adicione até oito widgets. Arraste pela alça ou use os botões Subir e Descer para ordenar. Desmarque **Visível** para guardar um widget no editor e use **Salvar mural** para publicar as alterações no perfil.
- Tipos disponíveis: Jogo favorito (capa e descrição opcionais), Jogando agora, Quero jogar, Sobre mim, Link, **Bloco personalizado** (título, emoji opcional, texto até 300 caracteres e imagem opcional PNG/JPEG/WebP até 4 MB) e Conquistas. **Conquistas** reúne selos concedidos pelo servidor e **marcos automáticos** (`milestone_first_server`, `milestone_5_friends`, `milestone_100_messages`, `milestone_500_messages`).
- O servidor filtra widgets ocultos e aplica a audiência escolhida, incluindo bloqueios nos dois sentidos. O hub público fica fora da regra de servidor em comum. A aba **Mural** consulta a versão autorizada quando aberta. As sessões da própria conta recebem a configuração atualizada e a revisão impede que um rascunho antigo sobrescreva outra sessão.
- O mural é armazenado no JSON da conta em SQLite. As capas e imagens de bloco usam anexos próprios em PNG, JPEG ou WebP até 4 MB e seguem as regras existentes de acesso a mídia por URL. Os links usam HTTP ou HTTPS e são abertos pela pessoa, sem consulta ao destino no servidor do Sancord.

## Conexões sociais e administração de selos

- `ProfileLink` e `ProfileLinkView` suportam `platform` com detecção automática pelo host (GitHub, Steam, Twitch, YouTube, Spotify, X/Twitter, Instagram, Xbox, PlayStation, TikTok, LinkedIn, Reddit e site) e seleção manual no editor, preservando a distinção clara entre **GitHub verificado** e links manuais.
- `GetBadgeAdminState` e `SetUserBadges` oferecem um painel administrativo de selos em **Configurações → Dados e privacidade** visível exclusivamente para operadores autorizados (`founder`/`developer` ou `SANCORD_OPERATORS`), com persistência atômica em `badges.json`, atualização imediata de `effective_badges`/`CosmeticsState` e proteção contra remoção do último operador.

## Minha Coleção (Fase 7)

- Em **Configurações → Perfil → Minha Coleção**, os cosméticos possuídos aparecem agrupados por conjunto, com filtros de categoria, coleção e favoritos. **Equipado** indica o visual ativo da conta. **Novo** indica um item que ainda não foi visto na coleção. Abra sua prévia ou escolha **Marcar todos como vistos** para registrar a visualização.
- A estrela alterna o favorito da conta. Selecionar um item abre a prévia. **Usar no editor** seleciona aquele item para o próximo salvamento do perfil.
- **Salvar visual como preset** guarda os cosméticos, o tema e as cores do nome presentes no editor. É possível guardar até 12 combinações com nomes distintos, aplicar cada uma em um clique ou excluir uma combinação.
- **Surpreenda-me** monta uma combinação só com itens possuídos e mantém as cores do editor. A prévia usa as camadas de nome, efeito, decoração, moldura e placa do próprio perfil. **Aplicar combinação** envia o visual escolhido para validação.
- Favoritos, itens vistos e presets são particulares, persistidos no JSON da conta em SQLite e sincronizados entre as sessões da conta. O servidor valida todos os cosméticos e as cores antes de gravar o visual. Se o acesso a algum item tiver mudado, o visual anterior é preservado. Bio, presença, nome de exibição e mídia ficam fora dos presets.

## Polimento e acessibilidade (Fase 8)

- Em **Configurações → Aparência → Acessibilidade do perfil**, há controles locais para decorações, molduras, efeitos, placas, estilos de nome e animações. A opção **Reduzir animações** do Sancord e a preferência do Windows têm prioridade. A arte estática, a identidade e as ações continuam disponíveis.
- Há até dois originais GIF visíveis ao mesmo tempo. Os demais avatares e banners GIF usam uma imagem PNG do primeiro quadro. Ao perder foco ou ficar em segundo plano, o aplicativo retira o endereço animado dos elementos e cancela decodificações em andamento. Em uma versão de WebView sem `ImageDecoder`, o avatar usa iniciais e o banner conserva a cor de fundo.
- O carregamento considera a área visível da janela, com até duas decodificações em paralelo e cache de até 64 quadros de no máximo 192 pixels por lado. O cliente limita os GIFs a 8 MiB e valida as dimensões antes de decodificar. O servidor limita novas imagens de perfil a 4.096 pixels por lado e cerca de oito milhões de pixels no total, além dos limites de tamanho por tipo.
- Uma área de decoração ou moldura pode animar por vez. A animação de entrada mantém o limite de 1,5 s e duas camadas de arte. Os estilos mais fortes usam transições mais suaves, com menos variação de opacidade. O cartão reaproveita avatar e moldura quando somente outros dados mudam.
- O backend propaga o nome, a presença e os cosméticos de `UpdateProfile` para todas as sessões da conta. O upload mantém os URLs imutáveis por ID, e o quadro estático é indexado pelo URL da imagem.

### Medição no Windows

O ensaio de `scripts/profile-motion-qa.mjs` abre o executável local com dados temporários, sem registrar protocolo nem consultar atualizações. Ele usa 240 perfis sintéticos e mede duas janelas de 2 s com 110 itens visíveis. Rode `node scripts/profile-motion-qa.mjs` a partir da raiz depois de compilar `SancordApp`.

| Medida | Cosméticos ligados | Cosméticos desligados |
|---|---:|---:|
| GIFs ativos | 2 | 0 |
| Quadros estáticos visíveis | 108 | 110 |
| Quadros por segundo, amostrados por `requestAnimationFrame` | 100 | 100 |
| Tempo de tarefas do renderer | 307 ms | 111 ms |
| Tempo de CPU dos processos WebView2 | 585 ms | 507 ms |
| Pico de um motor de GPU no instante da amostra | 1% | 0% |
| Soma do conjunto de trabalho do aplicativo e WebView2 | 458,9 MiB | 504,6 MiB |

Após simular perda de foco, o ensaio confirmou zero GIFs originais e zero áreas de decoração animadas. A amostra de memória subiu durante a execução. Estes números descrevem a carga sintética em uma máquina, com o mesmo GIF pequeno usado pelos perfis.

## Placas e estilos de nome (Fase 4)

- O catálogo adiciona nove placas próprias e oito estilos de nome. Faixa Core completa a coleção Sancord Core. Placas aparecem em DMs, amigos e cartões de perfil. Mensagens e lista de membros continuam sem fundo de placa permanente.
- O seletor mostra a arte da placa e sua prévia com o nome antes de salvar. Opções novas dependem do catálogo anunciado pelo backend e seguem a validação de posse existente. Os IDs clássicos continuam válidos, inclusive o arco-íris legado.
- Gradiente Personalizado usa duas cores e quatro direções. `name_color` mantém a primeira cor. `name_color_secondary` e `name_gradient_direction` são campos opcionais no JSON da conta e em `UpdateProfile`. A cor secundária aceita hex de seis dígitos, a direção passa por lista fechada e a ausência mantém o valor anterior. As mudanças de nome são sincronizadas também entre sessões da mesma conta. Sem migração de SQLite.
- Animações de nome e das três placas com reflexo são breves e acionadas ao passar o mouse ou focar os controles relevantes. A configuração de movimento e as preferências do Windows desativam essas animações. O gradiente combina as cores escolhidas com a cor legível do contexto e o alto contraste usa a cor do sistema.
- Em **Configurações → Aparência**, a opção **Exibir estilos de nomes personalizados** pode ser desligada neste aparelho. Apelidos, identificadores, cores de cargo e selos permanecem disponíveis. A prévia do editor continua reproduzindo o rascunho.
