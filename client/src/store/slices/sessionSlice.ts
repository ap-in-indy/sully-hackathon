import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export interface SessionState {
  encounterId: string | null;
  patientId: string | null;
  clinicianId: string | null;
  status: 'idle' | 'active' | 'completed';
  isConnected: boolean;
}

const initialState: SessionState = {
  encounterId: null,
  patientId: null,
  clinicianId: null,
  status: 'idle',
  isConnected: false,
};

const sessionSlice = createSlice({
  name: 'session',
  initialState,
  reducers: {
    startSession: (state, action: PayloadAction<{ encounterId: string; patientId: string; clinicianId: string }>) => {
      state.encounterId = action.payload.encounterId;
      state.patientId = action.payload.patientId;
      state.clinicianId = action.payload.clinicianId;
      state.status = 'active';
    },
    endSession: (state) => {
      state.status = 'completed';
    },
    setConnectionStatus: (state, action: PayloadAction<boolean>) => {
      state.isConnected = action.payload;
    },
    clearSession: (state) => {
      return initialState;
    },
  },
});

export const {
  startSession,
  endSession,
  setConnectionStatus,
  clearSession,
} = sessionSlice.actions;

export default sessionSlice.reducer;
