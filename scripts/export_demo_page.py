"""Export the web demo for hosting inside a document skeleton (e.g. a published page): strips <!doctype>, <html>, <head>, <body> wrappers from
app/index.html, inlines the vendored map stylesheet, and copies js/, data/ and vendor/ next to it. The repository copy (app/index.html) stays a complete document for offline serving.
  PYTHONPATH=. python scripts/export_demo_page.py OUT_DIR"""
import re, shutil, sys
from pathlib import Path
src = Path("app"); out = Path(sys.argv[1] if len(sys.argv) > 1 else "build/demo"); out.mkdir(parents=True, exist_ok=True)
h = (src / "index.html").read_text()
h = re.sub(r"<!doctype html>\s*", "", h, flags=re.I); h = re.sub(r"</?html[^>]*>\s*", "", h); h = re.sub(r"</?head>\s*", "", h); h = re.sub(r"</?body>\s*", "", h)
h = re.sub(r'<meta charset="utf-8">\s*', "", h); h = re.sub(r'<meta name="viewport"[^>]*>\s*', "", h)
# hosts that allow stylesheets only from fixed origins: inline the vendored map stylesheet instead of linking it
css = (src / "vendor" / "maplibre" / "maplibre-gl.css").read_text()
h = h.replace('<link rel="stylesheet" href="vendor/maplibre/maplibre-gl.css">', f"<style>{css}</style>")
(out / "index.html").write_text(h.strip() + "\n")
for d in ("js", "data", "vendor"):                      # vendor: three.js r160 and MapLibre GL 4.7.1, so the page needs no CDN
    if (out / d).exists(): shutil.rmtree(out / d)
    shutil.copytree(src / d, out / d, ignore=shutil.ignore_patterns("*.test.mjs", "classic.js", "*.css"))
print("exported to", out, sum(f.stat().st_size for f in out.rglob("*") if f.is_file()) // 1024, "KB")
