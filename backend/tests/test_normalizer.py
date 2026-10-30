import unittest
from app.normalizer import (
    remove_fillers,
    spoken_to_numeric,
    normalize_units,
    fuzzy_correct,
    normalize,
    extract_numbers_units,
)


class NormalizerTests(unittest.TestCase):
    def test_remove_fillers(self):
        self.assertEqual(remove_fillers("um raise the bridge"), "raise the bridge")
        self.assertEqual(remove_fillers("well you see reduce tip"), "reduce tip")
    
    def test_spoken_numbers(self):
        self.assertIn("2.5", spoken_to_numeric("two point five millimeters"))
        self.assertIn("2.5", spoken_to_numeric("two and a half mm"))
        self.assertIn("3", spoken_to_numeric("three mil"))
        self.assertIn("0.5", spoken_to_numeric("half a millimeter"))
        self.assertIn("1", spoken_to_numeric("a millimeter"))
    
    def test_unit_normalization(self):
        self.assertIn("mm", normalize_units("three mil"))
        self.assertIn("mm", normalize_units("two millimeters"))
        self.assertIn("degrees", normalize_units("5 degrees"))
        self.assertIn("cm", normalize_units("1 cm"))
    
    def test_fuzzy_correction_colonel_to_columella(self):
        result = fuzzy_correct("colonel show")
        # Should correct colonel to columella
        self.assertIn("columella", result.lower())
    
    def test_normalize_pipeline(self):
        result = normalize("um raise the bridge by two and a half mm")
        self.assertIn("2.5", result)
        self.assertIn("mm", result)
    
    def test_extract_numbers_units(self):
        nums = extract_numbers_units("raise bridge by 2.5 mm")
        self.assertEqual(len(nums), 1)
        self.assertEqual(nums[0][0], 2.5)
        self.assertEqual(nums[0][1], "mm")
    
    def test_percent_not_converted_to_mm(self):
        # percent should remain as percent
        nums = extract_numbers_units("increase by 50 percent")
        self.assertEqual(nums[0][1], "%")


if __name__ == "__main__":
    unittest.main()
