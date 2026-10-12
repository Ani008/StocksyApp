// Runs the real SQL in services/sessionStore.js against a real Postgres.
// Skipped unless RUN_PG_TESTS=1 (the other tests need no database).
//
//   createdb stocksy_test
//   psql -d stocksy_test -f migrations/001_create_users.sql -f migrations/013_auth_sessions.sql
//   RUN_PG_TESTS=1 PG_HOST=127.0.0.1 PG_PORT=5432 PG_USER=postgres PG_PASSWORD=... \
//     PG_DATABASE=stocksy_test JWT_SECRET=x node --test --test-force-exit tests/sessionStore.pg.test.js
//
// (--test-force-exit: config/postgres.js opens a startup connection it never
//  releases, so the pool can't drain on its own.)

const test = require('node:test');
const assert = require('node:assert/strict');

const enabled = process.env.RUN_PG_TESTS === '1';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'pg-test-secret';

test('sessionStore + sessionService against real Postgres', { skip: !enabled && 'set RUN_PG_TESTS=1' }, async () => {
  const { pool } = require('../config/postgres');
  const sessions = require('../services/sessionService');

  const email = `pg-${Date.now()}@test.com`;
  const { rows } = await pool.query(
    `INSERT INTO users (full_name, username, email, password) VALUES ('P G','pg',$1,'x') RETURNING id`, [email]);
  const userId = rows[0].id;
  try {
    const s1 = await sessions.createSession({ userId, clientType: 'web', userAgent: 'test' });
    assert.ok(await sessions.findActiveSessionUser(s1.sid, userId));
    assert.equal(await sessions.findActiveSessionUser(s1.sid, '00000000-0000-4000-8000-000000000000'), null);

    const r = await sessions.rotate(s1.refreshToken);
    assert.notEqual(r.refreshToken, s1.refreshToken);
    await assert.rejects(sessions.rotate(s1.refreshToken), { code: 'RETRY' });        // inside grace
    await pool.query(`UPDATE auth_sessions SET rotated_at = NOW() - INTERVAL '1 minute' WHERE id = $1`, [s1.sid]);
    await assert.rejects(sessions.rotate(s1.refreshToken), { code: 'REUSED' });       // stolen copy
    assert.equal(await sessions.findActiveSessionUser(s1.sid, userId), null);          // whole session revoked

    const s2 = await sessions.createSession({ userId, clientType: 'native' });
    const s3 = await sessions.createSession({ userId, clientType: 'native' });
    assert.deepEqual((await sessions.activeIds([s2.sid, s3.sid])).sort(), [s2.sid, s3.sid].sort());
    const revoked = await sessions.revokeAllForUser(userId, 'password_reset');
    assert.equal(revoked.length, 2);
    assert.deepEqual(await sessions.activeIds([s2.sid, s3.sid]), []);

    // deleting the user removes their sessions (ON DELETE CASCADE)
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
    const left = await pool.query('SELECT 1 FROM auth_sessions WHERE user_id = $1', [userId]);
    assert.equal(left.rowCount, 0);
  } finally {
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
  }
});
