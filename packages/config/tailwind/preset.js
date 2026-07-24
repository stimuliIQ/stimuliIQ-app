// @repo/config/tailwind/preset — shared Tailwind preset, tokens per docs/07-design-system.md.
// CSS-variable-driven so light/dark/density theming plugs in without a rebuild. Apps extend
// this in their own tailwind.config.js via `presets: [require("@repo/config/tailwind/preset")]`
// and must import `@repo/ui/styles.css` once (root layout / main entry) to get the variables.

/** @type {import("tailwindcss").Config} */
module.exports = {
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        brand: {
          50: "rgb(var(--brand-50) / <alpha-value>)",
          100: "rgb(var(--brand-100) / <alpha-value>)",
          500: "rgb(var(--brand-500) / <alpha-value>)",
          600: "rgb(var(--brand-600) / <alpha-value>)",
          700: "rgb(var(--brand-700) / <alpha-value>)",
          foreground: "rgb(var(--brand-foreground) / <alpha-value>)",
        },
        bg: "rgb(var(--bg) / <alpha-value>)",
        surface: "rgb(var(--surface) / <alpha-value>)",
        card: "rgb(var(--card) / <alpha-value>)",
        border: "rgb(var(--border) / <alpha-value>)",
        fg: {
          DEFAULT: "rgb(var(--fg) / <alpha-value>)",
          muted: "rgb(var(--fg-muted) / <alpha-value>)",
          subtle: "rgb(var(--fg-subtle) / <alpha-value>)",
        },
        success: {
          DEFAULT: "rgb(var(--success) / <alpha-value>)",
          foreground: "rgb(var(--success-foreground) / <alpha-value>)",
        },
        warning: {
          DEFAULT: "rgb(var(--warning) / <alpha-value>)",
          foreground: "rgb(var(--warning-foreground) / <alpha-value>)",
        },
        danger: {
          DEFAULT: "rgb(var(--danger) / <alpha-value>)",
          foreground: "rgb(var(--danger-foreground) / <alpha-value>)",
        },
        info: {
          DEFAULT: "rgb(var(--info) / <alpha-value>)",
          foreground: "rgb(var(--info-foreground) / <alpha-value>)",
        },
        ring: "rgb(var(--ring) / <alpha-value>)",

        // Categorical chart palette (docs/07-design-system.md §5/§2 — colorblind-safe,
        // themed light/dark). Chart components mostly resolve these via inline
        // `rgb(var(--chart-N))` strings (recharts needs literal color values, not classes)
        // but the utilities below are available for legend swatches / static usage.
        chart: {
          1: "rgb(var(--chart-1) / <alpha-value>)",
          2: "rgb(var(--chart-2) / <alpha-value>)",
          3: "rgb(var(--chart-3) / <alpha-value>)",
          4: "rgb(var(--chart-4) / <alpha-value>)",
          5: "rgb(var(--chart-5) / <alpha-value>)",
          6: "rgb(var(--chart-6) / <alpha-value>)",
        },

        // Back-compat aliases (Phase-0 placeholder names) so any code already referencing
        // these utility classes keeps working while migrating to the docs/07 token names.
        background: "rgb(var(--bg) / <alpha-value>)",
        foreground: "rgb(var(--fg) / <alpha-value>)",
        primary: {
          DEFAULT: "rgb(var(--brand-500) / <alpha-value>)",
          foreground: "rgb(var(--brand-foreground) / <alpha-value>)",
        },
        muted: {
          DEFAULT: "rgb(var(--surface) / <alpha-value>)",
          foreground: "rgb(var(--fg-muted) / <alpha-value>)",
        },
        destructive: {
          DEFAULT: "rgb(var(--danger) / <alpha-value>)",
          foreground: "rgb(var(--danger-foreground) / <alpha-value>)",
        },
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        DEFAULT: "var(--radius-md)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
        full: "var(--radius-full)",
      },
      boxShadow: {
        sm: "var(--shadow-sm)",
        md: "var(--shadow-md)",
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
        display: ["var(--font-display)"],
        mono: ["var(--font-mono)"],
      },
      fontSize: {
        xs: "var(--text-xs)",
        sm: "var(--text-sm)",
        base: "var(--text-base)",
        lg: "var(--text-lg)",
        xl: "var(--text-xl)",
        "2xl": "var(--text-2xl)",
        "3xl": "var(--text-3xl)",
        "4xl": "var(--text-4xl)",
        "5xl": "var(--text-5xl)",
      },
      transitionDuration: {
        fast: "var(--duration-fast)",
        DEFAULT: "var(--duration-base)",
        slow: "var(--duration-slow)",
      },
      transitionTimingFunction: {
        out: "var(--ease-out)",
      },
    },
  },
  plugins: [],
};
