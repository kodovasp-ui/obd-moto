// Διγλωσσία: ελληνικά (πηγή) ή αγγλικά.
//
// Ο κώδικας και το HTML γράφονται στα ελληνικά. Η μετάφραση γίνεται στην
// εμφάνιση: το λεξικό EN έχει κλειδί το ελληνικό κείμενο και τιμή το αγγλικό.
// Ό,τι δεν υπάρχει στο λεξικό μένει ελληνικό — έτσι τίποτα δεν «σπάει».
//
// Στατικό HTML: μεταφράζεται ανά κόμβο κειμένου (translateDom), χωρίς αλλαγές
// στο markup. Δυναμικά strings: τυλίγονται σε t('…').

const KEY = 'obd.lang';

let lang = (() => {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'en' || v === 'el') return v;
    // Αρχική εικασία από τη γλώσσα του browser — αλλά ο χρήστης μπορεί να αλλάξει.
    return (navigator.language || '').toLowerCase().startsWith('el') ? 'el' : (v === null ? 'el' : 'en');
  } catch { return 'el'; }
})();

export const getLang = () => lang;

export function setLang(l) {
  lang = l === 'en' ? 'en' : 'el';
  try { localStorage.setItem(KEY, lang); } catch { /* χωρίς αποθήκευση */ }
  return lang;
}

/** Μεταφράζει ένα δυναμικό string. t('Ελληνικό') → αγγλικό ή το ίδιο. */
export function t(s, ...args) {
  let out = lang === 'en' ? (EN[s] ?? s) : s;
  // Προαιρετικά placeholders {0}, {1}…
  args.forEach((a, i) => { out = out.replace(`{${i}}`, a); });
  return out;
}

const norm = (s) => s.replace(/\s+/g, ' ').trim();

// Χάρτης κανονικοποιημένου ελληνικού → κλειδί λεξικού (ώστε να ταιριάζει
// ανεξάρτητα από κενά/αλλαγές γραμμής στο HTML).
const BY_NORM = {};
function indexDict() {
  for (const k of Object.keys(EN)) BY_NORM[norm(k)] = k;
}

/**
 * Μεταφράζει το στατικό περιεχόμενο κάτω από το root: κόμβους κειμένου και
 * τα attributes placeholder/title/aria-label/label. Ιδεμποτέντ — μπορεί να
 * κληθεί ξανά (π.χ. μετά από αλλαγή γλώσσας επαναφορτώνουμε τη σελίδα).
 */
export function translateDom(root = document.body) {
  if (lang !== 'en') return;
  if (!Object.keys(BY_NORM).length) indexDict();

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const n of nodes) {
    const raw = n.nodeValue;
    const key = BY_NORM[norm(raw)];
    if (key) {
      // Διατηρούμε τα κενά αριστερά/δεξιά του αρχικού κόμβου.
      const lead = raw.match(/^\s*/)[0];
      const tail = raw.match(/\s*$/)[0];
      n.nodeValue = lead + EN[key] + tail;
    }
  }

  for (const attr of ['placeholder', 'title', 'aria-label']) {
    for (const el of root.querySelectorAll(`[${attr}]`)) {
      const key = BY_NORM[norm(el.getAttribute(attr))];
      if (key) el.setAttribute(attr, EN[key]);
    }
  }
  document.documentElement.lang = 'en';
}

// ------------------------------------------------------------------ λεξικό
// Κλειδί: το ελληνικό κείμενο όπως εμφανίζεται. Τιμή: το αγγλικό.
export const EN = {
  // --- κεφαλίδα / κατάσταση
  'Αποσυνδεδεμένο': 'Disconnected',
  'Εγκατάσταση': 'Install',
  'Σύνδεση BLE': 'Connect BLE',
  'Αποσύνδεση': 'Disconnect',
  'Σύνδεση BLE…': 'Connecting BLE…',
  'Σύνδεση…': 'Connecting…',
  'Θέμα εμφάνισης': 'Display theme',

  // --- καρτέλες
  'Κωδικοί': 'Codes',
  'Σάρωση': 'Scan',
  'Υγεία': 'Health',
  'Ταξίδι': 'Trip',
  'Ιστορικό': 'History',
  'Βοηθός': 'Assistant',
  'Όχημα': 'Vehicle',
  'Κονσόλα': 'Console',

  // --- εκτύπωση
  'Αναφορά διαγνωστικού ελέγχου OBD-II': 'OBD-II diagnostic report',
  'Μόνο ανάγνωση — καμία εγγραφή στην ECU. Οι τιμές αναφοράς είναι γενικές· επιβεβαίωσε με το εγχειρίδιο σέρβις του οχήματος.':
    'Read-only — no writes to the ECU. Reference values are generic; confirm with the vehicle service manual.',

  // --- Live
  'Έναρξη': 'Start',
  '● Καταγραφή': '● Record',
  'Εξαγωγή CSV': 'Export CSV',
  '⚙ Επιλογή PID': '⚙ Choose PIDs',
  'Έξοδος': 'Exit',
  'Έτοιμα σετ:': 'Presets:',
  'Ειδοποιήσεις': 'Alerts',
  'Ελέγχονται οι live τιμές και σε προειδοποιεί. Μόνο ενημερωτικό — καμία ενέργεια στην ECU. Τα όρια είναι':
    'Watches the live values and warns you. Informational only — no action on the ECU. The thresholds are',
  'γενικά': 'generic',
  '· προσάρμοσέ τα με βάση το εγχειρίδιο σέρβις του οχήματός σου.':
    '· adjust them based on your vehicle service manual.',
  'Ενεργές': 'Enabled',
  'Ήχος': 'Sound',
  'Επαναφορά ορίων': 'Reset thresholds',
  'Δοκιμή ήχου': 'Test sound',
  'Πάτα σε μια κάρτα για να εμφανιστεί/κρυφτεί το γράφημά της.': 'Tap a tile to show/hide its chart.',
  'Σύνδεσου, πάτα Demo ή άνοιξε μια συνεδρία από το Ιστορικό.': 'Connect, press Demo, or open a session from History.',
  'Σύγκριση': 'Compare',
  'Αναφορά:': 'Reference:',
  'Κατάργηση': 'Remove',
  'PID κατάστασης': 'Status PIDs',
  'Τιμές που δεν είναι αριθμοί (βρόχος καυσίμου, τύπος καυσίμου, πρότυπο OBD) και PID που δεν αναγνωρίζουμε — δείχνονται ως raw bytes αντί να κρυφτούν. Διαβάζονται μία φορά.':
    'Non-numeric values (fuel loop, fuel type, OBD standard) and PIDs we do not recognise — shown as raw bytes instead of hidden. Read once.',
  'Διάβασε': 'Read',

  // --- Κωδικοί
  'Ανάγνωση κωδικών': 'Read codes',
  'Σβήσιμο κωδικών…': 'Clear codes…',
  'Δεν έχουν διαβαστεί κωδικοί.': 'No codes read yet.',
  'Κωδικοί J1939': 'J1939 codes',
  'φορτηγά / αγροτικά': 'trucks / agricultural',
  'Τα βαρέα οχήματα δεν μιλούν OBD-II: οι ενεργοί κωδικοί έρχονται στο μήνυμα':
    'Heavy vehicles do not speak OBD-II: active codes arrive in the',
  '. Παρακολουθούμε τον δίαυλο για λίγα δευτερόλεπτα και διαβάζουμε':
    'message. We listen to the bus for a few seconds and read',
  '(τι),': '(what),',
  '(είδος βλάβης) και πλήθος εμφανίσεων.': '(fault type) and occurrence count.',
  'Μόνο ανάγνωση.': 'Read-only.',
  'Ανάγνωση DM1': 'Read DM1',
  'Ακρόαση (s):': 'Listen (s):',
  'Βάση γνώσης κωδικών': 'Code knowledge base',
  'Αναζήτηση': 'Search',
  'Δικοί σου κωδικοί από το εγχειρίδιο σέρβις': 'Your own codes from the service manual',
  'Οι ειδικοί κωδικοί κάθε κατασκευαστή δεν είναι δημοσιευμένοι και': 'Each maker’s specific codes are not published and',
  'δεν τους εφευρίσκουμε': 'we do not invent them',
  '. Αν τους έχεις από το εγχειρίδιο, φόρτωσέ τους εσύ: μετά εμφανίζονται παντού όπως οι υπόλοιποι, με πηγή «δικό σου αρχείο». Μένουν στη συσκευή σου.':
    '. If you have them from the manual, load them yourself: they then appear everywhere like the rest, sourced as “your file”. They stay on your device.',
  'Μορφή CSV ή TSV, μία γραμμή ανά κωδικό:': 'CSV or TSV format, one line per code:',
  'Οι δύο πρώτες στήλες αρκούν. Γραμμές με': 'The first two columns are enough. Lines starting with',
  'αγνοούνται.': 'are ignored.',
  'Επιλογή αρχείου…': 'Choose file…',
  'Κατέβασε υπόδειγμα': 'Download sample',
  'Διαγραφή όλων': 'Delete all',

  // --- Σάρωση
  'Σάρωση όλων των μονάδων': 'Scan all modules',
  'Ρωτά κάθε διεύθυνση του διαύλου «υπάρχει μονάδα εδώ;» (UDS':
    'Asks each bus address “is a module here?” (UDS',
  ') και, για όσες απαντήσουν, διαβάζει κωδικούς (': ') and, for those that answer, reads codes (',
  ') και ταυτότητα (': ') and identity (',
  '). Έτσι βλέπεις ABS, airbag, σασμάν, immobilizer — όχι μόνο τον κινητήρα.':
    '). This reveals ABS, airbag, transmission, immobilizer — not just the engine.',
  'Με το κλειδί στο ON και τον κινητήρα σβηστό.': 'Key ON, engine off.',
  'Έναρξη σάρωσης': 'Start scan',
  'Διακοπή': 'Stop',
  'Κωδικοί βλάβης': 'Fault codes',
  'Ταυτότητα μονάδας': 'Module identity',
  'Δεν έχει γίνει σάρωση.': 'No scan run yet.',
  'Σαρωτής DID': 'DID scanner',
  'προχωρημένο': 'advanced',
  'Το OBD-II δίνει μόνο όσα επιβάλλει ο νόμος. Κάθε μονάδα όμως εκθέτει και δικά της δεδομένα σε ταυτοποιητές (DID) των 16 bit, που διαβάζονται με':
    'OBD-II gives only what the law requires. Each module, though, exposes its own data in 16-bit identifiers (DID), read with',
  '. Εδώ ρωτάμε μια-μια τις διευθύνσεις μιας περιοχής και κρατάμε ό,τι απαντά — έτσι βγαίνουν ζωντανά δεδομένα ABS, airbag ή κιβωτίου.':
    '. Here we query a range one by one and keep whatever answers — this surfaces live ABS, airbag or transmission data.',
  'Ό,τι ζητά security access σημειώνεται και αφήνεται.': 'Anything requiring security access is noted and left alone.',
  'Δεύτερο πέρασμα (εντοπισμός ζωντανών)': 'Second pass (detect live values)',
  'Δική σου περιοχή:': 'Custom range:',

  // --- Υγεία
  'Αναφορά από την τρέχουσα καταγραφή': 'Report from the current recording',
  '🖨 Εκτύπωση / PDF': '🖨 Print / PDF',
  'Για πλήρη αναφορά: ζεστός κινητήρας, ~30 s ρελαντί και ~30 s στις 2500 rpm, και ανάγνωση κωδικών πριν.':
    'For a full report: warm engine, ~30 s idle and ~30 s at 2500 rpm, and read codes beforehand.',
  'Μπαταρία και φόρτιση': 'Battery and charging',
  'Από την τάση της τρέχουσας καταγραφής: κατάσταση στην ηρεμία, βύθισμα στη μίζα και τάση φόρτισης.':
    'From the voltage of the current recording: resting state, cranking dip and charging voltage.',
  'Δεν είναι τεστ φορτίου': 'Not a load test',
  '— χωρίς όργανο δεν μετριούνται η εσωτερική αντίσταση και τα CCA.':
    '— without an instrument, internal resistance and CCA cannot be measured.',
  'Ανάλυση': 'Analyse',
  'Τύπος:': 'Type:',
  'Μολύβδου–οξέος': 'Lead-acid',
  'Λιθίου (LiFePO4)': 'Lithium (LiFePO4)',
  'Τεστ αισθητήρων λάμδα (mode 05)': 'Oxygen sensor tests (mode 05)',
  'Παλιότερα οχήματα (ISO 9141-2, KWP2000) δίνουν τα αποτελέσματα των τεστ λάμδα στο mode 05 — τάσεις κατωφλίου και χρόνους εναλλαγής. (Στα CAN οχήματα αυτά βρίσκονται στα on-board tests / mode 06.)':
    'Older vehicles (ISO 9141-2, KWP2000) give oxygen sensor test results in mode 05 — threshold voltages and switch times. (On CAN vehicles these live in the on-board tests / mode 06.)',
  'Ανάγνωση mode 05': 'Read mode 05',
  'Τα τεστ που τρέχει μόνη της η ECU, με τα': 'The tests the ECU runs on its own, with its',
  'όρια': 'limits',
  'της. Αν μια τιμή πλησιάζει το όριο, το εξάρτημα γερνάει — το βλέπεις':
    '. If a value nears the limit, the part is ageing — you see it',
  'πριν': 'before',
  'ανάψει η λυχνία. Μόνο ανάγνωση. Πιο αξιόπιστα με ζεστό κινητήρα και ολοκληρωμένα readiness monitors.':
    'the light comes on. Read-only. More reliable with a warm engine and complete readiness monitors.',
  'Διάβασε τεστ': 'Read tests',
  'Δείξε και τα τεστ χωρίς όρια': 'Also show tests without limits',
  'Readiness — τι λείπει για ΚΤΕΟ': 'Readiness — what is missing for inspection',
  'Τα monitors ολοκληρώνονται μόνο αν οδηγήσεις με συγκεκριμένο τρόπο (drive cycle). Μετά από σβήσιμο κωδικών ή αποσύνδεση μπαταρίας μηδενίζουν.':
    'Monitors complete only if you drive a specific way (drive cycle). They reset after clearing codes or disconnecting the battery.',
  'Έλεγχος readiness': 'Check readiness',

  // --- Ιστορικό
  'Εισαγωγή CSV': 'Import CSV',
  'Αποθηκεύεται μόνο σε αυτή τη συσκευή (IndexedDB).': 'Stored only on this device (IndexedDB).',
  'Καμία αποθηκευμένη συνεδρία.': 'No saved sessions.',

  // --- Βοηθός
  'Βοηθός διάγνωσης (Claude)': 'Diagnostic assistant (Claude)',
  'Προαιρετικό. Όταν πατήσεις «Ανάλυση», οι κωδικοί, η αναφορά υγείας, στατιστικά της καταγραφής και τα συμπτώματα στέλνονται στο api.anthropic.com. Το κλειδί αποθηκεύεται μόνο σε αυτόν τον browser.':
    'Optional. When you press “Analyse”, the codes, health report, recording stats and symptoms are sent to api.anthropic.com. The key is stored only in this browser.',
  'Να το θυμάται': 'Remember it',
  'Διαγραφή κλειδιού': 'Delete key',
  'Ακύρωση': 'Cancel',
  'Τι θα σταλεί;': 'What gets sent?',
  'Ζωντανή σύνδεση (live)': 'Live connection',
  'Με ανοιχτή τη σύνδεση (ή Demo), στέλνει περιοδικά τις τρέχουσες τιμές στο Claude και μπορείς να ρωτάς ζωντανά. Χρεώνεται ανά μήνυμα. Μόνο ανάγνωση. Για πλήρη εικόνα διάβασε πρώτα κωδικούς και αναφορά υγείας.':
    'With the connection open (or Demo), it periodically sends the current values to Claude and you can ask live. Charged per message. Read-only. For the full picture, read codes and the health report first.',
  '▶ Έναρξη ζωντανής ανάλυσης': '▶ Start live analysis',
  'Αυτόματος έλεγχος:': 'Auto check:',
  'χειροκίνητα': 'manual',
  'κάθε 15 s': 'every 15 s',
  'κάθε 30 s': 'every 30 s',
  'κάθε 60 s': 'every 60 s',
  'Αποστολή': 'Send',

  // --- Όχημα
  'Ανάγνωση ECU ID': 'Read ECU ID',
  'UDS 0x22 και OBD 09 — μόνο ανάγνωση. Η εφαρμογή δεν γράφει ποτέ στην ECU.':
    'UDS 0x22 and OBD 09 — read-only. The app never writes to the ECU.',
  'Σύνδεσου και πάτα «Ανάγνωση ECU ID».': 'Connect and press “Read ECU ID”.',
  'Σύνδεσου για στοιχεία οχήματος.': 'Connect for vehicle details.',
  'Ανάλυση VIN': 'VIN decode',
  'Ο VIN (ISO 3779) κωδικοποιεί χώρα, κατασκευαστή, έτος μοντέλου, εργοστάσιο και αύξοντα αριθμό. Η ανάλυση γίνεται':
    'The VIN (ISO 3779) encodes country, maker, model year, plant and serial number. Decoding is done',
  'εντελώς τοπικά': 'entirely locally',
  ', χωρίς δίκτυο. Το μέρος 4–8 (μοντέλο, κινητήρας) είναι ιδιωτικό κάθε κατασκευαστή και':
    ', with no network. Section 4-8 (model, engine) is private to each maker and',
  'δεν το μαντεύουμε': 'we do not guess it',
  'Γκαράζ': 'Garage',
  'Κάθε όχημα που συνδέεις καταγράφεται με το VIN του (ή, αν δεν δίνει VIN, με το πρωτόκολλο και τα PID του). Το ταμπλό και οι ρυθμίσεις θυμούνται ανά όχημα.':
    'Each vehicle you connect is recorded by its VIN (or, if no VIN, by its protocol and PIDs). The dashboard and settings are remembered per vehicle.',
  'Ρυθμίσεις': 'Settings',
  'Μονάδες:': 'Units:',
  'Μετρικό (°C, km/h, kPa, L)': 'Metric (°C, km/h, kPa, L)',
  'Θέμα:': 'Theme:',
  'Αυτόματο (από το σύστημα)': 'Automatic (from system)',
  'Φωτεινό': 'Light',
  'Σκοτεινό': 'Dark',
  'Το φωτεινό θέμα διαβάζεται καλύτερα στον ήλιο· το σκοτεινό κουράζει λιγότερο σε νυχτερινή διάγνωση. Το «αυτόματο» ακολουθεί το κινητό σου.':
    'The light theme reads better in sunlight; the dark theme is easier at night. “Automatic” follows your phone.',
  'Πρωτόκολλο:': 'Protocol:',
  'Το CAN είναι υποχρεωτικό μόνο από το 2008· παλιότερα οχήματα μιλούν ISO 9141-2, KWP2000 ή J1850. Άφησέ το στο':
    'CAN is mandatory only from 2008; older vehicles speak ISO 9141-2, KWP2000 or J1850. Leave it on',
  'αυτόματο': 'automatic',
  '— αν αποτύχει, η εφαρμογή δοκιμάζει τα πρωτόκολλα ένα-ένα και θυμάται ποιο δούλεψε. Διάλεξε χειροκίνητα μόνο αν ξέρεις το όχημα και ο adapter δυσκολεύεται. Ισχύει από την':
    '— if it fails, the app tries the protocols one by one and remembers which worked. Choose manually only if you know the vehicle and the adapter struggles. Applies from the',
  'επόμενη σύνδεση': 'next connection',
  'Προσομοιωτής παριστάνει:': 'Simulator pretends:',
  'CAN 11/500 (νεότερο όχημα)': 'CAN 11/500 (newer vehicle)',
  'KWP2000 fast init — το αυτόματο αποτυγχάνει': 'KWP2000 fast init — auto fails',
  'ISO 9141-2 (παλιό όχημα)': 'ISO 9141-2 (old vehicle)',
  'J1939 (φορτηγό / αγροτικό)': 'J1939 (truck / agricultural)',
  'Μόνο για δοκιμή χωρίς όχημα: στα παλιά πρωτόκολλα απαντά μόνο ο κινητήρας, χωρίς UDS — όπως στην πραγματικότητα.':
    'For testing without a vehicle only: on old protocols only the engine answers, no UDS — as in reality.',
  'Η μετατροπή αφορά μόνο την εμφάνιση. Οι αποθηκευμένες συνεδρίες, το CSV και ό,τι στέλνεται στον Βοηθό μένουν':
    'Conversion affects display only. Saved sessions, the CSV and anything sent to the Assistant stay',
  'πάντα μετρικά': 'always metric',
  ', ώστε να συγκρίνονται μεταξύ τους.': ', so they stay comparable.',

  // --- Ταξίδι
  'Υπολογιστής ταξιδιού': 'Trip computer',
  'Υπολογίζεται από την τρέχουσα καταγραφή: απόσταση με ολοκλήρωση της ταχύτητας, καύσιμο από το PID':
    'Computed from the current recording: distance by integrating speed, fuel from PID',
  '(L/h) της ECU. Αν το όχημα δεν το δίνει, γίνεται': '(L/h) of the ECU. If the vehicle does not provide it, it is',
  'εκτίμηση': 'estimated',
  'από το MAF — δηλώνεται όταν συμβαίνει.': 'from MAF — stated when it happens.',
  'Υπολογισμός': 'Calculate',
  'Τιμή καυσίμου (€/L):': 'Fuel price (€/L):',
  'Ξεκίνα Live (ή άνοιξε συνεδρία από το Ιστορικό) και πάτα Υπολογισμός.':
    'Start Live (or open a session from History) and press Calculate.',
  'Επιδόσεις': 'Performance',
  'Ανιχνεύονται από την καταγραφή, όχι από χρονόμετρο: ψάχνει εκκινήσεις από στάση (≤ 2 km/h). Η ακρίβεια εξαρτάται από τον ρυθμό δειγματοληψίας του adapter — με ~5 δείγματα/s το σφάλμα είναι μερικά δέκατα.':
    'Detected from the recording, not a stopwatch: it looks for launches from standstill (≤ 2 km/h). Accuracy depends on the adapter sampling rate — at ~5 samples/s the error is a few tenths.',
  'Μόνο σε κλειστή πίστα, όχι στον δρόμο.': 'Closed track only, not on the road.',
  'Πάτα Υπολογισμός πιο πάνω.': 'Press Calculate above.',
  'Εκτίμηση ισχύος': 'Power estimate',
  'ενδεικτικό': 'indicative',
  'Από την επιτάχυνση:': 'From acceleration:',
  'Δεν είναι δυναμόμετρο.': 'Not a dynamometer.',
  'Εξαρτάται από τη μάζα που θα δηλώσεις, από εκτιμώμενο συντελεστή οπισθέλκουσας, από τον άνεμο, την κλίση του δρόμου και από τη δειγματοληψία του OBD. Χρήσιμο για':
    'It depends on the mass you declare, an estimated drag coefficient, wind, road grade and the OBD sampling. Useful for',
  'σύγκριση πριν/μετά': 'before/after comparison',
  ', όχι για απόλυτο νούμερο.': ', not for an absolute figure.',
  'Όχημα:': 'Vehicle:',
  'Μάζα οχήματος (kg):': 'Vehicle mass (kg):',
  'Αναβάτης / επιβάτες (kg):': 'Rider / passengers (kg):',
  'Κλίση δρόμου (%):': 'Road grade (%):',

  // --- υποσέλιδο / διάλογοι
  'Μόνο εντολές ανάγνωσης (whitelist): OBD 01/02/03/06/07/09/0A, UDS 19/22, επιλεγμένες AT.':
    'Read-only commands (whitelist): OBD 01/02/03/06/07/09/0A, UDS 19/22, selected AT.',
  'Μόνο ανάγνωση · καμία εγγραφή στην ECU': 'Read-only · no writes to the ECU',
  'Επιλογή PID': 'Choose PIDs',
  'Μόνο όσα δηλώνει η ECU αυτού του οχήματος. Η επιλογή αποθηκεύεται ανά VIN. Τα γκρι (κατάσταση / raw) δεν μπαίνουν σε κάρτες — τα βλέπεις στο «PID κατάστασης».':
    'Only what this vehicle’s ECU declares. The selection is saved per VIN. Greyed ones (status / raw) do not go on tiles — you see them in “Status PIDs”.',
  'Όλα': 'All',
  'Κανένα': 'None',
  'Άκυρο': 'Cancel',
  'Εφαρμογή': 'Apply',
  'Σβήσιμο κωδικών βλάβης': 'Clear fault codes',
  'Θα σβηστούν': 'This clears',
  'όλοι': 'all',
  'οι κωδικοί, τα freeze frame και τα readiness monitors (υπηρεσία 04). Η λυχνία θα σβήσει, αλλά η βλάβη μένει αν δεν διορθώθηκε.':
    'codes, freeze frames and readiness monitors (service 04). The light goes off, but the fault remains if not fixed.',
  'Καταλαβαίνω και θέλω να τους σβήσω': 'I understand and want to clear them',
  'Σβήσιμο': 'Clear',

  // --- attributes
  'Θέση αναπαραγωγής': 'Playback position',
  'Ταχύτητα': 'Speed',
  'π.χ. P0171': 'e.g. P0171',
  'Εύρος σάρωσης': 'Scan range',
  'Μονάδα': 'Module',
  'Περιοχή DID': 'DID range',
  'Τύπος μπαταρίας': 'Battery type',
  'Κλειδί Anthropic API (sk-ant-…)': 'Anthropic API key (sk-ant-…)',
  'Συμπτώματα: π.χ. «σβήνει στο ρελαντί όταν είναι ζεστή», «κόβει στις 5000»':
    'Symptoms: e.g. “stalls at idle when hot”, “cuts out at 5000”',
  'Συχνότητα αυτόματου ελέγχου': 'Auto-check frequency',
  'Ρώτησέ με… π.χ. «πέφτει το ρελαντί όταν ζεσταθεί, τι να κοιτάξω;»':
    'Ask me… e.g. “idle drops when it warms up, what should I check?”',
  '17 χαρακτήρες': '17 characters',
  'Σύστημα μονάδων': 'Unit system',
  'Πρωτόκολλο OBD': 'OBD protocol',
  'Πρωτόκολλο προσομοιωτή': 'Simulator protocol',
  'Είδος οχήματος': 'Vehicle type',
  'π.χ. ATRV, 010C, 22F190': 'e.g. ATRV, 010C, 22F190',

  // --- γλώσσα (νέο στοιχείο)
  'Γλώσσα:': 'Language:',
  'Ελληνικά': 'Greek',
  'Αγγλικά': 'English',
};
