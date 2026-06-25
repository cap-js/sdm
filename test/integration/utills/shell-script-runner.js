'use strict';

const { execFile } = require('child_process');

/**
 * Runs a shell script and returns its exit code.
 * stdout is streamed with [script] prefix, stderr with [script-err] prefix.
 *
 * If the last argument is a plain object, it's treated as options:
 *   { env: {...} } — extra env vars merged on top of process.env for the child process.
 *
 * @param {string} scriptPath - path to the .sh file
 * @param {...(string|object)} args - additional arguments forwarded to the script,
 *   optionally followed by an options object
 * @returns {Promise<number>} exit code of the process (0 = success)
 */
function run(scriptPath, ...args) {
  let opts = {};
  if (args.length && typeof args[args.length - 1] === 'object' && args[args.length - 1] !== null && !Array.isArray(args[args.length - 1])) {
    opts = args.pop();
  }
  const execOpts = { maxBuffer: 10 * 1024 * 1024 };
  if (opts.env) execOpts.env = { ...process.env, ...opts.env };

  return new Promise((resolve, reject) => {
    const child = execFile('bash', [scriptPath, ...args], execOpts);

    child.stdout.on('data', data => {
      for (const line of data.toString().split('\n').filter(l => l)) {
        console.log(`[script] ${line}`);
      }
    });

    child.stderr.on('data', data => {
      for (const line of data.toString().split('\n').filter(l => l)) {
        console.error(`[script-err] ${line}`);
      }
    });

    child.on('error', reject);
    child.on('close', code => resolve(code));
  });
}

/**
 * Runs a shell script and returns the last non-empty line of stdout.
 * Useful for scripts that print a single result value as their final output line.
 *
 * If the last argument is a plain object, it's treated as options:
 *   { env: {...} } — extra env vars merged on top of process.env for the child process.
 *
 * @param {string} scriptPath - path to the .sh file
 * @param {...(string|object)} args - additional arguments forwarded to the script,
 *   optionally followed by an options object
 * @returns {Promise<string|null>} the last non-empty stdout line, or null if stdout was empty
 */
function runAndCaptureOutput(scriptPath, ...args) {
  let opts = {};
  if (args.length && typeof args[args.length - 1] === 'object' && args[args.length - 1] !== null && !Array.isArray(args[args.length - 1])) {
    opts = args.pop();
  }
  const execOpts = { maxBuffer: 10 * 1024 * 1024 };
  if (opts.env) execOpts.env = { ...process.env, ...opts.env };

  return new Promise((resolve, reject) => {
    const stdoutLines = [];
    const stderrLines = [];

    const child = execFile('bash', [scriptPath, ...args], execOpts);

    child.stdout.on('data', data => {
      for (const line of data.toString().split('\n')) {
        if (line.trim()) stdoutLines.push(line.trim());
      }
    });

    child.stderr.on('data', data => {
      for (const line of data.toString().split('\n').filter(l => l)) {
        stderrLines.push(line);
        console.error(`[script-err] ${line}`);
      }
    });

    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) {
        const output = stdoutLines.join('\n');
        const errOutput = stderrLines.join('\n');
        reject(new Error(`${scriptPath} exited with code ${code}\nstdout: ${output}\nstderr: ${errOutput}`));
      } else {
        resolve(stdoutLines.length > 0 ? stdoutLines[stdoutLines.length - 1] : null);
      }
    });
  });
}

/**
 * Runs a shell script and returns all stdout lines along with the exit code.
 * Does NOT throw on non-zero exit code.
 *
 * If the last argument is a plain object, it's treated as options:
 *   { silent: true } — do not mirror stdout to console (useful for cf-logs which
 *   can dump megabytes of binary cert data and JWT tokens).
 *   { env: {...} } — extra env vars merged on top of process.env for the child process.
 *
 * @param {string} scriptPath - path to the .sh file
 * @param {...(string|object)} args - additional arguments forwarded to the script,
 *   optionally followed by an options object
 * @returns {Promise<{exitCode: number, lines: string[], output: string, containsIgnoreCase: function}>}
 */
function runAndCaptureAll(scriptPath, ...args) {
  let opts = {};
  if (args.length && typeof args[args.length - 1] === 'object' && args[args.length - 1] !== null && !Array.isArray(args[args.length - 1])) {
    opts = args.pop();
  }
  const silent = opts.silent === true;
  const execOpts = { maxBuffer: 50 * 1024 * 1024 };
  if (opts.env) execOpts.env = { ...process.env, ...opts.env };

  return new Promise((resolve, reject) => {
    const stdoutLines = [];

    const child = execFile('bash', [scriptPath, ...args], execOpts);

    child.stdout.on('data', data => {
      for (const line of data.toString().split('\n')) {
        if (line !== '') {
          if (!silent) console.log(`[script] ${line}`);
          stdoutLines.push(line);
        }
      }
    });

    child.stderr.on('data', data => {
      for (const line of data.toString().split('\n').filter(l => l)) {
        if (!silent) console.error(`[script-err] ${line}`);
      }
    });

    child.on('error', reject);
    child.on('close', exitCode => {
      resolve({
        exitCode,
        lines: stdoutLines,
        get output() { return stdoutLines.join('\n'); },
        containsIgnoreCase(substring) {
          const lower = substring.toLowerCase();
          return stdoutLines.some(l => l.toLowerCase().includes(lower));
        }
      });
    });
  });
}

module.exports = { run, runAndCaptureOutput, runAndCaptureAll };

