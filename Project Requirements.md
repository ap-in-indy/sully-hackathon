# Project Requirements

NOTES:

[Hackathon Project] Interpreter End-to-End Proof-of-Concept
Problem:
Non-english speaking patients are unable to communicate with clinicians who cannot speak the patients’
language. Providers are required to hire in-person or virtual interpreters.
Goals:
Build a web-based Language Interpreter agent designed for an in-person visit that can:
●
interpret between the clinician (English-speaking) and the patient (Spanish-speaking), using speech
input and output
●
support special inputs such as the patient saying “repeat that”
, which should repeat the doctor’s
previous sentence.
●
At the end of the conversation, provide a summary of the conversation along with these actions if
detected during the conversation: schedule followup appointment, send lab order.
●
Add and use tools to execute the actions (use https://webhook.site/ to simulate calling an action)
●
Store the full conversation and the summary in a database
NOTE: Utilize AI coding tools to develop the proof-of-concept if possible (Copilot or Cursor or similar)
Stack:
Use the following stack:
●
Use OpenAI Realtime API (WebRTC or Websockets) as the core engine for the Interpreter
●
ReactJS frontend: Use ReactJS in a principled manner:
○
Use of state management solution (e.g. redux)
○
Use of React routers
○
Design reusable React components
●
Node or Python server
●
Pick your own database
●
Host on GCP/Vercel (or your choice of hosting solution)
Deliverables:
> Document the list of features you chose to build and why: provide product rationale
> Proof-of-concept: A functional prototype that enables communication between English and Spanish
●
A feature complete UI
●
Text-to-speech output for each utterance
●
Display both sides of the conversation in English
●
Display summary of the conversation
●
Store the conversation and the summary in a database
●
Display recognized intents/actions (listed above under Goals) along with their metadata
●
Execute actions using tools (use https://webhook.site/)
> Technical Design Doc that captures your thought process
Resources:
●
OpenAI APIs
●
What are Tools?