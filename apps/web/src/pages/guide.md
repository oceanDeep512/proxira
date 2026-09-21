---
layout: ../layouts/Docs.astro
title: 用法
description: 从装到用：把请求指到 Proxira、看面板、配请求头与 Mock 分组，以及 HTTPS、局域网、令牌这些进阶用法。
eyebrow: 文档
---

## 安装与启动

推荐直接用 `npx`，不需要安装，也不需要配置文件：

```bash
npx proxira
```

想固定版本（便于团队复现）或全局安装：

```bash
npx proxira@0.4.0
npm i -g proxira
```

启动后默认给出三个地址：

| 地址 | 用途 |
| --- | --- |
| `http://localhost:3000/proxira` | 代理入口，把请求指到这里 |
| `http://localhost:3000/_proxira/ui` | 管理面板 |
| `http://localhost:3000/_proxira/api/health` | 健康检查 |

## 把请求接进来

Proxira 默认只走**前缀模式**：请求打到 `/proxira/*` 才会被接管，其余路径不受影响。
所以接入方式就是把你要联调的 `baseURL` 换成代理入口。

```bash
# 指定端口和上游
npx proxira --port 3010 --target http://localhost:8080

# 换一个前缀
npx proxira --prefix /debug-proxy --target http://localhost:8080

# 关掉前缀，所有路径都转发（/_proxira/* 仍留给面板）
npx proxira --no-prefix --target http://localhost:8080
```

> 关闭前缀后，`/_proxira/*` 依然保留给管理面板与内部 API，其余路径才转发到上游。

## 面板导览

- **左栏**：请求列表，按时间倒序，支持状态筛选、方法筛选、耗时排序、时间排序。
- **右栏**：请求详情，默认落在「概览」。概览不做卡片分块，而是按人类读一条请求的顺序从上到下铺开。
- **正文**：JSON / XML / YAML / HTML / CSV / Markdown / Text 都能看；JSON 树带行号、可逐层折叠，SSE 响应按帧折叠。
- **新请求提示**：来了新请求时底部浮出一条「N 条新请求」，点它才跳到最新，不会抢走你正在看的那条。

正文里查找用浏览器自带的 `⌘F` / `Ctrl+F`，不额外做一套搜索框。

## 请求头分组

请求头配置是**全局分组**模型：在设置面板的「请求头」里定义分组，转发地址里勾选生效，同一套鉴权头可以给多个地址共用。

- **固定请求头**：每个出站请求都带上，同名时覆盖客户端原值。
- **匹配规则**：按请求头**名称前缀**匹配（大小写不敏感），命中后 `set` 改写、`ignore` 直接不转发。

勾选多个分组时按**分组列表顺序**依次叠加，**后面的覆盖前面的**（列表里的上移/下移就是调整这个顺序）。

被代理接管的头不可配置：`host`、`content-length`、`transfer-encoding`、`connection`、`accept-encoding` 等既不能设为固定头，也不会被规则复活——配置里写了会在保存时返回 `400`。

## Mock 拦截

Mock 同样是**全局分组**模型：一个分组装多条接口规则，转发地址在编辑时勾选要让哪些分组生效。

一条规则 = 匹配（路径片段 + 可选 Method）+ 响应（状态码 / Headers / 正文，可勾选以 SSE 分片下发）。
**命中的请求直接返回，不会打到上游**。

匹配顺序：按分组列表顺序逐个分组问，组内第一条命中的规则胜出。分组可以整组停用，也可以单独停用某条规则。

## 故障注入

和 Mock 的分界线是：Mock **替上游回答**，故障注入**让上游出错**（请求仍会打到上游，只是在回程上做手脚）。

| 动作 | 作用 | 典型场景 |
| --- | --- | --- |
| `error` | 直接以指定状态码失败，不请求上游 | 复现 5xx / 网关错误 |
| `delay` | 先等待 N 毫秒，再正常转发 | 复现慢请求、验证前端 loading |
| `break_stream` | 流式响应在第 N 个分片后断开 | 复现 SSE / LLM 流式中断 |
| `truncate` | 只保留响应前 N 字节后断开 | 复现响应被截断、JSON 解析失败 |

故障注入规则挂在**转发地址**上（每个地址一套），入口在设置面板的「Mock 拦截」标签底部。

## 请求重放与差异对比

选中任意记录后点「重放请求」：

1. 表单已按原请求预填 METHOD / URL / HEADERS / BODY，可以直接改（比如换个 model、改个 temperature）。
2. 发送后展示新响应的状态码、耗时，以及与**原响应**的逐行差异。
3. 重放**不经过拦截规则与 Mock 分组**，看到的永远是上游真实行为。
4. 重放结果会写入历史并标记「重放」，方便和原始请求对照。

## 敏感信息脱敏

默认对展示层做打码，不改落盘数据：`authorization`、`cookie`、`set-cookie`、`x-api-key`、`token`、`secret`、`password` 等键的值，JSON 正文会递归匹配。

点工具栏的眼睛图标可在「脱敏 / 原文」之间切换，「复制 cURL」同样遵循当前脱敏状态。

## HTTPS 调试

```bash
npx proxira gen-cert   # 生成本地证书（带环境检测）
npx proxira --https    # 启动 HTTPS
```

证书默认位于 `<数据目录>/certs/`，也可以手动指定：

```bash
npx proxira --https --https-key ./my-certs/key.pem --https-cert ./my-certs/cert.pem
```

> 这里加密的是**客户端到代理**这一段，代理转发给上游的请求仍是你原来的请求。

## 局域网共享

默认只监听 `127.0.0.1`，其他电脑连不上。要让局域网内的设备也用这台机器上的代理：

```bash
npx proxira --host
```

启动横幅会直接给出这台机器对外的地址，别的电脑填它就行。也可以只监听某一张网卡：`--host 192.168.1.4`。

> 开放后，同一网络里的任何人都能看到你的请求历史与响应正文（含 token / cookie），也能通过面板改上游地址。请只在可信网络里开，必要时配合 `--token`。

## 访问令牌

```bash
npx proxira --token my-secret
```

启用后 `/_proxira/api/*`（含 SSE）必须携带令牌，否则返回 401。传参方式二选一：`Authorization: Bearer my-secret`，或 URL 查询参数 `?token=my-secret`。

## 数据目录

数据与启动端口、启动方式、工作目录**无关**，按以下优先级解析：

1. `--data-dir <path>`
2. `PROXY_DATA_DIR` 环境变量
3. 用户级默认目录（macOS `~/Library/Application Support/Proxira`，Linux `~/.local/share/Proxira`，Windows `%APPDATA%\Proxira`）

```bash
proxira data-dir                       # 查看当前数据目录及来源
proxira migrate-data                   # 把旧版 ./.proxira 迁到统一目录
```

目录内存放 `config.json`（转发地址、请求头分组、Mock 分组）、`history.json`（请求历史）、`rules.json`（故障注入规则）与 `certs/`（证书）。

## CLI 参数

| 参数 | 说明 | 默认值 |
| --- | --- | --- |
| `-p, --port <port>` | 服务端口 | `3000` |
| `-t, --target <url>` | 上游服务地址 | `http://localhost:8080` |
| `-d, --data-dir <path>` | 数据目录 | `./.proxira` |
| `--host [address]` | 监听地址，不带值即局域网 | `127.0.0.1` |
| `-x, --prefix <path>` | 自定义代理前缀 | `/proxira` |
| `-nx, --no-prefix` | 关闭代理前缀 | — |
| `-s, --https` | 启用 HTTPS | — |
| `-b, --no-banner` | 关闭启动横幅 | — |
| `--token <token>` | 内部 API / SSE 访问令牌 | 关闭 |
| `-v, --version` | 版本信息 | — |

## 环境变量

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `PORT` | 服务端口 | `3000` |
| `PROXY_TARGET_URL` | 默认上游地址 | `http://localhost:8080` |
| `PROXY_DATA_DIR` | 数据目录 | `./.proxira` |
| `PROXY_PREFIX` | 代理前缀 | `/proxira` |
| `PROXY_HOST` | 监听地址 | `127.0.0.1` |
| `PROXY_UPSTREAM_TIMEOUT_MS` | 上游超时（毫秒），只约束「等响应头」，超时返回 504 | `30000` |
| `PROXY_MAX_BODY_CAPTURE_BYTES` | 单条非流式正文的**采集**上限，`0` = 不限制 | `2097152` |
| `PROXY_HISTORY_PERSIST_BODY_LIMIT` | 单条正文写入 `history.json` 时的**落盘**上限，`0` = 不裁剪 | `65536` |
| `PROXY_REQUEST_CONTENT_LENGTH_LIMIT` | 单个请求体硬上限，超出直接返回 `413`（不转发） | `10485760` |
| `PROXY_STREAM_MAX_CAPTURE_BYTES` | 流式响应采集字节上限，`0` = 不限制 | `0` |
| `PROXY_STREAM_MAX_CAPTURE_MS` | 流式响应采集时长上限（毫秒），`0` = 不限制 | `0` |
| `PROXY_HISTORY_LIMIT` | 内存历史上限 | `1000` |
| `PROXY_ACCESS_TOKEN` | 访问令牌 | — |

## 内部管理接口

面板本身就是这些接口的消费者，所以它们对外也是稳定可用的 —— 你可以用脚本改转发地址、灌 Mock 规则、
拉历史记录，把 Proxira 塞进自己的联调流水线。接口都在 `/_proxira/api/` 下，返回 JSON；
配了 `--token` 时记得带访问令牌。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/_proxira/api/health` | 健康检查 |
| `GET` | `/_proxira/api/status` | 服务状态（含 `dataDir` 数据目录） |
| `GET` | `/_proxira/api/config` | 读取当前配置 |
| `PUT` | `/_proxira/api/config` | 切换激活转发地址 |
| `POST` | `/_proxira/api/groups` | 创建转发地址（可带 `headerPresetIds` / `mockGroupIds`） |
| `PUT` | `/_proxira/api/groups/:id` | 更新转发地址（含生效的请求头分组 / Mock 分组） |
| `DELETE` | `/_proxira/api/groups/:id` | 删除转发地址 |
| `GET` | `/_proxira/api/header-presets` | 查询全部请求头分组 |
| `POST` | `/_proxira/api/header-presets` | 创建请求头分组 |
| `PUT` | `/_proxira/api/header-presets/:id` | 更新请求头分组（固定头 / 匹配规则 / 名称） |
| `DELETE` | `/_proxira/api/header-presets/:id` | 删除请求头分组（同时解除各转发地址的引用） |
| `POST` | `/_proxira/api/header-presets/:id/move` | 调整分组顺序（`direction: up｜down`） |
| `GET` | `/_proxira/api/mock-groups` | 查询全部 Mock 分组 |
| `POST` | `/_proxira/api/mock-groups` | 创建 Mock 分组 |
| `PUT` | `/_proxira/api/mock-groups/:id` | 更新 Mock 分组（名称 / 整组开关 / 规则整表替换） |
| `DELETE` | `/_proxira/api/mock-groups/:id` | 删除 Mock 分组（同时解除各转发地址的引用） |
| `POST` | `/_proxira/api/mock-groups/:id/move` | 调整分组顺序（`direction: up｜down`） |
| `GET` | `/_proxira/api/records` | 查询历史 |
| `GET` | `/_proxira/api/records/export` | 导出记录 |
| `DELETE` | `/_proxira/api/records/:id` | 删除单条 |
| `DELETE` | `/_proxira/api/records` | 清空转发地址历史 |
| `GET` | `/_proxira/api/rules` | 查询当前转发地址的拦截规则 |
| `POST` | `/_proxira/api/rules` | 创建拦截规则 |
| `PUT` | `/_proxira/api/rules/:id` | 更新拦截规则（含启用/停用） |
| `DELETE` | `/_proxira/api/rules/:id` | 删除拦截规则 |
| `POST` | `/_proxira/api/replay` | 重放一次请求（不经过规则引擎；`useCustomHeaders: true` 才套用请求头分组） |
| `GET` | `/_proxira/api/events` | SSE 事件流（面板实时更新靠它） |
| `POST` | `/_proxira/api/reset` | 重置数据 |
| `POST` | `/_proxira/api/open-folder` | 在系统文件管理器中打开数据目录 |

## 能力边界

- **不支持 WebSocket 及其他 HTTP Upgrade 协议**：握手请求返回 `501`，不静默降级。调试 WebSocket 请直连上游。
- **不做系统代理接管**：只监听自己的端口，需要你手动把请求地址指过去。
- **正文太大只会影响「记录」，不影响转发**：超过 `PROXY_MAX_BODY_CAPTURE_BYTES`（默认 2MB）时记录会被截断并标记 `truncated`，但转发给客户端的响应始终完整；落盘时还会按 `PROXY_HISTORY_PERSIST_BODY_LIMIT`（默认 64KB）再裁一次，所以重启后看到的往往比面板里短。这两个值都支持 `0` = 不限制 —— 需要复盘大报文时设成 `0` 即可，代价是 `history.json` 会跟着变大。
  - 注意区分：单个**请求体**超过 `PROXY_REQUEST_CONTENT_LENGTH_LIMIT`（默认 10MB）是**硬拒绝**（`413`，请求不会发给上游），不是截断。
- **流式响应默认全量捕获**：不按长度截断，也不会跑过超时被掐断。

## 常见问题

**终端里的 curl / git / npm 抓不到？**
它们不读系统代理，只认 `http_proxy` / `https_proxy` 环境变量。这不是 Proxira 的问题，给当前 shell 设一下即可：

```bash
export http_proxy=http://127.0.0.1:3000
export https_proxy=http://127.0.0.1:3000
```

**面板打开是空的？**
先确认请求真的打到了代理入口（默认带 `/proxira` 前缀），再看左上角选中的转发地址是不是你要的那个——历史记录按转发地址分开存。

**HTTPS 站点看不到明文？**
Proxira 不解密 HTTPS 上游：`--https` 只作用于客户端到代理这一段。要看上游返回内容，请让客户端用 `http://` 打到本地代理，或在业务侧临时改用 HTTP 联调。

**面板能改上游地址，安全吗？**
所以不要把它暴露到公网。默认只监听 `127.0.0.1`；要开放局域网时请只在可信网络里用，并配合 `--token`。
