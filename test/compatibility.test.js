import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePublish } from '../src/evaluate.js';

const v1Schema = {
  type: 'record',
  fields: [
    { name: 'id', type: 'string', required: true },
    { name: 'email', type: 'string', required: false },
    { name: 'legacy_flag', type: 'string', required: false },
  ],
};

const v2Schema = {
  type: 'record',
  fields: [
    { name: 'id', type: 'string', required: true },
    { name: 'email', type: 'string', required: false },
    { name: 'legacy_flag', type: 'string', required: false },
    { name: 'nickname', type: 'string', required: false },
  ],
};

// 删除 legacy_flag 的候选版本
const v3DropFlag = {
  type: 'record',
  fields: [
    { name: 'id', type: 'string', required: true },
    { name: 'email', type: 'string', required: false },
    { name: 'nickname', type: 'string', required: false },
  ],
};

function baseInput(overrides = {}) {
  return {
    subject: 'user-events',
    schemas: [
      { version: 1, schema: v1Schema },
      { version: 2, schema: v2Schema },
    ],
    compatibilityMode: 'FORWARD',
    producerVersion: 2,
    candidate: { version: 3, schema: v3DropFlag },
    requiredFields: ['id'],
    consumers: [],
    ...overrides,
  };
}

test('forward 冲突：删除字段且消费者未完成升级时被阻塞', () => {
  const result = evaluatePublish(baseInput({
    consumers: [
      { id: 'consumer-a', version: 2, rolloutStatus: 'pending' },
    ],
  }));
  assert.equal(result.publishable, false);
  assert.equal(result.publishableSchema, null);
  assert.ok(result.violations.some((v) => v.type === 'FIELD_REMOVED' && v.field === 'legacy_flag'));
  assert.ok(result.violations.some((v) => v.type === 'ROLLOUT_INCOMPLETE'));
  assert.deepEqual(result.blockingConsumers.map((c) => c.id), ['consumer-a']);
  assert.equal(result.rollbackVersion, 2);
});

test('backward 冲突：新增必填字段不兼容', () => {
  const candidate = {
    version: 3,
    schema: {
      type: 'record',
      fields: [
        ...v2Schema.fields,
        { name: 'tenant_id', type: 'string', required: true },
      ],
    },
  };
  const result = evaluatePublish(baseInput({ compatibilityMode: 'BACKWARD', candidate }));
  assert.equal(result.publishable, false);
  assert.ok(result.violations.some((v) => v.type === 'REQUIRED_FIELD_ADDED' && v.field === 'tenant_id'));
});

test('兼容性基准是生产者实际版本而非最新注册版本', () => {
  // 注册中心已有 v3（删除了 legacy_flag），但生产者仍在 v2。
  // 候选 v4 相对 v3 兼容（仅加可选字段），但相对生产者实际版本 v2 删除了 legacy_flag —— 必须被阻塞。
  const v3Registered = {
    type: 'record',
    fields: v2Schema.fields.filter((f) => f.name !== 'legacy_flag'),
  };
  const candidate = {
    version: 4,
    schema: {
      type: 'record',
      fields: [...v3Registered.fields, { name: 'extra', type: 'string', required: false }],
    },
  };
  const result = evaluatePublish(baseInput({
    schemas: [
      { version: 1, schema: v1Schema },
      { version: 2, schema: v2Schema },
      { version: 3, schema: v3Registered },
    ],
    candidate,
    consumers: [{ id: 'consumer-a', version: 2, rolloutStatus: 'complete' }],
  }));
  assert.equal(result.referenceVersion, 2);
  assert.equal(result.publishable, false);
  assert.ok(result.violations.some((v) => v.type === 'FIELD_REMOVED' && v.field === 'legacy_flag'));
});

test('部分 rollout：已完成消费者不阻塞，未完成消费者阻塞字段删除', () => {
  const result = evaluatePublish(baseInput({
    compatibilityMode: 'BACKWARD',
    consumers: [
      { id: 'consumer-a', version: 2, rolloutStatus: 'complete' },
      { id: 'consumer-b', version: 1, rolloutStatus: 'in_progress' },
    ],
  }));
  assert.equal(result.publishable, false);
  assert.deepEqual(result.affectedConsumers.map((c) => c.id).sort(), ['consumer-a', 'consumer-b']);
  assert.deepEqual(result.blockingConsumers.map((c) => c.id), ['consumer-b']);
  assert.equal(result.rollbackVersion, 2);
});

test('字段删除：全部消费者完成升级后允许发布', () => {
  const result = evaluatePublish(baseInput({
    compatibilityMode: 'BACKWARD',
    consumers: [
      { id: 'consumer-a', version: 2, rolloutStatus: 'complete' },
      { id: 'consumer-b', version: 2, rolloutStatus: 'complete' },
    ],
  }));
  assert.equal(result.publishable, true);
  assert.deepEqual(result.publishableSchema, v3DropFlag);
  assert.deepEqual(result.blockingConsumers, []);
  assert.equal(result.rollbackVersion, 2);
});

test('契约必填字段缺失时阻塞发布', () => {
  const candidate = {
    version: 3,
    schema: {
      type: 'record',
      fields: [{ name: 'email', type: 'string', required: false }],
    },
  };
  const result = evaluatePublish(baseInput({ compatibilityMode: 'BACKWARD', candidate }));
  assert.equal(result.publishable, false);
  assert.ok(result.violations.some((v) => v.type === 'REQUIRED_FIELD_MISSING' && v.field === 'id'));
});

test('仅新增可选字段时 forward/backward/full 均可发布', () => {
  const candidate = {
    version: 3,
    schema: {
      type: 'record',
      fields: [...v2Schema.fields, { name: 'avatar', type: 'string', required: false }],
    },
  };
  for (const mode of ['FORWARD', 'BACKWARD', 'FULL']) {
    const result = evaluatePublish(baseInput({ compatibilityMode: mode, candidate }));
    assert.equal(result.publishable, true, `模式 ${mode} 应可发布`);
  }
});
