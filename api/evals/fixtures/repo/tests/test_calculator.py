import unittest

from src.calculator import add, mean


class CalculatorTests(unittest.TestCase):
    def test_add(self):
        self.assertEqual(add(2, 3), 5)
        self.assertEqual(add(-2, 3), 1)

    def test_mean(self):
        self.assertEqual(mean([2, 4]), 3)


if __name__ == "__main__":
    unittest.main()
