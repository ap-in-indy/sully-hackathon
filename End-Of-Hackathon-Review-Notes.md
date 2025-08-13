# End of Hackathon Review Notes

## Where things stand:

Branch as of end of 4-hour hackathon limit: feature/better-real-time-translations

**Issue: Detection between clinician and patient speaking is not working properly at this time.**

I was aiming for a purely passive agent running in the background, without the need for "push to speak" or anything like that. Will need further experimentation to see if detecting English vs Spanish responses is easy. Due to the JSON responses that also come with OpenAI responses, I should be able to detect this by asking (or further checking) OpenAI's response to provide the response language and parsing that out.

STATUS: Partially resolved. Still coming back with [EN] / [ES] brackets in order to resolve it, and those are being pronounced. Trying to resolve this.

**Issue: Steerability of the voice model.**

I am actively researching this, but I have made multiple separate attempts to have the voice models START OFF as translators. They do not seem to want to do this.

Currently, you have to tell the model to "be a bilingual translator from this point moving forward" and then it works correctly.

The alternative would be a push to speak form of interaction, which while a relatively clean UI solution, is a poor UX. We want passive, or as passive as possible at least.

Much easier for a doctor to enter a room, hit a button once, and say those words than a constant push to speak back and forth between doctor and patient.

STATUS: This seems to be fully resolved.

**Issue: Only English/Spanish.**

Hardcoded. Since the system instructions aren't working at this time, and you have to tell the application to be a translator, I believe it should be possible to translate to / from any supported language in theory. Even easier if you always assume the base physician language is English.

**Issue: Various UI/UX issues.**

Too much time was spent simply getting the WebRTC to properly work to address all UI/UX concerns. There are probably a lot of them, so not worth listing all individually.