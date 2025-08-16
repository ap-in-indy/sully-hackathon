```mermaid
flowchart LR
  subgraph Browser["Client Browser React TS Redux"]
    C["App and Pages"]
    RS["RealtimeService WebRTC"]
    Store["Redux Store"]
    AudioIO["Mic and Speakers"]
  end

  subgraph Server["Server Node Express Prisma"]
    API["REST API"]
    ORM["Prisma ORM"]
  end

  DB["SQLite Database"]
  OpenAISvc["OpenAI Realtime API"]
  WebhookSvc["webhook site"]

  C --> Store
  C --> API
  API --> C

  C --> API
  API --> OpenAISvc

  RS --> OpenAISvc
  OpenAISvc --> RS

  C --> API
  API --> WebhookSvc
  API --> ORM
  ORM --> DB

  AudioIO --> RS
  RS --> AudioIO
  RS --> Store
```mermaid