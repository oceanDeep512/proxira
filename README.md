# Proxira

Proxira 是一个轻量化请求转发工具，主要用于本地开发联调。  
它会启动一个本地代理端口，将请求转发到真实上游服务，并提供 Web 面板实时查看请求与响应详情。

## 适用场景

- 联调 SDK 请求参数是否正确
- 快速排查接口响应、状态码、耗时
- 临时替换上游服务地址，不改业务代码

## 核心能力

- 请求透明转发（path / query / header / cookie / body）
- Web 面板实时展示请求记录
- SSE 实时推送最新请求
- 支持多分组：每个分组绑定独立上游地址和请求历史
- 历史请求支持一键导出 JSON
- 详情支持一键复制 URL / Headers / Body / cURL
- 支持按记录查看、删除、清空
- 支持通过 UI 动态切换上游地址

## 项目结构（Monorepo）

```text
proxira/
├─ apps/
│  ├─ getway/              # 后端代理服务 + 可发布 npm CLI 包
│  └─ dashboard/           # Vue 管理面板
├─ packages/
│  └─ core/                # 前后端共享类型定义
└─ package.json            # 根脚本（构建/启动/打包）
```

## 快速开始（仓库运行）

```bash
# 1) 安装依赖
pnpm install

# 2) 构建（前端 + 后端）
pnpm run build:app

# 3) 启动代理
pnpm run start:app
```

启动后访问：

- 管理面板：`http://localhost:3000/_proxira/ui`
- 健康检查：`http://localhost:3000/_proxira/api/health`

## 快速开始（CLI 方式）

```bash
npx proxira --help
npx proxira --port 3010 --target http://localhost:8080
```

## 启动后推荐使用流程

1. 让你的 SDK/应用请求指向 Proxira 端口（例如 `http://localhost:3000`）。
2. 打开管理面板查看实时请求列表。
3. 在详情区检查 Query / Headers / Body / Response。
4. 需要并行联调多个环境时，新建分组并切换到对应分组。
5. 需要切换上游时，在当前分组里修改“真实转发地址”并保存。

## 管理接口一览

- `GET /_proxira/api/health`：健康检查
- `GET /_proxira/api/status`：服务状态（启动时间、连接数、记录数）
- `GET /_proxira/api/config`：获取分组配置（包含当前激活分组）
- `PUT /_proxira/api/config`：切换激活分组或更新当前分组上游地址
- `POST /_proxira/api/groups`：创建分组（默认创建后切换到新分组）
- `PUT /_proxira/api/groups/:id`：编辑分组标题/上游地址（可选设为激活）
- `GET /_proxira/api/records`：分页查询记录（支持 `groupId` 查询参数）
- `GET /_proxira/api/records/export`：导出当前分组记录为 JSON（支持 `groupId`）
- `GET /_proxira/api/records/:id`：查看单条记录（支持 `groupId`）
- `DELETE /_proxira/api/records/:id`：删除单条记录（支持 `groupId`）
- `DELETE /_proxira/api/records`：清空记录（支持 `groupId`）
- `GET /_proxira/api/events`：SSE 实时事件流

## 环境变量

- `PORT`：服务端口（默认 `3000`）
- `PROXY_TARGET_URL`：初始默认分组的上游地址（默认 `http://localhost:8080`）
- `PROXY_DATA_DIR`：配置文件存储目录（默认 `./.proxira`）
- `PROXY_BODY_LIMIT`：记录体截断大小（默认 `32768` 字节）
- `PROXY_HISTORY_LIMIT`：内存历史记录上限（默认 `1000`）
- `PROXY_HISTORY_PERSIST_LIMIT`：本地持久化时每个分组保留最近 N 条（默认 `200`，且不超过 `PROXY_HISTORY_LIMIT`）
- `PROXY_QUERY_LIMIT_MAX`：历史记录接口最大分页值（默认 `500`）
- `PROXY_SSE_HEARTBEAT_MS`：SSE 心跳毫秒（默认 `15000`）
- `PROXY_DISABLE_BANNER=1`：关闭启动 Banner

## 开发命令

```bash
# 后端开发
pnpm run dev:getway

# 前端开发
pnpm run dev:dashboard

# 打包 npm CLI 产物
pnpm run pack:cli
```

## 注意事项

- 该工具定位为本地开发联调工具，请勿直接暴露到公网环境。
- 默认会记录请求与响应内容，联调敏感数据时请谨慎使用。
