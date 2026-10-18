/* =====================================================================
   Runs every test in turn (each is a standalone script):
   node tests/run-all.js
   ===================================================================== */
const { spawnSync } = require('child_process');
const fs = require('fs'),
  path = require('path');
fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });
let failed = 0;
for (const testName of ['smoke', 'engine', 'formats', 'base', 'ref', 'net', 'perf']) {
  console.log('\n== ' + testName);
  const child = spawnSync('node', [path.join(__dirname, testName + '.js')], { stdio: 'inherit', timeout: 300000 });
  if (child.status !== 0) failed++;
}
console.log('\n' + (failed ? failed + ' test file(s) failed' : 'all tests passed'));
process.exit(failed ? 1 : 0);
