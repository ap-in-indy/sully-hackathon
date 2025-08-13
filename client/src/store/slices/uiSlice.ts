import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export interface UIState {
  isLoading: boolean;
  showToolModal: boolean;
  activeTool: 'schedule_follow_up' | 'send_lab_order' | null;
  notifications: Array<{
    id: string;
    type: 'success' | 'error' | 'warning' | 'info';
    message: string;
    timestamp: Date;
  }>;
  sidebarOpen: boolean;
}

const initialState: UIState = {
  isLoading: false,
  showToolModal: false,
  activeTool: null,
  notifications: [],
  sidebarOpen: false,
};

const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    setLoading: (state, action: PayloadAction<boolean>) => {
      state.isLoading = action.payload;
    },
    showToolModal: (state, action: PayloadAction<'schedule_follow_up' | 'send_lab_order'>) => {
      state.showToolModal = true;
      state.activeTool = action.payload;
    },
    hideToolModal: (state) => {
      state.showToolModal = false;
      state.activeTool = null;
    },
    addNotification: (state, action: PayloadAction<{ type: 'success' | 'error' | 'warning' | 'info'; message: string }>) => {
      state.notifications.push({
        id: Date.now().toString(),
        type: action.payload.type,
        message: action.payload.message,
        timestamp: new Date(),
      });
    },
    removeNotification: (state, action: PayloadAction<string>) => {
      state.notifications = state.notifications.filter(n => n.id !== action.payload);
    },
    clearNotifications: (state) => {
      state.notifications = [];
    },
    toggleSidebar: (state) => {
      state.sidebarOpen = !state.sidebarOpen;
    },
    setSidebarOpen: (state, action: PayloadAction<boolean>) => {
      state.sidebarOpen = action.payload;
    },
  },
});

export const {
  setLoading,
  showToolModal,
  hideToolModal,
  addNotification,
  removeNotification,
  clearNotifications,
  toggleSidebar,
  setSidebarOpen,
} = uiSlice.actions;

export default uiSlice.reducer;
