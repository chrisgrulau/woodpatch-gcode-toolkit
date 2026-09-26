// SPDX-FileCopyrightText: 2026 Promotional Notions Pty Ltd trading as Woodpatch House & Garden
// SPDX-License-Identifier: MIT
import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths: the site works wherever it's served (a Pages sub-path).
  base: './',
  build: {
    target: 'es2022',
    // Maps are built for local debugging but not referenced from the bundles, and the
    // deploy leaves them out: no dangling sourceMappingURL on the public site.
    sourcemap: 'hidden',
    // Keep /*! legal comments: MIT's notice must travel with the built bundle
    // (ADR-0009). scripts/check-notice.mjs proves it did.
    rolldownOptions: { output: { comments: { legal: true } } },
  },
  worker: {
    format: 'es',
    rolldownOptions: { output: { comments: { legal: true } } },
  },
});
