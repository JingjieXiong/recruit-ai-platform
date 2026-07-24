#!/usr/bin/env python3
import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET


def clean(text, max_chars):
    text = re.sub(r"\x00", " ", text or "")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()[:max_chars]


def extract_pdf(path, max_chars):
    warnings = []
    try:
        from pypdf import PdfReader
        reader = PdfReader(path)
        parts = []
        for page in reader.pages[:80]:
            parts.append(page.extract_text() or "")
            if sum(len(item) for item in parts) >= max_chars:
                break
        return clean("\n".join(parts), max_chars), "pypdf", warnings
    except Exception as exc:
        warnings.append(f"pypdf: {exc}")
    try:
        import pdfplumber
        parts = []
        with pdfplumber.open(path) as pdf:
            for page in pdf.pages[:80]:
                parts.append(page.extract_text() or "")
                if sum(len(item) for item in parts) >= max_chars:
                    break
        return clean("\n".join(parts), max_chars), "pdfplumber", warnings
    except Exception as exc:
        warnings.append(f"pdfplumber: {exc}")
    return "", "pdf_unavailable", warnings


def xml_text(xml_bytes):
    try:
        root = ET.fromstring(xml_bytes)
        return "\n".join(node.text for node in root.iter() if node.text)
    except Exception:
        text = re.sub(rb"<[^>]+>", b" ", xml_bytes)
        return text.decode("utf-8", errors="ignore")


def extract_docx(path, max_chars):
    with zipfile.ZipFile(path) as archive:
        xml = archive.read("word/document.xml")
    return clean(xml_text(xml), max_chars), "docx_zip_xml", []


def extract_xlsx(path, max_chars):
    warnings = []
    try:
        import openpyxl
        wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
        rows = []
        for sheet in wb.worksheets[:8]:
            rows.append(f"Sheet: {sheet.title}")
            for row in sheet.iter_rows(max_row=300, values_only=True):
                values = [str(value) for value in row if value is not None and str(value).strip()]
                if values:
                    rows.append(" | ".join(values))
                if sum(len(item) for item in rows) >= max_chars:
                    break
        return clean("\n".join(rows), max_chars), "openpyxl", warnings
    except Exception as exc:
        warnings.append(f"openpyxl: {exc}")
    try:
        with zipfile.ZipFile(path) as archive:
            names = [name for name in archive.namelist() if name.startswith("xl/worksheets/") or name == "xl/sharedStrings.xml"]
            text = "\n".join(xml_text(archive.read(name)) for name in names[:12])
        return clean(text, max_chars), "xlsx_zip_xml", warnings
    except Exception as exc:
        warnings.append(f"xlsx_zip_xml: {exc}")
    return "", "xlsx_unavailable", warnings


def extract_pptx(path, max_chars):
    with zipfile.ZipFile(path) as archive:
        names = sorted(name for name in archive.namelist() if name.startswith("ppt/slides/slide") and name.endswith(".xml"))
        parts = []
        for name in names[:80]:
            parts.append(xml_text(archive.read(name)))
            if sum(len(item) for item in parts) >= max_chars:
                break
    return clean("\n".join(parts), max_chars), "pptx_zip_xml", []


def main():
    path = sys.argv[1]
    ext = (sys.argv[2] if len(sys.argv) > 2 else "").lower()
    max_chars = int(sys.argv[3]) if len(sys.argv) > 3 else 8000
    if ext == ".pdf":
        text, method, warnings = extract_pdf(path, max_chars)
    elif ext == ".docx":
        text, method, warnings = extract_docx(path, max_chars)
    elif ext == ".xlsx":
        text, method, warnings = extract_xlsx(path, max_chars)
    elif ext == ".pptx":
        text, method, warnings = extract_pptx(path, max_chars)
    else:
        with open(path, "rb") as file:
            text = file.read().decode("utf-8", errors="ignore")
        text, method, warnings = clean(text, max_chars), "utf8_python", []
    print(json.dumps({"text": text, "method": method, "warnings": warnings}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"text": "", "method": "failed", "warnings": [str(exc)]}, ensure_ascii=False))
        sys.exit(0)
