# Wayline M5 发布阻断项收口报告 — RC.5 Private Beta

日期：2026-11-25  
仓库：NextVariable/wayline  
分支：`feat/ai-native-mvp`  
版本：`1.0.0-rc.5`  
收口提交：`{{SHA}}`  
结论：**工程侧可处理阻断项已完成；RC.5 可进入受限内测准备。Google 真实联调、实体设备与 G0/R02–R05 仍阻断正式 V1.0。**

本轮未进入 M6，未修改 `main`，未合并 PR #9，未删除历史分支，未创建 Release/Tag，未执行真实部署。

## 1. 本轮实际代码变更

| 范围 | 变更 | 文件 |
| --- | --- | --- |
| 跨午夜 | 明确 `endDate`、次日推断提示、跨日拒绝拆分、预览/持久化/提案链路 | `server/ai/schemas.mjs`、`src/lib/smartIntake.ts`、`src/components/ScheduleAssistant.tsx`、`src/App.tsx`（上一提交 `9f31ed5`） |
| 来源同步 | 字段级覆盖、来源差异提示、迟到旧版本保护、来源墓碑、用户删除抑制、跨重连抑制 | `src/lib/googleCalendarSync.ts`、`src/lib/calendarEvents.ts`、`src/lib/useGoogleCalendar.ts`、`src/components/ScheduleAgenda.tsx` |
| 服务端墓碑 | 取消与全量窗口消失事件保留 90 天墓碑并随状态返回；全量失败仍保留旧快照 | `server/google-calendar.mjs`、`src/tests/googleCalendarServer.test.ts` |
| History | 复用 Trips 时间线与订单行；补齐铁路/航班/住宿订单、确认/变更/取消状态、城市与月份筛选、来源已删除标识 | `src/components/HistoryPanel.tsx`、`src/components/TripBookingRow.tsx`、`src/components/BusinessTripsPanel.tsx`、`src/lib/tripIntelligence.ts` |
| 数据生命周期 | 30 天最近删除、恢复、单条永久删除、清空、到期清理；账号永久删除并停止同步/清理凭证/工作区/订单/会话/AI 计数 | `src/lib/deletion.ts`、`src/components/AuthPanel.tsx`、`server/accounts.mjs`、`server/index.mjs`、`server/ai/proposals.mjs`、`server/ai/budget.mjs` |
| 备份 | 最近删除纳入工作区备份与校验 | `src/lib/workspaceBackup.ts` |
| 发布配置 | DeepSeek/AI/高德/单实例环境变量示例；版本号 rc.5 | `deploy/rc.env.example`、`package.json` |
| 文档 | 阶段范围裁决、G0/R02–R05 表、README 范围声明 | `docs/m5-scope-and-decisions.md`、`README.md` |
| 评测脚本 | 支持逗号分隔类别并逐样本使用独立 owner，避免单账号每日调用上限影响 | `scripts/m5-ai-eval.mjs` |

自动化验证：`tsc --noEmit` 通过；`npm run lint` 0 警告；`vitest` **100 文件 / 876 测试通过**；`npm run build` 通过；`node scripts/rc-preflight.mjs` PASS。

## 2. 八个发布阻断项状态

| # | 阻断项 | 状态 | 证据与剩余 |
| --- | --- | --- | --- |
| 1 | PRD 未冻结、G0 未批准、R02–R05 未裁决 | **OWNER DECISION** | 已整理范围裁决与 R02–R05 推荐方案；未自行批准。见第 13 节。 |
| 2 | 真实 Google Calendar/Gmail 未验证 | **EXTERNAL BLOCKED** | 环境无 `GOOGLE_CLIENT_ID/SECRET`；OAuth/进度代码与合成测试通过；Gmail 保持关闭。 |
| 3 | 实体 iPhone/Android 未验证 | **EXTERNAL BLOCKED** | 无实体设备；提供产品负责人可执行清单，未把模拟视口称为真机通过。 |
| 4 | History 未展示订单（AC17） | **CLOSED** | History 复用 Trips 订单行，展示状态/时间/地点/来源/筛选；合成数据测试通过。真实 Gmail 订单仍随 #2 阻断。 |
| 5 | 跨午夜结束时间不支持（AC24） | **CLOSED** | 端到端支持显式次日结束；10/10 目标样本通过；全量复评见第 4 节。 |
| 6 | 来源删除/字段级覆盖未实现（AC06/AC07） | **CLOSED** | 墓碑、迟到旧版本、字段覆盖、差异提示、用户删除抑制、跨重连抑制均有测试。真实 Google 供应商行为仍随 #2。 |
| 7 | 永久删除与 30 天恢复缺失（AC18） | **CLOSED** | 本地最近删除 30 天、到期清理、立即永久删除；账号永久删除停止同步并清理凭证/工作区/订单/会话。 |
| 8 | 生产监控/告警、Gmail CASA、数据条款、部署 AI 变量 | **OPEN**（含 EXTERNAL 子项） | 已补 AI/高德/单实例环境变量与单实例约束；**外部 uptime/错误/预算/配额告警尚未接入**；Gmail CASA 与 DeepSeek/Google 数据条款仍需外部审核与法务确认。 |

## 3. 验收矩阵增量

未列出的行沿用 `docs/M5-final-acceptance.md` 结论。状态：真实 / 合成 / 部分 / 未验证。

### F01–F17

| ID | 本轮结论 | 变化与证据 |
| --- | --- | --- |
| F01 | 未验证（实现存在） | 无 OAuth 凭据；登录/重连代码未改。 |
| F02 | 合成验证（增强） | 新增来源墓碑、全量窗口消失标记、重连保留；真实 API 未跑。 |
| F03 | 未验证（阻断） | Gmail 仍关闭；订单行已可在 History 渲染。 |
| F04 | 真实验证（增强） | 跨午夜支持；全量复评见第 4 节。 |
| F05 | 部分 | ICS 幂等与原有测试保持通过。 |
| F06 | 合成验证 | 未改归组规则。 |
| F07 | 真实（桌面） | Chrome 桌面 Today 通过；移动端为模拟。 |
| F08 | 部分（增强） | Trips/History 共用订单行；真实 Gmail 未验证。 |
| F09 | 真实（桌面） | 地图与面板同屏、无遮挡。 |
| F10 | 真实 | 高德真实返回：步行 241 分钟/18.0km，驾车 28 分钟/21.8km，公交 58 分钟/19.7km。 |
| F11 | 合成 | 未改。 |
| F12 | 部分 | 未新增提醒通道。 |
| F13 | 真实（历史证据） | 未改 Copilot 主体。 |
| F14 | **通过（合成）** | 订单、状态、筛选、来源删除标识；明确“不代表实际到访”。 |
| F15 | 真实 | Demo 隔离未改。 |
| F16 | **通过（本地/合成）** | 30 天恢复、永久删除、账号删除后端；真实 Google 账号删除随凭据阻断。 |
| F17 | 部分 | 未改。 |

### AC01–AC24（仅变化项）

| AC | 本轮结论 |
| --- | --- |
| AC06 本地覆盖/来源更新/迟到旧版本 | **通过（合成）**：字段覆盖、差异提示、旧版本丢弃、幂等合并。 |
| AC07 来源删除后不复活 | **通过（合成）**：来源墓碑 90 天；用户删除按来源键抑制，跨重连不复活。 |
| AC14 AI 提案确认/来源失效 | 通过（沿用）+ 来源字段变更后提案仍以确认时版本校验。 |
| AC17 History 计划/订单/状态 | **通过（合成）**：订单行复用 Trips；筛选、状态、`来源已删除` 标记。 |
| AC18 断开/导出/恢复/删除/30 天 | **通过（本地/合成）**：30 天最近删除、立即永久删除、账号删除清理。 |
| AC22 Desktop/Safari/iPhone/Android | **部分**：Chrome 桌面通过；移动端仅 CSS 模拟；Safari 与真机未执行。 |
| AC24 枢纽缓冲/跨午夜/线上会议 | **通过（跨午夜）**；线上会议仍为既有实现，未新增逐项真机验证。 |

## 4. 跨午夜修复与评测

修复链路：DeepSeek 输出 → Schema `endDate` 校验 → 时间标准化 → 预览“结束（次日）/跨日” → 持久化 → Today/Trips/History 时间线 → 地图与 Smart Routes → Copilot。

- 明确次日结束：接受并保留 `endDate`，不拆分。
- 仅给跨午夜时间：推断 +1 天并提示“已按次日处理，请确认”。
- 超过 1 天：拒绝并标记待确认，不猜测结束日期。
- 中国大陆出行按 `Asia/Shanghai` 展示；外部日历保留原始时区字段。

评测：
- 原失败样本定向重跑：**10/10** 日期/开始/结束/结束日期/地点/标题/条数正确（`docs/m5-ai-crossmidnight.json`）。
- 全量 100 条复评：**100/100 条、130/130 项通过**。日期/开始/结束/地点/标题均 130/130（100%），结束日期 10/10，条数 100/100（100%）；所有 7 个类别均为 100%。证据：`docs/m5-ai-eval-rc5.json`。

## 5. 来源同步与数据生命周期验证

- 来源与本地分离：Google 事件保留 `google.updated` 原始版本；本地覆盖记录编辑时来源值。
- 字段级覆盖：确认地点的日程在来源地址变化时保留本地地点，显示“来源已更新…保留本地修改”，可“保留本地/使用来源”。
- 迟到旧版本：`google.updated` 更旧的快照不得覆盖缓存。
- 来源删除：取消或全量窗口内消失 → 墓碑，退出 Today/Trips/Smart Routes，History 保留并标“来源已删除”。
- 用户删除：按 `calendarId:eventId` 抑制，重复同步与重连不复活；未提供显式重新导入入口（R02 待裁决）。
- 幂等：重复快照合并相等；ICS 既有去重测试保持通过。
- Google Calendar/Gmail 仍只读，未新增写权限。

数据生命周期：
- 普通删除进入本机最近删除，保留 30 天；到期读取时清理；不进入活动视图、路线与导出之外的活动数据。
- 单条永久删除与清空不可恢复。
- 账号永久删除：先停止 Google 同步并删除日历连接凭证，再删除账号、工作区、Gmail 订单、会话与 AI 提案/计数；本机该账号数据同步移除。
- 导出不包含 access/refresh token、client secret、API Key；日志沿用既有脱敏与路由检查。
- 备份：工作区快照/恢复脚本保留；备份可能含删除前数据，恢复演练须确认不会把已永久删除的账号重新上线。账号删除后备份最长保留 30 天的策略需产品负责人确认（见第 13 节）。

## 6. History 订单验证

- 铁路、航班、住宿订单进入 History 时间线；确认/变更/取消/待核对/时段已过状态可核实。
- 保留时间、地点、来源（日历 / Gmail）与行程关系；复用 Trips 的 `TripBookingRow`。
- 筛选：城市、月份；空结果与空历史有明确文案。
- 历史只表示过去的计划与已知订单，不表示真实到访或轨迹；未恢复 GPS/GPX/足迹功能。

## 7. Google OAuth 环境状态与待配置

环境审计（仅检查存在性，未打印值）：
- `.env.local` 与当前 shell：`GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET` **均未配置**。
- 早期 Wayline 目录未发现已为本项目配置的 Google 凭据；未读取其他项目私人凭证。
- `GMAIL_ORDERS_ENABLED=0`，Gmail 保持关闭。

产品负责人需在 Google Cloud Console 执行：
1. 选择/创建 Wayline 项目；启用 **Google Calendar API**。Gmail API 仅在政策确认后启用。
2. OAuth 同意屏幕：应用名 Wayline、支持邮箱、开发者邮箱、授权域名；外部/内部用户按内测范围选择。
3. 添加 scope：`openid`、`email`、`profile`、`https://www.googleapis.com/auth/calendar.events.readonly`、`https://www.googleapis.com/auth/calendar.calendarlist.readonly`。**暂不添加** `https://www.googleapis.com/auth/gmail.readonly`。
4. 创建 OAuth 客户端（Web application），授权重定向 URI 精确添加：
   - `https://<生产域名>/api/auth/google/callback`
   - `https://<生产域名>/api/calendar/google/callback`
5. 测试用户加入授权测试账号；凭据只写入 Git 外的私有环境文件：`GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`。
6. 真实联调顺序：登录 → Calendar 只读授权 → 全量/增量同步 → 改期 → 取消 → 断开重连 → 账号 A/B 隔离。Gmail 在 CASA/数据条款完成前不开启，也不向 DeepSeek 发送真实邮件内容。

## 8. 中国大陆真实出行验收

高德 Web 服务实测（上海人民广场 → 虹桥火车站）：
- 步行：241 分钟，18,044 米。
- 驾车/打车语义：28 分钟，21,823 米；明确不含等车/停车时间。
- 公交地铁：58 分钟（3,489 秒），19,729 米，真实 `departure`。
- POI：上海“国金中心”返回上海结果；北京同名查询返回北京结果，未跨城误配。
- 路线暂时失败时返回“查询暂时无法完成，请稍后重试”，未编造路线；重试后恢复。
- 已覆盖：同城多安排、跨城归组、铁路/航班/住宿与市内通勤衔接、未来路线参考、失败/过期提示、地图—时间线双向选择（沿用 M4/M5 证据与单测）。
- 未接入 Google Maps 或其他海外地图。

## 9. 桌面与移动端测试证据

- 桌面 Chrome：960×571 视口，Today 地图 + 浮动面板同屏；打开 Copilot 后输入框可达；控制台无错误；无阻塞覆盖层。**PASS**。
- 移动端：浏览器工具不支持真实视口切换，通过注入 `max-width:700px` 样式模拟底部抽屉与 Copilot；地图可见、输入框在视口内、无横向溢出。**仅模拟，不计为真机通过**。
- Safari：本轮未执行自动化验证，**未验证**。
- 实体 iPhone/Android：**EXTERNAL BLOCKED**；产品负责人清单：
  1. iPhone Safari 与 Android Chrome 各打开生产预览地址。
  2. 检查底部抽屉拖拽、时间线滚动、Copilot 展开后输入框不被键盘遮挡。
  3. 地图单指拖动、双指缩放、点选点位与“导航”跳转。
  4. 横竖屏切换后面板不重叠；返回手势不丢失当前行程。
  5. 记录机型、系统版本、浏览器版本与截图。

## 10. AI 实际调用费用

- 供应商/模型：DeepSeek `deepseek-flash`，`https://api.deepseek.com`，thinking disabled。
- 每日全局预算：1 USD；单 owner 40 次/日。
- 本轮 RC.5 复评前累计：**$0.042859**，剩余 **$0.957141**。
- 全量 100 条复评后当日累计：**$0.056729**，剩余 **$0.943271**；本轮增量约 **$0.01387**。未超出 1 USD 上限。
- 未更换模型，未放宽评测标准；跨午夜修复不是通过修改评测口径实现。

## 11. Git、CI 与本地预览

- 分支：`feat/ai-native-mvp`。
- 当前 HEAD：`{{SHA}}`。
- 与 `main` 关系：领先 27+ 提交，`main` 无新提交可回并；未修改 `main`。
- CI：`{{CI}}`
- 本地预览：`http://127.0.0.1:8787/`（单实例本地构建，已重启加载本轮代码）。
- PR #9：仍为 draft，base 为 `codex/v1.0-rc.2`；**未合并、未修改**。建议后续新开 `feat/ai-native-mvp` → `main` 的单一发布 PR。

## 12. RC.5 Private Beta 与正式 V1.0 的剩余差距

RC.5 可做：受限邀请内测，本地/合成数据、真实高德路线、真实 DeepSeek（预算内）、Chrome 桌面与移动模拟。

正式 V1.0 仍需：
1. G0 批准、PRD 冻结、R02–R05/D01–D07 裁决。
2. Google OAuth 真实 Calendar 全链路与账号隔离；Gmail 政策/CASA 与数据条款。
3. 实体 iPhone/Android 与 Safari 验收。
4. 生产外部监控、错误率/预算/配额告警、备份恢复演练。
5. 账号删除后的备份保留与外部供应商数据边界披露。
6. 主动出发提醒（R03）与 Trip 状态机（R04）等待裁决后实现。
7. Gmail 关闭期间，真实订单验证与 AC03/AC08 仍不完整。

## 13. 需要产品负责人正式裁决

1. G0 是否批准及批准版本 SHA-256。
2. R02：墓碑期限、清理策略、是否提供“显式重新导入”。
3. R03：提醒锚点、提前量与是否引入主动通知。
4. R04：Trip 状态机与跨时区归档时区。
5. R05：“已过期”语义与排序。
6. Gmail restricted scope/CASA、数据使用政策与邮件内容是否可入模。
7. 账号删除后的备份保留期限（建议 ≤30 天且不可恢复到在线工作区）。
8. 实体设备验收安排与 Safari 验收负责人。
9. 是否批准 RC.5 受限内测与后续单一发布 PR。

## 14. 停止条件

工程侧可处理事项到此停止。未进入 M6，未增加 PRD 外功能，未做全面架构重写。等待产品负责人确认 RC.5 内测与正式发布方案。
