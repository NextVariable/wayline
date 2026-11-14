# 开发与配置

网站由 React 和 Vite 构建。生产模式由 Node 在同一地址提供网页和接口。Google 登录、日历和 Gmail 依赖浏览器会话及准确的回调地址。

## 本地开发

```bash
npm ci
npm run build
npm start
```

生产构建运行在 `http://127.0.0.1:8787`。需要前端热更新时，保持后端运行，在另一个终端执行 `npm run dev`，打开 `http://127.0.0.1:3000`。需要走完整的 Google 登录或授权流程时，在 8787 上测试，浏览器访问地址须与 OAuth 配置一致。

## 可选集成

把 [`.env.example`](../.env.example) 复制为 `.env.local`。修改浏览器地图配置后重新构建网站。

| 能力 | 配置 |
| --- | --- |
| 浏览器底图 | 高德使用 `VITE_AMAP_KEY`，按供应商配置填写 `VITE_AMAP_SECURITY_CODE`。天地图使用 `VITE_TIANDITU_TOKEN`。 |
| 服务端路线和地点搜索 | 配置 `AMAP_WEB_SERVICE_KEY`。备用天地图查询可配置 `TIANDITU_TOKEN`。 |
| Google 登录和日历 | 配置 `GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`，启用 Calendar API，并登记下方两个回调地址。 |
| Gmail 订单 | 启用 Gmail API，设置 `GMAIL_ORDERS_ENABLED=1`，在 Wayline 的日历来源内单独连接 Gmail。 |
| 车次和航班参考 | 按需运行 `npm run providers:install` 安装可选运行依赖，返回结果取决于供应服务和线路覆盖。 |

在 Google Cloud 登记两个本机回调地址。

```text
http://127.0.0.1:8787/api/auth/google/callback
http://127.0.0.1:8787/api/calendar/google/callback
```

`VITE_` 变量会进入浏览器构建产物。OAuth 密钥和服务端地图凭证放在服务端环境变量中。默认账号和日历存储位于 `.wayline-private/`。迁移加密存储时需要对应的数据文件和密钥，妥善保管这两项。

## 验证与部署

```bash
npm test
npm run build
```

自动测试使用本地样本。验证真实同步、路线或设备行为时，在变更说明中写清数据来源、环境和观察结果。使用合成资料验证恢复流程，避免覆盖真实账号的工作区。

部署受邀预览时，使用受信任的 HTTPS 入口，配置 `PUBLIC_ORIGIN`、预览访问密码及持久存储，并将 OAuth 和地图服务配置对齐到实际域名。当前公开发布条件见[发布验收](release-readiness.md)。
