"""End-to-end checks of the original application (app/) after the benchmark-scene and Bengaluru-explorer work, in headless Chromium.

Benchmark: rendered inventory equals the source data, view modes (Spatial / Grid focus / Grid only / Schematic), the decorative city is never
pickable, timeline scrubbing / round selection / event-to-object navigation, Inspector source values, and repeated network switching without
stale state or growing GPU resources. Geographic mode: the Overpass API and the map tiles are intercepted and answered with a SYNTHETIC test
fixture (tests/fixtures/overpass_synthetic_fixture.json, names start with TEST) and a blank tile, because this test environment has no
internet access; the live services are therefore NOT exercised here. WebGL is SwiftShader; frame rates are not asserted."""
from __future__ import annotations
import base64, functools, http.server, json, socketserver, threading
from pathlib import Path
import pytest

ROOT = Path(__file__).resolve().parents[2]
APP = ROOT / "app"
FIXTURE = ROOT / "tests" / "fixtures" / "overpass_synthetic_fixture.json"
PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==")
pw = pytest.importorskip("playwright.sync_api")


@pytest.fixture(scope="module")
def server():
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
    httpd = socketserver.ThreadingTCPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=str(APP))); httpd.daemon_threads = True
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
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


def _ctx(browser, overpass="fixture", tiles=True):
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    ctx.route("**/tile.openstreetmap.org/**", (lambda r: r.fulfill(status=200, content_type="image/png", body=PNG)) if tiles else (lambda r: r.abort()))
    if overpass == "fixture": ctx.route("**/api/interpreter", lambda r: r.fulfill(status=200, content_type="application/json", body=FIXTURE.read_text()))
    elif overpass == "fail": ctx.route("**/api/interpreter", lambda r: r.fulfill(status=504, body="gateway timeout (simulated)"))
    ctx.route("**/fonts.googleapis.com/**", lambda r: r.abort()); ctx.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    ctx.add_init_script("try { localStorage.setItem('gdf.intro', 'done'); } catch (e) {}")
    return ctx


def _open(ctx, url):
    page = ctx.new_page(); errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" and "404" not in m.text and "ERR_" not in m.text and "GL Driver" not in m.text else None)
    page.goto(url); page.wait_for_selector("body[data-ready='1']", timeout=90000)
    return page, errors


W = lambda page, expr: page.evaluate(f"(() => {{ const wb = window.__gdf, s = wb.store.get(); return {expr}; }})()")
G = lambda page, expr: page.evaluate(f"(() => {{ const g = window.__gdfGeo, st = g.state; return {expr}; }})()")


def test_benchmark_inventory_modes_inspector_and_switching(server, browser):
    ctx = _ctx(browser); page, errors = _open(ctx, server)
    for gid in ["ieee118", "ieee30", "ieee14"]:
        page.select_option("#grid-sel", gid); page.wait_for_function(f"window.__gdf.store.get().gridId === '{gid}'")
        grid = json.loads((APP / "data" / f"grid_{gid}.json").read_text()); cm = json.loads((APP / "data" / f"cascade_model_{gid}.json").read_text())
        assert W(page, "wb.gs.busMesh.count") == grid["n_bus"] and W(page, "wb.gs.cond.count") == grid["n_branch"] * 12
        assert W(page, "wb.gs.genBody.count") == len(cm["gen_bus"]) and W(page, "wb.gs.loadServed.count") == sum(1 for p in cm["Pd"] if p > 0)
    # IEEE-14 gives baseKV = 0 (not stated) for every bus: the Inspector must say unavailable, never "0 kV" (Review A defect)
    W(page, "wb.select('branch:0')"); t14 = page.inner_text("#ins"); assert " 0 kV" not in t14 and "Unavailable" in t14 and "inferred" not in t14.split("type")[0]
    page.select_option("#grid-sel", "ieee118"); page.wait_for_function("window.__gdf.store.get().gridId === 'ieee118'")
    # view modes; the city is decoration: present in Spatial, lowered in Grid focus, absent in Grid only and Schematic
    assert W(page, "wb.gs.city.visible") is True and W(page, "wb.gs.cityList.length") > 100
    page.click("#view-mode button[data-v='focus']"); assert W(page, "s.camera.context") == "focus" and W(page, "wb.gs.city.visible") is True
    page.click("#view-mode button[data-v='grid']"); assert W(page, "wb.gs.city.visible") is False and W(page, "wb.gs.grid.visible") is False
    page.click("#view-mode button[data-v='schematic']"); assert W(page, "s.camera.schematic") is True and W(page, "wb.gs.cityList.length") == 0
    page.click("#view-mode button[data-v='spatial']"); assert W(page, "s.camera.schematic") is False and W(page, "wb.gs.city.visible") is True
    # picking never returns a city block: sample a grid of screen points, every hit is a real entity id
    hits = page.evaluate("""(() => { const g = window.__gdf.gs, r = g.canvas.getBoundingClientRect(), out = new Set();
        for (let x = 10; x < r.width; x += 23) for (let y = 10; y < r.height; y += 23) { const k = g.pick(x, y, 9); if (k) out.add(k); } return [...out]; })()""")
    assert hits and all(W(page, f"s.model.byKey.has('{k}')") for k in hits)
    # inspector shows case-file source values (branch 0 resistance from params_ieee118.json)
    params = json.loads((APP / "data" / "params_ieee118.json").read_text())
    W(page, "wb.select('branch:0')"); txt = page.inner_text("#ins")
    assert f"{params['branches'][0]['r']:.5f} p.u." in txt and "case" in txt.lower() and "synthetic" in txt.lower()
    W(page, "wb.select('bus:69')"); assert "slack" in page.inner_text("#ins").lower()
    # run, then timeline: scrubber, round headers, event → object chips
    page.click("#s-worst"); page.wait_for_function("window.__gdf.store.get().contingency.length === 3")       # network switches clear the contingency
    page.click("#h-run"); page.wait_for_function("window.__gdf.store.get().run.status === 'done'")
    W(page, "wb.stop()"); n = W(page, "s.run.events.length")
    page.fill("#tl-scrub", "5"); page.dispatch_event("#tl-scrub", "change"); assert W(page, "s.playback.i") == 5
    page.locator(".round .rh").nth(2).click(); i = W(page, "s.playback.i"); assert W(page, f"s.run.events[{i}].round") == 2
    trip_i = W(page, "s.run.events.findIndex((e) => e.type === 'trip')"); W(page, f"wb.goEvent({trip_i})")
    first = W(page, f"s.run.events[{trip_i}].entities[0]"); page.click(f"#tl-now [data-sel='{first}']"); assert W(page, "s.selection") == first
    assert "tripped" in page.inner_text("#ins").lower()
    assert W(page, f"wb.gs.kinds.get({int(first.split(':')[1])})") == "tripped_now"
    assert 0 <= i < n
    # repeated switching: no stale selection or run, GPU geometry count does not grow
    geo0 = None
    for k in range(4):
        for gid in ["ieee30", "ieee118"]:
            page.select_option("#grid-sel", gid); page.wait_for_function(f"window.__gdf.store.get().gridId === '{gid}'")
            assert W(page, "s.selection") is None and W(page, "s.run.status") == "idle"
        W(page, "wb.gs.render(0.016)"); g = W(page, "wb.gs.renderer.info.memory.geometries")
        if k == 1: geo0 = g
        if k == 3: assert g <= geo0, f"geometries grew from {geo0} to {g}"
    assert not errors, errors
    ctx.close()


def test_bengaluru_explorer_with_synthetic_fixture(server, browser):
    ctx = _ctx(browser); page, errors = _open(ctx, server)
    W(page, "wb.select('bus:59')")
    page.select_option("#grid-sel", "geo:bengaluru")
    page.wait_for_function("window.__gdfGeo && window.__gdfGeo.state.recs.length > 0", timeout=60000)
    assert page.is_visible("#geo") and not page.is_visible("#wb") and page.is_visible("#h-geo") and not page.is_visible("#h-run")
    fx = json.loads(FIXTURE.read_text())
    assert G(page, "st.recs.length") == 8 and G(page, "st.source.osmBase") == fx["osm3s"]["timestamp_osm_base"]
    assert G(page, "st.recs.every((r) => r.prov.url && r.prov.license.includes('ODbL'))")
    # map is live: sources hold the filtered features
    page.wait_for_function("window.__gdfGeo.state.ready")
    assert G(page, "st.map.getSource('pts')._data.features.length") == G(page, "st.shown.filter((r) => r.point).length")
    # search → select → inspector with provenance and limitations
    page.fill("#geo-q", "alpha"); page.locator("#geo-results button").first.click()
    assert G(page, "st.sel") == "osm:node/900000001"; ins = page.inner_text("#geo-ins-b")
    assert "TEST Alpha" in ins and "node/900000001" in ins and "Not cross-checked against KPTCL/BESCOM" in ins and "ODbL" in ins
    # filters and layers change what is shown; counts follow
    page.locator("#geo-filters input[data-vc='vna']").uncheck(); assert G(page, "st.shown.length") == 6
    page.locator("#geo-layers input[data-layer='line']").uncheck(); assert G(page, "st.shown.some((r) => r.kind === 'line')") is False
    page.locator("#geo-layers input[data-layer='line']").check(); page.locator("#geo-filters input[data-vc='vna']").check(); assert G(page, "st.shown.length") == 8
    page.select_option("#geo-op", "TEST-OP-2"); assert G(page, "st.shown.length") == 2; page.select_option("#geo-op", "")
    # basemap prominence and toggle
    page.locator("#geo-bm").uncheck(); assert G(page, "st.map.getLayoutProperty('basemap', 'visibility')") == "none"; page.locator("#geo-bm").check()
    # back to the benchmark: network, selection and scene restored; the geographic selection never becomes a contingency
    page.select_option("#grid-sel", "ieee118"); page.wait_for_function("document.body.dataset.mode === 'benchmark'")
    assert page.is_visible("#wb") and not page.is_visible("#geo") and W(page, "s.gridId") == "ieee118" and W(page, "s.selection") == "bus:59"
    assert all(isinstance(x, int) for x in W(page, "s.contingency"))
    assert not errors, errors
    ctx.close()


def test_bengaluru_explorer_failure_states_and_file_import(server, browser, tmp_path):
    ctx = _ctx(browser, overpass="fail", tiles=False); page, errors = _open(ctx, server + "#bengaluru")
    page.wait_for_function("window.__gdfGeo && window.__gdfGeo.state.load.status === 'error'", timeout=60000)
    assert "Not loaded" in page.inner_text("#geo-src") and "504" in page.inner_text("#geo-src")
    assert "could not be loaded" in page.inner_text("#geo-status")
    assert G(page, "st.recs.length") == 0                                   # nothing is shown in place of the missing data
    page.wait_for_function("window.__gdfGeo.state.basemap.error !== null", timeout=30000)
    assert "Basemap tiles could not be loaded" in page.inner_text("#geo-layers")
    # an export file loads, with the file named in the provenance
    page.set_input_files("#geo-file", str(FIXTURE)); page.wait_for_function("window.__gdfGeo.state.recs.length === 8")
    assert G(page, "st.source.kind") == "file" and "overpass_synthetic_fixture.json" in page.inner_text("#geo-src")
    bad = tmp_path / "not_power.geojson"; bad.write_text(json.dumps({"type": "FeatureCollection", "features": [{"type": "Feature", "properties": {"highway": "primary"}, "geometry": {"type": "Point", "coordinates": [77.6, 12.9]}}]}))
    page.set_input_files("#geo-file", str(bad)); page.wait_for_timeout(300)
    assert "no features tagged power" in page.inner_text("#geo-status") and G(page, "st.recs.length") == 8   # previous data kept, nothing invented
    assert not [e for e in errors if "504" not in e], errors
    ctx.close()


def test_leaving_mid_query_is_not_an_error_and_retries_on_return(server, browser):
    """Review C: switching back to a benchmark while the Overpass query is still running must not leave a false error behind."""
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}); held = []
    ctx.route("**/tile.openstreetmap.org/**", lambda r: r.fulfill(status=200, content_type="image/png", body=PNG))
    ctx.route("**/api/interpreter", lambda r: held.append(r))                 # hold the request: the query is "in flight"
    ctx.route("**/fonts.g*/**", lambda r: r.abort()); ctx.add_init_script("try { localStorage.setItem('gdf.intro', 'done'); } catch (e) {}")
    page = ctx.new_page(); page.goto(server); page.wait_for_selector("body[data-ready='1']", timeout=90000)
    page.select_option("#grid-sel", "geo:bengaluru"); page.wait_for_function("window.__gdfGeo.state.load.status === 'running'", timeout=60000)
    page.select_option("#grid-sel", "ieee30"); page.wait_for_function("window.__gdf.store.get().gridId === 'ieee30'")
    page.wait_for_function("window.__gdfGeo.state.load.status === 'idle'", timeout=30000)
    assert page.evaluate("document.getElementById('geo-status').hidden") is True
    n = len(held); page.select_option("#grid-sel", "geo:bengaluru"); page.wait_for_function("window.__gdfGeo.state.load.status === 'running'", timeout=60000)
    for _ in range(100):
        if len(held) > n: break
        page.wait_for_timeout(100)
    held[-1].fulfill(status=200, content_type="application/json", body=FIXTURE.read_text())
    page.wait_for_function("window.__gdfGeo.state.recs.length === 8", timeout=30000)
    ctx.close()
