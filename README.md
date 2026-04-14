# Proxira

Proxira 是一个**本地开发联调用的实时请求代理与观测工具**。  
它在本地启动代理端口，将请求转发到真实上游服务，并通过 Web 控制面板实时展示请求、响应、耗时与错误信息。

## 项目作用

- 让 SDK / 前端 / 客户端请求统一走本地代理，便于观测与排查
- 在不改业务请求代码的前提下，快速切换真实上游地址
- 对请求数据进行“可视化追踪”：状态码、耗时、Headers、Body、错误等
- 支持并行调试多环境（如 dev / test / staging）

## 适用场景

- 联调时快速确认请求参数是否正确
- 排查接口异常（4xx / 5xx / 网络错误）
- 对比不同上游环境的返回差异
- 导出记录用于问题复盘与协作沟通

## 核心能力

- 请求透明转发（Path / Query / Headers / Body）
- SSE 实时推送请求事件
- 多分组管理（每个分组独立上游地址与历史记录）
- 记录查询、删除、清空、导出 JSON
- 详情一键复制（URL / Headers / Body / cURL）
- 请求体/响应体自动识别（JSON / Text / Binary）
- 过滤与排序：
  - Method 过滤
  - Status 过滤（2xx / 3xx / 4xx / 5xx / ERR）
  - 时间排序（新→旧、旧→新）
  - 耗时排序（高→低、低→高）
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

## 快速开始（仓库方式）

```bash
# 1) 安装依赖
pnpm install

# 2) 构建完整应用（dashboard + getway）
pnpm run build:app

# 3) 启动代理服务
pnpm run start:app
```

启动后访问：

- 代理入口：`http://localhost:3000/proxira`
- 管理面板：`http://localhost:3000/_proxira/ui`
- 健康检查：`http://localhost:3000/_proxira/api/health`

## 快速开始（CLI 方式）

```bash
npx proxira --help
npx proxira --port 3010 --target http://localhost:8080
```

## 常用开发命令

```bash
# 后端开发（watch）
pnpm run dev:getway

# 前端开发（Vite）
pnpm run dev:dashboard

# 构建所有包
pnpm run build

# 打包 CLI 产物（npm pack）
pnpm run pack:cli
```

## 推荐使用流程

1. 将业务请求指向 Proxira 代理入口（如 `http://localhost:3000/proxira`）。
2. 打开 Dashboard 观察实时请求列表。
3. 通过过滤与排序快速定位目标请求。
4. 在详情区检查 Query / Headers / Body / Response / Error。
5. 使用分组切换不同上游环境。
6. 需要留档时导出 JSON。

## 管理接口（概览）

- `GET /_proxira/api/health`：健康检查
- `GET /_proxira/api/status`：服务状态
- `GET /_proxira/api/config`：读取分组配置与当前激活分组
- `PUT /_proxira/api/config`：切换激活分组
- `POST /_proxira/api/groups`：创建分组
- `PUT /_proxira/api/groups/:id`：更新分组信息
- `DELETE /_proxira/api/groups/:id`：删除分组并清理分组数据
- `GET /_proxira/api/records`：查询历史记录（支持 `groupId`）
- `GET /_proxira/api/records/export`：导出记录（支持筛选参数）
- `GET /_proxira/api/records/:id`：查询单条记录
- `DELETE /_proxira/api/records/:id`：删除单条记录
- `DELETE /_proxira/api/records`：清空当前分组记录
- `GET /_proxira/api/events`：SSE 实时事件流
- `POST /_proxira/api/reset`：重置分组与历史数据

## 关键环境变量

- `PORT`：服务端口（默认 `3000`）
- `PROXY_TARGET_URL`：默认分组上游地址（默认 `http://localhost:8080`）
- `PROXY_DATA_DIR`：本地数据目录（默认 `./.proxira`）
- `PROXY_BODY_LIMIT`：请求/响应体截断大小
- `PROXY_HISTORY_LIMIT`：内存历史记录上限
- `PROXY_HISTORY_PERSIST_LIMIT`：持久化历史记录上限
- `PROXY_QUERY_LIMIT_MAX`：记录查询接口最大分页值
- `PROXY_SSE_HEARTBEAT_MS`：SSE 心跳间隔（毫秒）
- `PROXY_DISABLE_BANNER=1`：关闭启动 Banner

## 注意事项

- Proxira 定位为本地联调工具，请勿直接暴露公网使用。
- 默认会记录请求与响应内容，涉及敏感数据时请谨慎处理。
