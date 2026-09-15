# Proxira

[![npm version](https://img.shields.io/npm/v/proxira)](https://www.npmjs.com/package/proxira)
![node](https://img.shields.io/badge/node-%3E%3D20-339933)
![license](https://img.shields.io/badge/license-MIT-blue)

> 轻量化实时请求代理工具 —— 让本地开发联调更高效

Proxira 是一个**本地开发联调用的实时请求代理与观测工具**。
它在本地启动代理端口，将请求转发到真实上游服务，并通过 Web 控制面板实时展示请求、响应、耗时与错误信息。

除了观测，它还能主动制造问题：Mock 桩数据、模拟 5xx、注入延迟、在流式响应中途断开、截断响应体；
也能把任意一条历史请求改改参数直接重放，并和原响应做逐行差异对比。

## 项目作用

- 让 SDK / 前端 / 客户端请求统一走本地代理，便于观测与排查
- 在不改业务请求代码的前提下，快速切换真实上游地址
- 对请求数据进行"可视化追踪"：状态码、耗时、Headers、Body、错误等
- 支持并行调试多环境（如 dev / test / staging）

## 目录

- [核心能力](#核心能力)
- [快速开始](#快速开始) · [把请求接进来](#把请求接进来) · [HTTPS 模式](#https-模式快速开始)
- [可用参数](#可用参数) · [使用示例](#使用示例)
- [拦截规则](#拦截规则mock--故障注入) · [请求重放与差异对比](#请求重放与差异对比) · [敏感信息脱敏](#敏感信息脱敏) · [访问令牌](#访问令牌可选)
- [分组级超时](#分组级超时) · [数据存放位置](#数据存放位置) · [可选环境变量](#可选环境变量)
- [常见问题](#常见问题) · [从源码开发](#从源码开发)

## 核心能力

- **代理与转发** - 请求透明转发（Path / Query / Headers / Body）
- **HTTP & HTTPS 支持** - 支持 HTTP 和 HTTPS 上游服务，也支持 HTTPS 服务模式
- **智能证书生成** - 一键生成自签名证书，自动检测环境并提供安装指引
- **多分组管理** - 每个分组独立上游地址与历史记录
- **SSE 实时推送** - 实时推送请求事件到 Web 面板
- **请求记录** - 记录查询、删除、清空、导出 JSON
- **详情复制** - 一键复制 URL / Headers / Body / cURL
- **过滤排序** - Method 过滤、Status 过滤、时间排序、耗时排序
- **拦截规则** - Mock、模拟错误、延迟、流式中断、响应截断，按路径/方法匹配
- **请求重放** - 改完参数直接重发上游，并与原响应做逐行差异对比
- **敏感信息脱敏** - `authorization` / `cookie` / `api_key` 等默认打码，可一键看原文
- **可选访问令牌** - `--token` 保护内部 API 与 SSE 事件流

## 快速开始

### npm 仓库说明

- 包名：`proxira`
- npm 地址：`https://www.npmjs.com/package/proxira`
- 命令名：`proxira`
- 发布内容：`dist/`、`dashboard-dist/`、`README.md`

推荐使用方式：

```bash
# 直接运行最新版本（推荐）
npx proxira@latest

# 固定版本运行（适合团队统一环境，请替换为 npm 上的实际版本）
npx proxira@0.2.0

# 全局安装
npm i -g proxira
```

### 方式 1：使用 npx（推荐，无需全局安装）

```bash
npx proxira
```

### 方式 2：全局安装后使用

```bash
npm i -g proxira
proxira
```

启动后默认地址：

- 代理入口：`http://localhost:3000/proxira`（默认）
- 管理面板：`http://localhost:3000/_proxira/ui`

### 把请求接进来

代理会把 `<代理入口>/<原路径>` 原样转发到 `<上游>/<原路径>`，所以接入时通常只要改 baseURL：

```bash
# 原来
curl https://api.example.com/v1/users

# 接入后：把域名+端口换成代理地址，保留 /proxira 前缀
curl http://127.0.0.1:3000/proxira/v1/users
```

```js
// OpenAI / DeepSeek 这类 SDK，改 baseURL 即可（路径 /v1 保留在后面）
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "http://127.0.0.1:3000/proxira/v1",
  apiKey: process.env.DEEPSEEK_API_KEY,
});
```

> [!TIP]
> 若 SDK 或客户端强制使用 HTTPS，可用 `--https` 启动（配合 `gen-cert` 生成的自签名证书），
> 或用 `-nx` 关闭前缀后把完整地址指向代理端口。

## HTTPS 模式快速开始

```bash
# 1) 生成自签名证书（智能检测环境）
npx proxira gen-cert

# 2) 使用生成的证书启动 HTTPS 服务（自动检测默认证书位置）
npx proxira --https
```

启动后访问：
- 代理入口：`https://localhost:3000/proxira`
- 管理面板：`https://localhost:3000/_proxira/ui`

**注意**：使用自签名证书时，浏览器会提示安全警告，这是正常的。点击"高级" → "继续访问"即可。

如果证书不在默认位置（`./.proxira/certs/`），也可以手动指定：

```bash
npx proxira --https --https-key ./my-certs/key.pem --https-cert ./my-certs/cert.pem
```

## 命令格式

```bash
proxira [options]
proxira clear-cache [options]
proxira gen-cert [options]
```

## 可用参数

### 通用参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `-p, --port <port>` | 代理端口 | `3000` |
| `-t, --target <url>` | 上游服务地址 | `http://localhost:8080` |
| `-d, --data-dir <path>` | 配置目录 | `./.proxira` |
| `-x, --prefix <path>` | 自定义代理前缀 | `/proxira` |
| `-nx, --no-prefix` | 关闭代理前缀 | - |
| `-b, --no-banner` | 关闭启动 Banner | - |
| `--token <token>` | 为内部 API / SSE 设置访问令牌 | 关闭 |
| `-h, --help` | 查看帮助 | - |
| `-v, --version` | 查看版本 | - |

### HTTPS 模式参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `-s, --https` | 启用 HTTPS 服务模式 | - |
| `--https-key <path>` | HTTPS 私钥文件路径 | - |
| `--https-cert <path>` | HTTPS 证书文件路径 | - |

### gen-cert 专用参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `-o, --output-dir <path>` | 证书输出目录 | `./.proxira/certs` |
| `-c, --common-name <name>` | 证书通用名 | `localhost` |
| `--days <number>` | 证书有效期天数 | `365` |
| `-y, --yes` | 跳过确认提示，直接执行 | - |

### 子命令

| 命令 | 说明 |
|------|------|
| `clear-cache` | 清除本地缓存（配置 + 历史记录） |
| `gen-cert` | 生成自签名 HTTPS 证书（自动检测环境） |

## 使用示例

### 1) 最简单启动

```bash
npx proxira
```

将你的 SDK 或应用请求地址指向 `http://localhost:3000/proxira`，然后在面板查看请求与响应详情。

### 2) 指定端口和上游

```bash
npx proxira --port 3010 --target http://localhost:8080
```

此时代理入口变为 `http://localhost:3010/proxira`，所有请求会转发到 `http://localhost:8080`。

### 3) 自定义代理前缀

```bash
proxira -x /debug-proxy -t http://localhost:8080
```

此时代理入口变为 `http://localhost:3000/debug-proxy`。

### 4) 关闭代理前缀

```bash
proxira -nx -t http://localhost:8080
```

此时除 `/_proxira/*` 之外的请求都会直接转发到上游。

### 5) 指定配置目录

```bash
proxira --data-dir ./.proxira-dev
```

### 6) 关闭 Banner，适合脚本或日志收集

```bash
proxira -b
```

### 7) 智能证书生成

```bash
# 向导模式（推荐）
npx proxira gen-cert

# 一键生成，跳过确认
npx proxira gen-cert --yes

# 自定义配置
npx proxira gen-cert -o ./my-certs -c myapp.local --days 730
```

### 8) HTTPS 模式启动

```bash
# 使用生成的证书（自动检测默认位置）
npx proxira --https

# 指定 HTTPS 端口
npx proxira -s --port 3443

# 手动指定证书路径（证书不在默认位置时使用）
npx proxira --https --https-key ./my-certs/key.pem --https-cert ./my-certs/cert.pem
```

## 推荐使用流程

1. 启动 Proxira。
2. 将待联调请求指向 Proxira 端口。
3. 打开 `/_proxira/ui` 实时查看请求与响应。
4. 按需创建分组（一个分组对应一个上游地址和独立请求历史）。
5. 在当前分组中调整上游地址继续联调。

## 面板实用能力

- 历史请求支持一键导出 JSON
- 详情支持一键复制 URL / Headers / Body / cURL
- 多分组管理，独立历史记录
- 实时 SSE 推送请求事件
- 流式响应按采样增量上屏（不为观测而完整缓冲，避免拖住请求）
- 记录超过 500 条时可点「加载更多」继续翻页

## 分组级超时

在面板「编辑当前分组」里可单独设置上游超时（毫秒），留空则回落到全局的
`PROXY_UPSTREAM_TIMEOUT_MS`（默认 30s）。适合某个上游特别慢、又不想把全局超时调大的场景。

## 拦截规则（Mock / 故障注入）

规则挂在分组上，按「路径包含 + 方法」匹配，命中的请求不再打上游：

| 动作 | 作用 | 典型场景 |
| --- | --- | --- |
| `mock` | 返回预设状态码与 body，可勾选以 SSE 分片下发 | 上游还没写好、想固定返回内容 |
| `error` | 直接以指定状态码失败，不请求上游 | 复现 5xx / 网关错误 |
| `delay` | 先等待 N 毫秒再正常转发 | 复现慢请求、验证前端 loading |
| `break_stream` | 流式响应在第 N 个分片后断开 | 复现 SSE / LLM 流式中断 |
| `truncate` | 只保留响应前 N 字节后断开 | 复现响应截断、JSON 解析失败 |

面板工具栏「拦截规则」可增删改与启停，停用后立刻恢复真实转发；命中的记录会带「规则」标记。

## 请求重放与差异对比

选中记录后点「重放请求」，表单已按原请求预填，可直接改参数再发送；结果会展示状态码、耗时，
以及与原响应的逐行差异。重放**不经过拦截规则**，看到的始终是上游真实行为；结果写入历史并标记「重放」。

## 敏感信息脱敏

默认对展示层打码，不改落盘数据：Headers 中的 `authorization` / `cookie` / `x-api-key` 等键、
JSON 正文中同名键的值、文本正文里的 `Authorization: Bearer ...` 片段。复制 cURL 同样遵循当前脱敏状态，
点工具栏眼睛图标可在「脱敏 / 原文」间切换。

## 访问令牌（可选）

```bash
npx proxira --token my-secret
```

启用后 `/_proxira/api/*`（含 SSE）必须携带令牌，否则 401；可通过 `Authorization: Bearer my-secret`
或 `?token=my-secret` 传入。面板打开时带一次 `?token=my-secret` 即可，令牌会存在 `sessionStorage`。
面板 HTML 与 JS/CSS 静态资源不校验令牌（浏览器无法给 `<script>`/`<link>` 加头），但缺令牌时接口全 401，页面只会是空的。

## 数据存放位置

默认写入运行目录下的 `.proxira/`（可用 `--data-dir` 改）：

| 文件 | 内容 |
| --- | --- |
| `config.json` | 分组配置、当前激活分组 |
| `history.json` | 按分组分桶的请求历史 |
| `rules.json` | 各分组的拦截规则 |

历史是防抖落盘的，进程退出前会强制刷盘；`proxira clear-cache` 可一次性清空配置与历史。

## 可选环境变量

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `PORT` | 服务端口 | `3000` |
| `PROXY_TARGET_URL` | 默认分组上游地址 | `http://localhost:8080` |
| `PROXY_DATA_DIR` | 本地数据目录 | `./.proxira` |
| `PROXY_PREFIX` | 代理请求前缀 | `/proxira` |
| `PROXY_PREFIX_ENABLED` | 关闭代理请求前缀 | 未设置 |
| `PROXY_HOST` | 监听地址 | `127.0.0.1` |
| `PROXY_UPSTREAM_TIMEOUT_MS` | 上游请求超时（毫秒），超时返回 504 | `30000` |
| `PROXY_MAX_BODY_CAPTURE_BYTES` | 单条正文记录上限，超出只记录前缀并标记 truncated | `2097152` |
| `PROXY_PERSIST_DEBOUNCE_MS` | 落盘防抖间隔（毫秒） | `500` |
| `PROXY_HISTORY_LIMIT` | 内存历史记录上限 | `1000` |
| `PROXY_HISTORY_PERSIST_LIMIT` | 持久化历史记录上限 | `200` |
| `PROXY_HISTORY_PERSIST_BODY_LIMIT` | 落盘时单条正文重新裁剪上限（内存仍保留完整内容） | `65536` |
| `PROXY_ACCESS_TOKEN` | 内部 API / SSE 的访问令牌，未设置则不做校验 | - |
| `PROXY_QUERY_LIMIT_MAX` | 记录查询接口最大分页值 | - |
| `PROXY_SSE_HEARTBEAT_MS` | SSE 心跳间隔（毫秒） | - |
| `PROXY_DISABLE_BANNER` | 关闭启动 Banner | 未设置 |
| `PROXY_HTTPS_ENABLED` | 启用 HTTPS 服务模式 | 未设置 |
| `PROXY_HTTPS_KEY_PATH` | HTTPS 私钥文件路径 | - |
| `PROXY_HTTPS_CERT_PATH` | HTTPS 证书文件路径 | - |

## 从源码开发

> 以下仅面向参与本仓库开发的场景；作为 npm 包使用不需要看这节。

本包是 monorepo 的发布主体，开发命令在**仓库根目录**执行：

```bash
pnpm install     # 安装依赖
pnpm dev         # 后端 watch(:3000) + 面板 dev server(:5173)，并行
pnpm build       # 构建发布产物（dashboard → dashboard-dist → tsc）
pnpm test        # 运行测试
pnpm pack        # 生成 tarball 本地验证
```

## 常见问题

**面板打不开 / 白屏**
若启动时带了 `--token`，面板地址要补一次 `?token=你的令牌`（之后会存在 `sessionStorage`）。
令牌不对时接口返回 401，页面只能看到空壳。

**请求没出现在面板里**
- 确认请求带了代理前缀（默认 `/proxira`），或已用 `-nx` 关闭前缀；
- 确认当前激活分组的上游地址是你以为的那个（面板顶部可切换）；
- 确认服务监听地址可达（默认只监听 `127.0.0.1`）。

**502 和 504 的区别**
`502` 是连不上上游或上游提前断开；`504` 是上游在 `PROXY_UPSTREAM_TIMEOUT_MS`（或分组级超时）内没响应。

**流式响应详情里正文是空的**
SSE / 流式响应不会为了观测而完整缓冲（否则会拖住请求），面板展示的是采样到的内容；
超过 `PROXY_MAX_BODY_CAPTURE_BYTES` 的记录会截断并标记 `truncated`。

**历史记录太多想翻更早的**
面板单次加载 500 条，列表底部点「加载更多」可按 offset 继续翻页。

## 注意事项

- 该工具定位为本地开发调试工具，请勿直接暴露公网使用。
- 默认会记录请求与响应内容，请注意敏感信息处理。
- 管理面板和内部 API 固定使用 `/_proxira/*`，自定义前缀只影响业务代理入口。

## License

MIT
