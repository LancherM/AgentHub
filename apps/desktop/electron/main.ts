import { app, BrowserWindow, shell } from "electron";
import path from "node:path";
import { registerAgentHubIpc } from "./ipc";

app.setName("Agent Hub");
app.setPath("userData", path.join(app.getPath("appData"), "Agent Hub"));


const SAFE_EXTERNAL_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

async function openExternalUrl(rawUrl: string): Promise<void> {
  try {
    const parsed = new URL(rawUrl);
    if (!SAFE_EXTERNAL_PROTOCOLS.has(parsed.protocol)) {
      return;
    }

    await shell.openExternal(parsed.toString());
  } catch {
    // Ignore malformed or unsupported URLs.
  }
}

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 720,
    title: "Agent Hub",
    backgroundColor: "#11110f",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });

  window.once("ready-to-show", () => {
    window.show();
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    void openExternalUrl(url);
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    if (url === window.webContents.getURL()) {
      return;
    }

    event.preventDefault();
    void openExternalUrl(url);
  });


  const devServerUrl = process.env.ELECTRON_RENDERER_URL;
  if (devServerUrl) {
    void window.loadURL(devServerUrl);
  } else {
    void window.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  return window;
}

app.whenReady().then(() => {
  registerAgentHubIpc();
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
