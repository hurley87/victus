import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      backgroundImage: {
        "gradient-radial": "radial-gradient(var(--tw-gradient-stops))",
        "gradient-conic":
          "conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))",
      },
      colors: {
        imperial: {
          bg: '#0D0D0D',
          surface: '#141414',
          border: '#2A2A2A',
        },
        gold: {
          DEFAULT: '#C8A84E',
          light: '#D4AF37',
          muted: '#8B7331',
          dim: '#6B5A2A',
        },
        pnl: {
          positive: '#22C55E',
          negative: '#EF4444',
        },
      },
      fontFamily: {
        serif: ['Cinzel', 'serif'],
      },
    },
  },
  plugins: [],
};
export default config;
