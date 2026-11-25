// A profile app and its `orca serve` exclude each other. See docs/fork/profiles-design.md, section 4.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { app, dialog } from 'electron'
import {
  SERVE_LAUNCHD_LABEL_PREFIX,
  serveProfileSuffix
} from '../../shared/remote-runtime/serve-supervisor/serve-bundle-coordination'
import { ORCAD_LOCK_FILE_NAME } from '../orcad/instance-lock/orcad-instance-lock'
import {
  readOrcadInstanceLockRecord,
  type OrcadLockRecord
} from '../orcad/instance-lock/orcad-instance-lock-record'
import { isProcessAlive } from '../daemon/endpoint/identity/daemon-process-inspection'

const SERVER_EXIT_WAIT_MS = 30_000

export type ProcessRow = { pid: number; ppid: number; command: string }

export type ProfileServer =
  | { kind: 'none' }
  /** The profile's own LaunchAgent runs it: its supervisor's parent is launchd. */
  | { kind: 'service'; pid: number }
  | { kind: 'hand-started'; pids: number[] }

/** Who holds the profile. Pure: the caller reads the lock record and the process table. */
export function classifyProfileServer(
  record: OrcadLockRecord | null,
  processes: readonly ProcessRow[],
  ownPid: number
): ProfileServer {
  const holder = record ? processes.find((row) => row.pid === record.pid) : undefined
  if (!record || !holder || holder.pid === ownPid) {
    return { kind: 'none' }
  }
  // An Electron serve takes the desktop role, so its command line tells it from a desktop.
  if (record.role === 'desktop' && !/ --serve(\s|$)/.test(holder.command)) {
    return { kind: 'none' }
  }
  const supervisor = processes.find((row) => row.pid === holder.ppid)
  if (supervisor && / serve(\s|$)/.test(supervisor.command)) {
    return supervisor.ppid === 1
      ? { kind: 'service', pid: holder.pid }
      : { kind: 'hand-started', pids: [supervisor.pid, holder.pid] }
  }
  return { kind: 'hand-started', pids: [holder.pid] }
}

// shortcut: synchronous `ps` and `launchctl` before ready, where nothing can await; slice 5 moves them to an async start.
function runSync(program: string, args: string[]): { status: number | null; stdout: string } {
  return spawnSync(program, args, { encoding: 'utf8' })
}

function readProcessTable(): ProcessRow[] {
  const out = runSync('/bin/ps', ['-axo', 'pid=,ppid=,command=']).stdout
  return (out ?? '').split('\n').flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line)
    return match ? [{ pid: Number(match[1]), ppid: Number(match[2]), command: match[3] }] : []
  })
}

function waitForExit(pid: number): boolean {
  const deadline = Date.now() + SERVER_EXIT_WAIT_MS
  while (isProcessAlive(pid)) {
    if (Date.now() > deadline) {
      return false
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200)
  }
  return true
}

function launchctl(args: string[]): void {
  spawn('/bin/launchctl', args, { detached: true, stdio: 'ignore' }).unref()
}

/**
 * Runs before the app takes the profile. Stops the profile's own serve service and starts it
 * again after a normal quit. Offers to stop a server that the user started by hand.
 * Returns false when the app must not start.
 */
export function takeProfileFromServer(userDataPath: string): boolean {
  const server = classifyProfileServer(
    readOrcadInstanceLockRecord(join(userDataPath, ORCAD_LOCK_FILE_NAME)),
    readProcessTable(),
    process.pid
  )
  if (server.kind === 'none') {
    return true
  }
  if (server.kind === 'service') {
    const uid = process.getuid?.() ?? 0
    const label = `${SERVE_LAUNCHD_LABEL_PREFIX}.${serveProfileSuffix(userDataPath)}`
    const unitPath = join(homedir(), 'Library', 'LaunchAgents', `${label}.plist`)
    // The job can be loaded without its file, so bootout runs in every case.
    if (runSync('/bin/launchctl', ['bootout', `gui/${uid}/${label}`]).status === 0) {
      if (existsSync(unitPath)) {
        // Detached, so it runs after this process has exited.
        app.once('will-quit', () => launchctl(['bootstrap', `gui/${uid}`, unitPath]))
      }
      if (waitForExit(server.pid)) {
        return true
      }
    }
  }
  const pids = server.kind === 'service' ? [server.pid] : server.pids
  const choice = dialog.showMessageBoxSync({
    type: 'warning',
    message: 'An Orca server uses this profile',
    detail: `orca serve (pid ${pids.join(', ')}) runs this profile. The app and the server cannot use the same profile at the same time.`,
    buttons: ['Stop the server and open', 'Cancel'],
    defaultId: 0,
    cancelId: 1
  })
  if (choice !== 0) {
    return false
  }
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      // It stopped on its own.
    }
  }
  if (pids.every(waitForExit)) {
    return true
  }
  dialog.showErrorBox('Orca could not start', `The server (pid ${pids.join(', ')}) did not stop.`)
  return false
}
