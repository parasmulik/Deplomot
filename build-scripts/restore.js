const fs = require('fs');
const filesToRestore = ['utils/groq.js', 'main.js'];
filesToRestore.forEach(filePath => {
  if (fs.existsSync(filePath + '.bak')) {
    fs.copyFileSync(filePath + '.bak', filePath);
    fs.unlinkSync(filePath + '.bak');
    console.log('Restored:', filePath);
  }
});
