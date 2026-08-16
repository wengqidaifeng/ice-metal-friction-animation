const { app, BrowserWindow, dialog, session } = require("electron");
const http = require("http");
const fs = require("fs");
const path = require("path");

const consoleRoot = path.join(__dirname, "..", "slider-console");
let server;

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".md": "text/plain; charset=utf-8"
  }[ext] || "application/octet-stream";
}

function startLocalServer() {
  return new Promise((resolve, reject) => {
    server = http.createServer((request, response) => {
      const requested = decodeURIComponent((request.url || "/").split("?")[0]);
      const relative = requested === "/" ? "index.html" : requested.replace(/^\/+/, "");
      const filePath = path.resolve(consoleRoot, relative);
      if (!filePath.startsWith(path.resolve(consoleRoot) + path.sep)) {
        response.writeHead(403);
        response.end("Forbidden");
        return;
      }
      fs.readFile(filePath, (error, data) => {
        if (error) {
          response.writeHead(error.code === "ENOENT" ? 404 : 500);
          response.end(error.code === "ENOENT" ? "Not found" : "Server error");
          return;
        }
        response.writeHead(200, { "Content-Type": contentType(filePath), "Cache-Control": "no-store" });
        response.end(data);
      });
    });
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 960,
    minHeight: 700,
    title: "冰-金属摩擦实验控制台",
    backgroundColor: "#f5f7f8",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  });

  // Electron requires the main process to approve and select serial devices.
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => permission === "serial");
  session.defaultSession.setDevicePermissionHandler((details) => details.deviceType === "serial");
  win.webContents.on("select-serial-port", (event, portList, _webContents, callback) => {
    event.preventDefault();
    if (!portList.length) {
      callback("");
      return;
    }
    const labels = portList.map((port, index) => `${index + 1}. ${port.displayName || port.portId}`);
    dialog.showMessageBox(win, {
      type: "question",
      title: "选择 ESP32 串口",
      message: "请选择要连接的串口：",
      detail: labels.join("\n"),
      buttons: [...labels, "取消"],
      defaultId: 0,
      cancelId: labels.length
    }).then(({ response }) => callback(response < portList.length ? portList[response].portId : ""));
  });

  const port = await startLocalServer();
  await win.loadURL(`http://127.0.0.1:${port}/`);
  return win;
}

app.whenReady().then(async () => {
  try {
    await createWindow();
    app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  } catch (error) {
    dialog.showErrorBox("控制台启动失败", error.message);
    app.quit();
  }
});

app.on("window-all-closed", () => {
  if (server) server.close();
  if (process.platform !== "darwin") app.quit();
});
