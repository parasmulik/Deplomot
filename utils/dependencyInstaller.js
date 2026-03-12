const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

function getNpmPath() {
  if (process.platform === 'win32') {
    // On Windows, try common npm paths
    const possiblePaths = [
      path.join(process.env.APPDATA, 'npm', 'npm.cmd'),
      'npm.cmd',
      'npm'
    ];

    for (const p of possiblePaths) {
      try {
        if (p === 'npm.cmd' || p === 'npm') return p;
        if (fs.existsSync(p)) return p;
      } catch (e) {}
    }
    return 'npm.cmd';
  }
  return 'npm';
}

function installDependencies(targetDir, dependencies) {
  return new Promise((resolve) => {
    // Check if package.json exists, create one if not
    const packageJsonPath = path.join(targetDir, 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
      const deps = {};
      dependencies.forEach(dep => {
        deps[dep] = '*';
      });
      const packageJson = {
        name: 'pastify-generated',
        version: '1.0.0',
        dependencies: deps
      };
      fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2), 'utf8');
    } else {
      // Update existing package.json with any missing dependencies
      try {
        const existing = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
        if (!existing.dependencies) {
          existing.dependencies = {};
        }
        dependencies.forEach(dep => {
          if (!existing.dependencies[dep]) {
            existing.dependencies[dep] = '*';
          }
        });
        fs.writeFileSync(packageJsonPath, JSON.stringify(existing, null, 2), 'utf8');
      } catch (e) {
        console.error('Error updating package.json:', e);
      }
    }

    const npmCmd = getNpmPath();
    const env = { ...process.env };

    // Ensure node/npm are in PATH
    if (process.platform === 'darwin') {
      env.PATH = `/usr/local/bin:/opt/homebrew/bin:/usr/local/share/npm/bin:${env.PATH}`;
    }

    const child = spawn(npmCmd, ['install', '--production', '--no-audit', '--no-fund'], {
      cwd: targetDir,
      env: env,
      shell: true,
      stdio: 'pipe',
      windowsHide: true
    });

    let stderr = '';
    let stdout = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('error', (error) => {
      resolve({
        success: false,
        error: `Could not run npm install: ${error.message}. Make sure Node.js is installed on your computer.`
      });
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true });
      } else {
        resolve({
          success: false,
          error: stderr || stdout || `npm install exited with code ${code}`
        });
      }
    });

    // Timeout after 120 seconds
    setTimeout(() => {
      try {
        child.kill();
      } catch (e) {}
      resolve({
        success: false,
        error: 'Installation timed out after 2 minutes. Check your internet connection.'
      });
    }, 120000);
  });
}

module.exports = {
  installDependencies,
  checkAndInstallNode
};

async function checkAndInstallNode() {
  try {
    execSync('node --version', { stdio: 'ignore' });
    return { installed: true };
  } catch (e) {
    const fetch = require('node-fetch');
    const installerPath = path.join(os.tmpdir(), 'node-v20.11.0-x64.msi');
    
    const response = await fetch('https://nodejs.org/dist/v20.11.0/node-v20.11.0-x64.msi');
    const buffer = await response.buffer();
    fs.writeFileSync(installerPath, buffer);
    
    try {
      execSync(`msiexec /i "${installerPath}" /quiet /norestart`, { windowsHide: true });
    } catch (installError) {}
    
    return { installed: true, wasInstalled: true };
  }
}