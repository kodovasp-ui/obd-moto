// Γνωστές ECU και διαθέσιμα εργαλεία/tunes (μόνο πληροφορίες — η εφαρμογή ΔΕΝ γράφει στην ECU).
// Πηγές: σελίδες πωλητών, Νοέμβριος 2026. Λεπτομέρειες: docs/reflash-plan.md

export const ECU_DB = {
  'MSE6.0': {
    name: 'Bosch MSE 6.0',
    mcu: 'SPC563M64',
    tools: [
      { name: 'AutoTuner', methods: 'OBD, Bench (χωρίς άνοιγμα)', url: 'https://www.autotuner.com/pages/ecu/bosch-mse60-spc563m64' },
      { name: 'Magicmotorsport Flex', methods: 'OBD (v6.56+), Bench (v6.59+)', url: 'https://tuning-x.com/bench-solution-for-mse6-0-and-us6-0' },
      { name: 'MotoFlasher', methods: 'OP20 CAN — λίστα με 450 MT 2024–2025', url: 'https://motoflasher.com/features/' },
      { name: 'ECUTools Combiloader', methods: 'Module MSE6.0', url: 'https://ecutools.eu/chip-tuning/combiloader/mse-6-0/' },
      { name: 'TunerPro (XDF)', methods: 'Μόνο επεξεργασία αρχείου', url: 'https://oldskulltuning.com/bosch-mse6-0-tunerpro-maps-for-atv-and-bikes/' },
    ],
    tunes: [
      { name: 'SSS Motorcycles — 450MT mail-in', url: 'https://sssmotorcycles.com/products/cfmoto-450mt-ecu-reflash' },
      { name: 'Alt Tune — CFMOTO 450 (δυναμόμετρο)', url: 'https://alttune.com/cfmoto-450-ecu-tune-bike-dyno-ecu-file-service/' },
      { name: 'Throttle Punks — 450MT (ΕΕ)', url: 'https://eshop.throttlepunks.cz/en/cfmoto-450mt-ecu/' },
      { name: 'FASTTUNES — Ibex 450 (μόνο πίστα)', url: 'https://www.fasttunes.com/product-page/cfmoto-ibex-450-ecu-tune' },
    ],
    note: 'Υπάρχουν εργαλεία και έτοιμα tunes. Νομιμότητα σε δρόμο, εγγύηση και κίνδυνοι: docs/reflash-plan.md.',
  },
  'MSE9.0': {
    name: 'Bosch MSE 9.0',
    tools: [{ name: 'MotoFlasher', methods: 'Bench (ορισμένα 450 του 2025–2026)', url: 'https://motoflasher.com/features/' }],
    tunes: [],
    note: 'Περιορισμένη υποστήριξη· επιβεβαίωσε με τον πάροχο.',
  },
};

// Αναφορά: εργοστασιακή ανάγνωση της δικής μας μοτοσυκλέτας (docs/ecu-id.md, 2026-11-17).
export const REFERENCE = {
  vin: 'LCEPESLGXT6001808', date: '2026-11-17',
  F188: 'MSE6.0', F18A: 'UAES', F194: 'F05H00015L', F195: 'SW:1.00.00',
  CALID: '8811CF24503B6AQ2', CVN: 'FBE14DDC',
};

export const ECU_DIDS = [
  ['F187', 'Κωδικός ανταλλακτικού'], ['F188', 'Τύπος ECU (SW number)'], ['F189', 'SW version'],
  ['F18A', 'Προμηθευτής'], ['F190', 'VIN'], ['F191', 'HW number'], ['F192', 'HW προμηθευτή'],
  ['F193', 'HW version προμηθευτή'], ['F194', 'SW προμηθευτή'], ['F195', 'SW version προμηθευτή'],
  ['F197', 'Όνομα συστήματος'], ['F199', 'Ημ/νία προγραμματισμού / αναφορά'],
];
