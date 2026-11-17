"""obd_cli.py - Απλό CLI για ELM327 (BLE ή σειριακή θύρα COM). ΜΟΝΟ ανάγνωση.

Χρήση:
  py obd_cli.py init
  py obd_cli.py raw "ATRV"
  py obd_cli.py dtc
  py obd_cli.py live 30 [--out live.csv]
  py obd_cli.py vin
  py obd_cli.py info            (πρωτόκολλο + υποστηριζόμενα PID)
  py obd_cli.py clear           (ζητά επιβεβαίωση)

Σύνδεση: προεπιλογή BLE στο --ble 00:10:CC:4F:36:03.
Για Classic/COM: --port COM5 (38400 baud).
"""
import argparse
import asyncio
import csv
import sys
import time

DEFAULT_BLE = "00:10:CC:4F:36:03"
NOTIFY_UUID = "0000fff1-0000-1000-8000-00805f9b34fb"
WRITE_UUID = "0000fff2-0000-1000-8000-00805f9b34fb"
TIMEOUT = 5.0

# ---------------------------------------------------------------- ασφάλεια
# Κάθε εντολή περνά από τη whitelist του obd_safety (βλ. CLAUDE.md).
import obd_safety


def check_safe(cmd: str, allow_clear: bool = False):
    try:
        return obd_safety.check(cmd, allow_clear=allow_clear)
    except obd_safety.UnsafeCommand as e:
        raise SystemExit(f"Απορρίφθηκε: {e}")


# ---------------------------------------------------------------- μεταφορά
class BleLink:
    def __init__(self, addr):
        self.addr = addr
        self.buf = bytearray()
        self.evt = asyncio.Event()

    async def open(self):
        from bleak import BleakClient
        from bleak.exc import BleakError
        for attempt in range(4):
            self.client = BleakClient(self.addr, timeout=20)
            try:
                await self.client.connect()
                await self.client.start_notify(NOTIFY_UUID, self._on)
                return
            except (OSError, asyncio.TimeoutError, BleakError) as e:
                await self.close()
                if attempt == 3:
                    raise SystemExit(f"Αποτυχία σύνδεσης BLE: {e}")
                await asyncio.sleep(2)

    def _on(self, _h, data):
        self.buf.extend(data)
        self.evt.set()

    async def write(self, data: bytes):
        for i in range(0, len(data), 20):
            await self.client.write_gatt_char(WRITE_UUID, data[i:i + 20], response=False)

    async def read_until_prompt(self, timeout):
        end = time.monotonic() + timeout
        while b">" not in self.buf:
            left = end - time.monotonic()
            if left <= 0:
                break
            self.evt.clear()
            try:
                await asyncio.wait_for(self.evt.wait(), left)
            except asyncio.TimeoutError:
                break
        out = bytes(self.buf)
        self.buf.clear()
        return out

    async def close(self):
        try:
            await self.client.disconnect()
        except Exception:
            pass


class SerialLink:
    def __init__(self, port, baud=38400):
        self.port, self.baud = port, baud

    async def open(self):
        import serial
        self.s = serial.Serial(self.port, self.baud, timeout=0.1)

    async def write(self, data):
        self.s.reset_input_buffer()
        self.s.write(data)

    async def read_until_prompt(self, timeout):
        def rd():
            end, buf = time.monotonic() + timeout, bytearray()
            while time.monotonic() < end and b">" not in buf:
                buf.extend(self.s.read(256))
            return bytes(buf)
        return await asyncio.to_thread(rd)

    async def close(self):
        self.s.close()


class ELM:
    def __init__(self, link):
        self.link = link
        self.is_can = True

    async def cmd(self, c, timeout=TIMEOUT, allow_clear=False):
        check_safe(c, allow_clear=allow_clear)  # ΚΑΘΕ εντολή περνά από whitelist
        await self.link.write((c + "\r").encode())
        raw = (await self.link.read_until_prompt(timeout)).decode(errors="replace")
        lines = []
        for ln in raw.replace("\r", "\n").split("\n"):
            ln = ln.strip().strip(">").strip()
            if not ln or ln.upper() == c.upper() or ln.upper().startswith("SEARCHING"):
                continue
            lines.append(ln)
        return lines

    async def init(self):
        out = {}
        out["ATZ"] = await self.cmd("ATZ", 5)
        for c in ("ATE0", "ATL0", "ATS1", "ATH0", "ATAT1", "ATSP0"):
            await self.cmd(c)
        out["ATRV"] = await self.cmd("ATRV")
        out["0100"] = await self.cmd("0100", 10)
        out["ATDP"] = await self.cmd("ATDP")
        dpn = (await self.cmd("ATDPN"))
        out["ATDPN"] = dpn
        num = dpn[0].lstrip("A").strip() if dpn else ""
        self.is_can = num in ("6", "7", "8", "9", "A", "B", "C")
        return out

    async def obd(self, c, timeout=TIMEOUT):
        """Επιστρέφει λίστα από bytes (μία ανά απάντηση/ECU)."""
        lines = await self.cmd(c, timeout)
        resp, multi = [], []
        for ln in lines:
            u = ln.upper()
            if any(k in u for k in ("NO DATA", "ERROR", "UNABLE", "STOPPED", "?", "BUS INIT")):
                continue
            if ":" in ln:  # CAN multi-frame "0: 49 02 01 ..."
                multi.append(ln.split(":", 1)[1])
                continue
            h = u.replace(" ", "")
            if len(h) <= 3 and multi == [] and all(ch in "0123456789ABCDEF" for ch in h):
                continue  # μήκος μηνύματος πριν τα frames
            try:
                resp.append(bytes.fromhex(h))
            except ValueError:
                pass
        if multi:
            try:
                resp.append(bytes.fromhex("".join(multi).replace(" ", "")))
            except ValueError:
                pass
        return resp


# ---------------------------------------------------------------- αποκωδικοποίηση
def pid_data(resps, pid):
    want = bytes([0x41, int(pid, 16)])
    for r in resps:
        i = r.find(want)
        if i >= 0:
            return r[i + 2:]
    return None


PIDS = {  # pid: (όνομα, μονάδα, συνάρτηση)
    "04": ("Φορτίο κινητήρα", "%", lambda d: d[0] * 100 / 255),
    "05": ("Θερμ. ψυκτικού", "°C", lambda d: d[0] - 40),
    "06": ("STFT B1", "%", lambda d: d[0] * 100 / 128 - 100),
    "07": ("LTFT B1", "%", lambda d: d[0] * 100 / 128 - 100),
    "0B": ("MAP", "kPa", lambda d: d[0]),
    "0C": ("Στροφές", "rpm", lambda d: (d[0] * 256 + d[1]) / 4),
    "0D": ("Ταχύτητα", "km/h", lambda d: d[0]),
    "0E": ("Προπορεία", "°", lambda d: d[0] / 2 - 64),
    "0F": ("Θερμ. αέρα εισαγ.", "°C", lambda d: d[0] - 40),
    "10": ("MAF", "g/s", lambda d: (d[0] * 256 + d[1]) / 100),
    "11": ("Πεταλούδα", "%", lambda d: d[0] * 100 / 255),
    "14": ("O2 B1S1", "V", lambda d: d[0] / 200),
    "15": ("O2 B1S2", "V", lambda d: d[0] / 200),
    "1F": ("Χρόνος λειτουργίας", "s", lambda d: d[0] * 256 + d[1]),
    "21": ("Απόσταση με MIL", "km", lambda d: d[0] * 256 + d[1]),
    "2F": ("Στάθμη καυσίμου", "%", lambda d: d[0] * 100 / 255),
    "31": ("Απόσταση από σβήσιμο DTC", "km", lambda d: d[0] * 256 + d[1]),
    "33": ("Βαρομετρική", "kPa", lambda d: d[0]),
    "42": ("Τάση ECU", "V", lambda d: (d[0] * 256 + d[1]) / 1000),
    "46": ("Θερμ. περιβάλλοντος", "°C", lambda d: d[0] - 40),
    "5C": ("Θερμ. λαδιού", "°C", lambda d: d[0] - 40),
}
LIVE_DEFAULT = ["0C", "0D", "05", "0F", "04", "11", "0B", "10", "06", "07", "0E", "14", "15", "42", "5C"]


def parse_volts(lines):
    for ln in lines:
        try:
            return float(ln.upper().rstrip("V"))
        except ValueError:
            pass
    return None


def decode_dtcs(data: bytes):
    out = []
    for i in range(0, len(data) - 1, 2):
        a, b = data[i], data[i + 1]
        if a == 0 and b == 0:
            continue
        out.append("PCBU"[a >> 6] + str((a >> 4) & 3) + f"{a & 0x0F:X}{b:02X}")
    return out


async def read_dtcs(elm, mode):
    resp_id = 0x40 + int(mode, 16)
    codes = []
    for r in await elm.obd(mode):
        i = r.find(bytes([resp_id]))
        if i < 0:
            continue
        body = r[i + 1:]
        if elm.is_can and body:
            body = body[1:]  # byte πλήθους
        codes += decode_dtcs(body)
    return sorted(set(codes))


async def supported_pids(elm):
    sup = []
    for base in (0x00, 0x20, 0x40, 0x60, 0x80, 0xA0, 0xC0):
        d = pid_data(await elm.obd(f"01{base:02X}"), f"{base:02X}")
        if not d or len(d) < 4:
            break
        bits = int.from_bytes(d[:4], "big")
        for n in range(32):
            if bits & (1 << (31 - n)):
                sup.append(f"{base + n + 1:02X}")
        if not bits & 1:
            break
    return sup


# ---------------------------------------------------------------- εντολές
async def run(args):
    link = SerialLink(args.port) if args.port else BleLink(args.ble)
    await link.open()
    elm = ELM(link)
    try:
        info = await elm.init()
        if args.cmd == "init":
            for k, v in info.items():
                print(f"{k}: {' | '.join(v)}")

        elif args.cmd == "raw":
            check_safe(args.arg)
            print("\n".join(await elm.cmd(args.arg, 10)))

        elif args.cmd == "info":
            print("Πρωτόκολλο:", " ".join(info["ATDP"]), f"(ATDPN={' '.join(info['ATDPN'])})")
            print("Τάση:", " ".join(info["ATRV"]))
            sup = await supported_pids(elm)
            print("Υποστηριζόμενα PID (01):", " ".join(sup))
            for p in sup:
                if p in PIDS:
                    d = pid_data(await elm.obd("01" + p), p)
                    if d:
                        n, u, f = PIDS[p]
                        try:
                            print(f"  {p} {n}: {f(d):.1f} {u}")
                        except IndexError:
                            pass

        elif args.cmd == "dtc":
            d = pid_data(await elm.obd("0101"), "01")
            if d:
                print(f"MIL (λυχνία): {'ΑΝΑΜΜΕΝΗ' if d[0] & 0x80 else 'σβηστή'}, "
                      f"αποθηκευμένα DTC: {d[0] & 0x7F}")
                tests = []
                names = ["Misfire", "Fuel", "Components"]
                for n in range(3):
                    if d[1] & (1 << n):
                        tests.append(f"{names[n]}:{'ΜΗ ολοκλ.' if d[1] & (1 << (n + 4)) else 'OK'}")
                print("Monitors:", ", ".join(tests), "| κινητήρας:", "diesel" if d[1] & 0x08 else "βενζίνη")
            for mode, label in (("03", "Αποθηκευμένα (03)"), ("07", "Εκκρεμή (07)"), ("0A", "Μόνιμα (0A)")):
                c = await read_dtcs(elm, mode)
                print(f"{label}: {', '.join(c) if c else 'κανένα'}")

        elif args.cmd == "vin":
            vin = ""
            for r in await elm.obd("0902", 10):
                i = r.find(b"\x49\x02")
                if i >= 0:
                    vin += "".join(chr(b) for b in r[i + 3:] if 32 < b < 127)
            print("VIN:", vin[-17:] if vin else "(δεν επιστράφηκε)")

        elif args.cmd == "live":
            secs = float(args.arg or 10)
            sup = set(await supported_pids(elm))
            want = args.pids.upper().split(",") if args.pids else LIVE_DEFAULT
            pids = [p for p in want if p in PIDS and (args.pids or p in sup)]
            if args.wait_temp:
                while True:
                    d = pid_data(await elm.obd("0105"), "05")
                    t = d[0] - 40 if d else None
                    print(f"Ψυκτικό: {t} °C (στόχος {args.wait_temp:.0f})", flush=True)
                    if t is not None and t >= args.wait_temp:
                        break
                    await asyncio.sleep(10)
            hdr = ["t"] + [f"{PIDS[p][0]} [{PIDS[p][1]}]" for p in pids] + ["ATRV [V]"]
            banners = {"rev2500": "ΑΝΕΒΑΣΕ ΤΙΣ ΣΤΡΟΦΕΣ ΣΤΑ 2500 rpm ΚΑΙ ΚΡΑΤΑ ΤΕΣ ΣΤΑΘΕΡΕΣ ΩΣ ΤΟ ΤΕΛΟΣ"}
            if args.banner:
                print(f"\n>>> {banners.get(args.banner, args.banner)} <<<\n", flush=True)
            if args.delay:
                for s in range(int(args.delay), 0, -1):
                    print(f"Έναρξη καταγραφής σε {s} s...", flush=True)
                    await asyncio.sleep(1)
            fh = open(args.out, "w", newline="", encoding="utf-8-sig") if args.out else None
            w = csv.writer(fh or sys.stdout)
            w.writerow(hdr)
            t0 = time.monotonic()
            if args.phases:
                print("\n>>> ΦΑΣΗ 1: ΡΕΛΑΝΤΙ - μην πατάς γκάζι <<<\n", flush=True)
            phase2 = False
            while time.monotonic() - t0 < secs:
                if args.phases and not phase2 and time.monotonic() - t0 >= secs / 2:
                    phase2 = True
                    print("\n>>> ΦΑΣΗ 2: ΓΚΑΖΙ ΣΤΑΘΕΡΑ ΣΤΙΣ 2500 rpm <<<\n", flush=True)
                row = [f"{time.monotonic() - t0:.1f}"]
                for p in pids:
                    d = pid_data(await elm.obd("01" + p), p)
                    try:
                        row.append(f"{PIDS[p][2](d):.2f}" if d else "")
                    except IndexError:
                        row.append("")
                v = parse_volts(await elm.cmd("ATRV"))
                row.append(f"{v:.1f}" if v is not None else "")
                w.writerow(row)
                if fh:
                    fh.flush()
                    print(",".join(row), flush=True)
            if fh:
                fh.close()
                if args.phases or args.banner:
                    print("\n>>> ΤΕΛΟΣ - άφησε το γκάζι <<<")
                print("Αποθηκεύτηκε:", args.out)

        elif args.cmd == "clear":
            if not args.yes:
                a = input("Σβήσιμο ΟΛΩΝ των κωδικών και freeze frame (υπηρεσία 04). "
                          "Γράψε ΝΑΙ για επιβεβαίωση: ")
                if a.strip().upper() not in ("ΝΑΙ", "NAI"):
                    print("Ακυρώθηκε.")
                    return
            print("\n".join(await elm.cmd("04", 10, allow_clear=True)))
    finally:
        await link.close()


def main():
    ap = argparse.ArgumentParser(description="ELM327 OBD-II CLI (μόνο ανάγνωση)")
    ap.add_argument("cmd", choices=["init", "raw", "dtc", "live", "vin", "info", "clear"])
    ap.add_argument("arg", nargs="?", help="εντολή για raw / δευτερόλεπτα για live")
    ap.add_argument("--ble", default=DEFAULT_BLE, help="διεύθυνση BLE")
    ap.add_argument("--port", help="θύρα COM (Classic), π.χ. COM5")
    ap.add_argument("--out", help="αρχείο CSV για live")
    ap.add_argument("--pids", help="PID για live, π.χ. 0C,05,06,07")
    ap.add_argument("--delay", type=float, default=0, help="αναμονή πριν το live (s)")
    ap.add_argument("--wait-temp", type=float, default=0, help="αναμονή μέχρι ψυκτικό >= T °C")
    ap.add_argument("--banner", help="μήνυμα οδηγίας πριν την καταγραφή")
    ap.add_argument("--phases", action="store_true", help="οδηγίες ρελαντί / 2500 rpm")
    ap.add_argument("--yes", action="store_true", help="clear χωρίς ερώτηση")
    args = ap.parse_args()
    if args.cmd == "raw" and not args.arg:
        ap.error("raw: δώσε εντολή")
    asyncio.run(run(args))


if __name__ == "__main__":
    main()
