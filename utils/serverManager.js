const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');
const dependencyInstaller = require('./dependencyInstaller');

let serverProcess = null;
let staticServerInstance = null;

function getNodePath() {
  return dependencyInstaller.getBundledNodePath();
}

function startServer(projectRoot, serverFile) {
  return new Promise((resolve) => {
    // Kill any existing server
    stopServer();

    const serverFilePath = path.join(projectRoot, serverFile);

    if (!fs.existsSync(serverFilePath)) {
      resolve({
        success: false,
        error: `Server file "${serverFile}" not found in the project folder.`
      });
      return;
    }

    const nodeCmd = getNodePath();
    const nodeDir = path.dirname(nodeCmd);
    const env = {
      ...process.env,
      PORT: '3847',
      NODE_ENV: 'development'
    };

    // Add bundled node to PATH
    if (process.platform === 'win32') {
      env.PATH = `${nodeDir};${env.PATH}`;
    } else {
      env.PATH = `${nodeDir}:${env.PATH}`;
    }

    serverProcess = spawn(nodeCmd, [serverFile], {
      cwd: projectRoot,
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

function startStaticServer(projectRoot) {
  return new Promise((resolve) => {
    stopServer();

    console.log('[StaticServer] projectRoot:', projectRoot);

    // Check multiple possible locations for static files in order
    const possibleLocations = [
      path.join(projectRoot, 'public'),
      path.join(projectRoot, 'frontend'),
      projectRoot
    ];

    let staticDir = null;
    for (const location of possibleLocations) {
      console.log('[StaticServer] Checking:', location, 'exists:', fs.existsSync(location));
      if (fs.existsSync(location) && hasFrontendFiles(location)) {
        staticDir = location;
        console.log('[StaticServer] Found staticDir:', staticDir);
        break;
      }
    }

    // If none of the preferred locations have frontend files, fallback to frontend directory
    if (!staticDir) {
      staticDir = path.join(projectRoot, 'public');
      console.log('[StaticServer] Using fallback staticDir:', staticDir);
      // Create the directory if it doesn't exist to prevent errors
      if (!fs.existsSync(staticDir)) {
        fs.mkdirSync(staticDir, { recursive: true });
      }
    }

    // Log what files exist in staticDir
    if (fs.existsSync(staticDir)) {
      console.log('[StaticServer] Files in', staticDir, ':', fs.readdirSync(staticDir));
    }

    try {
      const express = require('express');
      const app = express();
      const cors = require('cors');

      app.use(cors());
      app.use(express.static(staticDir, { index: ['index.html', 'index.htm'] }));

      app.get('/', (req, res) => {
        const indexPath = path.join(staticDir, 'index.html');
        if (fs.existsSync(indexPath)) {
          res.sendFile(indexPath);
        } else {
          const files = fs.readdirSync(staticDir);
          const htmlFile = files.find(f => f.endsWith('.html'));
          if (htmlFile) {
            res.sendFile(path.join(staticDir, htmlFile));
          } else {
            res.send('<h1>No HTML file found</h1>');
          }
        }
      });

      app.get('*', (req, res) => {
        const indexPath = path.join(staticDir, 'index.html');
        if (fs.existsSync(indexPath)) {
          res.sendFile(indexPath);
        } else {
          // Find any HTML file
          const files = fs.readdirSync(staticDir);
          const htmlFile = files.find(f => f.endsWith('.html'));
          if (htmlFile) {
            res.sendFile(path.join(staticDir, htmlFile));
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
          let filePath = path.join(staticDir, req.url === '/' ? 'index.html' : req.url);
          
          if (!fs.existsSync(filePath)) {
            filePath = path.join(staticDir, 'index.html');
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

// Helper function to check if a directory contains frontend files
function hasFrontendFiles(dir) {
  try {
    const files = fs.readdirSync(dir);
    return files.some(file => {
      const lowerCase = file.toLowerCase();
      return lowerCase === 'index.html' || lowerCase.endsWith('.html');
    });
  } catch (err) {
    return false;
  }
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