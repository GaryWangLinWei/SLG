const D = require('better-sqlite3');
const d = new D('auth.db');
const rows = d.prepare("SELECT db.device_fingerprint, db.bound_at, db.last_heartbeat_at, ac.code, ac.expires_at FROM device_bindings db JOIN activation_codes ac ON db.activation_code_id=ac.id WHERE ac.status='used' ORDER BY db.last_heartbeat_at DESC").all();
rows.forEach(r => console.log(r.device_fingerprint.slice(0,16)+' | '+r.code+' | bound:'+new Date(r.bound_at).toLocaleDateString('zh-CN')+' | hb:'+new Date(r.last_heartbeat_at).toLocaleDateString('zh-CN')+' | exp:'+new Date(r.expires_at).toLocaleDateString('zh-CN')));
console.log('Total bindings:', rows.length);
d.close();
