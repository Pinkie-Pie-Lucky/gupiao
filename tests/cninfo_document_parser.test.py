import importlib.util
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("cninfo_document_parser.py")
SPEC = importlib.util.spec_from_file_location("cninfo_document_parser", MODULE_PATH)
PARSER = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(PARSER)


class CninfoDocumentParserTests(unittest.TestCase):
    def test_priority_document_classification(self):
        self.assertEqual(PARSER.classify_document("公司2025年年度报告"), "annual_report")
        self.assertEqual(PARSER.classify_document("公司2025年半年度报告"), "semi_annual_report")
        self.assertEqual(PARSER.classify_document("公司2025年第三季度报告"), "quarterly_report")
        self.assertEqual(PARSER.classify_document("公司2025年度业绩预告"), "earnings_forecast")

    def test_high_confidence_ocr_becomes_auditable_page(self):
        pages = [{"pageNumber": 1, "text": "", "textSource": "pdf_text", "confidence": 1.0}]
        payload = {"pages": [{"pageNumber": 1, "text": "按产品档次 茅台酒 系列酒 销售收入 报告期主营业务收入及产品构成情况说明", "meanConfidence": 0.96, "lineCount": 2, "engine": "paddleocr", "engineVersion": "3.7.0"}]}
        merged, evidence, gaps = PARSER.merge_ocr_pages(pages, payload, "cninfo_document:demo:hash")
        self.assertEqual(merged[0]["textSource"], "ocr")
        self.assertEqual(len(evidence), 1)
        self.assertEqual(gaps, [])
        sections = PARSER.page_sections(merged, "cninfo_document:demo:hash")
        self.assertEqual(sections[0]["sectionType"], "business_by_product")
        self.assertEqual(sections[0]["ocrEvidenceId"], evidence[0]["evidenceId"])

    def test_low_confidence_ocr_is_not_used_as_section_evidence(self):
        pages = [{"pageNumber": 1, "text": "", "textSource": "pdf_text", "confidence": 1.0}]
        payload = {"pages": [{"pageNumber": 1, "text": "按产品", "meanConfidence": 0.51, "lineCount": 1, "engine": "paddleocr", "engineVersion": "3.7.0"}]}
        merged, evidence, gaps = PARSER.merge_ocr_pages(pages, payload, "cninfo_document:demo:hash")
        self.assertEqual(merged[0]["text"], "")
        self.assertEqual(len(evidence), 1)
        self.assertEqual(PARSER.page_sections(merged, "cninfo_document:demo:hash"), [])
        self.assertEqual(len(gaps), 1)


if __name__ == "__main__":
    unittest.main()
