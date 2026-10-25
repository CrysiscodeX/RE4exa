import { readFileSync } from 'node:fs';
const [pkgEntry, sqlPath] = process.argv.slice(2);
const { PGlite } = await import(pkgEntry);
const db = new PGlite();
const q = async (s, p) => (await db.query(s, p)).rows;
await db.exec(readFileSync(sqlPath, 'utf8'));
await q("select absurd.create_queue('q')");
const claimAwait = async (name) => {
  const sp = (await q("select * from absurd.spawn_task('q','inv','{}'::jsonb)"))[0];
  const c = (await q("select run_id from absurd.claim_task('q','w',60,1)"))[0];
  return (await q("select * from absurd.await_event('q',$1,$2,$3,$3,null)", [sp.task_id, c.run_id, name]))[0];
};
// 1. reproduce misfire with a reused name
await claimAwait('release:app');
await q("select absurd.emit_event('q','release:app','{\"v\":\"1.0\"}'::jsonb)");
console.log('2nd wait on reused name ->', JSON.stringify(await claimAwait('release:app')));
// 2. TTL cleanup, then re-emit of same name
await q("select set_config('absurd.fake_now', (now() + interval '40 days')::text, false)");
console.log('cleanup deleted events     ->', (await q("select absurd.cleanup_events('q', 2592000, 1000) n"))[0].n);
await q("select absurd.emit_event('q','release:app','{\"v\":\"2.0\"}'::jsonb)");
console.log('payload after TTL re-emit  ->', JSON.stringify(await q("select payload from absurd.e_q where event_name='release:app'")));
// 3. proposed: topic sequence + dedupe key + gap detection
await db.exec(`
create table absurd.topics (queue_name text, topic text, hwm bigint not null default 0, primary key (queue_name, topic));
create table absurd.topic_keys (queue_name text, topic text, dedupe_key text, seq bigint not null, primary key (queue_name, topic, dedupe_key));
create function absurd.publish(p_queue text, p_topic text, p_key text, p_payload jsonb) returns bigint language plpgsql as $f$
declare v_seq bigint;
begin
  select seq into v_seq from absurd.topic_keys where queue_name=p_queue and topic=p_topic and dedupe_key=p_key;
  if v_seq is not null then return v_seq; end if;           -- webhook redelivery: no new occurrence
  insert into absurd.topics(queue_name, topic, hwm) values (p_queue, p_topic, 1)
    on conflict (queue_name, topic) do update set hwm = absurd.topics.hwm + 1 returning hwm into v_seq;
  insert into absurd.topic_keys values (p_queue, p_topic, p_key, v_seq);
  perform absurd.emit_event(p_queue, p_topic || '#' || v_seq, jsonb_build_object('seq', v_seq, 'key', p_key, 'payload', p_payload));
  return v_seq;
end $f$;
create function absurd.topic_gap(p_queue text, p_topic text, p_seq bigint) returns boolean language sql as $f$
  select coalesce((select hwm from absurd.topics where queue_name=p_queue and topic=p_topic), 0) >= p_seq
     and not exists (select 1 from absurd.e_q where event_name = p_topic || '#' || p_seq and payload is not null)
$f$;`);
console.log('publish 1.1               ->', (await q("select absurd.publish('q','release:app','1.1','{}'::jsonb) s"))[0].s);
console.log('publish 1.1 again (dedupe)->', (await q("select absurd.publish('q','release:app','1.1','{}'::jsonb) s"))[0].s);
console.log('wait cursor+1 = #2 ->', JSON.stringify(await claimAwait('release:app#2')));
console.log('publish 1.2               ->', (await q("select absurd.publish('q','release:app','1.2','{}'::jsonb) s"))[0].s);
await q("delete from absurd.e_q where event_name='release:app#1'");
console.log('gap check #1 after delete ->', (await q("select absurd.topic_gap('q','release:app',1) g"))[0].g);
await db.close();
