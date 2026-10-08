// Small, pure guards shared by the launcher, main process and regression tests.
export function runtimeError({ node = process.versions.node, uid = process.getuid?.(), argv = process.argv, env = process.env } = {}) {
  const [major, minor] = node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 12)) return 'Node.js 22.12 or newer is required.';
  if (uid === 0) return 'Gatekeeper refuses to run as root. Use a normal user account with the Electron sandbox enabled.';
  if (argv.some(a => /^--(?:no-sandbox|disable-setuid-sandbox|disable-gpu-sandbox|disable-seccomp-filter-sandbox|disable-namespace-sandbox)(?:=|$)/.test(a)) || env.ELECTRON_DISABLE_SANDBOX)
    return 'Gatekeeper requires the Electron sandbox; remove sandbox-disabling flags and environment settings.';
  return null;
}

export function trustedSender(event, window, pageUrl) {
  if (!window || window.isDestroyed()) return false;
  const contents = window.webContents;
  return event?.sender === contents && event.senderFrame === contents.mainFrame && event.senderFrame?.url === pageUrl;
}
