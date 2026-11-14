import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // Keep development requests same-origin, including isolated UI test ports.
    proxy: { "/api": "http://127.0.0.1:8787" },
  },
});
