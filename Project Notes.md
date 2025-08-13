# Project Notes

NOTES:

* Language can potentially be any language
* English and Spanish are likely the most common in many areas, and a focus on this is explicitly stated in the document

* Speech-based. NOT text-based. We may / likely want transcriptions (although this may be a plus rather than a requirement)

* Need to discern between English-speaking clinician and Spanish-speaking patient.

* Does this mean we want to transcribe / listen to the entire conversation and know when to translate between English and Spanish and vice versa?

* Special inputs - repeat that. Someone isn't likely going to say "Repeat that" exactly. (This is a constraint that we MAY end up needing to rely on, but ideally "Repeat that please", "I don't understand." "Can you rephrase?" will all be successfully interpreted as a "Repeat that" request)

* Summary at the end of the conversation - so we for sure probably want transcripts. (And I believe there is an OpenAI API to do both voice and transcribe at the same time.)

## FOLLOW-UP ACTIONS:

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
* As far as router use goes - what screens? features? functionality will require that?

# DELIVERABLES / DESIGN

* Speech to text instead of text to speech? We're talking, not typing.

* Both sides of the conversation - should probably be in both English AND Spanish so the patient feels comfortable and confident. The doctor needs to know that what is being said is correct as well.

* (I'm not 100% sure how easy it is to get the translations to come back from OpenAI in both English and Spanish, while only using the appropriate translated language for voice. Will need to explore that.)

* Maybe a small workflow or notifications to confirm follow-up appointments, lab order requests, and when information has been requested to be repeated or rephrased.

* Mock tool use (or fleshing it out further if time constraints permit) using webhook.site

* One other potential feature? Webcam access for scanning QR or barcodes that could be on a doctor's name badge or keycard in order to authorize lab orders, appointment bookings, etc.

-------------

