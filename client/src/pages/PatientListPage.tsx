import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
import './PatientListPage.css';

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
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'appointment' | 'lastVisit'>('appointment');
  const [filterPriority, setFilterPriority] = useState<'all' | 'high' | 'medium' | 'low'>('all');

  // Mock patient data for demo with more realistic data
  const mockPatients: Patient[] = [
    { id: 'patient-1', name: 'Maria Rodriguez', age: 45, lastVisit: '2024-01-15', appointmentDate: '2024-01-20', priority: 'high' },
    { id: 'patient-2', name: 'Carlos Mendez', age: 32, lastVisit: '2024-01-10', appointmentDate: '2024-01-19', priority: 'medium' },
    { id: 'patient-3', name: 'Ana Garcia', age: 28, lastVisit: '2024-01-08', appointmentDate: '2024-01-18', priority: 'low' },
    { id: 'patient-4', name: 'Jose Lopez', age: 55, lastVisit: '2024-01-05', appointmentDate: '2024-01-17', priority: 'high' },
    { id: 'patient-5', name: 'Isabella Torres', age: 38, lastVisit: '2024-01-12', appointmentDate: '2024-01-21', priority: 'medium' },
    { id: 'patient-6', name: 'Miguel Santos', age: 42, lastVisit: '2024-01-03', appointmentDate: '2024-01-16', priority: 'low' },
  ];

  const filteredAndSortedPatients = useMemo(() => {
    let filtered = mockPatients.filter(patient => {
      const matchesSearch = patient.name.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesPriority = filterPriority === 'all' || patient.priority === filterPriority;
      return matchesSearch && matchesPriority;
    });

    // Sort patients
    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'appointment':
          if (!a.appointmentDate || !b.appointmentDate) return 0;
          return new Date(a.appointmentDate).getTime() - new Date(b.appointmentDate).getTime();
        case 'name':
          return a.name.localeCompare(b.name);
        case 'lastVisit':
          return new Date(b.lastVisit).getTime() - new Date(a.lastVisit).getTime();
        default:
          return 0;
      }
    });

    return filtered;
  }, [mockPatients, searchTerm, sortBy, filterPriority]);

  const startNewSession = (patientId: string) => {
    const encounterId = uuidv4();
    navigate(`/session/${encounterId}`);
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high': return 'priority-high';
      case 'medium': return 'priority-medium';
      case 'low': return 'priority-low';
      default: return '';
    }
  };

  const getPriorityIcon = (priority: string) => {
    switch (priority) {
      case 'high': return '🔴';
      case 'medium': return '🟡';
      case 'low': return '🟢';
      default: return '⚪';
    }
  };

  const isToday = (dateString: string) => {
    const today = new Date().toDateString();
    return new Date(dateString).toDateString() === today;
  };

  const isTomorrow = (dateString: string) => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return new Date(dateString).toDateString() === tomorrow.toDateString();
  };

  const formatAppointmentDate = (dateString: string) => {
    if (isToday(dateString)) return 'Today';
    if (isTomorrow(dateString)) return 'Tomorrow';
    return new Date(dateString).toLocaleDateString();
  };

  return (
    <div className="patient-list-page">
      <div className="page-header">
        <h1>👥 Patient List</h1>
        <p>Select a patient to start a new translation session</p>
      </div>

      <div className="patient-controls">
        <div className="search-section">
          <input
            type="text"
            placeholder="Search patients by name..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="search-input"
          />
        </div>

        <div className="filter-section">
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'name' | 'appointment' | 'lastVisit')}
            className="sort-select"
          >
            <option value="appointment">Sort by Appointment Date</option>
            <option value="name">Sort by Name</option>
            <option value="lastVisit">Sort by Last Visit</option>
          </select>

          <select
            value={filterPriority}
            onChange={(e) => setFilterPriority(e.target.value as 'all' | 'high' | 'medium' | 'low')}
            className="priority-select"
          >
            <option value="all">All Priorities</option>
            <option value="high">High Priority</option>
            <option value="medium">Medium Priority</option>
            <option value="low">Low Priority</option>
          </select>
        </div>
      </div>

      <div className="patient-grid">
        {filteredAndSortedPatients.length === 0 ? (
          <div className="no-results">
            <p>No patients found matching your criteria.</p>
          </div>
        ) : (
          filteredAndSortedPatients.map((patient) => (
            <div key={patient.id} className={`patient-card ${getPriorityColor(patient.priority)}`}>
              <div className="patient-header">
                <div className="priority-indicator">
                  {getPriorityIcon(patient.priority)}
                </div>
                <h3>{patient.name}</h3>
              </div>
              
              <div className="patient-info">
                <p><strong>Age:</strong> {patient.age}</p>
                <p><strong>Last Visit:</strong> {new Date(patient.lastVisit).toLocaleDateString()}</p>
                {patient.appointmentDate && (
                  <p className={`appointment-date ${isToday(patient.appointmentDate) ? 'today' : isTomorrow(patient.appointmentDate) ? 'tomorrow' : ''}`}>
                    <strong>Appointment:</strong> {formatAppointmentDate(patient.appointmentDate)}
                  </p>
                )}
              </div>
              
              <button
                className="btn btn-primary"
                onClick={() => startNewSession(patient.id)}
              >
                Start Session
              </button>
            </div>
          ))
        )}
      </div>

      <div className="demo-note">
        <p>💡 This is a demo with mock patient data. Use the search and filters to find patients, then click to start a real-time translation session.</p>
        <p className="text-secondary">Patients are sorted by appointment date by default, with today's appointments highlighted.</p>
      </div>
    </div>
  );
};

export default PatientListPage;
