import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSelector, useDispatch } from 'react-redux';
import { RootState } from '../store';
import { startSession, endSession } from '../store/slices/sessionSlice';
import { setLoading, addNotification } from '../store/slices/uiSlice';
import realtimeService from '../services/realtimeService';
import splitPipelineService from '../services/splitPipelineService';
import TranscriptPanel from '../components/TranscriptPanel';
import ActionsPanel from '../components/ActionsPanel';
import AudioControls from '../components/AudioControls';
import AudioRecorder from '../components/AudioRecorder';
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
  const [useSplitPipeline, setUseSplitPipeline] = useState(false);

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

      // Initialize the appropriate service based on user choice
      if (useSplitPipeline) {
        await splitPipelineService.initialize(mockSession);
      } else {
        await realtimeService.initialize(mockSession);
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
  }, [encounterId, dispatch, navigate, useSplitPipeline]);

  useEffect(() => {
    if (!encounterId) {
      navigate('/patients');
      return;
    }

    initializeSession();
  }, [encounterId, navigate, initializeSession]);

  const handleEndSession = async () => {
    try {
      dispatch(setLoading(true));

      // Disconnect from the appropriate service
      if (useSplitPipeline) {
        await splitPipelineService.disconnect();
      } else {
        await realtimeService.disconnect();
      }

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
      
      {/* Service Selection */}
      <div className="service-selection">
        <h3>🔧 Translation Service</h3>
        <div className="service-toggle">
          <button
            className={`service-btn ${!useSplitPipeline ? 'active' : ''}`}
            onClick={() => setUseSplitPipeline(false)}
          >
            🚀 Realtime API
          </button>
          <button
            className={`service-btn ${useSplitPipeline ? 'active' : ''}`}
            onClick={() => setUseSplitPipeline(true)}
          >
            🔄 Split Pipeline
          </button>
        </div>
        <p className="service-description">
          {useSplitPipeline 
            ? "Split Pipeline: Separate ASR → Translation → TTS for maximum reliability"
            : "Realtime API: Single WebRTC connection for low-latency streaming"
          }
        </p>
      </div>

      {useSplitPipeline ? (
        <div className="split-pipeline-layout">
          <AudioRecorder 
            encounterId={encounterId!}
            patientId="patient-1"
            clinicianId="clinician-1"
          />
          <div className="transcript-panel">
            <h3>📝 Live Transcript</h3>
            <TranscriptPanel />
          </div>
        </div>
      ) : (
        <div className="session-layout">
          <div className="clinician-panel">
            <h3>👨‍⚕️ Clinician</h3>
            <AudioControls 
              speaker="clinician"
              isActive={audio.activeSpeaker === 'clinician'}
              audioLevel={audio.audioLevel}
            />
            <div className="last-text">
              <strong>Last said:</strong>
              <p>{audio.lastClinicianText || 'No speech detected yet'}</p>
            </div>
          </div>

          <div className="transcript-panel">
            <h3>📝 Live Transcript</h3>
            <TranscriptPanel />
          </div>

          <div className="patient-panel">
            <h3>👤 Patient</h3>
            <AudioControls 
              speaker="patient"
              isActive={audio.activeSpeaker === 'patient'}
              audioLevel={audio.audioLevel}
            />
            <div className="last-text">
              <strong>Last said:</strong>
              <p>{audio.lastPatientText || 'No speech detected yet'}</p>
            </div>
          </div>
        </div>
      )}

      <div className="actions-panel">
        <h3>🔧 Actions & Tools</h3>
        <ActionsPanel />
        
        {/* Connection Status Debug Panel */}
        <div className="connection-debug-panel">
          <h4>🔍 Connection Status</h4>
          <div className="connection-info">
            <p><strong>Connected:</strong> {session.isConnected ? '✅ Yes' : '❌ No'}</p>
            <p><strong>Audio Level:</strong> {Math.round(audio.audioLevel)}%</p>
            <p><strong>Active Speaker:</strong> {audio.activeSpeaker || 'None'}</p>
          </div>
          
          <div className="connection-actions">
            <button 
              className="btn btn-outline btn-sm"
              onClick={() => {
                const status = realtimeService.getConnectionStatus();
                console.log('Connection Status:', status);
                dispatch(addNotification({
                  type: 'info',
                  message: `Connection: ${status.dataChannelState}, Peer: ${status.peerConnectionState}, ICE: ${status.iceConnectionState}`
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
                dispatch(addNotification({
                  type: 'info',
                  message: 'Session state logged to console'
                }));
              }}
            >
              Debug Session
            </button>
          </div>
        </div>
      </div>

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
