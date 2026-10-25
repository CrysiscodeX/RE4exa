import { readFileSync } from 'node:fs';
const [pkgEntry, sqlPath] = process.argv.slice(2);
const { PGlite } = await import(pkgEntry);
let sql = readFileSync(sqlPath, 'utf8');
// 1. fence helper
const fence = `
create function absurd.assert_lease (p_queue_name text, p_run_id uuid)
  returns void language plpgsql as $f$
declare v_state text; v_exp timestamptz; v_task_state text;
begin
  execute format('select r.state, r.claim_expires_at, t.state from absurd.%I r join absurd.%I t on t.task_id = r.task_id where r.run_id = $1 for update of r',
    'r_' || p_queue_name, 't_' || p_queue_name) into v_state, v_exp, v_task_state using p_run_id;
  if v_state is null then raise exception 'Run "%" not found in queue "%"', p_run_id, p_queue_name; end if;
  if v_task_state = 'cancelled' or v_state = 'cancelled' then raise exception sqlstate 'AB001' using message = 'Task has been cancelled'; end if;
  if v_state = 'failed' then raise exception sqlstate 'AB002' using message = 'Run has already failed'; end if;
  if v_state <> 'running' then raise exception 'Run "%" is not currently running', p_run_id; end if;
  if v_exp is null or v_exp <= absurd.current_time() then
    raise exception sqlstate 'AB004' using message = format('Lease on run %s expired at %s', p_run_id, v_exp);
  end if;
end $f$;
`;
sql = sql.replace('create function absurd.complete_run (', fence + '\ncreate function absurd.complete_run (');
// 2. inject the fence at the top of worker-side writers
const inject = (fn, arg) => {
  const start = sql.indexOf(`create function absurd.${fn} (`);
  const b = sql.indexOf('\nbegin\n', start);
  sql = sql.slice(0, b) + `\nbegin\n  perform absurd.assert_lease(p_queue_name, ${arg});\n` + sql.slice(b + 7);
};
inject('complete_run', 'p_run_id'); inject('schedule_run', 'p_run_id');
inject('extend_claim', 'p_run_id'); inject('set_task_checkpoint_state', 'p_owner_run');
inject('await_event', 'p_run_id');
// 3. reject non-positive lease
sql = sql.replace('  if v_claim_timeout > 0 then', "  if v_claim_timeout <= 0 then\n    raise exception sqlstate 'AB005' using message = 'claim_timeout must be > 0';\n  end if;\n  if v_claim_timeout > 0 then");
const db = new PGlite();
const q = async (s, p) => (await db.query(s, p)).rows;
const tryq = (label, s, p) => q(s, p).then(() => console.log(label.padEnd(40), 'accepted')).catch(e => console.log(label.padEnd(40), 'ERR', e.code, e.message));
await db.exec(sql);
await q("select absurd.create_queue('q')");
await q("select set_config('absurd.fake_now', '2026-01-01T00:00:00Z', false)");
const sp = (await q("select * from absurd.spawn_task('q','t','{}'::jsonb)"))[0];
await tryq('claim with timeout 0', "select * from absurd.claim_task('q','w0',0,1)");
const c1 = (await q("select run_id from absurd.claim_task('q','w1',30,1)"))[0];
await tryq('in-lease checkpoint', "select absurd.set_task_checkpoint_state('q',$1,'s1','{}'::jsonb,$2,30)", [sp.task_id, c1.run_id]);
await q("select set_config('absurd.fake_now', '2026-01-01T00:00:50Z', false)");
await tryq('in-lease checkpoint (extended to :60)', "select absurd.set_task_checkpoint_state('q',$1,'s2','{}'::jsonb,$2,30)", [sp.task_id, c1.run_id]);
await q("select set_config('absurd.fake_now', '2026-01-01T00:02:00Z', false)");
await tryq('expired-unswept extend_claim', "select absurd.extend_claim('q',$1,30)", [c1.run_id]);
await tryq('expired-unswept checkpoint', "select absurd.set_task_checkpoint_state('q',$1,'s3','{}'::jsonb,$2,30)", [sp.task_id, c1.run_id]);
await tryq('expired-unswept complete_run', "select absurd.complete_run('q',$1,'{}'::jsonb)", [c1.run_id]);
await tryq('expired-unswept await_event', "select * from absurd.await_event('q',$1,$2,'w','e',null)", [sp.task_id, c1.run_id]);
const c2 = (await q("select run_id, attempt from absurd.claim_task('q','w2',30,1)"))[0];
console.log('reclaim'.padEnd(40), JSON.stringify(c2));
console.log('checkpoints seen by attempt 2'.padEnd(40), JSON.stringify(await q("select checkpoint_name from absurd.get_task_checkpoint_states('q',$1,$2)", [sp.task_id, c2.run_id])));
await tryq('new holder complete_run', "select absurd.complete_run('q',$1,'{}'::jsonb)", [c2.run_id]);
await db.close();
