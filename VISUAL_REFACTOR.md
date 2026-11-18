# Refatoração visual do Sancord — 18/11/2026

Implementação sobre o trabalho existente do Claude, na candidata **0.2.1**. A interface
continua embutida no executável Wry/Tao/WebView2. Não foi criado site, framework novo,
serviço, migração ou protocolo para esta refatoração.

## Cobertura do prompt

| Etapa | Implementação |
| --- | --- |
| A — tokens, tipografia, cores e ícones | `static/ui.css` concentra superfícies semânticas, cores próprias, espaçamentos, pesos, raios, medidas e durações. Claro, Escuro, Cinza e OLED usam a mesma linguagem. `static/js/icons.js` fornece um catálogo SVG local para os controles. Logo, imagens, emojis de conteúdo e personalizações continuam preservados. |
| B — servidores, canais e usuário | Grade usa os mesmos tokens de largura das colunas; rail 72 px, ícones 48 px, sidebar 240 px, categorias/canais compactos, indicadores e menus existentes preservados. Painel do usuário com 52 px, controles compactos, nome com ellipsis e estados de mute/deafen. |
| C — cabeçalho, chat e composer | Header 48 px, busca compacta com ícone, mensagens agrupadas/timestamps/ações existentes mantidos. Boas-vindas com nome real no início do histórico; filtros/carregamento não exibem início falso. Envio neutro de 32 px; Enter/Shift+Enter, resposta, anexos e listeners mantidos. Textarea limitado ao menor valor entre 200 px e 30% da altura. |
| D — membros, perfis e menus | Membros online agrupados por cargos e offline derivados do cadastro real do servidor; sessões duplicadas eliminadas. Perfis offline consultam o perfil real ao clicar. Itens acessíveis por teclado; removido fundo permanente de nameplate nos membros/user panel. Popovers, perfis e menus usam os mesmos tokens. |
| E — settings, modais e tooltips | Conta, servidor, perfil, updater e diálogos compartilham superfícies e controles. Confirmações nativas restantes substituídas pelo diálogo existente do Sancord, conservando o alvo antes do `await`. Tooltips por mouse/teclado mantêm nome acessível e acompanham mudanças de estado. |
| F — polimento e adaptação | Membros saem da grade antes da descrição do canal; sidebar e busca se adaptam. Foco visível, scrollbars, densidade compacta, raio escolhido e redução de movimento preservados. Barra nativa e tela de conexão acompanham os tokens, sem alteração dos comandos de janela. |

Estados vazios compartilhados: canal/conversa, amigos/solicitações/bloqueados, DMs,
favoritas, fixadas, busca, membros, atividade, eventos, fóruns e auditoria. O aplicativo
não recebeu uma central de notificações cenográfica: avisos continuam usando os fluxos
reais já existentes, incluindo o updater.

`styles.css` permanece como base dos componentes legados e das personalizações; a
camada final `ui.css`, carregada depois, governa os componentes refatorados. Cores de
avatar, cargo, decoração e conteúdo do usuário não foram substituídas por cores fixas.

## Arquivos desta continuação

- `static/ui.css`, `static/js/icons.js`, `static/index.html`.
- `static/app.js`, `static/js/ui-kit.js`, `static/js/chat.js`, `static/js/servers.js`.
- Estados vazios em `advanced.js`, `community.js`, `threads.js`, `social.js`, `polish.js`.
- Estilos da conexão/titlebar em `src/bin/SancordApp.rs`; assets embutidos e teste de
  rotas CSS em `src/bin/desktop_assets.rs`.
- `tests/frontend-visual.test.cjs`, `CHANGELOG.md`, este documento e `AI_HANDOFF.md`.
- Somente correção de caracteres nos comentários/descrição do `Cargo.toml`; versão e
  dependências da candidata do Claude preservadas.

As mudanças de backend, timeout, modo lento, tags, schema 13 e privacidade já presentes
na pasta são do trabalho anterior. Não foram recriadas nesta continuação.

## Validação

Baseline antes das alterações: 106 testes de núcleo + 8 desktop + 1 manutenção +
107 frontend aprovados. Após a continuação: **106 + 8 + 1 + 123 = 238 testes aprovados**.
Um ensaio do artefato assinado permanece ignorado por padrão, pois requer o pacote
assinado específico; não está incluído nessa contagem.

Comandos da suíte permanente:

```powershell
cargo check --locked --all-targets
cargo test --locked --all-targets
npm ci --ignore-scripts --no-audit --no-fund
npm test
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File scripts/audit-git.ps1 -WorkingTree
```

Os nove testes visuais de comportamento cobrem catálogo seguro de ícones, escaping
dos estados vazios, tooltips acessíveis, membros reais offline/deduplicação, início do
histórico, limite do composer, cancelamento e alvo de exclusão durante confirmação
assíncrona. As suítes existentes continuam cobrindo chat, permissões, social, voz/vídeo,
updater, integrações, castigos, modo lento, tags e preferências.

Os ensaios de DOM/CSS agora são **sete testes permanentes**, executados também pelo
CI e por `scripts/homologate.ps1`. Eles carregam todos os scripts do HTML, verificam
controles dinâmicos/reações, os quatro temas, ausência de captura ao abrir Voz, tooltips
e teclado nos diálogos. O contraste é calculado após aplicar as variáveis das duas
folhas, respeitando a especificidade dos seletores dos temas. Foi reproduzida uma
falha de foco da confirmação antes da correção: agora Cancelar recebe foco, Tab e
Shift+Tab ficam dentro do diálogo e Escape cancela/restaura o foco anterior.

Ensaios locais adicionais em `qa-visual-20261118/` (ignorados pelo Git):

- Snapshot dos fontes anteriores em `baseline/`, sem bancos nem credenciais.
- Parser CSS: ambos os estilos sem erro de sintaxe; cascata de temas conferida para
  evitar que o CSS legado prevaleça no tema Escuro ou no fundo dos inputs.
- Texto normal e secundário sobre o fundo do chat: contraste entre **5,53:1 e 13,25:1**
  nas combinações medidas. Isso não é certificação de contraste de toda a interface.
- `dom-smoke.cjs`: todos os scripts do HTML carregados na ordem real em um DOM isolado;
  ícones estáticos/dinâmicos, classes, badges, reações, listeners, tooltip, temas,
  configurações e cancelamento aprovados. Abrir a aba Voz não solicita captura.
  Rede, mídia e timers contínuos são desativados neste ensaio; não é teste de WebView2.
- `css-tree` e `jsdom` foram promovidos a dependências **somente de desenvolvimento**
  em `package.json`, com versões exatas e integridade em `package-lock.json`.
  `node_modules/` é ignorado; a instalação de testes usa `npm ci --ignore-scripts`.
  Nenhuma dependência Node é necessária para executar ou distribuir o Sancord.

## Pacote local e limites

Pacote candidato: `qa-visual-20261118/package/Sancord-0.2.1-windows-x64.zip`, contendo
somente `Sancord.exe`. O servidor e a ferramenta de manutenção ficam separados na pasta
de saída e não fazem parte do ZIP do cliente. Gerado pelo processo existente:

```powershell
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File scripts/package-release.ps1 -OutputDir qa-visual-20261118/package
```

É um build local, **sem assinatura de release**. Não foi publicado, não substitui o
artefato assinado `8c9cbd9` e não deve ser enviado ao updater como release estável.
O build usa a toolchain local; Windows/MSVC e assinatura precisam do CI no commit final.

**Homologação nativa ainda pendente:** a revisão automática rejeitou o comando de
abertura do cliente isolado com `blocked by policy`, sem fornecer motivo detalhado.
Nenhum método alternativo de lançamento foi usado para contornar a rejeição. Assim,
não há alegação de comparação visual, segunda rodada por screenshot ou teste completo
de rede/mídia na janela atualizada. Esta pendência impede declarar todos os critérios
visuais do prompt homologados, apesar de os fontes compilarem e os testes passarem.

Quando a abertura nativa estiver disponível, conferir o pacote isolado em 1320×830 e
940×600, DPI 100/125/150%, quatro temas, nomes longos, coluna de membros/overlay,
mensagens agrupadas, reply/uploads, menus, perfis, settings e updater. Conferir também
voz/tela com duas instâncias, sem iniciar captura sem ação explícita. Corrigir eventuais
diferenças de layout antes da publicação; não executar o backend candidato sobre os
dados de produção apenas para inspecionar o visual.

## Git e próximo passo

O trabalho anterior foi enviado pelo Claude à branch remota `release/0.2.1` em
`8c9cbd9` pela API. O histórico remoto foi buscado sem alterar o working tree original.
Uma branch local `codex/visual-0.2.1` é preparada em worktree isolado, derivada desse
commit e com os fontes atuais sobrepostos, sem perder as implementações do Claude.
A validação CI de `8c9cbd9` não inclui esta refatoração. O próximo passo de distribuição
é enviar a branch final e executar `release.yml` manualmente para validar Windows/MSVC
e assinatura, sem tag/release pública; a homologação nativa continua necessária.
Nenhuma tag, push, release, troca de executável instalado ou migração de produção foi
feita por esta continuação.
