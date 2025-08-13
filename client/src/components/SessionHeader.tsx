import React from 'react';
import './SessionHeader.css';

interface SessionHeaderProps {
  encounterId: string;
  onEndSession: () => void;
  isConnected: boolean;
}

const SessionHeader: React.FC<SessionHeaderProps> = ({ encounterId, onEndSession, isConnected }) => {
  return (
    <div className="session-header">
      <div className="session-info">
        <h2>
          Medical Translation Session
          <span className="system-badge">JSON Metadata System</span>
        </h2>
        <div className="session-details">
          <span className="encounter-id">Encounter: {encounterId}</span>
          <div className={`connection-status ${isConnected ? 'connected' : 'disconnected'}`}>
            <div className="status-dot"></div>
            <span>{isConnected ? 'Connected' : 'Disconnected'}</span>
          </div>
        </div>
      </div>
      
      <div className="session-actions">
        <button 
          className="btn btn-danger"
          onClick={onEndSession}
        >
          End Session
        </button>
      </div>
    </div>
  );
};

export default SessionHeader;
