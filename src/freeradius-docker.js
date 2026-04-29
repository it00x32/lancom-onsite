/**
 * FreeRADIUS-Container (docker compose) — Status, Start, Stopp.
 * Voraussetzung: Docker-CLI installiert; der OnSite-Prozess braucht Rechte (z. B. Nutzer in Gruppe docker).
 * Hinweis: Viele Dienste haben kein vollständiges PATH — wir probieren typische Pfade vor „docker“.
 */

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const util = require('util');
const { BASE_DIR } = require('./config');

const execFileAsync = util.promisify(execFile);

const CONTAINER_NAME = 'onsite-freeradius';
const COMPOSE_REL = 'docker-compose.freeradius.yml';

/** @type {string | null} */
let _resolvedDocker = null;

function firstExecutable(candidates) {
  for (const p of candidates) {
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return p;
    } catch {
      /* next */
    }
  }
  return null;
}

/**
 * Docker-Binary: zuerst Standardpfade (unabhängig vom PATH des Server-Prozesses), sonst „docker“ aus PATH.
 */
function dockerBin() {
  if (_resolvedDocker) return _resolvedDocker;
  const found = firstExecutable(['/usr/bin/docker', '/usr/local/bin/docker', '/bin/docker', '/snap/bin/docker']);
  _resolvedDocker = found || 'docker';
  return _resolvedDocker;
}

const execDockerEnv = () => ({
  ...process.env,
  PATH: [
    '/usr/local/sbin',
    '/usr/local/bin',
    '/usr/sbin',
    '/usr/bin',
    '/sbin',
    '/bin',
    '/snap/bin',
    process.env.PATH || '',
  ].filter(Boolean).join(':'),
});

function composePath() {
  return path.join(BASE_DIR, COMPOSE_REL);
}

/**
 * @returns {Promise<{ available: boolean, running: boolean, status?: string, error?: string }>}
 */
async function getDockerFreeRadiusStatus() {
  try {
    const { stdout } = await execFileAsync(
      dockerBin(),
      ['inspect', '-f', '{{.State.Status}}|{{.State.Running}}', CONTAINER_NAME],
      { timeout: 12000, maxBuffer: 256 * 1024, env: execDockerEnv() },
    );
    const parts = String(stdout || '').trim().split('|');
    const status = parts[0] || 'unknown';
    const running = parts[1] === 'true';
    return { available: true, running, status };
  } catch (e) {
    const stderr = e.stderr ? e.stderr.toString() : '';
    const msg = e.message || String(e);
    if (e.code === 'ENOENT') {
      return {
        available: false,
        running: false,
        error: 'Docker-CLI nicht gefunden. Bitte Docker installieren oder OnSite mit PATH starten, der /usr/bin enthält (typisch: /usr/bin/docker).',
      };
    }
    if (e.code === 1 && (/No such object|no such/i.test(stderr) || /no such/i.test(msg))) {
      return { available: true, running: false, status: 'not_found' };
    }
    return { available: false, running: false, error: stderr.trim() || msg };
  }
}

async function runCompose(subArgs) {
  const file = composePath();
  const env = execDockerEnv();
  const tryRun = async (cmd, args) => {
    try {
      const r = await execFileAsync(cmd, args, {
        cwd: BASE_DIR,
        timeout: 180000,
        maxBuffer: 4 * 1024 * 1024,
        env,
      });
      return { stdout: r.stdout || '', stderr: r.stderr || '' };
    } catch (e) {
      const detail = [e.stderr?.toString(), e.stdout?.toString(), e.message].filter(Boolean).join('\n').trim();
      throw new Error(detail || 'Docker Compose fehlgeschlagen');
    }
  };
  const dockerComposeStandalone = firstExecutable(['/usr/local/bin/docker-compose', '/usr/bin/docker-compose']);
  try {
    return await tryRun(dockerBin(), ['compose', '-f', file, ...subArgs]);
  } catch (e1) {
    if (e1.code !== 'ENOENT') throw e1;
    try {
      const alt = dockerComposeStandalone || 'docker-compose';
      return await tryRun(alt, ['-f', file, ...subArgs]);
    } catch (e2) {
      if (e2.code === 'ENOENT') {
        throw new Error('Weder „docker compose“ noch „docker-compose“ gefunden. Bitte Docker Compose installieren.');
      }
      throw e2;
    }
  }
}

async function startDockerFreeRadius() {
  const out = await runCompose(['up', '-d']);
  return { ok: true, message: (out.stderr || out.stdout || '').trim() || 'OK' };
}

async function stopDockerFreeRadius() {
  const out = await runCompose(['down']);
  return { ok: true, message: (out.stderr || out.stdout || '').trim() || 'OK' };
}

module.exports = {
  CONTAINER_NAME,
  getDockerFreeRadiusStatus,
  startDockerFreeRadius,
  stopDockerFreeRadius,
};
