const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

let serverProcess = null;
let staticServerInstance = null;

function getNodePath() {
  if (process.platform === 'win32') {
    return 'node';
  }
  return 'node';
}

function startServer(backendDir, serverFile) {
  return new Promise((resolve) => {
    // Kill any existing server
    stopServer();

    const serverFilePath = path.join(backendDir, serverFile);

    if (!fs.existsSync(serverFilePath)) {
      resolve({
        success: false,
        error: `Server file "${serverFile}" not found in the backend folder.`
      });
      return;
    }

    const nodeCmd = getNodePath();
    const env = {
      ...process.env,
      PORT: '3847',
      NODE_ENV: 'development'
    };

    if (process.platform === 'darwin') {
      env.PATH = `/usr/local/bin:/opt/homebrew/bin:${env.PATH}`;
    }

    serverProcess = spawn(nodeCmd, [serverFile], {
      cwd: backendDir,
      env: env,
      shell: true,
      stdio: 'pipe',
      windowsHide: true
    });

    let startupOutput = '';
    let hasResolved = false;

    serverProcess.stdout.on('data', (data) => {
      const output = data.toString();
      startupOutput += output;
      console.log('[Server stdout]:', output);

      // If we see a "listening" message, server started successfully
      if (!hasResolved && (
        output.toLowerCase().includes('listening') ||
        output.toLowerCase().includes('running') ||
        output.toLowerCase().includes('started') ||
        output.toLowerCase().includes('server on') ||
        output.toLowerCase().includes('port')
      )) {
        hasResolved = true;
        resolve({ success: true });
      }
    });

    serverProcess.stderr.on('data', (data) => {
      const output = data.toString();
      startupOutput += output;
      console.error('[Server stderr]:', output);

      // Some servers log to stderr (like nodemon)
      if (!hasResolved && (
        output.toLowerCase().includes('listening') ||
        output.toLowerCase().includes('running') ||
        output.toLowerCase().includes('started')
      )) {
        hasResolved = true;
        resolve({ success: true });
      }
    });

    serverProcess.on('error', (error) => {
      if (!hasResolved) {
        hasResolved = true;
        resolve({
          success: false,
          error: `Could not start the server: ${error.message}. Make sure Node.js is installed.`
        });
      }
    });

    serverProcess.on('close', (code) => {
      if (!hasResolved) {
        hasResolved = true;
        if (code !== 0) {
          resolve({
            success: false,
            error: startupOutput || `Server process exited with code ${code}`
          });
        }
      }
      serverProcess = null;
    });

    // Give the server time to start, then check if it's responding
    setTimeout(() => {
      if (!hasResolved) {
        // Check if the server is responding
        checkServerHealth('http://localhost:3847')
          .then((isAlive) => {
            if (!hasResolved) {
              hasResolved = true;
              if (isAlive) {
                resolve({ success: true });
              } else if (serverProcess && !serverProcess.killed) {
                // Process is still running, assume it's working
                resolve({ success: true });
              } else {
                resolve({
                  success: false,
                  error: startupOutput || 'Server did not respond within the expected time.'
                });
              }
            }
          });
      }
    }, 5000);

    // Final timeout
    setTimeout(() => {
      if (!hasResolved) {
        hasResolved = true;
        if (serverProcess && !serverProcess.killed) {
          resolve({ success: true });
        } else {
          resolve({
            success: false,
            error: 'Server failed to start within 15 seconds.'
          });
        }
      }
    }, 15000);
  });
}

function startStaticServer(frontendDir) {
  return new Promise((resolve) => {
    stopServer();

    try {
      const express = require('express');
      const app = express();
      const cors = require('cors');

      app.use(cors());
      app.use(express.static(frontendDir));

      app.get('*', (req, res) => {
        const indexPath = path.join(frontendDir, 'index.html');
        if (fs.existsSync(indexPath)) {
          res.sendFile(indexPath);
        } else {
          // Find any HTML file
          const files = fs.readdirSync(frontendDir);
          const htmlFile = files.find(f => f.endsWith('.html'));
          if (htmlFile) {
            res.sendFile(path.join(frontendDir, htmlFile));
          } else {
            res.send('<h1>No HTML file found</h1>');
          }
        }
      });

      staticServerInstance = app.listen(3847, () => {
        resolve({ success: true });
      });

      staticServerInstance.on('error', (error) => {
        resolve({
          success: false,
          error: `Could not start static server: ${error.message}`
        });
      });
    } catch (error) {
      // Fallback: use http module
      try {
        const httpServer = http.createServer((req, res) => {
          let filePath = path.join(frontendDir, req.url === '/' ? 'index.html' : req.url);
          
          if (!fs.existsSync(filePath)) {
            filePath = path.join(frontendDir, 'index.html');
          }

          if (fs.existsSync(filePath)) {
            const ext = path.extname(filePath);
            const mimeTypes = {
              '.html': 'text/html',
              '.css': 'text/css',
              '.js': 'text/javascript',
              '.json': 'application/json',
              '.png': 'image/png',
              '.jpg': 'image/jpeg',
              '.gif': 'image/gif',
              '.svg': 'image/svg+xml',
              '.ico': 'image/x-icon'
            };

            res.writeHead(200, {
              'Content-Type': mimeTypes[ext] || 'text/plain',
              'Access-Control-Allow-Origin': '*'
            });
            fs.createReadStream(filePath).pipe(res);
          } else {
            res.writeHead(404);
            res.end('Not found');
          }
        });

        staticServerInstance = httpServer;
        httpServer.listen(3847, () => {
          resolve({ success: true });
        });
      } catch (fallbackError) {
        resolve({
          success: false,
          error: `Could not start any server: ${fallbackError.message}`
        });
      }
    }
  });
}

function checkServerHealth(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      resolve(true);
      res.resume();
    });
    req.on('error', () => {
      resolve(false);
    });
    req.setTimeout(3000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

function stopServer() {
  if (serverProcess) {
    try {
      const treeKill = require('tree-kill');
      treeKill(serverProcess.pid, 'SIGTERM');
    } catch (e) {
      try {
        serverProcess.kill('SIGTERM');
      } catch (e2) {}
    }
    serverProcess = null;
  }

  if (staticServerInstance) {
    try {
      staticServerInstance.close();
    } catch (e) {}
    staticServerInstance = null;
  }
}

function isServerRunning() {
  return serverProcess !== null || staticServerInstance !== null;
}

module.exports = {
  startServer,
  startStaticServer,
  stopServer,
  isServerRunning
};