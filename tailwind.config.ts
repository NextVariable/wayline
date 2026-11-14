import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        display: ["-apple-system", "BlinkMacSystemFont", "Segoe UI", "PingFang SC", "Microsoft YaHei", "sans-serif"],
        sans: ["-apple-system", "BlinkMacSystemFont", "Segoe UI", "PingFang SC", "Microsoft YaHei", "sans-serif"],
      },
      colors: {
        surface: {
          base: "var(--surface-base)",
          panel: "var(--surface-panel)",
          overlay: "var(--surface-overlay)",
          dark: "var(--surface-dark)",
        },
        brand: {
          DEFAULT: "var(--brand)",
        },
        semantic: {
          success: "var(--success)",
          "success-bg": "var(--success-bg)",
          error: "var(--error)",
          "error-bg": "var(--error-bg)",
          warning: "var(--warning)",
          "warning-bg": "var(--warning-bg)",
          info: "var(--info)",
          "info-bg": "var(--info-bg)",
        },
      },
      boxShadow: {
        glass: "0 24px 70px rgba(32, 43, 66, 0.16)",
        pin: "0 12px 28px rgba(19, 36, 58, 0.22)",
      },
      keyframes: {
        floatIn: {
          "0%": { opacity: "0", transform: "translateY(8px) scale(0.98)" },
          "100%": { opacity: "1", transform: "translateY(0) scale(1)" },
        },
      },
      animation: {
        floatIn: "floatIn 420ms cubic-bezier(0.2, 0.8, 0.2, 1)",
      },
    },
  },
  plugins: [],
} satisfies Config;
