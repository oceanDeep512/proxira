# @proxira/dashboard

Proxira 的 Web 控制面板（React 实现）。

## 技术栈

- **React 19 + TypeScript + Vite**：构建产物挂载在 `/_proxira/ui/`，由 `apps/getway` 托管
- **Tailwind CSS v4**：`@theme inline` + 语义化 CSS 变量（`--px-*`），`html[data-theme]` 切换深浅色，工具类直接消费 `var()`，所以整站配色跟随主题
- **Zustand**：内核状态（records / rules / targets / SSE）与 UI 状态（筛选、主题、Tab）分开两个 store
- **Radix UI**：Dialog / DropdownMenu / Tooltip / Switch，弹窗与下拉的焦点管理和键盘可达性不自己造
- **@tanstack/react-virtual**：历史请求列表虚拟滚动，上千条也不卡
- **@fontsource-variable**：Sora / Space Grotesk / JetBrains Mono 本地打包，离线可用（不依赖 Google Fonts CDN）

## 命令

```bash
pnpm dev          # Vite 开发服务（127.0.0.1:5173，/_proxira 代理到内核）
pnpm build        # tsc --noEmit + vite build（输出 dist/）
pnpm typecheck    # 仅类型检查
```

内核侧 `pnpm build:pkg` 会先构建本包，再执行 `apps/getway` 的 `sync:ui` 拷贝到 `dashboard-dist/`。

## 目录

```
src/
  lib/        纯函数：body 解析、格式化、筛选、脱敏、diff（与框架无关，可直接复用）
  store/      zustand：proxira（内核契约 + SSE）、ui（主题/筛选/Tab）、toast
  hooks/      useMediaQuery、useCopy
  components/
    ui/       Button / IconButton / Pill / Select / Modal / Segmented / Toggle / Tooltip / Toaster
    layout/   TopBar、TargetHub
    records/  RecordList（虚拟列表 + 筛选）
    detail/   DetailPanel、OverviewTab、BodyViewer、JsonTree、CodeBlock、
              HeadersView、CsvTable、SseEventList
    modals/   TargetFormModal、ConfirmDialog、RuleManagerModal、ReplayDialog
  styles/     设计 token 与少量组件层 CSS
```

## 约定（改 UI 前先看）

- **wire 契约不能改名**：`/_proxira/api/*` 路由、查询键 `groupId`、请求体键 `activeGroupId`，统一收在 `src/lib/api.ts` 与 `src/store/proxira.ts`
- **布局用 flex**：只有两个真正的断点 —— `panel`(960px) 以下单列堆叠（`display: contents` 拆掉中间两层盒子，让顶栏与转发地址同行），以上是「左列表 / 右详情」双栏
- **颜色只写语义名**（`bg-surface`、`text-fg-soft`、`border-line`…），不要写死十六进制；新增颜色先加 token
- **间距/圆角用刻度**：`gap-3`(12) / `p-3` / `p-4`(16)，圆角 `rounded-md`(12) / `rounded-lg`(16) / `rounded-full`
- **数据展示组件**：JSON 一律走 `JsonTree`（搜索命中自动展开 + 大数组分页），代码块走 `CodeBlock`（highlight.js 按需注册语言）
