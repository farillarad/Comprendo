from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routes import tree, explain, quiz

app = FastAPI(title="Comprendo API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(tree.router)
app.include_router(explain.router)
app.include_router(quiz.router)


@app.get("/health")
def health():
    return {"status": "ok"}
