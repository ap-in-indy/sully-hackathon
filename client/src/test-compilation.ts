// Test file to check compilation
import { addNotification } from './store/slices/uiSlice';
import { startSession } from './store/slices/sessionSlice';

// Test that the actions can be imported
const testActions = {
  addNotification,
  startSession
};

export default testActions;
