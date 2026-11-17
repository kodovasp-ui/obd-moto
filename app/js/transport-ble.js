// Μεταφορά Web Bluetooth (BLE) για ELM327.
// Υποστηρίζει τα συνηθισμένα σχήματα: FFF0 (FFF1 notify / FFF2 write) και FFE0 (FFE1).

const SERVICES = [0xfff0, 0xffe0, 0x18f0];

export class BleTransport {
  constructor() {
    this.onData = () => {};
    this.onDisconnect = () => {};
    this.device = null;
    this.name = '';
  }

  static isSupported() {
    return !!(navigator.bluetooth && window.isSecureContext);
  }

  async connect() {
    if (!navigator.bluetooth) throw new Error('Ο browser δεν υποστηρίζει Web Bluetooth (χρησιμοποίησε Chrome).');
    if (!window.isSecureContext) throw new Error('Χρειάζεται https ή localhost για Web Bluetooth.');
    this.device = await navigator.bluetooth.requestDevice({
      filters: [
        { services: [0xfff0] }, { services: [0xffe0] },
        { namePrefix: 'OBD' }, { namePrefix: 'V-LINK' }, { namePrefix: 'IOS-Vlink' },
        { namePrefix: 'Android-Vlink' }, { namePrefix: 'ELM' }, { namePrefix: 'vgate' },
      ],
      optionalServices: SERVICES,
    });
    this.name = this.device.name || 'BLE';
    this.device.addEventListener('gattserverdisconnected', () => this.onDisconnect());
    const server = await this.device.gatt.connect();

    let notifyCh = null;
    let writeCh = null;
    for (const uuid of SERVICES) {
      let svc;
      try { svc = await server.getPrimaryService(uuid); } catch { continue; }
      const chars = await svc.getCharacteristics();
      notifyCh = chars.find((c) => c.properties.notify || c.properties.indicate) || null;
      // Προτίμησε write χαρακτηριστικό διαφορετικό από το notify (FFF2), αλλιώς το ίδιο (FFE1).
      writeCh = chars.find((c) => c !== notifyCh && (c.properties.write || c.properties.writeWithoutResponse))
        || chars.find((c) => c.properties.write || c.properties.writeWithoutResponse) || null;
      if (notifyCh && writeCh) break;
    }
    if (!notifyCh || !writeCh) throw new Error('Δεν βρέθηκε υπηρεσία UART (FFF0/FFE0) στη συσκευή.');
    this.writeCh = writeCh;
    const dec = new TextDecoder();
    notifyCh.addEventListener('characteristicvaluechanged', (e) => this.onData(dec.decode(e.target.value)));
    await notifyCh.startNotifications();
  }

  async write(text) {
    const bytes = new TextEncoder().encode(text);
    for (let i = 0; i < bytes.length; i += 20) {
      const chunk = bytes.slice(i, i + 20);
      if (this.writeCh.properties.writeWithoutResponse) await this.writeCh.writeValueWithoutResponse(chunk);
      else await this.writeCh.writeValueWithResponse(chunk);
    }
  }

  async disconnect() {
    try { this.device?.gatt?.disconnect(); } catch { /* ήδη αποσυνδεδεμένο */ }
  }
}
