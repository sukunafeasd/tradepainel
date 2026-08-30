"use strict";

const path = require("path");
const fs = require("fs");
const { app, BrowserWindow, shell, safeStorage } = require("electron");
const { createServer } = require("./server.cjs");
const { CredentialStore } = require("./security/credential-store.cjs");

const allowedExternal = new Set([
  "https://platform.openai.com/api-keys",
  "https://developers.binance.com/docs/binance-spot-api-docs",
]);

let localServer = null;
let mainWindow = null;

if (process.env.DIEFTRADE_SMOKE_SCREENSHOT) app.setPath("userData", path.join(app.getPath("temp"), `dieftrade-smoke-${process.pid}`));
if (!app.requestSingleInstanceLock() && !process.env.DIEFTRADE_SMOKE_SCREENSHOT) app.quit();

app.on("second-instance", () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

async function start() {
  const dataDirectory = path.join(app.getPath("userData"), "dieftrade-data");
  const credentialStore = new CredentialStore(dataDirectory, safeStorage);
  localServer = createServer({
    dataDirectory,
    uiDirectory: path.join(__dirname, "ui"),
    credentialStore,
  });
  const { port, token } = await localServer.listen();

  mainWindow = new BrowserWindow({
    width: 1540,
    height: 960,
    minWidth: 1120,
    minHeight: 700,
    show: false,
    title: "DiefTrade",
    icon: path.join(__dirname, "..", "assets", "brand", "dieftrade.ico"),
    backgroundColor: "#050907",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      devTools: process.env.DIEFTRADE_DEV === "1",
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (allowedExternal.has(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const localOrigin = `http://127.0.0.1:${port}`;
    if (!url.startsWith(localOrigin)) event.preventDefault();
  });
  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    mainWindow.focus();
  });
  mainWindow.on("closed", () => { mainWindow = null; });
  await mainWindow.loadURL(`http://127.0.0.1:${port}/?t=${encodeURIComponent(token)}`);
  if (process.env.DIEFTRADE_SMOKE_SCREENSHOT) {
    await new Promise((resolve) => setTimeout(resolve, 9000));
    const image = await mainWindow.webContents.capturePage();
    fs.writeFileSync(process.env.DIEFTRADE_SMOKE_SCREENSHOT, image.toPNG());
    app.quit();
  }
}

app.whenReady().then(start).catch((error) => {
  console.error(error);
  app.quit();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (localServer) void localServer.close();
});
