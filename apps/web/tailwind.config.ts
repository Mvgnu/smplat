import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: ["./src/app/**/*.{ts,tsx}", "./src/components/**/*.{ts,tsx}", "../../packages/shared/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "hsl(222, 47%, 5%)",
        foreground: "hsl(210, 40%, 98%)",
        primary: {
          DEFAULT: "#2E6FED",
          foreground: "#F8FAFF"
        },
        secondary: {
          DEFAULT: "#0F1115",
          foreground: "#E5E7EB"
        },
        muted: {
          DEFAULT: "#1A1D22",
          foreground: "#9CA3AF"
        }
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        display: ["Satoshi", "Inter", "sans-serif"]
      },
      animation: {
        blob: "blob 7s infinite"
      },
      keyframes: {
        blob: {
          "0%": { transform: "translate(0px, 0px) scale(1)" },
          "33%": { transform: "translate(30px, -50px) scale(1.1)" },
          "66%": { transform: "translate(-20px, 20px) scale(0.9)" },
          "100%": { transform: "translate(0px, 0px) scale(1)" }
        }
      }
    }
  },
  plugins: []
};

export default config;
