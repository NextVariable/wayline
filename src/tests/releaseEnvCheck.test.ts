import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

const run = (env: NodeJS.ProcessEnv) => spawnSync(process.execPath, ["scripts/rc-env-check.mjs"], {
  env: { ...process.env, ...env },
  encoding: "utf8",
});

it("accepts a loopback development profile and warns about the missing map key", () => {
  const result = run({ PUBLIC_ORIGIN: "http://127.0.0.1:8787", HOST: "127.0.0.1", NODE_ENV: "development" });
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain("PASS");
  expect(result.stderr).toContain("未配置高德");
});

it("accepts a complete https profile", () => {
  const result = run({
    PUBLIC_ORIGIN: "https://wayline.example.com", HOST: "0.0.0.0", WEB_ACCESS_PASSWORD: "synthetic-password",
    GOOGLE_CLIENT_ID: "synthetic-client", GOOGLE_CLIENT_SECRET: "synthetic-secret",
    GOOGLE_REDIRECT_URI: "https://wayline.example.com/api/calendar/google/callback",
    AMAP_WEB_SERVICE_KEY: "synthetic-amap",
  });
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain("PASS");
});

it("rejects unsafe origins, missing access password and mismatched OAuth without echoing secrets", () => {
  const result = run({
    PUBLIC_ORIGIN: "http://wayline.example.com", HOST: "0.0.0.0",
    GOOGLE_CLIENT_ID: "synthetic-client", GOOGLE_CLIENT_SECRET: "synthetic-secret",
    GOOGLE_REDIRECT_URI: "https://elsewhere.example/callback", AMAP_WEB_SERVICE_KEY: "synthetic-amap",
  });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("必须使用 https");
  expect(result.stderr).toContain("WEB_ACCESS_PASSWORD");
  expect(result.stderr).toContain("GOOGLE_REDIRECT_URI");
  expect(`${result.stdout}${result.stderr}`).not.toContain("synthetic-secret");
});

it("rejects a half-configured Google OAuth client", () => {
  const result = run({ PUBLIC_ORIGIN: "http://127.0.0.1:8787", HOST: "127.0.0.1", GOOGLE_CLIENT_ID: "synthetic-client" });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("成对配置");
});
