# Proxira CLI（apps/getway）

`apps/getway` 是 Proxira 的后端代理服务，同时也是可发布的 npm CLI 包（包名：`proxira`）。

## 功能职责

- 启动本地代理端口
- 转发请求到真实上游服务
- 提供 `/_proxira/api/*` 管理接口
- 托管打包后的 Dashboard 静态资源（`/_proxira/ui`）

## 常用命令

在仓库根目录执行：

```bash
# 开发模式（监听源码）
pnpm --filter ./apps/getway dev

# 构建后端
pnpm --filter ./apps/getway build

# 构建可发布包（包含 dashboard 静态资源）
pnpm --filter ./apps/getway build:pkg

# 打包 npm tarball
pnpm --filter ./apps/getway pack:pkg
```

## CLI 用法

```bash
proxira --help
proxira --port 3010 --target http://localhost:8080
proxira start -p 3001 -d ./.proxira
```

参数说明：

- `-p, --port <port>`：代理服务端口，默认 `3000`
- `-t, --target <url>`：上游服务地址
- `-d, --data-dir <path>`：配置数据目录
- `--no-banner`：关闭启动 Banner
- `-h, --help`：查看帮助
- `-v, --version`：查看版本

## 启动后会显示的中文提示

服务启动后 CLI 会展示一段中文引导，包含：

- 如何让 SDK/应用接入代理端口
- 管理面板访问地址
- 当前上游地址说明
- 常用 CLI 示例
- “仅建议本地开发使用”的提醒

## 管理接口

- `GET /_proxira/api/health`
- `GET /_proxira/api/status`
- `GET /_proxira/api/config`
- `PUT /_proxira/api/config`
- `GET /_proxira/api/records`
- `GET /_proxira/api/records/:id`
- `DELETE /_proxira/api/records/:id`
- `DELETE /_proxira/api/records`
- `GET /_proxira/api/events`（SSE）

## 数据与目录

- 配置文件：默认写入 `./.proxira/config.json`
- 请求历史：当前保存在内存中，进程重启后清空
- 静态面板：发布时同步到 `apps/getway/dashboard-dist`

## 发布说明

```bash
pnpm --filter ./apps/getway build:pkg
pnpm --filter ./apps/getway pack:pkg
```

产物中包含：

- `dist/*`（CLI 和服务端）
- `dashboard-dist/*`（前端构建资源）
