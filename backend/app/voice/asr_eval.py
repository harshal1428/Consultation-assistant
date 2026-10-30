#!/usr/bin/env python3
"""Evaluate ASR on locally recorded clips against reference text.

Clips are never committed. The dev recorder writes them to the gitignored
``backend/tests/audio_local`` directory with a ``manifest.csv`` containing the
gold reference text. A row may carry a ``hypothesis`` column (useful for offline
comparison); otherwise the configured backend transcribes the WAV.

Run from ``backend/``::

    python -m app.voice.asr_eval
    python -m app.voice.asr_eval --backend fake --json
"""

from __future__ import annotations

import argparse
import csv
import json
import wave
from pathlib import Path
from typing import Dict, List, Optional

import numpy as np

from .asr import create_asr_backend
from .config import VoiceConfig
from .correct import correct_text
from .normalize import normalize_voice_text

DEFAULT_AUDIO_DIR = Path(__file__).resolve().parents[2] / "tests" / "audio_local"


def read_wav_mono(path: Path) -> tuple[np.ndarray, int]:
    with wave.open(str(path), "rb") as handle:
        channels = handle.getnchannels()
        width = handle.getsampwidth()
        rate = handle.getframerate()
        frames = handle.readframes(handle.getnframes())
    if width != 2:
        raise ValueError(f"{path}: expected 16-bit PCM, got {width * 8}-bit")
    pcm = np.frombuffer(frames, dtype="<i2").astype(np.float32) / 32768.0
    if channels > 1:
        pcm = pcm.reshape(-1, channels).mean(axis=1)
    return pcm, rate


def _words(text: str) -> str:
    return " ".join((text or "").lower().split())


def _distance(a: List[str], b: List[str]) -> int:
    previous = list(range(len(b) + 1))
    for i, item_a in enumerate(a, start=1):
        current = [i]
        for j, item_b in enumerate(b, start=1):
            current.append(
                min(
                    previous[j] + 1,
                    current[j - 1] + 1,
                    previous[j - 1] + (item_a != item_b),
                )
            )
        previous = current
    return previous[-1]


def word_error_rate(reference: str, hypothesis: str) -> float:
    ref = _words(reference)
    hyp = _words(hypothesis)
    ref_tokens = ref.split()
    if not ref_tokens:
        return 0.0 if not hyp else 1.0
    return _distance(ref_tokens, hyp.split()) / len(ref_tokens)


def character_error_rate(reference: str, hypothesis: str) -> float:
    ref = _words(reference).replace(" ", "")
    hyp = _words(hypothesis).replace(" ", "")
    if not ref:
        return 0.0 if not hyp else 1.0
    return _distance(list(ref), list(hyp)) / len(ref)


def evaluate_manifest(
    manifest_path: Path = DEFAULT_AUDIO_DIR / "manifest.csv",
    backend: Optional[object] = None,
    base_dir: Optional[Path] = None,
) -> Dict:
    if not manifest_path.exists():
        raise FileNotFoundError(
            f"No recording manifest at {manifest_path}. Use the dev recorder "
            "(DEV_TOOLS=1) to capture clips first."
        )
    base_dir = base_dir or manifest_path.parent
    rows = list(csv.DictReader(manifest_path.open(encoding="utf-8")))
    per_clip = []
    for row in rows:
        reference = row.get("reference_text") or row.get("text") or ""
        hypothesis = row.get("hypothesis", "").strip()
        latency_ms = None
        audio_path = base_dir / row.get("file", "") if row.get("file") else None
        if not hypothesis:
            audio_path = base_dir / row["file"]
            audio, rate = read_wav_mono(audio_path)
            if backend is None:
                raise ValueError(
                    f"Row {row.get('key')} has no hypothesis and no ASR backend was supplied"
                )
            result = backend.transcribe(audio, rate)
            hypothesis = result.text
            latency_ms = result.latency_ms
        normalised = normalize_voice_text(hypothesis).text
        corrected = correct_text(normalised).text
        raw_wer = word_error_rate(reference, hypothesis)
        normalised_wer = word_error_rate(reference, corrected)
        duration_s = None
        if audio_path and audio_path.exists():
            try:
                with wave.open(str(audio_path), "rb") as handle:
                    duration_s = handle.getnframes() / float(handle.getframerate())
            except Exception:
                duration_s = None
        per_clip.append(
            {
                "key": row.get("key", ""),
                "reference": reference,
                "raw_hypothesis": hypothesis,
                "normalized_hypothesis": corrected,
                "raw_wer": raw_wer,
                "normalized_wer": normalised_wer,
                "cer": character_error_rate(reference, corrected),
                "duration_s": duration_s,
                "latency_ms": latency_ms,
                "rtf": (latency_ms / 1000.0 / duration_s)
                if latency_ms is not None and duration_s
                else None,
            }
        )

    if not per_clip:
        return {"clips": 0, "raw_wer": None, "normalized_wer": None, "cer": None}
    return {
        "clips": len(per_clip),
        "raw_wer": sum(item["raw_wer"] for item in per_clip) / len(per_clip),
        "normalized_wer": sum(item["normalized_wer"] for item in per_clip) / len(per_clip),
        "cer": sum(item["cer"] for item in per_clip) / len(per_clip),
        "mean_latency_ms": (
            sum(item["latency_ms"] for item in per_clip if item["latency_ms"] is not None)
            / max(1, sum(1 for item in per_clip if item["latency_ms"] is not None))
        ),
        "per_clip": per_clip,
    }


def render_markdown(report: Dict) -> str:
    lines = [
        "# Local ASR evaluation",
        "",
        f"- Clips: {report['clips']}",
        f"- Raw WER: {report.get('raw_wer')}",
        f"- Normalized WER: {report.get('normalized_wer')}",
        f"- CER (normalized): {report.get('cer')}",
        "",
        "| Key | Raw WER | Normalized WER | Reference | Hypothesis |",
        "| --- | ---: | ---: | --- | --- |",
    ]
    for item in report.get("per_clip", []):
        lines.append(
            f"| {item['key']} | {item['raw_wer']:.3f} | {item['normalized_wer']:.3f} "
            f"| {item['reference']!r} | {item['normalized_hypothesis']!r} |"
        )
    return "\n".join(lines) + "\n"


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_AUDIO_DIR / "manifest.csv")
    parser.add_argument("--backend", choices=["configured", "fake"], default="configured")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)

    backend = None
    if args.backend == "fake":
        from .asr.fake_backend import FakeASRBackend

        backend = FakeASRBackend()
    elif not any(row.get("hypothesis") for row in csv.DictReader(args.manifest.open(encoding="utf-8"))):
        backend = create_asr_backend(VoiceConfig.from_env())

    report = evaluate_manifest(args.manifest, backend=backend)
    if args.json:
        print(json.dumps(report, indent=2, ensure_ascii=False))
    else:
        print(render_markdown(report), end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
