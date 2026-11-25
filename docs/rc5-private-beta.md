# Wayline RC.5 Private Beta 准备说明

日期：2026-11-25  
版本：`1.0.0-rc.5`  
分支：`feat/ai-native-mvp`  
代码冻结提交：`58ebfecee735951322b50715aad77c09f09fc35a`  
状态文档提交：`84da96a`  
CI：[run 45650623664](https://github.com/NextVariable/wayline/actions/runs/45650623664) — **success**

状态：**DEVELOPMENT FROZEN / PRIVATE BETA READY**

## 1. 四个阶段必须区分

| 阶段 | 当前结论 | 含义 |
| --- | --- | --- |
| 本地工程收口 | **完成** | 代码、测试、构建、本地预检通过；M5 阻断项工程部分按报告收口。 |
| 远端 CI 验收 | **通过** | 推送后手动触发 CI，lint、备份演练、测试、构建、隔离进程预检全部成功。 |
| 私人内测 | **就绪，待体验** | 本机预览可用；仅限个人/受邀测试，不代表正式发布。 |
| 正式发布 | **未就绪** | G0/PRD、Google 真实授权、Gmail 合规、真机验收与生产告警仍阻断。 |

## 2. 本地启动与预览

```bash
cd /Users/francis/Desktop/wayline-rc3
npm ci
npm run build
npm start
```

- 默认仅监听本机：`http://127.0.0.1:8787/`
- 健康检查：`http://127.0.0.1:8787/healthz`
- 若只需开发热更新：`npm run dev`，访问 `http://127.0.0.1:3000/`
- 结束：在运行 `npm start` 的终端按 `Ctrl+C`

当前预览已用本轮最新构建重启；若修改代码，需重新 `npm run build` 并重启。

## 3. 同一局域网 Android 手机访问

默认服务只绑定 `127.0.0.1`，手机无法直接访问，这是有意的安全默认。需要受保护的局域网访问时：

```bash
cd /Users/francis/Desktop/wayline-rc3
WEB_ACCESS_PASSWORD='<自行设置一个仅本次使用的强密码>' \
HOST=0.0.0.0 \
PUBLIC_ORIGIN='http://<Mac 局域网 IP>:8787' \
npm start
```

- 本机局域网 IP：`10.9.167.109`（以 `ipconfig getifaddr en0` 当前输出为准，IP 可能变化）。
- 手机与 Mac 连同一 Wi-Fi，浏览器打开 `http://10.9.167.109:8787`。
- 启动时若 `HOST` 非回环且未设置 `WEB_ACCESS_PASSWORD`，服务会拒绝启动。
- 仅在测试期间开启；结束后恢复默认 `npm start`（回环）或关闭进程。
- **不要**使用公网隧道、端口映射或路由器 DMZ；不要把该地址发给非受邀测试者。
- 局域网仍建议保持 macOS 防火墙开启，仅允许当前网络访问 Node。

安全边界：该模式会暴露本机工作区与付费 AI/高德接口，密码是唯一访问门槛；不得在咖啡厅、酒店等不可信网络开启。

## 4. 连接状态

| 服务 | 状态 | 说明 |
| --- | --- | --- |
| 高德地图 | **已配置并可用** | 服务端 `AMAP_WEB_SERVICE_KEY`、浏览器 `VITE_AMAP_KEY` / `VITE_AMAP_SECURITY_CODE` 已配置；本机实测路线与 POI 返回真实数据。 |
| DeepSeek | **已配置并可用** | `deepseek-flash`、`https://api.deepseek.com`、thinking disabled；每日 1 USD 上限。产品服务端账本当前显示已用约 `$0.042859`；评测脚本另行直连产生的当日累计为 `$0.056729`。 |
| Google Calendar | **不可用（未配置）** | 本机无 `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`，真实同步未验证；Google Maps 未接入。 |
| Gmail | **关闭** | `GMAIL_ORDERS_ENABLED` 未开启；在 CASA/数据政策与数据条款完成前保持关闭。 |

## 5. 个人内测操作清单

1. 打开 `http://127.0.0.1:8787/`，确认 Today 地图与左侧/底部工作面板同屏。
2. 用自然语言录入一条今天或明天的安排，确认预览中的日期、开始、结束、地点与条数。
3. 录入一条跨午夜安排（如 11 月 28 日 22:00 至 11 月 29 日 01:00），确认只有一条、结束显示“次日”。
4. 打开 Trips，查看跨城归组、订单与路线建议。
5. 打开 History，切换城市/月份筛选，确认订单状态与“计划行程，不表示实际到访”。
6. 打开 Copilot，询问“今天还有哪些安排？”或“当前出行的通勤风险？”，确认提案需要手动确认。
7. 删除一个地点或日程，确认提示“30 天内可恢复”，在“最近删除”中恢复，再测试永久删除。
8. Android 手机按第 3 节以密码保护方式访问，检查底部抽屉、时间线滚动、Copilot 输入框和地图拖动缩放。
9. 记录任何阻断问题：页面、操作、预期、实际、截图；不要记录密钥或完整私人日历内容。

## 6. 已知限制

- Google Calendar/Gmail 真实旅程不可用；无法用 Demo 或合成数据替代正式验收。
- Safari 与实体 iPhone/Android 尚未完成正式验收；本轮移动端仅做响应式模拟。
- 主动出发提醒、Trip 完整状态机、Gmail 订单真实同步仍待产品裁决/外部条件。
- 账号删除后的备份保留期限、Gmail CASA/数据条款未确认。
- 本机单实例：AI 预算账本、提案缓存与账户文件不适合多实例共享。

## 7. 停止状态

Development frozen。等待产品负责人实际体验与裁决；不新增功能、不重构、不部署、不进入 M6。推送、CI 与内测准备完成后停止。
