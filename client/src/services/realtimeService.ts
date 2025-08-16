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
        // Explicit, focused instructions for a medical interpreter with one shared mic
        instructions: `
You are a real-time English–Spanish medical interpreter for a clinician–patient encounter using a single shared microphone.

Behavior:
- Infer who is speaking (Clinician or Patient) purely from the content and context of the utterance.
- For each turn, speak ONLY the translation into the other party's language as audio.
- Maintain tone and register; be literal and concise. Do not add or omit information.
- Do NOT output any text, captions, meta talk, acknowledgements, or explanations.
- If uncertain who is speaking, make your best inference; avoid asking meta-questions.
- If a greeting or short phrase is spoken, return only its literal translation as audio (e.g., “Hola” -> “Hello”).
        `.trim(),
        input_audio_transcription: {
          // Realtime supports multiple ASR options; keep whisper-1 for broad access
          model: 'whisper-1',
          prompt: 'Transcribe literally; do not paraphrase.',
        },
        temperature: Math.max(this.config?.temperature ?? 0.8, 0.6),
        max_response_output_tokens: 300,
        // Let the server detect turns and automatically create responses
        turn_detection: useSemanticVAD
          ? {
              type: 'semantic_vad',
              eagerness: 'medium',
              create_response: true,
              interrupt_response: true,
            }
          : {
              // Optional fallback: traditional VAD based on silence thresholds
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
      switch (data.type) {
        // Robust error surfacing
        case 'error': {
          const e = data.error || {};
          console.error('Realtime API error:', e.type, e.code, e.param, e.message);
          store.dispatch(setError(e.message || 'Realtime error'));
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
          this.cancelOngoingResponse();
          break;

        default:
          // Keep unknown types from spamming logs
          // console.debug('Unhandled event:', data.type);
          break;
      }
    } catch {
      // Swallow parse errors to keep the loop resilient
    }
  };

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
        try { this.dc.close(); } catch {}
        this.dc = null;
      }
      if (this.pc) {
        try { this.pc.close(); } catch {}
        this.pc = null;
      }
      if (this.audioEl) {
        this.audioEl.remove();
        this.audioEl = null;
      }

      this.isConnected = false;
      this.isAiSpeaking = false;
      this.config = null;

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
