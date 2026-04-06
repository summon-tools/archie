import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./tools/**/*.{js,ts,jsx,tsx}",
    "./lib/**/*.{js,ts}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#f8fce8",
          100: "#eff8cd",
          200: "#e0f2a0",
          300: "#cde96e",
          400: "#b8d950",
          500: "#a3c93a",
          600: "#82a52b",
          700: "#637e24",
          800: "#4e6422",
          900: "#3d4f20",
        },
        surface: {
          700: "#334155",
          800: "#1e293b",
          900: "#0f172a",
          950: "#020617",
        },
      },
      textColor: {
        th: {
          primary: "var(--text-primary)",
          secondary: "var(--text-secondary)",
          muted: "var(--text-muted)",
          dimmed: "var(--text-dimmed)",
          inverted: "var(--bg-gradient-from)",
        },
        "btn-primary": "var(--btn-primary-text)",
        "btn-secondary": "var(--btn-secondary-text)",
        "btn-ghost": "var(--btn-ghost-text)",
        "btn-ghost-hover": "var(--btn-ghost-hover-text)",
        "st-green": "var(--status-green-text)",
        "st-blue": "var(--status-blue-text)",
        "st-red": "var(--status-red-text)",
        "st-red-strong": "var(--status-red-text-strong)",
        "st-yellow": "var(--status-yellow-text)",
        "st-purple": "var(--status-purple-text)",
        "st-amber": "var(--status-amber-text)",
        "code-inline": "var(--text-code-inline)",
        "code-block": "var(--text-code-block)",
      },
      backgroundColor: {
        th: {
          surface: "var(--surface-primary)",
          sidebar: "var(--surface-sidebar)",
          elevated: "var(--surface-elevated)",
          overlay: "var(--surface-overlay)",
          subtle: "var(--fill-subtle)",
          muted: "var(--fill-muted)",
          strong: "var(--fill-strong)",
          code: "var(--surface-code)",
          "code-block": "var(--surface-code-block)",
          primary: "var(--text-primary)",
        },
        "btn-primary": "var(--btn-primary-bg)",
        "btn-primary-hover": "var(--btn-primary-hover)",
        "btn-secondary": "var(--btn-secondary-bg)",
        "btn-secondary-hover": "var(--btn-secondary-hover)",
        "btn-ghost-hover": "var(--btn-ghost-hover-bg)",
        "st-green": "var(--status-green-bg)",
        "st-green-hover": "var(--status-green-bg-hover)",
        "st-blue": "var(--status-blue-bg)",
        "st-blue-hover": "var(--status-blue-bg-hover)",
        "st-red": "var(--status-red-bg)",
        "st-red-hover": "var(--status-red-bg-hover)",
        "st-yellow": "var(--status-yellow-bg)",
        "st-purple": "var(--status-purple-bg)",
        "st-purple-hover": "var(--status-purple-bg-hover)",
        "st-amber": "var(--status-amber-bg)",
        "st-amber-hover": "var(--status-amber-bg-hover)",
        "overlay-light": "var(--overlay-light)",
        "overlay-medium": "var(--overlay-medium)",
        "overlay-heavy": "var(--overlay-heavy)",
      },
      borderColor: {
        th: {
          DEFAULT: "var(--border-primary)",
          strong: "var(--border-strong)",
        },
        "st-green": "var(--status-green-border)",
        "st-blue": "var(--status-blue-border)",
        "st-red": "var(--status-red-border)",
        "st-yellow": "var(--status-yellow-border)",
      },
      placeholderColor: {
        th: {
          DEFAULT: "var(--text-dimmed)",
          muted: "var(--text-muted)",
        },
      },
      ringColor: {
        th: "var(--ring-color)",
      },
      boxShadow: {
        soft: "0 1px 3px 0 rgba(0,0,0,0.3), 0 1px 2px -1px rgba(0,0,0,0.3)",
        glass: "0 4px 30px rgba(0,0,0,0.3)",
      },
      fontSize: {
        meta: ["11px", { lineHeight: "1.4" }],
        secondary: ["13px", { lineHeight: "1.5" }],
      },
      maxWidth: {
        chat: "720px",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        fadeIn: "fadeIn 0.3s ease-out",
      },
    },
  },
  plugins: [],
};
export default config;
