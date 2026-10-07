// Every process the app starts (claude, git, ripgrep, the login shell) is started
// here, so that quitting can stop all of them and whatever they started in turn.
// On macOS and Linux each one leads its own process group, and stopping it signals
// the whole group; on Windows `taskkill /T` takes the whole tree.
//
//   spawnTracked(cmd, args, opts)   child_process.spawn, tracked until it exits
//   killTree(child, signal)         stop one child and everything under it
//   stopAll(graceMs)                SIGTERM every live tree, SIGKILL what is left after graceMs
//   killAllNow()                    synchronous last resort, for process 'exit'
import { spawn, spawnSync } from 'node:child_process';

const WIN = process.platform === 'win32';
const live = new Set();

export function spawnTracked(cmd, args = [], opts = {}) {
  const child = spawn(cmd, args, { windowsHide: true, ...opts, detached: !WIN });
  live.add(child);
  const forget = () => live.delete(child);
  child.once('exit', forget); child.once('error', forget);
  return child;
}

const running = child => child.pid && child.exitCode === null && child.signalCode === null;

export function killTree(child, signal = 'SIGTERM') {
  if (!child || !running(child)) return;
  try {
    if (WIN) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    else process.kill(-child.pid, signal);           // the group: the child and what it started
  } catch { try { child.kill(signal); } catch {} }
}

export async function stopAll(graceMs = 2000) {
  const kids = [...live].filter(running);
  if (!kids.length) return;
  kids.forEach(c => killTree(c, 'SIGTERM'));
  await Promise.race([
    Promise.all(kids.map(c => running(c) ? new Promise(r => c.once('exit', r)) : null)),
    new Promise(r => setTimeout(r, graceMs)),
  ]);
  kids.forEach(c => killTree(c, 'SIGKILL'));
  // a group can outlive its leader (a grandchild that ignored SIGTERM): signal the groups once more
  if (!WIN) for (const c of kids) try { process.kill(-c.pid, 'SIGKILL'); } catch {}
}

export function killAllNow() {
  for (const c of live) {
    if (WIN) killTree(c);
    else try { process.kill(-c.pid, 'SIGKILL'); } catch {}
  }
}

export const liveCount = () => [...live].filter(running).length;
