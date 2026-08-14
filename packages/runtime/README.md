# Runtime

React-free 的 Session 与 Attention Runtime。它消费 Connection 基线和 Frame，发布不可变 Snapshot，从权威 Interaction 状态派生收件箱，并协调带幂等键的修改操作。

UI 不直接消费 Connection Frame。Interaction 只能在 resolved Frame 或替换基线确认后从 pending 变为 resolved。
