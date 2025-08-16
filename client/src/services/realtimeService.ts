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
  private isInitializing = false; // Guard against concurrent initialization

  async initialize(config: RealtimeConfig): Promise<void> {
    // Prevent concurrent initialization
    if (this.isInitializing) {
      console.log('Initialization already in progress, skipping...');
      return;
    }

    // Clean up any existing session first
    if (this.isConnected || this.peerConnection || this.dataChannel) {
      await this.disconnect();
    }

    this.isInitializing = true;
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

      // Create data channel FIRST (before any media tracks)
      // This ensures m=application comes before m=audio in the SDP
      this.dataChannel = this.peerConnection.createDataChannel('oai-events');
      this.dataChannel.onmessage = this.handleDataChannelMessage.bind(this);
      this.dataChannel.onopen = () => {
        this.sendSessionConfiguration();
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

      // Add local audio to connection AFTER data channel creation
      this.mediaStream.getTracks().forEach(track => {
        if (this.peerConnection) {
          this.peerConnection.addTrack(track, this.mediaStream!);
        }
      });

      // Create offer and send to OpenAI Realtime endpoint
      const offer = await this.peerConnection.createOffer();
      
      // Log m-lines for debugging
      if (offer.sdp) {
        const offerMLines = offer.sdp.match(/^m=.*$/gm);
        console.log('Offer m-lines order:', offerMLines);
      }
      
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

      const answerSdp = await sdpResponse.text();
      
      // Log answer m-lines for debugging
      if (answerSdp) {
        const answerMLines = answerSdp.match(/^m=.*$/gm);
        console.log('Answer m-lines order:', answerMLines);
      }
      
      // Verify peer connection is still valid
      if (!this.peerConnection || this.peerConnection.connectionState === 'closed') {
        throw new Error('Peer connection was closed during initialization');
      }

      const answer: RTCSessionDescriptionInit = {
        type: 'answer',
        sdp: answerSdp,
      };

      await this.peerConnection.setRemoteDescription(answer);

      // Set up connection state monitoring AFTER successful SDP exchange
      this.peerConnection.onconnectionstatechange = () => {
        const state = this.peerConnection?.connectionState;
        console.log('Peer connection state changed:', state);
        
        if (state === 'connected') {
          this.isConnected = true;
          store.dispatch(setConnectionStatus(true));
          store.dispatch(setError(null));
        } else if (state === 'disconnected' || state === 'failed' || state === 'closed') {
          this.isConnected = false;
          store.dispatch(setConnectionStatus(false));
        }
      };

      // Monitor ICE connection state
      this.peerConnection.oniceconnectionstatechange = () => {
        console.log('ICE connection state:', this.peerConnection?.iceConnectionState);
      };

    } catch (error: any) {
      console.error('Realtime init error:', error);
      this.isConnected = false;
      store.dispatch(setConnectionStatus(false));
      store.dispatch(setError(error?.message || 'Realtime initialization failed'));
      await this.disconnect(); // ensure clean state on failure
    } finally {
      this.isInitializing = false; // Always reset the flag
    }
  }

  private sendSessionConfiguration(): void {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      console.warn('Data channel not ready for session configuration');
      return;
    }

    // Audio-only, opposite-language interpreter. No text output. No meta talk.
    const sessionConfig = {
      type: 'session.update',
      session: {
        model: 'gpt-4o-realtime-preview-2025-06-03',
        modalities: ['audio', 'text'],
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
        temperature: 0.6,
        // Let the server VAD detect turns and automatically create responses
        turn_detection: {
          type: 'server_vad',
          create_response: true
        }
      }
    };

    try {
      console.log('Sending session configuration...');
      this.dataChannel.send(JSON.stringify(sessionConfig));
      console.log('Session configuration sent successfully');
    } catch (err) {
      console.error('Failed to send session configuration:', err);
      store.dispatch(setError('Failed to configure translation session'));
    }
  }

  private handleDataChannelMessage(event: MessageEvent): void {
    try {
      const data = JSON.parse(event.data);
      console.log('Received data channel message:', data.type);

      switch (data.type) {
        case 'error': {
          const err = data.error || {};
          console.error('Realtime API error:', err.type, err.code, err.param, err.message);
          store.dispatch(setError(err.message || 'Realtime error'));
          break;
        }

        // When the model starts/stops speaking, mute/unmute mic to prevent feedback/echo.
        case 'output_audio_buffer.started':
          console.log('AI started speaking - muting input');
          this.muteInput(true);
          break;

        case 'output_audio_buffer.stopped':
          console.log('AI stopped speaking - unmuting input');
          this.muteInput(false);
          break;

        // Optional logs
        case 'session.created':
          console.log('Session created successfully');
          break;
        case 'session.updated':
          console.log('Session configuration applied');
          break;
        case 'rate_limits.updated':
          console.log('Rate limits updated:', data);
          break;
        case 'response.created':
          console.log('AI response created');
          break;
        case 'response.done':
          console.log('AI response completed');
          break;
        case 'response.cancelled':
          console.log('AI response cancelled');
          break;

        // If the user starts speaking while the model is talking, cancel model output
        case 'input_audio_buffer.speech_started':
          console.log('User speech detected - cancelling AI response');
          this.cancelOngoingResponse();
          break;

        default:
          // Log unknown message types for debugging
          console.log('Unknown message type:', data.type, data);
          break;
      }
    } catch (error) {
      // Log parsing errors for debugging
      console.warn('Failed to parse data channel message:', error);
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
    // Don't disconnect if we're in the middle of initializing
    if (this.isInitializing) {
      console.log('Skipping disconnect during initialization');
      return;
    }

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

  // Check if the service is properly initialized
  isInitialized(): boolean {
    return !!(
      this.peerConnection &&
      this.dataChannel &&
      this.mediaStream &&
      this.audioElement
    );
  }

  // Get detailed connection information for debugging
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
      hasMediaStream: !!this.mediaStream,
      hasAudioElement: !!this.audioElement,
      dataChannelReady: this.dataChannel?.readyState === 'open',
      peerConnectionValid: !!(this.peerConnection && this.peerConnection.connectionState !== 'closed'),
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
