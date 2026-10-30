.PHONY: help test test-js test-nopytest feasibility install data truth truth-118k3 experiments experiment figs fixtures demo-data serve lint all blacksky-sync blacksky-serve blacksky-test blacksky-validate blacksky-typecheck

PY ?= python
export PYTHONPATH := .
TABLES := results/phase7/tables
GEN := $(PY) scripts/generate_truth_table.py --out $(TABLES) --chunk 5000
WORKERS ?= 2

help:            ## list targets
	@grep -E '^[a-z0-9-]+:.*##' Makefile | sed 's/:.*##/ -/'

install:         ## dev + analysis + quantum + api extras
	$(PY) -m pip install -e ".[dev,analysis,quantum,reference,api]" qiskit-ibm-runtime

test:            ## full Python suite (includes the JS parity suite when node is installed)
	$(PY) -m pytest -q
test-js:         ## JavaScript port parity tests only
	node --test app/test/*.test.mjs
test-nopytest:   ## fallback runner used where pytest is unavailable
	$(PY) scripts/run_tests.py
feasibility:
	$(PY) scripts/rating_feasibility.py
lint:            ## V2 R4 claims lint + ruff
	$(PY) scripts/claims_lint.py
	-ruff check doomsday scripts --select E9,F63,F7,F82

data:            ## fetch official MATPOWER and install case14/30/118 (needs network once); records commit + sha256
	test -d ../matpower || git clone --depth 1 --branch 8.1 https://github.com/MATPOWER/matpower ../matpower
	$(PY) scripts/verify_case_files.py --matpower-dir ../matpower --install

truth:           ## exhaustive tables used by the experiments (IEEE-118 k=3 DC takes ~2 core-hours)
	$(GEN) --grid ieee14 --fidelity dc --k 1 2 3 4
	$(GEN) --grid ieee14 --fidelity ac --k 1 2 3 4
	$(GEN) --grid ieee30 --fidelity dc --k 1 2 3 4 --workers $(WORKERS)
	$(GEN) --grid ieee30 --fidelity ac --k 1 2 3 --workers $(WORKERS)
	$(GEN) --grid ieee118 --fidelity dc --k 1 2 --workers $(WORKERS)
	$(GEN) --grid ieee118 --fidelity ac --k 1 2 --workers $(WORKERS)
	$(GEN) --grid ieee118 --fidelity dc --k 3 --workers $(WORKERS)

experiments:     ## run every E0-E16 experiment in dependency order (results/phase7/<ID>/)
	$(PY) scripts/run_experiments.py --all
experiment:      ## one experiment: make experiment E=E7
	$(PY) scripts/run_experiments.py --only $(E)
figs:            ## regenerate figures (E15) from the stored inputs
	$(PY) scripts/run_experiments.py --only E15
fixtures:        ## regenerate JS parity fixtures from the Python reference
	$(PY) scripts/make_js_fixtures.py
demo-data:       ## precomputed JSON bundle for the web demo (app/data)
	$(PY) scripts/build_demo_data.py
report:          ## results/phase7/REPORT.md from the manifests
	$(PY) scripts/make_report.py
serve:           ## API + static demo at http://127.0.0.1:8000 (offline)
	$(PY) -m uvicorn doomsday.api.app:app --host 127.0.0.1 --port 8000

blacksky-sync:   ## BLACKSKY: copy the shared engine/data files from app/ into blacksky/site (byte-for-byte)
	$(PY) scripts/build_blacksky.py
blacksky-serve:  ## BLACKSKY site + the unchanged API (at /api) on http://127.0.0.1:8010
	$(PY) -m uvicorn blacksky.serve:app --host 127.0.0.1 --port 8010
blacksky-test:   ## BLACKSKY: sync check, node suite, integration + cross-library checks + e2e journeys
	$(PY) scripts/build_blacksky.py --check
	node --test blacksky/test/*.test.mjs
	$(PY) -m pytest -q tests/integration/test_blacksky.py tests/integration/test_blacksky_quantum.py tests/integration/test_blacksky_ml.py tests/e2e/test_blacksky_e2e.py
blacksky-typecheck: ## BLACKSKY: tsc --checkJs (strict) on js/sci and js/q (dev tool; installs typescript into blacksky/tools)
	npm --prefix blacksky/tools install --no-audit --no-fund
	npm --prefix blacksky/tools run typecheck
blacksky-validate: ## BLACKSKY: run every suite and write blacksky/site/data/validation.json (shown in the Evidence Lab)
	$(PY) scripts/blacksky_validate.py

all: data truth experiments demo-data report test lint   ## V2 26: "all experiments rerun from the Makefile"
