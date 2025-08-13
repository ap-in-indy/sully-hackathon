import React, { useState } from 'react';
import { useDispatch } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { startSession } from '../store/slices/sessionSlice';
import { addNotification } from '../store/slices/uiSlice';
import './LoginPage.css';

const LoginPage: React.FC = () => {
  const [pin, setPin] = useState('');
  const dispatch = useDispatch();
  const navigate = useNavigate();

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    
    // For demo purposes, accept any 4-digit PIN
    if (pin.length === 4 && /^\d+$/.test(pin)) {
      dispatch(startSession({
        encounterId: 'demo-encounter',
        patientId: 'demo-patient',
        clinicianId: 'demo-clinician',
      }));
      
      dispatch(addNotification({
        type: 'success',
        message: 'Login successful'
      }));
      
      navigate('/patients');
    } else {
      dispatch(addNotification({
        type: 'error',
        message: 'Please enter a valid 4-digit PIN'
      }));
    }
  };

  return (
    <div className="login-page">
      <div className="login-container">
        <div className="login-header">
          <h1>🏥 Sully Medical Translator</h1>
          <p>Real-time medical translation between English-speaking clinicians and Spanish-speaking patients</p>
        </div>
        
        <form className="login-form" onSubmit={handleLogin}>
          <div className="form-group">
            <label htmlFor="pin">Clinician PIN</label>
            <input
              type="password"
              id="pin"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="Enter 4-digit PIN"
              maxLength={4}
              pattern="\d{4}"
              required
            />
          </div>
          
          <button type="submit" className="btn btn-primary">
            Login
          </button>
        </form>
        
        <div className="login-footer">
          <p className="text-secondary">
            For demo purposes, use any 4-digit PIN
          </p>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
