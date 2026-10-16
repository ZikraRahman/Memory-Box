const { rmSync } = require('node:fs');

rmSync('dist/main', { recursive: true, force: true });
rmSync('dist/shared', { recursive: true, force: true });
