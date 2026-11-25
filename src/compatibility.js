import { diffSchemas } from './schema.js';

export const MODES = ['FORWARD', 'BACKWARD', 'FULL'];

// 结构兼容性检查：candidate 相对 reference（生产者实际在用的版本）是否满足兼容模式。
// FORWARD：旧消费者能读新数据 —— 不允许删字段、不允许改类型。
// BACKWARD：新代码能读旧数据 —— 不允许新增必填字段、不允许改类型。
// FULL：两者同时满足。
export function checkStructuralCompatibility(mode, reference, candidate) {
  const { removed, added, typeChanged } = diffSchemas(reference, candidate);
  const violations = [];

  for (const change of typeChanged) {
    violations.push({
      type: 'FIELD_TYPE_CHANGED',
      field: change.name,
      detail: `字段 "${change.name}" 类型从 ${change.from} 变为 ${change.to}`,
    });
  }

  if (mode === 'FORWARD' || mode === 'FULL') {
    for (const field of removed) {
      violations.push({
        type: 'FIELD_REMOVED',
        field: field.name,
        detail: `forward 兼容下不允许删除字段 "${field.name}"`,
      });
    }
  }

  if (mode === 'BACKWARD' || mode === 'FULL') {
    for (const field of added) {
      if (field.required) {
        violations.push({
          type: 'REQUIRED_FIELD_ADDED',
          field: field.name,
          detail: `backward 兼容下不允许新增必填字段 "${field.name}"`,
        });
      }
    }
  }

  return { compatible: violations.length === 0, violations, removed, added };
}
