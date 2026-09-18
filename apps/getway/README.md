# Proxira

[![npm version](https://img.shields.io/npm/v/proxira)](https://www.npmjs.com/package/proxira)
![node](https://img.shields.io/badge/node-%3E%3D20-339933)
![license](https://img.shields.io/badge/license-MIT-blue)

本地开发联调用的实时请求代理与观测工具：把请求指向本地代理，它转发到真实上游，
并在 Web 面板里实时展示请求、响应、耗时与错误。

```bash
npx proxira
```

启动后：

- 代理入口 `http://localhost:3000/proxira`
- 管理面板 `http://localhost:3000/_proxira/ui`

## 安装与运行

```bash
# 直接跑，不安装（推荐）
npx proxira

# 固定版本
npx proxira@0.3.1

# 全局安装
npm i -g proxira
proxira
```

## 把请求接进来

代理把 `<代理入口>/<原路径>` 原样转发到 `<上游>/<原路径>`，所以接入通常只改 baseURL：

```bash
# 原来
curl https://api.example.com/v1/users

# 接入后：换成代理地址，保留 /proxira 前缀
curl http://127.0.0.1:3000/proxira/v1/users
```

```js
// OpenAI / DeepSeek 这类 SDK 改 baseURL 即可，路径 /v1 保留在后面
const client = new OpenAI({
  baseURL: "http://127.0.0.1:3000/proxira/v1",
  apiKey: process.env.DEEPSEEK_API_KEY,
});
```

常用启动形式：

```bash
npx proxira --port 3010 --target http://localhost:8080   # 指定端口和上游
npx proxira -nx                                          # 关闭 /proxira 前缀，端口下全部转发
npx proxira --host                                       # 不带值 = --host lan，开放到局域网（见下一节）
npx proxira --token my-secret                            # 给内部 API 与 SSE 加访问令牌
```

HTTPS（客户端强制 HTTPS 时用）：

```bash
npx proxira gen-cert      # 生成自签名证书
npx proxira --https       # 用生成的证书启动
```

## 让其他电脑也能用（局域网共享）

默认只监听 `127.0.0.1`，**只有本机自己能连**。想让同一网络下的其他电脑（或手机）也用这台机器上的代理：

```bash
npx proxira --host        # 不带值即 --host lan
npx proxira --host lan    # 同上，写清楚一点
```

启动后横幅直接给出这台机器对外的地址，别的设备填它即可：

```text
Proxy: http://192.168.1.4:3000/proxira     ← 其他电脑填这个
Local: http://localhost:3000/proxira       ← 本机自己用这个
Host: 0.0.0.0
Dashboard: http://192.168.1.4:3000/_proxira/ui
```

| `--host` 值 | 谁能连 |
|---|---|
| `127.0.0.1`（默认） | 只有本机 |
| 不带值 / `lan` / `0.0.0.0` | 同一网络下的所有设备 |
| `192.168.1.4`（本机某个 IP） | 只能通过那张网卡连进来 |

> [!TIP]
> `--host` 填的是**本机监听哪张网卡**，不是上游地址、也不是别人的地址。
> 所以一般不用填 `192.168.x.x`——直接 `--host lan` 就行，换网络也不会失效。

> [!WARNING]
> 开放后同一网络里的人都能看到你的请求历史与响应正文（含 token / cookie），
> 也能改上游地址。只在可信网络里开，必要时加 `--token`。

## 核心能力

- **透明转发** - 保留 Method / Path / Query / Headers / Body，支持 HTTP 与 HTTPS 上游
- **实时观测** - SSE 推送，面板实时刷新；支持状态 / 方法筛选与耗时排序
- **多转发地址** - 每个转发地址独立上游与历史，可配置独立超时
- **拦截规则** - 按路径 / 方法 Mock 桩数据、模拟错误、注入延迟、流式中断、截断响应
- **请求重放** - 改完参数直接重发上游，与原响应逐行差异对比
- **正文查看** - JSON 树（搜索高亮 / 分页 / 节点复制）、源码视图、表格、SSE 逐帧、多格式高亮
- **详情复制与导出** - 一键复制 URL / Headers / Body / cURL，历史导出 JSON
- **敏感信息脱敏** - `authorization` / `cookie` / `api_key` 默认打码，可一键看原文

## 参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `-p, --port <port>` | 代理端口 | `3000` |
| `-t, --target <url>` | 上游服务地址 | `http://localhost:8080` |
| `-d, --data-dir <path>` | 配置目录 | 用户级目录 |
| `-x, --prefix <path>` | 自定义代理前缀 | `/proxira` |
| `-nx, --no-prefix` | 关闭代理前缀 | - |
| `--host [addr]` | 监听地址；不带值 = `lan` = `0.0.0.0` = 局域网可访问 | `127.0.0.1` |
| `--token <token>` | 内部 API / SSE 访问令牌 | 关闭 |
| `-b, --no-banner` | 关闭启动 Banner | - |
| `-s, --https` | 启用 HTTPS 服务模式 | - |
| `--https-key / --https-cert <path>` | 指定证书（需成对） | - |
| `-h, --help` / `-v, --version` | 帮助 / 版本 | - |

子命令：

| 命令 | 说明 |
|------|------|
| `gen-cert` | 生成自签名证书（`-o` 输出目录、`-c` 通用名、`--days` 有效期、`-y` 跳过确认） |
| `clear-cache` | 清空本地配置与历史 |
| `data-dir` | 显示当前数据目录及其来源 |
| `migrate-data` | 把旧版工作目录下的 `.proxira` 迁移到统一数据目录 |

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PORT` | 服务端口 | `3000` |
| `PROXY_TARGET_URL` | 上游地址 | `http://localhost:8080` |
| `PROXY_HOST` | 监听地址 | `127.0.0.1` |
| `PROXY_DATA_DIR` | 数据目录 | 用户级目录 |
| `PROXY_PREFIX` / `PROXY_PREFIX_ENABLED` | 代理前缀 / 关闭前缀 | `/proxira` |
| `PROXY_UPSTREAM_TIMEOUT_MS` | 等待上游响应头的超时，超时返回 504 | `30000` |
| `PROXY_MAX_BODY_CAPTURE_BYTES` | 单条**非流式**正文记录上限 | `2097152` |
| `PROXY_STREAM_MAX_CAPTURE_BYTES` | 流式响应捕获字节上限，`0` = 不限制 | `0` |
| `PROXY_STREAM_MAX_CAPTURE_MS` | 流式响应采样时长上限，`0` = 不限制 | `0` |
| `PROXY_HISTORY_LIMIT` | 内存历史条数上限 | `1000` |
| `PROXY_HISTORY_PERSIST_LIMIT` | 落盘历史条数上限 | `200` |
| `PROXY_HISTORY_PERSIST_BODY_LIMIT` | 落盘时单条正文裁剪上限（内存仍完整） | `65536` |
| `PROXY_ACCESS_TOKEN` | 内部 API / SSE 访问令牌 | - |
| `PROXY_HTTPS_ENABLED` | 启用 HTTPS 服务模式 | 未设置 |

## 能力边界

- **不支持 WebSocket 及其他 HTTP Upgrade 协议**：握手请求返回 `501`、不转发、面板记录写明原因。
  调试 WebSocket 请让客户端直连上游。
- **不做系统代理接管**：只监听自己的端口，需要你在客户端里把请求地址指过去，不会改写系统网络设置。
- **不解密 HTTPS 上游**：`--https` 是让「客户端 → 代理」这一段走 HTTPS（自签名证书），
  代理 → 上游仍按上游本身的协议原样转发。
- **定位是本地开发调试工具**：面板能看完整正文、也能改上游地址，请勿直接暴露公网；
  `--host` 开放到局域网时请只在可信网络里用，必要时加 `--token`。

## 注意事项

> [!NOTE]
> - 默认只监听 `127.0.0.1`，其他电脑连不上；需要局域网访问用 `proxira --host`（不带值即 `lan`）。
> - 默认会记录完整请求/响应正文，联调真实数据请注意敏感信息。
> - 非流式正文超过 `PROXY_MAX_BODY_CAPTURE_BYTES` 才截断（只截记录，转发始终完整）；
>   流式响应**默认全量捕获**。
> - `PROXY_UPSTREAM_TIMEOUT_MS` 只管「等响应头」，长 SSE / LLM 流不会被掐断。
> - 落盘是原子写；若配置文件损坏会改名成 `*.corrupt-<时间戳>` 保留证据，再重建空数据。

## 常见问题

**面板打不开 / 白屏**
带了 `--token` 时，面板地址要补一次 `?token=你的令牌`（之后存在 `sessionStorage`）。

**请求没出现在面板里**
确认带了 `/proxira` 前缀（或已 `-nx`）、当前激活转发地址的上游是你以为的那个、监听地址可达。

**502 和 504 的区别**
`502` 是连不上上游或上游提前断开；`504` 是上游在超时内没返回响应头。

**流式响应正文为空 / 被截断**
进行中的流每秒增量上屏，稍等即可；默认不截断，除非你显式设了
`PROXY_STREAM_MAX_CAPTURE_BYTES` / `_MS`；重启后看到的是落盘版本，会按
`PROXY_HISTORY_PERSIST_BODY_LIMIT`（默认 64KB）裁剪，想保留完整正文把它设为 `0`。

**数据存在哪**
用户级统一目录（与端口、工作目录无关）。`proxira data-dir` 可查看，
`proxira migrate-data` 可迁移旧数据，`proxira clear-cache` 可清空。

## 更多

开发、测试、发布与架构说明见仓库根目录 README：
<https://github.com/oceanDeep512/proxira#readme>

## License

MIT
