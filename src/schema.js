// 本地 schema 模型：所有 schema 均为内存中的本地对象，不依赖外部注册中心。
//
// Schema 格式（本地模型）：
// {
//   "type": "record",
//   "fields": [
//     { "name": "id",    "type": "string", "required": true  },
//     { "name": "email", "type": "string", "required": false }
//   ]
// }

export function fieldMap(schema) {
  const map = new Map();
  for (const field of schema.fields ?? []) {
    map.set(field.name, field);
  }
  return map;
}

export function fieldNames(schema) {
  return [...fieldMap(schema).keys()];
}

// 计算 candidate 相对 reference 的结构差异。
export function diffSchemas(reference, candidate) {
  const refFields = fieldMap(reference);
  const candFields = fieldMap(candidate);

  const removed = [];
  const added = [];
  const typeChanged = [];

  for (const [name, field] of refFields) {
    if (!candFields.has(name)) {
      removed.push(field);
    }
  }
  for (const [name, field] of candFields) {
    if (!refFields.has(name)) {
      added.push(field);
    } else if (refFields.get(name).type !== field.type) {
      typeChanged.push({
        name,
        from: refFields.get(name).type,
        to: field.type,
      });
    }
  }

  return { removed, added, typeChanged };
}
