/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        background: '#F3F4F6',
        sidebar: {
          bg: '#111827',
          text: {
            DEFAULT: '#9CA3AF',
            active: '#FFFFFF'
          }
        },
        text: {
          primary: '#374151',
          secondary: '#6B7280'
        },
        action: '#3B82F6',
        success: '#10B981',
        card: {
          bg: '#FFFFFF',
          border: '#E5E7EB'
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif']
      }
    },
  },
  plugins: [],
};