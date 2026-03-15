const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, exec } = require('child_process');

function getProjectPath() {
  const desktop = path.join(os.homedir(), 'Desktop');
  const projectPath = path.join(desktop, 'deplomot-project');
  return projectPath;
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function forceKillHandles(dirPath) {
  if (process.platform === 'win32') {
    try {
      // Kill any node processes that might be holding files in this directory
      
    } catch (e) {
      // Ignore — process may not exist
    }

    try {
      // Use Windows handle utility to release locks if available
      execSync(`rd /s /q "${dirPath}" 2>nul`, { stdio: 'ignore', windowsHide: true });
    } catch (e) {
      // Ignore — fallback to Node.js deletion
    }
  }
}

function forceDeleteFile(filePath) {
  try {
    // Remove read-only flag on Windows
    if (process.platform === 'win32') {
      try {
        fs.chmodSync(filePath, 0o666);
      } catch (e) {}
    }
    fs.unlinkSync(filePath);
  } catch (e) {
    // Ignore individual file deletion failures
  }
}

function forceDeleteDirContents(dirPath) {
  if (!fs.existsSync(dirPath)) return;

  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        forceDeleteDirContents(fullPath);
        try {
          fs.rmdirSync(fullPath);
        } catch (e) {
          // Will retry at parent level
        }
      } else {
        forceDeleteFile(fullPath);
      }
    }
  } catch (e) {
    // Directory might already be gone
  }
}

async function cleanDir(dirPath) {
  const MAX_RETRIES = 5;
  const RETRY_DELAY = 1000;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (fs.existsSync(dirPath)) {
        // Attempt 1-2: Try normal Node.js removal
        if (attempt <= 2) {
          fs.rmSync(dirPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 });
        } else {
          // Attempt 3+: Force kill handles then try manual cleanup
          console.log(`[FileManager] Attempt ${attempt}: Force killing file handles...`);
          forceKillHandles(dirPath);

          // Wait a moment for handles to release
          await new Promise(resolve => setTimeout(resolve, 500));

          // Manual recursive delete with chmod
          forceDeleteDirContents(dirPath);

          // Try removing the now-empty directory
          try {
            fs.rmdirSync(dirPath, { recursive: true });
          } catch (e) {
            // If dir still exists, try rmSync one more time
            if (fs.existsSync(dirPath)) {
              fs.rmSync(dirPath, { recursive: true, force: true });
            }
          }
        }
      }

      // Create fresh directory
      fs.mkdirSync(dirPath, { recursive: true });

      // Verify it worked
      if (fs.existsSync(dirPath)) {
        console.log(`[FileManager] Directory cleaned successfully on attempt ${attempt}`);
        return;
      }

    } catch (error) {
      const isRetryable = error.code === 'EBUSY' ||
                          error.code === 'EPERM' ||
                          error.code === 'EACCES' ||
                          error.code === 'ENOTEMPTY' ||
                          error.code === 'ENFILE' ||
                          error.code === 'EMFILE';

      console.error(`[FileManager] Attempt ${attempt}/${MAX_RETRIES} failed: ${error.code || error.message}`);

      if (attempt === MAX_RETRIES) {
        // Last resort: try to just overwrite files instead of deleting
        console.error('[FileManager] All delete attempts failed. Attempting to write over existing files...');
        
        // Force kill node processes that might be holding files
        exec('taskkill /F /IM node.exe', () => {});
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        try {
          ensureDir(dirPath);
          return;
        } catch (finalError) {
          throw new Error(`Cannot clean project folder after ${MAX_RETRIES} attempts. Close any programs using files in ${dirPath} and try again. (${error.code})`);
        }
      }

      if (isRetryable) {
        console.log(`[FileManager] Retryable error ${error.code}, waiting ${RETRY_DELAY}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
      } else {
        throw error;
      }
    }
  }
}

async function createProject(analysis) {
  const projectPath = getProjectPath();

  // Clean and recreate with retry logic
  await cleanDir(projectPath);

  const frontendPath = path.join(projectPath, 'public');
  const backendPath = projectPath; // Backend files go directly to project root
  ensureDir(frontendPath);
  ensureDir(backendPath);

  // Write frontend files to public/ directory
  if (analysis.frontend && analysis.frontend.files) {
    for (const file of analysis.frontend.files) {
      const filePath = path.join(frontendPath, file.filename);
      const fileDir = path.dirname(filePath);
      ensureDir(fileDir);
      fs.writeFileSync(filePath, file.content, 'utf8');
    }
  }

  // Write backend files directly to project root
  if (analysis.backend && analysis.backend.files) {
    for (const file of analysis.backend.files) {
      const filePath = path.join(backendPath, file.filename);
      const fileDir = path.dirname(filePath);
      ensureDir(fileDir);
      fs.writeFileSync(filePath, file.content, 'utf8');
    }
  }

  // Write database files
  if (analysis.database && analysis.database.detected && analysis.database.files) {
    const dbPath = path.join(projectPath, 'database');
    ensureDir(dbPath);
    for (const file of analysis.database.files) {
      const filePath = path.join(dbPath, file.filename);
      const fileDir = path.dirname(filePath);
      ensureDir(fileDir);
      fs.writeFileSync(filePath, file.content, 'utf8');
    }
  }

  return projectPath;
}

module.exports = {
  createProject,
  getProjectPath
};