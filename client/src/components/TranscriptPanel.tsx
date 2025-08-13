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
    return lang === 'en' ? '🇺🇸 EN' : '🇪🇸 ES';
  };

  const getTranslationIndicator = (isTranslation: boolean) => {
    return isTranslation ? '🔄 AI Translation' : '🎤 Original Speech';
  };

  const getTranslationDirection = (line: TranscriptLine) => {
    if (!line.isTranslation) return null;
    
    if (line.speaker === 'patient' && line.lang === 'en') {
      return '🇪🇸 → 🇺🇸 Patient → Clinician';
    } else if (line.speaker === 'clinician' && line.lang === 'es') {
      return '🇺🇸 → 🇪🇸 Clinician → Patient';
    }
    return null;
  };

  return (
    <div className="transcript-panel-container">
      <div className="transcript-content" ref={scrollRef}>
        {transcripts.length === 0 ? (
          <div className="empty-transcript">
            <p>🎤 Start speaking to see the live transcript...</p>
            <p className="text-secondary">
              The system uses JSON metadata for perfect parsing while keeping audio natural
            </p>
            <div className="system-info">
              <p>💡 <strong>How it works:</strong></p>
              <ul>
                <li>🎤 You speak naturally</li>
                <li>🔤 AI translates with structured JSON metadata</li>
                <li>🔊 Audio output is natural speech only</li>
                <li>📝 UI displays both original and translation</li>
              </ul>
            </div>
          </div>
        ) : (
          transcripts.map((line: TranscriptLine) => (
            <div 
              key={line.id} 
              className={`transcript-line ${line.speaker === 'clinician' ? 'clinician' : 'patient'} ${line.isTranslation ? 'translation' : 'original'}`}
            >
              <div className="transcript-header">
                <span className="speaker-icon">{getSpeakerIcon(line.speaker)}</span>
                <span className="speaker-name">
                  {line.speaker === 'clinician' ? 'Clinician' : 'Patient'}
                </span>
                <span className="language-badge">{getLanguageLabel(line.lang)}</span>
                <span className="translation-indicator">{getTranslationIndicator(line.isTranslation)}</span>
                <span className="timestamp">{formatTime(line.timestamp)}</span>
              </div>
              
              {line.isTranslation && getTranslationDirection(line) && (
                <div className="translation-direction">
                  {getTranslationDirection(line)}
                </div>
              )}
              
              <div className="transcript-text">
                {/* Show the main text (audio transcript for translations, original for speech) */}
                <div className={line.isTranslation ? "translation-text" : "original-text"}>
                  <strong>{line.isTranslation ? "Spoken:" : "Original:"}</strong> {line.text}
                </div>
                
                {/* Show the structured translation if available and different from main text */}
                {line.isTranslation && line.en_text && line.en_text !== line.text && (
                  <div className="structured-translation en">
                    <strong>🇺🇸 English (JSON):</strong> {line.en_text}
                  </div>
                )}
                
                {line.isTranslation && line.es_text && line.es_text !== line.text && (
                  <div className="structured-translation es">
                    <strong>🇪🇸 Spanish (JSON):</strong> {line.es_text}
                  </div>
                )}
                
                {/* For original speech, show translations if available */}
                {!line.isTranslation && line.en_text && line.en_text !== line.text && (
                  <div className="translation en">
                    <strong>🇺🇸 English:</strong> {line.en_text}
                  </div>
                )}
                
                {!line.isTranslation && line.es_text && line.es_text !== line.text && (
                  <div className="translation es">
                    <strong>🇪🇸 Spanish:</strong> {line.es_text}
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
          <span>JSON metadata system active</span>
        </div>
      </div>
    </div>
  );
};

export default TranscriptPanel;
