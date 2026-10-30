import os
import subprocess
import sys
import unittest


class GoldEvalTest(unittest.TestCase):
    def test_false_commit_rate_must_be_zero(self):
        backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        result = subprocess.run(
            [sys.executable, os.path.join(backend_dir, "app", "eval", "run_gold.py")],
            cwd=backend_dir,
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            self.fail(f"Gold eval failed with code {result.returncode}:\n{result.stdout}\n{result.stderr}")
        # Check false-commit rate is 0
        self.assertIn("FALSE-COMMIT RATE: 0.0000", result.stdout)


if __name__ == "__main__":
    unittest.main()
