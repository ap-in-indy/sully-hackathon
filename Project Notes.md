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

