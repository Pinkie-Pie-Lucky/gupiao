import contextlib
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
import pypdfium2 as pdfium
import requests


CNINFO_ORIGIN = "http://www.cninfo.com.cn"
CNINFO_STATIC_ORIGIN = "http://static.cninfo.com.cn"
CACHE_TTL_SECONDS = 7 * 24 * 60 * 60
MAX_DOCUMENT_BYTES = 40 * 1024 * 1024
MAX_PDF_PAGES = 650
MIN_TEXT_CHARS_PER_PAGE = 20
OCR_MIN_CONFIDENCE = 0.75
MAX_OCR_PAGES = 80
OCR_RENDER_SCALE = 2
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
            pages.append({"pageNumber": index, "text": text, "textSource": "pdf_text", "confidence": 1.0})
    text_pages = sum(1 for page in pages if len(page["text"]) >= MIN_TEXT_CHARS_PER_PAGE)
    return pages, {"pageCount": len(pages), "textLayerPages": text_pages}


SECTION_PATTERNS = {
    "business_by_product": ["分产品", "按产品", "产品构成", "产品收入", "主营业务产品"],
    "business_by_region": ["分地区", "按地区", "地区构成", "地区收入"],
    "business_by_industry": ["分行业", "按行业", "行业构成", "行业收入"],
    "revenue_composition": ["营业收入构成", "主营业务收入", "营业收入按", "收入构成"],
}


def ocr_cache_path(item_dir: Path) -> Path:
    return item_dir / "ocr.json"


def read_ocr_cache(path: Path, sha256: str) -> dict | None:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        if payload.get("sha256") == sha256 and isinstance(payload.get("pages"), list):
            return payload
    except (OSError, ValueError, TypeError):
        pass
    return None


def configure_paddle_cache(root: Path) -> None:
    os.environ.setdefault("PADDLE_PDX_MODEL_SOURCE", "BOS")
    os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")
    os.environ.setdefault("PADDLE_PDX_CACHE_HOME", str(root.parent / "paddleocr"))


def ocr_pdf_pages(file_path: Path, item_dir: Path, root: Path, target_pages: list[int], sha256: str) -> tuple[dict, list[str]]:
    cached = read_ocr_cache(ocr_cache_path(item_dir), sha256)
    needed = set(target_pages[:MAX_OCR_PAGES])
    if cached and needed.issubset({int(item.get("pageNumber", 0)) for item in cached["pages"]}):
        return cached, []

    configure_paddle_cache(root)
    try:
        from paddleocr import PaddleOCR
        import paddleocr
    except ImportError:
        return {"engine": "paddleocr", "available": False, "pages": []}, ["PaddleOCR 未安装，扫描页保持待 OCR。"]

    try:
        # Node 侧以 stdout 作为 JSON 协议通道；Paddle 的初始化日志必须转到 stderr。
        with contextlib.redirect_stdout(sys.stderr):
            engine = PaddleOCR(
                device="cpu",
                enable_mkldnn=False,
                use_doc_orientation_classify=False,
                use_doc_unwarping=False,
                use_textline_orientation=False,
            )
        document = pdfium.PdfDocument(str(file_path))
        image_dir = item_dir / "ocr-pages"
        image_dir.mkdir(parents=True, exist_ok=True)
        pages = []
        for page_number in sorted(needed):
            image_path = image_dir / f"page-{page_number:04d}.png"
            page = document[page_number - 1]
            page.render(scale=OCR_RENDER_SCALE).to_pil().save(image_path)
            with contextlib.redirect_stdout(sys.stderr):
                result = next(iter(engine.predict(str(image_path))))
            value = result.json.get("res", {})
            texts = [str(text).strip() for text in value.get("rec_texts", []) if str(text).strip()]
            scores = [float(score) for score in value.get("rec_scores", []) if isinstance(score, (int, float))]
            mean_confidence = round(sum(scores) / len(scores), 4) if scores else 0.0
            pages.append({
                "pageNumber": page_number,
                "text": "\n".join(texts),
                "meanConfidence": mean_confidence,
                "lineCount": len(texts),
                "engine": "paddleocr",
                "engineVersion": getattr(paddleocr, "__version__", "unknown"),
            })
            image_path.unlink(missing_ok=True)
        try:
            image_dir.rmdir()
        except OSError:
            pass
        payload = {"sha256": sha256, "engine": "paddleocr", "engineVersion": getattr(paddleocr, "__version__", "unknown"), "pages": pages}
        ocr_cache_path(item_dir).write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        return payload, []
    except Exception as error:
        return {"engine": "paddleocr", "available": False, "pages": []}, [f"PaddleOCR 扫描页识别失败：{str(error)[:180]}。"]


def merge_ocr_pages(pages: list[dict], ocr_payload: dict, document_evidence_id: str) -> tuple[list[dict], list[dict], list[str]]:
    ocr_by_page = {int(item.get("pageNumber", 0)): item for item in ocr_payload.get("pages", [])}
    ocr_evidence = []
    gaps = []
    for page in pages:
        if len(page["text"]) >= MIN_TEXT_CHARS_PER_PAGE:
            continue
        ocr = ocr_by_page.get(page["pageNumber"])
        if not ocr or not str(ocr.get("text") or "").strip():
            gaps.append(f"第 {page['pageNumber']} 页缺少原生文字且 OCR 未识别出有效文本。")
            continue
        confidence = float(ocr.get("meanConfidence") or 0)
        evidence_id = f"{document_evidence_id}:ocr:p{page['pageNumber']}"
        ocr_evidence.append({
            "evidenceId": evidence_id,
            "pageNumber": page["pageNumber"],
            "source": "ocr",
            "engine": ocr.get("engine", "paddleocr"),
            "engineVersion": ocr.get("engineVersion", "unknown"),
            "meanConfidence": confidence,
            "lineCount": int(ocr.get("lineCount") or 0),
        })
        if confidence < OCR_MIN_CONFIDENCE:
            gaps.append(f"第 {page['pageNumber']} 页 OCR 平均置信度为 {confidence:.2f}，低于 {OCR_MIN_CONFIDENCE:.2f}，不用于研究结论。")
            continue
        page.update({"text": str(ocr["text"]), "textSource": "ocr", "confidence": confidence, "ocrEvidenceId": evidence_id})
    return pages, ocr_evidence, gaps


def page_sections(pages: list[dict], document_evidence_id: str) -> list[dict]:
    found = []
    seen = set()
    for page in pages:
        normalized = normalize_text(page["text"])
        if len(normalized) < MIN_TEXT_CHARS_PER_PAGE or (page.get("textSource") == "ocr" and float(page.get("confidence") or 0) < OCR_MIN_CONFIDENCE):
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
                "textSource": page.get("textSource", "pdf_text"),
                "ocrEvidenceId": page.get("ocrEvidenceId"),
                "confidence": page.get("confidence", 1.0),
            })
    return found[:24]


def as_number(value):
    """Return a report-table number without guessing units or column meanings."""
    text = str(value or "").strip().replace(",", "").replace("，", "")
    text = re.sub(r"[()（）]", "", text)
    if not text or text in {"-", "--", "不适用", "N/A"} or "%" in text:
        return None
    match = re.fullmatch(r"[-+]?\d+(?:\.\d+)?", text)
    return float(text) if match else None


def table_cell(value):
    return re.sub(r"\s+", "", str(value or "")).strip()


def table_headers(rows):
    """Use up to two header rows; annual-report tables commonly have merged headers."""
    if not rows:
        return []
    width = max(len(row) for row in rows[:2])
    values = []
    for index in range(width):
        parts = []
        for row in rows[:2]:
            cell = table_cell(row[index] if index < len(row) else "")
            if cell and cell not in parts:
                parts.append(cell)
        values.append("/".join(parts))
    return values


def find_column(headers, patterns):
    for index, header in enumerate(headers):
        if any(pattern in header for pattern in patterns):
            return index
    return None


def segment_dimension(section_type):
    return {
        "business_by_product": "product",
        "business_by_region": "region",
        "business_by_industry": "industry",
    }.get(section_type)


def extract_business_segments(file_path: Path, is_html: bool, sections: list[dict], document_evidence_id: str) -> dict:
    """Extract only explicit product/region/industry table values.

    A text hit alone remains original evidence.  It never becomes a numerical segment
    until the PDF table has a recognizable revenue column and a named row.
    """
    result = {"segmentSets": [], "dataGaps": []}
    by_page = {}
    for section in sections:
        dimension = segment_dimension(section.get("sectionType"))
        if dimension:
            by_page.setdefault((dimension, int(section["pageNumber"])), section)
    if not by_page:
        result["dataGaps"].append("未在报告正文定位到分产品、分地区或分行业章节；仅保留其他原文证据。")
        return result
    if is_html:
        result["dataGaps"].append("当前 HTML 公告未接入表格结构提取；已保留正文页码证据，不对经营分部数值作推断。")
        return result
    try:
        with pdfplumber.open(file_path) as document:
            for (dimension, page_number), section in by_page.items():
                page = document.pages[page_number - 1]
                tables = page.extract_tables() or []
                selected_items = []
                raw_rows = []
                for table in tables:
                    rows = [[table_cell(cell) for cell in (row or [])] for row in table if row]
                    if len(rows) < 3:
                        continue
                    headers = table_headers(rows)
                    revenue_index = find_column(headers, ["营业收入", "主营业务收入", "收入"])
                    profit_index = find_column(headers, ["营业利润", "净利润", "分部利润"])
                    revenue_yoy_index = find_column(headers, ["营业收入比上年", "收入同比", "收入增长"])
                    name_index = 0
                    if revenue_index is None:
                        continue
                    active_dimension = None
                    for row in rows:
                        name = table_cell(row[name_index] if name_index < len(row) else "")
                        if "分产品" in name or "按产品" in name:
                            active_dimension = "product"
                            continue
                        if "分地区" in name or "按地区" in name:
                            active_dimension = "region"
                            continue
                        if "分行业" in name or "按行业" in name:
                            active_dimension = "industry"
                            continue
                        if "销售模式" in name or "分渠道" in name or "按渠道" in name:
                            # These are useful disclosures, but not one of the three
                            # requested dimensions; do not leak them into regions.
                            active_dimension = "unsupported"
                            continue
                        if active_dimension is not None and active_dimension != dimension:
                            continue
                        revenue = as_number(row[revenue_index] if revenue_index < len(row) else "")
                        if not name or revenue is None or name in {"合计", "总计", "小计"}:
                            continue
                        profit = as_number(row[profit_index] if profit_index is not None and profit_index < len(row) else "")
                        revenue_yoy = as_number(row[revenue_yoy_index] if revenue_yoy_index is not None and revenue_yoy_index < len(row) else "")
                        selected_items.append({
                            "name": name[:100], "revenue": revenue, "profit": profit,
                            "revenueYoY": revenue_yoy / 100 if revenue_yoy is not None else None,
                            "unit": "document_reported", "period": None, "pageNumber": page_number,
                            "evidenceId": f"{document_evidence_id}:p{page_number}:{dimension}:{len(selected_items) + 1}",
                            "sourceEvidenceId": section["evidenceId"], "source": "cninfo_pdf_table",
                        })
                    if selected_items:
                        raw_rows = rows[:12]
                        break
                if selected_items:
                    total = sum(item["revenue"] for item in selected_items)
                    for item in selected_items:
                        item["revenueShare"] = round(item["revenue"] / total, 6) if total else None
                    ordered = sorted(selected_items, key=lambda item: item["revenue"], reverse=True)
                    top3 = sum(item["revenueShare"] or 0 for item in ordered[:3])
                    result["segmentSets"].append({
                        "dimension": dimension, "period": None, "unit": "document_reported",
                        "items": ordered[:30],
                        "concentration": {"top1RevenueShare": ordered[0]["revenueShare"], "top3RevenueShare": round(top3, 6), "basis": "extracted_items_only"},
                        "growthSources": [{"name": item["name"], "revenueYoY": item["revenueYoY"], "evidenceId": item["evidenceId"]} for item in ordered if item["revenueYoY"] is not None and item["revenueYoY"] > 0][:5],
                        "deteriorationSignals": [{"name": item["name"], "revenueYoY": item["revenueYoY"], "evidenceId": item["evidenceId"]} for item in ordered if item["revenueYoY"] is not None and item["revenueYoY"] < 0][:5], "rawTable": raw_rows,
                        "pageNumber": page_number, "evidenceId": section["evidenceId"], "status": "available",
                    })
                else:
                    result["segmentSets"].append({
                        "dimension": dimension, "period": None, "unit": None, "items": [],
                        "concentration": None, "growthSources": [], "deteriorationSignals": [],
                        "pageNumber": page_number, "evidenceId": section["evidenceId"], "status": "evidence_only",
                        "dataGap": "已定位章节，但表格列无法可靠识别为收入/利润；保留原文与页码，不输出推断数值。",
                    })
    except Exception as error:
        result["dataGaps"].append(f"分业务表格提取失败：{str(error)[:160]}；保留正文页码证据。")
    return result


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
    document_evidence_id = f"cninfo_document:{announcement_id}:{sha256[:16]}"
    ocr_evidence = []
    ocr_gaps = []
    ocr_meta = {"status": "not_needed", "engine": None, "processedPages": 0, "eligiblePages": 0}
    missing_pages = [page["pageNumber"] for page in pages if len(page["text"]) < MIN_TEXT_CHARS_PER_PAGE]
    if missing_pages and not is_html:
        ocr_payload, ocr_errors = ocr_pdf_pages(document_path, item_dir, root, missing_pages, sha256)
        pages, ocr_evidence, ocr_gaps = merge_ocr_pages(pages, ocr_payload, document_evidence_id)
        processed_pages = len(ocr_payload.get("pages", []))
        if ocr_errors:
            ocr_gaps.extend(ocr_errors)
        ocr_meta = {
            "status": "completed" if processed_pages >= len(missing_pages) and not ocr_errors else "partial" if processed_pages else "unavailable",
            "engine": ocr_payload.get("engine", "paddleocr"),
            "engineVersion": ocr_payload.get("engineVersion"),
            "processedPages": processed_pages,
            "eligiblePages": len(missing_pages),
            "maxPages": MAX_OCR_PAGES,
        }
    usable_pages = sum(1 for page in pages if len(page["text"]) >= MIN_TEXT_CHARS_PER_PAGE and (page.get("textSource") != "ocr" or float(page.get("confidence") or 0) >= OCR_MIN_CONFIDENCE))
    usable_coverage = round(usable_pages / page_count, 4) if page_count else 0
    scan_status = "text_ready" if coverage >= 0.8 else "ocr_ready" if usable_coverage >= 0.8 else "partial_ocr" if usable_pages else "needs_ocr"
    sections = page_sections(pages, document_evidence_id)
    business_segments = extract_business_segments(document_path, is_html, sections, document_evidence_id)
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
            "usableTextCoverage": usable_coverage,
            "scanStatus": scan_status,
            "ocr": ocr_meta,
        },
        "sections": sections,
        "businessSegments": business_segments,
        "ocrEvidence": ocr_evidence,
        "dataGaps": (["文档为扫描件或没有可用文字层，PaddleOCR 未获得足够高置信度文本，不输出正文证据。"] if scan_status == "needs_ocr" else ["部分页面缺少可用文字层，已启用 PaddleOCR；仅使用高置信度 OCR 页作为证据。"] if scan_status == "partial_ocr" else []) + ocr_gaps + business_segments.get("dataGaps", []),
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
