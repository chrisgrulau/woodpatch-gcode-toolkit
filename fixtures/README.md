<!--
SPDX-FileCopyrightText: 2026 Promotional Notions Pty Ltd trading as Woodpatch House & Garden
SPDX-License-Identifier: MIT
-->

# Test fixtures

| Path             | What                                                                                                                                                                                                  |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `upstream/`      | webgcode's own sample programs, copied from `legacy/webapp/samples/`. They carry upstream's licence (MIT OR AGPL-3.0).                                                                                |
| `synthetic/`     | Small hand-written programs, one per upstream defect (R1–R9), per behaviour upstream gets right, and per encoding edge case. [`synthetic/index.json`](synthetic/index.json) says what each one tests. |
| `golden/legacy/` | Recorded outputs of upstream's own parser on the files above: characterisation of upstream, bugs included. Regenerated only by `tools/golden-legacy.cjs`.                                             |

**Rules**

- Files here are parser inputs and are stored byte-for-byte (`.gitattributes`: `-text`).
  Don't reformat them, add headers to them or fix their line endings. Some cases test
  exactly those bytes.
- **No customer or proprietary G-code, ever**, not even anonymised. This repository
  is public, and its history is permanent. Real job files live in a separate private
  fixtures repository.
