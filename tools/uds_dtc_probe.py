"""uds_dtc_probe.py — Λίστα υποστηριζόμενων DTC μιας μονάδας (UDS 19 0A) και πλήθος (19 01 FF).
ΜΟΝΟ ανάγνωση. Χρήση: py tools\\uds_dtc_probe.py 7E1 [7E0 ...]
"""
import asyncio
import sys
from collections import Counter

from obd_cli import BleLink, ELM, DEFAULT_BLE
from ecu_id import setup, req


def dtc3(b):
    """UDS DTC 3 bytes → π.χ. C0035-00 (ISO 15031-6 + failure type)."""
    a = b[0]
    return "PCBU"[a >> 6] + str((a >> 4) & 3) + f"{a & 15:X}{b[1]:02X}-{b[2]:02X}"


async def main(addrs):
    link = BleLink(DEFAULT_BLE)
    await link.open()
    elm = ELM(link)
    try:
        await setup(elm)
        for tx in addrs:
            rx = f"{int(tx, 16) + 8:03X}"
            print(f"\n== {tx} → {rx} ==")
            for m in (await req(elm, tx, "1901FF", 3)).get(rx, []):
                print("  19 01 FF:", m.hex(" ").upper())
            for m in (await req(elm, tx, "190A", 5)).get(rx, []):
                if m[:1] != b"\x59":
                    print("  19 0A:", m.hex(" ").upper())
                    continue
                recs = [m[i:i + 4] for i in range(3, len(m) - 3, 4)]
                codes = [dtc3(r[:3]) for r in recs]
                kinds = Counter(c[0] for c in codes)
                print(f"  19 0A: {len(codes)} υποστηριζόμενα DTC, ανά σύστημα: {dict(kinds)}")
                print("  ", " ".join(codes[:60]), "…" if len(codes) > 60 else "")
            for m in (await req(elm, tx, "1902FF", 3)).get(rx, []):
                recs = [m[i:i + 4] for i in range(3, len(m) - 3, 4)]
                print("  19 02 FF (καταγεγραμμένα):", " ".join(f"{dtc3(r[:3])}[{r[3]:02X}]" for r in recs) or "κανένα")
    finally:
        await link.close()


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1:] or ["7E0", "7E1"]))
