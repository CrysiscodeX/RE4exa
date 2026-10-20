#!/usr/bin/env bash
# Crash test: SIGKILL the worker after step 3 of 6, restart it, and check that
# the task completes, no completed REA call ran twice, and the restored REA
# ledger holds the same content-addressed Evidence IDs as an uncrashed run.
set -euo pipefail
HERE=$(cd "$(dirname "$0")/.." && pwd); cd "$HERE"
export PG_PORT=${PG_PORT:-54330}
export DATABASE_URL=$(bash scripts/pg-up.sh)
export RUN_DIR=$HERE/.run/work; mkdir -p "$RUN_DIR"
q() { psql -qtA "$DATABASE_URL" -c "$1"; }
trap 'kill $(jobs -p) 2>/dev/null || true' EXIT  # never leave a worker or spawner behind

# Plan: six cheap, deterministic REA calls on REA's own native payloads.
REA_DIR=$(node -p "require('path').dirname(require.resolve('rea-agents/package.json'))")
WIN=$REA_DIR/native/windows/build/rea-windows-x64.node
PTY=$(node -p "require('path').dirname(require.resolve('@lydell/node-pty-linux-x64/package.json', {paths:['$REA_DIR']}))")/pty.node
cat > "$RUN_DIR/plan.json" <<JSON
{"calls":[
 {"tool":"inspect_go_binary","args":{"path":"$WIN"}},
 {"tool":"inspect_rust_binary","args":{"path":"$WIN"}},
 {"tool":"inspect_pe_resources","args":{"path":"$WIN"}},
 {"tool":"inspect_electron_fuses","args":{"path":"$WIN"}},
 {"tool":"inspect_go_binary","args":{"path":"$PTY"}},
 {"tool":"inspect_rust_binary","args":{"path":"$PTY"}}
]}
JSON
STAMP=$(date +%s)

echo "# baseline: plain REA, killed"
node test/baseline-loss.mjs "$RUN_DIR/plan.json" | tee "$RUN_DIR/baseline.json"

echo "# control: no crash"
node src/worker.mjs & W=$!
CONTROL=$(node src/spawn.mjs "$RUN_DIR/plan.json" "control-$STAMP" 300); kill $W; wait $W 2>/dev/null || true
echo "$CONTROL" > "$RUN_DIR/control.json"

echo "# crash: SIGKILL after step 3"
node src/spawn.mjs "$RUN_DIR/plan.json" "crash-$STAMP" 600 > "$RUN_DIR/crash.json" & S=$!
set +e; CRASH_AFTER_STEP=3 node src/worker.mjs; CRASH_EXIT=$?; set -e
TASK=$(q "select task_id from absurd.t_rea where idempotency_key = 'rea-plan:crash-$STAMP'")
CHECKPOINTS_AT_CRASH=$(q "select count(*) from absurd.c_rea where task_id = '$TASK'")
echo "# restart worker"
node src/worker.mjs & W=$!
wait $S; kill $W; wait $W 2>/dev/null || true

node - "$RUN_DIR" "$CRASH_EXIT" "$CHECKPOINTS_AT_CRASH" "$TASK" <<'EOF'
const { readFileSync, writeFileSync } = await import("node:fs");
const { execFileSync } = await import("node:child_process");
const [dir, crashExit, checkpointsAtCrash, task] = process.argv.slice(2);
const q = (sql) => execFileSync("psql", ["-qtA", process.env.DATABASE_URL, "-c", sql], { encoding: "utf8" }).trim();
const control = JSON.parse(readFileSync(`${dir}/control.json`, "utf8"));
const crash = JSON.parse(readFileSync(`${dir}/crash.json`, "utf8"));
const baseline = JSON.parse(readFileSync(`${dir}/baseline.json`, "utf8"));
const result = {
  baseline_without_prototype: baseline,
  worker_exit_on_crash: Number(crashExit),
  checkpoints_at_crash: Number(checkpointsAtCrash),
  task_state: q(`select state || ' attempts=' || attempts from absurd.t_rea where task_id = '${task}'`),
  runs: q(`select attempt || ':' || state || ':' || coalesce(failure_reason->>'name', '-') from absurd.r_rea where task_id = '${task}' order by attempt`).split("\n"),
  checkpoints_final: Number(q(`select count(*) from absurd.c_rea where task_id = '${task}'`)),
  repeated_completed_calls: q(`select count(*) from (select step_name from rea_call_log where task_id = '${task}' and phase = 'end' group by 1 having count(*) > 1) t`),
  started_but_not_completed_before_crash: q(`select count(*) from (select step_name from rea_call_log where task_id = '${task}' and phase = 'start' group by 1 having count(*) > 1) t`),
  restore_log: q(`select phase from rea_call_log where task_id = '${task}' and step_name = '(restore)'`),
  same_evidence_ids_as_control: JSON.stringify(crash.result?.evidence_ids) === JSON.stringify(control.result?.evidence_ids),
  ledger_has_all_after_resume: crash.result?.ledger_has_all,
  evidence_ids: crash.result?.evidence_ids,
};
result.pass = result.worker_exit_on_crash === 137 && result.checkpoints_at_crash === 3 && result.task_state.startsWith("completed")
  && result.checkpoints_final === 6 && result.repeated_completed_calls === "0" && result.same_evidence_ids_as_control && result.ledger_has_all_after_resume === true
  && baseline.ledger_ids_after_restart === 0;
writeFileSync(`${dir}/crash-test-result.json`, JSON.stringify(result, null, 1));
console.log(JSON.stringify(result, null, 1));
process.exit(result.pass ? 0 : 1);
EOF
