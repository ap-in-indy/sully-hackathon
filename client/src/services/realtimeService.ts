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
  strictTranslatorMode?: boolean; // Enable strict translator mode (default: true)
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
  
  // NEW: Track demo mode state to prevent duplicate activation
  private isDemoMode = false;
  private demoModeActivationCount = 0;
  private demoModeActivationStack: string[] = [];
  private connectionAttemptCount = 0;
  private lastConnectionState = 'none';
  private lastIceConnectionState = 'none';
  
  // NEW: Prevent multiple simultaneous initializations
  private isInitializing = false;
  private initializationPromise: Promise<void> | null = null;

  async initialize(config: RealtimeConfig): Promise<void> {
    const startTime = Date.now();
    this.connectionAttemptCount++;
    
    console.log(`🚀 [${new Date().toISOString()}] ===== REALTIME SERVICE INITIALIZATION START ====`);
    console.log(`📋 Config:`, config);
    console.log(`🔍 Current state:`, {
      isConnected: this.isConnected,
      isDemoMode: this.isDemoMode,
      demoModeActivationCount: this.demoModeActivationCount,
      connectionAttemptCount: this.connectionAttemptCount,
      hasPeerConnection: !!this.peerConnection,
      hasAudioChannel: !!this.audioDataChannel,
      hasTextChannel: !!this.textDataChannel,
      lastConnectionState: this.lastConnectionState,
      lastIceConnectionState: this.lastIceConnectionState,
      isInitializing: this.isInitializing,
      hasInitializationPromise: !!this.initializationPromise
    });

    // PREVENT MULTIPLE SIMULTANEOUS INITIALIZATIONS
    if (this.isInitializing) {
      console.warn(`⚠️ [${new Date().toISOString()}] INITIALIZATION ALREADY IN PROGRESS - Waiting for existing initialization to complete`);
      console.warn(`📊 Duplicate initialization details:`, {
        connectionAttemptCount: this.connectionAttemptCount,
        isInitializing: this.isInitializing,
        hasInitializationPromise: !!this.initializationPromise
      });
      
      // Wait for existing initialization to complete
      if (this.initializationPromise) {
        try {
          await this.initializationPromise;
          console.log(`✅ [${new Date().toISOString()}] Waited for existing initialization to complete`);
          return;
        } catch (error) {
          console.warn(`⚠️ [${new Date().toISOString()}] Existing initialization failed, proceeding with new attempt`);
        }
      }
    }

    // PREVENT DUPLICATE INITIALIZATION WHEN DEMO MODE IS ACTIVE
    if (this.isDemoMode) {
      console.warn(`⚠️ [${new Date().toISOString()}] DEMO MODE ALREADY ACTIVE - Skipping initialization`);
      console.warn(`📊 Demo mode details:`, {
        activationCount: this.demoModeActivationCount,
        activationStack: this.demoModeActivationStack,
        isConnected: this.isConnected
      });
      return;
    }

    // Set initialization state
    this.isInitializing = true;
    this.initializationPromise = this.performInitialization(config, startTime);
    
    try {
      await this.initializationPromise;
    } finally {
      this.isInitializing = false;
      this.initializationPromise = null;
    }
  }

  private async performInitialization(config: RealtimeConfig, startTime: number): Promise<void> {
    // Clean up any existing session first
    if (this.isConnected || this.peerConnection || this.audioDataChannel || this.textDataChannel) {
      console.log(`🧹 [${new Date().toISOString()}] Cleaning up existing session before initializing new one...`);
      await this.disconnect();
    }

    this.config = config;
    console.log(`✅ [${new Date().toISOString()}] Config set, proceeding with initialization...`);

    try {
      // Check if getUserMedia is supported
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        console.error(`❌ [${new Date().toISOString()}] getUserMedia not supported - entering demo mode`);
        console.error(`📊 Browser capabilities:`, {
          hasMediaDevices: !!navigator.mediaDevices,
          hasGetUserMedia: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
          userAgent: navigator.userAgent
        });
        this.initializeDemoMode(config, 'getUserMedia_not_supported');
        return;
      }

      console.log(`🔑 [${new Date().toISOString()}] Getting ephemeral token from server...`);
      // Get ephemeral token from server
      const tokenResponse = await fetch('/api/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!tokenResponse.ok) {
        console.warn(`⚠️ [${new Date().toISOString()}] Failed to get OpenAI token (${tokenResponse.status} ${tokenResponse.statusText}), entering demo mode`);
        console.log(`📊 Token response details:`, {
          status: tokenResponse.status,
          statusText: tokenResponse.statusText,
          headers: Object.fromEntries(tokenResponse.headers.entries()),
          url: tokenResponse.url
        });
        this.initializeDemoMode(config, 'token_fetch_failed');
        return;
      }

      const tokenData = await tokenResponse.json();
      const ephemeralKey = tokenData.client_secret.value;
      console.log(`✅ [${new Date().toISOString()}] Token obtained successfully, length: ${ephemeralKey.length}`);

      // Create peer connection
      console.log(`🔗 [${new Date().toISOString()}] Creating RTCPeerConnection...`);
      this.peerConnection = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
      });
      console.log(`✅ [${new Date().toISOString()}] RTCPeerConnection created`);

      // Create the single data channel that OpenAI expects BEFORE createOffer
      console.log(`📡 [${new Date().toISOString()}] Creating data channel before offer...`);
      this.setupSingleDataChannel();

      // Also accept remote-created data channels
      this.peerConnection.ondatachannel = (event) => {
        if (!this.audioDataChannel) {
          console.log(`📡 [${new Date().toISOString()}] Remote data channel received:`, event.channel.label);
          this.audioDataChannel = event.channel;
          this.audioDataChannel.onmessage = (e) => this.handleUnifiedMessage(e);
          this.audioDataChannel.onopen = () => {
            console.log('✅ Data channel open (remote)');
            this.sendSessionConfiguration();
          };
        }
      };

      // Get user media for microphone input
      console.log(`🎤 [${new Date().toISOString()}] Getting user media for microphone...`);
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      console.log(`✅ [${new Date().toISOString()}] Audio stream obtained:`, this.mediaStream.getTracks().map(t => ({ kind: t.kind, enabled: t.enabled })));

      // Add an audio transceiver and send the mic track to the peer
      // Using both ensures a=sendrecv appears and your mic audio is sent.
      this.peerConnection.addTransceiver('audio', { direction: 'sendrecv' });
      const micTrack = this.mediaStream.getAudioTracks()[0];
      if (micTrack) {
        this.peerConnection.addTrack(micTrack, this.mediaStream);
        console.log('🎤 Mic track added to RTCPeerConnection');
      } else {
        console.warn('⚠️ No audio track found on media stream');
      }

      // Set up remote audio element
      this.audioElement = document.createElement('audio');
      this.audioElement.autoplay = true;
      this.audioElement.setAttribute('playsinline', 'true');
      this.audioElement.style.display = 'none';
      document.body.appendChild(this.audioElement);
      console.log(`🔊 [${new Date().toISOString()}] Audio element created and attached`);

      // Handle remote audio stream
      this.peerConnection.ontrack = (event) => {
        console.log(`🎵 [${new Date().toISOString()}] Remote audio track received:`, event.streams[0]);
        if (this.audioElement) {
          this.audioElement.srcObject = event.streams[0];
          // Attempt to play, handle autoplay restrictions
          const p = this.audioElement.play();
          if (p && typeof p.catch === 'function') {
            p.catch(() => {
              console.warn('Autoplay blocked. Show a UI button to enable audio.');
              // Optionally dispatch a notification to prompt user to click "Enable audio"
            });
          }
        }
      };

      // Create offer WITHOUT any SDP modifications
      console.log(`📤 [${new Date().toISOString()}] Creating offer with audio track and data channel...`);
      
      const offer = await this.peerConnection.createOffer();
      await this.peerConnection.setLocalDescription(offer);
      console.log(`✅ [${new Date().toISOString()}] Local description set`);
      
      // Wait for ICE candidates to be gathered so the SDP we send contains them
      console.log(`🧊 [${new Date().toISOString()}] Waiting for ICE gathering to complete...`);
      await this.waitForIceGatheringComplete(this.peerConnection);
      console.log(`✅ [${new Date().toISOString()}] ICE gathering completed`);

      // Use the final localDescription.sdp (NOT the original offer.sdp)
      const localSdp = this.peerConnection.localDescription?.sdp;
      if (!localSdp) {
        throw new Error('LocalDescription SDP missing after ICE gathering');
      }

      console.log(`🌐 [${new Date().toISOString()}] Sending SDP offer to OpenAI...`);
      console.log(`📤 [${new Date().toISOString()}] SDP offer details:`, {
        url: 'https://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2025-06-03',
        method: 'POST',
        bodyLength: localSdp.length,
        bodyPreview: localSdp.substring(0, 300) + '...',
        headers: {
          'Authorization': `Bearer ${ephemeralKey.substring(0, 10)}...`,
          'Content-Type': 'application/sdp',
        }
      });
      
      const sdpResponse = await fetch('https://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2025-06-03', {
        method: 'POST',
        body: localSdp,
        headers: {
          'Authorization': `Bearer ${ephemeralKey}`,
          'Content-Type': 'application/sdp',
        },
      });

      if (!sdpResponse.ok) {
        const errorText = await sdpResponse.text();
        console.error(`❌ [${new Date().toISOString()}] OpenAI API error response:`, {
          status: sdpResponse.status,
          statusText: sdpResponse.statusText,
          errorText: errorText.substring(0, 500),
          url: sdpResponse.url,
          headers: Object.fromEntries(sdpResponse.headers.entries())
        });
        throw new Error(`Failed to establish WebRTC connection: ${sdpResponse.status} ${sdpResponse.statusText}`);
      }

      const answerSdp = await sdpResponse.text();
      console.log(`✅ [${new Date().toISOString()}] Received SDP answer from OpenAI, length: ${answerSdp.length}`);

      const answer: RTCSessionDescriptionInit = {
        type: 'answer' as RTCSdpType,
        sdp: answerSdp,
      };

      console.log(`🔗 [${new Date().toISOString()}] Setting remote description...`);
      await this.peerConnection.setRemoteDescription(answer);
      console.log(`✅ [${new Date().toISOString()}] Remote description set successfully`);

      // NOW add the essential event handlers and audio setup
      console.log(`⚙️ [${new Date().toISOString()}] Setting up event handlers and audio...`);
      
      // Monitor connection state changes
      this.peerConnection.onconnectionstatechange = () => {
        const state = this.peerConnection?.connectionState;
        const previousState = this.lastConnectionState;
        this.lastConnectionState = state || 'none';
        
        console.log(`🔄 [${new Date().toISOString()}] Peer connection state changed: ${previousState} → ${state}`);
        console.log(`📊 Connection state details:`, {
          previousState,
          currentState: state,
          isDemoMode: this.isDemoMode,
          isConnected: this.isConnected,
          hasDataChannels: !!(this.audioDataChannel || this.textDataChannel)
        });

        if (state === 'failed' || state === 'disconnected') {
          console.log(`❌ [${new Date().toISOString()}] Peer connection failed or disconnected, attempting to reconnect...`);
          this.isConnected = false;
          store.dispatch(setConnectionStatus(false));

          // Try to reconnect after a delay
          setTimeout(() => {
            if (this.config && !this.isDemoMode) {
              console.log(`🔄 [${new Date().toISOString()}] Attempting reconnection...`);
              this.initialize(this.config);
            } else {
              console.log(`⏭️ [${new Date().toISOString()}] Skipping reconnection - demo mode active or no config`);
            }
          }, 3000);
        } else if (state === 'connected') {
          console.log(`✅ [${new Date().toISOString()}] Peer connection established successfully!`);
          console.log(`🎯 [${new Date().toISOString()}] EXITING DEMO MODE - Live connection established`);
          
          // EXIT DEMO MODE when live connection is established
          if (this.isDemoMode) {
            console.log(`🔄 [${new Date().toISOString()}] Transitioning from demo mode to live mode...`);
            this.exitDemoMode();
          }
        }
      };

      // Monitor ICE connection state
      this.peerConnection.oniceconnectionstatechange = () => {
        const iceState = this.peerConnection?.iceConnectionState;
        const previousIceState = this.lastIceConnectionState;
        this.lastIceConnectionState = iceState || 'none';
        
        console.log(`🧊 [${new Date().toISOString()}] ICE connection state: ${previousIceState} → ${iceState}`);
        console.log(`📊 ICE state details:`, {
          previousState: previousIceState,
          currentState: iceState,
          isDemoMode: this.isDemoMode,
          isConnected: this.isConnected
        });
      };

      // Don't add any tracks - let OpenAI handle audio entirely
      console.log(`✅ [${new Date().toISOString()}] WebRTC connection established successfully (minimal setup)`);

      this.isConnected = true;
      this.isDemoMode = false; // Ensure demo mode is off
      store.dispatch(setConnectionStatus(true));
      store.dispatch(setError(null));
      console.log(`🎉 [${new Date().toISOString()}] Connection marked as connected, dispatching to store`);
      console.log(`🚫 [${new Date().toISOString()}] Demo mode explicitly disabled`);

      // Start audio level monitoring
      console.log(`📊 [${new Date().toISOString()}] Starting audio level monitoring...`);
      this.startAudioLevelMonitoring();

      // Note: Session configuration will be sent when data channel is created
      console.log(`⏱️ [${new Date().toISOString()}] Initialization completed in ${Date.now() - startTime}ms`);
      console.log(`🎯 [${new Date().toISOString()}] ===== REALTIME SERVICE INITIALIZATION SUCCESS ====`);

    } catch (error) {
      const errorTime = Date.now();
      console.error(`❌ [${new Date().toISOString()}] Error initializing realtime service:`, error);
      console.error(`📊 [${new Date().toISOString()}] Error details:`, {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : 'No stack trace',
        config: this.config,
        peerConnectionState: this.peerConnection?.connectionState,
        audioChannelState: this.audioDataChannel?.readyState,
        textChannelState: this.textDataChannel?.readyState,
        timeSinceStart: errorTime - startTime,
        isDemoMode: this.isDemoMode,
        connectionAttemptCount: this.connectionAttemptCount
      });
      console.warn(`⚠️ [${new Date().toISOString()}] Falling back to demo mode`);
      this.initializeDemoMode(config, 'initialization_error');
    }
  }

  private setupSingleDataChannel(): void {
    // Use the standard data channel name that OpenAI expects
    this.audioDataChannel = this.peerConnection?.createDataChannel('oai-events', { ordered: true }) || null;
    if (this.audioDataChannel) {
      this.audioDataChannel.onopen = () => {
        console.log('✅ Data channel opened successfully');
        // Send session configuration as soon as the data channel opens
        this.sendSessionConfiguration();
      };
      this.audioDataChannel.onclose = () => {
        console.log('Data channel closed');
      };
      this.audioDataChannel.onerror = (event) => {
        console.error('Data channel error:', event);
      };
      this.audioDataChannel.onmessage = (event) => this.handleUnifiedMessage(event);
      console.log('Data channel created with name: oai-events');
    } else {
      console.error('Failed to create data channel');
    }
  }

  private async waitForDataChannelOpen(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        console.error('❌ Data channel failed to open within 15 seconds');
        console.log('Audio channel state:', this.audioDataChannel?.readyState);
        reject(new Error('Data channel failed to open within 15 seconds'));
      }, 15000);

      const checkState = () => {
        const audioState = this.audioDataChannel?.readyState;

        console.log(`🔍 Checking data channel state - Audio: ${audioState}`);

        if (audioState === 'open') {
          console.log('✅ Data channel is now open!');
          clearTimeout(timeout);
          resolve();
        } else if (audioState === 'closed') {
          console.error('❌ Data channel closed before opening');
          clearTimeout(timeout);
          reject(new Error('Data channel closed before opening'));
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
      this.setupSingleDataChannel();
      this.waitForDataChannelOpen().then(() => {
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

  private initializeDemoMode(config: RealtimeConfig, reason: string): void {
    console.log(`🚫 [${new Date().toISOString()}] ===== ENTERING DEMO MODE ====`);
    console.log(`📊 Demo mode activation details:`, {
      reason,
      activationCount: this.demoModeActivationCount + 1,
      previousStack: [...this.demoModeActivationStack],
      currentTime: new Date().toISOString(),
      isConnected: this.isConnected,
      hasPeerConnection: !!this.peerConnection
    });

    // PREVENT DUPLICATE DEMO MODE ACTIVATION
    if (this.isDemoMode) {
      console.warn(`⚠️ [${new Date().toISOString()}] DEMO MODE ALREADY ACTIVE - Skipping duplicate activation`);
      console.warn(`📊 Duplicate activation details:`, {
        reason,
        currentActivationCount: this.demoModeActivationCount,
        activationStack: this.demoModeActivationStack
      });
      return;
    }

    this.demoModeActivationCount++;
    this.demoModeActivationStack.push(`initialize(config, ${reason}) at ${new Date().toISOString()}`);
    this.isDemoMode = true;
    this.config = config;

    console.log(`✅ [${new Date().toISOString()}] Demo mode state updated:`, {
      isDemoMode: this.isDemoMode,
      activationCount: this.demoModeActivationCount,
      activationStack: this.demoModeActivationStack
    });

    // Set connection status to false in demo mode
    this.isConnected = false;
    store.dispatch(setConnectionStatus(false));
    store.dispatch(setError(null));

    // Notify user about demo mode
    store.dispatch(addNotification({
      type: 'info',
      message: `Demo mode active (${reason}) - simulating real-time translation. Add your OpenAI API key to enable live voice translation.`
    }));

    // Simulate audio level monitoring
    console.log(`📊 [${new Date().toISOString()}] Starting demo audio level simulation...`);
    this.simulateAudioLevels();

    // Add some demo transcripts after a delay
    console.log(`📝 [${new Date().toISOString()}] Scheduling demo transcripts in 2 seconds...`);
    setTimeout(() => {
      if (this.isDemoMode) {
        console.log(`📝 [${new Date().toISOString()}] Adding demo transcripts...`);
        this.addDemoTranscripts();
      } else {
        console.log(`⏭️ [${new Date().toISOString()}] Skipping demo transcripts - no longer in demo mode`);
      }
    }, 2000);

    console.log(`🎯 [${new Date().toISOString()}] ===== DEMO MODE ACTIVATION COMPLETE ====`);
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
    console.log(`📊 [${new Date().toISOString()}] Starting demo audio level simulation...`);
    
    // Clear any existing interval
    if (this.demoAudioLevelInterval) {
      console.log(`🧹 [${new Date().toISOString()}] Clearing existing demo audio level interval`);
      clearInterval(this.demoAudioLevelInterval);
      this.demoAudioLevelInterval = null;
    }

    const simulateLevel = () => {
      if (!this.isDemoMode) {
        console.log(`⏭️ [${new Date().toISOString()}] Stopping demo audio simulation - no longer in demo mode`);
        if (this.demoAudioLevelInterval) {
          clearInterval(this.demoAudioLevelInterval);
          this.demoAudioLevelInterval = null;
        }
        return;
      }

      // Simulate random audio levels for single mic
      const level = Math.random() * 30 + 10; // 10-40 range
      store.dispatch(setAudioLevel(level));
    };

    // Use setInterval instead of setTimeout for better control
    this.demoAudioLevelInterval = setInterval(simulateLevel, 100);
    console.log(`✅ [${new Date().toISOString()}] Demo audio level simulation started with interval ID:`, this.demoAudioLevelInterval);
  }

  private addDemoTranscripts(): void {
    console.log(`📝 [${new Date().toISOString()}] ===== ADDING DEMO TRANSCRIPTS ====`);
    console.log(`📊 Demo transcript details:`, {
      isDemoMode: this.isDemoMode,
      isConnected: this.isConnected,
      activationCount: this.demoModeActivationCount,
      currentTime: new Date().toISOString()
    });

    // Only add demo transcripts if still in demo mode
    if (!this.isDemoMode) {
      console.log(`⏭️ [${new Date().toISOString()}] Skipping demo transcripts - no longer in demo mode`);
      return;
    }

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

    console.log(`📝 [${new Date().toISOString()}] Scheduling ${demoTranscripts.length} demo transcripts...`);
    demoTranscripts.forEach((transcript, index) => {
      const delay = index * 2000;
      console.log(`📝 [${new Date().toISOString()}] Scheduling demo transcript ${index + 1} in ${delay}ms:`, {
        speaker: transcript.speaker,
        lang: transcript.lang,
        text: transcript.original_text.substring(0, 50) + '...'
      });
      
      setTimeout(() => {
        if (this.isDemoMode) {
          console.log(`📝 [${new Date().toISOString()}] Adding demo transcript ${index + 1}:`, transcript.speaker);
          this.handleTranscript(transcript);
        } else {
          console.log(`⏭️ [${new Date().toISOString()}] Skipping demo transcript ${index + 1} - no longer in demo mode`);
        }
      }, delay);
    });

    console.log(`🎯 [${new Date().toISOString()}] ===== DEMO TRANSCRIPTS SCHEDULED ====`);
  }

  private sendSessionConfiguration(): void {
    if (!this.config) return;

    // Create data channel dynamically if it doesn't exist
    if (!this.audioDataChannel) {
      console.log('📡 Creating data channel dynamically...');
      this.setupSingleDataChannel();
      
      // Wait for the data channel to open before sending configuration
      this.waitForDataChannelOpen().then(() => {
        console.log('✅ Data channel ready, sending configuration...');
        this.sendSessionConfigurationInternal();
      }).catch((error) => {
        console.error('❌ Failed to create data channel:', error);
      });
      return;
    }

    // Ensure data channel is open before sending
    if (this.audioDataChannel.readyState !== 'open') {
      console.log('Data channel not ready, retrying in 100ms...');
      setTimeout(() => this.sendSessionConfiguration(), 100);
      return;
    }

    this.sendSessionConfigurationInternal();
  }

  private sendSessionConfigurationInternal(): void {
    if (!this.audioDataChannel || this.audioDataChannel.readyState !== 'open') {
      console.warn('Cannot send configuration - data channel not ready');
      return;
    }

    console.log('📤 Sending session configuration...');
    console.log('Data channel state:', this.audioDataChannel.readyState);

    // Configuration based on strict translator mode setting
    const useStrictMode = this.config?.strictTranslatorMode !== false; // Default to true
    
    const sessionConfig = {
      type: "session.update",
      session: {
        modalities: ["text", "audio"], // Both modalities
        instructions: useStrictMode ? `
Act ONLY as a strict EN↔ES medical translator (simultaneous interpreter).

Hard rules:

Translate ONLY the last speaker's utterance into the other language.
Do NOT answer questions, offer advice, add clarifications, prefaces, greetings, or summaries.
Preserve meaning, register, medical terms, numbers, and units exactly.
If the input is fragmented, translate literally without adding content.
AUDIO: speak only the translated sentence(s), nothing else.
TEXT: output exactly one JSON object with the schema below (no extra text):
{
  "language": "en|es",
  "translation": "translated text",
  "original_speaker": "clinician|patient",
  "target_speaker": "clinician|patient",
  "intents": [
    {
      "type": "schedule_follow_up|send_lab_order|repeat_last|other",
      "confidence": 0.0-1.0,
      "details": "short context"
    }
  ]
}

Intent detection rules:
- "schedule_follow_up": Look for appointment requests, follow-up needs, scheduling
- "send_lab_order": Look for lab tests, blood work, diagnostic orders
- "repeat_last": Look for repetition requests, "otra vez", "repita"
- Always preserve the original meaning and tone` : `
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
        temperature: 0.6,              // Realtime min; lower values are rejected.
        top_p: useStrictMode ? 0.15 : 0.8, // Tighter control in strict mode
        max_response_output_tokens: useStrictMode ? 512 : 1024, // Stricter cap in strict mode
        turn_detection: { 
          type: 'server_vad', // Use server-side VAD for better reliability
          create_response: true,
          silence_threshold_ms: 3000, // 3 seconds of silence before processing
          speech_threshold_ms: 500    // 500ms of speech to start processing
        },
        tool_choice: useStrictMode ? "none" : undefined // Prevent tool calling only in strict mode
      }
    };

    try {
      // Send configuration to data channel
      this.audioDataChannel.send(JSON.stringify(sessionConfig));
      console.log('✅ Session configuration sent for dual modalities');
      console.log('Configuration payload:', JSON.stringify(sessionConfig, null, 2));

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

      // Audio channel handles audio-specific events
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

        // Handle audio transcript events
        case 'response.audio_transcript.delta':
          this.handleAudioTranscriptDelta(data);
          break;

        case 'response.audio_transcript.done':
          this.handleAudioTranscriptDone(data);
          break;

        // Handle session events (these can come to either channel)
        case 'session.created':
          console.log('🎵 Audio channel: Session created');
          break;

        // Audio channel should not receive text events
        case 'conversation.item.input_audio_transcription.completed':
        case 'response.content_part.added':
        case 'response.content_part.done':
        case 'conversation.item.created':
        case 'session.updated':
        case 'rate_limits.updated':
          console.warn('⚠️ Audio channel received text event:', data.type, '- should be routed to text channel');
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

        case 'response.output_item.added':
          this.handleOutputItemAdded(data);
          break;

        case 'response.audio_transcript.delta':
          this.handleAudioTranscriptDelta(data);
          break;

        case 'response.audio_transcript.done':
          this.handleAudioTranscriptDone(data);
          break;

        case 'response.done':
          this.handleResponseDone(data);
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

        // Text channel should not receive audio events - these should go to audio channel
        case 'input_audio_buffer.speech_started':
        case 'input_audio_buffer.speech_stopped':
        case 'input_audio_buffer.committed':
        case 'output_audio_buffer.started':
        case 'output_audio_buffer.stopped':
        case 'response.audio.done':
        case 'response.audio_transcript.delta':
        case 'response.audio_transcript.done':
          console.warn('⚠️ Text channel received audio event:', data.type, '- should be routed to audio channel');
          break;

        default:
          console.log('📝 Text channel unknown message type:', data.type);
      }
    } catch (error) {
      console.error('Error handling text channel message:', error);
    }
  }

  private handleUnifiedMessage(event: MessageEvent): void {
    try {
      const data = JSON.parse(event.data);
      console.log('📨 Received message:', data.type);

      // Route messages based on their type to appropriate handlers
      switch (data.type) {
        case 'error': {
          const err = data.error || {};
          console.error('Realtime API error:', err.type, err.code, err.param, err.message);
          return;
        }

        // Audio-related events
        case 'input_audio_buffer.speech_started':
        case 'input_audio_buffer.speech_stopped':
        case 'input_audio_buffer.committed':
        case 'output_audio_buffer.started':
        case 'output_audio_buffer.stopped':
        case 'response.audio.done':
          this.handleAudioChannelMessage(event);
          break;

        // Text and transcription events
        case 'conversation.item.input_audio_transcription.completed':
        case 'conversation.item.input_audio_transcription.delta':
        case 'response.created':
        case 'response.content_part.added':
        case 'response.content_part.done':
        case 'response.output_item.done':
        case 'conversation.item.created':
        case 'session.created':
        case 'session.updated':
        case 'rate_limits.updated':
        case 'transcript':
        case 'intent':
        case 'speaker_change':
        case 'audio_level':
          this.handleTextChannelMessage(event);
          break;

        default:
          console.log('📨 Unknown message type:', data.type);
      }
    } catch (error) {
      console.error('Error handling unified message:', error);
    }
  }

  private tryParseTranslationJson(raw: string): boolean {
    try {
      const obj = JSON.parse(raw);
      
      // Strict validation: require all essential fields
      if (
        obj &&
        (obj.language === 'en' || obj.language === 'es') &&
        typeof obj.translation === 'string' &&
        (obj.original_speaker === 'clinician' || obj.original_speaker === 'patient') &&
        (obj.target_speaker === 'clinician' || obj.target_speaker === 'patient') &&
        obj.translation.trim().length > 0 // Ensure translation is not empty
      ) {
        const lang = obj.language as 'en' | 'es';
        
        // Additional guardrail: check if this looks like an answer to a question
        const translation = obj.translation.toLowerCase();
        const isAnswerLike = translation.includes('yes') || translation.includes('no') || 
                           translation.includes('sí') || translation.includes('no') ||
                           translation.startsWith('because') || translation.startsWith('porque') ||
                           translation.includes('i think') || translation.includes('creo que');
        
        if (isAnswerLike) {
          console.log('⚠️ Rejected JSON that looks like an answer:', obj.translation);
          return false;
        }
        
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
        return true;
      } else {
        console.log('⚠️ Parsed JSON missing required fields:', obj);
        return false;
      }
    } catch (error) {
      console.log('⚠️ Failed to parse JSON:', raw.substring(0, 100));
      return false;
    }
  }

  private handleSpeechStarted(data: any): void {
    console.log('Speech started:', data);
    
    // In strict translator mode, cancel any ongoing AI response when user starts speaking
    // This prevents the AI from continuing to talk over the user
    if (this.isConnected && !this.isDemoMode) {
      this.cancelOngoingResponse();
    }
    
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

    // Ensure session configuration is sent (this will create data channel if needed)
    if (!this.audioDataChannel || this.audioDataChannel.readyState !== 'open') {
      console.log('📡 Ensuring session configuration is sent...');
      this.sendSessionConfiguration();
    }

    // Ask for a bilingual response (audio + JSON text)
    // If clinician spoke EN, target is patient; if patient spoke ES, target is clinician
    const target = (lang === 'en') ? 'patient' : 'clinician';
    this.requestBilingualResponseFor(data.item_id, target);
  }

  private requestBilingualResponseFor(itemId: string, target: 'patient' | 'clinician') {
    if (!this.config) return;

    // Create data channel dynamically if it doesn't exist
    if (!this.audioDataChannel) {
      console.log('📡 Creating data channel for bilingual response...');
      this.setupSingleDataChannel();
      
      // Wait for the data channel to open before sending request
      this.waitForDataChannelOpen().then(() => {
        console.log('✅ Data channel ready, sending bilingual response request...');
        this.sendBilingualResponseRequest(itemId, target);
      }).catch((error) => {
        console.error('❌ Failed to create data channel for bilingual response:', error);
      });
      return;
    }

    // Ensure data channel is open before sending
    if (this.audioDataChannel.readyState !== 'open') {
      console.log('Data channel not ready, retrying in 100ms...');
      setTimeout(() => this.requestBilingualResponseFor(itemId, target), 100);
      return;
    }

    this.sendBilingualResponseRequest(itemId, target);
  }

  private sendBilingualResponseRequest(itemId: string, target: 'patient' | 'clinician') {
    if (!this.audioDataChannel || this.audioDataChannel.readyState !== 'open') {
      console.warn('Cannot send bilingual response request - data channel not ready');
      return;
    }

    const original = target === 'patient' ? 'clinician' : 'patient';
    const targetLang = target === 'patient' ? 'es' : 'en';
  
    // Configuration based on strict translator mode setting
    const useStrictMode = this.config?.strictTranslatorMode !== false; // Default to true
    
    // Strict translator request with JSON schema enforcement
    const request = {
      type: "response.create",
      response: {
        modalities: ["text", "audio"], // Both modalities
        // Enforce JSON-first text output in strict mode:
        ...(useStrictMode && {
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "TranslationMetadata",
              strict: true,
              schema: {
                type: "object",
                additionalProperties: false,
                required: ["language", "translation", "original_speaker", "target_speaker"],
                properties: {
                  language: { type: "string", enum: ["en", "es"] },
                  translation: { type: "string" },
                  original_speaker: { type: "string", enum: ["clinician", "patient"] },
                  target_speaker: { type: "string", enum: ["clinician", "patient"] },
                  intents: {
                    type: "array",
                    items: {
                      type: "object",
                      additionalProperties: false,
                      required: ["type", "confidence"],
                      properties: {
                        type: { type: "string", enum: ["schedule_follow_up", "send_lab_order", "repeat_last", "other"] },
                        confidence: { type: "number", minimum: 0, maximum: 1 },
                        details: { type: "string" }
                      }
                    }
                  }
                }
              }
            }
          }
        }),
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
                text: useStrictMode ? `Translate the referenced utterance to ${targetLang} ONLY.

Strict rules:

Do not answer questions or add clarifications.
Preserve meaning, register, medical terms, numbers, units.
AUDIO: speak only the translation, no pre/post text.
TEXT: output exactly one JSON object per the provided schema.
Set original_speaker="${original}" and target_speaker="${target}".` : `Translate the referenced utterance to ${targetLang} and provide:

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
        instructions: useStrictMode ? "Strict translator mode: output exactly one JSON object and the spoken translation." : "Provide JSON metadata and speak the translation. Handle both text and audio output.",
        temperature: 0.6,              // Mirror the session values so drift can't sneak in
        top_p: useStrictMode ? 0.15 : 0.8, // Same top_p as session for consistency
        max_output_tokens: useStrictMode ? 256 : 512, // Cap verbosity per response
        tool_choice: useStrictMode ? "none" : undefined // Prevent tool calling only in strict mode
      }
    };

    try {
      this.audioDataChannel.send(JSON.stringify(request));
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
        if (raw) {
          const parsed = this.tryParseTranslationJson(raw);
          if (parsed) {
            console.log('✅ Successfully parsed content part JSON');
            return; // Exit early if we successfully parsed JSON
          }
        }
      }
      // If it's audio we just ignore here; captions come via response.audio_transcript.*
      return;
    }

    // 2) Fallback: some stacks include a snapshot of the item's content array
    const parts = data.item?.content || [];
    for (const part of parts) {
      if (part.type === 'text' || part.type === 'output_text') {
        const raw: string = part.text ?? part.value ?? part.content ?? '';
        if (raw) {
          const parsed = this.tryParseTranslationJson(raw);
          if (parsed) {
            console.log('✅ Successfully parsed fallback content part JSON');
            return; // Exit early if we successfully parsed JSON
          }
        }
      }
    }
    
    // If we get here, no valid JSON was parsed
    console.log('⚠️ No valid translation JSON found in content parts');
  }

  private handleOutputItemAdded(data: any): void {
    console.log('Output item added:', data);
    // This message indicates a new output item has been added to the conversation.
    // It might contain a new JSON metadata object or a new spoken text.
    // We need to process it to update the lastJsonTranslationAt and potentially add a new transcript.

    const item = data.item;
    if (!item) {
      console.warn('Output item added message missing item:', data);
      return;
    }

    if (item.type === 'output_text') {
      const raw: string = item.text ?? item.value ?? item.content ?? '';
      if (raw) {
        const parsed = this.tryParseTranslationJson(raw);
        if (parsed) {
          // If it's a new JSON metadata, update lastJsonTranslationAt
          if (this.lastJsonTranslationAt === 0) {
            this.lastJsonTranslationAt = Date.now();
          }
          console.log('✅ Successfully parsed output item JSON');
        }
      }
    } else if (item.type === 'output_audio_buffer') {
      // This is a new spoken audio buffer. We don't parse JSON from it directly,
      // but we need to update lastJsonTranslationAt if it's a new JSON metadata.
      // This is a bit complex because the audio buffer itself doesn't contain JSON.
      // The JSON is embedded in the response.audio_transcript.delta/done messages.
      // So, we rely on the audio transcript delta/done messages to update lastJsonTranslationAt.
      // For now, we'll just log it.
      console.log('Output audio buffer added:', item);
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
  
    // Skip processing if this is an audio transcript (to prevent voice overlap)
    if (payload.type === 'response.audio_transcript.done' || 
        payload.type === 'response.audio_transcript.delta') {
      console.log('🎵 Skipping audio transcript processing to prevent voice overlap');
      return;
    }
  
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
    console.log(`🔌 [${new Date().toISOString()}] ===== DISCONNECTING REALTIME SERVICE ====`);
    console.log(`📊 Disconnect details:`, {
      isConnected: this.isConnected,
      isDemoMode: this.isDemoMode,
      demoModeActivationCount: this.demoModeActivationCount,
      hasPeerConnection: !!this.peerConnection,
      hasMediaStream: !!this.mediaStream,
      hasAudioChannel: !!this.audioDataChannel,
      hasTextChannel: !!this.textDataChannel,
      hasAudioElement: !!this.audioElement,
      connectionAttemptCount: this.connectionAttemptCount
    });

    try {
      // Stop demo audio level simulation if active
      if (this.demoAudioLevelInterval) {
        console.log(`⏹️ [${new Date().toISOString()}] Stopping demo audio level simulation...`);
        clearInterval(this.demoAudioLevelInterval);
        this.demoAudioLevelInterval = null;
      }

      // Stop all media tracks
      if (this.mediaStream) {
        console.log(`🎤 [${new Date().toISOString()}] Stopping media tracks...`);
        this.mediaStream.getTracks().forEach(track => {
          console.log(`⏹️ [${new Date().toISOString()}] Stopping track:`, track.kind, track.id);
          track.stop();
        });
        this.mediaStream = null;
      }

      // Close data channels
      if (this.audioDataChannel) {
        console.log(`📡 [${new Date().toISOString()}] Closing audio data channel...`);
        this.audioDataChannel.close();
        this.audioDataChannel = null;
      }
      if (this.textDataChannel) {
        console.log(`📡 [${new Date().toISOString()}] Closing text data channel...`);
        this.textDataChannel.close();
        this.textDataChannel = null;
      }

      // Close peer connection
      if (this.peerConnection) {
        console.log(`🔗 [${new Date().toISOString()}] Closing peer connection...`);
        this.peerConnection.close();
        this.peerConnection = null;
      }

      // Remove audio element
      if (this.audioElement) {
        console.log(`🔊 [${new Date().toISOString()}] Removing audio element...`);
        this.audioElement.remove();
        this.audioElement = null;
      }

      // Reset state
      console.log(`🔄 [${new Date().toISOString()}] Resetting service state...`);
      this.isConnected = false;
      this.isDemoMode = false; // Ensure demo mode is off
      this.demoModeActivationCount = 0;
      this.demoModeActivationStack = [];
      this.config = null;
      this.lastConnectionState = 'none';
      this.lastIceConnectionState = 'none';

      // Update Redux state
      store.dispatch(setConnectionStatus(false));
      store.dispatch(setAudioLevel(0));
      store.dispatch(setError(null));

      console.log(`✅ [${new Date().toISOString()}] Real-time service disconnected successfully`);
      console.log(`🎯 [${new Date().toISOString()}] ===== DISCONNECT COMPLETE ====`);

    } catch (error) {
      console.error(`❌ [${new Date().toISOString()}] Error disconnecting:`, error);
      console.error(`📊 Error details:`, {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : 'No stack trace'
      });
    }
  }

  isConnectedToService(): boolean {
    return this.isConnected;
  }

  // NEW: Method to check if service is currently initializing
  isServiceInitializing(): boolean {
    return this.isInitializing;
  }

  // Method to verify session configuration was applied
  private verifySessionConfiguration(): void {
    if (!this.audioDataChannel || this.audioDataChannel.readyState !== 'open') {
      console.warn('Cannot verify session configuration - data channel not ready');
      return;
    }

    try {
      this.audioDataChannel.send(JSON.stringify({
        type: 'conversation.item.create',
        item: { type: 'message', role: 'user',
                content: [{ type: 'input_text', text: 'ping' }] }
      }));
      this.audioDataChannel.send(JSON.stringify({ type: 'response.create' }));
      console.log('Verification message sent to test translator role');
    } catch (error) {
      console.error('Error sending verification message:', error);
    }
  }

  // Method to manually trigger repeat functionality
  async repeatLast(): Promise<void> {
    if (!this.audioDataChannel) {
      console.warn('Data channel not available for repeat');
      return;
    }

    const repeatMessage = {
      type: 'message',
      role: 'user',
      content: 'repeat_last',
    };

    this.audioDataChannel.send(JSON.stringify(repeatMessage));
  }

  // Method to test the connection by sending a test message
  async testConnection(): Promise<void> {
    if (!this.audioDataChannel || this.audioDataChannel.readyState !== 'open') {
      console.warn('Data channel not ready for testing');
      return;
    }

    const testMessage = {
      type: 'message',
      role: 'user',
      content: 'Hello, this is a test message to verify the connection is working.',
    };

    try {
      this.audioDataChannel.send(JSON.stringify(testMessage));
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
    if (!this.audioDataChannel || this.audioDataChannel.readyState !== 'open') {
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
      this.audioDataChannel.send(JSON.stringify(spanishTestMessage));
      console.log('✅ Spanish test message sent to data channel');

      // Wait a bit then test English to Spanish
      setTimeout(() => {
        if (this.audioDataChannel && this.audioDataChannel.readyState === 'open') {
          const englishTestMessage = {
            type: 'message',
            role: 'user',
            content: 'How long have you had these symptoms?'
          };

          this.audioDataChannel.send(JSON.stringify(englishTestMessage));
          console.log('✅ English test message sent to data channel');
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
      dataChannelState: this.audioDataChannel?.readyState || 'none',
      peerConnectionState: this.peerConnection?.connectionState || 'none',
      iceConnectionState: this.peerConnection?.iceConnectionState || 'none',
    };
  }

  // Method to cancel ongoing AI response (useful for strict translator mode)
  private cancelOngoingResponse(): void {
    if (!this.audioDataChannel || this.audioDataChannel.readyState !== 'open') {
      return;
    }

    try {
      const cancelMessage = {
        type: 'response.cancel'
      };
      this.audioDataChannel.send(JSON.stringify(cancelMessage));
      console.log('🛑 Cancelled ongoing AI response due to user speech');
    } catch (error) {
      console.error('Error cancelling response:', error);
    }
  }

  // Method to reconnect with new configuration (useful for changing strict mode)
  async reconnectWithNewConfig(): Promise<void> {
    if (!this.config) {
      console.warn('Cannot reconnect - no configuration available');
      return;
    }

    console.log('🔄 Reconnecting with new configuration...');
    console.log('📊 New config:', {
      strictTranslatorMode: this.config.strictTranslatorMode,
      encounterId: this.config.encounterId,
      patientId: this.config.patientId,
      clinicianId: this.config.clinicianId
    });

    // Disconnect current session
    await this.disconnect();
    
    // Wait a moment for cleanup
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Reinitialize with new config
    await this.initialize(this.config);
  }

  // NEW: Method to get comprehensive service state for debugging
  getServiceState(): {
    isConnected: boolean;
    isDemoMode: boolean;
    demoModeActivationCount: number;
    demoModeActivationStack: string[];
    connectionAttemptCount: number;
    lastConnectionState: string;
    lastIceConnectionState: string;
    hasPeerConnection: boolean;
    hasMediaStream: boolean;
    hasAudioChannel: boolean;
    hasTextChannel: boolean;
    hasAudioElement: boolean;
    hasDemoAudioInterval: boolean;
    isInitializing: boolean;
    hasInitializationPromise: boolean;
    config: RealtimeConfig | null;
  } {
    return {
      isConnected: this.isConnected,
      isDemoMode: this.isDemoMode,
      demoModeActivationCount: this.demoModeActivationCount,
      demoModeActivationStack: [...this.demoModeActivationStack],
      connectionAttemptCount: this.connectionAttemptCount,
      lastConnectionState: this.lastConnectionState,
      lastIceConnectionState: this.lastIceConnectionState,
      hasPeerConnection: !!this.peerConnection,
      hasMediaStream: !!this.mediaStream,
      hasAudioChannel: !!this.audioDataChannel,
      hasTextChannel: !!this.textDataChannel,
      hasAudioElement: !!this.audioElement,
      hasDemoAudioInterval: !!this.demoAudioLevelInterval,
      isInitializing: this.isInitializing,
      hasInitializationPromise: !!this.initializationPromise,
      config: this.config
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

  // NEW: Method to force exit demo mode for testing
  forceExitDemoMode(): void {
    console.log(`🔧 [${new Date().toISOString()}] ===== FORCE EXITING DEMO MODE ====`);
    console.log(`📊 Force exit details:`, {
      wasDemoMode: this.isDemoMode,
      activationCount: this.demoModeActivationCount,
      activationStack: this.demoModeActivationStack,
      isConnected: this.isConnected
    });

    if (this.isDemoMode) {
      this.exitDemoMode();
      console.log(`✅ [${new Date().toISOString()}] Demo mode force exited successfully`);
    } else {
      console.log(`ℹ️ [${new Date().toISOString()}] Not in demo mode, nothing to force exit`);
    }
  }

  // Method to get mute status
  isMuted(): boolean {
    if (!this.mediaStream) return false;
    const audioTracks = this.mediaStream.getAudioTracks();
    return audioTracks.length > 0 ? !audioTracks[0].enabled : false;
  }

  // Method to enable audio output (handle autoplay restrictions)
  enableAudio(): void {
    if (this.audioElement) {
      this.audioElement.play().catch((error) => {
        console.warn('Failed to enable audio:', error);
      });
    }
  }

  // NEW: Method to exit demo mode
  private exitDemoMode(): void {
    console.log(`🔄 [${new Date().toISOString()}] ===== EXITING DEMO MODE ====`);
    console.log(`📊 Demo mode exit details:`, {
      wasDemoMode: this.isDemoMode,
      activationCount: this.demoModeActivationCount,
      activationStack: this.demoModeActivationStack,
      isConnected: this.isConnected,
      peerConnectionState: this.peerConnection?.connectionState
    });

    if (!this.isDemoMode) {
      console.log(`ℹ️ [${new Date().toISOString()}] Not in demo mode, nothing to exit`);
      return;
    }

    // Stop demo audio level simulation
    if (this.demoAudioLevelInterval) {
      clearInterval(this.demoAudioLevelInterval);
      this.demoAudioLevelInterval = null;
      console.log(`⏹️ [${new Date().toISOString()}] Stopped demo audio level simulation`);
    }

    // Reset demo mode state
    this.isDemoMode = false;
    this.demoModeActivationCount = 0;
    this.demoModeActivationStack = [];

    // Update store to reflect live connection
    store.dispatch(setConnectionStatus(true));
    store.dispatch(setError(null));

    // Notify user about transition to live mode
    store.dispatch(addNotification({
      type: 'success',
      message: 'Demo mode exited - live voice translation is now active!'
    }));

    console.log(`✅ [${new Date().toISOString()}] Demo mode exited successfully`);
    console.log(`🎯 [${new Date().toISOString()}] ===== DEMO MODE EXIT COMPLETE ====`);
  }

  // NEW: Track demo audio level interval
  private demoAudioLevelInterval: NodeJS.Timeout | null = null;

  // NEW: Method to wait for ICE gathering to complete
  private async waitForIceGatheringComplete(pc: RTCPeerConnection): Promise<void> {
    if (pc.iceGatheringState === 'complete') return;
    
    await new Promise<void>((resolve) => {
      const check = () => {
        if (!pc) return resolve();
        if (pc.iceGatheringState === 'complete') {
          pc.removeEventListener('icegatheringstatechange', check);
          resolve();
        }
      };
      pc.addEventListener('icegatheringstatechange', check);
      // Safety timeout after 5s in case some networks don't produce candidates
      setTimeout(() => {
        pc.removeEventListener('icegatheringstatechange', check);
        resolve();
      }, 5000);
    });
  }



  // NEW: Method to log current state for debugging
  logCurrentState(): void {
    console.log(`🔍 [${new Date().toISOString()}] ===== CURRENT SERVICE STATE LOG ====`);
    const serviceState = this.getServiceState();
    const connectionStatus = this.getConnectionStatus();
    
    console.log('📊 Service State:', serviceState);
    console.log('🔗 Connection Status:', connectionStatus);
    console.log('🎯 Demo Mode Details:', {
      isDemoMode: serviceState.isDemoMode,
      activationCount: serviceState.demoModeActivationCount,
      activationStack: serviceState.demoModeActivationStack
    });
    console.log('📡 Data Channels:', {
      audioChannel: this.audioDataChannel?.readyState || 'none',
      textChannel: this.textDataChannel?.readyState || 'none'
    });
    console.log('🎤 Media Stream:', {
      hasStream: !!this.mediaStream,
      trackCount: this.mediaStream?.getTracks().length || 0,
      audioTracks: this.mediaStream?.getAudioTracks().map(t => ({ id: t.id, enabled: t.enabled })) || []
    });
    console.log('🔊 Audio Element:', {
      hasElement: !!this.audioElement,
      srcObject: !!this.audioElement?.srcObject
    });
    console.log(`🎯 [${new Date().toISOString()}] ===== END STATE LOG ====`);
  }
}

export const realtimeService = new RealtimeService();
export default realtimeService;
