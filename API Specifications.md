# API Specifications:

OpenAI Realtime API
Beta
Build low-latency, multi-modal experiences with the Realtime API.
The OpenAI Realtime API enables low-latency, multimodal interactions including speech-to-speech conversational experiences and real-time transcription.

This API works with natively multimodal models such as GPT-4o and GPT-4o mini, offering capabilities such as real-time text and audio processing, function calling, and speech generation, and with the latest transcription models GPT-4o Transcribe and GPT-4o mini Transcribe.

Get started with the Realtime API
Just getting started with Realtime? Try the new Agents SDK for TypeScript, optimized for building voice agents with Realtime models.

You can connect to the Realtime API in two ways:

Using WebRTC, which is ideal for client-side applications (for example, a web app)
Using WebSockets, which is great for server-to-server applications (from your backend or if you're building a voice agent over phone for example)
Start by exploring examples and partner integrations below, or learn how to connect to the Realtime API using the most relevant method for your use case below.

Example applications
Check out one of the example applications below to see the Realtime API in action.

Realtime Console
To get started quickly, download and configure the Realtime console demo. See events flowing back and forth, and inspect their contents. Learn how to execute custom logic with function calling.

Realtime Solar System demo
A demo of the Realtime API with the WebRTC integration, navigating the solar system through voice thanks to function calling.

Twilio Integration Demo
A demo combining the Realtime API with Twilio to build an AI calling assistant.

Realtime API Agents Demo
A demonstration of handoffs between Realtime API voice agents with reasoning model validation.

Partner integrations
Check out these partner integrations, which use the Realtime API in frontend applications and telephony use cases.

LiveKit integration guide
How to use the Realtime API with LiveKit's WebRTC infrastructure.

Twilio integration guide
Build Realtime apps using Twilio's powerful voice APIs.

Agora integration quickstart
How to integrate Agora's real-time audio communication capabilities with the Realtime API.

Pipecat integration guide
Create voice agents with OpenAI audio models and Pipecat orchestration framework.

Stream integration guide
Learn how to deploy voice agents in mobile and web applications using Stream's global edge network.

Client-side tool calling
Built with Cloudflare Workers, an example application showcasing client-side tool calling. Also check out the tutorial on YouTube.

Use cases
The most common use case for the Realtime API is to build a real-time, speech-to-speech, conversational experience. This is great for building voice agents and other voice-enabled applications.

The Realtime API can also be used independently for transcription and turn detection use cases. A client can stream audio in and have Realtime API produce streaming transcripts when speech is detected.

Both use-cases benefit from built-in voice activity detection (VAD) to automatically detect when a user is done speaking. This can be helpful to seamlessly handle conversation turns, or to analyze transcriptions one phrase at a time.

Learn more about these use cases in the dedicated guides.

Realtime Speech-to-Speech
Learn to use the Realtime API for streaming speech-to-speech conversations.

Realtime Transcription
Learn to use the Realtime API for transcription-only use cases.

Depending on your use case (conversation or transcription), you should initialize a session in different ways. Use the switcher below to see the details for each case.

Connect with WebRTC
WebRTC is a powerful set of standard interfaces for building real-time applications. The OpenAI Realtime API supports connecting to realtime models through a WebRTC peer connection. Follow this guide to learn how to configure a WebRTC connection to the Realtime API.

Overview
In scenarios where you would like to connect to a Realtime model from an insecure client over the network (like a web browser), we recommend using the WebRTC connection method. WebRTC is better equipped to handle variable connection states, and provides a number of convenient APIs for capturing user audio inputs and playing remote audio streams from the model.

Connecting to the Realtime API from the browser should be done with an ephemeral API key, generated via the OpenAI REST API. The process for initializing a WebRTC connection is as follows (assuming a web browser client):

A browser makes a request to a developer-controlled server to mint an ephemeral API key.
The developer's server uses a standard API key to request an ephemeral key from the OpenAI REST API, and returns that new key to the browser. Note that ephemeral keys currently expire one minute after being issued.
The browser uses the ephemeral key to authenticate a session directly with the OpenAI Realtime API as a WebRTC peer connection.
connect to realtime via WebRTC

While it is technically possible to use a standard API key to authenticate client-side WebRTC sessions, this is a dangerous and insecure practice because it leaks your secret key. Standard API keys grant access to your full OpenAI API account, and should only be used in secure server-side environments. We recommend ephemeral keys in client-side applications whenever possible.

Connection details
Connecting via WebRTC requires the following connection information:

URL	
https://api.openai.com/v1/realtime

Query Parameters	
model

Realtime model ID to connect to, like gpt-4o-realtime-preview-2025-06-03

Headers	
Authorization: Bearer EPHEMERAL_KEY

Substitute EPHEMERAL_KEY with an ephemeral API token - see below for details on how to generate one.

The following example shows how to initialize a WebRTC session (including the data channel to send and receive Realtime API events). It assumes you have already fetched an ephemeral API token (example server code for this can be found in the next section).

async function init() {
  // Get an ephemeral key from your server - see server code below
  const tokenResponse = await fetch("/session");
  const data = await tokenResponse.json();
  const EPHEMERAL_KEY = data.client_secret.value;

  // Create a peer connection
  const pc = new RTCPeerConnection();

  // Set up to play remote audio from the model
  const audioEl = document.createElement("audio");
  audioEl.autoplay = true;
  pc.ontrack = e => audioEl.srcObject = e.streams[0];

  // Add local audio track for microphone input in the browser
  const ms = await navigator.mediaDevices.getUserMedia({
    audio: true
  });
  pc.addTrack(ms.getTracks()[0]);

  // Set up data channel for sending and receiving events
  const dc = pc.createDataChannel("oai-events");
  dc.addEventListener("message", (e) => {
    // Realtime server events appear here!
    console.log(e);
  });

  // Start the session using the Session Description Protocol (SDP)
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  const baseUrl = "https://api.openai.com/v1/realtime";
  const model = "gpt-4o-realtime-preview-2025-06-03";
  const sdpResponse = await fetch(`${baseUrl}?model=${model}`, {
    method: "POST",
    body: offer.sdp,
    headers: {
      Authorization: `Bearer ${EPHEMERAL_KEY}`,
      "Content-Type": "application/sdp"
    },
  });

  const answer = {
    type: "answer",
    sdp: await sdpResponse.text(),
  };
  await pc.setRemoteDescription(answer);
}

init();
The WebRTC APIs provide rich controls for handling media streams and input devices. For more guidance on building user interfaces on top of WebRTC, refer to the docs on MDN.

Creating an ephemeral token
To create an ephemeral token to use on the client-side, you will need to build a small server-side application (or integrate with an existing one) to make an OpenAI REST API request for an ephemeral key. You will use a standard API key to authenticate this request on your backend server.

Below is an example of a simple Node.js express server which mints an ephemeral API key using the REST API:

import express from "express";

const app = express();

// An endpoint which would work with the client code above - it returns
// the contents of a REST API request to this protected endpoint
app.get("/session", async (req, res) => {
  const r = await fetch("https://api.openai.com/v1/realtime/sessions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-realtime-preview-2025-06-03",
      voice: "verse",
    }),
  });
  const data = await r.json();

  // Send back the JSON we received from the OpenAI REST API
  res.send(data);
});

app.listen(3000);
You can create a server endpoint like this one on any platform that can send and receive HTTP requests. Just ensure that you only use standard OpenAI API keys on the server, not in the browser.

Sending and receiving events
To learn how to send and receive events over the WebRTC data channel, refer to the Realtime conversations guide.

Connect with WebSockets
WebSockets are a broadly supported API for realtime data transfer, and a great choice for connecting to the OpenAI Realtime API in server-to-server applications. For browser and mobile clients, we recommend connecting via WebRTC.

Overview
In a server-to-server integration with Realtime, your backend system will connect via WebSocket directly to the Realtime API. You can use a standard API key to authenticate this connection, since the token will only be available on your secure backend server.

connect directly to realtime API

WebSocket connections can also be authenticated with an ephemeral client token (as shown above in the WebRTC section) if you choose to connect to the Realtime API via WebSocket on a client device.


Standard OpenAI API tokens should only be used in secure server-side environments.

Connection details
Speech-to-Speech
Transcription
Connecting via WebSocket requires the following connection information:

URL	
wss://api.openai.com/v1/realtime

Query Parameters	
model

Realtime model ID to connect to, like gpt-4o-realtime-preview-2025-06-03

Headers	
Authorization: Bearer YOUR_API_KEY

Substitute YOUR_API_KEY with a standard API key on the server, or an ephemeral token on insecure clients (note that WebRTC is recommended for this use case).

OpenAI-Beta: realtime=v1

This header is required during the beta period.

Below are several examples of using these connection details to initialize a WebSocket connection to the Realtime API.

ws module (Node.js)
websocket-client (Python)
WebSocket (browsers)
Connect with standard WebSocket (browsers)
/*
Note that in client-side environments like web browsers, we recommend
using WebRTC instead. It is possible, however, to use the standard 
WebSocket interface in browser-like environments like Deno and 
Cloudflare Workers.
*/

const ws = new WebSocket(
  "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17",
  [
    "realtime",
    // Auth
    "openai-insecure-api-key." + OPENAI_API_KEY, 
    // Optional
    "openai-organization." + OPENAI_ORG_ID,
    "openai-project." + OPENAI_PROJECT_ID,
    // Beta protocol, required
    "openai-beta.realtime-v1"
  ]
);

ws.on("open", function open() {
  console.log("Connected to server.");
});

ws.on("message", function incoming(message) {
  console.log(message.data);
});
Sending and receiving events
To learn how to send and receive events over Websockets, refer to the Realtime conversations guide.




