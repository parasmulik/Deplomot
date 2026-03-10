document.addEventListener('DOMContentLoaded', () => {
  const apiKeyInput = document.getElementById('api-key');
  const saveBtn = document.getElementById('save-btn');
  const btnText = saveBtn.querySelector('.btn-text');
  const btnLoader = saveBtn.querySelector('.btn-loader');
  const errorMsg = document.getElementById('error-msg');
  const groqLink = document.getElementById('groq-link');

  groqLink.addEventListener('click', (e) => {
    e.preventDefault();
    window.electronAPI.openExternal('https://console.groq.com/keys');
  });

  saveBtn.addEventListener('click', async () => {
    const apiKey = apiKeyInput.value.trim();

    if (!apiKey) {
      showError('Please enter your Groq API key.');
      return;
    }

    if (!apiKey.startsWith('gsk_')) {
      showError('That doesn\'t look like a valid Groq API key. It should start with "gsk_".');
      return;
    }

    if (apiKey.length < 20) {
      showError('That API key seems too short. Please check and try again.');
      return;
    }

    // Show loading
    btnText.style.display = 'none';
    btnLoader.style.display = 'inline-block';
    saveBtn.disabled = true;
    errorMsg.style.display = 'none';

    try {
      const result = await window.electronAPI.saveApiKey(apiKey);

      if (result.success) {
        // Window will be closed by main process
      } else {
        showError(result.error || 'Could not save API key. Please try again.');
        resetButton();
      }
    } catch (error) {
      showError('Something went wrong. Please try again.');
      resetButton();
    }
  });

  apiKeyInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      saveBtn.click();
    }
  });

  function showError(message) {
    errorMsg.textContent = message;
    errorMsg.style.display = 'block';
  }

  function resetButton() {
    btnText.style.display = 'inline';
    btnLoader.style.display = 'none';
    saveBtn.disabled = false;
  }
});