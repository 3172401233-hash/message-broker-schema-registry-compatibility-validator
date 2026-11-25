# message-broker-schema-registry-compatibility-validator

验证消息 schema 兼容性和滚动发布（rollout）。

> **说明：本项目中所有 schema、注册中心和消费者状态均为本地模型（内存中的普通
> JavaScript 对象 / JSON 文件），不连接任何外部 Schema Registry、消息队列或网络服务。**

运行环境：Node.js 24.16.0（`engines: >=24.16.0`），仅使用标准库，无第三方依赖。

## 问题背景

生产者已发布 schema 新版本，但部分消费者仍注册在旧版本。注册中心显示
forward compatible，消费者在字段缺失时却无法反序列化。常见根因有两个：

1. **兼容性判断基准错误**：只拿候选 schema 和注册中心里的最新版本比较，
   而生产者实际生产数据用的是另一个（更旧的）版本。本工具强制以
   `producerVersion`（生产者当前实际版本）作为兼容性基准。
2. **忽略 rollout 状态**：结构上允许删除字段（如 BACKWARD 模式），但仍有
   消费者注册在包含该字段的旧版本且未完成升级。旧消费者未完成升级时，
   不能推进删除字段。

## 本地 schema 模型

```json
{
  "type": "record",
  "fields": [
    { "name": "id", "type": "string", "required": true },
    { "name": "email", "type": "string", "required": false }
  ]
}
```

## 输入

`evaluatePublish(input)`（`src/evaluate.js`）接受：

| 字段 | 说明 |
| --- | --- |
| `subject` | 主题名 |
| `schemas` | 本地注册中心内容：`[{ version, schema }]` |
| `compatibilityMode` | `FORWARD` / `BACKWARD` / `FULL` |
| `producerVersion` | 生产者当前实际在用的版本（兼容性基准，非最新版本） |
| `candidate` | 待发布版本 `{ version, schema }` |
| `requiredFields` | 契约层面必须保留的字段 |
| `consumers` | `[{ id, version, requiredFields?, rolloutStatus }]`，`rolloutStatus` 为 `pending` / `in_progress` / `complete` |

## 输出

| 字段 | 说明 |
| --- | --- |
| `publishable` | 是否允许发布 |
| `publishableSchema` | 可发布时的 schema，否则为 `null` |
| `violations` | 冲突详情（`FIELD_REMOVED` / `REQUIRED_FIELD_ADDED` / `FIELD_TYPE_CHANGED` / `REQUIRED_FIELD_MISSING` / `ROLLOUT_INCOMPLETE`） |
| `affectedConsumers` | 受字段删除影响的消费者 |
| `blockingConsumers` | 其中未完成升级、阻塞发布的消费者 |
| `rollbackVersion` | 回滚版本（生产者当前实际在用的已知良好版本） |
| `referenceVersion` | 实际使用的兼容性基准版本（等于 `producerVersion`） |

## 兼容规则

- `FORWARD`：旧消费者能读新数据 —— 不允许删字段、不允许改字段类型。
- `BACKWARD`：新代码能读旧数据 —— 不允许新增必填字段、不允许改字段类型。
- `FULL`：两者同时满足。
- 字段删除额外受 rollout 门禁约束：任何注册在含该字段版本且
  `rolloutStatus !== 'complete'` 的消费者都会阻塞删除。

## 使用

```bash
# 运行测试
node --test

# 用 JSON 输入评估一次发布（可发布退出码 0，被阻塞退出码 2）
node src/cli.js examples/input.json
```

## 目录结构

- `src/schema.js` — 本地 schema 模型与结构 diff
- `src/registry.js` — 本地内存注册中心模型
- `src/compatibility.js` — 结构兼容性检查（forward/backward/full）
- `src/evaluate.js` — 发布评估主逻辑（兼容性基准 + rollout 门禁）
- `src/cli.js` — 命令行入口
- `test/compatibility.test.js` — `node:test` 测试
