import React, { useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { RootState } from '../store';
import { removeNotification } from '../store/slices/uiSlice';
import './NotificationContainer.css';

const NotificationContainer: React.FC = () => {
  const dispatch = useDispatch();
  const notifications = useSelector((state: RootState) => state.ui.notifications);

  useEffect(() => {
    // Auto-remove notifications after 5 seconds
    const timers = notifications.map(notification => 
      setTimeout(() => {
        dispatch(removeNotification(notification.id));
      }, 5000)
    );

    return () => {
      timers.forEach(timer => clearTimeout(timer));
    };
  }, [notifications, dispatch]);

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'success':
        return '✅';
      case 'error':
        return '❌';
      case 'warning':
        return '⚠️';
      case 'info':
        return 'ℹ️';
      default:
        return '📢';
    }
  };

  const getNotificationClass = (type: string) => {
    return `notification ${type}`;
  };

  return (
    <div className="notification-container">
      {notifications.map((notification) => (
        <div
          key={notification.id}
          className={getNotificationClass(notification.type)}
          onClick={() => dispatch(removeNotification(notification.id))}
        >
          <div className="notification-icon">
            {getNotificationIcon(notification.type)}
          </div>
          <div className="notification-content">
            <p>{notification.message}</p>
          </div>
          <button
            className="notification-close"
            onClick={(e) => {
              e.stopPropagation();
              dispatch(removeNotification(notification.id));
            }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
};

export default NotificationContainer;
