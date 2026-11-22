import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

it("rejects hostile restore targets, manifests and partial failures on temp fixtures", () => {
  const result = spawnSync(process.execPath, ["scripts/wayline-backup-safety.mjs"], { encoding: "utf8" });
  expect(result.status, result.stderr).toBe(0);
  for (const scenario of [
    "拒绝危险恢复目标",
    "拒绝源目录与备份目录重叠",
    "拒绝恶意 manifest 路径",
    "检测字节数、额外文件与符号链接",
    "拒绝备份源中的符号链接与非普通文件",
    "force 覆盖必须通过暂存校验且保留旧数据",
    "部分失败时目标保持不变",
    "路径别名与符号链接不能绕过安全检查",
    "备份 label 不能构造路径穿越",
  ]) {
    expect(result.stdout).toContain(`PASS ${scenario}`);
  }
  expect(result.stdout).toContain("PASS: 备份恢复安全演练全部通过");
});
