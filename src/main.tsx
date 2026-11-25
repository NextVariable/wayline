import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { isDesktopShowcase, spatialMedia } from "./lib/spatialMedia";
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
const showOpening = isDesktopShowcase && !matchMedia(spatialMedia.reduced).matches;

// A reload of the showcase should always begin at the room, even mid-scroll.
if (showOpening) history.scrollRestoration = "manual";
const workspace = <App />;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ToastProvider>
      {showOpening ? <Suspense fallback={null}><SpatialShowcase>{workspace}</SpatialShowcase></Suspense> : workspace}
    </ToastProvider>
  </StrictMode>,
);
