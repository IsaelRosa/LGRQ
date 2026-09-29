import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // O LGRP é uma aplicação de CRUD sobre registros de laboratório: os
      // formulários dinâmicos (`FieldDef`) produzem objetos cuja forma só é
      // conhecida em tempo de execução. Tipar tudo exigiria um gerador de
      // tipos por módulo sem ganho de segurança real — o contrato fica no
      // servidor, em `api/`.
      '@typescript-eslint/no-explicit-any': 'off',
      // Os contexts exportam o hook junto do provider, padrão adotado em
      // ToastContext e AuthContext.
      'react-refresh/only-export-components': 'off',
    },
  },
  {
    // Backend em JS puro (Node): sem DOM, com globais de Node.
    files: ['api/**/*.js', 'server.js', 'scripts/**/*.mjs', 'test/**/*.mjs'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_|^req$|^res$|^next$' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
])
