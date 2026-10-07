// Explicit local-disposable runner only. Never reads .env or a Production URL.
// Import runConcurrencyTests with a node-postgres Client and a local config.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export async function runConcurrencyTests({ Client, config }) {
  assert.ok(['127.0.0.1', '::1', 'localhost'].includes(config.host), 'Local host required');
  assert.equal(config.database, 'askio_vote_management_disposable');
  const owner = new Client(config);
  const first = new Client(config);
  const second = new Client(config);
  const prefix = `vote_management_race_${randomUUID()}`;
  const accounts = [randomUUID(), randomUUID()];
  const guest = 'd'.repeat(64);
  let caseCount = 0;
  try {
    await Promise.all([owner.connect(), first.connect(), second.connect()]);
    const { rows: [guard] } = await owner.query(`select current_database() as db, host(inet_server_addr()) as host`);
    assert.equal(guard.db, config.database);
    assert.ok(['127.0.0.1', '::1'].includes(guard.host));
    await owner.query(`insert into auth.users(id,aud,role,email,is_anonymous) values ($1::uuid,'authenticated','authenticated',$1::uuid::text || '@example.invalid',false),($2::uuid,'authenticated','authenticated',$2::uuid::text || '@example.invalid',false)`, accounts);
    for (const connection of [first, second]) {
      await connection.query("set statement_timeout='10s'; set lock_timeout='8s'; set role service_role");
    }
    const secondPid = (await second.query('select pg_backend_pid() as pid')).rows[0].pid;

    async function fixture(suffix, conflict = false) {
      const id = `${prefix}_${suffix}`;
      await owner.query(`insert into public.polls(id,title,category,options,votes,participants) values ($1,'Disposable concurrent vote fixture','커뮤니티','["A","B"]','[0,0]',0)`, [id]);
      await first.query('select * from public.cast_guest_poll_vote($1,0,$2)', [id,guest]);
      if (conflict) {
        await first.query('select * from public.claim_authenticated_poll_vote($1,null,$2,$3)', [id,accounts[0],guest]);
        await first.query('select * from public.cast_authenticated_poll_vote($1,1,$2,null)', [id,accounts[1]]);
      }
      const { rows: [vote] } = await owner.query(`select id from public.poll_votes where poll_id=$1 and ${conflict?'user_id=$2':'guest_id_hash=$2'}`, [id,conflict?accounts[1]:guest]);
      return { id, voteId:vote.id, user:conflict?accounts[1]:null };
    }
    async function race(f, a, b) {
      const invoke = (connection, method) => method==='cancel'
        ? connection.query('select * from public.cancel_managed_poll_vote($1,$2,$3,$4)', [f.id,f.user,guest,f.voteId])
        : connection.query('select * from public.change_managed_poll_vote($1,1,$2,$3,$4)', [f.id,f.user,guest,f.voteId]);
      await first.query('begin');
      const resultA = await invoke(first,a);
      const waiting = invoke(second,b).then(result=>({result}),error=>({error}));
      // Prove the second connection is really blocked by the first poll lock,
      // rather than merely executing two operations sequentially.
      const deadline = Date.now()+3000;
      let blocked = false;
      while(Date.now()<deadline) {
        const { rows: [state] } = await owner.query('select wait_event_type from pg_stat_activity where pid=$1', [secondPid]);
        if(state?.wait_event_type==='Lock') { blocked=true; break; }
        await new Promise(resolve=>setTimeout(resolve,20));
      }
      await first.query('commit');
      const resultB = await waiting;
      assert.equal(blocked,true,'Second connection must wait on a real row lock');
      assert.equal(resultA.rows.length,1);
      return resultB;
    }
    for(let round=0;round<5;round++) {
      for(const [a,b,conflict] of [
        ['cancel','cancel',false], ['cancel','cancel',true],
        ['cancel','change',false], ['change','cancel',false],
      ]) {
        const f = await fixture(`${round}_${a}_${b}_${conflict}`,conflict);
        const outcome = await race(f,a,b);
        if(a==='cancel') {
          assert.equal(outcome.error?.code,'P0001');
          assert.equal(outcome.error?.message,'VOTE_MANAGEMENT_CONFLICT');
        } else assert.equal(outcome.error,undefined);
        const { rows: [poll] } = await owner.query('select votes,participants from public.polls where id=$1',[f.id]);
        assert.deepEqual(poll.votes,conflict?[1,0]:[0,0]);
        assert.equal(poll.participants,conflict?1:0);
        const { rows: remaining } = await owner.query('select user_id,guest_id_hash,option_index from public.poll_votes where poll_id=$1',[f.id]);
        assert.equal(remaining.length,conflict?1:0);
        if(conflict) {
          assert.equal(remaining[0].user_id,accounts[0]);
          assert.equal(remaining[0].guest_id_hash,guest);
          assert.equal(remaining[0].option_index,0);
        }
        caseCount++;
      }
    }
    console.log(`PASS ${caseCount} real two-connection cancel/cancel and cancel/change lock races`);
  } finally {
    await first.query('rollback').catch(()=>{});
    await second.query('rollback').catch(()=>{});
    // Exact fixtures only; no broad table cleanup and no production credentials.
    await owner.query('delete from public.polls where id like $1',[`${prefix}%`]).catch(()=>{});
    await owner.query('delete from auth.users where id=any($1::uuid[])',[accounts]).catch(()=>{});
    await Promise.all([first.end(),second.end(),owner.end()]);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const urlArg = args.find(arg => arg.startsWith('--local-disposable-url='));
  const moduleArg = args.find(arg => arg.startsWith('--pg-module='));
  assert.ok(urlArg && moduleArg && args.length === 2,
    'Explicit --local-disposable-url and --pg-module are required; no env is loaded.');
  const url = new URL(urlArg.slice('--local-disposable-url='.length));
  assert.ok(['postgresql:', 'postgres:'].includes(url.protocol));
  assert.ok(['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname));
  assert.equal(url.pathname, '/askio_vote_management_disposable');
  assert.equal(url.search, '', 'URL connection overrides are not accepted');
  const driver = await import(pathToFileURL(moduleArg.slice('--pg-module='.length)).href);
  await runConcurrencyTests({ Client:(driver.default ?? driver).Client, config:{
    host:url.hostname === '[::1]' ? '::1' : url.hostname,
    port:Number(url.port || 5432), database:url.pathname.slice(1),
    user:decodeURIComponent(url.username), password:decodeURIComponent(url.password),
  } });
}
