import fs from "node:fs";
import path from "node:path";
import * as turf from "@turf/turf";

const rootDir = process.cwd();
const replayCellsPath = path.join(rootDir, "public/data/amboseli/v2-replay-cells.geojson");
const manifestPath = path.join(rootDir, "public/data/amboseli/sentinel1-flood-mask-manifest.json");
const publicReportPath = path.join(rootDir, "public/data/amboseli/v2-real-mask-evaluation.json");
const assetReportPath = path.join(rootDir, "versions/v2-forecast-mvp/data/reports/v2_real_mask_evaluation.json");
const wetThreshold = 0.5;
const maskWetThreshold = 0.62;

for (const requiredPath of [replayCellsPath, manifestPath]) {
  if (!fs.existsSync(requiredPath)) throw new Error(`Missing ${path.relative(rootDir, requiredPath)}.`);
}

const replayCells = JSON.parse(fs.readFileSync(replayCellsPath, "utf8"));
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const maskRecords = Object.fromEntries((manifest.masks ?? []).map((record) => [record.window, record]));
const beforeMask = loadMask("beforeFlooding");
const duringMask = loadMask("duringFlooding");
const recoveryMask = loadMask("recoveryComparison");
const examples = replayCells.features.map((cell) => evaluateCell(cell, beforeMask, duringMask, recoveryMask));
const labeledExamples = examples.filter((example) => example.maskCoverage > 0);
const evaluationPairs = labeledExamples.map((example) => [example.modelProbability, example.observedWet ? 1 : 0]);
const trainedRegression = trainAndEvaluate(labeledExamples);
const report = {
  generatedAt: new Date().toISOString(),
  replayId: "amboseli-2026-march",
  method: "v2-simple-regression-vs-generated-sentinel1-mask-grid-v1",
  caveat:
    "This evaluates the current V2 simple regression against generated Sentinel-1 planning masks, not against a hand-labeled authoritative inundation product.",
  targetWindow: {
    window: "duringFlooding",
    observedRange: maskRecords.duringFlooding?.observedRange ?? null,
    maskMethod: maskRecords.duringFlooding?.method?.id ?? "missing",
    maskWetThreshold
  },
  comparisonWindows: {
    beforeFlooding: maskRecords.beforeFlooding?.observedRange ?? null,
    recoveryComparison: maskRecords.recoveryComparison?.observedRange ?? null
  },
  metrics: metrics(evaluationPairs, labeledExamples),
  trainedRegression,
  baselines: baselines(labeledExamples),
  confusion: confusion(labeledExamples),
  examples: labeledExamples
};

fs.mkdirSync(path.dirname(publicReportPath), { recursive: true });
fs.mkdirSync(path.dirname(assetReportPath), { recursive: true });
fs.writeFileSync(publicReportPath, `${JSON.stringify(report, null, 2)}\n`);
fs.writeFileSync(assetReportPath, `${JSON.stringify(report, null, 2)}\n`);

console.log(`Wrote ${path.relative(rootDir, publicReportPath)}`);
console.log(`Wrote ${path.relative(rootDir, assetReportPath)}`);

function loadMask(windowKey) {
  const record = maskRecords[windowKey];
  if (!record?.href) return { type: "FeatureCollection", features: [] };
  const maskPath = path.join(rootDir, "public", record.href);
  if (!fs.existsSync(maskPath)) return { type: "FeatureCollection", features: [] };
  return JSON.parse(fs.readFileSync(maskPath, "utf8"));
}

function evaluateCell(cell, before, during, recovery) {
  const modelProbability = probabilityFor(cell.properties);
  const beforeObservation = maskObservation(cell, before);
  const duringObservation = maskObservation(cell, during);
  const recoveryObservation = maskObservation(cell, recovery);
  const observedWet = duringObservation.maxProbability >= maskWetThreshold;
  const changedFromBefore =
    duringObservation.maxProbability >= maskWetThreshold &&
    beforeObservation.maxProbability < wetThreshold;

  return {
    cellId: cell.properties.cellId,
    label: cell.properties.label,
    model: cell.properties.stateAtIssue === "wet" ? "persistence-v1" : "wetting-v1",
    modelProbability,
    predictedWet: modelProbability >= wetThreshold,
    observedWet,
    observedMaskProbability: round(duringObservation.maxProbability),
    beforeMaskProbability: round(beforeObservation.maxProbability),
    recoveryMaskProbability: round(recoveryObservation.maxProbability),
    changedFromBefore,
    maskCoverage: round(duringObservation.coverage),
    fixtureObservedWet: cell.properties.observedAtValid === "wet",
    baselines: {
      currentFloodPersistence: cell.properties.stateAtIssue === "wet" ? 0.82 : 0.18,
      historicalFrequency: cell.properties.historicalFloodFrequency,
      rainfallThreshold: rainfallThreshold(cell.properties)
    },
    features: featureVector(cell.properties)
  };
}

function maskObservation(cell, mask) {
  const overlaps = mask.features
    .map((feature) => {
      if (!turf.booleanIntersects(cell, feature)) return null;
      const intersection = turf.intersect(turf.featureCollection([cell, feature]));
      const coverage = intersection ? turf.area(intersection) / Math.max(turf.area(cell), 1) : 0;
      return {
        probability: feature.properties.floodProbability,
        coverage
      };
    })
    .filter(Boolean);

  if (overlaps.length === 0) return { maxProbability: 0, coverage: 0 };
  return {
    maxProbability: Math.max(...overlaps.map((overlap) => overlap.probability)),
    coverage: Math.min(1, overlaps.reduce((sum, overlap) => sum + overlap.coverage, 0))
  };
}

function metrics(pairs, examples) {
  return {
    evaluatedCells: examples.length,
    brierScore: brier(pairs),
    calibrationError: calibration(pairs),
    precision: precision(examples),
    recall: recall(examples),
    fixtureAgreement: round(
      mean(examples.map((example) => (example.fixtureObservedWet === example.observedWet ? 1 : 0)))
    )
  };
}

function baselines(examples) {
  return [
    {
      id: "current_flood_persistence",
      label: "Current flood persists",
      brierScore: brier(examples.map((example) => [example.baselines.currentFloodPersistence, example.observedWet ? 1 : 0]))
    },
    {
      id: "historical_frequency",
      label: "Historical frequency",
      brierScore: brier(examples.map((example) => [example.baselines.historicalFrequency, example.observedWet ? 1 : 0]))
    },
    {
      id: "rainfall_threshold",
      label: "Rainfall threshold",
      brierScore: brier(examples.map((example) => [example.baselines.rainfallThreshold, example.observedWet ? 1 : 0]))
    }
  ];
}

function trainAndEvaluate(examples) {
  if (examples.length < 4 || examples.some((example) => typeof example.observedWet !== "boolean")) {
    return {
      protocol: "leave-one-mask-cell-out-logistic-regression",
      status: "insufficient_examples",
      metrics: {
        evaluatedCells: examples.length,
        brierScore: null,
        calibrationError: null,
        precision: null,
        recall: null
      },
      featureNames: featureNames()
    };
  }

  const predictions = examples.map((heldOut, index) => {
    const training = examples.filter((_, candidateIndex) => candidateIndex !== index);
    const weights = fitLogistic(training);
    return {
      ...heldOut,
      trainedProbability: round(sigmoid(dot(weights, heldOut.features))),
      trainedPredictedWet: sigmoid(dot(weights, heldOut.features)) >= wetThreshold
    };
  });
  const pairs = predictions.map((example) => [example.trainedProbability, example.observedWet ? 1 : 0]);

  return {
    protocol: "leave-one-mask-cell-out-logistic-regression",
    status: "evaluated",
    featureNames: featureNames(),
    metrics: {
      evaluatedCells: predictions.length,
      brierScore: brier(pairs),
      calibrationError: calibration(pairs),
      precision: precisionWithKey(predictions, "trainedPredictedWet"),
      recall: recallWithKey(predictions, "trainedPredictedWet")
    },
    predictions: predictions.map((example) => ({
      cellId: example.cellId,
      label: example.label,
      trainedProbability: example.trainedProbability,
      observedWet: example.observedWet
    }))
  };
}

function fitLogistic(training) {
  const weights = Array.from({ length: featureNames().length }, () => 0);
  const learningRate = 0.18;
  const l2 = 0.015;

  for (let iteration = 0; iteration < 900; iteration += 1) {
    const gradients = Array.from({ length: weights.length }, () => 0);
    for (const example of training) {
      const predicted = sigmoid(dot(weights, example.features));
      const actual = example.observedWet ? 1 : 0;
      for (let index = 0; index < weights.length; index += 1) {
        gradients[index] += (predicted - actual) * example.features[index];
      }
    }
    for (let index = 0; index < weights.length; index += 1) {
      const regularization = index === 0 ? 0 : l2 * weights[index];
      weights[index] -= learningRate * (gradients[index] / training.length + regularization);
    }
  }

  return weights;
}

function featureNames() {
  return [
    "bias",
    "state_at_issue_wet",
    "forecast_72h_rain_100mm",
    "previous_30d_rain_200mm",
    "historical_flood_frequency",
    "distance_to_current_flood_1000m",
    "flooded_neighbor_fraction",
    "inverse_hand_5m",
    "days_flooded_min_10d",
    "historical_residence_30d"
  ];
}

function featureVector(properties) {
  return [
    1,
    properties.stateAtIssue === "wet" ? 1 : 0,
    properties.forecast72hRainMm / 100,
    properties.previous30dRainMm / 200,
    properties.historicalFloodFrequency,
    properties.distanceToCurrentFloodM / 1000,
    properties.floodedNeighborFraction,
    1 - Math.min(properties.handMeters / 5, 1),
    properties.daysFloodedMin / 10,
    properties.historicalResidenceMedianDays / 30
  ];
}

function confusion(examples) {
  return examples.reduce(
    (summary, example) => {
      if (example.predictedWet && example.observedWet) summary.truePositive += 1;
      if (example.predictedWet && !example.observedWet) summary.falsePositive += 1;
      if (!example.predictedWet && example.observedWet) summary.falseNegative += 1;
      if (!example.predictedWet && !example.observedWet) summary.trueNegative += 1;
      return summary;
    },
    { truePositive: 0, falsePositive: 0, falseNegative: 0, trueNegative: 0 }
  );
}

function probabilityFor(properties) {
  if (properties.stateAtIssue === "wet") {
    return round(
      sigmoid(
        -0.95 +
          properties.forecast72hRainMm * 0.01 +
          properties.floodedNeighborFraction * 0.95 +
          properties.daysFloodedMin * 0.08 +
          properties.historicalResidenceMedianDays * 0.035 -
          properties.handMeters * 0.18 -
          properties.observationAgeDays * 0.04
      )
    );
  }

  return round(
    sigmoid(
      -2.8 +
        properties.forecast72hRainMm * 0.024 +
        properties.previous30dRainMm * 0.005 +
        properties.historicalFloodFrequency * 1.65 +
        properties.floodedNeighborFraction * 1.05 -
        properties.distanceToCurrentFloodM * 0.0011 -
        properties.handMeters * 0.22 -
        properties.observationAgeDays * 0.04
    )
  );
}

function rainfallThreshold(properties) {
  if (properties.forecast72hRainMm >= 64 && properties.historicalFloodFrequency >= 0.35) return 0.72;
  if (properties.forecast72hRainMm >= 52 && properties.historicalFloodFrequency >= 0.25) return 0.48;
  return 0.18;
}

function precision(examples) {
  const predicted = examples.filter((example) => example.predictedWet);
  if (predicted.length === 0) return 1;
  return round(predicted.filter((example) => example.observedWet).length / predicted.length);
}

function recall(examples) {
  const observed = examples.filter((example) => example.observedWet);
  if (observed.length === 0) return 1;
  return round(observed.filter((example) => example.predictedWet).length / observed.length);
}

function precisionWithKey(examples, predictionKey) {
  const predicted = examples.filter((example) => example[predictionKey]);
  if (predicted.length === 0) return 1;
  return round(predicted.filter((example) => example.observedWet).length / predicted.length);
}

function recallWithKey(examples, predictionKey) {
  const observed = examples.filter((example) => example.observedWet);
  if (observed.length === 0) return 1;
  return round(observed.filter((example) => example[predictionKey]).length / observed.length);
}

function brier(pairs) {
  return round(mean(pairs.map(([probability, actual]) => (probability - actual) ** 2)));
}

function calibration(pairs) {
  const bins = [
    pairs.filter(([probability]) => probability < 0.33),
    pairs.filter(([probability]) => probability >= 0.33 && probability < 0.66),
    pairs.filter(([probability]) => probability >= 0.66)
  ].filter((bin) => bin.length > 0);

  return round(
    mean(
      bins.map((bin) => {
        const predicted = mean(bin.map(([probability]) => probability));
        const actual = mean(bin.map(([, observed]) => observed));
        return Math.abs(predicted - actual);
      })
    )
  );
}

function sigmoid(value) {
  return 1 / (1 + Math.exp(-value));
}

function dot(weights, features) {
  return weights.reduce((sum, weight, index) => sum + weight * features[index], 0);
}

function mean(values) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}
