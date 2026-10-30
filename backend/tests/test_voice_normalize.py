"""Deterministic normalisation and conservative correction tests."""

from __future__ import annotations

import re
import unittest

from app.voice.correct import (
    COMMON_WORDS,
    correct_text,
    get_lexicon,
    hotwords_from_lexicon,
    soundex,
)
from app.voice.normalize import extract_numbers, normalize_voice_text


class VoiceNormalisationTests(unittest.TestCase):
    CASES = [
        ("Raise the bridge by two millimeters", "raise the bridge by 2 mm"),
        ("raise the bridge by 2 millimeters", "raise the bridge by 2 mm"),
        ("raise bridge two mm", "raise bridge 2 mm"),
        ("increase by two", "increase by 2"),
        ("increase by two mm", "increase by 2 mm"),
        ("reduce by half a millimeter", "reduce by 0.5 mm"),
        ("reduce by a half mm", "reduce by 0.5 mm"),
        ("reduce by half mm", "reduce by 0.5 mm"),
        ("rotate tip three degrees", "rotate tip 3 degrees"),
        ("rotate tip by three degrees", "rotate tip by 3 degrees"),
        ("raise bridge by two point five mm", "raise bridge by 2.5 mm"),
        ("raise bridge by two point five millimeters", "raise bridge by 2.5 mm"),
        ("raise bridge by twenty five mm", "raise bridge by 25 mm"),
        ("raise bridge by twenty-five millimeters", "raise bridge by 25 mm"),
        ("raise bridge by a hundred mm", "raise bridge by 100 mm"),
        ("raise bridge by one hundred mm", "raise bridge by 100 mm"),
        ("raise bridge by two hundred mm", "raise bridge by 200 mm"),
        ("raise bridge by thirty five mm", "raise bridge by 35 mm"),
        ("raise bridge by forty two mm", "raise bridge by 42 mm"),
        ("raise bridge by ninety nine mm", "raise bridge by 99 mm"),
        ("raise bridge by a quarter of a millimeter", "raise bridge by 0.25 mm"),
        ("lower the tip by a quarter of a millimeter", "lower the tip by 0.25 mm"),
        ("raise bridge by three quarters of a mm", "raise bridge by 0.75 mm"),
        ("lower tip by three quarters of a millimeter", "lower tip by 0.75 mm"),
        ("raise bridge by point five mm", "raise bridge by 0.5 mm"),
        ("raise bridge by oh point five mm", "raise bridge by 0.5 mm"),
        ("raise bridge by zero point five mm", "raise bridge by 0.5 mm"),
        ("raise bridge by two point zero five mm", "raise bridge by 2.05 mm"),
        ("raise bridge by two point oh five mm", "raise bridge by 2.05 mm"),
        ("raise bridge by one and a half mm", "raise bridge by 1.5 mm"),
        ("raise the bridge by two and a half millimeters", "raise the bridge by 2.5 mm"),
        ("raise bridge by a millimeter", "raise bridge by 1 mm"),
        ("raise bridge by an millimeter", "raise bridge by 1 mm"),
        ("raise bridge by two mil", "raise bridge by 2 mm"),
        ("raise bridge by two mils", "raise bridge by 2 mm"),
        ("raise bridge by two m m", "raise bridge by 2 mm"),
        ("raise bridge by two mms", "raise bridge by 2 mm"),
        ("rotate tip by 3 deg", "rotate tip by 3 degrees"),
        ("rotate tip by 3 degrees", "rotate tip by 3 degrees"),
        ("rotate tip 3 degrees", "rotate tip 3 degrees"),
        ("increase by 5 percent", "increase by 5 percent"),
        ("increase by five per cent", "increase by 5 percent"),
        ("raise bridge by an inch", "raise bridge by 1 inch"),
        ("raise bridge by two inches", "raise bridge by 2 inch"),
        ("raise bridge by two point five centimeters", "raise bridge by 2.5 cm"),
        ("raise bridge by one centimeter", "raise bridge by 1 cm"),
        ("raise bridge by five cm", "raise bridge by 5 cm"),
        ("lower the tip slightly", "lower the tip slightly"),
        ("lower the tip a bit", "lower the tip a bit"),
        ("lower the tip a touch", "lower the tip a touch"),
        ("make the chin a bit more prominent", "make the chin a bit more prominent"),
        ("one might lower the bridge", "one might lower the bridge"),
        ("we may reduce the bridge by two mm", "we may reduce the bridge by 2 mm"),
        ("um uh raise the bridge", "raise the bridge"),
        ("you know raise the bridge", "raise the bridge"),
        ("sort of lower the tip", "lower the tip"),
        ("okay so raise the bridge", "raise the bridge"),
        ("just a moment raise the bridge", "raise the bridge"),
        ("  raise   the bridge  ", "raise the bridge"),
        ("raise the bridge by two mm please", "raise the bridge by 2 mm please"),
        ("raise the bridge by two millimeters, please", "raise the bridge by 2 mm, please"),
        ("increase width by 2 mm", "increase width by 2 mm"),
        ("decrease projection by 1 mm", "decrease projection by 1 mm"),
        ("rotate upward by 3 degrees", "rotate upward by 3 degrees"),
        ("raise the nasal bridge by 2 millimeters", "raise the nasal bridge by 2 mm"),
        ("widen jawline by 2 mm", "widen jawline by 2 mm"),
        ("narrow alar base by 1.5 mm", "narrow alar base by 1.5 mm"),
        ("raise chin by 3 mm", "raise chin by 3 mm"),
        ("raise bridge by two hundreds", "raise bridge by two hundreds"),
    ]

    def test_normalisation_cases(self):
        self.assertGreaterEqual(len(self.CASES), 60)
        for raw, expected in self.CASES:
            with self.subTest(raw=raw):
                result = normalize_voice_text(raw)
                self.assertEqual(result.text, expected)
                if expected != raw.strip().lower():
                    self.assertTrue(result.edits)

    def test_existing_digits_are_preserved(self):
        for raw, expected in self.CASES:
            if not re.search(r"\d", raw):
                continue
            with self.subTest(raw=raw):
                self.assertEqual(
                    re.findall(r"\d+(?:\.\d+)?", raw),
                    re.findall(r"\d+(?:\.\d+)?", expected),
                )

    def test_vague_words_never_gain_a_number(self):
        for raw in (
            "lower the tip slightly",
            "raise the bridge a bit",
            "make the chin more prominent",
            "refine the tip just a touch",
        ):
            result = normalize_voice_text(raw)
            self.assertEqual(extract_numbers(result.text), [])

    def test_numbers_are_extracted_with_units(self):
        numbers = extract_numbers("raise bridge by 2.5 mm and rotate 3 degrees")
        self.assertEqual(numbers[0]["value"], 2.5)
        self.assertEqual(numbers[0]["unit"], "mm")
        self.assertEqual(numbers[1]["value"], 3.0)
        self.assertEqual(numbers[1]["unit"], "degrees")

    def test_empty_input(self):
        self.assertEqual(normalize_voice_text("  ").text, "")


class VoiceCorrectionTests(unittest.TestCase):
    def test_known_mishearings(self):
        cases = {
            "colonel show": "columella show",
            "column ella": "columella",
            "aller base": "alar base",
            "alor base": "alar base",
            "dorsel hump": "nasal bridge",
            "brige": "nasal bridge",
            "pro nasa lee": "nasal tip",
            "hight": "height",
            "definishun": "definition",
            "deegrees": "degrees",
            "jaw lyn": "jawline",
            "row tation": "rotation",
            "may lar": "cheek",
            "sep tum": "septal region",
        }
        for raw, expected in cases.items():
            with self.subTest(raw=raw):
                result = correct_text(raw)
                self.assertEqual(result.text, expected)
                self.assertTrue(result.corrections)
                self.assertTrue(result.as_dicts()[0]["from"])

    def test_canonical_and_common_words_are_untouched(self):
        for raw in (
            "raise the bridge by 2 mm",
            "increase the alar width first",
            "check the tip",
            "look at the tip",
            "show the tip",
            "the tip is fine",
            "maybe do the bridge by 2 mm",
            "right side",
            "left side",
            "patient right",
            "width 2 mm",
        ):
            with self.subTest(raw=raw):
                result = correct_text(raw)
                self.assertEqual(result.text, raw)
                self.assertEqual(result.corrections, [])

    def test_digits_are_never_rewritten(self):
        for raw in ("2 mm", "2.5 mm", "3 degrees", "1.5 mm"):
            self.assertEqual(correct_text(raw).text, raw)

    def test_lexicon_exposes_hotwords_and_soundex(self):
        lexicon = get_lexicon()
        self.assertIn("columella", lexicon.canonicals)
        self.assertIn("alar base", hotwords_from_lexicon())
        self.assertEqual(soundex("colonel"), soundex("columella"))
        self.assertIn("the", COMMON_WORDS)

    def test_correction_is_reported_not_silent(self):
        result = correct_text("aller base by 2 mm")
        self.assertEqual(result.text, "alar base by 2 mm")
        self.assertEqual(len(result.corrections), 1)
        self.assertEqual(result.corrections[0].original, "aller base")


if __name__ == "__main__":
    unittest.main()
