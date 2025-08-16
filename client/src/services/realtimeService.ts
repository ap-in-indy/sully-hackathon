import { store } from '../store';
import { setConnectionStatus } from '../store/slices/sessionSlice';
import { setError } from '../store/slices/audioSlice';

export interface RealtimeConfig {
  encounterId: string;
  patientId: string;
  clinicianId: string;
}

class RealtimeService {
  private peerConnection: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private audioElement: HTMLAudioElement | null = null;
  private mediaStream: MediaStream | null = null;
  private isConnected = false;
  private config: RealtimeConfig | null = null;

  async initialize(config: RealtimeConfig): Promise<void> {
    // Clean up any existing session first
    if (this.isConnected || this.peerConnection || this.dataChannel) {
      await this.disconnect();
    }

    this.config = config;

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('getUserMedia is not supported in this browser');
      }

      // Get ephemeral token from your server
      const tokenResponse = await fetch('/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!tokenResponse.ok) {
        throw new Error('Failed to obtain OpenAI ephemeral token');
      }
      const tokenData = await tokenResponse.json();
      const ephemeralKey = tokenData.client_secret.value;

      // Create WebRTC peer connection
      this.peerConnection = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      });

      this.peerConnection.onconnectionstatechange = () => {
        const state = this.peerConnection?.connectionState;
        if (state === 'connected') {
          this.isConnected = true;
          store.dispatch(setConnectionStatus(true));
          store.dispatch(setError(null));
        } else if (state === 'disconnected' || state === 'failed' || state === 'closed') {
          this.isConnected = false;
          store.dispatch(setConnectionStatus(false));
        }
      };

      // Audio output element
      this.audioElement = document.createElement('audio');
      this.audioElement.autoplay = true;
      this.audioElement.style.display = 'none';
      document.body.appendChild(this.audioElement);

      // Remote audio
      this.peerConnection.ontrack = (event) => {
        if (this.audioElement) {
          this.audioElement.srcObject = event.streams[0];
        }
      };

      // Local microphone
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      // Add local audio to connection
      this.mediaStream.getTracks().forEach(track => {
        if (this.peerConnection) {
          this.peerConnection.addTrack(track, this.mediaStream!);
        }
      });

      // Data channel for minimal control/events
      this.dataChannel = this.peerConnection.createDataChannel('oai-events');
      this.dataChannel.onmessage = this.handleDataChannelMessage.bind(this);
      this.dataChannel.onopen = () => {
        this.sendSessionConfiguration();
      };

      // Create offer and send to OpenAI Realtime endpoint
      const offer = await this.peerConnection.createOffer();
      await this.peerConnection.setLocalDescription(offer);

      const baseUrl = 'https://api.openai.com/v1/realtime';
      const model = 'gpt-4o-realtime-preview-2025-06-03';

      const sdpResponse = await fetch(`${baseUrl}?model=${model}`, {
        method: 'POST',
        body: offer.sdp,
        headers: {
          'Authorization': `Bearer ${ephemeralKey}`,
          'Content-Type': 'application/sdp',
        },
      });

      if (!sdpResponse.ok) {
        throw new Error('Failed to establish WebRTC connection with OpenAI');
      }

      const answer: RTCSessionDescriptionInit = {
        type: 'answer',
        sdp: await sdpResponse.text(),
      };
      await this.peerConnection.setRemoteDescription(answer);

    } catch (error: any) {
      console.error('Realtime init error:', error);
      this.isConnected = false;
      store.dispatch(setConnectionStatus(false));
      store.dispatch(setError(error?.message || 'Realtime initialization failed'));
      await this.disconnect(); // ensure clean state on failure
    }
  }

  private sendSessionConfiguration(): void {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') return;

    // Audio-only, opposite-language interpreter. No text output. No meta talk.
    const sessionConfig = {
      type: 'session.update',
      session: {
        model: 'gpt-4o-realtime-preview-2025-06-03',
        modalities: ['audio'],
        // Voice to synthesize the translated speech
        voice: 'alloy',
        // Strong, global rule: translate to the opposite language as audio-only
        instructions: `
You are a real-time medical interpreter.
Behavior:
- Input can be English or Spanish.
- For each human speech turn, output ONLY the translation in the opposite language as spoken audio.
- Do not produce any text, captions, greetings, meta commentary, or explanations.
- Preserve tone and intent; no additions or omissions.
- If input is English, speak Spanish. If input is Spanish, speak English.
- Be concise when appropriate and keep the same register.
`,
        input_audio_transcription: { model: 'whisper-1' },
        temperature: 0.2,
        // Let the server VAD detect turns and automatically create responses
        turn_detection: {
          type: 'server_vad',
          create_response: true,
          speech_threshold_ms: 400
        }
      }
    };

    try {
      this.dataChannel.send(JSON.stringify(sessionConfig));
    } catch (err) {
      console.error('Failed to send session configuration:', err);
    }
  }

  private handleDataChannelMessage(event: MessageEvent): void {
    try {
      const data = JSON.parse(event.data);

      switch (data.type) {
        case 'error': {
          const err = data.error || {};
          console.error('Realtime API error:', err.type, err.code, err.param, err.message);
          store.dispatch(setError(err.message || 'Realtime error'));
          break;
        }

        // When the model starts/stops speaking, mute/unmute mic to prevent feedback/echo.
        case 'output_audio_buffer.started':
          this.muteInput(true);
          break;

        case 'output_audio_buffer.stopped':
          this.muteInput(false);
          break;

        // Optional logs
        case 'session.created':
        case 'session.updated':
        case 'rate_limits.updated':
        case 'response.created':
        case 'response.done':
        case 'response.cancelled':
          // No text handling; purely informational
          break;

        // If the user starts speaking while the model is talking, cancel model output
        case 'input_audio_buffer.speech_started':
          this.cancelOngoingResponse();
          break;

        default:
          // Ignore all text/transcript/content events
          break;
      }
    } catch {
      // Non-JSON messages can be ignored in this minimal client
    }
  }

  private muteInput(shouldMute: boolean): void {
    if (!this.mediaStream) return;
    for (const track of this.mediaStream.getTracks()) {
      if (track.kind === 'audio') track.enabled = !shouldMute;
    }
  }

  private cancelOngoingResponse(): void {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') return;
    try {
      this.dataChannel.send(JSON.stringify({ type: 'response.cancel' }));
    } catch (error) {
      console.error('Error cancelling response:', error);
    }
  }

  async disconnect(): Promise<void> {
    try {
      // Stop media
      if (this.mediaStream) {
        this.mediaStream.getTracks().forEach(t => t.stop());
        this.mediaStream = null;
      }

      if (this.dataChannel) {
        try { this.dataChannel.close(); } catch {}
        this.dataChannel = null;
      }

      if (this.peerConnection) {
        try { this.peerConnection.close(); } catch {}
        this.peerConnection = null;
      }

      if (this.audioElement) {
        this.audioElement.remove();
        this.audioElement = null;
      }

      this.isConnected = false;
      this.config = null;
      store.dispatch(setConnectionStatus(false));
      store.dispatch(setError(null));
    } catch (error) {
      console.error('Error during disconnect:', error);
    }
  }

  // Simple helpers for UI
  getConnectionStatus(): {
    isConnected: boolean;
    dataChannelState: string;
    peerConnectionState: string;
    iceConnectionState: string;
  } {
    return {
      isConnected: this.isConnected,
      dataChannelState: this.dataChannel?.readyState || 'none',
      peerConnectionState: this.peerConnection?.connectionState || 'none',
      iceConnectionState: this.peerConnection?.iceConnectionState || 'none',
    };
  }

  toggleMute(): void {
    if (!this.mediaStream) return;
    const audioTracks = this.mediaStream.getAudioTracks();
    if (!audioTracks.length) return;
    const next = !audioTracks[0].enabled;
    audioTracks.forEach(t => { if (t.kind === 'audio') t.enabled = next; });
  }

  isMuted(): boolean {
    if (!this.mediaStream) return false;
    const t = this.mediaStream.getAudioTracks()[0];
    return t ? !t.enabled : false;
  }
}

export const realtimeService = new RealtimeService();
export default realtimeService;
