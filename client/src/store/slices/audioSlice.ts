import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export interface AudioState {
  error: string | null;
}

const initialState: AudioState = {
  error: null,
};

const audioSlice = createSlice({
  name: 'audio',
  initialState,
  reducers: {
    setError: (state, action: PayloadAction<string | null>) => {
      state.error = action.payload;
    },
    clearAudioState: (state) => {
      return initialState;
    },
  },
});

export const {
  setError,
  clearAudioState,
} = audioSlice.actions;

export default audioSlice.reducer;
