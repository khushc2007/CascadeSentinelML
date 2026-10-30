// Command-line bridge used by tests/integration/test_blacksky_quantum.py: reads {"jobs": [...]} on stdin, runs the Quantum Lab engine
// on each job and prints JSON results (statevector, statistics, QASM, noisy probabilities, Grover traces). Test tooling only.
import { simulate, simulateNoisy, circuitStats, toQasm2, expandCircuit, layoutColumns } from "../../site/js/q/circuit.js";
import { runGroverCircuit, groverCircuit } from "../../site/js/q/grover.js";

let raw = ""; process.stdin.on("data", (d) => (raw += d)); process.stdin.on("end", () => {
  const { jobs } = JSON.parse(raw), out = [];
  for (const j of jobs) {
    if (j.kind === "sv") { const C = { n: j.n, ops: layoutColumns(j.ops, j.n) }, r = simulate(C, { snapshots: false });
      out.push({ re: Array.from(r.state.re), im: Array.from(r.state.im), stats: circuitStats(C), qasm: toQasm2(C), dist: Object.fromEntries(r.dist) }); }
    else if (j.kind === "noisy") { const C = expandCircuit({ n: j.n, ops: layoutColumns(j.ops, j.n) }), r = simulateNoisy(C, j.noise);
      out.push({ probs: Array.from(r.probs), dist: Object.fromEntries(r.dist), distBefore: Object.fromEntries(r.distBeforeReadout), qasm: toQasm2(C) }); }
    else if (j.kind === "grover") { const r = runGroverCircuit(j), C = groverCircuit(j);
      out.push({ pMarked: r.final.pMarked, probs: r.final.probs, qasm: toQasm2(C), statsCompiled: r.statsCompiled, statsAbstract: r.statsAbstract }); }
  }
  process.stdout.write(JSON.stringify({ results: out }));
});
