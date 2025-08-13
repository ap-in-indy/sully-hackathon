import React from 'react';
import { useSelector } from 'react-redux';
import { RootState } from '../store';
import './AudioControls.css';

interface AudioControlsProps {
  speaker: 'clinician' | 'patient';
  isActive: boolean;
  audioLevel: number;
}

const AudioControls: React.FC<AudioControlsProps> = ({ speaker, isActive, audioLevel }) => {
  const isConnected = useSelector((state: RootState) => state.session.isConnected);

  const getSpeakerLabel = () => {
    return speaker === 'clinician' ? 'Clinician' : 'Patient';
  };

  const getStatusColor = () => {
    if (!isConnected) return 'disconnected';
    if (isActive) return 'active';
    return 'idle';
  };

  const getAudioLevelBars = () => {
    const bars = [];
    const maxBars = 10;
    const activeBars = Math.floor((audioLevel / 100) * maxBars);
    
    for (let i = 0; i < maxBars; i++) {
      const isActive = i < activeBars;
      const height = isActive ? Math.max(20, 20 + (i * 3)) : 20;
      
      bars.push(
        <div
          key={i}
          className={`audio-bar ${isActive ? 'active' : ''}`}
          style={{ height: `${height}%` }}
        />
      );
    }
    
    return bars;
  };

  return (
    <div className={`audio-controls ${getStatusColor()}`}>
      <div className="audio-header">
        <div className="status-indicator">
          <div className={`status-dot ${getStatusColor()}`}></div>
          <span className="status-text">
            {!isConnected ? 'Disconnected' : isActive ? 'Speaking' : 'Listening'}
          </span>
        </div>
      </div>
      
      <div className="audio-visualizer">
        <div className="audio-bars">
          {getAudioLevelBars()}
        </div>
      </div>
      
      <div className="audio-info">
        <div className="speaker-label">{getSpeakerLabel()}</div>
        <div className="audio-level">
          {isConnected ? `${Math.round(audioLevel)}%` : '--'}
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
