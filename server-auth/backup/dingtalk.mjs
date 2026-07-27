import { createHmac } from 'node:crypto';

export function signDingtalk(timestamp, secret) {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) {
    throw new TypeError('timestamp must be a finite number');
  }
  if (typeof secret !== 'string' || secret === '') {
    throw new TypeError('secret must be a non-empty string');
  }
  return createHmac('sha256', secret).update(`${timestamp}\n${secret}`).digest('base64');
}

function buildSignedUrl(webhook, timestamp, sign) {
  const url = new URL(webhook);
  if (url.protocol !== 'https:') {
    throw new Error('DingTalk webhook must use HTTPS');
  }
  url.searchParams.set('timestamp', String(timestamp));
  url.searchParams.set('sign', sign);
  return url.toString();
}

export async function sendDingtalk({ webhook, secret, text, fetchImpl = fetch, now = Date.now } = {}) {
  if (typeof webhook !== 'string' || webhook === '') {
    throw new TypeError('webhook must be a non-empty string');
  }
  if (typeof secret !== 'string' || secret === '') {
    throw new TypeError('secret must be a non-empty string');
  }
  if (typeof text !== 'string' || text.trim() === '') {
    throw new TypeError('text must be a non-empty string');
  }
  if (typeof fetchImpl !== 'function') {
    throw new TypeError('fetchImpl must be a function');
  }
  const timestamp = typeof now === 'function' ? now() : Number(now);
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) {
    throw new TypeError('now must return a finite number');
  }
  const sign = signDingtalk(timestamp, secret);
  const signedUrl = buildSignedUrl(webhook, timestamp, sign);
  const body = JSON.stringify({ msgtype: 'text', text: { content: text } });
  const response = await fetchImpl(signedUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  if (!response || response.ok !== true) {
    const status = response?.status ?? 'unknown';
    throw new Error(`DingTalk request failed: status=${status}`);
  }
  return { status: response.status };
}
