# Histórico de versões

## 0.2.1

- Refatoração visual desktop: tokens e paleta próprios, ícones SVG consistentes,
  colunas e controles compactos, chat/composer, membros, perfis, menus e configurações.
- Início de canal contextual, estados vazios compartilhados, membros offline reais,
  tooltips acessíveis e confirmações integradas ao aplicativo.
- Confirmações recebem foco e contêm a navegação por teclado; ensaios de DOM e
  contraste dos temas passam a integrar o CI. Ícones de reordenação corrigidos.
- Candidata local: testes automatizados aprovados; homologação visual nativa e CI do
  commit com a refatoração ainda pendentes. Esta alteração não publica uma release.
- Castigo (timeout) de membros: duração de 60 segundos a 28 dias, motivo na auditoria,
  validação no servidor e fim automático. Nova permissão "Aplicar castigo".
- Modo lento por canal (de 5 segundos a 6 horas), com contagem regressiva no campo de
  mensagem. Moderadores ficam isentos.
- Tags nos fóruns: até 20 por fórum (algumas só a moderação aplica), até 5 por postagem e
  filtro por tag.
- "Exibir status Está digitando", Modo Foco e Proteção de Links Externos agora funcionam.
  O Status da conta mostra os castigos ativos.
- Textos de segurança corrigidos: só as chamadas têm criptografia entre participantes, as
  mensagens não.
- Banco migra para a versão 13 ao iniciar o servidor.

## 0.2.0

- Auditoria persistida, AutoMod configurável e busca no histórico com filtros e
  verificação de acesso aos canais.
- Enquetes, eventos, threads e fóruns com persistência e permissões herdadas.
- Notificações por servidor/canal, navegação rápida, atalhos, responsividade,
  melhorias dos temas e estrutura de idioma pt-BR com inglês preview.

- Integrações HTTP por canal: bots de envio e webhooks com token revogável, rotação,
  persistência, auditoria, AutoMod e mensagens em tempo real (schema v10).
- Proteção de autoria de integrações, contraste nos ajustes/convites e captura de
  microfone iniciada somente por chamada/teste explícito.
- Preparação de homologação desktop e ensaio seguro de migração em cópia do banco.
- Correção do botão Depois no updater: adiar uma versão preserva o aviso de versões
  posteriores; verificar manualmente reapresenta a atualização adiada.
- Testes HTTPS automatizados de detecção, download, progresso e falhas do updater,
  com ensaio adicional do artefato real assinado pelo CI.
- Publicação condicionada também à validação HTTPS do pacote real já assinado,
  executada em um job Windows/MSVC separado e sem acesso à chave privada.

- Continuação do polimento: traduções dinâmicas da navegação rápida, atalhos e
  diálogos; preservação de nomes e conteúdo do usuário.
- Correções dos limites efetivos do cache de imagens e validação de idioma salvo.

- Câmera: seleção de webcam e qualidade nas configurações de Voz e vídeo.
- Cancelamento de câmera/tela ao sair ou trocar de canal; limpeza de recursos e
  tratamento de perda da ponte de captura.
- Correções na identificação de streams remotos e novas verificações de vídeo.
- Fase 7 em validação: teste local de tela relatado pelo usuário; webcam física
  e cenários entre redes diferentes ainda pendentes.
- Candidata em homologação: testes locais e migração da cópia aprovados; CI final
  Windows/MSVC, pacote assinado final e ciclo público de atualização ainda exigem
  validação. Nenhuma publicação estável é autorizada por este changelog.

## 0.1.0

- Cliente Windows com interface embutida no executável.
- Chat persistido, permissões de canais e recursos sociais.
- Voz em desenvolvimento, com moderação e correções de reconexão.
- Atualizações do cliente por GitHub Releases, com assinatura Ed25519 e SHA-256.
- Áudio entre máquinas e o primeiro ciclo público do updater ainda exigem validação.
