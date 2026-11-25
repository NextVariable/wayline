import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ToastProvider } from "./components/Toast";
import "./styles/globals.css";
import "./styles/m3.css";

// 高德 JS API 2.0 安全配置（必须在 SDK 加载前设置）
Object.assign(window, { _AMapSecurityConfig: {
  securityJsCode: import.meta.env.VITE_AMAP_SECURITY_CODE as string,
} });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </StrictMode>,
);
