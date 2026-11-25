import { LocalSchemaRegistry } from './registry.js';
import { checkStructuralCompatibility, MODES } from './compatibility.js';
import { fieldMap } from './schema.js';

// 评估一次 schema 发布。
//
// input = {
//   subject: string,
//   schemas: [{ version, schema }],          // 本地注册中心内容
//   compatibilityMode: 'FORWARD' | 'BACKWARD' | 'FULL',
//   producerVersion: number,                 // 生产者当前实际在用的版本（兼容性基准）
//   candidate: { version, schema },          // 待发布的 schema
//   requiredFields: string[],                // 契约层面必须保留的字段
//   consumers: [{ id, version, requiredFields?, rolloutStatus }], // rolloutStatus: pending|in_progress|complete
// }
//
// 关键点：兼容性基准是 producerVersion 对应的 schema（生产者实际生产数据的版本），
// 而不是注册中心里的最新版本 —— 最新版本可能尚未被生产者采用。
export function evaluatePublish(input) {
  const {
    subject,
    compatibilityMode,
    producerVersion,
    candidate,
    requiredFields = [],
    consumers = [],
  } = input;

  if (!MODES.includes(compatibilityMode)) {
    throw new Error(`未知兼容模式: ${compatibilityMode}`);
  }

  const registry = LocalSchemaRegistry.fromInput(input);
  const reference = registry.get(subject, producerVersion);

  const violations = [];
  const structural = checkStructuralCompatibility(compatibilityMode, reference, candidate.schema);
  violations.push(...structural.violations);

  // 契约必填字段：candidate 必须保留。
  const candidateFields = fieldMap(candidate.schema);
  for (const name of requiredFields) {
    if (!candidateFields.has(name)) {
      violations.push({
        type: 'REQUIRED_FIELD_MISSING',
        field: name,
        detail: `契约必填字段 "${name}" 在候选 schema 中缺失`,
      });
    }
  }

  // 字段删除的 rollout 门禁：即使兼容模式（如 BACKWARD）结构上允许删字段，
  // 只要还有消费者注册在包含该字段的旧版本且未完成升级，就不能推进删除。
  const removedNames = new Set(structural.removed.map((f) => f.name));
  const affectedConsumers = [];
  const blockingConsumers = [];

  for (const consumer of consumers) {
    const consumerSchema = registry.get(subject, consumer.version);
    const consumerFields = fieldMap(consumerSchema);
    const consumerRequired = consumer.requiredFields ?? [];
    const impacted = [...removedNames].filter(
      (name) => consumerFields.has(name) || consumerRequired.includes(name),
    );
    if (impacted.length === 0) continue;

    const entry = {
      id: consumer.id,
      version: consumer.version,
      rolloutStatus: consumer.rolloutStatus,
      impactedFields: impacted,
    };
    affectedConsumers.push(entry);
    if (consumer.rolloutStatus !== 'complete') {
      blockingConsumers.push(entry);
    }
  }

  for (const consumer of blockingConsumers) {
    for (const field of consumer.impactedFields) {
      violations.push({
        type: 'ROLLOUT_INCOMPLETE',
        field,
        consumer: consumer.id,
        detail: `消费者 "${consumer.id}"（版本 ${consumer.version}，状态 ${consumer.rolloutStatus}）仍依赖字段 "${field}"，未完成升级前不能删除`,
      });
    }
  }

  const publishable = violations.length === 0;

  return {
    subject,
    compatibilityMode,
    referenceVersion: producerVersion,
    candidateVersion: candidate.version,
    publishable,
    publishableSchema: publishable ? candidate.schema : null,
    violations,
    affectedConsumers,
    blockingConsumers,
    // 回滚版本：发布被阻塞或上线后出问题时，回退到生产者当前实际在用的已知良好版本。
    rollbackVersion: producerVersion,
  };
}
