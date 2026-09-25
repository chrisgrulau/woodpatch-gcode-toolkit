// SPDX-FileCopyrightText: 2026 Promotional Notions Pty Ltd trading as Woodpatch House & Garden
// SPDX-License-Identifier: MIT

/**
 * Where this toolkit comes from, as data rather than prose.
 *
 * Every surface that shows the toolkit (the playground and any consuming application)
 * should render its credit line from this object instead of hard-coding one,
 * so the wording, the upstream link and the licence stay the same everywhere
 * and have one place to change.
 *
 * Under the MIT election (ADR-0001) a visible credit is courtesy, not an
 * obligation. What MIT does require (the copyright and permission notice
 * travelling with the code) is handled by the build: see the `/*! *\/`
 * banner in scripts/build-package.mjs and the CI check that it survives
 * minification.
 */
export const ATTRIBUTION = Object.freeze({
  /** Human-readable credit line, suitable for a footer or an About dialog. */
  credit: 'Based on webgcode by Nicolas Raynaud',
  upstream: Object.freeze({
    name: 'webgcode',
    author: 'Nicolas Raynaud',
    url: 'https://github.com/nraynaud/webgcode',
    /** Upstream's own offer: recipients choose either licence. */
    licence: 'MIT OR AGPL-3.0',
  }),
  /** SPDX identifier of the licence this toolkit is distributed under. */
  licence: 'MIT',
});

export type Attribution = typeof ATTRIBUTION;
