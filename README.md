# Proxira

> 轻量化实时请求代理工具 —— 让本地开发联调更高效

Proxira 是一个**本地开发联调用的实时请求代理与观测工具**。
它在本地启动代理端口，将请求转发到真实上游服务，并通过 Web 控制面板实时展示请求、响应、耗时与错误信息。

## 项目作用

- 让 SDK / 前端 / 客户端请求统一走本地代理，便于观测与排查
- 在不改业务请求代码的前提下，快速切换真实上游地址
- 对请求数据进行"可视化追踪"：状态码、耗时、Headers、Body、错误等
- 支持并行调试多环境（如 dev / test / staging）

## 适用场景

- 联调时快速确认请求参数是否正确
- 排查接口异常（4xx / 5xx / 网络错误）
- 对比不同上游环境的返回差异
- 导出记录用于问题复盘与协作沟通

## 核心能力

### 代理与转发

- 请求透明转发（Path / Query / Headers / Body）
- 支持 HTTP 和 HTTPS 上游服务
- 支持自定义代理前缀或无前缀模式
- 支持 HTTPS 服务模式（需提供证书）
- SSE 实时推送请求事件

### 多分组管理

- 每个分组独立上游地址与历史记录
- 快速切换不同环境（dev / test / staging）

### 请求记录

- 记录查询、删除、清空、导出 JSON
- 详情一键复制（URL / Headers / Body / cURL）
- 请求体/响应体自动识别（JSON / Text / Binary）

### 过滤与排序

- Method 过滤
- Status 过滤（2xx / 3xx / 4xx / 5xx / ERR）
- 时间排序（新→旧、旧→新）
- 耗时排序（高→低、低→高）

### UI 体验

- Dashboard 自动跟随系统明暗主题
- 三个主滚动区域采用 `SimpleBar` 自定义滚动条，暗色模式可读性已适配：
  - 历史请求列表
  - 请求内容列
  - 响应内容列

## Monorepo 结构

```text
proxira/
├─ apps/
│  ├─ getway/              # 代理服务 + CLI（npm 包主体）
│  └─ dashboard/           # Vue 3 + Vite 控制面板
├─ packages/
│  └─ core/                # 前后端共享类型
├─ package.json            # 根脚本（开发/构建/启动）
└─ pnpm-workspace.yaml
```

## 技术栈

| 层级    | 技术选型          |
| ------- | ----------------- |
| 后端服务 | Hono (Node.js)    |
| 前端面板 | Vue 3 + Vite      |
| 类型验证 | Zod               |
| 构建工具 | TypeScript + tsx  |
| 包管理   | pnpm workspace    |

## 快速开始

### 方式一：CLI 方式（推荐）

```bash
# 直接使用 npx
npx proxira --help
npx proxira --port 3010 --target http://localhost:8080
npx proxira -x /debug-proxy --target http://localhost:8080
npx proxira -X --target http://localhost:8080
```

### 方式二：仓库方式

```bash
# 1) 安装依赖
pnpm install

# 2) 构建完整应用（dashboard + getway）
pnpm run build:app

# 3) 启动代理服务
pnpm run start:app
```

### 启动后访问

- 代理入口：`http://localhost:3000/proxira`（默认）
- 管理面板：`http://localhost:3000/_proxira/ui`
- 健康检查：`http://localhost:3000/_proxira/api/health`

### HTTPS 模式快速开始

```bash
# 1) 生成自签名证书
npx proxira gen-cert

# 2) 使用生成的证书启动 HTTPS 服务
npx proxira --https --https-key ./.proxira/certs/key.pem --https-cert ./.proxira/certs/cert.pem
```

启动后访问：
- 代理入口：`https://localhost:3000/proxira`
- 管理面板：`https://localhost:3000/_proxira/ui`

**注意**：使用自签名证书时，浏览器会提示安全警告，这是正常的。点击"高级" → "继续访问"即可。

## 智能证书生成向导

`gen-cert` 子命令提供智能环境检测和友好的安装指引：

### 功能特性

- ✅ **自动系统检测**：识别 macOS、Windows、Linux
- ✅ **OpenSSL 检测**：检查是否已安装 OpenSSL
- ✅ **智能安装指引**：
  - macOS：检测 Homebrew，提供 `brew install openssl`
  - Windows：检测 Chocolatey，提供 `choco install openssl`
  - Linux：检测 apt，提供 `sudo apt-get install openssl`
- ✅ **友好确认提示**：生成前显示配置摘要，等待用户确认
- ✅ **一键跳过确认**：使用 `--yes` 参数直接执行

### 使用流程

```bash
# 1) 运行证书生成向导
npx proxira gen-cert

# 2) 如果 OpenSSL 未安装，按提示安装
#    macOS: brew install openssl
#    Windows: choco install openssl
#    Linux: sudo apt-get install openssl

# 3) 重新运行生成向导
npx proxira gen-cert

# 4) 确认配置后，证书自动生成

# 5) 使用生成的证书启动 HTTPS 服务
npx proxira --https --https-key ./.proxira/certs/key.pem --https-cert ./.proxira/certs/cert.pem
```

### 跳过确认模式

```bash
# 直接生成证书，无需确认
npx proxira gen-cert --yes
```

## CLI 命令参考

```bash
# 基本用法
proxira [options]
proxira clear-cache [options]
proxira gen-cert [options]

# 参数说明
-p, --port <port>          代理服务端口，默认 3000
-t, --target <url>         上游服务地址（例如 http://localhost:8080）
-d, --data-dir <path>      配置目录（默认 ./.proxira）
-x, --prefix <path>        自定义代理前缀，默认 /proxira
-nx, --no-prefix            关闭代理前缀，直接转发非 /_proxira 请求
-s, --https                启用 HTTPS 服务模式
--https-key <path>         HTTPS 私钥文件路径
--https-cert <path>        HTTPS 证书文件路径
-b, --no-banner            关闭启动 Banner 输出
-h, --help                 查看帮助信息
-v, --version              查看当前 CLI 版本

# gen-cert 专用参数
-o, --output-dir <path>    证书输出目录（默认 ./.proxira/certs）
-c, --common-name <name>   证书通用名（默认 localhost）
--days <number>            证书有效期天数（默认 365）
-y, --yes                  跳过确认提示，直接执行

# 子命令
clear-cache                清除本地缓存（配置 + 历史记录）
gen-cert                   生成自签名 HTTPS 证书（自动检测环境）

# 示例
proxira
proxira --port 3010 --target http://localhost:8080
# 默认业务请求需走 /proxira 前缀，例如：http://localhost:3010/proxira/api/users
proxira -x /debug-proxy --target http://localhost:8080
proxira -nx --target http://localhost:8080
proxira -b -p 3010 -t http://localhost:8080
proxira --port=3010 --target=http://localhost:8080
proxira -p 3001 -d ./.proxira

# 证书生成示例（智能检测）
proxira gen-cert
proxira gen-cert -o ./my-certs -c myapp.local --days 730
proxira gen-cert --yes  # 跳过确认提示

# HTTPS 模式示例（配合生成的证书使用）
proxira --https --https-key ./.proxira/certs/key.pem --https-cert ./.proxira/certs/cert.pem
proxira -s --https-key ./.proxira/certs/key.pem --https-cert ./.proxira/certs/cert.pem --port 3443

proxira clear-cache
proxira clear-cache --data-dir ./.proxira
```

## 常用开发命令

```bash
# 后端开发（watch）
pnpm run dev:getway

# 前端开发（Vite）
pnpm run dev:dashboard

# 构建所有包
pnpm run build

# 构建应用并打包 CLI 产物
pnpm run build:app
pnpm run pack:cli
```

## 推荐使用流程

1. 将业务请求指向 Proxira 代理入口（默认如 `http://localhost:3000/proxira`，也可通过 CLI 自定义或关闭前缀）。
2. 打开 Dashboard 观察实时请求列表。
3. 通过过滤与排序快速定位目标请求。
4. 在详情区检查 Query / Headers / Body / Response / Error。
5. 使用分组切换不同上游环境。
6. 需要留档时导出 JSON。

## 管理接口（概览）

| 方法   | 路径                            | 说明                                   |
| ------ | ------------------------------- | -------------------------------------- |
| GET    | `/_proxira/api/health`         | 健康检查                               |
| GET    | `/_proxira/api/status`         | 服务状态                               |
| GET    | `/_proxira/api/config`         | 读取分组配置与当前激活分组             |
| PUT    | `/_proxira/api/config`         | 切换激活分组                           |
| POST   | `/_proxira/api/groups`         | 创建分组                               |
| PUT    | `/_proxira/api/groups/:id`     | 更新分组信息                           |
| DELETE | `/_proxira/api/groups/:id`     | 删除分组并清理分组数据                 |
| GET    | `/_proxira/api/records`        | 查询历史记录（支持 `groupId`）         |
| GET    | `/_proxira/api/records/export` | 导出记录（支持筛选参数）               |
| GET    | `/_proxira/api/records/:id`    | 查询单条记录                           |
| DELETE | `/_proxira/api/records/:id`    | 删除单条记录                           |
| DELETE | `/_proxira/api/records`        | 清空当前分组记录                       |
| GET    | `/_proxira/api/events`         | SSE 实时事件流                         |
| POST   | `/_proxira/api/reset`          | 重置分组与历史数据                     |

## 关键环境变量

| 变量名                        | 说明                           | 默认值                  |
| ----------------------------- | ------------------------------ | ----------------------- |
| `PORT`                        | 服务端口                       | `3000`                  |
| `PROXY_TARGET_URL`            | 默认分组上游地址               | `http://localhost:8080` |
| `PROXY_DATA_DIR`              | 本地数据目录                   | `./.proxira`            |
| `PROXY_PREFIX`                | 代理请求前缀                   | `/proxira`              |
| `PROXY_PREFIX_ENABLED`        | 关闭代理请求前缀               | 未设置                  |
| `PROXY_BODY_LIMIT`            | 请求/响应体截断大小            | -                       |
| `PROXY_HISTORY_LIMIT`         | 内存历史记录上限               | -                       |
| `PROXY_HISTORY_PERSIST_LIMIT` | 持久化历史记录上限             | -                       |
| `PROXY_QUERY_LIMIT_MAX`       | 记录查询接口最大分页值         | -                       |
| `PROXY_SSE_HEARTBEAT_MS`      | SSE 心跳间隔（毫秒）           | -                       |
| `PROXY_DISABLE_BANNER`        | 关闭启动 Banner                | 未设置                  |
| `PROXY_HTTPS_ENABLED`         | 启用 HTTPS 服务模式            | 未设置                  |
| `PROXY_HTTPS_KEY_PATH`        | HTTPS 私钥文件路径             | -                       |
| `PROXY_HTTPS_CERT_PATH`       | HTTPS 证书文件路径             | -                       |

## 注意事项

- Proxira 定位为本地联调工具，请勿直接暴露公网使用。
- 默认会记录请求与响应内容，涉及敏感数据时请谨慎处理。
- 管理面板和内部 API 固定保留在 `/_proxira/*`，自定义前缀仅影响业务代理入口。

## License

MIT
