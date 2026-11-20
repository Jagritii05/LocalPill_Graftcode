import { GraftSpeechClient } from '../src/main/graft/graft-speech-client.js';
import { GraftTextClient } from '../src/main/graft/graft-text-client.js';
import { ProcessSupervisor } from '../src/main/supervisor.js';

function createSineWavBuffer(durationSec = 1.0, sampleRate = 16000) {
  const numSamples = Math.floor(durationSec * sampleRate);
  const dataSize = numSamples * 2;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);

  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);

  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < numSamples; i++) {
    const val = Math.floor(32767 * 0.3 * Math.sin(2 * Math.PI * 440 * i / sampleRate));
    buffer.writeInt16LE(val, 44 + i * 2);
  }
  return buffer;
}

async function main() {
  const supervisor = new ProcessSupervisor();

  console.log('[Phase 3 E2E] Starting Graftcode Gateway A (Python SpeechService) on port 8085...');
  supervisor.startGatewayA(8085, 8086);

  console.log('[Phase 3 E2E] Starting Graftcode Gateway B (Node.js TextPipelineService) on port 8095...');
  supervisor.startGatewayB(8095, 8096);

  try {
    console.log('[Phase 3 E2E] Waiting for gateways to become ready...');
    const ready = await supervisor.waitForAllReady('graft', 120000);
    if (!ready) {
      throw new Error('Gateways did not become ready in time.');
    }

    const speechClient = new GraftSpeechClient();
    const textClient = new GraftTextClient();

    let gatewaysReady = false;
    for (let i = 0; i < 15; i++) {
      try {
        const healthA = await speechClient.isReady();
        const healthB = await textClient.health();
        if (healthA && healthA.ready && healthB && healthB.ready) {
          gatewaysReady = true;
          console.log('[Phase 3 E2E] Both Gateway A (Python) and Gateway B (Node.js) are ready over Graftcode RPC!');
          break;
        }
      } catch (_) {}
      await new Promise((r) => setTimeout(r, 1000));
    }

    if (!gatewaysReady) {
      throw new Error('Gateways did not report healthy in time.');
    }

    // 1. speech transcription over rpc
    console.log('[Phase 3 E2E] Testing Speech Transcription over Graftcode RPC (Gateway A)...');
    const wavBuf = createSineWavBuffer(1.0);
    const sttRes = await speechClient.transcribe(wavBuf);
    console.log(`[Phase 3 E2E] Gateway A transcribe result: duration=${sttRes.duration}s, language=${sttRes.language}, text="${sttRes.text}"`);
    if (typeof sttRes.duration !== 'number' || sttRes.duration <= 0) {
      throw new Error(`Expected valid duration from Gateway A transcribe, got: ${JSON.stringify(sttRes)}`);
    }

    // 2. text normalization via rpc
    console.log('[Phase 3 E2E] Testing Text Pipeline over Graftcode RPC (Gateway B)...');
    const rawTranscript =
      'um uh hello comma please charge my card 4532 0151 1283 0366 period send receipt to :email exclamation mark';
    const cleanResult = await textClient.process(rawTranscript, {
      snippets: { ':email': 'user@example.com' },
    });

    console.log(`[Phase 3 E2E] Input : "${rawTranscript}"`);
    console.log(`[Phase 3 E2E] Output: "${cleanResult}"`);

    if (!cleanResult.includes('user@example.com')) {
      throw new Error('Expected snippet :email to be expanded by Gateway B');
    }
    if (cleanResult.includes('um') || cleanResult.includes('uh')) {
      throw new Error('Expected filler words to be removed by Gateway B');
    }

    // 3. mcp clean text tool call
    console.log('[Phase 3 E2E] Testing MCP CleanTextJson static method...');
    const mcpClean = await textClient.cleanTextJson('um I need to buy milk period');
    console.log(`[Phase 3 E2E] MCP Clean Result: "${mcpClean}"`);
    if (mcpClean !== 'I need to buy milk.') {
      throw new Error(`Expected "I need to buy milk.", got "${mcpClean}"`);
    }

    console.log('[Phase 3 E2E] ALL PHASE 3 PIPELINE & GRAFTCODE TESTS PASSED! [OK]');
  } finally {
    console.log('[Phase 3 E2E] Cleaning up background processes...');
    supervisor.stopAll();
  }
}

main().catch((err) => {
  console.error('[Phase 3 E2E Failed]', err);
  process.exit(1);
});
