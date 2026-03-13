const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

function getBundledNodeDir() {
  return path.join(os.homedir(), '.deplomot', 'node');
}

function getBundledNodePath() {
  // Point directly to extracted subfolder
  if (process.platform === 'win32') {
    return path.join(getBundledNodeDir(), 'node-v20.11.0-win-x64', 'node.exe');
  }
  return path.join(getBundledNodeDir(), 'node-v20.11.0-win-x64', 'bin', 'node');
}

function getBundledNpmPath() {
  // Point directly to extracted subfolder
  if (process.platform === 'win32') {
    return path.join(getBundledNodeDir(), 'node-v20.11.0-win-x64', 'npm.cmd');
  }
  return path.join(getBundledNodeDir(), 'node-v20.11.0-win-x64', 'bin', 'npm');
}

function getNpmPath() {
  // Use bundled npm first
  const bundledNpm = getBundledNpmPath();
  if (fs.existsSync(bundledNpm)) {
    return bundledNpm;
  }

  // Fallback to system npm
  if (process.platform === 'win32') {
    return 'npm.cmd';
  }
  return 'npm';
}

function getNodePath() {
  // Use bundled node first
  const bundledNode = getBundledNodePath();
  if (fs.existsSync(bundledNode)) {
    return bundledNode;
  }

  // Fallback to system node
  return 'node';
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
        name: 'deplomot-generated',
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
    const nodeDir = path.dirname(npmCmd);
    const env = { ...process.env };

    // Add bundled node/npm to PATH
    if (process.platform === 'win32') {
      env.PATH = `${nodeDir};${env.PATH}`;
    } else {
      env.PATH = `${nodeDir}:${env.PATH}`;
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

async function checkAndInstallNode(sendStatus) {
  // Check if bundled node already exists at the subfolder path
  const bundledNodePath = getBundledNodePath();
  if (fs.existsSync(bundledNodePath)) {
    return { installed: true };
  }

  // Download portable Node.js
  const nodeDir = getBundledNodeDir();
  const fetch = require('node-fetch');
  const extract = require('extract-zip');
  
  const zipUrl = 'https://nodejs.org/dist/v20.11.0/node-v20.11.0-win-x64.zip';
  const zipPath = path.join(os.tmpdir(), 'node-v20.11.0-win-x64.zip');

  // Ensure directory exists
  if (!fs.existsSync(nodeDir)) {
    fs.mkdirSync(nodeDir, { recursive: true });
  }

  // Send status: downloading
  if (sendStatus) {
    sendStatus('⏳ First time setup: Downloading Node.js (~30MB), please wait...');
  }

  // Download the zip file
  const response = await fetch(zipUrl);
  const buffer = await response.buffer();
  fs.writeFileSync(zipPath, buffer);

  // Send status: extracting
  if (sendStatus) {
    sendStatus('⏳ Extracting Node.js, please wait...');
  }

  // Extract the zip - contents will be in node-v20.11.0-win-x64 subfolder
  await extract(zipPath, { dir: nodeDir });

  // Wait for extraction to fully complete
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Clean up zip file
  try {
    fs.unlinkSync(zipPath);
  } catch (e) {}

  // Send status: complete
  if (sendStatus) {
    sendStatus('✅ Setup complete! Starting your project...');
  }

  return { installed: true, wasInstalled: true };
}

module.exports = {
  installDependencies,
  checkAndInstallNode,
  getBundledNodeDir,
  getBundledNodePath,
  getBundledNpmPath,
  getNpmPath,
  getNodePath
};
