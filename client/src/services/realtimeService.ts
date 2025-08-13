import { store } from '../store';
import { 
  addTranscript, 
  addIntent, 
  setConnectionStatus
} from '../store/slices/sessionSlice';
import { 
  setActiveSpeaker, 
  setAudioLevel, 
  setError,
  setLastClinicianText,
  setLastPatientText 
} from '../store/slices/audioSlice';
import { addNotification } from '../store/slices/uiSlice';

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
        console.warn('Failed to get OpenAI token, entering demo mode');
        this.initializeDemoMode(config);
        return;
      }
      
      const tokenData = await tokenResponse.json();
      const ephemeralKey = tokenData.client_secret.value;

      // Create peer connection
      this.peerConnection = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
        ],
      });

      // Monitor connection state changes
      this.peerConnection.onconnectionstatechange = () => {
        console.log('Peer connection state changed:', this.peerConnection?.connectionState);
        
        if (this.peerConnection?.connectionState === 'failed' || 
            this.peerConnection?.connectionState === 'disconnected') {
          console.log('Peer connection failed or disconnected, attempting to reconnect...');
          this.isConnected = false;
          store.dispatch(setConnectionStatus(false));
          
          // Try to reconnect after a delay
          setTimeout(() => {
            if (this.config) {
              this.initialize(this.config);
            }
          }, 3000);
        }
      };

      // Monitor ICE connection state
      this.peerConnection.oniceconnectionstatechange = () => {
        console.log('ICE connection state:', this.peerConnection?.iceConnectionState);
      };

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
      
      // Set up data channel event handlers
      this.dataChannel.onopen = () => {
        console.log('Data channel opened successfully');
        this.isConnected = true;
        store.dispatch(setConnectionStatus(true));
        store.dispatch(setError(null));
        
        // Start audio level monitoring
        this.startAudioLevelMonitoring();
        
        // Send system message immediately when channel opens
        this.sendSystemMessage();
      };

      this.dataChannel.onerror = (error) => {
        console.error('Data channel error:', error);
        // Don't disconnect on error, try to recover
      };

      this.dataChannel.onclose = () => {
        console.log('Data channel closed');
        // Try to reconnect if this wasn't an intentional close
        if (this.isConnected && this.peerConnection?.connectionState === 'connected') {
          console.log('Attempting to reconnect data channel...');
          setTimeout(() => {
            this.reconnectDataChannel();
          }, 1000);
        }
      };

      // Create and send offer
      const offer = await this.peerConnection.createOffer();
      await this.peerConnection.setLocalDescription(offer);

      const baseUrl = 'https://api.openai.com/v1/realtime';
      const model = 'gpt-4o-realtime-preview-2025-06-03';
      
      console.log('Sending offer to OpenAI Realtime API...');
      const sdpResponse = await fetch(`${baseUrl}?model=${model}`, {
        method: 'POST',
        body: offer.sdp,
        headers: {
          'Authorization': `Bearer ${ephemeralKey}`,
          'Content-Type': 'application/sdp',
        },
      });

      if (!sdpResponse.ok) {
        const errorText = await sdpResponse.text();
        console.error('OpenAI API error:', sdpResponse.status, errorText);
        console.warn('Falling back to demo mode due to OpenAI API error');
        this.initializeDemoMode(config);
        return;
      }

      const answerSdp = await sdpResponse.text();
      console.log('Received answer from OpenAI API');

      const answer: RTCSessionDescriptionInit = {
        type: 'answer' as RTCSdpType,
        sdp: answerSdp,
      };

      await this.peerConnection.setRemoteDescription(answer);
      console.log('Set remote description');
      
      // Wait for the connection to stabilize and data channel to open
      await this.waitForDataChannelOpen();

    } catch (error) {
      console.error('Error initializing realtime service:', error);
      console.warn('Falling back to demo mode');
      this.initializeDemoMode(config);
    }
  }

  private async waitForDataChannelOpen(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Data channel failed to open within 10 seconds'));
      }, 10000);

      if (this.dataChannel?.readyState === 'open') {
        clearTimeout(timeout);
        resolve();
        return;
      }

      const checkState = () => {
        if (this.dataChannel?.readyState === 'open') {
          clearTimeout(timeout);
          resolve();
        } else if (this.dataChannel?.readyState === 'closed') {
          clearTimeout(timeout);
          reject(new Error('Data channel closed before opening'));
        } else {
          setTimeout(checkState, 100);
        }
      };

      checkState();
    });
  }

  private reconnectDataChannel(): void {
    if (!this.peerConnection || this.peerConnection.connectionState !== 'connected') {
      console.log('Cannot reconnect - peer connection not in connected state');
      return;
    }

    try {
      console.log('Creating new data channel...');
      this.dataChannel = this.peerConnection.createDataChannel('oai-events');
      this.dataChannel.onmessage = this.handleDataChannelMessage.bind(this);
      
      this.dataChannel.onopen = () => {
        console.log('Data channel reconnected successfully');
        this.isConnected = true;
        store.dispatch(setConnectionStatus(true));
        store.dispatch(setError(null));
        
        // Send system message again
        this.sendSystemMessage();
      };

      this.dataChannel.onerror = (error) => {
        console.error('Reconnected data channel error:', error);
      };

      this.dataChannel.onclose = () => {
        console.log('Reconnected data channel closed');
        if (this.isConnected) {
          setTimeout(() => {
            this.reconnectDataChannel();
          }, 2000);
        }
      };
    } catch (error) {
      console.error('Error reconnecting data channel:', error);
    }
  }

  private initializeDemoMode(config: RealtimeConfig): void {
    console.log('Initializing demo mode - simulating real-time communication');
    
    this.config = config;
    this.isConnected = true;
    store.dispatch(setConnectionStatus(true));
    store.dispatch(setError(null));
    
    // Notify user about demo mode
    store.dispatch(addNotification({
      type: 'info',
      message: 'Demo mode active - simulating real-time translation. Add your OpenAI API key to enable live voice translation.'
    }));
    
    // Simulate audio level monitoring
    this.simulateAudioLevels();
    
    // Add some demo transcripts after a delay
    setTimeout(() => {
      this.addDemoTranscripts();
    }, 2000);
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

  private simulateAudioLevels(): void {
    const simulateLevel = () => {
      if (!this.isConnected) return;
      
      // Simulate random audio levels
      const level = Math.random() * 30 + 10; // 10-40 range
      store.dispatch(setAudioLevel(level));
      
      // Randomly set active speaker
      if (Math.random() > 0.8) {
        const speaker = Math.random() > 0.5 ? 'clinician' : 'patient';
        store.dispatch(setActiveSpeaker(speaker));
      }
      
      setTimeout(simulateLevel, 100);
    };
    
    simulateLevel();
  }

  private addDemoTranscripts(): void {
    const demoTranscripts = [
      {
        speaker: 'clinician' as const,
        lang: 'en' as const,
        original_text: 'Hello, how are you feeling today?',
        english_text: 'Hello, how are you feeling today?',
        spanish_text: 'Hola, ¿cómo te sientes hoy?'
      },
      {
        speaker: 'patient' as const,
        lang: 'es' as const,
        original_text: 'Me duele la cabeza y tengo fiebre.',
        english_text: 'I have a headache and fever.',
        spanish_text: 'Me duele la cabeza y tengo fiebre.'
      },
      {
        speaker: 'clinician' as const,
        lang: 'en' as const,
        original_text: 'I understand. Let me check your temperature.',
        english_text: 'I understand. Let me check your temperature.',
        spanish_text: 'Entiendo. Déjame revisar tu temperatura.'
      }
    ];

    demoTranscripts.forEach((transcript, index) => {
      setTimeout(() => {
        this.handleTranscript(transcript);
      }, index * 2000);
    });
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
      
      // Add a small delay before allowing other messages
      setTimeout(() => {
        console.log('Ready to receive voice input');
      }, 1000);
      
    } catch (error) {
      console.error('Error sending system message:', error);
      // If sending fails, the data channel might be closed, try to reconnect
      if (this.dataChannel.readyState !== 'open') {
        console.log('Data channel not ready, attempting to reconnect...');
        setTimeout(() => {
          this.reconnectDataChannel();
        }, 1000);
      }
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
      console.log('Repeat message sent successfully');
    } catch (error) {
      console.error('Error sending repeat message:', error);
    }
  }

  // Method to test the connection by sending a test message
  async testConnection(): Promise<void> {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      console.warn('Data channel not ready for testing');
      return;
    }

    const testMessage = {
      type: 'message',
      role: 'user',
      content: 'Hello, this is a test message to verify the connection is working.',
    };

    try {
      this.dataChannel.send(JSON.stringify(testMessage));
      console.log('Test message sent successfully');
    } catch (error) {
      console.error('Error sending test message:', error);
    }
  }

  // Method to get connection status
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
}

export const realtimeService = new RealtimeService();
export default realtimeService;
