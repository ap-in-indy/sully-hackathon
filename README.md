# Sully Medical Translator

A real-time medical translation system that enables seamless communication between English-speaking clinicians and Spanish-speaking patients using OpenAI's Realtime API.

## 🎯 Project Overview

This application provides real-time voice translation during medical encounters, automatically detecting speech, translating between English and Spanish, and identifying medical actions like scheduling follow-ups and lab orders.

### Key Features

- **Real-time Voice Translation**: Passive streaming with automatic speech detection
- **Bidirectional Translation**: English ↔ Spanish with context awareness
- **Medical Intent Recognition**: Automatically detects medical actions
- **Live Transcript**: Real-time conversation logging with speaker identification
- **Action Management**: Handle follow-up appointments and lab orders
- **Responsive Design**: Works on desktop and mobile devices

## 🏗️ Architecture

### Backend (Node.js + Express)
- **Real-time Communication**: WebSocket server for live updates
- **OpenAI Integration**: Realtime API for voice processing and translation
- **Database**: SQLite with Prisma ORM for data persistence
- **Authentication**: Simple PIN-based clinician authentication
- **API Endpoints**: RESTful API for session management and actions

### Frontend (React + TypeScript)
- **State Management**: Redux Toolkit for application state
- **Real-time Updates**: WebSocket client for live communication
- **Voice Processing**: WebRTC integration with OpenAI Realtime API
- **Responsive UI**: Modern, medical-themed interface
- **Routing**: React Router for navigation

### Database Schema
- **Encounters**: Medical session records
- **Transcript Lines**: Conversation history with translations
- **Intents**: Detected medical actions and their status
- **Patients & Clinicians**: User management

## 🚀 Quick Start

### Prerequisites
- Node.js (v16 or higher)
- npm or yarn
- OpenAI API key with Realtime API access

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd sully-hackathon
   ```

2. **Install dependencies**
   ```bash
   npm run install-all
   ```

3. **Environment Setup**
   ```bash
   cp env.example .env
   ```
   
   Edit `.env` and add your OpenAI API key:
   ```env
   OPENAI_API_KEY=your_openai_api_key_here
   DATABASE_URL="file:./dev.db"
   ```

4. **Database Setup**
   ```bash
   npx prisma generate
   npx prisma db push
   ```

5. **Start Development Servers**
   ```bash
   npm run dev
   ```

   This starts both the backend (port 3001) and frontend (port 3000).

### Usage

1. **Login**: Use any 4-digit PIN for demo purposes
2. **Select Patient**: Choose from the mock patient list
3. **Start Session**: Begin real-time voice translation
4. **Speak Naturally**: The system automatically detects and translates speech
5. **Monitor Actions**: View detected medical intents in the actions panel

## 🔧 Technical Implementation

### Real-time Voice Communication

The system uses OpenAI's Realtime API with WebRTC for low-latency voice processing:

```typescript
// Initialize real-time connection
await realtimeService.initialize({
  encounterId: 'session-id',
  patientId: 'patient-id', 
  clinicianId: 'clinician-id'
});
```

### Speech Detection & Translation

- **Passive Streaming**: Continuous audio monitoring without push-to-talk
- **Speaker Identification**: Automatic detection of clinician vs patient
- **Context-Aware Translation**: Medical terminology preservation
- **Bidirectional Support**: English ↔ Spanish with cultural context

### Intent Recognition

The AI system detects medical actions from conversation:

- **Repeat Last**: Patient requests for clarification
- **Schedule Follow-up**: Clinician appointment scheduling
- **Send Lab Order**: Laboratory test ordering

### Data Flow

1. **Audio Input** → WebRTC → OpenAI Realtime API
2. **Speech Processing** → Transcription + Translation
3. **Intent Detection** → Action Classification
4. **Real-time Updates** → WebSocket → UI Components
5. **Data Persistence** → SQLite Database

## 📱 User Interface

### Session Layout
- **Left Panel**: Clinician audio controls and last utterance
- **Center Panel**: Live transcript with translations
- **Right Panel**: Patient audio controls and last utterance
- **Actions Panel**: Detected intents and manual controls

### Responsive Design
- **Desktop**: Full 3-column layout with floating actions panel
- **Tablet**: Adaptive layout with stacked panels
- **Mobile**: Single-column layout optimized for touch

## 🔒 Security & Privacy

- **Ephemeral Tokens**: Secure OpenAI API access
- **Local Storage**: Patient data stored locally
- **No Audio Recording**: Real-time processing only
- **HIPAA Considerations**: Designed for medical privacy compliance

## 🧪 Testing

### Manual Testing
1. **Voice Recognition**: Test speech detection accuracy
2. **Translation Quality**: Verify medical terminology preservation
3. **Intent Detection**: Validate action recognition
4. **Real-time Performance**: Check latency and responsiveness

### Demo Scenarios
- **Initial Consultation**: Patient symptoms and medical history
- **Treatment Discussion**: Medication and procedure explanations
- **Follow-up Planning**: Appointment scheduling and lab orders

## 🚧 Development Roadmap

### Phase 1 (Current)
- ✅ Basic real-time voice communication
- ✅ English-Spanish translation
- ✅ Intent detection and action management
- ✅ Responsive UI implementation

### Phase 2 (Future)
- 🔄 Multi-language support (beyond Spanish)
- 🔄 Advanced medical terminology handling
- 🔄 Integration with EHR systems
- 🔄 Mobile app development
- 🔄 Offline capability

### Phase 3 (Advanced)
- 🔄 AI-powered medical summaries
- 🔄 Voice biometrics for speaker identification
- 🔄 Real-time medical decision support
- 🔄 Integration with telemedicine platforms

## 🤝 Contributing

This is a hackathon project demonstrating real-time medical translation capabilities. For production use, additional security, compliance, and testing measures would be required.

## 📄 License

MIT License - see LICENSE file for details.

## 🙏 Acknowledgments

- OpenAI for the Realtime API
- Medical translation community
- Healthcare professionals for domain expertise
- React and Node.js communities

---

**Note**: This is a demonstration project. For production medical applications, ensure compliance with relevant healthcare regulations and security standards.