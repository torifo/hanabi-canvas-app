import { app, BrowserWindow, Menu, screen, Tray, nativeImage, type Display } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const rendererPath = join(here, '../../dist/index.html');
const preloadPath = join(here, 'preload.js');
const devServerUrl = process.env.VITE_DEV_SERVER_URL;

let tray: Tray | null = null;
let muted = false;
const windows = new Map<number, BrowserWindow>();

function trayIcon() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><circle cx="16" cy="16" r="4" fill="#f7d98b"/><g stroke="#f7d98b" stroke-width="2" stroke-linecap="round"><path d="M16 2v7M16 23v7M2 16h7M23 16h7M6.1 6.1l5 5M20.9 20.9l5 5M25.9 6.1l-5 5M11.1 20.9l-5 5"/></g></svg>`;
  return nativeImage.createFromDataURL(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
}

async function loadRenderer(window: BrowserWindow): Promise<void> {
  if (devServerUrl) {
    await window.loadURL(devServerUrl);
    return;
  }
  await window.loadFile(rendererPath);
}

function createWindow(display: Display): BrowserWindow {
  const existing = windows.get(display.id);
  if (existing && !existing.isDestroyed()) {
    existing.setBounds(display.bounds);
    return existing;
  }

  const window = new BrowserWindow({
    ...display.bounds,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath,
    },
  });

  windows.set(display.id, window);
  window.on('closed', () => windows.delete(display.id));
  window.once('ready-to-show', () => window.showInactive());
  void loadRenderer(window).catch((error: unknown) => console.error('Could not load Hanabi Canvas renderer', error));
  return window;
}

function syncDisplays(): void {
  const displays = screen.getAllDisplays();
  const activeIds = new Set(displays.map((display) => display.id));
  for (const [id, window] of windows) {
    if (!activeIds.has(id) && !window.isDestroyed()) {
      window.close();
    }
  }
  for (const display of displays) {
    createWindow(display);
  }
}

function setMuted(nextMuted: boolean): void {
  muted = nextMuted;
  for (const window of windows.values()) {
    if (!window.isDestroyed()) {
      window.webContents.send('hanabi:set-muted', muted);
    }
  }
  refreshTrayMenu();
}

function setWindowsVisible(visible: boolean): void {
  for (const window of windows.values()) {
    if (!window.isDestroyed()) {
      if (visible) window.showInactive();
      else window.hide();
    }
  }
  refreshTrayMenu();
}

function anyWindowVisible(): boolean {
  return [...windows.values()].some((window) => !window.isDestroyed() && window.isVisible());
}

function refreshTrayMenu(): void {
  if (!tray) return;
  const visible = anyWindowVisible();
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: visible ? '隠す' : '表示する', click: () => setWindowsVisible(!visible) },
    { label: muted ? '音をオンにする' : 'ミュート', type: 'checkbox', checked: muted, click: (item) => setMuted(item.checked) },
    { type: 'separator' },
    { label: '終了', click: () => app.quit() },
  ]));
}

function createTray(): void {
  tray = new Tray(trayIcon());
  tray.setToolTip('花火と心模様');
  tray.on('click', () => setWindowsVisible(!anyWindowVisible()));
  refreshTrayMenu();
}

app.whenReady().then(() => {
  createTray();
  syncDisplays();
  screen.on('display-added', syncDisplays);
  screen.on('display-removed', syncDisplays);
  screen.on('display-metrics-changed', syncDisplays);
});

app.on('activate', () => setWindowsVisible(true));
app.on('before-quit', () => {
  for (const window of windows.values()) window.destroy();
});
