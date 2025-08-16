import React from 'react';
import { useSelector } from 'react-redux';
import { RootState } from '../store';
import './TranscriptPanel.css';

const TranscriptPanel: React.FC = () => {
  const isConnected = useSelector((state: RootState) => state.session.isConnected);

  return (
    <div className="transcript-panel-container">
      <div className="transcript-content">
        <div className="audio-only-mode">
          <div className="mode-header">
            <h3>🎤 Audio Translation Mode</h3>
            <div className={`connection-status ${isConnected ? 'connected' : 'disconnected'}`}>
              <div className="status-dot"></div>
              <span>{isConnected ? 'Connected' : 'Disconnected'}</span>
            </div>
          </div>
          
          <div className="mode-description">
            <p><strong>How it works:</strong></p>
            <ul>
              <li>🎯 Speak in English or Spanish</li>
              <li>🔄 AI automatically translates to the opposite language</li>
              <li>🔊 Translation is spoken back to you</li>
              <li>⏹️ No text transcripts - pure audio conversation</li>
            </ul>
          </div>

          <div className="audio-controls">
            <div className="control-item">
              <span className="control-icon">🎙️</span>
              <span className="control-text">Microphone active when connected</span>
            </div>
            <div className="control-item">
              <span className="control-icon">🔇</span>
              <span className="control-text">Auto-muted during AI translation</span>
            </div>
            <div className="control-item">
              <span className="control-icon">⚡</span>
              <span className="control-text">Real-time voice processing</span>
            </div>
          </div>

          {!isConnected && (
            <div className="connection-notice">
              <p className="warning">⚠️ Waiting for connection...</p>
              <p className="text-secondary">Please ensure your OpenAI API key is configured</p>
            </div>
          )}
        </div>
      </div>
      
      <div className="transcript-footer">
        <div className="transcript-stats">
          <span>🎵 Audio-Only Translation</span>
          <span>Real-time voice interpreter</span>
        </div>
      </div>
    </div>
  );
};

export default TranscriptPanel;
