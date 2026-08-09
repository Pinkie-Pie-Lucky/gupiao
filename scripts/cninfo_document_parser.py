import hashlib
import html
import json
import os
import re
import sys
import time
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlparse

import pdfplumber
import requests


CNINFO_ORIGIN = "http://www.cninfo.com.cn"
CNINFO_STATIC_ORIGIN = "http://static.cninfo.com.cn"
CACHE_TTL_SECONDS = 7 * 24 * 60 * 60
MAX_DOCUMENT_BYTES = 40 * 1024 * 1024
MAX_PDF_PAGES = 650
MIN_TEXT_CHARS_PER_PAGE = 20
HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; PaopaoStockResearch/1.0)",
    "Referer": f"{CNINFO_ORIGIN}/new/disclosure/",
}


class TextCollector(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []

    def handle_data(self, data):
        value = data.strip()
        if value:
            self.parts.append(value)


def cache_root() -> Path:
    configured = os.environ.get("CNINFO_DOCUMENT_CACHE_DIR", "").strip()
    root = Path(configured) if configured else Path.cwd() / "work" / ".runtime" / "cninfo-documents"
    root.mkdir(parents=True, exist_ok=True)
    return root


def safe_id(value: str, name: str, pattern: str) -> str:
    value = str(value or "").strip()
    if not re.fullmatch(pattern, value):
        raise ValueError(f"{name} 格式不正确")
    return value


def normalize_text(value: str) -> str:
    return re.sub(r"\s+", "", str(value or "")).lower()


def classify_document(title: str) -> str:
    normalized = normalize_text(title)
    if "业绩预告" in normalized:
        return "earnings_forecast"
    if "半年度报告" in normalized or "半年度" in normalized or "半年报" in normalized:
        return "semi_annual_report"
    if "年度报告" in normalized or "年报" in normalized:
        return "annual_report"
    if "季度报告" in normalized or "一季度报告" in normalized or "三季度报告" in normalized:
        return "quarterly_report"
    return "other_announcement"


def is_cninfo_document_url(url: str) -> bool:
    parsed = urlparse(url)
    return parsed.scheme in {"http", "https"} and parsed.netloc.lower() in {"static.cninfo.com.cn", "www.cninfo.com.cn"} and bool(parsed.path)


def fetch_metadata(announcement_id: str, announcement_time: str, stock_code: str) -> dict:
    is_szse = stock_code.startswith(("0", "3"))
    response = requests.post(
        f"{CNINFO_ORIGIN}/new/announcement/bulletin_detail",
        params={"announceId": announcement_id, "flag": str(is_szse).lower(), "announceTime": announcement_time},
        headers=HEADERS,
        timeout=30,
    )
    response.raise_for_status()
    payload = response.json()
    announcement = payload.get("announcement") or {}
    file_url = str(payload.get("fileUrl") or "").strip()
    adjunct_url = str(announcement.get("adjunctUrl") or "").strip()
    if not file_url and adjunct_url:
        file_url = f"{CNINFO_STATIC_ORIGIN}/{adjunct_url.lstrip('/')}"
    if not is_cninfo_document_url(file_url):
        raise ValueError("巨潮未返回可校验的公告文档地址")
    return {
        "announcementId": str(announcement.get("announcementId") or announcement_id),
        "stockCode": str(announcement.get("secCode") or stock_code),
        "title": str(announcement.get("announcementTitle") or ""),
        "announcementTime": announcement.get("announcementTime"),
        "adjunctUrl": adjunct_url,
        "documentUrl": file_url,
        "documentType": str(announcement.get("adjunctType") or "").lower(),
        "documentSizeKB": announcement.get("adjunctSize"),
        "source": "cninfo",
    }


def read_cache(metadata_path: Path) -> dict | None:
    try:
        payload = json.loads(metadata_path.read_text(encoding="utf-8"))
        if time.time() - float(payload.get("cachedAt", 0)) <= CACHE_TTL_SECONDS:
            return payload
    except (OSError, ValueError, TypeError):
        pass
    return None


def download_document(document_url: str, destination: Path) -> tuple[str, int]:
    response = requests.get(document_url, headers=HEADERS, timeout=60, stream=True)
    response.raise_for_status()
    content_type = str(response.headers.get("Content-Type") or "").lower()
    total = 0
    digest = hashlib.sha256()
    temporary = destination.with_suffix(destination.suffix + ".part")
    try:
        with temporary.open("wb") as stream:
            for chunk in response.iter_content(64 * 1024):
                if not chunk:
                    continue
                total += len(chunk)
                if total > MAX_DOCUMENT_BYTES:
                    raise ValueError(f"公告文档超过 {MAX_DOCUMENT_BYTES // 1024 // 1024}MB 下载上限")
                digest.update(chunk)
                stream.write(chunk)
        temporary.replace(destination)
    finally:
        if temporary.exists():
            temporary.unlink()
    return digest.hexdigest(), total


def extract_html(file_path: Path) -> tuple[list[dict], dict]:
    raw = file_path.read_text(encoding="utf-8", errors="ignore")
    parser = TextCollector()
    parser.feed(raw)
    text = html.unescape(" ".join(parser.parts)).strip()
    return ([{"pageNumber": 1, "text": text}] if text else []), {"pageCount": 1, "textLayerPages": 1 if text else 0}


def extract_pdf(file_path: Path) -> tuple[list[dict], dict]:
    pages = []
    with pdfplumber.open(file_path) as document:
        if len(document.pages) > MAX_PDF_PAGES:
            raise ValueError(f"PDF 页数超过 {MAX_PDF_PAGES} 页解析上限")
        for index, page in enumerate(document.pages, start=1):
            text = (page.extract_text() or "").strip()
            pages.append({"pageNumber": index, "text": text})
    text_pages = sum(1 for page in pages if len(page["text"]) >= MIN_TEXT_CHARS_PER_PAGE)
    return pages, {"pageCount": len(pages), "textLayerPages": text_pages}


SECTION_PATTERNS = {
    "business_by_product": ["分产品", "按产品", "产品构成", "产品收入", "主营业务产品"],
    "business_by_region": ["分地区", "按地区", "地区构成", "地区收入"],
    "business_by_industry": ["分行业", "按行业", "行业构成", "行业收入"],
    "revenue_composition": ["营业收入构成", "主营业务收入", "营业收入按", "收入构成"],
}


def page_sections(pages: list[dict], document_evidence_id: str) -> list[dict]:
    found = []
    seen = set()
    for page in pages:
        normalized = normalize_text(page["text"])
        if len(normalized) < MIN_TEXT_CHARS_PER_PAGE:
            continue
        for kind, patterns in SECTION_PATTERNS.items():
            anchor = next((pattern for pattern in patterns if pattern in normalized), None)
            if not anchor or (kind, page["pageNumber"]) in seen:
                continue
            seen.add((kind, page["pageNumber"]))
            text = re.sub(r"\s+", " ", page["text"])
            position = normalize_text(text).find(anchor)
            snippet = text[max(0, position - 240): position + 1200].strip() if position >= 0 else text[:1400]
            found.append({
                "sectionType": kind,
                "pageNumber": page["pageNumber"],
                "anchor": anchor,
                "snippet": snippet,
                "evidenceId": f"{document_evidence_id}:p{page['pageNumber']}:{kind}",
                "sourceEvidenceId": document_evidence_id,
            })
    return found[:24]


def parse_document(announcement_id: str, announcement_time: str, stock_code: str, force: bool) -> dict:
    root = cache_root()
    item_dir = root / announcement_id
    item_dir.mkdir(parents=True, exist_ok=True)
    cache_path = item_dir / "metadata.json"
    cached = None if force else read_cache(cache_path)
    cache_hit = cached is not None
    metadata = cached.get("metadata") if cached else fetch_metadata(announcement_id, announcement_time, stock_code)
    title = str(metadata.get("title") or "")
    document_kind = classify_document(title)
    document_url = str(metadata.get("documentUrl") or "")
    extension = ".html" if document_url.lower().endswith((".html", ".htm")) else ".pdf"
    document_path = item_dir / f"document{extension}"
    sha256 = str(cached.get("sha256") or "") if cached else ""
    size_bytes = int(cached.get("sizeBytes") or 0) if cached else 0
    if force or not document_path.exists() or not sha256:
        sha256, size_bytes = download_document(document_url, document_path)
    is_html = extension == ".html"
    pages, extraction = extract_html(document_path) if is_html else extract_pdf(document_path)
    page_count = extraction["pageCount"]
    text_pages = extraction["textLayerPages"]
    coverage = round(text_pages / page_count, 4) if page_count else 0
    scan_status = "text_ready" if coverage >= 0.8 else "partial_text_layer" if text_pages else "needs_ocr"
    document_evidence_id = f"cninfo_document:{announcement_id}:{sha256[:16]}"
    sections = [] if scan_status == "needs_ocr" else page_sections(pages, document_evidence_id)
    result = {
        "document": {
            **metadata,
            "documentKind": document_kind,
            "priorityDocument": document_kind != "other_announcement",
            "sha256": sha256,
            "sizeBytes": size_bytes,
            "evidenceId": document_evidence_id,
            "pageCount": page_count,
            "textLayerPages": text_pages,
            "textLayerCoverage": coverage,
            "scanStatus": scan_status,
        },
        "sections": sections,
        "dataGaps": (["文档为扫描件或没有可用文字层，已标记待 OCR，未输出低置信度正文证据。"] if scan_status == "needs_ocr" else ["部分页面缺少可用文字层，只输出可提取页面的证据。"] if scan_status == "partial_text_layer" else []),
        "sourceMeta": {"source": "cninfo", "verification": "official_verified", "cache": "hit" if cache_hit else "miss", "cachedAt": cached.get("cachedAt") if cached else None},
    }
    cache_path.write_text(json.dumps({"cachedAt": time.time(), "metadata": metadata, "sha256": sha256, "sizeBytes": size_bytes}, ensure_ascii=False), encoding="utf-8")
    return result


def main() -> None:
    if len(sys.argv) < 4:
        raise ValueError("用法：cninfo_document_parser.py <announcementId> <YYYY-MM-DD> <stockCode> [--force]")
    announcement_id = safe_id(sys.argv[1], "announcementId", r"\d{8,20}")
    announcement_time = safe_id(sys.argv[2], "announcementTime", r"\d{4}-\d{2}-\d{2}")
    stock_code = safe_id(sys.argv[3], "stockCode", r"\d{6}")
    print(json.dumps(parse_document(announcement_id, announcement_time, stock_code, "--force" in sys.argv[4:]), ensure_ascii=False))


if __name__ == "__main__":
    main()
