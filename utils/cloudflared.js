const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

function getCloudflaredDir() {
  return path.join(os.homedir(), '.deplomot', 'cloudflared');
}

function getCloudflaredPath() {
  if (process.platform === 'win32') {
    return path.join(getCloudflaredDir(), 'cloudflared.exe');
  }
  return path.join(getCloudflaredDir(), 'cloudflared');
}

async function checkAndInstallCloudflared(sendStatus) {
  const cloudflaredPath = getCloudflaredPath();
  if (fs.existsSync(cloudflaredPath)) {
    return { installed: true };
  }

  const cloudflaredDir = getCloudflaredDir();
  const fetch = require('node-fetch');

  let downloadUrl;
  if (process.platform === 'win32') {
    downloadUrl = 'https://github.com/cloudflare/cloudflared/releases/download/2026.3.0/cloudflared-windows-amd64.exe';
  } else if (process.platform === 'darwin') {
    downloadUrl = 'https://github.com/cloudflare/cloudflared/releases/download/2026.3.0/cloudflared-darwin-amd64';
  } else {
    downloadUrl = 'https://github.com/cloudflare/cloudflared/releases/download/2026.3.0/cloudflared-linux-amd64';
  }

  const exePath = path.join(cloudflaredDir, process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');

  if (!fs.existsSync(cloudflaredDir)) {
    fs.mkdirSync(cloudflaredDir, { recursive: true });
  }

  if (sendStatus) {
    sendStatus('⏳ Downloading Cloudflare Tunnel binary (~15MB)...');
  }

  const response = await fetch(downloadUrl);
  
  if (!response.ok) {
    throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  }

  const buffer = await response.buffer();
  
  if (buffer.length < 1000) {
    throw new Error(`Downloaded file is too small (${buffer.length} bytes) - likely an error page`);
  }

  fs.writeFileSync(exePath, buffer);

  if (process.platform !== 'win32') {
    fs.chmodSync(exePath, '755');
  }

  if (sendStatus) {
    sendStatus('✅ Cloudflare Tunnel ready!');
  }

  return { installed: true, wasInstalled: true };
}

function startTunnel(port = 3847) {
  return new Promise((resolve) => {
    const cloudflaredPath = getCloudflaredPath();

    if (!fs.existsSync(cloudflaredPath)) {
      resolve({ success: false, error: 'Cloudflared not installed' });
      return;
    }

    const env = { ...process.env };
    const cloudflaredDir = path.dirname(cloudflaredPath);
    if (process.platform === 'win32') {
      env.PATH = `${cloudflaredDir};${env.PATH}`;
    } else {
      env.PATH = `${cloudflaredDir}:${env.PATH}`;
    }

    const tunnelProcess = spawn(cloudflaredPath, ['tunnel', '--url', `http://localhost:${port}`], {
      env: env,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let startupOutput = '';
    let hasResolved = false;

    const cleanup = () => {
      if (tunnelProcess && !tunnelProcess.killed) {
        try {
          const treeKill = require('tree-kill');
          treeKill(tunnelProcess.pid, 'SIGTERM');
        } catch (e) {
          try {
            tunnelProcess.kill('SIGTERM');
          } catch (e2) {}
        }
      }
    };

    const checkOutput = (data, isStderr) => {
      const output = data.toString();
      startupOutput += output;
      console.log(`[Cloudflared ${isStderr ? 'stderr' : 'stdout'}]:`, output);

      if (!hasResolved) {
        const urlMatch = output.match(/(https?:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com)/);
        if (urlMatch) {
          hasResolved = true;
          resolve({ success: true, url: urlMatch[1], process: tunnelProcess });
        }
      }
    };

    tunnelProcess.stdout.on('data', (data) => checkOutput(data, false));
    tunnelProcess.stderr.on('data', (data) => checkOutput(data, true));

    tunnelProcess.on('error', (error) => {
      if (!hasResolved) {
        hasResolved = true;
        resolve({ success: false, error: error.message });
      }
    });

    tunnelProcess.on('close', (code) => {
      if (!hasResolved) {
        hasResolved = true;
        resolve({ success: false, error: startupOutput || `Tunnel exited with code ${code}` });
      }
    });

    setTimeout(() => {
      if (!hasResolved) {
        hasResolved = true;
        const urlMatch = startupOutput.match(/(https?:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com)/);
        if (urlMatch) {
          resolve({ success: true, url: urlMatch[1], process: tunnelProcess });
        } else {
          resolve({ success: false, error: 'Timeout waiting for tunnel URL' });
        }
      }
    }, 30000);
  });
}

function stopTunnel(tunnelProcess) {
  return new Promise((resolve) => {
    if (!tunnelProcess || tunnelProcess.killed) {
      resolve({ success: true });
      return;
    }

    try {
      const treeKill = require('tree-kill');
      treeKill(tunnelProcess.pid, 'SIGTERM', (err) => {
        if (err) {
          resolve({ success: false, error: err.message });
        } else {
          resolve({ success: true });
        }
      });
    } catch (e) {
      try {
        tunnelProcess.kill('SIGTERM');
        resolve({ success: true });
      } catch (e2) {
        resolve({ success: false, error: e2.message });
      }
    }
  });
}

module.exports = {
  checkAndInstallCloudflared,
  getCloudflaredPath,
  getCloudflaredDir,
  startTunnel,
  stopTunnel
};
