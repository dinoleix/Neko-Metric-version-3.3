/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './index.tsx',
    './App.tsx',
    './components/**/*.{ts,tsx}',
  ],
  // Classes built from template literals (`text-${color}-600` in BankReconciliation,
  // `bg-${colorMap[type]}-50` in DataCatalog) are invisible to the content scanner
  // and must be safelisted or they silently lose styling.
  safelist: [
    { pattern: /^text-(indigo|violet|slate|emerald|amber|rose|orange)-600$/ },
    { pattern: /^bg-(indigo|violet|slate|emerald|amber|rose|orange)-(50|400|500)$/ },
    { pattern: /^border-(indigo|violet|slate|emerald|amber|rose|orange)-100$/ },
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};
