# Proxira

> 轻量化实时请求代理工具 —— 让本地开发联调更高效

Proxira 是一个**本地开发联调用的实时请求代理与观测工具**。
它在本地启动代理端口，将请求转发到真实上游服务，并通过 Web 控制面板实时展示请求、响应、耗时与错误信息。

## 项目作用

- 让 SDK / 前端 / 客户端请求统一走本地代理，便于观测与排查
- 在不改业务请求代码的前提下，快速切换真实上游地址
- 对请求数据进行"可视化追踪"：状态码、耗时、Headers、Body、错误等
- 支持并行调试多环境（如 dev / test / staging）

## 核心能力

- **代理与转发** - 请求透明转发（Path / Query / Headers / Body）
- **HTTP & HTTPS 支持** - 支持 HTTP 和 HTTPS 上游服务，也支持 HTTPS 服务模式
- **智能证书生成** - 一键生成自签名证书，自动检测环境并提供安装指引
- **多分组管理** - 每个分组独立上游地址与历史记录
- **SSE 实时推送** - 实时推送请求事件到 Web 面板
- **请求记录** - 记录查询、删除、清空、导出 JSON
- **详情复制** - 一键复制 URL / Headers / Body / cURL
- **过滤排序** - Method 过滤、Status 过滤、时间排序、耗时排序

## 快速开始

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

## 可选环境变量

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `PORT` | 服务端口 | `3000` |
| `PROXY_TARGET_URL` | 默认分组上游地址 | `http://localhost:8080` |
| `PROXY_DATA_DIR` | 本地数据目录 | `./.proxira` |
| `PROXY_PREFIX` | 代理请求前缀 | `/proxira` |
| `PROXY_PREFIX_ENABLED` | 关闭代理请求前缀 | 未设置 |
| `PROXY_BODY_LIMIT` | 兼容保留（当前版本不再截断展示，实际不生效） | - |
| `PROXY_HISTORY_LIMIT` | 内存历史记录上限 | `1000` |
| `PROXY_HISTORY_PERSIST_LIMIT` | 持久化历史记录上限 | `200` |
| `PROXY_QUERY_LIMIT_MAX` | 记录查询接口最大分页值 | - |
| `PROXY_SSE_HEARTBEAT_MS` | SSE 心跳间隔（毫秒） | - |
| `PROXY_DISABLE_BANNER` | 关闭启动 Banner | 未设置 |
| `PROXY_HTTPS_ENABLED` | 启用 HTTPS 服务模式 | 未设置 |
| `PROXY_HTTPS_KEY_PATH` | HTTPS 私钥文件路径 | - |
| `PROXY_HTTPS_CERT_PATH` | HTTPS 证书文件路径 | - |

## 注意事项

- 该工具定位为本地开发调试工具，请勿直接暴露公网使用。
- 默认会记录请求与响应内容，请注意敏感信息处理。
- 管理面板和内部 API 固定使用 `/_proxira/*`，自定义前缀只影响业务代理入口。

## License

MIT
