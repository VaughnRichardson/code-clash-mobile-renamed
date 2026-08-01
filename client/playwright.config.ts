import { defineConfig, devices } from '@playwright/test'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// One server for the whole run; the tests drive two browser contexts against
// it so a PvP match is exercised the way it is actually played.
//
// BASE_URL OVERRIDES BOTH THE URL AND THE SERVER, and it is not a convenience.
// `reuseExistingServer` will happily adopt whatever is already listening on
// 8000 — including a server started from a DIFFERENT CHECKOUT, which then
// serves that checkout's `dist/`. It cost a full test run here: two failures
// that were entirely real on the old build and entirely absent from the new
// one, with nothing in the output to say which bundle had been tested. Set
// BASE_URL to a port you started yourself and the run cannot be hijacked.
const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:8000'

const chromeCandidates = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  process.env.CHROME_PATH,
  process.env.PROGRAMFILES
    ? join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe')
    : undefined,
  process.env['PROGRAMFILES(X86)']
    ? join(process.env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe')
    : undefined,
  process.env.LOCALAPPDATA
    ? join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe')
    : undefined,
  '/opt/pw-browsers/chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
]
const CHROME = chromeCandidates.find(
  (candidate): candidate is string => Boolean(candidate && existsSync(candidate)))

function pythonCommand(): string {
  if (process.env.CARD_CLASH_PYTHON) return process.env.CARD_CLASH_PYTHON
  if (process.platform !== 'win32') return 'python3'
  const root = process.env.LOCALAPPDATA
    ? join(process.env.LOCALAPPDATA, 'Programs', 'Python')
    : ''
  if (root && existsSync(root)) {
    const installs = readdirSync(root)
      .filter(name => /^Python3\d+$/.test(name))
      .sort()
      .reverse()
    for (const install of installs) {
      const executable = join(root, install, 'python.exe')
      if (existsSync(executable)) return `"${executable}"`
    }
  }
  return 'python'
}

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: BASE,
    // A Chromium-based phone profile: this environment ships Chromium only,
    // and an iPhone descriptor would silently ask for WebKit.
    ...devices['Pixel 5'],
    viewport: { width: 390, height: 844 },
    screenshot: 'only-on-failure',
    reducedMotion: 'reduce',
    // Prefer a system browser when one is available; otherwise Playwright may
    // use its own installed Chromium.
    launchOptions: CHROME ? { executablePath: CHROME } : undefined,
  },
  webServer: process.env.BASE_URL ? undefined : {
    command: `${pythonCommand()} -m uvicorn server.app:app --host 127.0.0.1 --port 8000`,
    cwd: '..',
    url: 'http://127.0.0.1:8000/api/health',
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
