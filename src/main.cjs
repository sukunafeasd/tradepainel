"use strict";

const path = require("path");
const { app, BrowserWindow, shell, safeStorage } = require("electron");
const { createServer } = require("./server.cjs");
const { CredentialStore } = require("./security/credential-store.cjs");

const allowedExternal = new Set([
  "https://platform.openai.com/api-keys",
  "https://platform.openai.com/settings/organization/billing/overview",
  "https://aistudio.google.com/app/apikey",
  "https://developers.binance.com/docs/binance-spot-api-docs",
]);

let localServer = null;
let mainWindow = null;
let localAddress = null;
let quitting = false;
let closingServer = false;
let focusRequested = false;

if (process.env.DIEFTRADE_SMOKE_SCREENSHOT) app.setPath("userData", path.join(app.getPath("temp"), `dieftrade-smoke-${process.pid}`));
const primaryInstance = process.env.DIEFTRADE_SMOKE_SCREENSHOT || app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();

app.on("second-instance", () => {
  if (!mainWindow) { focusRequested = true; return; }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

async function createMainWindow() {
  if (!localAddress || mainWindow) return mainWindow;
  const { port, token } = localAddress;
  const localOrigin = `http://127.0.0.1:${port}`;
  const window = new BrowserWindow({
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
  mainWindow = window;
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (allowedExternal.has(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, target) => {
    try { if (new URL(target).origin !== localOrigin) event.preventDefault(); }
    catch { event.preventDefault(); }
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    if (!quitting && details.reason !== "clean-exit") void window.loadURL(`${localOrigin}/#t=${encodeURIComponent(token)}`);
  });
  window.once("ready-to-show", () => { window.show(); window.focus(); focusRequested = false; });
  window.on("closed", () => { if (mainWindow === window) mainWindow = null; });
  await window.loadURL(`${localOrigin}/#t=${encodeURIComponent(token)}`);
  return window;
}

async function start() {
  const dataDirectory = path.join(app.getPath("userData"), "dieftrade-data");
  const credentialStore = new CredentialStore(dataDirectory, safeStorage);
  localServer = createServer({
    dataDirectory,
    uiDirectory: path.join(__dirname, "ui"),
    credentialStore,
  });
  localAddress = await localServer.listen();
  await createMainWindow();
  if (process.env.DIEFTRADE_SMOKE_SCREENSHOT) {
    // Mantido no pacote para validar exatamente o mesmo artefato entregue ao usuário.
    const { runSmoke } = require("../scripts/smoke-runner.cjs");
    await runSmoke(mainWindow, process.env);
    app.quit();
  }
}

if (primaryInstance) app.whenReady().then(start).catch((error) => {
  console.error(error);
  app.quit();
});

app.on("activate", () => { if (!mainWindow && localAddress && !quitting) void createMainWindow(); });

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", (event) => {
  if (!localServer || closingServer) return;
  event.preventDefault();
  quitting = true;
  closingServer = true;
  void localServer.close().catch((error) => console.error("Falha ao encerrar o serviço local:", error)).finally(() => app.exit(0));
});
