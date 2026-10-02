# Deplomot
Desktop app that lets you paste AI-generated code, preview it instantly as a local website, and deploy it to a live URL in one click.

## Features
- Paste code and get an instant local preview
- AI features powered by the Groq API (Llama 3.3 70B) with rotating API key management
- One-click deployment to Netlify via OAuth

## Tech Stack
Electron.js, Node.js, Groq API, Netlify

## Setup
1. Clone the repo and run npm install
2. Copy .env.example to .env and add your own Groq key(s) to GROQ_KEYS
3. Run npm start

## Status
Built as a solo project using AI-assisted development tools. Sunset after market validation showed no repeatable use case for the target users.

## Live Site
https://deplomot.netlify.app
