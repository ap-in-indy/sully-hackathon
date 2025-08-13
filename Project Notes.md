# Project Notes

NOTES:

* Language can potentially be any language
* English and Spanish are likely the most common in many areas, and a focus on this is explicitly stated in the document

* Speech-based. NOT text-based. We may / likely want transcriptions (although this may be a plus rather than a requirement)

* Need to discern between English-speaking clinician and Spanish-speaking patient.

* Does this mean we want to transcribe / listen to the entire conversation and know when to translate between English and Spanish and vice versa?

* Special inputs - repeat that. Someone isn't likely going to say "Repeat that" exactly. (This is a constraint that we MAY end up needing to rely on, but ideally "Repeat that please", "I don't understand." "Can you rephrase?" will all be successfully interpreted as a "Repeat that" request)

* Summary at the end of the conversation - so we for sure probably want transcripts. (And I believe there is an OpenAI API to do both voice and transcribe at the same time.)

## Follow-up Actions

* Schedule followup appointment
* Send lab order

IF DETECTED DURING THE CONVERSATION.

CONSIDER LOCKING LAB ORDER WITH A SHORT CODE???

How do we make sure the patient isn't submitting a lab order?

## Other requirements

* Tools for actions
* Conversation summary in a database (firebase or MySQL?) See whatever is cheap or free tier on Google Cloud Platform

## Stack notes

* I would prefer to just use React Hooks if possible
* WebRTC or Websockets - no real preference here. Whichever has the least friction and greatest support and immediate capabilities in a NodeJS server at the moment.
* As far as router use goes - what screens? features? functionality will require that?
* Database - firebase or whatever is cheap and easy (MySQL)
* Going with Node for more rapid prototyping

# Deliverables / Design Requirements Notes

* Speech to text instead of text to speech? We're talking, not typing.

* Both sides of the conversation - should probably be in both English AND Spanish so the patient feels comfortable and confident. The doctor needs to know that what is being said is correct as well.

* (I'm not 100% sure how easy it is to get the translations to come back from OpenAI in both English and Spanish, while only using the appropriate translated language for voice. Will need to explore that.)

* Maybe a small workflow or notifications to confirm follow-up appointments, lab order requests, and when information has been requested to be repeated or rephrased.

* Mock tool use (or fleshing it out further if time constraints permit) using webhook.site

* One other potential feature? Webcam access for scanning QR or barcodes that could be on a doctor's name badge or keycard in order to authorize lab orders, appointment bookings, etc.

# Value proposition / Business Case

Really the first thing ot think about in any project is the big "why?"

## Pain points of human translators

* Scheduling - hard to find and schedule translators
* Cost - human translators will come at a high cost
* Reliability - human translators may not always be readily staffed and available
* Transparency - human translators may not be able to rapidly transcribe their conversations in real-time, causing a loss of information and historical integrity
* Privacy - not everyone may be comfortable with another human in the room with them talking about private medical concerns
* Underserved demographic - not every office can afford or make translators available all of the time. hiring may mandate then that people speak multiple languages to address patients from different backgrounds.

## The "why?"s for this app

* Cost savings of the AI vs human translators
* More immediate accessibility of AI-assisted translation versus scheduling of humans
* Portability and privacy of the AI versus a human translator
* Real-time transcriptions can alleviate concerns over lack of a record trail and mistranslations
* No human needed in the room. Some people may be more comfortable with telling a computer program their personal concerns rather than another human
* Broadly and vastly increases availability of higher quality confidence in medical care to these underserved demographics. Potentially expandable to other languages pending quality vetting of translation services between English and other languages.

# Intended Deliverables

**So that doctors can keep track of a patient's history over time:**
* Initial authorization / login? (Pin code, barcode scan) so that the system isn't open all of the time.
* Patient list, then drill-down to a patient's conversation / appointment history with that patient
* Within a conversation, reviewing it if it's a historical conversation / appointment

**The real-time creation and transcription of appointment conversations:**
* Starting transcription if it's a new conversation / appointment
* Real-time speech-to-text in Spanish and English so that both clinician and patient can vet and verify translations
* System instructions or some other reliable and easy way to ensure instructions from the clinician can be repeated
* Voice needs to go both ways for sure (Physician English --> Patient Spanish and vice versa)
* Transcription ideally both ways all of the time, but not strictly required. Only ENGLISH is strictly required. (Although I think there are some risks if transcriptions don't exist for both languages. What if the patient mis-speaks or the AI messes up?)

**Archiving of transcriptions:**
* Saving them to a database
* Being able to view historical transcriptions for a patient (see above)
* Ending an appointment / conversation to know what it's over

**Follow-up actions:**
* Schedule follow-up appointment and lab order - we may want a popup with a barcode scanner or qr code, or button + pin to verify this is coming from the clinician
* A success confirmation and inserting this information into the database. What patient, appointment, what lab order was made.

-------------

# Technical Specifications

## Tool contract:

schedule_follow_up: {patient_id, date_iso, notes}

send_lab_order: {patient_id, test_code, priority}

repeat_last: {} (no webhook, just playback)

Save these and their history to the database.

## Speech to text and translations

* We may need to implement a push to talk button akin to Google Translate if OpenAI's realtime API can't easily recognize who's speaking

## Stretch goals

* If abbreviations or uncommon terminology is used, highlight it and allow the patient to get an explanation of what it means. (Risky, as it could simply lead to more questions and physicians are very busy, but worth exploring)

* (How do we get patients more of what they want while not overburdening the physician any further?)

# Risks / Concerns

* How well does the Realtime API from OpenAI perform?
* Is overlapping audio, speech, etc. going to be a problem in practice?
* Is it going to know who is speaking between the clinician and patient?
* Can you ask the system instructions / ai persona to transcribe both in English and in Spanish for any text?

--------------------------------------------------------

4-Hour Hackathon scope cuts
Make these choices to finish:

Input routing: Push-to-talk A/B buttons. Skip diarization.

Languages: English <-> Spanish only.

Auth: single clinician PIN. Skip full user management.

Storage: SQLite via Prisma (Node) or Firestore Lite. Store text only, plus tool logs and summary.

Actions: implement both actions through webhook.site. No actual scheduling UI beyond a minimal modal for date and test code.

UI: 3 screens only.

Login (PIN)

Patient list (static list or create-on-the-fly)

Live session with split view: left is clinician, right is patient, center column is transcript, right rail is intents/actions.

Minimal technical design
Frontend (React + Redux + Router)

Routes:

/login

/patients

/session/:encounterId

Redux slices:

session: {encounterId, roleElevated, lastClinicianText, intents[], transcript[]}

audio: {isRecording, activeSpeaker}

Components:

TalkControls {Clinician mic button, Patient mic button, VU meter}

TranscriptList {lines with speaker, lang, original, english}

IntentPanel {recognized intents with status and confirm buttons}

SummaryCard {shows when end session is pressed}

WebRTC client to OpenAI Realtime. Token fetched from Node server. On partial/final transcripts, dispatch to store. On tool suggestions, render buttons.

Backend (Node)

Endpoints:

POST /token -> returns ephemeral token for client to connect to Realtime

POST /tool/schedule_follow_up -> forwards to webhook.site and persists result

POST /tool/send_lab_order -> same

POST /encounter -> create encounter

POST /encounter/:id/line -> append transcript line

POST /encounter/:id/summary -> save summary

DB schema (SQLite or Firestore):

encounters(id, patient_id, started_at, ended_at, summary_json)

transcript_lines(id, encounter_id, ts, speaker, lang, text, en_text, es_text)

intents(id, encounter_id, ts, actor, name, args_json, status, webhook_response_json)

LLM directives

System message:

You are a medical interpreter between an English speaking clinician and a Spanish speaking patient.

Always produce JSON events of shape {type: "transcript"|"intent", ...}.

Intents allowed: repeat_last, schedule_follow_up, send_lab_order.

Only infer schedule_follow_up or send_lab_order from clinician speech.

Treat phrases like "repeat that", "please repeat", "I did not understand", "otra vez", "repita por favor" as repeat_last when spoken by the patient.

For each user utterance, emit:

transcript: {speaker, lang, original_text, english_text, spanish_text}

optional intent: {name, args}

Keep a rolling memory of the last clinician utterance.

TTS choices

Pick one voice for Spanish output and one for English. Cache them.



Alternative Design:

Minimal architecture for speed
Frontend React

Pages with React Router:

“Sessions” list

“New visit”

“Active visit”

“Visit details”

State: Redux slices for session, messages, actions, ui.

Components: MicControls, TranscriptPane, ActionsPane, SummaryCard, ConsentBanner, ToolConfirmModal.

Realtime and server

Node server with a websocket that proxies to the OpenAI Realtime API or brokers WebRTC tokens.

Endpoints:

POST /sessions

POST /messages

POST /actions

POST /end_visit -> runs summarization and intent extraction

POST /tool/schedule_followup -> relays to webhook.site

POST /tool/send_lab_order -> relays to webhook.site

Mute loopback on TTS events.

Keep a per-session ring buffer for last English TTS and last Spanish TTS for instant repeat.

Database (pick Firestore or Postgres)

sessions: id, patient_id, clinician_id, started_at, ended_at, consent, status

messages: id, session_id, role, source_lang, text, translated_en, translated_es, timestamps

actions: id, session_id, type, status, payload_json, webhook_response_json, clinician_id, created_at

summaries: id, session_id, text_en, risks_flags, created_at

patients: id, display_name

clinicians: id, display_name, pin_hash