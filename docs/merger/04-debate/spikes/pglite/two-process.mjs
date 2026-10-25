const [entry, dir, who, n] = process.argv.slice(2);
const { PGlite } = await import(entry);
try {
  const db = new PGlite(dir);
  await db.exec("create table if not exists t (who text, i int)");
  for (let i = 0; i < Number(n); i++) { await db.query("insert into t values ($1,$2)", [who, i]); }
  const r = await db.query("select who, count(*) c from t group by who order by who");
  console.log(who, 'sees', JSON.stringify(r.rows));
  await new Promise(r => setTimeout(r, 1500));
  await db.close();
} catch (e) { console.log(who, 'ERR', e.message); }
