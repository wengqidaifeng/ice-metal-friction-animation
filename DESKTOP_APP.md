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

构建产物位于 `dist`，可以直接运行生成的 `.exe`。程序启动后点击“连接串口”，选择 ESP32 对应的 COM 端口，当前实验装置通常是 COM12。

桌面版的串口选择由 Electron 主进程处理；软件启动或关闭不会自动执行 HOME、RUN、JOG 等运动指令。
