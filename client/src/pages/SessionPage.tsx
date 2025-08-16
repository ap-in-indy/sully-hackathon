import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSelector, useDispatch } from 'react-redux';
import { RootState } from '../store';
import { startSession, endSession } from '../store/slices/sessionSlice';
import { setLoading, addNotification } from '../store/slices/uiSlice';
import realtimeService from '../services/realtimeService';
import TranscriptPanel from '../components/TranscriptPanel';
import ActionsPanel from '../components/ActionsPanel';
import AudioControls from '../components/AudioControls';
import SessionHeader from '../components/SessionHeader';
import './SessionPage.css';

const SessionPage: React.FC = () => {
  const { encounterId } = useParams<{ encounterId: string }>();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  
  const session = useSelector((state: RootState) => state.session);
  const audio = useSelector((state: RootState) => state.audio);
  const ui = useSelector((state: RootState) => state.ui);

  const [isInitializing, setIsInitializing] = useState(true);
  const [showEnableAudio, setShowEnableAudio] = useState(false);
  const didInit = useRef(false);

  const initializeSession = useCallback(async () => {
    try {
      dispatch(setLoading(true));
      setIsInitializing(true);

      // For demo purposes, create a mock session
      // In production, this would fetch from the server
      const mockSession = {
        encounterId: encounterId!,
        patientId: 'patient-1',
        clinicianId: 'clinician-1',
      };

      dispatch(startSession(mockSession));

      // Initialize real-time voice communication
      await realtimeService.initialize(mockSession);

      // Check if we need to show the enable audio button
      if (realtimeService.isConnectedToService()) {
        setShowEnableAudio(true);
      }

      dispatch(addNotification({
        type: 'success',
        message: 'Real-time voice communication initialized successfully'
      }));

    } catch (error) {
      console.error('Error initializing session:', error);
      dispatch(addNotification({
        type: 'error',
        message: 'Failed to initialize session. Please try again.'
      }));
      navigate('/patients');
    } finally {
      dispatch(setLoading(false));
      setIsInitializing(false);
    }
  }, [encounterId, dispatch, navigate]);

  useEffect(() => {
    if (!encounterId) {
      navigate('/patients');
      return;
    }

    // Prevent duplicate initialization in React 18 Strict Mode
    if (didInit.current) return;
    didInit.current = true;
    
    initializeSession();
  }, [encounterId, navigate, initializeSession]);

  const handleEndSession = async () => {
    try {
      dispatch(setLoading(true));

      // Disconnect from real-time service
      await realtimeService.disconnect();

      // End session on server
      if (session.encounterId) {
        const response = await fetch(`/api/encounters/${session.encounterId}/end`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
        });

        if (response.ok) {
          dispatch(endSession());
          dispatch(addNotification({
            type: 'success',
            message: 'Session ended successfully'
          }));
          navigate('/patients');
        }
      }
    } catch (error) {
      console.error('Error ending session:', error);
      dispatch(addNotification({
        type: 'error',
        message: 'Failed to end session'
      }));
    } finally {
      dispatch(setLoading(false));
    }
  };

  if (isInitializing || ui.isLoading) {
    return (
      <div className="session-page">
        <div className="loading-container">
          <div className="loading-spinner"></div>
          <p>Initializing real-time voice communication...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="session-page">
      <SessionHeader 
        encounterId={encounterId!}
        onEndSession={handleEndSession}
        isConnected={session.isConnected}
      />
      
      <div className="session-layout">
        <div className="audio-panel">
          <h3>🎤 Audio Input</h3>
          <AudioControls 
            speaker="microphone"
            isActive={audio.audioLevel > 10}
            audioLevel={audio.audioLevel}
          />
          <div className="audio-status">
            <strong>Audio Level:</strong> {Math.round(audio.audioLevel)}%
            {audio.audioLevel > 10 && <span className="recording-indicator"> ● Recording</span>}
          </div>
        </div>

        <div className="transcript-panel">
          <h3>📝 Live Transcript</h3>
          <TranscriptPanel />
        </div>
      </div>

      <div className="actions-panel">
        <h3>🔧 Actions & Tools</h3>
        <ActionsPanel />
        
        {/* Connection Status Debug Panel */}
        <div className="connection-debug-panel">
          <h4>🔍 Connection Status</h4>
          <div className="connection-info">
            <p><strong>Connected:</strong> {session.isConnected ? '✅ Yes' : '❌ No'}</p>
            <p><strong>Audio Level:</strong> {Math.round(audio.audioLevel)}%</p>
            <p><strong>Data Channel:</strong> {realtimeService.getConnectionStatus().dataChannelState}</p>
          </div>
          
          <div className="connection-actions">
            <button 
              className="btn btn-outline btn-sm"
              onClick={() => {
                const status = realtimeService.getConnectionStatus();
                console.log('Connection Status:', status);
                dispatch(addNotification({
                  type: 'info',
                  message: `Data Channel: ${status.dataChannelState}, Peer: ${status.peerConnectionState}, ICE: ${status.iceConnectionState}`
                }));
              }}
            >
              📊 Log Status
            </button>
            
            <button 
              className="btn btn-outline btn-sm"
              onClick={() => realtimeService.testConnection()}
              disabled={!session.isConnected}
            >
              🧪 Test Connection
            </button>

            <button 
              className="btn btn-outline btn-sm"
              onClick={() => realtimeService.testDualStreams()}
              disabled={!session.isConnected}
            >
              🔄 Test Dual Streams
            </button>

            <button 
              className="btn btn-warning btn-sm"
              onClick={() => realtimeService.forceExitDemoMode()}
            >
              🚫 Force Exit Demo Mode
            </button>

            <button 
              className="btn btn-info btn-sm"
              onClick={() => realtimeService.logCurrentState()}
            >
              📊 Log Current State
            </button>

            <button 
              className="btn btn-secondary btn-sm"
              onClick={() => {
                const isInitializing = realtimeService.isServiceInitializing();
                const isConnected = realtimeService.isConnectedToService();
                dispatch(addNotification({
                  type: 'info',
                  message: `Service Status: Initializing=${isInitializing}, Connected=${isConnected}`
                }));
              }}
            >
              🔍 Check Service Status
            </button>

            <button 
              className={`btn btn-sm ${realtimeService.isMuted() ? 'btn-danger' : 'btn-secondary'}`}
              onClick={() => realtimeService.toggleMute()}
              disabled={!session.isConnected}
            >
              {realtimeService.isMuted() ? '🔇 Unmute' : '🎤 Mute'}
            </button>

            <button 
              className="btn btn-outline btn-sm"
              onClick={() => {
                console.log('Current session state:', session);
                const serviceState = realtimeService.getServiceState();
                console.log('=== COMPREHENSIVE SERVICE STATE ===');
                console.log('Service State:', serviceState);
                console.log('Connection Status:', realtimeService.getConnectionStatus());
                console.log('=== END SERVICE STATE ===');
                dispatch(addNotification({
                  type: 'info',
                  message: `Service State: Demo=${serviceState.isDemoMode}, Connected=${serviceState.isConnected}, Attempts=${serviceState.connectionAttemptCount}`
                }));
              }}
            >
              Debug Service State
            </button>
          </div>
        </div>
      </div>

      {showEnableAudio && (
        <div className="enable-audio-banner">
          <p>🔊 Audio output is ready. Click to enable:</p>
          <button 
            className="btn btn-primary"
            onClick={() => {
              realtimeService.enableAudio();
              setShowEnableAudio(false);
            }}
          >
            Enable Audio Output
          </button>
        </div>
      )}

      {audio.error && (
        <div className="error-banner">
          <p>⚠️ {audio.error}</p>
          <button 
            className="btn btn-outline"
            onClick={() => window.location.reload()}
          >
            Retry Connection
          </button>
        </div>
      )}
    </div>
  );
};

export default SessionPage;
