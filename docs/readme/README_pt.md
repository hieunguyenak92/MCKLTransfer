<div align="center">

[English](../../README.md) · [简体中文](README_zh-CN.md) · [日本語](README_ja.md) · [Tiếng Việt](README_vi.md) · [ไทย](README_th.md) · [Español](README_es.md) · **Português**

# MCKL Transfer

</div>

Partilhe ficheiros e converse através do seu próprio servidor numa LAN ou entre dispositivos autorizados numa rede sobreposta (overlay). Apenas o servidor precisa de Node.js; os outros dispositivos usam um navegador. Não há contas na nuvem da MCKL, análise de utilização, base de dados nem dependências npm em tempo de execução.

**0.2.0-alpha.2 · Apache-2.0 · experimental.** Consulte os [resultados de verificação](../VALIDATION.md) e o [modelo de segurança](../../SECURITY.md) antes de implementar. Não há garantia de suporte estável nem de velocidade LAN em todos os dispositivos.

## Início rápido numa rede de confiança

Instale Node.js **24, a partir de 24.22.2**, ou **26, a partir de 26.13.0**, com as correções atualizadas. No diretório do código-fonte:

```sh
npm start
```

Não é necessário executar `npm install`. O terminal mostra os endereços LAN, um código de acesso de seis dígitos e um **código de administrador separado**. Abra o endereço LAN noutro dispositivo, introduza um nome de dispositivo e o código de acesso. Forneça o código de administrador apenas à pessoa que gere o servidor. Os códigos nunca são expostos pela API, nem mesmo em localhost.

A ligação HTTP predefinida não é encriptada: use-a apenas numa rede que controla e com pessoas de confiança. Use HTTPS ou uma rede sobreposta controlada para outras ligações. Não encaminhe esta porta do router para a Internet.

### Utilização da aplicação

- Selecione ou arraste vários ficheiros. A fila de toda a aplicação transfere até dois ficheiros em simultâneo, com velocidade, tempo estimado e controlos para pausar, retomar, tentar novamente e cancelar.
- Depois de perder a ligação ou recarregar a página, selecione novamente o mesmo ficheiro para retomar. O cookie do dispositivo deve continuar disponível e o envio não pode ter expirado. O navegador não mantém automaticamente a autorização de leitura de um ficheiro depois de fechar a página.
- Use **um único separador de envio por servidor**. Os separadores da mesma origem partilham cookies e registos de retoma. Se dois separadores retomarem o mesmo envio, cancelar num deles pode apagar o progresso parcial do outro. O ficheiro original permanece seguro; o outro separador precisa de recomeçar quando receber `404`. Esta versão alfa não coordena a titularidade dos envios entre separadores.
- Antes de enviar, o navegador lê o ficheiro original para calcular SHA-256; cada bloco e o ficheiro completo são verificados no host. O cálculo do hash exige uma leitura adicional e pode ser lento em dispositivos menos potentes. O ficheiro inteiro não é mantido na RAM.
- Os ficheiros concluídos aparecem na lista partilhada; todos os membros com sessão iniciada podem descarregá-los. Os membros só podem eliminar os ficheiros que enviaram. O administrador pode eliminar qualquer ficheiro e revogar sessões de dispositivos.
- A conversa partilhada guarda até 200 mensagens na RAM; estas perdem-se quando o host reinicia. Mantenha a página aberta durante as transferências, sobretudo em telemóveis. A PWA não garante transferências em segundo plano nem a continuação quando o iOS bloqueia o ecrã.

O modelo é **navegador A → o host guarda o ficheiro → o navegador B descarrega-o**. «Envio concluído» significa que o host recebeu e verificou o ficheiro; não significa que B o tenha descarregado ou guardado. O host pode ler os ficheiros e a conversa; não há E2EE nem salas privadas por destinatário.

## Idioma

A interface da aplicação está disponível em **Tiếng Việt** e **English**. Use o seletor de idioma na barra superior; a sua escolha fica guardada neste navegador. Na primeira utilização, a aplicação segue o idioma do navegador e usa inglês se esse idioma não for suportado. Mudar de idioma não recarrega a página nem interrompe as transferências; o conteúdo dos ficheiros, as mensagens da conversa e os nomes dos dispositivos não são traduzidos. O README está disponível em sete idiomas através dos links no início da página.

## Configuração

A aplicação lê as variáveis de ambiente do processo; não carrega ficheiros `.env` automaticamente. Os tamanhos são indicados em bytes e os tempos em milissegundos.

| Variável | Valor predefinido | Significado |
|---|---|---|
| `HOST`, `PORT` | `0.0.0.0`, `8787` | Interface e porta de escuta; IPv4 por predefinição |
| `SHARE_DIR` | `./shared` junto ao código-fonte | Diretório de dados privados; de preferência fora do repositório |
| `DEVICE_NAME` | hostname | Nome do host, apresentado apenas após iniciar sessão e no terminal |
| `SHARE_CODE` | Seis dígitos aleatórios em cada arranque | Código de membro; `LAN_SHARE_CODE` continua a ser aceite por compatibilidade |
| `ADMIN_CODE` | Valor aleatório separado em cada arranque | Pelo menos 24 caracteres; mantenha-o em segredo |
| `MAX_FILE_SIZE` | `21474836480` (20 GiB) | Limite por ficheiro |
| `MAX_TOTAL_SIZE` | `107374182400` (100 GiB) | Ficheiros concluídos mais capacidade reservada para envios |
| `MIN_FREE_SPACE` | `134217728` (128 MiB) | Espaço livre de reserva; não é uma quota de disco do sistema operativo |
| `CHUNK_SIZE` | `4194304` (4 MiB) | Máximo de 16 MiB por pedido de envio de um bloco |
| `MAX_CONCURRENT_UPLOADS` | `4` | Operações simultâneas de escrita/cálculo de hash de envios no servidor |
| `MAX_PENDING_UPLOADS` | `128` | Número de envios incompletos mantidos |
| `UPLOAD_TTL_MS` | `86400000` (24 horas) | Prazo absoluto desde a criação de um envio incompleto |
| `SESSION_TTL_MS`, `MAX_DEVICES` | `43200000` (12 horas), `128` | Duração da sessão normal e total de sessões de dispositivos; sessões memorizadas duram até 30 dias |
| `REQUEST_TIMEOUT_MS` | `1800000` (30 minutos) | Tempo para receber um pedido; sockets inativos durante 60 segundos são desligados |
| `TLS_KEY_FILE`, `TLS_CERT_FILE` | Não definido | Par de chave privada/certificado PEM para HTTPS direto |
| `PUBLIC_URL` | Não definido | Origem externa do proxy, como `https://transfer.example.org`; sem caminho nem consulta |
| `ALLOWED_HOSTS` | Hostname/interfaces locais | Nomes de host/IP específicos adicionais, separados por vírgulas; sem caracteres universais nem portas |

Exemplo em PowerShell com um diretório de dados separado:

```powershell
$env:SHARE_DIR = "D:\MCKL-data"
$env:DEVICE_NAME = "Home transfer host"
npm start
```

Alterar os códigos após reiniciar não revoga as sessões já concedidas. Use o painel de gestão de dispositivos para as revogar. Se um PIN for divulgado, altere o PIN **e** revogue as sessões que não sejam de confiança. Os cookies e a titularidade dos ficheiros mantêm-se após reiniciar. Terminar a sessão ou apagar os cookies e voltar a emparelhar cria uma identidade nova; o administrador continua a poder eliminar os ficheiros antigos.

## HTTPS e ligações entre redes

### HTTPS direto

Obtenha um certificado cujo SAN corresponda ao hostname/IP utilizado, emitido por uma CA em que todos os dispositivos confiem. Mantenha a chave fora do código-fonte, restrinja as permissões de leitura e configure ambas as variáveis:

```sh
TLS_KEY_FILE=/secure/mckl/server.key TLS_CERT_FILE=/secure/mckl/server.pem npm start
```

Abra o URL `https://...` correspondente. Não ignore erros de verificação do certificado. Os certificados autoassinados exigem um procedimento, através de um canal de confiança, para instalar a confiança na CA ou verificar impressões digitais; a aplicação não automatiza o emparelhamento de certificados. Os cookies HTTPS usam `Secure`, `HttpOnly` e `SameSite=Strict`.

### Grupos privados através de Tailscale ou WireGuard

Instale a rede sobreposta nos dispositivos, autorize os membros pretendidos e restrinja a porta do serviço. Mantenha a autenticação da MCKL. Com WireGuard, gere as chaves, o encaminhamento, a firewall e o DNS; com Tailscale, verifique as políticas e os caminhos diretos ou por relay. Um intervalo de IP privados não demonstra, por si só, que um dispositivo é de confiança.

Uma opção HTTPS para uma tailnet é [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve). Depois de o host ter um nome DNS e de configurar HTTPS na tailnet, execute MCKL apenas em loopback com essa origem:

```sh
HOST=127.0.0.1 PUBLIC_URL=https://YOUR-HOST.YOUR-TAILNET.ts.net npm start
```

Noutro terminal:

```sh
tailscale serve --bg http://127.0.0.1:8787
tailscale serve status
```

Abra exatamente o URL HTTPS fornecido pelo Serve. Este serviço destina-se à tailnet; restrinja a sua política de acesso. Consulte a [CLI do Serve](https://tailscale.com/docs/reference/tailscale-cli/serve) para conhecer os requisitos e como o desativar. MCKL não instala nem configura Tailscale automaticamente, e esta versão não foi testada numa tailnet real.

Outros proxies inversos devem encaminhar streaming/SSE sem buffering, preservar Host ou definir `PUBLIC_URL` corretamente, configurar limites de tempo/tamanho do corpo adequados e restringir o acesso ao servidor de origem ao proxy de confiança. A aplicação não confia em `X-Forwarded-*` para determinar se a ligação é segura.

## Dados, atualizações e cópias de segurança

O host mantém `.mckl-manifest.json`, `.mckl-devices.json` (hashes dos tokens de sessão), `.mckl-uploads.json` e `.mckl-objects/` em `SHARE_DIR`. Os novos conteúdos são guardados por ID; os nomes apresentados estão no manifesto. Não edite nem elimine ficheiros internos enquanto o servidor está em execução. Não execute dois processos sobre o mesmo `SHARE_DIR`.

Pare o host antes de fazer uma cópia de **todo** o diretório de dados. As cópias contêm ficheiros e estado de acesso do grupo e devem ser protegidas. Esta alfa lê manifestos do MVP antigo com ficheiros normais válidos; não migra automaticamente conteúdos antigos para armazenamento de objetos. Só o administrador pode eliminar ficheiros antigos sem proprietário. Faça uma cópia antes de atualizar; o regresso a uma versão anterior não é suportado depois de escrito o novo formato do manifesto.

Use apenas um sistema de ficheiros local de confiança com ACL restritas. Os envios incompletos expirados são limpos; os ficheiros concluídos não são eliminados automaticamente. Não foram verificados discos de rede, sincronização na nuvem do diretório de dados, falhas de energia reais nem o hardware de armazenamento. O renomear atómico/fsync não garante proteção contra todas as falhas.

## Se outro dispositivo não conseguir ligar-se

Escolha o URL IPv4 da LAN apresentado no terminal, use a mesma rede Wi-Fi e evite o isolamento de convidados/AP. Verifique se a firewall abre a porta apenas para as redes/dispositivos pretendidos. Verifique o estado a partir de outro computador, substituindo o endereço de exemplo:

```sh
curl --connect-timeout 5 http://192.168.1.10:8787/api/health
```

A resposta esperada é `{"ok":true}`. Um timeout normalmente exige verificar o encaminhamento/firewall; um `403` exige verificar hostname/Origin e `ALLOWED_HOSTS`/`PUBLIC_URL`. Não adicione um carácter universal para contornar o erro. O navegador pode pedir autorização para aceder à rede local.

## Desenvolvimento, testes e versões

```sh
npm run check
npm test
npm run release:check
npm run release:source
```

O exportador de código-fonte usa uma lista explícita de ficheiros permitidos, volta a verificar o arquivo e grava SHA-256 em `release/`. Não comprima todo o diretório de trabalho. `.gitignore` não exclui ficheiros dos ZIP do Finder nem remove dados já incluídos em commits. Mantenha `private: true` para evitar a publicação acidental no npm; o código-fonte continua licenciado sob Apache-2.0.

- [Contribuir](../../CONTRIBUTING.md), [segurança](../../SECURITY.md), [lista de publicação](../RELEASE_CHECKLIST.md).
- [Protocolo alfa](../PROTOCOL.md), [evidências e limites de verificação](../VALIDATION.md).
- [Arquitetura](../research/architecture.md), [desempenho](../research/performance.md), [licença e roteiro](../research/license-and-roadmap.md).

Descoberta/QR, WebRTC, partilha da área de transferência iniciada pelo utilizador, transferência de pastas e partilha de ecrã fazem parte do roteiro. Um ambiente de trabalho remoto completo exige um agente nativo e um modelo de consentimento separado; esta versão não tem controlo remoto.

## Licença

[Apache License 2.0](../../LICENSE). Copyright 2026 hieunguyenak92; consulte [NOTICE](../../NOTICE). A utilização, modificação e distribuição, incluindo uso comercial, são permitidas nos termos da licença. Mantenha LICENSE/NOTICE e documente as alterações conforme os termos aplicáveis. Não é prestada qualquer garantia.
