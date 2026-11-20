"""Train and evaluate the local Vietnamese text head. Run with python -m backend.train_text."""

import json
import os
from collections import Counter
from itertools import product
from pathlib import Path
from tempfile import NamedTemporaryFile

import numpy as np

from .classifier import CATEGORIES, EXAMPLES, _baseline_text_scores, _words
from .text_model import MODEL_PATH, MODEL_VERSION, TextModel, features

ROOT = Path(__file__).resolve().parents[1]
CLASSES = (*CATEGORIES, "unclear")


def read_cases(path):
    categories = json.loads(path.read_text(encoding="utf-8"))
    return [(label, _words(text)) for label, texts in categories.items() for text in texts]


def fit(records, char_weight, regularization):
    documents = [features(text) for _, text in records]
    frequencies = Counter(term for document in documents for term in document)
    vocabulary = sorted(term for term, count in frequencies.items() if count >= 2)
    scale = np.array([
        (1 + np.log((1 + len(records)) / (1 + frequencies[term])))
        * (char_weight if term.startswith("c:") else 1.0)
        for term in vocabulary
    ], dtype=np.float32)
    encoder = TextModel(vocabulary, scale, None, .3, .12)
    matrix = np.zeros((len(records), len(vocabulary)), dtype=np.float32)
    for row, document in zip(matrix, documents):
        indices, values = encoder.encode(document)
        row[indices] = values
    labels = np.array([CLASSES.index(label) for label, _ in records])
    class_weights = len(labels) / (len(CLASSES) * np.bincount(labels, minlength=len(CLASSES)))
    weights = np.sqrt(class_weights[labels]).astype(np.float32)
    weighted = matrix * weights[:, None]
    targets = np.eye(len(CLASSES), dtype=np.float32)[labels] * weights[:, None]
    kernel = weighted @ weighted.T
    kernel.flat[:: len(records) + 1] += regularization
    encoder.weights = weighted.T @ np.linalg.solve(kernel, targets)
    return encoder, vocabulary


def suggested(scores):
    return CATEGORIES[int(scores.argmax())] if scores.max() >= .15 else "unclear"


def confidently_grouped(scores):
    ranked = np.sort(scores)
    return bool(suggested(scores) not in ("other", "unclear") and ranked[-1] >= .25 and ranked[-1] - ranked[-2] >= .09)


def metrics(records, score_rows):
    pairs = [(label, suggested(scores)) for (label, _), scores in zip(records, score_rows)]
    f1 = []
    for group in CLASSES:
        tp = sum(a == b == group for a, b in pairs)
        denominator = sum(a == group for a, _ in pairs) + sum(b == group for _, b in pairs)
        f1.append(2 * tp / denominator if denominator else 0)
    return {
        "correct_label": sum(a == b for a, b in pairs),
        "macro_f1": round(float(np.mean(f1)), 3),
        "correct_confident": sum(confidently_grouped(scores) and truth == guess for (truth, guess), scores in zip(pairs, score_rows)),
        "incorrect_confident": sum(confidently_grouped(scores) and truth != guess for (truth, guess), scores in zip(pairs, score_rows)),
        "correct_per_group": {group: sum(a == b == group for a, b in pairs) for group in CLASSES},
    }


def main():
    authored = read_cases(MODEL_PATH.with_name("text_training.json"))
    existing = [(label, _words(text)) for label, texts in EXAMPLES.items() for text in texts]
    evaluation = read_cases(ROOT / "tests/data/local_text_eval.json")
    if {text for _, text in authored + existing} & {text for _, text in evaluation}:
        raise ValueError("A held-out description also appears in training data.")

    # Keep the original examples in each training fold. Only new authored
    # descriptions are held out for selection; the final evaluation is untouched.
    folds = [[] for _ in range(4)]
    offsets = Counter()
    for row in authored:
        folds[offsets[row[0]] % len(folds)].append(row)
        offsets[row[0]] += 1

    best = None
    for char_weight, penalty in product((.55, .9, 1.25), (.25, .65)):
        predictions = []
        for index, validation in enumerate(folds):
            training = existing + [row for fold, rows in enumerate(folds) if fold != index for row in rows]
            model, _ = fit(training, char_weight, penalty)
            predictions.extend(
                (label, _baseline_text_scores(text), model.predict(features(text))) for label, text in validation
            )
        raw_correct = sum(label == CLASSES[int(scores.argmax())] for label, _, scores in predictions)
        for minimum, margin in ((.25, .10), (.30, .12), (.35, .15), (.40, .18)):
            model.minimum, model.margin = minimum, margin
            changes = [(label, before, model.supplement(before, raw)) for label, before, raw in predictions]
            good = sum(new is not old and confidently_grouped(new) and suggested(new) == label for label, old, new in changes)
            bad = sum(new is not old and confidently_grouped(new) and suggested(new) != label for label, old, new in changes)
            key = (good - 5 * bad, -bad, raw_correct, minimum)
            if best is None or key > best[0]:
                best = (key, char_weight, penalty, minimum, margin)

    _, char_weight, penalty, minimum, margin = best
    model, vocabulary = fit(existing + authored, char_weight, penalty)
    model.minimum, model.margin = minimum, margin
    baseline = [_baseline_text_scores(text) for _, text in evaluation]
    updated = [model.supplement(scores, model.predict(features(text))) for (_, text), scores in zip(evaluation, baseline)]
    before, after = metrics(evaluation, baseline), metrics(evaluation, updated)
    print(json.dumps({
        "training_cases": len(existing) + len(authored), "evaluation_cases": len(evaluation),
        "model": {"char_weight": char_weight, "regularization": penalty, "minimum": minimum, "margin": margin},
        "baseline": before, "candidate": after,
    }, indent=2))
    if after["macro_f1"] < before["macro_f1"] or after["incorrect_confident"] > before["incorrect_confident"]:
        raise RuntimeError("Candidate regressed on the held-out evaluation; existing model preserved.")
    with NamedTemporaryFile(dir=MODEL_PATH.parent, delete=False, suffix=".npz") as output:
        np.savez_compressed(output, version=MODEL_VERSION, classes=CLASSES, features=vocabulary,
                            scale=model.scale, weights=model.weights, minimum=minimum, margin=margin)
    os.replace(output.name, MODEL_PATH)


if __name__ == "__main__":
    main()
