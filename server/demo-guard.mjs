const demoId = value => typeof value === "string" && /^demo(?::|-)/i.test(value.trim());

export function isDemoRequest(request, payload) {
  return request?.headers?.["x-wayline-workspace"] === "demo" ||
    demoId(payload?.owner) || demoId(payload?.context?.owner) ||
    (Array.isArray(payload?.places) && payload.places.some(place => demoId(place?.id)));
}

export const demoResponse = { ok: false, code: "demo_only", error: "演示只使用示例数据" };
