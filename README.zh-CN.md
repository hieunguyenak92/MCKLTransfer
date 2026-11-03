# MCKL Transfer

[Tiếng Việt](README.md) · [English](README.en.md) · [日本語](README.ja.md) · [Español](README.es.md) · [Português](README.pt.md) · [ไทย](README.th.md) · [简体中文](README.zh-CN.md)

通过局域网内的自有服务器共享文件和聊天，也可供受控 overlay 网络中已获授权的设备使用。只有服务器需要 Node.js，其他设备使用浏览器访问。没有 MCKL 云账户、分析追踪、数据库或运行时 npm 依赖。

**0.2.0-alpha.2 · Apache-2.0 · 实验版本。** 部署前请阅读[验证结果](docs/VALIDATION.md)和[安全模型](SECURITY.md)。尚不承诺稳定支持或所有设备上的局域网传输速度。

## 在可信网络中快速开始

安装已更新安全补丁的 Node.js **24（至少 24.22.2）**或 **26（至少 26.13.0）**。在源码目录中运行：

```sh
npm start
```

不需要 `npm install`。终端会显示局域网地址、6 位访问码和**独立的管理员代码**。在其他设备上打开局域网地址，填写设备名称并输入访问码。管理员代码只能提供给服务器管理者。这些代码不会通过 API 暴露，即使从 localhost 访问也一样。

默认 HTTP 不加密，只应在您控制的网络中与可信人员使用。其他连接请使用 HTTPS 或受控 overlay。不要在路由器上将此端口转发到互联网。

### 使用方法

- 选择或拖入多个文件；应用使用统一队列，最多同时传输两个文件，并提供速度、预计剩余时间、暂停、继续、重试和取消。
- 断网或刷新页面后，重新选择同一个文件即可继续。设备 Cookie 必须仍然保留，且上传尚未过期。页面关闭后，浏览器不会自动保留文件读取权限。
- **每个服务器只使用一个文件传输标签页。** 同源标签页共享 Cookie 和续传记录。若两个标签页同时继续同一上传，在一个标签页中取消可能删除另一个标签页的未完成数据。源文件仍然安全；另一个标签页遇到 `404` 后需要重新发送。此 alpha 版本尚未协调不同标签页之间的上传所有权。
- 发送前，浏览器读取源文件以计算 SHA-256；主机随后校验每个分块及完整文件。哈希计算会额外读取一次源文件，在性能较弱的设备上可能较慢。不会将整个文件保存在 RAM 中。
- 已完成的文件出现在共享列表中，所有已登录成员都可下载。成员只能删除自己发送的文件；管理员可以删除所有文件并撤销设备会话。
- 共享聊天最多在 RAM 中保留最近 200 条消息，主机重启后丢失。传输时请保持页面打开，尤其是在手机上。PWA 不保证后台传输，也不保证 iOS 锁屏后继续传输。

这是 **浏览器 A → 主机存储文件 → 浏览器 B 下载**的模型。“上传完成”表示主机已接收并验证文件，不表示 B 已经下载或保存文件。主机可以读取文件和聊天内容；尚无 E2EE 或按接收者隔离的私人房间。

## 语言

应用界面提供 Tiếng Việt（越南语）和 English（英语）。使用页面顶部的语言选择器切换，选择会保存在当前浏览器中。首次打开时，应用根据浏览器语言选择；不支持该语言时使用 English。切换语言不会刷新页面或中断文件传输，也不会翻译文件内容、聊天或设备名称。README 可通过顶部链接阅读七种语言的版本。

## 配置

应用读取进程的环境变量，不会自动加载 `.env`。容量单位为字节，时间单位为毫秒。

| 变量 | 默认值 | 含义 |
|---|---|---|
| `HOST`, `PORT` | `0.0.0.0`, `8787` | 监听接口与端口；默认使用 IPv4 |
| `SHARE_DIR` | 源码旁的 `./shared` | 私有数据目录，建议放在仓库之外 |
| `DEVICE_NAME` | hostname | 主机名称，仅登录后及终端中可见 |
| `SHARE_CODE` | 每次启动随机生成 6 位数字 | 成员访问码；仍接受 `LAN_SHARE_CODE` 以保持兼容 |
| `ADMIN_CODE` | 每次启动独立随机生成 | 至少 24 个字符；请保密 |
| `MAX_FILE_SIZE` | `21474836480`（20 GiB） | 单文件大小上限 |
| `MAX_TOTAL_SIZE` | `107374182400`（100 GiB） | 完成文件与已预留上传容量的总和 |
| `MIN_FREE_SPACE` | `134217728`（128 MiB） | 预留磁盘空闲空间；不等于 OS 磁盘配额 |
| `CHUNK_SIZE` | `4194304`（4 MiB） | 每个分块上传请求最多支持 16 MiB |
| `MAX_CONCURRENT_UPLOADS` | `4` | 服务器同时执行的上传写入/哈希任务数 |
| `MAX_PENDING_UPLOADS` | `128` | 保留的未完成上传数量 |
| `UPLOAD_TTL_MS` | `86400000`（24 小时） | 从创建未完成上传时起计算的绝对有效期限 |
| `SESSION_TTL_MS`, `MAX_DEVICES` | `43200000`（12 小时）, `128` | 普通会话期限与设备会话总数；记住设备时的有效期为 30 天 |
| `REQUEST_TIMEOUT_MS` | `1800000`（30 分钟） | 接收单个请求的期限；连续 60 秒无活动的 socket 会断开 |
| `TLS_KEY_FILE`, `TLS_CERT_FILE` | 未设置 | 直接 HTTPS 使用的 PEM 私钥与证书对 |
| `PUBLIC_URL` | 未设置 | 代理的外部 origin，例如 `https://transfer.example.org`；不能包含 path/query |
| `ALLOWED_HOSTS` | 本地 hostname/接口 | 额外允许的具体 hostname/IP，以逗号分隔；不支持通配符或端口 |

使用独立数据目录的 PowerShell 示例：

```powershell
$env:SHARE_DIR = "D:\MCKL-data"
$env:DEVICE_NAME = "Home transfer host"
npm start
```

重启后访问码改变不会撤销已经签发的会话。请在设备管理面板中撤销会话；若 PIN 泄露，请修改 PIN，**并且**撤销不可信的会话。Cookie 和文件所有权在重启后仍保留。退出登录或删除 Cookie 后重新配对会创建新的身份；管理员仍可删除旧文件。

## HTTPS 与跨网络连接

### 直接 HTTPS

准备 SAN 与实际 hostname/IP 匹配、由所有设备信任的 CA 签发的证书。将密钥放在源码之外并限制读取权限，然后设置两个变量：

```sh
TLS_KEY_FILE=/secure/mckl/server.key TLS_CERT_FILE=/secure/mckl/server.pem npm start
```

打开对应的 `https://...` URL。不要跳过证书验证错误。自签名证书需要通过可信渠道安装受信任的 CA 或验证指纹；应用尚未自动配对证书。HTTPS Cookie 设置了 `Secure`、`HttpOnly`、`SameSite=Strict`。

### 通过 Tailscale 或 WireGuard 建立私人群组

在各设备上安装 overlay，仅授予所需成员权限，并限制服务端口。继续保留 MCKL 的身份验证。使用 WireGuard 时，密钥、路由、防火墙和 DNS 由您管理；使用 Tailscale 时，请检查 policy 与 direct/relay 路径。私有 IP 地址段本身不能证明设备可信。

tailnet 中的一种 HTTPS 方案是 [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve)。取得主机 DNS 名称并配置 tailnet 的 HTTPS 后，指定该 origin，仅在 loopback 上运行 MCKL：

```sh
HOST=127.0.0.1 PUBLIC_URL=https://YOUR-HOST.YOUR-TAILNET.ts.net npm start
```

在另一个终端中运行：

```sh
tailscale serve --bg http://127.0.0.1:8787
tailscale serve status
```

打开 Serve 提供的准确 HTTPS URL。此服务用于 tailnet，请限制访问策略。条件与关闭方法参见 [Serve CLI](https://tailscale.com/docs/reference/tailscale-cli/serve)。MCKL 不会自动安装或配置 Tailscale，本次发布尚未在真实 tailnet 上测试。

其他反向代理需要在不缓冲的情况下转发 stream/SSE，保留 Host 或正确设置 `PUBLIC_URL`，配置合适的超时和请求体大小，并限制上游仅接受可信代理的连接。应用不会信任 `X-Forwarded-*` 来判断连接是否安全。

## 数据、升级与备份

主机在 `SHARE_DIR` 中保存 `.mckl-manifest.json`、`.mckl-devices.json`（会话 token 的哈希）、`.mckl-uploads.json` 和 `.mckl-objects/`。新文件内容按 ID 存储，显示名称记录在 manifest 中。服务器运行时，不要编辑或删除内部文件。不要让两个进程共用同一个 `SHARE_DIR`。

备份**整个**数据目录之前，请先停止主机。备份包含群组文件和访问权限，需要妥善保护。此 alpha 版本可以读取引用有效普通文件的旧 MVP manifest，但不会自动将旧文件内容迁移到对象存储。无所有者的旧文件只能由管理员删除。升级前请备份；写入新 manifest 格式后，不支持降级。

仅使用可信的本地文件系统，并严格设置 ACL。过期的未完成上传会被清理，但已完成文件不会自动删除。网络磁盘、数据目录的云同步、真实断电或存储硬件故障尚未验证。原子 rename/fsync 不代表能够防止所有损坏。

## 其他设备无法连接时

选择终端显示的 IPv4 LAN URL，连接同一 Wi-Fi，并避免访客网络或 AP isolation。检查防火墙，仅向需要的网络/设备开放端口。替换示例地址后，从另一设备检查 health：

```sh
curl --connect-timeout 5 http://192.168.1.10:8787/api/health
```

正确响应为 `{"ok":true}`。超时通常需要检查路由/防火墙；收到 `403` 时，请检查 hostname/Origin 和 `ALLOWED_HOSTS`/`PUBLIC_URL`。不要通过添加通配符解决问题。浏览器可能会请求本地网络访问权限。

## 开发、测试与发布

```sh
npm run check
npm test
npm run release:check
npm run release:source
```

源码导出工具仅包含允许列表中的文件，重新检查 archive，并将 SHA-256 写入 `release/`。不要将正在使用的整个目录打包为 ZIP。`.gitignore` 不会从 Finder ZIP 中排除文件，也不会移除已提交的数据。保留 `private: true` 以防误发布到 npm；源码仍按 Apache-2.0 授权。

- [贡献](CONTRIBUTING.md)、[安全](SECURITY.md)、[发布检查清单](docs/RELEASE_CHECKLIST.md)。
- [alpha 协议](docs/PROTOCOL.md)、[验证证据与局限](docs/VALIDATION.md)。
- [架构](docs/research/architecture.md)、[性能](docs/research/performance.md)、[许可证与路线图](docs/research/license-and-roadmap.md)。

Discovery/QR、WebRTC、用户主动操作的剪贴板共享、文件夹传输和屏幕共享属于路线图。完整远程桌面需要原生 agent 和独立的同意机制；本版本没有远程控制功能。

## 许可证

[Apache License 2.0](LICENSE)。Copyright 2026 hieunguyenak92；参见 [NOTICE](NOTICE)。允许依照许可证条款使用、修改和分发，包括商业使用。请保留 LICENSE/NOTICE，并根据适用条款注明更改。不提供担保。
