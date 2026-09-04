const fs = require('fs');
const { app } = require('electron');
const path = require('path');

const STARTUP_LAUNCHER_VBS = 'PlotBetter.vbs';
const LEGACY_STARTUP_CMD = 'PlotBetter.cmd';

function getAppRoot() {
  return path.resolve(__dirname, '..');
}

function getWindowsStartupFolder() {
  const appData = process.env.APPDATA;
  if (!appData) return null;
  return path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
}

function getWindowsStartupLauncherPath() {
  const folder = getWindowsStartupFolder();
  return folder ? path.join(folder, STARTUP_LAUNCHER_VBS) : null;
}

function getLegacyStartupCmdPath() {
  const folder = getWindowsStartupFolder();
  return folder ? path.join(folder, LEGACY_STARTUP_CMD) : null;
}

function resolveElectronExe(appRoot) {
  const candidates = [
    path.join(appRoot, 'node_modules', 'electron', 'dist', 'electron.exe'),
    path.join(appRoot, 'node_modules', '.bin', 'electron.cmd'),
    process.execPath,
  ];
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return process.execPath;
}

function writeWindowsStartupLauncher(appRoot) {
  const launcherPath = getWindowsStartupLauncherPath();
  if (!launcherPath) {
    throw new Error('Cannot resolve Windows Startup folder (APPDATA missing).');
  }

  const electronExe = resolveElectronExe(appRoot);
  const vbs = [
    'Set WshShell = CreateObject("WScript.Shell")',
    `cmd = Chr(34) & "${electronExe.replace(/\\/g, '\\\\')}" & Chr(34) & " " & Chr(34) & "${appRoot.replace(/\\/g, '\\\\')}" & Chr(34) & " --startup"`,
    'WshShell.Run cmd, 0, False',
    '',
  ].join('\r\n');

  if (fs.existsSync(launcherPath)) {
    try {
      if (fs.readFileSync(launcherPath, 'utf8') === vbs) {
        return launcherPath;
      }
    } catch {
      /* rewrite below */
    }
  }

  fs.writeFileSync(launcherPath, vbs, 'utf8');

  const legacyCmd = getLegacyStartupCmdPath();
  if (legacyCmd && fs.existsSync(legacyCmd)) {
    fs.unlinkSync(legacyCmd);
  }

  return launcherPath;
}

function removeWindowsStartupLauncher() {
  const launcherPath = getWindowsStartupLauncherPath();
  if (launcherPath && fs.existsSync(launcherPath)) {
    fs.unlinkSync(launcherPath);
  }
  const legacyCmd = getLegacyStartupCmdPath();
  if (legacyCmd && fs.existsSync(legacyCmd)) {
    fs.unlinkSync(legacyCmd);
  }
}

function usesWindowsStartupFolder() {
  return process.platform === 'win32' && !app.isPackaged;
}

function getElectronLoginOptions() {
  const appRoot = getAppRoot();

  if (app.isPackaged) {
    return {};
  }

  if (process.platform === 'win32') {
    return {
      path: resolveElectronExe(appRoot),
      args: [appRoot, '--startup'],
    };
  }

  if (process.platform === 'darwin') {
    return {
      path: process.execPath,
      args: [appRoot, '--startup'],
    };
  }

  return {
    path: process.execPath,
    args: [appRoot, '--startup'],
  };
}

function getAutoLaunchStatus() {
  if (usesWindowsStartupFolder()) {
    const launcherPath = getWindowsStartupLauncherPath();
    return Boolean(launcherPath && fs.existsSync(launcherPath));
  }

  try {
    return app.getLoginItemSettings(getElectronLoginOptions()).openAtLogin;
  } catch {
    return false;
  }
}

function applyAutoLaunch(enabled) {
  const want = Boolean(enabled);
  const appRoot = getAppRoot();

  if (usesWindowsStartupFolder()) {
    if (want) {
      writeWindowsStartupLauncher(appRoot);
    } else {
      removeWindowsStartupLauncher();
    }
    return getAutoLaunchStatus();
  }

  const options = {
    openAtLogin: want,
    ...getElectronLoginOptions(),
  };
  app.setLoginItemSettings(options);
  return getAutoLaunchStatus();
}

function syncAutoLaunchFromConfig(config) {
  const want = Boolean(config?.autoLaunch);

  if (usesWindowsStartupFolder()) {
    if (want) {
      writeWindowsStartupLauncher(getAppRoot());
    } else {
      removeWindowsStartupLauncher();
    }
    return;
  }

  const current = getAutoLaunchStatus();
  if (want !== current) {
    applyAutoLaunch(want);
  }
}

function getAutoLaunchInfo() {
  const systemActive = getAutoLaunchStatus();
  const info = {
    systemActive,
    method: usesWindowsStartupFolder() ? 'windows-startup-folder' : 'electron-login-item',
  };
  if (usesWindowsStartupFolder()) {
    info.launcherPath = getWindowsStartupLauncherPath();
  }
  return info;
}

module.exports = {
  applyAutoLaunch,
  getAutoLaunchStatus,
  syncAutoLaunchFromConfig,
  getAutoLaunchInfo,
};
