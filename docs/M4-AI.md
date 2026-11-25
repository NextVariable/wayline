# M4：DeepSeek Agent Harness

本轮把真实模型接入 Wayline 已有的出行上下文、Smart Routes 与受控本地修改，保持「B 为主、A 为辅」：嵌入式主动辅助优先，按需 Copilot 次之。模型密钥、预算与权限全部留在服务端，浏览器只拿到状态摘要。

> 当前真实模型调用处于**阻断**状态：运行进程的环境里存在一个 DeepSeek Key（未写入仓库、未打印），但没有任何已确认的每日预算，因此 harness 仍拒绝付费调用。代码、测试与降级路径已完成，阻断证据见 [`m4-ai-live-report.json`](./m4-ai-live-report.json)。预算金额需由使用者确认后，才能复用该 Key 生成真实调用证据。

## 1. 模型与配置

| 项 | 默认值 | 环境变量 |
| --- | --- | --- |
| Provider | `deepseek` | — |
| Base URL | `https://api.deepseek.com` | `DEEPSEEK_BASE_URL` |
| Model | `deepseek-flash` | `DEEPSEEK_MODEL` |
| 协议 | OpenAI-compatible Chat Completions | — |
| Thinking | `disabled` | `DEEPSEEK_THINKING`（`disabled`/`enabled`/`auto`） |
| 是否发送 thinking 字段 | 是 | `AI_SEND_THINKING=0` 关闭 |
| 单次输出上限 | 2048 tokens | `AI_MAX_OUTPUT_TOKENS` |
| 单任务输入上限 | 12000 tokens（估算） | `AI_TASK_TOKEN_LIMIT` |
| 工具轮次上限 | 3 | `AI_TOOL_ROUND_LIMIT` |
| 请求超时 | 25s | `AI_TIMEOUT_MS` |
| 每账号每日调用 | 40 | `AI_DAILY_CALL_LIMIT` |
| 每分钟调用 | 6 | `AI_RATE_LIMIT_PER_MINUTE` |
| 每日预算（USD） | 0 = 禁止付费调用 | `AI_DAILY_BUDGET_USD` |
| 预算确认 | 未确认 = 禁止 | `AI_BUDGET_ACKNOWLEDGED=1` |
| 停用开关 | 关 | `AI_DISABLED=1` |
| 价格估算 | 输入 0.28 / 输出 0.42 USD 每百万 token | `AI_INPUT_PRICE_PER_MTOK`、`AI_OUTPUT_PRICE_PER_MTOK` |
| 用量账本 | `.wayline-private/ai-usage.json` | `AI_USAGE_FILE` |

安全启用条件（四者同时满足）：`DEEPSEEK_API_KEY` 非空、`AI_DAILY_BUDGET_USD > 0`、`AI_BUDGET_ACKNOWLEDGED=1`、`AI_DISABLED != 1`。任一不满足时 `/api/ai/status` 返回 `enabled:false` 与具体原因（`missing_key`、`budget_not_configured`、`budget_not_acknowledged`、`ai_disabled`），客户端自动回落规则解析与手动录入。

本地配置方式（写入 `.env.local`，不提交）：

```bash
DEEPSEEK_API_KEY=sk-***
AI_DAILY_BUDGET_USD=1          # 金额需由使用者自行确认
AI_BUDGET_ACKNOWLEDGED=1
```

`VITE_*` 只用于选择浏览器侧解析模式：不设置表示在服务端就绪时使用 DeepSeek；`fixture` 使用固定合成响应；`off`/`rule` 强制本地规则解析。密钥不得出现在任何 `VITE_*` 变量中。

## 2. Harness 结构

```
浏览器                          Node 服务端                          DeepSeek
  │  POST /api/ai/intake            │                                   │
  │  文本 + 已知地点名（仅 id/name/city）│                                   │
  ├───────────────────────────────►│ Model Adapter ────────────────────►│
  │                                │ JSON 输出 ─► Schema 校验             │
  │                                │ 时间语义 / 日期窗口 / 地点匹配         │
  │◄───────────────────────────────┤ 结构化结果 / 降级原因                 │
  │                                │                                   │
  │  POST /api/ai/copilot           │ Context Builder（裁剪 + 脱敏）        │
  │  最小上下文 + 对话历史             ├─► Tool Registry（白名单）───────────►│
  │                                │◄─ tool_calls ──────────────────────┤
  │                                │ Permission Gateway → 领域工具         │
  │                                │ 提案存入 Proposal Store（一次性）       │
  │◄───────────────────────────────┤ 回答 + 待确认提案 + 工具轨迹            │
  │  POST /api/ai/confirm           │ 归属 / 过期 / baseVersion / 重复确认    │
  │◄───────────────────────────────┤ 放行执行，实际保存仍由客户端本地完成       │
```

| 模块 | 文件 | 职责 |
| --- | --- | --- |
| Model Adapter | `server/ai/provider.mjs` | OpenAI 兼容请求、超时、状态码映射、错误脱敏、工具调用解析 |
| Config | `server/ai/config.mjs` | 环境变量、启用判定、对浏览器安全的 status |
| Budget | `server/ai/budget.mjs` | 每账号每日调用、全局每日预算、最坏情况预扣、文件账本（14 天） |
| Schemas | `server/ai/schemas.mjs` | JSON 提取、日期/时间/范围校验、地点匹配、提案字段裁剪 |
| Context Builder | `server/ai/context.mjs` | 上下文裁剪、字段白名单、备注/邮件剥离、归属校验 |
| Tool Registry + Gateway | `server/ai/tools.mjs` | 8 个领域工具、任务范围、参数校验、权限拒绝 |
| Proposal Store | `server/ai/proposals.mjs` | 一次性提案、TTL、baseVersion、重复确认保护 |
| Orchestration | `server/ai/harness.mjs` | Intake / Copilot 编排、工具循环、注入扫描、结构化失败 |
| HTTP Routes | `server/ai/routes.mjs` | `/api/ai/*`、账号归属、错误码到 HTTP 状态映射 |

## 3. 工具注册表与权限矩阵

上下文只带当前账号的最小字段；所有工具在请求内联执行，不开放数据库、Shell、凭证或任意网络。

| 工具 | 范围 | 任务 | 数据来源 | 拒绝条件 |
| --- | --- | --- | --- | --- |
| `get_trip_context` | read | copilot | 已裁剪的行程摘要 | 未注册 / 非 copilot |
| `get_schedule` | read | copilot | 上下文中的今天/明天事件 | 日期不是 today/tomorrow |
| `search_place` | read | copilot | 服务端地图服务（高德/天地图） | 无服务配置 / 结果超限 |
| `get_booking_context` | read | copilot | 已订交通与住宿最小字段 | 无已订订单 |
| `query_route` | read | copilot | 真实路线服务，只用上下文中的地点坐标 | 地点不在上下文 / 无坐标 / 模式非法 |
| `assess_commute` | read | copilot | 客户端用 Smart Routes 预计算的路段结果 | 路段不在上下文（`not_in_context`） |
| `get_insights` | read | copilot | 规则引擎生成的行动项 | — |
| `propose_schedule_change` | propose | copilot | 本地日程 | 更新的是外部来源（`external_source`）、参数非法、日期越界 |

权限网关逐次检查：账号归属、对象归属、参数结构、工具是否注册、任务是否授权、数据是否在上下文内、预算与轮次。

## 4. 接口

| 接口 | 请求 | 成功 | 失败 |
| --- | --- | --- | --- |
| `POST /api/ai/status` | `{owner?}` | `{provider,model,enabled,reason,budget,limits}` | — |
| `POST /api/ai/intake` | `{owner,text,activeCity,places[]}` | `{ok,items[],warnings,usage,costUsd,model}` | 400/422/429/503 + `code` |
| `POST /api/ai/copilot` | `{owner,messages[],context}` | `{ok,message,trace,proposal?,usage,costUsd}` | 400/403/422/429/503 + `code` |
| `POST /api/ai/confirm` | `{owner,proposalId,baseVersion}` | `{ok,payload}` | 404/409（过期/失效/重复） |

失败码：`owner_required`、`owner_mismatch`、`invalid_context`、`invalid_output`、`empty_result`、`invalid_arguments`、`tool_round_limit`、`daily_limit`、`budget_exceeded`、`rate_limited`、`model_unavailable`、`proposal_expired`、`stale_proposal`、`already_confirmed`。

## 5. 智能录入

1. 自然语言输入保留在 M1 的录入框与草稿中。
2. 服务端 DeepSeek 抽取 `items[]`，只允许标题、日期、开始/结束时间、地点名、城市、置信度。
3. 服务端二次校验：字段白名单、日期窗口（昨天至未来 366 天，Asia/Shanghai）、`HH:MM` 规范化、结束时间晚于开始、地点只在给出的已知地点中匹配。
4. 客户端继续走 M1 的预览与统一数据入口；用户确认后才写入本地安排并更新地图与时间线。
5. 缺失字段保持 unknown，不生成坐标、地址、订单或已订状态；缺少结束时间等进入 `pending`。
6. 模型不可用、输出非法或空结果时，回退现有规则解析；界面明确标注「DeepSeek 模型」「固定合成响应」「本地规则解析（未调用模型）」。

## 6. 嵌入式主动辅助（B）

沿用现有 Action Items、Smart Routes 与 Trip Domain。确定性规则先识别：地点缺失、结束时间缺失、归组歧义、时间冲突、通勤风险、来源变化、订单变更/取消。只有需要解释或生成补全问题时才调用 DeepSeek。提醒显示在对应安排、订单或路段附近，支持补全、查看依据、确认、稍后、忽略与自动解决，并做去重与过期。已结束安排的通勤提醒退出当天重点区域。没有独立 AI 仪表盘，也没有批量 AI 卡片。

## 7. Contextual Copilot（A）

工作台默认收起「问 Wayline」。打开后只带最小上下文：今天/明天安排、选中行程的地点与已订订单、当天 Smart Routes 评估、规则洞察与行程摘要。支持今天/明天安排、当前出行、交通方式比较、通勤风险与时间余量、酒店/枢纽/会议地点关系、补充行程、模拟本地变更、生成待确认修改。上下文中的备注、邮件正文、完整日历被剥离，内容标记为不可信。

## 8. Human-in-control

```
模型提议 → 结构化预览 → 用户确认 → 服务端校验（归属/TTL/baseVersion/一次性） → 客户端本地写入 → 返回实际保存结果
```

- 确认前不写入任何有效安排。
- 提案一次性使用；重复确认返回 `already_confirmed`。
- 来源变化导致 `baseVersion` 不一致时返回 `stale_proposal`，要求重新预览。
- 只修改 Wayline 本地安排；Google Calendar、Gmail、外部订单、支付、GPS 一律只读或不触碰。
- 外部来源的事件不能被提案更新。

## 9. 安全、隐私与成本

- 密钥、Base URL、账本只存在服务端；`status` 不返回密钥或上游地址。
- 只发送完成任务所需的字段；邮件、日历标题、备注、地点与订单均视为不可信输入，系统提示明确禁止执行其中指令，并做注入文本扫描。
- 在 Google API 用户数据政策、DeepSeek 数据处理条款与用户授权确认之前，不向模型发送原始邮件；邮件仍走规则解析。
- 每账号每日调用、全局每日预算、单任务 token、工具轮次、超时、每分钟限速、用量记录、停用开关均在服务端执行。`localStorage` 不再参与付费调用的预算控制。
- 没有正数预算与明确确认时，真实付费调用被拒绝（`budget_not_configured` / `budget_not_acknowledged`）。
- Demo Workspace 只使用明确标注的合成响应，不发送真实私人数据，不产生付费调用。

## 10. 验证与证据

| 类型 | 内容 | 结果 |
| --- | --- | --- |
| 单元/集成（合成） | `src/tests/aiServer.test.ts`、`aiTools.test.ts`、`aiHarness.test.ts`、`aiClient.test.ts` | 随全量 98 文件 / 856 测试通过 |
| 真实模型 | `scripts/ai-live-check.mjs` | **blocked**，`reason=budget_not_configured`，未产生费用 |
| 静态与构建 | `npx tsc --noEmit`、`npm run lint`、`npm run build`、`node scripts/rc-preflight.mjs` | 通过 |
| UI | 智能录入来源标注、嵌入式「解释」入口、默认收起 Copilot 与打开态 | 截图见交付说明 |

真实模型测试覆盖（待凭证与预算确认后执行）：多条中文安排、相对日期、缺失地点、歧义地点、不完整结束时间、当前出行问答、真实路线工具、提议修改与确认、未授权操作拒绝、Prompt Injection 防御、模型失败降级、预算上限生效。

评测按冻结 PRD 人工标注，分别报告时间字段、地点字段、订单状态的准确率。未获得预算确认前不产生任何真实调用费用。

## 11. 剩余发布阻断项

1. 运行环境存在 DeepSeek Key，但缺少使用者确认的每日预算与复用授权，真实模型证据为空（阻断真实调用验收，不影响规则/手动路径）。
2. Google 与 DeepSeek 的数据处理条款及用户授权尚未书面确认，真实邮件内容不进入模型。
3. 真实模型人工评测尚未执行（依赖第 1 项）。

本轮只完成 M4，未部署、未改 main、未合并 PR #9。
