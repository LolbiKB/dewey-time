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
  },
  {
    // In frappe auth mode supabase.auth is a throwing Proxy (supabase-js
    // accessToken option) — any direct access crashes at runtime. All token
    // reads must go through lib/auth-token.ts; only the dual-mode auth
    // context and the token helper itself may touch supabase.auth.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/contexts/auth-context.tsx', 'src/lib/auth-token.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.name='supabase'][property.name='auth']",
          message:
            'supabase.auth crashes in frappe auth mode — use getAuthToken()/getAuthHeaders() from @/lib/auth-token instead.',
        },
      ],
    },
  },
])
