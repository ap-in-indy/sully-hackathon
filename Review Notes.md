# Review Notes

## Patient List
* Patient list is not really scalable beyond like 30 patients maybe. No one wants to have to scroll forever.
* Interface is fine for a small number of patients, though.
* Patient list should be sorted by appointment date and also offer name sorting. For example, patients whose appointments are today should be shown first. Maybe highlighted or in a different section.
* If that's challenging, just sort by name.

## Session
* Audio does not seem to be getting properly captured. I checked permissions. Audio permissions are available, but audio sound bars are not indicating any activity. There are console logs and some network activity, but it's very limited.

Error initializing realtime service: InvalidStateError: Failed to execute 'send' on 'RTCDataChannel': RTCDataChannel.readyState is not 'open'
    at RealtimeService.sendSystemMessage (realtimeService.ts:155:1)
    at RealtimeService.initialize (realtimeService.ts:121:1)
    at async initializeSession (SessionPage.tsx:51:1)
initialize @ realtimeService.ts:124
await in initialize
initializeSession @ SessionPage.tsx:51
(anonymous) @ SessionPage.tsx:32
commitHookEffectListMount @ react-dom.development.js:23189
invokePassiveEffectMountInDEV @ react-dom.development.js:25193
invokeEffectsInDev @ react-dom.development.js:27390
commitDoubleInvokeEffectsInDEV @ react-dom.development.js:27369
flushPassiveEffectsImpl @ react-dom.development.js:27095
flushPassiveEffects @ react-dom.development.js:27023
commitRootImpl @ react-dom.development.js:26974
commitRoot @ react-dom.development.js:26721
performSyncWorkOnRoot @ react-dom.development.js:26156
flushSyncCallbacks @ react-dom.development.js:12042
(anonymous) @ react-dom.development.js:25690Understand this error
realtimeService.ts:125 A non-serializable value was detected in the state, in the path: `ui.notifications.0.timestamp`. Value: Tue Aug 12 2025 23:52:23 GMT-0400 (Eastern Daylight Time) 
Take a look at the reducer(s) handling this action type: audio/setError.
(See https://redux.js.org/faq/organizing-state#can-i-put-functions-promises-or-other-non-serializable-items-in-my-store-state)

{"type":"warnings","data":[{"message":"[eslint] \nsrc/components/ActionsPanel.tsx\n  \u001b[1mLine 4:10:\u001b[22m  'updateIntentStatus' is defined but never used  \u001b[33m\u001b[4m@typescript-eslint/no-unused-vars\u001b[24m\u001b[39m\n\nsrc/pages/SessionPage.tsx\n  \u001b[1mLine 33:6:\u001b[22m   React Hook useEffect has missing dependencies: 'initializeSession' and 'navigate'. Either include them or remove the dependency array  \u001b[33m\u001b[4mreact-hooks/exhaustive-deps\u001b[24m\u001b[39m\n  \u001b[1mLine 88:17:\u001b[22m  'result' is assigned a value but never used                                                                                            \u001b[33m\u001b[4m@typescript-eslint/no-unused-vars\u001b[24m\u001b[39m\n\n"}]}

* End session should take you back to the main patients list