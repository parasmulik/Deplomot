const {
  app,
  BrowserWindow,
  ipcMain,
  shell,
  dialog,
  Menu
} = require('electron');
const path = require('path');
const { execSync } = require('child_process');
const fs = require('fs');
const archiver = require('archiver');
const os = require('os');
const configManager = require('./utils/config');
const groqAPI = require('./utils/groq');
const fileManager = require('./utils/fileManager');
const serverManager = require('./utils/serverManager');
const dependencyInstaller = require('./utils/dependencyInstaller');

let mainWindow = null;
let setupWindow = null;
let previewWindow = null;
let lastRequestTime = 0;
const RATE_LIMIT_MS = 10000;

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    backgroundColor: '#0d0d0d',
    titleBarStyle: 'hiddenInset',
    frame: process.platform === 'darwin' ? true : true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    icon: path.join(__dirname, 'assets', 'icon.png'),
    show: false
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (previewWindow && !previewWindow.isDestroyed()) {
      previewWindow.close();
    }
    serverManager.stopServer();
  });
}

function createSetupWindow() {
  setupWindow = new BrowserWindow({
    width: 550,
    height: 480,
    resizable: false,
    backgroundColor: '#0d0d0d',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    icon: path.join(__dirname, 'assets', 'icon.png'),
    show: false
  });

  setupWindow.loadFile(path.join(__dirname, 'src', 'setup.html'));

  setupWindow.once('ready-to-show', () => {
    setupWindow.show();
  });

  setupWindow.on('closed', () => {
    setupWindow = null;
  });
}

function createPreviewWindow(url) {
  if (previewWindow && !previewWindow.isDestroyed()) {
    previewWindow.loadURL(url);
    previewWindow.focus();
    return;
  }

  previewWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 600,
    minHeight: 400,
    backgroundColor: '#0d0d0d',
    title: 'Deplomot - Live Preview',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true
    },
    icon: path.join(__dirname, 'assets', 'icon.png'),
    show: false
  });

  const previewHTML = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Deplomot - Live Preview</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { background: #0d0d0d; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; overflow: hidden; }
        .toolbar {
          height: 48px;
          background: #1a1a2e;
          display: flex;
          align-items: center;
          padding: 0 16px;
          gap: 10px;
          border-bottom: 1px solid #2a2a3e;
          -webkit-app-region: drag;
        }
        .toolbar button {
          -webkit-app-region: no-drag;
          background: #2a2a3e;
          color: #e0e0e0;
          border: 1px solid #3a3a4e;
          padding: 6px 14px;
          border-radius: 6px;
          cursor: pointer;
          font-size: 13px;
          transition: all 0.2s;
        }
        .toolbar button:hover { background: #3a3a4e; border-color: #6c63ff; }
        .toolbar .url-bar {
          flex: 1;
          background: #0d0d0d;
          color: #888;
          border: 1px solid #2a2a3e;
          padding: 6px 12px;
          border-radius: 6px;
          font-size: 13px;
          -webkit-app-region: no-drag;
        }
        .toolbar .status-dot {
          width: 8px; height: 8px;
          background: #4ade80;
          border-radius: 50%;
          animation: pulse 2s infinite;
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        webview {
          width: 100%;
          height: calc(100vh - 48px);
          border: none;
        }
      </style>
    </head>
    <body>
      <div class="toolbar">
        <div class="status-dot"></div>
        <input class="url-bar" value="${url}" readonly />
        <button onclick="document.querySelector('webview').reload()">↻ Refresh</button>
        <button onclick="window.electronAPI.openExternal('${url}')">↗ Open in Browser</button>
      </div>
      <webview src="${url}" id="preview-webview"></webview>
      <script>
        const webview = document.getElementById('preview-webview');
        webview.addEventListener('did-fail-load', (e) => {
          if (e.errorCode !== -3) {
            setTimeout(() => webview.reload(), 2000);
          }
        });
      </script>
    </body>
    </html>
  `;

  const tempPath = path.join(app.getPath('temp'), 'Deplomot-preview.html');
  fs.writeFileSync(tempPath, previewHTML);
  previewWindow.loadFile(tempPath);

  previewWindow.once('ready-to-show', () => {
    previewWindow.show();
  });

  previewWindow.on('closed', () => {
    previewWindow = null;
  });
}

app.whenReady().then(async () => {
  const config = configManager.loadConfig();

  Menu.setApplicationMenu(null);

  createMainWindow();

  mainWindow.webContents.send('status-update', {
    step: 'setup',
    message: 'Setting up Deplomot for the first time... Downloading Node.js (~30MB)'
  });

  const nodeCheck = await dependencyInstaller.checkAndInstallNode();
  if (nodeCheck.wasInstalled) {
    mainWindow.webContents.send('status-update', {
      step: 'ready',
      message: 'Setup complete! You can now use Deplomot.'
    });
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const config = configManager.loadConfig();
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  serverManager.stopServer();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  serverManager.stopServer();
});

// IPC Handlers

ipcMain.handle('save-api-key', async (event, apiKey) => {
  try {
    configManager.saveConfig({ groqApiKey: apiKey });
    if (setupWindow && !setupWindow.isDestroyed()) {
      setupWindow.close();
    }
    
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-api-key', async () => {
  const config = configManager.loadConfig();
  return config.groqApiKey || null;
});

ipcMain.handle('update-api-key', async (event, apiKey) => {
  try {
    configManager.saveConfig({ groqApiKey: apiKey });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('analyze-and-run', async (event, pastedCode) => {
  const now = Date.now();
  if (lastRequestTime && (now - lastRequestTime) < RATE_LIMIT_MS) {
    mainWindow.webContents.send('status-update', {
      step: 'error',
      message: 'Please wait a few seconds before analyzing again.'
    });
    return { success: false, error: 'Rate limit exceeded' };
  }
  lastRequestTime = now;

  try {
    // Check/install bundled Node.js with status callback
    const sendStatus = (message) => {
      mainWindow.webContents.send('status-update', {
        step: 'setup',
        message: message
      });
    };
    
    const nodeCheck = await dependencyInstaller.checkAndInstallNode(sendStatus);
    if (nodeCheck.wasInstalled) {
      // Brief pause after setup before continuing
      await new Promise(resolve => setTimeout(resolve, 1500));
    }

    serverManager.stopServer();
    await new Promise(resolve => setTimeout(resolve, 2000));
    const config = configManager.loadConfig();
    
    // Step 1: Send status
    mainWindow.webContents.send('status-update', {
      step: 'analyzing',
      message: 'Analyzing your code with AI...'
    });

    // Step 2: Call Groq API
    let analysisResult = await groqAPI.analyzeCode(pastedCode);

    if (!analysisResult) {
      // Retry once
      mainWindow.webContents.send('status-update', {
        step: 'retrying',
        message: 'First attempt failed, retrying analysis...'
      });
      analysisResult = await groqAPI.analyzeCode(pastedCode);
    }

    if (!analysisResult) {
      return {
        success: false,
        error: 'The AI could not understand the code you pasted. Please make sure you\'re pasting valid code from an AI tool like ChatGPT or Claude.'
      };
    }

    // Step 3: Auto-wire URLs
    mainWindow.webContents.send('status-update', {
      step: 'wiring',
      message: 'Configuring connections between frontend and backend...'
    });

    analysisResult = autoWireUrls(analysisResult);

    // Step 4: Create files
    mainWindow.webContents.send('status-update', {
      step: 'creating-files',
      message: 'Creating project files...'
    });

    const projectPath = await fileManager.createProject(analysisResult);

    // Step 5: Install dependencies
    if (analysisResult.dependencies &&
        analysisResult.dependencies.backend &&
        analysisResult.dependencies.backend.length > 0) {
      mainWindow.webContents.send('status-update', {
        step: 'installing',
        message: 'Installing backend dependencies... This may take a moment.'
      });

      const backendPath = path.join(projectPath, 'backend');
      const installResult = await dependencyInstaller.installDependencies(
        backendPath,
        analysisResult.dependencies.backend
      );

      if (!installResult.success) {
        return {
          success: false,
          error: `Could not install some required packages. This might be because:\n\n• You don't have Node.js installed\n• Your internet connection is down\n• Some packages are not available\n\nTechnical detail: ${installResult.error}`
        };
      }
    }

    if (analysisResult.dependencies &&
        analysisResult.dependencies.frontend &&
        analysisResult.dependencies.frontend.length > 0) {
      mainWindow.webContents.send('status-update', {
        step: 'installing-frontend',
        message: 'Installing frontend dependencies...'
      });

      const frontendPath = path.join(projectPath, 'frontend');
      await dependencyInstaller.installDependencies(
        frontendPath,
        analysisResult.dependencies.frontend
      );
    }

    // Step 6: Determine what to serve
    const hasBackend = analysisResult.backend &&
                       analysisResult.backend.files &&
                       analysisResult.backend.files.length > 0;

    const hasFrontend = analysisResult.frontend &&
                        analysisResult.frontend.files &&
                        analysisResult.frontend.files.length > 0;

    let previewUrl = `http://localhost:3847`;

    if (hasBackend) {
      // Step 7: Start backend server
      mainWindow.webContents.send('status-update', {
        step: 'starting',
        message: 'Starting your website...'
      });

      const backendPath = path.join(projectPath, 'backend');

      // Find the main server file
      let serverFile = 'server.js';
      const backendFiles = analysisResult.backend.files.map(f => f.filename);
      if (backendFiles.includes('app.js') && !backendFiles.includes('server.js')) {
        serverFile = 'app.js';
      } else if (backendFiles.includes('index.js') && !backendFiles.includes('server.js')) {
        serverFile = 'index.js';
      }

      const serverResult = await serverManager.startServer(backendPath, serverFile);

      if (!serverResult.success) {
        return {
          success: false,
          error: `Your website's server couldn't start. This usually means:\n\n• The code might have a bug\n• A required package is missing\n• Port 3847 might be in use by another app\n\nTry closing other apps and trying again.\n\nDetail: ${serverResult.error}`
        };
      }
    } else if (hasFrontend) {
      // No backend, serve frontend statically
      mainWindow.webContents.send('status-update', {
        step: 'starting',
        message: 'Starting static file server...'
      });

      const frontendPath = path.join(projectPath, 'frontend');
      const serverResult = await serverManager.startStaticServer(frontendPath);

      if (!serverResult.success) {
        return {
          success: false,
          error: `Could not start the preview server. Detail: ${serverResult.error}`
        };
      }
    }

    // Step 8: Wait a moment for server to be ready, then open preview
    await new Promise(resolve => setTimeout(resolve, 2000));

    mainWindow.webContents.send('status-update', {
      step: 'ready',
      message: 'Your website is running!'
    });

    // Open preview window
    createPreviewWindow(previewUrl);
    mainWindow.minimize();

    // Build file list for results panel
    const fileList = [];
    if (analysisResult.frontend && analysisResult.frontend.files) {
      analysisResult.frontend.files.forEach(f => {
        fileList.push({ filename: f.filename, category: 'Frontend', content: f.content });
      });
    }
    if (analysisResult.backend && analysisResult.backend.files) {
      analysisResult.backend.files.forEach(f => {
        fileList.push({ filename: f.filename, category: 'Backend', content: f.content });
      });
    }
    if (analysisResult.database && analysisResult.database.detected && analysisResult.database.files) {
      analysisResult.database.files.forEach(f => {
        fileList.push({ filename: f.filename, category: 'Database', content: f.content });
      });
    }

    return {
      success: true,
      summary: analysisResult.summary || 'Your website is ready!',
      files: fileList,
      projectPath: projectPath,
      previewUrl: previewUrl
    };

  } catch (error) {
    return {
      success: false,
      error: `Something unexpected happened: ${error.message}\n\nPlease try pasting your code again.`
    };
  }
});

ipcMain.handle('stop-server', async () => {
  serverManager.stopServer();
  await new Promise(resolve => setTimeout(resolve, 2000));
  return { success: true };
});

ipcMain.handle('open-external', async (event, url) => {
  shell.openExternal(url);
});

ipcMain.handle('open-project-folder', async (event, projectPath) => {
  shell.openPath(projectPath);
});

ipcMain.handle('refresh-preview', async () => {
  if (previewWindow && !previewWindow.isDestroyed()) {
    previewWindow.webContents.reload();
  }
});

ipcMain.handle('open-preview', async () => {
  createPreviewWindow('http://localhost:3847');
});
ipcMain.handle('ai-fix', async (event, { originalCode, errorMessage, projectFiles }) => {
  try {
    mainWindow.webContents.send('status-update', {
      step: 'analyzing',
      message: '🔧 AI is analyzing the error...'
    });

    const fixResult = await groqAPI.fixCode(originalCode, errorMessage, projectFiles);

    if (!fixResult) {
      return {
        success: false,
        error: 'AI could not figure out a fix. Try modifying your original code and pasting again.'
      };
    }

    // Stop existing server
    serverManager.stopServer();
    await new Promise(resolve => setTimeout(resolve, 2000));

    mainWindow.webContents.send('status-update', {
      step: 'wiring',
      message: '🔧 Applying fixes...'
    });

    const fixedAnalysis = autoWireUrls(fixResult);

    mainWindow.webContents.send('status-update', {
      step: 'creating-files',
      message: '🔧 Writing fixed files...'
    });

    const projectPath = await fileManager.createProject(fixedAnalysis);

    // Install dependencies
    if (fixedAnalysis.dependencies &&
        fixedAnalysis.dependencies.backend &&
        fixedAnalysis.dependencies.backend.length > 0) {
      mainWindow.webContents.send('status-update', {
        step: 'installing',
        message: '🔧 Installing dependencies...'
      });

      const backendPath = path.join(projectPath, 'backend');
      const installResult = await dependencyInstaller.installDependencies(
        backendPath,
        fixedAnalysis.dependencies.backend
      );

      if (!installResult.success) {
        return {
          success: false,
          error: `Could not install packages after fix: ${installResult.error}`
        };
      }
    }

    // Start server
    const hasBackend = fixedAnalysis.backend &&
                       fixedAnalysis.backend.files &&
                       fixedAnalysis.backend.files.length > 0;
    const hasFrontend = fixedAnalysis.frontend &&
                        fixedAnalysis.frontend.files &&
                        fixedAnalysis.frontend.files.length > 0;

    let previewUrl = 'http://localhost:3847';

    if (hasBackend) {
      mainWindow.webContents.send('status-update', {
        step: 'starting',
        message: '🔧 Starting fixed server...'
      });

      const backendPath = path.join(projectPath, 'backend');
      let serverFile = 'server.js';
      const backendFiles = fixedAnalysis.backend.files.map(f => f.filename);
      if (backendFiles.includes('app.js') && !backendFiles.includes('server.js')) {
        serverFile = 'app.js';
      } else if (backendFiles.includes('index.js') && !backendFiles.includes('server.js')) {
        serverFile = 'index.js';
      }

      const serverResult = await serverManager.startServer(backendPath, serverFile);
      if (!serverResult.success) {
        return {
          success: false,
          error: `Server still won't start after AI fix: ${serverResult.error}`
        };
      }
    } else if (hasFrontend) {
      const frontendPath = path.join(projectPath, 'frontend');
      const serverResult = await serverManager.startStaticServer(frontendPath);
      if (!serverResult.success) {
        return { success: false, error: `Static server failed: ${serverResult.error}` };
      }
    }

    await new Promise(resolve => setTimeout(resolve, 2000));

    mainWindow.webContents.send('status-update', {
      step: 'ready',
      message: 'Your website is running!'
    });

    createPreviewWindow(previewUrl);

    // Build file list
    const fileList = [];
    if (fixedAnalysis.frontend && fixedAnalysis.frontend.files) {
      fixedAnalysis.frontend.files.forEach(f => {
        fileList.push({ filename: f.filename, category: 'Frontend', content: f.content });
      });
    }
    if (fixedAnalysis.backend && fixedAnalysis.backend.files) {
      fixedAnalysis.backend.files.forEach(f => {
        fileList.push({ filename: f.filename, category: 'Backend', content: f.content });
      });
    }
    if (fixedAnalysis.database && fixedAnalysis.database.detected && fixedAnalysis.database.files) {
      fixedAnalysis.database.files.forEach(f => {
        fileList.push({ filename: f.filename, category: 'Database', content: f.content });
      });
    }

    return {
      success: true,
      summary: fixResult.summary,
      issuesFixed: fixResult.issuesFound || 1,
      files: fileList,
      projectPath: projectPath,
      previewUrl: previewUrl
    };

  } catch (error) {
    return {
      success: false,
      error: `AI Fix failed: ${error.message}`
    };
  }
});

function autoWireUrls(analysis) {
  const backendPort = 3847;
  const localhostPatterns = [
    /http:\/\/localhost:\d+/g,
    /http:\/\/127\.0\.0\.1:\d+/g,
    /https:\/\/localhost:\d+/g
  ];

  if (analysis.frontend && analysis.frontend.files) {
    analysis.frontend.files = analysis.frontend.files.map(file => {
      let content = file.content;
      localhostPatterns.forEach(pattern => {
        content = content.replace(pattern, `http://localhost:${backendPort}`);
      });
      return { ...file, content };
    });
  }

  if (analysis.backend && analysis.backend.files) {
    analysis.backend.files = analysis.backend.files.map(file => {
      let content = file.content;
      // Fix port in backend files
      const portPatterns = [
        /const\s+PORT\s*=\s*process\.env\.PORT\s*\|\|\s*\d+/g,
        /const\s+port\s*=\s*process\.env\.PORT\s*\|\|\s*\d+/g,
        /let\s+PORT\s*=\s*process\.env\.PORT\s*\|\|\s*\d+/g,
        /let\s+port\s*=\s*process\.env\.PORT\s*\|\|\s*\d+/g,
        /\.listen\(\s*\d+/g,
      ];

      content = content.replace(
        /const\s+(PORT|port)\s*=\s*(?:process\.env\.PORT\s*\|\|\s*)?\d+/g,
        `const PORT = process.env.PORT || ${backendPort}`
      );
      content = content.replace(
        /let\s+(PORT|port)\s*=\s*(?:process\.env\.PORT\s*\|\|\s*)?\d+/g,
        `const PORT = process.env.PORT || ${backendPort}`
      );
      content = content.replace(
        /app\.listen\(\s*\d+/g,
        `app.listen(${backendPort}`
      );

      return { ...file, content };
    });
  }

  // If frontend files exist but no backend is serving them, inject static serving into backend
  if (analysis.frontend && analysis.frontend.files && analysis.frontend.files.length > 0 &&
      analysis.backend && analysis.backend.files && analysis.backend.files.length > 0) {

    const mainServerFile = analysis.backend.files.find(
      f => f.filename === 'server.js' || f.filename === 'app.js' || f.filename === 'index.js'
    );

    if (mainServerFile && !mainServerFile.content.includes('express.static')) {
      // Add static file serving for frontend
      const staticServeCode = `\n// Serve frontend files\nconst frontendPath = require('path').join(__dirname, '..', 'frontend');\napp.use(require('express').static(frontendPath));\n`;

      // Try to insert before the listen call
      const listenIndex = mainServerFile.content.lastIndexOf('app.listen(');
if (listenIndex !== -1) {
  mainServerFile.content =
    mainServerFile.content.slice(0, listenIndex) +
    staticServeCode +
    mainServerFile.content.slice(listenIndex);
}
    }
  }

  return analysis;
}

// IPC Handlers for project saving

ipcMain.handle('save-project', async (event, { name, code, summary }) => {
  const project = {
    id: Date.now().toString(),
    name: name,
    code: code,
    summary: summary,
    date: new Date().toISOString()
  };
  configManager.saveProject(project);
  return { success: true, project };
});

ipcMain.handle('get-projects', async () => {
  return configManager.getProjects();
});

ipcMain.handle('delete-project', async (event, id) => {
  configManager.deleteProject(id);
  return { success: true };
});

ipcMain.handle('export-project', async (event, projectPath) => {
  return new Promise((resolve) => {
    const downloadsPath = app.getPath('downloads');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const zipFileName = `deplomot-export-${timestamp}.zip`;
    const zipPath = path.join(downloadsPath, zipFileName);
    
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    
    output.on('close', () => {
      resolve({ success: true, path: zipPath });
    });
    
    archive.on('error', (err) => {
      resolve({ success: false, error: err.message });
    });
    
    archive.pipe(output);
    archive.directory(projectPath, false);
    archive.finalize();
  });
});
