import React from 'react';
import { useSelector } from 'react-redux';
import { RootState } from '../store';
import './ActionsPanel.css';

const ActionsPanel: React.FC = () => {
  const isConnected = useSelector((state: RootState) => state.session.isConnected);

  return (
    <div className="actions-panel-container">
      <div className="actions-header">
        <h4>🎤 Audio Translation Controls</h4>
        <div className="audio-mode-notice">
          <span className="info-badge">🎵 Audio-Only Mode</span>
          <p className="text-secondary">Real-time voice translation active</p>
        </div>
      </div>

      <div className="audio-features">
        <div className="feature-item">
          <div className="feature-icon">🎯</div>
          <div className="feature-content">
            <h5>Automatic Translation</h5>
            <p>Speak in English or Spanish and get instant spoken translation</p>
          </div>
        </div>

        <div className="feature-item">
          <div className="feature-icon">🔇</div>
          <div className="feature-content">
            <h5>Smart Audio Management</h5>
            <p>Microphone automatically mutes during AI translation to prevent feedback</p>
          </div>
        </div>

        <div className="feature-item">
          <div className="feature-icon">⚡</div>
          <div className="feature-content">
            <h5>Real-time Processing</h5>
            <p>Server-side voice activity detection for seamless conversation flow</p>
          </div>
        </div>

        <div className="feature-item">
          <div className="feature-icon">🌐</div>
          <div className="feature-content">
            <h5>Bilingual Support</h5>
            <p>English ↔ Spanish translation with natural voice synthesis</p>
          </div>
        </div>
      </div>

      <div className="actions-footer">
        <div className="connection-status">
          <div className={`status-indicator ${isConnected ? 'connected' : 'disconnected'}`}>
            <div className="status-dot"></div>
            <span>{isConnected ? 'Connected' : 'Disconnected'}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ActionsPanel;
