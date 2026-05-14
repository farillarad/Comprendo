import json
from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel
import anthropic

router = APIRouter()


class QuizGenerateRequest(BaseModel):
    file_path: str
    file_content: str
    explanation: str


class Question(BaseModel):
    id: int
    question: str


class QuizGenerateResponse(BaseModel):
    questions: list[Question]


class QuizScoreRequest(BaseModel):
    file_path: str
    question: str
    answer: str
    file_content: str


class QuizScoreResponse(BaseModel):
    correct: bool
    score: int
    feedback: str


@router.post("/quiz/generate", response_model=QuizGenerateResponse)
def generate_quiz(
    request: QuizGenerateRequest,
    x_api_key: str = Header(..., alias="X-API-Key")
):
    if not x_api_key:
        raise HTTPException(status_code=401, detail="Missing API key")

    prompt = f"""You are a programming tutor creating comprehension questions about a code file.

File: {request.file_path}

File explanation:
{request.explanation}

File contents (excerpt):
```
{request.file_content[:8000]}
```

Generate exactly 3 comprehension questions that test understanding of this file. Questions should range from basic (what does this do) to applied (why is it designed this way, how would you use it).

Respond with ONLY a JSON array, no other text:
[
  {{"id": 1, "question": "..."}},
  {{"id": 2, "question": "..."}},
  {{"id": 3, "question": "..."}}
]"""

    try:
        client = anthropic.Anthropic(api_key=x_api_key)
        message = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=512,
            messages=[{"role": "user", "content": prompt}]
        )
        text = message.content[0].text.strip()
        # Strip markdown code fences if present
        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
        questions_data = json.loads(text)
        questions = [Question(**q) for q in questions_data]
    except anthropic.AuthenticationError:
        raise HTTPException(status_code=401, detail="Invalid Claude API key")
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail="Failed to parse quiz response")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    return QuizGenerateResponse(questions=questions)


@router.post("/quiz/score", response_model=QuizScoreResponse)
def score_answer(
    request: QuizScoreRequest,
    x_api_key: str = Header(..., alias="X-API-Key")
):
    if not x_api_key:
        raise HTTPException(status_code=401, detail="Missing API key")

    prompt = f"""You are a programming tutor grading a student's answer about a code file.

File: {request.file_path}

File contents (excerpt):
```
{request.file_content[:6000]}
```

Question: {request.question}

Student's answer: {request.answer}

Evaluate the answer for correctness and understanding. Respond with ONLY a JSON object, no other text:
{{
  "correct": true or false,
  "score": a number from 0 to 100,
  "feedback": "Concise feedback explaining what was right/wrong and the correct answer if needed (2-3 sentences)"
}}"""

    try:
        client = anthropic.Anthropic(api_key=x_api_key)
        message = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=256,
            messages=[{"role": "user", "content": prompt}]
        )
        text = message.content[0].text.strip()
        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
        result = json.loads(text)
    except anthropic.AuthenticationError:
        raise HTTPException(status_code=401, detail="Invalid Claude API key")
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail="Failed to parse score response")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    return QuizScoreResponse(
        correct=result.get("correct", False),
        score=result.get("score", 0),
        feedback=result.get("feedback", "")
    )
