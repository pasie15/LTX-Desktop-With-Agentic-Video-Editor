import { app, BrowserWindow, nativeImage } from 'electron'
import path from 'path'
import fs from 'fs'
import { isDev, getCurrentDir } from './config'
import { logger } from './logger'

const DEV_RENDERER_URLS = ['http://127.0.0.1:5173/', 'http://localhost:5173/'] as const
const DEV_LOAD_RETRIES = 40
const DEV_LOAD_RETRY_MS = 500
/** Chromium net::ERR_CONNECTION_REFUSED — Vite is not listening yet. */
const ERR_CONNECTION_REFUSED = -102
const ERR_CONNECTION_RESET = -101
const ERR_NAME_NOT_RESOLVED = -105
const ERR_ADDRESS_UNREACHABLE = -109
const TRANSIENT_DEV_LOAD_ERRORS = new Set([
  ERR_CONNECTION_REFUSED,
  ERR_CONNECTION_RESET,
  ERR_NAME_NOT_RESOLVED,
  ERR_ADDRESS_UNREACHABLE,
])

let mainWindow: BrowserWindow | null = null

export function createWindow(): BrowserWindow {
  // Get the path to preload script
  const preloadPath = isDev
    ? path.join(getCurrentDir(), 'dist-electron', 'preload.js')
    : path.join(app.getAppPath(), 'dist-electron', 'preload.js')

  // App icon — use .ico on Windows, .png elsewhere
  const iconExt = process.platform === 'win32' ? 'icon.ico' : 'icon.png'
  const iconPath = path.join(getCurrentDir(), 'resources', iconExt)
  logger.info(`[icon] Loading app icon from: ${iconPath} | exists: ${fs.existsSync(iconPath)}`)
  const appIcon = fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : undefined

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    icon: appIcon,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: isDev ? false : true,
    },
    backgroundColor: '#1a1a1a',
    titleBarStyle: 'default',
    show: false,
  })

  if (isDev) {
    let loadAttempts = 0
    let shown = false

    const showWindow = (): void => {
      if (shown || !mainWindow || mainWindow.isDestroyed()) return
      shown = true
      mainWindow.show()
    }

    const loadDevRenderer = (): void => {
      if (!mainWindow || mainWindow.isDestroyed()) return
      const url = DEV_RENDERER_URLS[loadAttempts % DEV_RENDERER_URLS.length]
      loadAttempts += 1
      logger.info(`[window] Loading ${url} (attempt ${loadAttempts}/${DEV_LOAD_RETRIES})`)
      void mainWindow.loadURL(url)
    }

    mainWindow.webContents.on('did-finish-load', () => {
      logger.info('[window] Renderer loaded')
      showWindow()
    })

    mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame || !mainWindow || mainWindow.isDestroyed()) return
      logger.warn(`[window] Load failed ${errorCode} ${errorDescription} ${validatedURL}`)
      const canRetry =
        TRANSIENT_DEV_LOAD_ERRORS.has(errorCode) && loadAttempts < DEV_LOAD_RETRIES
      if (canRetry) {
        setTimeout(loadDevRenderer, DEV_LOAD_RETRY_MS)
        return
      }
      showWindow()
    })

    loadDevRenderer()
  } else {
    void mainWindow.loadFile(path.join(app.getAppPath(), 'dist', 'index.html'))
    mainWindow.once('ready-to-show', () => {
      mainWindow?.show()
    })
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  return mainWindow
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}
