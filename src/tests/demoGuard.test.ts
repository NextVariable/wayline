import { describe, expect, it, vi } from "vitest";
// @ts-expect-error Node server modules are not compiled by the frontend.
import { createAiRoutes } from "../../server/ai/routes.mjs";
// @ts-expect-error Node server modules are not compiled by the frontend.
import { isDemoRequest } from "../../server/demo-guard.mjs";
import { resolveIntakeModel } from "../lib/intakeModel";

describe("zero-cost demo guard", () => {
  it("blocks demo intake, copilot and confirmation before reading account or touching a provider or budget", async () => {
    const touched = vi.fn(() => { throw new Error("Paid service or budget was reached"); });
    const run = createAiRoutes({
      config: {}, budget: {snapshot:touched,begin:touched}, provider:{complete:touched},
      accountFor:touched, proposals:{confirm:touched}, services:{route:touched},
    });
    const request = {headers:{}};
    for (const route of ["/api/ai/intake","/api/ai/copilot","/api/ai/confirm"]) {
      expect(await run({route,request,body:{owner:"demo:wayline"}})).toMatchObject({status:403,payload:{code:"demo_only"}});
    }
    expect(touched).not.toHaveBeenCalled();
    expect(resolveIntakeModel("demo:wayline")).toBeNull();
  });

  it("recognizes workspace markers and demo endpoints independently of the UI", () => {
    expect(isDemoRequest({headers:{"x-wayline-workspace":"demo"}},{mode:"driving"})).toBe(true);
    expect(isDemoRequest({headers:{}},{context:{owner:"demo:wayline"},owner:"guest"})).toBe(true);
    expect(isDemoRequest({headers:{}},{places:[{id:"demo-sh-station"},{id:"other"}]})).toBe(true);
    expect(isDemoRequest({headers:{}},{owner:"guest",places:[{id:"amap-123"}]})).toBe(false);
  });
});
