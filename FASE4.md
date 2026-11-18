# Fase 4 — cargos, permissões e canais privados

Implementação e verificação em 17/11/2026. O código existente foi estendido; os arquivos
anteriores desta etapa estão em `qa-phase4/baseline/`, pois esta pasta não possui Git.

## Implementado

- Autorização central em `src/permissions.rs`: exige participação e capacidade de gerenciar
  cargos; protege proprietário, próprio ator e hierarquia do alvo; verifica cargo antigo,
  posição nova, permissões concedidas, adições e remoções. Recusas geram feedback de erro.
- Correção da escalada reproduzida na auditoria: um gerente não pode atribuir a si cargo
  superior nem dar a outros permissões que não possui. Criar ou editar um cargo também
  não permite habilitar administrador sem autorização. Limite de 250 cargos por servidor.
- Reordenação de cargos no backend e arraste na lista atual. Um gerente só reorganiza
  a parte abaixo da própria hierarquia; o proprietário pode reorganizar todos os cargos.
- Permissões novas de visualizar canal/histórico, reagir e fixar; permissões existentes
  de enviar, anexar, gerenciar mensagens, mencionar e voz são calculadas por canal.
- Sobrescritas por cargo e membro em categorias e canais. Servidor → categoria → canal;
  herdar é ausência da chave, permitir é true, negar é false. Todos os cargos participam
  da união; na mesma camada, allow de um cargo vence deny de outro. Exceção individual
  é aplicada por último. Proprietário e administrador ignoram restrições de canal.
- Canais sincronizados seguem a categoria; personalizar aplica exceções adicionais.
  Sincronizar novamente remove as exceções próprias. Canais antigos começam sincronizados.
- Criação atômica de canal privado, com acesso opcional de um cargo. Ele não é criado
  público para depois receber uma restrição.
- Migração SQLite v3 → v4 compatível; sobrescritas e sincronização são persistidas.
- Projeção de saída em `src/access.rs`: Welcome, servidores, canais, histórico, fixadas,
  mensagens, digitação, leitura e presença em voz são filtrados por destinatário.
  Consultas assíncronas são revalidadas na saída, depois de possíveis revogações.
- Contagem de menções só inclui destinatários que enxergam o canal. A mesma regra vale
  para menções coletivas e de cargos, além das menções diretas.
- Alterações de cargo/permissão sincronizam estrutura e estados de leitura. O cliente
  remove caches/DOM inacessíveis, muda para um canal acessível e busca apenas históricos
  recém-liberados. Uma página do histórico preserva mensagens novas recebidas durante a consulta.
- Sinalização WebRTC limitada a participantes no mesmo canal autorizado; publicação de
  áudio/vídeo no SDP e estado de transmissão respeitam permissões. Revogar direitos de
  voz/mídia encerra conexões existentes; o usuário pode voltar como ouvinte se permitido.
- Excluir cargo remove suas sobrescritas. Renomear usuário atualiza exceções individuais.
  Uma categoria restrita com canais não pode ser excluída automaticamente, para evitar
  que canais herdados se tornem públicos: primeiro é necessário movê-los.

## Interface

- Preservados painéis, identidade escura, menus, editor de cargos e controles existentes.
- Menu de contexto do canal/categoria abre o editor de permissões; cada regra tem
  Herdar / Permitir / Negar e seleção de cargo ou membro.
- Criar canal oferece acesso privado e seleção de cargo autorizado.
- Editor de cargos mostra 18 permissões e limita edição/atribuição conforme a hierarquia.
- Composer, anexos, reações e fixadas refletem permissões; o backend continua sendo a
  fonte da decisão. DMs restauram seus controles ao sair de um canal restrito.
- Diálogos longos têm limite de altura e rolagem; o editor de permissões usa duas colunas
  em janelas maiores. Evidência: `qa-phase4/permissoes-validado.jpg`.

## Testado

- `cargo check --locked --all-targets --target-dir target-dev`: passou, sem warnings.
- `cargo build --locked --bin sancord --target-dir target-dev`: passou.
- `cargo test --locked --lib --target-dir target-dev`: 53 passaram (47 anteriores + 6 da Fase 4).
- `cargo test --locked --bin SancordApp --target-dir target-dev`: 2 passaram.
- `node --test tests/frontend-chat.test.cjs tests/frontend-permissions.test.cjs`: 15 passaram.
- `node --check` nos arquivos JS alterados: passou.
- Total: **70 testes automáticos passaram**. Nenhum teste existente foi removido.
- Os seis cenários novos Rust usam HTTP/WS reais ou SQLite real: escalada/gestão válida
  e reordenação; isolamento de canal privado; categoria/exceção/sincronização e reabertura
  do banco; criação privada atômica e união de cargos/exceção individual; sinalização e
  revogação da voz; migração de estrutura v3 preservando um registro existente.
- Navegador, duas contas isoladas: editor permitindo/negar/herdar; salvar negação de envio
  e reações; composer desabilitado para membro; cargo Equipe concedendo acesso e histórico
  privado sem recarga; remoção do cargo retirando imediatamente canal e conteúdo da tela;
  criar canal privado pela interface sem mostrá-lo ao membro.
- Após recompilar/reiniciar a versão final, foi repetida a concessão de Equipe: o cliente
  carregou o histórico privado sob demanda e exibiu a mensagem existente, sem erro de console.

## Limites e continuidade

- Validação de voz desta etapa é de protocolo/autorização. Captura/reprodução real de
  áudio, câmera e compartilhamento entre máquinas/redes continuam sem nova validação.
  A arquitetura de mídia permanece P2P mesh, com as limitações já registradas.
- O arraste de cargos foi implementado; autorização/reordenação foram testadas no backend.
  O gesto de arraste não foi exercitado manualmente nesta rodada visual.
- Downloads mantêm o modelo preexistente de URL de capacidade (UUID aleatório). As URLs
  não são publicadas a quem não tem acesso ao canal, mas conhecer uma URL de anexo ainda
  permite baixá-lo; esta etapa não introduziu autorização por sessão nos downloads nem
  revogação de URLs previamente conhecidas.
- A migração foi testada com esquema v3 isolado e a persistência com banco real de QA;
  não foi executada no banco principal. Não houve teste de carga nem distribuição nova.
- O ambiente de QA usou `127.0.0.1:3100`, `qa-phase4/data` e descoberta desligada.
  O processo foi encerrado após os testes; o banco de QA e as evidências foram preservados.
- Banco principal, executáveis distribuídos e `target/debug/sancord.exe` preservados.
  O servidor novo está em `target-dev/debug/sancord.exe`; não foi publicado em produção.
- Próxima fase principal: Social — aproveitar amigos/DMs existentes, implementar bloqueio
  e privacidade no backend, solicitações de mensagem e grupos. A denúncia que só mostra
  toast continua pendente de implementação real; ela não foi tratada como funcional.
- Permanecem pendências da Fase 3: limpeza de uploads abandonados, emojis próprios e
  prévias de links seguras. Threads, fóruns, enquetes, eventos, timeout, AutoMod e auditoria
  não foram implementados nesta fase.
