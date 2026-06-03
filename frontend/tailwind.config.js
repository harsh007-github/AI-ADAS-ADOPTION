/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        nivara: {
          green: '#10b981',
          amber: '#f59e0b',
          red: '#ef4444',
          ink: '#05060a',
        },
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      keyframes: {
        'pulse-red': {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(239, 68, 68, 0.7)' },
          '50%':      { boxShadow: '0 0 0 24px rgba(239, 68, 68, 0)' },
        },
      },
      animation: {
        'pulse-red': 'pulse-red 0.9s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
