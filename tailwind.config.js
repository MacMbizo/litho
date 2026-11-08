/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        notion: {
          bg: {
            light: '#ffffff',
            dark: '#191919'
          },
          sidebar: {
            light: '#f7f6f3',
            dark: '#202020'
          },
          border: {
            light: '#e9e9e7',
            dark: '#2f2f2f'
          },
          hover: {
            light: '#efedea',
            dark: '#2c2c2c'
          },
          text: {
            light: '#37352f',
            dark: '#d4d4d4'
          },
          muted: {
            light: '#787774',
            dark: '#9b9b9b'
          }
        }
      },
      fontFamily: {
        sans: [
          'Inter',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Helvetica',
          '"Apple Color Emoji"',
          'Arial',
          'sans-serif'
        ],
        mono: [
          'JetBrains Mono',
          'Fira Code',
          'Consolas',
          'monospace'
        ]
      }
    },
  },
  plugins: [],
}
