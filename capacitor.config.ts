import type { CapacitorConfig } from "@capacitor/cli";

// 保留原应用标识，确保已有安装和本地数据连续。
const config: CapacitorConfig = {
  appId: "app.whereto.business",
  appName: "Wayline",
  webDir: "dist",
};

export default config;
