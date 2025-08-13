import React, { useEffect, useState, useCallback } from 'react';
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

  const initializeSession = useCallback(async () => {
    if (!encounterId) {
      navigate('/patients');
      return;
    }

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
  }, [encounterId, navigate, dispatch]);

  useEffect(() => {
    initializeSession();
  }, [initializeSession]);

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
          // Don't store the result since it's not used
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

      <div className="actions-panel">
        <h3>🔧 Actions & Tools</h3>
        <ActionsPanel />
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
