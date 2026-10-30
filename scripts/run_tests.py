"""Minimal pytest-free runner (used only where pytest cannot be installed). Real CI uses `pytest`."""
import importlib.util, pathlib, sys, time, traceback
root = pathlib.Path(__file__).resolve().parent.parent
sys.path[:0] = [str(root), str(root / "tests")]
FILTERS = sys.argv[1:]          # optional: only run test files whose name contains one of these substrings
failed, skipped, n = [], [], 0
for f in sorted((root / "tests").rglob("test_*.py")):
    if FILTERS and not any(x in f.stem for x in FILTERS): continue
    spec = importlib.util.spec_from_file_location(f.stem, f); mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    for name in sorted(dir(mod)):
        if name.startswith("test_") and callable(getattr(mod, name)):
            n += 1; t = time.time()
            try:
                getattr(mod, name)(); print(f"PASS {f.stem}::{name} ({time.time()-t:.2f}s)")
            except Exception as e:
                if type(e).__name__ in ("Skipped", "SkipTest"):
                    skipped.append(f"{f.stem}::{name}"); print(f"SKIP {f.stem}::{name}: {e}"); continue
                failed.append(f"{f.stem}::{name}"); print(f"FAIL {f.stem}::{name}"); traceback.print_exc()
print(f"\n{n - len(failed) - len(skipped)} passed, {len(failed)} failed, {len(skipped)} skipped, {n} total")
sys.exit(1 if failed else 0)
