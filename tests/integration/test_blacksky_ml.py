"""BLACKSKY ML Risk Observatory code (blacksky/site/js/sci/ml.js) against scikit-learn: ROC AUC, average precision, precision / recall /
F1, Brier score, MAE / RMSE / R², NDCG@k (ignore_ties=True) and L2 logistic-regression coefficients on the same standardised data.
Runs the JavaScript through blacksky/test/tools/ml_cli.mjs. Skips when node or scikit-learn is unavailable."""
from __future__ import annotations
import json, shutil, subprocess
from pathlib import Path
import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[2]
CLI = ROOT / "blacksky" / "test" / "tools" / "ml_cli.mjs"
NODE = shutil.which("node") or ("/opt/node22/bin/node" if Path("/opt/node22/bin/node").exists() else None)
sk = pytest.importorskip("sklearn")
from sklearn import metrics as M  # noqa: E402
from sklearn.linear_model import LogisticRegression  # noqa: E402

pytestmark = pytest.mark.skipif(NODE is None, reason="node not available")


def js(payload):
    r = subprocess.run([NODE, str(CLI)], input=json.dumps(payload), capture_output=True, text=True, timeout=120, check=True)
    return json.loads(r.stdout)


@pytest.mark.parametrize("seed", [0, 1, 2, 3])
def test_metrics_match_sklearn(seed):
    rng = np.random.default_rng(seed); n = 300
    y = (rng.random(n) < 0.18).astype(int)
    s = np.clip(0.35 * y + rng.random(n) * 0.7, 0, 1); s = np.round(s, 2)                 # rounded: exercises tied scores
    ys = rng.gamma(0.6, 0.15, n); yh = ys + rng.normal(0, 0.05, n)
    out = js({"metrics": {"y": y.tolist(), "s": s.tolist(), "ys": ys.tolist(), "yh": yh.tolist(), "k": 20}})
    assert abs(out["auc"] - M.roc_auc_score(y, s)) < 1e-12
    assert abs(out["ap"] - M.average_precision_score(y, s)) < 1e-12
    pred = (s >= 0.5).astype(int)
    assert abs(out["cls"]["precision"] - M.precision_score(y, pred, zero_division=0)) < 1e-12
    assert abs(out["cls"]["recall"] - M.recall_score(y, pred)) < 1e-12
    assert abs(out["cls"]["f1"] - M.f1_score(y, pred)) < 1e-12
    tn, fp, fn, tp = M.confusion_matrix(y, pred).ravel(); assert [out["cls"][k] for k in ("tn", "fp", "fn", "tp")] == [tn, fp, fn, tp]
    assert abs(out["cal"]["brier"] - M.brier_score_loss(y, s)) < 1e-12
    assert abs(out["reg"]["mae"] - M.mean_absolute_error(ys, yh)) < 1e-12
    assert abs(out["reg"]["rmse"] - np.sqrt(M.mean_squared_error(ys, yh))) < 1e-12
    assert abs(out["reg"]["r2"] - M.r2_score(ys, yh)) < 1e-12
    assert abs(out["rank"]["ndcgAtK"] - M.ndcg_score([ys], [yh], k=20, ignore_ties=True)) < 1e-12


def test_logistic_regression_matches_sklearn():
    rng = np.random.default_rng(5); n, p = 400, 6
    X = rng.normal(size=(n, p)) * rng.uniform(0.5, 3, p) + rng.uniform(-2, 2, p)
    w = rng.normal(size=p); y = (rng.random(n) < 1 / (1 + np.exp(-(X - X.mean(0)) / X.std(0) @ w))).astype(int)
    for C in (0.1, 1.0, 10.0):
        out = js({"logistic": {"X": X.tolist(), "y": y.tolist(), "C": C}})
        Z = (X - np.array(out["mu"])) / np.array(out["sd"])
        np.testing.assert_allclose(out["mu"], X.mean(0), atol=1e-12); np.testing.assert_allclose(out["sd"], X.std(0), atol=1e-12)
        ref = LogisticRegression(C=C, tol=1e-12, max_iter=10000).fit(Z, y)
        np.testing.assert_allclose(out["coef"], ref.coef_[0], atol=1e-6); assert abs(out["intercept"] - ref.intercept_[0]) < 1e-6
