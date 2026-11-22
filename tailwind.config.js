/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,jsx,ts,tsx}', './src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        primary: '#F97316',
        primarySoft: '#FFF7ED',
        surface: '#F8FAFC',
        ink: '#18181B',
      },
    },
  },
  plugins: [],
};
