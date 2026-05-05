"""Smoke-тесты API. Запуск: pip install -r requirements-dev.txt && pytest"""
from __future__ import annotations

import importlib
import json
import os
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("ALLOW_INSECURE_EDIT", "1")
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("BOT_TOKEN", "")
    # Перечитать main с новым DATA_DIR
    for mod in ("main", "bot"):
        if mod in sys.modules:
            del sys.modules[mod]
    sys.path.insert(0, str(ROOT))
    import main as m

    importlib.reload(m)
    from starlette.testclient import TestClient

    with TestClient(m.app) as tc:
        yield tc


def test_put_get_profile(client):
    r = client.put(
        "/api/public/test-user",
        json={"displayName": "Тест", "bio": "Привет", "links": []},
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["slug"] == "test-user"
    assert data["displayName"] == "Тест"

    g = client.get("/api/public/test-user")
    assert g.status_code == 200
    assert g.json()["bio"] == "Привет"


def test_click_counter(client):
    link_id = "btn-1"
    client.put(
        "/api/public/counter-slug",
        json={
            "displayName": "C",
            "bio": "",
            "links": [{"id": link_id, "title": "Go", "url": "https://example.com"}],
        },
    )
    c = client.post("/api/public/counter-slug/click", json={"linkId": link_id, "website": ""})
    assert c.status_code == 200, c.text
    c2 = client.post("/api/public/counter-slug/click", json={"linkId": link_id, "website": ""})
    assert c2.status_code == 200

    g = client.get("/api/public/counter-slug")
    assert g.status_code == 200
    counts = g.json().get("linkClicks") or {}
    assert counts.get(link_id) == 2


def test_avatar_rejects_non_image(client):
    client.put(
        "/api/public/av-slug",
        json={"displayName": "A", "bio": "", "links": []},
    )
    # Нет JPEG-сигнатуры
    bad = b"not an image at all"
    r = client.post(
        "/api/public/av-slug/avatar",
        files={"file": ("x.jpg", bad, "image/jpeg")},
    )
    assert r.status_code == 400
    assert "not_image" in r.text or "detail" in r.text


def test_reserved_slug_rejected(client):
    r = client.put(
        "/api/public/edit",
        json={"displayName": "X", "bio": "", "links": []},
    )
    assert r.status_code == 400
