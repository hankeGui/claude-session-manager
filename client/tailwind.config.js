/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        'bg-primary': '#1a1a2e',
        'bg-secondary': '#16213e',
        'bg-card': '#0f3460',
        'text-primary': '#e0e0e0',
        'text-muted': '#8892a4',
        'accent': '#4fc3f7',
        'accent-hover': '#29b6f6',
        'danger': '#ef5350',
        'danger-hover': '#e53935',
        'success': '#66bb6a',
        'warning': '#ffa726',
        'border': '#2a3a5e',
      },
      animation: {
        'slide-up': 'slide-up 0.3s ease-out',
      },
      keyframes: {
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
}
