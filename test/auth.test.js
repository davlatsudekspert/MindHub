'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { setup, call, db, registerTestUser, getLatestCode, registerAndVerify } = require('./_helpers');

before(setup);

test('register: to\'liq token emas, pending holat qaytaradi', async () => {
  const { reg } = await registerTestUser();
  assert.equal(reg.status, 201);
  assert.equal(reg.body.pending, true);
  assert.ok(reg.body.user_id);
  assert.ok(!reg.body.token, 'register token qaytarmasligi kerak (2 bosqichli)');
});

test('verify-email: noto\'g\'ri kod rad etiladi', async () => {
  const { reg } = await registerTestUser();
  const r = await call('POST', '/api/auth/verify-email', { user_id: reg.body.user_id, code: '000000' });
  assert.equal(r.status, 400);
  assert.ok(r.body.error);
});

test('verify-email: to\'g\'ri kod token beradi', async () => {
  const { reg } = await registerTestUser();
  const code = await getLatestCode(reg.body.user_id);
  assert.ok(code, 'kod bazadan topilishi kerak');
  const r = await call('POST', '/api/auth/verify-email', { user_id: reg.body.user_id, code });
  assert.equal(r.status, 200);
  assert.ok(r.body.token);
  assert.equal(r.body.user.email_verified, 1);
});

test('login: email tasdiqlanmagan bo\'lsa 403 + need_verification', async () => {
  const { reg, username, password } = await registerTestUser();
  const r = await call('POST', '/api/auth/login', { username, password });
  assert.equal(r.status, 403);
  assert.equal(r.body.need_verification, true);
  assert.equal(r.body.user_id, reg.body.user_id);
});

test('login: tasdiqlangandan keyin muvaffaqiyatli', async () => {
  const { username, password } = await registerAndVerify();
  const r = await call('POST', '/api/auth/login', { username, password });
  assert.equal(r.status, 200);
  assert.ok(r.body.token);
});

test('login: noto\'g\'ri parol rad etiladi', async () => {
  const { username } = await registerAndVerify();
  const r = await call('POST', '/api/auth/login', { username, password: 'notogri' });
  assert.equal(r.status, 401);
});

test('parol o\'zgartirilganda eski token bekor bo\'ladi (pass_version)', async () => {
  const auth = await registerAndVerify();
  const me1 = await call('GET', '/api/me', null, { Authorization: `Bearer ${auth.token}` });
  assert.equal(me1.status, 200);

  const chpass = await call('PUT', '/api/me/password',
    { old_pass: auth.password, new_pass: 'yangiParol456' },
    { Authorization: `Bearer ${auth.token}` });
  assert.equal(chpass.status, 200);

  const me2 = await call('GET', '/api/me', null, { Authorization: `Bearer ${auth.token}` });
  assert.equal(me2.status, 401, 'parol o\'zgargandan keyin eski token ishlamasligi kerak');

  const login2 = await call('POST', '/api/auth/login', { username: auth.username, password: 'yangiParol456' });
  assert.equal(login2.status, 200);
  assert.ok(login2.body.token);
});

test('eski hmac formatidagi parol login paytida scrypt\'ga shaffof qayta hashlanadi', async () => {
  const { Q, hmac } = require('../src/db');
  const { uid, randColor, verifyPassword, isScryptHash } = require('../src/helpers');

  const id = uid();
  const username = 'legacy' + require('crypto').randomBytes(3).toString('hex');
  const email = `${username}@example.com`;
  const plainPass = 'eskiParol123';
  await Q.uInsert(id, username, username, email, hmac(plainPass), randColor());
  await Q.uSetEmailVerified(id);

  const before = await db.get('SELECT pass FROM users WHERE id=$1', [id]);
  assert.equal(isScryptHash(before.pass), false, 'boshlang\'ich holat eski hmac formatida bo\'lishi kerak');

  const login = await call('POST', '/api/auth/login', { username, password: plainPass });
  assert.equal(login.status, 200);

  const after = await db.get('SELECT pass FROM users WHERE id=$1', [id]);
  assert.equal(isScryptHash(after.pass), true, 'login\'dan keyin scrypt formatiga o\'tishi kerak');
  assert.ok(verifyPassword(plainPass, after.pass), 'yangi hash bilan parol hali ham to\'g\'ri tekshirilishi kerak');
});

test('rate limit: /api/auth/login 15 daqiqada 10 tadan ko\'p urinishni rad etadi', async () => {
  const ip = { 'x-forwarded-for': '203.0.113.' + Math.floor(Math.random() * 255) };
  let sawTooMany = false;
  for (let i = 0; i < 12; i++) {
    const r = await call('POST', '/api/auth/login', { username: 'yoqolgan_user', password: 'x' }, ip);
    if (r.status === 429) { sawTooMany = true; break; }
  }
  assert.ok(sawTooMany, '12 urinishdan birontasi 429 qaytarishi kerak edi');
});
