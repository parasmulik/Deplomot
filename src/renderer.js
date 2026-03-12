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
  const btnSettings = document.getElementById('btn-settings');

  const settingsModal = document.getElementById('settings-modal');
  const btnCloseSettings = document.getElementById('btn-close-settings');

  const saveSection = document.getElementById('save-section');
  const projectNameInput = document.getElementById('project-name');
  const btnSaveProject = document.getElementById('btn-save-project');
  const saveMessage = document.getElementById('save-message');

  let currentProjectPath = '';
  let currentPreviewUrl = '';
  let lastPastedCode = '';
  let currentSummary = '';
  let projects = [];

  // Character count
  codeInput.addEventListener('input', () => {
    const len = codeInput.value.length;
    charCount.textContent = `${len.toLocaleString()} character${len !== 1 ? 's' : ''}`;
  });

  // Clear button
  btnClear.addEventListener('click', () => {
    codeInput.value = '';
    charCount.textContent = '0 characters';
    codeInput.focus();
  });

  // Status updates from main process
  window.electronAPI.onStatusUpdate((data) => {
    updateLoadingStep(data.step);
    loadingTitle.textContent = data.message;

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

    try {
      const result = await window.electronAPI.analyzeAndRun(code);

      if (result.success) {
        currentProjectPath = result.projectPath;
        currentPreviewUrl = result.previewUrl;
        showResults(result);
      } else {
        lastProjectFiles = result.files || [];
        showError(result.error, true);
      }
    } catch (error) {
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
    statusDot.className = 'status-dot error';
    statusText.textContent = 'Stopped';
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