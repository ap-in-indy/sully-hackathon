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
      // Check if getUserMedia is supported
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('getUserMedia is not supported in this browser');
      }

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
      console.log('Requesting microphone access...');
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      console.log('Microphone access granted:', this.mediaStream.getTracks().length, 'tracks');

      // Add local audio track
      this.mediaStream.getTracks().forEach(track => {
        if (this.peerConnection) {
          this.peerConnection.addTrack(track, this.mediaStream!);
          console.log('Added audio track to peer connection:', track.kind, track.id);
        }
      });

      // Set up data channel for events
      this.dataChannel = this.peerConnection.createDataChannel('oai-events');
      this.dataChannel.onmessage = this.handleDataChannelMessage.bind(this);
      
      // Wait for data channel to be open before proceeding
      await new Promise<void>((resolve, reject) => {
        if (!this.dataChannel) {
          reject(new Error('Data channel not created'));
          return;
        }

        this.dataChannel.onopen = () => {
          console.log('Data channel opened');
          resolve();
        };

        this.dataChannel.onerror = (error) => {
          console.error('Data channel error:', error);
          reject(new Error('Data channel error'));
        };

        this.dataChannel.onclose = () => {
          console.log('Data channel closed');
        };
      });

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
      
      // Wait a bit for the connection to stabilize
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      this.isConnected = true;
      store.dispatch(setConnectionStatus(true));
      store.dispatch(setError(null));

      // Start audio level monitoring
      this.startAudioLevelMonitoring();

      // Now send system message when data channel is confirmed open
      this.sendSystemMessage();

    } catch (error) {
      console.error('Error initializing realtime service:', error);
      store.dispatch(setError(error instanceof Error ? error.message : 'Failed to initialize'));
      store.dispatch(setConnectionStatus(false));
    }
  }

  private startAudioLevelMonitoring(): void {
    if (!this.mediaStream) return;

    const audioContext = new AudioContext();
    const analyser = audioContext.createAnalyser();
    const microphone = audioContext.createMediaStreamSource(this.mediaStream);
    
    microphone.connect(analyser);
    analyser.fftSize = 256;
    
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    const updateAudioLevel = () => {
      if (!this.isConnected) return;
      
      analyser.getByteFrequencyData(dataArray);
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        sum += dataArray[i];
      }
      const average = sum / bufferLength;
      const level = Math.min(100, (average / 128) * 100);
      
      store.dispatch(setAudioLevel(level));
      requestAnimationFrame(updateAudioLevel);
    };
    
    updateAudioLevel();
  }

  private sendSystemMessage(): void {
    if (!this.dataChannel || !this.config) return;

    // Check if data channel is ready
    if (this.dataChannel.readyState !== 'open') {
      console.warn('Data channel not ready, retrying in 500ms...');
      setTimeout(() => this.sendSystemMessage(), 500);
      return;
    }

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

    try {
      this.dataChannel.send(JSON.stringify(systemMessage));
      console.log('System message sent successfully');
    } catch (error) {
      console.error('Error sending system message:', error);
    }
  }

  private handleDataChannelMessage(event: MessageEvent): void {
    try {
      const data = JSON.parse(event.data);
      console.log('Received data channel message:', data);
      
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
      timestamp: new Date().toISOString(), // Convert to ISO string for Redux
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
      timestamp: new Date().toISOString(), // Convert to ISO string for Redux
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
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      console.warn('Data channel not ready for repeat');
      return;
    }

    const repeatMessage = {
      type: 'message',
      role: 'user',
      content: 'repeat_last',
    };

    try {
      this.dataChannel.send(JSON.stringify(repeatMessage));
    } catch (error) {
      console.error('Error sending repeat message:', error);
    }
  }
}

export const realtimeService = new RealtimeService();
export default realtimeService;
