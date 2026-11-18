# Distribuição e atualizações do Sancord

## Arquitetura e limites

O cliente usa Wry/Tao/WebView2, não Tauri. Preservamos o launcher portátil existente:
`Sancord.exe` extrai a interface embutida e o cliente para uma pasta de versão em
`%LOCALAPPDATA%/SancordDesktopData/bin_v4/`. O pacote não contém o banco do anfitrião.

O updater nativo consulta GitHub Releases por HTTPS sem tokens no cliente. Só aceita
releases estáveis e maiores que a versão instalada. O manifesto inteiro, incluindo
versão, destino, nome do pacote, tamanho, hash e notas, é assinado com Ed25519.
O cliente verifica a assinatura com a chave pública compilada, baixa com limites e
progresso, calcula SHA-256 e verifica novamente antes de instalar. O WebView não
recebe URLs de download nem controla caminhos de instalação.

Ao confirmar **Reiniciar e instalar**, uma cópia do cliente instalado aguarda o
processo atual encerrar. Ela revalida a assinatura e o pacote, copia o arquivo ao
lado do destino, verifica a cópia e troca o launcher por renomeação no mesmo volume.
A versão anterior fica como `Sancord-before-<versão>-<uuid>.exe`. Se o novo processo
não puder ser criado, a troca é revertida. Falhas posteriores ao início do processo
exigem recuperação manual; não há promessa de rollback automático de crashes.

O sistema atualiza somente o **cliente**. O backend e suas migrações continuam sob
controle do anfitrião. Compatibilidade de protocolo deve ser mantida entre releases.
O pacote inicial com updater precisa ser instalado uma vez manualmente pelos usuários
dos executáveis antigos. Depois, as atualizações são recebidas dentro do aplicativo.

O pacote Windows é portátil (EXE e ZIP), sem privilégios de administrador. Instale-o
numa pasta em que seu usuário possa gravar. WebView2 Runtime precisa estar instalado.
Os builds Windows/MSVC usam CRT estático pela configuração `.cargo/config.toml`,
para não exigir uma cópia separada de `vcruntime140.dll`.
A assinatura Ed25519 autentica o updater; ela não é um certificado Authenticode e
não remove avisos SmartScreen. Certificado de assinatura Windows é uma etapa separada.

## Configuração inicial

1. Repositório público: `https://github.com/gabrielsanderx/Sancord`.
2. A chave pública está em `release-config.json`, versionada e embutida no build.
   A privada gerada com autorização fica fora do workspace:
   `%USERPROFILE%/.sancord-release/sancord-update-signing.key`.
   A pasta tem acesso restrito ao usuário atual. Faça uma cópia offline protegida;
   perder a chave impede assinar atualizações aceitas pelos clientes existentes.
3. No GitHub, abra **Settings → Secrets and variables → Actions → New repository secret**.
   Nome: **`SANCORD_UPDATE_SIGNING_KEY`**. Valor: o conteúdo hexadecimal desse arquivo.
   Não cole a privada no chat, em commits, issues, logs ou variáveis públicas.
4. Se quiser copiar sem exibir a chave no terminal, execute localmente:

   ```powershell
   Get-Content "$env:USERPROFILE/.sancord-release/sancord-update-signing.key" -Raw | Set-Clipboard
   ```

   Cole no campo Secret do GitHub e limpe o clipboard ao terminar. Essa etapa é manual.
5. Em **Settings → Environments**, crie `release`. Configure revisores obrigatórios
   se quiser aprovar cada publicação. Sem essa regra, enviar uma tag estável autoriza
   o workflow a publicar depois que os testes/build passarem.
6. Se usa descoberta assinada do anfitrião, configure a variável pública opcional
   `SANCORD_DISCOVERY_PUBKEY` com a chave pública de descoberta. É diferente da chave
   de atualização. Nunca copie `data/discovery.key` para o repositório.
7. Revise o primeiro commit e faça o push autenticado da branch `main`. Esta preparação
   local não cria tags e não publica releases automaticamente.

Para criar uma chave em outro ambiente, use `cargo run --bin sancord-release -- keygen
<arquivo-novo-fora-do-repositório>`, a partir da raiz. O comando não sobrescreve uma
privada existente e atualiza somente a parte pública em `release-config.json`.
Restrinja as permissões da pasta da chave antes de gerar o arquivo.

## Publicar uma versão

1. Termine e revise as alterações na `main`. Atualize `CHANGELOG.md`.
2. Para a próxima versão, execute:

   ```powershell
   ./scripts/prepare-release.ps1 -Version 0.1.1
   ```

   Preencha a seção `## 0.1.1` do changelog. O script altera `Cargo.toml` e atualiza o
   lockfile; não faz commit, tag ou push.
3. Valide e faça commit:

   ```powershell
   ./scripts/prepare-windows.ps1
   cargo check --locked --all-targets
   cargo test --locked --all-targets
   node --test tests/frontend-*.test.cjs
   git add .
   ./scripts/audit-git.ps1
   git diff --cached --stat
   git commit -m "Release 0.1.1"
   git push origin main
   git tag v0.1.1
   git push origin v0.1.1
   ```

4. O workflow verifica que a tag coincide com `Cargo.toml`, é estável e pertence à
   história da `main`. Executa CI, compila Windows x64 MSVC, empacota, assina com o
   Secret e verifica a assinatura antes de criar a release.
5. Os assets são enviados primeiro como draft. Só depois do upload completo o draft
   é publicado como estável/latest. Releases existentes não são sobrescritas.
6. Usuários recebem **Atualização disponível**, versão e changelog. O download e o
   reinício exigem ação do usuário. Também existe **Configurações → Atualizações**.

Para a primeira publicação da versão atual, use `v0.1.0` depois de configurar o Secret
e validar o pacote. Não crie essa tag antes de querer distribuir o estado atual das fases.
Tags com `-beta`, `-rc` ou outros sufixos são rejeitadas pelo fluxo estável. Execução manual
do workflow de release gera artefatos de build, sem publicar no canal estável.

## Builds locais e testes do updater

```powershell
./scripts/package-release.ps1
cargo run --locked --bin sancord-release -- check
```

Os pacotes ficam em `dist/`; nada é publicado por esses comandos. Para assinar localmente,
carregue a privada somente no ambiente temporário da ferramenta e remova-a em seguida:

```powershell
try {
  $env:SANCORD_UPDATE_SIGNING_KEY = [IO.File]::ReadAllText("$env:USERPROFILE/.sancord-release/sancord-update-signing.key").Trim()
  ./dist/release-tools.exe sign dist dist/release-notes.md
  if ($LASTEXITCODE -ne 0) { throw 'Falha de assinatura' }
  ./dist/release-tools.exe verify dist
} finally {
  Remove-Item Env:SANCORD_UPDATE_SIGNING_KEY -ErrorAction SilentlyContinue
}
```

Testes em `src/updates_tests.rs` cobrem SemVer, versões iguais/antigas/prerelease,
assinaturas inválidas, chave errada, metadados alterados, limites, progresso,
truncamento, erro de leitura, revalidação, instalação, acionamento do reinício e
rollback quando criar o processo falha. Os testes de instalação usam executáveis
de fixture e um callback de lançamento; não equivalem a uma atualização pública real.
`tests/frontend-updater.test.cjs` cobre ações, estados, progresso e changelog como texto.

O teste completo requer duas versões reais assinadas: instalar a primeira em um perfil
Windows de QA, publicar a segunda, verificar notificação/changelog, baixar, confirmar
reinício e conferir a nova versão. Repetir offline, com arquivo adulterado e com a pasta
sem permissão de escrita. Nunca use o banco de produção para esse ensaio.

## Recuperação

- Falhou o build, teste, Secret ou assinatura: a release não deve ser publicada.
  Corrija o problema; se existe draft incompleto, revise/remova o draft manualmente
  antes de repetir o workflow. Nunca sobrescreva uma release já publicada.
- Bug numa versão publicada: publique uma versão **maior** com a correção ou com o
  código revertido. Não reutilize tags nem tente forçar downgrade no updater.
- Falha ao iniciar após atualização: feche o aplicativo e restaure manualmente o
  arquivo `Sancord-before-...exe` para `Sancord.exe`. Perfis e banco permanecem separados.
- Perda da privada: não gere outra esperando que os clientes antigos a aceitem.
  Restaure o backup protegido. O assinador atual exige que a privada corresponda à
  pública compilada: trocar somente o arquivo de configuração não implementa rotação.
  Uma rotação planejada exige preparar e testar uma migração de confiança, inclusive
  para clientes que ficaram offline e não receberam uma versão intermediária. Esse
  fluxo ainda não é automatizado. Comprometimento exige avaliar distribuição manual
  por canal confiável; não tente contornar a verificação de assinatura.
- O updater não altera serviços do anfitrião, não executa comandos remotos, não usa
  `taskkill` e não altera permissões de administrador.

Referências: [GitHub Releases API](https://docs.github.com/en/rest/releases/releases),
[GitHub Actions Secrets](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets),
[gh release create](https://cli.github.com/manual/gh_release_create).
Configuração de CRT: [referência de linkage do Rust](https://doc.rust-lang.org/reference/linkage.html).
