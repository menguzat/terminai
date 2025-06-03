#!/usr/bin/env node

import { TerminaiShell } from './shell';

console.log('🚀 Terminai - AI-Enhanced Shell Wrapper');
console.log('Press Ctrl+C to exit\n');

const shell = new TerminaiShell();
shell.start().catch((error: unknown) => {
  console.error('Error starting Terminai:', error);
  process.exit(1);
}); 