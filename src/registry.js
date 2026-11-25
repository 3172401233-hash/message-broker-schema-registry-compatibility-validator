// 本地内存版 schema 注册中心模型。
export class LocalSchemaRegistry {
  constructor() {
    this.subjects = new Map();
  }

  register(subject, version, schema) {
    if (!this.subjects.has(subject)) {
      this.subjects.set(subject, new Map());
    }
    const versions = this.subjects.get(subject);
    if (versions.has(version)) {
      throw new Error(`subject "${subject}" 版本 ${version} 已注册`);
    }
    versions.set(version, schema);
    return { subject, version };
  }

  get(subject, version) {
    const schema = this.subjects.get(subject)?.get(version);
    if (!schema) {
      throw new Error(`subject "${subject}" 不存在版本 ${version}`);
    }
    return schema;
  }

  latestVersion(subject) {
    const versions = this.subjects.get(subject);
    if (!versions || versions.size === 0) {
      throw new Error(`subject "${subject}" 没有任何已注册版本`);
    }
    return Math.max(...versions.keys());
  }

  static fromInput(input) {
    const registry = new LocalSchemaRegistry();
    for (const entry of input.schemas ?? []) {
      registry.register(input.subject, entry.version, entry.schema);
    }
    return registry;
  }
}
