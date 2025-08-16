import { store } from '../store';
import {
  addTranscript,
  addIntent,
  setConnectionStatus
} from '../store/slices/sessionSlice';
import {
  setAudioLevel,
  setError
} from '../store/slices/audioSlice';
import { addNotification } from '../store/slices/uiSlice';

export interface RealtimeConfig {
  encounterId: string;
  patientId: string;
  clinicianId: string;
}

class RealtimeService {
  private peerConnection: RTCPeerConnection | null = null;
  private audioDataChannel: RTCDataChannel | null = null;  // For audio handling
  private textDataChannel: RTCDataChannel | null = null;   // For text/metadata handling
  private audioElement: HTMLAudioElement | null = null;
  private mediaStream: MediaStream | null = null;
  private isConnected = false;
  private config: RealtimeConfig | null = null;
  private lastJsonTranslationAt: number = 0;

  async initialize(config: RealtimeConfig): Promise<void> {
    // Clean up any existing session first
    if (this.isConnected || this.peerConnection || this.audioDataChannel || this.textDataChannel) {
      console.log('Cleaning up existing session before initializing new one...');
      await this.disconnect();
    }

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
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      console.log('Audio stream obtained:', this.mediaStream.getTracks().map(t => ({ kind: t.kind, enabled: t.enabled })));

      // Add local audio track
      this.mediaStream.getTracks().forEach(track => {
        if (this.peerConnection) {
          this.peerConnection.addTrack(track, this.mediaStream!);
          console.log('Added audio track to peer connection:', track.kind);
        }
      });

      // Create data channels BEFORE creating the offer (this is the key fix)
      console.log('Creating data channels before offer...');
      this.setupAudioDataChannel();
      this.setupTextDataChannel();

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

      // Wait for both data channels to be open
      await this.waitForBothDataChannelsOpen();

      this.isConnected = true;
      store.dispatch(setConnectionStatus(true));
      store.dispatch(setError(null));

      // Start audio level monitoring
      this.startAudioLevelMonitoring();

      // Send session configuration to both channels
      this.sendSessionConfiguration();

    } catch (error) {
      console.error('Error initializing realtime service:', error);
      console.warn('Falling back to demo mode');
      this.initializeDemoMode(config);
    }
  }

  private setupAudioDataChannel(): void {
    // Audio channel - handles pure audio input/output
    this.audioDataChannel = this.peerConnection!.createDataChannel('audio-channel');
    
    this.audioDataChannel.onopen = () => {
      console.log('🎵 Audio data channel opened');
    };

    this.audioDataChannel.onmessage = (event) => {
      this.handleAudioChannelMessage(event);
    };

    this.audioDataChannel.onerror = (error) => {
      console.error('Audio data channel error:', error);
    };

    this.audioDataChannel.onclose = () => {
      console.log('Audio data channel closed');
    };
  }

  private setupTextDataChannel(): void {
    // Text channel - handles transcription, translation metadata, and intents
    this.textDataChannel = this.peerConnection!.createDataChannel('text-channel');
    
    this.textDataChannel.onopen = () => {
      console.log('📝 Text data channel opened');
    };

    this.textDataChannel.onmessage = (event) => {
      this.handleTextChannelMessage(event);
    };

    this.textDataChannel.onerror = (error) => {
      console.error('Text data channel error:', error);
    };

    this.textDataChannel.onclose = () => {
      console.log('Text data channel closed');
    };
  }

  private async waitForBothDataChannelsOpen(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Data channels failed to open within 10 seconds'));
      }, 10000);

      const checkState = () => {
        if (this.audioDataChannel?.readyState === 'open' && 
            this.textDataChannel?.readyState === 'open') {
          clearTimeout(timeout);
          resolve();
        } else if (this.audioDataChannel?.readyState === 'closed' || 
                   this.textDataChannel?.readyState === 'closed') {
          clearTimeout(timeout);
          reject(new Error('One or both data channels closed before opening'));
        } else {
          setTimeout(checkState, 100);
        }
      };

      checkState();
    });
  }

  private reconnectDataChannels(): void {
    if (!this.peerConnection || this.peerConnection.connectionState !== 'connected') {
      console.log('Cannot reconnect - peer connection not in connected state');
      return;
    }

    try {
      console.log('Recreating data channels...');
      this.setupAudioDataChannel();
      this.setupTextDataChannel();

      // Wait for both to open again
      this.waitForBothDataChannelsOpen().then(() => {
        console.log('Data channels reconnected successfully');
        this.isConnected = true;
        store.dispatch(setConnectionStatus(true));
        store.dispatch(setError(null));

        // Send session configuration again
        this.sendSessionConfiguration();
      }).catch((error) => {
        console.error('Failed to reconnect data channels:', error);
      });

    } catch (error) {
      console.error('Error reconnecting data channels:', error);
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

      // Simulate random audio levels for single mic
      const level = Math.random() * 30 + 10; // 10-40 range
      store.dispatch(setAudioLevel(level));

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
        spanish_text: 'Hola, ¿cómo te sientes hoy?',
        jsonMetadata: {
          language: 'en',
          translation: 'Hello, how are you feeling today?',
          original_speaker: 'clinician',
          target_speaker: 'patient',
          intents: []
        }
      },
      {
        speaker: 'patient' as const,
        lang: 'es' as const,
        original_text: 'Me duele la cabeza y tengo fiebre.',
        english_text: 'I have a headache and fever.',
        spanish_text: 'Me duele la cabeza y tengo fiebre.',
        jsonMetadata: {
          language: 'es',
          translation: 'I have a headache and fever.',
          original_speaker: 'patient',
          target_speaker: 'clinician',
          intents: []
        }
      },
      {
        speaker: 'clinician' as const,
        lang: 'en' as const,
        original_text: 'I understand. Let me check your temperature and schedule a follow-up appointment.',
        english_text: 'I understand. Let me check your temperature and schedule a follow-up appointment.',
        spanish_text: 'Entiendo. Déjame revisar tu temperatura y programar una cita de seguimiento.',
        jsonMetadata: {
          language: 'en',
          translation: 'I understand. Let me check your temperature and schedule a follow-up appointment.',
          original_speaker: 'clinician',
          target_speaker: 'patient',
          intents: [
            {
              type: 'schedule_follow_up',
              confidence: 0.95,
              details: 'Clinician mentioned scheduling follow-up appointment'
            }
          ]
        }
      },
      {
        speaker: 'patient' as const,
        lang: 'es' as const,
        original_text: '¿Puede ordenar algunos análisis de sangre?',
        english_text: 'Can you order some blood tests?',
        spanish_text: '¿Puede ordenar algunos análisis de sangre?',
        jsonMetadata: {
          language: 'es',
          translation: 'Can you order some blood tests?',
          original_speaker: 'patient',
          target_speaker: 'clinician',
          intents: [
            {
              type: 'send_lab_order',
              confidence: 0.88,
              details: 'Patient requested blood test orders'
            }
          ]
        }
      }
    ];

    demoTranscripts.forEach((transcript, index) => {
      setTimeout(() => {
        this.handleTranscript(transcript);
      }, index * 2000);
    });
  }

  private sendSessionConfiguration(): void {
    if (!this.textDataChannel || !this.config) return;

    // Ensure text data channel is open before sending
    if (this.textDataChannel.readyState !== 'open') {
      console.log('Text data channel not ready, retrying in 100ms...');
      setTimeout(() => this.sendSessionConfiguration(), 100);
      return;
    }

    // Single configuration that handles both audio and text
    const sessionConfig = {
      type: "session.update",
      session: {
        modalities: ["text", "audio"], // Both modalities
        instructions: `
You are a medical interpreter and intent detector. Your role is to:

1. TRANSCRIBE: Convert speech to text accurately
2. TRANSLATE: Provide translations between English and Spanish
3. DETECT INTENTS: Identify when patients or clinicians request actions
4. SPEAK: Provide natural audio output of translations

For each utterance, provide:

TEXT OUTPUT (JSON metadata):
{
  "language": "en|es",
  "translation": "translated text",
  "original_speaker": "clinician|patient", 
  "target_speaker": "clinician|patient",
  "intents": [
    {
      "type": "schedule_follow_up|send_lab_order|repeat_last|other",
      "confidence": 0.0-1.0,
      "details": "additional context"
    }
  ]
}

AUDIO OUTPUT:
- Speak ONLY the translated sentence
- Match the tone and emotion of the original
- Speak naturally and clearly in the target language
- NO greetings, confirmations, or meta-talk

Intent detection rules:
- "schedule_follow_up": Look for appointment requests, follow-up needs, scheduling
- "send_lab_order": Look for lab tests, blood work, diagnostic orders
- "repeat_last": Look for repetition requests, "otra vez", "repita"
- Always preserve the original meaning and tone`,
        input_audio_transcription: { model: "whisper-1" },
        temperature: 0.4,  // Balanced temperature for both text and audio
        turn_detection: { 
          type: 'server_vad', 
          create_response: true,
          silence_threshold_ms: 3000, // 3 seconds of silence before processing
          speech_threshold_ms: 500    // 500ms of speech to start processing
        },
      }
    };

    try {
      // Send configuration to text channel (it will handle both modalities)
      this.textDataChannel.send(JSON.stringify(sessionConfig));
      console.log('✅ Session configuration sent for dual modalities');

      // Verify the configuration was applied after a short delay
      setTimeout(() => {
        this.verifySessionConfiguration();
      }, 1000);
    } catch (error) {
      console.error('Error sending session configuration:', error);
    }
  }

  private handleAudioChannelMessage(event: MessageEvent): void {
    try {
      const data = JSON.parse(event.data);
      console.log('🎵 Received audio channel message:', data);

      // Audio channel handles only audio-specific events
      switch (data.type) {
        case 'error': {
          const err = data.error || {};
          console.error('Audio channel error:', err.type, err.code, err.param, err.message);
          return;
        }

        // Handle audio input events
        case 'input_audio_buffer.speech_started':
          this.handleSpeechStarted(data);
          break;

        case 'input_audio_buffer.speech_stopped':
          this.handleSpeechStopped(data);
          break;

        case 'input_audio_buffer.committed':
          this.handleSpeechCommitted(data);
          break;

        // Handle audio output events
        case 'output_audio_buffer.started':
          this.handleStartSpeaking();
          break;

        case 'output_audio_buffer.stopped':
          this.handleStopSpeaking();
          break;

        case 'response.audio.done':
          this.handleAudioDone(data);
          break;

        // Audio channel should not receive text events
        case 'conversation.item.input_audio_transcription.completed':
        case 'response.audio_transcript.delta':
        case 'response.audio_transcript.done':
        case 'response.content_part.added':
        case 'response.content_part.done':
          console.warn('⚠️ Audio channel received text event:', data.type);
          break;

        default:
          console.log('🎵 Audio channel unknown message type:', data.type);
      }
    } catch (error) {
      console.error('Error handling audio channel message:', error);
    }
  }

  private handleTextChannelMessage(event: MessageEvent): void {
    try {
      const data = JSON.parse(event.data);
      console.log('📝 Received text channel message:', data);

      // Text channel handles transcription, translation, and intent detection
      switch (data.type) {
        case 'error': {
          const err = data.error || {};
          console.error('Text channel error:', err.type, err.code, err.param, err.message);
          return;
        }

        // Handle input audio transcription (patient/clinician speech)
        case 'conversation.item.input_audio_transcription.completed':
          this.handleInputTranscriptionCompleted(data);
          break;

        case 'conversation.item.input_audio_transcription.delta':
          // Optional: accumulate partial transcript for live captions
          break;

        // Handle AI response and output
        case 'response.created':
          this.handleResponseCreated(data);
          break;

        case 'response.content_part.added':
        case 'response.content_part.done': {
          // Handle text content parts (translation metadata and intents)
          this.handleContentPartAdded(data);
          break;
        }

        case 'response.output_item.done':
          // Marks an output item finalized
          break;

        // Handle conversation events
        case 'conversation.item.created':
          this.handleConversationItemCreated(data);
          break;

        // Handle session events
        case 'session.created':
          console.log('Session created:', data);
          break;

        case 'session.updated':
          console.log('Session updated with configuration:', data);
          // Verify that our session configuration was accepted
          if (data.session?.instructions) {
            console.log('✅ Session instructions confirmed:', data.session.instructions.substring(0, 100) + '...');
          }
          break;

        // Handle rate limits
        case 'rate_limits.updated':
          console.log('Rate limits updated:', data);
          break;

        // Legacy cases for backward compatibility
        case 'transcript':
          this.handleTranscript(data);
          break;

        case 'intent':
          this.handleIntent(data);
          break;

        // Text channel should not receive audio events
        case 'input_audio_buffer.speech_started':
        case 'input_audio_buffer.speech_stopped':
        case 'input_audio_buffer.committed':
        case 'output_audio_buffer.started':
        case 'output_audio_buffer.stopped':
        case 'response.audio.done':
          console.warn('⚠️ Text channel received audio event:', data.type);
          break;

        default:
          console.log('📝 Text channel unknown message type:', data.type);
      }
    } catch (error) {
      console.error('Error handling text channel message:', error);
    }
  }

  private tryParseTranslationJson(raw: string): void {
    try {
      const obj = JSON.parse(raw);
      if (
        obj &&
        (obj.language === 'en' || obj.language === 'es') &&
        typeof obj.translation === 'string' &&
        (obj.original_speaker === 'clinician' || obj.original_speaker === 'patient') &&
        (obj.target_speaker === 'clinician' || obj.target_speaker === 'patient')
      ) {
        const lang = obj.language as 'en' | 'es';
        
        // Handle the transcript
        this.handleTranscript({
          speaker: obj.target_speaker,
          lang,
          original_text: obj.translation,
          english_text: lang === 'en' ? obj.translation : undefined,
          spanish_text: lang === 'es' ? obj.translation : undefined,
          isTranslation: true,
          jsonMetadata: obj
        });

        // Handle intents if present
        if (obj.intents && Array.isArray(obj.intents)) {
          obj.intents.forEach((intent: any) => {
            if (intent.type && intent.confidence) {
              this.handleIntent({
                name: intent.type,
                args: intent.details || {},
                actor: obj.target_speaker,
                confidence: intent.confidence
              });
            }
          });
        }

        this.lastJsonTranslationAt = Date.now();
        console.log('✅ Parsed translation JSON with intents:', obj);
      } else {
        console.log('⚠️ Parsed JSON missing required fields:', obj);
      }
    } catch (error) {
      console.log('⚠️ Failed to parse JSON:', raw.substring(0, 100));
    }
  }

  private handleSpeechStarted(data: any): void {
    console.log('Speech started:', data);
    // Could be used to show "listening" indicator
  }

  private handleSpeechStopped(data: any): void {
    console.log('Speech stopped:', data);
    // Could be used to hide "listening" indicator
  }

  private handleSpeechCommitted(data: any): void {
    console.log('Speech committed:', data);
    // Speech has been processed and committed to the conversation
  }

  private handleResponseCreated(data: any): void {
    console.log('AI response created:', data);
    // AI is about to start responding
  }

  private handleAudioDone(data: any): void {
    console.log('Audio done:', data);
    this.handleStopSpeaking();
  }

  private handleResponseDone(data: any): void {
    console.log('Response done:', data);
    // AI finished responding completely
  }

  private handleConversationItemCreated(data: any): void {
    console.log('Conversation item created:', data);

    // Check if this item contains intents or actions
    if (data.item?.content) {
      for (const content of data.item.content) {
        if (content.type === 'text') {
          // Look for intents in the text
          this.detectIntentsFromText(content.text);
        }
      }
    }
  }

  private determineSpeaker(data: any): 'clinician' | 'patient' {
    const text = data.transcript || data.item?.content?.[0]?.transcript || '';
    const langFromEvent = data.language || data.item?.content?.[0]?.language; // check if present
    const lang = (langFromEvent === 'es' || langFromEvent === 'en')
      ? langFromEvent
      : this.detectLanguage(text);

    return lang === 'en' ? 'clinician' : 'patient';
  }

  private detectLanguage(text: string): 'en' | 'es' {
    if (!text || !text.trim()) return 'en';

    const t = text.toLowerCase();
    const hasSpanishChars = /[áéíóúñü]/.test(t);

    // very common Spanish tokens
    const spanishHits = (t.match(/\b(de|que|la|el|y|en|un|una|es|no|si|con|para)\b/g) || []).length;
    // very common English tokens
    const englishHits = (t.match(/\b(the|and|to|of|in|it|is|you|that|for|on|with|as|at|this)\b/g) || []).length;

    if (spanishHits > englishHits) return 'es';
    if (englishHits > spanishHits) return 'en';
    if (hasSpanishChars) return 'es';

    // last resort: bias toward Spanish if there is any Spanish token at all
    if (/\b(el|la|de|que|y|en)\b/.test(t)) return 'es';

    return 'en';
  }

  private handleTranscript(data: any): void {
    const transcript = {
      id: Date.now().toString(),
      speaker: data.speaker as 'clinician' | 'patient',
      lang: data.lang as 'en' | 'es',
      text: data.original_text,
      en_text: data.english_text,
      es_text: data.spanish_text,
      isTranslation: data.isTranslation || false,
      timestamp: new Date().toISOString(), // Store as ISO string for Redux
      jsonMetadata: data.jsonMetadata, // Store JSON metadata if present
    };

    console.log('📝 Adding transcript to store:', {
      speaker: transcript.speaker,
      lang: transcript.lang,
      text: transcript.text,
      isTranslation: transcript.isTranslation,
      hasJsonMetadata: !!transcript.jsonMetadata
    });

    store.dispatch(addTranscript(transcript));
  }

  private detectIntentsFromText(text: string): void {
    console.log('Detecting intents from text:', text);

    // Look for specific phrases that indicate intents
    const lowerText = text.toLowerCase();

    if (lowerText.includes('repeat') || lowerText.includes('otra vez') || lowerText.includes('repita')) {
      this.handleIntent({
        name: 'repeat_last',
        args: {},
        actor: 'patient'
      });
    }

    if (lowerText.includes('schedule') || lowerText.includes('appointment') || lowerText.includes('follow-up')) {
      this.handleIntent({
        name: 'schedule_follow_up',
        args: {},
        actor: 'clinician'
      });
    }

    if (lowerText.includes('lab') || lowerText.includes('test') || lowerText.includes('order')) {
      this.handleIntent({
        name: 'send_lab_order',
        args: {},
        actor: 'clinician'
      });
    }
  }

  private handleStartSpeaking(): void {
    console.log('AI started speaking - muting input');
    // Mute input tracks to prevent voice overlap
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => {
        if (track.kind === 'audio') {
          track.enabled = false;
        }
      });
    }
  }

  private handleStopSpeaking(): void {
    console.log('AI stopped speaking - unmuting input');
    // Unmute input tracks
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => {
        if (track.kind === 'audio') {
          track.enabled = true;
        }
      });
    }
  }

  private handleInputTranscriptionCompleted(data: any): void {
    console.log('Input transcription completed:', data);

    // Extract transcript from the completed transcription
    const transcript = data.transcript || data.item?.content?.[0]?.transcript;
    if (!transcript) {
      console.warn('No transcript found in input transcription:', data);
      return;
    }

    // Determine speaker and language
    const speaker = this.determineSpeaker(data);
    const lang = this.detectLanguage(transcript);

    console.log(`🎤 ${speaker} spoke in ${lang === 'en' ? 'English' : 'Spanish'}: "${transcript}"`);

    // Create transcript entry
    this.handleTranscript({
      speaker,
      lang,
      original_text: transcript,
      english_text: lang === 'en' ? transcript : undefined,
      spanish_text: lang === 'es' ? transcript : undefined,
      isTranslation: false // This is original speech, not a translation
    });

    // Ask for a bilingual response (audio + JSON text)
    // If clinician spoke EN, target is patient; if patient spoke ES, target is clinician
    const target = (lang === 'en') ? 'patient' : 'clinician';
    this.requestBilingualResponseFor(data.item_id, target);
  }

  private requestBilingualResponseFor(itemId: string, target: 'patient' | 'clinician') {
    if (!this.textDataChannel || this.textDataChannel.readyState !== 'open') return;
  
    const original = target === 'patient' ? 'clinician' : 'patient';
    const targetLang = target === 'patient' ? 'es' : 'en';
  
    // Single request that handles both text and audio
    const request = {
      type: "response.create",
      response: {
        modalities: ["text", "audio"], // Both modalities
        input: [
          // 1) Reference the spoken utterance
          { type: "item_reference", id: itemId },
          // 2) Provide per-turn instructions
          {
            type: "message",
            role: "user",
            content: [
              {
                type: "input_text",
                text: `
Translate the referenced utterance to ${targetLang} and provide:

1. JSON metadata with translation and intent detection
2. Spoken audio output of the translation

Output format:
- TEXT: JSON with language, translation, speakers, and intents
- AUDIO: Speak the translation naturally in ${targetLang}

Rules:
- Detect intents like appointment requests, lab orders, repetition needs
- Preserve medical terminology accuracy
- Speak clearly and naturally
- No greetings or meta-commentary`
              }
            ]
          }
        ],
        instructions: "Provide JSON metadata and speak the translation. Handle both text and audio output.",
        temperature: 0.4
      }
    };

    try {
      this.textDataChannel.send(JSON.stringify(request));
      console.log('📝 Bilingual response request sent for both text and audio');
    } catch (error) {
      console.error('Error sending bilingual response request:', error);
    }
  }
  


  private handleContentPartAdded(data: any): void {
    console.log('Content part added:', data);

    // 1) Preferred: parse the part on the event
    const p = data.part;
    if (p) {
      if (p.type === 'text' || p.type === 'output_text') {
        const raw: string = p.text ?? p.value ?? p.content ?? '';
        if (raw) this.tryParseTranslationJson(raw);
      }
      // If it's audio we just ignore here; captions come via response.audio_transcript.*
      return;
    }

    // 2) Fallback: some stacks include a snapshot of the item's content array
    const parts = data.item?.content || [];
    for (const part of parts) {
      if (part.type === 'text' || part.type === 'output_text') {
        const raw: string = part.text ?? part.value ?? part.content ?? '';
        if (raw) this.tryParseTranslationJson(raw);
      }
    }
  }

  private handleAudioTranscriptDelta(data: any): void {
    console.log('Audio transcript delta:', data);

    // This is the AI speaking - we can show real-time transcription
    if (data.delta?.text) {
      this.handleAIRealTimeTranscript(data.delta.text);
    }
  }

  private handleAudioTranscriptDone(data: any): void {
    console.log('Audio transcript done:', data);
    this.handleAIResponse(data); // pass the whole event so we have response_id
  }

  private handleAIRealTimeTranscript(text: string): void {
    console.log('AI real-time transcript:', text);
    // Could be used to show real-time AI speech
  }

  private handleAIResponse(payload: any): void {
    // Accept either the event or a raw string
    const responseId = typeof payload === 'object' ? payload.response_id : undefined;
    const raw = typeof payload === 'object' ? (payload.transcript || '') : String(payload || '');
    const text = raw.trim();
  
    if (!text) return;
  
    // 1) Try to extract a leading JSON object, then the remainder (spoken text)
    const { obj, remainder } = this.extractLeadingJson(text);
  
    // 2) If JSON is valid and has our schema, ingest it once
    let jsonIngested = false;
    if (
      obj &&
      (obj.language === 'en' || obj.language === 'es') &&
      typeof obj.translation === 'string' &&
      (obj.original_speaker === 'clinician' || obj.original_speaker === 'patient') &&
      (obj.target_speaker === 'clinician' || obj.target_speaker === 'patient')
    ) {
      const lang = obj.language as 'en' | 'es';
      this.handleTranscript({
        speaker: obj.target_speaker,
        lang,
        original_text: obj.translation,
        english_text: lang === 'en' ? obj.translation : undefined,
        spanish_text: lang === 'es' ? obj.translation : undefined,
        isTranslation: true,
        jsonMetadata: obj
      });
      this.lastJsonTranslationAt = Date.now();
      jsonIngested = true;
    }
  
    // 3) Optionally handle the spoken caption, but only if it is non-JSON and not a duplicate
    const cap = remainder.trim();
    if (!cap) return;
  
    // Drop if it looks like JSON
    if (cap.startsWith('{') && cap.endsWith('}')) {
      console.log('⏭️ Ignoring audio transcript that is JSON-shaped');
      return;
    }
  
    // Drop if we just ingested JSON a moment ago (same response)
    const justNow = Date.now() - this.lastJsonTranslationAt < 1500;
    if (jsonIngested && justNow) {
      console.log('⏭️ Skipping caption because JSON was just processed');
      return;
    }
  
    // Fallback: infer target from language of caption if no JSON
    const isSpanish = /[áéíóúñü¿¡]/i.test(cap) ||
                      /\b(el|la|los|las|de|que|y|en|un|una|es|está|tiene|me)\b/i.test(cap);
  
    this.handleTranscript({
      speaker: isSpanish ? 'patient' : 'clinician',
      lang: isSpanish ? 'es' : 'en',
      original_text: cap,
      english_text: isSpanish ? undefined : cap,
      spanish_text: isSpanish ? cap : undefined,
      isTranslation: true
    });
  }

  private extractLeadingJson(s: string): { obj?: any; remainder: string } {
    // Finds the first top-level {...} at the start of the string and parses it.
    // Allows optional whitespace and a blank line after.
    const trimmed = s.trimStart();
    if (!trimmed.startsWith('{')) return { remainder: s };
  
    // Simple balanced-brace scan to find the end of the first JSON object
    let depth = 0;
    let end = -1;
    for (let i = 0; i < trimmed.length; i++) {
      const ch = trimmed[i];
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    if (end === -1) return { remainder: s };
  
    const jsonStr = trimmed.slice(0, end + 1);
    try {
      const obj = JSON.parse(jsonStr);
      const remainder = trimmed.slice(end + 1).replace(/^\s+/, '');
      return { obj, remainder };
    } catch {
      return { remainder: s };
    }
  }

  private handleIntent(data: any): void {
    const intent = {
      id: Date.now().toString(),
      name: data.name as 'repeat_last' | 'schedule_follow_up' | 'send_lab_order' | 'other',
      args: data.args || {},
      status: 'detected' as const,
      actor: data.actor as 'clinician' | 'patient',
      confidence: data.confidence || 1.0, // Add confidence field
      timestamp: new Date().toISOString(), // Store as ISO string for Redux
    };

    console.log('🎯 Intent detected:', {
      name: intent.name,
      actor: intent.actor,
      confidence: intent.confidence,
      args: intent.args
    });

    store.dispatch(addIntent(intent));
  }

  async disconnect(): Promise<void> {
    try {
      console.log('Disconnecting real-time service...');

      // Stop all media tracks
      if (this.mediaStream) {
        this.mediaStream.getTracks().forEach(track => {
          console.log('Stopping track:', track.kind, track.id);
          track.stop();
        });
        this.mediaStream = null;
      }

      // Close data channels
      if (this.audioDataChannel) {
        console.log('Closing audio data channel...');
        this.audioDataChannel.close();
        this.audioDataChannel = null;
      }
      if (this.textDataChannel) {
        console.log('Closing text data channel...');
        this.textDataChannel.close();
        this.textDataChannel = null;
      }

      // Close peer connection
      if (this.peerConnection) {
        console.log('Closing peer connection...');
        this.peerConnection.close();
        this.peerConnection = null;
      }

      // Remove audio element
      if (this.audioElement) {
        console.log('Removing audio element...');
        this.audioElement.remove();
        this.audioElement = null;
      }

      // Reset state
      this.isConnected = false;
      this.config = null;

      // Update Redux state
      store.dispatch(setConnectionStatus(false));
      store.dispatch(setAudioLevel(0));
      store.dispatch(setError(null));

      console.log('Real-time service disconnected successfully');

    } catch (error) {
      console.error('Error disconnecting:', error);
    }
  }

  isConnectedToService(): boolean {
    return this.isConnected;
  }

  // Method to verify session configuration was applied
  private verifySessionConfiguration(): void {
    if (!this.textDataChannel || this.textDataChannel.readyState !== 'open') {
      console.warn('Cannot verify session configuration - text data channel not ready');
      return;
    }

    try {
      this.textDataChannel.send(JSON.stringify({
        type: 'conversation.item.create',
        item: { type: 'message', role: 'user',
                content: [{ type: 'input_text', text: 'ping' }] }
      }));
      this.textDataChannel.send(JSON.stringify({ type: 'response.create' }));
      console.log('Verification message sent to test translator role');
    } catch (error) {
      console.error('Error sending verification message:', error);
    }
  }

  // Method to manually trigger repeat functionality
  async repeatLast(): Promise<void> {
    if (!this.textDataChannel) return;

    const repeatMessage = {
      type: 'message',
      role: 'user',
      content: 'repeat_last',
    };

    this.textDataChannel.send(JSON.stringify(repeatMessage));
  }

  // Method to test the connection by sending a test message
  async testConnection(): Promise<void> {
    if (!this.textDataChannel || this.textDataChannel.readyState !== 'open') {
      console.warn('Text data channel not ready for testing');
      return;
    }

    const testMessage = {
      type: 'message',
      role: 'user',
      content: 'Hello, this is a test message to verify the connection is working.',
    };

    try {
      this.textDataChannel.send(JSON.stringify(testMessage));
      console.log('Test message sent successfully');
    } catch (error) {
      console.error('Error sending test message:', error);
    }
  }

  // Method to test both channels separately
  async testDualStreams(): Promise<void> {
    if (!this.audioDataChannel || !this.textDataChannel) {
      console.warn('Cannot test dual streams - one or both channels not ready');
      return;
    }

    console.log('🧪 Testing dual-stream functionality...');

    // Test text channel with a simple message
    const textTestMessage = {
      type: 'message',
      role: 'user',
      content: 'Test message for text channel - should return JSON metadata'
    };

    // Test audio channel with a simple message
    const audioTestMessage = {
      type: 'message',
      role: 'user',
      content: 'Test message for audio channel - should return spoken audio only'
    };

    try {
      // Send to text channel
      this.textDataChannel.send(JSON.stringify(textTestMessage));
      console.log('✅ Text channel test message sent');

      // Send to audio channel
      this.audioDataChannel.send(JSON.stringify(audioTestMessage));
      console.log('✅ Audio channel test message sent');

    } catch (error) {
      console.error('Error testing dual streams:', error);
    }
  }

  // Method to test the translator functionality
  async testTranslator(): Promise<void> {
    if (!this.textDataChannel || this.textDataChannel.readyState !== 'open') {
      console.warn('Cannot test translator - text data channel not ready');
      return;
    }

    console.log('🧪 Testing translator functionality...');

    // Test Spanish to English translation
    const spanishTestMessage = {
      type: 'message',
      role: 'user',
      content: 'Me duele la cabeza y tengo fiebre.'
    };

    try {
      this.textDataChannel.send(JSON.stringify(spanishTestMessage));
      console.log('✅ Spanish test message sent to text channel');

      // Wait a bit then test English to Spanish
      setTimeout(() => {
        if (this.textDataChannel && this.textDataChannel.readyState === 'open') { 
          const englishTestMessage = {
            type: 'message',
            role: 'user',
            content: 'How long have you had these symptoms?'
          };

          this.textDataChannel.send(JSON.stringify(englishTestMessage));
          console.log('✅ English test message sent to text channel');
        }
      }, 2000);

    } catch (error) {
      console.error('Error testing translator:', error);
    }
  }

  // Method to get connection status
  getConnectionStatus(): {
    isConnected: boolean;
    audioDataChannelState: string;
    textDataChannelState: string;
    peerConnectionState: string;
    iceConnectionState: string;
  } {
    return {
      isConnected: this.isConnected,
      audioDataChannelState: this.audioDataChannel?.readyState || 'none',
      textDataChannelState: this.textDataChannel?.readyState || 'none',
      peerConnectionState: this.peerConnection?.connectionState || 'none',
      iceConnectionState: this.peerConnection?.iceConnectionState || 'none',
    };
  }

  // Method to manually mute/unmute input
  toggleMute(): void {
    if (!this.mediaStream) return;

    const audioTracks = this.mediaStream.getAudioTracks();
    if (audioTracks.length > 0) {
      const isMuted = !audioTracks[0].enabled;
      audioTracks[0].enabled = isMuted;
      console.log(`Input ${isMuted ? 'unmuted' : 'muted'}`);

      store.dispatch(addNotification({
        type: 'info',
        message: `Input ${isMuted ? 'unmuted' : 'muted'}`
      }));
    }
  }

  // Method to get mute status
  isMuted(): boolean {
    if (!this.mediaStream) return false;
    const audioTracks = this.mediaStream.getAudioTracks();
    return audioTracks.length > 0 ? !audioTracks[0].enabled : false;
  }
}

export const realtimeService = new RealtimeService();
export default realtimeService;
