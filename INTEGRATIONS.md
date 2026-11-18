# Bots de envio e webhooks

Implementação real de integrações HTTP de entrada, com persistência SQLite v10.
O escopo é publicar texto em um canal. Não é uma API pública de automação completa:
comandos, leitura de mensagens, anexos, avatar próprio e assinatura de eventos não
fazem parte deste contrato. Não há bot fictício representando uma integração pronta.

## Pelo aplicativo

Em **Configurações do servidor → Integrações**, escolha o canal e crie um webhook
ou bot de envio. É preciso ver/enviar no canal e gerenciar canais ou o servidor.
Em anúncios, também é necessário poder moderar mensagens. Fóruns, threads e DMs
não recebem essas credenciais.

A URL é mostrada sem segredo; o token vai no cabeçalho `Authorization: Bearer TOKEN`.
O diálogo de criação/renovação permite copiar os dados e mostra o token uma vez.
Não o coloque no chat, código público ou URL. A listagem não revela token ou hash.
O aplicativo não salva o token no perfil/localStorage e o backend persiste só SHA-256.

Renovar invalida o segredo anterior; revogar remove a integração. Perder acesso ou
permissão de gerenciamento interrompe o envio. Um administrador pode renovar a
credencial e assumir sua responsabilidade. Excluir canal/servidor remove a integração.
Criação, renovação e revogação entram na auditoria.

## Contrato HTTP

| Método e rota | Credencial | Resultado |
|---|---|---|
| GET `/api/channels/{channel}/integrations` | Sessão do usuário | Metadados, sem segredo |
| POST na mesma rota, JSON `name`, `kind` (`bot` ou `webhook`) | Sessão do usuário | Metadados e token novo |
| POST `/api/integrations/{id}/rotate` | Sessão do usuário | Token novo |
| POST `/api/integrations/{id}/revoke` | Sessão do usuário | Revogação imediata |
| POST `/api/integrations/{id}/messages`, JSON `content` | Token da integração | Mensagem persistida e distribuída por WS |

O canal e tipo do autor vêm da credencial, nunca do payload. O envio aceita de 1 a
4000 caracteres, com limite de corpo de 64 KiB e limite de ritmo por integração.
O AutoMod é aplicado sem herdar a isenção de administrador do criador. Menções não
notificam. HTTP: 201 para criação/envio, 400 para conteúdo inválido, 401 para segredo
inválido/revogado, 403 para permissão perdida, 422 para AutoMod e 429 para excesso.
Usar HTTPS para o backend fora do computador local.

Exemplo PowerShell, com variáveis definidas localmente a partir do diálogo:

```powershell
$headers = @{ Authorization = "Bearer $env:SANCORD_INTEGRATION_TOKEN" }
$body = @{ content = 'Nova versão disponível para teste.' } | ConvertTo-Json
Invoke-RestMethod -Uri $env:SANCORD_INTEGRATION_URL -Method Post -Headers $headers -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($body))
```

Não confundir essas credenciais com a chave privada de assinatura das releases.

## Evidências e limites

`src/integrations_tests.rs` usa HTTP e WS reais em dados temporários: autorização,
entrega, autoria, persistência, rotação, revogação, AutoMod, ritmo, exclusão de canal
e proteção contra editar/excluir um bot com o mesmo nome de usuário. A interface tem
testes de transporte, seleção de canais e distinção de autoria.

O banco de produção não é migrado para testar. O instalador da raiz ainda é a versão
anterior: usar o cliente/backend de QA recompilados para validar estas funções.
