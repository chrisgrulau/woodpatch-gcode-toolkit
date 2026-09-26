// SPDX-FileCopyrightText: 2026 Promotional Notions Pty Ltd trading as Woodpatch House & Garden
// SPDX-License-Identifier: MIT
import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths: the site works wherever it's served (a Pages sub-path).
  base: './',
  build: {
    target: 'es2022',
    sourcemap: true,
    // Keep /*! legal comments: MIT's notice must travel with the built bundle
    // (ADR-0009). scripts/check-notice.mjs proves it did.
    rollupOptions: { output: { comments: { legal: true } } },
  },
  worker: {
    format: 'es',
    rollupOptions: { output: { comments: { legal: true } } },
  },
});
