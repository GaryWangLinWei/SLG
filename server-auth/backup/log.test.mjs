import test from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { createRedactor, serializeError, writeLog } from './log.mjs';
test('redact recursively redacts strings Error message stack and objects', () => { const redact=createRedactor(['token-123','secret-456']); const v=redact({text:'use token-123',nested:['secret-456'],error:new Error('token-123 failed')}); assert.equal(v.text,'use [REDACTED]'); assert.deepEqual(v.nested,['[REDACTED]']); assert.doesNotMatch(v.error.message,/token-123/); assert.doesNotMatch(v.error.stack,/token-123/); });
test('redact serializeError redacts message stack and object properties', () => { const redact=createRedactor(['password']); const e=new Error('bad password'); e.details={credential:'password'}; const v=serializeError(e,redact); assert.doesNotMatch(v.message,/password/); assert.doesNotMatch(v.stack,/password/); assert.equal(v.details.credential,'[REDACTED]'); });
test('log writes one valid JSON line with required event fields', () => { let output=''; const stream=new Writable({write(chunk,_enc,cb){output+=chunk;cb();}}); writeLog(stream,{runId:'run-1',stage:'config',status:'ok',detail:'token-123'},createRedactor(['token-123'])); assert.equal(output.split('\n').length,2); const event=JSON.parse(output.trim()); assert.equal(event.runId,'run-1'); assert.equal(event.stage,'config'); assert.equal(event.status,'ok'); assert.equal(event.detail,'[REDACTED]'); assert.match(event.timestamp,/^\d{4}-\d{2}-\d{2}T/); });

test('redact hides Buffer secrets in equivalent encodings and all binary values', () => {
  const key=Buffer.from('encryption-key-material'); const database=Buffer.from([0x53,0x51,0x4c,0x69,0x74,0x65]); const redact=createRedactor([key]);
  const value=redact({utf8:`key=${key.toString('utf8')}`,base64:key.toString('base64'),hex:key.toString('hex'),key,database,arrayBuffer:database.buffer.slice(database.byteOffset,database.byteOffset+database.byteLength),typed:new Uint8Array(database),error:Object.assign(new Error('backup failed'),{payload:database})});
  const output=JSON.stringify(value);
  for (const leaked of [key.toString('utf8'),key.toString('base64'),key.toString('hex'),database.toString('hex')]) assert.doesNotMatch(output,new RegExp(leaked));
  assert.equal(value.key,'[BINARY REDACTED]'); assert.equal(value.database,'[BINARY REDACTED]'); assert.equal(value.arrayBuffer,'[BINARY REDACTED]'); assert.equal(value.typed,'[BINARY REDACTED]'); assert.equal(value.error.payload,'[BINARY REDACTED]');
});
test('log rejects missing or blank required event fields without writing', () => {
  for (const field of ['runId','stage','status']) for (const invalid of [undefined,'','   ']) {
    let output=''; const stream=new Writable({write(chunk,_enc,cb){output+=chunk;cb();}}); const event={runId:'run-1',stage:'config',status:'ok',[field]:invalid};
    assert.throws(() => writeLog(stream,event,createRedactor([])),new RegExp(field)); assert.equal(output,'');
  }
});
