const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { DATA_DIR } = require('./config');
const { sshPipeCommands, sshPtyCommands } = require('./ssh');

const BACKUP_EXT = /\.(txt|lcfsx|cfg|xml)$/i;

/** LANCOM KB: Switch-Konfiguration per SCP als „config“-Remote-Datei (nicht show running-config). */
const SX_SCP_OS = new Set(['LCOS SX 3', 'LCOS SX 4', 'LCOS SX 5']);

function sxScpExtension(os) {
  if (os === 'LCOS SX 3') return '.xml';
  if (os === 'LCOS SX 4') return '.lcfsx';
  if (os === 'LCOS SX 5') return '.cfg';
  return '.bin';
}

/**
 * @returns {Promise<Buffer>}
 */
function scpFetchRemoteConfig(ip, user, pass) {
  const tmp = path.join(os.tmpdir(), `onsite-cfg-${process.pid}-${Date.now()}.bin`);
  const run = (legacyO) => new Promise((resolve, reject) => {
    const args = ['-p', pass, 'scp'];
    if (legacyO) args.push('-O');
    args.push(
      '-o', 'StrictHostKeyChecking=no',
      '-o', 'UserKnownHostsFile=/dev/null',
      '-o', 'ConnectTimeout=25',
      `${user}@${ip}:config`,
      tmp,
    );
    const p = spawn('sshpass', args);
    let stderr = '';
    const timer = setTimeout(() => {
      try { p.kill('SIGKILL'); } catch (_) {}
      reject(new Error('SCP-Timeout (90s)'));
    }, 90000);
    p.stderr.on('data', (d) => { stderr += d.toString(); });
    p.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        try {
          const buf = fs.readFileSync(tmp);
          fs.unlinkSync(tmp);
          if (!buf || buf.length < 10) reject(new Error('SCP: empfangene Datei zu klein'));
          else resolve(buf);
        } catch (e) {
          try { fs.unlinkSync(tmp); } catch (_) {}
          reject(e);
        }
      } else {
        try { fs.unlinkSync(tmp); } catch (_) {}
        reject(new Error((stderr || '').trim() || `scp beendet mit Code ${code}`));
      }
    });
    p.on('error', (e) => {
      clearTimeout(timer);
      try { fs.unlinkSync(tmp); } catch (_) {}
      reject(e);
    });
  });
  return run(false).catch(() => run(true));
}

const BACKUP_DIR = path.join(DATA_DIR, 'backups');
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

function backupDirForIp(ip) {
  const dir = path.join(BACKUP_DIR, ip.replace(/\./g, '_'));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanSshConfigOutput(s) {
  let config = s || '';
  config = config.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
  config = config.replace(/\r/g, '');
  return config.trim();
}

/** LX 7.x: SSH landet in der Menü-CLI (>), nicht in sh — kein „sh -c … cat …“. */
function looksLikeLxCliFailure(out) {
  const t = out.trim();
  if (t.length < 10) return true;
  if (/^Usage:\s*show\b/m.test(t)) return true;
  if (/%\s*Unrecognized command/i.test(t)) return true;
  if (/^Usage:/m.test(t) && !/#\s*Script/i.test(t)) return true;
  return false;
}

async function fetchLcosLxConfig(ip, user, pass) {
  const tries = ['readscript -n', 'readscript', 'readconfig'];
  const timeout = 120000;
  let lastDetail = '';
  for (const cmd of tries) {
    const result = await sshPipeCommands(ip, user, pass, [cmd], timeout, false, true);
    const out = cleanSshConfigOutput(result.stdout || '');
    // Exit-Code kann trotz gültiger Ausgabe ≠ 0 sein (Remote-CLI); Inhalt zählt.
    if (!looksLikeLxCliFailure(out)) return out;
    const hint = (result.stderr || out || '').trim().slice(0, 240);
    lastDetail = `${cmd} (exit ${result.exitCode}): ${hint}`;
  }
  throw new Error(
    'LCOS-LX: Konfiguration nicht lesbar. ' +
      lastDetail +
      ' — Am SSH-Prompt > direkt testen: readscript -n, readscript, readconfig (ohne sh).',
  );
}

function getConfigCommand(os) {
  switch (os) {
    case 'LCOS':      return { cmd: 'readconfig', mode: 'pty' };
    case 'LCOS FX':   return { cmd: 'readconfig', mode: 'pipe-pty' };
    case 'LCOS SX 3': return { cmd: 'show running-config', mode: 'pty' };
    case 'LCOS SX 4': return { cmd: 'show running-config', mode: 'pipe-crlf' };
    case 'LCOS SX 5': return { cmd: 'show running-config', mode: 'pipe-crlf' };
    default:          return { cmd: 'show running-config', mode: 'pipe' };
  }
}

async function fetchConfig(ip, os, user, pass) {
  if (os === 'LCOS LX') {
    return fetchLcosLxConfig(ip, user, pass);
  }

  const { cmd, mode } = getConfigCommand(os);
  let result;
  if (mode === 'pty') {
    result = await sshPtyCommands(ip, user, pass, [cmd], 30000);
  } else if (mode === 'pipe-pty') {
    // SSH -tt: interaktive LCOS-FX-Shell, LF, danach exit (vollständige Ausgabe)
    result = await sshPipeCommands(ip, user, pass, [cmd], 60000, false, true);
  } else if (mode === 'pipe-crlf') {
    // PTY + CRLF: Session bleibt offen bis „exit“, Ausgabe vollständiger als stdin sofort zu schließen
    result = await sshPipeCommands(ip, user, pass, [cmd], 45000, true, true);
  } else {
    result = await sshPipeCommands(ip, user, pass, [cmd], 30000, false);
  }

  if (result.exitCode !== 0) {
    throw new Error(`SSH-Fehler (exit ${result.exitCode}): ${result.stderr || result.stdout}`);
  }

  return cleanSshConfigOutput(result.stdout || '');
}

async function backupDevice(ip, os, user, pass) {
  const dir = backupDirForIp(ip);
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

  if (SX_SCP_OS.has(os)) {
    try {
      const buf = await scpFetchRemoteConfig(ip, user, pass);
      const ext = sxScpExtension(os);
      const filename = ts + ext;
      const filepath = path.join(dir, filename);
      fs.writeFileSync(filepath, buf);
      return { ip, os, filename, size: buf.length, ts: new Date().toISOString(), via: 'scp' };
    } catch (scpErr) {
      try {
        const config = await fetchConfig(ip, os, user, pass);
        if (!config || config.length < 10) throw scpErr;
        const filename = `${ts}.txt`;
        fs.writeFileSync(path.join(dir, filename), config, 'utf8');
        return { ip, os, filename, size: config.length, ts: new Date().toISOString(), via: 'ssh', warn: `SCP fehlgeschlagen (${scpErr.message}), Fallback SSH-CLI.` };
      } catch {
        throw new Error(
          `Switch-Backup fehlgeschlagen. SCP: ${scpErr.message}. ` +
            'Prüfen Sie: sshpass/scp installiert, Port 22, Benutzer admin, Gerätepasswort. ' +
            'Alternativ manuell: scp admin@' + ip + ':config … (siehe LANCOM KB „SCP“).',
        );
      }
    }
  }

  const config = await fetchConfig(ip, os, user, pass);
  if (!config || config.length < 10) throw new Error('Leere oder zu kurze Konfiguration empfangen');

  const filename = `${ts}.txt`;
  fs.writeFileSync(path.join(dir, filename), config, 'utf8');

  return { ip, os, filename, size: config.length, ts: new Date().toISOString() };
}

function listBackups(ip) {
  const dir = backupDirForIp(ip);
  try {
    return fs.readdirSync(dir)
      .filter(f => BACKUP_EXT.test(f))
      .sort().reverse()
      .map(f => {
        const stat = fs.statSync(path.join(dir, f));
        return { filename: f, size: stat.size, ts: stat.mtime.toISOString() };
      });
  } catch { return []; }
}

function resolveBackupFilePath(ip, filename) {
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    throw new Error('Ungültiger Dateiname');
  }
  const dir = path.resolve(backupDirForIp(ip));
  const filepath = path.resolve(path.join(dir, filename));
  if (!filepath.startsWith(dir + path.sep) && filepath !== dir) throw new Error('Ungültiger Pfad');
  if (!fs.existsSync(filepath)) throw new Error('Datei fehlt');
  return filepath;
}

function getBackupContent(ip, filename) {
  const filepath = resolveBackupFilePath(ip, filename);
  const lower = filename.toLowerCase();
  if (lower.endsWith('.lcfsx') || lower.endsWith('.cfg') || lower.endsWith('.xml')) {
    const st = fs.statSync(filepath);
    return (
      `[Binärkonfiguration (${filename}, ${st.size} Byte)\n\n` +
      `Vorschau nicht möglich. Download: /api/backup/download?ip=${encodeURIComponent(ip)}&file=${encodeURIComponent(filename)}\n` +
      `Oder auf dem Server: ${filepath}]`
    );
  }
  return fs.readFileSync(filepath, 'utf8');
}

function deleteBackup(ip, filename) {
  const filepath = resolveBackupFilePath(ip, filename);
  fs.unlinkSync(filepath);
}

function diffConfigs(a, b) {
  const linesA = a.split('\n');
  const linesB = b.split('\n');
  const setA = new Set(linesA);
  const setB = new Set(linesB);
  const removed = linesA.filter(l => !setB.has(l) && l.trim());
  const added = linesB.filter(l => !setA.has(l) && l.trim());
  return { removed, added, same: linesA.length - removed.length };
}

module.exports = {
  backupDevice,
  listBackups,
  getBackupContent,
  deleteBackup,
  diffConfigs,
  resolveBackupFilePath,
  BACKUP_DIR,
};
