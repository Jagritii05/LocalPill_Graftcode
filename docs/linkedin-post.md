# LinkedIn Publication: Building LocalPill with Graftcode

## Full Post Draft (Ready to Publish)

If you have ever tried building a desktop AI assistant on Windows, you have probably run straight into the classic split-brain problem.

Electron and Node.js are practically unmatched for building desktop experiences. You get floating glassmorphism overlays, global keyboard hooks, system tray menus, and active-window clipboard automation up and running in days.

The catch? The state-of-the-art local ML ecosystem lives almost entirely in Python (Faster-Whisper, CTranslate2, PyTorch).

Every developer who tries to bridge the two usually hits the same wall of ugly workarounds:

1. Spawning CLI child processes (like python.exe or curl.exe) on hotkey presses? On Windows, child-process initialization costs 15 to 50 ms of pure latency overhead per call, alongside zombie process headaches.
2. Spinning up an internal localhost HTTP REST microservice? Suddenly you are writing and maintaining 300+ lines of boilerplate HTTP server handlers, body parsers, socket timeouts, and error code translations across two runtimes.

When building LocalPill, an open-source private voice layer and visual memory assistant for Windows, we took a completely different approach using Graftcode Gateway (gg.exe).

Here is how the architecture works under the hood:

Instead of running an internal REST microservice, Graftcode Gateway hosts our Python SpeechService directly. It establishes a persistent WebSocket RPC connection to Electron and generates a type-safe client package (@graft/pypi-speech-gateway).

When you finish speaking, Electron encodes the completed audio recording as base64 and calls SpeechService.transcribeBytesJson(base64Audio) directly over WebSocket RPC. From the Node.js side, it looks and feels like calling a native local async function.

What made this architecture so compelling came down to three concrete wins:

1. Over 320 lines of integration boilerplate deleted.
We eliminated custom HTTP request handlers, URL routing, Content-Length body parsers, connection retry loops, and subprocess wrappers. The entire Node-to-Python bridge is handled declaratively.

2. True cross-language RPC with sub-millisecond transport.
For operational metadata and health calls, Graftcode WebSocket RPC clocks in at 0.46 ms (p50) on our benchmark harness, compared to 1.07 ms for loopback REST and 22.36 ms when spawning a CLI subprocess bridge.

3. Built-in, zero-code Model Context Protocol (MCP) endpoints.
Graftcode automatically exposes our Python speech and Node text methods as standard MCP endpoints at localhost:8085/mcp and localhost:8095/mcp. External AI agents like Claude Desktop or Google Antigravity can connect directly to transcribe audio files inside a hardened recordings folder without us having to author custom SSE servers or agent plugins.

On top of sub-second offline Faster-Whisper dictation, we built in contextual visual memory (capture a screen with "Hey Pill, remember this", then ask questions about that screen from Slack or email without switching windows) and opt-in multilingual Indic support (speak in Hindi and get clean Romanized output like "Mera naam Jagriti hai").

The entire project is open-source, including our automated test suites and reproducible benchmark harness.

Check out the repository on GitHub:
https://github.com/Jagritii05/LocalPill_Graftcode

If you are building cross-language desktop apps bridging Node.js frontends to Python ML backends, I would love to hear how you currently handle IPC and cross-runtime contracts!

#DeveloperTools #SoftwareArchitecture #Electron #Python #OpenSource #MachineLearning #Graftcode #VoiceAI #ModelContextProtocol
