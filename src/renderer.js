document.addEventListener('DOMContentLoaded', () => {
  // Elements
  const codeInput = document.getElementById('code-input');
  const charCount = document.getElementById('char-count');
  const btnClear = document.getElementById('btn-clear');
  const btnRun = document.getElementById('btn-run');
  const runBtnText = document.getElementById('run-btn-text');
  const runBtnLoader = document.getElementById('run-btn-loader');

  const heroSection = document.getElementById('hero-section');
  const loadingSection = document.getElementById('loading-section');
  const errorSection = document.getElementById('error-section');

  const statusSection = document.getElementById('status-section');
  const summarySection = document.getElementById('summary-section');
  const filesSection = document.getElementById('files-section');
  const actionsSection = document.getElementById('actions-section');

  const statusDot = document.getElementById('status-dot');
  const statusText = document.getElementById('status-text');
  const summaryText = document.getElementById('summary-text');
  const filesList = document.getElementById('files-list');

  const errorMessage = document.getElementById('error-message');
  const btnRetry = document.getElementById('btn-retry');
  const btnAiFix = document.getElementById('btn-ai-fix');
  let lastErrorMessage = '';
  let lastProjectFiles = [];

  const loadingTitle = document.getElementById('loading-title');
  const loadingSubtitle = document.getElementById('loading-subtitle');
  const loadingSteps = document.getElementById('loading-steps');

  const btnOpenPreview = document.getElementById('btn-open-preview');
  const btnOpenFolder = document.getElementById('btn-open-folder');
  const btnStopServer = document.getElementById('btn-stop-server');
  const btnDownloadZip = document.getElementById('btn-download-zip');
  const btnSettings = document.getElementById('btn-settings');

  const settingsModal = document.getElementById('settings-modal');
  const btnCloseSettings = document.getElementById('btn-close-settings');

  const promptModal = document.getElementById('prompt-modal');
  const btnClosePrompt = document.getElementById('btn-close-prompt');
  const btnAiPrompt = document.getElementById('btn-ai-prompt');

  const saveSection = document.getElementById('save-section');
  const projectNameInput = document.getElementById('project-name');
  const btnSaveProject = document.getElementById('btn-save-project');
  const saveMessage = document.getElementById('save-message');

  const consolePanel = document.getElementById('console-panel');
  const consoleToggle = document.getElementById('console-toggle');
  const consoleContent = document.getElementById('console-content');
  const consoleClear = document.getElementById('console-clear');

  const toast = document.getElementById('toast');
  const toastTitle = document.getElementById('toast-title');
  const toastPath = document.getElementById('toast-path');

  let currentProjectPath = '';
  let currentPreviewUrl = '';
  let lastPastedCode = '';
  let currentSummary = '';
  let projects = [];
  let draftSaveTimeout = null;

  const DRAFT_KEY = 'deplomot-draft';

  // Draft indicator element
  const draftIndicator = document.getElementById('draft-indicator');

  function showDraftSaved() {
    draftIndicator.classList.add('show');
    setTimeout(() => {
      draftIndicator.classList.remove('show');
    }, 1500);
  }

  function saveDraft(content) {
    if (content && content.trim()) {
      localStorage.setItem(DRAFT_KEY, content);
      showDraftSaved();
    }
  }

  function clearDraft() {
    localStorage.removeItem(DRAFT_KEY);
  }

  function loadDraft() {
    const draft = localStorage.getItem(DRAFT_KEY);
    if (draft && draft.trim()) {
      codeInput.value = draft;
      charCount.textContent = `${draft.length.toLocaleString()} character${draft.length !== 1 ? 's' : ''}`;
      
      // Show draft restored notification
      draftIndicator.textContent = 'Draft restored';
      draftIndicator.classList.add('show');
      setTimeout(() => {
        draftIndicator.textContent = 'Draft saved';
        draftIndicator.classList.remove('show');
      }, 2000);
    }
  }

  // Check for draft on startup
  loadDraft();

  // Character count and debounced draft save
  codeInput.addEventListener('input', () => {
    const len = codeInput.value.length;
    charCount.textContent = `${len.toLocaleString()} character${len !== 1 ? 's' : ''}`;
    
    // Debounced auto-save (1 second after typing stops)
    if (draftSaveTimeout) clearTimeout(draftSaveTimeout);
    draftSaveTimeout = setTimeout(() => {
      saveDraft(codeInput.value);
    }, 1000);
  });

  // Clear button
  btnClear.addEventListener('click', () => {
    codeInput.value = '';
    charCount.textContent = '0 characters';
    clearDraft();
    codeInput.focus();
  });

  // Import button
  const btnImport = document.getElementById('btn-import');
  btnImport.addEventListener('click', async () => {
    const result = await window.electronAPI.openFileDialog();
    if (result.success && result.content) {
      codeInput.value = result.content;
      charCount.textContent = `${result.content.length.toLocaleString()} characters`;
      addConsoleLog(`📂 Imported file: ${result.path.split(/[\\/]/).pop()}`, 'success');
      saveDraft(result.content);
    } else if (result.error) {
      addConsoleLog(`Failed to import file: ${result.error}`, 'error');
    }
  });

  // Drag and drop
  const codeInputContainer = document.querySelector('.code-input-container');
  
  codeInput.addEventListener('dragover', (e) => {
    e.preventDefault();
    codeInputContainer.classList.add('drag-over');
  });

  codeInput.addEventListener('dragleave', (e) => {
    e.preventDefault();
    codeInputContainer.classList.remove('drag-over');
  });

  codeInput.addEventListener('drop', (e) => {
    e.preventDefault();
    codeInputContainer.classList.remove('drag-over');

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0];
      const validExtensions = ['.txt', '.js', '.html', '.css', '.json', '.py', '.ts', '.jsx', '.tsx', '.md'];
      const ext = '.' + file.name.split('.').pop().toLowerCase();
      
      if (validExtensions.includes(ext)) {
        const reader = new FileReader();
        reader.onload = (event) => {
          codeInput.value = event.target.result;
          charCount.textContent = `${event.target.result.length.toLocaleString()} characters`;
          addConsoleLog(`📂 Dropped file: ${file.name}`, 'success');
          saveDraft(event.target.result);
        };
        reader.onerror = () => {
          addConsoleLog(`Failed to read file: ${file.name}`, 'error');
        };
        reader.readAsText(file);
      } else {
        addConsoleLog(`Unsupported file type: ${ext}`, 'error');
      }
    }
  });

  // Console panel functions
  function getTimestamp() {
    const now = new Date();
    return now.toTimeString().split(' ')[0];
  }

  function addConsoleLog(message, type = 'info') {
    const timestamp = getTimestamp();
    const line = document.createElement('span');
    line.className = `console-line ${type}`;
    line.innerHTML = `<span class="console-timestamp">[${timestamp}]</span>${message}`;
    consoleContent.appendChild(line);
    consoleContent.scrollTop = consoleContent.scrollHeight;
  }

  function clearConsole() {
    consoleContent.innerHTML = '';
  }

  function showToast(title, path) {
    toastTitle.textContent = title;
    toastPath.textContent = path;
    toast.classList.remove('hidden', 'hiding');
    
    setTimeout(() => {
      toast.classList.add('hiding');
      setTimeout(() => {
        toast.classList.add('hidden');
      }, 300);
    }, 4000);
  }

  // Console toggle
  consoleToggle.addEventListener('click', () => {
    const isExpanded = consoleContent.style.display !== 'none';
    if (isExpanded) {
      consoleContent.style.display = 'none';
      consoleToggle.classList.remove('expanded');
    } else {
      consoleContent.style.display = 'block';
      consoleToggle.classList.add('expanded');
    }
  });

  // Console clear button
  consoleClear.addEventListener('click', clearConsole);

  // Status updates from main process
  window.electronAPI.onStatusUpdate((data) => {
    updateLoadingStep(data.step);
    loadingTitle.textContent = data.message;

    // Determine log type based on step
    let logType = 'info';
    if (data.step === 'ready' || data.step === 'done') {
      logType = 'success';
    } else if (data.step === 'error' || data.step === 'failed') {
      logType = 'error';
    } else if (data.step === 'starting') {
      logType = 'warning';
    }
    
    addConsoleLog(data.message, logType);

    const subtitles = {
      'analyzing': 'The AI is reading through your code...',
      'retrying': 'Giving it another shot...',
      'wiring': 'Making sure everything connects properly...',
      'creating-files': 'Building your project structure...',
      'installing': 'Downloading required packages...',
      'installing-frontend': 'Setting up the frontend...',
      'starting': 'Almost there! Starting your server...',
      'ready': 'Opening your website preview!'
    };

    loadingSubtitle.textContent = subtitles[data.step] || '';
  });

  // Run button
  btnRun.addEventListener('click', async () => {
    const code = codeInput.value.trim();

    if (!code) {
      showError('Please paste some code first! Copy the code from ChatGPT, Claude, or any AI tool, and paste it in the text area above.');
      return;
    }

    if (code.length < 20) {
      showError('That doesn\'t look like enough code. Please paste the complete code from your AI tool.');
      return;
    }

    lastPastedCode = code;
    showLoading();
    addConsoleLog('Starting code analysis...', 'info');

    try {
      const result = await window.electronAPI.analyzeAndRun(code);

      if (result.success) {
        currentProjectPath = result.projectPath;
        currentPreviewUrl = result.previewUrl;
        clearDraft();
        addConsoleLog('Analysis complete! Server started successfully.', 'success');
        showResults(result);
      } else {
        lastProjectFiles = result.files || [];
        addConsoleLog(`Error: ${result.error}`, 'error');
        showError(result.error, true);
      }
    } catch (error) {
      addConsoleLog(`Unexpected error: ${error.message}`, 'error');
      showError(`An unexpected error occurred: ${error.message}`);
    }
  });

  // Retry button
  btnAiFix.addEventListener('click', async () => {
    if (!lastPastedCode) return;

    btnAiFix.style.display = 'none';
    showLoading();
    loadingTitle.textContent = '🔧 AI is fixing your code...';
    loadingSubtitle.textContent = 'Analyzing the error and applying fixes...';

    try {
      const result = await window.electronAPI.aiFix({
        originalCode: lastPastedCode,
        errorMessage: lastErrorMessage,
        projectFiles: lastProjectFiles
      });

      if (result.success) {
        currentProjectPath = result.projectPath;
        currentPreviewUrl = result.previewUrl;
        result.summary = `🔧 AI found and fixed ${result.issuesFixed} issue${result.issuesFixed !== 1 ? 's' : ''}: ${result.summary}`;
        showResults(result);
      } else {
        showError(result.error, false);
      }
    } catch (error) {
      showError(`AI Fix failed: ${error.message}`, false);
    }
  });
  btnRetry.addEventListener('click', () => {
    if (lastPastedCode) {
      codeInput.value = lastPastedCode;
    }
    showHero();
    codeInput.focus();
  });

  // Action buttons
  btnOpenPreview.addEventListener('click', () => {
    window.electronAPI.openPreview();
  });

  btnOpenFolder.addEventListener('click', () => {
    if (currentProjectPath) {
      window.electronAPI.openProjectFolder(currentProjectPath);
    }
  });

  btnStopServer.addEventListener('click', async () => {
    await window.electronAPI.stopServer();
    addConsoleLog('Server stopped.', 'warning');
    statusDot.className = 'status-dot error';
    statusText.textContent = 'Stopped';
  });

  btnDownloadZip.addEventListener('click', async () => {
    if (!currentProjectPath) {
      addConsoleLog('No project to export.', 'error');
      return;
    }
    
    addConsoleLog('Exporting project as ZIP...', 'info');
    
    try {
      const result = await window.electronAPI.exportProject(currentProjectPath);
      if (result.success) {
        addConsoleLog('Project exported to Downloads folder!', 'success');
        showToast('ZIP Downloaded!', result.path);
      } else {
        addConsoleLog(`Export failed: ${result.error}`, 'error');
      }
    } catch (error) {
      addConsoleLog(`Export error: ${error.message}`, 'error');
    }
  });

  // Settings (About)
  btnSettings.addEventListener('click', async () => {
    settingsModal.style.display = 'flex';
  });

  btnCloseSettings.addEventListener('click', () => {
    settingsModal.style.display = 'none';
  });

  settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) {
      settingsModal.style.display = 'none';
    }
  });

  // AI Prompt Modal
  btnAiPrompt.addEventListener('click', () => {
    promptModal.style.display = 'flex';
  });

  btnClosePrompt.addEventListener('click', () => {
    promptModal.style.display = 'none';
  });

  promptModal.addEventListener('click', (e) => {
    if (e.target === promptModal) {
      promptModal.style.display = 'none';
    }
  });

  // Prompt copy buttons
  document.querySelectorAll('.prompt-copy-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const promptType = btn.dataset.prompt;
      let prompt = '';
      
      if (promptType === 'simple') {
        prompt = 'Build me a [describe your app] as a single HTML file. Requirements: Single HTML file with CSS and JavaScript inside it. No frameworks, no build tools, vanilla only. No external APIs that require keys. Everything self-contained in one file.';
      } else if (promptType === 'fullstack') {
        prompt = 'Build me a [describe your app] web app. Requirements: Frontend: HTML, CSS, vanilla JavaScript. Backend: Node.js with Express. Database: in-memory. CORS enabled on backend. Backend on port 3000. No .env files or API keys. Label each file clearly as // server.js and // index.html';
      } else if (promptType === 'database') {
        prompt = 'Build me a [describe your app] with data persistence. Requirements: Frontend: HTML, CSS, vanilla JavaScript. Backend: Node.js with Express. Database: SQLite using better-sqlite3. CORS enabled. Backend on port 3000. No .env files. Label files as // server.js and // index.html';
      }
      
      await navigator.clipboard.writeText(prompt);
      btn.textContent = 'Copied! ✓';
      btn.classList.add('copied');
      
      setTimeout(() => {
        btn.textContent = 'Copy';
        btn.classList.remove('copied');
      }, 2000);
    });
  });

  // Save Project
  btnSaveProject.addEventListener('click', async () => {
    const name = projectNameInput.value.trim();
    if (!name) {
      saveMessage.textContent = 'Please enter a project name.';
      saveMessage.className = 'save-message error';
      saveMessage.style.display = 'block';
      return;
    }

    const result = await window.electronAPI.saveProject({
      name: name,
      code: lastPastedCode,
      summary: currentSummary
    });

    if (result.success) {
      saveMessage.textContent = 'Project saved!';
      saveMessage.className = 'save-message success';
      saveMessage.style.display = 'block';
      projectNameInput.value = '';
      setTimeout(() => {
        saveMessage.style.display = 'none';
      }, 2000);
    } else {
      saveMessage.textContent = 'Could not save project.';
      saveMessage.className = 'save-message error';
      saveMessage.style.display = 'block';
    }
  });

  // State management functions
  function showHero() {
    heroSection.style.display = 'flex';
    loadingSection.style.display = 'none';
    errorSection.style.display = 'none';
    btnRun.disabled = false;
    runBtnText.style.display = 'inline';
    runBtnLoader.style.display = 'none';
    resetLoadingSteps();
  }

  function showLoading() {
    heroSection.style.display = 'none';
    loadingSection.style.display = 'flex';
    errorSection.style.display = 'none';
    btnRun.disabled = true;
    loadingTitle.textContent = 'Analyzing your code...';
    loadingSubtitle.textContent = 'This usually takes 10-30 seconds';
    resetLoadingSteps();

    // Show status in sidebar
    statusSection.style.display = 'block';
    statusDot.className = 'status-dot processing';
    statusText.textContent = 'Processing...';
  }

  function showError(message, showFixButton = false) {
    heroSection.style.display = 'none';
    loadingSection.style.display = 'none';
    errorSection.style.display = 'flex';
    errorSection.classList.add('fade-in');
    errorMessage.textContent = message;
    btnRun.disabled = false;
    runBtnText.style.display = 'inline';
    runBtnLoader.style.display = 'none';

    statusSection.style.display = 'block';
    statusDot.className = 'status-dot error';
    statusText.textContent = 'Error';

    lastErrorMessage = message;

    if (showFixButton && lastPastedCode) {
      btnAiFix.style.display = 'inline-flex';
    } else {
      btnAiFix.style.display = 'none';
    }
  }

  function showResults(result) {
    currentSummary = result.summary || '';
    
    // Show hero again but with success state
    heroSection.style.display = 'flex';
    loadingSection.style.display = 'none';
    errorSection.style.display = 'none';
    btnRun.disabled = false;
    runBtnText.style.display = 'inline';
    runBtnLoader.style.display = 'none';

    // Update sidebar
    statusSection.style.display = 'block';
    statusDot.className = 'status-dot running';
    statusText.textContent = 'Running';

    summarySection.style.display = 'block';
    summarySection.classList.add('slide-in');
    summaryText.textContent = result.summary;

    filesSection.style.display = 'block';
    filesSection.classList.add('slide-in');
    renderFilesList(result.files);

    actionsSection.style.display = 'block';
    actionsSection.classList.add('slide-in');

    saveSection.style.display = 'block';
    saveSection.classList.add('slide-in');
  }

  function renderFilesList(files) {
    filesList.innerHTML = '';

    const fileIcons = {
      '.html': '📄',
      '.css': '🎨',
      '.js': '⚡',
      '.json': '📋',
      '.sql': '🗄️',
      '.py': '🐍',
      '.ts': '💎',
      '.jsx': '⚛️',
      '.tsx': '⚛️',
      '.md': '📝',
      '.env': '🔒'
    };

    files.forEach((file, index) => {
      const ext = '.' + (file.filename.split('.').pop() || '');
      const icon = fileIcons[ext] || '📄';
      const categoryClass = file.category.toLowerCase();

      const item = document.createElement('div');
      item.className = 'file-item slide-in';
      item.style.animationDelay = `${index * 50}ms`;

      item.innerHTML = `
        <div class="file-info">
          <span class="file-icon">${icon}</span>
          <span class="file-name">${file.filename}</span>
        </div>
        <span class="file-category ${categoryClass}">${file.category}</span>
        <button class="file-copy-btn" data-content="${encodeURIComponent(file.content)}" title="Copy file content">
          📋
        </button>
      `;

      filesList.appendChild(item);
    });

    // Copy buttons
    filesList.querySelectorAll('.file-copy-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const content = decodeURIComponent(e.currentTarget.dataset.content);
        navigator.clipboard.writeText(content).then(() => {
          const original = e.currentTarget.textContent;
          e.currentTarget.textContent = '✓';
          setTimeout(() => {
            e.currentTarget.textContent = original;
          }, 1500);
        });
      });
    });
  }

  function updateLoadingStep(currentStep) {
    const steps = loadingSteps.querySelectorAll('.loading-step');
    let foundCurrent = false;

    const stepOrder = ['analyzing', 'wiring', 'creating-files', 'installing', 'starting'];
    const currentIndex = stepOrder.indexOf(currentStep);

    steps.forEach(step => {
      const stepName = step.dataset.step;
      const stepIndex = stepOrder.indexOf(stepName);

      if (stepIndex < currentIndex) {
        step.classList.add('done');
        step.classList.remove('active');
      } else if (stepName === currentStep) {
        step.classList.add('active');
        step.classList.remove('done');
      } else {
        step.classList.remove('active');
        step.classList.remove('done');
      }
    });
  }

  function resetLoadingSteps() {
    const steps = loadingSteps.querySelectorAll('.loading-step');
    steps.forEach(step => {
      step.classList.remove('active');
      step.classList.remove('done');
    });
  }

  // Keyboard shortcut: Ctrl/Cmd + Enter to run
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      if (!btnRun.disabled) {
        btnRun.click();
      }
    }
  });

  // Handle paste with large content gracefully
  codeInput.addEventListener('paste', () => {
    setTimeout(() => {
      const len = codeInput.value.length;
      charCount.textContent = `${len.toLocaleString()} character${len !== 1 ? 's' : ''}`;
    }, 100);
  });

  // Recent Projects
  async function loadProjects() {
    try {
      projects = await window.electronAPI.getProjects();
      const projectsList = document.getElementById('projects-list');
      
      if (projects.length === 0) {
        projectsList.innerHTML = '<p class="no-projects">No recent projects</p>';
        document.getElementById('recent-projects-section').style.display = 'none';
        return;
      }
      
      document.getElementById('recent-projects-section').style.display = 'block';
      projectsList.innerHTML = '';
      
      projects.forEach((project, index) => {
        const item = document.createElement('div');
        item.className = 'project-item';
        item.style.animationDelay = `${index * 50}ms`;
        
        const date = new Date(project.date).toLocaleString();
        item.innerHTML = `
          <div class="project-info">
            <div class="project-name">${project.name}</div>
            <div class="project-date">${date}</div>
          </div>
          <div class="project-actions">
            <button class="run-project-btn" data-id="${project.id}">▶ Run</button>
            <button class="delete-project-btn" data-id="${project.id}">🗑</button>
          </div>
        `;
        
        projectsList.appendChild(item);
      });
      
      // Add event listeners to buttons
      projectsList.querySelectorAll('.run-project-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const id = e.currentTarget.dataset.id;
          const project = projects.find(p => p.id === id);
          if (project) {
            codeInput.value = project.code;
            lastPastedCode = project.code;
            currentSummary = project.summary || '';
            btnRun.click(); // Auto-click Analyze & Run
          }
        });
      });
      
      projectsList.querySelectorAll('.delete-project-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const id = e.currentTarget.dataset.id;
          await window.electronAPI.deleteProject(id);
          loadProjects(); // Refresh the list
        });
      });
    } catch (error) {
      console.error('Error loading projects:', error);
    }
  }

  // Load projects on startup
  loadProjects();
});