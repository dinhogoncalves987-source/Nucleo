/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // CSS variable-based semantic tokens (auto switch with theme)
        surface: {
          main:    'var(--surface-main)',
          page:    'var(--surface-page)',
          card:    'var(--surface-card)',
          hover:   'var(--surface-hover)',
          input:   'var(--surface-input)',
        },
        border:    { DEFAULT: 'var(--border)', focus: 'var(--border-focus)' },
        text:      { main: 'var(--text-main)', muted: 'var(--text-muted)', subtle: 'var(--text-subtle)' },
        accent:    {
          DEFAULT:   'var(--accent)',
          light:     'var(--accent-light)',
          dark:      'var(--accent-dark)',
          muted:     'var(--accent-muted)',
        },
        gold:      {
          DEFAULT:   'var(--gold)',
          light:     'var(--gold-light)',
          muted:     'var(--gold-muted)',
        },
        // Static brand colors
        rose:      { 600: '#DB2777', 700: '#BE185D', 500: '#EC4899' },
        bhub: {
          rose:    '#DB2777',
          gold:    '#CA8A04',
          'gold-d':'#d4af37',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['Outfit', 'system-ui', 'sans-serif'],
      },
      animation: {
        'fade-in': 'fade-in 0.35s ease-out',
        'slide-in': 'slide-in 0.25s ease-out',
        'spin': 'spin 0.8s linear infinite',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-in': {
          from: { opacity: '0', transform: 'translateX(-10px)' },
          to:   { opacity: '1', transform: 'translateX(0)' },
        },
      },
      boxShadow: {
        'card':       'var(--shadow-card)',
        'accent':     '0 0 20px var(--accent-muted)',
        'accent-lg':  '0 0 40px var(--accent-muted)',
      },
    },
  },
  plugins: [],
}
