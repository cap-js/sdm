'use strict';

const { execFile } = require('child_process');
const path = require('path');

/**
 * Runs a shell script and returns its exit code.
 * stdout is streamed with [script] prefix, stderr with [script-err] prefix.
 *
 * @param {string} scriptPath - path to the .sh file
 * @param {...string} args - additional arguments forwarded to the script
 * @returns {Promise<number>} exit code of the process (0 = success)
 */
function run(scriptPath, ...args) {
  return new Promise((resolve, reject) => {
    const child = execFile('bash', [scriptPath, ...args], { maxBuffer: 10 * 1024 * 1024 });

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
 * @param {string} scriptPath - path to the .sh file
 * @param {...string} args - additional arguments forwarded to the script
 * @returns {Promise<string|null>} the last non-empty stdout line, or null if stdout was empty
 */
function runAndCaptureOutput(scriptPath, ...args) {
  return new Promise((resolve, reject) => {
    const stdoutLines = [];

    const child = execFile('bash', [scriptPath, ...args], { maxBuffer: 10 * 1024 * 1024 });

    child.stdout.on('data', data => {
      for (const line of data.toString().split('\n')) {
        if (line.trim()) stdoutLines.push(line.trim());
      }
    });

    child.stderr.on('data', data => {
      for (const line of data.toString().split('\n').filter(l => l)) {
        console.error(`[script-err] ${line}`);
      }
    });

    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) {
        reject(new Error(`${scriptPath} exited with code ${code}`));
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
 * @param {string} scriptPath - path to the .sh file
 * @param {...string} args - additional arguments forwarded to the script
 * @returns {Promise<{exitCode: number, lines: string[], output: string, containsIgnoreCase: function}>}
 */
function runAndCaptureAll(scriptPath, ...args) {
  return new Promise((resolve, reject) => {
    const stdoutLines = [];

    const child = execFile('bash', [scriptPath, ...args], { maxBuffer: 10 * 1024 * 1024 });

    child.stdout.on('data', data => {
      for (const line of data.toString().split('\n')) {
        if (line !== '') {
          console.log(`[script] ${line}`);
          stdoutLines.push(line);
        }
      }
    });

    child.stderr.on('data', data => {
      for (const line of data.toString().split('\n').filter(l => l)) {
        console.error(`[script-err] ${line}`);
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
