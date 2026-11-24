/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,jsx,ts,tsx}', './src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        primary: '#E05A2B',
        primaryDeep: '#C4481D',
        primarySoft: '#FDF1EC',
        primaryMist: '#FAF8F5',
        primaryBorder: '#F5D5C8',
        surface: '#F6F5F2',
        ink: '#1F1D1A',
        inkMuted: '#66615B',
        inkSubtle: '#9A938C',
        line: '#EAE6DF',
        lineSoft: '#F2EFEA',
      },
    },
  },
  plugins: [],
};
