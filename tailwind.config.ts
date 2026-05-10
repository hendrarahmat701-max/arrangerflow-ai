import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        'hw': {
          'bg': '#0E0E10',
          'panel': '#151619',
          'sidebar': '#111215',
          'workspace': '#0A0A0C',
          'card': '#1C1D21',
          'border': '#2A2B2F',
          'border-light': '#3A3B40',
          'accent': '#FFB000',
          'data': '#00E5FF',
          'status': '#00FF41',
          'muted': '#8E9299',
          'text-dark': '#4A4B50',
        }
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      }
    },
  },
  plugins: [],
};

export default config;