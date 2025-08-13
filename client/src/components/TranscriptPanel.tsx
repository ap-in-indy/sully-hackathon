import React, { useRef, useEffect } from 'react';
import { useSelector } from 'react-redux';
import { RootState } from '../store';
import { TranscriptLine } from '../store/slices/sessionSlice';
import './TranscriptPanel.css';

const TranscriptPanel: React.FC = () => {
  const transcripts = useSelector((state: RootState) => state.session.transcripts);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Auto-scroll to bottom when new transcripts are added
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [transcripts]);

  const formatTime = (timestamp: string) => {
    return new Date(timestamp).toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit',
      second: '2-digit'
    });
  };

  const getSpeakerIcon = (speaker: string) => {
    return speaker === 'clinician' ? '👨‍⚕️' : '👤';
  };

  const getLanguageLabel = (lang: string) => {
    return lang === 'en' ? 'EN' : 'ES';
  };

  return (
    <div className="transcript-panel-container">
      <div className="transcript-content" ref={scrollRef}>
        {transcripts.length === 0 ? (
          <div className="empty-transcript">
            <p>🎤 Start speaking to see the live transcript...</p>
            <p className="text-secondary">
              The system will automatically detect speech and provide real-time translation
            </p>
          </div>
        ) : (
          transcripts.map((line: TranscriptLine) => (
            <div 
              key={line.id} 
              className={`transcript-line ${line.speaker === 'clinician' ? 'clinician' : 'patient'}`}
            >
              <div className="transcript-header">
                <span className="speaker-icon">{getSpeakerIcon(line.speaker)}</span>
                <span className="speaker-name">
                  {line.speaker === 'clinician' ? 'Clinician' : 'Patient'}
                </span>
                <span className="language-badge">{getLanguageLabel(line.lang)}</span>
                {line.jsonMetadata && (
                  <span className="json-indicator" title="AI-provided metadata">🤖</span>
                )}
                <span className="timestamp">{formatTime(line.timestamp)}</span>
              </div>
              
              <div className="transcript-text">
                <div className={line.isTranslation ? "translation" : "original-text"}>
                  <strong>{line.isTranslation ? "Translation:" : "Original:"}</strong> {line.text}
                </div>
                
                {line.en_text && line.en_text !== line.text && (
                  <div className="translation en">
                    <strong>English:</strong> {line.en_text}
                  </div>
                )}
                
                {line.es_text && line.es_text !== line.text && (
                  <div className="translation es">
                    <strong>Spanish:</strong> {line.es_text}
                  </div>
                )}

                {/* Display JSON metadata if available */}
                {line.jsonMetadata && (
                  <div className="json-metadata">
                    <details>
                      <summary>📊 Translation Metadata</summary>
                      <pre>{JSON.stringify(line.jsonMetadata, null, 2)}</pre>
                    </details>
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>
      
      <div className="transcript-footer">
        <div className="transcript-stats">
          <span>Total lines: {transcripts.length}</span>
          <span>Active session</span>
        </div>
      </div>
    </div>
  );
};

export default TranscriptPanel;
