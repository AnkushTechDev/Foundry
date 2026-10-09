/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      colors: {
        ink: "hsl(var(--ink) / <alpha-value>)",
        panel: "hsl(var(--panel) / <alpha-value>)",
        line: "hsl(var(--line) / <alpha-value>)",
        mute: "hsl(var(--mute) / <alpha-value>)",
        accent: "hsl(var(--accent) / <alpha-value>)",
      },
      boxShadow: {
        lift: "0 12px 40px hsl(220 40% 2% / 0.28)",
      },
    },
  },
  plugins: [],
};
