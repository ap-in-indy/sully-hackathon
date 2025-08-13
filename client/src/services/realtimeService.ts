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
    // Clean up any existing session first
    if (this.isConnected || this.peerConnection || this.dataChannel) {
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

      // Set up data channel for events
      this.dataChannel = this.peerConnection.createDataChannel('oai-events');
      this.dataChannel.onmessage = this.handleDataChannelMessage.bind(this);
      
      // Wait for data channel to be open before proceeding
      this.dataChannel.onopen = () => {
        console.log('Data channel opened, sending session configuration');
        this.sendSessionConfiguration();
      };

      this.dataChannel.onerror = (error) => {
        console.error('Data channel error:', error);
      };

      this.dataChannel.onclose = () => {
        console.log('Data channel closed');
      };

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

      // Start audio level monitoring
      this.startAudioLevelMonitoring();

      // Note: Session configuration will be sent when data channel opens
      // No need to call sendSessionConfiguration() here anymore

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
        
        // Send session configuration again
        this.sendSessionConfiguration();
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

  private sendSessionConfiguration(): void {
    if (!this.dataChannel || !this.config) return;
    
    // Ensure data channel is open before sending
    if (this.dataChannel.readyState !== 'open') {
      console.log('Data channel not ready, retrying in 100ms...');
      setTimeout(() => this.sendSessionConfiguration(), 100);
      return;
    }

    // Use session.update with modalities to separate text and audio outputs
    const sessionConfig = {
      type: "session.update",
      session: {
        modalities: ["text", "audio"],
        instructions: `You are a medical interpreter facilitating communication between an English-speaking clinician and a Spanish-speaking patient.

CRITICAL MODALITY SEPARATION INSTRUCTIONS:
You MUST provide TWO COMPLETELY SEPARATE outputs:

1. TEXT MODALITY (silent JSON metadata):
   - Output ONLY valid JSON with this exact structure
   - This JSON is NEVER spoken aloud
   - Structure: {"language": "en|es", "translation": "text", "original_speaker": "clinician|patient", "target_speaker": "clinician|patient"}

2. AUDIO MODALITY (spoken translation only):
   - Speak ONLY the translated sentence naturally
   - NEVER speak JSON, brackets, quotes, or metadata
   - NEVER speak the word "language", "translation", "original_speaker", "target_speaker"
   - NEVER speak curly braces, quotes, or any JSON syntax
   - Speak as a human interpreter would speak

IMPORTANT RULES:
- The text modality (JSON) and audio modality (speech) are completely separate
- The JSON is for the system to parse, the audio is for humans to hear
- If you speak JSON in the audio, you are doing it wrong
- The audio should contain ONLY the natural translation

TRANSLATION RULES:
- Patient speaks Spanish → Translate to English for clinician
- Clinician speaks English → Translate to Spanish for patient
- Maintain medical terminology accuracy
- Be concise and clear
- Use formal medical language appropriate for healthcare settings

EXAMPLE:
Patient says: "Me duele el estómago"
- TEXT (JSON): {"language": "en", "translation": "My stomach hurts.", "original_speaker": "patient", "target_speaker": "clinician"}
- AUDIO (spoken): "My stomach hurts." (spoken naturally in English)

Clinician says: "How long have you had this pain?"
- TEXT (JSON): {"language": "es", "translation": "¿Cuánto tiempo ha tenido este dolor?", "original_speaker": "clinician", "target_speaker": "patient"}
- AUDIO (spoken): "¿Cuánto tiempo ha tenido este dolor?" (spoken naturally in Spanish)

REMEMBER: You are ONLY an interpreter. Do not diagnose, give medical advice, or add commentary. Just translate accurately between English and Spanish.`,
        input_audio_transcription: { model: "whisper-1" },
        temperature: 0.6,  // Lower temperature for more deterministic translations
        turn_detection: { type: 'server_vad' },
      }
    };

    try {
      this.dataChannel.send(JSON.stringify(sessionConfig));
      console.log('Session configuration sent successfully via session.update with separated text/audio outputs');
      
      // Verify the configuration was applied after a short delay
      setTimeout(() => {
        this.verifySessionConfiguration();
      }, 1000);
    } catch (error) {
      console.error('Error sending session configuration:', error);
    }
  }
  

  private handleDataChannelMessage(event: MessageEvent): void {
    try {
      const data = JSON.parse(event.data);
      console.log('Received data channel message:', data);
      
      switch (data.type) {
        // Handle input audio transcription (patient/clinician speech)
        case 'input_audio_buffer.speech_started':
          this.handleSpeechStarted(data);
          break;
          
        case 'input_audio_buffer.speech_stopped':
          this.handleSpeechStopped(data);
          break;
          
        case 'input_audio_buffer.committed':
          this.handleSpeechCommitted(data);
          break;
          
        case 'conversation.item.input_audio_transcription.completed':
          this.handleInputTranscriptionCompleted(data);
          break;

        // Handle AI response and output
        case 'response.created':
          this.handleResponseCreated(data);
          break;
          
        case 'response.content_part.added':
          this.handleContentPartAdded(data);
          break;
          
        case 'response.content_part.done':
          this.handleContentPartDone(data);
          break;
          
        case 'response.audio_transcript.delta':
          this.handleAudioTranscriptDelta(data);
          break;
          
        case 'response.audio_transcript.done':
          this.handleAudioTranscriptDone(data);
          break;
          
        case 'response.audio.done':
          this.handleAudioDone(data);
          break;
          
        case 'response.done':
          this.handleResponseDone(data);
          break;

        // Handle audio buffer events
        case 'output_audio_buffer.started':
          this.handleStartSpeaking();
          break;
          
        case 'output_audio_buffer.stopped':
          this.handleStopSpeaking();
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
          
        case 'speaker_change':
          this.handleSpeakerChange(data);
          break;
          
        case 'audio_level':
          this.handleAudioLevel(data);
          break;

        case 'conversation.item.input_audio_transcription.delta':
          // optional: accumulate partial transcript for live captions
          break;
        
        case 'response.content_part.done':
          // optional: inspect final content parts
          break;
        
        case 'response.output_item.done':
          // optional: marks an output item finalized
          break;

        default:
          console.log('Unknown message type:', data.type);
      }
    } catch (error) {
      console.error('Error handling data channel message:', error);
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
  }

  private handleResponseCreated(data: any): void {
    console.log('AI response created:', data);
    // AI is about to start responding
  }

  private handleContentPartAdded(data: any): void {
    console.log('Content part added:', data);
    
    // Check if this is a text response that contains JSON metadata
    if (data.item?.content?.[0]?.type === 'text') {
      const text = data.item.content[0].text;
      if (text) {
        // Try to parse JSON from the text channel
        try {
          const jsonData = JSON.parse(text);
          console.log('Parsed JSON metadata from text channel:', jsonData);
          
          // Validate the JSON structure
          if (jsonData.language && jsonData.translation && jsonData.original_speaker && jsonData.target_speaker) {
            // Store the JSON metadata for use with audio transcript
            this.handleJSONMetadata(jsonData);
          } else {
            console.warn('Invalid JSON structure received:', jsonData);
          }
        } catch (error) {
          console.warn('Failed to parse JSON from text channel:', error);
          console.log('Raw text content:', text);
          // Fallback to old behavior if JSON parsing fails
          this.handleAIResponse(text);
        }
      }
    }
  }

  private handleContentPartDone(data: any): void {
    console.log('Content part done:', data);
    
    // Check if this is an audio content part that contains JSON (which shouldn't happen but we need to handle it)
    if (data.part?.type === 'audio' && data.part?.transcript) {
      const transcript = data.part.transcript;
      console.log('🎤 Audio content part transcript:', transcript);
      
      // Check if the transcript contains JSON
      if (transcript.trim().startsWith('{') && transcript.trim().endsWith('}')) {
        console.warn('⚠️ AI is speaking JSON in audio modality! Attempting to parse...');
        try {
          const jsonData = JSON.parse(transcript);
          if (jsonData.language && jsonData.translation && jsonData.original_speaker && jsonData.target_speaker) {
            console.log('✅ Successfully parsed JSON from audio content part:', jsonData);
            // Use the translation field as the spoken content
            this.handleAIResponseWithMetadata(jsonData.translation, jsonData);
            return;
          }
        } catch (error) {
          console.error('❌ Failed to parse JSON from audio content part:', error);
        }
      }
    }
    
    // Also check text content parts for JSON metadata
    if (data.item?.content?.[0]?.type === 'text') {
      const text = data.item.content[0].text;
      if (text && text.trim().startsWith('{') && text.trim().endsWith('}')) {
        try {
          const jsonData = JSON.parse(text);
          if (jsonData.language && jsonData.translation && jsonData.original_speaker && jsonData.target_speaker) {
            console.log('✅ JSON metadata received via text content part:', jsonData);
            this.handleJSONMetadata(jsonData);
          }
        } catch (error) {
          console.error('❌ Failed to parse JSON from text content part:', error);
        }
      }
    }
  }

  private handleAudioTranscriptDelta(data: any): void {
    console.log('Audio transcript delta:', data);
    
    // This is the AI speaking - we can show real-time transcription
    // This is the spoken audio, not JSON, so we can display it directly
    if (data.delta?.text) {
      this.handleAIRealTimeTranscript(data.delta.text);
    }
  }

  private handleAudioTranscriptDone(data: any): void {
    console.log('Audio transcript done:', data);
    
    // AI finished speaking - final transcript
    if (data.transcript) {
      const audioTranscript = data.transcript;
      console.log('🎤 Audio transcript received:', audioTranscript);
      
      // Check if the audio transcript contains JSON (this shouldn't happen but we need to handle it)
      if (audioTranscript.trim().startsWith('{') && audioTranscript.trim().endsWith('}')) {
        console.warn('⚠️ AI is speaking JSON instead of natural speech! Attempting to parse...');
        try {
          const jsonData = JSON.parse(audioTranscript);
          if (jsonData.language && jsonData.translation && jsonData.original_speaker && jsonData.target_speaker) {
            console.log('✅ Successfully parsed JSON from audio transcript:', jsonData);
            // Use the translation field as the spoken content
            this.handleAIResponseWithMetadata(jsonData.translation, jsonData);
            return;
          }
        } catch (error) {
          console.error('❌ Failed to parse JSON from audio transcript:', error);
        }
      }
      
      // Normal flow: use stored JSON metadata if available
      if (this.currentJSONMetadata) {
        console.log('✅ Using stored JSON metadata with audio transcript');
        this.handleAIResponseWithMetadata(audioTranscript, this.currentJSONMetadata);
        this.currentJSONMetadata = null; // Clear after use
      } else {
        console.warn('⚠️ No JSON metadata available, falling back to old behavior');
        this.handleAIResponse(audioTranscript);
      }
    }
  }

  // Store for JSON metadata received from text channel
  private currentJSONMetadata: any = null;
  private jsonMetadataTimeout: NodeJS.Timeout | null = null;

  private handleJSONMetadata(jsonData: any): void {
    console.log('Storing JSON metadata for audio transcript:', jsonData);
    
    // Validate the JSON structure
    if (!jsonData.language || !jsonData.translation || !jsonData.original_speaker || !jsonData.target_speaker) {
      console.warn('Invalid JSON metadata structure:', jsonData);
      return;
    }
    
    // Clear any existing timeout
    if (this.jsonMetadataTimeout) {
      clearTimeout(this.jsonMetadataTimeout);
    }
    
    this.currentJSONMetadata = jsonData;
    console.log('✅ JSON metadata stored successfully:', {
      language: jsonData.language,
      original_speaker: jsonData.original_speaker,
      target_speaker: jsonData.target_speaker,
      translation: jsonData.translation
    });
    
    // Set a timeout to clear metadata if audio transcript doesn't arrive
    this.jsonMetadataTimeout = setTimeout(() => {
      console.warn('⏰ JSON metadata timeout - clearing stored metadata');
      this.currentJSONMetadata = null;
      this.jsonMetadataTimeout = null;
    }, 10000); // 10 second timeout
  }

  private handleAIResponseWithMetadata(audioTranscript: string, metadata: any): void {
    console.log('AI response with metadata:', { audioTranscript, metadata });
    
    // Clear the timeout since we successfully used the metadata
    if (this.jsonMetadataTimeout) {
      clearTimeout(this.jsonMetadataTimeout);
      this.jsonMetadataTimeout = null;
    }
    
    // Use the metadata to determine speaker and language
    const speakerTarget = metadata.original_speaker;
    const isSpanish = metadata.language === 'es';
    
    console.log(`🎯 Processing AI translation: ${speakerTarget} → ${isSpanish ? 'Spanish' : 'English'}`);
    console.log(`📝 Audio transcript: "${audioTranscript}"`);
    console.log(`🔤 JSON translation: "${metadata.translation}"`);
    
    this.handleTranscript({
      speaker: speakerTarget,
      lang: isSpanish ? 'es' : 'en',
      original_text: audioTranscript, // Use the spoken audio transcript for display
      english_text: isSpanish ? metadata.translation : audioTranscript,
      spanish_text: isSpanish ? audioTranscript : metadata.translation,
      isTranslation: true // This is an AI translation
    });
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

  private handleAIResponse(text: string): void {
    console.log('AI response:', text);
  
    // Determine the original speaker based on the AI response content
    // If AI is translating to Spanish for the patient, the original speaker was the clinician
    // If AI is translating to English for the clinician, the original speaker was the patient
    let speakerTarget: 'clinician' | 'patient';
    let isSpanish = false;
    
    // Check for language markers in the response
    if (text.startsWith('[ES]') || text.includes('El doctor') || text.includes('La doctora')) {
      // AI is translating clinician's words to Spanish for the patient
      speakerTarget = 'clinician';
      isSpanish = true;
    } else if (text.startsWith('[EN]') || text.includes('The patient says') || text.includes('patient says')) {
      // AI is translating patient's words to English for the clinician
      speakerTarget = 'patient';
      isSpanish = false;
    } else {
      // Fallback: use language detection
      isSpanish = /[áéíóúñü]/i.test(text) ||
                  /\b(el|la|los|las|de|que|y|en|un|una|es|son|está|están|tiene|tienen|me|te|se|nos|le|les)\b/i.test(text);
      speakerTarget = isSpanish ? 'patient' : 'clinician';
    }
  
    this.handleTranscript({
      speaker: speakerTarget,
      lang: isSpanish ? 'es' : 'en',
      original_text: text,
      english_text: isSpanish ? undefined : text,
      spanish_text: isSpanish ? text : undefined,
      isTranslation: true // This is an AI translation
    });
  }

  private handleAIRealTimeTranscript(text: string): void {
    console.log('AI real-time transcript (spoken):', text);
    // This is the AI speaking the translation in real-time
    // Could be used to show real-time AI speech or live captions
    // The text here is the natural spoken translation, not JSON
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
      timestamp: new Date().toISOString(), // Store as ISO string for Redux
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
      console.log('Disconnecting real-time service...');
      
      // Clear any pending timeouts
      if (this.jsonMetadataTimeout) {
        clearTimeout(this.jsonMetadataTimeout);
        this.jsonMetadataTimeout = null;
      }
      
      // Clear stored metadata
      this.currentJSONMetadata = null;
      
      // Stop all media tracks
      if (this.mediaStream) {
        this.mediaStream.getTracks().forEach(track => {
          console.log('Stopping track:', track.kind, track.id);
          track.stop();
        });
        this.mediaStream = null;
      }

      // Close data channel
      if (this.dataChannel) {
        console.log('Closing data channel...');
        this.dataChannel.close();
        this.dataChannel = null;
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
      store.dispatch(setActiveSpeaker(null));
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
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      console.warn('Cannot verify session configuration - data channel not ready');
      return;
    }

    // Send a verification message to test if the translator role is working
    const verificationMessage = {
      type: 'message',
      role: 'user',
      content: 'Test: Please translate "Me duele la cabeza" to English. Put JSON metadata in text modality, speak only the translation in audio modality.'
    };

    try {
      this.dataChannel.send(JSON.stringify(verificationMessage));
      console.log('Verification message sent to test JSON metadata system');
    } catch (error) {
      console.error('Error sending verification message:', error);
    }
  }

  // Method to test the JSON metadata system
  async testJSONMetadataSystem(): Promise<void> {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      console.warn('Cannot test JSON metadata system - data channel not ready');
      return;
    }

    console.log('🧪 Testing JSON metadata system...');

    // Test Spanish to English translation
    const spanishTestMessage = {
      type: 'message',
      role: 'user',
      content: 'Please translate "Me duele la cabeza y tengo fiebre" to English. Remember: put JSON in text modality, speak only the translation in audio modality.'
    };

    try {
      this.dataChannel.send(JSON.stringify(spanishTestMessage));
      console.log('✅ Spanish test message sent - expecting JSON metadata in text channel and spoken translation in audio');
      
      // Wait a bit then test English to Spanish
      setTimeout(() => {
        if (this.dataChannel && this.dataChannel.readyState === 'open') {
          const englishTestMessage = {
            type: 'message',
            role: 'user',
            content: 'Please translate "How long have you had these symptoms?" to Spanish. Remember: put JSON in text modality, speak only the translation in audio modality.'
          };
          
          this.dataChannel.send(JSON.stringify(englishTestMessage));
          console.log('✅ English test message sent - expecting JSON metadata in text channel and spoken translation in audio');
        }
      }, 3000);
      
    } catch (error) {
      console.error('Error testing JSON metadata system:', error);
    }
  }

  // Method to send a manual test message for debugging
  async sendManualTestMessage(message: string): Promise<void> {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      console.warn('Cannot send manual test message - data channel not ready');
      return;
    }

    const testMessage = {
      type: 'message',
      role: 'user',
      content: message
    };

    try {
      this.dataChannel.send(JSON.stringify(testMessage));
      console.log('✅ Manual test message sent:', message);
    } catch (error) {
      console.error('Error sending manual test message:', error);
    }
  }

  // Method to send a system message reinforcing modality separation
  async sendModalityReminder(): Promise<void> {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      console.warn('Cannot send modality reminder - data channel not ready');
      return;
    }

    const reminderMessage = {
      type: 'message',
      role: 'system',
      content: 'REMINDER: You must separate text and audio modalities. Text modality should contain JSON metadata. Audio modality should contain only natural speech. Never speak JSON in the audio modality.'
    };

    try {
      this.dataChannel.send(JSON.stringify(reminderMessage));
      console.log('✅ Modality separation reminder sent');
    } catch (error) {
      console.error('Error sending modality reminder:', error);
    }
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

  // Method to test the translator functionality
  async testTranslator(): Promise<void> {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      console.warn('Cannot test translator - data channel not ready');
      return;
    }

    console.log('🧪 Testing translator functionality with JSON metadata system...');

    // Test Spanish to English translation
    const spanishTestMessage = {
      type: 'message',
      role: 'user',
      content: 'Me duele la cabeza y tengo fiebre.'
    };

    try {
      this.dataChannel.send(JSON.stringify(spanishTestMessage));
      console.log('✅ Spanish test message sent - expecting JSON metadata in text channel and spoken translation in audio');
      
      // Wait a bit then test English to Spanish
      setTimeout(() => {
        if (this.dataChannel && this.dataChannel.readyState === 'open') {
          const englishTestMessage = {
            type: 'message',
            role: 'user',
            content: 'How long have you had these symptoms?'
          };
          
          this.dataChannel.send(JSON.stringify(englishTestMessage));
          console.log('✅ English test message sent - expecting JSON metadata in text channel and spoken translation in audio');
        }
      }, 2000);
      
    } catch (error) {
      console.error('Error testing translator:', error);
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
