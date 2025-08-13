import { configureStore } from '@reduxjs/toolkit';
import sessionReducer from './slices/sessionSlice';
import audioReducer from './slices/audioSlice';
import uiReducer from './slices/uiSlice';

export const store = configureStore({
  reducer: {
    session: sessionReducer,
    audio: audioReducer,
    ui: uiReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
