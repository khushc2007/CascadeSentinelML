"""Every accounting(...) call in the experiment modules uses only the five registered cost classes (+ notes); checked statically so a typo
cannot surface only at the end of a long run."""
import ast, pathlib
from doomsday.experiments.framework import ACCOUNTING_KEYS

def test_accounting_calls_use_registered_keys():
    root = pathlib.Path(__file__).resolve().parents[2] / "doomsday" / "experiments"; bad = []
    for f in root.glob("*.py"):
        for n in ast.walk(ast.parse(f.read_text())):
            if isinstance(n, ast.Call) and getattr(n.func, "id", None) == "accounting":
                bad += [(f.name, kw.arg) for kw in n.keywords if kw.arg not in set(ACCOUNTING_KEYS) | {"notes"}]
    assert not bad, bad
