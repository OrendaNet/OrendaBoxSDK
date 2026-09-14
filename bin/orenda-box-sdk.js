#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { validateManifest } = require('../lib/manifest');
const [command, target, ...flags] = process.argv.slice(2);
try {
  if (command === 'create' && target) {
    const destination = path.resolve(target);
    if (fs.existsSync(destination)) throw new Error('Choose a new directory; existing projects are never overwritten');
    fs.cpSync(path.join(__dirname, '../templates/node-app'), destination, { recursive: true });
    fs.cpSync(path.join(__dirname, '../lib'), path.join(destination, 'sdk'), { recursive: true });
    fs.copyFileSync(path.join(__dirname, '../LICENSE'), path.join(destination, 'sdk/LICENSE'));
    console.log(`Created ${destination}\nNext: cd into that folder and run npm run dev`);
  } else if (command === 'validate' && target) {
    const errors = validateManifest(JSON.parse(fs.readFileSync(path.resolve(target), 'utf8')), { release: flags.includes('--release') });
    if (errors.length) throw new Error(errors.join('\n'));
    console.log('App manifest is valid' + (flags.includes('--release') ? ' for release.' : '. Run with --release before submission.'));
  } else {
    throw new Error('Usage: orenda-box-sdk create <new-folder> | validate <orenda-app.json> [--release]');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
