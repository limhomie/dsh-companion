# Agent Notes

Agent Note 记录会被重新讨论的设计决定或提案，包括问题、选择、放弃的方案、验证要求和代价。代码与当前架构描述“是什么”，Agent Note 保存“为什么”。

## 路径

文件路径使用 `{lifecycle}/{class}/yyyy-mm-dd-topic.md`。

Lifecycle：

- `proposed/`：需要在实现前评审或仍有结构性开放问题。
- `implemented/`：已经落地并描述当前现实；实现位置或名称变化时同步更新事实。
- `rejected/`：保留仍能阻止一种合理但错误方案的提案；失去价值后删除。

Class：

- `architecture/`：Package、插件、状态、协议和部署职责。
- `feature/`：用户可观察能力。
- `bug-fix/`：具体行为缺陷及防复发约束。
- `process/`：开发、评审、发布和文档机制。
- `testing/`：验证层次、Fixture 和测试载体。
- `simplification/`：删除、合并或用依赖替代自有机制。

## 何时创建

非机械性改动必须新增或更新至少一个 Agent Note。先搜索当前 Note，更新拥有该决策的文件，不为同一事实建立多个索引或摘要。一个 Note 不得被编辑成相反的决策；新决策应创建新 Note 并相互链接。

## 格式

每份文件前三行固定为：

```md
# Agent Note: 标题

Status: proposed
```

Proposed Note 使用：

```md
## Problem
## Proposal
## Alternatives considered
## Acceptance criteria
## Risks
```

Implemented Note 使用：

```md
## Problem
## Decision
## Alternatives considered
## Consequences
```

可以在必需章节之间增加协议、状态、生命周期、安全或测试等专题章节。`Problem` 必须不依赖方案也能成立。`Alternatives considered` 必须记录真实备选及落选原因，不为满足格式虚构选项。

Proposed 转为 Implemented 时要重写正文：使用现在时描述实际机制，把未完成清单改成已存在的结果、验证和代价，不保留实施计划。

## 语言

当前 Agent Note 使用中文。机器标记 `# Agent Note:`、`Status:`、`proposed`、`implemented` 和 `rejected` 保持英文，方便后续接入格式检查。需要英文协作时增加同结构 `.en.md` 镜像，不把翻译变成第二个决策来源。
