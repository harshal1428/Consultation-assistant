"""Normalizer for spoken commands with phonetic/fuzzy correction."""

import json
import os
import re
from typing import Dict, List, Optional, Tuple

try:
    from rapidfuzz import fuzz, process
except Exception:
    fuzz = None
    process = None


def _load_lexicon() -> Dict:
    lex_path = os.path.join(os.path.dirname(__file__), "data", "lexicon.json")
    with open(lex_path, "r", encoding="utf-8") as f:
        return json.load(f)


LEXICON = _load_lexicon()


NUMBER_WORDS = {
    "zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
    "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
    "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14,
    "fifteen": 15, "sixteen": 16, "seventeen": 17, "eighteen": 18,
    "nineteen": 19, "twenty": 20, "half": 0.5, "quarter": 0.25
}


FILLERS = [
    r"\b(um+|uh+|hmm+|ah+|er+|mm+)\b",
    r"\b(well|you see|kind of|sort of|like)\b",
    r"\b(just a moment|give me a moment)\b",
]


def remove_fillers(text: str) -> str:
    result = text
    for pattern in FILLERS:
        result = re.sub(pattern, " ", result, flags=re.I)
    return re.sub(r"\s+", " ", result).strip()


def _word_to_num(w):
    w = w.lower()
    if w in NUMBER_WORDS and w != "half":
        return str(NUMBER_WORDS[w])
    try:
        return str(int(w))
    except:
        return w


def spoken_to_numeric(text: str) -> str:
    result = text.lower()
    
    # Handle "X point Y"
    result = re.sub(r'\b(\w+)\s+point\s+(\w+)\b', lambda m: f"{_word_to_num(m.group(1))}.{_word_to_num(m.group(2))}", result)
    
    # Handle "X and a half"
    result = re.sub(r'\b([a-z]+)\s+and\s+a\s+half\b', lambda m: f"{m.group(1)}_and_a_half", result)
    
    # Handle fractions
    result = re.sub(r'\bhalf\s+a\s+millimet(?:er|re)\b', '0.5 mm', result)
    result = re.sub(r'\ba\s+half\s+millimet(?:er|re)\b', '0.5 mm', result)
    
    def replace_number_word(m):
        word = m.group(0).lower()
        if word.endswith("_and_a_half"):
            base = word[:-len("_and_a_half")]
            if base in NUMBER_WORDS:
                return str(NUMBER_WORDS[base] + 0.5)
        if word in NUMBER_WORDS:
            return str(NUMBER_WORDS[word])
        return word
    
    # Replace number words
    for word in sorted([w for w in NUMBER_WORDS.keys() if '_' not in w and w != "half"], key=len, reverse=True):
        result = re.sub(r'\b' + re.escape(word) + r'\b', str(NUMBER_WORDS[word]), result)
    
    result = re.sub(r'\b([a-z]+)_and_a_half\b', replace_number_word, result)
    
    # "a millimeter", "an inch"
    result = re.sub(r'\b(?:a|an)\s+(millimet(?:er|re)s?|mm|inch)\b', lambda m: '1 mm' if m.group(1).lower() in ['millimeter', 'millimetre', 'millimeters', 'millimetres', 'mm'] else '1 ' + m.group(1), result)
    
    return result


def normalize_units(text: str) -> str:
    result = text
    # mm variations
    result = re.sub(r'\bmillimet(?:er|re)s?\b', 'mm', result, flags=re.I)
    result = re.sub(r'\bmil\b', 'mm', result, flags=re.I)
    result = re.sub(r'\bm\s*m\b', 'mm', result, flags=re.I)
    # cm
    result = re.sub(r'\bcentimet(?:er|re)s?\b', 'cm', result, flags=re.I)
    # degrees
    result = re.sub(r'\bdegrees?\b', 'degrees', result, flags=re.I)
    result = re.sub(r'°', ' degrees', result)
    # percent
    result = re.sub(r'\bpercent\b', '%', result, flags=re.I)
    return result


def fuzzy_correct(text: str, threshold: float = 80.0) -> str:
    if fuzz is None or process is None:
        return text
    
    result = text
    # Get all terms from lexicon
    all_terms = []
    for term in LEXICON.get("nasal_terms", {}).keys():
        all_terms.append(term)
    for term in ["columella", "alar rim", "supratip break", "nasolabial angle", "colonel"]:
        if term not in all_terms:
            all_terms.append(term)
    
    # Special case
    if re.search(r'\bcolonel\b', result, re.I):
        result = re.sub(r'\bcolonel\b', 'columella', result, flags=re.I)
    
    # Try to correct multi-word terms first
    words = result.split()
    i = 0
    corrected_words = []
    while i < len(words):
        # Try 3-word, 2-word, 1-word
        for length in [3, 2, 1]:
            if i + length <= len(words):
                candidate = " ".join(words[i:i+length])
                match = process.extractOne(candidate, all_terms, scorer=fuzz.ratio)
                if match and match[1] >= threshold:
                    corrected_words.append(match[0])
                    i += length
                    break
        else:
            corrected_words.append(words[i])
            i += 1
    
    return " ".join(corrected_words)


def normalize(text: str) -> str:
    """Full normalization pipeline."""
    result = text
    result = remove_fillers(result)
    result = spoken_to_numeric(result)
    result = normalize_units(result)
    result = fuzzy_correct(result)
    # Ensure mm stays
    if re.search(r'\d', result) and 'mm' not in result.lower() and 'degree' not in result.lower() and '%' not in result and 'cm' not in result.lower():
        result = result + ' mm'
    return result


def extract_numbers_units(text: str) -> List[Tuple[float, str]]:
    result = normalize(text)
    matches = re.findall(r'(\d+(?:\.\d+)?)\s*(mm|cm|degrees|percent|%)', result, flags=re.I)
    out = []
    for m in matches:
        unit = m[1].lower()
        if unit == 'percent':
            unit = '%'
        out.append((float(m[0]), unit))
    return out
