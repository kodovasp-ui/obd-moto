"""Whitelist εντολών προς ELM327 / ECU. ΜΟΝΟ ανάγνωση.

Ό,τι δεν ταιριάζει ρητά εδώ απορρίπτεται (whitelist, όχι blacklist).
Η ίδια λίστα υπάρχει στο app/js/safety.js — τα tests ελέγχουν ότι συμφωνούν.
"""
import re

# --- SAFETY-RULES-BEGIN (κράτα ίδιο με app/js/safety.js) ---
# OBD-II modes ανάγνωσης
OBD_READ_MODES = ["01", "02", "03", "06", "07", "09", "0A"]
# UDS υπηρεσίες ανάγνωσης (0x19 ReadDTCInformation, 0x22 ReadDataByIdentifier)
UDS_READ_SERVICES = ["19", "22"]
# Ακριβείς εντολές που επιτρέπονται (0x10 μόνο default session)
EXACT_ALLOWED = ["1001"]
# Σβήσιμο κωδικών: ΜΟΝΟ με allow_clear=True μετά από επιβεβαίωση χρήστη
CLEAR_SERVICES = ["04", "14"]
# Εντολές AT του adapter (regex, χωρίς το πρόθεμα AT, χωρίς κενά)
AT_PATTERNS = [
    r"Z", r"WS", r"D", r"I", r"@1", r"RV", r"DP", r"DPN", r"PC",
    r"E[01]", r"L[01]", r"S[01]", r"H[01]", r"M0", r"AT[012]",
    r"ST[0-9A-F]{2}", r"SP[0-9A-C]", r"SPA[0-9A-C]", r"TP[0-9A-C]",
    r"CAF[01]", r"CFC[01]", r"SH[0-9A-F]{3}", r"SH[0-9A-F]{6}", r"SH[0-9A-F]{8}",
    r"CRA[0-9A-F]{3}", r"CRA[0-9A-F]{8}", r"CRA", r"FCSH[0-9A-F]{3}", r"FCSH[0-9A-F]{8}",
    r"FCSD[0-9A-F]{2,10}", r"FCSM[012]",
    r"CF[0-9A-F]{3}", r"CM[0-9A-F]{3}",
]
# --- SAFETY-RULES-END ---

_AT_RE = [re.compile("^" + p + "$") for p in AT_PATTERNS]
_HEX_RE = re.compile(r"^(?:[0-9A-F]{2})+$")


class UnsafeCommand(ValueError):
    pass


def normalize(cmd: str) -> str:
    return re.sub(r"\s+", "", cmd).upper()


def check(cmd: str, allow_clear: bool = False) -> str:
    """Επιστρέφει την κανονικοποιημένη εντολή ή σηκώνει UnsafeCommand."""
    c = normalize(cmd)
    if not c:
        raise UnsafeCommand("κενή εντολή")
    if c.startswith("AT"):
        body = c[2:]
        if any(r.match(body) for r in _AT_RE):
            return c
        raise UnsafeCommand(f"η εντολή AT '{cmd}' δεν είναι στη whitelist")
    if not _HEX_RE.match(c):
        raise UnsafeCommand(f"μη έγκυρη εντολή '{cmd}' (μόνο AT ή δεκαεξαδικά bytes)")
    svc = c[:2]
    if c in EXACT_ALLOWED:
        return c
    if svc in OBD_READ_MODES or svc in UDS_READ_SERVICES:
        return c
    if svc in CLEAR_SERVICES:
        if allow_clear:
            return c
        raise UnsafeCommand("σβήσιμο κωδικών μόνο μέσω 'clear' με επιβεβαίωση")
    raise UnsafeCommand(f"η υπηρεσία 0x{svc} δεν επιτρέπεται (μόνο ανάγνωση)")
