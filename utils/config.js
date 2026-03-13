const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_DIR = path.join(os.homedir(), '.deplomot');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const PROJECTS_FILE = path.join(CONFIG_DIR, 'projects.json');

function ensureConfigDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

function loadConfig() {
  ensureConfigDir();
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = fs.readFileSync(CONFIG_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Error loading config:', error);
  }
  return {};
}

function saveConfig(updates) {
  ensureConfigDir();
  const current = loadConfig();
  const merged = { ...current, ...updates };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2), 'utf8');
  return merged;
}

function getProjects() {
  ensureConfigDir();
  try {
    if (fs.existsSync(PROJECTS_FILE)) {
      const data = fs.readFileSync(PROJECTS_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Error loading projects:', error);
  }
  return [];
}

function saveProject(project) {
  ensureConfigDir();
  const projects = getProjects();
  projects.unshift(project);
  fs.writeFileSync(PROJECTS_FILE, JSON.stringify(projects, null, 2), 'utf8');
  return projects;
}

function deleteProject(id) {
  ensureConfigDir();
  const projects = getProjects();
  const filtered = projects.filter(p => p.id !== id);
  fs.writeFileSync(PROJECTS_FILE, JSON.stringify(filtered, null, 2), 'utf8');
  return filtered;
}

function renameProject(id, newName) {
  ensureConfigDir();
  const projects = getProjects();
  const projectIndex = projects.findIndex(p => p.id === id);
  if (projectIndex !== -1) {
    projects[projectIndex].name = newName;
    fs.writeFileSync(PROJECTS_FILE, JSON.stringify(projects, null, 2), 'utf8');
    return projects;
  }
  return null;
}

function getConfigPath() {
  return CONFIG_FILE;
}

module.exports = {
  loadConfig,
  saveConfig,
  getConfigPath,
  getProjects,
  saveProject,
  deleteProject,
  renameProject
};
