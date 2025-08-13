const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const WebSocket = require('ws');
const { PrismaClient } = require('@prisma/client');
const OpenAI = require('openai');
require('dotenv').config();

const app = express();
const server = require('http').createServer(app);
const wss = new WebSocket.Server({ server });

const prisma = new PrismaClient();
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use(limiter);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Generate ephemeral token for OpenAI Realtime API
app.post('/api/token', async (req, res) => {
  try {
    const response = await openai.beta.realtime.sessions.create({
      model: "gpt-4o-realtime-preview-2025-06-03",
      voice: "alloy",
    });
    
    res.json(response);
  } catch (error) {
    console.error('Error creating ephemeral token:', error);
    res.status(500).json({ error: 'Failed to create token' });
  }
});

// Create new encounter/session
app.post('/api/encounters', async (req, res) => {
  try {
    const { patient_id, clinician_id } = req.body;
    
    const encounter = await prisma.encounter.create({
      data: {
        patient_id,
        clinician_id,
        started_at: new Date(),
        status: 'active'
      }
    });
    
    res.json(encounter);
  } catch (error) {
    console.error('Error creating encounter:', error);
    res.status(500).json({ error: 'Failed to create encounter' });
  }
});

// Add transcript line
app.post('/api/encounters/:id/line', async (req, res) => {
  try {
    const { id } = req.params;
    const { speaker, lang, text, en_text, es_text } = req.body;
    
    const line = await prisma.transcriptLine.create({
      data: {
        encounter_id: id,
        speaker,
        lang,
        text,
        en_text,
        es_text,
        timestamp: new Date()
      }
    });
    
    res.json(line);
  } catch (error) {
    console.error('Error adding transcript line:', error);
    res.status(500).json({ error: 'Failed to add transcript line' });
  }
});

// End encounter and generate summary
app.post('/api/encounters/:id/end', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Get all transcript lines for this encounter
    const lines = await prisma.transcriptLine.findMany({
      where: { encounter_id: id },
      orderBy: { timestamp: 'asc' }
    });
    
    // Generate summary using OpenAI
    const transcript = lines.map(line => 
      `${line.speaker} (${line.lang}): ${line.text}`
    ).join('\n');
    
    const summaryResponse = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "You are a medical assistant. Create a concise summary of this medical encounter, highlighting key symptoms, diagnoses, treatments, and follow-up actions. Focus on medical accuracy and patient safety."
        },
        {
          role: "user",
          content: transcript
        }
      ]
    });
    
    const summary = summaryResponse.choices[0].message.content;
    
    // Update encounter
    const encounter = await prisma.encounter.update({
      where: { id },
      data: {
        ended_at: new Date(),
        status: 'completed',
        summary: summary
      }
    });
    
    res.json({ encounter, summary });
  } catch (error) {
    console.error('Error ending encounter:', error);
    res.status(500).json({ error: 'Failed to end encounter' });
  }
});

// Tool endpoints for follow-up actions
app.post('/api/tool/schedule_follow_up', async (req, res) => {
  try {
    const { patient_id, date_iso, notes } = req.body;
    
    // Log the action
    const action = await prisma.intent.create({
      data: {
        encounter_id: req.body.encounter_id,
        actor: 'clinician',
        name: 'schedule_follow_up',
        args: { patient_id, date_iso, notes },
        status: 'pending'
      }
    });
    
    // Forward to webhook.site for demo purposes
    const webhookResponse = await fetch('https://webhook.site/your-unique-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ patient_id, date_iso, notes })
    });
    
    const webhookResult = await webhookResponse.json();
    
    // Update action status
    await prisma.intent.update({
      where: { id: action.id },
      data: {
        status: 'completed',
        webhook_response: webhookResult
      }
    });
    
    res.json({ success: true, action_id: action.id });
  } catch (error) {
    console.error('Error scheduling follow-up:', error);
    res.status(500).json({ error: 'Failed to schedule follow-up' });
  }
});

app.post('/api/tool/send_lab_order', async (req, res) => {
  try {
    const { patient_id, test_code, priority } = req.body;
    
    // Log the action
    const action = await prisma.intent.create({
      data: {
        encounter_id: req.body.encounter_id,
        actor: 'clinician',
        name: 'send_lab_order',
        args: { patient_id, test_code, priority },
        status: 'pending'
      }
    });
    
    // Forward to webhook.site for demo purposes
    const webhookResponse = await fetch('https://webhook.site/your-unique-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ patient_id, test_code, priority })
    });
    
    const webhookResult = await webhookResponse.json();
    
    // Update action status
    await prisma.intent.update({
      where: { id: action.id },
      data: {
        status: 'completed',
        webhook_response: webhookResult
      }
    });
    
    res.json({ success: true, action_id: action.id });
  } catch (error) {
    console.error('Error sending lab order:', error);
    res.status(500).json({ error: 'Failed to send lab order' });
  }
});

// WebSocket connection handling
wss.on('connection', (ws) => {
  console.log('New WebSocket connection');
  
  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);
      
      // Handle different message types
      switch (data.type) {
        case 'transcript':
          // Store transcript line
          await prisma.transcriptLine.create({
            data: {
              encounter_id: data.encounter_id,
              speaker: data.speaker,
              lang: data.lang,
              text: data.text,
              en_text: data.en_text,
              es_text: data.es_text,
              timestamp: new Date()
            }
          });
          break;
          
        case 'intent':
          // Store intent
          await prisma.intent.create({
            data: {
              encounter_id: data.encounter_id,
              actor: data.actor,
              name: data.name,
              args: data.args,
              status: 'detected'
            }
          });
          break;
      }
      
      // Broadcast to all connected clients
      wss.clients.forEach((client) => {
        if (client !== ws && client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify(data));
        }
      });
      
    } catch (error) {
      console.error('Error handling WebSocket message:', error);
    }
  });
  
  ws.on('close', () => {
    console.log('WebSocket connection closed');
  });
});

const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully');
  await prisma.$disconnect();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
