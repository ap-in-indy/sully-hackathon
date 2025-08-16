import { store } from '../store';
import { setConnectionStatus } from '../store/slices/sessionSlice';
import { setError } from '../store/slices/audioSlice';

export interface RealtimeConfig {
  encounterId: string;
  patientId: string;
  clinicianId: string;
  // Optional overrides
  model?: string;
  voice?: string;
  useSemanticVAD?: boolean;
  temperature?: number; // Realtime requires >= 0.6
}

class RealtimeService {
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private audioEl: HTMLAudioElement | null = null;
  private localStream: MediaStream | null = null;

  private isConnected = false;
  private isInitializing = false;
  private config: RealtimeConfig | null = null;

  // Track when AI is speaking so we can avoid acoustic echo
  private isAiSpeaking = false;

  // NEW: accumulate text output per response so we can parse JSON after it's complete
  private textBuffers: Map<string, { acc: string; logged: boolean }> = new Map();

  async initialize(config: RealtimeConfig): Promise<void> {
    // Prevent concurrent init
    if (this.isInitializing) return;

    // Always start clean
    if (this.isConnected || this.pc || this.dc) {
      await this.disconnect();
    }

    this.isInitializing = true;
    this.config = config;

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('getUserMedia is not supported in this browser');
      }

      // Fetch an ephemeral token from your backend (server-side signs it with your real API key)
      const tokenResp = await fetch('/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!tokenResp.ok) throw new Error('Failed to obtain OpenAI ephemeral token');
      const tokenData = await tokenResp.json();
      const ephemeralKey = tokenData?.client_secret?.value;
      if (!ephemeralKey) throw new Error('Ephemeral token missing from response');

      // Create RTCPeerConnection
      // max-bundle = one 5‑tuple for all m-lines (fewer transports; simpler; widely recommended)
      this.pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
        bundlePolicy: 'max-bundle',
      });

      // 1) Create the DataChannel BEFORE adding media tracks.
      // This ensures m=application appears before m=audio in the SDP, which some endpoints prefer.
      this.dc = this.pc.createDataChannel('oai-events');
      this.dc.onmessage = this.onDCMessage;
      this.dc.onopen = () => this.sendSessionConfiguration();

      // 2) Prepare remote audio sink
      this.audioEl = document.createElement('audio');
      this.audioEl.autoplay = true;
      //this.audioEl.playsInline = true; // iOS autoplay policy
      this.audioEl.style.display = 'none';
      document.body.appendChild(this.audioEl);

      // 3) Attach remote track to the audio element
      this.pc.ontrack = (e) => {
        if (this.audioEl) this.audioEl.srcObject = e.streams[0];
      };

      // 4) Capture mic (single mic shared by clinician + patient)
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      // 5) Add local audio track(s) after data channel creation
      this.localStream.getTracks().forEach((t) => this.pc!.addTrack(t, this.localStream!));

      // 6) Create offer -> send to OpenAI Realtime WebRTC endpoint -> set remote answer
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);

      // Use a conservative, widely available snapshot by default; allow override from config
      const model = this.config.model || 'gpt-4o-realtime-preview-2024-12-17';
      const baseUrl = 'https://api.openai.com/v1/realtime';

      const sdpResp = await fetch(`${baseUrl}?model=${encodeURIComponent(model)}`, {
        method: 'POST',
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${ephemeralKey}`,
          'Content-Type': 'application/sdp',
        },
      });
      if (!sdpResp.ok) throw new Error('Failed to establish WebRTC connection with OpenAI');

      const answerSdp = await sdpResp.text();
      if (!this.pc || this.pc.connectionState === 'closed') {
        throw new Error('Peer connection was closed during initialization');
      }
      await this.pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });

      // Connection state monitoring
      this.pc.onconnectionstatechange = () => {
        const state = this.pc?.connectionState;
        if (state === 'connected') {
          this.isConnected = true;
          store.dispatch(setConnectionStatus(true));
          store.dispatch(setError(null));
        } else if (state === 'disconnected' || state === 'failed' || state === 'closed') {
          this.isConnected = false;
          store.dispatch(setConnectionStatus(false));
        }
      };

      this.pc.oniceconnectionstatechange = () => {
        // Optional: log or surface to UI
        // console.log('ICE state:', this.pc?.iceConnectionState);
      };
    } catch (err: any) {
      console.error('Realtime init error:', err);
      this.isConnected = false;
      store.dispatch(setConnectionStatus(false));
      store.dispatch(setError(err?.message || 'Realtime initialization failed'));
      await this.disconnect(); // ensure clean state
    } finally {
      this.isInitializing = false;
    }
  }

  // Send initial session configuration once the DataChannel is open.
  // Notes:
  // - Realtime supports modalities ["text"] or ["audio","text"] only.
  // - Temperature must be >= 0.6 (defaults here to 0.8).
  // - We use semantic VAD so the model uses semantics (AI) to end turns.
  // - We explicitly instruct the model to infer speaker role (Clinician vs Patient) from content,
  //   since both share a single mic; output is audio-only translation to the opposite language.
  private sendSessionConfiguration(): void {
    if (!this.dc || this.dc.readyState !== 'open') return;

    const useSemanticVAD = this.config?.useSemanticVAD !== false; // default true
    const sessionConfig = {
      type: 'session.update',
      session: {
        model: this.config?.model || 'gpt-4o-realtime-preview-2024-12-17',
        modalities: ['audio', 'text'],
        voice: this.config?.voice || 'alloy',
        // IMPORTANT: Do not forbid all text; permit exactly one JSON via tool call.
        instructions: `You are a real-time English–Spanish medical interpreter for a clinician–patient encounter using a single shared microphone.

Behavior:

Infer who is speaking (Clinician or Patient) purely from the content and context of the utterance.
For each turn, speak ONLY the translation into the other party's language as audio.
Maintain tone and register; be literal and concise. Do not add or omit information.
After you finish speaking the audio for a turn:

Call the tool "emit_metadata" exactly once with the following keys: { "Source Language": "<English|Spanish>", "Output Language": "<English|Spanish>", "Original Text": "<verbatim transcript of the speaker's utterance>", "Translated Text": "<the translation you just spoke>", "Intent Detected": "<one of: schedule follow-up appointment | order lab test | order prescription | none>" }
Do not include any other text output beyond this tool call.`,
        tools: [{
          type: 'function',
          name: 'emit_metadata',
          description: 'Emit per-turn translation metadata after the audio translation is finished.',
          parameters: {
            type: 'object',
            properties: {
              'Source Language': {
                type: 'string',
                enum: ['English', 'Spanish']
              },
              'Output Language': {
                type: 'string',
                enum: ['English', 'Spanish']
              },
              'Original Text': {
                type: 'string'
              },
              'Translated Text': {
                type: 'string'
              },
              'Intent Detected': {
                type: 'string',
                enum: ['schedule follow-up appointment', 'order lab test', 'order prescription', 'none'],
              },
            },
            required: ['Source Language', 'Output Language', 'Original Text', 'Translated Text', 'Intent Detected',],
            additionalProperties: false,
          },
        },
        ],
        input_audio_transcription: {
          model: 'whisper-1',
          prompt: 'Transcribe literally; do not paraphrase.',
        },
        temperature: Math.max(this.config?.temperature ?? 0.8, 0.6),
        max_response_output_tokens: 300,
        turn_detection: useSemanticVAD ? {
          type: 'semantic_vad',
          eagerness: 'medium',
          create_response: true,
          interrupt_response: true,
        } : {
          type: 'server_vad',
          threshold: 0.5,
          prefix_padding_ms: 250,
          silence_duration_ms: 500,
          create_response: true,
          interrupt_response: true,
        },
      },
    };

    try {
      this.dc.send(JSON.stringify(sessionConfig));
    } catch (err) {
      console.error('Failed to send session configuration:', err);
      store.dispatch(setError('Failed to configure translation session'));
    }
  }

  // Handle DataChannel events from OpenAI
  private onDCMessage = (event: MessageEvent) => {
    try {
      const data = JSON.parse(event.data);

      // NEW: small helper to get a stable response id for buffering
      const getResponseId = (ev: any): string => {
        return (
          ev?.response_id ||
          ev?.response?.id ||
          ev?.id || // fallback (shouldn't normally be needed)
          'default'
        );
      };

      // NEW: helper for function call args per response id
      const getBuf = (rid: string) => {
        const existing = this.textBuffers.get(rid) || { acc: '', logged: false };
        return existing;
      };

      switch (data.type) {
        // Robust error surfacing
        case 'error': {
          const e = data.error || {};
          console.error('Realtime API error:', e.type, e.code, e.param, e.message);
          store.dispatch(setError(e.message || 'Realtime error'));
          break;
        }

        // PRIMARY PATH: tool/function call for structured JSON
        case 'response.function_call_arguments.delta':
        case 'response.tool_call_arguments.delta': {
          const rid = getResponseId(data);
          const buf = getBuf(rid);
          if (typeof data.delta === 'string') buf.acc += data.delta;
          this.textBuffers.set(rid, buf);
          break;
        }
        case 'response.function_call_arguments.done':
        case 'response.tool_call_arguments.done': {
          const rid = getResponseId(data);
          const buf = getBuf(rid);
          const text = buf.acc.trim();
          if (text && !buf.logged) {
            this.tryLogJson(text); // arguments are a JSON string
            buf.logged = true;
            this.textBuffers.set(rid, buf);
          }
          break;
        }

        // Mute/unmute our mic while the model speaks to prevent feedback/echo bleed
        case 'output_audio_buffer.started':
          this.isAiSpeaking = true;
          this.muteInput(true);
          break;
        case 'output_audio_buffer.stopped':
          this.isAiSpeaking = false;
          this.muteInput(false);
          break;

        // Optional heartbeat/info
        case 'session.created':
        case 'session.updated':
        case 'rate_limits.updated':
          // No-op; available for diagnostics if needed
          break;

        // If a user starts speaking while the model is talking, cancel immediately
        case 'input_audio_buffer.speech_started':
          if (this.isAiSpeaking) this.cancelOngoingResponse(); // avoid "no active response" error
          break;

        // FALLBACK PATH: free-text JSON (if tool call not used)
        case 'response.text.delta':
        case 'response.output_text.delta': {
          const rid = getResponseId(data);
          const buf = getBuf(rid);
          if (typeof data.delta === 'string') buf.acc += data.delta;
          this.textBuffers.set(rid, buf);
          break;
        }
        case 'response.text.done':
        case 'response.output_text.done': {
          const rid = getResponseId(data);
          const buf = getBuf(rid);
          const text = buf.acc?.trim?.() || (typeof data.text === 'string' ? data.text.trim() : '');
          if (text && !buf.logged) {
            this.tryLogJson(text);
            buf.logged = true;
            this.textBuffers.set(rid, buf);
          }
          break;
        }

        case 'response.done': {
          // Safety net: if we somehow missed *.done but have buffered text, attempt parse+log now.
          const rid = getResponseId(data);
          const buf = this.textBuffers.get(rid);
          if (buf && buf.acc && !buf.logged) {
            this.tryLogJson(buf.acc.trim());
            buf.logged = true;
            this.textBuffers.set(rid, buf);
          }
          // Cleanup any buffers we no longer need to hold
          this.textBuffers.delete(rid);
          break;
        }

        default:
          // Keep unknown types from spamming logs
          // console.debug('Unhandled event:', data.type);
          break;
      }
    } catch {
      // Swallow parse errors to keep the loop resilient
    }
  };

  // NEW: Parse and log JSON only if it looks like the model emitted the required object.
  // We intentionally do not mutate UI state or behavior to keep translation stable.
  private tryLogJson(text: string): void {
    const s = text.trim();
    const looksLikeJson = s.startsWith('{') && s.endsWith('}');
    if (!looksLikeJson) return;
    try {
      const obj = JSON.parse(s);
      const hasKeys =
        obj &&
        typeof obj === 'object' &&
        'Source Language' in obj &&
        'Output Language' in obj &&
        'Original Text' in obj &&
        'Translated Text' in obj &&
        'Intent Detected' in obj;

      if (hasKeys) {
        console.log('[Realtime JSON]', obj);
      }
    } catch {
      // ignore malformed
    }
  }

  private muteInput(shouldMute: boolean): void {
    if (!this.localStream) return;
    for (const track of this.localStream.getTracks()) {
      if (track.kind === 'audio') track.enabled = !shouldMute;
    }
  }

  private cancelOngoingResponse(): void {
    if (!this.dc || this.dc.readyState !== 'open') return;
    // It's safe to send response.cancel even if there isn't active output;
    // the server ignores it if nothing is playing.
    try {
      this.dc.send(JSON.stringify({ type: 'response.cancel' }));
    } catch (err) {
      console.error('Error cancelling response:', err);
    }
  }

  async disconnect(): Promise<void> {
    if (this.isInitializing) return;

    try {
      if (this.localStream) {
        this.localStream.getTracks().forEach((t) => t.stop());
        this.localStream = null;
      }
      if (this.dc) {
        try { this.dc.close(); } catch { }
        this.dc = null;
      }
      if (this.pc) {
        try { this.pc.close(); } catch { }
        this.pc = null;
      }
      if (this.audioEl) {
        this.audioEl.remove();
        this.audioEl = null;
      }

      this.isConnected = false;
      this.isAiSpeaking = false;
      this.config = null;

      // NEW: clear any partial buffers
      this.textBuffers.clear();

      store.dispatch(setConnectionStatus(false));
      store.dispatch(setError(null));
    } catch (err) {
      console.error('Error during disconnect:', err);
    }
  }

  // UI helpers
  getConnectionStatus(): {
    isConnected: boolean;
    dataChannelState: string;
    peerConnectionState: string;
    iceConnectionState: string;
  } {
    return {
      isConnected: this.isConnected,
      dataChannelState: this.dc?.readyState || 'none',
      peerConnectionState: this.pc?.connectionState || 'none',
      iceConnectionState: this.pc?.iceConnectionState || 'none',
    };
  }

  isInitialized(): boolean {
    return !!(this.pc && this.dc && this.localStream && this.audioEl);
  }

  getConnectionDetails(): {
    isInitialized: boolean;
    isConnected: boolean;
    hasMediaStream: boolean;
    hasAudioElement: boolean;
    dataChannelReady: boolean;
    peerConnectionValid: boolean;
  } {
    return {
      isInitialized: this.isInitialized(),
      isConnected: this.isConnected,
      hasMediaStream: !!this.localStream,
      hasAudioElement: !!this.audioEl,
      dataChannelReady: this.dc?.readyState === 'open',
      peerConnectionValid: !!(this.pc && this.pc.connectionState !== 'closed'),
    };
  }

  toggleMute(): void {
    if (!this.localStream) return;
    const audioTracks = this.localStream.getAudioTracks();
    if (!audioTracks.length) return;
    const next = !audioTracks[0].enabled;
    audioTracks.forEach((t) => { if (t.kind === 'audio') t.enabled = next; });
  }

  isMuted(): boolean {
    if (!this.localStream) return false;
    const t = this.localStream.getAudioTracks()[0];
    return t ? !t.enabled : false;
  }
}

export const realtimeService = new RealtimeService();
export default realtimeService;