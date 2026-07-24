# Interview Provider interface

The Interview Bridge treats interview execution as a replaceable provider. The bundled `browser-demo` implementation is intentionally small and dependency-free.

## Configuration

```dotenv
INTERVIEW_RUNTIME=browser-demo
INTERVIEW_BASE_URL=http://127.0.0.1:5174
INTERVIEW_PUBLIC_BASE_URL=http://127.0.0.1:5174
INTERVIEW_BRIDGE_PUBLIC_BASE_URL=http://127.0.0.1:5173
INTERVIEW_BRIDGE_CALLBACK_SECRET=replace-outside-local-demo
```

Use `INTERVIEW_RUNTIME=external` when a compatible service is deployed separately.

## Create a session

```http
POST /api/agent-sessions
Content-Type: application/json
```

```json
{
  "sessionId": "main-attempt-001",
  "projectSnapshot": {
    "source": {
      "system": "recruit-ai-platform",
      "applicationId": "application-001",
      "attemptId": "attempt-001",
      "jobId": "job-001",
      "candidateId": "candidate-001",
      "candidateName": "Synthetic Candidate"
    },
    "generation": {
      "questionCount": 3,
      "durationMinutes": 20
    },
    "interviewPolicy": {
      "maxFollowUpsPerQuestion": 1
    },
    "interviewPlan": {
      "title": "AI Application Engineer Interview",
      "questions": [
        {
          "id": "q1",
          "competency": "Project evidence",
          "prompt": "Describe one relevant project, your role, and its result."
        }
      ]
    }
  },
  "callback": {
    "statusCallbackUrl": "https://platform.example/api/interview-bridge/status-callback",
    "secret": "configured-out-of-band",
    "applicationId": "application-001",
    "attemptId": "attempt-001",
    "returnUrl": "https://platform.example/candidate"
  }
}
```

Response:

```json
{
  "session": {
    "id": "main-attempt-001",
    "status": "ready",
    "phase": "ready",
    "mode": "browser_demo",
    "questionBank": []
  },
  "entryUrl": "/?sessionId=main-attempt-001"
}
```

The response must never echo the callback secret.

## Read session state

```http
GET /api/agent-sessions/:sessionId
```

Session lifecycle:

```text
ready → in_progress → closed
```

The provider may expose more detailed phases, but the three lifecycle states above must remain mappable.

## Complete and report

When the session finishes, the provider posts:

```http
POST /api/interview-bridge/status-callback
Content-Type: application/json
x-interview-bridge-secret: configured-out-of-band
```

```json
{
  "status": "completed",
  "applicationId": "application-001",
  "attemptId": "attempt-001",
  "sessionId": "main-attempt-001",
  "sessionRef": "interview://browser-demo/main-attempt-001",
  "reportRef": "interview://browser-demo/main-attempt-001/report",
  "reportSummary": "Synthetic structured report summary.",
  "recommendation": "Human review recommended",
  "report": {
    "title": "Structured interview report",
    "summary": "Synthetic structured report summary.",
    "riskNotes": [
      "The report supports, but does not replace, human review."
    ],
    "questionReviews": []
  },
  "fullTrace": {
    "sessionId": "main-attempt-001",
    "questionCount": 3,
    "turnCount": 3,
    "turns": []
  }
}
```

## Pull fallback

The main platform can also poll `GET /api/agent-sessions/:sessionId`. If the session is `closed` but does not yet contain a report, it calls:

```http
POST /api/report
Content-Type: application/json

{"sessionId": "main-attempt-001", "background": true}
```

This pull path protects the workflow from a transient callback delivery failure. It is not a substitute for callback authentication or retry handling.

## Health

The provider implements:

```http
GET /healthz
```

```json
{
  "status": "ok",
  "runtime": "browser-demo",
  "provider": {
    "kind": "browser-demo",
    "ready": true
  }
}
```

Do not return API keys, callback secrets, private paths, or configured internal URLs.
