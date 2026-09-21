'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { scenarios } = require('./scenarios');

const ARTIFACTS_DIR = path.join(__dirname, 'artifacts');
const GOLDEN_PATH = path.join(__dirname, 'golden.sha256');

async function runAllOnce() {
  const results = [];
  for (const s of scenarios) {
    let outcome;
    try {
      const { requests, response } = await s.run();
      outcome = { name: s.name, pass: true, error: null, requests, response };
    } catch (e) {
      outcome = { name: s.name, pass: false, error: e.message, requests: [], response: null };
    }
    results.push(outcome);
    process.stdout.write(`${outcome.pass ? 'PASS' : 'FAIL'}  ${s.name}${outcome.pass ? '' : '  -  ' + outcome.error}\n`);
  }
  return results;
}

function hashResults(results) {
  const normalized = results.map((r) => ({ name: r.name, pass: r.pass, requests: r.requests, response: r.response }));
  return crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

async function main() {
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });

  console.log('=== E2E run 1/2 ===');
  const run1 = await runAllOnce();
  const hash1 = hashResults(run1);

  console.log('\n=== E2E run 2/2 ===');
  const run2 = await runAllOnce();
  const hash2 = hashResults(run2);

  const anyFail = run1.some((r) => !r.pass) || run2.some((r) => !r.pass);

  const report = {
    generatedAt: new Date().toISOString(),
    hash: hash2,
    run1Hash: hash1,
    run2Hash: hash2,
    hashesMatch: hash1 === hash2,
    scenarios: run2,
  };
  fs.writeFileSync(path.join(ARTIFACTS_DIR, 'report.json'), JSON.stringify(report, null, 2));

  console.log(`\nRun 1 hash: ${hash1}`);
  console.log(`Run 2 hash: ${hash2}`);

  if (hash1 !== hash2) {
    console.error('FAIL: two consecutive runs produced different hashes (non-deterministic behavior).');
    process.exitCode = 1;
    return;
  }

  if (anyFail) {
    console.error('FAIL: one or more scenarios failed assertions.');
    process.exitCode = 1;
    return;
  }

  if (!fs.existsSync(GOLDEN_PATH)) {
    fs.writeFileSync(GOLDEN_PATH, hash2 + '\n');
    console.log(`No golden hash found; wrote ${GOLDEN_PATH}. Commit this file.`);
    return;
  }

  const golden = fs.readFileSync(GOLDEN_PATH, 'utf8').trim();
  if (golden !== hash2) {
    console.error(`FAIL: hash ${hash2} does not match golden.sha256 (${golden}).`);
    process.exitCode = 1;
    return;
  }

  console.log('OK: hashes match golden.sha256');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
