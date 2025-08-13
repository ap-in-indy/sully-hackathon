import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export interface AudioState {
  isRecording: boolean;
  activeSpeaker: 'clinician' | 'patient' | null;
  audioLevel: number;
  isConnected: boolean;
  error: string | null;
  lastClinicianText: string;
  lastPatientText: string;
}

const initialState: AudioState = {
  isRecording: false,
  activeSpeaker: null,
  audioLevel: 0,
  isConnected: false,
  error: null,
  lastClinicianText: '',
  lastPatientText: '',
};

const audioSlice = createSlice({
  name: 'audio',
  initialState,
  reducers: {
    startRecording: (state) => {
      state.isRecording = true;
      state.error = null;
    },
    stopRecording: (state) => {
      state.isRecording = false;
    },
    setActiveSpeaker: (state, action: PayloadAction<'clinician' | 'patient' | null>) => {
      state.activeSpeaker = action.payload;
    },
    setAudioLevel: (state, action: PayloadAction<number>) => {
      state.audioLevel = action.payload;
    },
    setConnectionStatus: (state, action: PayloadAction<boolean>) => {
      state.isConnected = action.payload;
    },
    setError: (state, action: PayloadAction<string | null>) => {
      state.error = action.payload;
    },
    setLastClinicianText: (state, action: PayloadAction<string>) => {
      state.lastClinicianText = action.payload;
    },
    setLastPatientText: (state, action: PayloadAction<string>) => {
      state.lastPatientText = action.payload;
    },
    clearAudioState: (state) => {
      return initialState;
    },
  },
});

export const {
  startRecording,
  stopRecording,
  setActiveSpeaker,
  setAudioLevel,
  setConnectionStatus,
  setError,
  setLastClinicianText,
  setLastPatientText,
  clearAudioState,
} = audioSlice.actions;

export default audioSlice.reducer;
