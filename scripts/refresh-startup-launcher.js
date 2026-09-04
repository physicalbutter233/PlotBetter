const fs = require('fs');
const path = require('path');

const appRoot = path.resolve(__dirname, '..');
const startupFolder = path.join(
  process.env.APPDATA,
  'Microsoft',
  'Windows',
  'Start Menu',
  'Programs',
  'Startup'
);
const electronExe = path.join(appRoot, 'node_modules', 'electron', 'dist', 'electron.exe');
const vbsPath = path.join(startupFolder, 'PlotBetter.vbs');
const cmdPath = path.join(startupFolder, 'PlotBetter.cmd');

const vbs = [
  'Set WshShell = CreateObject("WScript.Shell")',
  `cmd = Chr(34) & "${electronExe.replace(/\\/g, '\\\\')}" & Chr(34) & " " & Chr(34) & "${appRoot.replace(/\\/g, '\\\\')}" & Chr(34) & " --startup"`,
  'WshShell.Run cmd, 0, False',
  '',
].join('\r\n');

fs.writeFileSync(vbsPath, vbs, 'utf8');
if (fs.existsSync(cmdPath)) fs.unlinkSync(cmdPath);
console.log('Wrote', vbsPath);
if (fs.existsSync(cmdPath)) console.log('Legacy cmd still present');
else console.log('Removed legacy PlotBetter.cmd');
