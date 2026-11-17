"""ecu_id.py — Αναγνώριση μονάδων ελέγχου (ΜΟΝΟ ανάγνωση).

1. Broadcast 7DF: ποιες μονάδες απαντούν σε OBD 0100 / mode 09.
2. Σάρωση φυσικών διευθύνσεων 0x700–0x7F7 με UDS 22 F190 (κάθε απάντηση — ακόμα και
   αρνητική 7F — σημαίνει ότι υπάρχει μονάδα).
3. Για κάθε μονάδα: UDS 0x22 στα DID αναγνώρισης F180–F19E.
Όλες οι εντολές περνούν από τη whitelist (obd_safety). Αποτέλεσμα: JSON + Markdown.

Χρήση:  py tools\\ecu_id.py [--quick] [--json out.json] [--md docs\\ecu-id.md]
"""
import argparse
import asyncio
import json
import time
from pathlib import Path

from obd_cli import BleLink, SerialLink, ELM, DEFAULT_BLE

DIDS = {
    "F180": "Boot software ID", "F181": "Application software ID", "F182": "Application data ID",
    "F183": "Boot software fingerprint", "F184": "Application software fingerprint",
    "F185": "Application data fingerprint", "F186": "Ενεργό session", "F187": "Κωδικός ανταλλακτικού (κατασκευαστή)",
    "F188": "ECU software number", "F189": "ECU software version", "F18A": "Προμηθευτής συστήματος",
    "F18B": "Ημερομηνία κατασκευής ECU", "F18C": "Σειριακός αριθμός ECU", "F18E": "Supported functional units",
    "F190": "VIN", "F191": "ECU hardware number", "F192": "Supplier ECU hardware number",
    "F193": "Supplier ECU hardware version", "F194": "Supplier ECU software number",
    "F195": "Supplier ECU software version", "F196": "Exhaust regulation / type approval",
    "F197": "Όνομα συστήματος / κινητήρα", "F198": "Κωδικός συνεργείου / tester", "F199": "Ημερομηνία προγραμματισμού",
    "F19D": "Ημερομηνία εγκατάστασης ECU", "F19E": "ODX file",
}
MODE09 = {"0902": "VIN", "0904": "Calibration ID (CALID)", "0906": "Calibration verification (CVN)", "090A": "Όνομα ECU"}
NRC = {"10": "generalReject", "11": "serviceNotSupported", "12": "subFunctionNotSupported",
       "13": "incorrectMessageLength", "22": "conditionsNotCorrect", "31": "requestOutOfRange",
       "33": "securityAccessDenied", "78": "responsePending", "7F": "serviceNotSupportedInActiveSession"}


def parse_frames(lines):
    """Γραμμές με headers (ATH1, ATCAF1 ή 0) → {can_id: payload bytes} με ISO-TP επανασύνθεση."""
    frames = {}
    for ln in lines:
        parts = ln.replace(":", " ").split()
        if len(parts) < 2 or not all(len(p) <= 3 and all(c in "0123456789ABCDEFabcdef" for c in p) for p in parts):
            continue
        if len(parts[0]) != 3:
            continue
        try:
            frames.setdefault(parts[0].upper(), []).append(bytes(int(p, 16) for p in parts[1:]))
        except ValueError:
            pass
    out = {}
    for cid, fl in frames.items():
        payload = b""
        need = None
        for f in fl:
            pci = f[0] >> 4
            if pci == 0:
                n = f[0] & 0x0F
                if n:
                    out.setdefault(cid, []).append(f[1:1 + n])
            elif pci == 1:
                need = ((f[0] & 0x0F) << 8) | f[1]
                payload = f[2:]
            elif pci == 2 and need is not None:
                payload += f[1:]
                if len(payload) >= need:
                    out.setdefault(cid, []).append(payload[:need])
                    need = None
    return out


def show(b: bytes):
    core = b.rstrip(b"\x00 ")  # padding με μηδενικά/κενά
    txt = core.decode("latin-1")
    printable = sum(32 <= c < 127 for c in core)
    if core and printable == len(core):
        return txt.strip("\x00 ").strip(), b.hex(" ").upper()
    return None, b.hex(" ").upper()


async def setup(elm):
    await elm.cmd("ATZ", 5)
    for c in ("ATE0", "ATL0", "ATS1", "ATH1", "ATAT1", "ATSP6", "ATCAF1", "ATCF700", "ATCM700"):
        await elm.cmd(c)
    return (await elm.cmd("ATRV"))


async def req(elm, tx, data, timeout=2.0, fc=True):
    """Αίτημα σε φυσική διεύθυνση tx (π.χ. '7E0'). Flow control προς tx."""
    await elm.cmd(f"ATSH{tx}")
    if not fc:
        pass
    elif tx != "7DF":
        await elm.cmd(f"ATFCSH{tx}")
        await elm.cmd("ATFCSD300000")
        await elm.cmd("ATFCSM1")
    else:
        await elm.cmd("ATFCSM0")
    return parse_frames(await elm.cmd(data, timeout))


async def run(args):
    link = SerialLink(args.port) if args.port else BleLink(args.ble)
    await link.open()
    elm = ELM(link)
    result = {"time": time.strftime("%Y-%m-%d %H:%M:%S"), "broadcast": {}, "modules": {}}
    try:
        result["voltage"] = " ".join(await setup(elm))
        print("Τάση:", result["voltage"])

        # 1) Broadcast
        print("\n== Broadcast 7DF ==")
        for cmd in ["0100", *MODE09]:
            r = await req(elm, "7DF", cmd, 3)
            for cid, msgs in r.items():
                for m in msgs:
                    txt, hx = show(m[3:] if cmd.startswith("09") else m)
                    result["broadcast"].setdefault(cid, {})[cmd] = {"hex": m.hex(" ").upper(), "text": txt}
                    print(f"  {cid} {cmd}: {txt or hx}")

        # 2) Σάρωση φυσικών διευθύνσεων
        print("\n== Σάρωση 0x700–0x7F7 (22 F190) ==")
        await elm.cmd("ATST19")  # ~100 ms αναμονή απάντησης
        targets = range(0x7E0, 0x7E8) if args.quick else [a for a in range(0x700, 0x7F8) if a != 0x7DF]
        found = {}
        for a in targets:
            tx = f"{a:03X}"
            lines = (await elm.cmd(f"ATSH{tx}")) and await elm.cmd("22F190", 0.6)
            ids = sorted({ln.split()[0] for ln in lines
                          if len(ln.split()) > 1 and len(ln.split()[0]) == 3 and ln.split()[0] != tx
                          and all(c in "0123456789ABCDEF" for c in ln.split()[0])})
            for cid in ids:
                found[tx] = cid
                print(f"  απάντηση: αίτημα {tx} → {cid}: {[l for l in lines if l.startswith(cid)][0]}")
        await elm.cmd("ATST64")
        # Οι γνωστές OBD διευθύνσεις από το broadcast
        for cid in result["broadcast"]:
            tx = f"{int(cid, 16) - 8:03X}"
            found.setdefault(tx, cid)

        # 3) DID αναγνώρισης ανά μονάδα
        for tx, rx in sorted(found.items()):
            print(f"\n== Μονάδα {tx} → {rx} ==")
            mod = result["modules"].setdefault(tx, {"rx": rx, "dids": {}})
            r = await req(elm, tx, "1001", 2)
            for m in r.get(rx, []):
                mod["session"] = m.hex(" ").upper()
            for did, name in DIDS.items():
                r = await req(elm, tx, "22" + did, 2)
                for m in r.get(rx, []):
                    if m[:1] == b"\x62" and m[1:3].hex().upper() == did:
                        txt, hx = show(m[3:])
                        mod["dids"][did] = {"name": name, "text": txt, "hex": hx}
                        print(f"  {did} {name}: {txt if txt else hx}")
                    elif m[:1] == b"\x7f":
                        code = m[2:3].hex().upper()
                        mod["dids"][did] = {"name": name, "nrc": f"{code} {NRC.get(code, '')}".strip()}
    finally:
        await link.close()

    Path(args.json).parent.mkdir(parents=True, exist_ok=True)
    Path(args.json).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print("\nJSON:", args.json)


def main():
    ap = argparse.ArgumentParser(description="Αναγνώριση ECU (UDS 0x22, μόνο ανάγνωση)")
    ap.add_argument("--ble", default=DEFAULT_BLE)
    ap.add_argument("--port")
    ap.add_argument("--quick", action="store_true", help="μόνο 7E0–7E7")
    ap.add_argument("--json", default=str(Path(__file__).resolve().parents[1] / "docs" / "ecu-id.json"))
    args = ap.parse_args()
    asyncio.run(run(args))


if __name__ == "__main__":
    main()
