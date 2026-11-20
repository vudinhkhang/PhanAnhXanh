"""CPU-only text classifier with learned linear weights and a safe NumPy artifact."""

from collections import Counter
from functools import lru_cache
from pathlib import Path

import numpy as np

MODEL_PATH = Path(__file__).with_name("data") / "text_model.npz"
MODEL_VERSION = 1


def features(normalized):
    words = normalized.split()
    terms = Counter("w:" + word for word in words)
    terms.update("w:" + first + " " + second for first, second in zip(words, words[1:]))
    for word in words:
        bounded = "^" + word + "$"
        terms.update(
            "c:" + bounded[start:start + size]
            for size in (3, 4, 5)
            for start in range(len(bounded) - size + 1)
        )
    return terms


class TextModel:
    def __init__(self, vocabulary, scale, weights, minimum, margin):
        self.vocabulary = {term: index for index, term in enumerate(vocabulary)}
        self.scale = scale
        self.weights = weights
        self.minimum = minimum
        self.margin = margin

    def encode(self, terms):
        pairs = [(self.vocabulary[term], count) for term, count in terms.items() if term in self.vocabulary]
        if not pairs:
            return np.array([], dtype=int), np.array([], dtype=np.float32)
        indices, counts = map(np.asarray, zip(*pairs))
        values = (1 + np.log(counts)) * self.scale[indices]
        return indices, (values / np.linalg.norm(values)).astype(np.float32)

    def predict(self, terms):
        indices, values = self.encode(terms)
        return values @ self.weights[indices]

    def supplement(self, baseline, scores):
        # An established strong label keeps precedence. The extra class is an
        # internal abstention label, so vague evidence never becomes a category.
        previous = np.sort(baseline)
        if previous[-1] >= .25 and previous[-1] - previous[-2] >= .09:
            return baseline
        ranked = np.argsort(scores)
        best, second = ranked[-1], ranked[-2]
        if best == len(baseline) or scores[best] < self.minimum or scores[best] - scores[second] < self.margin:
            return baseline
        return np.clip(scores[:-1], 0, 1)


@lru_cache(maxsize=1)
def load_model(categories):
    try:
        with np.load(MODEL_PATH, allow_pickle=False) as model:
            if model["version"].item() != MODEL_VERSION or tuple(model["classes"]) != (*categories, "unclear"):
                return None
            words, scale, weights = model["features"], model["scale"], model["weights"]
            if scale.shape != words.shape or weights.shape != (len(words), len(categories) + 1):
                return None
            return TextModel(words, scale, weights, model["minimum"].item(), model["margin"].item())
    except (OSError, ValueError, KeyError):
        return None
