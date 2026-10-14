#!/usr/bin/env node
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createServer } from './server.mjs';

try {
  // Construct first so missing configuration fails before the transport starts.
  const server = createServer();
  const handle = serveStdio(() => server);
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => void handle.close());
  }
} catch (error) {
  console.error(`InsAuto MCP: ${error.message}`);
  process.exitCode = 1;
}
