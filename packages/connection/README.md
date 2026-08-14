# Connection

Companion Connection 的 Service Definition，拥有 Host 描述、物理连接状态、权威 Frame、修改命令和 Provider 生命周期接口。

Consumer 只依赖 `ConnectionService`，不导入具体 Provider。业务 Payload 不包含调用方自行声明的设备身份或 Scope；真实认证主体由后续 Provider 与 Harness Wire Package 提供。
