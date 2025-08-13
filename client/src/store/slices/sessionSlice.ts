import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export interface TranscriptLine {
  id: string;
  speaker: 'clinician' | 'patient';
  lang: 'en' | 'es';
  text: string;
  en_text?: string;
  es_text?: string;
  timestamp: string; // Store as ISO string instead of Date object
}

export interface Intent {
  id: string;
  name: 'repeat_last' | 'schedule_follow_up' | 'send_lab_order';
  args: any;
  status: 'detected' | 'pending' | 'completed' | 'failed';
  actor: 'clinician' | 'patient';
  timestamp: string; // Store as ISO string instead of Date object
}

export interface SessionState {
  encounterId: string | null;
  patientId: string | null;
  clinicianId: string | null;
  status: 'idle' | 'active' | 'completed';
  transcripts: TranscriptLine[];
  intents: Intent[];
  summary: string | null;
  isConnected: boolean;
}

const initialState: SessionState = {
  encounterId: null,
  patientId: null,
  clinicianId: null,
  status: 'idle',
  transcripts: [],
  intents: [],
  summary: null,
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
      state.transcripts = [];
      state.intents = [];
      state.summary = null;
    },
    endSession: (state) => {
      state.status = 'completed';
    },
    addTranscript: (state, action: PayloadAction<TranscriptLine>) => {
      state.transcripts.push(action.payload);
    },
    addIntent: (state, action: PayloadAction<Intent>) => {
      state.intents.push(action.payload);
    },
    updateIntentStatus: (state, action: PayloadAction<{ id: string; status: Intent['status'] }>) => {
      const intent = state.intents.find(i => i.id === action.payload.id);
      if (intent) {
        intent.status = action.payload.status;
      }
    },
    setSummary: (state, action: PayloadAction<string>) => {
      state.summary = action.payload;
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
  addTranscript,
  addIntent,
  updateIntentStatus,
  setSummary,
  setConnectionStatus,
  clearSession,
} = sessionSlice.actions;

export default sessionSlice.reducer;
