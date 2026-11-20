"""Download pinned weights and build CLIP caption embeddings for offline inference.

Run from the project root with: python -m backend.prepare_models
"""

import os
from hashlib import file_digest
from pathlib import Path
from tempfile import NamedTemporaryFile

import numpy as np
from huggingface_hub import snapshot_download
from tokenizers import Tokenizer

from .classifier import CAPTIONS, CATEGORIES, MODEL_DIR, _session

REVISION = "6b7c523703ae26e39be4b03774966f8571c7f523"
FILES = {
    "onnx/text_model_quantized.onnx": "73baab855d406190da9faa498cfedf65f15cf309f4cc7385b7b032e6d08e5c3a",
    "onnx/vision_model_quantized.onnx": "583fd1110a514667812fee7d684952aaf82a99b959760c8d7dca7e0ab9839299",
    "tokenizer.json": "f7f3b7af117d467b58374797691a6438d3e6b9e9cef800dfd5dced7f697a90cd",
}


def valid(path: Path, expected: str) -> bool:
    if not path.is_file():
        return False
    with path.open("rb") as stream:
        return file_digest(stream, "sha256").hexdigest() == expected


def main():
    missing = [
        file for file, digest in FILES.items() if not valid(MODEL_DIR / file, digest)
    ]
    if missing:
        snapshot_download(
            "Xenova/clip-vit-base-patch32",
            revision=REVISION,
            allow_patterns=missing,
            local_dir=MODEL_DIR,
            force_download=True,
        )
        if any(not valid(MODEL_DIR / file, FILES[file]) for file in missing):
            raise RuntimeError(
                "Downloaded CLIP files did not pass SHA-256 verification."
            )

    model = _session(MODEL_DIR / "onnx/text_model_quantized.onnx")
    tokenizer = Tokenizer.from_file(str(MODEL_DIR / "tokenizer.json"))
    # Encode each short caption at its native length, avoiding padding artifacts.
    prototypes = []
    for category in CATEGORIES:
        vectors = []
        for caption in CAPTIONS[category]:
            tokens = np.array([tokenizer.encode(caption).ids], dtype=np.int64)
            (embedding,) = model.run(["text_embeds"], {"input_ids": tokens})
            vectors.append(embedding[0] / np.linalg.norm(embedding[0]))
        average = np.mean(vectors, axis=0)
        prototypes.append(average / np.linalg.norm(average))

    with NamedTemporaryFile(dir=MODEL_DIR, delete=False, suffix=".npy") as output:
        np.save(output, np.array(prototypes, dtype=np.float32))
    os.replace(output.name, MODEL_DIR / "prototypes.npy")
    print(f"CLIP ready for offline inference in {MODEL_DIR}")


if __name__ == "__main__":
    main()
