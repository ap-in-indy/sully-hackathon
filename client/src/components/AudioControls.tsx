import React from 'react';
import { useSelector } from 'react-redux';
import { RootState } from '../store';
import './AudioControls.css';

interface AudioControlsProps {
  speaker: 'clinician' | 'patient';
}

const AudioControls: React.FC<AudioControlsProps> = ({ speaker }) => {
  const isConnected = useSelector((state: RootState) => state.session.isConnected);

  const getSpeakerLabel = () => {
    return speaker === 'clinician' ? 'Clinician' : 'Patient';
  };

  const getStatusColor = () => {
    if (!isConnected) return 'disconnected';
    return 'connected';
  };

  return (
    <div className={`audio-controls ${getStatusColor()}`}>
      <div className="audio-header">
        <div className="status-indicator">
          <div className={`status-dot ${getStatusColor()}`}></div>
          <span className="status-text">
            {!isConnected ? 'Disconnected' : 'Connected'}
          </span>
        </div>
      </div>
      
      <div className="audio-info">
        <div className="speaker-label">{getSpeakerLabel()}</div>
        <div className="connection-status">
          {isConnected ? '🎤 Ready' : '❌ Offline'}
        </div>
      </div>
      
      {!isConnected && (
        <div className="connection-warning">
          <span>⚠️ No connection</span>
        </div>
      )}
    </div>
  );
};

export default AudioControls;
