# Review Notes 2

## Session
After some debugging, Custor stabilized the WebRTC connection.

Now I am observing a few issues:

1) Sometimes when I speak English, I get a voice response back in English instead of Spanish. When I speak Spanish, I should get a voice back in English. Can system instructions not restrict this?

2) The AI is not responding strictly with translations. The system instructions need to demand that it responds only with translations and nothing but as direct of a translation as possible.

3) The voices are overlapping sometimes. I had thought the Realtime API would not have this issue, but we may need to disable recording while a voice is playing back.

4) The text transcriptions aren't appearing.

5) Ending a session doesn't seem to properly disconnect the WebRTC connection. Talking still produces a voice response. I suspect multiple sessions are being created unintentionally instead of a single unified session.