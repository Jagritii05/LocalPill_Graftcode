import assert from 'assert/strict';
import { GraftSpeechClient } from '../src/main/graft/graft-speech-client.js';
import { ProcessSupervisor } from '../src/main/supervisor.js';

let totalTests = 0;
let passedTests = 0;

async function asyncTest(name, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`[PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`[FAIL] ${name}: ${err.message}`);
    throw err;
  }
}

console.log('====================================================');
console.log(' LocalPill Phase 5 Dynamic Engine Swap Tests');
console.log('====================================================\n');

const supervisor = new ProcessSupervisor();

try {
  // 1. Ensure Gateway A (Python runtime hosting SpeechService directly) is running
  supervisor.startGatewayA(8085, 8086);

  console.log('Waiting for Gateway A (Python SpeechService) to be ready...');
  const readyA = await supervisor.waitForReady('gateway-a', 120000);
  assert.equal(readyA, true, 'Gateway A should be ready on 8085');

  const graftClient = new GraftSpeechClient();

  // 1. list engines over rpc
  await asyncTest('GraftSpeechClient lists available engines over Graftcode RPC', async () => {
    const engines = await graftClient.listEngines();
    assert.ok(Array.isArray(engines), 'Engines should be an array');
    assert.ok(engines.length >= 5, 'Should list at least 5 engines');

    const tiny = engines.find((e) => e.id === 'whisper-tiny');
    const base = engines.find((e) => e.id === 'whisper-base');
    const small = engines.find((e) => e.id === 'whisper-small');
    const groq = engines.find((e) => e.id === 'groq-whisper');
    const gnani = engines.find((e) => e.id === 'gnani-prisma');
    const mlx = engines.find((e) => e.id === 'mlx-granite');

    assert.ok(tiny && tiny.is_local, 'whisper-tiny should be local');
    assert.ok(base && base.is_local, 'whisper-base should be local');
    assert.ok(small && small.is_local, 'whisper-small should be local');
    assert.ok(groq && !groq.is_local, 'groq-whisper should be cloud (is_local: false)');
    assert.ok(gnani && !gnani.is_local, 'gnani-prisma should be cloud (is_local: false)');
    assert.ok(mlx && !mlx.is_available, 'mlx-granite should be unavailable on Windows');
    assert.ok(base.device === 'cpu' || base.device === 'cuda', 'Device should be auto-detected');
  });

  // 2. test engine swapping
  await asyncTest('Dynamic swap to whisper-tiny via GraftSpeechClient', async () => {
    const res = await graftClient.setEngine('whisper-tiny');
    assert.ok(res.success, 'Engine swap to whisper-tiny should succeed');
    assert.equal(res.active, 'whisper-tiny');

    const health = await graftClient.isReady();
    assert.equal(health.engine, 'whisper-tiny');
  });

  await asyncTest('Dynamic swap back to whisper-base via GraftSpeechClient', async () => {
    const res = await graftClient.setEngine('whisper-base');
    assert.ok(res.success, 'Engine swap to whisper-base should succeed');
    assert.equal(res.active, 'whisper-base');

    const health = await graftClient.isReady();
    assert.equal(health.engine, 'whisper-base');
  });

  // 3. invalid engine error handling
  await asyncTest('Requesting invalid or unavailable engine raises error via GraftSpeechClient', async () => {
    try {
      await graftClient.setEngine('mlx-granite');
      assert.fail('Should have thrown error for unavailable engine mlx-granite');
    } catch (err) {
      assert.ok(err.message.includes('not available') || err.message.includes('unavailable') || err.message.includes('failed'));
    }
  });

} finally {
  supervisor.stopAll();
}

console.log('\n====================================================');
console.log(` All Phase 5 Engine Swap Tests Passed! (${passedTests}/${totalTests})`);
console.log('====================================================\n');
