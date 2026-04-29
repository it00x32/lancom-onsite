const fs     = require('fs');
const crypto = require('crypto');
const { LICENSE_FILE, TRIAL_FILE } = require('./config');

const TRIAL_MINUTES = 30;

const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA27gAr8vOWQ+Fa2QLxMzj
fnyFbqrE4OyyeD2rkWbbkWMr74/imZLdevq2pn7s907kapomw93RcbCCgG22tAlL
EbM+kx7IHHamv44z3jJXtZSIcExNCcThcq30CuhLnLIG5KZeouulIsdwCJHdZQej
TipHXNVxFALO5rmfELhpCnuSLd2WVwf7qjmGu1eijkTVUFnrgD/HVtRTO7F72m4S
abzZQ0vGvkl5lnHfkR4mx5xBvFMTJzBjhKm8frzFIn2+M4ZNLXMfxUoCuvxy6Hop
u9TsEodjQht1P6BGjJ0wolWFPakok57ffC79GBLi+AYPWEvlKTyei4N5b/EaMruy
WwIDAQAB
-----END PUBLIC KEY-----`;

function getTrialInfo() {
  try {
    if (!fs.existsSync(TRIAL_FILE)) {
      const data = { firstRun: new Date().toISOString() };
      fs.writeFileSync(TRIAL_FILE, JSON.stringify(data));
      return data;
    }
    return JSON.parse(fs.readFileSync(TRIAL_FILE, 'utf8'));
  } catch { return { firstRun: new Date().toISOString() }; }
}

function validateLicense() {
  // Lizenz-Datei prüfen
  if (fs.existsSync(LICENSE_FILE)) {
    try {
      const lic = JSON.parse(fs.readFileSync(LICENSE_FILE, 'utf8'));
      const { signature, ...payload } = lic;
      const data = JSON.stringify(payload, Object.keys(payload).sort());
      const verify = crypto.createVerify('SHA256');
      verify.update(data);
      const valid = verify.verify(PUBLIC_KEY, signature, 'base64');
      if (!valid) return { status: 'invalid', message: 'Ungültige Lizenz (Signatur fehlerhaft)' };
      const now      = new Date();
      const expires  = new Date(lic.expiresAt);
      if (now > expires) return { status: 'expired', customer: lic.customer, email: lic.email, expiresAt: lic.expiresAt, message: 'Lizenz abgelaufen' };
      const daysLeft = Math.ceil((expires - now) / 86400000);
      return { status: 'active', customer: lic.customer, email: lic.email, issuedAt: lic.issuedAt, expiresAt: lic.expiresAt, daysLeft };
    } catch { return { status: 'invalid', message: 'Lizenz-Datei fehlerhaft' }; }
  }
  // Keine Lizenz nach explizitem Entfernen
  const trial = getTrialInfo();
  if (trial.removed) return { status: 'none', message: 'Keine Lizenz installiert' };
  // Trial-Modus
  const start       = new Date(trial.firstRun);
  const now         = new Date();
  const elapsed     = Math.floor((now - start) / 60000);
  const minutesLeft = Math.max(0, TRIAL_MINUTES - elapsed);
  if (minutesLeft <= 0) return { status: 'trial_expired', minutesLeft: 0, message: `Trial-Zeitraum (${TRIAL_MINUTES} Minuten) abgelaufen` };
  return { status: 'trial', minutesLeft, trialStart: trial.firstRun, message: `Trial — noch ${minutesLeft} Minute${minutesLeft !== 1 ? 'n' : ''}` };
}

module.exports = {
  getTrialInfo,
  validateLicense,
  PUBLIC_KEY,
};
