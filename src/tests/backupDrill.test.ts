import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

it("rehearses backup, tamper detection and restore on synthetic data", () => {
  const result = spawnSync(process.execPath, ["scripts/wayline-backup-drill.mjs"], { encoding: "utf8" });
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain("PASS");
});
