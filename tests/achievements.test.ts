import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import request from 'supertest';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  'postgres://pocket:pocket-local-only@127.0.0.1:55432/pocket_test';
if (!new URL(process.env.DATABASE_URL).pathname.endsWith('_test'))
  throw new Error('Tests require a database whose name ends in _test.');
process.env.NODE_ENV = 'test';
process.env.AI_MONTHLY_CHARACTERS = '1000';
process.env.AI_GROUP_MONTHLY_CHARACTERS = '1000';
process.env.ELEVENLABS_API_KEY = 'test-key-never-sent';
process.env.DATA_DIR = '.private/test-data-achievements';
const { db } = await import('../server/db.js');
const { createApp } = await import('../server/app.js');
globalThis.fetch = async (input) => {
  const url = String(input);
  assert.equal(
    url,
    'https://api.elevenlabs.io/v1/voices',
    'Tests must never call a billable service',
  );
  return new Response(
    JSON.stringify({ voices: [{ voice_id: 'test-voice', name: 'Test voice' }] }),
    { headers: { 'Content-Type': 'application/json' } },
  );
};
const app = createApp(async (req, res, next) => {
  const uid = req.header('x-test-uid');
  if (!uid) {
    res.status(401).json({ error: 'Please sign in.' });
    return;
  }
  req.identity = { uid, email: uid + '@example.invalid', name: uid, authTime: Date.now() / 1000 };
  next();
});
const as = (uid: string) => ({
  get: (url: string) =>
    request(app)
      .get('/pocket-partner/api' + url)
      .set('x-test-uid', uid),
  post: (url: string) =>
    request(app)
      .post('/pocket-partner/api' + url)
      .set('x-test-uid', uid),
});
const suffix = randomUUID();
const a = 'ach-owner-' + suffix,
  b = 'ach-outsider-' + suffix;
let groupId: string, sceneId: string, lineIds: string[] = [];
before(async () => {
  await db.query(await readFile(new URL('../server/schema.sql', import.meta.url), 'utf8'));
  for (const uid of [a, b])
    await db.query('INSERT INTO app_users(uid,email,name) VALUES($1,$2,$1)', [
      uid,
      uid + '@example.invalid',
    ]);
  const group = await as(a).post('/groups').send({ name: 'Achievements cast' }).expect(201);
  groupId = group.body.id;
  const script = await as(a)
    .post('/groups/' + groupId + '/scripts')
    .send({
      title: 'Achievements test',
      kind: 'scene',
      scenes: [
        {
          title: 'Scene',
          lines: [
            { speaker: 'A', text: 'Line one.' },
            { speaker: 'A', text: 'Line two.' },
          ],
        },
      ],
    })
    .expect(201);
  const detail = await as(a)
    .get('/scripts/' + script.body.id)
    .expect(200);
  sceneId = detail.body.scenes[0].id;
  const scene = await as(a)
    .get('/scenes/' + sceneId)
    .expect(200);
  lineIds = scene.body.lines.map((l: any) => l.id);
});
after(async () => {
  await db.query('DELETE FROM groups WHERE owner_uid=ANY($1::text[])', [[a, b]]);
  await db.query('DELETE FROM app_users WHERE uid=ANY($1::text[])', [[a, b]]);
  await db.query('DELETE FROM user_stats WHERE uid=ANY($1::text[])', [[a, b]]);
  await db.query('DELETE FROM budgets WHERE period=$1', [new Date().toISOString().slice(0, 7)]);
  await db.end();
});
test('Hint-free rate reflects attempt and hint events for the signed-in user only', async () => {
  await as(a)
    .post('/practice')
    .send({ eventId: randomUUID(), lineId: lineIds[0], kind: 'attempt' })
    .expect(200);
  await as(a)
    .post('/practice')
    .send({ eventId: randomUUID(), lineId: lineIds[0], kind: 'attempt' })
    .expect(200);
  await as(a)
    .post('/practice')
    .send({ eventId: randomUUID(), lineId: lineIds[0], kind: 'hint' })
    .expect(200);
  const stats = await as(a).get('/me/stats').expect(200);
  assert.equal(stats.body.hintFreeRate, 0.5);
  const outsider = await as(b).get('/me/stats').expect(200);
  assert.equal(outsider.body.hintFreeRate, null);
});
test('Scene completion is idempotent and requires group membership', async () => {
  const eventId = randomUUID();
  await as(a)
    .post('/scenes/' + sceneId + '/complete')
    .send({ eventId })
    .expect(200);
  await as(a)
    .post('/scenes/' + sceneId + '/complete')
    .send({ eventId })
    .expect(200);
  const stats = await as(a).get('/me/stats').expect(200);
  assert.equal(stats.body.plays, 1);
  await as(b)
    .post('/scenes/' + sceneId + '/complete')
    .send({ eventId: randomUUID() })
    .expect(404);
  const outsider = await as(b).get('/me/stats').expect(200);
  assert.equal(outsider.body.plays, 0);
});
test('Recording a line increments the recordings counter', async () => {
  const { recordLineRecording } = await import('../server/achievements.js');
  const before = (await as(a).get('/me/stats').expect(200)).body.recordings;
  await recordLineRecording(a);
  const after = (await as(a).get('/me/stats').expect(200)).body.recordings;
  assert.equal(after, before + 1);
});
test('AI lines counter increments only when the generation is actually applied', async () => {
  const { enqueueGeneration, finishGeneration } = await import('../server/generation.js');
  const { saveFile } = await import('../server/storage.js');
  await db.query(
    'UPDATE characters SET voice_id=$1 WHERE script_id=(SELECT script_id FROM scenes WHERE id=$2)',
    ['test-voice', sceneId],
  );
  const before = (await as(a).get('/me/stats').expect(200)).body.aiLines;
  const result = await enqueueGeneration(a, sceneId, [lineIds[1]], false);
  assert.equal(result.queued, 1);
  const job = (
    await db.query('SELECT * FROM jobs WHERE line_id=$1 ORDER BY created_at DESC LIMIT 1', [
      lineIds[1],
    ])
  ).rows[0];
  const fileId = await saveFile(groupId, Buffer.from('generated audio'), 'audio/mpeg', 'ai.mp3');
  assert.equal(await finishGeneration(job, fileId), true);
  const applied = (await as(a).get('/me/stats').expect(200)).body.aiLines;
  assert.equal(applied, before + 1);
  // A superseded result (line changed since the job was created) must not be credited.
  const stale = { ...job, payload: { ...job.payload, revision: job.payload.revision + 1 } };
  const staleFile = await saveFile(groupId, Buffer.from('stale audio'), 'audio/mpeg', 'stale.mp3');
  assert.equal(await finishGeneration(stale, staleFile), false);
  const unchanged = (await as(a).get('/me/stats').expect(200)).body.aiLines;
  assert.equal(unchanged, applied);
});
test('Count badges flip exactly at their threshold; rate badges respect the minimum sample size', async () => {
  const stats = (await as(a).get('/me/stats').expect(200)).body;
  const plays1 = stats.badges.find((b: any) => b.id === 'plays-1');
  assert.equal(plays1.achieved, true);
  const plays10 = stats.badges.find((b: any) => b.id === 'plays-10');
  assert.equal(plays10.achieved, false);
  const hintBadge = stats.badges.find((b: any) => b.id === 'hintFreeRate-50');
  assert.equal(hintBadge.achieved, false);
  assert.equal(hintBadge.progressText, '2 of 10 attempts logged');
});
