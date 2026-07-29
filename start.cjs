const { spawn } = require('child_process');
const s = spawn('npx', ['tsx', 'server.ts'], { cwd: __dirname, shell: true, stdio: 'inherit' });
s.on('error', e => console.error(e));
setTimeout(() => console.log('Server starting...'), 1000);