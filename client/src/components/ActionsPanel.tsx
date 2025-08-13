import React from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { RootState } from '../store';
import { showToolModal, addNotification } from '../store/slices/uiSlice';
import realtimeService from '../services/realtimeService';
import './ActionsPanel.css';

const ActionsPanel: React.FC = () => {
  const dispatch = useDispatch();
  const intents = useSelector((state: RootState) => state.session.intents);
  const isConnected = useSelector((state: RootState) => state.session.isConnected);

  const handleRepeatLast = async () => {
    try {
      await realtimeService.repeatLast();
      dispatch(addNotification({
        type: 'success',
        message: 'Repeating last utterance...'
      }));
    } catch (error) {
      dispatch(addNotification({
        type: 'error',
        message: 'Failed to repeat last utterance'
      }));
    }
  };

  const handleIntentAction = (intent: any) => {
    switch (intent.name) {
      case 'schedule_follow_up':
        dispatch(showToolModal('schedule_follow_up'));
        break;
      case 'send_lab_order':
        dispatch(showToolModal('send_lab_order'));
        break;
      case 'repeat_last':
        handleRepeatLast();
        break;
    }
  };

  const getIntentIcon = (name: string) => {
    switch (name) {
      case 'schedule_follow_up':
        return '📅';
      case 'send_lab_order':
        return '🧪';
      case 'repeat_last':
        return '🔄';
      default:
        return '⚡';
    }
  };

  const getIntentLabel = (name: string) => {
    switch (name) {
      case 'schedule_follow_up':
        return 'Schedule Follow-up';
      case 'send_lab_order':
        return 'Send Lab Order';
      case 'repeat_last':
        return 'Repeat Last';
      default:
        return name;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'success';
      case 'failed':
        return 'error';
      case 'pending':
        return 'warning';
      default:
        return 'info';
    }
  };

  return (
    <div className="actions-panel-container">
      <div className="actions-header">
        <h4>Detected Actions</h4>
        <button 
          className="btn btn-outline btn-sm"
          onClick={handleRepeatLast}
          disabled={!isConnected}
        >
          🔄 Repeat Last
        </button>
      </div>

      <div className="intents-list">
        {intents.length === 0 ? (
          <div className="empty-intents">
            <p>No actions detected yet...</p>
            <p className="text-secondary">
              Actions will appear here when detected during conversation
            </p>
          </div>
        ) : (
          intents.map((intent) => (
            <div 
              key={intent.id} 
              className={`intent-item ${getStatusColor(intent.status)}`}
            >
              <div className="intent-header">
                <span className="intent-icon">{getIntentIcon(intent.name)}</span>
                <span className="intent-name">{getIntentLabel(intent.name)}</span>
                <span className={`intent-status ${getStatusColor(intent.status)}`}>
                  {intent.status}
                </span>
              </div>
              
              <div className="intent-details">
                <div className="intent-actor">
                  <strong>Actor:</strong> {intent.actor}
                </div>
                <div className="intent-time">
                  {new Date(intent.timestamp).toLocaleTimeString()}
                </div>
              </div>

              {intent.args && Object.keys(intent.args).length > 0 && (
                <div className="intent-args">
                  <strong>Arguments:</strong>
                  <pre>{JSON.stringify(intent.args, null, 2)}</pre>
                </div>
              )}

              <div className="intent-actions">
                {intent.status === 'detected' && (
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => handleIntentAction(intent)}
                  >
                    Execute
                  </button>
                )}
                
                {intent.status === 'pending' && (
                  <span className="pending-indicator">⏳ Processing...</span>
                )}
                
                {intent.status === 'completed' && (
                  <span className="success-indicator">✅ Completed</span>
                )}
                
                {intent.status === 'failed' && (
                  <span className="error-indicator">❌ Failed</span>
                )}
              </div>
            </div>
          ))
        )}
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
