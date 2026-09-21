# Proxira

[![npm version](https://img.shields.io/npm/v/proxira)](https://www.npmjs.com/package/proxira)
![node](https://img.shields.io/badge/node-%3E%3D20-339933)
![license](https://img.shields.io/badge/license-MIT-blue)

本地开发联调用的实时请求代理与观测工具：把请求指向本地代理，它转发到真实上游，
并在 Web 面板里实时展示请求、响应、耗时与错误。

### [→ 打开官网 · 完整用法文档](https://proxira.oceandeep.top/)

## 快速开始

```bash
npx proxira            # 直接跑，不安装（推荐）
npx proxira@0.4.1      # 固定版本
npm i -g proxira       # 全局安装，之后直接敲 proxira
```

启动后：

- 代理入口 `http://localhost:3000/proxira`
- 管理面板 `http://localhost:3000/_proxira/ui`

接入通常只改 baseURL：把 `https://api.example.com/v1/users`
换成 `http://localhost:3000/proxira/v1/users`，请求就会经过代理并出现在面板里。

## 常用参数

| 参数 | 说明 | 默认值 |
| --- | --- | --- |
| `-p, --port <port>` | 服务端口 | `3000` |
| `-t, --target <url>` | 上游服务地址 | `http://localhost:8080` |
| `--host [address]` | 监听地址，**不带值即开放到局域网** | `127.0.0.1` |
| `-x, --prefix <path>` | 自定义代理前缀 | `/proxira` |
| `-nx, --no-prefix` | 关闭代理前缀（直转发） | — |
| `-s, --https` | 本地 HTTPS 调试（自签名证书） | — |
| `--token <token>` | 内部 API / SSE 访问令牌 | 关闭 |

完整参数表、环境变量、HTTPS 调试、局域网共享、Mock 拦截、故障注入、请求头分组、
请求重放与差异对比、内部管理接口 —— 全部在官网。

> [!IMPORTANT]
> 定位是**本地开发调试工具**，请勿直接暴露公网。默认只监听 `127.0.0.1`；
> 不支持 WebSocket 等 HTTP Upgrade 协议（握手返回 `501`）；上游是 HTTPS 时不会被解密。

## 链接

- 官网 / 用法文档：<https://proxira.oceandeep.top/>
- 更新日志：<https://proxira.oceandeep.top/changelog/>
- 源码与问题反馈：<https://github.com/oceanDeep512/proxira>

## License

MIT
