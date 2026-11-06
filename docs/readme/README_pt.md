<div align="center">

[English](../../README.md) · [简体中文](README_zh-CN.md) · [日本語](README_ja.md) · [Tiếng Việt](README_vi.md) · [ไทย](README_th.md) · [Español](README_es.md) · **Português**

# MCKL Transfer

**Seus arquivos. Seus dispositivos. Seu espaço.**

Compartilhe pelo navegador com um servidor que você controla, para uso pessoal, familiar ou de uma equipe pequena.

[Baixar a versão mais recente](https://github.com/hieunguyenak92/MCKLTransfer/releases/latest) · [Configuração](../CONFIGURATION.md) · [Apoiar com uma estrela](https://github.com/hieunguyenak92/MCKLTransfer)

**0.5.0 · Apache-2.0 · Sem instalar clientes · Sem dependências npm em execução**

</div>

Transfira um vídeo para o computador, envie documentos entre dispositivos ou crie uma pequena caixa de entrada para sua equipe. O MCKL Transfer transforma um computador no seu ponto de compartilhamento. Os outros dispositivos acessam pelo navegador. Não é preciso criar uma conta na nuvem do MCKL.

## O que faz a diferença

| Recurso | Benefício |
|---|---|
| Upload com retomada | Pause, tente novamente e confira SHA-256; recupere o mesmo resultado se a resposta final se perder |
| Destino sob seu controle | Espaço comum, inbox por destinatário e salas com membros escolhidos |
| Convites por QR | Links de uso único com validade e aprovação opcional pelo host |
| Pastas e download em lote | Preserve caminhos relativos e baixe uma seleção em `.tar` por streaming |
| Ferramentas para o dia a dia | Busca, chat, histórico de transferências e expiração de arquivos |
| Envio direto experimental | Sessões WebRTC aceitas pelo destinatário, com indicação de rota direct/relay |
| Recursos limitados | Cotas por dispositivo, limite de arquivos e downloads e leases entre abas |

## Comece em poucos passos

No host, use Node.js **24.x a partir de 24.22.2** ou **26.x a partir de 26.13.0**.

```sh
git clone https://github.com/hieunguyenak92/MCKLTransfer.git
cd MCKLTransfer
npm start
```

Não é necessário executar `npm install`. Você também pode baixar o código em [Releases](https://github.com/hieunguyenak92/MCKLTransfer/releases).

1. Abra a URL da LAN exibida no terminal no navegador de outro dispositivo.
2. Informe o nome do dispositivo e o código de acesso de seis dígitos.
3. Escolha o destino e envie arquivos ou pastas.

O **código de administrador separado** deve ficar com quem gerencia o host. O painel permite aprovar ou revogar dispositivos, criar convites e administrar salas.

O HTTP padrão não cifra a conexão. Use-o em uma LAN controlada e confiável; para outras conexões, configure HTTPS confiável ou Tailscale/WireGuard com acesso restrito. Não exponha essa porta HTTP diretamente à Internet.

## Espaço compartilhado ou inbox particular

- **Espaço comum:** arquivos e chat para os membros aprovados.
- **Inbox privado:** acesso pelo remetente, pelo destinatário escolhido e pelo administrador de confiança.
- **Salas:** o administrador escolhe os membros; a autorização vale para listas, downloads e eventos.

O botão de convite cria um link e um QR válidos por dez minutos. O convite pode ser usado uma vez e não permanece após reiniciar o servidor. Para exigir aprovação do host na conexão:

```sh
REQUIRE_APPROVAL=1 npm start
```

Se o upload cair, selecione novamente o mesmo arquivo. É necessário manter o cookie e a sessão de upload ainda válida. Os leases no servidor impedem que várias abas alterem simultaneamente o mesmo upload.

«Recebido pelo host» e «salvo pelo destinatário» são estados diferentes. Em navegadores compatíveis, o salvamento verificado envia um recibo após a gravação e a conferência de SHA-256.

## WebRTC direto — experimental

Com ambos os dispositivos conectados, você pode escolher uma sessão que não armazena o arquivo no host.

1. Escolha o destinatário e o arquivo para envio direto.
2. O destinatário aceita e escolhe onde salvar.
3. **Compare os códigos dos dois dispositivos por outro canal confiável e confirme nos dois.**
4. O receptor grava blocos pequenos e verifica tamanho e SHA-256.

É necessário HTTPS ou localhost. A recepção exige `showSaveFilePicker`, tendo Chromium de desktop como principal alvo. O arquivo inteiro não é acumulado em um Blob na RAM. Em aparelhos incompatíveis ou se a conexão falhar, você pode escolher explicitamente a transferência pelo host. Alterações no armazenamento e na privacidade não ficam escondidas em um fallback automático.

Nenhum STUN/TURN externo é configurado por padrão. Você pode indicar servidores próprios em `ICE_SERVERS`. A rota relay significa passagem por TURN; a conexão direta não é garantida em toda rede. Veja a [configuração](../CONFIGURATION.md).

## Privacidade e limites claros

O host consegue ler os arquivos e chats que passam por ele. O inbox privado usa controle de acesso; não oferece E2EE contra o host. A criptografia da sessão direta e a comparação dos códigos também não protegem contra JavaScript malicioso servido por um host comprometido.

Mantenha a página aberta durante a transferência, principalmente em celulares. A PWA não garante envio em segundo plano ou com a tela do iPhone bloqueada. Não inclui controle remoto da área de trabalho.

## Operação e atualizações

- `SHARE_DIR` contém os dados privados. Veja [Configuração](../CONFIGURATION.md) para cotas, número de arquivos, expiração, HTTPS e ICE. Arquivos `.env` não são carregados automaticamente.
- Antes de atualizar, pare o servidor e proteja uma cópia de todo o diretório de dados. Um bloqueio recusa outro processo de host usando o mesmo diretório.
- As sessões são mantidas após parada e reinício normais. Uma interrupção inesperada exige novo pareamento por segurança; a recuperação da propriedade anterior depende do administrador.
- A expiração não equivale a apagamento seguro e não remove backups. Não se garante comportamento uniforme em unidades de rede ou falhas de energia.

O desempenho depende da rede, do disco, do cálculo de hashes e do dispositivo. As condições de medição e o alcance da verificação ficam em [Validação](../VALIDATION.md); números de loopback não prometem a mesma velocidade na LAN.

## Idiomas e desenvolvimento

A interface alterna entre **Tiếng Việt e English**. O README está disponível em sete idiomas pelos links no topo.

```sh
npm run check
npm test
npm run release:check
npm run release:source
```

[Protocolo](../PROTOCOL.md) · [Segurança](../../SECURITY.md) · [Como contribuir](../../CONTRIBUTING.md)

Se o projeto ajudar você, deixe uma **estrela** para apoiá-lo. Relatos reproduzíveis e testes em dispositivos reais também tornam a próxima versão melhor.

[Apache License 2.0](../../LICENSE): uso comercial, modificação e distribuição conforme seus termos. Preserve [NOTICE](../../NOTICE), incluindo o aviso MIT da biblioteca QR. Sem garantia.
