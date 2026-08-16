const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { SerialPort } = require("serialport");

const consoleRoot = path.join(__dirname, "..", "slider-console");
let server;
let activeSerialPort;

async function closeSerialPort() {
  const port = activeSerialPort;
  activeSerialPort = null;
  if (!port?.isOpen) return;
  await new Promise((resolve) => port.close(() => resolve()));
}

ipcMain.handle("serial:list", async () => SerialPort.list());
ipcMain.handle("serial:open", async (event, options) => {
  await closeSerialPort();
  const port = new SerialPort({
    path: options.path,
    baudRate: Number(options.baudRate) || 115200,
    dataBits: 8,
    stopBits: 1,
    parity: "none",
    autoOpen: false
  });
  await new Promise((resolve, reject) => port.open((error) => error ? reject(error) : resolve()));
  port.on("data", (data) => event.sender.send("serial:data", data.toString("utf8")));
  port.on("error", (error) => event.sender.send("serial:error", error.message));
  activeSerialPort = port;
  return { path: port.path, baudRate: port.baudRate };
});
ipcMain.handle("serial:write", async (_event, text) => {
  if (!activeSerialPort?.isOpen) throw new Error("串口未打开");
  await new Promise((resolve, reject) => activeSerialPort.write(text, (error) => error ? reject(error) : resolve()));
});
ipcMain.handle("serial:close", closeSerialPort);

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
      sandbox: false,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js")
    }
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
  void closeSerialPort();
  if (server) server.close();
  if (process.platform !== "darwin") app.quit();
});
