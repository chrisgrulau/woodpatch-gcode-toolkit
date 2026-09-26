// SPDX-FileCopyrightText: 2026 Promotional Notions Pty Ltd trading as Woodpatch House & Garden
// SPDX-License-Identifier: MIT

import type { Diagnostic, ExpressionValue, Line, OWordToken } from '../syntax/types.js';

/**
 * The static structure of a program's O-word control flow (parcel 2c-3, ADR-0021):
 * which `if` goes with which `elseif`/`else`/`endif`, which loop a `break` leaves,
 * where each subroutine starts and ends.
 *
 * LinuxCNC finds these at run time by seeking through the file for a label
 * (`interp_o_word.cc`: `control_back_to`, `control_skip_to`). The whole program is in
 * memory here, so it is matched once, up front, and the interpreter just follows the
 * indices. The scoping follows LinuxCNC:
 *
 * - subroutine labels (`sub`/`endsub`, `call`) are global;
 * - control-flow labels are local to the subroutine body, or the main program, they
 *   appear in, so `o100 if` may be reused in different subroutines;
 * - within one scope, a label names one block only ("duplicate O-word label");
 * - subroutine definitions may not be nested.
 *
 * A line whose structure is wrong gets `broken` and an error. The interpreter stops
 * when it reaches one, as LinuxCNC does: carrying on would run code that should have
 * been skipped, or skip code that should have run.
 */

export type FlowKind =
  | 'sub'
  | 'endsub'
  | 'call'
  | 'return'
  | 'if'
  | 'elseif'
  | 'else'
  | 'endif'
  | 'while'
  | 'endwhile'
  | 'do'
  /** The `while` that closes a `do` loop. */
  | 'do-while'
  | 'repeat'
  | 'endrepeat'
  | 'break'
  | 'continue'
  /** A bare `O1000`: a program number, with no effect. */
  | 'program';

export interface FlowOp {
  /** Mutable only so the index can turn a `while` into the `do-while` that closes a `do`. */
  kind: FlowKind;
  /** Normalised label: `o0100` → "100", `o<My Sub>` → "mysub". */
  readonly label: string;
  /** The bracketed arguments or condition after the O-word, in order. */
  readonly args: readonly ExpressionValue[];
  /** True when other words share the line (LinuxCNC: undefined behaviour); they are ignored. */
  readonly extraWords: boolean;
  /**
   * The line index this op jumps to or pairs with. Per kind:
   * - sub: its endsub. if/elseif/else: the next branch, or the endif.
   * - while: its endwhile. endwhile: its while. do: its closing while.
   * - do-while: its do. repeat: its endrepeat. endrepeat: its repeat.
   * - break/continue: the loop's opening line.
   * - return/endsub: the sub line. elseif/else also record their endif in `end`.
   */
  target: number;
  /** For if-chain branches and loops: the line index of the block's closing line. */
  end: number;
  /** Structure error: the interpreter stops here. */
  broken: boolean;
}

export interface SubDefinition {
  /** Index of the `sub` line. */
  readonly start: number;
  /** Index of the `endsub` line. */
  readonly end: number;
}

export interface FlowIndex {
  /** One entry per line index; undefined for lines without an O-word. */
  readonly ops: readonly (FlowOp | undefined)[];
  /** Subroutines defined in this program, by label. */
  readonly subs: ReadonlyMap<string, SubDefinition>;
  readonly diagnostics: readonly Diagnostic[];
}

/** `o0100` → "100"; `o<My Sub>` → "mysub" (LinuxCNC lower-cases names and drops spaces). */
export function normaliseLabel(text: string): string {
  if (text.startsWith('<')) return text.slice(1, -1).replace(/[ \t]/g, '').toLowerCase();
  return String(Number(text));
}

interface OpenBlock {
  readonly kind: 'if' | 'while' | 'do' | 'repeat';
  readonly label: string;
  readonly index: number;
  /** if: the if and each elseif/else, in order. */
  readonly branches: number[];
  hasElse: boolean;
  /** break/continue ops waiting for the loop's end. */
  readonly exits: FlowOp[];
}

interface Scope {
  readonly blocks: OpenBlock[];
  /** Labels already used by a control-flow block in this scope. */
  readonly used: Map<string, number>;
  /** The subroutine this scope is the body of, or null for the main program. */
  readonly sub: { readonly label: string; readonly index: number } | null;
}

/** Matches every O-word in `lines`. Pure: the same lines always give the same index. */
export function buildFlowIndex(lines: readonly Line[]): FlowIndex {
  const ops: (FlowOp | undefined)[] = new Array<FlowOp | undefined>(lines.length);
  const subs = new Map<string, SubDefinition>();
  const diagnostics: Diagnostic[] = [];
  const main: Scope = { blocks: [], used: new Map(), sub: null };
  let scope = main;

  const fail = (op: FlowOp, lineNo: number, code: string, message: string) => {
    op.broken = true;
    diagnostics.push({ severity: 'error', code, message, line: lineNo });
  };
  /** A new control-flow block: its label must not already name another block here. */
  const open = (op: FlowOp, i: number, lineNo: number, kind: OpenBlock['kind']) => {
    const prior = scope.used.get(op.label);
    if (prior !== undefined) {
      fail(
        op,
        lineNo,
        'SEMANTIC_OWORD_DUPLICATE_LABEL',
        `O-word label ${op.label} already names the block at line ${(lines[prior]?.lineNo ?? 0).toString()}`,
      );
      return;
    }
    scope.used.set(op.label, i);
    scope.blocks.push({
      kind,
      label: op.label,
      index: i,
      branches: [i],
      hasElse: false,
      exits: [],
    });
  };
  /** The innermost open block, which must be `kind` with this op's label. */
  const top = (op: FlowOp, lineNo: number, kinds: readonly OpenBlock['kind'][]) => {
    const b = scope.blocks[scope.blocks.length - 1];
    if (b && b.label === op.label && kinds.includes(b.kind)) return b;
    fail(
      op,
      lineNo,
      'SEMANTIC_OWORD_UNMATCHED',
      `o${op.label} ${op.kind} does not match an open ${kinds.join('/')} o${op.label}`,
    );
    return undefined;
  };
  const closeScope = (s: Scope) => {
    for (const b of s.blocks) {
      const op = ops[b.index];
      if (op)
        fail(
          op,
          lines[b.index]?.lineNo ?? 0,
          'SEMANTIC_OWORD_UNCLOSED',
          `o${b.label} ${b.kind} is never closed`,
        );
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    let oword: OWordToken | undefined;
    for (const t of line.tokens) {
      if (t.kind === 'oword') {
        oword = t;
        break;
      }
    }
    if (!oword) continue;
    const args: ExpressionValue[] = [];
    let extraWords = false;
    for (const t of line.tokens) {
      if (t.kind === 'argument') args.push(t.value);
      else if (t.kind === 'word' && t.letter !== 'N') extraWords = true;
      else if (t.kind === 'assignment') extraWords = true;
    }
    const op: FlowOp = {
      kind: flowKind(oword.keyword),
      label: normaliseLabel(line.text.slice(oword.label.start, oword.label.end)),
      args,
      extraWords,
      target: -1,
      end: -1,
      broken: false,
    };
    ops[i] = op;
    const n = line.lineNo;

    switch (op.kind) {
      case 'sub':
        if (scope.sub) {
          fail(
            op,
            n,
            'SEMANTIC_OWORD_NESTED_SUB',
            `Subroutine o${op.label} is defined inside subroutine o${scope.sub.label}: definitions cannot be nested`,
          );
          break;
        }
        if (subs.has(op.label)) {
          fail(op, n, 'SEMANTIC_OWORD_DUPLICATE_SUB', `Subroutine o${op.label} is defined twice`);
          break;
        }
        scope = { blocks: [], used: new Map(), sub: { label: op.label, index: i } };
        break;
      case 'endsub': {
        const s = scope.sub;
        if (!s || s.label !== op.label) {
          fail(
            op,
            n,
            'SEMANTIC_OWORD_UNMATCHED',
            s
              ? `o${op.label} endsub does not match subroutine o${s.label}`
              : `o${op.label} endsub is not in a subroutine definition`,
          );
          break;
        }
        closeScope(scope);
        op.target = s.index;
        const subOp = ops[s.index];
        if (subOp) subOp.target = i;
        subs.set(s.label, { start: s.index, end: i });
        scope = main;
        break;
      }
      case 'return':
        if (!scope.sub || scope.sub.label !== op.label) {
          fail(
            op,
            n,
            'SEMANTIC_OWORD_UNMATCHED',
            `o${op.label} return is not inside subroutine o${op.label}`,
          );
        } else op.target = scope.sub.index;
        break;
      case 'if':
        open(op, i, n, 'if');
        break;
      case 'elseif':
      case 'else': {
        const b = top(op, n, ['if']);
        if (!b) break;
        if (b.hasElse) {
          fail(
            op,
            n,
            'SEMANTIC_OWORD_AFTER_ELSE',
            `o${op.label} ${op.kind} after o${op.label} else`,
          );
          break;
        }
        if (op.kind === 'else') b.hasElse = true;
        b.branches.push(i);
        break;
      }
      case 'endif': {
        const b = top(op, n, ['if']);
        if (!b) break;
        scope.blocks.pop();
        // Each branch points at the next one; the last at the endif. All know the endif.
        b.branches.forEach((at, k) => {
          const bop = ops[at];
          if (!bop) return;
          bop.target = b.branches[k + 1] ?? i;
          bop.end = i;
        });
        break;
      }
      case 'while': {
        // A while that closes an open do with the same label ends that loop.
        const b = scope.blocks[scope.blocks.length - 1];
        if (b && b.kind === 'do' && b.label === op.label) {
          scope.blocks.pop();
          op.kind = 'do-while';
          op.target = b.index;
          op.end = i;
          const doOp = ops[b.index];
          if (doOp) {
            doOp.target = i;
            doOp.end = i;
          }
          for (const x of b.exits) x.end = i;
        } else open(op, i, n, 'while');
        break;
      }
      case 'endwhile': {
        const b = top(op, n, ['while']);
        if (!b) break;
        scope.blocks.pop();
        op.target = b.index;
        op.end = i;
        const w = ops[b.index];
        if (w) {
          w.target = i;
          w.end = i;
        }
        for (const x of b.exits) x.end = i;
        break;
      }
      case 'do':
        open(op, i, n, 'do');
        break;
      case 'repeat':
        open(op, i, n, 'repeat');
        break;
      case 'endrepeat': {
        const b = top(op, n, ['repeat']);
        if (!b) break;
        scope.blocks.pop();
        op.target = b.index;
        op.end = i;
        const r = ops[b.index];
        if (r) {
          r.target = i;
          r.end = i;
        }
        break;
      }
      case 'break':
      case 'continue': {
        // LinuxCNC: break and continue name a while or do loop (not repeat).
        let loop: OpenBlock | undefined;
        for (let k = scope.blocks.length - 1; k >= 0; k--) {
          const b = scope.blocks[k];
          if (b && b.label === op.label) {
            loop = b;
            break;
          }
        }
        if (!loop || (loop.kind !== 'while' && loop.kind !== 'do')) {
          fail(
            op,
            n,
            'SEMANTIC_OWORD_UNMATCHED',
            `o${op.label} ${op.kind} is not inside a while or do loop o${op.label}`,
          );
          break;
        }
        op.target = loop.index;
        loop.exits.push(op);
        break;
      }
      case 'call':
      case 'program':
        break;
    }
  }
  if (scope !== main) {
    const s = scope.sub;
    const op = s ? ops[s.index] : undefined;
    if (s && op)
      fail(
        op,
        lines[s.index]?.lineNo ?? 0,
        'SEMANTIC_OWORD_UNCLOSED',
        `Subroutine o${s.label} has no endsub`,
      );
    closeScope(scope);
  }
  closeScope(main);
  return { ops, subs, diagnostics };
}

function flowKind(keyword: string | null): FlowKind {
  return keyword === null ? 'program' : (keyword as FlowKind);
}
