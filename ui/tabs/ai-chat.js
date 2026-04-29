import { q } from '../lib/helpers.js';

let _history = [];
let _abort = null;
let _streaming = false;

const QUICK = {
  status:    'Fasse den aktuellen Netzwerk-Status zusammen. Welche Geräte sind online/offline? Gibt es Auffälligkeiten?',
  problems:  'Analysiere das Netzwerk auf Probleme. Prüfe offline-Geräte, aktuelle Traps, Loops und andere Auffälligkeiten. Gib konkrete Handlungsempfehlungen.',
  traps:     'Werte die letzten SNMP-Traps aus. Was bedeuten sie? Gibt es Muster oder Häufungen?',
  recommend: 'Gib Empfehlungen zur Verbesserung des Netzwerks. Berücksichtige Sicherheit, Redundanz, Performance und Best Practices für LANCOM-Geräte.',
};

// ── Send ─────────────────────────────────────────────────────────────────────

export function aiSend(text) {
  if (_streaming) return;
  const input = q('ai-input');
  const msg = text || input?.value?.trim();
  if (!msg) return;
  if (input) input.value = '';
  _history.push({ role: 'user', content: msg });
  render();
  streamResponse();
}

export function aiQuick(type) { aiSend(QUICK[type] || type); }

export function aiClear() {
  if (_abort) { _abort.abort(); _abort = null; }
  _history = [];
  _streaming = false;
  render();
}

export function aiStop() {
  if (_abort) { _abort.abort(); _abort = null; }
  _streaming = false;
  updateSendBtn();
}

// ── Streaming ────────────────────────────────────────────────────────────────

async function streamResponse() {
  _abort = new AbortController();
  _streaming = true;
  updateSendBtn();

  _history.push({ role: 'assistant', content: '' });
  const idx = _history.length - 1;
  render();

  try {
    const resp = await fetch('/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: _history.filter(m => m.content && !m.error).map(m => ({ role: m.role, content: m.content })) }),
      signal: _abort.signal,
    });

    if (resp.headers.get('content-type')?.includes('application/json')) {
      const err = await resp.json();
      _history[idx].content = err.error || 'Unbekannter Fehler';
      _history[idx].error = true;
      render(); _streaming = false; updateSendBtn();
      return;
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();

      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith('data: ')) continue;
        const data = t.slice(6);
        if (data === '[DONE]') break;
        try {
          const j = JSON.parse(data);
          if (j.content) _history[idx].content += j.content;
          if (j.error)   { _history[idx].content += j.error; _history[idx].error = true; }
        } catch {}
      }
      renderLastMsg(idx);
    }
  } catch (e) {
    if (e.name !== 'AbortError') {
      _history[idx].content += `\n\nFehler: ${e.message}`;
      _history[idx].error = true;
    }
  }

  _streaming = false;
  _abort = null;
  updateSendBtn();
  render();
}

// ── Render ───────────────────────────────────────────────────────────────────

function updateSendBtn() {
  const btn = q('ai-send-btn');
  if (!btn) return;
  btn.textContent = _streaming ? 'Stopp' : 'Senden';
  btn.onclick = _streaming ? aiStop : () => aiSend();
}

function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function fmtMd(raw) {
  if (!raw) return '<span class="ai-dots">●●●</span>';
  let html = esc(raw);
  // code blocks
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
  html = html.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
  // inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  // bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // italic
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  // headers
  html = html.replace(/^### (.+)$/gm, '<strong style="font-size:14px">$1</strong>');
  html = html.replace(/^## (.+)$/gm, '<strong style="font-size:15px">$1</strong>');
  // list items
  html = html.replace(/^[-*] (.+)$/gm, '<span style="display:block;padding-left:12px">• $1</span>');
  // numbered list
  html = html.replace(/^(\d+)\. (.+)$/gm, '<span style="display:block;padding-left:12px">$1. $2</span>');
  // newlines (but not inside <pre>)
  html = html.replace(/\n/g, '<br>');
  // fix double br inside pre
  html = html.replace(/<pre><code>([\s\S]*?)<\/code><\/pre>/g, (_, code) =>
    `<pre><code>${code.replace(/<br>/g, '\n')}</code></pre>`
  );
  return html;
}

function renderLastMsg(idx) {
  const box = q('ai-messages');
  if (!box) return;
  const el = box.querySelector(`[data-idx="${idx}"] .ai-content`);
  if (el) {
    el.innerHTML = fmtMd(_history[idx].content);
    box.scrollTop = box.scrollHeight;
  }
}

function render() {
  const box = q('ai-messages');
  if (!box) return;

  if (!_history.length) {
    box.innerHTML = `
      <div class="ai-welcome">
        <div style="font-size:28px;margin-bottom:8px">🔍</div>
        <div style="font-size:15px;font-weight:600;margin-bottom:6px">KI-Netzwerk-Assistent</div>
        <div style="font-size:12px;color:var(--text3);max-width:400px;line-height:1.5">
          Ich kenne dein Netzwerk – Geräte, Status, Traps und Alerts.
          Stelle mir eine Frage oder nutze die Schnellaktionen oben.
        </div>
      </div>`;
    return;
  }

  box.innerHTML = _history.map((m, i) => {
    if (m.role === 'user') {
      return `<div class="ai-row ai-row-user"><div class="ai-bubble ai-bubble-user">${esc(m.content)}</div></div>`;
    }
    const cls = m.error ? ' ai-error' : '';
    return `<div class="ai-row ai-row-ai" data-idx="${i}"><div class="ai-bubble ai-bubble-ai${cls}"><div class="ai-content">${fmtMd(m.content)}</div></div></div>`;
  }).join('');

  box.scrollTop = box.scrollHeight;
}

export function aiInputKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (_streaming) return;
    aiSend();
  }
}
