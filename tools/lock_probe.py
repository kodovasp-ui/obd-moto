"""lock_probe.py — Έλεγχος αν η ECU είναι κλειδωμένη για εγγραφή. ΜΟΝΟ ΑΝΑΓΝΩΣΗ.

ΕΚΤΟΣ της whitelist της εφαρμογής, κατόπιν ρητού αιτήματος χρήστη, για probe στη
δική του μοτοσυκλέτα. Στέλνει ΜΟΝΟ: session control (10 01/02/03), request seed
(27 01 — ΠΟΤΕ 27 02 με key), read DID (22), read memory (23). ΚΑΜΙΑ εγγραφή:
όχι 27+key, 2E, 2F, 31, 34-37, 11. Μια σκληρή λίστα το εξασφαλίζει (abort αλλιώς).

Προσοχή: το dongle BLE δέχεται μία σύνδεση — κλείσε πρώτα την εφαρμογή στο Chrome
(κουμπί «Αποσύνδεση»), αλλιώς η σύνδεση αποτυγχάνει.
"""
import asyncio
import re
import sys

from obd_cli import BleLink, DEFAULT_BLE
from ecu_id import parse_frames, NRC

DIDS = ["F180", "F187", "F18A", "F18C", "F190", "F191", "F194", "F195"]

# Σκληρή λίστα: ΜΟΝΟ αυτά τα μοτίβα επιτρέπονται να σταλούν.
_ALLOWED = re.compile(r"^(AT[0-9A-Z]*|10(01|02|03)|2701|22[0-9A-F]{4}|23[0-9A-F]{6,})$")


def guard(cmd):
    c = cmd.replace(" ", "").upper()
    if not _ALLOWED.match(c):
        raise SystemExit(f"ΜΠΛΟΚΑΡΙΣΤΗΚΕ (δεν είναι read-only probe): {cmd}")
    if c.startswith("27") and c != "2701":
        raise SystemExit(f"ΜΠΛΟΚΑΡΙΣΤΗΚΕ (27 μόνο με subfunction 01, ποτέ key): {cmd}")
    return c


DEBUG = "--raw" in sys.argv


async def send(link, cmd, timeout=3.0):
    guard(cmd)
    await link.write((cmd + "\r").encode())
    raw = (await link.read_until_prompt(timeout)).decode(errors="replace")
    lines = [l.strip() for l in raw.replace("\r", "\n").split("\n") if l.strip() and l.strip() != ">"]
    if DEBUG:
        print(f"    [raw {cmd}] {lines}")
    return lines


def payload(lines, rx="7E8"):
    """UDS payload bytes από την απάντηση της ECU (7E8), με ISO-TP."""
    frames = parse_frames([l for l in lines if l[:3].upper() == rx])
    msgs = frames.get(rx) or frames.get(rx.upper())
    return msgs[0] if msgs else None


def interpret(req_sid, b):
    if not b:
        return "— (καμία απάντηση)"
    if b[0] == 0x7F and len(b) >= 3:
        code = f"{b[2]:02X}"
        return f"ΑΡΝΗΤΙΚΗ 7F {b[1]:02X} {code} — {NRC.get(code, 'άγνωστο')}"
    if b[0] == req_sid + 0x40:
        return "ΘΕΤΙΚΗ " + b.hex(" ").upper()
    return b.hex(" ").upper()


async def main():
    link = BleLink(DEFAULT_BLE)
    await link.open()
    results = {}
    try:
        for c in ("ATZ", "ATE0", "ATL0", "ATS1", "ATH1", "ATAT1", "ATST96", "ATSP6",
                  "ATSH7E0", "ATCRA7E8", "ATFCSH7E0", "ATFCSD300000", "ATFCSM1"):
            await send(link, c, 4)

        async def probe(label, cmd, sid):
            b = payload(await send(link, cmd))
            results[label] = (cmd, b, interpret(sid, b))
            print(f"{label:28} {cmd:16} -> {results[label][2]}")

        seed_only = "--seed" in sys.argv
        print("== Επιβεβαίωση επικοινωνίας ==")
        lines = await send(link, "22F190", 4)
        alive = any(l[:3].upper() == "7E8" for l in lines)
        print(f"  22 F190: {'η ECU απαντά' if alive else 'καμία απάντηση'}")
        if not alive:
            raise SystemExit("Ο δίαυλος δεν απαντά ακόμα — κλειδί ON και ξαναδοκίμασε.")

        if seed_only:
            print("\n== Seed σε DEFAULT session ==")
            await probe("seed 2701 (default)", "2701", 0x27)
            print("\n== Seed σε EXTENDED, με καθυστέρηση ==")
            await probe("extended 1003", "1003", 0x10)
            await asyncio.sleep(0.5)  # να τελειώσει τυχόν responsePending (7F 10 78)
            await probe("seed 2701 (extended)", "2701", 0x27)
            await asyncio.sleep(0.5)
            await probe("seed 2701 (ξανά)", "2701", 0x27)
            return

        print("== Extended session + reads ==")
        await probe("extended session 1003", "1003", 0x10)
        for did in DIDS:
            b = payload(await send(link, "22" + did, 4))
            txt = ""
            if b and b[0] == 0x62:
                core = bytes(x for x in b[3:]).rstrip(b"\x00 ")
                if core and all(32 <= x < 127 for x in core):
                    txt = " = " + core.decode("latin-1")
            print(f"  22 {did}: {interpret(0x22, b)}{txt}")
            results["did_" + did] = (b, txt)

        print("\n== Security seed (27 01) ==")
        await probe("seed σε extended", "2701", 0x27)
        await probe("programming session 1002", "1002", 0x10)
        await probe("seed σε programming", "2701", 0x27)

        print("\n== ReadMemoryByAddress (23) ==")
        # 23 14 <addr 4 bytes=00000000> <size 1 byte=01>
        b = payload(await send(link, "2314" + "00000000" + "01", 4))
        results["read_mem"] = (b, interpret(0x23, b))
        print(f"  23 14 00000000 01 -> {results['read_mem'][1]}")
    finally:
        try:
            await send(link, "1001")  # επαναφορά default session
        except Exception:
            pass
        await link.close()


if __name__ == "__main__":
    asyncio.run(main())
