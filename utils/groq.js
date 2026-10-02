const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

function loadEnvFile() {
  try {
    const envPath = path.join(__dirname, '..', '.env');
    if (!fs.existsSync(envPath)) return;
    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!match) continue;
      const name = match[1];
      const value = match[2].trim().replace(/^["']|["']$/g, '');
      if (process.env[name] === undefined) process.env[name] = value;
    }
  } catch (e) {
    console.error('[env] Failed to load .env:', e.message);
  }
}

loadEnvFile();

const API_KEYS = (process.env.GROQ_KEYS || '').split(',').map(k => k.trim()).filter(Boolean);

function noKeysError() {
  console.error('[Groq] No API keys configured. Copy .env.example to .env and set GROQ_KEYS (comma-separated), or set the GROQ_KEYS environment variable.');
}

let currentKeyIndex = 0;

function getNextKey() {
  const key = API_KEYS[currentKeyIndex];
  currentKeyIndex = (currentKeyIndex + 1) % API_KEYS.length;
  return key;
}

const SYSTEM_PROMPT = `Analyze pasted AI code. Return ONLY valid JSON with this structure:
{"summary":"what it does","frontend":{"files":[{"filename":"name","content":"full code"}]},"backend":{"language":"node","files":[{"filename":"server.js","content":"full code"}]},"database":{"detected":false,"files":[]},"dependencies":{"frontend":[],"backend":["express","cors"]}}

RULES:
1. Return ONLY raw JSON. No markdown, no text before/after.
2. Static HTML/CSS/JS: put all in frontend, leave backend empty.
3. Node/Express backend: server.js in backend, frontend files in frontend.
4. Include ALL code - don't skip anything.
5. Backend must listen on port 3847. Add express.static for 'public' folder. Add cors.
6. Database code (SQL, MongoDB): set database.detected=true, put files in database.files.
7. React detection: JSX syntax, <Component />, import { useState }, .jsx/.tsx = React app.
8. React setup: package.json with react,react-dom,vite,@vitejs/plugin-react; vite.config.js with port 3847; src/App.jsx; index.html with <div id="root"></div>.
9. For React: "dev":"vite --port 3847", "build":"vite build", "preview":"vite preview --port 3847".
10. Always include package.json in backend with all dependencies.`;

async function makeRequest(apiKey, code) {
  const systemContent = SYSTEM_PROMPT;
  const userContent = `Here is the code I pasted. Please analyze it and return the JSON structure:\n\n${code}`;
  
  console.log('=== GROQ API REQUEST ===');
  console.log(`System prompt (${systemContent.length} chars):`);
  console.log(systemContent);
  console.log(`\nUser content (${userContent.length} chars):`);
  console.log(userContent);
  console.log(`TOTAL: ${systemContent.length + userContent.length} chars`);
  console.log('========================');

  const response = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [
        {
          role: 'system',
          content: systemContent
        },
        {
          role: 'user',
          content: userContent
        }
      ],
      temperature: 0.1,
      max_tokens: 4000,
      response_format: { type: 'json_object' }
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    const status = response.status;
    console.error(`Groq API error with key ...${apiKey.slice(-6)}:`, status, errorText);
    throw new Error(`API returned status ${status}: ${errorText}`);
  }

  return await response.json();
}

// Split pasted code into files based on comment markers like // filename or /* filename */
function splitCodeIntoFiles(code) {
  const files = {};
  let currentFile = null;
  let currentContent = [];
  
  const lines = code.split('\n');
  const validExtensions = ['.js', '.jsx', '.ts', '.tsx', '.json', '.html', '.css', '.py', '.sql', '.md', '.txt', '.mjs', '.cjs'];
  
  // First pass: detect multi-line /* ... HTML ... */ blocks
  const htmlBlockRegex = /\/\*\s*\n([\s\S]*?<!DOCTYPE\s+html[\s\S]*?<\/html>[\s\S]*?)\*\//gi;
  let htmlMatch;
  while ((htmlMatch = htmlBlockRegex.exec(code)) !== null) {
    files['index.html'] = htmlMatch[1].trim();
  }
  
  // First pass: detect multi-line /* ... filename ... */ blocks
  const multilineFilenameRegex = /\/\*[\s=*#-]*\n\s*([a-zA-Z0-9_\-/.]+\.[a-zA-Z0-9]+)\s*\n[\s=*#-]*\*\//gi;
  let mlMatch;
  while ((mlMatch = multilineFilenameRegex.exec(code)) !== null) {
    const fname = mlMatch[1];
    const ext = '.' + fname.split('.').pop();
    if (validExtensions.includes(ext)) {
      files[fname] = '__MULTILINE_MARKER__';
    }
  }
  
  function extractFilename(text) {
    const patterns = [
      // Direct: server.js
      /^([a-zA-Z0-9_\-/.]+\.[a-zA-Z0-9]+)\s*$/,
      // With delimiters: === server.js ===, --- server.js ---, ### server.js ###
      /^[=\-#*]+\s*([a-zA-Z0-9_\-/.]+\.[a-zA-Z0-9]+)\s*[=\-#*]*\s*$/,
      // With prefix: file: server.js, file -> server.js
      /^(?:file|filename|path)\s*[:=>]\s*([a-zA-Z0-9_\-/.]+\.[a-zA-Z0-9]+)\s*$/i,
      // With backticks: `server.js`
      /^`([a-zA-Z0-9_\-/.]+\.[a-zA-Z0-9]+)`\s*$/,
      // With markdown bold: **server.js**
      /^\*\*([a-zA-Z0-9_\-/.]+\.[a-zA-Z0-9]+)\*\*\s*$/,
      // With markdown heading: ### server.js, ## server.js, # server.js
      /^#{1,6}\s+([a-zA-Z0-9_\-/.]+\.[a-zA-Z0-9]+)\s*$/,
      // With brackets: [server.js]
      /^\[([a-zA-Z0-9_\-/.]+\.[a-zA-Z0-9]+)\]\s*$/,
      // With angle brackets: <server.js>
      /^<([a-zA-Z0-9_\-/.]+\.[a-zA-Z0-9]+)>\s*$/,
      // With HTML comment: <!-- server.js -->
      /^<!--\s*([a-zA-Z0-9_\-/.]+\.[a-zA-Z0-9]+)\s*-->\s*$/,
      // With colon suffix: server.js:
      /^([a-zA-Z0-9_\-/.]+\.[a-zA-Z0-9]+):\s*$/
    ];
    
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        const name = match[1].trim();
        const ext = '.' + name.split('.').pop();
        if (validExtensions.includes(ext)) {
          return name;
        }
      }
    }
    return null;
  }
  
  function looksLikeCodeStart(text) {
    const trimmed = text.trim();
    if (!trimmed) return false;
    const codeStarts = [
      'const ', 'let ', 'var ', 'import ', 'export ', 'function ', 'class ',
      'require(', 'module.exports', 'app.', 'server.', 'router.',
      '<!DOCTYPE', '<html', '<head', '<body', '<div', '<script',
      '{', 'from ', 'use ', 'describe(', 'it(', 'test(', 'async ',
      'try ', 'if ', 'for ', 'while ', 'switch ', 'return ',
      'console.', 'process.', 'const{', 'import{',
      '*', '@', '#', '.', ':', '"', "'", '```', '`'
    ];
    for (const start of codeStarts) {
      if (trimmed.startsWith(start)) return true;
    }
    return false;
  }
  
  function stripMarkdownFence(line) {
    return line.trim().startsWith('```');
  }
  
  let inMarkdownFence = false;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    
    // Detect 3-line comment block: /* ===\nfilename\n=== */
    if (trimmed.startsWith('/*') && !trimmed.endsWith('*/') && i + 2 < lines.length) {
      const nextLine = lines[i + 1].trim();
      const afterNext = lines[i + 2].trim();
      if (afterNext.endsWith('*/')) {
        const potentialFile = extractFilename(nextLine);
        if (potentialFile) {
          if (currentFile && currentContent.length > 0) {
            files[currentFile] = currentContent.join('\n');
          }
          currentFile = potentialFile;
          currentContent = [];
          i += 2; // skip the 3-line block
          continue;
        }
      }
    }
    
    // Handle markdown code fences - extract filename from fence if present
    if (stripMarkdownFence(trimmed)) {
      // Try to extract filename from fence line like ```package.json or ```js
      const fenceContent = trimmed.replace(/^`{3,}/, '').trim();
      if (fenceContent) {
        // Check if it's a filename
        const fenceFile = extractFilename(fenceContent);
        if (fenceFile) {
          if (currentFile && currentContent.length > 0) {
            files[currentFile] = currentContent.join('\n');
          }
          currentFile = fenceFile;
          currentContent = [];
          inMarkdownFence = true;
          continue;
        }
      }
      // Just a regular fence toggle
      inMarkdownFence = !inMarkdownFence;
      continue;
    }
    
    let potentialFile = null;
    
    // Check for // filename pattern
    if (trimmed.startsWith('//') && trimmed.length > 3) {
      const afterSlash = trimmed.substring(2).trim();
      potentialFile = extractFilename(afterSlash);
    }
    // Check for /* filename */ pattern (single line only)
    else if (trimmed.startsWith('/*') && trimmed.endsWith('*/') && trimmed.length > 6) {
      const inside = trimmed.substring(2, trimmed.length - 2).trim();
      potentialFile = extractFilename(inside);
    }
    // Check for bare filename patterns when we're inside a code fence
    else if (inMarkdownFence && (currentFile !== null || i > 0)) {
      potentialFile = extractFilename(trimmed);
      // Only accept bare filename if next line looks like code
      if (potentialFile && i + 1 < lines.length) {
        const nextLine = lines[i + 1].trim();
        if (!looksLikeCodeStart(nextLine)) {
          potentialFile = null;
        }
      }
    }
    
    if (potentialFile) {
      if (currentFile && currentContent.length > 0) {
        files[currentFile] = currentContent.join('\n');
      }
      currentFile = potentialFile;
      currentContent = [];
    } else {
      if (currentFile !== null) {
        currentContent.push(line);
      } else if (i === 0) {
        currentContent.push(line);
      }
    }
  }
  
  if (currentFile && currentContent.length > 0) {
    files[currentFile] = currentContent.join('\n');
  }
  
  // Clean up marker placeholders
  for (const [fname, content] of Object.entries(files)) {
    if (content === '__MULTILINE_MARKER__') {
      files[fname] = '';
    }
  }
  
  return files;
}

// Use Groq to split code into files when no markers are found
async function splitWithGroq(code) {
  if (API_KEYS.length === 0) {
    noKeysError();
    return null;
  }
  const apiKey = API_KEYS[currentKeyIndex];
  
  try {
    const response = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          {
            role: 'system',
            content: 'You are a code splitter. Given pasted code that may contain multiple files concatenated together, split it into individual files. Return ONLY valid JSON with filenames as keys and full file contents as values. Example: {"package.json":"{...}","server.js":"const express...","public/index.html":"<!DOCTYPE..."}'
          },
          {
            role: 'user',
            content: `Split this code into files:\n\n${code.substring(0, 15000)}`
          }
        ],
        temperature: 0.1,
        max_tokens: 8000,
        response_format: { type: 'json_object' }
      })
    });
    
    if (!response.ok) return null;
    
    const data = await response.json();
    let content = data.choices?.[0]?.message?.content?.trim();
    if (!content) return null;
    
    content = content.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
    const parsed = JSON.parse(content);
    
    if (typeof parsed === 'object' && parsed !== null) {
      console.log('[Groq Split] Successfully split into', Object.keys(parsed).length, 'files:', Object.keys(parsed));
      for (const [name, c] of Object.entries(parsed)) {
        console.log(`[Groq Split]   ${name}: ${c.length} chars`);
      }
      return parsed;
    }
    return null;
  } catch (e) {
    console.log('[Groq Split] Failed:', e.message);
    return null;
  }
}

async function analyzeCode(code) {
  if (API_KEYS.length === 0) {
    noKeysError();
    return null;
  }

  // Keep full code for writing files later
  const fullCode = code.trim();
  fullCode.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  
  // LOCAL REACT PRE-CHECK - Skip Groq if React detected
  const hasReactImport = 
    fullCode.includes('import React') ||
    fullCode.includes("from 'react'") ||
    fullCode.includes('from "react"') ||
    fullCode.includes('import { useState') ||
    fullCode.includes('import { useEffect') ||
    fullCode.includes('import { useContext') ||
    fullCode.includes('ReactDOM.createRoot') ||
    fullCode.includes('ReactDOM.render') ||
    fullCode.includes('@vitejs/plugin-react');
  
  const hasJSXSyntax = 
    fullCode.includes('<') && 
    (fullCode.includes('/>') || 
     /<\/[A-Z]/.test(fullCode) || 
     /<[A-Z][a-zA-Z]+/.test(fullCode) ||
     fullCode.includes('className='));
  
  const isReact = hasReactImport && hasJSXSyntax;
  
  if (isReact) {
    console.log('[React Pre-check] React indicators found, building React structure locally');
    
    const splitFiles = splitCodeIntoFiles(fullCode);
    
    // Detect entry point from index.html script tag
    let entryFile = 'src/main.jsx';
    if (splitFiles['index.html']) {
      const scriptMatch = splitFiles['index.html'].match(/src="([^"]+)"/);
      if (scriptMatch) {
        entryFile = scriptMatch[1].replace(/^\//, '');
      }
    } else {
      for (const key of Object.keys(splitFiles)) {
        if (key.includes('main.') || key.includes('index.')) {
          if (key.endsWith('.jsx') || key.endsWith('.tsx') || key.endsWith('.js')) {
            entryFile = key;
            break;
          }
        }
      }
    }
    
    // Collect all dependencies from import statements
    const extraDeps = new Set();
    const depPatterns = [
      /import\s+.*?\s+from\s+['"]([^'"]+)['"]/g,
      /require\(['"]([^'"]+)['"]\)/g
    ];
    
    for (const content of Object.values(splitFiles)) {
      for (const pattern of depPatterns) {
        let match;
        while ((match = pattern.exec(content)) !== null) {
          const pkg = match[1];
          if (!pkg.startsWith('.') && !pkg.startsWith('/') && 
              !['react', 'react-dom', 'fs', 'path', 'os', 'http', 'https', 'url', 'crypto'].includes(pkg)) {
            const pkgName = pkg.startsWith('@') ? pkg.split('/').slice(0, 2).join('/') : pkg.split('/')[0];
            extraDeps.add(pkgName);
          }
        }
      }
    }
    
    const deps = {
      react: '^18.2.0',
      'react-dom': '^18.2.0'
    };
    for (const dep of extraDeps) {
      if (!['react', 'react-dom'].includes(dep)) {
        deps[dep] = '*';
      }
    }
    
    const allDepsList = ['react', 'react-dom', '@vitejs/plugin-react', 'vite', ...Array.from(extraDeps)];
    
    const reactStructure = {
      summary: 'A React web application',
      frontend: {
        files: []
      },
      backend: {
        language: 'node',
        files: [
          { 
            filename: 'index.html', 
            content: splitFiles['index.html'] || `<!DOCTYPE html>\n<html lang="en">\n  <head>\n    <meta charset="UTF-8" />\n    <link rel="icon" type="image/svg+xml" href="/vite.svg" />\n    <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n    <title>Vite + React App</title>\n  </head>\n  <body>\n    <div id="root"></div>\n    <script type="module" src="/${entryFile}"></script>\n  </body>\n</html>` 
          },
          { 
            filename: 'package.json', 
            content: JSON.stringify({
              name: 'deplomot-react-app',
              version: '1.0.0',
              private: true,
              dependencies: deps,
              devDependencies: {
                '@vitejs/plugin-react': '^4.0.0',
                vite: '^5.0.0'
              },
              scripts: {
                dev: 'vite --port 3847',
                build: 'vite build',
                preview: 'vite preview --port 3847'
              }
            }, null, 2)
          },
          {
            filename: 'vite.config.js',
            content: `import { defineConfig } from 'vite';\nimport react from '@vitejs/plugin-react';\n\nexport default defineConfig({\n  plugins: [react()],\n  server: {\n    port: 3847\n  }\n});`
          },
          {
            filename: entryFile,
            content: splitFiles[entryFile] || `import React from 'react';\nimport ReactDOM from 'react-dom/client';\nimport App from './App.jsx';\nimport './styles.css';\n\nReactDOM.createRoot(document.getElementById('root')).render(\n  <App />\n);`
          },
          {
            filename: 'src/App.jsx',
            content: splitFiles['src/App.jsx'] || fullCode
          },
          {
            filename: 'src/styles.css',
            content: splitFiles['src/styles.css'] || `* { margin: 0; padding: 0; box-sizing: border-box; }\nbody { font-family: system-ui, sans-serif; }\n#root { min-height: 100vh; }`
          }
        ]
      },
      database: { detected: false, files: [] },
      dependencies: { frontend: [], backend: allDepsList }
    };
    
    return reactStructure;
  }
  
  // LOCAL NODE.JS PRE-CHECK - Skip Groq if Express/Node.js backend detected
  const hasNodeImports = 
    fullCode.includes('require(') ||
    fullCode.includes("from 'express'") ||
    fullCode.includes('from "express"') ||
    fullCode.includes("require('express')") ||
    fullCode.includes('require("express")') ||
    fullCode.includes('app.listen(') ||
    fullCode.includes('app.use(') ||
    fullCode.includes('app.get(') ||
    fullCode.includes('app.post(') ||
    fullCode.includes('express()') ||
    fullCode.includes('cors()') ||
    fullCode.includes('body-parser') ||
    fullCode.includes('const cors') ||
    fullCode.includes('const express');
  
  const hasBackendMarkers = 
    fullCode.includes('app.listen(') ||
    fullCode.includes('res.json(') ||
    fullCode.includes('res.send(') ||
    fullCode.includes('req.body') ||
    fullCode.includes('req.params') ||
    fullCode.includes('req.query');
  
  const isNodeBackend = hasNodeImports && hasBackendMarkers;
  
  if (isNodeBackend) {
    console.log('[Node.js Pre-check] Node.js/Express indicators found, building structure locally');
    
    let splitFiles = splitCodeIntoFiles(fullCode);
    const hasMarkers = Object.keys(splitFiles).length > 1;
    
    // Validate that split files have meaningful content
    let hasContent = false;
    if (hasMarkers) {
      for (const [name, content] of Object.entries(splitFiles)) {
        if (content && content.trim().length > 20) {
          hasContent = true;
          break;
        }
      }
      if (!hasContent) {
        console.log('[Node.js Pre-check] Markers found but files are empty, using Groq to split');
        const groqSplit = await splitWithGroq(fullCode);
        if (groqSplit && Object.keys(groqSplit).length > 1) {
          splitFiles = groqSplit;
          console.log('[Node.js Pre-check] Groq split into', Object.keys(splitFiles).length, 'files:', Object.keys(splitFiles));
          for (const [name, c] of Object.entries(splitFiles)) {
            console.log(`[Node.js Pre-check]   ${name}: ${c.length} chars`);
          }
        } else {
          console.log('[Node.js Pre-check] Groq split failed, falling back to full code');
          splitFiles = { 'server.js': fullCode };
        }
      } else {
        console.log('[Node.js Pre-check] Found file markers, splitting into', Object.keys(splitFiles).length, 'files:', Object.keys(splitFiles));
      }
    }
    
    if (!hasMarkers || (!hasContent && Object.keys(splitFiles).length <= 1)) {
      console.log('[Node.js Pre-check] No usable file markers, using Groq to split');
      const groqSplit = await splitWithGroq(fullCode);
      if (groqSplit && Object.keys(groqSplit).length > 1) {
        splitFiles = groqSplit;
        console.log('[Node.js Pre-check] Groq split into', Object.keys(splitFiles).length, 'files:', Object.keys(splitFiles));
      } else {
        console.log('[Node.js Pre-check] Groq split failed, using full code as server.js');
      }
    }
    
    const backendFiles = [];
    const frontendFiles = [];
    const backendDeps = new Set();
    const frontendDeps = new Set();
    
    const depPatterns = [
      /import\s+.*?\s+from\s+['"]([^'"]+)['"]/g,
      /require\(['"]([^'"]+)['"]\)/g
    ];
    
    const nodeModules = ['express', 'cors', 'body-parser', 'morgan', 'dotenv', 'helmet', 'cookie-parser', 'multer', 'nodemon', 'better-sqlite3', 'sqlite3', 'pg', 'mysql2', 'mongoose', 'mongodb', 'jsonwebtoken', 'bcrypt', 'uuid', 'winston', 'compression', '@supabase/supabase-js', '@supabase', 'supabase'];
    
    for (const [filename, content] of Object.entries(splitFiles)) {
      console.log(`[Node.js Pre-check] Processing split file: ${filename} (${content?.length || 0} chars, first 100: ${JSON.stringify(content?.substring(0, 100))})`);
      const ext = '.' + filename.split('.').pop();
      const isFrontend = ['.html', '.css', '.jsx', '.tsx'].includes(ext) || filename.startsWith('public/');
      const isBackend = ['.js', '.mjs', '.cjs'].includes(ext) && !filename.startsWith('public/');
      const isConfig = ext === '.json';
      const isEnv = filename === '.env';
      
      if (isFrontend || (isConfig && filename === 'package.json')) {
        for (const pattern of depPatterns) {
          let match;
          while ((match = pattern.exec(content)) !== null) {
            const pkg = match[1];
            if (!pkg.startsWith('.') && !pkg.startsWith('/')) {
              const pkgName = pkg.startsWith('@') ? pkg.split('/').slice(0, 2).join('/') : pkg.split('/')[0];
              if (isFrontend) {
                frontendDeps.add(pkgName);
              }
            }
          }
        }
        
      if (isFrontend) {
        // Normalize filename - strip leading 'public/' since fileManager adds it
        const normalizedFilename = filename.replace(/^public\//, '');
        frontendFiles.push({ filename: normalizedFilename, content });
      } else if (isConfig) {
          backendFiles.push({ filename, content });
        }
      } else if (isBackend || (isConfig && filename !== 'package.json') || isEnv) {
        for (const pattern of depPatterns) {
          let match;
          while ((match = pattern.exec(content)) !== null) {
            const pkg = match[1];
            if (!pkg.startsWith('.') && !pkg.startsWith('/')) {
              const pkgName = pkg.startsWith('@') ? pkg.split('/').slice(0, 2).join('/') : pkg.split('/')[0];
              // Include all known node modules plus any @supabase packages
              if (nodeModules.includes(pkgName) || pkgName === 'express' || pkgName === 'cors' || pkgName.startsWith('@supabase')) {
                backendDeps.add(pkgName);
              }
            }
          }
        }
        
        backendFiles.push({ filename, content });
      }
    }
    
    // If no files were split at all (single file), check if it's pure frontend
    if (backendFiles.length === 0 && frontendFiles.length === 0) {
      const isPureFrontend = fullCode.includes('<!DOCTYPE') || fullCode.includes('<html') || fullCode.includes('<body');
      
      if (isPureFrontend) {
        console.log('[Node.js Pre-check] Pure frontend HTML detected, no backend needed');
        frontendFiles.push({ filename: 'index.html', content: fullCode });
      } else {
        for (const pattern of depPatterns) {
          let match;
          while ((match = pattern.exec(fullCode)) !== null) {
            const pkg = match[1];
            if (!pkg.startsWith('.') && !pkg.startsWith('/')) {
              const pkgName = pkg.startsWith('@') ? pkg.split('/').slice(0, 2).join('/') : pkg.split('/')[0];
              if (nodeModules.includes(pkgName) || pkgName.startsWith('@supabase')) {
                backendDeps.add(pkgName);
              }
            }
          }
        }
        
        if (fullCode.includes('supabase') || fullCode.includes('@supabase/supabase-js')) {
          backendDeps.add('@supabase/supabase-js');
        }
        
        backendFiles.push({ filename: 'server.js', content: fullCode });
      }
    }
    
    // Ensure package.json exists and is valid in backend
    const pkgIndex = backendFiles.findIndex(f => f.filename === 'package.json');
    const depsObj = {};
    for (const dep of backendDeps) {
      depsObj[dep] = dep === 'express' ? '^4.18.0' : '*';
    }
    
    if (pkgIndex >= 0) {
      try {
        const parsedPkg = JSON.parse(backendFiles[pkgIndex].content);
        // Add dependencies from the original package.json to backendDeps
        if (parsedPkg.dependencies) {
          for (const dep of Object.keys(parsedPkg.dependencies)) {
            backendDeps.add(dep);
          }
        }
        // Rebuild depsObj with all detected deps including supabase
        const finalDeps = {};
        for (const dep of backendDeps) {
          if (dep === 'express') finalDeps[dep] = '^4.18.0';
          else if (dep === '@supabase/supabase-js') finalDeps[dep] = '^2.43.4';
          else finalDeps[dep] = '*';
        }
        // Update package.json with all dependencies
        parsedPkg.dependencies = finalDeps;
        parsedPkg.type = parsedPkg.type || (fullCode.includes('"type": "module"') || fullCode.includes('import ') ? 'module' : 'commonjs');
        backendFiles[pkgIndex].content = JSON.stringify(parsedPkg, null, 2);
      } catch (e) {
        // Preserve "type": "module" from original code if present
        const isESM = fullCode.includes('"type": "module"') || fullCode.includes('import ') || fullCode.includes('export ');
        backendFiles[pkgIndex].content = JSON.stringify({
          name: 'Deplomot-backend',
          version: '1.0.0',
          main: 'server.js',
          type: isESM ? 'module' : 'commonjs',
          dependencies: depsObj
        }, null, 2);
      }
    }
    
    // Ensure package.json exists in backend
    if (pkgIndex < 0) {
      const depsObj = {};
      for (const dep of backendDeps) {
        if (dep === 'express') depsObj[dep] = '^4.18.0';
        else if (dep === '@supabase/supabase-js') depsObj[dep] = '^2.43.4';
        else depsObj[dep] = '*';
      }
      const isESM = fullCode.includes('"type": "module"') || fullCode.includes('import ') || fullCode.includes('export ');
      backendFiles.push({
        filename: 'package.json',
        content: JSON.stringify({
          name: 'Deplomot-backend',
          version: '1.0.0',
          main: 'server.js',
          type: isESM ? 'module' : 'commonjs',
          dependencies: depsObj
        }, null, 2)
      });
    }
    
    const nodeStructure = {
      summary: 'A Node.js/Express web application',
      frontend: { files: frontendFiles },
      backend: {
        language: 'node',
        files: backendFiles
      },
      database: { detected: false, files: [] },
      dependencies: {
        frontend: Array.from(frontendDeps),
        backend: Array.from(backendDeps)
      }
    };
    
    return nodeStructure;
  }
  
  // Truncate for Groq request (just enough for type detection)
  let truncatedCode = code.trim();
  if (truncatedCode.length > 2000) {
    truncatedCode = truncatedCode.substring(0, 2000);
  }
  truncatedCode = truncatedCode.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  const startIndex = currentKeyIndex;
  let lastError = null;

  for (let attempt = 0; attempt < API_KEYS.length; attempt++) {
    const apiKey = getNextKey();
    const keyHint = `...${apiKey.slice(-6)}`;

    try {
      console.log(`Attempting Groq API call with key ${keyHint} (attempt ${attempt + 1}/${API_KEYS.length})`);

      const data = await makeRequest(apiKey, truncatedCode);

      if (!data.choices || !data.choices[0] || !data.choices[0].message) {
        throw new Error('Unexpected API response format');
      }

      let content = data.choices[0].message.content.trim();
      content = content.replace(/^```json\s*/i, '');
      content = content.replace(/^```\s*/i, '');
      content = content.replace(/\s*```$/i, '');
      content = content.trim();

      const parsed = JSON.parse(content);

      if (!parsed.summary) parsed.summary = 'Your website is ready to preview.';
      if (!parsed.frontend) parsed.frontend = { files: [] };
      if (!parsed.backend) parsed.backend = { language: 'node', files: [] };
      if (!parsed.database) parsed.database = { detected: false, files: [] };
      if (!parsed.dependencies) parsed.dependencies = { frontend: [], backend: [] };

      // REPLACE file contents with FULL original code
      const hasBackend = parsed.backend && parsed.backend.files && parsed.backend.files.length > 0;
      
      if (hasBackend) {
        const splitFullFiles = splitCodeIntoFiles(fullCode);
        const hasMarkers = Object.keys(splitFullFiles).length > 1;
        
        if (hasMarkers) {
          for (const file of parsed.backend.files) {
            if (splitFullFiles[file.filename]) {
              let content = splitFullFiles[file.filename];
              // Remove any /* ... HTML ... */ blocks from backend files
              content = content.replace(/\/\*\s*\n[\s\S]*?<!DOCTYPE\s+html[\s\S]*?<\/html>[\s\S]*?\*\//gi, '');
              // Remove any /* ... */ comment blocks that contain HTML
              content = content.replace(/\/\*\s*[\s\S]*?<!DOCTYPE[\s\S]*?\*\//gi, '');
              file.content = content.trim();
            }
          }
          for (const file of parsed.frontend.files) {
            if (splitFullFiles[file.filename]) {
              file.content = splitFullFiles[file.filename];
            }
          }
        } else {
          // Try Groq split as fallback
          const groqSplit = await splitWithGroq(fullCode);
          if (groqSplit && Object.keys(groqSplit).length > 1) {
            for (const file of parsed.backend.files) {
              if (groqSplit[file.filename]) {
                file.content = groqSplit[file.filename];
              }
            }
            for (const file of parsed.frontend.files) {
              if (groqSplit[file.filename]) {
                file.content = groqSplit[file.filename];
              }
            }
          } else {
            // Last resort: put full code in server file
            const serverFile = parsed.backend.files.find(f => 
              f.filename === 'server.js' || f.filename === 'app.js' || f.filename === 'index.js'
            );
            if (serverFile) {
              serverFile.content = fullCode;
            }
            const htmlFile = parsed.frontend?.files?.find(f => f.filename.endsWith('.html'));
            if (htmlFile && (fullCode.includes('<!DOCTYPE') || fullCode.includes('<html'))) {
              htmlFile.content = fullCode;
            }
          }
        }
      } else {
        const htmlFile = parsed.frontend?.files?.find(f => f.filename.endsWith('.html'));
        if (htmlFile) {
          htmlFile.content = fullCode;
        }
      }

      // Ensure backend has valid package.json
      if (parsed.backend.files.length > 0) {
        const pkgIndex = parsed.backend.files.findIndex(f => f.filename === 'package.json');
        const deps = {};
        if (parsed.dependencies.backend) {
          parsed.dependencies.backend.forEach(dep => {
            if (dep === 'express') {
              deps[dep] = '^4.18.0';
            } else {
              deps[dep] = '*';
            }
          });
        }
        
        const validPkg = {
          name: 'Deplomot-backend',
          version: '1.0.0',
          description: 'Generated by Deplomot',
          main: 'server.js',
          dependencies: deps
        };
        
        if (pkgIndex >= 0) {
          try {
            JSON.parse(parsed.backend.files[pkgIndex].content);
          } catch (e) {
            parsed.backend.files[pkgIndex].content = JSON.stringify(validPkg, null, 2);
          }
        } else {
          parsed.backend.files.push({
            filename: 'package.json',
            content: JSON.stringify(validPkg, null, 2)
          });
        }
      }

      console.log(`Successfully analyzed code with key ${keyHint}`);
      return parsed;

    } catch (error) {
      lastError = error;
      console.error(`Key ${keyHint} failed: ${error.message}`);

      const isRetryable = error.message.includes('429') ||
                          error.message.includes('401') ||
                          error.message.includes('500') ||
                          error.message.includes('502') ||
                          error.message.includes('503') ||
                          error.message.includes('rate') ||
                          error.message.includes('limit') ||
                          error.message.includes('quota');

      if (!isRetryable && attempt === 0) {
        console.log('Non-rate-limit error, trying next key anyway...');
      }

      if (attempt < API_KEYS.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
  }

  console.error('All API keys failed. Last error:', lastError?.message);
  return null;
}

async function fixCode(originalCode, errorMessage, projectFiles) {
  if (API_KEYS.length === 0) {
    noKeysError();
    return null;
  }
  originalCode = originalCode.trim();
  if (originalCode.length > 50000) {
    originalCode = originalCode.substring(0, 50000);
  }
  originalCode = originalCode.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  const FIX_PROMPT = `You are Deplomot, a code-fixing AI. The user's code failed to run. Fix it.

Return ONLY valid JSON:
{"summary":"what was wrong and what you fixed","issuesFound":2,"frontend":{"files":[{"filename":"index.html","content":"full FIXED content"}]},"backend":{"language":"node","files":[{"filename":"server.js","content":"full FIXED content"}]},"database":{"detected":false,"files":[]},"dependencies":{"frontend":[],"backend":["express","cors"]}}

RULES:
1. ONLY valid JSON. No markdown. No backticks.
2. Fix ALL issues. Include COMPLETE file contents.
3. Backend must listen on port 3847. Add cors.
4. Always include package.json with all dependencies.
5. Never use placeholders.`;

  const filesDescription = projectFiles.map(f =>
    `--- ${f.category}/${f.filename} ---\n${f.content}`
  ).join('\n\n');

  const userMessage = `ORIGINAL CODE:\n${originalCode}\n\nERROR:\n${errorMessage}\n\nCURRENT FILES:\n${filesDescription}`;

  for (let attempt = 0; attempt < API_KEYS.length; attempt++) {
    const apiKey = getNextKey();
    const keyHint = `...${apiKey.slice(-6)}`;

    try {
      const response = await fetch(GROQ_API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [
            { role: 'system', content: FIX_PROMPT },
            { role: 'user', content: userMessage }
          ],
          temperature: 0.1,
          max_tokens: 4000,
          response_format: { type: 'json_object' }
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API status ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      let content = data.choices[0].message.content.trim();
      content = content.replace(/^```json\s*/i, '');
      content = content.replace(/^```\s*/i, '');
      content = content.replace(/\s*```$/i, '');
      content = content.trim();

      const parsed = JSON.parse(content);
      if (!parsed.summary) parsed.summary = 'Fixed issues.';
      if (!parsed.frontend) parsed.frontend = { files: [] };
      if (!parsed.backend) parsed.backend = { language: 'node', files: [] };
      if (!parsed.database) parsed.database = { detected: false, files: [] };
      if (!parsed.dependencies) parsed.dependencies = { frontend: [], backend: [] };

      if (parsed.backend.files.length > 0) {
        const hasPackageJson = parsed.backend.files.some(f => f.filename === 'package.json');
        if (!hasPackageJson) {
          const deps = {};
          if (parsed.dependencies.backend) {
            parsed.dependencies.backend.forEach(dep => { deps[dep] = '*'; });
          }
          parsed.backend.files.push({
            filename: 'package.json',
            content: JSON.stringify({
              name: 'Deplomot-backend',
              version: '1.0.0',
              main: 'server.js',
              dependencies: deps
            }, null, 2)
          });
        }
      }

      console.log(`[AI Fix] Successfully got fix with key ${keyHint}`);
      return parsed;

    } catch (error) {
      console.error(`[AI Fix] Key ${keyHint} failed: ${error.message}`);
      if (attempt < API_KEYS.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
  }

  console.error('[AI Fix] All keys failed');
  return null;
}

module.exports = {
  analyzeCode,
  fixCode
};
