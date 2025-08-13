import React from 'react';
import { Routes, Route } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { RootState } from './store';
import LoginPage from './pages/LoginPage';
import PatientListPage from './pages/PatientListPage';
import SessionPage from './pages/SessionPage';
import NotificationContainer from './components/NotificationContainer';
import './App.css';

function App() {
  const isAuthenticated = useSelector((state: RootState) => 
    state.session.clinicianId !== null
  );

  return (
    <div className="App">
      <NotificationContainer />
      <Routes>
        <Route 
          path="/" 
          element={isAuthenticated ? <PatientListPage /> : <LoginPage />} 
        />
        <Route 
          path="/login" 
          element={<LoginPage />} 
        />
        <Route 
          path="/patients" 
          element={isAuthenticated ? <PatientListPage /> : <LoginPage />} 
        />
        <Route 
          path="/session/:encounterId" 
          element={isAuthenticated ? <SessionPage /> : <LoginPage />} 
        />
      </Routes>
    </div>
  );
}

export default App;
