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
  private lastJsonTranslationAt: number = 0;

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
    return;
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

    // Use session.update instead of message for system instructions
    // This ensures the model receives the translator role at the session level
    const sessionConfig = {
      type: "session.update",
      session: {
        modalities: ["text", "audio"],
        instructions: `
You are a medical interpreter ONLY. Not a general assistant.

Absolute rules:
- Translate ONLY the referenced utterance.
- Never add greetings, apologies, explanations, confirmations, or meta talk.
- Never invent or modify meaning. Preserve tone.
- Never ask questions or offer help unless the source utterance says so.
- Output must follow per-turn instructions.`,
        input_audio_transcription: { model: "whisper-1" },
        temperature: 0.6,  // Lower temperature for more deterministic translations
        turn_detection: { type: 'server_vad', create_response: false },
      }
    };

    try {
      this.dataChannel.send(JSON.stringify(sessionConfig));
      console.log('Session configuration sent successfully via session.update');

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
        case 'error': {
          const err = data.error || {};
          console.error('Realtime API error:', err.type, err.code, err.param, err.message);
          return;
        }
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

        case 'response.content_part.added':
        case 'response.content_part.done': {
          // Same logic: first try data.part, then fallback to item.content
          const p = data.part;
          if (p && (p.type === 'text' || p.type === 'output_text')) {
            const raw: string = p.text ?? p.value ?? p.content ?? '';
            if (raw) this.tryParseTranslationJson(raw);
            break;
          }
          const parts = data.item?.content || [];
          for (const part of parts) {
            if (part.type === 'text' || part.type === 'output_text') {
              const raw: string = part.text ?? part.value ?? part.content ?? '';
              if (raw) this.tryParseTranslationJson(raw);
            }
          }
          break;
        }

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
      } else {
        console.log('⚠️ Parsed JSON missing required fields:', obj);
      }
    } catch {}
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

    // Ask for a bilingual response (audio + JSON text)
    // If clinician spoke EN, target is patient; if patient spoke ES, target is clinician
    const target = (lang === 'en') ? 'patient' : 'clinician';
    this.requestBilingualResponseFor(data.item_id, target);
  }

  private requestBilingualResponseFor(itemId: string, target: 'patient' | 'clinician') {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') return;
  
    const original = target === 'patient' ? 'clinician' : 'patient';
    const targetLang = target === 'patient' ? 'es' : 'en';
  
    const msg = {
      type: "response.create",
      response: {
        modalities: ["text", "audio"], // text first
        input: [
          // 1) Reference the spoken utterance
          { type: "item_reference", id: itemId },
          // 2) Provide per-turn guardrails as a user message
          {
            type: "message",
            role: "user",
            content: [
              {
                type: "input_text",
                text: `
  Translate exactly the referenced utterance. Do not add anything else.
  Source speaker: ${original}
  Target speaker: ${target}
  Target language: ${targetLang}
  
  Output exactly TWO parts in this order:
  1) TEXT (single JSON object on one line):
  {"language":"${targetLang}","translation":"<only the translated sentence>","original_speaker":"${original}","target_speaker":"${target}"}
  
  2) AUDIO: speak only <only the translated sentence> in ${targetLang}.
  
  Hard bans:
  - No greetings, apologies, confirmations, or meta statements.
  - No labels, brackets, or JSON in the audio.
  - Do not paraphrase beyond a faithful translation.`
              }
            ]
          }
        ],
        // Keep instructions short. The per-turn message above carries the heavy lift.
        instructions: "Follow the per-turn rules. Produce the JSON text part, then speak only the translation in audio.",
        temperature: 0.6
      }
    };
  
    this.dataChannel.send(JSON.stringify(msg));
  }
  


  private handleResponseCreated(data: any): void {
    console.log('AI response created:', data);
    // AI is about to start responding
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
  

  private handleAIRealTimeTranscript(text: string): void {
    console.log('AI real-time transcript:', text);
    // Could be used to show real-time AI speech
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

    try {
      this.dataChannel.send(JSON.stringify({
        type: 'conversation.item.create',
        item: { type: 'message', role: 'user',
                content: [{ type: 'input_text', text: 'ping' }] }
      }));
      this.dataChannel.send(JSON.stringify({ type: 'response.create' }));
      console.log('Verification message sent to test translator role');
    } catch (error) {
      console.error('Error sending verification message:', error);
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

    console.log('🧪 Testing translator functionality...');

    // Test Spanish to English translation
    const spanishTestMessage = {
      type: 'message',
      role: 'user',
      content: 'Me duele la cabeza y tengo fiebre.'
    };

    try {
      this.dataChannel.send(JSON.stringify(spanishTestMessage));
      console.log('✅ Spanish test message sent');

      // Wait a bit then test English to Spanish
      setTimeout(() => {
        if (this.dataChannel && this.dataChannel.readyState === 'open') {
          const englishTestMessage = {
            type: 'message',
            role: 'user',
            content: 'How long have you had these symptoms?'
          };

          this.dataChannel.send(JSON.stringify(englishTestMessage));
          console.log('✅ English test message sent');
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
