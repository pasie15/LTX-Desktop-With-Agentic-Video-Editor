import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import net from 'net'
import path from 'path'

const DEV_HOST = '127.0.0.1'
const DEV_PORT = 5173

function startElectron(startup: (args?: string[]) => void): void {
  if (process.env.ELECTRON_DEBUG) {
    // --inspect and --remote-debugging-port must come before '.' (the app path)
    startup(['--inspect=9229', '--remote-debugging-port=9222', '.', '--no-sandbox'])
    return
  }
  startup()
}

function waitForPort(host: string, port: number, timeoutMs = 30_000): Promise<void> {
  const startedAt = Date.now()
  return new Promise((resolve, reject) => {
    const tryOnce = (): void => {
      const socket = net.connect({ host, port }, () => {
        socket.end()
        resolve()
      })
      socket.on('error', () => {
        socket.destroy()
        if (Date.now() - startedAt > timeoutMs) {
          reject(new Error(`Vite did not listen on ${host}:${port}`))
          return
        }
        setTimeout(tryOnce, 250)
      })
    }
    tryOnce()
  })
}

export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        entry: 'electron/main.ts',
        onstart(options) {
          void waitForPort(DEV_HOST, DEV_PORT)
            .catch((error: unknown) => {
              console.error(error)
            })
            .finally(() => {
              startElectron(options.startup)
            })
        },
        vite: {
          build: {
            outDir: 'dist-electron',
            sourcemap: true,
            rollupOptions: {
              external: ['electron', 'koffi']
            }
          }
        }
      },
      {
        entry: 'electron/preload.ts',
        onstart(options) {
          options.reload()
        },
        vite: {
          build: {
            outDir: 'dist-electron',
            sourcemap: true,
            rollupOptions: {
              output: {
                format: 'cjs'  // Preload must be CommonJS
              }
            }
          }
        }
      }
    ]),
    renderer()
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './frontend')
    }
  },
  base: './',  // Use relative paths for Electron file:// protocol
  // Bind IPv4 (0.0.0.0) so both localhost and 127.0.0.1 work on Windows.
  server: {
    host: true,
    port: DEV_PORT,
    strictPort: true,
  },
  build: {
    outDir: 'dist'
  }
})
