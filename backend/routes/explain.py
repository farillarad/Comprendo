import os
from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel
import anthropic

router = APIRouter()


class ExplainRequest(BaseModel):
    file_path: str
    workspace_path: str
    file_content: str


class ExplainResponse(BaseModel):
    summary: str
    connections: str
    key_components: str


@router.post("/explain", response_model=ExplainResponse)
def explain_file(
    request: ExplainRequest,
    x_api_key: str = Header(..., alias="X-API-Key")
):
    if not x_api_key:
        raise HTTPException(status_code=401, detail="Missing API key")

    relative_path = os.path.relpath(request.file_path, request.workspace_path)

    prompt = f"""You are a code explanation assistant. Analyze the following file from a software project and provide a structured explanation.

File: {relative_path}
Workspace: {request.workspace_path}

File contents:
```
{request.file_content[:12000]}
```

Respond with exactly three sections, each clearly labeled:

SUMMARY:
A concise plain-English explanation of what this file does and its purpose in the project (2-4 sentences).

CONNECTIONS:
How this file connects to and interacts with the rest of the codebase — what it imports, what likely imports it, and its role in the overall architecture (2-4 sentences).

KEY_COMPONENTS:
A bullet-point list of the most important functions, classes, or exports in this file with a one-line description of each. Format each as "- name: description"."""

    try:
        client = anthropic.Anthropic(api_key=x_api_key)
        message = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=1024,
            messages=[{"role": "user", "content": prompt}]
        )
        text = message.content[0].text
    except anthropic.AuthenticationError:
        raise HTTPException(status_code=401, detail="Invalid Claude API key")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    summary = _extract_section(text, "SUMMARY:")
    connections = _extract_section(text, "CONNECTIONS:")
    key_components = _extract_section(text, "KEY_COMPONENTS:")

    return ExplainResponse(
        summary=summary,
        connections=connections,
        key_components=key_components
    )


def _extract_section(text: str, header: str) -> str:
    headers = ["SUMMARY:", "CONNECTIONS:", "KEY_COMPONENTS:"]
    start = text.find(header)
    if start == -1:
        return ""
    start += len(header)
    end = len(text)
    for h in headers:
        if h != header:
            idx = text.find(h, start)
            if idx != -1 and idx < end:
                end = idx
    return text[start:end].strip()
