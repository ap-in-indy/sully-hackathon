import React, { useState, useEffect } from 'react';
import { useSelector } from 'react-redux';
import { RootState } from '../store';
import splitPipelineService from '../services/splitPipelineService';
import './AudioRecorder.css';

interface AudioRecorderProps {
  encounterId: string;
  patientId: string;
  clinicianId: string;
}

const AudioRecorder: React.FC<AudioRecorderProps> = ({ encounterId, patientId, clinicianId }) => {
  const [isInitialized, setIsInitialized] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  
  const connectionStatus = useSelector((state: RootState) => state.session.isConnected);
  const audioLevel = useSelector((state: RootState) => state.audio.audioLevel);
  const error = useSelector((state: RootState) => state.audio.error);

  useEffect(() => {
    const initializeService = async () => {
      try {
        await splitPipelineService.initialize({
          encounterId,
          patientId,
          clinicianId,
        });
        setIsInitialized(true);
      } catch (error) {
        console.error('Failed to initialize split pipeline service:', error);
      }
    };

    if (!isInitialized) {
      initializeService();
    }

    return () => {
      splitPipelineService.disconnect();
    };
  }, [encounterId, patientId, clinicianId, isInitialized]);

  const handleStartRecording = () => {
    splitPipelineService.startRecording();
    setIsRecording(true);
  };

  const handleStopRecording = () => {
    splitPipelineService.stopRecording();
    setIsRecording(false);
  };

  const handleToggleMute = () => {
    splitPipelineService.toggleMute();
    setIsMuted(!isMuted);
  };

  const getStatusText = () => {
    if (error) return `Error: ${error}`;
    if (!connectionStatus) return 'Disconnected';
    if (isRecording) return 'Recording...';
    return 'Ready to record';
  };

  const getStatusColor = () => {
    if (error) return '#ff4444';
    if (!connectionStatus) return '#ff8800';
    if (isRecording) return '#00ff00';
    return '#0088ff';
  };

  return (
    <div className="audio-recorder">
      <div className="recorder-header">
        <h3>Split Pipeline Audio Recorder</h3>
        <div 
          className="status-indicator"
          style={{ backgroundColor: getStatusColor() }}
        >
          {getStatusText()}
        </div>
      </div>

      <div className="audio-level-container">
        <div className="audio-level-bar">
          <div 
            className="audio-level-fill"
            style={{ width: `${audioLevel}%` }}
          />
        </div>
        <span className="audio-level-text">{Math.round(audioLevel)}%</span>
      </div>

      <div className="recorder-controls">
        <button
          className={`record-button ${isRecording ? 'recording' : ''}`}
          onClick={isRecording ? handleStopRecording : handleStartRecording}
          disabled={!connectionStatus}
        >
          {isRecording ? '⏹️ Stop' : '🎤 Record'}
        </button>

        <button
          className={`mute-button ${isMuted ? 'muted' : ''}`}
          onClick={handleToggleMute}
          disabled={!connectionStatus}
        >
          {isMuted ? '🔊 Unmute' : '🔇 Mute'}
        </button>
      </div>

      <div className="recorder-info">
        <p>
          <strong>How it works:</strong>
        </p>
        <ol>
          <li>Click "Record" to start capturing audio</li>
          <li>Speak clearly in English or Spanish</li>
          <li>Click "Stop" when finished</li>
          <li>The system will automatically:
            <ul>
              <li>Transcribe your speech (ASR)</li>
              <li>Translate to the other language</li>
              <li>Play back the translation (TTS)</li>
            </ul>
          </li>
        </ol>
      </div>

      {error && (
        <div className="error-message">
          <strong>Error:</strong> {error}
        </div>
      )}
    </div>
  );
};

export default AudioRecorder;
