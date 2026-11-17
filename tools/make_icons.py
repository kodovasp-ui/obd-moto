"""Δημιουργεί τα εικονίδια PNG της PWA (app/icons) χωρίς εξωτερικές βιβλιοθήκες."""
import math
import struct
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "app" / "icons"
BG = (15, 18, 22)
FG = (255, 122, 26)
WHITE = (236, 240, 244)


def shape(x, y, scale, rounded):
    """Χρώμα στο σημείο (x, y) ∈ [0,1]² ή None (διάφανο)."""
    # φόντο
    if rounded:
        r = 0.2
        dx = max(r - x, 0, x - (1 - r))
        dy = max(r - y, 0, y - (1 - r))
        if dx * dx + dy * dy > r * r:
            return None
    # κλίμακα περιεχομένου γύρω από το κέντρο
    u = (x - 0.5) / scale + 0.5
    v = (y - 0.5) / scale + 0.5
    cx, cy = 0.5, 0.58
    dx, dy = u - cx, cy - v
    d = math.hypot(dx, dy)
    ang = math.degrees(math.atan2(dy, dx))
    # τόξο οργάνου 200° → -20°
    if 0.27 <= d <= 0.33 and (ang >= -20 or ang <= -160) and not (-160 < ang < -20):
        return FG
    # βελόνα προς 50°
    a = math.radians(50)
    t = dx * math.cos(a) + dy * math.sin(a)
    n = abs(-dx * math.sin(a) + dy * math.cos(a))
    if 0 <= t <= 0.25 and n <= 0.022:
        return WHITE
    if d <= 0.05:
        return WHITE
    return BG


def render(size, scale=1.0, rounded=True, ss=3):
    rows = []
    for py in range(size):
        row = bytearray([0])
        for px in range(size):
            acc = [0, 0, 0, 0]
            for sy in range(ss):
                for sx in range(ss):
                    c = shape((px + (sx + 0.5) / ss) / size, (py + (sy + 0.5) / ss) / size, scale, rounded)
                    if c:
                        acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2]; acc[3] += 255
            k = ss * ss
            a = acc[3] // k
            if a:
                row += bytes([acc[0] * 255 // acc[3], acc[1] * 255 // acc[3], acc[2] * 255 // acc[3], a])
            else:
                row += b"\0\0\0\0"
        rows.append(bytes(row))
    return png(size, b"".join(rows))


def png(size, raw):
    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "icon-192.png").write_bytes(render(192))
    (OUT / "icon-512.png").write_bytes(render(512, ss=2))
    (OUT / "maskable-512.png").write_bytes(render(512, scale=0.78, rounded=False, ss=2))
    print("OK:", ", ".join(p.name for p in OUT.glob("*.png")))
