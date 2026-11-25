# Wayline M5 — Final Product Acceptance & Release Readiness

日期：2026-11-25  
分支：`feat/ai-native-mvp`  
验收基线：`b83231b4f25e053332e11449e21d32cd06a4e132`  
结论：**NO-GO — 不满足正式发布条件，等待产品负责人裁决与授权**

## 1. 结论摘要

M1–M4 的本地核心旅程、真实高德路线、真实 DeepSeek 调用、演示隔离、ICS 导入与备份导出已验证。但本轮不能宣布 V1.0 通过，原因不是单个 UI 缺陷，而是冻结与外部验证条件未满足：

1. PRD 仍是**未冻结评审稿**，G0 未批准；独立审查 R02–R05 未裁决（见 Obsidian 项目索引与审查原文）。
2. 本机没有 Google OAuth 凭据，真实 Google Calendar/Gmail 旅程**未验证**；不得用 Demo 或 mock 冒充。
3. 没有连接实体手机，AC22 的 iPhone/Android 真机验收**未执行**；桌面 Chrome 结果不能替代。
4. History 未展示已订订单；跨午夜区间无法表达；来源删除/字段级覆盖未实现。
5. 账号永久删除与 30 天恢复缺失；生产监控、告警、Gmail 验证与 DeepSeek/Google 数据条款未闭环。

因此本轮只完成验收取证、有限安全修复和发布方案，不合并、不部署、不创建 Release。

## 2. F01–F17 验收矩阵

状态说明：真实验证 / 合成验证 / 部分实现 / 未实现 / 未验证（缺凭证或设备）。

| ID | 功能 | 状态 | 证据与差距 |
| --- | --- | --- | --- |
| F01 | Google 登录、只读授权、重连 | 未验证（实现存在） | `server/accounts.mjs` 支持 OAuth/PKCE/scope 校验；本机无 `GOOGLE_CLIENT_ID/SECRET` |
| F02 | Calendar 增量同步、去重、改期/取消、来源状态 | 未验证（实现存在） | `server/google-calendar.mjs`、`calendarEvents.ts`；真实 API 未跑；来源删除无墓碑 |
| F03 | Gmail 订单确认/变更/取消 | 未验证（阻断） | `gmail-rail-orders.mjs` 需 `GMAIL_ORDERS_ENABLED=1` 与 Google 凭据；策略未确认 |
| F04 | 自然语言智能录入 | 真实验证 | 100 条评测 + 真实 UI；跨午夜为已知缺口 |
| F05 | 手动 CRUD + ICS 导入 | 部分实现 | ICS 用合成文件真实验证去重/全天/外部时区；手动 CRUD 仅测试覆盖 |
| F06 | 出行归组/手动拆分/合并/撤销 | 合成验证 | `businessTrips.ts` + 既有单测；未跑真实多城日历 |
| F07 | Today 固定布局、日期切换、下一站、风险 | 真实验证（桌面） | M3/M4/M5 截图；实体手机未验证 |
| F08 | Trips 当前/未来、订单、单日/全地图 | 部分实现 | 页面存在；订单依赖 Gmail，未验证 |
| F09 | 地图—时间线双向选择、缺失地点、路段详情 | 真实验证（桌面） | M4/M5 截图；真机未验证 |
| F10 | 四种交通方式与时长 | 真实验证 | 高德真实路线：公交 46、驾车 27、步行 114 分钟 |
| F11 | 可行性/余量/风险判断 | 合成验证 | `smartRoutes.test`；UI 路段建议已验证 |
| F12 | 嵌入式行动项/洞察闭环 | 部分实现 | 冲突提醒 +「解释」真实调用；稍后/忽略/自动解决未完整验证 |
| F13 | 上下文 Copilot | 真实验证 | 当前行程、路线工具、提案确认；跨出行清理未验证 |
| F14 | History 列表/筛选/详情 | 部分实现 | 过去行程可回看；**未展示已订订单**，无筛选 |
| F15 | Demo 工作区 | 真实验证 | 横幅声明合成数据；网络仅 status，无付费 AI/路线调用 |
| F16 | 账号隔离、断开、删除、导出/恢复 | 部分实现 | 导出无 token；恢复代码存在；**无永久删除/30 天恢复** |
| F17 | 地点搜索、纠错、收藏、别名 | 部分实现 | 高德搜索真实返回；别名/收藏未验证 |

## 3. AC01–AC24 验收矩阵

| AC | 结论 | 说明 |
| --- | --- | --- |
| AC01 Demo/登录隔离、零付费 | 部分 | Demo 合成与零付费已验证；真实登录不可用 |
| AC02 Google Calendar 真实增量 | 未验证 | 无 OAuth 凭据 |
| AC03 Gmail 订单三类模板 | 未验证/阻断 | 无凭据、无策略授权 |
| AC04 智能录入多安排/缺失/同名/重复确认 | 通过（本地） | 100 条评测；重复确认已拦截 |
| AC05 ICS 重复/全天/时区/异常 | 通过（合成） | 4 条输入去重为 3 条；全天保留；纽约时区转上海时间 |
| AC06 本地覆盖/来源更新/迟到旧版本 | 未实现/未验证 | 无字段级覆盖与差异展示 |
| AC07 来源删除后不复活 | 未实现 | 无删除墓碑/抑制键 |
| AC08 Gmail 冲突订单 | 未验证 | 依赖 AC03 |
| AC09 自动归组/拆分/合并 | 合成验证 | 单测覆盖，真实数据未跑 |
| AC10 Today 地图双向/缺失地点/并行冲突 | 通过（桌面） | 真机未验证 |
| AC11 四模式/地点/打车等车语义 | 通过（桌面） | 驾车明确标注“不含等车/停车时间” |
| AC12 可行性阈值/缓冲/出发建议 | 合成验证 | 枢纽缓冲已实现并测试；真实全链路未跑 |
| AC13 参考路线/未来出发/过期响应 | 部分 | 公交查询传真实 departure；未来参考标识未逐项验证 |
| AC14 AI 提案/确认/来源失效 | 通过（本地） | 一次性确认、重复拒绝、baseVersion 过期拦截 |
| AC15 嵌入式提醒闭环 | 部分 | 冲突解释真实；稍后/忽略/自动解决未完整验收 |
| AC16 Copilot 边界/跨出行清理 | 部分 | 非通用聊天；跨出行清理未验证 |
| AC17 History 计划/实际/订单状态 | 部分 | 计划可回看；订单未展示；不宣称实际足迹 |
| AC18 断开/删除/导出/恢复/30 天 | 部分 | 导出无凭证；永久删除与恢复期缺失 |
| AC19 账号隔离/AI 日志/撤销授权 | 合成验证 | AI owner 隔离与提案隔离通过；真实 Google A/B 未跑 |
| AC20 预算/限速/网络/地图失败 | 通过（部分） | 预算与 401/429 已验证；地图 429 表单保留未逐项验证 |
| AC21 地点别名/收藏/地址纠错 | 部分 | 搜索可用；别名/收藏未验证 |
| AC22 Desktop/Safari/iPhone/Android | 失败（未执行） | 无实体设备；仅桌面 Chrome |
| AC23 AI 非目标与权限边界 | 通过（合成） | 30/30 安全样本；另 1 条真实注入样本 |
| AC24 枢纽缓冲/跨午夜/线上会议 | 部分/失败 | 枢纽缓冲存在；**跨午夜 endDate 不支持**；线上会议未逐项 |

## 4. 真实产品旅程证据

### 4.1 已执行（桌面 Chrome + 真实高德 + 真实 DeepSeek）

- 智能录入：多条中文安排、相对日期、起止时间、同名地点、缺失字段、确认保存。
- Today：保存后地图点位、连续时间线、18/30 分钟路段与“21:20 前出发”建议。
- Copilot：当前行程问答、`get_schedule`、`assess_commute`、`query_route`、提案预览与确认。
- 提案持久化：11/25 22:00 → 11/26 10:00；重复确认按钮禁用，服务端 `already_confirmed`。
- 嵌入式：时间重叠 60 分钟 +「解释」，模型解释与 Smart Routes 判断一致。
- 安全：未授权取消订单/写 Google Calendar 被拒绝；预算上限在调用前拒绝。
- ICS：重复 UID 去重、全天事件、`America/New_York` 转上海时间。
- History：过去两天的行程可回看；**未展示订单**。
- Demo：明确“全部为合成数据”，无 Google/Gmail/地图供应商连接，无付费 AI 调用。
- 备份：导出 1,710 bytes，未包含 token/secret/API Key。

截图：`/Users/francis/Desktop/whereto/m5-acceptance-shots` 与 M4 的 `m4-live-acceptance-shots`。

### 4.2 未执行（阻断）

- 真实 Google Calendar 授权、增量同步、改期/取消、重连。
- 真实 Gmail 铁路/航班/酒店订单确认、变更、取消。
- iPhone/Android 实体手机。
- Google OAuth 生产验证、Gmail restricted scope/CASA、原生邮件内容入模。

## 5. AI 正式评测报告

### 5.1 智能录入（真实 DeepSeek，100 条合成/脱敏样本）

| 字段 | 正确/总数 | 准确率 |
| --- | --- | --- |
| 日期 | 130/130 | 100% |
| 开始时间 | 130/130 | 100% |
| 结束时间 | 120/130 | 92.3% |
| 地点 | 130/130 | 100% |
| 活动名称 | 130/130 | 100% |
| 条数 | 94/100 | 94% |

分类：绝对日期、相对日期、口语时间、同名地点、缺失字段、复杂多安排均为 100%；**跨午夜 0/10 结束时间正确**，6/10 被拆成多条。剔除跨午夜后结束时间 120/120。结论：跨午夜是明确的产品缺口，不是模型随机误差。

### 5.2 安全样本（30 条，合成）

- Prompt Injection：10/10 被标记，未执行。
- 工具权限：10/10 被拒绝（未注册工具、未知地点、非法模式、外部来源更新、缺失目标、缺失时间、非上下文通勤、短查询、错误任务）。
- 提案生命周期：10/10（一次性、重复、越权、过期、payload 变化、未知 ID、并发、缺失版本、账号隔离）。

本轮修复了两个真实安全缺陷：
1. 提案确认省略 `baseVersion` 时可绕过过期校验；已改为必须匹配。
2. 注入扫描覆盖过窄（原 3/10）；已扩展到日历写入、Gmail、订单取消、Shell、数据库、管理员、其他账号、密钥等意图。

### 5.3 用量与费用

当日累计：**111,399 tokens**（输入 99,242 / 输出 12,157），**$0.032895**，160 次调用，剩余 **$0.967105**。未超出 1 USD。

证据：`docs/m5-ai-eval.json`、`docs/m5-ai-safety.json`、`docs/m4-ai-live-report.json`。

## 6. Task 4 遗留核对

| 项目 | 结论 |
| --- | --- |
| History 已订订单 | **缺失**；History 只有计划，没有订单卡片/状态 |
| 打车等车时间/参考语义 | 通过；驾车标注不含等车/停车，打车不承诺等车 |
| 日期/时区一致性 | 部分；统一 Asia/Shanghai，外部时区可转换；跨午夜结束日期缺失 |
| 枢纽缓冲/确认状态 | 通过（代码+测试）；机场/铁路缓冲，未确认时标待确认 |
| 来源删除/同步/本地覆盖 | **未实现**；无墓碑、字段级覆盖、迟到旧版本显示 |
| AI 提案持久化/重复/隔离 | 重复与隔离通过；待确认提案在内存，重启丢失，已确认修改持久化 |
| 隐私/导出/删除/恢复 | 导出通过且无 token；恢复代码存在；永久删除与 30 天恢复缺失 |

## 7. 生产发布方案（建议，不执行）

现有资产：`Dockerfile`、`deploy/compose.rc.yml`、`deploy/nginx.rc.conf.example`、`deploy/rc.env.example`、`/healthz`。

建议步骤：

1. **主机与 TLS**：单台 Linux + Docker Compose；Nginx 443/HSTS，80 跳转；仅绑定 `127.0.0.1:8787`。
2. **私有环境文件**：在 Git 外创建 `wayline-rc.env`，至少包含 `PUBLIC_ORIGIN`、`GOOGLE_CLIENT_ID/SECRET`、`GMAIL_ORDERS_ENABLED`、`AMAP_WEB_SERVICE_KEY`、`DEEPSEEK_API_KEY`、`DEEPSEEK_MODEL=deepseek-flash`、`AI_DAILY_BUDGET_USD`、`AI_BUDGET_ACKNOWLEDGED`、`AI_DISABLED`、`AI_USAGE_FILE`。现有 `rc.env.example` 缺少 DeepSeek/AI 项，需补齐。
3. **Google OAuth**：授权回调固定为 `https://<host>/api/auth/google/callback` 与 `https://<host>/api/calendar/google/callback`；Calendar 只读；Gmail 只读单独授权；生产 OAuth 验证、隐私政策、服务条款、测试用户。
4. **Gmail**：在 Google restricted scope/CASA 与 DeepSeek 数据处理条款确认前保持 `GMAIL_ORDERS_ENABLED=0`；不发送原始邮件到模型。
5. **高德/Tianditu**：Web 服务 Key 仅服务端；JS Key 绑定生产域名；配置配额告警。
6. **密钥与日志**：Docker secret/系统环境注入；确保日志不记录 `Authorization`、OAuth code、`tk`、`sk-`；Nginx 仅记录 `$uri`。
7. **预算与限速**：保留 AI 账本挂载卷；设置每日预算、单任务 Token、轮次、超时、每分钟限速；`AI_DISABLED=1` 作为熔断。
8. **监控与回滚**：外部 uptime 检查 `/healthz`；错误率/OAuth 失败/高德配额/AI 预算告警；镜像按 tag 回滚，`.wayline-private` 快照恢复演练。
9. **数据**：账户删除与 30 天恢复任务补齐后再开放真实账号；备份加密、最小权限。

## 8. GitHub 合并与版本建议（不执行）

- `origin/main` = `62fec0f`，不包含 RC.2/RC.4/M1–M4。
- PR #9 是 **draft**，base 为 `codex/v1.0-rc.2`，head 为 RC.4 `591724e`；它不是 main 的发布路径。
- 当前 `feat/ai-native-mvp` 已包含 RC.4 与 M1–M4（`b83231b`）。
- 建议：**不要合并 PR #9**；待 P0 阻断关闭后，新开一个 `feat/ai-native-mvp` → `main` 的单一发布 PR（包含 RC.4+M1–M4），PR #9 由负责人决定关闭或保留为历史。
- 版本：当前 `1.0.0-rc.4`；修复阻断后先发 `1.0.0-rc.5` 内测，G0 冻结与 P0 全过后再发 `1.0.0`。
- README 更新建议：M4 AI harness/预算/权限矩阵、DeepSeek 环境变量、Google/Gmail scope、Demo 隔离、已知限制（跨午夜/订单/真机）、M5 验收状态。
- 发布清单：PRD 冻结与 G0 签字 → P0 全过 → 真机与 Google/Gmail 真实验收 → 安全/隐私评审 → 生产演练 → 合并 → 部署 → 监控观察。

## 9. 发布阻断项

1. PRD 未冻结、G0 未批准，R02–R05 未裁决。
2. 真实 Google Calendar/Gmail 未验证（无凭据、无 Gmail 政策授权）。
3. 实体手机未验证（AC22）。
4. History 未展示订单（AC17）。
5. 跨午夜结束时间不支持，结束时间准确率 92.3% < 95%（AC24）。
6. 来源删除/字段级覆盖未实现（AC06/AC07）。
7. 永久删除与 30 天恢复缺失（AC18）。
8. 生产监控/告警、Gmail 验证/CASA、DeepSeek/Google 数据条款、部署环境 AI 变量未闭环。

## 10. 验证命令与结果

- `npx tsc --noEmit`：通过
- `npm run lint`：通过（0 warnings）
- `npx vitest run`：98 文件 / 857 测试通过
- `npm run build`：通过
- `node scripts/rc-preflight.mjs`：PASS
- 真实模型：`scripts/ai-live-check.mjs`、`scripts/m5-ai-eval.mjs`、`scripts/m5-ai-safety.mjs`

本轮未新增产品功能，未进入 M6，未部署，未修改 main，未合并 PR #9，未创建 Release。
