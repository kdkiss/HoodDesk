import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./src/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        hood: {
          bg: "rgb(var(--hood-bg) / <alpha-value>)",
          panel: "rgb(var(--hood-panel) / <alpha-value>)",
          well: "rgb(var(--hood-well) / <alpha-value>)",
          border: "rgb(var(--hood-border) / <alpha-value>)",
          borderLight: "rgb(var(--hood-border-light) / <alpha-value>)",
          text: "rgb(var(--hood-text) / <alpha-value>)",
          muted: "rgb(var(--hood-muted) / <alpha-value>)",
          green: "rgb(var(--hood-green) / <alpha-value>)",
          greenDim: "rgb(var(--hood-green-dim) / <alpha-value>)",
          amber: "rgb(var(--hood-amber) / <alpha-value>)",
          amberDim: "rgb(var(--hood-amber-dim) / <alpha-value>)",
          red: "rgb(var(--hood-red) / <alpha-value>)",
          redDim: "rgb(var(--hood-red-dim) / <alpha-value>)",
          yellow: "rgb(var(--hood-yellow) / <alpha-value>)",
          accent: "rgb(var(--hood-amber) / <alpha-value>)",
        },
      },
      borderRadius: {
        xl: "0.875rem",
        "2xl": "1rem",
      },
      boxShadow: {
        card: "0 1px 2px rgba(0,0,0,0.4), 0 4px 16px rgba(0,0,0,0.25)",
        pop: "0 8px 32px rgba(0,0,0,0.55)",
        glow: "0 0 0 1px rgba(0,209,143,0.35), 0 4px 20px rgba(0,209,143,0.12)",
        "amber-glow": "0 0 0 1px rgba(217,119,6,0.35), 0 4px 20px rgba(217,119,6,0.12)",
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "Roboto", "Helvetica Neue", "Arial", "sans-serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "SFMono-Regular", "Menlo", "Monaco", "Consolas", "monospace"],
      },
    },
  },
  plugins: [],
};
export default config;
