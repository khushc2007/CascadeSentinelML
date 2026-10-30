// @ts-check
// Gate set of the Quantum Lab. Matrices follow Qiskit's definitions (RZ(θ) = diag(e^{-iθ/2}, e^{iθ/2}), P(λ) = diag(1, e^{iλ})), so the
// statevectors compare directly with qiskit.quantum_info.Statevector (checked in tests/integration/test_blacksky_quantum.py).
// A 2×2 complex matrix is stored as [re00, im00, re01, im01, re10, im10, re11, im11].

const S2 = Math.SQRT1_2;
/** @typedef {number[]} M2 */
/** @type {Record<string, (p: number[]) => M2>} */
export const MATRIX = {
  id: () => [1, 0, 0, 0, 0, 0, 1, 0],
  x: () => [0, 0, 1, 0, 1, 0, 0, 0],
  y: () => [0, 0, 0, -1, 0, 1, 0, 0],
  z: () => [1, 0, 0, 0, 0, 0, -1, 0],
  h: () => [S2, 0, S2, 0, S2, 0, -S2, 0],
  s: () => [1, 0, 0, 0, 0, 0, 0, 1],
  sdg: () => [1, 0, 0, 0, 0, 0, 0, -1],
  t: () => [1, 0, 0, 0, 0, 0, S2, S2],
  tdg: () => [1, 0, 0, 0, 0, 0, S2, -S2],
  rx: ([t]) => [Math.cos(t / 2), 0, 0, -Math.sin(t / 2), 0, -Math.sin(t / 2), Math.cos(t / 2), 0],
  ry: ([t]) => [Math.cos(t / 2), 0, -Math.sin(t / 2), 0, Math.sin(t / 2), 0, Math.cos(t / 2), 0],
  rz: ([t]) => [Math.cos(t / 2), -Math.sin(t / 2), 0, 0, 0, 0, Math.cos(t / 2), Math.sin(t / 2)],
  p: ([l]) => [1, 0, 0, 0, 0, 0, Math.cos(l), Math.sin(l)],
};

/**
 * @typedef {{ name: string, label: string, kind: "1q"|"c1q"|"swap"|"mcp"|"measure"|"barrier", nq: number, params: string[], base?: string,
 *   qasm: string, title: string, palette: boolean }} GateDef
 */
/** @type {Record<string, GateDef>} */
export const GATES = {
  x: { name: "x", label: "X", kind: "1q", nq: 1, params: [], qasm: "x", title: "Pauli-X (bit flip)", palette: true },
  y: { name: "y", label: "Y", kind: "1q", nq: 1, params: [], qasm: "y", title: "Pauli-Y", palette: true },
  z: { name: "z", label: "Z", kind: "1q", nq: 1, params: [], qasm: "z", title: "Pauli-Z (phase flip)", palette: true },
  h: { name: "h", label: "H", kind: "1q", nq: 1, params: [], qasm: "h", title: "Hadamard", palette: true },
  s: { name: "s", label: "S", kind: "1q", nq: 1, params: [], qasm: "s", title: "S = √Z (phase π/2)", palette: true },
  sdg: { name: "sdg", label: "S†", kind: "1q", nq: 1, params: [], qasm: "sdg", title: "S dagger", palette: false },
  t: { name: "t", label: "T", kind: "1q", nq: 1, params: [], qasm: "t", title: "T = √S (phase π/4)", palette: true },
  tdg: { name: "tdg", label: "T†", kind: "1q", nq: 1, params: [], qasm: "tdg", title: "T dagger", palette: false },
  rx: { name: "rx", label: "Rx", kind: "1q", nq: 1, params: ["θ"], qasm: "rx", title: "Rotation about X by θ", palette: true },
  ry: { name: "ry", label: "Ry", kind: "1q", nq: 1, params: ["θ"], qasm: "ry", title: "Rotation about Y by θ", palette: true },
  rz: { name: "rz", label: "Rz", kind: "1q", nq: 1, params: ["θ"], qasm: "rz", title: "Rotation about Z by θ (Qiskit convention)", palette: true },
  p: { name: "p", label: "P", kind: "1q", nq: 1, params: ["λ"], qasm: "u1", title: "Phase gate diag(1, e^{iλ})", palette: false },
  cx: { name: "cx", label: "CX", kind: "c1q", nq: 2, base: "x", params: [], qasm: "cx", title: "CNOT: X on the target when the control is 1", palette: true },
  cz: { name: "cz", label: "CZ", kind: "c1q", nq: 2, base: "z", params: [], qasm: "cz", title: "Controlled-Z", palette: false },
  cp: { name: "cp", label: "CP", kind: "c1q", nq: 2, base: "p", params: ["λ"], qasm: "cu1", title: "Controlled phase diag(1,1,1,e^{iλ})", palette: true },
  swap: { name: "swap", label: "SWAP", kind: "swap", nq: 2, params: [], qasm: "swap", title: "Swap two qubits", palette: false },
  mcz: { name: "mcz", label: "MCZ", kind: "mcp", nq: -1, params: [], qasm: "", title: "Multi-controlled Z (phase −1 on |1…1⟩); exported as its CX/P decomposition", palette: false },
  measure: { name: "measure", label: "M", kind: "measure", nq: 1, params: [], qasm: "measure", title: "Measure in the computational basis (terminal only)", palette: true },
  barrier: { name: "barrier", label: "║", kind: "barrier", nq: -1, params: [], qasm: "barrier", title: "Barrier (visual and scheduling aid; no operation)", palette: true },
};
export const PALETTE = Object.values(GATES).filter((g) => g.palette).map((g) => g.name);
/** Two-or-more-qubit gates (for "two-qubit gate count"). @param {string} g */
export const isMulti = (g) => ["cx", "cz", "cp", "swap", "mcz"].includes(g);
