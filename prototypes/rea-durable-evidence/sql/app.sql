-- Tables owned by the prototype (Absurd owns schema "absurd").
create table if not exists rea_evidence (
  evidence_id    text primary key,          -- REA's content address: ev_<sha256>
  task_id        uuid not null,
  step_name      text not null,
  tool           text not null,
  args_canonical text not null,
  record_text    text not null,             -- exact Evidence JSON; text, since jsonb rejects \u0000
  created_at     timestamptz not null default now()
);
create table if not exists rea_bundle (     -- latest REA ledger snapshot per task, written before each checkpoint
  task_id     uuid primary key,
  step_name   text not null,
  bundle_text text not null,
  updated_at  timestamptz not null default now()
);
create table if not exists rea_call_log (   -- one row per step start/end, to prove no completed call repeats
  id        bigserial primary key,
  task_id   uuid not null,
  step_name text not null,
  phase     text not null,
  pid       int not null,
  rea_pid   int,
  at        timestamptz not null default now()
);
