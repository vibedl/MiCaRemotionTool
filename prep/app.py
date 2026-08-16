"""
Room Flythrough Prep — FastAPI service.

Standalone from the Node Studio: remove backgrounds from opaque shape photos,
scale them relative to room backgrounds, pick a camera preset, and write a
Studio-compatible job JSON into ../jobs/ (plus PNGs into ../uploads/).
"""

from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from typing import Literal

from collections import deque

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image, ImageChops, ImageFilter
from pydantic import BaseModel, Field

# ---------------------------------------------------------------------------
# Paths — Prep lives in <repo>/prep/, Studio assets in <repo>/uploads|jobs
# ---------------------------------------------------------------------------

PREP_ROOT = Path(__file__).resolve().parent
REPO_ROOT = PREP_ROOT.parent
UPLOADS_DIR = REPO_ROOT / "uploads"
JOBS_DIR = REPO_ROOT / "jobs"
INBOX_DIR = PREP_ROOT / "data" / "inbox"
MATTED_DIR = PREP_ROOT / "data" / "matted"
STATIC_DIR = PREP_ROOT / "static"
TEMPLATES_DIR = PREP_ROOT / "templates"

for d in (UPLOADS_DIR, JOBS_DIR, INBOX_DIR, MATTED_DIR, TEMPLATES_DIR):
    d.mkdir(parents=True, exist_ok=True)

PORT = 4400
JOB_VERSION = 1
JOB_SUFFIX = ".room-flythrough.job.json"
FPS = 30

# Session store (in-memory; fine for local / single-user prep)
sessions: dict[str, dict] = {}

# Lazy rembg session (birefnet-general — better hard edges than u2net)
_rembg_session = None
_rembg_model = "birefnet-general"


def get_rembg_session():
    global _rembg_session
    if _rembg_session is None:
        from rembg import new_session

        _rembg_session = new_session(_rembg_model)
    return _rembg_session


def sanitize_name(name: str) -> str:
    safe = re.sub(r"[^a-zA-Z0-9_-]+", "_", name or "prep-job").strip("_")
    return safe or "prep-job"


def label_from_filename(filename: str) -> str:
    return Path(filename).stem.replace("_", " ").strip() or "item"


# ---------------------------------------------------------------------------
# Camera presets (Studio cameraKeyframes)
# ---------------------------------------------------------------------------

CAMERA_PRESETS: dict[str, dict] = {
    "kenburns": {
        "label": "Ken Burns (Pan + Zoom)",
        "description": "Langsamer Schwenk mit leichter Zoom-Öffnung — Standard aus dem Studio.",
        "durationInFrames": 630,
        "keyframes": [
            {"frame": 0, "position": [0.15, 0.08, 8], "rotation": [1, 0.5], "fov": 15},
            {"frame": 90, "position": [-0.7, 0.05, 8], "rotation": [-5, 0.3], "fov": 19},
            {"frame": 200, "position": [0.85, -0.1, 8], "rotation": [6, -0.6], "fov": 25},
            {"frame": 320, "position": [-0.6, 0.12, 8], "rotation": [-4, 0.7], "fov": 21},
            {"frame": 440, "position": [0.5, -0.08, 8], "rotation": [3, -0.5], "fov": 27},
            {"frame": 560, "position": [-0.3, 0.05, 8], "rotation": [-2, 0.3], "fov": 29},
            {"frame": 629, "position": [0, 0.05, 8], "rotation": [0, 0.3], "fov": 30},
        ],
    },
    "gentle-orbit": {
        "label": "Sanfter Orbit",
        "description": "Leichte Links-Rechts-Bewegung, ruhiger Zoom.",
        "durationInFrames": 450,
        "keyframes": [
            {"frame": 0, "position": [-0.4, 0.05, 8], "rotation": [-3, 0.2], "fov": 18},
            {"frame": 150, "position": [0.5, 0.08, 8], "rotation": [4, -0.2], "fov": 22},
            {"frame": 300, "position": [-0.35, 0.0, 8], "rotation": [-2.5, 0.4], "fov": 24},
            {"frame": 449, "position": [0.1, 0.05, 8], "rotation": [0.5, 0.2], "fov": 26},
        ],
    },
    "push-in": {
        "label": "Push-In",
        "description": "Langsames Heranzoomen auf die Wandbilder.",
        "durationInFrames": 360,
        "keyframes": [
            {"frame": 0, "position": [0, 0.05, 8], "rotation": [0, 0.3], "fov": 28},
            {"frame": 180, "position": [0.1, 0.05, 8], "rotation": [1, 0.2], "fov": 20},
            {"frame": 359, "position": [0.15, 0.08, 8], "rotation": [1.5, 0.3], "fov": 15},
        ],
    },
    "static": {
        "label": "Statisch",
        "description": "Kaum Bewegung — gut zum Prüfen von Freistellung und Größe.",
        "durationInFrames": 300,
        "keyframes": [
            {"frame": 0, "position": [0, 0.05, 8], "rotation": [0, 0.3], "fov": 22},
            {"frame": 299, "position": [0, 0.05, 8], "rotation": [0, 0.3], "fov": 22},
        ],
    },
}


# ---------------------------------------------------------------------------
# Image helpers
# ---------------------------------------------------------------------------


def save_upload(file: UploadFile, dest: Path) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    data = file.file.read()
    dest.write_bytes(data)
    return dest


def _count_opaque(img: Image.Image, threshold: int = 16) -> int:
    alpha = img.getchannel("A")
    data = list(alpha.getdata())
    step = max(1, len(data) // 200_000)
    return sum(1 for i in range(0, len(data), step) if data[i] >= threshold) * step


def _crop_and_save(composed: Image.Image, dest: Path, *, edge_grow: int = 0, mode: str = "matte") -> dict:
    """Crop to opaque content. Scale uses the tight bbox (no pad) so gallery
    proportions match the real silhouette; a tiny pad is only for export bleed.
    """
    canvas_w, canvas_h = composed.size
    bbox = composed.getbbox()
    dest.parent.mkdir(parents=True, exist_ok=True)
    if not bbox:
        composed.save(dest, format="PNG")
        return {
            "width": canvas_w,
            "height": canvas_h,
            "bbox": None,
            "croppedSize": [canvas_w, canvas_h],
            "contentSize": [canvas_w, canvas_h],
            "canvasSize": [canvas_w, canvas_h],
            "opaquePixels": 0,
            "edgeGrow": edge_grow,
            "mode": mode,
        }

    x0, y0, x1, y1 = bbox
    content_w = max(1, x1 - x0)
    content_h = max(1, y1 - y0)
    # 1–2px pad only — percent pad used to inflate aspect and shrink shapes.
    pad = 2 if mode == "matte" else 1
    cx0 = max(0, x0 - pad)
    cy0 = max(0, y0 - pad)
    cx1 = min(canvas_w, x1 + pad)
    cy1 = min(canvas_h, y1 + pad)
    cropped = composed.crop((cx0, cy0, cx1, cy1))
    cropped.save(dest, format="PNG")
    return {
        "width": cropped.width,
        "height": cropped.height,
        "bbox": [cx0, cy0, cx1, cy1],
        "croppedSize": [content_w, content_h],
        "contentSize": [content_w, content_h],
        "paddedSize": [cropped.width, cropped.height],
        "canvasSize": [canvas_w, canvas_h],
        "opaquePixels": _count_opaque(cropped),
        "edgeGrow": edge_grow,
        "mode": mode,
    }


def _corner_flood_mask(img: Image.Image, thresh: int = 42) -> Image.Image:
    """Mark corner-connected background as 0, subject as 255."""
    rgba = img.convert("RGBA")
    w, h = rgba.size
    pixels = rgba.load()
    out = Image.new("L", (w, h), 255)
    out_px = out.load()
    visited: set[tuple[int, int]] = set()

    def color_dist(c1, c2) -> int:
        return abs(c1[0] - c2[0]) + abs(c1[1] - c2[1]) + abs(c1[2] - c2[2])

    for seed in ((0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)):
        if seed in visited:
            continue
        base = pixels[seed][:3]
        q = deque([seed])
        visited.add(seed)
        while q:
            x, y = q.popleft()
            if color_dist(pixels[x, y][:3], base) > thresh:
                continue
            out_px[x, y] = 0
            for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                if 0 <= nx < w and 0 <= ny < h and (nx, ny) not in visited:
                    if color_dist(pixels[nx, ny][:3], base) <= thresh:
                        visited.add((nx, ny))
                        q.append((nx, ny))
    return out


def preserve_form(src: Path, dest: Path) -> dict:
    """Keep existing silhouette — no rembg. Use alpha if present, else corner flood."""
    img = Image.open(src).convert("RGBA")
    if _has_meaningful_alpha(img):
        composed = img
    else:
        mask = _corner_flood_mask(img)
        mask = mask.filter(ImageFilter.MaxFilter(3))
        composed = img.copy()
        composed.putalpha(mask)
    return _crop_and_save(composed, dest, mode="preserve")


def _resolve_template_path(template_id: str) -> Path:
    safe = sanitize_name(template_id)
    tmpl_path = TEMPLATES_DIR / f"{safe}.png"
    if tmpl_path.exists():
        return tmpl_path
    for p in TEMPLATES_DIR.glob("*.png"):
        if p.stem.lower() == safe.lower() or p.stem.lower() == template_id.lower():
            return p
    raise ValueError(f"Unbekannte Form-Vorlage: {template_id}")


def apply_template(src: Path, dest: Path, template_id: str) -> dict:
    """Cover-fit photo into the opaque mask bbox (not full padded canvas), then crop."""
    tmpl_path = _resolve_template_path(template_id)
    photo = Image.open(src).convert("RGBA")
    tmpl = Image.open(tmpl_path).convert("RGBA")
    mask = tmpl.getchannel("A")
    tw, th = tmpl.size
    mb = mask.getbbox()
    if not mb:
        raise ValueError(f"Form-Vorlage ohne Alpha: {template_id}")
    mx0, my0, mx1, my1 = mb
    bw, bh = max(1, mx1 - mx0), max(1, my1 - my0)

    # Cover-fit into the opaque bbox only — padding around the silhouette
    # must not dilute how much of the photo lands inside the shape.
    pw, ph = photo.size
    scale = max(bw / max(1, pw), bh / max(1, ph))
    nw, nh = max(1, int(round(pw * scale))), max(1, int(round(ph * scale)))
    resized = photo.resize((nw, nh), Image.Resampling.LANCZOS)
    left = max(0, (nw - bw) // 2)
    top = max(0, (nh - bh) // 2)
    fitted = resized.crop((left, top, left + bw, top + bh))
    if fitted.size != (bw, bh):
        fitted = fitted.resize((bw, bh), Image.Resampling.LANCZOS)

    canvas = Image.new("RGBA", (tw, th), (0, 0, 0, 0))
    region_mask = mask.crop((mx0, my0, mx1, my1))
    fitted.putalpha(region_mask)
    canvas.paste(fitted, (mx0, my0), fitted)
    return _crop_and_save(canvas, dest, mode="template")


def remove_background(src: Path, dest: Path, edge_grow: int = 3) -> dict:
    """Cut out the subject with soft BiRefNet alpha; grow without hard binary edges."""
    from rembg import remove

    img = Image.open(src).convert("RGBA")
    mask_raw = remove(img, session=get_rembg_session(), only_mask=True)
    if not isinstance(mask_raw, Image.Image):
        mask = Image.open(BytesIO(mask_raw))
    else:
        mask = mask_raw
    soft = mask.convert("L")

    grow = max(1, min(5, int(edge_grow)))
    # Grow on a mid-threshold binary so morphology is stable, then keep the
    # softer rembg edge where it already covers the subject.
    binary = soft.point(lambda p: 255 if p >= 24 else 0)
    for _ in range(grow):
        binary = binary.filter(ImageFilter.MaxFilter(3))
    binary = binary.filter(ImageFilter.MaxFilter(3))
    binary = binary.filter(ImageFilter.MinFilter(3))

    soft_grown = soft
    for _ in range(max(1, grow - 1)):
        soft_grown = soft_grown.filter(ImageFilter.MaxFilter(3))
    # Union: dilated solid core + soft fringe from rembg
    combined = ImageChops.lighter(soft_grown, binary)
    combined = combined.filter(ImageFilter.GaussianBlur(radius=0.7))

    composed = img.copy()
    composed.putalpha(combined)
    return _crop_and_save(composed, dest, edge_grow=grow, mode="matte")


def process_shape(
    src: Path,
    dest: Path,
    *,
    cutout_mode: str = "matte",
    template_id: str | None = None,
    edge_grow: int = 3,
) -> dict:
    mode = (cutout_mode or "matte").lower()
    if mode == "preserve":
        return preserve_form(src, dest)
    if mode == "template":
        if not template_id:
            raise ValueError("Form-Vorlage gewählt, aber keine Vorlage ausgewählt.")
        return apply_template(src, dest, template_id)
    return remove_background(src, dest, edge_grow=edge_grow)


def list_template_files() -> list[dict]:
    out = []
    if not TEMPLATES_DIR.exists():
        return out
    for p in sorted(TEMPLATES_DIR.glob("*.png"), key=lambda x: x.stem.lower()):
        out.append(
            {
                "id": p.stem,
                "label": p.stem.replace("_", " "),
                "url": f"/api/templates/{p.stem}/preview",
            }
        )
    return out


def compute_shape_scale(matted_meta: dict, wall_size: float = 0.85) -> dict:
    """Map cropped motif aspect to Studio plane scales (shared wallSize = gallery)."""
    size = max(0.4, min(1.4, float(wall_size)))
    cropped = matted_meta.get("croppedSize")
    if isinstance(cropped, list) and len(cropped) >= 2:
        cw, ch = max(1, int(cropped[0])), max(1, int(cropped[1]))
    else:
        cw = max(1, int(matted_meta.get("width") or 1))
        ch = max(1, int(matted_meta.get("height") or 1))

    aspect = cw / ch
    if aspect >= 1:
        scale_x = size
        scale_y = size / aspect
    else:
        scale_y = size
        scale_x = size * aspect

    return {
        "scaleX": round(float(scale_x), 3),
        "scaleY": round(float(scale_y), 3),
        "aspectLock": True,
    }


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(title="Room Flythrough Prep", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.get("/", response_class=HTMLResponse)
def index():
    html = STATIC_DIR / "index.html"
    if not html.exists():
        return HTMLResponse("<p>Prep UI fehlt — static/index.html</p>", status_code=500)
    return HTMLResponse(html.read_text(encoding="utf-8"))


@app.get("/api/health")
def health():
    return {
        "ok": True,
        "service": "prep",
        "uploadsDir": str(UPLOADS_DIR),
        "jobsDir": str(JOBS_DIR),
        "rembgLoaded": _rembg_session is not None,
    }


@app.get("/api/presets")
def list_presets():
    return {
        "presets": [
            {"id": pid, "label": p["label"], "description": p["description"], "durationInFrames": p["durationInFrames"]}
            for pid, p in CAMERA_PRESETS.items()
        ]
    }


@app.get("/api/templates")
def list_templates():
    return {"templates": list_template_files()}


@app.get("/api/templates/{template_id}/preview")
def template_preview(template_id: str):
    safe = sanitize_name(template_id)
    path = TEMPLATES_DIR / f"{safe}.png"
    if not path.exists():
        found = None
        for p in TEMPLATES_DIR.glob("*.png"):
            if p.stem.lower() == safe.lower() or p.stem.lower() == template_id.lower():
                found = p
                break
        if not found:
            raise HTTPException(404, f"Vorlage nicht gefunden: {template_id}")
        path = found
    return FileResponse(path, media_type="image/png")


CutoutMode = Literal["preserve", "matte", "template"]


class ItemKind(BaseModel):
    id: str
    kind: Literal["room", "shape", "ignore"]
    cutoutMode: CutoutMode | None = None
    templateId: str | None = None


class ClassifyBody(BaseModel):
    sessionId: str
    items: list[ItemKind]


class BuildBody(BaseModel):
    sessionId: str
    jobName: str = "prep-job"
    cameraPreset: str = "kenburns"
    wallSize: float = Field(default=0.85, ge=0.4, le=1.4)
    studioUrl: str = "http://localhost:5183"


class MatteBody(BaseModel):
    edgeGrow: int = Field(default=3, ge=1, le=5)
    wallSize: float = Field(default=0.85, ge=0.4, le=1.4)


def _has_meaningful_alpha(img: Image.Image) -> bool:
    """True when alpha defines a silhouette (not just fully opaque / junk)."""
    if "A" not in img.getbands():
        return False
    alpha = img.convert("RGBA").getchannel("A")
    amin, amax = alpha.getextrema()
    if amax <= 0 or amin >= 250:
        return False
    data = list(alpha.getdata())
    step = max(1, len(data) // 80_000)
    soft = sum(1 for i in range(0, len(data), step) if data[i] < 250)
    return soft * step > max(64, len(data) // 200)


def _default_cutout_mode(path: Path) -> CutoutMode:
    """Prefer preserve when the source already has a real alpha silhouette."""
    try:
        with Image.open(path) as img:
            if _has_meaningful_alpha(img):
                return "preserve"
    except Exception:  # noqa: BLE001
        pass
    return "matte"


def _suggest_kind(path: Path, filename: str) -> str:
    lower = filename.lower()
    if any(k in lower for k in ("bg", "room", "raum", "hintergrund", "wall", "wand", "kulisse")):
        return "room"
    if any(k in lower for k in ("shape", "bild", "pic", "mask", "herz", "stern", "form", "motiv")):
        return "shape"
    try:
        with Image.open(path) as img:
            if _has_meaningful_alpha(img):
                return "shape"
            w, h = img.size
            # Wide, large, opaque photos are usually room backgrounds.
            if w >= 1200 and h >= 800 and (w / max(1, h)) >= 1.25:
                return "room"
    except Exception:  # noqa: BLE001
        pass
    return "shape"


def _default_template_id() -> str | None:
    templates = list_template_files()
    preferred = ("Herz", "Kreis", "Oval", "Stern", "Puzzle", "love")
    ids = {t["id"] for t in templates}
    for name in preferred:
        if name in ids:
            return name
    return templates[0]["id"] if templates else None


@app.post("/api/session")
async def create_session(files: list[UploadFile] = File(...)):
    if not files:
        raise HTTPException(400, "Keine Dateien.")
    session_id = str(uuid.uuid4())
    session_dir = INBOX_DIR / session_id
    session_dir.mkdir(parents=True, exist_ok=True)
    items = []
    for f in files:
        raw_name = f.filename or "image.png"
        ext = Path(raw_name).suffix.lower() or ".png"
        if ext not in {".png", ".jpg", ".jpeg", ".webp", ".bmp"}:
            continue
        item_id = uuid.uuid4().hex[:10]
        dest = session_dir / f"{item_id}{ext}"
        save_upload(f, dest)
        suggested = _suggest_kind(dest, raw_name)
        items.append(
            {
                "id": item_id,
                "label": label_from_filename(raw_name),
                "filename": raw_name,
                "path": str(dest),
                "url": f"/api/session/{session_id}/file/{item_id}",
                "suggestedKind": suggested,
                "kind": suggested,
                "cutoutMode": _default_cutout_mode(dest),
                "templateId": _default_template_id(),
                "mattedUrl": None,
                "meta": None,
            }
        )
    if not items:
        raise HTTPException(400, "Keine unterstützten Bilddateien.")
    sessions[session_id] = {"id": session_id, "items": items, "createdAt": datetime.now(timezone.utc).isoformat()}
    return {"sessionId": session_id, "items": _public_items(session_id)}


def _public_items(session_id: str) -> list[dict]:
    s = sessions[session_id]
    out = []
    for it in s["items"]:
        out.append(
            {
                "id": it["id"],
                "label": it["label"],
                "filename": it["filename"],
                "url": it["url"],
                "suggestedKind": it["suggestedKind"],
                "kind": it["kind"],
                "cutoutMode": it.get("cutoutMode") or "matte",
                "templateId": it.get("templateId"),
                "mattedUrl": it.get("mattedUrl"),
                "meta": it.get("meta"),
                "scale": it.get("scale"),
            }
        )
    return out


@app.get("/api/session/{session_id}/file/{item_id}")
def get_session_file(session_id: str, item_id: str):
    s = sessions.get(session_id)
    if not s:
        raise HTTPException(404, "Unbekannte Session.")
    item = next((i for i in s["items"] if i["id"] == item_id), None)
    if not item:
        raise HTTPException(404, "Unbekannte Datei.")
    return FileResponse(item["path"])


@app.get("/api/session/{session_id}/matted/{item_id}")
def get_matted_file(session_id: str, item_id: str):
    path = MATTED_DIR / session_id / f"{item_id}.png"
    if not path.exists():
        raise HTTPException(404, "Noch nicht freigestellt.")
    return FileResponse(path, media_type="image/png")


def _clear_matte(item: dict) -> None:
    item["mattedUrl"] = None
    item["mattedPath"] = None
    item["meta"] = None
    item["scale"] = None
    item.pop("mattedCutoutMode", None)
    item.pop("mattedTemplateId", None)


def _cutout_fingerprint(item: dict) -> tuple[str, str | None]:
    mode = (item.get("cutoutMode") or "matte").lower()
    tmpl = item.get("templateId") if mode == "template" else None
    return (mode, tmpl)


@app.post("/api/session/{session_id}/classify")
def classify(session_id: str, body: ClassifyBody):
    if body.sessionId != session_id:
        raise HTTPException(400, "sessionId mismatch")
    s = sessions.get(session_id)
    if not s:
        raise HTTPException(404, "Unbekannte Session.")
    by_id = {i["id"]: i for i in s["items"]}
    for entry in body.items:
        if entry.id not in by_id:
            continue
        item = by_id[entry.id]
        prev_kind = item.get("kind")
        prev_fp = _cutout_fingerprint(item)
        item["kind"] = entry.kind
        if entry.cutoutMode is not None:
            item["cutoutMode"] = entry.cutoutMode
        if entry.templateId is not None:
            item["templateId"] = entry.templateId
        # Kind/mode/template change invalidates prior cutout — avoid wrong PNG in build.
        if item["kind"] != "shape" or prev_kind != item["kind"] or prev_fp != _cutout_fingerprint(item):
            if item.get("mattedPath") or item.get("mattedUrl"):
                _clear_matte(item)
    return {"items": _public_items(session_id)}


@app.post("/api/session/{session_id}/matte")
def matte_shapes(session_id: str, body: MatteBody = MatteBody()):
    s = sessions.get(session_id)
    if not s:
        raise HTTPException(404, "Unbekannte Session.")
    shapes = [i for i in s["items"] if i["kind"] == "shape"]
    if not shapes:
        raise HTTPException(400, "Keine Shapes markiert.")
    edge_grow = body.edgeGrow
    wall_size = body.wallSize
    results = []
    for item in shapes:
        dest = MATTED_DIR / session_id / f"{item['id']}.png"
        mode = (item.get("cutoutMode") or "matte").lower()
        try:
            meta = process_shape(
                Path(item["path"]),
                dest,
                cutout_mode=mode,
                template_id=item.get("templateId"),
                edge_grow=edge_grow,
            )
        except ValueError as e:
            raise HTTPException(400, f"{item['label']}: {e}") from e
        except Exception as e:  # noqa: BLE001
            raise HTTPException(500, f"Freistellen fehlgeschlagen ({item['label']}): {e}") from e
        item["meta"] = meta
        item["mattedUrl"] = f"/api/session/{session_id}/matted/{item['id']}"
        item["mattedPath"] = str(dest)
        item["mattedCutoutMode"] = mode
        item["mattedTemplateId"] = item.get("templateId")
        item["scale"] = compute_shape_scale(meta, wall_size=wall_size)
        results.append(
            {
                "id": item["id"],
                "mattedUrl": item["mattedUrl"],
                "meta": meta,
                "scale": item["scale"],
                "cutoutMode": mode,
                "templateId": item.get("templateId"),
            }
        )
    return {"items": _public_items(session_id), "matted": results}


@app.post("/api/session/{session_id}/build")
def build_job(session_id: str, body: BuildBody):
    s = sessions.get(session_id)
    if not s:
        raise HTTPException(404, "Unbekannte Session.")
    if body.sessionId != session_id:
        raise HTTPException(400, "sessionId mismatch")

    rooms = [i for i in s["items"] if i["kind"] == "room"]
    shapes = [i for i in s["items"] if i["kind"] == "shape"]
    if not rooms:
        raise HTTPException(400, "Mindestens einen Hintergrund (Raum) wählen.")
    if not shapes:
        raise HTTPException(400, "Mindestens ein Shape wählen.")
    for sh in shapes:
        if not sh.get("mattedPath") or not Path(sh["mattedPath"]).exists():
            raise HTTPException(400, "Zuerst Shapes freistellen (Matte).")
        mode = (sh.get("cutoutMode") or "matte").lower()
        if sh.get("mattedCutoutMode") and sh.get("mattedCutoutMode") != mode:
            raise HTTPException(
                400,
                f"„{sh['label']}“: Cutout-Modus geändert — bitte erneut freistellen.",
            )
        if mode == "template" and sh.get("mattedTemplateId") and sh.get("mattedTemplateId") != sh.get("templateId"):
            raise HTTPException(
                400,
                f"„{sh['label']}“: Form-Vorlage geändert — bitte erneut freistellen.",
            )

    preset = CAMERA_PRESETS.get(body.cameraPreset)
    if not preset:
        raise HTTPException(400, f"Unbekanntes Preset: {body.cameraPreset}")

    # Copy media into Studio uploads/
    stamp = uuid.uuid4().hex[:8]
    job_name = sanitize_name(body.jobName)

    room_defs = []
    duration = int(preset["durationInFrames"])
    hold = max(1, duration // len(rooms))

    for idx, room in enumerate(rooms):
        src_path = Path(room["path"])
        filename = f"prep-{job_name}-room-{idx}-{stamp}{src_path.suffix.lower()}"
        dest = UPLOADS_DIR / filename
        dest.write_bytes(src_path.read_bytes())
        room_defs.append(
            {
                "label": room["label"],
                "src": f"upload:{filename}",
                "holdFrames": hold if idx < len(rooms) - 1 else duration - hold * (len(rooms) - 1),
                "scaleX": 1,
                "scaleY": 1,
                "aspectLock": True,
            }
        )

    picture_defs = []
    for idx, shape in enumerate(shapes):
        matted = Path(shape["mattedPath"])
        filename = f"prep-{job_name}-shape-{idx}-{stamp}.png"
        dest = UPLOADS_DIR / filename
        dest.write_bytes(matted.read_bytes())
        scale = compute_shape_scale(shape["meta"], wall_size=body.wallSize)
        shape["scale"] = scale
        picture_defs.append(
            {
                "label": shape["label"],
                "src": f"upload:{filename}",
                **scale,
                "offsetX": 0,
                "offsetY": 0,
            }
        )

    # Stretch keyframes to duration if needed (presets already match)
    keyframes = preset["keyframes"]

    job_file = {
        "version": JOB_VERSION,
        "name": job_name,
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "sourceFolder": str(REPO_ROOT),
        "durationInFrames": duration,
        "outputName": job_name,
        "job": {
            "pictures": picture_defs,
            "rooms": room_defs,
            "transitionFrames": 14,
            "crossfadeFrames": 30,
            "cameraKeyframes": keyframes,
            "shadow": {"offsetX": 0.045, "offsetY": -0.045, "opacity": 0.45},
            "gloss": {"strength": 0.35, "sharpness": 0.5, "reflectStrength": 0.2},
            "extrusionDepth": 0,
        },
        "prep": {
            "cameraPreset": body.cameraPreset,
            "wallSize": body.wallSize,
            "sessionId": session_id,
        },
    }

    out_path = JOBS_DIR / f"{job_name}.json"
    # Also keep portable long-suffix copy for local download compatibility
    portable_path = JOBS_DIR / f"{job_name}{JOB_SUFFIX}"
    payload = json.dumps(job_file, indent=2, ensure_ascii=False)
    out_path.write_text(payload, encoding="utf-8")
    portable_path.write_text(payload, encoding="utf-8")

    studio = body.studioUrl.rstrip("/")
    return {
        "ok": True,
        "jobPath": str(out_path),
        "jobName": job_name,
        "durationInFrames": duration,
        "rooms": len(room_defs),
        "pictures": len(picture_defs),
        "studioUrl": studio,
        "hint": f"Studio öffnet automatisch mit Job „{job_name}“.",
        "items": _public_items(session_id),
    }


@app.get("/api/session/{session_id}")
def get_session(session_id: str):
    if session_id not in sessions:
        raise HTTPException(404, "Unbekannte Session.")
    return {"sessionId": session_id, "items": _public_items(session_id)}
