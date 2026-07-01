import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: {
          50:  "#f8f8f8",
          100: "#e8e8e8",
          200: "#d0d0d0",
          400: "#888888",
          500: "#555555",
          600: "#333333",
          700: "#222222",
          800: "#161616",
          900: "#111111",
          950: "#080808",
        },
      },
      fontFamily: {
        sans: ["-apple-system", "BlinkMacSystemFont", '"Segoe UI"', "system-ui", "sans-serif"],
      },
      borderRadius: {
        "2xl": "1rem",
        "3xl": "1.25rem",
      },
      animation: {
        "fade-in":      "fadeIn 0.22s ease-out both",
        "slide-up":     "slideUp 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) both",
        "spring-up":    "springUp 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) both",
        "spring-scale": "springScale 0.38s cubic-bezier(0.34, 1.56, 0.64, 1) both",
        "shimmer":      "shimmer 1.4s ease-in-out infinite",
      },
      keyframes: {
        fadeIn: {
          "0%":   { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%":   { opacity: "0", transform: "translateY(10px) scale(0.98)" },
          "60%":  { opacity: "1", transform: "translateY(-2px) scale(1.003)" },
          "100%": { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        springUp: {
          "0%":   { opacity: "0", transform: "translateY(18px) scale(0.96)" },
          "55%":  { opacity: "1", transform: "translateY(-5px) scale(1.015)" },
          "80%":  { transform: "translateY(2px) scale(0.998)" },
          "100%": { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        springScale: {
          "0%":   { opacity: "0", transform: "scale(0.86)" },
          "55%":  { opacity: "1", transform: "scale(1.055)" },
          "75%":  { transform: "scale(0.99)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        shimmer: {
          "0%":   { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
