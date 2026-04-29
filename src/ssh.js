const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { readSettings } = require('./data');
const { SCRIPTE_DIR, ROLLOUT_FILENAME } = require('./config');

const IP_RE = /^\d{1,3}(\.\d{1,3}){3}$/;
function escapeExpect(s) {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\[/g, '\\[').replace(/\]/g, '\\]').replace(/\$/g, '\\$').replace(/`/g, '\\`');
}

function sshPtyCommands(ip, user, pass, commands, timeout = 30000) {
  return new Promise((resolve) => {
    if (!IP_RE.test(ip)) { resolve({ exitCode: -1, stdout: '', stderr: 'Ungültige IP-Adresse' }); return; }
    const sends = commands.map(cmd => {
      return `send "${escapeExpect(cmd)}\\r"\nexpect "# "`;
    }).join('\n');
    const script = `
set timeout ${Math.floor(timeout / 1000)}
spawn sshpass -p "${escapeExpect(pass)}" ssh -tt -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=10 ${user}@${ip}
expect {
  "# " {}
  "Permission denied" { exit 1 }
  timeout             { exit 2 }
}
${sends}
send "exit\\r"
expect eof
exit 0
`;
    const proc = spawn('expect', ['-c', script], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    proc.stdout.on('data', d => stdout += d.toString());
    proc.stderr.on('data', d => stderr += d.toString());
    const timer = setTimeout(() => { proc.kill(); resolve({ exitCode: -1, stdout, stderr: stderr + '\n[Timeout]' }); }, timeout + 5000);
    proc.on('close', code => { clearTimeout(timer); resolve({ exitCode: code, stdout, stderr }); });
    proc.on('error', e => { clearTimeout(timer); resolve({ exitCode: -1, stdout, stderr: e.message }); });
  });
}

function sshPipeCommands(ip, user, pass, commands, timeout = 20000, crlf = false, pty = false) {
  return new Promise((resolve) => {
    if (!IP_RE.test(ip)) { resolve({ exitCode: -1, stdout: '', stderr: 'Ungültige IP-Adresse' }); return; }
    const proc = spawn('sshpass', [
      '-p', pass,
      'ssh',
      ...(pty ? ['-tt'] : []),
      '-o', 'StrictHostKeyChecking=no',
      '-o', 'UserKnownHostsFile=/dev/null',
      '-o', 'ConnectTimeout=10',
      '-o', 'BatchMode=no',
      `${user}@${ip}`,
    ]);
    let stdout = '', stderr = '';
    proc.stdout.on('data', d => stdout += d.toString());
    proc.stderr.on('data', d => stderr += d.toString());
    const timer = setTimeout(() => { proc.kill(); resolve({ exitCode: -1, stdout, stderr: stderr + '\n[Timeout]' }); }, timeout);
    proc.on('close', code => { clearTimeout(timer); resolve({ exitCode: code, stdout, stderr }); });
    proc.on('error', e => { clearTimeout(timer); resolve({ exitCode: -1, stdout, stderr: e.message }); });
    const eol = crlf ? '\r\n' : '\n';
    for (const cmd of commands) proc.stdin.write(cmd + eol);
    if (pty) proc.stdin.write('exit' + eol);
    proc.stdin.end();
  });
}

function sshFnForOs(os) {
  if (os === 'LCOS SX 3') return sshPtyCommands;
  const crlf = (os === 'LCOS' || os === 'LCOS SX 4' || os === 'LCOS SX 5');
  const pty  = (os === 'LCOS LX' || os === 'LCOS FX');
  return (ip, u, p, cmds) => sshPipeCommands(ip, u, p, cmds, 20000, crlf, pty);
}

function resolvePlaceholders(str, s) {
  return str
    .replaceAll('{{password}}',          s.devicePassword       || '')
    .replaceAll('{{snmp_securityname}}', s.snmpV3SecurityName   || '')
    .replaceAll('{{snmp_auth_password}}',s.snmpV3AuthPassword   || '')
    .replaceAll('{{snmp_priv_password}}',s.snmpV3PrivPassword   || '');
}

async function runRolloutScript(ip, os, user, pass) {
  try {
    const file = path.join(SCRIPTE_DIR, os, ROLLOUT_FILENAME);
    if (!fs.existsSync(file)) return null;
    const script = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!script.commands || !script.commands.length) return null;
    const resolved = script.commands.map(c => resolvePlaceholders(c, readSettings()));
    const r = await sshFnForOs(os)(ip, user, pass, resolved);
    return [{ commands: script.commands, ...r, combined: true }];
  } catch { return null; }
}

function sshExec(ip, user, pass, command) {
  return new Promise((resolve) => {
    const args = [
      '-p', pass,
      'ssh',
      '-o', 'StrictHostKeyChecking=no',
      '-o', 'UserKnownHostsFile=/dev/null',
      '-o', 'ConnectTimeout=10',
      '-o', 'BatchMode=no',
      `${user}@${ip}`,
      command,
    ];
    const proc = spawn('sshpass', args);
    let stdout = '', stderr = '';
    proc.stdout.on('data', d => stdout += d.toString());
    proc.stderr.on('data', d => stderr += d.toString());
    const timer = setTimeout(() => { proc.kill(); resolve({ stdout: '', stderr: 'Timeout (15s)', exitCode: -1 }); }, 15000);
    proc.on('close', code => { clearTimeout(timer); resolve({ stdout, stderr, exitCode: code }); });
    proc.on('error', err => { clearTimeout(timer); resolve({ stdout: '', stderr: err.message, exitCode: -1 }); });
  });
}

module.exports = {
  IP_RE,
  escapeExpect,
  sshPtyCommands,
  sshPipeCommands,
  sshFnForOs,
  sshExec,
  resolvePlaceholders,
  runRolloutScript,
};
