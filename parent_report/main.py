"""保護者向けAI分析レポート生成ツール - FastAPI backend."""
from __future__ import annotations

import io
import logging
import os
import uuid
from collections import Counter
from datetime import date, datetime
from pathlib import Path
from typing import Any

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from matplotlib import font_manager
from pydantic import BaseModel
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.pdfgen import canvas

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
TMP_DIR = BASE_DIR / "_tmp"
TMP_DIR.mkdir(exist_ok=True)

REQUIRED_COLUMNS = [
    "student_name",
    "parent_name",
    "grade",
    "eiken_level",
    "play_date",
    "play_minutes",
    "words_attempted",
    "words_correct",
    "sentences_spoken",
    "missions_completed",
    "weak_words",
]

# ReportLab: register a CID Japanese font (no external file needed).
pdfmetrics.registerFont(UnicodeCIDFont("HeiseiKakuGo-W5"))
JP_FONT = "HeiseiKakuGo-W5"

# matplotlib: pick a Japanese-capable font if present, else fall back silently.
_JP_FONT_CANDIDATES = [
    "Noto Sans CJK JP",
    "IPAexGothic",
    "IPAGothic",
    "TakaoGothic",
    "Hiragino Sans",
    "Yu Gothic",
    "Meiryo",
    "MS Gothic",
]
_available = {f.name for f in font_manager.fontManager.ttflist}
for _name in _JP_FONT_CANDIDATES:
    if _name in _available:
        plt.rcParams["font.family"] = _name
        break
plt.rcParams["axes.unicode_minus"] = False

# In-memory session store: session_id -> parsed DataFrame.
SESSIONS: dict[str, pd.DataFrame] = {}

app = FastAPI(title="保護者向けAI分析レポート生成ツール")
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


# ---------- models ----------
class StudentSummary(BaseModel):
    student_name: str
    parent_name: str
    grade: str
    eiken_level: str
    sessions: int
    total_minutes: int
    min_date: str
    max_date: str


class UploadResponse(BaseModel):
    session_id: str
    students: list[StudentSummary]


class GenerateRequest(BaseModel):
    session_id: str
    student_names: list[str]
    start_date: str | None = None
    end_date: str | None = None


# ---------- CSV parsing ----------
def parse_csv(raw: bytes) -> pd.DataFrame:
    # UTF-8 with optional BOM.
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError as e:
        raise HTTPException(status_code=400, detail=f"CSVはUTF-8で保存してください: {e}")

    try:
        df = pd.read_csv(io.StringIO(text))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"CSVの解析に失敗しました: {e}")

    missing = [c for c in REQUIRED_COLUMNS if c not in df.columns]
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"必要なカラムがありません: {', '.join(missing)}",
        )

    df["play_date"] = pd.to_datetime(df["play_date"], errors="coerce").dt.date
    if df["play_date"].isna().any():
        raise HTTPException(status_code=400, detail="play_date の形式が不正な行があります (YYYY-MM-DD)")

    for col in ["play_minutes", "words_attempted", "words_correct", "sentences_spoken", "missions_completed"]:
        df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0).astype(int)

    df["weak_words"] = df["weak_words"].fillna("").astype(str)
    df["student_name"] = df["student_name"].astype(str).str.strip()
    return df


def summarize_students(df: pd.DataFrame) -> list[StudentSummary]:
    out: list[StudentSummary] = []
    for name, g in df.groupby("student_name", sort=False):
        out.append(
            StudentSummary(
                student_name=name,
                parent_name=str(g["parent_name"].iloc[0]),
                grade=str(g["grade"].iloc[0]),
                eiken_level=str(g["eiken_level"].iloc[0]),
                sessions=len(g),
                total_minutes=int(g["play_minutes"].sum()),
                min_date=str(g["play_date"].min()),
                max_date=str(g["play_date"].max()),
            )
        )
    return out


# ---------- aggregation ----------
def filter_by_date(df: pd.DataFrame, start: date | None, end: date | None) -> pd.DataFrame:
    out = df
    if start is not None:
        out = out[out["play_date"] >= start]
    if end is not None:
        out = out[out["play_date"] <= end]
    return out.sort_values("play_date")


def aggregate_student(df_student: pd.DataFrame) -> dict[str, Any]:
    total_minutes = int(df_student["play_minutes"].sum())
    total_attempted = int(df_student["words_attempted"].sum())
    total_correct = int(df_student["words_correct"].sum())
    total_sentences = int(df_student["sentences_spoken"].sum())
    total_missions = int(df_student["missions_completed"].sum())
    accuracy = (total_correct / total_attempted * 100.0) if total_attempted > 0 else 0.0

    counter: Counter[str] = Counter()
    for s in df_student["weak_words"]:
        for w in (w.strip() for w in s.split(",") if w.strip()):
            counter[w] += 1
    top_weak = [w for w, _ in counter.most_common(3)]

    return {
        "sessions": len(df_student),
        "total_minutes": total_minutes,
        "total_attempted": total_attempted,
        "total_correct": total_correct,
        "total_sentences": total_sentences,
        "total_missions": total_missions,
        "accuracy": accuracy,
        "top_weak": top_weak,
        "all_weak_counts": counter,
    }


# ---------- AI comment ----------
SYSTEM_PROMPT = """あなたは子ども英語教室のカスタマーサクセス担当です。
生徒の学習データをもとに、保護者への温かみのある報告コメントを日本語で書いてください。

ルール：
- 150〜200文字
- 具体的な数字を必ず1つ入れる
- 構成：褒める → 課題 → 励まし
- 語尾は「〜ですね」「〜でした」などの丁寧語
- 生徒の名前（さん付け）を必ず使う"""


def generate_comment(student_name: str, grade: str, eiken: str, agg: dict[str, Any]) -> str:
    """Call Anthropic API. Falls back to a deterministic stub if no key."""
    top_weak_str = "、".join(agg["top_weak"]) if agg["top_weak"] else "なし"
    user_prompt = (
        f"生徒名: {student_name}\n"
        f"学年: {grade}\n"
        f"英検目標級: {eiken}\n"
        f"合計プレイ時間: {agg['total_minutes']}分\n"
        f"合計発話文数: {agg['total_sentences']}文\n"
        f"平均正答率: {agg['accuracy']:.1f}%\n"
        f"苦手単語トップ3: {top_weak_str}"
    )

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        logger.warning("ANTHROPIC_API_KEY 未設定: ローカルフォールバックコメントを生成します")
        return _fallback_comment(student_name, agg)

    try:
        import anthropic

        client = anthropic.Anthropic(api_key=api_key)
        msg = client.messages.create(
            model=os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-6"),
            max_tokens=400,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_prompt}],
        )
        parts = [b.text for b in msg.content if getattr(b, "type", None) == "text"]
        text = "".join(parts).strip()
        return text or _fallback_comment(student_name, agg)
    except Exception as e:
        logger.exception("Anthropic API 呼び出しに失敗: %s", e)
        return _fallback_comment(student_name, agg)


def _fallback_comment(student_name: str, agg: dict[str, Any]) -> str:
    top_weak = agg["top_weak"][0] if agg["top_weak"] else ""
    weak_part = f"苦手な「{top_weak}」は繰り返し練習しましょう。" if top_weak else "苦手な単語も少しずつ克服していきましょう。"
    return (
        f"{student_name}さん、今月は合計{agg['total_minutes']}分しっかり取り組めましたね。"
        f"発話{agg['total_sentences']}文・正答率{agg['accuracy']:.1f}%と、努力の成果が数字に表れています。"
        f"{weak_part}次回もこの調子で一緒に頑張りましょう。"
    )


# ---------- charts ----------
def render_daily_minutes_chart(df_student: pd.DataFrame) -> bytes:
    daily = df_student.groupby("play_date")["play_minutes"].sum().sort_index()
    fig, ax = plt.subplots(figsize=(5.2, 2.6), dpi=150)
    ax.bar([d.strftime("%m/%d") for d in daily.index], daily.values, color="#4C9AFF")
    ax.set_title("日別プレイ時間（分）", fontsize=10)
    ax.set_ylabel("分", fontsize=9)
    ax.tick_params(axis="x", rotation=45, labelsize=8)
    ax.tick_params(axis="y", labelsize=8)
    ax.grid(axis="y", linestyle="--", alpha=0.4)
    fig.tight_layout()
    buf = io.BytesIO()
    fig.savefig(buf, format="png")
    plt.close(fig)
    return buf.getvalue()


def render_accuracy_trend_chart(df_student: pd.DataFrame) -> bytes:
    per_day = df_student.groupby("play_date").agg(
        attempted=("words_attempted", "sum"),
        correct=("words_correct", "sum"),
    ).sort_index()
    per_day["acc"] = (per_day["correct"] / per_day["attempted"].replace(0, pd.NA) * 100).fillna(0)

    fig, ax = plt.subplots(figsize=(5.2, 2.6), dpi=150)
    ax.plot([d.strftime("%m/%d") for d in per_day.index], per_day["acc"].values,
            marker="o", color="#36B37E", linewidth=2)
    ax.set_ylim(0, 100)
    ax.set_title("正答率の推移（%）", fontsize=10)
    ax.set_ylabel("%", fontsize=9)
    ax.tick_params(axis="x", rotation=45, labelsize=8)
    ax.tick_params(axis="y", labelsize=8)
    ax.grid(axis="y", linestyle="--", alpha=0.4)
    fig.tight_layout()
    buf = io.BytesIO()
    fig.savefig(buf, format="png")
    plt.close(fig)
    return buf.getvalue()


# ---------- PDF ----------
def _wrap_text(text: str, max_chars: int) -> list[str]:
    out: list[str] = []
    line = ""
    for ch in text:
        line += ch
        if ch == "\n" or len(line) >= max_chars:
            out.append(line.rstrip("\n"))
            line = ""
    if line:
        out.append(line)
    return out


def draw_student_page(
    c: canvas.Canvas,
    student: dict[str, Any],
    agg: dict[str, Any],
    comment: str,
    chart_minutes: bytes,
    chart_accuracy: bytes,
    period_label: str,
) -> None:
    width, height = A4
    margin = 18 * mm
    y = height - margin

    # Header band
    c.setFillColor(colors.HexColor("#2C3E50"))
    c.rect(0, y - 2 * mm, width, 22 * mm, fill=1, stroke=0)
    c.setFillColor(colors.white)
    c.setFont(JP_FONT, 18)
    c.drawString(margin, y + 8 * mm, f"{student['student_name']} さんの学習レポート")
    c.setFont(JP_FONT, 10)
    c.drawString(margin, y + 1 * mm, f"保護者: {student['parent_name']} 様 ／ {student['grade']} ／ 英検 {student['eiken_level']} 目標")
    c.drawRightString(width - margin, y + 1 * mm, f"期間: {period_label}")
    c.setFillColor(colors.black)

    y -= 28 * mm

    # Summary stats box
    c.setFont(JP_FONT, 11)
    c.setFillColor(colors.HexColor("#F4F6F8"))
    c.rect(margin, y - 28 * mm, width - 2 * margin, 28 * mm, fill=1, stroke=0)
    c.setFillColor(colors.black)

    stat_cells = [
        ("プレイ回数", f"{agg['sessions']}回"),
        ("合計プレイ時間", f"{agg['total_minutes']}分"),
        ("発話文数", f"{agg['total_sentences']}文"),
        ("ミッション達成", f"{agg['total_missions']}個"),
        ("平均正答率", f"{agg['accuracy']:.1f}%"),
    ]
    col_w = (width - 2 * margin) / len(stat_cells)
    for i, (label, value) in enumerate(stat_cells):
        cx = margin + col_w * i + col_w / 2
        c.setFont(JP_FONT, 9)
        c.setFillColor(colors.HexColor("#607080"))
        c.drawCentredString(cx, y - 8 * mm, label)
        c.setFont(JP_FONT, 16)
        c.setFillColor(colors.HexColor("#2C3E50"))
        c.drawCentredString(cx, y - 20 * mm, value)
    c.setFillColor(colors.black)

    y -= 36 * mm

    # Charts (side by side)
    from reportlab.lib.utils import ImageReader

    chart_w = (width - 2 * margin - 6 * mm) / 2
    chart_h = 55 * mm
    c.drawImage(ImageReader(io.BytesIO(chart_minutes)), margin, y - chart_h,
                width=chart_w, height=chart_h, preserveAspectRatio=True, anchor="c")
    c.drawImage(ImageReader(io.BytesIO(chart_accuracy)), margin + chart_w + 6 * mm, y - chart_h,
                width=chart_w, height=chart_h, preserveAspectRatio=True, anchor="c")
    y -= chart_h + 6 * mm

    # AI comment box
    c.setFont(JP_FONT, 12)
    c.setFillColor(colors.HexColor("#2C3E50"))
    c.drawString(margin, y, "担当者からのコメント")
    y -= 4 * mm
    box_h = 36 * mm
    c.setFillColor(colors.HexColor("#FFF8E1"))
    c.setStrokeColor(colors.HexColor("#F5C518"))
    c.rect(margin, y - box_h, width - 2 * margin, box_h, fill=1, stroke=1)
    c.setFillColor(colors.black)
    c.setFont(JP_FONT, 11)
    lines = _wrap_text(comment, max_chars=38)
    tx = margin + 4 * mm
    ty = y - 6 * mm
    for line in lines:
        c.drawString(tx, ty, line)
        ty -= 5.2 * mm
        if ty < y - box_h + 3 * mm:
            break
    y -= box_h + 6 * mm

    # Weak words
    c.setFont(JP_FONT, 12)
    c.setFillColor(colors.HexColor("#2C3E50"))
    c.drawString(margin, y, "苦手単語トップ3")
    y -= 6 * mm
    c.setFont(JP_FONT, 11)
    c.setFillColor(colors.black)
    if agg["top_weak"]:
        for i, w in enumerate(agg["top_weak"], 1):
            count = agg["all_weak_counts"].get(w, 0)
            c.drawString(margin + 4 * mm, y, f"{i}. {w}  （{count}回）")
            y -= 5.5 * mm
    else:
        c.drawString(margin + 4 * mm, y, "特筆すべき苦手単語はありませんでした。")
        y -= 5.5 * mm

    # Footer
    c.setFont(JP_FONT, 8)
    c.setFillColor(colors.HexColor("#808080"))
    c.drawString(margin, 10 * mm, f"U-Speak Roblox 学習レポート / 発行日: {date.today().isoformat()}")
    c.drawRightString(width - margin, 10 * mm, "このレポートはAIが生成した分析を含みます")


def build_pdf(df: pd.DataFrame, student_names: list[str],
              start: date | None, end: date | None) -> bytes:
    period_label = f"{start or '全期間開始'} 〜 {end or '全期間終了'}"

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    c.setTitle("保護者向け学習レポート")

    any_page = False
    for name in student_names:
        ds = df[df["student_name"] == name]
        ds = filter_by_date(ds, start, end)
        if ds.empty:
            continue
        agg = aggregate_student(ds)
        student = {
            "student_name": name,
            "parent_name": str(ds["parent_name"].iloc[0]),
            "grade": str(ds["grade"].iloc[0]),
            "eiken_level": str(ds["eiken_level"].iloc[0]),
        }
        comment = generate_comment(name, student["grade"], student["eiken_level"], agg)
        chart_m = render_daily_minutes_chart(ds)
        chart_a = render_accuracy_trend_chart(ds)
        draw_student_page(c, student, agg, comment, chart_m, chart_a, period_label)
        c.showPage()
        any_page = True

    if not any_page:
        raise HTTPException(status_code=400, detail="対象期間に該当するデータがありません")

    c.save()
    return buf.getvalue()


# ---------- routes ----------
@app.get("/", response_class=HTMLResponse)
async def index() -> HTMLResponse:
    return HTMLResponse((STATIC_DIR / "index.html").read_text(encoding="utf-8"))


@app.post("/api/upload", response_model=UploadResponse)
async def upload(file: UploadFile = File(...)) -> UploadResponse:
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="CSVファイルをアップロードしてください")
    raw = await file.read()
    df = parse_csv(raw)
    session_id = uuid.uuid4().hex
    SESSIONS[session_id] = df
    return UploadResponse(session_id=session_id, students=summarize_students(df))


@app.post("/api/generate")
async def generate(req: GenerateRequest):
    df = SESSIONS.get(req.session_id)
    if df is None:
        raise HTTPException(status_code=404, detail="セッションが見つかりません。CSVを再アップロードしてください")
    if not req.student_names:
        raise HTTPException(status_code=400, detail="生徒を1名以上選択してください")

    def _parse(d: str | None) -> date | None:
        if not d:
            return None
        try:
            return datetime.strptime(d, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(status_code=400, detail=f"日付形式が不正です: {d}")

    pdf = build_pdf(df, req.student_names, _parse(req.start_date), _parse(req.end_date))

    out_path = TMP_DIR / f"report_{uuid.uuid4().hex}.pdf"
    out_path.write_bytes(pdf)
    return FileResponse(
        out_path,
        media_type="application/pdf",
        filename="parent_report.pdf",
    )


@app.get("/api/health")
async def health() -> JSONResponse:
    return JSONResponse({"status": "ok", "has_api_key": bool(os.environ.get("ANTHROPIC_API_KEY"))})
