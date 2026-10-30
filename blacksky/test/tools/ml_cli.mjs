// Command-line bridge for tests/integration/test_blacksky_ml.py: evaluates the BLACKSKY ML metric and model code on arrays sent as JSON.
import { rocAuc, averagePrecision, classification, calibration, regression, ranking, fitLogistic, fitScaler } from "../../site/js/sci/ml.js";

let raw = ""; process.stdin.on("data", (d) => (raw += d)); process.stdin.on("end", () => {
  const j = JSON.parse(raw), out = {};
  if (j.metrics) { const { y, s, ys, yh, k } = j.metrics;
    Object.assign(out, { auc: rocAuc(y, s), ap: averagePrecision(y, s), cls: classification(y, s, 0.5), cal: calibration(y, s, 10), reg: regression(ys, yh), rank: ranking(ys, yh, k) }); }
  if (j.logistic) { const { X, y, C } = j.logistic, sc = fitScaler(X, [...X.keys()]), Z = X.map(sc.z), m = fitLogistic(Z, y, { C }); Object.assign(out, { coef: m.coef, intercept: m.intercept, mu: sc.mu, sd: sc.sd }); }
  process.stdout.write(JSON.stringify(out));
});
