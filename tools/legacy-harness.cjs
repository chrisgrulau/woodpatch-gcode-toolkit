// SPDX-FileCopyrightText: 2026 Promotional Notions Pty Ltd trading as Woodpatch House & Garden
// SPDX-License-Identifier: MIT
//
// Loads upstream's legacy AMD parser/simulator headless in Node, so Phase 1 can
// record characterisation goldens: upstream's behaviour INCLUDING its bugs
// R1–R14 (plan §2.2, Appendix A). This is test-time tooling only. It reads
// legacy/ and never ships anything from it (ADR-0005).
//
// Two `$` flavours, because upstream has two:
//   workerDollar: the worker's home-made `$` (legacy/webapp/worker.js:2-24).
//                 This is what the live simulator runs, and its `$.each` does
//                 not iterate objects, which is half of bug R1.
//   jqDollar:     a jQuery-faithful `$`, for comparison.
//
// It loads legacy/webapp/libs/jsparse.js (Chris Double, BSD-style licence per
// its header) at test time only. See LICENSES/LicenseRef-legacy-vendored.txt.
'use strict';
const fs = require('fs'),
  path = require('path');
const ROOT = path.resolve(__dirname, '../legacy/webapp');
const workerDollar = {
  each: (a, f) => {
    for (let i = 0; i < a.length; i++) f(i, a[i]);
  },
  extend: function () {
    const t = arguments[0] || {};
    for (let i = 0; i < arguments.length; i++) {
      const o = arguments[i];
      if (o != null) for (const n in o) if (o[n] !== undefined) t[n] = o[n];
    }
    return t;
  },
};
const jqDollar = {
  each: (o, f) => {
    if (Array.isArray(o) || typeof o.length === 'number') {
      for (let i = 0; i < o.length; i++) if (f(i, o[i]) === false) break;
    } else {
      for (const k in o) if (Object.hasOwn(o, k) && f(k, o[k]) === false) break;
    }
  },
  extend: workerDollar.extend,
};
function load(dollar) {
  global.$ = dollar;
  const cache = {};
  function req(name) {
    if (name === 'require') return { toUrl: (s) => s };
    if (name === 'libs/jsparse') {
      delete require.cache[require.resolve(path.join(ROOT, 'libs/jsparse.js'))];
      return require(path.join(ROOT, 'libs/jsparse.js'));
    }
    if (cache[name]) return cache[name];
    const src = fs.readFileSync(path.join(ROOT, name + '.js'), 'utf8');
    let mod;
    const define = (deps, factory) => {
      if (typeof deps === 'function') {
        factory = deps;
        deps = [];
      }
      mod = factory.apply(null, deps.map(req));
    };
    define.amd = true;
    new Function('define', '$', 'console', src)(define, dollar, console);
    return (cache[name] = mod);
  }
  return {
    parser: req('cnc/gcode/parser'),
    simulation: req('cnc/gcode/simulation'),
    gcodeSimulation: req('cnc/gcode/gcodeSimulation'),
    util: req('cnc/util'),
  };
}
module.exports = { load, workerDollar, jqDollar };
// usage:
// const { load, workerDollar } = require("./legacy-harness");
// const m = load(workerDollar); const errors = [];
// const path = m.parser.evaluate(fs.readFileSync(file, "utf8"), null, null, null, errors);
// const r = m.gcodeSimulation.simulateGCode(code, new m.util.Point(0,0,0), fragment => {/* Float32 vertices */});
