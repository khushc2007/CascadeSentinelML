"""End-to-end journeys through BLACKSKY COMMAND · OMEGA (blacksky/site) in headless Chromium.

Serves blacksky/site over plain HTTP (no API, as on a static deployment) and drives the five workspaces: Cascade Theater (scenario
configuration, k validation, run, replay, inspector, compare, 2-D view, palette), Quantum Lab (composer, measurement, Grover, noise,
toy grid formulation), Algorithm Arena (seeded comparison against the exhaustive optimum, drill-down to the Theater), ML Observatory
(simulator-labelled training with a leakage-free split, candidate verification), Evidence & Resource Lab (registry, re-run, live checks,
resources). Numbers are checked against the data files and closed forms, never hard-coded. API behaviour is checked with the real
FastAPI app (blacksky/serve.py) and with an intercepted failing API. WebGL is software (SwiftShader); frame rates are not asserted."""
from __future__ import annotations
import functools, http.server, json, math, socket, socketserver, threading, time
from pathlib import Path
import pytest

ROOT = Path(__file__).resolve().parents[2]
SITE = ROOT / "blacksky" / "site"
DATA = SITE / "data"
pw = pytest.importorskip("playwright.sync_api")


@pytest.fixture(scope="module")
def server():
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
    httpd = socketserver.ThreadingTCPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=str(SITE))); httpd.daemon_threads = True
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


def _open(browser, url, arrival=False, **ctx):
    page = browser.new_page(**ctx); errors = []
    if not arrival:  # the arrival overlay is tested on its own; other journeys start in the command view
        page.add_init_script("try { localStorage.setItem('blacksky.arrival.v1', JSON.stringify('seen')); } catch (e) {}")
    page.on("pageerror", lambda e: errors.append(str(e)))
    # the API probes are expected to 404 on a static server; every other console error is a failure
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" and "404" not in m.text and "GL Driver" not in m.text else None)
    page.goto(url); page.wait_for_selector("body[data-ready='1']", timeout=90000)
    return page, errors


def S(page, expr):
    return page.evaluate(f"(() => {{ const bx = window.__blacksky, s = bx.store.get(); return {expr}; }})()")


def J(name):
    return json.loads((DATA / name).read_text())


def wait_ws(page, ws, ready):
    page.wait_for_function(f"window.__blacksky.store.get().ws === '{ws}' && !!window.__blacksky.{ready}", timeout=60000)


# ------------------------------------------------------------------------------------------------------------------------------ Arrival
def test_arrival_shows_the_headline_once_and_hands_over_to_the_theater(server, browser):
    page, errors = _open(browser, server, arrival=True)
    page.wait_for_selector("#arrival:not([hidden])")
    top = J("top_cascades_ieee118_k3.json")[0]
    sv = page.evaluate("window.__blacksky.runOnNet().summary.S")
    assert abs(sv - top["dc"]["metrics"]["S"]) < 1e-9                                    # the headline is the engine's result for the table's worst set
    page.wait_for_function(f"document.getElementById('ar-s').textContent === '{100 * sv:.1f}'", timeout=15000)
    n_loads = page.evaluate("window.__blacksky.store.get().net.model.loads.filter((l) => l.demand_mw > 0).length")
    assert page.locator(".ar-cells i").count() == n_loads
    page.click("#ar-watch"); page.wait_for_selector("#arrival", state="hidden")
    page.wait_for_function("window.__blacksky.store.get().playback.playing === true", timeout=10000)
    assert page.evaluate("JSON.parse(localStorage.getItem('blacksky.arrival.v1'))") == "seen"
    page.reload(); page.wait_for_selector("body[data-ready='1']", timeout=90000)
    assert page.locator("#arrival").is_hidden()                                # once per browser
    page.goto(server + "#quantum"); page.wait_for_selector("body[data-ready='1']", timeout=90000)
    assert page.locator("#arrival").is_hidden()                                # deep links never see it
    assert not errors, errors
    page.close()


# ------------------------------------------------------------------------------------------------------------------------------ Theater
def test_theater_story_transport_and_camera(server, browser):
    page, errors = _open(browser, server, viewport={"width": 1440, "height": 900})
    top = J("top_cascades_ieee118_k3.json")[0]["dc"]
    assert S(page, "s.ws") == "theater" and S(page, "s.netId") == "ieee118"
    assert sorted(S(page, "s.run.result.outage")) == sorted(top["outage"])
    assert abs(S(page, "s.run.result.metrics.S") - top["metrics"]["S"]) < 1e-9                  # browser engine = stored Python run
    assert S(page, "s.run.rank.rank") == 1 and S(page, "s.run.rank.exact") is True
    assert S(page, "s.run.scenarioId") == "SCN:ieee118:k3:6-67-140:dc:all" and S(page, "s.run.scenarioId") in page.inner_text("#scn-txt")
    assert S(page, "bx.registry.get(s.run.recordId).type") == "cascade"                        # the headline run is a registered experiment
    assert "API offline" in page.inner_text("#api-txt")
    page.click("#sc-t-story"); assert "Detect" in page.inner_text("#left")
    for st in ["trace", "cascade", "island", "assess"]:
        page.click(f"#left button[data-stage='{st}']"); page.wait_for_timeout(120)
        i = S(page, "s.playback.i"); assert i == S(page, f"s.run.stages.find((x) => x.id === '{st}').eventIndex")
        assert S(page, "bx.view().frameIndex") == S(page, "s.run.events[s.playback.i].frame")
        assert S(page, "document.getElementById('scrub').value") == str(i)
    assert "assess" in page.inner_text("#left .stagecard").lower()
    page.click("#tp-back"); assert S(page, "s.playback.i") == S(page, "s.run.events.length") - 2
    page.click("#tp-fwd"); assert S(page, "s.playback.i") == S(page, "s.run.events.length") - 1
    page.click("#tp-reset"); assert S(page, "s.playback.i") == 0
    page.fill("#scrub", "5"); page.dispatch_event("#scrub", "change"); assert S(page, "s.playback.i") == 5
    page.select_option("#tp-speed", "4"); assert S(page, "s.playback.speed") == 4
    page.click("#tp-play"); page.wait_for_timeout(900); assert S(page, "s.playback.i") > 5
    page.click("#tp-play"); i = S(page, "s.playback.i"); page.wait_for_timeout(1200); assert S(page, "s.playback.i") == i and S(page, "s.playback.playing") is False
    page.click("#tp-reset"); page.locator("body").press("ArrowRight"); assert S(page, "s.playback.i") == 1
    page.locator("body").press("ArrowLeft"); assert S(page, "s.playback.i") == 0
    # camera: follow, recon, schematic, presets, zoom, 2-D view, layers, full screen
    page.click("#cam-follow"); assert S(page, "s.follow") is False; page.click("#cam-follow")
    page.click("#cam-mode button[data-m='recon']"); assert S(page, "bx.rig.mode") == "recon"; page.click("#cam-mode button[data-m='orbit']")
    page.click("#cam-view button[data-v='schematic']"); assert S(page, "bx.rig.schematic") is True and S(page, "bx.gs.camera === bx.gs.ortho")
    page.click("#cam-view button[data-v='spatial']"); assert S(page, "bx.rig.schematic") is False
    page.click("#cam-top"); page.wait_for_timeout(900); assert S(page, "bx.rig.p.y") > S(page, "bx.rig.t.y") + 50
    d0 = S(page, "bx.rig.p.distanceTo(bx.rig.t)"); page.click("#cam-zin"); assert S(page, "bx.rig.p.distanceTo(bx.rig.t)") < d0
    page.click("#cam-view button[data-v='2d']"); page.wait_for_timeout(300)
    assert page.is_visible("#svg2d") and page.locator("#svg2d polyline[data-key^='branch:']").count() == 186
    page.locator("#svg2d circle[data-key='bus:69']").click(); assert S(page, "s.selection") == "bus:69"
    page.click("#cam-view button[data-v='spatial']"); assert not page.is_visible("#svg2d")
    page.click("#layers-btn"); page.uncheck("#layers-menu input[data-layer='grid']"); assert S(page, "bx.gs.gridLines.visible") is False
    page.check("#layers-menu input[data-layer='grid']"); page.click("#layers-btn")
    page.click("#cam-fs"); assert S(page, "document.body.classList.contains('fs')") is True
    page.keyboard.press("Escape"); page.wait_for_timeout(100); assert S(page, "document.body.classList.contains('fs')") is False
    # a featured scenario where three stages do not happen
    page.click("#sc-t-scenario"); page.select_option("#sc-scn", label="Absorbed outage · IEEE 14")
    page.wait_for_function("window.__blacksky.store.get().run.status === 'done' && window.__blacksky.store.get().netId === 'ieee14'")
    assert S(page, "s.run.stages.filter((x) => !x.occurred).map((x) => x.id)") == ["trace", "cascade", "island"]
    page.click("#sc-t-story"); assert "did not occur in this run" in page.inner_text("#left").lower()
    assert not errors, errors
    page.close()


def test_theater_scenario_configuration_validation_run_reproduce_compare(server, browser):
    page, errors = _open(browser, server, viewport={"width": 1440, "height": 900})
    d = J("dist_ieee118_k3.json"); o = sorted(d["top"][0][1])
    # k validation and N = C(m, k)
    page.fill("#sc-k", "3"); assert "1,055,240" in page.inner_text("#sc-n") and "C(186, 3)" in page.inner_text("#sc-n")
    page.click("#sc-clear"); page.fill("#sc-add", "6, 67"); page.press("#sc-add", "Enter")
    assert "k = 3, but 2 branches are selected" in page.inner_text("#left") and page.is_disabled("#sc-run")
    page.fill("#sc-k", "2.5"); assert "whole number" in page.inner_text("#left")
    page.fill("#sc-k", "-1"); assert "cannot be negative" in page.inner_text("#left")
    page.fill("#sc-k", "400"); assert "cannot exceed" in page.inner_text("#left")
    page.fill("#sc-k", "3"); page.fill("#sc-add", "999"); page.press("#sc-add", "Enter"); assert "Unknown branch index 999" in page.inner_text("#toast")
    page.fill("#sc-add", "140"); page.press("#sc-add", "Enter"); assert sorted(S(page, "s.draft.set")) == o and "Valid: k = 3" in page.inner_text("#left")
    page.select_option("#sc-engine", "api-dc"); assert "API is not reachable" in page.inner_text("#left") and page.is_disabled("#sc-run")
    page.select_option("#sc-engine", "browser-dc"); n0 = S(page, "bx.registry.list().length")
    page.click("#sc-run"); page.wait_for_function("window.__blacksky.store.get().run.status === 'done' && window.__blacksky.store.get().run.cfg.origin === 'theater'")
    assert S(page, "s.run.rank.rank") == 1
    # the identical run reuses its record (dedupe); "Reproduce" makes a new record with a parent and says it matched
    rid = S(page, "s.run.recordId"); assert S(page, "s.run.reproduced") is True and S(page, "bx.registry.list().length") == n0
    page.click("#sc-repro"); page.wait_for_function(f"window.__blacksky.store.get().run.recordId && window.__blacksky.store.get().run.recordId !== '{rid}'")
    assert S(page, "bx.registry.get(s.run.recordId).parent") == rid and "Reproduced exactly" in page.inner_text("#toast")
    # Run tab: measured quantities with units and result classes
    page.click("#au-t-run"); t = page.inner_text("#au-body")
    assert "4666.2 MW" in t and "22.80%" in t and "#1 of 1,055,240" in t and "Max loading" in t and "MEAS" in t and "SIM" in t
    # pin A, run a different set B, compare differences
    page.click("#sc-pin"); page.click("#sc-clear"); page.fill("#sc-k", "")
    page.fill("#sc-add", "6, 67"); page.press("#sc-add", "Enter"); page.click("#sc-run")
    page.wait_for_function("window.__blacksky.store.get().run.result && window.__blacksky.store.get().run.result.outage.join() === '6,67'")
    page.click("#au-t-compare"); c = page.inner_text("#au-body").lower()                     # micro labels are upper-cased by CSS
    assert "a (pinned) vs b (current)" in c and "{6, 67, 140}" in c and "{6, 67}" in c and "tripped only in a" in c
    # inspector: entity with case-file values, event causes, findings
    page.click("#au-t-entity"); page.fill("#au-find", "bus 69"); page.press("#au-find", "Enter"); e = page.inner_text("#au-body")
    assert S(page, "s.selection") == "bus:69" and "Vm (case)" in e and "case" in e and "not solver outputs here (DC model)" in e
    page.click("#au-t-events"); assert "Cause:" in page.inner_text("#au-list")
    page.click("#au-t-findings"); md = page.input_value("#au-md"); assert "not a blackout probability" in md and "Scenario id: SCN:ieee118:k2:6-67:dc:all" in md
    page.click("#au-export"); assert page.is_visible("#textout") and "Contingency finding" in page.input_value("#textout-ta"); page.click("#textout-x")
    # network switch clears selection and run
    page.select_option("#net-sel", "ieee14"); page.wait_for_function("window.__blacksky.store.get().netId === 'ieee14' && !window.__blacksky.store.get().loading")
    assert S(page, "s.selection") is None and S(page, "s.run.status") == "idle"
    assert not errors, errors
    page.close()


def test_command_palette_and_sessions(server, browser):
    page, errors = _open(browser, server, viewport={"width": 1280, "height": 860})
    page.keyboard.press("Control+k"); assert page.is_visible("#cmdk")
    page.fill("#cmdk-in", "branch 12"); page.keyboard.press("Enter"); assert S(page, "s.selection") == "branch:12"
    page.keyboard.press("/"); page.fill("#cmdk-in", "open quantum"); page.keyboard.press("Enter"); wait_ws(page, "quantum", "quantum")
    page.keyboard.press("/"); page.fill("#cmdk-in", "SCN:ieee30:k3:1-15-18:dc:all"); page.keyboard.press("Enter")
    page.wait_for_function("window.__blacksky.store.get().ws === 'theater' && window.__blacksky.store.get().run.scenarioId === 'SCN:ieee30:k3:1-15-18:dc:all'")
    page.keyboard.press("/"); page.fill("#cmdk-in", "save investigation"); page.keyboard.press("Enter")
    assert S(page, "JSON.parse(localStorage.getItem('blacksky.sessions.v1'))[0].scenarioId") == "SCN:ieee30:k3:1-15-18:dc:all"
    page.reload(); page.wait_for_selector("body[data-ready='1']", timeout=90000)
    page.keyboard.press("/"); page.fill("#cmdk-in", "restore session"); page.keyboard.press("Enter")
    page.wait_for_function("window.__blacksky.store.get().run.scenarioId === 'SCN:ieee30:k3:1-15-18:dc:all'")
    assert not errors, errors
    page.close()


# ------------------------------------------------------------------------------------------------------------------------- Quantum Lab
def test_quantum_lab_composer_and_grover(server, browser):
    page, errors = _open(browser, server + "#quantum", viewport={"width": 1440, "height": 900}); wait_ws(page, "quantum", "quantum")
    Q = "bx.quantum.state"
    # default Bell circuit: exact probabilities 1/2, 1/2
    assert abs(S(page, f"{Q}.sim.probs[0]") - 0.5) < 1e-12 and abs(S(page, f"{Q}.sim.probs[3]") - 0.5) < 1e-12
    # build H on q0 of a fresh 1-qubit circuit by clicking; undo / redo; parameter editing through the safe parser
    page.click("#q-clear"); page.click("#q-nm"); assert S(page, f"{Q}.n") == 1
    page.click(".gpal button[data-gate='ry']"); page.click("#qc-svg rect[data-cell='0,0']")
    page.fill("#q-par-0", "pi/3"); page.wait_for_timeout(50); assert abs(S(page, f"{Q}.ops[0].p[0]") - math.pi / 3) < 1e-12
    assert abs(S(page, f"{Q}.sim.probs[1]") - math.sin(math.pi / 6) ** 2) < 1e-12
    page.click("#q-undo"); assert abs(S(page, f"{Q}.ops[0].p[0]") - math.pi / 2) < 1e-12; page.click("#q-redo")
    page.click(".gpal button[data-gate='measure']"); page.click("#qc-svg rect[data-cell='1,0']")
    page.fill("#q-shots", "4000"); page.dispatch_event("#q-shots", "change"); page.click("#q-run")
    rec = S(page, f"bx.registry.get({Q}.record.id)"); assert rec["type"] == "quantum.circuit" and rec["provenance"] == "emulated" and rec["results"]["tvDistance"] < 0.03
    page.click("#q-qasm"); assert page.input_value("#textout-ta").startswith("OPENQASM 2.0;"); page.click("#textout-x")
    # keyboard placement: cursor, hot key, Enter
    page.focus("#qc-svg"); page.keyboard.press("ArrowRight"); page.keyboard.press("ArrowRight"); page.keyboard.press("h"); page.keyboard.press("Enter")
    assert S(page, f"{Q}.ops.some((o) => o.g === 'h' && o.col === 2)") is True or "after it was measured" in page.inner_text("#q-left")
    # a CX needs control then target
    page.click("#q-clear"); page.click("#q-np"); page.click(".gpal button[data-gate='h']"); page.click("#qc-svg rect[data-cell='0,0']")
    page.click(".gpal button[data-gate='cx']"); page.click("#qc-svg rect[data-cell='1,0']"); page.click("#qc-svg rect[data-cell='1,1']")
    assert abs(S(page, f"{Q}.sim.probs[3]") - 0.5) < 1e-12 and S(page, f"{Q}.sim.bloch[0].r") < 1e-9
    page.click("[data-viz='bloch']"); assert "mixed reduced state" in page.inner_text("#q-center")
    # Grover: P(marked) after r* iterations equals sin²((2r+1)θ); noise lowers it; toy grid formulation marks real candidate sets
    page.click("[data-mode='grover']"); page.click("#g-run"); page.wait_for_function("!!window.__blacksky.quantum.state.g.res", timeout=60000)
    th = math.asin(math.sqrt(1 / 16)); p = S(page, f"{Q}.g.res.main.stages.at(-1).pMarked")
    assert abs(p - math.sin(7 * th) ** 2) < 1e-10 and S(page, f"bx.registry.get({Q}.g.record.id).type") == "quantum.grover"
    page.check("#g-noisy"); page.click("#g-run"); page.wait_for_function("!!window.__blacksky.quantum.state.g.res && !!window.__blacksky.quantum.state.g.res.noisy", timeout=60000)
    assert S(page, f"{Q}.g.res.noisy.pMarked") < p - 0.01
    page.uncheck("#g-noisy"); page.click("#g-toy"); assert S(page, f"{Q}.g.toy.cands.length") == 16
    toy = S(page, f"{Q}.g.toy"); smax = max(c["S"] for c in toy["cands"]); assert all(toy["cands"][m]["S"] == smax for m in toy["marked"])
    assert "lookup table built by running the cascade simulator" in page.inner_text("#q-left")
    assert not errors, errors
    page.close()


# --------------------------------------------------------------------------------------------------------------------- Algorithm Arena
def test_arena_comparison_against_exhaustive_optimum(server, browser):
    page, errors = _open(browser, server + "#arena", viewport={"width": 1440, "height": 900}); wait_ws(page, "arena", "arena")
    opt = next(g for g in J("index.json")["grids"] if g["id"] == "ieee14")["k"]["2"]["Smax_dc"]
    S(page, "bx.arena.setConfig({ grid: 'ieee14', k: '2', budget: 40, reps: 3, seed: 5, methods: { exhaustive: true, random: true, ga: true, sa: false, loading: false, surrogate: true } })")
    assert "Grover on the grid objective" in page.inner_text("#a-left") and page.is_disabled("#a-left input[type=checkbox][disabled]")
    page.click("#a-run"); page.wait_for_function("!!window.__blacksky.arena.state.res", timeout=180000)
    res = S(page, "bx.arena.state.res")
    ex = next(r for r in res["runs"] if r["method"] == "exhaustive"); assert ex["sims"] == 190 and abs(ex["best"]["S"] - opt) < 1e-12 and abs(res["optimum"] - opt) < 1e-12
    for r in res["runs"]:
        assert r["sims"] <= (190 if r["method"] == "exhaustive" else 40) and r["best"]["S"] <= opt + 1e-12
    assert len([r for r in res["runs"] if r["method"] == "random"]) == 3 and sorted(r["seed"] for r in res["runs"] if r["method"] == "random") == [5, 6, 7]
    rec = S(page, "bx.registry.get(bx.arena.state.record.id)"); assert rec["type"] == "arena.grid" and rec["config"]["seed"] == 5
    assert "not implemented" in page.inner_text("#a-center")
    # drill down: the top candidate opens its real simulation in the Theater
    page.locator("#a-right tr[data-cand]").first.click(); cand = S(page, "bx.arena.state.sel")
    page.click("#a-right button[data-theater]"); page.wait_for_function(f"window.__blacksky.store.get().ws === 'theater' && window.__blacksky.store.get().run.status === 'done' && window.__blacksky.store.get().run.result.outage.join('-') === '{cand}'")
    assert abs(S(page, "s.run.result.metrics.S") - opt) < 1e-12
    # experiment A: Grover P(r*) from the circuit matches the formula
    page.click(".ws-nav a[data-ws='arena']"); page.click("[data-exp='A']"); page.click("#t-run"); page.wait_for_function("!!window.__blacksky.arena.state.toy.res", timeout=60000)
    t = S(page, "bx.arena.state.toy.res"); th = math.asin(math.sqrt(1 / 64)); assert abs(t["pExact"] - math.sin((2 * t["rStar"] + 1) * th) ** 2) < 1e-10
    assert "does not establish any quantum advantage" in page.inner_text("#a-left")
    assert not errors, errors
    page.close()


def test_worker_keeps_the_page_responsive(server, browser):
    page, errors = _open(browser, server + "#arena", viewport={"width": 1280, "height": 860}); wait_ws(page, "arena", "arena")
    S(page, "bx.arena.setConfig({ grid: 'ieee118', k: '2', budget: 400, reps: 1, seed: 1, methods: { exhaustive: true, random: false, ga: false, sa: false, loading: false, surrogate: false } })")
    page.click("#a-run"); page.wait_for_function("!!window.__blacksky.arena.state.job")
    frames = page.evaluate("new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 1000) requestAnimationFrame(f); else res(n); }; requestAnimationFrame(f); })")
    t0 = time.time(); page.click(".ws-nav a[data-ws='evidence']"); page.wait_for_function("window.__blacksky.store.get().ws === 'evidence'"); dt = time.time() - t0
    assert frames >= 10 and dt < 1.5, (frames, dt)                                                        # the 17,205 simulations run in the worker
    page.click(".ws-nav a[data-ws='arena']"); page.click("#a-cancel"); page.wait_for_function("!window.__blacksky.arena.state.job", timeout=30000)
    assert S(page, "bx.arena.state.res && bx.arena.state.res.cancelled") is True
    assert not errors, errors
    page.close()


# ------------------------------------------------------------------------------------------------------------------- ML Observatory
def test_ml_observatory_training_split_and_verification(server, browser):
    page, errors = _open(browser, server + "#ml", viewport={"width": 1440, "height": 900}); wait_ws(page, "ml", "ml")
    page.select_option("#m-grid", "ieee30"); page.select_option("#m-k", "2"); page.fill("#m-tf", "0.5"); page.dispatch_event("#m-tf", "change")
    page.fill("#m-tau", "0.3"); page.dispatch_event("#m-tau", "change"); page.fill("#m-trees", "20"); page.dispatch_event("#m-trees", "change")
    assert "expected" in page.inner_text("#m-left").lower()
    page.click("#m-train"); page.wait_for_function("!!window.__blacksky.ml.state.res || !!window.__blacksky.ml.state.err", timeout=240000)
    assert S(page, "bx.ml.state.err") is None
    r = S(page, "({ ov: bx.ml.state.res.split.overlap, n: bx.ml.state.res.sets.length, te: bx.ml.state.res.metrics.test.n, tr: bx.ml.state.res.metrics.train.n, r2: bx.ml.state.res.metrics.test.regression.r2 })")
    assert r["ov"] == 0 and r["n"] == 820 and r["te"] > 30 and r["tr"] > 30
    t = page.inner_text("#m-center"); assert "Held-out performance" in t and "in-sample" in t.lower() and "Branch overlap" in t
    # labels are the simulator's: a test candidate's label equals a fresh browser-engine run
    page.click("[data-tab='cands']"); page.locator("#m-center tr[data-cand]").first.click()
    i = S(page, "bx.ml.state.sel"); sset = S(page, f"bx.ml.state.res.sets[{i}]"); y = S(page, f"bx.ml.state.res.y[{i}]")
    page.select_option("#net-sel", "ieee30"); page.wait_for_function("window.__blacksky.store.get().netId === 'ieee30' && !window.__blacksky.store.get().loading")
    assert abs(S(page, f"s.net.engine.run({sset}, {{ policy: 'all_overloaded' }}).metrics.S") - y) < 1e-12
    right = page.inner_text("#m-right"); assert "PRED" in right and "SIM" in right and "not a calibrated interval" in right
    # a set typed by hand: prediction only, then verified with the simulator into a record
    # every pair is in the dataset here, so a typed pair resolves to its row; verification of a prediction is still recorded
    page.fill("#m-q", "1, 15"); page.click("#m-q-go"); page.wait_for_timeout(200)
    assert S(page, "bx.ml.state.res.sets[bx.ml.state.sel].join()") == "1,15"
    S(page, "(bx.ml.state.extra = { set: [1, 15], x: bx.ml.state.res.X[bx.ml.state.sel], pred: bx.ml.state.res.pred[bx.ml.state.sel], actual: null }, bx.ml.render())")
    assert "Not verified: this is only a prediction" in page.inner_text("#m-right")
    page.click("#m-verify"); page.wait_for_function("window.__blacksky.ml.state.extra && window.__blacksky.ml.state.extra.actual != null")
    assert S(page, "bx.registry.list()[0].type") == "ml.verify" and abs(S(page, "bx.ml.state.extra.actual") - S(page, "bx.ml.state.res.y[bx.ml.state.sel]")) < 1e-12
    page.click("[data-tab='prov']"); assert "disjoint-branch group split" in page.inner_text("#m-center")
    assert not errors, errors
    page.close()


# ------------------------------------------------------------------------------------------------------------------- APEX
def test_apex_overlays_severity_strip_and_propagation(server, browser):
    page, errors = _open(browser, server + "#theater", viewport={"width": 1440, "height": 900})
    d = J("dist_ieee118_k3.json"); tally = [0] * 186
    for _, st in d["top"]:
        for l in st: tally[l] += 1
    page.click("#layers-btn"); page.check("input[data-ov='faults']"); page.wait_for_timeout(200)
    assert S(page, "s.layers.overlay") == "faults" and S(page, "bx.overlay().counts") == tally
    assert "most damaging 3-line sets" in page.inner_text("#legend") or "most damaging" in S(page, "bx.legendItems().join(' ')")
    page.click("button[data-fk='2']"); assert S(page, "bx.overlay().k") == 2
    # the 2-D view draws the same overlay
    S(page, "bx.setView('2d')"); page.wait_for_timeout(300)
    col = page.get_attribute("#svg2d polyline[data-key='branch:67']", "stroke"); assert col and col.startswith("#") and col != "#6b7580"
    S(page, "bx.setView('3d')")
    # flow surge: zero everywhere for the intact network reference, non-zero after the outage
    S(page, "bx.setLayer('overlay', 'surge')"); sg = S(page, "bx.overlay().surge"); assert any(v is not None and v > 0.05 for v in sg)
    S(page, "bx.setLayer('overlay', 'loading')"); assert S(page, "bx.overlay()") is None
    # severity strip: stored histogram, current set marked; a bar in the top band opens a stored set
    page.click("#au-t-run"); assert page.locator("#au-body .sv").count() == 1 and page.locator(".sv-hit").count() == 44
    assert "of all sets lose no demand" in page.inner_text("#au-body")
    S(page, "bx.select('branch:67'); bx.inspectorTab('entity')"); page.wait_for_timeout(150)
    assert f"In the 500 worst 3-sets" in page.inner_text("#au-body") and str(tally[67]) in page.inner_text("#au-body")
    # propagation: stepping forward onto a trip event starts trip fronts; jumping back does not
    i = S(page, "s.run.events.findIndex((e) => e.type === 'trip')")
    S(page, f"(bx.goEvent({i - 1}, {{ frame: false }}), bx.goEvent({i}, {{ frame: false }}))"); assert S(page, "bx.gs.fxList.length") > 0
    S(page, "(bx.gs.fxList = [], bx.goEvent(0, { frame: false }))"); assert S(page, "bx.gs.fxList.length") == 0
    assert not errors, errors
    page.close()


def test_apex_landscapes_lineage_and_briefing(server, browser):
    page, errors = _open(browser, server + "#arena", viewport={"width": 1440, "height": 900}); wait_ws(page, "arena", "arena")
    S(page, "bx.arena.setConfig({ grid: 'ieee30', k: '2', budget: 60, reps: 2, seed: 4, methods: { exhaustive: true, random: true, ga: false, sa: true, loading: false, surrogate: false } })")
    page.click("#a-run"); page.wait_for_function("!!window.__blacksky.arena.state.res", timeout=240000)
    assert page.locator("#a-land canvas").count() == 1
    m = S(page, "bx.arena.state.land.universe.length"); assert S(page, "bx.arena.state.land.lower.length") == m * (m - 1) // 2
    page.select_option("#net-sel", "ieee30"); page.wait_for_function("window.__blacksky.store.get().netId === 'ieee30' && !window.__blacksky.store.get().loading")
    bad = S(page, "(() => { const L = bx.arena.state.land, m = L.universe.length; let b = 0; for (let t = 0; t < 15; t++) { const i = (t * 53) % L.lower.length; let a = 0, base = 0; while (i >= base + m - a - 1) { base += m - a - 1; a++; } const c = a + 1 + i - base; if (Math.abs(s.net.engine.run([L.universe[a], L.universe[c]], { policy: 'all_overloaded' }).metrics.S - L.lower[i]) > 1e-6) b++; } return b; })()")
    assert bad == 0
    assert abs(S(page, "Math.max(...Array.from(bx.arena.state.land.lower))") - J("dist_ieee30_k2.json")["top"][0][0]) < 1e-6
    page.fill("#a-ls-u", "300"); page.dispatch_event("#a-ls-u", "input"); assert "evaluations" in page.inner_text("#a-ls-n")
    # ML landscape: simulated below, predicted above
    page.click(".ws-nav a[data-ws='ml']"); wait_ws(page, "ml", "ml")
    page.select_option("#m-grid", "ieee30"); page.select_option("#m-k", "2"); page.fill("#m-tf", "0.5"); page.dispatch_event("#m-tf", "change"); page.fill("#m-trees", "15"); page.dispatch_event("#m-trees", "change")
    page.click("#m-train"); page.wait_for_function("!!window.__blacksky.ml.state.res || !!window.__blacksky.ml.state.err", timeout=240000)
    page.click("[data-tab='land']"); assert page.locator("#m-land canvas").count() == 1 and "PRED" in page.inner_text("#m-center")
    page.click("[data-lu='error']"); assert "prediction − simulation" in page.inner_text("#m-center")
    # lineage: one node per record
    page.click(".ws-nav a[data-ws='evidence']"); wait_ws(page, "evidence", "evidence"); page.click("[data-tab='lineage']")
    assert page.locator(".ln-node").count() == S(page, "bx.registry.list().length")
    page.locator(".ln-node").first.click(); assert S(page, "bx.evidence.state.tab") == "registry"
    # briefing: every step opens and the last one closes the tour
    S(page, "bx.briefing.start()")
    for k in range(S(page, "bx.briefing.steps")):
        page.wait_for_function(f"window.__blacksky.briefing.step === {k} && document.querySelector('#brief .br-t') && document.querySelector('#brief .br-t').textContent !== 'Preparing…'", timeout=30000)
        page.click("#br-next")
    page.wait_for_selector("#brief", state="hidden")
    assert not errors, errors
    page.close()


# ------------------------------------------------------------------------------------------------------------------- Evidence Lab
def test_evidence_lab_registry_rerun_checks_resources(server, browser):
    page, errors = _open(browser, server + "#evidence", viewport={"width": 1440, "height": 900}); wait_ws(page, "evidence", "evidence")
    rid = S(page, "s.run.recordId"); S(page, f"bx.evidence.open('{rid}')")
    c = page.inner_text("#e-center"); assert rid in c and "Configuration" in c and "Limitations that apply" in c and "L01" in c
    page.click("#e-rerun"); page.wait_for_function("window.__blacksky.evidence.state.rerun && window.__blacksky.evidence.state.rerun.same !== null", timeout=60000)
    assert S(page, "bx.evidence.state.rerun.same") is True and "reproduced every recorded result field exactly" in page.inner_text("#e-right")
    assert "Compare records" in page.inner_text("#e-center")
    page.click("#e-md"); assert page.input_value("#textout-ta").startswith("# ") and "Result classification" in page.input_value("#textout-ta"); page.click("#textout-x")
    page.click("[data-tab='validation']"); page.click("#e-checks"); page.wait_for_function("!!window.__blacksky.evidence.state.checks", timeout=60000)
    res = S(page, "bx.evidence.state.checks.results.map((c) => [c.id, c.status, c.detail])")
    assert len(res) >= 14 and all(s == "passed" for _, s, _ in res), [r for r in res if r[1] != "passed"]
    page.click("[data-tab='resources']"); page.wait_for_function("document.querySelector('#e-center').innerText.includes('Logical qubits')")
    head = J("crossover.json")["headline"]["IEEE118_k3_realistic_be_prep"]
    assert f"{head['logical_qubits']:,}" in page.inner_text("#e-center")                   # same model and inputs as the project's headline estimate
    assert "Fewer queries is not less time" in page.inner_text("#e-center")
    page.click("[data-tab='limits']"); assert page.locator("#e-center .lim").count() >= 19
    assert not errors, errors
    page.close()


# --------------------------------------------------------------------------------------------------------- failures, phone, API
def test_api_failure_is_reported_not_hidden(server, browser):
    ctx = browser.new_context(viewport={"width": 1280, "height": 860})
    ctx.add_init_script("try { localStorage.setItem('blacksky.arrival.v1', JSON.stringify('seen')); } catch (e) {}")
    ctx.route("**/api/health", lambda r: r.fulfill(status=200, content_type="application/json", body='{"status":"ok"}'))
    ctx.route("**/api/cascade", lambda r: r.fulfill(status=500, content_type="application/json", body='{"detail":"engine crashed (simulated)"}'))
    page = ctx.new_page(); page.goto(server); page.wait_for_selector("body[data-ready='1']", timeout=90000)
    assert "API online" in page.inner_text("#api-txt")
    page.select_option("#net-sel", "ieee14"); page.wait_for_function("window.__blacksky.store.get().netId === 'ieee14' && !window.__blacksky.store.get().loading")
    S(page, "bx.setDraft({ set: [0, 5], k: '2', engine: 'api-dc' })"); page.click("#sc-run")
    page.wait_for_function("window.__blacksky.store.get().run.status === 'error'")
    assert "API 500: engine crashed (simulated)" in page.inner_text("#left") and "run failed" in page.inner_text("#eng-txt")
    assert S(page, "bx.registry.get(s.run.recordId).status") == "failed"                        # the failure is recorded, not hidden
    ctx.close()


@pytest.mark.parametrize("ws", ["theater", "quantum", "arena", "ml", "evidence"])
def test_phone_layout_has_no_horizontal_scroll(server, browser, ws):
    page, errors = _open(browser, server + f"#{ws}", viewport={"width": 390, "height": 844}, reduced_motion="reduce", is_mobile=True, has_touch=True)
    page.wait_for_function(f"window.__blacksky.store.get().ws === '{ws}'"); page.wait_for_timeout(600)
    assert page.evaluate("document.documentElement.scrollWidth") <= 390 and S(page, "s.reduced") is True
    if ws == "theater":
        assert S(page, "document.getElementById('left').classList.contains('collapsed')") is True
        page.click("#sc-sheet"); assert S(page, "document.getElementById('left').classList.contains('collapsed')") is False
    assert not errors, errors
    page.close()


def _free_port():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p


def test_live_api_through_blacksky_server(browser):
    pytest.importorskip("fastapi"); uvicorn = pytest.importorskip("uvicorn")
    from blacksky.serve import app
    port = _free_port(); srv = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    th = threading.Thread(target=srv.run, daemon=True); th.start()
    for _ in range(100):
        if srv.started: break
        time.sleep(0.1)
    try:
        page, errors = _open(browser, f"http://127.0.0.1:{port}/", viewport={"width": 1280, "height": 860})
        page.wait_for_function("window.__blacksky.store.get().api.state === 'ok'")
        page.select_option("#net-sel", "ieee14"); page.wait_for_function("window.__blacksky.store.get().netId === 'ieee14' && !window.__blacksky.store.get().loading")
        S(page, "bx.setDraft({ set: [0, 5], k: '2', engine: 'api-ac' })"); page.click("#sc-run")
        page.wait_for_function("window.__blacksky.store.get().run.status === 'done' || window.__blacksky.store.get().run.status === 'error'", timeout=120000)
        assert S(page, "s.run.status") == "done", S(page, "s.run.error")
        assert S(page, "s.run.mode") == "ac" and S(page, "s.run.rank") is None and S(page, "s.run.result.metrics.S") > 0.4   # IEEE-14 {0,5}: DC 0 %, AC ≈ 47 %
        page.select_option("#net-sel", "ieee118"); page.wait_for_function("window.__blacksky.store.get().netId === 'ieee118' && !window.__blacksky.store.get().loading")
        S(page, "bx.setDraft({ set: [3, 4, 5], k: '3', engine: 'api-dc' })"); page.click("#sc-run")
        page.wait_for_function("window.__blacksky.store.get().run.status === 'error'", timeout=60000)
        assert "API 409" in page.inner_text("#left")
        # BLACKSKY API with Qiskit: transpiled statistics of the Bell circuit
        pytest.importorskip("qiskit")
        page.wait_for_function("window.__blacksky.store.get().bsapi.state === 'ok'")
        page.click(".ws-nav a[data-ws='quantum']"); wait_ws(page, "quantum", "quantum"); page.click("#q-transpile")
        page.wait_for_function("!!window.__blacksky.quantum.state.transp", timeout=30000)
        assert S(page, "bx.quantum.state.transp.res.two_qubit") == 1 and "transpile()" in page.inner_text("#q-right")
        assert not [e for e in errors if "409 (Conflict)" not in e], errors                      # the 409 above is the expected API answer
        page.close()
    finally:
        srv.should_exit = True; th.join(timeout=10)
