const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { NAC_CERTS_DIR } = require('./config');

const SAFE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,62}$/;

function safeCertName(name) {
  const n = String(name || '').trim();
  if (!SAFE_NAME.test(n)) throw new Error('Ungültiger Dateiname (nur Buchstaben, Ziffern, . _ -)');
  if (n.includes('..') || n.includes('/') || n.includes('\\')) throw new Error('Ungültiger Dateiname');
  return n;
}

function describePem(pem) {
  const s = String(pem || '');
  if (/BEGIN CERTIFICATE/.test(s)) {
    try {
      const c = new crypto.X509Certificate(s);
      return {
        kind: 'certificate',
        subject: c.subject,
        issuer: c.issuer,
        validFrom: c.validFrom,
        validTo: c.validTo,
      };
    } catch {
      return { kind: 'certificate', subject: '(nicht lesbar)', issuer: '', validFrom: '', validTo: '' };
    }
  }
  if (/BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/.test(s)) {
    return { kind: 'private_key', subject: '(Private Key)', issuer: '', validFrom: '', validTo: '' };
  }
  return { kind: 'other', subject: '', issuer: '', validFrom: '', validTo: '' };
}

function listNacCerts() {
  if (!fs.existsSync(NAC_CERTS_DIR)) return [];
  const names = fs.readdirSync(NAC_CERTS_DIR).filter((n) => !n.startsWith('.'));
  return names.map((name) => {
    const fp = path.join(NAC_CERTS_DIR, name);
    const st = fs.statSync(fp);
    let pem = '';
    try {
      pem = fs.readFileSync(fp, 'utf8');
    } catch {
      return { name, size: st.size, mtime: st.mtimeMs, kind: 'other', subject: '', issuer: '', validFrom: '', validTo: '' };
    }
    const meta = describePem(pem);
    return { name, size: st.size, mtime: st.mtimeMs, ...meta };
  });
}

function saveNacCert(name, pem) {
  const n = safeCertName(name);
  const body = String(pem || '').trim();
  if (!body.includes('-----BEGIN')) throw new Error('Kein PEM-Inhalt (BEGIN … erwartet)');
  if (body.length > 512 * 1024) throw new Error('Datei zu groß (max. 512 KB)');
  fs.writeFileSync(path.join(NAC_CERTS_DIR, n), body, 'utf8');
}

function deleteNacCert(name) {
  const n = safeCertName(name);
  const fp = path.join(NAC_CERTS_DIR, n);
  if (!fs.existsSync(fp)) throw new Error('Datei nicht gefunden');
  fs.unlinkSync(fp);
}

module.exports = {
  listNacCerts,
  saveNacCert,
  deleteNacCert,
  safeCertName,
};
