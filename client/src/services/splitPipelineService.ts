import { store } from '../store';
import {
  addTranscript,
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

export interface SplitPipelineConfig {
  encounterId: string;
  patientId: string;
  clinicianId: string;
}

class SplitPipelineService {
  private mediaStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private isRecording = false;
  private isConnected = false;
  private config: SplitPipelineConfig | null = null;
  private audioChunks: Blob[] = [];
  private audioElement: HTMLAudioElement | null = null;

  async initialize(config: SplitPipelineConfig): Promise<void> {
    // Clean up any existing session first
    if (this.isConnected || this.mediaStream) {
      console.log('Cleaning up existing session before initializing new one...');
      await this.disconnect();
    }

    this.config = config;

    try {
      // Check if getUserMedia is supported
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('getUserMedia is not supported in this browser');
      }

      // Get user media for microphone input
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 16000, // 16kHz for better ASR
        },
      });

      console.log('Audio stream obtained:', this.mediaStream.getTracks().map(t => ({ kind: t.kind, enabled: t.enabled })));

      // Set up audio element for TTS playback
      this.audioElement = document.createElement('audio');
      this.audioElement.autoplay = true;
      this.audioElement.style.display = 'none';
      document.body.appendChild(this.audioElement);

      // Initialize audio context for recording
      this.audioContext = new AudioContext({ sampleRate: 16000 });

      this.isConnected = true;
      store.dispatch(setConnectionStatus(true));
      store.dispatch(setError(null));

      // Start audio level monitoring
      this.startAudioLevelMonitoring();

      // Notify user about split pipeline mode
      store.dispatch(addNotification({
        type: 'info',
        message: 'Split pipeline mode active - using separate ASR, translation, and TTS for robust performance.'
      }));

      console.log('✅ Split pipeline service initialized successfully');

    } catch (error) {
      console.error('Error initializing split pipeline service:', error);
      store.dispatch(setError('Failed to initialize audio capture'));
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

  // Start recording audio
  startRecording(): void {
    if (!this.mediaStream || this.isRecording) return;

    this.audioChunks = [];
    this.isRecording = true;

    // Create MediaRecorder with supported format
    const mimeType = MediaRecorder.isTypeSupported('audio/webm') 
      ? 'audio/webm' 
      : MediaRecorder.isTypeSupported('audio/mp4') 
        ? 'audio/mp4' 
        : 'audio/wav';
    
    this.mediaRecorder = new MediaRecorder(this.mediaStream, {
      mimeType
    });

    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        this.audioChunks.push(event.data);
      }
    };

    this.mediaRecorder.onstop = async () => {
      if (this.audioChunks.length > 0) {
        await this.processAudioChunk();
      }
    };

    this.mediaRecorder.start(1000); // Collect data every second
    console.log('🎤 Started recording audio');
  }

  // Stop recording and process
  stopRecording(): void {
    if (!this.mediaRecorder || !this.isRecording) return;

    this.isRecording = false;
    this.mediaRecorder.stop();
    console.log('🛑 Stopped recording audio');
  }

  private async processAudioChunk(): Promise<void> {
    if (this.audioChunks.length === 0) return;

    try {
      // Combine all audio chunks into a single blob
      const audioBlob = new Blob(this.audioChunks, { type: this.mediaRecorder?.mimeType || 'audio/webm' });
      this.audioChunks = []; // Clear for next recording

      // Step 1: ASR - Convert speech to text
      const transcript = await this.performASR(audioBlob);
      if (!transcript) return;

      // Step 2: Determine speaker and language
      const speaker = this.detectSpeaker(transcript);
      const lang = this.detectLanguage(transcript);

      console.log(`🎤 ${speaker} spoke in ${lang === 'en' ? 'English' : 'Spanish'}: "${transcript}"`);

      // Add original transcript to store
      this.handleTranscript({
        speaker,
        lang,
        original_text: transcript,
        english_text: lang === 'en' ? transcript : undefined,
        spanish_text: lang === 'es' ? transcript : undefined,
        isTranslation: false
      });

      // Step 3: Translation - Get structured JSON
      const target = (lang === 'en') ? 'patient' : 'clinician';
      const translation = await this.performTranslation(transcript, speaker, target);
      if (!translation) return;

      // Step 4: TTS - Generate speech from translation
      await this.performTTS(translation.translation);

      // Add translation to store
      this.handleTranscript({
        speaker: translation.target_speaker,
        lang: translation.language,
        original_text: translation.translation,
        english_text: translation.language === 'en' ? translation.translation : undefined,
        spanish_text: translation.language === 'es' ? translation.translation : undefined,
        isTranslation: true,
        jsonMetadata: translation
      });

    } catch (error) {
      console.error('Error processing audio chunk:', error);
      store.dispatch(addNotification({
        type: 'error',
        message: 'Error processing audio. Please try again.'
      }));
    }
  }

  private async performASR(audioBlob: Blob): Promise<string | null> {
    try {
      const formData = new FormData();
      formData.append('audio', audioBlob, 'audio.wav');

      const response = await fetch('/api/asr', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`ASR failed: ${response.statusText}`);
      }

      const result = await response.json();
      return result.transcript;
    } catch (error) {
      console.error('Error in ASR:', error);
      return null;
    }
  }

  private async performTranslation(
    transcript: string, 
    original_speaker: 'clinician' | 'patient', 
    target_speaker: 'clinician' | 'patient'
  ): Promise<any | null> {
    try {
      const response = await fetch('/api/translate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          transcript,
          original_speaker,
          target_speaker,
        }),
      });

      if (!response.ok) {
        throw new Error(`Translation failed: ${response.statusText}`);
      }

      const result = await response.json();
      return result;
    } catch (error) {
      console.error('Error in translation:', error);
      return null;
    }
  }

  private async performTTS(text: string): Promise<void> {
    try {
      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text }),
      });

      if (!response.ok) {
        throw new Error(`TTS failed: ${response.statusText}`);
      }

      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);

      if (this.audioElement) {
        this.audioElement.src = audioUrl;
        this.audioElement.play().catch(error => {
          console.error('Error playing TTS audio:', error);
        });
      }
    } catch (error) {
      console.error('Error in TTS:', error);
    }
  }

  private detectSpeaker(transcript: string): 'clinician' | 'patient' {
    const lang = this.detectLanguage(transcript);
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
      timestamp: new Date().toISOString(),
      jsonMetadata: data.jsonMetadata,
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

  async disconnect(): Promise<void> {
    try {
      console.log('Disconnecting split pipeline service...');

      // Stop recording if active
      if (this.mediaRecorder && this.isRecording) {
        this.mediaRecorder.stop();
        this.isRecording = false;
      }

      // Stop all media tracks
      if (this.mediaStream) {
        this.mediaStream.getTracks().forEach(track => {
          console.log('Stopping track:', track.kind, track.id);
          track.stop();
        });
        this.mediaStream = null;
      }

      // Close audio context
      if (this.audioContext) {
        await this.audioContext.close();
        this.audioContext = null;
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
      this.audioChunks = [];

      // Update Redux state
      store.dispatch(setConnectionStatus(false));
      store.dispatch(setActiveSpeaker(null));
      store.dispatch(setAudioLevel(0));
      store.dispatch(setError(null));

      console.log('Split pipeline service disconnected successfully');

    } catch (error) {
      console.error('Error disconnecting:', error);
    }
  }

  isConnectedToService(): boolean {
    return this.isConnected;
  }

  // Method to manually trigger recording (for testing)
  toggleRecording(): void {
    if (this.isRecording) {
      this.stopRecording();
    } else {
      this.startRecording();
    }
  }

  // Method to get connection status
  getConnectionStatus(): {
    isConnected: boolean;
    isRecording: boolean;
  } {
    return {
      isConnected: this.isConnected,
      isRecording: this.isRecording,
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

export const splitPipelineService = new SplitPipelineService();
export default splitPipelineService;
