"""End-to-end journey through the web workbench in a real (headless) browser.

Serves app/ over HTTP, opens the page in Chromium (Playwright) and drives the critical journey: search and inspect equipment, build a
contingency, run it with the browser engine, step through the recorded events, switch views and camera modes, open Research. Values are
checked against the data files and the engine, not against hard-coded expectations. Skips when Playwright or Chromium is unavailable.
WebGL runs on SwiftShader (software) in CI, so frame-rate numbers from this test are not representative and are not asserted."""
from __future__ import annotations
import functools, http.server, json, socketserver, threading
from pathlib import Path
import pytest

APP = Path(__file__).resolve().parents[2] / "app"
pw = pytest.importorskip("playwright.sync_api")


@pytest.fixture(scope="module")
def server():
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
    handler = functools.partial(Quiet, directory=str(APP))
    httpd = socketserver.ThreadingTCPServer(("127.0.0.1", 0), handler); httpd.daemon_threads = True
    t = threading.Thread(target=httpd.serve_forever, daemon=True); t.start()
    yield f"http://127.0.0.1:{httpd.server_address[1]}/"
    httpd.shutdown()


@pytest.fixture(scope="module")
def browser():
    with pw.sync_playwright() as p:
        try:
            b = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader"])
        except Exception as e:  # noqa: BLE001
            pytest.skip(f"Chromium not available: {e}")
        yield b
        b.close()


def _open(browser, url, **ctx):
    page = browser.new_page(**ctx); errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" and "fonts.g" not in m.text and "ERR_TUNNEL" not in m.text and "404" not in m.text else None)
    page.goto(url); page.wait_for_selector("body[data-ready='1']", timeout=60000)
    return page, errors


def S(page, expr):
    return page.evaluate(f"(() => {{ const s = window.__gdf.store.get(); return {expr}; }})()")


def test_critical_journey(server, browser):
    page, errors = _open(browser, server, viewport={"width": 1440, "height": 900})
    d3 = json.loads((APP / "data" / "dist_ieee118_k3.json").read_text())
    # initial state: IEEE-118 loaded, worst 3-set from the table pre-loaded as the contingency, nothing run
    assert S(page, "s.gridId") == "ieee118" and S(page, "s.model.nBranch") == 186
    assert sorted(S(page, "s.contingency")) == sorted(d3["top"][0][1]) and S(page, "s.run.status") == "idle"
    # search → select → inspector
    page.fill("#search", "bus 59"); page.press("#search", "Enter")
    assert S(page, "s.selection") == "bus:59"; assert "Bus 59" in page.inner_text("#ins")
    # 2-hop neighbourhood of the selection (topology only), then back to the whole network
    page.click("#i-hood"); nb = S(page, "s.layers.neighbourhood"); i59 = S(page, "s.model.busById.get(59).i")
    assert i59 in nb and len(nb) > 5 and len(nb) < 118
    page.click("#i-hood"); assert S(page, "s.layers.neighbourhood") is None
    # explorer '+' adds a branch; header and scenario panel follow
    page.fill("#search", ""); page.dispatch_event("#search", "input"); page.click("#s-clear")
    assert S(page, "s.contingency") == []
    page.click("#exp-list [data-add='37']"); assert S(page, "s.contingency") == [37]
    assert "37" in page.inner_text("#scn") and "k = 1" in page.inner_text("#h-cont")
    page.click("#exp-list [data-add='37']"); assert S(page, "s.contingency") == []
    # run validation: empty contingency cannot run
    assert page.is_disabled("#h-run")
    # API engines are disabled when no API answers /health
    assert page.is_disabled("#s-engine option[value='api-ac']")
    # load the worst 3-set from the Scenarios tab and run it
    page.click("#exp-tabs [data-t='scenarios']"); page.click("#exp-list [data-scn='3:0'][data-run='1']")
    page.wait_for_function("window.__gdf.store.get().run.status === 'done'", timeout=30000)
    res = S(page, "s.run.result.metrics")
    assert abs(res["S"] - d3["top"][0][0]) < 1e-9, "browser engine reproduces the exhaustive-table severity"
    assert S(page, "s.run.rank.rank") == 1 and S(page, "s.run.rank.exact") is True
    assert "22.8%" in page.inner_text("#h-sev")
    n = S(page, "s.run.events.length"); assert n > 5
    # timeline: stepping and clicking an event updates playback and the scene frame
    page.click("#tl-play")  # pause if playing
    page.evaluate("window.__gdf.stop()")
    trip_i = page.evaluate("window.__gdf.store.get().run.events.findIndex(e => e.type === 'trip')")
    page.click(f".evb[data-i='{trip_i}']")
    assert S(page, "s.playback.i") == trip_i
    tripped = page.evaluate(f"window.__gdf.store.get().run.events[{trip_i}].entities[0]")
    page.evaluate(f"window.__gdf.select('{tripped}')")
    assert "tripped in round 1" in page.inner_text("#ins")
    page.keyboard.press("]"); assert S(page, "s.playback.i") == trip_i + 1
    page.keyboard.press("["); assert S(page, "s.playback.i") == trip_i
    # termination event and islands tab
    page.evaluate("window.__gdf.goEvent(window.__gdf.store.get().run.events.length - 1)")
    page.click("#exp-tabs [data-t='islands']"); assert "main island" in page.inner_text("#exp-list")
    # save, findings export (modal with Markdown)
    page.click("#s-save"); assert S(page, "s.saved.length") == 1
    page.click("#s-export"); md = page.input_value("#md"); assert "#1 of 1,055,240" in md and "not a blackout probability" in md
    page.click("#modal-x")
    # camera: schematic view and recon flight move the camera; Esc returns to orbit
    page.click("[data-v='schematic']"); assert S(page, "s.camera.schematic") is True
    page.click("[data-v='spatial']"); assert S(page, "s.camera.schematic") is False
    page.click("[data-m='recon']"); p0 = page.evaluate("window.__gdf.rig.pose().p")
    page.keyboard.down("w"); page.wait_for_timeout(700); page.keyboard.up("w"); page.wait_for_timeout(300)
    p1 = page.evaluate("window.__gdf.rig.pose().p"); assert p0 != p1
    page.keyboard.press("Escape"); assert S(page, "s.camera.mode") == "orbit"
    # research workspace renders the ledger from evidence.json
    page.click("[data-ws='research']"); page.wait_for_selector("#tiles .tile")
    assert page.locator("#tiles .tile").count() == 17
    page.close()
    assert not errors, errors


def test_phone_layout_and_reduced_motion(server, browser):
    page, errors = _open(browser, server, viewport={"width": 390, "height": 844}, reduced_motion="reduce")
    assert page.evaluate("document.documentElement.scrollWidth") <= 390
    assert S(page, "s.layers.reduced") is True
    assert page.is_hidden("#explorer"); page.click("#h-exp"); assert page.is_visible("#explorer")
    page.click("#h-exp"); assert page.is_hidden("#explorer")
    page.click("#h-run"); page.wait_for_function("window.__gdf.store.get().run.status === 'done'", timeout=30000)
    assert S(page, "s.playback.playing") is False, "reduced motion: no auto-playback"
    page.close()
    assert not errors, errors


def test_compare_layers_views_keyboard(server, browser):
    page, errors = _open(browser, server, viewport={"width": 1440, "height": 900})
    d30 = json.loads((APP / "data" / "dist_ieee30_k3.json").read_text())
    tops = json.loads((APP / "data" / "top_cascades_ieee30_k3.json").read_text())
    # DC vs AC on the worst IEEE-30 set: AC comes from the stored Python run (works without the API)
    page.select_option("#grid-sel", "ieee30"); page.wait_for_function("window.__gdf.store.get().gridId === 'ieee30'")
    page.evaluate(f"window.__gdf.setContingency({json.dumps(d30['top'][0][1])})")
    page.click("#h-run"); page.wait_for_function("window.__gdf.store.get().run.status === 'done'")
    page.click("#s-dcac"); page.wait_for_function("window.__gdf.store.get().saved.length === 2")
    saved = page.evaluate("window.__gdf.store.get().saved.map(x => [x.result.mode, x.result.metrics.S, x.rank && x.rank.rank])")
    ac_ref = next(r["ac"] for r in tops if sorted(r["dc"]["outage"]) == sorted(d30["top"][0][1]))
    assert saved[-2][0] == "dc" and abs(saved[-2][1] - d30["top"][0][0]) < 1e-9 and saved[-2][2] == 1
    assert saved[-1][0] == "ac" and abs(saved[-1][1] - ac_ref["metrics"]["S"]) < 1e-12 and saved[-1][2] is None, "AC is not ranked against the DC table"
    table = page.inner_text("#cmp"); assert "not ranked" in table and "#1 of 10,660" in table
    # layers: turning flow and equipment off is reflected in the store and the scene stays renderable
    page.click("#layers-btn"); page.uncheck("#layers-menu input[data-k='flow']"); page.uncheck("#layers-menu input[data-k='equipment']")
    assert S(page, "s.layers.flow") is False and S(page, "s.layers.equipment") is False
    page.check("#layers-menu input[data-k='equipment']"); page.click("#layers-btn")
    # the AC result carries no per-bus component data: the Islands tab says so instead of guessing
    page.click("#exp-tabs [data-t='islands']"); assert "unavailable" in page.inner_text("#exp-list")
    # switch the scene to the DC run (A) with the camera unchanged, then isolate an island and restore
    page.click("#cmp [data-show] >> nth=0"); assert S(page, "s.run.result.mode") == "dc"
    page.click("#exp-tabs [data-t='islands']"); page.click("#exp-list [data-iso]")
    assert S(page, "s.layers.isolate") is not None
    page.click("#exp-list [data-iso]"); assert S(page, "s.layers.isolate") is None
    # saved viewpoints: save, move the camera, restore
    page.click("#bm-btn"); page.click("#bm-save"); pose = page.evaluate("window.__gdf.rig.pose().p"); page.keyboard.press("Escape"); assert page.is_hidden("#bm-menu")
    page.keyboard.press("o"); page.wait_for_timeout(1000); page.evaluate("window.__gdf.rig.to([5, 40, 5], [0, 0, 0], 0)")
    page.click("#bm-btn"); page.click("#bm-list button >> nth=0"); page.wait_for_timeout(1100)
    assert max(abs(a - b) for a, b in zip(page.evaluate("window.__gdf.rig.pose().p"), pose)) < 1e-3
    # keyboard-only: search, select with Enter, add the selected branch with C, run with the header button via keyboard, step events
    page.click("#s-clear") if page.locator("#s-clear").count() else None
    page.focus("#search"); page.keyboard.type("line 7"); page.keyboard.press("Enter")
    assert S(page, "s.selection") == "branch:7"
    page.evaluate("document.activeElement.blur()"); page.keyboard.press("c"); assert 7 in S(page, "s.contingency")
    page.focus("#h-run"); page.keyboard.press("Enter"); page.wait_for_function("window.__gdf.store.get().run.status === 'done'")
    page.evaluate("window.__gdf.stop()"); i0 = S(page, "s.playback.i"); page.keyboard.press("]"); assert S(page, "s.playback.i") == min(i0 + 1, S(page, "s.run.events.length") - 1)
    page.close()
    assert not errors, errors
