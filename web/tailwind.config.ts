import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // White-label overrideable via CSS variables
        primary: 'rgb(var(--color-primary) / <alpha-value>)',
        accent:  'rgb(var(--color-accent)  / <alpha-value>)',
      },
    },
  },
  plugins: [],
} satisfies Config
