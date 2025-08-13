import { store } from '../store';
import { 
  addTranscript, 
  addIntent, 
  setConnectionStatus,
  setSummary 
} from '../store/slices/sessionSlice';
import { 
  setActiveSpeaker, 
  setAudioLevel, 
  setError,
  setLastClinicianText,
  setLastPatientText 
} from '../store/slices/audioSlice';

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
    this.config = config;
    
    try {
      // Get ephemeral token from server
      const tokenResponse = await fetch('/api/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      
      if (!tokenResponse.ok) {
        throw new Error('Failed to get token');
      }
      
      const tokenData = await tokenResponse.json();
      const ephemeralKey = tokenData.client_secret.value;

      // Create peer connection
      this.peerConnection = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
        ],
      });

      // Set up audio element for remote audio
      this.audioElement = document.createElement('audio');
      this.audioElement.autoplay = true;
      this.audioElement.style.display = 'none';
      document.body.appendChild(this.audioElement);

      // Handle remote audio stream
      this.peerConnection.ontrack = (event) => {
        if (this.audioElement) {
          this.audioElement.srcObject = event.streams[0];
        }
      };

      // Get user media for microphone input
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      // Add local audio track
      this.mediaStream.getTracks().forEach(track => {
        if (this.peerConnection) {
          this.peerConnection.addTrack(track, this.mediaStream!);
        }
      });

      // Set up data channel for events
      this.dataChannel = this.peerConnection.createDataChannel('oai-events');
      this.dataChannel.onmessage = this.handleDataChannelMessage.bind(this);

      // Create and send offer
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
        throw new Error('Failed to establish WebRTC connection');
      }

      const answer: RTCSessionDescriptionInit = {
        type: 'answer' as RTCSdpType,
        sdp: await sdpResponse.text(),
      };

      await this.peerConnection.setRemoteDescription(answer);
      
      this.isConnected = true;
      store.dispatch(setConnectionStatus(true));
      store.dispatch(setError(null));

      // Send system message to configure the AI
      this.sendSystemMessage();

    } catch (error) {
      console.error('Error initializing realtime service:', error);
      store.dispatch(setError(error instanceof Error ? error.message : 'Failed to initialize'));
      store.dispatch(setConnectionStatus(false));
    }
  }

  private sendSystemMessage(): void {
    if (!this.dataChannel || !this.config) return;

    const systemMessage = {
      type: 'message',
      role: 'system',
      content: `You are a medical interpreter between an English-speaking clinician and a Spanish-speaking patient.

Always produce JSON events of shape {type: "transcript"|"intent", ...}.

Intents allowed: repeat_last, schedule_follow_up, send_lab_order.

Only infer schedule_follow_up or send_lab_order from clinician speech.

Treat phrases like "repeat that", "please repeat", "I did not understand", "otra vez", "repita por favor" as repeat_last when spoken by the patient.

For each user utterance, emit:
transcript: {speaker, lang, original_text, english_text, spanish_text}
optional intent: {name, args}

Keep a rolling memory of the last clinician utterance.

The encounter ID is: ${this.config.encounterId}`,
    };

    this.dataChannel.send(JSON.stringify(systemMessage));
  }

  private handleDataChannelMessage(event: MessageEvent): void {
    try {
      const data = JSON.parse(event.data);
      
      switch (data.type) {
        case 'transcript':
          this.handleTranscript(data);
          break;
        case 'intent':
          this.handleIntent(data);
          break;
        case 'speaker_change':
          this.handleSpeakerChange(data);
          break;
        case 'audio_level':
          this.handleAudioLevel(data);
          break;
      }
    } catch (error) {
      console.error('Error handling data channel message:', error);
    }
  }

  private handleTranscript(data: any): void {
    const transcript = {
      id: Date.now().toString(),
      speaker: data.speaker as 'clinician' | 'patient',
      lang: data.lang as 'en' | 'es',
      text: data.original_text,
      en_text: data.english_text,
      es_text: data.spanish_text,
      timestamp: new Date(),
    };

    store.dispatch(addTranscript(transcript));

    // Update last text for each speaker
    if (data.speaker === 'clinician') {
      store.dispatch(setLastClinicianText(data.english_text || data.original_text));
    } else {
      store.dispatch(setLastPatientText(data.spanish_text || data.original_text));
    }
  }

  private handleIntent(data: any): void {
    const intent = {
      id: Date.now().toString(),
      name: data.name as 'repeat_last' | 'schedule_follow_up' | 'send_lab_order',
      args: data.args || {},
      status: 'detected' as const,
      actor: data.actor as 'clinician' | 'patient',
      timestamp: new Date(),
    };

    store.dispatch(addIntent(intent));
  }

  private handleSpeakerChange(data: any): void {
    store.dispatch(setActiveSpeaker(data.speaker));
  }

  private handleAudioLevel(data: any): void {
    store.dispatch(setAudioLevel(data.level));
  }

  async disconnect(): Promise<void> {
    try {
      if (this.mediaStream) {
        this.mediaStream.getTracks().forEach(track => track.stop());
        this.mediaStream = null;
      }

      if (this.dataChannel) {
        this.dataChannel.close();
        this.dataChannel = null;
      }

      if (this.peerConnection) {
        this.peerConnection.close();
        this.peerConnection = null;
      }

      if (this.audioElement) {
        this.audioElement.remove();
        this.audioElement = null;
      }

      this.isConnected = false;
      store.dispatch(setConnectionStatus(false));
      store.dispatch(setActiveSpeaker(null));
      store.dispatch(setAudioLevel(0));

    } catch (error) {
      console.error('Error disconnecting:', error);
    }
  }

  isConnectedToService(): boolean {
    return this.isConnected;
  }

  // Method to manually trigger repeat functionality
  async repeatLast(): Promise<void> {
    if (!this.dataChannel) return;

    const repeatMessage = {
      type: 'message',
      role: 'user',
      content: 'repeat_last',
    };

    this.dataChannel.send(JSON.stringify(repeatMessage));
  }
}

export const realtimeService = new RealtimeService();
export default realtimeService;
