# Proxira

Proxira 是一个轻量化本地请求转发工具，适合开发联调时查看 SDK 请求参数、响应内容和耗时。

## 安装与启动

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

- 代理地址：`http://localhost:3000`
- 管理面板：`http://localhost:3000/_proxira/ui`

## 命令格式

```bash
proxira [options]
```

可用参数：

- `-p, --port <port>`：代理端口（默认 `3000`）
- `-t, --target <url>`：上游服务地址（默认 `http://localhost:8080`）
- `-d, --data-dir <path>`：配置目录（默认 `./.proxira`）
- `--no-banner`：关闭启动 Banner
- `-h, --help`：查看帮助
- `-v, --version`：查看版本

## 使用示例

### 1) 最简单启动

```bash
npx proxira
```

将你的 SDK 或应用请求地址指向 `http://localhost:3000`，然后在面板查看请求与响应详情。

### 2) 指定端口和上游

```bash
npx proxira --port 3010 --target http://localhost:8080
```

此时代理入口变为 `http://localhost:3010`，所有请求会转发到 `http://localhost:8080`。

### 3) 仅使用 proxira + 参数启动

```bash
proxira -p 3001 -t http://localhost:8080
```

### 4) 指定配置目录

```bash
proxira --data-dir ./.proxira-dev
```

### 5) 关闭 Banner，适合脚本或日志收集

```bash
proxira --no-banner
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

## 可选环境变量

- `PROXY_HISTORY_LIMIT`：内存历史记录上限，默认 `1000`
- `PROXY_HISTORY_PERSIST_LIMIT`：本地持久化时每个分组保留最近 N 条，默认 `200`（且不超过 `PROXY_HISTORY_LIMIT`）

## 注意事项

- 该工具定位为本地开发调试工具。
- 默认会记录请求与响应内容，请注意敏感信息处理。
