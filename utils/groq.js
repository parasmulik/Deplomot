const fetch = require('node-fetch');

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

const API_KEYS = [
  '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',
  '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',
  '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',
  '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',
  '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'
];

let currentKeyIndex = 0;

function getNextKey() {
  const key = API_KEYS[currentKeyIndex];
  currentKeyIndex = (currentKeyIndex + 1) % API_KEYS.length;
  return key;
}

const SYSTEM_PROMPT = `You are Deplomot, a code analysis AI. Your job is to take code that a user has pasted (which they got from ChatGPT, Claude, or another AI tool) and organize it into a proper project structure.

Analyze the pasted code carefully and return ONLY a valid JSON object with this EXACT structure — no markdown, no code fences, no explanation, ONLY the raw JSON:

{
  "summary": "A plain English description of what this app/website does, written for someone who doesn't know how to code. Keep it to 1-2 sentences.",
  "frontend": {
    "files": [
      {
        "filename": "index.html",
        "content": "the full complete file content here"
      }
    ]
  },
  "backend": {
    "language": "node",
    "files": [
      {
        "filename": "server.js",
        "content": "the full complete file content here"
      }
    ]
  },
  "database": {
    "detected": false,
    "files": []
  },
  "dependencies": {
    "frontend": [],
    "backend": ["express", "cors"]
  }
}

IMPORTANT RULES:
1. Return ONLY valid JSON. No markdown code fences. No backticks. No text before or after the JSON.
2. If the code is just HTML/CSS/JS with no server, put everything in frontend and leave backend files empty.
3. If there's a backend server (Express, Flask, etc.), put server code in backend and HTML/CSS in frontend.
4. Always include ALL the code the user pasted — don't skip or summarize any of it.
5. If the code references packages like express, cors, body-parser, etc., include them in the dependencies.backend array.
6. For Node.js backends, always ensure the backend has express and cors in dependencies if it uses them.
7. If you detect database-related code (SQL schemas, MongoDB models, etc.), set database.detected to true and put those files in database.files.
8. The backend server MUST listen on port 3847. Modify any port references accordingly.
9. If there's both frontend and backend, make sure the backend serves the frontend as static files OR that API URLs in frontend point to http://localhost:3847.
10. If the user pastes a single HTML file with embedded CSS/JS, that's fine — put it as one file in frontend.
11. Make sure every file has complete, working content. Never use placeholders.
12. If the code seems to be a full-stack app, ensure the backend has cors enabled.
13. For any backend using Express, ensure it includes: const cors = require('cors'); app.use(cors());
14. If you create a backend that serves the frontend, add express.static middleware pointing to 'public' using: app.use(express.static(path.join(__dirname, 'public')));
15. Always make sure the backend has a package.json file with all needed dependencies listed.`;

async function makeRequest(apiKey, code) {
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
          content: SYSTEM_PROMPT
        },
        {
          role: 'user',
          content: `Here is the code I pasted. Please analyze it and return the JSON structure:\n\n${code}`
        }
      ],
      temperature: 0.1,
      max_tokens: 32000,
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

async function analyzeCode(code) {
  code = code.trim();
  if (code.length > 50000) {
    code = code.substring(0, 50000);
  }
  code = code.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  const startIndex = currentKeyIndex;
  let lastError = null;

  // Try each key, starting from current round-robin position
  for (let attempt = 0; attempt < API_KEYS.length; attempt++) {
    const apiKey = getNextKey();
    const keyHint = `...${apiKey.slice(-6)}`;

    try {
      console.log(`Attempting Groq API call with key ${keyHint} (attempt ${attempt + 1}/${API_KEYS.length})`);

      const data = await makeRequest(apiKey, code);

      if (!data.choices || !data.choices[0] || !data.choices[0].message) {
        throw new Error('Unexpected API response format');
      }

      let content = data.choices[0].message.content.trim();

      // Remove any markdown code fences if present
      content = content.replace(/^```json\s*/i, '');
      content = content.replace(/^```\s*/i, '');
      content = content.replace(/\s*```$/i, '');
      content = content.trim();

      const parsed = JSON.parse(content);

      // Validate required structure
      if (!parsed.summary) {
        parsed.summary = 'Your website is ready to preview.';
      }
      if (!parsed.frontend) {
        parsed.frontend = { files: [] };
      }
      if (!parsed.backend) {
        parsed.backend = { language: 'node', files: [] };
      }
      if (!parsed.database) {
        parsed.database = { detected: false, files: [] };
      }
      if (!parsed.dependencies) {
        parsed.dependencies = { frontend: [], backend: [] };
      }

      // Ensure backend has package.json if it has files and dependencies
      if (parsed.backend.files.length > 0) {
        const hasPackageJson = parsed.backend.files.some(f => f.filename === 'package.json');
        if (!hasPackageJson) {
          const deps = {};
          if (parsed.dependencies.backend) {
            parsed.dependencies.backend.forEach(dep => {
              deps[dep] = '*';
            });
          }
          parsed.backend.files.push({
            filename: 'package.json',
            content: JSON.stringify({
              name: 'Deplomot-backend',
              version: '1.0.0',
              description: 'Generated by Deplomot',
              main: 'server.js',
              dependencies: deps
            }, null, 2)
          });
        }
      }

      // If no backend but has frontend, create a simple static server
      if (parsed.backend.files.length === 0 && parsed.frontend.files.length > 0) {
        parsed.backend.files = [
          {
            filename: 'server.js',
            content: `const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3847;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log('Server running on port ' + PORT);
});`
          },
          {
            filename: 'package.json',
            content: JSON.stringify({
              name: 'Deplomot-backend',
              version: '1.0.0',
              description: 'Generated by Deplomot',
              main: 'server.js',
              dependencies: {
                express: '*',
                cors: '*'
              }
            }, null, 2)
          }
        ];

        if (!parsed.dependencies.backend.includes('express')) {
          parsed.dependencies.backend.push('express');
        }
        if (!parsed.dependencies.backend.includes('cors')) {
          parsed.dependencies.backend.push('cors');
        }
      }

      console.log(`Successfully analyzed code with key ${keyHint}`);
      return parsed;

    } catch (error) {
      lastError = error;
      console.error(`Key ${keyHint} failed: ${error.message}`);

      // If it's a rate limit (429) or auth error (401) or server error (5xx), try next key
      const isRetryable = error.message.includes('429') ||
                          error.message.includes('401') ||
                          error.message.includes('500') ||
                          error.message.includes('502') ||
                          error.message.includes('503') ||
                          error.message.includes('rate') ||
                          error.message.includes('limit') ||
                          error.message.includes('quota');

      if (!isRetryable && attempt === 0) {
        // For non-retryable errors on first attempt (like JSON parse failures), still try next key
        console.log('Non-rate-limit error, trying next key anyway...');
      }

      // Small delay before trying next key to avoid hammering the API
      if (attempt < API_KEYS.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
  }

  // All keys exhausted
  console.error('All API keys failed. Last error:', lastError?.message);
  return null;
}

async function fixCode(originalCode, errorMessage, projectFiles) {
  originalCode = originalCode.trim();
  if (originalCode.length > 50000) {
    originalCode = originalCode.substring(0, 50000);
  }
  originalCode = originalCode.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  const FIX_PROMPT = `You are Deplomot, a code-fixing AI. The user's code failed to run. Your job is to fix it.

You will receive:
1. The original code the user pasted
2. The error message that occurred
3. The current project files that were generated

Analyze the error, find the root cause, and return ONLY a valid JSON object with this EXACT structure — no markdown, no code fences, ONLY raw JSON:

{
  "summary": "Plain English explanation of what was wrong and what you fixed. Example: 'Fixed 2 issues: missing express import and wrong port number'",
  "issuesFound": 2,
  "frontend": {
    "files": [
      {
        "filename": "index.html",
        "content": "the full FIXED file content"
      }
    ]
  },
  "backend": {
    "language": "node",
    "files": [
      {
        "filename": "server.js",
        "content": "the full FIXED file content"
      }
    ]
  },
  "database": {
    "detected": false,
    "files": []
  },
  "dependencies": {
    "frontend": [],
    "backend": ["express", "cors"]
  }
}

IMPORTANT RULES:
1. Return ONLY valid JSON. No markdown. No backticks. No explanation outside JSON.
2. Fix ALL issues that could cause the error.
3. Include COMPLETE file contents — not just the changed parts.
4. The backend MUST listen on port 3847.
5. Ensure all required packages are in dependencies.
6. If a package is missing, add it to dependencies AND add the require/import in the code.
7. Always include cors and express.static for serving frontend.
8. Include a package.json in backend files with all dependencies.
9. Make sure the code actually works — test your logic mentally before returning.`;

  const filesDescription = projectFiles.map(f =>
    `--- ${f.category}/${f.filename} ---\n${f.content}`
  ).join('\n\n');

  const userMessage = `ORIGINAL CODE THE USER PASTED:
${originalCode}

ERROR THAT OCCURRED:
${errorMessage}

CURRENT PROJECT FILES:
${filesDescription}

Please fix all issues and return the corrected project as JSON.`;

  for (let attempt = 0; attempt < API_KEYS.length; attempt++) {
    const apiKey = getNextKey();
    const keyHint = `...${apiKey.slice(-6)}`;

    try {
      console.log(`[AI Fix] Attempting with key ${keyHint} (attempt ${attempt + 1})`);

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
          max_tokens: 32000,
          response_format: { type: 'json_object' }
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API status ${response.status}: ${errorText}`);
      }

      const data = await response.json();

      if (!data.choices || !data.choices[0] || !data.choices[0].message) {
        throw new Error('Unexpected API response format');
      }

      let content = data.choices[0].message.content.trim();
      content = content.replace(/^```json\s*/i, '');
      content = content.replace(/^```\s*/i, '');
      content = content.replace(/\s*```$/i, '');
      content = content.trim();

      const parsed = JSON.parse(content);

      // Validate and fill defaults
      if (!parsed.summary) parsed.summary = 'Fixed issues in your code.';
      if (!parsed.issuesFound) parsed.issuesFound = 1;
      if (!parsed.frontend) parsed.frontend = { files: [] };
      if (!parsed.backend) parsed.backend = { language: 'node', files: [] };
      if (!parsed.database) parsed.database = { detected: false, files: [] };
      if (!parsed.dependencies) parsed.dependencies = { frontend: [], backend: [] };

      // Ensure package.json exists in backend
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