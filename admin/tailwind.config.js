/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        warm: {
          50: '#fefcf8',
          100: '#faf6ee',
          200: '#f0e7d8',
          800: '#3d3226',
          900: '#2b2117',
        },
        accent: {
          DEFAULT: '#d4844a',
          hover: '#b9682f',
          light: '#f3e6d6',
        },
      },
    },
  },
  plugins: [],
};
