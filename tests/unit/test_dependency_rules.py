"""V2 20.1 module-boundary rules, enforced statically (stand-in for import-linter, which is not installable offline)."""
import ast, pathlib
ROOT = pathlib.Path(__file__).resolve().parents[2] / "doomsday"

def imports(path):
    tree = ast.parse(path.read_text()); out = []
    for n in ast.walk(tree):
        if isinstance(n, ast.Import): out += [a.name for a in n.names]
        elif isinstance(n, ast.ImportFrom):
            base = ("." * n.level) + (n.module or ""); out.append(base)
            out += [(f"{base}{a.name}" if n.module is None else f"{base}.{a.name}") for a in n.names]
    return out

def resolve(path, name):
    if not name.startswith("."): return name
    parts = list(path.relative_to(ROOT.parent).with_suffix("").parts)[:-1]
    up = len(name) - len(name.lstrip("."))
    base = parts[: len(parts) - (up - 1)]
    return ".".join(base + ([name.lstrip(".")] if name.lstrip(".") else []))

def mods(pkg):
    d = ROOT / pkg
    return sorted(d.rglob("*.py")) if d.exists() else []

def test_gridtwin_has_no_quantum_or_upstream_imports():
    for f in mods("gridtwin"):
        for i in imports(f):
            r = resolve(f, i)
            assert not r.startswith(("qiskit", "doomsday.qsearch", "doomsday.classical", "doomsday.oracle", "doomsday.resource", "pandapower")), (f, r)

def test_interface_is_independent_of_the_grid_implementation():
    f = ROOT / "oracle" / "interface.py"
    for i in imports(f):
        r = resolve(f, i)
        assert not r.startswith(("doomsday.gridtwin", "doomsday.config", "scipy", "networkx", "qiskit")), r

def test_search_packages_depend_only_on_oracle_interface():
    for pkg in ("qsearch", "classical"):
        for f in mods(pkg):
            for i in imports(f):
                r = resolve(f, i)
                if r.startswith("doomsday."):
                    assert r.startswith(("doomsday.oracle.interface", f"doomsday.{pkg}", "doomsday.experiments.ranking_metrics")), (f, r)

def test_resource_never_imports_gridtwin_or_oracle_impls():
    for f in mods("resource"):
        for i in imports(f):
            assert not resolve(f, i).startswith(("doomsday.gridtwin", "doomsday.oracle", "doomsday.qsearch", "doomsday.classical")), (f, i)

def test_the_checker_itself_detects_a_violation():
    import tempfile
    with tempfile.TemporaryDirectory() as d:
        p = pathlib.Path(d) / "x.py"; p.write_text("from doomsday.gridtwin.base import build_base_point\nimport qiskit\n")
        r = [resolve(p.with_name("x.py"), i) if i.startswith(".") else i for i in imports(p)]
        assert any(x.startswith("doomsday.gridtwin") for x in r) and "qiskit" in r


def test_relative_import_resolution_is_correct():
    f = ROOT / "classical" / "api.py"
    assert resolve(f, ".methods_basic") == "doomsday.classical.methods_basic"
    assert resolve(f, "..oracle.interface") == "doomsday.oracle.interface"
    assert resolve(f, "..gridtwin.base") == "doomsday.gridtwin.base"
    assert resolve(ROOT / "oracle" / "interface.py", "..config") == "doomsday.config"
    import tempfile
    from_dot = ast.parse("from . import methods_basic as mb, methods_structural as ms")
    names = []
    for n in ast.walk(from_dot):
        if isinstance(n, ast.ImportFrom): names = [(f"{'.' * n.level}{a.name}" if n.module is None else a.name) for a in n.names]
    assert names == [".methods_basic", ".methods_structural"]
