import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

/**
 * Configuración mínima de ESLint — prioriza detectar en automático la misma clase de
 * bugs que ya se encontraron manualmente en producción (variables sin definir, hooks mal
 * usados) en vez de imponer un estilo de código estricto. `no-undef` es la regla más
 * importante aquí: es la que hubiera detectado el `user` sin definir en AdminPage.jsx
 * antes de llegar a producción.
 */
export default [
  js.configs.recommended,
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.es2021,
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      react,
      'react-hooks': reactHooks,
    },
    rules: {
      ...react.configs.recommended.rules,
      // Solo las dos reglas clásicas y bien establecidas de react-hooks (orden/condición
      // de hooks, y dependencias de useEffect/useCallback/useMemo) — NO el set
      // "recommended" completo de la v7, que agrega reglas nuevas orientadas al React
      // Compiler (ej. prohibir setState síncrono dentro de un efecto) y generaría cientos
      // de hallazgos de estilo/patrón sin relación con los bugs reales que se buscan aquí.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'no-undef': 'error',
      'no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^_' }],
      'react/prop-types': 'off',
      'react/react-in-jsx-scope': 'off',
      'react/no-unescaped-entities': 'off',
    },
    settings: {
      react: { version: 'detect' },
    },
  },
  {
    ignores: ['dist/**', 'node_modules/**', 'functions/**'],
  },
];
