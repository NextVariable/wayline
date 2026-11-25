import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ToastProvider } from "./components/Toast";
import "./styles/globals.css";
import "./styles/m3.css";

// 高德 JS API 2.0 安全配置（必须在 SDK 加载前设置）
Object.assign(window, { _AMapSecurityConfig: {
  securityJsCode: import.meta.env.VITE_AMAP_SECURITY_CODE as string,
} });

const SpatialShowcase = lazy(() =>
  import("./components/SpatialShowcase").then(({ SpatialShowcase }) => ({ default: SpatialShowcase })),
);
const showOpening = /^\/showcase\/?$/.test(window.location.pathname);
const workspace = <App />;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ToastProvider>
      {showOpening ? <Suspense fallback={null}><SpatialShowcase>{workspace}</SpatialShowcase></Suspense> : workspace}
    </ToastProvider>
  </StrictMode>,
);
