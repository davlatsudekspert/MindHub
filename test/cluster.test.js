'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { setup, db, uniqueSuffix } = require('./_helpers');

before(setup);

test('cosineSim: bir xil vektorlar uchun 1, ortogonal vektorlar uchun 0', () => {
  const { cosineSim } = require('../src/ai/cluster');
  assert.ok(Math.abs(cosineSim([1, 0, 0], [1, 0, 0]) - 1) < 1e-9);
  assert.ok(Math.abs(cosineSim([1, 0, 0], [0, 1, 0])) < 1e-9);
  assert.equal(cosineSim([0, 0, 0], [1, 1, 1]), 0, 'nol vektor uchun 0 qaytarishi kerak (bo\'linishga urinmasdan)');
});

test('processEmbedJob: o\'xshash matnlar bitta klasterga guruhlanadi', async () => {
  const provider = require('../src/ai/provider');
  const cluster = require('../src/ai/cluster');
  const { Q, uid } = requireQAndUid();

  const origEmbed = provider.embed;
  provider.embed = async (texts) => texts.map(t => (/internet/i.test(t) ? [1, 0, 0] : [0, 0, 1]));

  try {
    const sysUser = await Q.uById('u_system');
    const com = await Q.comById('c_tech');
    assert.ok(sysUser && com, 'seed ma\'lumotlari (u_system, c_tech) mavjud bo\'lishi kerak');

    const titles = ['Internet sekin ' + uniqueSuffix(), 'Internet uziladi ' + uniqueSuffix(), 'Internet tez emas ' + uniqueSuffix()];
    const postIds = [];
    for (const title of titles) {
      const pid = uid();
      await Q.pInsert(pid, sysUser.id, com.id, title, 'test', null, null, null, null, 'text', null, 'problem');
      postIds.push(pid);
    }

    let lastClusterId = null;
    for (const pid of postIds) {
      lastClusterId = await cluster.processEmbedJob(pid);
      assert.ok(lastClusterId, 'har bir embed job klaster id qaytarishi kerak');
    }

    const cl = await Q.clById(lastClusterId);
    assert.equal(cl.member_count, 3, '3 ta o\'xshash post bitta klasterga guruhlanishi kerak');
  } finally {
    provider.embed = origEmbed;
  }
});

test('processEmbedJob: faqat problem/idea postlari klasterlanadi', async () => {
  const provider = require('../src/ai/provider');
  const cluster = require('../src/ai/cluster');
  const { Q, uid } = requireQAndUid();

  const origEmbed = provider.embed;
  let called = false;
  provider.embed = async (texts) => { called = true; return texts.map(() => [1, 0, 0]); };

  try {
    const sysUser = await Q.uById('u_system');
    const com = await Q.comById('c_tech');
    const pid = uid();
    await Q.pInsert(pid, sysUser.id, com.id, 'Oddiy post ' + uniqueSuffix(), 'body', null, null, null, null, 'text', null, 'post');

    const result = await cluster.processEmbedJob(pid);
    assert.equal(result, null, 'kind=post uchun klasterlash ishlamasligi kerak');
    assert.equal(called, false, 'embed umuman chaqirilmasligi kerak');
  } finally {
    provider.embed = origEmbed;
  }
});

test('Q.comCanManage: egasi va admin uchun true, boshqalar uchun false', async () => {
  const { Q, uid } = requireQAndUid();
  const { randColor } = require('../src/helpers');
  const { hmac } = require('../src/db');

  const ownerId = uid();
  const strangerId = uid();
  await Q.uInsert(ownerId, 'owner' + uniqueSuffix(), 'Owner', `owner${uniqueSuffix()}@example.com`, hmac('x'), randColor());
  await Q.uInsert(strangerId, 'stranger' + uniqueSuffix(), 'Stranger', `stranger${uniqueSuffix()}@example.com`, hmac('x'), randColor());

  const comId = uid();
  const slug = 'testcom' + uniqueSuffix();
  await Q.comInsert(comId, slug, 'Test Community', '', '#C8922A', ownerId, 0);

  assert.equal(await Q.comCanManage(ownerId, comId), true);
  assert.equal(await Q.comCanManage(strangerId, comId), false);
});

function requireQAndUid() {
  const { Q } = require('../src/db');
  const { uid } = require('../src/helpers');
  return { Q, uid };
}
