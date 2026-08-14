# Fixture Connection Provider

Stage 0 的确定性 Connection Provider。它提供可重建基线、Interaction resolved Frame、延迟、重连和重新同步，用于真实 App Entry、单元测试和浏览器流程。

该 Provider 不建立网络连接，也不证明认证或 Harness 协议兼容性。UI 与 Runtime 不得导入本 Package 的实现类型。
