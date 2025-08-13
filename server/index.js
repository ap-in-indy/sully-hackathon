const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const WebSocket = require('ws');
const { PrismaClient } = require('@prisma/client');
const OpenAI = require('openai');
const multer = require('multer');
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

// Split pipeline endpoints for robust translation
// Step 1: ASR (Speech-to-Text)
const upload = multer({ storage: multer.memoryStorage() });

app.post('/api/asr', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file provided' });
    }

    // Create a file-like object for OpenAI
    const file = new File([req.file.buffer], 'audio.webm', { type: req.file.mimetype });

    // Whisper transcription (auto language)
    const t = await openai.audio.transcriptions.create({
      file,
      model: "whisper-1",
      // optional: "translate": true if you want EN only, but here we just transcribe
    });

    // t.text is the transcript. Some SDKs also expose detected_language.
    res.json({ transcript: t.text });
  } catch (error) {
    console.error('Error in ASR:', error);
    res.status(500).json({ error: 'Failed to transcribe audio' });
  }
});

// Step 2: Translation with structured JSON output
app.post('/api/translate', async (req, res) => {
  try {
    const { transcript, original_speaker, target_speaker } = req.body;

    const translationSchema = {
      name: "MedicalInterpreterTurn",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          language: { type: "string", enum: ["en", "es"] },
          translation: { type: "string" },
          original_speaker: { type: "string", enum: ["clinician", "patient"] },
          target_speaker: { type: "string", enum: ["clinician", "patient"] }
        },
        required: ["language", "translation", "original_speaker", "target_speaker"]
      },
      strict: true
    };

    const r = await openai.responses.create({
      model: "gpt-4o-mini", // supports Structured Outputs
      response_format: { type: "json_schema", json_schema: translationSchema },
      input: [
        {
          role: "system",
          content:
            "You are a medical interpreter. Translate exactly and preserve tone. No meta talk."
        },
        {
          role: "user",
          content: [
            { type: "text", text: `Original speaker: ${original_speaker}` },
            { type: "text", text: `Target speaker: ${target_speaker}` },
            { type: "text", text: `Source text:\n${transcript}` }
          ]
        }
      ]
    });

    // r.output[0].content[0].text may vary by SDK; the SDK also exposes r.output_text
    const json = JSON.parse(r.output_text);
    res.json(json);
  } catch (error) {
    console.error('Error in translation:', error);
    res.status(500).json({ error: 'Failed to translate text' });
  }
});

// Step 3: TTS (Text-to-Speech)
app.post('/api/tts', async (req, res) => {
  try {
    const { text } = req.body;

    const speech = await openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice: "alloy",          // pick a voice
      input: text,             // the translated sentence
      format: "wav"            // or "mp3", "opus"
    });

    const buf = Buffer.from(await speech.arrayBuffer());
    res.set('Content-Type', 'audio/wav');
    res.send(buf);
  } catch (error) {
    console.error('Error in TTS:', error);
    res.status(500).json({ error: 'Failed to generate speech' });
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
