#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { evaluatePublish } from './evaluate.js';

const file = process.argv[2];
if (!file) {
  console.error('用法: node src/cli.js <input.json>');
  process.exit(1);
}

const input = JSON.parse(await readFile(file, 'utf8'));
const result = evaluatePublish(input);
console.log(JSON.stringify(result, null, 2));
process.exit(result.publishable ? 0 : 2);
