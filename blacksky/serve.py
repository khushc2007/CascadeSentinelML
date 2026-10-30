"""BLACKSKY COMMAND local server: serves the static site (blacksky/site) at /, mounts the existing Grid Doomsday Finder API, unchanged, at
/api, and adds BLACKSKY's own small API at /bsapi, so the site and the optional Python services share one origin (no CORS, no credentials).

    PYTHONPATH=. uvicorn blacksky.serve:app --port 8010        (or: make blacksky-serve)

/bsapi (optional; the static site works without it):
    GET  /bsapi/health                 -> {"status": "ok", "qiskit": "<version>" | null}
    POST /bsapi/quantum/transpile      -> transpiled-circuit statistics from Qiskit for a Quantum Lab circuit (bounded: <= 12 qubits,
                                          <= 4000 operations, whitelisted gates only; no code is evaluated)

The original application (doomsday/api/app.py, app/) is imported, not modified; it keeps serving its own front end at
http://localhost:8000/ through `make serve`. Environment: BLACKSKY_SITE_DIR overrides the static directory (default blacksky/site);
GDF_APP_DIR / GDF_DATA_DIR are read by the original API exactly as before.
"""
from __future__ import annotations
import os
from pathlib import Path
from typing import List, Literal
from fastapi import APIRouter, FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from doomsday.api.app import app as gdf_api

SITE_DIR = Path(os.environ.get("BLACKSKY_SITE_DIR", Path(__file__).resolve().parent / "site"))
MAX_QUBITS, MAX_OPS = 12, 4000
ONE = {"x", "y", "z", "h", "s", "sdg", "t", "tdg", "rx", "ry", "rz", "p"}
TWO = {"cx", "cz", "cp", "swap"}

try:  # optional dependency
    import qiskit  # type: ignore
    QISKIT = qiskit.__version__
except Exception:  # noqa: BLE001
    qiskit, QISKIT = None, None

bsapi = APIRouter()


class Op(BaseModel):
    g: Literal["x", "y", "z", "h", "s", "sdg", "t", "tdg", "rx", "ry", "rz", "p", "cx", "cz", "cp", "swap", "mcz", "measure", "barrier"]
    q: List[int] = Field(default_factory=list, max_length=MAX_QUBITS)
    c: List[int] = Field(default_factory=list, max_length=MAX_QUBITS)
    p: List[float] = Field(default_factory=list, max_length=1)


class TranspileRequest(BaseModel):
    n: int = Field(ge=1, le=MAX_QUBITS)
    ops: List[Op] = Field(max_length=MAX_OPS)
    optimization_level: int = Field(default=1, ge=0, le=3)


@bsapi.get("/health")
def health():
    return {"status": "ok", "qiskit": QISKIT, "limits": {"qubits": MAX_QUBITS, "operations": MAX_OPS}}


def build_circuit(req: TranspileRequest):
    from qiskit import QuantumCircuit  # type: ignore
    import math
    qc = QuantumCircuit(req.n, req.n)
    for i, o in enumerate(req.ops):
        wires = list(o.c) + list(o.q)
        if any(w < 0 or w >= req.n for w in wires) or len(set(wires)) != len(wires):
            raise HTTPException(422, f"operation {i + 1}: qubit index out of range or repeated")
        if o.p and not all(math.isfinite(v) for v in o.p):
            raise HTTPException(422, f"operation {i + 1}: parameters must be finite")
        if o.g in ONE:
            if len(o.q) != 1 or o.c: raise HTTPException(422, f"operation {i + 1}: {o.g} needs one target")
            getattr(qc, o.g)(*(o.p if o.g in ("rx", "ry", "rz", "p") else []), o.q[0])
        elif o.g in ("cx", "cz", "cp"):
            if len(o.q) != 1 or len(o.c) != 1: raise HTTPException(422, f"operation {i + 1}: {o.g} needs one control and one target")
            if o.g == "cp": qc.cp(o.p[0] if o.p else 0.0, o.c[0], o.q[0])
            else: getattr(qc, o.g)(o.c[0], o.q[0])
        elif o.g == "swap":
            if len(o.q) != 2: raise HTTPException(422, f"operation {i + 1}: swap needs two qubits")
            qc.swap(o.q[0], o.q[1])
        elif o.g == "mcz":
            qs = list(o.c) + list(o.q)
            if len(qs) == 1: qc.z(qs[0])
            else: qc.h(qs[-1]); qc.mcx(qs[:-1], qs[-1]); qc.h(qs[-1])
        elif o.g == "measure":
            if len(o.q) != 1: raise HTTPException(422, f"operation {i + 1}: measure needs one qubit")
            qc.measure(o.q[0], o.q[0])
        elif o.g == "barrier":
            qc.barrier(*(o.q or range(req.n)))
    return qc


@bsapi.post("/quantum/transpile")
def transpile_stats(req: TranspileRequest):
    if qiskit is None:
        raise HTTPException(503, "Qiskit is not installed on this server")
    from qiskit import transpile  # type: ignore
    basis = ["cx", "rz", "sx", "x"]
    qc = build_circuit(req)
    tq = transpile(qc, basis_gates=basis, optimization_level=req.optimization_level, seed_transpiler=11)
    counts = {k: int(v) for k, v in tq.count_ops().items()}
    return {"basis": basis, "optimization_level": req.optimization_level, "depth": tq.depth(), "size": tq.size(), "two_qubit": counts.get("cx", 0),
            "counts": counts, "qiskit": QISKIT, "coupling_map": None, "note": "all-to-all connectivity; no device calibration"}


app = FastAPI(title="BLACKSKY COMMAND", description="Static BLACKSKY site at /, Grid Doomsday Finder API at /api (unchanged), BLACKSKY API at /bsapi.", docs_url=None, redoc_url=None)
app.include_router(bsapi, prefix="/bsapi")
app.mount("/api", gdf_api, name="gdf-api")
app.mount("/", StaticFiles(directory=str(SITE_DIR), html=True), name="blacksky")
