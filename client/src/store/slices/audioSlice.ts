import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export interface AudioState {
  isRecording: boolean;
  audioLevel: number;
  isConnected: boolean;
  error: string | null;
}

const initialState: AudioState = {
  isRecording: false,
  audioLevel: 0,
  isConnected: false,
  error: null,
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
    setAudioLevel: (state, action: PayloadAction<number>) => {
      state.audioLevel = action.payload;
    },
    setConnectionStatus: (state, action: PayloadAction<boolean>) => {
      state.isConnected = action.payload;
    },
    setError: (state, action: PayloadAction<string | null>) => {
      state.error = action.payload;
    },
    clearAudioState: (state) => {
      return initialState;
    },
  },
});

export const {
  startRecording,
  stopRecording,
  setAudioLevel,
  setConnectionStatus,
  setError,
  clearAudioState,
} = audioSlice.actions;

export default audioSlice.reducer;
