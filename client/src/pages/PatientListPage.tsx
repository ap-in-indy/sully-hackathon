import React from 'react';
import { useNavigate } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
import './PatientListPage.css';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
interface Patient {
  id: string;
  name: string;
  age: number;
  lastVisit: string;
  appointmentDate?: string;
  priority: 'high' | 'medium' | 'low';
}

const PatientListPage: React.FC = () => {
  const navigate = useNavigate();

  // Mock patient data for demo - sorted by name
  const mockPatients = [
    { id: 'patient-3', name: 'Ana Garcia', age: 28, lastVisit: '2024-01-08' },
    { id: 'patient-2', name: 'Carlos Mendez', age: 32, lastVisit: '2024-01-10' },
    { id: 'patient-4', name: 'Jose Lopez', age: 55, lastVisit: '2024-01-05' },
    { id: 'patient-1', name: 'Maria Rodriguez', age: 45, lastVisit: '2024-01-15' },
  ].sort((a, b) => a.name.localeCompare(b.name));

  const startNewSession = (patientId: string) => {
    const encounterId = uuidv4();
    navigate(`/session/${encounterId}`);
  };

  return (
    <div className="patient-list-page">
      <div className="page-header">
        <h1>👥 Patient List</h1>
        <p>Select a patient to start a new translation session</p>
      </div>

      <div className="patient-grid">
        {mockPatients.map((patient) => (
          <div key={patient.id} className="patient-card">
            <div className="patient-info">
              <h3>{patient.name}</h3>
              <p>Age: {patient.age}</p>
              <p>Last Visit: {new Date(patient.lastVisit).toLocaleDateString()}</p>
            </div>
            <button
              className="btn btn-primary"
              onClick={() => startNewSession(patient.id)}
            >
              Start Session
            </button>
          </div>
        ))}
      </div>

      <div className="demo-note">
        <p>💡 This is a demo with mock patient data. Click any patient to start a real-time translation session.</p>
        <p className="text-secondary">
          In production, this would include search, filtering, and pagination for larger patient lists.
        </p>
      </div>
    </div>
  );
};

export default PatientListPage;
