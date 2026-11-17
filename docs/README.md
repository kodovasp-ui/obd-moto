# OBD Moto — διαγνωστικά CFMOTO 450MT

PWA (Web Bluetooth) και Python CLI για ELM327 Bluetooth LE. **Μόνο ανάγνωση** — βλ. `CLAUDE.md`.

## Web app (PC)

```
py -m http.server 8000 -d app
```

Άνοιξε **Chrome ή Edge** στο `http://localhost:8000` → «Σύνδεση BLE» → διάλεξε `OBDII`.
Χωρίς μοτό: κουμπί **Demo** (προσομοιωτής).

Εγκατάσταση: κουμπί «Εγκατάσταση» ή εικονίδιο εγκατάστασης στη γραμμή διευθύνσεων.

> Το Bluetooth του Windows πρέπει να είναι ON. Αν το dongle είναι συνδεδεμένο σε άλλο
> πρόγραμμα (π.χ. `obd_cli.py`), κλείσ' το πρώτα — το BLE δέχεται μία σύνδεση.

## Android

Το Web Bluetooth θέλει **https ή localhost**. Το `http://192.168.x.x:8000` δεν αρκεί. Επιλογές:

1. **USB + adb (προτείνεται για δοκιμές):** σύνδεσε το κινητό με USB debugging και τρέξε
   `adb reverse tcp:8000 tcp:8000`. Στο κινητό άνοιξε Chrome στο `http://localhost:8000`.
2. **Chrome flag:** στο κινητό `chrome://flags/#unsafely-treat-insecure-origin-as-secure`,
   πρόσθεσε `http://<IP-του-PC>:8000`, Relaunch. Το server τότε με `--bind 0.0.0.0`.
3. **Φιλοξενία σε https** (π.χ. GitHub Pages) — μόνιμη λύση, εγκαθίσταται κανονικά.

Μετά την πρώτη φόρτωση η εφαρμογή δουλεύει **offline**.

## Ενημερώσεις

Ο service worker φέρνει πάντα τα νεότερα αρχεία όταν υπάρχει δίκτυο (network-first)
και κρατά αντίγραφο για offline. Σε κάθε release άλλαξε το `APP_VERSION` στο
`app/js/version.js` — οι εγκατεστημένες εφαρμογές ενημερώνονται αυτόματα.

## Python CLI

```
py tools\obd_cli.py init | dtc | vin | info | live 30 --out x.csv | raw 0100
```

## Tests

```
py -m unittest discover -s tests -v
```
