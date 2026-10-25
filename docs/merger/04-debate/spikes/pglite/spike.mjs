import { readFileSync } from 'node:fs';
const [pkgEntry, sqlPath] = process.argv.slice(2);
const { PGlite } = await import(pkgEntry);
const t0 = Date.now();
const db = new PGlite();
const log = (k, v) => console.log(k.padEnd(34), typeof v === 'string' ? v : JSON.stringify(v));
const q = async (s, p) => (await db.query(s, p)).rows;
log('pg version', (await q('select version()'))[0].version);
const sql = readFileSync(sqlPath, 'utf8');
const tl = Date.now();
await db.exec(sql);
log('absurd.sql loaded ms', String(Date.now() - tl));
log('schema version', await q('select absurd.get_schema_version() v'));
log('uuidv7 builtin?', await q("select to_regprocedure('pg_catalog.uuidv7()') is not null as has"));
log('portable_uuidv7', await q('select absurd.portable_uuidv7() id'));
await q("select absurd.create_queue('q')");
await q("select set_config('absurd.fake_now', '2026-01-01T00:00:00Z', false)");
const sp = (await q("select * from absurd.spawn_task('q','t','{\"a\":1}'::jsonb, '{\"idempotency_key\":\"k1\",\"max_attempts\":3}'::jsonb)"))[0];
log('spawn', sp);
log('spawn same key', (await q("select created from absurd.spawn_task('q','t','{}'::jsonb, '{\"idempotency_key\":\"k1\"}'::jsonb)"))[0]);
const c1 = (await q("select run_id, attempt from absurd.claim_task('q','w1',30,1)"))[0];
log('claim w1', c1);
await q("select absurd.set_task_checkpoint_state('q',$1,'step1','{\"x\":1}'::jsonb,$2,30)", [sp.task_id, c1.run_id]);
// expire lease
await q("select set_config('absurd.fake_now', '2026-01-01T00:01:00Z', false)");
log('extend expired-unswept (defect)', await q("select absurd.extend_claim('q',$1,30) is null as ok", [c1.run_id]).catch(e => 'ERR ' + e.message));
await q("select set_config('absurd.fake_now', '2026-01-01T00:03:00Z', false)");
const c2 = (await q("select run_id, attempt from absurd.claim_task('q','w2',30,1)"))[0];
log('reclaim w2 after expiry', c2);
log('stale w1 checkpoint', await q("select absurd.set_task_checkpoint_state('q',$1,'step2','{}'::jsonb,$2,30)", [sp.task_id, c1.run_id]).then(() => 'accepted').catch(e => 'ERR ' + (e.code || '') + ' ' + e.message));
log('w2 sees checkpoints', await q("select checkpoint_name from absurd.get_task_checkpoint_states('q',$1,$2)", [sp.task_id, c2.run_id]));
// events
const ev = (await q("select * from absurd.await_event('q',$1,$2,'wait1','rel:1',null)", [sp.task_id, c2.run_id]))[0];
log('await_event (no emit)', ev);
await q("select absurd.emit_event('q','rel:1','{\"v\":1}'::jsonb)");
await q("select absurd.emit_event('q','rel:1','{\"v\":2}'::jsonb)");
log('event row (first wins)', await q("select payload from absurd.e_q where event_name='rel:1'"));
const c3 = (await q("select run_id, wake_event, event_payload from absurd.claim_task('q','w2',30,1)"))[0];
log('woken run', c3);
await q("select absurd.complete_run('q',$1,'{\"done\":true}'::jsonb)", [c3.run_id]);
log('task result', await q("select state, result from absurd.get_task_result('q',$1)", [sp.task_id]));
// partitioned queue + cron
log('partitioned queue', await q("select absurd.create_queue('pq','partitioned')").then(() => 'ok').catch(e => 'ERR ' + e.message));
log('partitioned spawn', await q("select created from absurd.spawn_task('pq','t','{}'::jsonb,'{\"idempotency_key\":\"z\"}'::jsonb)").catch(e => 'ERR ' + e.message));
log('enable_cron', await q("select * from absurd.enable_cron('q')").then(r => r).catch(e => 'ERR ' + e.message));
log('cleanup', await q("select * from absurd.cleanup_all_queues()").catch(e => 'ERR ' + e.message));
// persistence: dump to dir
log('total ms', String(Date.now() - t0));
await db.close();
