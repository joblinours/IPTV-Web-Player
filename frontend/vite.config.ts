import { defineConfig } from 'vite'
import path from 'path'
import { readFileSync } from 'node:fs'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

const pkg = JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf8')) as { version?: string }

export default defineConfig({
  plugins: [
    // The React and Tailwind plugins are both required for Make, even if
    // Tailwind is not being actively used – do not remove them
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      // Alias @ to the src directory
      '@': path.resolve(__dirname, './src'),
    },
  },

  // File types to support raw imports. Never add .css, .tsx, or .ts files to this.
  assetsInclude: ['**/*.svg', '**/*.csv'],

  define: {
    // VITE_APP_VERSION/VITE_GIT_COMMIT are injected as Docker build-args in
    // CI; falling back to package.json keeps `npm run dev`/local builds
    // showing a sensible version too.
    __APP_VERSION__: JSON.stringify(process.env.VITE_APP_VERSION || pkg.version || '0.0.0'),
    __GIT_COMMIT__: JSON.stringify(process.env.VITE_GIT_COMMIT || 'dev'),
  },
})
