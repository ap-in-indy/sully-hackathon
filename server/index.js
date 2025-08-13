const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { PrismaClient } = require('@prisma/client');
const OpenAI = require('openai');
require('dotenv').config();

const app = express();

// Initialize Prisma client only if DATABASE_URL is available
let prisma = null;
if (process.env.DATABASE_URL) {
  try {
    prisma = new PrismaClient();
  } catch (error) {
    console.error('Failed to initialize Prisma:', error);
  }
}

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
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    database: !!prisma,
    openai: !!process.env.OPENAI_API_KEY
  });
});

// Favicon endpoint
app.get('/favicon.ico', (req, res) => {
  res.status(204).end(); // No content
});

// Generate ephemeral token for OpenAI Realtime API
app.post('/api/token', async (req, res) => {
  try {
    console.log('API Key available:', !!process.env.OPENAI_API_KEY);
    console.log('API Key length:', process.env.OPENAI_API_KEY ? process.env.OPENAI_API_KEY.length : 0);
    
    if (!process.env.OPENAI_API_KEY) {
      console.error('OpenAI API key not found in environment variables');
      return res.status(500).json({ error: 'OpenAI API key not configured' });
    }
    
    const response = await openai.beta.realtime.sessions.create({
      model: "gpt-4o-realtime-preview-2025-06-03",
      voice: "alloy",
    });
    
    console.log('Token created successfully');
    res.json(response);
  } catch (error) {
    console.error('Error creating ephemeral token:', error);
    console.error('Error details:', error.message);
    console.error('Error response:', error.response?.data);
    res.status(500).json({ 
      error: 'Failed to create token',
      details: error.message,
      response: error.response?.data
    });
  }
});

// Create new encounter/session
app.post('/api/encounters', async (req, res) => {
  try {
    if (!prisma) {
      return res.status(503).json({ error: 'Database not available' });
    }
    
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
    if (!prisma) {
      return res.status(503).json({ error: 'Database not available' });
    }
    
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
    if (!prisma) {
      return res.status(503).json({ error: 'Database not available' });
    }
    
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
        summary
      }
    });
    
    res.json(encounter);
  } catch (error) {
    console.error('Error ending encounter:', error);
    res.status(500).json({ error: 'Failed to end encounter' });
  }
});

// Get encounter details
app.get('/api/encounters/:id', async (req, res) => {
  try {
    if (!prisma) {
      return res.status(503).json({ error: 'Database not available' });
    }
    
    const { id } = req.params;
    
    const encounter = await prisma.encounter.findUnique({
      where: { id },
      include: {
        patient: true,
        clinician: true,
        transcript_lines: {
          orderBy: { timestamp: 'asc' }
        },
        intents: {
          orderBy: { created_at: 'asc' }
        }
      }
    });
    
    if (!encounter) {
      return res.status(404).json({ error: 'Encounter not found' });
    }
    
    res.json(encounter);
  } catch (error) {
    console.error('Error getting encounter:', error);
    res.status(500).json({ error: 'Failed to get encounter' });
  }
});

// Get all encounters
app.get('/api/encounters', async (req, res) => {
  try {
    if (!prisma) {
      return res.status(503).json({ error: 'Database not available' });
    }
    
    const encounters = await prisma.encounter.findMany({
      include: {
        patient: true,
        clinician: true
      },
      orderBy: { created_at: 'desc' }
    });
    
    res.json(encounters);
  } catch (error) {
    console.error('Error getting encounters:', error);
    res.status(500).json({ error: 'Failed to get encounters' });
  }
});

// Get all patients
app.get('/api/patients', async (req, res) => {
  try {
    if (!prisma) {
      return res.status(503).json({ error: 'Database not available' });
    }
    
    const patients = await prisma.patient.findMany({
      orderBy: { created_at: 'desc' }
    });
    
    res.json(patients);
  } catch (error) {
    console.error('Error getting patients:', error);
    res.status(500).json({ error: 'Failed to get patients' });
  }
});

// Create new patient
app.post('/api/patients', async (req, res) => {
  try {
    if (!prisma) {
      return res.status(503).json({ error: 'Database not available' });
    }
    
    const { name } = req.body;
    
    const patient = await prisma.patient.create({
      data: { name }
    });
    
    res.json(patient);
  } catch (error) {
    console.error('Error creating patient:', error);
    res.status(500).json({ error: 'Failed to create patient' });
  }
});

// Get all clinicians
app.get('/api/clinicians', async (req, res) => {
  try {
    if (!prisma) {
      return res.status(503).json({ error: 'Database not available' });
    }
    
    const clinicians = await prisma.clinician.findMany({
      orderBy: { created_at: 'desc' }
    });
    
    res.json(clinicians);
  } catch (error) {
    console.error('Error getting clinicians:', error);
    res.status(500).json({ error: 'Failed to get clinicians' });
  }
});

// Create new clinician
app.post('/api/clinicians', async (req, res) => {
  try {
    if (!prisma) {
      return res.status(503).json({ error: 'Database not available' });
    }
    
    const { name, pin } = req.body;
    const bcrypt = require('bcryptjs');
    const pin_hash = await bcrypt.hash(pin, 10);
    
    const clinician = await prisma.clinician.create({
      data: { name, pin_hash }
    });
    
    res.json(clinician);
  } catch (error) {
    console.error('Error creating clinician:', error);
    res.status(500).json({ error: 'Failed to create clinician' });
  }
});

// Authenticate clinician
app.post('/api/auth/clinician', async (req, res) => {
  try {
    if (!prisma) {
      return res.status(503).json({ error: 'Database not available' });
    }
    
    const { name, pin } = req.body;
    const bcrypt = require('bcryptjs');
    
    const clinician = await prisma.clinician.findFirst({
      where: { name }
    });
    
    if (!clinician) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const isValid = await bcrypt.compare(pin, clinician.pin_hash);
    
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const jwt = require('jsonwebtoken');
    const token = jwt.sign(
      { clinician_id: clinician.id, name: clinician.name },
      process.env.JWT_SECRET || 'fallback-secret',
      { expiresIn: '24h' }
    );
    
    res.json({ 
      token, 
      clinician: { 
        id: clinician.id, 
        name: clinician.name 
      } 
    });
  } catch (error) {
    console.error('Error authenticating clinician:', error);
    res.status(500).json({ error: 'Failed to authenticate' });
  }
});

// Send lab order webhook
app.post('/api/encounters/:id/lab-order', async (req, res) => {
  try {
    if (!prisma) {
      return res.status(503).json({ error: 'Database not available' });
    }
    
    const { id } = req.params;
    const { patient_id, test_code, priority } = req.body;
    
    // Create intent record
    const action = await prisma.intent.create({
      data: {
        encounter_id: id,
        actor: 'clinician',
        name: 'send_lab_order',
        args: JSON.stringify({ patient_id, test_code, priority }),
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

// Export the Express app for Vercel
module.exports = app;
