import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        status: {
          up: '#10b981',       // emerald-500
          degraded: '#f59e0b', // amber-500
          down: '#ef4444',     // red-500
          unknown: '#6b7280',  // gray-500
        },
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'onboarding-fade-in': 'onboarding-fade-in 0.5s ease-out forwards',
        'onboarding-slide-right': 'onboarding-slide-in-right 0.4s ease-out',
        'pulse-ring': 'pulse-ring 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
    },
  },
  plugins: [],
};

export default config;
