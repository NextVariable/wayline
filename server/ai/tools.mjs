/**
 * Tool Registry + Permission Gateway.
 *
 * The model can only call names registered here, only inside the task that
 * grants them, and only against the request-scoped context. Tools never open a
 * database, touch the filesystem, read credentials or call arbitrary URLs.
 * Time and feasibility come from context.commutes, which the client computes
 * with the same Smart Routes engine that renders Today.
 */
import { shanghaiDay, validDate } from "./schemas.mjs";

export const AI_TOOL_MATRIX = Object.freeze({
  get_trip_context: { scope: "read", tasks: ["copilot"], description: "读取当前出行概要（城市、日期、日程数量）" },
  get_schedule: { scope: "read", tasks: ["copilot"], description: "读取今天、明天或指定日期的安排" },
  search_place: { scope: "read", tasks: ["copilot"], description: "用地图服务搜索地点，不生成坐标" },
  get_booking_context: { scope: "read", tasks: ["copilot"], description: "读取已订交通与住宿的最小字段" },
  query_route: { scope: "read", tasks: ["copilot"], description: "查询工作区内两个地点之间的真实路线耗时" },
  assess_commute: { scope: "read", tasks: ["copilot"], description: "读取 Smart Routes 已计算的路段可行性" },
  get_insights: { scope: "read", tasks: ["copilot"], description: "读取规则引擎生成的行动项与风险" },
  propose_schedule_change: { scope: "propose", tasks: ["copilot"], description: "生成待用户确认的本地日程修改预览" },
});

const definitions = {
  get_trip_context: {
    type: "function",
    function: {
      name: "get_trip_context",
      description: AI_TOOL_MATRIX.get_trip_context.description,
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  get_schedule: {
    type: "function",
    function: {
      name: "get_schedule",
      description: AI_TOOL_MATRIX.get_schedule.description,
      parameters: {
        type: "object",
        properties: { day: { type: "string", enum: ["today", "tomorrow"], description: "只支持今天或明天" } },
        additionalProperties: false,
      },
    },
  },
  search_place: {
    type: "function",
    function: {
      name: "search_place",
      description: AI_TOOL_MATRIX.search_place.description,
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "地点名称" },
          city: { type: "string", description: "城市提示" },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  get_booking_context: {
    type: "function",
    function: {
      name: "get_booking_context",
      description: AI_TOOL_MATRIX.get_booking_context.description,
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  query_route: {
    type: "function",
    function: {
      name: "query_route",
      description: AI_TOOL_MATRIX.query_route.description,
      parameters: {
        type: "object",
        properties: {
          fromPlaceId: { type: "string" },
          toPlaceId: { type: "string" },
          mode: { type: "string", enum: ["walking", "transit", "driving", "selfDrive"] },
        },
        required: ["fromPlaceId", "toPlaceId", "mode"],
        additionalProperties: false,
      },
    },
  },
  assess_commute: {
    type: "function",
    function: {
      name: "assess_commute",
      description: AI_TOOL_MATRIX.assess_commute.description,
      parameters: {
        type: "object",
        properties: { fromEventId: { type: "string" }, toEventId: { type: "string" } },
        required: ["fromEventId", "toEventId"],
        additionalProperties: false,
      },
    },
  },
  get_insights: {
    type: "function",
    function: {
      name: "get_insights",
      description: AI_TOOL_MATRIX.get_insights.description,
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  propose_schedule_change: {
    type: "function",
    function: {
      name: "propose_schedule_change",
      description: AI_TOOL_MATRIX.propose_schedule_change.description,
      parameters: {
        type: "object",
        properties: {
          operation: { type: "string", enum: ["create", "update"] },
          targetId: { type: "string", description: "要修改的本地日程事件 id" },
          placeId: { type: "string", description: "工作区内已有地点 id" },
          title: { type: "string" },
          date: { type: "string", description: "YYYY-MM-DD" },
          startTime: { type: "string", description: "HH:MM" },
          endTime: { type: "string", description: "HH:MM" },
          reason: { type: "string" },
        },
        required: ["operation"],
        additionalProperties: false,
      },
    },
  },
};

class ToolError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ToolError";
    this.code = code;
  }
}

const clean = (value, max = 80) => (typeof value === "string" ? value.trim().slice(0, max) : "");
const TIME = /^([01]?\d|2[0-3]):([0-5]\d)$/;

const shanghaiDateOf = (value) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date(value));

export function toolDefinitions(task) {
  return Object.entries(AI_TOOL_MATRIX)
    .filter(([, entry]) => entry.tasks.includes(task))
    .map(([name]) => definitions[name])
    .filter(Boolean);
}

export function createToolRunner({ context, services = {}, now = Date.now }) {
  const findPlace = (id) => context.places.find((place) => place.id === id);
  const findEvent = (id) => context.events.find((event) => event.id === id);
  const today = shanghaiDay(now);

  const handlers = {
    get_trip_context() {
      const trips = context.trips.filter((trip) => !trip.startDate || !trip.endDate ||
        (trip.startDate <= today && trip.endDate >= today));
      return { today, activeCity: context.activeCity, trips: trips.length ? trips : context.trips.slice(0, 1) };
    },
    get_schedule(args) {
      const day = args.day === "tomorrow" ? shanghaiDay(now + 86_400_000) : today;
      return {
        day,
        events: context.events.filter((event) => shanghaiDateOf(event.start) === day),
      };
    },
    async search_place(args) {
      const query = clean(args.query, 60);
      if (query.length < 2) throw new ToolError("invalid_arguments", "地点名称太短");
      if (typeof services.searchPlaces !== "function") throw new ToolError("tool_unavailable", "地点服务暂不可用");
      const city = clean(args.city ?? context.activeCity, 40);
      const results = await services.searchPlaces({ keyword: query, city, count: 5 });
      return {
        query,
        results: (Array.isArray(results) ? results : []).slice(0, 5).map((place) => ({
          name: clean(place.name, 80),
          city: clean(place.city, 40),
          address: clean(place.address, 120),
          category: clean(place.category, 24),
          source: "amap",
        })),
      };
    },
    get_booking_context() {
      return { bookings: context.bookings, note: "只包含已确认或待核对的订单摘要，不含乘客与支付信息" };
    },
    async query_route(args) {
      const from = findPlace(clean(args.fromPlaceId, 120));
      const to = findPlace(clean(args.toPlaceId, 120));
      if (!from || !to) throw new ToolError("unknown_place", "只能查询工作区内已有地点");
      if (![from.lat, from.lng, to.lat, to.lng].every(Number.isFinite))
        throw new ToolError("missing_coordinates", "地点缺少可用坐标");
      if (!["walking", "transit", "driving", "selfDrive"].includes(args.mode))
        throw new ToolError("invalid_arguments", "交通方式不受支持");
      if (typeof services.route !== "function") throw new ToolError("tool_unavailable", "路线服务暂不可用");
      // The map provider needs an explicit departure for transit and has no
      // separate self-drive endpoint; both stay deterministic and cost-aware here.
      const routeMode = args.mode === "selfDrive" ? "driving" : args.mode;
      const route = await services.route({
        mode: routeMode,
        places: [{ id: from.id, lat: from.lat, lng: from.lng }, { id: to.id, lat: to.lat, lng: to.lng }],
        ...(routeMode === "transit" ? { departure: new Date(now).toISOString() } : {}),
      });
      if (!Number.isFinite(Number(route?.duration)))
        throw new ToolError("route_unavailable", "路线服务未返回可用耗时");
      return {
        from: from.name,
        to: to.name,
        mode: args.mode,
        minutes: Math.ceil(Number(route.duration) / 60),
        source: clean(route.source, 24) || "amap",
        observedAt: new Date(now).toISOString(),
        note: "由真实地图路线服务返回，不含等车、停车与进出站时间",
      };
    },
    assess_commute(args) {
      const fromEventId = clean(args.fromEventId, 120);
      const toEventId = clean(args.toEventId, 120);
      const commute = context.commutes.find((item) => item.fromEventId === fromEventId && item.toEventId === toEventId);
      if (!commute) throw new ToolError("not_in_context", "该路段尚未由 Smart Routes 计算，请先在工作区打开对应路段");
      return commute;
    },
    get_insights() {
      return { actions: context.actions };
    },
    propose_schedule_change(args) {
      const operation = clean(args.operation, 20);
      if (!["create", "update"].includes(operation)) throw new ToolError("invalid_arguments", "不支持的操作");
      const targetId = clean(args.targetId, 120);
      if (operation === "update") {
        const target = findEvent(targetId);
        if (!target) throw new ToolError("unknown_target", "没有找到要修改的安排");
        if (!target.local) throw new ToolError("external_source", "只能修改 Wayline 本地安排，不能修改外部日历");
      }
      const placeId = clean(args.placeId, 120);
      if (placeId && !findPlace(placeId)) throw new ToolError("unknown_place", "地点不在当前工作区");
      const date = clean(args.date, 10);
      if (date && !validDate(date, now)) throw new ToolError("invalid_date", "日期超出可接受范围");
      if (operation === "create" && (!placeId || !date))
        throw new ToolError("incomplete_proposal", "新增安排需要地点与日期");
      const startTime = clean(args.startTime, 5);
      const endTime = clean(args.endTime, 5);
      if (startTime && !TIME.test(startTime)) throw new ToolError("invalid_time", "开始时间格式无效");
      if (endTime && !TIME.test(endTime)) throw new ToolError("invalid_time", "结束时间格式无效");
      if (startTime && endTime && endTime <= startTime)
        throw new ToolError("invalid_range", "结束时间必须晚于开始时间");
      return {
        kind: "schedule-change",
        operation,
        targetId: operation === "update" ? targetId : "",
        placeId,
        date,
        startTime,
        endTime,
        title: clean(args.title, 40),
        reason: clean(args.reason, 160),
        baseVersion: context.revision,
        requiresConfirmation: true,
      };
    },
  };

  return {
    definitions: (task) => toolDefinitions(task),
    async run(name, args = {}, { task } = {}) {
      const entry = AI_TOOL_MATRIX[name];
      if (!entry) return { ok: false, code: "tool_not_registered", error: "工具未注册" };
      if (!entry.tasks.includes(task)) return { ok: false, code: "tool_not_allowed", error: "工具未授权给当前任务" };
      if (args && typeof args !== "object") return { ok: false, code: "invalid_arguments", error: "参数格式无效" };
      try {
        const result = await handlers[name](args, { context, services });
        return { ok: true, result };
      } catch (error) {
        return { ok: false, code: error.code ?? "tool_error", error: clean(error.message, 160) || "工具执行失败" };
      }
    },
  };
}
