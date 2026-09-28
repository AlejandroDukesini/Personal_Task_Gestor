/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        bg: "rgb(var(--bg) / <alpha-value>)",
        surface: "rgb(var(--surface) / <alpha-value>)",
        muted: "rgb(var(--muted) / <alpha-value>)",
        border: "rgb(var(--border) / <alpha-value>)",
        text: "rgb(var(--text) / <alpha-value>)",
        subtle: "rgb(var(--subtle) / <alpha-value>)",
        primary: "rgb(var(--primary) / <alpha-value>)",
        "primary-fg": "rgb(var(--primary-fg) / <alpha-value>)",
        danger: "rgb(var(--danger) / <alpha-value>)",
        success: "rgb(var(--success) / <alpha-value>)",
        warning: "rgb(var(--warning) / <alpha-value>)",
        ring: "rgb(var(--ring) / <alpha-value>)",
      },
      // Radios y sombras tematizables: `rounded-lg`/`shadow-soft` dejan de ser
      // valores fijos y pasan a resolverse por el skin activo.
      borderRadius: {
        sm: "var(--radius-sm)",
        DEFAULT: "var(--radius-md)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
        xl: "var(--radius-lg)",
        pill: "var(--radius-pill)",
      },
      borderWidth: {
        theme: "var(--border-w)",
      },
      boxShadow: {
        soft: "var(--shadow-1)",
        pop: "var(--shadow-2)",
      },
      fontFamily: {
        sans: "var(--font-ui)",
        mono: "var(--font-mono)",
        heading: "var(--font-heading)",
      },
      transitionTimingFunction: {
        theme: "cubic-bezier(0.2, 0.8, 0.2, 1)",
      },
      keyframes: {
        "fade-in": { "0%": { opacity: 0 }, "100%": { opacity: 1 } },
        "scale-in": {
          "0%": { opacity: 0, transform: "scale(.96)" },
          "100%": { opacity: 1, transform: "scale(1)" },
        },
      },
      animation: {
        "fade-in": "fade-in .15s ease-out",
        "scale-in": "scale-in .15s ease-out",
      },
    },
  },
  plugins: [],
};
