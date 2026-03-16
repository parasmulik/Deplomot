const JavaScriptObfuscator = require('javascript-obfuscator');
const fs = require('fs');
const path = require('path');

const filesToObfuscate = [
  'utils/groq.js',
  'main.js'
];

filesToObfuscate.forEach(filePath => {
  const code = fs.readFileSync(filePath, 'utf8');
  const obfuscated = JavaScriptObfuscator.obfuscate(code, {
    compact: true,
    controlFlowFlattening: true,
    deadCodeInjection: false,
    stringEncryption: true,
    rotateStringArray: true,
    shuffleStringArray: true,
    splitStrings: true,
    splitStringsChunkLength: 5
  });
  fs.writeFileSync(filePath + '.bak', code);
  fs.writeFileSync(filePath, obfuscated.getObfuscatedCode());
  console.log('Obfuscated:', filePath);
});
