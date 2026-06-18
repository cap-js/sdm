'use strict';

const path = require('path');
const { run } = require('./shell-script-runner');

const UPDATE_ENV_SCRIPT = path.join(__dirname, 'cf-update-env.sh');

/**
 * Updates an environment variable on the CF app defined in credentials.json,
 * then restages the app.
 *
 * @param {string} key - the environment variable name to set
 * @param {string} value - the value to assign
 */
async function updateEnv(key, value) {
  const exitCode = await run(UPDATE_ENV_SCRIPT, '--key', key, '--value', value);
  if (exitCode !== 0) {
    throw new Error(`cf-update-env.sh exited with non-zero code: ${exitCode}`);
  }
}

module.exports = { updateEnv };
