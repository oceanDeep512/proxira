# Dashboard（apps/dashboard）

`apps/dashboard` 是 Proxira 的 Web 管理面板，用于实时查看代理流量与配置上游地址。

## 核心功能

- 分组管理（每组独立上游地址与请求历史）
- 支持编辑当前分组标题与上游地址
- 查看请求列表（最新优先）
- 查看请求详情（Query / Headers / Body）
- 查看响应详情（Headers / Body / 状态码 / 耗时）
- 删除单条记录
- 实时 SSE 连接状态显示
- 修改并保存当前分组上游地址

## 本地开发

```bash
pnpm --filter @proxira/dashboard dev
```

默认访问：`http://localhost:5173`

开发代理行为：

- `/_proxira/*` 会代理到 `http://127.0.0.1:3000`
- 可通过 `VITE_PROXY_DEV_TARGET` 修改后端地址

示例：

```bash
VITE_PROXY_DEV_TARGET=http://127.0.0.1:3010 pnpm --filter @proxira/dashboard dev
```

## API 前缀覆盖（可选）

在少量自定义场景下可用 `VITE_PROXY_API_BASE` 覆盖请求前缀：

```bash
VITE_PROXY_API_BASE=http://localhost:3000 pnpm --filter @proxira/dashboard dev
```

## 生产构建

```bash
pnpm --filter @proxira/dashboard build
```

构建后：

- 产物输出到 `apps/dashboard/dist`
- 发布流程会把 dist 同步到 `apps/getway/dashboard-dist`
- 最终由后端通过 `/_proxira/ui` 统一托管

## 页面使用说明

1. 进入面板后会先加载分组配置和当前分组历史记录。
2. 需要并行联调多个环境时，可先创建分组再切换。
3. SSE 连接成功后，新的请求会自动出现在当前分组的左侧列表。
4. 点击某条记录，在右侧查看完整请求/响应细节。
5. 需要切换上游服务时，在当前分组“真实转发地址”输入并保存。
