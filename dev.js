#!/usr/bin/env node

const { spawn } = require('child_process');

console.log('🚀 Starting development server...\n');

// Start the build watcher
const buildProcess = spawn('node', ['build.js', '--watch'], {
  stdio: 'inherit',
});

// Start the HTTP server
const serverProcess = spawn('node', ['server.js'], {
  stdio: 'inherit',
});

// Handle cleanup on exit
process.on('SIGINT', () => {
  console.log('\n\n👋 Shutting down...\n');
  buildProcess.kill();
  serverProcess.kill();
  process.exit(0);
});

// Handle errors
buildProcess.on('error', (err) => {
  console.error('Build process error:', err);
});

serverProcess.on('error', (err) => {
  console.error('Server process error:', err);
});

// Exit if either process exits unexpectedly
buildProcess.on('exit', (code) => {
  if (code !== null && code !== 0) {
    console.error('Build process exited with code', code);
    serverProcess.kill();
    process.exit(1);
  }
});

serverProcess.on('exit', (code) => {
  if (code !== null && code !== 0) {
    console.error('Server process exited with code', code);
    buildProcess.kill();
    process.exit(1);
  }
});
