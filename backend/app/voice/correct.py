"""Conservative lexicon-based correction for domain terms.

Rules:

* exact known mishearings are applied;
* fuzzy matching runs only on domain-sized words (>= 5 letters) and only above a
  high score, with a phonetic Soundex boost;
* common English words, digits, and already-recognised aliases are protected;
* every change is returned in ``corrections`` for the UI/API, never silent.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Set, Tuple

try:
    from rapidfuzz import fuzz
except Exception:  # pragma: no cover - optional dependency fallback
    fuzz = None

HERE = Path(__file__).resolve().parent
SEED_LEXICON = HERE / "lexicon" / "nasal_terms.json"
PARSER_LEXICON = HERE.parent / "data" / "lexicon.json"

COMMON_WORDS = {
    "the", "a", "an", "and", "or", "but", "if", "then", "than", "so", "to",
    "of", "in", "on", "at", "by", "for", "from", "with", "without", "about",
    "this", "that", "these", "those", "there", "their", "they", "them", "it",
    "its", "is", "are", "was", "were", "be", "been", "being", "do", "does",
    "did", "done", "have", "has", "had", "can", "could", "would", "should",
    "will", "may", "might", "must", "please", "thank", "thanks", "hello",
    "maybe", "perhaps", "probably", "possibly", "just", "only", "very", "much",
    "more", "most", "some", "such", "any", "all", "both", "each", "other",
    "what", "when", "where", "which", "while", "who", "why", "how", "again",
    "before", "after", "over", "under", "between", "into", "onto", "up",
    "down", "out", "off", "here", "now", "first", "last", "next", "same",
    "different", "little", "bit", "touch", "slightly", "quite", "really",
    "want", "need", "make", "take", "look", "check", "see", "show", "try",
    "let", "lets", "let's", "go", "ahead", "yes", "no", "not", "don't",
    "do not", "never", "mind", "okay", "ok", "work", "thing", "something",
    "anything", "nothing", "change", "adjust", "shape", "sure", "right",
    "left", "side", "patient", "first", "second", "third",
}


def soundex(word: str) -> str:
    word = re.sub(r"[^a-z]", "", (word or "").lower())
    if not word:
        return ""
    codes = {
        **dict.fromkeys("bfpv", "1"),
        **dict.fromkeys("cgjkqsxz", "2"),
        **dict.fromkeys("dt", "3"),
        "l": "4",
        **dict.fromkeys("mn", "5"),
        "r": "6",
    }
    first = word[0].upper()
    last_code = codes.get(word[0], "")
    digits = []
    for char in word[1:]:
        code = codes.get(char, "")
        if code and code != last_code:
            digits.append(code)
        if char not in "hw":
            last_code = code
    return (first + "".join(digits) + "000")[:4]


@dataclass
class Correction:
    original: str
    replacement: str
    score: float
    reason: str


@dataclass
class CorrectionResult:
    text: str
    corrections: List[Correction] = field(default_factory=list)

    def as_dicts(self) -> List[dict]:
        return [
            {
                "from": item.original,
                "to": item.replacement,
                "score": round(item.score, 2),
                "reason": item.reason,
            }
            for item in self.corrections
        ]


def _load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


class DomainLexicon:
    def __init__(self, seed_path: Path = SEED_LEXICON, parser_path: Path = PARSER_LEXICON):
        self.terms: List[dict] = []
        seed = _load_json(seed_path)
        self.terms.extend(seed.get("terms", []))
        if parser_path.exists():
            parser = _load_json(parser_path)
            existing = {term["canonical"] for term in self.terms}
            for term in (parser.get("nasal_terms") or {}):
                if term not in existing:
                    self.terms.append({"canonical": term, "aliases": [], "mishearings": []})

        self.mishearings: Dict[str, str] = {}
        self.aliases: Dict[str, str] = {}
        self.canonicals: Set[str] = set()
        self.fuzzy_candidates: Dict[str, str] = {}
        for term in self.terms:
            canonical = (term.get("canonical") or "").strip().lower()
            if not canonical:
                continue
            self.canonicals.add(canonical)
            self.fuzzy_candidates[canonical] = canonical
            for alias in term.get("aliases", []):
                alias = alias.strip().lower()
                if alias:
                    self.aliases[alias] = canonical
                    self.fuzzy_candidates[alias] = canonical
            for mishearing in term.get("mishearings", []):
                mishearing = mishearing.strip().lower()
                if mishearing:
                    self.mishearings[mishearing] = canonical
                    self.fuzzy_candidates[mishearing] = canonical

        self.protected = set(self.aliases) | self.canonicals
        self.multiword_mishearings = {
            key: value for key, value in self.mishearings.items() if " " in key
        }

    def hotwords(self) -> str:
        words = set(self.canonicals) | set(self.aliases)
        return ", ".join(sorted(words))


_LEXICON: Optional[DomainLexicon] = None


def get_lexicon() -> DomainLexicon:
    global _LEXICON
    if _LEXICON is None:
        _LEXICON = DomainLexicon()
    return _LEXICON


def _best_fuzzy(token: str, lexicon: DomainLexicon) -> Tuple[str, float, str]:
    if fuzz is None:
        return "", 0.0, ""
    best_term = ""
    best_score = 0.0
    best_canonical = ""
    token_soundex = soundex(token)
    for candidate, canonical in lexicon.fuzzy_candidates.items():
        if " " in candidate:
            continue
        score = float(fuzz.WRatio(token, candidate))
        # A phonetic match is useful for misheard anatomy (colonel/columella),
        # but only with a reasonably close spelling as well.
        if token_soundex and soundex(candidate) == token_soundex and score >= 80:
            score = max(score, 88.0)
        if score > best_score:
            best_score = score
            best_term = candidate
            best_canonical = canonical
    if not best_term:
        return "", 0.0, ""
    return best_canonical, best_score, "phonetic-fuzzy" if soundex(best_term) == token_soundex else "fuzzy"


def correct_text(text: str, min_score: float = 91.0) -> CorrectionResult:
    lexicon = get_lexicon()
    result = text or ""
    corrections: List[Correction] = []

    # Multi-word mishearings first (longest first so "column ella" wins over
    # a shorter accidental match).
    for phrase in sorted(lexicon.multiword_mishearings, key=len, reverse=True):
        replacement = lexicon.multiword_mishearings[phrase]
        pattern = re.compile(rf"\b{re.escape(phrase)}\b", re.I)
        if pattern.search(result):
            result = pattern.sub(replacement, result)
            corrections.append(Correction(phrase, replacement, 100.0, "known mishearing"))

    tokens = list(re.finditer(r"[A-Za-z][A-Za-z'\-]*", result))
    replacements: List[Tuple[int, int, str]] = []
    for match in tokens:
        original = match.group(0)
        token = original.lower().strip("'-")
        if not token or any(char.isdigit() for char in original):
            continue
        if token in lexicon.protected:
            continue
        if token in COMMON_WORDS:
            continue
        if token in lexicon.mishearings:
            replacement = lexicon.mishearings[token]
            if replacement.lower() != token:
                replacements.append((match.start(), match.end(), replacement))
                corrections.append(Correction(original, replacement, 100.0, "known mishearing"))
            continue
        if len(token) < 5:
            continue
        replacement, score, reason = _best_fuzzy(token, lexicon)
        threshold = 88.0 if reason == "phonetic-fuzzy" else min_score
        if replacement and score >= threshold and replacement.lower() != token:
            replacements.append((match.start(), match.end(), replacement))
            corrections.append(Correction(original, replacement, score, reason))

    for start, end, replacement in reversed(replacements):
        result = result[:start] + replacement + result[end:]

    return CorrectionResult(result, corrections)


def hotwords_from_lexicon() -> str:
    return get_lexicon().hotwords()


def reset_lexicon_cache() -> None:
    global _LEXICON
    _LEXICON = None
