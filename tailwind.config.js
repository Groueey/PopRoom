/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,jsx,ts,tsx}', './src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        primary: '#F2843A',
        primaryDeep: '#D96820',
        primarySoft: '#FFF6EE',
        primaryMist: '#FFFBF7',
        primaryBorder: '#FCDCC3',
        surface: '#FAF7F4',
        ink: '#26201B',
        inkMuted: '#73685F',
        inkSubtle: '#A3988F',
        line: '#EFE8E1',
        lineSoft: '#F6F1EC',
      },
    },
  },
  plugins: [],
};
