"""Export BLACKSKY COMMAND for hosting inside a document skeleton (a published page): strips the <!doctype>/<html>/<head>/<body> wrappers
from blacksky/site/index.html, inlines the vendored fonts as data: URIs (hosts that only allow their own font sources), marks the page as
embedded (hides the file-download button, which sandboxed hosts block), and copies js/, shared/, data/ and vendor/ (three.js r160 + licence)
next to it, so the page does not depend on a CDN. blacksky/site itself is not modified.
  PYTHONPATH=. python scripts/export_blacksky_page.py [OUT_DIR]        (default build/blacksky_page)"""
import base64, re, shutil, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "blacksky" / "site"
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "build" / "blacksky_page"


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    h = (SRC / "index.html").read_text()
    def font(m):
        p = SRC / m.group(1); return f'url("data:font/woff2;base64,{base64.b64encode(p.read_bytes()).decode()}")'
    h = re.sub(r'url\("(fonts/[^"]+\.woff2)"\)', font, h)
    h = re.sub(r"<!doctype html>\s*", "", h, flags=re.I); h = re.sub(r"</?html[^>]*>\s*", "", h); h = re.sub(r"</?head>\s*", "", h); h = re.sub(r"</?body>\s*", "", h)
    h = re.sub(r'<meta charset="utf-8">\s*', "", h); h = re.sub(r'<meta name="viewport"[^>]*>\s*', "", h)
    h = h.replace('<meta name="blacksky-api" content="api/">', '<meta name="blacksky-api" content="api/">\n<meta name="blacksky-embed" content="1">')
    # keep <title> in the first 8 KB: move the (large) style block after the metadata, which it already follows
    assert h.find("<title>") < 8000, "title must stay near the top"
    (OUT / "index.html").write_text(h.strip() + "\n")
    for d in ("js", "shared", "data", "vendor"):
        if (OUT / d).exists(): shutil.rmtree(OUT / d)
        shutil.copytree(SRC / d, OUT / d)
    files = [f for f in OUT.rglob("*") if f.is_file()]
    print("exported to", OUT, len(files), "files,", sum(f.stat().st_size for f in files) // 1024, "KB")


if __name__ == "__main__":
    main()
