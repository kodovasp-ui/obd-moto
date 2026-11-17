"""Tests της whitelist ασφαλείας (Python + έλεγχος ισοδυναμίας με app/js/safety.js)."""
import json
import re
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import obd_safety as S  # noqa: E402

FORBIDDEN = [
    "1002", "1003", "1060", "10",          # 0x10 εκτός default session
    "1101", "2701", "2702",                # reset, security access
    "2EF19001", "2F123403", "3101FF00",    # write DID, IO control, routine
    "3400", "3500", "3601", "3700",        # download/upload/transfer
    "3D00", "85", "28", "05", "08", "1A",  # write memory, άλλες υπηρεσίες
    "0101X", "ATPP0CSV", "ATMA", "ATBRD23", "ATSI", "STPX", "",
]
ALLOWED = [
    "0100", "01 0C", "0200", "03", "0600", "07", "0902", "0A",
    "1902FF", "190A", "22F190", "22 F1 87", "1001",
    "ATZ", "ATE0", "ATSP0", "ATSH7E0", "ATSH7DF", "ATDPN", "ATRV",
    "ATCRA7E8", "ATFCSH7E0", "ATST64", "ATCAF1", "ATCF700", "ATCM700",
]


class PythonWhitelist(unittest.TestCase):
    def test_allowed(self):
        for c in ALLOWED:
            with self.subTest(c=c):
                S.check(c)

    def test_forbidden(self):
        for c in FORBIDDEN:
            with self.subTest(c=c):
                with self.assertRaises(S.UnsafeCommand):
                    S.check(c)

    def test_forbidden_even_with_allow_clear(self):
        for c in FORBIDDEN:
            with self.subTest(c=c):
                with self.assertRaises(S.UnsafeCommand):
                    S.check(c, allow_clear=True)

    def test_clear_needs_flag(self):
        for c in ("04", "14FFFFFF"):
            with self.assertRaises(S.UnsafeCommand):
                S.check(c)
            S.check(c, allow_clear=True)


def _js_rules():
    src = (ROOT / "app" / "js" / "safety.js").read_text(encoding="utf-8")
    block = re.search(r"SAFETY-RULES-BEGIN.*?\n(.*?)// --- SAFETY-RULES-END", src, re.S).group(1)
    out = {}
    for name, body in re.findall(r"export const (\w+) = (\[.*?\]);", block, re.S):
        if name == "AT_PATTERNS":
            out[name] = re.findall(r"'([^']*)'", body)
        else:
            out[name] = json.loads(body.replace("'", '"'))
    return out


class JsParity(unittest.TestCase):
    def test_same_rules(self):
        js = _js_rules()
        for name in ("OBD_READ_MODES", "UDS_READ_SERVICES", "EXACT_ALLOWED",
                     "CLEAR_SERVICES", "AT_PATTERNS"):
            with self.subTest(name=name):
                self.assertEqual(js[name], getattr(S, name))


if __name__ == "__main__":
    unittest.main()
