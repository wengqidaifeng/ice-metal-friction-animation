# 桌面版控制台

本仓库现在包含“冰-金属摩擦实验控制台”的桌面封装。桌面版使用 Electron 打开独立窗口，仍然复用 `slider-console` 中的串口界面和协议逻辑，不需要手动打开浏览器。

## 开发运行

```powershell
npm install
npm start
```

## 构建 Windows 便携版

```powershell
npm run dist
```

构建产物位于 `dist`，可以直接运行生成的 `.exe`。程序启动后可在顶部选择连接方式：

- `USB 串口`：选择 ESP32 的 CH343 端口，当前装置通常是 `COM12`，参数为 `115200, 8N1`。
- `ESP32 Wi-Fi`：电脑先连接热点 `IceFriction-ESP32`，密码 `IceLab2026`，地址保持 `http://192.168.4.1`，再点击“连接”。该模式对应当前固件的 `/api/status`、`/api/command` 和 `/api/samples` 接口。

如果只看到持续 `DATA` 而发送命令没有响应，优先使用 ESP32 Wi-Fi 模式；USB 串口仍可用于监视和现场调试。

桌面版的 USB 串口由 Electron 主进程通过原生 `serialport` 通道处理，会自动枚举并优先选择 CH343/COM12，不再依赖浏览器串口选择框。软件启动或关闭不会自动执行 HOME、RUN、JOG 等运动指令。
